import { FakeAiAdapter } from "../../packages/ai/src/index.js";
import type { SqlExecutor } from "../../packages/db/src/index.js";
import type { EmailAdapter } from "../../packages/email/src/index.js";
import { configSchema } from "../../packages/shared/src/index.js";
import { buildApp } from "../../services/public-api/src/app.js";
import { describe, expect, it } from "vitest";

const config = configSchema.parse({
  APP_ENV: "test",
  AWS_REGION: "us-east-1",
  PUBLIC_BASE_URL: "http://localhost:5173",
  ALLOWED_ORIGINS: "http://localhost:5173",
  CHURCH_DISPLAY_NAME: "Fictional Test Church",
  PRIVACY_CONTACT_EMAIL: "privacy@example.invalid",
  HELP_CONTACT_EMAIL: "help@example.invalid",
  DATABASE_URL: "postgres://unused",
  MAILPIT_SMTP_URL: "smtp://localhost:1025",
  SES_FROM_ADDRESS: "no-reply@example.invalid",
  SES_CONFIGURATION_SET: "test",
  MAGIC_LINK_HMAC_KEY: "m".repeat(32),
  SESSION_HMAC_KEY: "s".repeat(32),
  ORIGIN_VERIFY_SECRET: "o".repeat(32),
  AI_ADAPTER: "fake",
  EMAIL_ADAPTER: "mailpit",
  STAFF_AUTH_ADAPTER: "fake",
  COGNITO_USER_POOL_ID: "fictional-pool",
  COGNITO_CLIENT_ID: "fictional-client",
  COGNITO_CLIENT_SECRET: "fictional-secret",
  INTERVIEW_MODEL_ID: "fictional-interview",
  SEARCH_MODEL_ID: "fictional-search",
  EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
  EMBEDDING_DIMENSION: "1024",
  BEDROCK_GUARDRAIL_ID: "fictional-guardrail",
  BEDROCK_GUARDRAIL_VERSION: "DRAFT",
});

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Unexpected database access"));
const executor: SqlExecutor = { query: unavailable, transaction: unavailable };
const email: EmailAdapter = {
  send: () => Promise.reject(new Error("Unexpected email access")),
};

describe("deployed API surfaces", () => {
  it("does not expose staff handlers from the public application", async () => {
    const app = await buildApp({
      surface: "public",
      config,
      executor,
      email,
      ai: new FakeAiAdapter(),
    });
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/staff/me" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("does not expose public handlers from the staff application", async () => {
    const app = await buildApp({
      surface: "staff",
      config,
      executor,
      email,
      ai: new FakeAiAdapter(),
    });
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/config" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
