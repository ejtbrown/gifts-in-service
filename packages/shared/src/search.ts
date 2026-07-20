export interface RankedItem {
  id: string;
  rank: number;
}

export interface FusedItem {
  id: string;
  score: number;
  matchedLists: number;
}

export function reciprocalRankFusion(
  lists: readonly (readonly RankedItem[])[],
  k = 60,
): FusedItem[] {
  const fused = new Map<string, FusedItem>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id) || item.rank < 1) continue;
      seen.add(item.id);
      const current = fused.get(item.id) ?? {
        id: item.id,
        score: 0,
        matchedLists: 0,
      };
      current.score += 1 / (k + item.rank);
      current.matchedLists += 1;
      fused.set(item.id, current);
    }
  }
  return [...fused.values()].sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id),
  );
}

export interface CandidateEvidence {
  id: string;
  approvedText: string;
}

export interface GroundedResult {
  candidate_id: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  evidence: string[];
  cautions: string[];
}

export function validateGroundedResults(
  results: readonly GroundedResult[],
  candidates: readonly CandidateEvidence[],
): GroundedResult[] | null {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.approvedText]),
  );
  const seen = new Set<string>();
  for (const result of results) {
    const text = byId.get(result.candidate_id);
    if (
      text === undefined ||
      seen.has(result.candidate_id) ||
      result.evidence.length === 0
    )
      return null;
    if (!result.evidence.every((evidence) => text.includes(evidence)))
      return null;
    seen.add(result.candidate_id);
  }
  return [...results];
}

const SEARCH_STOP_WORDS = new Set([
  "about",
  "anyone",
  "could",
  "experience",
  "experienced",
  "for",
  "help",
  "kind",
  "looking",
  "need",
  "new",
  "of",
  "person",
  "someone",
  "that",
  "the",
  "their",
  "this",
  "understand",
  "we",
  "who",
  "with",
]);

const RELEVANT_LIMITATION =
  /\b(?:advice only|beginner|developing|learning|limited|not especially|not very|some exposure|still learning|unverified)\b/iu;

function stem(token: string): string {
  if (token.endsWith("ies") && token.length > 4)
    return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("er") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3)
    return token.slice(0, -1);
  return token;
}

function significantTokens(value: string): string[] {
  return (
    value
      .toLocaleLowerCase("en-US")
      .match(/[a-z0-9+#]+/gu)
      ?.filter((token) => !SEARCH_STOP_WORDS.has(token))
      .map(stem) ?? []
  );
}

function quotedTerms(terms: readonly string[]): string {
  const quoted = terms.slice(0, 3).map((term) => `“${term}”`);
  if (quoted.length < 2) return quoted[0] ?? "the request";
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

function profileSentences(approvedText: string): string[] {
  const sentences = approvedText
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [approvedText.trim()];
}

export interface DeterministicSearchExplanationInput {
  query: string;
  exactTerms: readonly string[];
  approvedText: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  fuzzyRank: number | null;
}

export interface DeterministicSearchExplanation {
  relevance: GroundedResult["relevance"];
  reason: string;
  evidence: string[];
  cautions: string[];
  hasRelevantLimitation: boolean;
}

export function relevanceWithProfileLimitations(
  relevance: GroundedResult["relevance"],
  explanation: DeterministicSearchExplanation,
): GroundedResult["relevance"] {
  return relevance === "HIGH" && explanation.hasRelevantLimitation
    ? "MEDIUM"
    : relevance;
}

export function deterministicSearchExplanation(
  input: DeterministicSearchExplanationInput,
): DeterministicSearchExplanation {
  const queryTokens = new Set(significantTokens(input.query));
  const terms =
    input.exactTerms.length > 0
      ? [
          ...new Set(
            input.exactTerms.map((term) => term.trim()).filter(Boolean),
          ),
        ]
      : [...queryTokens];
  const concepts = terms.map((label) => ({
    label,
    tokens: [...new Set(significantTokens(label))],
  }));
  const sentences = profileSentences(input.approvedText);
  const sentenceTokens = sentences.map(
    (sentence) => new Set(significantTokens(sentence)),
  );
  const directlyMatched = concepts.filter(
    (concept) =>
      concept.tokens.length > 0 &&
      sentenceTokens.some((tokens) =>
        concept.tokens.every((token) => tokens.has(token)),
      ),
  );
  const partiallyMatched = concepts.filter(
    (concept) =>
      !directlyMatched.includes(concept) &&
      concept.tokens.some((token) =>
        sentenceTokens.some((tokens) => tokens.has(token)),
      ),
  );
  const scoredSentences = sentences
    .map((sentence, index) => {
      const tokens = sentenceTokens[index] ?? new Set<string>();
      const directConcepts = concepts.filter(
        (concept) =>
          concept.tokens.length > 0 &&
          concept.tokens.every((token) => tokens.has(token)),
      ).length;
      const queryOverlap = [...queryTokens].filter((token) =>
        tokens.has(token),
      ).length;
      const conceptOverlap = concepts.reduce(
        (total, concept) =>
          total + concept.tokens.filter((token) => tokens.has(token)).length,
        0,
      );
      return {
        sentence,
        index,
        score: directConcepts * 20 + queryOverlap * 3 + conceptOverlap,
      };
    })
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  const positiveEvidence = scoredSentences.filter((item) => item.score > 0);
  const selectedEvidence =
    positiveEvidence.length > 0
      ? positiveEvidence.slice(0, 2)
      : scoredSentences.slice(0, 1);
  const evidence = selectedEvidence.map((item) => item.sentence.slice(0, 500));
  const hasRelevantLimitation = positiveEvidence.some((item) =>
    RELEVANT_LIMITATION.test(item.sentence),
  );
  const retrievalMethodCount = [
    input.lexicalRank,
    input.vectorRank,
    input.fuzzyRank,
  ].filter((rank) => rank !== null).length;
  const allConceptsMatched =
    concepts.length > 0 && directlyMatched.length === concepts.length;
  let relevance: GroundedResult["relevance"];
  if (directlyMatched.length === 0) {
    relevance =
      partiallyMatched.length > 0 && retrievalMethodCount > 1
        ? "MEDIUM"
        : "LOW";
  } else {
    relevance =
      allConceptsMatched && (concepts.length === 1 || retrievalMethodCount > 1)
        ? "HIGH"
        : "MEDIUM";
  }
  if (hasRelevantLimitation && relevance === "HIGH") relevance = "MEDIUM";

  let reason: string;
  if (directlyMatched.length > 0) {
    reason = `The approved profile contains direct evidence related to ${quotedTerms(
      directlyMatched.map((concept) => concept.label),
    )}.`;
    if (!allConceptsMatched)
      reason +=
        " It does not directly establish every requested concept, so this is a partial match.";
  } else if (partiallyMatched.length > 0) {
    reason = `The approved profile shares relevant language with ${quotedTerms(
      partiallyMatched.map((concept) => concept.label),
    )}, but does not directly establish the complete requested skill.`;
  } else {
    reason =
      "Semantic retrieval selected this as a possible adjacent profile, but deterministic checks found no direct support for the requested terms.";
  }
  if (hasRelevantLimitation)
    reason +=
      " The relevant evidence also states a limitation or developing skill, which lowers the match grade.";

  return {
    relevance,
    reason,
    evidence,
    cautions: hasRelevantLimitation
      ? [
          "The relevant profile text describes a limitation or developing skill; confirm current proficiency and suitability.",
        ]
      : [],
    hasRelevantLimitation,
  };
}
