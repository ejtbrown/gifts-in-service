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
variable "github_repository_ids" {
  type = object({
    owner_id      = string
    repository_id = string
  })
  default     = null
  nullable    = true
  description = "Immutable GitHub owner and repository IDs for repositories using immutable OIDC subjects"
  validation {
    condition = var.github_repository_ids == null || (
      can(regex("^[0-9]+$", var.github_repository_ids.owner_id)) &&
      can(regex("^[0-9]+$", var.github_repository_ids.repository_id))
    )
    error_message = "github_repository_ids values must contain decimal digits only"
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
