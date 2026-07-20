variable "region" {
  type    = string
  default = "us-east-1"
}
variable "state_bucket_prefix" {
  type    = string
  default = "gifts-in-service-tfstate"
}
variable "github_repository" {
  type        = string
  description = "Exact owner/repository, for example fictional-owner/gifts-in-service"
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be exact owner/repository"
  }
}
variable "create_github_oidc_provider" {
  type    = bool
  default = true
}
variable "state_kms_deletion_window_days" {
  type    = number
  default = 30
}
