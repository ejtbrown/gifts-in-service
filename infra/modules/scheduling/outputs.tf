output "lifecycle_schedule_name" { value = aws_scheduler_schedule.lifecycle.name }
output "jobs_dlq_name" { value = aws_sqs_queue.jobs_dlq.name }
output "reembed_queue_url" { value = aws_sqs_queue.reembed.id }
