resource "aws_s3_bucket" "web" {
  bucket = "${var.prefix}-web-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 35 }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.prefix}-web"
  description                       = "SigV4 access to private frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "api_disabled" {
  name        = "${var.prefix}-api-no-cache"
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
  }
}

resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${var.prefix}-api-request"
  cookies_config { cookie_behavior = "all" }
  headers_config {
    header_behavior = "whitelist"
    headers { items = ["Accept", "Content-Type", "Origin", "X-CSRF-Token"] }
  }
  query_strings_config { query_string_behavior = "all" }
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.prefix}-security"
  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      override                = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
      override = true
    }
    items {
      header   = "Cache-Control"
      value    = "no-store"
      override = false
    }
  }
}

resource "aws_wafv2_web_acl" "this" {
  provider = aws.us_east_1
  name     = "${var.prefix}-cloudfront"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.prefix}-common"
      sampled_requests_enabled   = false
    }
  }

  dynamic "rule" {
    for_each = {
      magic     = { priority = 20, limit = var.magic_link_rate_limit, path = "/api/public/magic-links" }
      redeem    = { priority = 21, limit = var.redemption_rate_limit, path = "/api/public/magic-links/redeem" }
      interview = { priority = 22, limit = var.interview_rate_limit, path = "/api/member/interview" }
      search    = { priority = 23, limit = var.search_rate_limit, path = "/api/staff/search" }
    }
    content {
      name     = "rate-${rule.key}"
      priority = rule.value.priority
      dynamic "action" {
        for_each = var.waf_count_mode ? [1] : []
        content {
          count {}
        }
      }
      dynamic "action" {
        for_each = var.waf_count_mode ? [] : [1]
        content {
          block {}
        }
      }
      statement {
        rate_based_statement {
          aggregate_key_type    = "IP"
          limit                 = rule.value.limit
          evaluation_window_sec = 300
          scope_down_statement {
            byte_match_statement {
              field_to_match {
                uri_path {}
              }
              positional_constraint = "STARTS_WITH"
              search_string         = rule.value.path
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.prefix}-${rule.key}"
        sampled_requests_enabled   = false
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.prefix}-waf"
    sampled_requests_enabled   = false
  }
  tags = var.tags
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Gifts in Service ${var.prefix}"
  default_root_object = "index.html"
  aliases             = var.custom_domain_name == "" ? [] : [var.custom_domain_name]
  web_acl_id          = aws_wafv2_web_acl.this.arn
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }
  origin {
    domain_name = var.api_domain_name
    origin_id   = "api"
    custom_header {
      name  = "X-GIS-Origin-Verify"
      value = var.origin_verify_secret
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = aws_cloudfront_cache_policy.api_disabled.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn            = var.custom_domain_name == "" ? null : var.acm_certificate_arn
    cloudfront_default_certificate = var.custom_domain_name == ""
    minimum_protocol_version       = var.custom_domain_name == "" ? "TLSv1" : "TLSv1.2_2021"
    ssl_support_method             = var.custom_domain_name == "" ? null : "sni-only"
  }
  tags = var.tags
}

data "aws_cloudfront_cache_policy" "caching_optimized" { name = "Managed-CachingOptimized" }

data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web.json
}
