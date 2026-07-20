variable "region" {
  type    = string
  default = "us-east-1"
}
variable "church_display_name" {
  type = string
  validation {
    condition     = length(trimspace(var.church_display_name)) >= 2
    error_message = "A reviewed church display name is required."
  }
}
variable "privacy_contact_email" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@[^@]+$", var.privacy_contact_email)) && !endswith(var.privacy_contact_email, ".invalid")
    error_message = "A reviewed production privacy contact is required."
  }
}
variable "help_contact_email" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@[^@]+$", var.help_contact_email)) && !endswith(var.help_contact_email, ".invalid")
    error_message = "A reviewed production help contact is required."
  }
}
variable "ses_sender_email" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@[^@]+$", var.ses_sender_email)) && !endswith(var.ses_sender_email, ".invalid")
    error_message = "A verified production SES sender is required."
  }
}
variable "ses_sender_domain" {
  type = string
  validation {
    condition     = length(var.ses_sender_domain) >= 3 && !endswith(var.ses_sender_domain, ".invalid")
    error_message = "A verified production SES domain is required."
  }
}
variable "ses_manage_sender_identity" {
  type    = bool
  default = true
}
variable "budget_alert_email" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@[^@]+$", var.budget_alert_email)) && !endswith(var.budget_alert_email, ".invalid")
    error_message = "A deliverable production budget contact is required."
  }
}
variable "github_repository" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be an exact owner/repository."
  }
}
variable "privacy_preflight_confirmed" {
  type    = bool
  default = false
}
variable "ses_production_ready" {
  type    = bool
  default = false
}
variable "custom_domain_name" {
  type    = string
  default = ""
}
variable "route53_zone_id" {
  type    = string
  default = ""
}
