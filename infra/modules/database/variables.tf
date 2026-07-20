variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "kms_key_arn" { type = string }
variable "engine_version" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.engine_version))
    error_message = "Aurora PostgreSQL engine_version must be an explicit major.minor release."
  }
}
variable "engine_support_end" {
  type = string
  validation {
    condition     = can(formatdate("YYYY-MM-DD", var.engine_support_end))
    error_message = "engine_support_end must be an RFC 3339 timestamp."
  }
}
variable "min_acu" { type = number }
variable "max_acu" { type = number }
variable "auto_pause_seconds" { type = number }
variable "backup_retention_days" { type = number }
variable "deletion_protection" { type = bool }
variable "skip_final_snapshot" { type = bool }
