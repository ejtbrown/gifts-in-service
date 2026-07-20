import { z } from "zod";

const fakeAddress = z
  .string()
  .email()
  .refine((value) => !value.endsWith("@example.com"), {
    message:
      "Use a reviewed church address or an .invalid address, not example.com",
  });

export const configSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "dev", "prod"]).default("local"),
    AWS_REGION: z
      .string()
      .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u)
      .default("us-east-1"),
    PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
    PUBLIC_BASE_URL: z.string().url(),
    ALLOWED_ORIGINS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    CHURCH_DISPLAY_NAME: z.string().trim().min(2).max(100),
    APP_DISPLAY_NAME: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .default("Gifts in Service"),
    PRIVACY_CONTACT_EMAIL: fakeAddress,
    HELP_CONTACT_EMAIL: fakeAddress,
    DATABASE_URL: z.string().min(1),
    MAILPIT_SMTP_URL: z.string().url(),
    SES_FROM_ADDRESS: z.string().email(),
    SES_CONFIGURATION_SET: z.string().min(1).max(64),
    MAGIC_LINK_HMAC_KEY: z.string().min(32),
    SESSION_HMAC_KEY: z.string().min(32),
    ORIGIN_VERIFY_SECRET: z.string().min(16),
    AI_ADAPTER: z.enum(["fake", "bedrock"]),
    EMAIL_ADAPTER: z.enum(["mailpit", "ses"]),
    STAFF_AUTH_ADAPTER: z.enum(["fake", "cognito"]),
    COGNITO_USER_POOL_ID: z.string().min(1),
    COGNITO_CLIENT_ID: z.string().min(1),
    COGNITO_CLIENT_SECRET: z.string().min(1),
    INTERVIEW_MODEL_ID: z.string().min(1),
    SEARCH_MODEL_ID: z.string().min(1),
    EMBEDDING_MODEL_ID: z.string().min(1),
    EMBEDDING_DIMENSION: z.coerce
      .number()
      .int()
      .refine((value) => [256, 512, 1024].includes(value)),
    BEDROCK_GUARDRAIL_ID: z.string().min(1),
    BEDROCK_GUARDRAIL_VERSION: z.string().min(1),
    RDS_RESOURCE_ARN: z.string().startsWith("arn:").optional(),
    RDS_SECRET_ARN: z.string().startsWith("arn:").optional(),
    RDS_MASTER_SECRET_ARN: z.string().startsWith("arn:").optional(),
    RDS_MIGRATION_SECRET_ARN: z.string().startsWith("arn:").optional(),
    RDS_DATABASE: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/u)
      .default("gifts_in_service"),
  })
  .superRefine((config, context) => {
    if (config.APP_ENV === "prod") {
      if (
        config.AI_ADAPTER !== "bedrock" ||
        config.EMAIL_ADAPTER !== "ses" ||
        config.STAFF_AUTH_ADAPTER !== "cognito"
      ) {
        context.addIssue({
          code: "custom",
          path: ["APP_ENV"],
          message:
            "Production forbids fake AI, email, or staff authentication adapters",
        });
      }
      if (!config.RDS_RESOURCE_ARN || !config.RDS_SECRET_ARN) {
        context.addIssue({
          code: "custom",
          path: ["RDS_RESOURCE_ARN"],
          message:
            "Production requires the Data API cluster and application secret ARNs",
        });
      }
      if (config.COGNITO_CLIENT_SECRET.includes("fake")) {
        context.addIssue({
          code: "custom",
          path: ["COGNITO_CLIENT_SECRET"],
          message: "Production requires deployed Cognito configuration",
        });
      }
      for (const key of [
        "PRIVACY_CONTACT_EMAIL",
        "HELP_CONTACT_EMAIL",
        "SES_FROM_ADDRESS",
      ] as const) {
        if (config[key].endsWith(".invalid")) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Production requires a reviewed, deliverable address",
          });
        }
      }
      for (const key of [
        "MAGIC_LINK_HMAC_KEY",
        "SESSION_HMAC_KEY",
        "ORIGIN_VERIFY_SECRET",
      ] as const) {
        if (
          config[key].toLowerCase().includes("local") ||
          config[key].toLowerCase().includes("fake")
        ) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Production secret contains a development marker",
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}

export function publicConfig(config: AppConfig) {
  return {
    appName: config.APP_DISPLAY_NAME,
    churchName: config.CHURCH_DISPLAY_NAME,
    privacyContactEmail: config.PRIVACY_CONTACT_EMAIL,
    helpContactEmail: config.HELP_CONTACT_EMAIL,
  };
}
