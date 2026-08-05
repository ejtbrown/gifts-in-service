import {
  loadEmailEventsConfig,
  loadLifecycleConfig,
  loadMigrationConfig,
  loadReembedConfig,
} from "../../packages/shared/src/index.js";
import { describe, expect, it } from "vitest";

const dataApiEnvironment = {
  AWS_REGION: "us-east-1",
  RDS_RESOURCE_ARN: "arn:aws:rds:us-east-1:123456789012:cluster:gis-fictional",
  RDS_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:gis-fictional",
  RDS_DATABASE: "gifts_in_service",
};

describe("service-specific configuration", () => {
  it("does not expose unrelated API secrets to the email-events worker", () => {
    const config = loadEmailEventsConfig({
      ...dataApiEnvironment,
      COGNITO_CLIENT_SECRET: "fictional-unrelated-secret",
      MAGIC_LINK_HMAC_KEY: "m".repeat(32),
    });

    expect(config).toEqual(dataApiEnvironment);
    expect(config).not.toHaveProperty("COGNITO_CLIENT_SECRET");
    expect(config).not.toHaveProperty("MAGIC_LINK_HMAC_KEY");
  });

  it("gives each privileged worker only its required secret and model fields", () => {
    const lifecycle = loadLifecycleConfig({
      ...dataApiEnvironment,
      PUBLIC_BASE_URL: "https://gifts.fictional-church.example",
      APP_DISPLAY_NAME: "Gifts in Service",
      MAGIC_LINK_HMAC_KEY: "m".repeat(32),
      SESSION_HMAC_KEY: "s".repeat(32),
      SES_FROM_ADDRESS: "no-reply@fictional-church.example",
      SES_CONFIGURATION_SET: "gis-fictional",
      COGNITO_CLIENT_SECRET: "fictional-unrelated-secret",
    });
    const reembed = loadReembedConfig({
      ...dataApiEnvironment,
      AI_ADAPTER: "bedrock",
      EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
      EMBEDDING_DIMENSION: "1024",
      BEDROCK_GUARDRAIL_ID: "unrelated",
    });
    const migration = loadMigrationConfig({
      ...dataApiEnvironment,
      RDS_MASTER_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:gis-master",
      RDS_MIGRATION_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:gis-migration",
      EMBEDDING_DIMENSION: "1024",
      MAGIC_LINK_HMAC_KEY: "m".repeat(32),
    });

    expect(lifecycle).not.toHaveProperty("COGNITO_CLIENT_SECRET");
    expect(reembed).not.toHaveProperty("BEDROCK_GUARDRAIL_ID");
    expect(reembed.EMBEDDING_DIMENSION).toBe(1024);
    expect(migration).not.toHaveProperty("MAGIC_LINK_HMAC_KEY");
  });
});
