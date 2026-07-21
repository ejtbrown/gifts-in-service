import { describe, expect, it } from "vitest";
import {
  FakeAiAdapter,
  SENSITIVE_INFORMATION_REJECTION_MESSAGE,
  detectHighRiskInput,
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
