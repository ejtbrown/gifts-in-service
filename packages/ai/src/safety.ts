import {
  ROLE_SAFETY_PROFILE_STATEMENTS,
  roleSafetyConcernsSchema,
  type InterviewMessage,
  type RoleSafetyConcern,
} from "@gis/shared";

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/u,
  /\b(?:password|passcode|pin|api[ -]?key|recovery code)\s*(?:is|:|=)/iu,
  /\b(?:routing|account|driver'?s license|passport)\s*(?:number|no\.?|#)?\s*[:=]?\s*[A-Z0-9-]{5,}\b/iu,
];

const PRIVATE_HEALTH_PATTERNS: readonly RegExp[] = [
  /\b(?:diagnos(?:is|ed)|medical condition|health condition|mental health condition|mental illness|psychiatric condition|prescription|medication|hospitali[sz]ed for|therapy for|treatment for)\b/iu,
  /\b(?:schizophren(?:ia|ic)|schizoaffective|bipolar(?: disorder)?|clinical depression|post[- ]traumatic stress(?: disorder)?|ptsd|obsessive[- ]compulsive disorder|ocd|attention[- ]deficit(?:\/hyperactivity)? disorder|adhd|dementia|alzheimer'?s|epilepsy|seizure disorder|multiple sclerosis|parkinson'?s|crohn'?s disease|lupus|hiv|aids)\b/iu,
  /\b(?:i|the volunteer|the member|they|he|she)\s+(?:have|has|had|am|is|are|was|were|live(?:s)? with|suffer(?:s|ed|ing)? from)\b[^.!?\n]{0,100}\b(?:disab(?:ility|led)|disorder|disease|syndrome|condition|cancer|diabetes|depression|anxiety)\b/iu,
  /\b(?:my|their|his|her)\s+(?:disab(?:ility|ilities)|symptoms?|treatment|medical|health|mental health|psychiatric)\b/iu,
];

const PROFILE_PRIVACY_REFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:hipaa|hippa)\b/iu,
  /\b(?:private|sensitive|confidential|privileged)\s+(?:(?:health|medical|personal)\s+)?(?:information|details?|disclosure)\b/iu,
];

const PROFILE_PRIVATE_PATTERNS: readonly RegExp[] = [
  ...SECRET_PATTERNS,
  ...PRIVATE_HEALTH_PATTERNS,
  ...PROFILE_PRIVACY_REFERENCE_PATTERNS,
  /\b\d{1,5}\s+[A-Za-z0-9.' -]+\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/iu,
  /\b(?:diagnosed with|my diagnosis is|I take \d*\s*mg|medication)\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/u,
];

export const PRIVATE_HEALTH_OMITTED_TRANSCRIPT_MESSAGE =
  "The application omitted a private health disclosure from this turn. The member must restate only the affected volunteer activity and a functional boundary.";

export const PRIVATE_HEALTH_FOLLOW_UP_MESSAGE =
  "I left out the private health detail and will not put it in your profile. Without repeating it, which volunteer activity does this affect, and would you prefer to rule that activity out or ask staff to discuss that activity’s objective requirements with you before considering placement?";

const ROLE_SAFETY_ACTIVITY_PATTERNS: Readonly<
  Record<RoleSafetyConcern, RegExp>
> = {
  INFANT_CARE:
    /\b(?:infant(?:s| care| childcare)?|bab(?:y|ies)|newborns?|church nursery|nursery care)\b/iu,
  CHILD_SUPERVISION:
    /\b(?:child(?:ren)?(?: care| supervision)|childcare|babysit(?:ting)?|children'?s ministry|youth supervision)\b/iu,
  VULNERABLE_ADULT_CARE:
    /\b(?:vulnerable adult care|elder care|elderly care|senior care|dependent adult care|caregiving for (?:an )?(?:elderly|vulnerable|dependent) adult)\b/iu,
  PASSENGER_TRANSPORT:
    /\b(?:passenger transport|transport(?:ing)? (?:people|members|children|youth|seniors)|driv(?:e|ing) (?:people|members|children|youth|seniors)|church van)\b/iu,
  FINANCIAL_HANDLING:
    /\b(?:financial handling|handling (?:cash|money|donations|offerings)|counting (?:cash|money|donations|offerings)|bookkeeping|church finances)\b/iu,
};

const GROUNDED_ROLE_SAFETY_PATTERNS: readonly RegExp[] = [
  /\b(?:do(?:es)? not|don't|doesn't|did not|didn't|would not|wouldn't|cannot|can't|should not|shouldn't)\b[^.!?\n]{0,100}\b(?:trust|feel safe|consider (?:me|them|him|her) safe|rely on)\b/iu,
  /\b(?:family|mothers?|fathers?|parents?|brothers?|sisters?|siblings?|spouse|wives?|husbands?|partners?|sons?|daughters?|relatives?|loved ones?|people (?:close to|who know) (?:me|them|him|her))\b[^.!?\n]{0,160}\b(?:warn(?:s|ed)? against|question(?:s|ed)? (?:my|their|his|her) judgment|refus(?:e|es|ed) to (?:allow|let|leave|entrust|permit)|(?:do(?:es)? not|don't|doesn't|will not|won't|would not|wouldn't) (?:allow|let|leave|entrust|permit))\b/iu,
  /\b(?:I|the member|the volunteer|they|he|she)\b[^.!?\n]{0,80}\b(?:cannot safely|can't safely|may be unsafe|might be unsafe|(?:am|is|are|was|were) unsafe|(?:should not|shouldn't|must not)\b(?![^.!?\n]{0,40}\brule out\b)[^.!?\n]{0,40}\b(?:care|watch|supervise|drive|transport|handle|serve|be alone))\b/iu,
  /\b(?:barred|prohibited|forbidden|not allowed|restricted)\b[^.!?\n]{0,100}\b(?:from|to|around|with)\b/iu,
  /\b(?:a safety risk|a danger|risk of harm|credible safety concern|serious safety concern|role-safety concern|(?:raised?|identified?|multiple|several) red flags?)\b/iu,
];

const CLOSE_RELATIONSHIP_PATTERN =
  /\b(?:family|mothers?|fathers?|parents?|brothers?|sisters?|siblings?|spouse|wives?|husbands?|partners?|sons?|daughters?|relatives?|loved ones?)\b/iu;
const RELATIONSHIP_REFUSAL_PATTERN =
  /\b(?:they|he|she|a family member|a relative)\b[^.!?\n]{0,60}\b(?:do(?:es)? not|don't|doesn't|will not|won't|would not|wouldn't|refus(?:e|es|ed) to)\b[^.!?\n]{0,30}\b(?:allow|let|leave|entrust|permit)\b/iu;

const ROLE_SAFETY_MANIPULATION_PATTERNS: readonly RegExp[] = [
  /\b(?:remove|omit|ignore|delete|hide|drop|erase|leave out|do not mention|don't mention)\b[^.!?\n]{0,100}\b(?:concern|caution|warning|red flag|safety|safeguarding)\b/iu,
  /\b(?:concern|caution|warning|red flag|safety|safeguarding)\b[^.!?\n]{0,100}\b(?:remove|omit|ignore|delete|hide|drop|erase|leave out)\b/iu,
];

export const OMITTED_PROFILE_SOURCE_MESSAGE =
  "This turn was omitted from profile source material.";

export const SENSITIVE_INFORMATION_REJECTION_MESSAGE =
  "That response was not accepted because it appears to contain sensitive personal information, such as a Social Security number, account number, password, or other identification number. Gifts in Service does not need that information. Remove the sensitive information and try again.";

export const CONTENT_SAFETY_REJECTION_MESSAGE =
  "That response was not accepted because it triggered the privacy and safety filter. Remove sensitive, unsafe, or unrelated content and try again.";

export const MALFORMED_INTERVIEW_RESPONSE_MESSAGE =
  "The assistant could not respond after several attempts. Your response was not saved. Please try again.";

export const MALFORMED_PROFILE_DRAFT_RESPONSE_MESSAGE =
  "The assistant could not prepare a privacy-safe profile after several attempts. Nothing was saved. Please try again.";

export class AiSafetyInterventionError extends Error {
  override readonly name = "AiSafetyInterventionError";

  constructor(readonly category: "SENSITIVE_INFORMATION" | "CONTENT_SAFETY") {
    super(
      category === "SENSITIVE_INFORMATION"
        ? SENSITIVE_INFORMATION_REJECTION_MESSAGE
        : CONTENT_SAFETY_REJECTION_MESSAGE,
    );
  }
}

export class AiMalformedInterviewResponseError extends Error {
  override readonly name = "AiMalformedInterviewResponseError";

  constructor() {
    super(MALFORMED_INTERVIEW_RESPONSE_MESSAGE);
  }
}

export class AiMalformedProfileDraftResponseError extends Error {
  override readonly name = "AiMalformedProfileDraftResponseError";

  constructor() {
    super(MALFORMED_PROFILE_DRAFT_RESPONSE_MESSAGE);
  }
}

export interface SafetyFinding {
  kind:
    | "HIGH_RISK_SECRET"
    | "PRIVATE_HEALTH_DATA"
    | "PROFILE_PRIVATE_DATA"
    | "PROFILE_REQUIRED_SAFETY_CONTEXT";
  message: string;
}

export function mergeRoleSafetyConcerns(
  ...groups: readonly (readonly RoleSafetyConcern[])[]
): RoleSafetyConcern[] {
  return roleSafetyConcernsSchema.parse([...new Set(groups.flat())]);
}

export function detectRoleSafetyConcerns(text: string): RoleSafetyConcern[] {
  const grounded =
    GROUNDED_ROLE_SAFETY_PATTERNS.some((pattern) => pattern.test(text)) ||
    (CLOSE_RELATIONSHIP_PATTERN.test(text) &&
      RELATIONSHIP_REFUSAL_PATTERN.test(text));
  if (!grounded) return [];
  return roleSafetyConcernsSchema.parse(
    Object.entries(ROLE_SAFETY_ACTIVITY_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([concern]) => concern),
  );
}

export function deriveRoleSafetyConcerns(
  messages: readonly InterviewMessage[],
  currentProfile?: string | null,
): RoleSafetyConcern[] {
  const fromMessages = messages
    .filter((message) => message.role === "user")
    .flatMap((message) => detectRoleSafetyConcerns(message.content));
  const fromProfile = currentProfile
    ? (Object.entries(ROLE_SAFETY_PROFILE_STATEMENTS)
        .filter(([, statement]) => currentProfile.includes(statement))
        .map(([concern]) => concern) as RoleSafetyConcern[])
    : [];
  return mergeRoleSafetyConcerns(fromMessages, fromProfile);
}

export function roleSafetyConcernAcknowledgement(
  concerns: readonly RoleSafetyConcern[],
  privateHealthOmitted = false,
): string {
  const labels = concerns.map((concern) => {
    switch (concern) {
      case "INFANT_CARE":
        return "infant care";
      case "CHILD_SUPERVISION":
        return "child supervision";
      case "VULNERABLE_ADULT_CARE":
        return "vulnerable-adult care";
      case "PASSENGER_TRANSPORT":
        return "passenger transport";
      case "FINANCIAL_HANDLING":
        return "financial handling";
    }
  });
  const roleList = new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(labels);
  const privacyPrefix = privateHealthOmitted
    ? "I left out the private health detail and will not put it in your profile. "
    : "";
  return `${privacyPrefix}Your response also raised a concrete role-safety concern related to ${roleList}. The proposed profile will tell staff to discuss that concern and the role's objective safeguarding requirements before considering placement. That neutral caution will remain in this interview even if you later ask to remove it; it will not include the underlying private detail.`;
}

export function applyRequiredRoleSafetyStatements(
  text: string,
  concerns: readonly RoleSafetyConcern[],
): string {
  const required = mergeRoleSafetyConcerns(concerns)
    .map((concern) => ROLE_SAFETY_PROFILE_STATEMENTS[concern])
    .filter((statement) => !text.includes(statement));
  if (required.length === 0) return text;
  const appendix = required.join("\n\n");
  const maximumBaseLength = Math.max(0, 6000 - appendix.length - 2);
  const base = text.trim().slice(0, maximumBaseLength).trimEnd();
  return `${base}\n\n${appendix}`.trim();
}

export function validateRequiredRoleSafetyStatements(
  text: string,
  concerns: readonly RoleSafetyConcern[],
): SafetyFinding | null {
  return mergeRoleSafetyConcerns(concerns).some(
    (concern) => !text.includes(ROLE_SAFETY_PROFILE_STATEMENTS[concern]),
  )
    ? {
        kind: "PROFILE_REQUIRED_SAFETY_CONTEXT",
        message:
          "The draft is missing required, diagnosis-free role-safety context. Please create a new draft before submitting.",
      }
    : null;
}

export function detectHighRiskInput(text: string): SafetyFinding | null {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
    ? {
        kind: "HIGH_RISK_SECRET",
        message: SENSITIVE_INFORMATION_REJECTION_MESSAGE,
      }
    : null;
}

export function detectPrivateHealthInput(text: string): SafetyFinding | null {
  return PRIVATE_HEALTH_PATTERNS.some((pattern) => pattern.test(text))
    ? {
        kind: "PRIVATE_HEALTH_DATA",
        message: PRIVATE_HEALTH_FOLLOW_UP_MESSAGE,
      }
    : null;
}

export function validateProposedProfile(text: string): SafetyFinding | null {
  return PROFILE_PRIVATE_PATTERNS.some((pattern) => pattern.test(text))
    ? {
        kind: "PROFILE_PRIVATE_DATA",
        message:
          "The draft may contain private detail that is not needed. Please make a revised draft that describes only relevant skills or functional boundaries.",
      }
    : null;
}

export function sanitizeProfileDraftMessages(
  messages: readonly InterviewMessage[],
): InterviewMessage[] {
  return messages.map((message) =>
    PROFILE_PRIVATE_PATTERNS.some((pattern) => pattern.test(message.content)) ||
    detectRoleSafetyConcerns(message.content).length > 0 ||
    ROLE_SAFETY_MANIPULATION_PATTERNS.some((pattern) =>
      pattern.test(message.content),
    )
      ? { ...message, content: OMITTED_PROFILE_SOURCE_MESSAGE }
      : message,
  );
}

export function sanitizePendingHealthMessages(
  messages: readonly InterviewMessage[],
): InterviewMessage[] {
  return messages.map((message) => {
    if (
      message.content === PRIVATE_HEALTH_OMITTED_TRANSCRIPT_MESSAGE ||
      message.content === PRIVATE_HEALTH_FOLLOW_UP_MESSAGE ||
      (message.role === "assistant" &&
        message.content.startsWith(
          "I left out the private health detail and will not put it in your profile. Your response also raised a concrete role-safety concern",
        ))
    )
      return message;
    return [
      ...PRIVATE_HEALTH_PATTERNS,
      ...PROFILE_PRIVACY_REFERENCE_PATTERNS,
    ].some((pattern) => pattern.test(message.content))
      ? {
          ...message,
          content:
            message.role === "user"
              ? PRIVATE_HEALTH_OMITTED_TRANSCRIPT_MESSAGE
              : PRIVATE_HEALTH_FOLLOW_UP_MESSAGE,
        }
      : message;
  });
}

export function sanitizeApprovedProfileSource(text: string): string | null {
  const safeSentences = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter(
      (sentence) =>
        !PROFILE_PRIVATE_PATTERNS.some((pattern) => pattern.test(sentence)),
    );
  const sanitized = safeSentences.join(" ").trim();
  return sanitized.length > 0 ? sanitized : null;
}
