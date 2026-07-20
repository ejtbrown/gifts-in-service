output "cluster_arn" { value = aws_rds_cluster.this.arn }
output "cluster_identifier" { value = aws_rds_cluster.this.cluster_identifier }
output "database_name" { value = aws_rds_cluster.this.database_name }
output "master_secret_arn" {
  value     = aws_rds_cluster.this.master_user_secret[0].secret_arn
  sensitive = true
}
output "application_secret_arn" {
  value     = aws_secretsmanager_secret.application.arn
  sensitive = true
}
output "migration_secret_arn" {
  value     = aws_secretsmanager_secret.migration.arn
  sensitive = true
}
