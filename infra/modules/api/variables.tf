variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "region" { type = string }
variable "public_base_url" { type = string }
variable "allowed_origins" { type = string }
variable "church_display_name" { type = string }
variable "privacy_contact_email" { type = string }
variable "help_contact_email" { type = string }
variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
variable "magic_hmac_key" {
  type      = string
  sensitive = true
}
variable "session_hmac_key" {
  type      = string
  sensitive = true
}
variable "rds_cluster_arn" { type = string }
variable "rds_application_secret_arn" {
  type      = string
  sensitive = true
}
variable "rds_migration_secret_arn" {
  type      = string
  sensitive = true
}
variable "rds_master_secret_arn" {
  type      = string
  sensitive = true
}
variable "database_name" { type = string }
variable "kms_key_arn" { type = string }
variable "cognito_user_pool_id" { type = string }
variable "cognito_client_id" { type = string }
variable "cognito_client_secret" {
  type      = string
  sensitive = true
}
variable "ses_from_address" { type = string }
variable "ses_configuration_set" { type = string }
variable "guardrail_id" { type = string }
variable "guardrail_version" { type = string }
variable "interview_model_id" { type = string }
variable "search_model_id" { type = string }
variable "embedding_model_id" { type = string }
variable "embedding_dimension" { type = number }
variable "lambda_package_paths" { type = map(string) }
variable "log_retention_days" { type = number }
variable "api_id" { type = string }
variable "api_endpoint" { type = string }
variable "api_execution_arn" { type = string }
