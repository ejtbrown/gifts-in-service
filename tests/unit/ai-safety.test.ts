import { describe, expect, it } from "vitest";
import {
  FakeAiAdapter,
  PRIVATE_HEALTH_FOLLOW_UP_MESSAGE,
  SENSITIVE_INFORMATION_REJECTION_MESSAGE,
  detectHighRiskInput,
  detectPrivateHealthInput,
  sanitizeApprovedProfileSource,
  sanitizeProfileDraftMessages,
  validateProposedProfile,
} from "../../packages/ai/src/index.js";

describe("AI safety boundaries", () => {
  it("redirects secrets without repeating them", async () => {
    const ai = new FakeAiAdapter();
    const response = await ai.interview(
      [{ role: "user", content: "My password is NeverPutThisInAProfile" }],
      {
        hasProposedProfile: false,
        previousCompletenessConfidence: "LOW",
        previousFollowUpNotes: [],
        previousConversationMemory: {
          establishedFacts: [],
          closedTopics: [],
        },
        currentProfile: null,
      },
    );
    expect(response.message).toBe(SENSITIVE_INFORMATION_REJECTION_MESSAGE);
    expect(response.message).not.toContain("NeverPutThisInAProfile");
    expect(detectHighRiskInput("SSN 123-45-6789")?.kind).toBe(
      "HIGH_RISK_SECRET",
    );
  });

  it("blocks diagnoses, contact data, identifiers, and payments from final prose", () => {
    expect(
      validateProposedProfile(
        "A long enough profile says I was diagnosed with a condition and can help occasionally.",
      ),
    ).not.toBeNull();
    expect(
      validateProposedProfile(
        "A long enough profile reaches me at volunteer@example.invalid and can help occasionally.",
      ),
    ).not.toBeNull();
    expect(
      validateProposedProfile(
        "A long enough profile contains 123-45-6789 and can help occasionally.",
      ),
    ).not.toBeNull();
    expect(
      validateProposedProfile(
        "This volunteer has schizophrenia and expressed an interest in infant care.",
      ),
    ).not.toBeNull();
    expect(
      validateProposedProfile(
        "This volunteer has private information that staff should address before infant care.",
      ),
    ).not.toBeNull();
    expect(
      validateProposedProfile(
        "They do not want to be considered for infant care. They can help organize occasional events.",
      ),
    ).toBeNull();
    expect(
      validateProposedProfile(
        "Before considering them for infant care, staff should discuss the activity's objective requirements and fit with the member.",
      ),
    ).toBeNull();
  });

  it("omits a health disclosure and asks only for a member-stated functional boundary", async () => {
    const disclosure =
      "I have schizophrenia and wonder whether I should provide infant care.";
    expect(detectPrivateHealthInput(disclosure)?.kind).toBe(
      "PRIVATE_HEALTH_DATA",
    );

    const ai = new FakeAiAdapter();
    const response = await ai.interview(
      [{ role: "user", content: disclosure }],
      {
        hasProposedProfile: false,
        previousCompletenessConfidence: "LOW",
        previousFollowUpNotes: [],
        previousConversationMemory: {
          establishedFacts: [],
          closedTopics: [],
        },
        currentProfile: null,
      },
    );

    expect(response.message).toBe(PRIVATE_HEALTH_FOLLOW_UP_MESSAGE);
    expect(response.message.toLowerCase()).not.toContain("schizophrenia");
    expect(response.conversation_memory.establishedFacts).toEqual([]);
  });

  it("removes private source turns before profile drafting", () => {
    const messages = sanitizeProfileDraftMessages([
      {
        role: "user",
        content: "I have schizophrenia and am interested in infant care.",
      },
      {
        role: "assistant",
        content:
          "Without repeating private health information, state a functional boundary.",
      },
      {
        role: "user",
        content: "I do not want to be considered for infant care.",
      },
    ]);
    expect(JSON.stringify(messages).toLowerCase()).not.toContain(
      "schizophrenia",
    );
    expect(messages.at(-1)?.content).toBe(
      "I do not want to be considered for infant care.",
    );
    expect(
      sanitizeApprovedProfileSource(
        "They organize occasional events. They have schizophrenia. They prefer one-time projects.",
      ),
    ).toBe("They organize occasional events. They prefer one-time projects.");
  });

  it("preserves advice-only and retired facts without inventing licensing", async () => {
    const ai = new FakeAiAdapter();
    const draft = await ai.draft([
      { role: "user", content: "I am a retired HVAC technician." },
      { role: "assistant", content: "What kind of help?" },
      {
        role: "user",
        content:
          "Advice and troubleshooting only; I do not do ladder or refrigerant work.",
      },
    ]);
    expect(draft.profile_text).toContain("retired HVAC technician");
    expect(draft.profile_text).toContain("Advice and troubleshooting only");
    expect(draft.profile_text.toLowerCase()).not.toContain("licensed");
  });
});
