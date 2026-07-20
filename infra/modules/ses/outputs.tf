output "identity" { value = var.use_domain_identity ? var.sender_domain : var.sender_email }
output "configuration_set" { value = aws_sesv2_configuration_set.this.configuration_set_name }
output "event_queue_arn" { value = aws_sqs_queue.events.arn }
output "event_queue_url" { value = aws_sqs_queue.events.id }
output "event_dlq_name" { value = aws_sqs_queue.events_dlq.name }
output "dkim_tokens" { value = try(aws_sesv2_email_identity.sender[0].dkim_signing_attributes[0].tokens, []) }
