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
  Partial<Record<RoleSafetyConcern, RegExp>>
> = {
  INFANT_CARE:
    /\b(?:infant(?:s| care| childcare)?|bab(?:y|ies)|newborns?|church nursery|nursery care)\b/iu,
  CHILD_SUPERVISION:
    /\b(?:child(?:ren)?(?: care| supervision)|childcare|babysit(?:ting)?|children'?s ministry|youth (?:group|ministry|supervision)|sunday school|vacation bible school|vbs|work(?:ing)? with (?:children|youth)|teach(?:ing)? (?:children|youth)|coach(?:ing)? (?:children|youth))\b/iu,
  VULNERABLE_ADULT_CARE:
    /\b(?:vulnerable adult care|elder care|elderly care|senior care|dependent adult care|caregiving for (?:an )?(?:elderly|vulnerable|dependent) adult|(?:support(?:ing)?|serv(?:e|ing)|work(?:ing)? with) (?:vulnerable|dependent|frail|homebound) adults?)\b/iu,
  PASSENGER_TRANSPORT:
    /\b(?:passenger transport|transport(?:ing)? (?:people|members|children|youth|seniors|volunteers)|driv(?:e|ing) (?:people|members|children|youth|seniors|volunteers)|giv(?:e|ing) rides?|church (?:bus|shuttle|van)|van driver)\b/iu,
  FINANCIAL_HANDLING:
    /\b(?:financial handling|handling (?:cash|money|donations|offerings)|counting (?:cash|money|donations|offerings)|bookkeeping|church finances|church treasurer|expense approvals?|purchase cards?|bank(?:ing)? access|reimbursements?)\b/iu,
  PASTORAL_COUNSELING:
    /\b(?:pastoral (?:care|counseling|counselling)|spiritual (?:care|direction|counseling|counselling)|prayer ministry|lay counsel(?:ing|ling)|peer counsel(?:ing|ling)|grief support|support group facilitat(?:e|ion|or)|mentor(?:ing)?|one[- ](?:to[- ]one|on[- ]one) (?:ministry|support|counseling|counselling|mentoring))\b/iu,
  HOME_VISITATION:
    /\b(?:home visits?|home visitation|homebound ministry|visit(?:ing)? (?:members|parishioners|people|seniors|the sick|the homebound) (?:at|in) (?:their )?homes?|hospital visitation|nursing[- ]home visits?|tak(?:e|ing) communion to (?:the )?homebound)\b/iu,
  FOOD_SERVICE:
    /\b(?:food (?:service|preparation|prep|handling|pantry)|church kitchen|community meals?|meal ministry|cook(?:ing)? (?:for|at) (?:church|events?|groups?|the congregation)|serv(?:e|ing) (?:food|meals)|potluck coordination|kitchen volunteer)\b/iu,
  MEDICAL_FIRST_AID:
    /\b(?:first[- ]aid|medical (?:support|care|team)|health ministry|parish nurs(?:e|ing)|administer(?:ing)? (?:medication|medicine)|medication administration|emergency medical response|aed|cpr)\b/iu,
  FACILITIES_EQUIPMENT:
    /\b(?:building maintenance|facilit(?:y|ies) (?:work|maintenance|repair)|repair work|construction|electrical work|plumbing|roof(?:ing)?|ladder work|power tools?|groundskeeping|landscaping|snow removal|heavy equipment|stage rigging|equipment maintenance)\b/iu,
  SECURITY_EMERGENCY_RESPONSE:
    /\b(?:church security|security team|safety team|armed security|emergency response|evacuation (?:team|leader)|fire watch|traffic control|parking[- ]lot security|incident response|emergency planning)\b/iu,
  SENSITIVE_INFORMATION_ACCESS:
    /\b(?:member records?|confidential records?|personal data|church database|church directory data|pastoral records?|counseling records?|donor records?|background[- ]check records?|database administrat(?:ion|or)|systems? administrat(?:ion|or)|IT admin(?:istration|istrator)?|admin(?:istrative)? access|privileged access|account access|computer security|cybersecurity|information security|website admin(?:istration|istrator)?|email admin(?:istration|istrator)?)\b/iu,
};

const GROUNDED_ROLE_SAFETY_PATTERNS: readonly RegExp[] = [
  /\b(?:do(?:es)? not|don't|doesn't|did not|didn't|would not|wouldn't|cannot|can't|should not|shouldn't)\b[^.!?\n]{0,100}\b(?:trust|feel safe|consider (?:me|them|him|her) safe|rely on)\b/iu,
  /\b(?:family|mothers?|fathers?|parents?|brothers?|sisters?|siblings?|spouse|wives?|husbands?|partners?|sons?|daughters?|relatives?|loved ones?|people (?:close to|who know) (?:me|them|him|her))\b[^.!?\n]{0,160}\b(?:warn(?:s|ed)? against|question(?:s|ed)? (?:my|their|his|her) judgment|refus(?:e|es|ed) to (?:allow|let|leave|entrust|permit)|(?:do(?:es)? not|don't|doesn't|will not|won't|would not|wouldn't) (?:allow|let|leave|entrust|permit))\b/iu,
  /\b(?:I|the member|the volunteer|they|he|she)\b[^.!?\n]{0,80}\b(?:cannot safely|can't safely|may be unsafe|might be unsafe|(?:am|is|are|was|were) unsafe|(?:should not|shouldn't|must not)\b(?![^.!?\n]{0,40}\brule out\b)[^.!?\n]{0,40}\b(?:care|watch|supervise|drive|transport|handle|serve|be alone))\b/iu,
  /\b(?:barred|prohibited|forbidden|not allowed|restricted)\b[^.!?\n]{0,100}\b(?:from|to|around|with)\b/iu,
  /\b(?:a safety risk|a danger|risk of harm|credible safety concern|serious safety concern|role-safety concern|(?:raised?|identified?|multiple|several) red flags?)\b/iu,
  /\bI\s+(?:refuse|decline)\s+(?:to\s+)?(?:(?:complete|take|accept|follow|submit to|undergo|agree to|cooperate with)\s+)?(?:a\s+)?(?:background check|screening|safeguarding training|safety training|supervision|two[- ]adult rule|code of conduct|boundary rules?|safety (?:rules?|procedures?|checks?))\b/iu,
  /\bI\s+(?:will not|won't|do not|don't)\s+(?:complete|take|accept|follow|submit to|undergo|agree to|cooperate with)\s+(?:a\s+)?(?:background check|screening|safeguarding training|safety training|supervision|two[- ]adult rule|code of conduct|boundary rules?|safety (?:rules?|procedures?|checks?))\b/iu,
  /\bI\s+(?:prefer|want|need|insist on)\b[^.!?\n]{0,60}\b(?:be(?:ing)?|work(?:ing)?|meet(?:ing)?|spend(?:ing)? time)\b[^.!?\n]{0,40}\b(?:alone|privately|unobserved|unmonitored|unsupervised)\b/iu,
];

const GENERAL_GROUNDED_ROLE_SAFETY_PATTERNS: readonly RegExp[] = [
  /\bI\s+(?:(?:have|had)\s+)?(?:(?:once|previously|repeatedly)\s+)?(?:assaulted|attacked|physically harmed|hit|punched|choked|stalked|sexually harassed|sexually abused|molested)\b[^.!?\n]{0,80}\b(?:someone|a person|people|another person|a child|children|an adult|a coworker|a volunteer|a member)\b/iu,
  /\bI\s+(?:(?:have|had)\s+)?(?:(?:once|previously|repeatedly)\s+)?(?:stole|embezzled|misused|diverted)\b[^.!?\n]{0,60}\b(?:money|cash|funds|donations|offerings|property|a purchase card)\b/iu,
  /\bI\s+(?:made|make|have made)\s+(?:a\s+)?(?:credible\s+)?threats?\b[^.!?\n]{0,80}\b(?:harm|hurt|kill|attack|violence|someone|people|a person)\b/iu,
  /\bI\s+(?:want|plan|intend|am going)\s+to\s+(?:harm|hurt|kill|attack)\b[^.!?\n]{0,50}\b(?:someone|people|a person|a member|a volunteer)\b/iu,
  /\bI\s+(?:was|have been|had been)\s+(?:removed|dismissed|suspended|barred|banned|disciplined)\b[^.!?\n]{0,100}\b(?:safety|safeguarding|misconduct|violence|harassment|abuse|theft|boundary violations?)\b/iu,
  /\bI\s+(?:have|had)\s+(?:a\s+)?history of\s+(?:violence|assault|harassment|abuse|theft|safety violations?|boundary violations?)\b/iu,
  /\bI\s+(?:volunteer|work|serve|drive|supervise|provide care)\b[^.!?\n]{0,60}\b(?:while|when)\s+(?:drunk|high|intoxicated|impaired)\b/iu,
  /\bI\s+(?:ignore|disregard|bypass|disable|break)\b[^.!?\n]{0,60}\b(?:safeguarding|safety|supervision|access control|privacy|food[- ]safety|allergy|medication)\b[^.!?\n]{0,30}\b(?:rules?|procedures?|checks?|controls?|requirements?|instructions?|protections?)\b/iu,
  /\bI\s+(?:refuse|decline)\s+(?:to\s+)?(?:(?:complete|take|accept|follow|submit to|undergo|agree to|cooperate with)\s+)?(?:a\s+)?(?:background check|screening|safeguarding training|safety training|supervision|two[- ]adult rule|code of conduct|boundary rules?|safety (?:rules?|procedures?|checks?))\b/iu,
  /\bI\s+(?:will not|won't|do not|don't)\s+(?:complete|take|accept|follow|submit to|undergo|agree to|cooperate with)\s+(?:a\s+)?(?:background check|screening|safeguarding training|safety training|supervision|two[- ]adult rule|code of conduct|boundary rules?|safety (?:rules?|procedures?|checks?))\b/iu,
];

const ROLE_SPECIFIC_INCIDENT_PATTERNS: Readonly<
  Partial<Record<RoleSafetyConcern, readonly RegExp[]>>
> = {
  INFANT_CARE: [
    /\bI\s+(?:(?:have|had)\s+)?(?:left|leave)\b[^.!?\n]{0,40}\b(?:an?\s+)?(?:infant|baby|newborn)\b[^.!?\n]{0,30}\b(?:alone|unattended|unsupervised)\b/iu,
  ],
  CHILD_SUPERVISION: [
    /\bI\s+(?:(?:have|had)\s+)?(?:left|leave)\b[^.!?\n]{0,40}\b(?:a\s+)?(?:child|children|youth)\b[^.!?\n]{0,30}\b(?:alone|unattended|unsupervised)\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?lost track of\b[^.!?\n]{0,40}\b(?:a\s+)?(?:child|children|youth)\b/iu,
  ],
  VULNERABLE_ADULT_CARE: [
    /\bI\s+(?:(?:have|had)\s+)?(?:left|leave)\b[^.!?\n]{0,40}\b(?:a\s+)?(?:vulnerable|dependent|frail)\s+adult\b[^.!?\n]{0,30}\b(?:alone|unattended|unsupervised)\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?lost track of\b[^.!?\n]{0,40}\b(?:a\s+)?(?:vulnerable|dependent|frail)\s+adult\b/iu,
  ],
  PASSENGER_TRANSPORT: [
    /\b(?:my\s+)?driver'?s license\s+(?:is|was|has been|had been)\s+(?:suspended|revoked)\b/iu,
    /\bI\s+(?:drive|drove|have driven)\b[^.!?\n]{0,50}\b(?:passengers?|people|members|children|youth|seniors)\b[^.!?\n]{0,40}\b(?:drunk|high|intoxicated|impaired|without (?:a\s+)?(?:valid )?license)\b/iu,
  ],
  FINANCIAL_HANDLING: [
    /\bI\s+(?:(?:have|had)\s+)?(?:stole|embezzled|misused|diverted|falsified)\b[^.!?\n]{0,60}\b(?:money|cash|funds|donations|offerings|expenses?|reimbursements?|a purchase card)\b/iu,
  ],
  PASTORAL_COUNSELING: [
    /\bI\s+(?:(?:have|had)\s+)?(?:violated|ignored|crossed)\b[^.!?\n]{0,60}\b(?:pastoral|counseling|counselling|mentoring|confidentiality|professional)\b[^.!?\n]{0,30}\b(?:boundaries|confidence|confidentiality|rules?|standards?)\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?disclosed\b[^.!?\n]{0,60}\b(?:pastoral|counseling|counselling|mentoring)\b[^.!?\n]{0,30}\b(?:confidences?|information|records?)\b[^.!?\n]{0,30}\bwithout (?:permission|authorization)\b/iu,
  ],
  HOME_VISITATION: [
    /\bI\s+(?:(?:have|had)\s+)?(?:entered|went into|remained in)\b[^.!?\n]{0,50}\b(?:someone'?s|a member'?s|a parishioner'?s|their)\s+home\b[^.!?\n]{0,40}\bwithout (?:permission|authorization|an appointment)\b/iu,
  ],
  FOOD_SERVICE: [
    /\bI\s+(?:(?:have|had)\s+)?(?:ignored|disregarded)\b[^.!?\n]{0,60}\b(?:allerg(?:y|ies)|allergen instructions?|cross[- ]contamination|food[- ]safety|unsafe food|expired food)\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?served\b[^.!?\n]{0,60}\b(?:a known allergen|food containing an allergen|unsafe food|expired food)\b/iu,
  ],
  MEDICAL_FIRST_AID: [
    /\bI\s+(?:(?:have|had)\s+)?(?:gave|administered|mixed up|misused)\b[^.!?\n]{0,50}\b(?:the wrong )?(?:medication|medicine|dose|first[- ]aid treatment)\b/iu,
  ],
  FACILITIES_EQUIPMENT: [
    /\bI\s+(?:(?:have|had)\s+)?(?:disabled|removed|ignored|bypassed|worked without)\b[^.!?\n]{0,60}\b(?:safety guards?|lockouts?|protective equipment|ppe|worksite rules?|equipment checks?)\b/iu,
  ],
  SECURITY_EMERGENCY_RESPONSE: [
    /\bI\s+(?:(?:have|had)\s+)?used\b[^.!?\n]{0,30}\b(?:excessive|unnecessary) force\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?threatened\b[^.!?\n]{0,50}\b(?:someone|people|a person|a member|a volunteer)\b[^.!?\n]{0,30}\bwith (?:a\s+)?weapon\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?escalated\b[^.!?\n]{0,60}\b(?:a confrontation|an incident|a dispute)\b[^.!?\n]{0,30}\b(?:to|into) violence\b/iu,
  ],
  SENSITIVE_INFORMATION_ACCESS: [
    /\bI\s+(?:(?:have|had)\s+)?misused\b[^.!?\n]{0,60}\b(?:confidential|private|member|donor|pastoral|counseling|personal)\b[^.!?\n]{0,30}\b(?:data|information|records?|files?|accounts?)\b/iu,
    /\bI\s+(?:(?:have|had)\s+)?(?:shared|disclosed|accessed|copied|downloaded)\b[^.!?\n]{0,60}\b(?:confidential|private|member|donor|pastoral|counseling|personal)\b[^.!?\n]{0,30}\b(?:data|information|records?|files?|accounts?)\b[^.!?\n]{0,30}\b(?:without (?:permission|authorization)|improperly|inappropriately)\b/iu,
  ],
};

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
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const groundedSentences = sentences.filter(
    (sentence) =>
      GROUNDED_ROLE_SAFETY_PATTERNS.some((pattern) => pattern.test(sentence)) ||
      GENERAL_GROUNDED_ROLE_SAFETY_PATTERNS.some((pattern) =>
        pattern.test(sentence),
      ) ||
      (CLOSE_RELATIONSHIP_PATTERN.test(sentence) &&
        RELATIONSHIP_REFUSAL_PATTERN.test(sentence)),
  );
  const relationshipRefusalWindows = sentences
    .slice(0, -1)
    .map((sentence, index) => `${sentence} ${sentences[index + 1]}`)
    .filter(
      (window) =>
        CLOSE_RELATIONSHIP_PATTERN.test(window) &&
        RELATIONSHIP_REFUSAL_PATTERN.test(window),
    );
  const roleSpecific = Object.entries(ROLE_SAFETY_ACTIVITY_PATTERNS)
    .filter(([concern, activityPattern]) => {
      const typedConcern = concern as RoleSafetyConcern;
      return (
        groundedSentences.some((sentence) => activityPattern.test(sentence)) ||
        relationshipRefusalWindows.some((window) =>
          activityPattern.test(window),
        ) ||
        (ROLE_SPECIFIC_INCIDENT_PATTERNS[typedConcern] ?? []).some((pattern) =>
          pattern.test(text),
        )
      );
    })
    .map(([concern]) => concern as RoleSafetyConcern);
  const generalGrounded = GENERAL_GROUNDED_ROLE_SAFETY_PATTERNS.some(
    (pattern) => pattern.test(text),
  );
  return roleSafetyConcernsSchema.parse([
    ...roleSpecific,
    ...(generalGrounded && roleSpecific.length === 0
      ? (["GENERAL_ROLE_SAFETY"] as const)
      : []),
  ]);
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
      case "PASTORAL_COUNSELING":
        return "pastoral care, counseling, or mentoring";
      case "HOME_VISITATION":
        return "home visitation";
      case "FOOD_SERVICE":
        return "food service";
      case "MEDICAL_FIRST_AID":
        return "first-aid or medical-support roles";
      case "FACILITIES_EQUIPMENT":
        return "facilities or equipment work";
      case "SECURITY_EMERGENCY_RESPONSE":
        return "security or emergency-response roles";
      case "SENSITIVE_INFORMATION_ACCESS":
        return "access to member records or privileged systems";
      case "GENERAL_ROLE_SAFETY":
        return "volunteer placement generally";
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
