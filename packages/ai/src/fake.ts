import { createHash } from "node:crypto";
import type { InterviewMessage, RerankerOutput, SearchPlan } from "@gis/shared";
import { detectHighRiskInput } from "./safety.js";
import type {
  AiAdapter,
  InterviewTurn,
  ProfileDraft,
  RerankCandidate,
} from "./adapter.js";

const interviewQuestions = [
  "What work, practical abilities, hobbies, or earlier volunteer experience would you be comfortable sharing?",
  "Could you add a little context about the tools, equipment, software, settings, or age groups involved?",
  "Would you prefer to advise, teach, troubleshoot, plan, lead, or do hands-on work?",
  "Are one-time, occasional, seasonal, or ongoing requests a good fit, and are there boundaries staff should know?",
  "I have enough to prepare a draft. Would you like me to create the profile for your review?",
];

function userMessages(messages: readonly InterviewMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);
}

export class FakeAiAdapter implements AiAdapter {
  interview(
    messages: readonly InterviewMessage[],
    hasProposedProfile: boolean,
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
      });
    if (
      hasProposedProfile &&
      (/\b(submit|save|approve|finalize)\b/iu.test(latest) ||
        /\b(looks|sounds)\s+good\b/iu.test(latest) ||
        /\bgo ahead\b/iu.test(latest))
    )
      return Promise.resolve({
        action: "SUBMIT_PROFILE",
        message: "I will submit the exact proposed profile.",
        referenced_profile_text: null,
      });
    if (
      /\b(create|prepare|show|write|revise|update)\b[\s\S]{0,40}\b(draft|profile|proposal)\b/iu.test(
        latest,
      ) ||
      userMessages(messages).length >= 4
    )
      return Promise.resolve({
        action: "PROPOSE_PROFILE",
        message: "I will prepare the proposed profile.",
        referenced_profile_text: null,
      });
    const turn = Math.min(
      userMessages(messages).length - 1,
      interviewQuestions.length - 1,
    );
    return Promise.resolve({
      action: "CONTINUE",
      message:
        interviewQuestions[Math.max(0, turn)] ??
        interviewQuestions[0] ??
        "What would you like staff to know?",
      referenced_profile_text: null,
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
