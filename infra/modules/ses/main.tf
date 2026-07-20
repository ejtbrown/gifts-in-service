resource "aws_sesv2_email_identity" "sender" {
  count          = var.manage_sender_identity ? 1 : 0
  email_identity = var.use_domain_identity ? var.sender_domain : var.sender_email
  tags           = var.tags
}

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = "${var.prefix}-email"
  delivery_options { tls_policy = "REQUIRE" }
  reputation_options { reputation_metrics_enabled = true }
  sending_options { sending_enabled = true }
  suppression_options { suppressed_reasons = ["BOUNCE", "COMPLAINT"] }
  tags = var.tags
}

resource "aws_sqs_queue" "events_dlq" {
  name                      = "${var.prefix}-email-events-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = var.kms_key_arn
  tags                      = var.tags
}

resource "aws_sqs_queue" "events" {
  name                       = "${var.prefix}-email-events"
  visibility_timeout_seconds = 180
  kms_master_key_id          = var.kms_key_arn
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.events_dlq.arn, maxReceiveCount = 5 })
  tags                       = var.tags
}

resource "aws_sns_topic" "events" {
  name              = "${var.prefix}-ses-events"
  kms_master_key_id = var.kms_key_arn
  tags              = var.tags
}

data "aws_caller_identity" "current" {}

resource "aws_sns_topic_policy" "events" {
  arn = aws_sns_topic.events.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSesConfigurationSetEvents", Effect = "Allow",
      Principal = { Service = "ses.amazonaws.com" }, Action = "sns:Publish",
      Resource  = aws_sns_topic.events.arn,
      Condition = { StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_sqs_queue_policy" "events" {
  queue_url = aws_sqs_queue.events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage",
      Resource  = aws_sqs_queue.events.arn,
      Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } }
    }]
  })
}

resource "aws_sns_topic_subscription" "events" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.events.arn
}

resource "aws_sesv2_configuration_set_event_destination" "events" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "delivery-events"
  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "DELIVERY_DELAY"]
    sns_destination { topic_arn = aws_sns_topic.events.arn }
  }
}
