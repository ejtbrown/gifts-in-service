import { PostgresExecutor, Repository } from "../../packages/db/src/index.js";
import {
  AiSafetyInterventionError,
  FakeAiAdapter,
  SENSITIVE_INFORMATION_REJECTION_MESSAGE,
} from "../../packages/ai/src/index.js";
import { keyedHash, sha256 } from "../../packages/auth/src/index.js";
import type { SqlExecutor } from "../../packages/db/src/index.js";
import type {
  EmailAdapter,
  OutboundEmail,
} from "../../packages/email/src/index.js";
import {
  CONSENT_VERSION,
  configSchema,
  embeddingVersion,
} from "../../packages/shared/src/index.js";
import { buildApp } from "../../services/public-api/src/app.js";
import type { AppDependencies } from "../../services/public-api/src/app.js";
import type {
  StaffAuthStep,
  StaffIdentityProvider,
  StaffTokenVerifier,
} from "../../services/public-api/src/staff-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

class CaptureEmail implements EmailAdapter {
  messages: OutboundEmail[] = [];
  send(message: OutboundEmail): Promise<{ messageId: string }> {
    this.messages.push(message);
    return Promise.resolve({ messageId: `fake-${this.messages.length}` });
  }
}

class PlannerFailureAi extends FakeAiAdapter {
  override planSearch(): Promise<never> {
    return Promise.reject(new Error("Fictional malformed planner output"));
  }
}

class RerankerFailureAi extends FakeAiAdapter {
  override rerank(): Promise<never> {
    return Promise.reject(new Error("Fictional malformed reranker output"));
  }
}

class GuardrailInterventionAi extends FakeAiAdapter {
  override interview(): Promise<never> {
    return Promise.reject(
      new AiSafetyInterventionError("SENSITIVE_INFORMATION"),
    );
  }
}

class FakeStaffIdentityProvider implements StaffIdentityProvider {
  resetConfirmed = false;

  startPasswordSignIn(
    username: string,
    password: string,
  ): Promise<StaffAuthStep> {
    if (password === "incorrect") {
      const error = new Error("Sensitive provider detail");
      error.name = "NotAuthorizedException";
      return Promise.reject(error);
    }
    if (password === "returning-user-password")
      return Promise.resolve({
        authenticated: false,
        challenge: "SOFTWARE_TOKEN_MFA",
        session: "returning-user-session-value",
        username: "canonical-cognito-username",
      });
    return Promise.resolve({
      authenticated: false,
      challenge: "NEW_PASSWORD_REQUIRED",
      session: "new-password-session-value",
      username: "canonical-cognito-username",
    });
  }

  respondToChallenge(input: {
    challenge: "NEW_PASSWORD_REQUIRED" | "SOFTWARE_TOKEN_MFA" | "MFA_SETUP";
    session: string;
    username: string;
    response: string;
  }): Promise<StaffAuthStep> {
    if (input.challenge === "NEW_PASSWORD_REQUIRED")
      return Promise.resolve({
        authenticated: false,
        challenge: "MFA_SETUP",
        session: "totp-setup-session-value",
        username: input.username,
        secretCode: "FAKESETUPSECRET",
      });
    return Promise.resolve({
      authenticated: true,
      idToken: "fake-verified-id-token",
    });
  }

  requestPasswordReset(): Promise<void> {
    return Promise.resolve();
  }

  confirmPasswordReset(): Promise<void> {
    this.resetConfirmed = true;
    return Promise.resolve();
  }
}

class FakeStaffTokenVerifier implements StaffTokenVerifier {
  constructor(
    private readonly groupNames: string[] = ["gis-staff", "unrecognized-group"],
  ) {}

  verify(): Promise<{
    subject: string;
    groupNames: string[];
  }> {
    return Promise.resolve({
      subject: "30000000-0000-4000-8000-000000000001",
      groupNames: this.groupNames,
    });
  }
}

interface FakeCognitoUser {
  subject: string;
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: string[];
}

class FakeCognitoAccessClient {
  readonly users: FakeCognitoUser[] = [
    {
      subject: "30000000-0000-4000-8000-000000000001",
      username: "admin@example.invalid",
      email: "admin@example.invalid",
      enabled: true,
      status: "CONFIRMED",
      groups: ["gis-admin"],
    },
    {
      subject: "30000000-0000-4000-8000-000000000002",
      username: "staff@example.invalid",
      email: "staff@example.invalid",
      enabled: true,
      status: "CONFIRMED",
      groups: ["gis-staff"],
    },
    {
      subject: "30000000-0000-4000-8000-000000000003",
      username: "technical@example.invalid",
      email: "technical@example.invalid",
      enabled: true,
      status: "CONFIRMED",
      groups: ["gis-technical-admin"],
    },
  ];

  send(command: unknown): Promise<unknown> {
    const value = command as {
      constructor: { name: string };
      input: {
        Filter?: string;
        Username?: string;
        GroupName?: string;
        UserAttributes?: { Name?: string; Value?: string }[];
      };
    };
    const byUsername = (): FakeCognitoUser | undefined =>
      this.users.find((user) => user.username === value.input.Username);
    if (value.constructor.name === "ListUsersCommand") {
      const subject = value.input.Filter?.match(/sub = "([^"]+)"/u)?.[1];
      const selected = subject
        ? this.users.filter((user) => user.subject === subject)
        : this.users;
      return Promise.resolve({
        Users: selected.map((user) => ({
          Username: user.username,
          Enabled: user.enabled,
          UserStatus: user.status,
          Attributes: [
            { Name: "sub", Value: user.subject },
            { Name: "email", Value: user.email },
          ],
        })),
      });
    }
    if (value.constructor.name === "AdminListGroupsForUserCommand")
      return Promise.resolve({
        Groups: (byUsername()?.groups ?? []).map((GroupName) => ({
          GroupName,
        })),
      });
    if (value.constructor.name === "AdminCreateUserCommand") {
      const username = value.input.Username ?? "";
      const subject = "30000000-0000-4000-8000-000000000004";
      this.users.push({
        subject,
        username,
        email:
          value.input.UserAttributes?.find(
            (attribute) => attribute.Name === "email",
          )?.Value ?? "",
        enabled: true,
        status: "FORCE_CHANGE_PASSWORD",
        groups: [],
      });
      return Promise.resolve({
        User: { Attributes: [{ Name: "sub", Value: subject }] },
      });
    }
    if (value.constructor.name === "AdminAddUserToGroupCommand") {
      const user = byUsername();
      if (user && value.input.GroupName)
        user.groups = [...new Set([...user.groups, value.input.GroupName])];
      return Promise.resolve({});
    }
    if (value.constructor.name === "AdminRemoveUserFromGroupCommand") {
      const user = byUsername();
      if (user && value.input.GroupName)
        user.groups = user.groups.filter(
          (group) => group !== value.input.GroupName,
        );
      return Promise.resolve({});
    }
    if (value.constructor.name === "AdminDisableUserCommand") {
      const user = byUsername();
      if (user) user.enabled = false;
      return Promise.resolve({});
    }
    if (value.constructor.name === "AdminEnableUserCommand") {
      const user = byUsername();
      if (user) user.enabled = true;
      return Promise.resolve({});
    }
    if (value.constructor.name === "AdminDeleteUserCommand") {
      const index = this.users.findIndex(
        (user) => user.username === value.input.Username,
      );
      if (index >= 0) this.users.splice(index, 1);
      return Promise.resolve({});
    }
    if (value.constructor.name === "AdminUserGlobalSignOutCommand")
      return Promise.resolve({});
    return Promise.reject(new Error("Unexpected fictional Cognito command"));
  }
}

const email = new CaptureEmail();
const executor = new PostgresExecutor(
  process.env.DATABASE_URL ??
    "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
);
const repository = new Repository(executor);
const config = configSchema.parse({
  APP_ENV: "test",
  AWS_REGION: "us-east-1",
  PORT: "3001",
  PUBLIC_BASE_URL: "http://localhost:5173",
  ALLOWED_ORIGINS: "http://localhost:5173",
  CHURCH_DISPLAY_NAME: "Fictional Test Church",
  APP_DISPLAY_NAME: "Gifts in Service",
  PRIVACY_CONTACT_EMAIL: "privacy@example.invalid",
  HELP_CONTACT_EMAIL: "help@example.invalid",
  DATABASE_URL: "postgres://unused",
  MAILPIT_SMTP_URL: "smtp://localhost:1025",
  SES_FROM_ADDRESS: "no-reply@example.invalid",
  SES_CONFIGURATION_SET: "test",
  MAGIC_LINK_HMAC_KEY: "m".repeat(32),
  SESSION_HMAC_KEY: "s".repeat(32),
  ORIGIN_VERIFY_SECRET: "o".repeat(32),
  AI_ADAPTER: "fake",
  EMAIL_ADAPTER: "mailpit",
  STAFF_AUTH_ADAPTER: "fake",
  COGNITO_USER_POOL_ID: "fake-pool",
  COGNITO_CLIENT_ID: "fake-client",
  COGNITO_CLIENT_SECRET: "fake-secret",
  INTERVIEW_MODEL_ID: "fake",
  SEARCH_MODEL_ID: "fake",
  EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
  EMBEDDING_DIMENSION: "1024",
  BEDROCK_GUARDRAIL_ID: "fake",
  BEDROCK_GUARDRAIL_VERSION: "DRAFT",
});
const origin = { origin: "http://localhost:5173" };
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ config, executor, email });
});
beforeEach(async () => {
  email.messages.length = 0;
  await executor.query(
    "DELETE FROM magic_link_tokens WHERE abuse_email_hash IS NOT NULL",
  );
});
afterAll(async () => {
  await app.close();
});

function cookie(response: {
  headers: { [key: string]: string | string[] | number | undefined };
}): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value)
    ? value[0]
    : typeof value === "string"
      ? value
      : undefined;
  return header?.split(";")[0] ?? "";
}

describe("public/member API security flow", () => {
  it("returns the same neutral response for known and unknown addresses", async () => {
    const request = (address: string) =>
      app.inject({
        method: "POST",
        url: "/api/public/magic-links",
        headers: origin,
        payload: { email: address },
      });
    const known = await request("shared.household@example.invalid");
    const unknown = await request(`unknown-${Date.now()}@example.invalid`);
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
  });

  it("requires Origin, protects against replay, binds exact approved text, and purges on deletion", async () => {
    const address = `api-${Date.now()}@example.invalid`;
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/api/public/magic-links",
      payload: {},
    });
    expect(missingOrigin.statusCode).toBe(403);
    await app.inject({
      method: "POST",
      url: "/api/public/magic-links",
      headers: origin,
      payload: { email: address },
    });
    const message = email.messages.at(-1)!;
    expect(message.text).not.toContain("API Fiction");
    const token = new URL(message.text.match(/http[^\s]+/u)![0]).hash.slice(
      "#token=".length,
    );
    const redeemed = await app.inject({
      method: "POST",
      url: "/api/public/magic-links/redeem",
      headers: origin,
      payload: { token },
    });
    expect(redeemed.statusCode).toBe(200);
    expect(String(redeemed.headers["set-cookie"])).toContain("Max-Age=2592000");
    const replay = await app.inject({
      method: "POST",
      url: "/api/public/magic-links/redeem",
      headers: origin,
      payload: { token },
    });
    expect(replay.statusCode).toBe(410);
    const sessionCookie = cookie(redeemed);
    let csrf = redeemed.json<{ csrfToken: string }>().csrfToken;
    const missingConsent = await app.inject({
      method: "POST",
      url: "/api/member/profiles/create",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: { displayName: "API Fiction", consentVersion: CONSENT_VERSION },
    });
    expect(missingConsent.statusCode).toBe(400);
    const create = await app.inject({
      method: "POST",
      url: "/api/member/profiles/create",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: {
        displayName: "API Fiction",
        adultConfirmed: true,
        disclosureAcknowledged: true,
        consentVersion: CONSENT_VERSION,
      },
    });
    expect(create.statusCode).toBe(200);
    const sessionRaw = sessionCookie.slice(sessionCookie.indexOf("=") + 1);
    const sessionTiming = await executor.query<{
      lifetime_seconds: number;
      idle_seconds: number;
    }>(
      `SELECT extract(epoch FROM (absolute_expires_at - issued_at))::int AS lifetime_seconds,
              extract(epoch FROM (idle_expires_at - issued_at))::int AS idle_seconds
       FROM member_sessions WHERE session_hash = $1`,
      [keyedHash(sessionRaw, config.SESSION_HMAC_KEY)],
    );
    expect(sessionTiming.rows[0]).toEqual({
      lifetime_seconds: 2_592_000,
      idle_seconds: 2_592_000,
    });
    const interview = await app.inject({
      method: "POST",
      url: "/api/member/interview/start",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: {},
    });
    expect(interview.statusCode).toBe(200);
    const initialInterview = interview.json<{
      revision: number;
      messages: { role: string; content: string }[];
      completenessConfidence: string;
    }>();
    expect(initialInterview.revision).toBe(0);
    expect(initialInterview.completenessConfidence).toBe("LOW");
    expect(initialInterview.messages).toHaveLength(1);
    const rejectedSensitiveInput = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: sessionCookie,
        "x-csrf-token": csrf,
      },
      payload: {
        response: "My fictional SSN is 000-00-0000.",
        revision: initialInterview.revision,
      },
    });
    expect(rejectedSensitiveInput.statusCode).toBe(422);
    expect(rejectedSensitiveInput.json()).toMatchObject({
      error: SENSITIVE_INFORMATION_REJECTION_MESSAGE,
    });
    const unchangedInterview = await repository.getPendingInterview(
      create.json<{ personId: string }>().personId,
      new Date(),
    );
    expect(unchangedInterview).toMatchObject({
      revision: 0,
      messages: initialInterview.messages,
    });
    expect(JSON.stringify(unchangedInterview)).not.toContain("000-00-0000");
    const guardrailExecutor = new PostgresExecutor(
      process.env.DATABASE_URL ??
        "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
    );
    const guardrailApp = await buildApp({
      config,
      executor: guardrailExecutor,
      email,
      ai: new GuardrailInterventionAi(),
    });
    try {
      const guardrailRejected = await guardrailApp.inject({
        method: "POST",
        url: "/api/member/interview/message",
        headers: {
          ...origin,
          cookie: sessionCookie,
          "x-csrf-token": csrf,
        },
        payload: {
          response:
            "This fictional response represents a provider-side privacy intervention.",
          revision: initialInterview.revision,
        },
      });
      expect(guardrailRejected.statusCode).toBe(422);
      expect(guardrailRejected.json()).toMatchObject({
        error: SENSITIVE_INFORMATION_REJECTION_MESSAGE,
      });
    } finally {
      await guardrailApp.close();
    }
    expect(
      await repository.getPendingInterview(
        create.json<{ personId: string }>().personId,
        new Date(),
      ),
    ).toMatchObject({
      revision: 0,
      messages: initialInterview.messages,
    });
    const answer = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: {
        response:
          "I maintain WordPress sites and can offer occasional accessibility advice only.",
        revision: initialInterview.revision,
      },
    });
    expect(answer.statusCode).toBe(200);
    const answerBody = answer.json<{
      revision: number;
      completenessConfidence: string;
    }>();
    const interviewRevision = answerBody.revision;
    expect(interviewRevision).toBe(1);
    expect(answerBody.completenessConfidence).toMatch(/MODERATE|HIGH/u);
    expect(
      (
        await repository.getPendingInterview(
          create.json<{ personId: string }>().personId,
          new Date(),
        )
      )?.completenessConfidence,
    ).toBe(answerBody.completenessConfidence);
    const draft = await app.inject({
      method: "POST",
      url: "/api/member/interview/draft",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: { revision: interviewRevision },
    });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json<{
      profile_text: string;
      approvalToken: string;
    }>();
    const exact = draftBody.profile_text;
    const changed = await app.inject({
      method: "POST",
      url: "/api/member/profile/approve",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: {
        profileText: `${exact} changed`,
        approvalToken: draftBody.approvalToken,
        consentVersion: CONSENT_VERSION,
      },
    });
    expect(changed.statusCode).toBe(409);
    const freshDraft = await app.inject({
      method: "POST",
      url: "/api/member/interview/draft",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: { revision: interviewRevision },
    });
    const freshDraftBody = freshDraft.json<{
      profile_text: string;
      approvalToken: string;
    }>();
    const approvedText = freshDraftBody.profile_text;
    const approved = await app.inject({
      method: "POST",
      url: "/api/member/profile/approve",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      payload: {
        profileText: approvedText,
        approvalToken: freshDraftBody.approvalToken,
        consentVersion: CONSENT_VERSION,
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(
      (
        await executor.query(
          "SELECT 1 FROM pending_interviews WHERE person_id = $1::uuid",
          [create.json<{ personId: string }>().personId],
        )
      ).rowCount,
    ).toBe(0);
    const session = await app.inject({
      method: "GET",
      url: "/api/member/session",
      headers: { cookie: sessionCookie },
    });
    const sessionBody = session.json<{
      person: { approvedText: string };
      csrfToken: string;
    }>();
    expect(sessionBody.person.approvedText).toBe(approvedText);
    csrf = sessionBody.csrfToken;
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/member/profile",
      headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
    });
    expect(deleted.statusCode).toBe(200);
    const expired = await app.inject({
      method: "GET",
      url: "/api/member/session",
      headers: { cookie: sessionCookie },
    });
    expect(expired.statusCode).toBe(401);
  });

  it("resumes the same pending interview through a newly redeemed magic link", async () => {
    const address = `resume-${Date.now()}@example.invalid`;
    await app.inject({
      method: "POST",
      url: "/api/public/magic-links",
      headers: origin,
      payload: { email: address },
    });
    const firstToken = new URL(
      email.messages.at(-1)!.text.match(/http[^\s]+/u)![0],
    ).hash.slice("#token=".length);
    const firstRedemption = await app.inject({
      method: "POST",
      url: "/api/public/magic-links/redeem",
      headers: origin,
      payload: { token: firstToken },
    });
    const firstCookie = cookie(firstRedemption);
    const firstCsrf = firstRedemption.json<{ csrfToken: string }>().csrfToken;
    const create = await app.inject({
      method: "POST",
      url: "/api/member/profiles/create",
      headers: {
        ...origin,
        cookie: firstCookie,
        "x-csrf-token": firstCsrf,
      },
      payload: {
        displayName: "Resume Browser Fiction",
        adultConfirmed: true,
        disclosureAcknowledged: true,
        consentVersion: CONSENT_VERSION,
      },
    });
    expect(create.statusCode).toBe(200);
    const personId = create.json<{ personId: string }>().personId;
    const firstStart = await app.inject({
      method: "POST",
      url: "/api/member/interview/start",
      headers: {
        ...origin,
        cookie: firstCookie,
        "x-csrf-token": firstCsrf,
      },
      payload: {},
    });
    const initial = firstStart.json<{
      revision: number;
      messages: { role: string; content: string }[];
      completenessConfidence: string;
      startedAt: string;
      expiresAt: string;
    }>();
    const responseText =
      "I can organize fictional community events on an occasional basis.";
    const answered = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: firstCookie,
        "x-csrf-token": firstCsrf,
      },
      payload: { response: responseText, revision: initial.revision },
    });
    expect(answered.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/api/public/magic-links",
      headers: origin,
      payload: { email: address },
    });
    const secondToken = new URL(
      email.messages.at(-1)!.text.match(/http[^\s]+/u)![0],
    ).hash.slice("#token=".length);
    const secondRedemption = await app.inject({
      method: "POST",
      url: "/api/public/magic-links/redeem",
      headers: origin,
      payload: { token: secondToken },
    });
    expect(
      secondRedemption
        .json<{ profiles: { id: string }[] }>()
        .profiles.map((profile) => profile.id),
    ).toContain(personId);
    const secondCookie = cookie(secondRedemption);
    const secondCsrf = secondRedemption.json<{ csrfToken: string }>().csrfToken;
    const selected = await app.inject({
      method: "POST",
      url: "/api/member/profiles/select",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: { personId },
    });
    expect(selected.statusCode).toBe(200);
    const resumedResponse = await app.inject({
      method: "POST",
      url: "/api/member/interview/start",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {},
    });
    const resumed = resumedResponse.json<{
      revision: number;
      messages: { role: string; content: string }[];
      completenessConfidence: string;
      startedAt: string;
      expiresAt: string;
    }>();
    expect(resumed.revision).toBe(1);
    expect(resumed.completenessConfidence).toBe("MODERATE");
    expect(resumed.messages.map((message) => message.content)).toContain(
      responseText,
    );
    expect(resumed.startedAt).toBe(initial.startedAt);
    expect(resumed.expiresAt).toBe(initial.expiresAt);

    const proposed = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {
        response: "Please prepare a proposed profile now.",
        revision: resumed.revision,
      },
    });
    expect(proposed.statusCode).toBe(200);
    const proposal = proposed.json<{
      saved: false;
      revision: number;
      proposedProfile: string;
      message: string;
    }>();
    expect(proposal.proposedProfile).toContain(
      "organize fictional community events",
    );
    expect(proposal.message).toContain(proposal.proposedProfile);

    const addedAfterProposal = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {
        response:
          "I also maintained computer networks and servers and could offer occasional troubleshooting advice.",
        revision: proposal.revision,
      },
    });
    expect(addedAfterProposal.statusCode).toBe(200);
    const addition = addedAfterProposal.json<{
      saved: false;
      deletionRequested: false;
      revision: number;
      proposedProfile: null;
    }>();
    expect(addition.proposedProfile).toBeNull();
    expect(addition.deletionRequested).toBe(false);
    expect(
      (await repository.getPendingInterview(personId, new Date()))
        ?.proposedProfile,
    ).toBeNull();

    const reproposed = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {
        response: "Please prepare the updated proposed profile now.",
        revision: addition.revision,
      },
    });
    expect(reproposed.statusCode).toBe(200);
    const updatedProposal = reproposed.json<{
      saved: false;
      revision: number;
      proposedProfile: string;
    }>();
    expect(updatedProposal.proposedProfile).toContain(
      "maintained computer networks and servers",
    );

    const semanticSubmission = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {
        response: "That looks good. Please submit it.",
        revision: updatedProposal.revision,
      },
    });
    expect(semanticSubmission.statusCode).toBe(200);
    expect(semanticSubmission.json()).toEqual({ saved: true });
    expect(
      await repository.getPendingInterview(personId, new Date()),
    ).toBeNull();
    expect((await repository.getPerson(personId))?.approvedText).toBe(
      updatedProposal.proposedProfile,
    );

    const deletionInterview = await app.inject({
      method: "POST",
      url: "/api/member/interview/start",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {},
    });
    const deletionStart = deletionInterview.json<{ revision: number }>();
    const deletionRequest = await app.inject({
      method: "POST",
      url: "/api/member/interview/message",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
      payload: {
        response: "Please delete my entire profile.",
        revision: deletionStart.revision,
      },
    });
    expect(deletionRequest.statusCode).toBe(200);
    expect(deletionRequest.json()).toMatchObject({
      saved: false,
      deletionRequested: true,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/member/profile",
      headers: {
        ...origin,
        cookie: secondCookie,
        "x-csrf-token": secondCsrf,
      },
    });
    expect(deleted.statusCode).toBe(200);
  });

  it("enforces staff permissions on the backend for technical and privacy-only roles", async () => {
    for (const group of [
      "gis-technical-admin",
      "gis-privacy-auditor",
    ] as const) {
      const signedIn = await app.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: [group] },
      });
      const staffCookie = cookie(signedIn);
      const csrf = signedIn.json<{ csrfToken: string }>().csrfToken;
      const search = await app.inject({
        method: "POST",
        url: "/api/staff/search",
        headers: { ...origin, cookie: staffCookie, "x-csrf-token": csrf },
        payload: { query: "WordPress accessibility" },
      });
      expect(search.statusCode).toBe(403);
      const profile = await app.inject({
        method: "GET",
        url: "/api/staff/profiles/10000000-0000-4000-8000-000000000002",
        headers: { cookie: staffCookie },
      });
      expect(profile.statusCode).toBe(403);
    }
  });

  it("falls back to deterministic retrieval when the AI search plan is malformed", async () => {
    const fallbackExecutor = new PostgresExecutor(
      process.env.DATABASE_URL ??
        "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
    );
    const fallbackApp = await buildApp({
      config,
      executor: fallbackExecutor,
      email,
      ai: new PlannerFailureAi(),
    });
    try {
      const signedIn = await fallbackApp.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: ["gis-staff"] },
      });
      const response = await fallbackApp.inject({
        method: "POST",
        url: "/api/staff/search",
        headers: {
          ...origin,
          cookie: cookie(signedIn),
          "x-csrf-token": signedIn.json<{ csrfToken: string }>().csrfToken,
        },
        payload: { query: "WordPress accessibility experience" },
      });
      expect(response.statusCode).toBe(200);
      const results = response.json<{
        results: { personId: string; explanationGeneratedByAi: boolean }[];
      }>().results;
      expect(results.map((result) => result.personId)).toContain(
        "10000000-0000-4000-8000-000000000002",
      );
    } finally {
      await fallbackApp.close();
    }
  });

  it("gives every deterministic reranker fallback a grade and focused evidence", async () => {
    const fallbackExecutor = new PostgresExecutor(
      process.env.DATABASE_URL ??
        "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
    );
    const fallbackApp = await buildApp({
      config,
      executor: fallbackExecutor,
      email,
      ai: new RerankerFailureAi(),
    });
    try {
      const signedIn = await fallbackApp.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: ["gis-staff"] },
      });
      const response = await fallbackApp.inject({
        method: "POST",
        url: "/api/staff/search",
        headers: {
          ...origin,
          cookie: cookie(signedIn),
          "x-csrf-token": signedIn.json<{ csrfToken: string }>().csrfToken,
        },
        payload: { query: "WordPress accessibility experience" },
      });
      expect(response.statusCode).toBe(200);
      const results = response.json<{
        results: {
          relevance: string;
          reason: string;
          evidence: string[];
          explanationGeneratedByAi: boolean;
        }[];
      }>().results;
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(["HIGH", "MEDIUM", "LOW"]).toContain(result.relevance);
        expect(result.relevance).not.toBe("UNRANKED");
        expect(result.reason).not.toContain("retrieval method");
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.explanationGeneratedByAi).toBe(false);
      }
    } finally {
      await fallbackApp.close();
    }
  });

  it("returns no more than the top ten fused search candidates", async () => {
    const createdPersonIds: string[] = [];
    const fakeAi = new FakeAiAdapter();
    try {
      for (let index = 0; index < 11; index += 1) {
        const personId = await repository.createPerson({
          displayName: `Search Limit Fiction ${index}`,
          normalizedDisplayName: `search limit fiction ${index}`,
          displayEmail: `search-limit-${index}@example.invalid`,
          normalizedEmail: `search-limit-${index}@example.invalid`,
          consentVersion: CONSENT_VERSION,
          now: new Date(),
        });
        createdPersonIds.push(personId);
        const approvedText = `This fictional profile ${index} offers occasional help organizing community materials and can freely decline any request.`;
        await repository.saveApprovedProfile({
          personId,
          exactText: approvedText,
          sha256: sha256(approvedText),
          embedding: await fakeAi.embed(approvedText, 1024),
          embeddingModelId: "amazon.titan-embed-text-v2:0",
          embeddingVersion: embeddingVersion(
            "fake",
            "amazon.titan-embed-text-v2:0",
            1024,
          ),
          promptVersion: "test-search-limit",
          consentVersion: CONSENT_VERSION,
          now: new Date(),
        });
      }

      const signedIn = await app.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: ["gis-staff"] },
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/staff/search",
        headers: {
          ...origin,
          cookie: cookie(signedIn),
          "x-csrf-token": signedIn.json<{ csrfToken: string }>().csrfToken,
        },
        payload: { query: "help organizing community materials" },
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ results: { personId: string }[] }>().results,
      ).toHaveLength(10);
    } finally {
      if (createdPersonIds.length > 0)
        await executor.query("DELETE FROM people WHERE id = ANY($1::uuid[])", [
          createdPersonIds,
        ]);
    }
  });

  it("lets administrators manage all volunteer record states while staff remain active-only", async () => {
    const personId = await repository.createPerson({
      displayName: "Volunteer Controls Fiction",
      normalizedDisplayName: "volunteer controls fiction",
      displayEmail: "volunteer-controls@example.invalid",
      normalizedEmail: "volunteer-controls@example.invalid",
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    const approvedText =
      "Volunteer Controls Fiction can help organize fictional library materials on an occasional basis and remains free to decline any request.";
    const fakeAi = new FakeAiAdapter();
    await repository.saveApprovedProfile({
      personId,
      exactText: approvedText,
      sha256: sha256(approvedText),
      embedding: await fakeAi.embed(approvedText, config.EMBEDDING_DIMENSION),
      embeddingModelId: config.EMBEDDING_MODEL_ID,
      embeddingVersion: embeddingVersion(
        config.AI_ADAPTER,
        config.EMBEDDING_MODEL_ID,
        config.EMBEDDING_DIMENSION,
      ),
      promptVersion: "fictional-profile-prompt",
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    try {
      const adminSignIn = await app.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: ["gis-admin"] },
      });
      const adminCookie = cookie(adminSignIn);
      const adminCsrf = adminSignIn.json<{ csrfToken: string }>().csrfToken;
      const records = await app.inject({
        method: "GET",
        url: "/api/staff/profiles",
        headers: { cookie: adminCookie },
      });
      expect(records.statusCode).toBe(200);
      expect(
        records
          .json<{ people: { id: string }[] }>()
          .people.map((person) => person.id),
      ).toContain(personId);

      const paused = await app.inject({
        method: "POST",
        url: `/api/staff/profiles/${personId}/pause`,
        headers: {
          ...origin,
          cookie: adminCookie,
          "x-csrf-token": adminCsrf,
        },
        payload: {},
      });
      expect(paused.statusCode).toBe(200);
      expect((await repository.getPerson(personId))?.status).toBe("PAUSED");
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/staff/profiles/${personId}`,
            headers: { cookie: adminCookie },
          })
        ).statusCode,
      ).toBe(200);

      const staffSignIn = await app.inject({
        method: "POST",
        url: "/api/staff/auth/fake",
        headers: origin,
        payload: { groups: ["gis-staff"] },
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/staff/profiles/${personId}`,
            headers: { cookie: cookie(staffSignIn) },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/staff/profiles",
            headers: { cookie: cookie(staffSignIn) },
          })
        ).statusCode,
      ).toBe(403);

      const reactivated = await app.inject({
        method: "POST",
        url: `/api/staff/profiles/${personId}/reactivate`,
        headers: {
          ...origin,
          cookie: adminCookie,
          "x-csrf-token": adminCsrf,
        },
        payload: {},
      });
      expect(reactivated.statusCode).toBe(200);
      expect((await repository.getPerson(personId))?.status).toBe("ACTIVE");

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/staff/profiles/${personId}`,
        headers: {
          ...origin,
          cookie: adminCookie,
          "x-csrf-token": adminCsrf,
        },
      });
      expect(deleted.statusCode).toBe(200);
      expect(await repository.getPerson(personId)).toBeNull();
    } finally {
      await executor.query("DELETE FROM people WHERE id = $1::uuid", [
        personId,
      ]);
    }
  });

  it("keeps Cognito password, TOTP setup, MFA, and reset challenges on the application page", async () => {
    const identityProvider = new FakeStaffIdentityProvider();
    const cognitoExecutor = new PostgresExecutor(
      process.env.DATABASE_URL ??
        "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
    );
    const cognitoApp = await buildApp({
      config: { ...config, STAFF_AUTH_ADAPTER: "cognito" },
      executor: cognitoExecutor,
      email,
      ai: new FakeAiAdapter(),
      staffIdentityProvider: identityProvider,
      staffTokenVerifier: new FakeStaffTokenVerifier(),
    });
    try {
      const legacyLogin = await cognitoApp.inject({
        method: "GET",
        url: "/api/staff/auth/login",
      });
      expect(legacyLogin.statusCode).toBe(302);
      expect(legacyLogin.headers.location).toBe("/staff");
      expect(
        (
          await cognitoApp.inject({
            method: "GET",
            url: "/api/staff/auth/callback?code=unused&state=unused",
          })
        ).statusCode,
      ).toBe(404);

      const rejected = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/login",
        headers: origin,
        payload: {
          email: "staff-auth@example.invalid",
          password: "incorrect",
        },
      });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json()).toEqual({
        error: "The email or password was not accepted.",
      });
      expect(rejected.body).not.toContain("Sensitive provider detail");

      const initial = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/login",
        headers: origin,
        payload: {
          email: "staff-auth@example.invalid",
          password: "temporary-password",
        },
      });
      expect(initial.statusCode).toBe(200);
      const firstStep = initial.json<{
        authenticated: false;
        challenge: string;
        transaction: string;
      }>();
      expect(firstStep.challenge).toBe("NEW_PASSWORD_REQUIRED");
      expect(initial.body).not.toContain("new-password-session-value");
      expect(initial.body).not.toContain("canonical-cognito-username");

      const tampered = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/challenge",
        headers: origin,
        payload: {
          transaction: `${firstStep.transaction}x`,
          response: "ValidPermanent1!",
        },
      });
      expect(tampered.statusCode).toBe(400);

      const permanentPassword = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/challenge",
        headers: origin,
        payload: {
          transaction: firstStep.transaction,
          response: "ValidPermanent1!",
        },
      });
      const setupStep = permanentPassword.json<{
        authenticated: false;
        challenge: string;
        transaction: string;
        secretCode: string;
      }>();
      expect(setupStep).toMatchObject({
        authenticated: false,
        challenge: "MFA_SETUP",
        secretCode: "FAKESETUPSECRET",
      });
      expect(permanentPassword.body).not.toContain("totp-setup-session-value");

      const completed = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/challenge",
        headers: origin,
        payload: {
          transaction: setupStep.transaction,
          response: "123456",
        },
      });
      expect(completed.statusCode).toBe(200);
      const completedBody = completed.json<{
        authenticated: boolean;
        groups: string[];
        permissions: string[];
      }>();
      expect(completedBody).toMatchObject({
        authenticated: true,
        groups: ["gis-staff"],
      });
      expect(completedBody.permissions).toContain("profile:search");
      const staffCookie = cookie(completed);
      expect(staffCookie).toContain("__Host-gis_staff_session=");
      expect(String(completed.headers["set-cookie"])).toContain(
        "Max-Age=86400",
      );
      const staffSessionTiming = await cognitoExecutor.query<{
        lifetime_seconds: number;
      }>(
        `SELECT extract(epoch FROM (expires_at - issued_at))::int AS lifetime_seconds
         FROM staff_sessions WHERE session_hash = $1`,
        [
          keyedHash(
            staffCookie.slice(staffCookie.indexOf("=") + 1),
            config.SESSION_HMAC_KEY,
          ),
        ],
      );
      expect(staffSessionTiming.rows[0]?.lifetime_seconds).toBe(86_400);
      expect(
        (
          await cognitoApp.inject({
            method: "GET",
            url: "/api/staff/me",
            headers: { cookie: staffCookie },
          })
        ).statusCode,
      ).toBe(200);

      const returning = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/login",
        headers: origin,
        payload: {
          email: "staff-auth@example.invalid",
          password: "returning-user-password",
        },
      });
      expect(returning.json<{ challenge: string }>().challenge).toBe(
        "SOFTWARE_TOKEN_MFA",
      );

      const forgot = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/forgot-password",
        headers: origin,
        payload: { email: "staff-auth@example.invalid" },
      });
      expect(forgot.statusCode).toBe(200);
      const reset = forgot.json<{ message: string; transaction: string }>();
      expect(reset.message).toBe(
        "If the staff account can be reset, Cognito has sent a verification code.",
      );
      const confirmed = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/confirm-password",
        headers: origin,
        payload: {
          transaction: reset.transaction,
          code: "123456",
          newPassword: "AnotherPermanent1!",
        },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(identityProvider.resetConfirmed).toBe(true);
    } finally {
      await cognitoApp.close();
    }
  });

  it("administers the complete lifecycle of lower-privilege Cognito users while protecting privileged users", async () => {
    const cognito = new FakeCognitoAccessClient();
    const cognitoExecutor = new PostgresExecutor(
      process.env.DATABASE_URL ??
        "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
    );
    const cognitoApp = await buildApp({
      config: { ...config, STAFF_AUTH_ADAPTER: "cognito" },
      executor: cognitoExecutor,
      email,
      ai: new FakeAiAdapter(),
      staffIdentityProvider: new FakeStaffIdentityProvider(),
      staffTokenVerifier: new FakeStaffTokenVerifier(["gis-admin"]),
      cognito: cognito as unknown as AppDependencies["cognito"],
    });
    try {
      const signIn = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/login",
        headers: origin,
        payload: {
          email: "admin@example.invalid",
          password: "returning-user-password",
        },
      });
      const challenge = signIn.json<{ transaction: string }>();
      const completed = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/auth/challenge",
        headers: origin,
        payload: { transaction: challenge.transaction, response: "123456" },
      });
      expect(completed.statusCode).toBe(200);
      const adminCookie = cookie(completed);
      const csrf = completed.json<{ csrfToken: string }>().csrfToken;
      const headers = {
        ...origin,
        cookie: adminCookie,
        "x-csrf-token": csrf,
      };

      const listed = await cognitoApp.inject({
        method: "GET",
        url: "/api/staff/access",
        headers: { cookie: adminCookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json<{ users: unknown[] }>().users).toHaveLength(3);

      const invited = await cognitoApp.inject({
        method: "POST",
        url: "/api/staff/access/invite",
        headers,
        payload: {
          email: "invited@example.invalid",
          groups: ["gis-ministry-leader"],
        },
      });
      expect(invited.statusCode).toBe(200);
      expect(
        cognito.users.find((user) => user.email === "invited@example.invalid")
          ?.groups,
      ).toEqual(["gis-ministry-leader"]);

      const lowerSubject = "30000000-0000-4000-8000-000000000002";
      const groupsChanged = await cognitoApp.inject({
        method: "POST",
        url: `/api/staff/access/${lowerSubject}/groups`,
        headers,
        payload: { groups: ["gis-ministry-leader", "gis-privacy-auditor"] },
      });
      expect(groupsChanged.statusCode).toBe(200);
      expect(
        cognito.users.find((user) => user.subject === lowerSubject)?.groups,
      ).toEqual(["gis-ministry-leader", "gis-privacy-auditor"]);

      const disabled = await cognitoApp.inject({
        method: "POST",
        url: `/api/staff/access/${lowerSubject}/disable`,
        headers,
        payload: {},
      });
      expect(disabled.statusCode).toBe(200);
      expect(
        cognito.users.find((user) => user.subject === lowerSubject)?.enabled,
      ).toBe(false);

      const enabled = await cognitoApp.inject({
        method: "POST",
        url: `/api/staff/access/${lowerSubject}/enable`,
        headers,
        payload: {},
      });
      expect(enabled.statusCode).toBe(200);
      expect(
        cognito.users.find((user) => user.subject === lowerSubject)?.enabled,
      ).toBe(true);

      expect(
        (
          await cognitoApp.inject({
            method: "DELETE",
            url: "/api/staff/access/30000000-0000-4000-8000-000000000003",
            headers,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await cognitoApp.inject({
            method: "DELETE",
            url: "/api/staff/access/30000000-0000-4000-8000-000000000001",
            headers,
          })
        ).statusCode,
      ).toBe(409);

      const deleted = await cognitoApp.inject({
        method: "DELETE",
        url: `/api/staff/access/${lowerSubject}`,
        headers,
      });
      expect(deleted.statusCode).toBe(200);
      expect(cognito.users.some((user) => user.subject === lowerSubject)).toBe(
        false,
      );
    } finally {
      await cognitoApp.close();
    }
  });

  it("rejects the production API origin when the CloudFront verification header is absent", async () => {
    const unavailable = async (): Promise<never> =>
      Promise.reject(new Error("Unexpected query"));
    const inertExecutor: SqlExecutor = {
      query: unavailable,
      transaction: unavailable,
    };
    const productionApp = await buildApp({
      config: { ...config, APP_ENV: "prod" },
      executor: inertExecutor,
      email,
      ai: new FakeAiAdapter(),
    });
    try {
      expect(
        (await productionApp.inject({ method: "GET", url: "/api/config" }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await productionApp.inject({
            method: "GET",
            url: "/api/config",
            headers: { "x-gis-origin-verify": config.ORIGIN_VERIFY_SECRET },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await productionApp.close();
    }
  });
});
