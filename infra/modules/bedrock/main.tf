resource "aws_bedrock_guardrail" "privacy" {
  name                      = "${var.prefix}-privacy"
  description               = "Defense in depth for unnecessary secrets and high-risk identifiers"
  blocked_input_messaging   = "Please omit private credentials and identification or financial numbers; they are not needed."
  blocked_outputs_messaging = "The assistant could not produce a privacy-safe response. Please try again without private details."
  kms_key_arn               = var.kms_key_arn

  sensitive_information_policy_config {
    pii_entities_config {
      type   = "PASSWORD"
      action = "BLOCK"
    }
    pii_entities_config {
      type   = "US_SOCIAL_SECURITY_NUMBER"
      action = "BLOCK"
    }
    pii_entities_config {
      type   = "CREDIT_DEBIT_CARD_NUMBER"
      action = "BLOCK"
    }
    pii_entities_config {
      type   = "US_BANK_ACCOUNT_NUMBER"
      action = "BLOCK"
    }
  }
  tags = var.tags
}

resource "aws_bedrock_guardrail_version" "privacy" {
  guardrail_arn = aws_bedrock_guardrail.privacy.guardrail_arn
  description   = "Deployed privacy guardrail"
  skip_destroy  = true
}
