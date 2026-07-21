import type {
  InterviewCompleteness,
  InterviewMessage,
  RerankerOutput,
  SearchPlan,
} from "@gis/shared";

export const PROMPT_VERSIONS = {
  interviewer: "interviewer-2026-07-21.v5",
  profileDrafter: "profile-drafter-2026-07-15.v1",
  searchPlanner: "search-planner-2026-07-15.v1",
  searchReranker: "search-reranker-2026-07-19.v2",
} as const;

export interface ProfileDraft {
  profile_text: string;
  coverage_notes: string;
}

export interface InterviewTurn {
  action:
    | "CONTINUE"
    | "PROPOSE_PROFILE"
    | "SUBMIT_PROFILE"
    | "REQUEST_PROFILE_DELETION";
  message: string;
  referenced_profile_text: string | null;
  invalidate_proposed_profile: boolean;
  completeness_confidence: InterviewCompleteness;
  follow_up_notes: string[];
}

export interface InterviewContext {
  hasProposedProfile: boolean;
  previousCompletenessConfidence: InterviewCompleteness;
  previousFollowUpNotes: string[];
  currentProfile: string | null;
}

export interface RerankCandidate {
  id: string;
  approvedText: string;
}

export interface AiAdapter {
  interview(
    messages: readonly InterviewMessage[],
    context: InterviewContext,
  ): Promise<InterviewTurn>;
  draft(
    messages: readonly InterviewMessage[],
    currentProfile?: string,
  ): Promise<ProfileDraft>;
  planSearch(query: string): Promise<SearchPlan>;
  rerank(
    query: string,
    plan: SearchPlan,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankerOutput>;
  embed(exactApprovedProse: string, dimension: number): Promise<number[]>;
}
