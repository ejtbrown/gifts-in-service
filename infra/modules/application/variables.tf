variable "environment" { type = string }
variable "region" { type = string }
variable "church_display_name" { type = string }
variable "privacy_contact_email" { type = string }
variable "help_contact_email" { type = string }
variable "ses_sender_email" { type = string }
variable "ses_sender_domain" { type = string }
variable "ses_use_domain_identity" { type = bool }
variable "ses_manage_sender_identity" {
  type    = bool
  default = true
}
variable "ses_production_ready" { type = bool }
variable "privacy_preflight_confirmed" { type = bool }
variable "github_repository" { type = string }
variable "custom_domain_name" { type = string }
variable "route53_zone_id" { type = string }
variable "interview_model_id" { type = string }
variable "search_model_id" { type = string }
variable "embedding_model_id" { type = string }
variable "embedding_dimension" { type = number }
variable "aurora_engine_version" { type = string }
variable "aurora_support_end" { type = string }
variable "aurora_min_acu" { type = number }
variable "aurora_max_acu" { type = number }
variable "aurora_auto_pause_seconds" { type = number }
variable "backup_retention_days" { type = number }
variable "log_retention_days" { type = number }
variable "waf_count_mode" { type = bool }
variable "budget_limit_usd" { type = number }
variable "budget_alert_email" { type = string }
variable "extra_tags" {
  type    = map(string)
  default = {}
}
