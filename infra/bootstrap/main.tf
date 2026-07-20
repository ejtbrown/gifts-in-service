resource "random_id" "suffix" { byte_length = 4 }

resource "aws_kms_key" "state" {
  description             = "Gifts in Service Terraform state"
  deletion_window_in_days = var.state_kms_deletion_window_days
  enable_key_rotation     = true
}

resource "aws_kms_alias" "state" {
  name          = "alias/gis-terraform-state"
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" {
  bucket = "${var.state_bucket_prefix}-${data.aws_caller_identity.current.account_id}-${random_id.suffix.hex}"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.state.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "existing" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  oidc_arn                    = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.existing[0].arn
  environments                = toset(["dev", "prod"])
  github_repository_segments  = split("/", var.github_repository)
  github_oidc_repository_name = var.github_repository_ids == null ? var.github_repository : "${local.github_repository_segments[0]}@${var.github_repository_ids.owner_id}/${local.github_repository_segments[1]}@${var.github_repository_ids.repository_id}"
}

data "aws_iam_policy_document" "github_trust" {
  for_each = local.environments
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_oidc_repository_name}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  for_each             = local.environments
  name                 = "gis-${each.key}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_trust[each.key].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "state_access" {
  for_each = local.environments
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${each.key}/*"]
    }
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.state.arn}/${each.key}/terraform.tfstate"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/${each.key}/terraform.tfstate.tflock"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.state.arn]
  }
}

resource "aws_iam_role_policy" "state_access" {
  for_each = local.environments
  name     = "terraform-state-${each.key}"
  role     = aws_iam_role.github_deploy[each.key].id
  policy   = data.aws_iam_policy_document.state_access[each.key].json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "CurrentTerraformSurface"
    actions = [
      "acm:*", "apigateway:*", "bedrock:*", "budgets:*", "cloudfront:*", "cloudwatch:*",
      "cognito-idp:*", "ec2:*", "events:*", "iam:Get*", "iam:List*", "iam:CreateRole",
      "iam:DeleteRole", "iam:TagRole", "iam:UntagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PassRole", "kms:*", "lambda:*", "logs:*",
      "rds:*", "route53:*", "s3:*", "scheduler:*", "secretsmanager:*", "ses:*", "sns:*", "sqs:*",
      "wafv2:*"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.environments
  name     = "gifts-in-service-terraform"
  role     = aws_iam_role.github_deploy[each.key].id
  policy   = data.aws_iam_policy_document.deploy.json
}

data "aws_iam_policy_document" "github_plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_oidc_repository_name}:environment:dev-plan"]
    }
  }
}

resource "aws_iam_role" "github_plan" {
  name                 = "gis-dev-github-plan"
  assume_role_policy   = data.aws_iam_policy_document.github_plan_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "plan_state_access" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["dev/*"]
    }
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.state.arn}/dev/terraform.tfstate"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [aws_kms_key.state.arn]
  }
}

resource "aws_iam_role_policy" "plan_state_access" {
  name   = "terraform-state-read-only"
  role   = aws_iam_role.github_plan.id
  policy = data.aws_iam_policy_document.plan_state_access.json
}
