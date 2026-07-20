output "dashboard_name" { value = aws_cloudwatch_dashboard.this.dashboard_name }
output "alarm_names" {
  value = concat(
    values(aws_cloudwatch_metric_alarm.function_errors)[*].alarm_name,
    values(aws_cloudwatch_metric_alarm.function_throttles)[*].alarm_name,
    values(aws_cloudwatch_metric_alarm.dlq)[*].alarm_name,
    values(aws_cloudwatch_metric_alarm.application_errors)[*].alarm_name,
    values(aws_cloudwatch_metric_alarm.ses_reputation)[*].alarm_name,
    [aws_cloudwatch_metric_alarm.api_5xx.alarm_name]
  )
}
