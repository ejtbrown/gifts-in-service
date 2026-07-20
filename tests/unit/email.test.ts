import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "../../packages/email/src/index.js";

describe("magic-link email", () => {
  it("renders expiration in US Central date and time format", () => {
    const message = magicLinkEmail({
      appName: "Gifts in Service",
      magicLink:
        "https://fictional.example.invalid/magic#token=fake-token-for-testing",
      expiresAt: new Date("2026-07-17T18:45:00.000Z"),
    });

    const expiration = "July 17, 2026 at 1:45 PM CDT";
    expect(message.text).toContain(`It expires at ${expiration}`);
    expect(message.html).toContain(`It expires at ${expiration}`);
    expect(message.text).not.toContain("2026-07-17T18:45:00.000Z");
    expect(message.text).not.toContain("select Continue");
    expect(message.html).not.toContain("select Continue");
  });
});
