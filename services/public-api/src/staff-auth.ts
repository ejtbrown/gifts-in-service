import { createHmac } from "node:crypto";
import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type StaffAuthChallenge =
  | "NEW_PASSWORD_REQUIRED"
  | "SOFTWARE_TOKEN_MFA"
  | "MFA_SETUP";

export type StaffAuthStep =
  | { authenticated: true; idToken: string }
  | {
      authenticated: false;
      challenge: StaffAuthChallenge;
      session: string;
      username: string;
      secretCode?: string;
    };

export interface StaffIdentityProvider {
  startPasswordSignIn(
    username: string,
    password: string,
  ): Promise<StaffAuthStep>;
  respondToChallenge(input: {
    challenge: StaffAuthChallenge;
    session: string;
    username: string;
    response: string;
  }): Promise<StaffAuthStep>;
  requestPasswordReset(username: string): Promise<void>;
  confirmPasswordReset(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<void>;
}

export interface VerifiedStaffToken {
  subject: string;
  groupNames: string[];
}

export interface StaffTokenVerifier {
  verify(idToken: string): Promise<VerifiedStaffToken>;
}

interface CognitoAuthResponse {
  ChallengeName?: string | undefined;
  ChallengeParameters?: Record<string, string> | undefined;
  Session?: string | undefined;
  AuthenticationResult?: { IdToken?: string | undefined } | undefined;
}

export function cognitoSecretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return createHmac("sha256", clientSecret)
    .update(`${username}${clientId}`, "utf8")
    .digest("base64");
}

export class CognitoStaffIdentityProvider implements StaffIdentityProvider {
  readonly #client: CognitoIdentityProviderClient;
  readonly #userPoolId: string;
  readonly #clientId: string;
  readonly #clientSecret: string;

  constructor(input: {
    region: string;
    userPoolId: string;
    clientId: string;
    clientSecret: string;
    client?: CognitoIdentityProviderClient;
  }) {
    this.#client =
      input.client ??
      new CognitoIdentityProviderClient({
        region: input.region,
        maxAttempts: 3,
      });
    this.#userPoolId = input.userPoolId;
    this.#clientId = input.clientId;
    this.#clientSecret = input.clientSecret;
  }

  async startPasswordSignIn(
    username: string,
    password: string,
  ): Promise<StaffAuthStep> {
    const response = await this.#client.send(
      new AdminInitiateAuthCommand({
        AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
        UserPoolId: this.#userPoolId,
        ClientId: this.#clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
          SECRET_HASH: this.#secretHash(username),
        },
      }),
    );
    return this.#normalize(response, username);
  }

  async respondToChallenge(input: {
    challenge: StaffAuthChallenge;
    session: string;
    username: string;
    response: string;
  }): Promise<StaffAuthStep> {
    let session = input.session;
    if (input.challenge === "MFA_SETUP") {
      const verified = await this.#client.send(
        new VerifySoftwareTokenCommand({
          Session: session,
          UserCode: input.response,
          FriendlyDeviceName: "Gifts in Service staff",
        }),
      );
      if (verified.Status !== "SUCCESS" || !verified.Session)
        throw new Error("CognitoTotpVerificationFailed");
      session = verified.Session;
    }
    const challengeResponses: Record<string, string> = {
      USERNAME: input.username,
      SECRET_HASH: this.#secretHash(input.username),
    };
    if (input.challenge === "NEW_PASSWORD_REQUIRED")
      challengeResponses.NEW_PASSWORD = input.response;
    else if (input.challenge === "SOFTWARE_TOKEN_MFA")
      challengeResponses.SOFTWARE_TOKEN_MFA_CODE = input.response;
    const response = await this.#client.send(
      new AdminRespondToAuthChallengeCommand({
        UserPoolId: this.#userPoolId,
        ClientId: this.#clientId,
        ChallengeName: input.challenge,
        ChallengeResponses: challengeResponses,
        Session: session,
      }),
    );
    return this.#normalize(response, input.username);
  }

  async requestPasswordReset(username: string): Promise<void> {
    await this.#client.send(
      new ForgotPasswordCommand({
        ClientId: this.#clientId,
        Username: username,
        SecretHash: this.#secretHash(username),
      }),
    );
  }

  async confirmPasswordReset(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    await this.#client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: this.#clientId,
        Username: username,
        ConfirmationCode: code,
        Password: newPassword,
        SecretHash: this.#secretHash(username),
      }),
    );
  }

  #secretHash(username: string): string {
    return cognitoSecretHash(username, this.#clientId, this.#clientSecret);
  }

  async #normalize(
    response: CognitoAuthResponse,
    fallbackUsername: string,
  ): Promise<StaffAuthStep> {
    const idToken = response.AuthenticationResult?.IdToken;
    if (idToken) return { authenticated: true, idToken };
    const session = response.Session;
    const username =
      response.ChallengeParameters?.USER_ID_FOR_SRP ??
      response.ChallengeParameters?.USERNAME ??
      fallbackUsername;
    if (!response.ChallengeName || !session)
      throw new Error("CognitoAuthResponseInvalid");
    if (response.ChallengeName === "SELECT_MFA_TYPE") {
      const selected = await this.#client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.#userPoolId,
          ClientId: this.#clientId,
          ChallengeName: "SELECT_MFA_TYPE",
          ChallengeResponses: {
            USERNAME: username,
            SECRET_HASH: this.#secretHash(username),
            ANSWER: "SOFTWARE_TOKEN_MFA",
          },
          Session: session,
        }),
      );
      return this.#normalize(selected, username);
    }
    if (response.ChallengeName === "MFA_SETUP") {
      const associated = await this.#client.send(
        new AssociateSoftwareTokenCommand({ Session: session }),
      );
      if (!associated.Session || !associated.SecretCode)
        throw new Error("CognitoTotpSetupInvalid");
      return {
        authenticated: false,
        challenge: "MFA_SETUP",
        session: associated.Session,
        username,
        secretCode: associated.SecretCode,
      };
    }
    if (
      response.ChallengeName !== "NEW_PASSWORD_REQUIRED" &&
      response.ChallengeName !== "SOFTWARE_TOKEN_MFA"
    )
      throw new Error("CognitoChallengeUnsupported");
    return {
      authenticated: false,
      challenge: response.ChallengeName,
      session,
      username,
    };
  }
}

export class CognitoStaffTokenVerifier implements StaffTokenVerifier {
  readonly #issuer: string;
  readonly #clientId: string;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(input: { region: string; userPoolId: string; clientId: string }) {
    this.#issuer = `https://cognito-idp.${input.region}.amazonaws.com/${input.userPoolId}`;
    this.#clientId = input.clientId;
    this.#jwks = createRemoteJWKSet(
      new URL(`${this.#issuer}/.well-known/jwks.json`),
    );
  }

  async verify(idToken: string): Promise<VerifiedStaffToken> {
    const verified = await jwtVerify(idToken, this.#jwks, {
      issuer: this.#issuer,
      audience: this.#clientId,
      algorithms: ["RS256"],
    });
    if (
      verified.payload.token_use !== "id" ||
      typeof verified.payload.sub !== "string"
    )
      throw new Error("CognitoIdTokenInvalid");
    const groupNames = Array.isArray(verified.payload["cognito:groups"])
      ? verified.payload["cognito:groups"].filter(
          (group): group is string => typeof group === "string",
        )
      : [];
    return { subject: verified.payload.sub, groupNames };
  }
}
