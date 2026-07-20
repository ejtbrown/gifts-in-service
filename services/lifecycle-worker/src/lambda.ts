import { DataApiExecutor } from "@gis/db";
import { SesEmailAdapter } from "@gis/email";
import { emitMetric, loadConfig } from "@gis/shared";
import { runLifecycle } from "./worker.js";

export async function handler(): Promise<{
  processed: number;
  purged: number;
}> {
  const config = loadConfig();
  if (!config.RDS_RESOURCE_ARN || !config.RDS_SECRET_ARN)
    throw new Error("LifecycleDataApiConfigurationMissing");
  const executor = new DataApiExecutor({
    resourceArn: config.RDS_RESOURCE_ARN,
    secretArn: config.RDS_SECRET_ARN,
    database: config.RDS_DATABASE,
    region: config.AWS_REGION,
  });
  const email = new SesEmailAdapter(
    config.AWS_REGION,
    config.SES_FROM_ADDRESS,
    config.SES_CONFIGURATION_SET,
  );
  const result = await runLifecycle(
    executor,
    email,
    {
      publicBaseUrl: config.PUBLIC_BASE_URL,
      appName: config.APP_DISPLAY_NAME,
      tokenHmacKey: config.MAGIC_LINK_HMAC_KEY,
      purgeHmacKey: config.SESSION_HMAC_KEY,
      backupRetentionDays: 35,
    },
    new Date(),
  );
  emitMetric("LifecycleProcessed", result.processed, "Count", "DailyLifecycle");
  emitMetric("LifecyclePurges", result.purged, "Count", "DailyLifecycle");
  return result;
}
