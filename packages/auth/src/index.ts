import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const MEMBER_COOKIE = "__Host-gis_member_session";
export const STAFF_COOKIE = "__Host-gis_staff_session";
export const MEMBER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const STAFF_SESSION_TTL_SECONDS = 24 * 60 * 60;

export interface OpaqueSecret {
  raw: string;
  hash: string;
}

export function generateOpaqueSecret(key: string, bytes = 32): OpaqueSecret {
  const raw = randomBytes(bytes).toString("base64url");
  return { raw, hash: keyedHash(raw, key) };
}

export function keyedHash(value: string, key: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function encryptShortLivedSecret(
  value: string,
  keyMaterial: string,
): string {
  const key = createHash("sha256").update(keyMaterial, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export function decryptShortLivedSecret(
  value: string,
  keyMaterial: string,
): string {
  const payload = Buffer.from(value, "base64url");
  if (payload.length < 29) throw new Error("EncryptedSecretInvalid");
  const key = createHash("sha256").update(keyMaterial, "utf8").digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function validateOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    return false;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

export function validateCsrf(
  provided: string | undefined,
  expectedHash: string,
  key: string,
): boolean {
  if (!provided || provided.length > 256) return false;
  return constantTimeEqual(keyedHash(provided, key), expectedHash);
}

export function isTokenUsable(
  token: {
    purpose: string;
    expiresAt: Date;
    usedAt: Date | null;
    recipientHash?: string;
  },
  expectedPurpose: string,
  now: Date,
  expectedRecipientHash?: string,
): boolean {
  return (
    token.purpose === expectedPurpose &&
    token.usedAt === null &&
    token.expiresAt > now &&
    (expectedRecipientHash === undefined ||
      token.recipientHash === expectedRecipientHash)
  );
}

export function memberCookieOptions(
  maxAgeSeconds = MEMBER_SESSION_TTL_SECONDS,
) {
  return {
    secure: true,
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function staffCookieOptions(maxAgeSeconds = STAFF_SESSION_TTL_SECONDS) {
  return {
    secure: true,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
