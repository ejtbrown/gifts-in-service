import { describe, expect, it, vi } from "vitest";
import { BedrockAiAdapter } from "../../packages/ai/src/index.js";

const config = {
  region: "us-east-1",
  interviewModelId: "us.amazon.nova-2-lite-v1:0",
  searchModelId: "us.amazon.nova-2-lite-v1:0",
  embeddingModelId: "amazon.titan-embed-text-v2:0",
  guardrailId: "fictional-guardrail",
  guardrailVersion: "1",
  interviewerPrompt: "Interview the volunteer.",
  profileDrafterPrompt: "Draft the profile.",
  searchPlannerPrompt: "Plan the search.",
  searchRerankerPrompt: "Rerank the candidates.",
};

describe("Bedrock conversation formatting", () => {
  it.each([
    ["guardrail_intervened", "SENSITIVE_INFORMATION"],
    ["content_filtered", "CONTENT_SAFETY"],
  ] as const)(
    "turns the %s stop reason into a user-safe intervention",
    async (stopReason, category) => {
      const send = vi.fn(() =>
        Promise.resolve({
          stopReason,
          output: {
            message: {
              content: [{ text: "Provider-generated blocked response" }],
            },
          },
        }),
      );
      const adapter = new BedrockAiAdapter(config, { send } as never);

      await expect(
        adapter.interview(
          [
            {
              role: "assistant",
              content: "What skills would you like to share?",
            },
            {
              role: "user",
              content: "Fictional content that the provider blocked.",
            },
          ],
          false,
        ),
      ).rejects.toMatchObject({
        name: "AiSafetyInterventionError",
        category,
      });
    },
  );

  it("makes a browser transcript with a local assistant opening valid for Converse", async () => {
    let capturedCommand: unknown;
    const send = vi.fn((command: unknown) => {
      capturedCommand = command;
      return Promise.resolve({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  name: "record_interview_decision",
                  input: {
                    action: "CONTINUE",
                    message: "What else would you like to share?",
                    referenced_profile_text: null,
                  },
                },
              },
            ],
          },
        },
        usage: { inputTokens: 12, outputTokens: 8 },
      });
    });
    const adapter = new BedrockAiAdapter(config, { send } as never);

    const turn = await adapter.interview(
      [
        { role: "assistant", content: "What skills would you like to share?" },
        { role: "user", content: "I organize community events." },
      ],
      false,
    );

    expect(turn.action).toBe("CONTINUE");
    expect(turn.message).toBe("What else would you like to share?");
    const systemPrompt = (
      capturedCommand as {
        input?: { system?: { text?: string }[] };
      }
    ).input?.system?.[0]?.text;
    expect(systemPrompt).toContain(
      "does not yet have an exact proposed profile",
    );
    expect(capturedCommand).toMatchObject({
      input: {
        toolConfig: {
          toolChoice: {
            tool: { name: "record_interview_decision" },
          },
        },
        messages: [
          {
            role: "user",
            content: [{ text: "Begin the volunteer profile interview." }],
          },
          {
            role: "assistant",
            content: [{ text: "What skills would you like to share?" }],
          },
          {
            role: "user",
            content: [{ text: "I organize community events." }],
          },
        ],
      },
    });
  });

  it("returns a semantic submission decision with an exact legacy proposal reference", async () => {
    const exact =
      "This fictional volunteer organizes occasional community events and remains free to decline every future request.";
    const send = vi.fn(() =>
      Promise.resolve({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  name: "record_interview_decision",
                  input: {
                    action: "SUBMIT_PROFILE",
                    message: "I will submit that profile.",
                    referenced_profile_text: exact,
                  },
                },
              },
            ],
          },
        },
      }),
    );
    const adapter = new BedrockAiAdapter(config, { send } as never);

    const turn = await adapter.interview(
      [
        {
          role: "assistant",
          content: `Here is a proposed profile:\n\n${exact}`,
        },
        { role: "user", content: "That looks good; please submit it." },
      ],
      false,
    );

    expect(turn).toEqual({
      action: "SUBMIT_PROFILE",
      message: "I will submit that profile.",
      referenced_profile_text: exact,
    });
  });

  it("normalizes an empty optional proposal reference without weakening the action", async () => {
    const send = vi.fn(() =>
      Promise.resolve({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  name: "record_interview_decision",
                  input: {
                    action: "PROPOSE_PROFILE",
                    message: "",
                    referenced_profile_text: "",
                  },
                },
              },
            ],
          },
        },
      }),
    );
    const adapter = new BedrockAiAdapter(config, { send } as never);

    await expect(
      adapter.interview(
        [
          { role: "assistant", content: "What should staff know?" },
          { role: "user", content: "Please prepare a proposed profile." },
        ],
        false,
      ),
    ).resolves.toEqual({
      action: "PROPOSE_PROFILE",
      message: "",
      referenced_profile_text: null,
    });
  });

  it("adds a final user request when drafting from a transcript that ends with the assistant", async () => {
    let capturedCommand: unknown;
    const send = vi.fn((command: unknown) => {
      capturedCommand = command;
      return Promise.resolve({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  profile_text:
                    "This fictional volunteer can organize occasional community events and remains free to decline every future request.",
                  coverage_notes: "Confirm the frequency and boundaries.",
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 24, outputTokens: 20 },
      });
    });
    const adapter = new BedrockAiAdapter(config, { send } as never);

    await adapter.draft([
      { role: "assistant", content: "What skills would you like to share?" },
      { role: "user", content: "I organize occasional community events." },
      { role: "assistant", content: "What boundaries should staff know?" },
    ]);

    expect(capturedCommand).toMatchObject({
      input: {
        messages: [
          { role: "user" },
          { role: "assistant" },
          { role: "user" },
          { role: "assistant" },
          {
            role: "user",
            content: [
              {
                text: "Create the volunteer profile draft from the conversation now. Return the requested JSON only.",
              },
            ],
          },
        ],
      },
    });
  });
});
