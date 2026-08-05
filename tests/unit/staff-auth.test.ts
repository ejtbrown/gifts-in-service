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
      username: "canonical-user",
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

  it("replaces TOTP with Cognito device SRP for a remembered browser", async () => {
    const send = vi.fn((command: unknown) => {
      const details = commandDetails(command);
      if (details.name === "AdminInitiateAuthCommand")
        return Promise.resolve({
          ChallengeName: "DEVICE_SRP_AUTH",
          ChallengeParameters: { USER_ID_FOR_SRP: "canonical-user" },
          Session: "device-srp-session-value",
        });
      if (
        details.name === "AdminRespondToAuthChallengeCommand" &&
        details.input.ChallengeName === "DEVICE_SRP_AUTH"
      )
        return Promise.resolve({
          ChallengeName: "DEVICE_PASSWORD_VERIFIER",
          ChallengeParameters: {
            USERNAME: "canonical-user",
            SRP_B: "5",
            SALT: "deadbeef",
            SECRET_BLOCK: Buffer.from("fictional-secret-block").toString(
              "base64",
            ),
          },
          Session: "device-verifier-session-value",
        });
      if (
        details.name === "AdminRespondToAuthChallengeCommand" &&
        details.input.ChallengeName === "DEVICE_PASSWORD_VERIFIER"
      )
        return Promise.resolve({
          AuthenticationResult: { IdToken: "remembered-device-id-token" },
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
    const deviceKey = "us-east-1_10000000-0000-4000-8000-000000000001";

    await expect(
      provider.startPasswordSignIn(
        "staff@example.invalid",
        "Fictional-Permanent-17!",
        {
          deviceKey,
          deviceGroupKey: "fictional-device-group",
          deviceSecret: "fictional-device-secret-that-is-long-enough",
        },
      ),
    ).resolves.toEqual({
      authenticated: true,
      idToken: "remembered-device-id-token",
      username: "canonical-user",
      trustedDeviceStatus: "used",
    });

    const commands = send.mock.calls.map(([command]) =>
      commandDetails(command),
    );
    expect(commands[0]?.input.AuthParameters).toMatchObject({
      DEVICE_KEY: deviceKey,
    });
    expect(commands[1]?.input).toMatchObject({
      ChallengeName: "DEVICE_SRP_AUTH",
      ChallengeResponses: { DEVICE_KEY: deviceKey },
    });
    expect(commands[2]?.input).toMatchObject({
      ChallengeName: "DEVICE_PASSWORD_VERIFIER",
      ChallengeResponses: { DEVICE_KEY: deviceKey },
    });
  });

  it("confirms, remembers, and can forget a Cognito device", async () => {
    const send = vi.fn((command: unknown) => {
      void command;
      return Promise.resolve({ UserConfirmationNecessary: true });
    });
    const provider = new CognitoStaffIdentityProvider({
      region: "us-east-1",
      userPoolId: "fictional-pool",
      clientId: "fictional-client",
      clientSecret: "fictional-secret",
      client: { send } as never,
    });
    const deviceKey = "us-east-1_10000000-0000-4000-8000-000000000001";

    const credentials = await provider.confirmTrustedDevice({
      accessToken: "fictional-access-token",
      deviceKey,
      deviceGroupKey: "fictional-device-group",
    });
    expect(credentials).toMatchObject({
      deviceKey,
      deviceGroupKey: "fictional-device-group",
    });
    expect(credentials.deviceSecret.length).toBeGreaterThan(32);
    await provider.forgetTrustedDevice("canonical-user", deviceKey);

    const commands = send.mock.calls.map(([command]) =>
      commandDetails(command),
    );
    expect(commands.map((command) => command.name)).toEqual([
      "ConfirmDeviceCommand",
      "UpdateDeviceStatusCommand",
      "AdminForgetDeviceCommand",
    ]);
    expect(commands[0]?.input).toMatchObject({
      AccessToken: "fictional-access-token",
      DeviceKey: deviceKey,
    });
    const verifierConfig = commands[0]?.input.DeviceSecretVerifierConfig;
    if (typeof verifierConfig !== "object" || verifierConfig === null)
      throw new Error("Expected Cognito device verifier configuration");
    expect(typeof (verifierConfig as Record<string, unknown>).Salt).toBe(
      "string",
    );
    expect(
      typeof (verifierConfig as Record<string, unknown>).PasswordVerifier,
    ).toBe("string");
  });

  it("resolves the stable subject after password reset for device revocation", async () => {
    const send = vi.fn((command: unknown) => {
      const details = commandDetails(command);
      if (details.name === "ConfirmForgotPasswordCommand")
        return Promise.resolve({});
      if (details.name === "ListUsersCommand")
        return Promise.resolve({
          Users: [
            {
              Username: "canonical-user",
              Attributes: [
                {
                  Name: "sub",
                  Value: "30000000-0000-4000-8000-000000000001",
                },
                { Name: "email", Value: "staff@example.invalid" },
              ],
            },
          ],
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

    await expect(
      provider.confirmPasswordReset(
        "staff@example.invalid",
        "123456",
        "Another-Fictional-Password-17!",
      ),
    ).resolves.toEqual({
      subject: "30000000-0000-4000-8000-000000000001",
      cognitoUsername: "canonical-user",
    });
    expect(commandDetails(send.mock.calls[1]?.[0]).input).toMatchObject({
      Filter: 'email = "staff@example.invalid"',
      Limit: 2,
    });
  });
});
