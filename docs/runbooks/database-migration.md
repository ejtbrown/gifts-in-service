# Database migration

Build `dist/lambda/migration-runner.zip` from the reviewed commit, apply infrastructure, then invoke `gis-ENV-migration` before frontend publication. The function alone receives master/migration secret ARNs. It reconciles the generated database roles, parses PostgreSQL dollar-quoted SQL safely, runs each unapplied file transactionally through the Data API, records `schema_migrations`, and grants the application role DML-only access.

Migrations are ordered, idempotent and forward-only. Use expand/contract: add nullable/compatible structures, deploy dual-compatible code, backfill/re-embed with bounded jobs, then remove old structure in a later reviewed release. Never edit an applied migration or manually mark it complete. On failure, keep traffic blocked, inspect the sanitized Lambda error class, fix forward, and re-invoke. Use backup restore only when a corrective migration cannot protect data.
