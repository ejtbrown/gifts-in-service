import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createCognitoDeviceSrpSession,
  createCognitoDeviceVerifier,
} from "../../services/public-api/src/cognito-device-srp.js";

const deviceKey = "us-east-1_10000000-0000-4000-8000-000000000001";
const deviceGroupKey = "fictional-device-group";

describe("Cognito remembered-device SRP", () => {
  it("generates the documented Cognito device verifier encoding", () => {
    let call = 0;
    const verifier = createCognitoDeviceVerifier(
      deviceGroupKey,
      deviceKey,
      (size) => {
        call += 1;
        if (call === 1)
          return Buffer.from(Array.from({ length: size }, (_, i) => i + 1));
        return Buffer.from(Array.from({ length: size }, (_, i) => 0xf0 + i));
      },
    );

    expect(verifier.deviceSecret).toBe(
      "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKA==",
    );
    expect(verifier.salt).toBe("APDx8vP09fb3+Pn6+/z9/v8=");
    expect(
      // This digest keeps the deterministic Cognito SRP test vector compact;
      // it does not hash or store a user password.
      // codeql[js/insufficient-password-hash]
      createHash("sha256")
        .update(Buffer.from(verifier.passwordVerifier, "base64"))
        .digest("hex"),
    ).toBe("1a447bced9d284ceb351e7a2ba16bd74193e5ef4c36ca81bf54950531838324b");
  });

  it("matches a fixed device password-verifier challenge vector", () => {
    const credentials = {
      deviceKey,
      deviceGroupKey,
      deviceSecret: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKA==",
    };
    const session = createCognitoDeviceSrpSession(credentials, (size) =>
      Buffer.from(Array.from({ length: size }, (_, i) => i + 1)),
    );
    expect(
      createHash("sha256")
        .update(Buffer.from(session.publicA, "hex"))
        .digest("hex"),
    ).toBe("e2e06aeec2e3a1ed51a7b12d1f3714b2135b8bdd4d4eeacec8769f3efdfb38c8");

    expect(
      session.answer({
        serverB: "5",
        salt: "deadbeef",
        secretBlock: Buffer.from("fictional-secret-block").toString("base64"),
        now: new Date("2025-05-07T00:09:40.000Z"),
      }),
    ).toEqual({
      passwordClaimSignature: "MbbjV9LoUkD5lvrWort++Dab7I4h/Ai3Pq8wdHQcWl0=",
      passwordClaimSecretBlock: "ZmljdGlvbmFsLXNlY3JldC1ibG9jaw==",
      timestamp: "Wed May 7 00:09:40 UTC 2025",
    });
  });
});
