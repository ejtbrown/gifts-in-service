variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "vpc_cidr" {
  type    = string
  default = "10.72.0.0/20"
}
