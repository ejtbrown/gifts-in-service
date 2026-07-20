data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_kms_key" "application" {
  description             = "Gifts in Service application data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministration", Effect = "Allow",
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
        Action    = "kms:*", Resource = "*"
      },
      {
        Sid       = "ScopedAWSServiceUse", Effect = "Allow",
        Principal = { Service = ["bedrock.amazonaws.com", "cloudfront.amazonaws.com", "logs.${data.aws_region.current.region}.amazonaws.com", "ses.amazonaws.com", "sns.amazonaws.com", "sqs.amazonaws.com"] },
        Action    = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"],
        Resource  = "*",
        Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
      }
    ]
  })
  tags = var.tags
}

resource "aws_kms_alias" "application" {
  name          = "alias/${var.prefix}-application"
  target_key_id = aws_kms_key.application.key_id
}
