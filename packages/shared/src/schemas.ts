import { z } from "zod";
import { CONSENT_VERSION } from "./disclosures.js";

export const uuidSchema = z.string().uuid();
export const displayNameSchema = z.string().trim().min(1).max(100);
export const emailSchema = z.string().trim().email().max(254);

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});

export const redeemMagicLinkSchema = z.object({
  token: z.string().min(43).max(512),
});

export const interviewMessageSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(7000),
      }),
    )
    .min(1)
    .max(61)
    .refine(
      (messages) =>
        messages.reduce(
          (total, message) => total + message.content.length,
          0,
        ) <= 60_000,
      {
        message:
          "Active interview is too long; please create a draft or start a new session",
      },
    ),
});

export const interviewResponseSchema = z.object({
  response: z.string().trim().min(1).max(3000),
  revision: z.number().int().min(0),
});

export const interviewCompletenessSchema = z.enum(["LOW", "MODERATE", "HIGH"]);

export const interviewFollowUpNotesSchema = z
  .array(z.string().trim().min(1).max(160))
  .max(8);

export const interviewConversationMemorySchema = z
  .object({
    establishedFacts: z.array(z.string().trim().min(1).max(240)).max(16),
    closedTopics: z.array(z.string().trim().min(1).max(160)).max(8),
  })
  .strict();

export const ROLE_SAFETY_CONCERNS = [
  "INFANT_CARE",
  "CHILD_SUPERVISION",
  "VULNERABLE_ADULT_CARE",
  "PASSENGER_TRANSPORT",
  "FINANCIAL_HANDLING",
  "PASTORAL_COUNSELING",
  "HOME_VISITATION",
  "FOOD_SERVICE",
  "MEDICAL_FIRST_AID",
  "FACILITIES_EQUIPMENT",
  "SECURITY_EMERGENCY_RESPONSE",
  "SENSITIVE_INFORMATION_ACCESS",
  "GENERAL_ROLE_SAFETY",
] as const;

export const roleSafetyConcernSchema = z.enum(ROLE_SAFETY_CONCERNS);

export const roleSafetyConcernsSchema = z
  .array(roleSafetyConcernSchema)
  .max(ROLE_SAFETY_CONCERNS.length);

export const profileDraftRequestSchema = z.object({
  revision: z.number().int().min(0),
});

export const pendingProfileSubmissionSchema = z.object({
  revision: z.number().int().min(0),
});

export const profileTextSchema = z.string().trim().min(50).max(6000);

export const profileApprovalSchema = z.object({
  profileText: profileTextSchema,
  approvalToken: z.string().min(43).max(512),
  consentVersion: z.literal(CONSENT_VERSION),
});

export const profileStatusSchema = z.enum([
  "ACTIVE",
  "PAUSED",
  "INACTIVE_STALE",
  "PENDING_PURGE",
]);
export const deliverabilitySchema = z.enum([
  "DELIVERABLE",
  "SOFT_BOUNCE",
  "HARD_BOUNCE",
  "COMPLAINT",
  "SUPPRESSED",
]);

export const searchQuerySchema = z.object({
  query: z.string().trim().min(3).max(1000),
});
export const SEARCH_RESULT_LIMIT = 10;
export const searchPlanSchema = z.object({
  semantic_query: z.string().trim().min(1).max(1000),
  exact_terms: z.array(z.string().trim().min(1).max(80)).max(12),
  excluded_concepts: z.array(z.string().trim().min(1).max(120)).max(8),
  cautions: z.array(z.string().trim().min(1).max(160)).max(8),
});

export const rerankerItemSchema = z.object({
  candidate_id: uuidSchema,
  relevance: z.enum(["HIGH", "MEDIUM", "LOW"]),
  reason: z.string().trim().min(1).max(500),
  evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(4),
  cautions: z.array(z.string().trim().min(1).max(300)).max(4),
});

export const rerankerOutputSchema = z.object({
  results: z.array(rerankerItemSchema).max(SEARCH_RESULT_LIMIT),
});

export const addEmailSchema = z.object({ email: emailSchema });
export const changeNameSchema = z.object({ displayName: displayNameSchema });
export const groupSchema = z.enum([
  "gis-admin",
  "gis-staff",
  "gis-ministry-leader",
  "gis-privacy-auditor",
  "gis-technical-admin",
]);

export type InterviewMessage = z.infer<
  typeof interviewMessageSchema
>["messages"][number];
export type InterviewCompleteness = z.infer<typeof interviewCompletenessSchema>;
export type InterviewFollowUpNotes = z.infer<
  typeof interviewFollowUpNotesSchema
>;
export type InterviewConversationMemory = z.infer<
  typeof interviewConversationMemorySchema
>;
export type RoleSafetyConcern = z.infer<typeof roleSafetyConcernSchema>;
export const ROLE_SAFETY_PROFILE_STATEMENTS: Readonly<
  Record<RoleSafetyConcern, string>
> = {
  INFANT_CARE:
    "Before considering this volunteer for infant care, staff should discuss a potential role-safety concern with the volunteer and review the role's safeguarding and supervision requirements.",
  CHILD_SUPERVISION:
    "Before considering this volunteer for child supervision, staff should discuss a potential role-safety concern with the volunteer and review the role's safeguarding and supervision requirements.",
  VULNERABLE_ADULT_CARE:
    "Before considering this volunteer for vulnerable-adult care, staff should discuss a potential role-safety concern with the volunteer and review the role's safeguarding and supervision requirements.",
  PASSENGER_TRANSPORT:
    "Before considering this volunteer for passenger transport, staff should discuss a potential role-safety concern with the volunteer and review the role's driving, screening, and supervision requirements.",
  FINANCIAL_HANDLING:
    "Before considering this volunteer for financial handling, staff should discuss a potential role-safety concern with the volunteer and review the role's screening and financial-control requirements.",
  PASTORAL_COUNSELING:
    "Before considering this volunteer for pastoral care, counseling, or mentoring, staff should discuss a potential role-safety concern with the volunteer and review the role's boundaries, safeguarding, and supervision requirements.",
  HOME_VISITATION:
    "Before considering this volunteer for home visitation, staff should discuss a potential role-safety concern with the volunteer and review the role's visitation, safeguarding, and check-in requirements.",
  FOOD_SERVICE:
    "Before considering this volunteer for food service, staff should discuss a potential role-safety concern with the volunteer and review the role's food-safety, allergy, and supervision requirements.",
  MEDICAL_FIRST_AID:
    "Before considering this volunteer for first-aid or medical-support roles, staff should discuss a potential role-safety concern with the volunteer and review the role's training, credential, scope, and emergency requirements.",
  FACILITIES_EQUIPMENT:
    "Before considering this volunteer for facilities or equipment work, staff should discuss a potential role-safety concern with the volunteer and review the role's training, authorization, protective-equipment, and worksite requirements.",
  SECURITY_EMERGENCY_RESPONSE:
    "Before considering this volunteer for security or emergency-response roles, staff should discuss a potential role-safety concern with the volunteer and review the role's training, authority, escalation, and emergency-plan requirements.",
  SENSITIVE_INFORMATION_ACCESS:
    "Before considering this volunteer for access to member records or privileged systems, staff should discuss a potential role-safety concern with the volunteer and review the role's authorization, data-handling, and least-privilege requirements.",
  GENERAL_ROLE_SAFETY:
    "Before placing this volunteer in any role, staff should discuss a potential role-safety concern with the volunteer and apply the role's screening, supervision, and safeguarding requirements.",
};
export type SearchPlan = z.infer<typeof searchPlanSchema>;
export type RerankerOutput = z.infer<typeof rerankerOutputSchema>;
export type ProfileStatus = z.infer<typeof profileStatusSchema>;
export type StaffGroup = z.infer<typeof groupSchema>;
