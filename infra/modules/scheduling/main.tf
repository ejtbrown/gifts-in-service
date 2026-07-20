resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${var.prefix}-jobs-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = var.kms_key_arn
  tags                      = var.tags
}

resource "aws_sqs_queue" "reembed" {
  name                       = "${var.prefix}-reembed"
  visibility_timeout_seconds = 360
  kms_master_key_id          = var.kms_key_arn
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn, maxReceiveCount = 5 })
  tags                       = var.tags
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.prefix}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}

resource "aws_iam_role_policy" "scheduler" {
  role   = aws_iam_role.scheduler.id
  name   = "invoke-lifecycle"
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = var.lifecycle_function_arn }] })
}

resource "aws_scheduler_schedule" "lifecycle" {
  name                         = "${var.prefix}-daily-lifecycle"
  schedule_expression          = "cron(17 8 * * ? *)"
  schedule_expression_timezone = "UTC"
  state                        = "ENABLED"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = var.lifecycle_function_arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 3
    }
  }
}

resource "aws_lambda_permission" "scheduler" {
  statement_id  = "AllowEventBridgeScheduler"
  action        = "lambda:InvokeFunction"
  function_name = var.lifecycle_function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.lifecycle.arn
}

resource "aws_lambda_event_source_mapping" "email_events" {
  event_source_arn                   = var.email_event_queue_arn
  function_name                      = var.email_events_function_arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 10
  function_response_types            = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "reembed" {
  event_source_arn        = aws_sqs_queue.reembed.arn
  function_name           = var.reembed_function_arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_iam_role_policy" "queue_consumers" {
  for_each = {
    email_events = { role = var.email_events_function_role_name, queue = var.email_event_queue_arn }
    reembed      = { role = var.reembed_function_role_name, queue = aws_sqs_queue.reembed.arn }
  }
  name = "consume-${replace(each.key, "_", "-")}"
  role = each.value.role
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"], Resource = each.value.queue },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.kms_key_arn }
  ] })
}
