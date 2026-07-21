import { createHash } from "node:crypto";
import type {
  InterviewCompleteness,
  InterviewMessage,
  RerankerOutput,
  SearchPlan,
} from "@gis/shared";
import { detectHighRiskInput } from "./safety.js";
import type {
  AiAdapter,
  InterviewContext,
  InterviewTurn,
  ProfileDraft,
  RerankCandidate,
} from "./adapter.js";

function userMessages(messages: readonly InterviewMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);
}

interface InterviewCoverage {
  confidence: InterviewCompleteness;
  gaps: string[];
  hasContext: boolean;
  hasContribution: boolean;
  hasCadenceOrBoundary: boolean;
}

const LEGAL_ROLE = /\b(?:attorney|lawyer|legal counsel|practiced law)\b/iu;
const LEGAL_SPECIALTY =
  /\b(?:administrative|appellate|bankruptcy|civil|corporate|criminal|employment|estate planning|family|government|immigration|labor|litigation|municipal|probate|real estate|tax|transactional|trusts?)\b/iu;
const LEGAL_JURISDICTION =
  /\b(?:federal|state|county|municipal|tribal|military|jurisdiction|court system)\b|\b(?:in|within)\s+(?:the\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/u;
const EDUCATION_ROLE =
  /\b(?:teacher|administrator|principal|superintendent|counselor|librarian|professor|instructor|paraprofessional|curriculum specialist|coach)\b/iu;
const EDUCATION_CONTEXT =
  /\b(?:preschool|elementary|middle school|high school|college|university|adult learners?|grade|grades|students?|math|science|history|language arts|music|art|special education|curriculum)\b/iu;
const CONTRIBUTION =
  /\b(?:can|could|would|willing|prefer|enjoy|offer|offers|interested|open to|like to)\b[^.!?]{0,100}\b(?:advise|advice|teach|tutor|mentor|coach|troubleshoot|repair|build|maintain|review|draft|research|plan|organize|lead|manage|facilitate|design|write|translate|cook|serve|perform|coordinate|consult)\w*\b/iu;
const CADENCE =
  /\b(?:one[- ]time|occasional(?:ly)?|seasonal(?:ly)?|ongoing|weekly|monthly|regular(?:ly)?|as needed|short[- ]term|long[- ]term|weekends?|weekdays?|evenings?|daytime)\b/iu;
const BOUNDARY =
  /\b(?:only|prefer|rather|not|no |avoid|unable|cannot|can't|won't|limit|boundary|boundaries|decline)\b/iu;
const CONCRETE_CONTEXT =
  /\b(?:wordpress|react|accessibility|software|equipment|tools?|commercial|residential|kitchen|classroom|school|office|nonprofit|church|events?|accounting|bookkeeping|hvac|refrigeration|woodworking|sewing|gardening|photography|audio|video)\b/iu;

function assessCoverage(
  messages: readonly InterviewMessage[],
  currentProfile: string | null,
): InterviewCoverage {
  const answers = userMessages(messages);
  const supplied = answers.join(" ");
  const source = [currentProfile, supplied].filter(Boolean).join(" ");
  const hasDomain = source.trim().length >= 12;
  const hasContext =
    LEGAL_SPECIALTY.test(source) ||
    LEGAL_JURISDICTION.test(supplied) ||
    EDUCATION_ROLE.test(source) ||
    EDUCATION_CONTEXT.test(source) ||
    CONCRETE_CONTEXT.test(source) ||
    answers.length >= 2;
  const hasContribution = CONTRIBUTION.test(source);
  const hasCadence = CADENCE.test(source);
  const hasBoundary = BOUNDARY.test(source);
  const hasCadenceOrBoundary = hasCadence || hasBoundary;
  const gaps = [
    ...(!hasDomain ? ["a concrete skill or experience area"] : []),
    ...(!hasContext ? ["specific context or experience"] : []),
    ...(!hasContribution ? ["the kind of help they would consider"] : []),
    ...(!hasCadenceOrBoundary ? ["frequency or practical limits"] : []),
  ];
  const coreComplete =
    hasDomain && hasContext && hasContribution && hasCadenceOrBoundary;
  return {
    confidence: coreComplete
      ? hasCadence && hasBoundary
        ? "HIGH"
        : "MODERATE"
      : "LOW",
    gaps,
    hasContext,
    hasContribution,
    hasCadenceOrBoundary,
  };
}

function nextInterviewQuestion(
  messages: readonly InterviewMessage[],
  coverage: InterviewCoverage,
): string {
  const answers = userMessages(messages);
  const supplied = answers.join(" ");

  if (LEGAL_ROLE.test(supplied)) {
    const hasSpecialty = LEGAL_SPECIALTY.test(supplied);
    const hasJurisdiction = LEGAL_JURISDICTION.test(supplied);
    if (!hasSpecialty && !hasJurisdiction)
      return "What specialty or area of law did you practice, and in what jurisdiction?";
    if (!hasSpecialty) return "What specialty or area of law did you practice?";
    if (!hasJurisdiction) return "In what jurisdiction did you practice?";
    if (!coverage.hasContribution)
      return "Which parts of that experience might transfer to volunteering—for example, advising, reviewing documents, researching, teaching, or governance work?";
  }

  if (/\b(?:educator|education professional)\b/iu.test(supplied)) {
    if (!EDUCATION_ROLE.test(supplied))
      return "Were you primarily a teacher, an administrator, or in another education role?";
    if (!EDUCATION_CONTEXT.test(supplied))
      return "What subjects, age groups, or educational settings did you work with?";
    if (!coverage.hasContribution)
      return "Which parts of that experience would you enjoy using now—for example, tutoring, mentoring teachers, planning curriculum, or organizing programs?";
  }

  if (!coverage.hasContext)
    return "Could you tell me a little more about the specific tasks, tools, settings, or people involved?";
  if (!coverage.hasContribution)
    return "How would you most like to use that experience—advising, teaching, troubleshooting, planning, leading, or doing hands-on work?";
  if (!coverage.hasCadenceOrBoundary)
    return "Would one-time, occasional, seasonal, or ongoing help fit best, and are there practical limits you would want staff to know?";

  return "I have a solid picture of what you have shared. Is there another skill or interest you would like to add, or would you like me to prepare the profile for review?";
}

export class FakeAiAdapter implements AiAdapter {
  interview(
    messages: readonly InterviewMessage[],
    context: InterviewContext,
  ): Promise<InterviewTurn> {
    const latest =
      [...messages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    const safety = detectHighRiskInput(latest);
    if (safety)
      return Promise.resolve({
        action: "CONTINUE",
        message: safety.message,
        referenced_profile_text: null,
        completeness_confidence: context.previousCompletenessConfidence,
        coverage_gaps: [],
      });
    if (
      context.hasProposedProfile &&
      (/\b(submit|save|approve|finalize)\b/iu.test(latest) ||
        /\b(looks|sounds)\s+good\b/iu.test(latest) ||
        /\bgo ahead\b/iu.test(latest))
    )
      return Promise.resolve({
        action: "SUBMIT_PROFILE",
        message: "I will submit the exact proposed profile.",
        referenced_profile_text: null,
        completeness_confidence: context.previousCompletenessConfidence,
        coverage_gaps: [],
      });
    const coverage = assessCoverage(messages, context.currentProfile);
    if (
      /\b(create|prepare|show|write|revise|update)\b[\s\S]{0,40}\b(draft|profile|proposal)\b/iu.test(
        latest,
      ) ||
      /\b(?:wrap up|finish|done|nothing else|that(?:'s| is) all)\b/iu.test(
        latest,
      )
    )
      return Promise.resolve({
        action: "PROPOSE_PROFILE",
        message: "I will prepare the proposed profile.",
        referenced_profile_text: null,
        completeness_confidence: coverage.confidence,
        coverage_gaps: coverage.gaps,
      });
    return Promise.resolve({
      action: "CONTINUE",
      message: nextInterviewQuestion(messages, coverage),
      referenced_profile_text: null,
      completeness_confidence: coverage.confidence,
      coverage_gaps: coverage.gaps,
    });
  }

  async draft(
    messages: readonly InterviewMessage[],
    currentProfile?: string,
  ): Promise<ProfileDraft> {
    const facts = userMessages(messages)
      .filter((message) => detectHighRiskInput(message) === null)
      .map((message) => message.trim().replace(/\s+/g, " "))
      .filter((message) => message.length > 8);
    const base = currentProfile
      ? `Their current approved profile says: ${currentProfile}`
      : "";
    const supplied = facts.join(" ");
    const text = [
      base,
      supplied,
      "They may consider a future request but remain free to decline; all experience and qualifications are self-reported.",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 6000);
    return Promise.resolve({
      profile_text:
        text.length >= 50
          ? text
          : `${text} They are open to discussing suitable occasional volunteer needs.`,
      coverage_notes:
        "Check that the draft accurately preserves the kind of help and every boundary you described.",
    });
  }

  async planSearch(query: string): Promise<SearchPlan> {
    const words =
      query.toLocaleLowerCase("en-US").match(/[a-z0-9+#.-]{3,}/gu) ?? [];
    const stop = new Set([
      "someone",
      "could",
      "help",
      "with",
      "that",
      "this",
      "anyone",
      "understand",
    ]);
    const exactTerms = [
      ...new Set(words.filter((word) => !stop.has(word))),
    ].slice(0, 8);
    const cautions: string[] = [];
    if (/audit|license|electric|medical|nurse|children|teacher/iu.test(query)) {
      cautions.push(
        "Confirm any required current license, professional authority, or church screening separately.",
      );
    }
    return Promise.resolve({
      semantic_query: query,
      exact_terms: exactTerms,
      excluded_concepts: /do not|not assume|without/iu.test(query)
        ? ["Do not infer excluded qualifications"]
        : [],
      cautions,
    });
  }

  async rerank(
    query: string,
    plan: SearchPlan,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankerOutput> {
    const terms = [
      ...plan.exact_terms,
      ...query.toLocaleLowerCase("en-US").split(/\W+/u),
    ].filter((term) => term.length > 2);
    const results = candidates.map((candidate) => {
      const lower = candidate.approvedText.toLocaleLowerCase("en-US");
      const evidence = candidate.approvedText
        .split(/(?<=[.!?])\s+/u)
        .filter((sentence) =>
          terms.some((term) =>
            sentence.toLocaleLowerCase("en-US").includes(term),
          ),
        )
        .slice(0, 2);
      const hits = terms.filter((term) => lower.includes(term)).length;
      return {
        candidate_id: candidate.id,
        relevance:
          hits >= 3
            ? ("HIGH" as const)
            : hits > 0
              ? ("MEDIUM" as const)
              : ("LOW" as const),
        reason:
          hits > 0
            ? "The approved profile contains experience related to the request."
            : "The semantic retrieval found a possible connection.",
        evidence:
          evidence.length > 0
            ? evidence
            : [
                candidate.approvedText.slice(
                  0,
                  Math.min(180, candidate.approvedText.length),
                ),
              ],
        cautions: [...plan.cautions],
      };
    });
    return Promise.resolve({ results });
  }

  async embed(
    exactApprovedProse: string,
    dimension: number,
  ): Promise<number[]> {
    const vector = Array.from({ length: dimension }, () => 0);
    for (const token of exactApprovedProse
      .toLocaleLowerCase("en-US")
      .split(/\W+/u)
      .filter(Boolean)) {
      const digest = createHash("sha256").update(token).digest();
      const index = digest.readUInt32BE(0) % dimension;
      vector[index] =
        (vector[index] ?? 0) + ((digest[4] ?? 0) % 2 === 0 ? 1 : -1);
    }
    const magnitude =
      Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return Promise.resolve(vector.map((value) => value / magnitude));
  }
}
