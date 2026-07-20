import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const production =
  process.argv.includes("--production") ||
  process.env.DEPLOY_ENVIRONMENT === "prod";
const region = process.env.AWS_REGION ?? "us-east-1";
const minimumSupportHorizonMs = 365 * 24 * 60 * 60 * 1000;

interface DatabaseRelease {
  aurora_postgresql_version: string;
  aurora_standard_support_end: string;
  local_postgresql_major: number;
}

async function databaseRelease(): Promise<DatabaseRelease> {
  const path = fileURLToPath(
    new URL("../infra/database-release.json", import.meta.url),
  );
  const parsed = JSON.parse(
    await readFile(path, "utf8"),
  ) as Partial<DatabaseRelease>;
  if (
    !parsed.aurora_postgresql_version ||
    !parsed.aurora_standard_support_end ||
    !Number.isInteger(parsed.local_postgresql_major)
  )
    throw new Error("Database release configuration is invalid");
  const supportEnd = Date.parse(parsed.aurora_standard_support_end);
  if (
    !Number.isFinite(supportEnd) ||
    supportEnd - Date.now() < minimumSupportHorizonMs
  )
    throw new Error(
      "Deployment blocked: the selected Aurora PostgreSQL release has less than one year of standard support remaining",
    );
  return parsed as DatabaseRelease;
}

function requireConfirmation(name: string): void {
  if (process.env[name] !== "true")
    throw new Error(`Production preflight blocked: ${name}=true is required`);
}

async function awsJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run(
    "aws",
    [...args, "--region", region, "--output", "json"],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(stdout || "{}") as Record<string, unknown>;
}

const release = await databaseRelease();
if (process.env.CHECK_AWS_ENGINE_VERSION === "true") {
  const result = await awsJson([
    "rds",
    "describe-db-engine-versions",
    "--engine",
    "aurora-postgresql",
    "--engine-version",
    release.aurora_postgresql_version,
  ]);
  const versions = result.DBEngineVersions as
    | Array<{ EngineVersion?: string; Status?: string }>
    | undefined;
  if (
    versions?.length !== 1 ||
    versions[0]?.EngineVersion !== release.aurora_postgresql_version ||
    versions[0]?.Status !== "available"
  )
    throw new Error(
      `Deployment blocked: Aurora PostgreSQL ${release.aurora_postgresql_version} is not available in ${region}`,
    );
}

if (!production) {
  process.stdout.write(
    `Development preflight passed for Aurora PostgreSQL ${release.aurora_postgresql_version}; production confirmations were not asserted.\n`,
  );
} else {
  for (const confirmation of [
    "BEDROCK_ZERO_RETENTION_CONFIRMED",
    "BEDROCK_INVOCATION_LOGGING_REVIEWED",
    "BODY_LOGGING_DISABLED_CONFIRMED",
    "SES_PRODUCTION_READY",
    "POLICY_COPY_REVIEWED",
  ])
    requireConfirmation(confirmation);

  await awsJson(["sts", "get-caller-identity"]);
  const logging = await awsJson([
    "bedrock",
    "get-model-invocation-logging-configuration",
  ]);
  const loggingConfig = logging.loggingConfig as
    | Record<string, unknown>
    | undefined;
  if (
    loggingConfig &&
    Object.values(loggingConfig).some(
      (value) => value === true || typeof value === "object",
    )
  ) {
    throw new Error(
      "Production preflight blocked: Bedrock model invocation logging is configured; review and disable prompt/output capture",
    );
  }
  const ses = await awsJson(["sesv2", "get-account"]);
  if (ses.ProductionAccessEnabled !== true || ses.SendingEnabled !== true) {
    throw new Error(
      "Production preflight blocked: SES production access and sending must both be enabled",
    );
  }
  const identity = process.env.SES_IDENTITY;
  if (!identity)
    throw new Error("Production preflight blocked: SES_IDENTITY is required");
  const identityResult = await awsJson([
    "sesv2",
    "get-email-identity",
    "--email-identity",
    identity,
  ]);
  if (identityResult.VerifiedForSendingStatus !== true) {
    throw new Error(
      "Production preflight blocked: the configured SES identity is not verified for sending",
    );
  }
  process.stdout.write(
    `Production privacy, logging, AWS identity, SES, and Aurora PostgreSQL ${release.aurora_postgresql_version} preflight passed.\n`,
  );
}
