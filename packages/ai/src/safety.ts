const SECRET_PATTERNS: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/u,
  /\b(?:password|passcode|pin|api[ -]?key|recovery code)\s*(?:is|:|=)/iu,
  /\b(?:routing|account|driver'?s license|passport)\s*(?:number|no\.?|#)?\s*[:=]?\s*[A-Z0-9-]{5,}\b/iu,
];

const PROFILE_PRIVATE_PATTERNS: readonly RegExp[] = [
  ...SECRET_PATTERNS,
  /\b\d{1,5}\s+[A-Za-z0-9.' -]+\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/iu,
  /\b(?:diagnosed with|my diagnosis is|I take \d*\s*mg|medication)\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/u,
];

export const SENSITIVE_INFORMATION_REJECTION_MESSAGE =
  "That response was not accepted because it appears to contain sensitive personal information, such as a Social Security number, account number, password, or other identification number. Gifts in Service does not need that information. Remove the sensitive information and try again.";

export const CONTENT_SAFETY_REJECTION_MESSAGE =
  "That response was not accepted because it triggered the privacy and safety filter. Remove sensitive, unsafe, or unrelated content and try again.";

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

export interface SafetyFinding {
  kind: "HIGH_RISK_SECRET" | "PROFILE_PRIVATE_DATA";
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

export function validateProposedProfile(text: string): SafetyFinding | null {
  return PROFILE_PRIVATE_PATTERNS.some((pattern) => pattern.test(text))
    ? {
        kind: "PROFILE_PRIVATE_DATA",
        message:
          "The draft may contain private detail that is not needed. Please make a revised draft that describes only relevant skills or functional boundaries.",
      }
    : null;
}
