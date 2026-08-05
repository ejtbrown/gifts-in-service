import { describe, expect, it } from "vitest";
import {
  CONSENT_VERSION,
  PRIVACY_NOTICE_VERSION,
  approvalDisclosure,
  initialDisclosure,
} from "../../packages/shared/src/index.js";

describe("plain-language disclosures", () => {
  it("versions the revised policy and explains AI without cloud jargon", () => {
    const copy = initialDisclosure.paragraphs.join(" ");

    expect(CONSENT_VERSION).toBe("2026-08-04.v3");
    expect(PRIVACY_NOTICE_VERSION).toBe("2026-08-04.draft-v3");
    expect(copy).toContain(
      "artificial intelligence (AI) assistant—a computer program",
    );
    expect(copy).toContain("shared mailbox");
    expect(copy).not.toMatch(
      /AWS|Bedrock|embedding|semantic retrieval|stateful model session/iu,
    );
  });

  it("warns that verified mailbox access can grant profile access", () => {
    const copy = approvalDisclosure.paragraphs.join(" ");

    expect(copy).toContain(
      "verified email address associated with this profile",
    );
    expect(copy).toContain("shared mailbox");
  });
});
