import { describe, expect, it } from "vitest";
import {
  CONSENT_VERSION,
  PRIVACY_NOTICE_VERSION,
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
    expect(copy).not.toMatch(
      /AWS|Bedrock|embedding|semantic retrieval|stateful model session/iu,
    );
  });
});
