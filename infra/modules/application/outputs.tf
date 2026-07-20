output "cloudfront_url" { value = module.edge.cloudfront_url }
output "api_endpoint" { value = module.api.api_endpoint }
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "ses_identity" { value = module.ses.identity }
output "ses_configuration_set" { value = module.ses.configuration_set }
output "ses_dkim_tokens" { value = module.ses.dkim_tokens }
output "rds_cluster_arn" { value = module.database.cluster_arn }
output "bedrock_guardrail_id" { value = module.bedrock.guardrail_id }
output "bedrock_guardrail_version" { value = module.bedrock.guardrail_version }
output "bedrock_model_configuration" { value = module.bedrock.model_configuration }
output "dashboard_name" { value = module.observability.dashboard_name }
output "alarm_names" { value = module.observability.alarm_names }
output "custom_domain_ready" { value = var.custom_domain_name != "" }
output "frontend_bucket" { value = module.edge.bucket_name }
output "distribution_id" { value = module.edge.distribution_id }
output "migration_function_name" { value = module.api.function_names.migration }
output "kms_key_arn" { value = module.kms.key_arn }
