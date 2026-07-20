terraform {
  required_version = ">= 1.14.0, < 2.0.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.55" }
    random = { source = "hashicorp/random", version = "~> 3.9" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Application        = "GiftsInService"
      Environment        = "bootstrap"
      ManagedBy          = "Terraform"
      DataClassification = "Confidential"
      project            = "gifts-in-service"
    }
  }
}
