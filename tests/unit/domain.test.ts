import { describe, expect, it, vi } from "vitest";
import {
  GROUP_PERMISSIONS,
  deterministicSearchExplanation,
  relevanceWithProfileLimitations,
  rerankerOutputSchema,
  SEARCH_RESULT_LIMIT,
  containsForbiddenLogField,
  emitMetric,
  lifecycleActionsDue,
  lifecycleDates,
  permissionsFor,
  reciprocalRankFusion,
  sanitizedLog,
  validateGroundedResults,
} from "../../packages/shared/src/index.js";

describe("authorization and lifecycle", () => {
  it("unions explicit permissions without making technical admins content admins", () => {
    expect(GROUP_PERMISSIONS["gis-technical-admin"]).toEqual([
      "technical:read",
    ]);
    const technical = permissionsFor(["gis-technical-admin"]);
    expect(technical.has("profile:search")).toBe(false);
    const union = permissionsFor(["gis-technical-admin", "gis-staff"]);
    expect(union.has("technical:read")).toBe(true);
    expect(union.has("profile:search")).toBe(true);
    expect(union.has("profile:purge")).toBe(false);
  });

  it("calculates exact 52/54/56/58/62 week UTC thresholds", () => {
    const verified = new Date("2025-01-01T00:00:00.000Z");
    const dates = lifecycleDates(verified);
    expect(dates.firstReminderAt.toISOString()).toBe(
      "2025-12-31T00:00:00.000Z",
    );
    expect(dates.secondReminderAt.toISOString()).toBe(
      "2026-01-14T00:00:00.000Z",
    );
    expect(dates.finalReminderAt.toISOString()).toBe(
      "2026-01-28T00:00:00.000Z",
    );
    expect(dates.deactivateAt.toISOString()).toBe("2026-02-11T00:00:00.000Z");
    expect(dates.purgeAt.toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(lifecycleActionsDue(verified, dates.deactivateAt)).toEqual([
      "FIRST_REMINDER",
      "SECOND_REMINDER",
      "FINAL_REMINDER",
      "DEACTIVATE",
    ]);
  });
});

describe("grounded hybrid search", () => {
  it("grades a limited but direct bass-player fallback as medium with focused evidence", () => {
    const bassSentence =
      "They also play bass guitar, noting that while they are not very good, they are learning every day.";
    const explanation = deterministicSearchExplanation({
      query: "We need a new bass player for the worship group",
      exactTerms: ["bass player", "worship group"],
      approvedText: `Morgan Fiction works with computers and electronics. ${bassSentence} They enjoy teaching technology.`,
      lexicalRank: 1,
      vectorRank: 1,
      fuzzyRank: null,
    });

    expect(explanation.relevance).toBe("MEDIUM");
    expect(explanation.hasRelevantLimitation).toBe(true);
    expect(relevanceWithProfileLimitations("HIGH", explanation)).toBe("MEDIUM");
    expect(relevanceWithProfileLimitations("LOW", explanation)).toBe("LOW");
    expect(explanation.reason).toContain("direct evidence");
    expect(explanation.reason).toContain("bass player");
    expect(explanation.reason).toContain("limitation or developing skill");
    expect(explanation.reason).not.toContain("retrieval method");
    expect(explanation.evidence).toEqual([bassSentence]);
    expect(explanation.cautions).toHaveLength(1);
  });

  it("grades strong direct fallback evidence high and semantic-only retrieval low", () => {
    expect(
      deterministicSearchExplanation({
        query: "WordPress accessibility maintenance",
        exactTerms: ["WordPress accessibility"],
        approvedText:
          "Morgan Fiction maintains WordPress sites and performs accessibility reviews.",
        lexicalRank: 1,
        vectorRank: 1,
        fuzzyRank: null,
      }),
    ).toMatchObject({
      relevance: "HIGH",
      evidence: [
        "Morgan Fiction maintains WordPress sites and performs accessibility reviews.",
      ],
    });
    expect(
      deterministicSearchExplanation({
        query: "commercial refrigeration repair",
        exactTerms: ["commercial refrigeration"],
        approvedText:
          "Morgan Fiction arranges flowers for occasional community dinners.",
        lexicalRank: null,
        vectorRank: 1,
        fuzzyRank: null,
      }),
    ).toMatchObject({
      relevance: "LOW",
      reason:
        "Semantic retrieval selected this as a possible adjacent profile, but deterministic checks found no direct support for the requested terms.",
    });
  });

  it("bounds reranked search results to the top ten candidates", () => {
    const result = (index: number) => ({
      candidate_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      relevance: "LOW" as const,
      reason: "A possible semantic connection.",
      evidence: ["Possible evidence"],
      cautions: [],
    });
    expect(SEARCH_RESULT_LIMIT).toBe(10);
    expect(
      rerankerOutputSchema.safeParse({
        results: Array.from({ length: SEARCH_RESULT_LIMIT }, (_, index) =>
          result(index),
        ),
      }).success,
    ).toBe(true);
    expect(
      rerankerOutputSchema.safeParse({
        results: Array.from({ length: SEARCH_RESULT_LIMIT + 1 }, (_, index) =>
          result(index),
        ),
      }).success,
    ).toBe(false);
  });

  it("uses reciprocal ranks and does not double-count duplicate IDs within one list", () => {
    const fused = reciprocalRankFusion([
      [
        { id: "a", rank: 1 },
        { id: "b", rank: 2 },
        { id: "a", rank: 3 },
      ],
      [
        { id: "b", rank: 1 },
        { id: "c", rank: 2 },
      ],
    ]);
    expect(fused.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(fused[0]?.matchedLists).toBe(2);
  });

  it("rejects unknown IDs, duplicate IDs, and non-substring evidence", () => {
    const candidates = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        approvedText: "Commercial refrigeration and ice machines.",
      },
    ];
    const good = [
      {
        candidate_id: candidates[0]!.id,
        relevance: "HIGH" as const,
        reason: "Relevant",
        evidence: ["ice machines"],
        cautions: [],
      },
    ];
    expect(validateGroundedResults(good, candidates)).toEqual(good);
    expect(
      validateGroundedResults(
        [{ ...good[0]!, evidence: ["licensed contractor"] }],
        candidates,
      ),
    ).toBeNull();
    expect(
      validateGroundedResults(
        [{ ...good[0]!, candidate_id: "20000000-0000-4000-8000-000000000001" }],
        candidates,
      ),
    ).toBeNull();
    expect(
      validateGroundedResults([good[0]!, good[0]!], candidates),
    ).toBeNull();
  });
});

describe("sanitized logging", () => {
  it("classifies interview follow-up notes as forbidden log fields", () => {
    expect(
      containsForbiddenLogField({ followUpNotes: ["unfinished thread"] }),
    ).toBe(true);
    expect(
      containsForbiddenLogField({ follow_up_notes: ["unfinished thread"] }),
    ).toBe(true);
  });

  it("drops bodies, queries, tokens, email, and raw IP fields", () => {
    const result = sanitizedLog({
      correlationId: "corr",
      route: "/magic?code=secret",
      status: 400,
      durationMs: 4,
      query: "accountant",
      email: "fictional@example.invalid",
      token: "secret",
      ip: "192.0.2.1",
    });
    expect(result).toEqual({
      correlationId: "corr",
      route: "/magic",
      status: 400,
      durationMs: 4,
    });
  });

  it("emits only fixed, non-personal CloudWatch dimensions", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      emitMetric(
        "ApiRequests",
        1,
        "Count",
        "/api/staff/profiles/:id",
        "gis-prod-staff",
      );
      const payload = JSON.parse(String(write.mock.calls[0]?.[0])) as {
        _aws: {
          CloudWatchMetrics: Array<{ Dimensions: string[][] }>;
        };
      };
      expect(payload._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([
        ["Environment", "Service", "Operation"],
      ]);
      expect(() =>
        emitMetric("ApiRequests", 1, "Count", "volunteer@example.invalid"),
      ).toThrow("UnsafeMetricMetadata");
    } finally {
      write.mockRestore();
    }
  });
});
