variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "region" { type = string }
variable "kms_key_arn" { type = string }
variable "api_id" { type = string }
variable "function_names" { type = map(string) }
variable "jobs_dlq_name" { type = string }
variable "email_events_dlq_name" { type = string }
variable "budget_limit_usd" { type = number }
variable "budget_alert_email" { type = string }
variable "alarm_actions" {
  type    = list(string)
  default = []
}
