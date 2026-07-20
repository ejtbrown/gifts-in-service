variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "kms_key_arn" { type = string }
variable "sender_email" { type = string }
variable "sender_domain" { type = string }
variable "use_domain_identity" { type = bool }
variable "manage_sender_identity" {
  type    = bool
  default = true
}
