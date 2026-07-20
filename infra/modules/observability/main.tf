resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = {
        title = "Lambda errors and throttles", region = var.region, stat = "Sum", period = 300,
        metrics = concat(
          [for name in values(var.function_names) : ["AWS/Lambda", "Errors", "FunctionName", name]],
          [for name in values(var.function_names) : ["AWS/Lambda", "Throttles", "FunctionName", name]],
        )
      } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = {
        title   = "Lambda duration", region = var.region, stat = "p95", period = 300,
        metrics = [for name in values(var.function_names) : ["AWS/Lambda", "Duration", "FunctionName", name]]
      } }
    ]
  })
}

resource "aws_sns_topic" "alarms" {
  name              = "${var.prefix}-alarms"
  kms_master_key_id = var.kms_key_arn
  tags              = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.budget_alert_email
}

locals {
  alarm_actions = distinct(concat([aws_sns_topic.alarms.arn], var.alarm_actions))
}

resource "aws_cloudwatch_metric_alarm" "function_errors" {
  for_each            = var.function_names
  alarm_name          = "${var.prefix}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "function_throttles" {
  for_each            = var.function_names
  alarm_name          = "${var.prefix}-${each.key}-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each            = toset([var.jobs_dlq_name, var.email_events_dlq_name])
  alarm_name          = "${each.value}-visible"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.prefix}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id, Stage = "$default" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "application_errors" {
  for_each            = toset(["BedrockErrors", "DataApiErrors", "SesErrors", "SesFeedbackErrors"])
  alarm_name          = "${var.prefix}-${lower(each.value)}"
  namespace           = "GiftsInService"
  metric_name         = each.value
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "ses_reputation" {
  for_each            = { bounce = { metric = "Reputation.BounceRate", threshold = 0.05 }, complaint = { metric = "Reputation.ComplaintRate", threshold = 0.001 } }
  alarm_name          = "${var.prefix}-ses-${each.key}-rate"
  namespace           = "AWS/SES"
  metric_name         = each.value.metric
  statistic           = "Average"
  period              = 900
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  tags                = var.tags
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
