import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { BedrockAiAdapter, loadPromptBundle } from "@gis/ai";
import { DataApiExecutor } from "@gis/db";
import { embeddingVersion, loadConfig } from "@gis/shared";
import { reembedBatch } from "./worker.js";

interface ReembedMessage {
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const config = loadConfig();
  if (!config.RDS_RESOURCE_ARN || !config.RDS_SECRET_ARN)
    throw new Error("ReembedDataApiConfigurationMissing");
  const prompts = await loadPromptBundle();
  const executor = new DataApiExecutor({
    resourceArn: config.RDS_RESOURCE_ARN,
    secretArn: config.RDS_SECRET_ARN,
    database: config.RDS_DATABASE,
    region: config.AWS_REGION,
  });
  const ai = new BedrockAiAdapter({
    region: config.AWS_REGION,
    interviewModelId: config.INTERVIEW_MODEL_ID,
    searchModelId: config.SEARCH_MODEL_ID,
    embeddingModelId: config.EMBEDDING_MODEL_ID,
    guardrailId: config.BEDROCK_GUARDRAIL_ID,
    guardrailVersion: config.BEDROCK_GUARDRAIL_VERSION,
    interviewerPrompt: prompts.interviewer,
    profileDrafterPrompt: prompts.profileDrafter,
    searchPlannerPrompt: prompts.searchPlanner,
    searchRerankerPrompt: prompts.searchReranker,
  });
  const failures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as ReembedMessage;
      await reembedBatch(executor, ai, {
        modelId: config.EMBEDDING_MODEL_ID,
        fromVersion: message.fromVersion ?? "legacy",
        toVersion:
          message.toVersion ??
          embeddingVersion(
            config.AI_ADAPTER,
            config.EMBEDDING_MODEL_ID,
            config.EMBEDDING_DIMENSION,
          ),
        dimension: config.EMBEDDING_DIMENSION,
        limit: message.limit ?? 25,
      });
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
