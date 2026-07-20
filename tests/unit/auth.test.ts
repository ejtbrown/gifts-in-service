import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  generateOpaqueSecret,
  isTokenUsable,
  keyedHash,
  MEMBER_SESSION_TTL_SECONDS,
  memberCookieOptions,
  normalizeDisplayName,
  normalizeEmail,
  STAFF_SESSION_TTL_SECONDS,
  staffCookieOptions,
  validateCsrf,
  validateOrigin,
} from "../../packages/auth/src/index.js";

describe("authentication primitives", () => {
  it("normalizes conservatively without provider-specific rewriting", () => {
    expect(normalizeEmail("  Person.Name+church@Example.INVALID ")).toBe(
      "person.name+church@example.invalid",
    );
    expect(normalizeDisplayName("  Morgan   Example ")).toBe("morgan example");
  });

  it("generates at least 256 bits and stores only a keyed hash", () => {
    const secret = generateOpaqueSecret("a".repeat(32));
    expect(Buffer.from(secret.raw, "base64url")).toHaveLength(32);
    expect(secret.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(secret.hash).not.toContain(secret.raw);
    expect(
      constantTimeEqual(secret.hash, keyedHash(secret.raw, "a".repeat(32))),
    ).toBe(true);
  });

  it("enforces purpose, recipient, expiry, and one-time state", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const base = {
      purpose: "LOGIN",
      expiresAt: new Date("2026-07-15T12:15:00Z"),
      usedAt: null,
      recipientHash: "recipient",
    };
    expect(isTokenUsable(base, "LOGIN", now, "recipient")).toBe(true);
    expect(isTokenUsable(base, "RECONFIRM", now, "recipient")).toBe(false);
    expect(
      isTokenUsable(
        base,
        "LOGIN",
        new Date("2026-07-15T12:15:00Z"),
        "recipient",
      ),
    ).toBe(false);
    expect(
      isTokenUsable({ ...base, usedAt: now }, "LOGIN", now, "recipient"),
    ).toBe(false);
  });

  it("requires exact approved Origins and a hash-bound CSRF value", () => {
    const key = "s".repeat(32);
    const raw = generateOpaqueSecret(key);
    expect(
      validateOrigin("https://church.example", ["https://church.example"]),
    ).toBe(true);
    expect(
      validateOrigin("https://church.example.evil.invalid", [
        "https://church.example",
      ]),
    ).toBe(false);
    expect(validateOrigin(undefined, ["https://church.example"])).toBe(false);
    expect(validateCsrf(raw.raw, raw.hash, key)).toBe(true);
    expect(validateCsrf("forged", raw.hash, key)).toBe(false);
  });

  it("issues member cookies for the fixed 30-day session lifetime", () => {
    expect(MEMBER_SESSION_TTL_SECONDS).toBe(2_592_000);
    expect(memberCookieOptions()).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 2_592_000,
    });
  });

  it("issues staff cookies for the fixed 24-hour session lifetime", () => {
    expect(STAFF_SESSION_TTL_SECONDS).toBe(86_400);
    expect(staffCookieOptions()).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 86_400,
    });
  });
});
