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
    .max(25)
    .refine(
      (messages) =>
        messages.reduce(
          (total, message) => total + message.content.length,
          0,
        ) <= 24_000,
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
export type SearchPlan = z.infer<typeof searchPlanSchema>;
export type RerankerOutput = z.infer<typeof rerankerOutputSchema>;
export type ProfileStatus = z.infer<typeof profileStatusSchema>;
export type StaffGroup = z.infer<typeof groupSchema>;
