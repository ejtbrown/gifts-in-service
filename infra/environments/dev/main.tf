locals {
  database_release = jsondecode(file("${path.module}/../../database-release.json"))
}

module "application" {
  source                      = "../../modules/application"
  providers                   = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  environment                 = "dev"
  region                      = var.region
  church_display_name         = var.church_display_name
  privacy_contact_email       = var.privacy_contact_email
  help_contact_email          = var.help_contact_email
  ses_sender_email            = var.ses_sender_email
  ses_sender_domain           = var.ses_sender_domain
  ses_use_domain_identity     = var.ses_use_domain_identity
  ses_manage_sender_identity  = var.ses_manage_sender_identity
  ses_production_ready        = false
  privacy_preflight_confirmed = false
  github_repository           = var.github_repository
  custom_domain_name          = var.custom_domain_name
  route53_zone_id             = var.route53_zone_id
  interview_model_id          = "us.amazon.nova-2-lite-v1:0"
  search_model_id             = "us.amazon.nova-2-lite-v1:0"
  embedding_model_id          = "amazon.titan-embed-text-v2:0"
  embedding_dimension         = 1024
  aurora_engine_version       = local.database_release.aurora_postgresql_version
  aurora_support_end          = local.database_release.aurora_standard_support_end
  aurora_min_acu              = 0
  aurora_max_acu              = 2
  aurora_auto_pause_seconds   = 300
  backup_retention_days       = 7
  log_retention_days          = 30
  waf_count_mode              = true
  budget_limit_usd            = 100
  budget_alert_email          = var.budget_alert_email
}
