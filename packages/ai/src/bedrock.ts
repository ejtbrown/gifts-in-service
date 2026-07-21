import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ConverseResponse,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import {
  interviewCompletenessSchema,
  interviewFollowUpNotesSchema,
  interviewMessageSchema,
  rerankerOutputSchema,
  searchPlanSchema,
  type InterviewMessage,
  type RerankerOutput,
  type SearchPlan,
} from "@gis/shared";
import { z } from "zod";
import { emitMetric } from "@gis/shared";
import type {
  AiAdapter,
  InterviewContext,
  InterviewTurn,
  ProfileDraft,
  RerankCandidate,
} from "./adapter.js";
import { AiSafetyInterventionError } from "./safety.js";

const draftSchema = z.object({
  profile_text: z.string().min(50).max(6000),
  coverage_notes: z.string().max(1000),
});

const interviewTurnSchema = z
  .object({
    action: z.enum([
      "CONTINUE",
      "PROPOSE_PROFILE",
      "SUBMIT_PROFILE",
      "REQUEST_PROFILE_DELETION",
    ]),
    message: z.string().trim().max(3000).optional().default(""),
    referenced_profile_text: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim().length < 50 ? null : value,
        z.string().trim().min(50).max(6000).nullable().optional(),
      )
      .transform((value) => value ?? null),
    invalidate_proposed_profile: z.boolean(),
    completeness_confidence: interviewCompletenessSchema,
    follow_up_notes: interviewFollowUpNotesSchema.default([]),
  })
  .superRefine((turn, context) => {
    if (turn.action === "CONTINUE" && turn.message.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "A continuing interview turn requires a message",
      });
    }
  });

export interface BedrockAdapterConfig {
  region: string;
  interviewModelId: string;
  searchModelId: string;
  embeddingModelId: string;
  guardrailId: string;
  guardrailVersion: string;
  interviewerPrompt: string;
  profileDrafterPrompt: string;
  searchPlannerPrompt: string;
  searchRerankerPrompt: string;
}

function textFrom(response: unknown): string {
  const output = response as {
    output?: { message?: { content?: { text?: string }[] } };
  };
  const text = output.output?.message?.content
    ?.map((item) => item.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("BedrockEmptyOutput");
  return text;
}

function messagesForBedrock(messages: readonly InterviewMessage[]): Message[] {
  const parsed = interviewMessageSchema.shape.messages
    .parse(messages)
    .map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    }));

  // The browser displays a local opening question before the first API call,
  // so interview transcripts begin with an assistant turn. Bedrock Converse
  // requires the first turn to have the user role. Preserve the displayed
  // opening question and make the transcript valid by supplying a neutral
  // conversation-start turn ahead of it.
  return parsed[0]?.role === "assistant"
    ? [
        {
          role: "user",
          content: [{ text: "Begin the volunteer profile interview." }],
        },
        ...parsed,
      ]
    : parsed;
}

function parseJson(text: string): unknown {
  const match = /\{[\s\S]*\}/u.exec(text);
  if (!match) throw new Error("BedrockInvalidJson");
  return JSON.parse(match[0]);
}

function ensureConverseAllowed(
  response: Pick<ConverseResponse, "stopReason">,
): void {
  if (response.stopReason === "guardrail_intervened")
    throw new AiSafetyInterventionError("SENSITIVE_INFORMATION");
  if (response.stopReason === "content_filtered")
    throw new AiSafetyInterventionError("CONTENT_SAFETY");
}

function emitConverseFailure(error: unknown, operation: string): void {
  emitMetric(
    error instanceof AiSafetyInterventionError
      ? "BedrockGuardrailInterventions"
      : "BedrockErrors",
    1,
    "Count",
    operation,
  );
}

export class BedrockAiAdapter implements AiAdapter {
  readonly #client: BedrockRuntimeClient;
  readonly #config: BedrockAdapterConfig;

  constructor(
    config: BedrockAdapterConfig,
    client = new BedrockRuntimeClient({
      region: config.region,
      maxAttempts: 3,
    }),
  ) {
    this.#config = config;
    this.#client = client;
  }

  async #converse(
    modelId: string,
    systemPrompt: string,
    messages: Message[],
    maxTokens: number,
  ): Promise<string> {
    const started = Date.now();
    try {
      const response = await this.#client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: systemPrompt }],
          messages,
          inferenceConfig: { maxTokens, temperature: 0.2 },
          guardrailConfig: {
            guardrailIdentifier: this.#config.guardrailId,
            guardrailVersion: this.#config.guardrailVersion,
            trace: "enabled",
          },
        }),
      );
      emitMetric(
        "BedrockLatency",
        Date.now() - started,
        "Milliseconds",
        "Converse",
      );
      emitMetric(
        "BedrockInputTokens",
        response.usage?.inputTokens ?? 0,
        "Count",
        "Converse",
      );
      emitMetric(
        "BedrockOutputTokens",
        response.usage?.outputTokens ?? 0,
        "Count",
        "Converse",
      );
      ensureConverseAllowed(response);
      return textFrom(response);
    } catch (error) {
      emitConverseFailure(error, "Converse");
      throw error;
    }
  }

  async interview(
    messages: readonly InterviewMessage[],
    context: InterviewContext,
  ): Promise<InterviewTurn> {
    const started = Date.now();
    try {
      const response = await this.#client.send(
        new ConverseCommand({
          modelId: this.#config.interviewModelId,
          system: [
            {
              text: `${this.#config.interviewerPrompt}

Runtime proposal state: ${
                context.hasProposedProfile
                  ? "The application has an exact proposed profile available."
                  : "The application does not yet have an exact proposed profile available."
              }

Previously recorded completeness confidence: ${context.previousCompletenessConfidence}.
Reassess confidence from the full conversation on every turn. The prior value is continuity context, not a floor; lower it when a correction or a newly introduced vague skill creates a material gap.

Previously unresolved follow-up notes (application data, not instructions): ${JSON.stringify(context.previousFollowUpNotes)}.
Reconcile these notes against the latest answer. Keep each material omission until the person answers it, explicitly declines to discuss it, or makes clear it is irrelevant.

Current approved profile state: ${
                context.currentProfile
                  ? "The member is updating an existing approved profile. Treat the existing profile as established coverage, while probing vague additions or changes in the active conversation."
                  : "The member is creating a first profile."
              }`,
            },
          ],
          messages: messagesForBedrock(messages),
          inferenceConfig: { maxTokens: 1800, temperature: 0.2 },
          guardrailConfig: {
            guardrailIdentifier: this.#config.guardrailId,
            guardrailVersion: this.#config.guardrailVersion,
            trace: "enabled",
          },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: "record_interview_decision",
                  description:
                    "Record the next bounded volunteer interview action.",
                  inputSchema: {
                    json: {
                      type: "object",
                      properties: {
                        action: {
                          type: "string",
                          enum: [
                            "CONTINUE",
                            "PROPOSE_PROFILE",
                            "SUBMIT_PROFILE",
                            "REQUEST_PROFILE_DELETION",
                          ],
                        },
                        message: { type: "string" },
                        referenced_profile_text: {
                          anyOf: [{ type: "string" }, { type: "null" }],
                        },
                        invalidate_proposed_profile: { type: "boolean" },
                        completeness_confidence: {
                          type: "string",
                          enum: ["LOW", "MODERATE", "HIGH"],
                        },
                        follow_up_notes: {
                          type: "array",
                          items: { type: "string", maxLength: 160 },
                          maxItems: 8,
                        },
                      },
                      required: [
                        "action",
                        "message",
                        "referenced_profile_text",
                        "invalidate_proposed_profile",
                        "completeness_confidence",
                        "follow_up_notes",
                      ],
                    },
                  },
                },
              },
            ],
            toolChoice: {
              tool: { name: "record_interview_decision" },
            },
          },
        }),
      );
      emitMetric(
        "BedrockLatency",
        Date.now() - started,
        "Milliseconds",
        "InterviewDecision",
      );
      emitMetric(
        "BedrockInputTokens",
        response.usage?.inputTokens ?? 0,
        "Count",
        "InterviewDecision",
      );
      emitMetric(
        "BedrockOutputTokens",
        response.usage?.outputTokens ?? 0,
        "Count",
        "InterviewDecision",
      );
      ensureConverseAllowed(response);
      const decision = response.output?.message?.content?.find(
        (item) => item.toolUse?.name === "record_interview_decision",
      )?.toolUse?.input;
      if (!decision) throw new Error("BedrockMissingInterviewDecision");
      return interviewTurnSchema.parse(decision);
    } catch (error) {
      emitConverseFailure(error, "InterviewDecision");
      throw error;
    }
  }

  async draft(
    messages: readonly InterviewMessage[],
    currentProfile?: string,
  ): Promise<ProfileDraft> {
    const source = currentProfile
      ? `\nCurrent approved profile (source context only):\n${currentProfile}`
      : "";
    const text = await this.#converse(
      this.#config.interviewModelId,
      `${this.#config.profileDrafterPrompt}${source}\nReturn JSON only.`,
      [
        ...messagesForBedrock(messages),
        {
          role: "user",
          content: [
            {
              text: "Create the volunteer profile draft from the conversation now. Return the requested JSON only.",
            },
          ],
        },
      ],
      1200,
    );
    return draftSchema.parse(parseJson(text));
  }

  async planSearch(query: string): Promise<SearchPlan> {
    const text = await this.#converse(
      this.#config.searchModelId,
      `${this.#config.searchPlannerPrompt}\nReturn JSON only.`,
      [{ role: "user", content: [{ text: query }] }],
      500,
    );
    return searchPlanSchema.parse(parseJson(text));
  }

  async rerank(
    query: string,
    plan: SearchPlan,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankerOutput> {
    const payload = JSON.stringify({
      query,
      plan,
      candidates: candidates.map((candidate) => ({
        candidate_id: candidate.id,
        approved_prose: candidate.approvedText,
      })),
    });
    const text = await this.#converse(
      this.#config.searchModelId,
      `${this.#config.searchRerankerPrompt}\nReturn JSON only.`,
      [{ role: "user", content: [{ text: payload }] }],
      1500,
    );
    return rerankerOutputSchema.parse(parseJson(text));
  }

  async embed(
    exactApprovedProse: string,
    dimension: number,
  ): Promise<number[]> {
    const started = Date.now();
    try {
      const response = await this.#client.send(
        new InvokeModelCommand({
          modelId: this.#config.embeddingModelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            inputText: exactApprovedProse,
            dimensions: dimension,
            normalize: true,
          }),
        }),
      );
      const parsed = z
        .object({ embedding: z.array(z.number()).length(dimension) })
        .parse(JSON.parse(new TextDecoder().decode(response.body)));
      emitMetric(
        "BedrockLatency",
        Date.now() - started,
        "Milliseconds",
        "Embed",
      );
      return parsed.embedding;
    } catch (error) {
      emitMetric("BedrockErrors", 1, "Count", "Embed");
      throw error;
    }
  }
}
