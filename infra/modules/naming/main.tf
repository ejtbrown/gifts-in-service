locals {
  prefix = "gis-${var.environment}"
  tags = merge(
    {
      Application        = "GiftsInService"
      Environment        = var.environment
      ManagedBy          = "Terraform"
      DataClassification = "Confidential"
    },
    var.extra_tags,
    { project = "gifts-in-service" },
  )
}
