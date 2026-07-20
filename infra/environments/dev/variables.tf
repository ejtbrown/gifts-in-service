variable "region" {
  type    = string
  default = "us-east-1"
}
variable "church_display_name" {
  type    = string
  default = "Example Community Church"
}
variable "privacy_contact_email" {
  type    = string
  default = "privacy@example.invalid"
}
variable "help_contact_email" {
  type    = string
  default = "help@example.invalid"
}
variable "ses_sender_email" {
  type    = string
  default = "no-reply@example.invalid"
}
variable "ses_sender_domain" {
  type    = string
  default = "example.invalid"
}
variable "ses_use_domain_identity" {
  type    = bool
  default = false
}
variable "ses_manage_sender_identity" {
  type    = bool
  default = true
}
variable "budget_alert_email" {
  type    = string
  default = "cloud-owner@example.invalid"
}
variable "github_repository" {
  type    = string
  default = "owner/gifts-in-service"
}
variable "custom_domain_name" {
  type    = string
  default = ""
}
variable "route53_zone_id" {
  type    = string
  default = ""
}
