import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DataApiExecutor, type SqlExecutor } from "@gis/db";
import { loadConfig } from "@gis/shared";
import { fileURLToPath } from "node:url";
import { runDataApiMigrations } from "./migrations.js";

interface DatabaseSecret {
  username: string;
  password: string;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function readDatabaseSecret(
  client: SecretsManagerClient,
  secretId: string,
): Promise<DatabaseSecret> {
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!result.SecretString) throw new Error("DatabaseSecretStringMissing");
  const parsed = JSON.parse(result.SecretString) as Partial<DatabaseSecret>;
  if (!parsed.username || !parsed.password)
    throw new Error("DatabaseSecretInvalid");
  return { username: parsed.username, password: parsed.password };
}

async function reconcileRole(
  executor: SqlExecutor,
  role: DatabaseSecret,
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(role.username))
    throw new Error("DatabaseRoleNameInvalid");
  await executor.query(
    `DO $role$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role.username)}) THEN
         EXECUTE 'CREATE ROLE ${role.username} LOGIN PASSWORD ' || quote_literal(${literal(role.password)});
       ELSE
         EXECUTE 'ALTER ROLE ${role.username} LOGIN PASSWORD ' || quote_literal(${literal(role.password)});
       END IF;
     END $role$`,
  );
}

export async function handler(): Promise<{ applied: string[] }> {
  const config = loadConfig();
  if (
    !config.RDS_RESOURCE_ARN ||
    !config.RDS_MASTER_SECRET_ARN ||
    !config.RDS_MIGRATION_SECRET_ARN ||
    !config.RDS_SECRET_ARN
  ) {
    throw new Error("MigrationDataApiConfigurationMissing");
  }
  const executor = new DataApiExecutor({
    resourceArn: config.RDS_RESOURCE_ARN,
    secretArn: config.RDS_MASTER_SECRET_ARN,
    database: config.RDS_DATABASE,
    region: config.AWS_REGION,
  });
  const secrets = new SecretsManagerClient({
    region: config.AWS_REGION,
    maxAttempts: 4,
  });
  const [applicationRole, migrationRole] = await Promise.all([
    readDatabaseSecret(secrets, config.RDS_SECRET_ARN),
    readDatabaseSecret(secrets, config.RDS_MIGRATION_SECRET_ARN),
  ]);
  await reconcileRole(executor, migrationRole);
  await reconcileRole(executor, applicationRole);
  const migrationsDirectory = fileURLToPath(
    new URL("../migrations/", import.meta.url),
  );
  const applied = await runDataApiMigrations(
    executor,
    migrationsDirectory,
    config.EMBEDDING_DIMENSION,
  );
  await executor.query(
    `GRANT CONNECT ON DATABASE ${config.RDS_DATABASE} TO ${applicationRole.username}, ${migrationRole.username}`,
  );
  await executor.query(
    `GRANT USAGE ON SCHEMA public TO ${applicationRole.username}, ${migrationRole.username}`,
  );
  await executor.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${applicationRole.username}`,
  );
  await executor.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${applicationRole.username}`,
  );
  await executor.query(
    `GRANT CREATE ON SCHEMA public TO ${migrationRole.username}`,
  );
  return { applied };
}
