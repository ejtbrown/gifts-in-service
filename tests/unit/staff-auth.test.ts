import { describe, expect, it, vi } from "vitest";
import {
  CognitoStaffIdentityProvider,
  cognitoSecretHash,
} from "../../services/public-api/src/staff-auth.js";

function commandDetails(command: unknown): {
  name: string;
  input: Record<string, unknown>;
} {
  if (typeof command !== "object" || command === null)
    throw new Error("Expected a Cognito command");
  const input =
    "input" in command &&
    typeof command.input === "object" &&
    command.input !== null
      ? (command.input as Record<string, unknown>)
      : {};
  return { name: command.constructor.name, input };
}

describe("Cognito staff authentication", () => {
  it("computes the confidential app-client secret hash", () => {
    expect(
      cognitoSecretHash("staff@example.invalid", "client-id", "client-secret"),
    ).toBe("wkG8hOaBk3jjI6Th7kE5N3W4P0ApwKtHv64B7ZqJ3LY=");
  });

  it("selects software TOTP, associates a token, and completes MFA setup", async () => {
    const send = vi.fn((command: unknown) => {
      const details = commandDetails(command);
      if (details.name === "AdminInitiateAuthCommand")
        return Promise.resolve({
          ChallengeName: "SELECT_MFA_TYPE",
          ChallengeParameters: {
            USERNAME: "staff@example.invalid",
            USER_ID_FOR_SRP: "canonical-user",
          },
          Session: "select-mfa-session",
        });
      if (
        details.name === "AdminRespondToAuthChallengeCommand" &&
        details.input.ChallengeName === "SELECT_MFA_TYPE"
      )
        return Promise.resolve({
          ChallengeName: "MFA_SETUP",
          ChallengeParameters: {
            USERNAME: "staff@example.invalid",
            USER_ID_FOR_SRP: "canonical-user",
          },
          Session: "mfa-setup-session",
        });
      if (details.name === "AssociateSoftwareTokenCommand")
        return Promise.resolve({
          SecretCode: "JBSWY3DPEHPK3PXP",
          Session: "associated-token-session",
        });
      if (details.name === "VerifySoftwareTokenCommand")
        return Promise.resolve({
          Status: "SUCCESS",
          Session: "verified-token-session",
        });
      if (
        details.name === "AdminRespondToAuthChallengeCommand" &&
        details.input.ChallengeName === "MFA_SETUP"
      )
        return Promise.resolve({
          AuthenticationResult: { IdToken: "verified-id-token" },
        });
      return Promise.reject(new Error("Unexpected Cognito command"));
    });
    const provider = new CognitoStaffIdentityProvider({
      region: "us-east-1",
      userPoolId: "fictional-pool",
      clientId: "fictional-client",
      clientSecret: "fictional-secret",
      client: { send } as never,
    });

    const setup = await provider.startPasswordSignIn(
      "staff@example.invalid",
      "Fictional-Temporary-17!",
    );
    expect(setup).toEqual({
      authenticated: false,
      challenge: "MFA_SETUP",
      session: "associated-token-session",
      username: "canonical-user",
      secretCode: "JBSWY3DPEHPK3PXP",
    });

    if (setup.authenticated) throw new Error("Expected an MFA setup challenge");
    const completed = await provider.respondToChallenge({
      challenge: setup.challenge,
      session: setup.session,
      username: setup.username,
      response: "123456",
    });
    expect(completed).toEqual({
      authenticated: true,
      idToken: "verified-id-token",
    });

    const challengeCommands = send.mock.calls
      .map(([command]) => commandDetails(command))
      .filter(({ name }) => name === "AdminRespondToAuthChallengeCommand");
    expect(challengeCommands).toHaveLength(2);
    expect(challengeCommands[0]?.input.ChallengeResponses).toMatchObject({
      USERNAME: "canonical-user",
      ANSWER: "SOFTWARE_TOKEN_MFA",
    });
    expect(challengeCommands[1]?.input).toMatchObject({
      ChallengeName: "MFA_SETUP",
      Session: "verified-token-session",
      ChallengeResponses: { USERNAME: "canonical-user" },
    });
  });
});
