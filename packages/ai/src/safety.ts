import type { InterviewMessage } from "@gis/shared";

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
  kind: "HIGH_RISK_SECRET" | "PRIVATE_HEALTH_DATA" | "PROFILE_PRIVATE_DATA";
  message: string;
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
    PROFILE_PRIVATE_PATTERNS.some((pattern) => pattern.test(message.content))
      ? { ...message, content: OMITTED_PROFILE_SOURCE_MESSAGE }
      : message,
  );
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
