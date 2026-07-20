output "state_bucket" { value = aws_s3_bucket.state.id }
output "state_kms_key_arn" { value = aws_kms_key.state.arn }
output "github_deploy_role_arns" { value = { for environment, role in aws_iam_role.github_deploy : environment => role.arn } }
output "github_plan_role_arn" { value = aws_iam_role.github_plan.arn }
output "backend_init_commands" {
  value = {
    for environment in ["dev", "prod"] : environment => "terraform -chdir=infra/environments/${environment} init -backend-config=bucket=${aws_s3_bucket.state.id} -backend-config=key=${environment}/terraform.tfstate -backend-config=region=${var.region} -backend-config=kms_key_id=${aws_kms_key.state.arn}"
  }
}
