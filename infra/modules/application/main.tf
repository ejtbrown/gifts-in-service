module "naming" {
  source      = "../naming"
  environment = var.environment
  extra_tags  = var.extra_tags
}

resource "terraform_data" "production_preflight" {
  input = var.privacy_preflight_confirmed
  lifecycle {
    precondition {
      condition     = var.environment != "prod" || var.privacy_preflight_confirmed
      error_message = "Production blocked: Bedrock zero-retention/invocation logging and infrastructure body-logging preflight is not confirmed."
    }
    precondition {
      condition     = var.environment != "prod" || var.ses_production_ready
      error_message = "Production blocked: SES verified identity and production access are not confirmed."
    }
  }
}

module "kms" {
  source = "../kms"
  prefix = module.naming.prefix
  tags   = module.naming.tags
}

module "networking" {
  source = "../networking"
  prefix = module.naming.prefix
  tags   = module.naming.tags
}

module "database" {
  source                = "../database"
  prefix                = module.naming.prefix
  tags                  = module.naming.tags
  vpc_id                = module.networking.vpc_id
  subnet_ids            = module.networking.database_subnet_ids
  kms_key_arn           = module.kms.key_arn
  engine_version        = var.aurora_engine_version
  engine_support_end    = var.aurora_support_end
  min_acu               = var.aurora_min_acu
  max_acu               = var.aurora_max_acu
  auto_pause_seconds    = var.aurora_auto_pause_seconds
  backup_retention_days = var.backup_retention_days
  deletion_protection   = var.environment == "prod"
  skip_final_snapshot   = var.environment != "prod"
}

module "bedrock" {
  source              = "../bedrock"
  prefix              = module.naming.prefix
  tags                = module.naming.tags
  kms_key_arn         = module.kms.key_arn
  interview_model_id  = var.interview_model_id
  search_model_id     = var.search_model_id
  embedding_model_id  = var.embedding_model_id
  embedding_dimension = var.embedding_dimension
}

module "ses" {
  source                 = "../ses"
  prefix                 = module.naming.prefix
  tags                   = module.naming.tags
  kms_key_arn            = module.kms.key_arn
  sender_email           = var.ses_sender_email
  sender_domain          = var.ses_sender_domain
  use_domain_identity    = var.ses_use_domain_identity
  manage_sender_identity = var.ses_manage_sender_identity
}

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}
resource "random_password" "magic_hmac" {
  length  = 64
  special = false
}
resource "random_password" "session_hmac" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "application_keys" {
  name                    = "${module.naming.prefix}/application/security-keys"
  kms_key_id              = module.kms.key_arn
  recovery_window_in_days = 30
  tags                    = module.naming.tags
}

resource "aws_secretsmanager_secret_version" "application_keys" {
  secret_id = aws_secretsmanager_secret.application_keys.id
  secret_string = jsonencode({
    origin_verify = random_password.origin_verify.result
    magic_hmac    = random_password.magic_hmac.result
    session_hmac  = random_password.session_hmac.result
  })
}

resource "aws_acm_certificate" "custom" {
  count             = var.custom_domain_name == "" ? 0 : 1
  provider          = aws.us_east_1
  domain_name       = var.custom_domain_name
  validation_method = "DNS"
  tags              = module.naming.tags
}

resource "aws_route53_record" "certificate_validation" {
  for_each = var.custom_domain_name == "" || var.route53_zone_id == "" ? {} : {
    for option in aws_acm_certificate.custom[0].domain_validation_options : option.domain_name => {
      name = option.resource_record_name, record = option.resource_record_value, type = option.resource_record_type
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "custom" {
  count                   = var.custom_domain_name == "" || var.route53_zone_id == "" ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.custom[0].arn
  validation_record_fqdns = values(aws_route53_record.certificate_validation)[*].fqdn
}

module "api_gateway" {
  source = "../api-gateway"
  prefix = module.naming.prefix
  tags   = module.naming.tags
}

locals {
  public_base_url = var.custom_domain_name == "" ? module.edge.cloudfront_url : "https://${var.custom_domain_name}"
  lambda_packages = {
    public       = "${path.root}/../../../dist/lambda/public-api.zip"
    staff        = "${path.root}/../../../dist/lambda/staff-api.zip"
    lifecycle    = "${path.root}/../../../dist/lambda/lifecycle-worker.zip"
    email_events = "${path.root}/../../../dist/lambda/email-events-worker.zip"
    reembed      = "${path.root}/../../../dist/lambda/reembed-worker.zip"
    migration    = "${path.root}/../../../dist/lambda/migration-runner.zip"
  }
}

module "cognito" {
  source              = "../cognito"
  prefix              = module.naming.prefix
  tags                = module.naming.tags
  deletion_protection = var.environment == "prod"
}

module "api" {
  source                     = "../api"
  prefix                     = module.naming.prefix
  tags                       = module.naming.tags
  region                     = var.region
  public_base_url            = local.public_base_url
  allowed_origins            = local.public_base_url
  church_display_name        = var.church_display_name
  privacy_contact_email      = var.privacy_contact_email
  help_contact_email         = var.help_contact_email
  origin_verify_secret       = random_password.origin_verify.result
  magic_hmac_key             = random_password.magic_hmac.result
  session_hmac_key           = random_password.session_hmac.result
  rds_cluster_arn            = module.database.cluster_arn
  rds_application_secret_arn = module.database.application_secret_arn
  rds_migration_secret_arn   = module.database.migration_secret_arn
  rds_master_secret_arn      = module.database.master_secret_arn
  database_name              = module.database.database_name
  kms_key_arn                = module.kms.key_arn
  cognito_user_pool_id       = module.cognito.user_pool_id
  cognito_client_id          = module.cognito.client_id
  cognito_client_secret      = module.cognito.client_secret
  ses_from_address           = var.ses_sender_email
  ses_configuration_set      = module.ses.configuration_set
  guardrail_id               = module.bedrock.guardrail_id
  guardrail_version          = module.bedrock.guardrail_version
  interview_model_id         = var.interview_model_id
  search_model_id            = var.search_model_id
  embedding_model_id         = var.embedding_model_id
  embedding_dimension        = var.embedding_dimension
  lambda_package_paths       = local.lambda_packages
  log_retention_days         = var.log_retention_days
  api_id                     = module.api_gateway.api_id
  api_endpoint               = module.api_gateway.api_endpoint
  api_execution_arn          = module.api_gateway.execution_arn
  depends_on                 = [terraform_data.production_preflight]
}

module "edge" {
  source                = "../storage-edge"
  providers             = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  prefix                = module.naming.prefix
  tags                  = module.naming.tags
  kms_key_arn           = module.kms.key_arn
  api_domain_name       = module.api_gateway.api_domain_name
  origin_verify_secret  = random_password.origin_verify.result
  waf_count_mode        = var.waf_count_mode
  custom_domain_name    = var.custom_domain_name
  acm_certificate_arn   = var.custom_domain_name == "" ? "" : aws_acm_certificate.custom[0].arn
  magic_link_rate_limit = 100
  redemption_rate_limit = 200
  interview_rate_limit  = 300
  search_rate_limit     = 200
}

resource "aws_route53_record" "custom" {
  count   = var.custom_domain_name == "" || var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.custom_domain_name
  type    = "A"
  alias {
    name                   = module.edge.distribution_domain_name
    zone_id                = module.edge.distribution_zone_id
    evaluate_target_health = false
  }
}

module "scheduling" {
  source                          = "../scheduling"
  prefix                          = module.naming.prefix
  tags                            = module.naming.tags
  kms_key_arn                     = module.kms.key_arn
  lifecycle_function_arn          = module.api.function_arns.lifecycle
  lifecycle_function_name         = module.api.function_names.lifecycle
  reembed_function_arn            = module.api.function_arns.reembed
  email_events_function_arn       = module.api.function_arns.email_events
  email_event_queue_arn           = module.ses.event_queue_arn
  reembed_function_role_name      = module.api.function_role_names.reembed
  email_events_function_role_name = module.api.function_role_names.email_events
}

module "observability" {
  source                = "../observability"
  prefix                = module.naming.prefix
  tags                  = module.naming.tags
  region                = var.region
  kms_key_arn           = module.kms.key_arn
  api_id                = module.api_gateway.api_id
  function_names        = module.api.function_names
  jobs_dlq_name         = module.scheduling.jobs_dlq_name
  email_events_dlq_name = module.ses.event_dlq_name
  budget_limit_usd      = var.budget_limit_usd
  budget_alert_email    = var.budget_alert_email
}
