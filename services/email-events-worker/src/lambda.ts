import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { DataApiExecutor } from "@gis/db";
import { emitMetric, loadConfig } from "@gis/shared";
import { processSesEvent } from "./worker.js";

function messageBody(body: string): unknown {
  const parsed = JSON.parse(body) as { Type?: string; Message?: string };
  return parsed.Type === "Notification" && typeof parsed.Message === "string"
    ? JSON.parse(parsed.Message)
    : parsed;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const config = loadConfig();
  if (!config.RDS_RESOURCE_ARN || !config.RDS_SECRET_ARN)
    throw new Error("EmailEventsDataApiConfigurationMissing");
  const executor = new DataApiExecutor({
    resourceArn: config.RDS_RESOURCE_ARN,
    secretArn: config.RDS_SECRET_ARN,
    database: config.RDS_DATABASE,
    region: config.AWS_REGION,
  });
  const failures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      await processSesEvent(executor, messageBody(record.body));
      emitMetric("SesFeedbackEvents", 1, "Count", "ProcessFeedback");
    } catch {
      emitMetric("SesFeedbackErrors", 1, "Count", "ProcessFeedback");
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
