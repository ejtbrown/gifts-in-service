import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  AiMalformedInterviewResponseError,
  AiMalformedProfileDraftResponseError,
  AiSafetyInterventionError,
  BedrockAiAdapter,
  FakeAiAdapter,
  PRIVATE_HEALTH_FOLLOW_UP_MESSAGE,
  PRIVATE_HEALTH_OMITTED_TRANSCRIPT_MESSAGE,
  PROMPT_VERSIONS,
  applyRequiredRoleSafetyStatements,
  deriveRoleSafetyConcerns,
  detectHighRiskInput,
  detectPrivateHealthInput,
  detectRoleSafetyConcerns,
  loadPromptBundle,
  mergeRoleSafetyConcerns,
  roleSafetyConcernAcknowledgement,
  sanitizePendingHealthMessages,
  sanitizeProfileDraftMessages,
  validateProposedProfile,
  validateRequiredRoleSafetyStatements,
  type AiAdapter,
} from "@gis/ai";
import {
  MEMBER_COOKIE,
  STAFF_COOKIE,
  STAFF_TRUST_COOKIE,
  STAFF_TRUST_TTL_SECONDS,
  constantTimeEqual,
  decryptShortLivedSecret,
  encryptShortLivedSecret,
  generateOpaqueSecret,
  keyedHash,
  memberCookieOptions,
  normalizeDisplayName,
  normalizeEmail,
  sha256,
  staffCookieOptions,
  staffTrustCookieOptions,
  validateCsrf,
  validateOrigin,
} from "@gis/auth";
import {
  DataApiExecutor,
  PostgresExecutor,
  Repository,
  type PendingInterview,
  type SqlExecutor,
} from "@gis/db";
import {
  MailpitEmailAdapter,
  SesEmailAdapter,
  magicLinkEmail,
  type EmailAdapter,
} from "@gis/email";
import {
  CONSENT_VERSION,
  addEmailSchema,
  approvalDisclosure,
  changeNameSchema,
  deterministicSearchExplanation,
  emitMetric,
  embeddingVersion,
  groupSchema,
  initialDisclosure,
  interviewResponseSchema,
  loadConfig,
  MANAGEABLE_GROUPS,
  magicLinkRequestSchema,
  pendingProfileSubmissionSchema,
  permissionsFor,
  profileApprovalSchema,
  profileDraftRequestSchema,
  publicConfig,
  reciprocalRankFusion,
  relevanceWithProfileLimitations,
  redeemMagicLinkSchema,
  rerankerOutputSchema,
  sanitizedLog,
  SEARCH_RESULT_LIMIT,
  searchQuerySchema,
  validateGroundedResults,
  type AppConfig,
  type Permission,
  type StaffGroup,
  type SearchPlan,
} from "@gis/shared";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  SecurityStore,
  type MemberSession,
  type StaffSession,
  type StaffTrustedDevice,
} from "./store.js";
import {
  CognitoStaffIdentityProvider,
  CognitoStaffTokenVerifier,
  type StaffAuthStep,
  type StaffIdentityProvider,
  type StaffTokenVerifier,
} from "./staff-auth.js";
import { type CognitoDeviceCredentials } from "./cognito-device-srp.js";

const NEUTRAL_MAGIC_RESPONSE =
  "If the address can receive a Gifts in Service link, an email has been sent.";
const NEW_PROFILE_OPENING =
  "We can take this one piece at a time. What work, practical ability, hobby, or earlier volunteer experience would you like to start with?";
const UPDATE_PROFILE_OPENING =
  "Your current profile is shown above. What has changed, what would you like to add, or what would you like removed?";
const STAFF_PASSWORD_RESET_RESPONSE =
  "If the staff account can be reset, Cognito has sent a verification code.";
const PROTECTED_STAFF_GROUPS: readonly StaffGroup[] = [
  "gis-admin",
  "gis-technical-admin",
];

const staffAuthChallengeSchema = z.enum([
  "NEW_PASSWORD_REQUIRED",
  "SOFTWARE_TOKEN_MFA",
  "MFA_SETUP",
]);
const staffAuthTransactionSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("CHALLENGE"),
    challenge: staffAuthChallengeSchema,
    session: z.string().min(20).max(4096),
    username: z.string().min(1).max(256),
    loginIdentifier: z.string().email().max(254),
    expiresAt: z.string().datetime(),
  }),
  z.object({
    purpose: z.literal("PASSWORD_RESET"),
    username: z.string().min(1).max(256),
    expiresAt: z.string().datetime(),
  }),
]);

type StaffAuthTransaction = z.infer<typeof staffAuthTransactionSchema>;

const cognitoDeviceCredentialsSchema = z.object({
  deviceKey: z.string().min(1).max(55),
  deviceGroupKey: z.string().min(1).max(256),
  deviceSecret: z.string().min(32).max(512),
});

interface ActiveStaffTrustedDevice {
  record: StaffTrustedDevice;
  credentials: CognitoDeviceCredentials;
}

function proposedProfileMessage(profile: string): string {
  return `Here is the proposed profile:

${profile}

If this is accurate enough for authorized staff and ministry leaders to see, select Submit profile or tell me to submit it. To make changes, describe them below.`;
}

function exactLegacyProposal(
  messages: readonly { role: "user" | "assistant"; content: string }[],
  referencedProfile: string | null,
): string | null {
  if (!referencedProfile) return null;
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  return latestAssistant?.content.includes(referencedProfile)
    ? referencedProfile
    : null;
}

function deterministicSearchPlan(query: string): SearchPlan {
  const words =
    query.toLocaleLowerCase("en-US").match(/[a-z0-9+#.-]{3,}/gu) ?? [];
  const stopWords = new Set([
    "about",
    "anyone",
    "could",
    "help",
    "looking",
    "someone",
    "that",
    "their",
    "this",
    "understand",
    "with",
  ]);
  const exactTerms = [
    ...new Set(words.filter((word) => !stopWords.has(word))),
  ].slice(0, 12);
  const cautions: string[] = [];
  if (/audit|license|electric|medical|nurse|children|teacher/iu.test(query))
    cautions.push(
      "Confirm any required current license, professional authority, or church screening separately.",
    );
  return {
    semantic_query: query,
    exact_terms: exactTerms,
    excluded_concepts: /do not|not assume|without/iu.test(query)
      ? ["Do not infer excluded qualifications"]
      : [],
    cautions,
  };
}

function hasProtectedStaffGroup(groups: readonly string[]): boolean {
  return groups.some((group) =>
    PROTECTED_STAFF_GROUPS.includes(group as StaffGroup),
  );
}

function cognitoAttribute(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((attribute) => attribute.Name === name)?.Value;
}

function auditActorUsername(input: {
  actorType: string;
  actorId: string;
  resolvedUsername: string | undefined;
  localDevelopment: boolean;
}): string {
  if (input.resolvedUsername) return input.resolvedUsername;
  if (input.actorType !== "STAFF") return input.actorType;
  if (input.localDevelopment && input.actorId.startsWith("fake:"))
    return `Local ${input.actorId.slice("fake:".length).replaceAll("+", ", ")}`;
  return "Former staff account";
}

export interface AppDependencies {
  surface: "all" | "public" | "staff";
  config: AppConfig;
  executor: SqlExecutor;
  ai: AiAdapter;
  email: EmailAdapter;
  now: () => Date;
  staffIdentityProvider: StaffIdentityProvider;
  staffTokenVerifier: StaffTokenVerifier;
  cognito: Pick<CognitoIdentityProviderClient, "send">;
}

function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  const safeName = [error.name, error.constructor.name].find(
    (candidate) =>
      candidate !== "Error" &&
      /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/u.test(candidate),
  );
  return safeName ?? "Error";
}

function safeEmailErrorReason(error: unknown): string {
  if (!(error instanceof Error)) return "UNCLASSIFIED";
  if (/configuration-set\//u.test(error.message))
    return "CONFIGURATION_SET_ACCESS_DENIED";
  if (/identity\//u.test(error.message)) return "IDENTITY_ACCESS_DENIED";
  if (/not verified/iu.test(error.message)) return "IDENTITY_NOT_VERIFIED";
  if (/not authorized|access denied/iu.test(error.message))
    return "SES_ACCESS_DENIED";
  return "UNCLASSIFIED";
}

function setNoStore(reply: FastifyReply): void {
  reply
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer");
}

function protectStaffAuthTransaction(
  transaction: StaffAuthTransaction,
  key: string,
): string {
  return encryptShortLivedSecret(JSON.stringify(transaction), key);
}

function readStaffAuthTransaction(
  protectedTransaction: string,
  key: string,
  current: Date,
): StaffAuthTransaction | null {
  try {
    const transaction = staffAuthTransactionSchema.parse(
      JSON.parse(decryptShortLivedSecret(protectedTransaction, key)),
    );
    return new Date(transaction.expiresAt) > current ? transaction : null;
  } catch {
    return null;
  }
}

function staffAuthFailure(error: unknown): {
  status: number;
  message: string;
} {
  const kind = errorClass(error);
  if (["NotAuthorizedException", "UserNotFoundException"].includes(kind))
    return { status: 401, message: "The email or password was not accepted." };
  if (kind === "PasswordResetRequiredException")
    return {
      status: 409,
      message: "A password reset is required. Select Forgot password.",
    };
  if (
    [
      "CodeMismatchException",
      "EnableSoftwareTokenMFAException",
      "CognitoTotpVerificationFailed",
    ].includes(kind)
  )
    return {
      status: 400,
      message: "The verification code was not accepted.",
    };
  if (kind === "ExpiredCodeException")
    return {
      status: 400,
      message: "This verification code has expired. Start again.",
    };
  if (kind === "InvalidPasswordException")
    return {
      status: 400,
      message: "The new password does not meet the password requirements.",
    };
  if (["TooManyRequestsException", "LimitExceededException"].includes(kind))
    return {
      status: 429,
      message: "Too many sign-in attempts. Please wait and try again.",
    };
  return {
    status: 503,
    message: "Staff sign-in is temporarily unavailable.",
  };
}

export async function buildApp(
  overrides: Partial<AppDependencies> = {},
): Promise<FastifyInstance> {
  const surface = overrides.surface ?? "all";
  const publicOnly =
    process.env.GIS_API_SURFACE === "public" ||
    (process.env.GIS_API_SURFACE === undefined && surface === "public");
  const staffOnly =
    process.env.GIS_API_SURFACE === "staff" ||
    (process.env.GIS_API_SURFACE === undefined && surface === "staff");
  const config = overrides.config ?? loadConfig();
  const executor: SqlExecutor =
    overrides.executor ??
    (config.APP_ENV === "prod" &&
    config.RDS_RESOURCE_ARN &&
    config.RDS_SECRET_ARN
      ? new DataApiExecutor({
          resourceArn: config.RDS_RESOURCE_ARN,
          secretArn: config.RDS_SECRET_ARN,
          database: config.RDS_DATABASE,
          region: config.AWS_REGION,
        })
      : new PostgresExecutor(config.DATABASE_URL));
  const repository = new Repository(executor);
  const security = new SecurityStore(executor);
  const prompts =
    config.AI_ADAPTER === "bedrock" && !overrides.ai
      ? await loadPromptBundle()
      : null;
  const ai =
    overrides.ai ??
    (prompts
      ? new BedrockAiAdapter({
          region: config.AWS_REGION,
          interviewModelId: config.INTERVIEW_MODEL_ID,
          searchModelId: config.SEARCH_MODEL_ID,
          embeddingModelId: config.EMBEDDING_MODEL_ID,
          guardrailId: config.BEDROCK_GUARDRAIL_ID,
          guardrailVersion: config.BEDROCK_GUARDRAIL_VERSION,
          interviewerPrompt: prompts.interviewer,
          profileDrafterPrompt: prompts.profileDrafter,
          searchPlannerPrompt: prompts.searchPlanner,
          searchRerankerPrompt: prompts.searchReranker,
        })
      : new FakeAiAdapter());
  const email =
    overrides.email ??
    (staffOnly
      ? ({
          send: () => Promise.reject(new Error("EmailUnavailableOnStaffApi")),
        } satisfies EmailAdapter)
      : config.EMAIL_ADAPTER === "ses"
        ? new SesEmailAdapter(
            config.AWS_REGION,
            config.SES_FROM_ADDRESS,
            config.SES_CONFIGURATION_SET,
          )
        : new MailpitEmailAdapter(config.MAILPIT_SMTP_URL));
  const now = overrides.now ?? (() => new Date());
  const staffIdentityProvider =
    overrides.staffIdentityProvider ??
    (publicOnly
      ? ({
          startPasswordSignIn: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
          respondToChallenge: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
          requestPasswordReset: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
          confirmPasswordReset: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
          confirmTrustedDevice: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
          forgetTrustedDevice: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
        } satisfies StaffIdentityProvider)
      : new CognitoStaffIdentityProvider({
          region: config.AWS_REGION,
          userPoolId: config.COGNITO_USER_POOL_ID,
          clientId: config.COGNITO_CLIENT_ID,
          clientSecret: config.COGNITO_CLIENT_SECRET,
        }));
  const staffTokenVerifier =
    overrides.staffTokenVerifier ??
    (publicOnly
      ? ({
          verify: () =>
            Promise.reject(new Error("StaffIdentityUnavailableOnPublicApi")),
        } satisfies StaffTokenVerifier)
      : new CognitoStaffTokenVerifier({
          region: config.AWS_REGION,
          userPoolId: config.COGNITO_USER_POOL_ID,
          clientId: config.COGNITO_CLIENT_ID,
        }));
  const cognito =
    overrides.cognito ??
    (publicOnly
      ? ({
          send: () =>
            Promise.reject(new Error("CognitoUnavailableOnPublicApi")),
        } satisfies Pick<CognitoIdentityProviderClient, "send">)
      : new CognitoIdentityProviderClient({
          region: config.AWS_REGION,
          maxAttempts: 3,
        }));
  async function listCognitoUsers(): Promise<UserType[]> {
    const users: UserType[] = [];
    let paginationToken: string | undefined;
    do {
      const listed = await cognito.send(
        new ListUsersCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          Limit: 60,
          ...(paginationToken ? { PaginationToken: paginationToken } : {}),
        }),
      );
      users.push(...(listed.Users ?? []));
      paginationToken = listed.PaginationToken;
    } while (paginationToken && users.length < 600);
    return users;
  }
  async function cognitoAccessTarget(
    subject: string,
  ): Promise<{ username: string; groups: string[] } | null> {
    const found = await cognito.send(
      new ListUsersCommand({
        UserPoolId: config.COGNITO_USER_POOL_ID,
        Filter: `sub = "${subject}"`,
        Limit: 1,
      }),
    );
    const username = found.Users?.[0]?.Username;
    if (!username) return null;
    const memberships = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: config.COGNITO_USER_POOL_ID,
        Username: username,
      }),
    );
    return {
      username,
      groups: (memberships.Groups ?? [])
        .map((group) => group.GroupName)
        .filter((group): group is string => Boolean(group)),
    };
  }

  async function forgetCognitoDevices(
    devices: readonly { cognitoUsername: string; deviceKey: string }[],
  ): Promise<void> {
    if (config.STAFF_AUTH_ADAPTER !== "cognito") return;
    await Promise.allSettled(
      devices.map((device) =>
        staffIdentityProvider.forgetTrustedDevice(
          device.cognitoUsername,
          device.deviceKey,
        ),
      ),
    );
  }

  async function revokeTrustedDevicesForSubject(
    subject: string,
    current: Date,
  ): Promise<number> {
    const revoked = await security.revokeStaffTrustedDevicesForSubject(
      subject,
      current,
    );
    await forgetCognitoDevices(revoked);
    return revoked.length;
  }

  async function activeTrustedDevice(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ActiveStaffTrustedDevice | null> {
    const raw = request.cookies[STAFF_TRUST_COOKIE];
    if (!raw) return null;
    const trustHash = keyedHash(raw, config.SESSION_HMAC_KEY);
    const record = await security.getStaffTrustedDevice(trustHash);
    const current = now();
    if (!record || record.revokedAt || record.expiresAt <= current) {
      if (record && !record.revokedAt) {
        const revoked = await security.revokeStaffTrustedDevice(
          trustHash,
          current,
        );
        if (revoked) await forgetCognitoDevices([revoked]);
      }
      reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
      return null;
    }
    try {
      const credentials = cognitoDeviceCredentialsSchema.parse(
        JSON.parse(
          decryptShortLivedSecret(
            record.credentialsCiphertext,
            `${config.SESSION_HMAC_KEY}:staff-trusted-device:v1`,
          ),
        ),
      );
      if (
        credentials.deviceKey !== record.deviceKey ||
        credentials.deviceGroupKey !== record.deviceGroupKey
      )
        throw new Error("TrustedDeviceMetadataMismatch");
      return { record, credentials };
    } catch {
      const revoked = await security.revokeStaffTrustedDevice(
        trustHash,
        current,
      );
      if (revoked) await forgetCognitoDevices([revoked]);
      reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
      return null;
    }
  }
  const requestStarts = new WeakMap<FastifyRequest, number>();
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    genReqId: () => randomUUID(),
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(rateLimit, { global: false, ban: 3 });

  app.addHook("onResponse", (request, reply, done) => {
    const started = requestStarts.get(request);
    const durationMs = typeof started === "number" ? Date.now() - started : 0;
    process.stdout.write(
      `${JSON.stringify(sanitizedLog({ correlationId: request.id, route: request.routeOptions.url ?? "unknown", status: reply.statusCode, durationMs }))}\n`,
    );
    const route = request.routeOptions.url ?? "unknown";
    emitMetric("ApiRequests", 1, "Count", route);
    emitMetric("ApiLatency", durationMs, "Milliseconds", route);
    if (reply.statusCode >= 500) emitMetric("ApiErrors", 1, "Count", route);
    if (reply.statusCode === 401)
      emitMetric("AuthenticationFailures", 1, "Count", "SecurityRejection");
    if (reply.statusCode === 403)
      emitMetric("AuthorizationDenials", 1, "Count", "SecurityRejection");
    if (reply.statusCode === 429)
      emitMetric("RateLimitRejections", 1, "Count", "SecurityRejection");
    const actionMetrics: Record<string, string> = {
      "/api/public/magic-links": "MagicLinkRequests",
      "/api/public/magic-links/redeem": "MagicLinkRedemptions",
      "/api/member/interview/message": "InterviewInvocations",
      "/api/member/interview/submit": "ProfileApprovals",
      "/api/member/profile/approve": "ProfileApprovals",
      "/api/member/profile/verify": "ProfileVerifications",
      "/api/member/profile/pause": "ProfilePauses",
      "/api/member/profile": "ProfileDeletions",
      "/api/staff/search": "StaffSearches",
      "/api/staff/profiles/:id": "StaffProfileOpens",
    };
    const actionMetric = actionMetrics[route];
    if (actionMetric && reply.statusCode < 400)
      emitMetric(actionMetric, 1, "Count", route);
    done();
  });
  app.addHook("onRequest", (request, _reply, done) => {
    requestStarts.set(request, Date.now());
    done();
  });
  app.addHook("onRequest", (request, reply, done) => {
    if (
      config.APP_ENV === "prod" &&
      !constantTimeEqual(
        String(request.headers["x-gis-origin-verify"] ?? ""),
        config.ORIGIN_VERIFY_SECRET,
      )
    ) {
      void reply
        .status(403)
        .send({ error: "Direct API access is not allowed." });
      return;
    }
    done();
  });
  app.addHook("onRequest", (request, reply, done) => {
    if (surface === "all") {
      done();
      return;
    }
    const path = request.url.split("?", 1)[0] ?? "";
    const allowed =
      surface === "public"
        ? path === "/api/config" ||
          path.startsWith("/api/public/") ||
          path.startsWith("/api/member/")
        : path.startsWith("/api/staff/") || path.startsWith("/api/technical/");
    if (!allowed) {
      void reply.status(404).send({ error: "Not found." });
      return;
    }
    done();
  });
  app.setErrorHandler((error, request, reply) => {
    const suppliedStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const status =
      error instanceof AiSafetyInterventionError
        ? 422
        : error instanceof AiMalformedInterviewResponseError ||
            error instanceof AiMalformedProfileDraftResponseError
          ? 502
          : error instanceof z.ZodError
            ? 400
            : (suppliedStatus ?? 500);
    process.stderr.write(
      `${JSON.stringify(sanitizedLog({ correlationId: request.id, route: request.routeOptions.url ?? "unknown", status, durationMs: 0, errorClass: errorClass(error) }))}\n`,
    );
    void reply.status(status).send({
      error:
        error instanceof AiSafetyInterventionError ||
        error instanceof AiMalformedInterviewResponseError ||
        error instanceof AiMalformedProfileDraftResponseError
          ? error.message
          : status === 400
            ? "The request was not valid."
            : "The request could not be completed.",
      correlationId: request.id,
    });
  });

  function checkOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (!validateOrigin(request.headers.origin, config.ALLOWED_ORIGINS)) {
      void reply.status(403).send({ error: "Origin validation failed." });
      return false;
    }
    return true;
  }

  async function memberSession(
    request: FastifyRequest,
    reply: FastifyReply,
    requireCsrf = false,
  ): Promise<MemberSession | null> {
    const raw = request.cookies[MEMBER_COOKIE];
    if (!raw) {
      void reply
        .status(401)
        .send({ error: "Your member session has expired." });
      return null;
    }
    const current = now();
    const session = await security.getMemberSession(
      keyedHash(raw, config.SESSION_HMAC_KEY),
      current,
    );
    if (!session) {
      void reply
        .clearCookie(MEMBER_COOKIE, { path: "/" })
        .status(401)
        .send({ error: "Your member session has expired." });
      return null;
    }
    if (
      requireCsrf &&
      (!checkOrigin(request, reply) ||
        !validateCsrf(
          request.headers["x-csrf-token"] as string | undefined,
          session.csrfHash,
          config.SESSION_HMAC_KEY,
        ))
    ) {
      if (!reply.sent)
        void reply.status(403).send({ error: "CSRF validation failed." });
      return null;
    }
    reply.setCookie(
      MEMBER_COOKIE,
      raw,
      memberCookieOptions(
        Math.max(
          1,
          Math.floor(
            (session.absoluteExpiresAt.getTime() - current.getTime()) / 1000,
          ),
        ),
      ),
    );
    return session;
  }

  async function staffSession(
    request: FastifyRequest,
    reply: FastifyReply,
    permission?: Permission,
    requireCsrf = false,
  ): Promise<StaffSession | null> {
    const raw = request.cookies[STAFF_COOKIE];
    if (!raw) {
      void reply.status(401).send({ error: "Staff sign-in is required." });
      return null;
    }
    const session = await security.getStaffSession(
      keyedHash(raw, config.SESSION_HMAC_KEY),
      now(),
    );
    if (!session) {
      void reply
        .clearCookie(STAFF_COOKIE, { path: "/" })
        .status(401)
        .send({ error: "The staff session has expired." });
      return null;
    }
    if (permission && !session.permissions.includes(permission)) {
      void reply
        .status(403)
        .send({ error: "This staff role does not permit that action." });
      return null;
    }
    if (
      requireCsrf &&
      (!checkOrigin(request, reply) ||
        !validateCsrf(
          request.headers["x-csrf-token"] as string | undefined,
          session.csrfHash,
          config.SESSION_HMAC_KEY,
        ))
    ) {
      if (!reply.sent)
        void reply.status(403).send({ error: "CSRF validation failed." });
      return null;
    }
    return session;
  }

  async function saveExactProfile(input: {
    session: MemberSession;
    exactText: string;
    current: Date;
    expectedPendingRevision?: number;
    expectedProposedProfile?: string;
    embedding?: readonly number[];
  }): Promise<boolean> {
    const embedding =
      input.embedding ??
      (await ai.embed(input.exactText, config.EMBEDDING_DIMENSION));
    const saved = await repository.saveApprovedProfile({
      personId: input.session.personId!,
      exactText: input.exactText,
      sha256: sha256(input.exactText),
      embedding,
      embeddingModelId: config.EMBEDDING_MODEL_ID,
      embeddingVersion: embeddingVersion(
        config.AI_ADAPTER,
        config.EMBEDDING_MODEL_ID,
        config.EMBEDDING_DIMENSION,
      ),
      promptVersion: PROMPT_VERSIONS.profileDrafter,
      consentVersion: CONSENT_VERSION,
      now: input.current,
      ...(input.expectedPendingRevision === undefined
        ? {}
        : { expectedPendingRevision: input.expectedPendingRevision }),
      ...(input.expectedProposedProfile === undefined
        ? {}
        : { expectedProposedProfile: input.expectedProposedProfile }),
    });
    if (saved && input.session.verificationCycleId) {
      await executor.query(
        `UPDATE magic_link_tokens SET superseded_at = $2
         WHERE verification_cycle_id = $1::uuid AND used_at IS NULL AND superseded_at IS NULL`,
        [input.session.verificationCycleId, input.current],
      );
    }
    return saved;
  }

  function effectiveRoleSafetyConcerns(
    pending: PendingInterview,
    currentProfile: string | null,
  ) {
    return mergeRoleSafetyConcerns(
      pending.roleSafetyConcerns,
      deriveRoleSafetyConcerns(pending.messages, currentProfile),
    );
  }

  function exactProfileSafetyFinding(
    text: string,
    pending: PendingInterview,
    currentProfile: string | null,
  ) {
    return (
      validateProposedProfile(text) ??
      validateRequiredRoleSafetyStatements(
        text,
        effectiveRoleSafetyConcerns(pending, currentProfile),
      )
    );
  }

  async function reconcileRoleSafetyConcerns(
    personId: string,
    pending: PendingInterview,
    currentProfile: string | null,
    current: Date,
  ): Promise<PendingInterview> {
    const concerns = effectiveRoleSafetyConcerns(pending, currentProfile);
    const messages = sanitizePendingHealthMessages(pending.messages);
    const followUpNotes = pending.followUpNotes.filter(
      (note) => validateProposedProfile(note) === null,
    );
    const conversationMemory = {
      establishedFacts: pending.conversationMemory.establishedFacts.filter(
        (fact) => validateProposedProfile(fact) === null,
      ),
      closedTopics: pending.conversationMemory.closedTopics.filter(
        (topic) => validateProposedProfile(topic) === null,
      ),
    };
    const proposalMustBeInvalidated =
      pending.proposedProfile !== null &&
      (concerns.length > pending.roleSafetyConcerns.length ||
        validateProposedProfile(pending.proposedProfile) !== null ||
        validateRequiredRoleSafetyStatements(
          pending.proposedProfile,
          concerns,
        ) !== null);
    const reconciledMessages =
      proposalMustBeInvalidated && pending.proposedProfile
        ? messages.map((message) =>
            message.role === "assistant" &&
            message.content.includes(pending.proposedProfile!)
              ? {
                  ...message,
                  content:
                    "The previous proposed profile was withdrawn because it requires a privacy or role-safety revision. Please create a new proposal before submitting.",
                }
              : message,
          )
        : messages;
    const changed =
      concerns.length !== pending.roleSafetyConcerns.length ||
      reconciledMessages.some(
        (message, index) =>
          message.content !== pending.messages[index]?.content,
      ) ||
      followUpNotes.length !== pending.followUpNotes.length ||
      conversationMemory.establishedFacts.length !==
        pending.conversationMemory.establishedFacts.length ||
      conversationMemory.closedTopics.length !==
        pending.conversationMemory.closedTopics.length ||
      proposalMustBeInvalidated;
    if (!changed) return pending;
    const revision = await repository.updatePendingInterview({
      personId,
      expectedRevision: pending.revision,
      messages: reconciledMessages,
      completenessConfidence: pending.completenessConfidence,
      followUpNotes,
      conversationMemory,
      roleSafetyConcerns: concerns,
      ...(proposalMustBeInvalidated ? { proposedProfile: null } : {}),
      now: current,
    });
    if (revision === null) {
      const refreshed = await repository.getPendingInterview(personId, current);
      if (!refreshed) throw new Error("PendingInterviewSafetyReconcileFailed");
      return refreshed;
    }
    return {
      ...pending,
      messages: reconciledMessages,
      proposedProfile: proposalMustBeInvalidated
        ? null
        : pending.proposedProfile,
      followUpNotes,
      conversationMemory,
      roleSafetyConcerns: concerns,
      revision,
      updatedAt: current,
    };
  }

  if (process.env.GIS_API_SURFACE !== "staff") {
    app.get("/api/config", async (_request, reply) => {
      setNoStore(reply);
      return {
        ...publicConfig(config),
        disclosure: initialDisclosure,
        approvalDisclosure,
        staffAuthMode:
          config.STAFF_AUTH_ADAPTER === "cognito" ? "cognito" : "fake",
      };
    });
  }

  if (process.env.GIS_API_SURFACE !== "public") {
    app.get("/api/technical/health", async (request, reply) => {
      const session = await staffSession(request, reply, "technical:read");
      if (!session) return;
      await executor.query("SELECT 1 AS healthy");
      return {
        status: "ok",
        version: "0.1.0",
        environment: config.APP_ENV,
        correlationId: request.id,
      };
    });
  }

  if (process.env.GIS_API_SURFACE !== "staff") {
    app.post(
      "/api/public/magic-links",
      { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (!checkOrigin(request, reply)) return;
        const body = magicLinkRequestSchema.parse(request.body);
        const normalized = normalizeEmail(body.email);
        const emailHash = keyedHash(normalized, config.MAGIC_LINK_HMAC_KEY);
        const networkHash = keyedHash(request.ip, config.MAGIC_LINK_HMAC_KEY);
        const current = now();
        if (
          (await security.recentMagicRequests(
            emailHash,
            networkHash,
            new Date(current.getTime() - 60 * 60 * 1000),
          )) >= 5
        ) {
          return reply.status(202).send({ message: NEUTRAL_MAGIC_RESPONSE });
        }
        const token = generateOpaqueSecret(config.MAGIC_LINK_HMAC_KEY);
        const expiresAt = new Date(current.getTime() + 15 * 60 * 1000);
        await security.insertMagicToken({
          tokenHash: token.hash,
          purpose: "LOGIN_OR_CREATE",
          personId: null,
          normalizedEmail: normalized,
          displayEmail: body.email,
          pendingDisplayName: null,
          consentVersion: null,
          abuseEmailHash: emailHash,
          abuseNetworkHash: networkHash,
          expiresAt,
        });
        const contents = magicLinkEmail({
          appName: config.APP_DISPLAY_NAME,
          magicLink: `${config.PUBLIC_BASE_URL}/magic#token=${token.raw}`,
          expiresAt,
        });
        try {
          await email.send({
            ...contents,
            to: body.email,
            idempotencyKey: token.hash,
          });
        } catch (error) {
          process.stderr.write(
            `${JSON.stringify({ correlationId: request.id, route: "/api/public/magic-links", errorClass: errorClass(error), errorReason: safeEmailErrorReason(error) })}\n`,
          );
        }
        return reply.status(202).send({ message: NEUTRAL_MAGIC_RESPONSE });
      },
    );

    app.post(
      "/api/public/magic-links/redeem",
      { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (!checkOrigin(request, reply)) return;
        const body = redeemMagicLinkSchema.parse(request.body);
        const redeemed = await security.redeemMagicToken(
          keyedHash(body.token, config.MAGIC_LINK_HMAC_KEY),
          now(),
        );
        if (!redeemed || redeemed.purpose === "ADD_EMAIL")
          return reply
            .status(410)
            .send({ error: "This link is expired or has already been used." });
        const sessionSecret = generateOpaqueSecret(config.SESSION_HMAC_KEY);
        const csrf = generateOpaqueSecret(config.SESSION_HMAC_KEY);
        await security.createMemberSession({
          sessionHash: sessionSecret.hash,
          mailboxEmail: redeemed.personId ? null : redeemed.normalizedEmail,
          mailboxDisplayEmail: redeemed.personId ? null : redeemed.displayEmail,
          personId: redeemed.personId,
          csrfHash: csrf.hash,
          now: now(),
          verificationCycleId: redeemed.verificationCycleId,
        });
        reply.setCookie(
          MEMBER_COOKIE,
          sessionSecret.raw,
          memberCookieOptions(),
        );
        const profiles = redeemed.personId
          ? []
          : await repository.profilesForMailbox(redeemed.normalizedEmail);
        return {
          scope: redeemed.personId ? "person" : "mailbox",
          profiles,
          pendingDisplayName: redeemed.pendingDisplayName,
          csrfToken: csrf.raw,
        };
      },
    );

    app.get("/api/member/session", async (request, reply) => {
      setNoStore(reply);
      const session = await memberSession(request, reply);
      if (!session) return;
      const csrf = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      await security.rotateMemberCsrf(session.sessionHash, csrf.hash);
      const person = session.personId
        ? await repository.getPerson(session.personId)
        : null;
      const profiles = session.mailboxEmail
        ? await repository.profilesForMailbox(session.mailboxEmail)
        : [];
      const emails = session.personId
        ? await repository.emails(session.personId)
        : [];
      return { person, profiles, emails, csrfToken: csrf.raw };
    });

    app.post("/api/member/profiles/select", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.mailboxEmail) return;
      const body = z
        .object({ personId: z.string().uuid() })
        .parse(request.body);
      if (
        !(await security.selectMemberPerson(
          session.sessionHash,
          body.personId,
          session.mailboxEmail,
        ))
      ) {
        return reply.status(403).send({
          error: "That profile is not associated with this verified mailbox.",
        });
      }
      const person = await repository.getPerson(body.personId);
      return { selected: true, currentProfile: person?.approvedText ?? null };
    });

    app.post("/api/member/profiles/create", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.mailboxEmail) return;
      const body = z
        .object({
          displayName: z.string().trim().min(1).max(100),
          adultConfirmed: z.literal(true),
          disclosureAcknowledged: z.literal(true),
          consentVersion: z.literal(CONSENT_VERSION),
        })
        .parse(request.body);
      const personId = await repository.createPerson({
        displayName: body.displayName,
        normalizedDisplayName: normalizeDisplayName(body.displayName),
        displayEmail: session.mailboxDisplayEmail ?? session.mailboxEmail,
        normalizedEmail: session.mailboxEmail,
        consentVersion: body.consentVersion,
        now: now(),
      });
      if (
        !(await security.selectMemberPerson(
          session.sessionHash,
          personId,
          session.mailboxEmail,
        ))
      )
        throw new Error("NewPersonSelectionFailed");
      return { personId };
    });

    app.post("/api/member/interview/start", async (request, reply) => {
      setNoStore(reply);
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      z.object({}).parse(request.body ?? {});
      const person = await repository.getPerson(session.personId);
      if (!person)
        return reply.status(404).send({ error: "The profile was not found." });
      const started = await repository.startPendingInterview({
        personId: session.personId,
        openingMessage: person.approvedText
          ? UPDATE_PROFILE_OPENING
          : NEW_PROFILE_OPENING,
        initialCompletenessConfidence: person.approvedText ? "MODERATE" : "LOW",
        initialRoleSafetyConcerns: deriveRoleSafetyConcerns(
          [],
          person.approvedText,
        ),
        now: now(),
      });
      const pending = await reconcileRoleSafetyConcerns(
        session.personId,
        started,
        person.approvedText,
        now(),
      );
      return {
        messages: pending.messages,
        proposedProfile: pending.proposedProfile,
        completenessConfidence: pending.completenessConfidence,
        revision: pending.revision,
        currentProfile: person.approvedText,
        startedAt: pending.startedAt,
        expiresAt: pending.expiresAt,
      };
    });

    app.post(
      "/api/member/interview/message",
      { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        const session = await memberSession(request, reply, true);
        if (!session?.personId) return;
        const body = interviewResponseSchema.parse(request.body);
        const current = now();
        const pending = await repository.getPendingInterview(
          session.personId,
          current,
        );
        if (!pending)
          return reply.status(409).send({
            error:
              "This pending interview has expired. Reload the page to begin again.",
          });
        if (pending.revision !== body.revision)
          return reply.status(409).send({
            error:
              "This interview changed in another tab. Reload the page to continue with the latest version.",
          });
        const highRiskInput = detectHighRiskInput(body.response);
        if (highRiskInput)
          return reply.status(422).send({ error: highRiskInput.message });
        const person = await repository.getPerson(session.personId);
        const priorRoleSafetyConcerns = effectiveRoleSafetyConcerns(
          pending,
          person?.approvedText ?? null,
        );
        const detectedRoleSafetyConcerns = detectRoleSafetyConcerns(
          body.response,
        );
        const roleSafetyConcerns = mergeRoleSafetyConcerns(
          priorRoleSafetyConcerns,
          detectedRoleSafetyConcerns,
        );
        const privateHealthInput = detectPrivateHealthInput(body.response);
        if (privateHealthInput) {
          const responseMessage =
            detectedRoleSafetyConcerns.length > 0
              ? roleSafetyConcernAcknowledgement(
                  detectedRoleSafetyConcerns,
                  true,
                )
              : PRIVATE_HEALTH_FOLLOW_UP_MESSAGE;
          const messages = [
            ...pending.messages,
            {
              role: "user" as const,
              content: PRIVATE_HEALTH_OMITTED_TRANSCRIPT_MESSAGE,
            },
            {
              role: "assistant" as const,
              content: responseMessage,
            },
          ];
          const revision = await repository.updatePendingInterview({
            personId: session.personId,
            expectedRevision: pending.revision,
            messages,
            completenessConfidence: pending.completenessConfidence,
            followUpNotes: pending.followUpNotes,
            conversationMemory: pending.conversationMemory,
            roleSafetyConcerns,
            ...(pending.proposedProfile === null
              ? {}
              : { proposedProfile: null }),
            now: current,
          });
          if (revision === null)
            return reply.status(409).send({
              error:
                "This interview changed in another tab. Reload the page to continue with the latest version.",
            });
          emitMetric(
            "PrivateHealthInputsOmitted",
            1,
            "Count",
            "InterviewDecision",
          );
          return {
            saved: false,
            deletionRequested: false,
            message: responseMessage,
            revision,
            proposedProfile: null,
            completenessConfidence: pending.completenessConfidence,
            expiresAt: pending.expiresAt,
            promptVersion: PROMPT_VERSIONS.interviewer,
          };
        }
        if (detectedRoleSafetyConcerns.length > 0) {
          const responseMessage = roleSafetyConcernAcknowledgement(
            detectedRoleSafetyConcerns,
          );
          const messages = [
            ...pending.messages,
            { role: "user" as const, content: body.response },
            { role: "assistant" as const, content: responseMessage },
          ];
          const revision = await repository.updatePendingInterview({
            personId: session.personId,
            expectedRevision: pending.revision,
            messages,
            completenessConfidence: pending.completenessConfidence,
            followUpNotes: pending.followUpNotes,
            conversationMemory: pending.conversationMemory,
            roleSafetyConcerns,
            ...(pending.proposedProfile === null
              ? {}
              : { proposedProfile: null }),
            now: current,
          });
          if (revision === null)
            return reply.status(409).send({
              error:
                "This interview changed in another tab. Reload the page to continue with the latest version.",
            });
          emitMetric(
            "RoleSafetyConcernsPreserved",
            1,
            "Count",
            "InterviewDecision",
          );
          return {
            saved: false,
            deletionRequested: false,
            message: responseMessage,
            revision,
            proposedProfile: null,
            completenessConfidence: pending.completenessConfidence,
            expiresAt: pending.expiresAt,
            promptVersion: PROMPT_VERSIONS.interviewer,
          };
        }
        const messages = [
          ...pending.messages,
          { role: "user" as const, content: body.response },
        ];
        const turn = await ai.interview(
          sanitizeProfileDraftMessages(messages),
          {
            hasProposedProfile: pending.proposedProfile !== null,
            previousCompletenessConfidence: pending.completenessConfidence,
            previousFollowUpNotes: pending.followUpNotes,
            previousConversationMemory: pending.conversationMemory,
            currentProfile: person?.approvedText ?? null,
          },
        );
        const completenessConfidence =
          turn.follow_up_notes.length > 0
            ? "LOW"
            : turn.completeness_confidence;
        if (turn.action === "SUBMIT_PROFILE") {
          const exactProfile =
            pending.proposedProfile ??
            exactLegacyProposal(messages, turn.referenced_profile_text);
          if (exactProfile) {
            const safety = exactProfileSafetyFinding(
              exactProfile,
              pending,
              person?.approvedText ?? null,
            );
            if (safety)
              return reply
                .status(422)
                .send({ error: safety.message, requiresRevision: true });
            const saved = await saveExactProfile({
              session,
              exactText: exactProfile,
              current,
              expectedPendingRevision: pending.revision,
              ...(pending.proposedProfile
                ? { expectedProposedProfile: pending.proposedProfile }
                : {}),
            });
            if (!saved)
              return reply.status(409).send({
                error:
                  "This interview changed in another tab. Reload the page before submitting.",
              });
            emitMetric("ProfileApprovals", 1, "Count", "SemanticSubmission");
            return { saved: true };
          }
        }
        let proposedProfile = pending.proposedProfile;
        let message = turn.message;
        if (turn.invalidate_proposed_profile) proposedProfile = null;
        if (turn.action === "REQUEST_PROFILE_DELETION") {
          proposedProfile = null;
          message ||=
            "I will take you to the deletion confirmation. Nothing will be deleted until you explicitly confirm it there.";
        }
        if (
          turn.action === "PROPOSE_PROFILE" ||
          turn.action === "SUBMIT_PROFILE"
        ) {
          const draft = await ai.draft(
            messages,
            person?.approvedText ?? undefined,
          );
          const exactDraft = applyRequiredRoleSafetyStatements(
            draft.profile_text,
            roleSafetyConcerns,
          );
          const safety =
            validateProposedProfile(exactDraft) ??
            validateRequiredRoleSafetyStatements(
              exactDraft,
              roleSafetyConcerns,
            );
          if (safety)
            return reply
              .status(422)
              .send({ error: safety.message, requiresRevision: true });
          proposedProfile = exactDraft;
          message = proposedProfileMessage(proposedProfile);
        }
        const revision = await repository.updatePendingInterview({
          personId: session.personId,
          expectedRevision: pending.revision,
          messages: [
            ...messages,
            { role: "assistant" as const, content: message },
          ],
          completenessConfidence,
          followUpNotes: turn.follow_up_notes,
          conversationMemory: turn.conversation_memory,
          roleSafetyConcerns,
          ...(proposedProfile !== pending.proposedProfile
            ? { proposedProfile }
            : {}),
          now: current,
        });
        if (revision === null)
          return reply.status(409).send({
            error:
              "This interview changed in another tab. Reload the page to continue with the latest version.",
          });
        return {
          saved: false,
          deletionRequested: turn.action === "REQUEST_PROFILE_DELETION",
          message,
          revision,
          proposedProfile,
          completenessConfidence,
          expiresAt: pending.expiresAt,
          promptVersion: PROMPT_VERSIONS.interviewer,
        };
      },
    );

    app.post("/api/member/interview/submit", async (request, reply) => {
      setNoStore(reply);
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const body = pendingProfileSubmissionSchema.parse(request.body);
      const current = now();
      const pending = await repository.getPendingInterview(
        session.personId,
        current,
      );
      if (
        !pending ||
        pending.revision !== body.revision ||
        !pending.proposedProfile
      )
        return reply.status(409).send({
          error:
            "The proposed profile is expired or changed in another tab. Reload the conversation before submitting.",
        });
      const person = await repository.getPerson(session.personId);
      const safety = exactProfileSafetyFinding(
        pending.proposedProfile,
        pending,
        person?.approvedText ?? null,
      );
      if (safety)
        return reply
          .status(422)
          .send({ error: safety.message, requiresRevision: true });
      const saved = await saveExactProfile({
        session,
        exactText: pending.proposedProfile,
        current,
        expectedPendingRevision: pending.revision,
        expectedProposedProfile: pending.proposedProfile,
      });
      if (!saved)
        return reply.status(409).send({
          error:
            "The conversation changed in another tab. Reload it before submitting.",
        });
      return { saved: true };
    });

    app.post("/api/member/interview/draft", async (request, reply) => {
      setNoStore(reply);
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const body = profileDraftRequestSchema.parse(request.body);
      const pending = await repository.getPendingInterview(
        session.personId,
        now(),
      );
      if (!pending || pending.revision !== body.revision)
        return reply.status(409).send({
          error:
            "This interview is expired or changed in another tab. Reload the conversation before creating a draft.",
        });
      if (!pending.messages.some((message) => message.role === "user"))
        return reply.status(400).send({
          error: "Answer at least one question before creating a draft.",
        });
      const person = await repository.getPerson(session.personId);
      const draft = await ai.draft(
        pending.messages,
        person?.approvedText ?? undefined,
      );
      const roleSafetyConcerns = effectiveRoleSafetyConcerns(
        pending,
        person?.approvedText ?? null,
      );
      const exactDraft = applyRequiredRoleSafetyStatements(
        draft.profile_text,
        roleSafetyConcerns,
      );
      const safety =
        validateProposedProfile(exactDraft) ??
        validateRequiredRoleSafetyStatements(exactDraft, roleSafetyConcerns);
      if (safety)
        return reply
          .status(422)
          .send({ error: safety.message, requiresRevision: true });
      const approval = generateOpaqueSecret(config.MAGIC_LINK_HMAC_KEY);
      await security.insertApprovalToken({
        tokenHash: approval.hash,
        personId: session.personId,
        sessionHash: session.sessionHash,
        approvedTextSha256: sha256(exactDraft),
        consentVersion: CONSENT_VERSION,
        promptVersion: PROMPT_VERSIONS.profileDrafter,
        expiresAt: new Date(now().getTime() + 15 * 60 * 1000),
      });
      return {
        ...draft,
        profile_text: exactDraft,
        approvalToken: approval.raw,
        consentVersion: CONSENT_VERSION,
        promptVersion: PROMPT_VERSIONS.profileDrafter,
      };
    });

    app.post("/api/member/profile/approve", async (request, reply) => {
      setNoStore(reply);
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const body = profileApprovalSchema.parse(request.body);
      const textHash = sha256(body.profileText);
      const current = now();
      const [pending, person] = await Promise.all([
        repository.getPendingInterview(session.personId, current),
        repository.getPerson(session.personId),
      ]);
      if (!pending)
        return reply.status(409).send({
          error:
            "The pending interview has expired. Please restart the interview and create a new draft.",
        });
      const safety = exactProfileSafetyFinding(
        body.profileText,
        pending,
        person?.approvedText ?? null,
      );
      if (safety)
        return reply
          .status(422)
          .send({ error: safety.message, requiresRevision: true });
      const embedding = await ai.embed(
        body.profileText,
        config.EMBEDDING_DIMENSION,
      );
      const consumed = await security.consumeApprovalToken({
        tokenHash: keyedHash(body.approvalToken, config.MAGIC_LINK_HMAC_KEY),
        personId: session.personId,
        sessionHash: session.sessionHash,
        approvedTextSha256: textHash,
        consentVersion: body.consentVersion,
        promptVersion: PROMPT_VERSIONS.profileDrafter,
        now: current,
      });
      if (!consumed)
        return reply.status(409).send({
          error:
            "The approval has expired or the displayed profile changed. Please create a new draft.",
        });
      const saved = await saveExactProfile({
        session,
        exactText: body.profileText,
        current,
        embedding,
        expectedPendingRevision: pending.revision,
      });
      if (!saved)
        return reply.status(409).send({
          error:
            "The conversation changed before approval. Please create and approve a new draft.",
        });
      return { saved: true, approvedTextSha256: textHash };
    });

    app.post(
      "/api/member/profile/verify",
      { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
      async (request, reply) => {
        const session = await memberSession(request, reply, true);
        if (!session?.personId) return;
        await repository.verify(session.personId, now());
        if (session.verificationCycleId) {
          await executor.query(
            `UPDATE magic_link_tokens SET superseded_at = $2
           WHERE verification_cycle_id = $1::uuid AND used_at IS NULL AND superseded_at IS NULL`,
            [session.verificationCycleId, now()],
          );
        }
        return { verified: true };
      },
    );

    app.post("/api/member/profile/pause", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      await repository.setStatus(session.personId, "PAUSED", now());
      return { paused: true };
    });

    app.post("/api/member/profile/reactivate", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      await repository.setStatus(session.personId, "ACTIVE", now());
      return { reactivated: true };
    });

    app.post("/api/member/name", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const body = changeNameSchema.parse(request.body);
      await repository.updateName(
        session.personId,
        body.displayName,
        normalizeDisplayName(body.displayName),
      );
      return { updated: true };
    });

    app.post(
      "/api/member/emails",
      { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
      async (request, reply) => {
        const session = await memberSession(request, reply, true);
        if (!session?.personId) return;
        const body = addEmailSchema.parse(request.body);
        const current = now();
        const token = generateOpaqueSecret(config.MAGIC_LINK_HMAC_KEY);
        const expiresAt = new Date(current.getTime() + 15 * 60 * 1000);
        const normalizedEmail = normalizeEmail(body.email);
        const reserved = await security.reserveAddEmailToken(
          {
            tokenHash: token.hash,
            personId: session.personId,
            normalizedEmail,
            displayEmail: body.email,
            abuseEmailHash: keyedHash(
              normalizedEmail,
              config.MAGIC_LINK_HMAC_KEY,
            ),
            expiresAt,
          },
          new Date(current.getTime() - 60 * 60 * 1000),
          5,
        );
        if (!reserved)
          return reply.status(429).send({
            error: "Too many email verification requests. Try again later.",
          });
        const contents = magicLinkEmail({
          appName: config.APP_DISPLAY_NAME,
          magicLink: `${config.PUBLIC_BASE_URL}/verify-email#token=${token.raw}`,
          expiresAt,
        });
        await email.send({
          ...contents,
          to: body.email,
          idempotencyKey: token.hash,
        });
        return { pending: true };
      },
    );

    app.post("/api/member/emails/verify", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const body = redeemMagicLinkSchema.parse(request.body);
      const redeemed = await security.redeemMagicToken(
        keyedHash(body.token, config.MAGIC_LINK_HMAC_KEY),
        now(),
      );
      if (
        !redeemed ||
        redeemed.purpose !== "ADD_EMAIL" ||
        redeemed.personId !== session.personId
      ) {
        return reply.status(410).send({
          error:
            "This email verification link is expired or has already been used.",
        });
      }
      await executor.query(
        `INSERT INTO person_emails(person_id, display_email, normalized_email, verified_at, is_primary)
       VALUES ($1::uuid, $2, $3, $4, false) ON CONFLICT (person_id, normalized_email)
       DO UPDATE SET verified_at = EXCLUDED.verified_at, deliverability = 'DELIVERABLE'`,
        [
          session.personId,
          redeemed.displayEmail,
          redeemed.normalizedEmail,
          now(),
        ],
      );
      return { verified: true };
    });

    app.post("/api/member/emails/:id/primary", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const id = z
        .string()
        .uuid()
        .parse((request.params as { id?: string }).id);
      await executor.transaction(async (transaction) => {
        const target = await transaction.query(
          "SELECT 1 FROM person_emails WHERE id = $1::uuid AND person_id = $2::uuid AND verified_at IS NOT NULL",
          [id, session.personId],
        );
        if (target.rowCount !== 1) throw new Error("VerifiedEmailNotFound");
        await transaction.query(
          "UPDATE person_emails SET is_primary = false WHERE person_id = $1::uuid AND is_primary",
          [session.personId],
        );
        await transaction.query(
          "UPDATE person_emails SET is_primary = true WHERE id = $1::uuid AND person_id = $2::uuid",
          [id, session.personId],
        );
      });
      return { primary: true };
    });

    app.delete("/api/member/emails/:id", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const id = z
        .string()
        .uuid()
        .parse((request.params as { id?: string }).id);
      const removedEmail = await executor.transaction(async (transaction) => {
        const target = await transaction.query<{
          is_primary: boolean;
          normalized_email: string;
        }>(
          `SELECT is_primary, normalized_email FROM person_emails
         WHERE id = $1::uuid AND person_id = $2::uuid FOR UPDATE`,
          [id, session.personId],
        );
        const selected = target.rows[0];
        if (!selected) throw new Error("VerifiedEmailNotFound");
        if (selected.is_primary) {
          await transaction.query(
            `UPDATE person_emails SET is_primary = false
             WHERE id = $1::uuid AND person_id = $2::uuid`,
            [id, session.personId],
          );
          await transaction.query(
            `UPDATE person_emails SET is_primary = true WHERE id = (
             SELECT id FROM person_emails WHERE person_id = $1::uuid AND id <> $2::uuid AND verified_at IS NOT NULL
             ORDER BY created_at LIMIT 1
           )`,
            [session.personId, id],
          );
        }
        await transaction.query(
          `UPDATE member_sessions SET revoked_at = $3::timestamptz
         WHERE selected_person_id = $1::uuid AND mailbox_normalized_email = $2
           AND revoked_at IS NULL`,
          [session.personId, selected.normalized_email, now()],
        );
        await transaction.query(
          "DELETE FROM person_emails WHERE id = $1::uuid AND person_id = $2::uuid",
          [id, session.personId],
        );
        return selected.normalized_email;
      });
      const signedOut = session.mailboxEmail === removedEmail;
      if (signedOut) reply.clearCookie(MEMBER_COOKIE, { path: "/" });
      return { removed: true, signedOut };
    });

    app.delete("/api/member/profile", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session?.personId) return;
      const pseudonymous = keyedHash(session.personId, config.SESSION_HMAC_KEY);
      await repository.purgePerson(
        session.personId,
        pseudonymous,
        "USER_REQUEST",
        now(),
      );
      await security.revokeMemberSession(session.sessionHash, now());
      reply.clearCookie(MEMBER_COOKIE, { path: "/" });
      return { deleted: true, backupRetentionDays: 35 };
    });

    app.post("/api/member/logout", async (request, reply) => {
      const session = await memberSession(request, reply, true);
      if (!session) return;
      await security.revokeMemberSession(session.sessionHash, now());
      reply.clearCookie(MEMBER_COOKIE, { path: "/" });
      return { signedOut: true };
    });
  }

  if (process.env.GIS_API_SURFACE !== "public") {
    app.post("/api/staff/auth/fake", async (request, reply) => {
      if (config.STAFF_AUTH_ADAPTER !== "fake" || config.APP_ENV === "prod")
        return reply.status(404).send({ error: "Not found." });
      if (!checkOrigin(request, reply)) return;
      const body = z
        .object({ groups: z.array(groupSchema).min(1).max(5) })
        .parse(request.body);
      const groups = [...new Set(body.groups)] as StaffGroup[];
      const sessionSecret = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      const csrf = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      const effectivePermissions = [...permissionsFor(groups)];
      await security.createStaffSession({
        sessionHash: sessionSecret.hash,
        subject: `fake:${groups.join("+")}`,
        groups,
        permissions: effectivePermissions,
        csrfHash: csrf.hash,
        now: now(),
      });
      reply.setCookie(STAFF_COOKIE, sessionSecret.raw, staffCookieOptions());
      return {
        groups,
        permissions: effectivePermissions,
        csrfToken: csrf.raw,
        trustedBrowser: false,
      };
    });

    async function finishStaffSignIn(
      step: StaffAuthStep,
      reply: FastifyReply,
      input: {
        loginIdentifier: string;
        trustBrowser: boolean;
        correlationId: string;
        currentTrustedDevice?: ActiveStaffTrustedDevice;
      },
    ): Promise<unknown> {
      if (!step.authenticated) {
        if (
          step.trustedDeviceStatus === "rejected" &&
          input.currentTrustedDevice
        ) {
          const revoked = await security.revokeStaffTrustedDevice(
            input.currentTrustedDevice.record.trustHash,
            now(),
          );
          if (revoked) await forgetCognitoDevices([revoked]);
          reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
        }
        const transaction = protectStaffAuthTransaction(
          {
            purpose: "CHALLENGE",
            challenge: step.challenge,
            session: step.session,
            username: step.username,
            loginIdentifier: input.loginIdentifier,
            expiresAt: new Date(now().getTime() + 10 * 60 * 1000).toISOString(),
          },
          config.SESSION_HMAC_KEY,
        );
        return {
          authenticated: false,
          challenge: step.challenge,
          transaction,
          ...(step.secretCode ? { secretCode: step.secretCode } : {}),
        };
      }
      const identity = await staffTokenVerifier.verify(step.idToken);
      const groups = identity.groupNames
        .map((group) => groupSchema.safeParse(group))
        .filter((result) => result.success)
        .map((result) => result.data);
      if (groups.length === 0) {
        if (input.currentTrustedDevice) {
          const revoked = await security.revokeStaffTrustedDevice(
            input.currentTrustedDevice.record.trustHash,
            now(),
          );
          if (revoked) await forgetCognitoDevices([revoked]);
          reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
        }
        return reply.status(403).send({
          error: "This account has not been assigned Gifts in Service access.",
        });
      }
      if (step.trustedDeviceStatus === "used") {
        const currentTrusted = input.currentTrustedDevice;
        if (
          !currentTrusted ||
          currentTrusted.record.subject !== identity.subject ||
          !(await security.markStaffTrustedDeviceUsed(
            currentTrusted.record.trustHash,
            identity.subject,
            now(),
          ))
        ) {
          if (currentTrusted) {
            const revoked = await security.revokeStaffTrustedDevice(
              currentTrusted.record.trustHash,
              now(),
            );
            if (revoked) await forgetCognitoDevices([revoked]);
          }
          reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
          return reply
            .status(401)
            .send({ error: "This browser must complete MFA again." });
        }
      }
      const sessionSecret = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      const csrf = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      const effectivePermissions = [...permissionsFor(groups)];
      await security.createStaffSession({
        sessionHash: sessionSecret.hash,
        subject: identity.subject,
        groups,
        permissions: effectivePermissions,
        csrfHash: csrf.hash,
        now: now(),
      });
      let trustedBrowserExpiresAt: string | undefined;
      if (input.trustBrowser && step.accessToken && step.newDeviceMetadata) {
        let createdTrustHash: string | undefined;
        try {
          const credentials = await staffIdentityProvider.confirmTrustedDevice({
            accessToken: step.accessToken,
            deviceKey: step.newDeviceMetadata.deviceKey,
            deviceGroupKey: step.newDeviceMetadata.deviceGroupKey,
          });
          const trust = generateOpaqueSecret(config.SESSION_HMAC_KEY);
          createdTrustHash = trust.hash;
          const current = now();
          const expiresAt = new Date(
            current.getTime() + STAFF_TRUST_TTL_SECONDS * 1000,
          );
          const evicted = await security.createStaffTrustedDevice({
            trustHash: trust.hash,
            subject: identity.subject,
            cognitoUsername: step.username,
            loginIdentifier: input.loginIdentifier,
            deviceKey: credentials.deviceKey,
            deviceGroupKey: credentials.deviceGroupKey,
            credentialsCiphertext: encryptShortLivedSecret(
              JSON.stringify(credentials),
              `${config.SESSION_HMAC_KEY}:staff-trusted-device:v1`,
            ),
            now: current,
            expiresAt,
          });
          await forgetCognitoDevices(evicted);
          await repository.writeAudit({
            actorType: "STAFF",
            actorId: identity.subject,
            roles: groups,
            action: "STAFF_TRUSTED_BROWSER_ADDED",
            targetId: identity.subject,
            correlationId: input.correlationId,
            succeeded: true,
            metadata: {
              lifetimeDays: 30,
              evictedBrowserCount: evicted.length,
            },
          });
          reply.setCookie(
            STAFF_TRUST_COOKIE,
            trust.raw,
            staffTrustCookieOptions(),
          );
          trustedBrowserExpiresAt = expiresAt.toISOString();
        } catch {
          let locallyTrackedDeviceForgotten = false;
          if (createdTrustHash) {
            const revoked = await security.revokeStaffTrustedDevice(
              createdTrustHash,
              now(),
            );
            if (revoked) {
              await forgetCognitoDevices([revoked]);
              locallyTrackedDeviceForgotten = true;
            }
          }
          if (!locallyTrackedDeviceForgotten)
            await forgetCognitoDevices([
              {
                cognitoUsername: step.username,
                deviceKey: step.newDeviceMetadata.deviceKey,
              },
            ]);
          reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
        }
      } else if (
        step.trustedDeviceStatus === "used" &&
        input.currentTrustedDevice
      ) {
        trustedBrowserExpiresAt =
          input.currentTrustedDevice.record.expiresAt.toISOString();
      }
      reply.setCookie(STAFF_COOKIE, sessionSecret.raw, staffCookieOptions());
      return {
        authenticated: true,
        groups,
        permissions: effectivePermissions,
        csrfToken: csrf.raw,
        ...(trustedBrowserExpiresAt ? { trustedBrowserExpiresAt } : {}),
      };
    }

    app.get("/api/staff/auth/login", async (_request, reply) =>
      reply.redirect("/staff"),
    );

    app.post(
      "/api/staff/auth/login",
      { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (config.STAFF_AUTH_ADAPTER !== "cognito")
          return reply.status(404).send({ error: "Not found." });
        if (!checkOrigin(request, reply)) return;
        const body = z
          .object({
            email: z.string().email().max(254),
            password: z.string().min(1).max(256),
          })
          .parse(request.body);
        const loginIdentifier = normalizeEmail(body.email);
        const currentTrustedDevice = await activeTrustedDevice(request, reply);
        try {
          return await finishStaffSignIn(
            await staffIdentityProvider.startPasswordSignIn(
              loginIdentifier,
              body.password,
              currentTrustedDevice?.credentials,
            ),
            reply,
            {
              loginIdentifier,
              trustBrowser: false,
              correlationId: request.id,
              ...(currentTrustedDevice ? { currentTrustedDevice } : {}),
            },
          );
        } catch (error) {
          const failure = staffAuthFailure(error);
          return reply.status(failure.status).send({ error: failure.message });
        }
      },
    );

    app.post(
      "/api/staff/auth/challenge",
      { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (config.STAFF_AUTH_ADAPTER !== "cognito")
          return reply.status(404).send({ error: "Not found." });
        if (!checkOrigin(request, reply)) return;
        const body = z
          .object({
            transaction: z.string().min(40).max(16_384),
            response: z.string().min(1).max(256),
            trustBrowser: z.boolean().default(false),
          })
          .parse(request.body);
        const transaction = readStaffAuthTransaction(
          body.transaction,
          config.SESSION_HMAC_KEY,
          now(),
        );
        if (!transaction || transaction.purpose !== "CHALLENGE")
          return reply
            .status(400)
            .send({ error: "This sign-in step expired. Start again." });
        if (
          (transaction.challenge === "NEW_PASSWORD_REQUIRED" &&
            body.response.length < 14) ||
          (transaction.challenge !== "NEW_PASSWORD_REQUIRED" &&
            !/^\d{6}$/u.test(body.response))
        )
          return reply
            .status(400)
            .send({ error: "The sign-in response was not valid." });
        try {
          return await finishStaffSignIn(
            await staffIdentityProvider.respondToChallenge({
              challenge: transaction.challenge,
              session: transaction.session,
              username: transaction.username,
              response: body.response,
            }),
            reply,
            {
              loginIdentifier: transaction.loginIdentifier,
              trustBrowser:
                body.trustBrowser &&
                transaction.challenge !== "NEW_PASSWORD_REQUIRED",
              correlationId: request.id,
            },
          );
        } catch (error) {
          const failure = staffAuthFailure(error);
          return reply.status(failure.status).send({ error: failure.message });
        }
      },
    );

    app.post(
      "/api/staff/auth/forgot-password",
      { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (config.STAFF_AUTH_ADAPTER !== "cognito")
          return reply.status(404).send({ error: "Not found." });
        if (!checkOrigin(request, reply)) return;
        const body = z
          .object({ email: z.string().email().max(254) })
          .parse(request.body);
        const username = normalizeEmail(body.email);
        try {
          await staffIdentityProvider.requestPasswordReset(username);
        } catch {
          // Keep reset initiation neutral for unknown, ineligible, throttled, and
          // temporarily unavailable accounts.
        }
        return {
          message: STAFF_PASSWORD_RESET_RESPONSE,
          transaction: protectStaffAuthTransaction(
            {
              purpose: "PASSWORD_RESET",
              username,
              expiresAt: new Date(
                now().getTime() + 15 * 60 * 1000,
              ).toISOString(),
            },
            config.SESSION_HMAC_KEY,
          ),
        };
      },
    );

    app.post(
      "/api/staff/auth/confirm-password",
      { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        if (config.STAFF_AUTH_ADAPTER !== "cognito")
          return reply.status(404).send({ error: "Not found." });
        if (!checkOrigin(request, reply)) return;
        const body = z
          .object({
            transaction: z.string().min(40).max(16_384),
            code: z.string().regex(/^\d{6}$/u),
            newPassword: z.string().min(14).max(256),
          })
          .parse(request.body);
        const transaction = readStaffAuthTransaction(
          body.transaction,
          config.SESSION_HMAC_KEY,
          now(),
        );
        if (!transaction || transaction.purpose !== "PASSWORD_RESET")
          return reply
            .status(400)
            .send({ error: "This password reset expired. Start again." });
        try {
          const resetIdentity =
            await staffIdentityProvider.confirmPasswordReset(
              transaction.username,
              body.code,
              body.newPassword,
            );
          const revoked = resetIdentity
            ? await security.revokeStaffTrustedDevicesForSubject(
                resetIdentity.subject,
                now(),
              )
            : await security.revokeStaffTrustedDevicesForLogin(
                transaction.username,
                now(),
              );
          await forgetCognitoDevices(revoked);
          return { reset: true };
        } catch (error) {
          const failure = staffAuthFailure(error);
          return reply.status(failure.status).send({ error: failure.message });
        }
      },
    );

    app.get("/api/staff/me", async (request, reply) => {
      const session = await staffSession(request, reply);
      if (!session) return;
      const trustedDevice = await activeTrustedDevice(request, reply);
      const csrf = generateOpaqueSecret(config.SESSION_HMAC_KEY);
      await security.rotateStaffCsrf(session.sessionHash, csrf.hash);
      return {
        subject: session.subject,
        groups: session.groups,
        permissions: session.permissions,
        csrfToken: csrf.raw,
        trustedBrowser: trustedDevice?.record.subject === session.subject,
      };
    });

    app.post(
      "/api/staff/search",
      { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
      async (request, reply) => {
        setNoStore(reply);
        const session = await staffSession(
          request,
          reply,
          "profile:search",
          true,
        );
        if (!session) return;
        const body = searchQuerySchema.parse(request.body);
        let plan: SearchPlan;
        try {
          plan = await ai.planSearch(body.query);
        } catch {
          plan = deterministicSearchPlan(body.query);
          emitMetric("SearchPlannerFallbacks", 1, "Count", "StaffSearch");
        }
        const embedding = await ai.embed(
          plan.semantic_query,
          config.EMBEDDING_DIMENSION,
        );
        const candidates = await repository.hybridCandidates({
          query: plan.semantic_query,
          exactTerms: plan.exact_terms,
          embedding,
          embeddingModelId: config.EMBEDDING_MODEL_ID,
          embeddingVersion: embeddingVersion(
            config.AI_ADAPTER,
            config.EMBEDDING_MODEL_ID,
            config.EMBEDDING_DIMENSION,
          ),
          now: now(),
        });
        const lists = [
          candidates
            .filter((item) => item.lexicalRank !== null)
            .map((item) => ({ id: item.id, rank: item.lexicalRank ?? 999 })),
          candidates
            .filter((item) => item.vectorRank !== null)
            .map((item) => ({ id: item.id, rank: item.vectorRank ?? 999 })),
          candidates
            .filter((item) => item.fuzzyRank !== null)
            .map((item) => ({ id: item.id, rank: item.fuzzyRank ?? 999 })),
        ];
        const fused = reciprocalRankFusion(lists);
        const byId = new Map(
          candidates.map((candidate) => [candidate.id, candidate]),
        );
        const ordered = fused
          .map((item) => byId.get(item.id))
          .filter((candidate) => candidate !== undefined)
          .slice(0, SEARCH_RESULT_LIMIT);
        let generated = null;
        try {
          const output = rerankerOutputSchema.parse(
            await ai.rerank(
              body.query,
              plan,
              ordered.map((candidate) => ({
                id: candidate.id,
                approvedText: candidate.approvedText,
              })),
            ),
          );
          generated = validateGroundedResults(
            output.results,
            ordered.map((candidate) => ({
              id: candidate.id,
              approvedText: candidate.approvedText,
            })),
          );
        } catch {
          generated = null;
        }
        const results = generated
          ? generated.flatMap((item) => {
              const candidate = byId.get(item.candidate_id);
              const deterministic = candidate
                ? deterministicSearchExplanation({
                    query: body.query,
                    exactTerms: plan.exact_terms,
                    approvedText: candidate.approvedText,
                    lexicalRank: candidate.lexicalRank,
                    vectorRank: candidate.vectorRank,
                    fuzzyRank: candidate.fuzzyRank,
                  })
                : null;
              return deterministic?.hasRelevantExclusion
                ? []
                : [
                    {
                      personId: item.candidate_id,
                      approvedText: candidate?.approvedText ?? "",
                      relevance: deterministic
                        ? relevanceWithProfileLimitations(
                            item.relevance,
                            deterministic,
                          )
                        : item.relevance,
                      reason: deterministic?.hasRoleSafetyCaution
                        ? deterministic.reason
                        : item.reason,
                      evidence: deterministic?.hasRoleSafetyCaution
                        ? deterministic.evidence
                        : item.evidence,
                      cautions: [
                        ...new Set([
                          ...item.cautions,
                          ...(deterministic?.cautions ?? []),
                        ]),
                      ],
                      explanationGeneratedByAi:
                        !deterministic?.hasRoleSafetyCaution,
                    },
                  ];
            })
          : ordered.flatMap((candidate) => {
              const explanation = deterministicSearchExplanation({
                query: body.query,
                exactTerms: plan.exact_terms,
                approvedText: candidate.approvedText,
                lexicalRank: candidate.lexicalRank,
                vectorRank: candidate.vectorRank,
                fuzzyRank: candidate.fuzzyRank,
              });
              return explanation.hasRelevantExclusion
                ? []
                : [
                    {
                      personId: candidate.id,
                      approvedText: candidate.approvedText,
                      relevance: explanation.relevance,
                      reason: explanation.reason,
                      evidence: explanation.evidence,
                      cautions: [
                        ...new Set([...plan.cautions, ...explanation.cautions]),
                      ],
                      explanationGeneratedByAi: false,
                    },
                  ];
            });
        const auditId = await repository.writeAudit({
          actorType: "STAFF",
          actorId: session.subject,
          roles: session.groups,
          action: "PROFILE_SEARCH",
          correlationId: request.id,
          resultIds: results.map((result) => result.personId),
          modelVersion: config.SEARCH_MODEL_ID,
          promptVersion: `${PROMPT_VERSIONS.searchPlanner}+${PROMPT_VERSIONS.searchReranker}`,
          succeeded: true,
          metadata: { resultCount: results.length },
        });
        await executor.query(
          `INSERT INTO audit_query_payloads(audit_event_id, protected_query, expires_at)
       VALUES ($1::uuid, $2, $3::timestamptz + interval '90 days')`,
          [auditId, body.query, now()],
        );
        return {
          results,
          cautions: plan.cautions,
          suggestionNotice:
            "Suggestions are based on self-reported profiles. Verify requirements separately.",
        };
      },
    );

    app.get("/api/staff/profiles/:id", async (request, reply) => {
      setNoStore(reply);
      const session = await staffSession(request, reply, "profile:read");
      if (!session) return;
      const personId = z
        .string()
        .uuid()
        .parse((request.params as { id?: string }).id);
      const person = await repository.getPerson(personId);
      const canManage = session.permissions.some((permission) =>
        ["profile:pause", "profile:reactivate", "profile:purge"].includes(
          permission,
        ),
      );
      if (
        !person ||
        (!canManage && (person.status !== "ACTIVE" || !person.approvedText))
      )
        return reply.status(404).send({ error: "Profile not found." });
      const emails = session.permissions.includes("contact:read")
        ? await repository.emails(personId)
        : [];
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "PROFILE_OPEN",
        targetId: personId,
        correlationId: request.id,
        succeeded: true,
        metadata: { contactRecordsShown: emails.length },
      });
      return {
        person,
        emails,
        selfReportedNotice:
          "Skills and qualifications are self-reported unless separately verified by the church.",
      };
    });

    app.get("/api/staff/profiles", async (request, reply) => {
      setNoStore(reply);
      const session = await staffSession(request, reply, "profile:pause");
      if (!session) return;
      return {
        people: await repository.staffPeople(
          session.permissions.includes("contact:read"),
        ),
      };
    });

    for (const [path, status, permission] of [
      ["/api/staff/profiles/:id/pause", "PAUSED", "profile:pause"],
      ["/api/staff/profiles/:id/reactivate", "ACTIVE", "profile:reactivate"],
    ] as const) {
      app.post(path, async (request, reply) => {
        const session = await staffSession(request, reply, permission, true);
        if (!session) return;
        const personId = z
          .string()
          .uuid()
          .parse((request.params as { id?: string }).id);
        const person = await repository.getPerson(personId);
        if (!person)
          return reply.status(404).send({ error: "Profile not found." });
        if (status === "ACTIVE" && !person.approvedText)
          return reply.status(409).send({
            error: "A record without an approved profile cannot be activated.",
          });
        await repository.setStatus(personId, status, now());
        await repository.writeAudit({
          actorType: "STAFF",
          actorId: session.subject,
          roles: session.groups,
          action:
            status === "PAUSED" ? "PROFILE_PAUSED" : "PROFILE_REACTIVATED",
          targetId: personId,
          correlationId: request.id,
          succeeded: true,
        });
        return { updated: true };
      });
    }

    app.delete("/api/staff/profiles/:id", async (request, reply) => {
      const session = await staffSession(request, reply, "profile:purge", true);
      if (!session) return;
      const personId = z
        .string()
        .uuid()
        .parse((request.params as { id?: string }).id);
      await repository.purgePerson(
        personId,
        keyedHash(personId, config.SESSION_HMAC_KEY),
        "ADMIN_REQUEST",
        now(),
      );
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "PROFILE_PURGED",
        correlationId: request.id,
        succeeded: true,
      });
      return { purged: true };
    });

    app.get("/api/staff/lifecycle/exceptions", async (request, reply) => {
      const session = await staffSession(request, reply, "lifecycle:read");
      if (!session) return;
      const result = await executor.query(
        `SELECT p.id::text AS person_id, p.display_name, p.status::text,
        p.last_verified_at, p.scheduled_purge_at,
        count(e.id)::int AS verified_addresses,
        count(e.id) FILTER (WHERE e.deliverability = 'DELIVERABLE')::int AS deliverable_addresses
       FROM people p LEFT JOIN person_emails e ON e.person_id = p.id AND e.verified_at IS NOT NULL
       GROUP BY p.id
       HAVING count(e.id) FILTER (WHERE e.deliverability = 'DELIVERABLE') = 0
       ORDER BY p.display_name, p.id`,
      );
      return { exceptions: result.rows };
    });

    app.get("/api/staff/audit", async (request, reply) => {
      const session = await staffSession(request, reply, "audit:read");
      if (!session) return;
      const result = await executor.query<{
        id: string;
        actor_type: string;
        actor_id: string;
        effective_roles: string[];
        action: string;
        target_uuid: string | null;
        occurred_at: Date;
        correlation_id: string;
        result_uuids: string[];
        succeeded: boolean;
        metadata: Record<string, unknown>;
      }>(
        `SELECT id::text, actor_type, actor_id, effective_roles, action, target_uuid::text,
        occurred_at, correlation_id::text, result_uuids::text, succeeded, metadata
       FROM audit_events ORDER BY occurred_at DESC LIMIT 200`,
      );
      const usernamesBySubject = new Map<string, string>();
      if (config.STAFF_AUTH_ADAPTER === "cognito") {
        for (const user of await listCognitoUsers()) {
          const subject = cognitoAttribute(user, "sub");
          const username = cognitoAttribute(user, "email") ?? user.Username;
          if (subject && username) usernamesBySubject.set(subject, username);
        }
      }
      return {
        events: result.rows.map(({ actor_id: actorId, ...event }) => ({
          ...event,
          actor_username: auditActorUsername({
            actorType: event.actor_type,
            actorId,
            resolvedUsername: usernamesBySubject.get(actorId),
            localDevelopment: config.STAFF_AUTH_ADAPTER === "fake",
          }),
        })),
      };
    });

    app.get("/api/staff/access", async (request, reply) => {
      const session = await staffSession(request, reply, "access:manage-lower");
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return { users: [], localDevelopment: true };
      const users = await Promise.all(
        (await listCognitoUsers()).map(async (user) => {
          const username = user.Username ?? "";
          const memberships = username
            ? await cognito.send(
                new AdminListGroupsForUserCommand({
                  UserPoolId: config.COGNITO_USER_POOL_ID,
                  Username: username,
                }),
              )
            : { Groups: [] };
          return {
            subject: cognitoAttribute(user, "sub") ?? "",
            email: cognitoAttribute(user, "email") ?? "",
            enabled: user.Enabled ?? false,
            status: user.UserStatus ?? "UNKNOWN",
            groups: (memberships.Groups ?? [])
              .map((group) => group.GroupName)
              .filter((group): group is string => Boolean(group)),
          };
        }),
      );
      return { users };
    });

    app.post("/api/staff/access/invite", async (request, reply) => {
      const session = await staffSession(
        request,
        reply,
        "access:manage-lower",
        true,
      );
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return reply.status(400).send({ error: "Invites require Cognito." });
      const body = z
        .object({
          email: z.string().email().max(254),
          groups: z
            .array(groupSchema)
            .min(1)
            .max(MANAGEABLE_GROUPS.length)
            .default(["gis-staff"]),
        })
        .parse(request.body);
      if (body.groups.some((group) => !MANAGEABLE_GROUPS.includes(group)))
        return reply.status(403).send({
          error: "High-privilege groups require the AWS-authorized process.",
        });
      const normalizedEmail = normalizeEmail(body.email);
      const result = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          // The staff pool uses email as its username attribute. Cognito rejects
          // an arbitrary UUID here before the invited user can reach the
          // permanent-password and TOTP setup steps.
          Username: normalizedEmail,
          DesiredDeliveryMediums: ["EMAIL"],
          UserAttributes: [{ Name: "email", Value: normalizedEmail }],
        }),
      );
      const target = result.User?.Attributes?.find(
        (attribute) => attribute.Name === "sub",
      )?.Value;
      for (const group of body.groups) {
        await cognito.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: config.COGNITO_USER_POOL_ID,
            Username: normalizedEmail,
            GroupName: group,
          }),
        );
      }
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_INVITE",
        ...(target ? { targetId: target } : {}),
        correlationId: request.id,
        succeeded: true,
        metadata: { groupCount: body.groups.length },
      });
      return { invited: true, groups: body.groups };
    });

    app.post("/api/staff/access/:sub/groups", async (request, reply) => {
      const session = await staffSession(
        request,
        reply,
        "access:manage-lower",
        true,
      );
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return reply
          .status(400)
          .send({ error: "Group changes require Cognito." });
      const subject = z
        .string()
        .uuid()
        .parse((request.params as { sub?: string }).sub);
      const body = z
        .object({ groups: z.array(groupSchema).max(MANAGEABLE_GROUPS.length) })
        .parse(request.body);
      if (body.groups.some((group) => !MANAGEABLE_GROUPS.includes(group)))
        return reply.status(403).send({
          error: "High-privilege groups require the AWS-authorized process.",
        });
      const target = await cognitoAccessTarget(subject);
      if (!target)
        return reply.status(404).send({ error: "Staff user not found." });
      if (hasProtectedStaffGroup(target.groups))
        return reply.status(403).send({
          error: "High-privilege users require the AWS-authorized process.",
        });
      const revokedTrustedBrowserCount = await revokeTrustedDevicesForSubject(
        subject,
        now(),
      );
      await executor.query(
        `UPDATE staff_sessions SET revoked_at = $2::timestamptz
       WHERE cognito_subject = $1 AND revoked_at IS NULL`,
        [subject, now()],
      );
      await cognito.send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          Username: target.username,
        }),
      );
      const currentManageable = target.groups.filter(
        (group): group is StaffGroup =>
          MANAGEABLE_GROUPS.includes(group as StaffGroup),
      );
      for (const group of MANAGEABLE_GROUPS) {
        if (body.groups.includes(group) && !currentManageable.includes(group)) {
          await cognito.send(
            new AdminAddUserToGroupCommand({
              UserPoolId: config.COGNITO_USER_POOL_ID,
              Username: target.username,
              GroupName: group,
            }),
          );
        } else if (
          !body.groups.includes(group) &&
          currentManageable.includes(group)
        ) {
          await cognito.send(
            new AdminRemoveUserFromGroupCommand({
              UserPoolId: config.COGNITO_USER_POOL_ID,
              Username: target.username,
              GroupName: group,
            }),
          );
        }
      }
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_GROUPS_CHANGED",
        targetId: subject,
        correlationId: request.id,
        succeeded: true,
        metadata: {
          groupCount: body.groups.length,
          revokedTrustedBrowserCount,
        },
      });
      return { updated: true, groups: body.groups };
    });

    app.post(
      "/api/staff/access/:sub/revoke-sessions",
      async (request, reply) => {
        const session = await staffSession(
          request,
          reply,
          "session:revoke",
          true,
        );
        if (!session) return;
        const subject = z
          .string()
          .uuid()
          .parse((request.params as { sub?: string }).sub);
        if (subject === session.subject)
          return reply
            .status(409)
            .send({ error: "Use Sign out to end your own staff session." });
        let cognitoUsername: string | undefined;
        if (config.STAFF_AUTH_ADAPTER === "cognito") {
          const target = await cognitoAccessTarget(subject);
          if (!target)
            return reply.status(404).send({ error: "Staff user not found." });
          if (hasProtectedStaffGroup(target.groups))
            return reply.status(403).send({
              error: "High-privilege users require the AWS-authorized process.",
            });
          cognitoUsername = target.username;
        }
        const revokedTrustedBrowserCount = await revokeTrustedDevicesForSubject(
          subject,
          now(),
        );
        await executor.query(
          "UPDATE staff_sessions SET revoked_at = $2 WHERE cognito_subject = $1 AND revoked_at IS NULL",
          [subject, now()],
        );
        if (cognitoUsername) {
          await cognito.send(
            new AdminUserGlobalSignOutCommand({
              UserPoolId: config.COGNITO_USER_POOL_ID,
              Username: cognitoUsername,
            }),
          );
        }
        await repository.writeAudit({
          actorType: "STAFF",
          actorId: session.subject,
          roles: session.groups,
          action: "STAFF_SESSIONS_REVOKED",
          targetId: subject,
          correlationId: request.id,
          succeeded: true,
          metadata: { revokedTrustedBrowserCount },
        });
        return { revoked: true };
      },
    );

    app.post("/api/staff/access/:sub/disable", async (request, reply) => {
      const session = await staffSession(
        request,
        reply,
        "access:manage-lower",
        true,
      );
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return reply
          .status(400)
          .send({ error: "Disabling users requires Cognito." });
      const subject = z
        .string()
        .uuid()
        .parse((request.params as { sub?: string }).sub);
      if (subject === session.subject)
        return reply
          .status(409)
          .send({ error: "You cannot disable your own staff account." });
      const target = await cognitoAccessTarget(subject);
      if (!target)
        return reply.status(404).send({ error: "Staff user not found." });
      if (hasProtectedStaffGroup(target.groups)) {
        return reply.status(403).send({
          error: "High-privilege users require the AWS-authorized process.",
        });
      }
      await cognito.send(
        new AdminDisableUserCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          Username: target.username,
        }),
      );
      const revokedTrustedBrowserCount = await revokeTrustedDevicesForSubject(
        subject,
        now(),
      );
      await executor.query(
        "UPDATE staff_sessions SET revoked_at = $2 WHERE cognito_subject = $1 AND revoked_at IS NULL",
        [subject, now()],
      );
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_DISABLED",
        targetId: subject,
        correlationId: request.id,
        succeeded: true,
        metadata: { revokedTrustedBrowserCount },
      });
      return { disabled: true };
    });

    app.post("/api/staff/access/:sub/enable", async (request, reply) => {
      const session = await staffSession(
        request,
        reply,
        "access:manage-lower",
        true,
      );
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return reply
          .status(400)
          .send({ error: "Enabling users requires Cognito." });
      const subject = z
        .string()
        .uuid()
        .parse((request.params as { sub?: string }).sub);
      const target = await cognitoAccessTarget(subject);
      if (!target)
        return reply.status(404).send({ error: "Staff user not found." });
      if (hasProtectedStaffGroup(target.groups))
        return reply.status(403).send({
          error: "High-privilege users require the AWS-authorized process.",
        });
      await cognito.send(
        new AdminEnableUserCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          Username: target.username,
        }),
      );
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_ENABLED",
        targetId: subject,
        correlationId: request.id,
        succeeded: true,
      });
      return { enabled: true };
    });

    app.delete("/api/staff/access/:sub", async (request, reply) => {
      const session = await staffSession(
        request,
        reply,
        "access:manage-lower",
        true,
      );
      if (!session) return;
      if (config.STAFF_AUTH_ADAPTER !== "cognito")
        return reply
          .status(400)
          .send({ error: "Deleting users requires Cognito." });
      const subject = z
        .string()
        .uuid()
        .parse((request.params as { sub?: string }).sub);
      if (subject === session.subject)
        return reply
          .status(409)
          .send({ error: "You cannot delete your own staff account." });
      const target = await cognitoAccessTarget(subject);
      if (!target)
        return reply.status(404).send({ error: "Staff user not found." });
      if (hasProtectedStaffGroup(target.groups))
        return reply.status(403).send({
          error: "High-privilege users require the AWS-authorized process.",
        });
      const revokedTrustedBrowserCount = await revokeTrustedDevicesForSubject(
        subject,
        now(),
      );
      await executor.query(
        "UPDATE staff_sessions SET revoked_at = $2 WHERE cognito_subject = $1 AND revoked_at IS NULL",
        [subject, now()],
      );
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: config.COGNITO_USER_POOL_ID,
          Username: target.username,
        }),
      );
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_DELETED",
        targetId: subject,
        correlationId: request.id,
        succeeded: true,
        metadata: { revokedTrustedBrowserCount },
      });
      return { deleted: true };
    });

    app.post("/api/staff/auth/forget-browser", async (request, reply) => {
      const session = await staffSession(request, reply, undefined, true);
      if (!session) return;
      const rawTrust = request.cookies[STAFF_TRUST_COOKIE];
      const revoked = rawTrust
        ? await security.revokeStaffTrustedDevice(
            keyedHash(rawTrust, config.SESSION_HMAC_KEY),
            now(),
            session.subject,
          )
        : null;
      if (revoked) await forgetCognitoDevices([revoked]);
      await security.revokeStaffSession(session.sessionHash, now());
      await repository.writeAudit({
        actorType: "STAFF",
        actorId: session.subject,
        roles: session.groups,
        action: "STAFF_TRUSTED_BROWSER_FORGOTTEN",
        targetId: session.subject,
        correlationId: request.id,
        succeeded: true,
        metadata: { trustedBrowserFound: Boolean(revoked) },
      });
      reply.clearCookie(STAFF_COOKIE, { path: "/" });
      reply.clearCookie(STAFF_TRUST_COOKIE, { path: "/" });
      return { signedOut: true, browserForgotten: true };
    });

    app.post("/api/staff/auth/logout", async (request, reply) => {
      const session = await staffSession(request, reply, undefined, true);
      if (!session) return;
      await security.revokeStaffSession(session.sessionHash, now());
      reply.clearCookie(STAFF_COOKIE, { path: "/" });
      return { signedOut: true };
    });
  }

  app.addHook("onClose", async () => {
    await executor.close?.();
  });
  return app;
}
