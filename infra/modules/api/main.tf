locals {
  functions = {
    public       = { handler = "app/index.handler", timeout = 30, memory = 1024 }
    staff        = { handler = "app/index.handler", timeout = 30, memory = 1024 }
    lifecycle    = { handler = "app/index.handler", timeout = 300, memory = 1024 }
    email_events = { handler = "app/index.handler", timeout = 60, memory = 512 }
    reembed      = { handler = "app/index.handler", timeout = 300, memory = 1024 }
    migration    = { handler = "app/index.handler", timeout = 300, memory = 1024 }
  }
  common_environment = {
    APP_ENV                   = "prod"
    PORT                      = "3001"
    PUBLIC_BASE_URL           = var.public_base_url
    ALLOWED_ORIGINS           = var.allowed_origins
    CHURCH_DISPLAY_NAME       = var.church_display_name
    APP_DISPLAY_NAME          = "Gifts in Service"
    PRIVACY_CONTACT_EMAIL     = var.privacy_contact_email
    HELP_CONTACT_EMAIL        = var.help_contact_email
    DATABASE_URL              = "postgres://data-api.invalid/gifts_in_service"
    MAILPIT_SMTP_URL          = "smtp://mailpit.invalid:1025"
    SES_FROM_ADDRESS          = var.ses_from_address
    SES_CONFIGURATION_SET     = var.ses_configuration_set
    MAGIC_LINK_HMAC_KEY       = var.magic_hmac_key
    SESSION_HMAC_KEY          = var.session_hmac_key
    ORIGIN_VERIFY_SECRET      = var.origin_verify_secret
    AI_ADAPTER                = "bedrock"
    EMAIL_ADAPTER             = "ses"
    STAFF_AUTH_ADAPTER        = "cognito"
    COGNITO_USER_POOL_ID      = var.cognito_user_pool_id
    COGNITO_CLIENT_ID         = var.cognito_client_id
    COGNITO_CLIENT_SECRET     = var.cognito_client_secret
    INTERVIEW_MODEL_ID        = var.interview_model_id
    SEARCH_MODEL_ID           = var.search_model_id
    EMBEDDING_MODEL_ID        = var.embedding_model_id
    EMBEDDING_DIMENSION       = tostring(var.embedding_dimension)
    BEDROCK_GUARDRAIL_ID      = var.guardrail_id
    BEDROCK_GUARDRAIL_VERSION = var.guardrail_version
    RDS_RESOURCE_ARN          = var.rds_cluster_arn
    RDS_SECRET_ARN            = var.rds_application_secret_arn
    RDS_DATABASE              = var.database_name
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "function" {
  for_each           = local.functions
  name               = "${var.prefix}-${replace(each.key, "_", "-")}-lambda"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = local.functions
  role       = aws_iam_role.function[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "data_api" {
  for_each = toset(["public", "staff", "lifecycle", "email_events", "reembed"])
  name     = "data-api"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["rds-data:ExecuteStatement", "rds-data:BeginTransaction", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"], Resource = var.rds_cluster_arn },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.rds_application_secret_arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.kms_key_arn }
  ] })
}

resource "aws_iam_role_policy" "migration" {
  name = "migration-data-api"
  role = aws_iam_role.function["migration"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["rds-data:ExecuteStatement", "rds-data:BeginTransaction", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"], Resource = var.rds_cluster_arn },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.rds_application_secret_arn, var.rds_migration_secret_arn, var.rds_master_secret_arn] },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.kms_key_arn }
  ] })
}

resource "aws_iam_role_policy" "bedrock" {
  for_each = toset(["public", "staff", "reembed"])
  name     = "bedrock"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Action = ["bedrock:InvokeModel", "bedrock:ApplyGuardrail"],
    Resource = ["arn:aws:bedrock:*::foundation-model/${trimprefix(var.interview_model_id, "us.")}", "arn:aws:bedrock:*::foundation-model/${trimprefix(var.search_model_id, "us.")}", "arn:aws:bedrock:${var.region}::foundation-model/${var.embedding_model_id}", "arn:aws:bedrock:${var.region}:*:inference-profile/${var.interview_model_id}", "arn:aws:bedrock:${var.region}:*:inference-profile/${var.search_model_id}", "arn:aws:bedrock:${var.region}:*:guardrail/${var.guardrail_id}"]
  }] })
}

resource "aws_iam_role_policy" "ses" {
  for_each = toset(["public", "staff", "lifecycle"])
  name     = "ses-send"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Sid    = "SendFromConfiguredIdentity"
      Effect = "Allow", Action = ["ses:SendEmail"],
      # Sandbox sends also authorize the verified recipient identity. The exact
      # From condition prevents this wildcard from permitting another sender.
      Resource  = "arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*",
      Condition = { StringEquals = { "ses:FromAddress" = var.ses_from_address } }
    },
    {
      Sid      = "UseConfiguredConfigurationSet"
      Effect   = "Allow", Action = ["ses:SendEmail"],
      Resource = "arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.ses_configuration_set}"
    }
  ] })
}

resource "aws_iam_role_policy" "cognito_admin" {
  name   = "cognito-lower-access-admin"
  role   = aws_iam_role.function["staff"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["cognito-idp:AdminInitiateAuth", "cognito-idp:AdminRespondToAuthChallenge", "cognito-idp:AdminCreateUser", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminRemoveUserFromGroup", "cognito-idp:AdminListGroupsForUser", "cognito-idp:ListUsers", "cognito-idp:ListGroups"], Resource = "arn:aws:cognito-idp:${var.region}:*:userpool/${var.cognito_user_pool_id}" }] })
}

resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.prefix}-${replace(each.key, "_", "-")}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_lambda_function" "function" {
  for_each         = local.functions
  function_name    = "${var.prefix}-${replace(each.key, "_", "-")}"
  role             = aws_iam_role.function[each.key].arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = each.value.handler
  filename         = var.lambda_package_paths[each.key]
  source_code_hash = filebase64sha256(var.lambda_package_paths[each.key])
  kms_key_arn      = var.kms_key_arn
  timeout          = each.value.timeout
  memory_size      = each.value.memory
  environment {
    variables = merge(local.common_environment, each.key == "migration" ? {
      RDS_MASTER_SECRET_ARN    = var.rds_master_secret_arn
      RDS_MIGRATION_SECRET_ARN = var.rds_migration_secret_arn
    } : {})
  }
  tracing_config { mode = "PassThrough" }
  reserved_concurrent_executions = each.key == "public" ? 20 : each.key == "staff" ? 10 : 2
  depends_on                     = [aws_cloudwatch_log_group.function]
  tags                           = var.tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = toset(["public", "staff"])
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function[each.key].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

locals {
  routes = {
    "ANY /api/config"             = "public"
    "ANY /api/public/{proxy+}"    = "public"
    "ANY /api/member/{proxy+}"    = "public"
    "ANY /api/staff/{proxy+}"     = "staff"
    "ANY /api/technical/{proxy+}" = "staff"
  }
}

resource "aws_apigatewayv2_route" "routes" {
  for_each  = local.routes
  api_id    = var.api_id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[each.value].id}"
}

resource "aws_lambda_permission" "api" {
  for_each      = toset(["public", "staff"])
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
