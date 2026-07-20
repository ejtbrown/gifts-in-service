resource "aws_cognito_user_pool" "staff" {
  name                     = "${var.prefix}-staff"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  deletion_protection      = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  admin_create_user_config { allow_admin_create_user_only = true }
  software_token_mfa_configuration { enabled = true }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 3
  }
  user_attribute_update_settings { attributes_require_verification_before_update = ["email"] }
  user_pool_add_ons { advanced_security_mode = "ENFORCED" }
  tags = var.tags
}

resource "aws_cognito_user_pool_client" "staff" {
  name            = "${var.prefix}-web-bff"
  user_pool_id    = aws_cognito_user_pool.staff.id
  generate_secret = true
  # This confidential client is API-only. Keep managed-login/OAuth disabled so
  # staff authentication can't fall back to a hosted redirect.
  allowed_oauth_flows_user_pool_client = false
  allowed_oauth_flows                  = []
  allowed_oauth_scopes                 = []
  callback_urls                        = []
  logout_urls                          = []
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
  auth_session_validity  = 10
  access_token_validity  = 24
  id_token_validity      = 24
  refresh_token_validity = 1
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

locals {
  groups = {
    "gis-admin"           = { precedence = 10, description = "Application content and access administrator" }
    "gis-staff"           = { precedence = 20, description = "Authorized church staff profile search" }
    "gis-ministry-leader" = { precedence = 30, description = "Explicitly designated ministry leader profile search" }
    "gis-privacy-auditor" = { precedence = 40, description = "Pseudonymous privacy and security audit access" }
    "gis-technical-admin" = { precedence = 50, description = "Non-PII health and deployment access" }
  }
}

resource "aws_cognito_user_group" "groups" {
  for_each     = local.groups
  user_pool_id = aws_cognito_user_pool.staff.id
  name         = each.key
  description  = each.value.description
  precedence   = each.value.precedence
}
