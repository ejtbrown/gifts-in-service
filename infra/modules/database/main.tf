resource "aws_db_subnet_group" "this" {
  name       = "${var.prefix}-aurora"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "database" {
  name        = "${var.prefix}-aurora"
  description = "Aurora has no network clients; application access uses RDS Data API"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_rds_cluster" "this" {
  cluster_identifier                  = "${var.prefix}-postgres"
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.engine_version
  allow_major_version_upgrade         = true
  auto_minor_version_upgrade          = false
  database_name                       = "gifts_in_service"
  master_username                     = "gis_migration_owner"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.kms_key_arn
  enable_http_endpoint                = true
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.database.id]
  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arn
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = "08:00-09:00"
  preferred_maintenance_window        = "sun:09:00-sun:10:00"
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = var.skip_final_snapshot
  final_snapshot_identifier           = var.skip_final_snapshot ? null : "${var.prefix}-final"
  copy_tags_to_snapshot               = true
  iam_database_authentication_enabled = true

  serverlessv2_scaling_configuration {
    min_capacity             = var.min_acu
    max_capacity             = var.max_acu
    seconds_until_auto_pause = var.min_acu == 0 ? var.auto_pause_seconds : null
  }

  lifecycle {
    precondition {
      condition     = var.min_acu >= 0 && var.max_acu >= var.min_acu
      error_message = "Aurora ACU range is invalid"
    }
  }
  tags = var.tags
}

check "engine_standard_support_horizon" {
  assert {
    condition     = timecmp(var.engine_support_end, timeadd(plantimestamp(), "8760h")) > 0
    error_message = "The selected Aurora PostgreSQL release has less than one year of standard support remaining. Select a supported LTS release and update infra/database-release.json."
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier                 = "${var.prefix}-writer-1"
  cluster_identifier         = aws_rds_cluster.this.id
  instance_class             = "db.serverless"
  engine                     = aws_rds_cluster.this.engine
  engine_version             = aws_rds_cluster.this.engine_version
  auto_minor_version_upgrade = false
  publicly_accessible        = false
  tags                       = var.tags
}

resource "random_password" "application" {
  length  = 40
  special = false
}

resource "random_password" "migration" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "application" {
  name                    = "${var.prefix}/database/application"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "application" {
  secret_id = aws_secretsmanager_secret.application.id
  secret_string = jsonencode({
    username = "gis_app"
    password = random_password.application.result
    database = "gifts_in_service"
  })
}

resource "aws_secretsmanager_secret" "migration" {
  name                    = "${var.prefix}/database/migration"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "migration" {
  secret_id = aws_secretsmanager_secret.migration.id
  secret_string = jsonencode({
    username = "gis_migration"
    password = random_password.migration.result
    database = "gifts_in_service"
  })
}
