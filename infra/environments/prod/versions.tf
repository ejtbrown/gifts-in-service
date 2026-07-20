terraform {
  required_version = ">= 1.14.0, < 2.0.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.55" }
    random = { source = "hashicorp/random", version = "~> 3.9" }
  }
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
provider "aws" {
  region = var.region
  default_tags { tags = { Application = "GiftsInService", Environment = "prod", ManagedBy = "Terraform", DataClassification = "Confidential", project = "gifts-in-service" } }
}
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { project = "gifts-in-service" } }
}
