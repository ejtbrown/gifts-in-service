variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "kms_key_arn" { type = string }
variable "api_domain_name" { type = string }
variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
variable "waf_count_mode" { type = bool }
variable "custom_domain_name" { type = string }
variable "acm_certificate_arn" { type = string }
variable "magic_link_rate_limit" { type = number }
variable "redemption_rate_limit" { type = number }
variable "interview_rate_limit" { type = number }
variable "search_rate_limit" { type = number }
