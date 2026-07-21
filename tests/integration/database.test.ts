import { randomUUID } from "node:crypto";
import { FakeAiAdapter, PROMPT_VERSIONS } from "../../packages/ai/src/index.js";
import { normalizeDisplayName, sha256 } from "../../packages/auth/src/index.js";
import { PostgresExecutor, Repository } from "../../packages/db/src/index.js";
import {
  CONSENT_VERSION,
  embeddingVersion,
  reciprocalRankFusion,
} from "../../packages/shared/src/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processSesEvent } from "../../services/email-events-worker/src/worker.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gis:gis-local-only@localhost:5432/gifts_in_service";
const executor = new PostgresExecutor(databaseUrl);
const repository = new Repository(executor);
const ai = new FakeAiAdapter();
const created: string[] = [];

beforeAll(async () => {
  await executor.query("SELECT 1");
});

afterAll(async () => {
  for (const id of created)
    await executor.query("DELETE FROM people WHERE id = $1", [id]);
  await executor.close();
});

describe("PostgreSQL invariants", () => {
  it("keeps shared email associations distinct and protects the last verified address", async () => {
    const email = `shared-${randomUUID()}@example.invalid`;
    for (const name of ["First Fiction", "Second Fiction"]) {
      const id = await repository.createPerson({
        displayName: name,
        normalizedDisplayName: normalizeDisplayName(name),
        displayEmail: email,
        normalizedEmail: email,
        consentVersion: CONSENT_VERSION,
        now: new Date(),
      });
      created.push(id);
    }
    expect(await repository.profilesForMailbox(email)).toHaveLength(2);
    const emails = await repository.emails(created[0]!);
    await expect(
      executor.query("DELETE FROM person_emails WHERE id = $1", [
        emails[0]!.id,
      ]),
    ).rejects.toThrow(/last verified email/u);
    expect(await repository.profilesForMailbox(email)).toHaveLength(2);
  });

  it("retains a pending interview for a fixed 30 days and deletes it on approval", async () => {
    const email = `pending-${randomUUID()}@example.invalid`;
    const personId = await repository.createPerson({
      displayName: "Pending Interview Fiction",
      normalizedDisplayName: "pending interview fiction",
      displayEmail: email,
      normalizedEmail: email,
      consentVersion: CONSENT_VERSION,
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    created.push(personId);
    const startedAt = new Date("2026-07-16T12:30:00.000Z");
    const pending = await repository.startPendingInterview({
      personId,
      openingMessage: "What fictional experience would you like to share?",
      initialCompletenessConfidence: "LOW",
      now: startedAt,
    });
    expect(pending.revision).toBe(0);
    expect(pending.expiresAt.toISOString()).toBe("2026-08-15T12:30:00.000Z");
    const messages = [
      ...pending.messages,
      {
        role: "user" as const,
        content: "I can help organize occasional fictional community events.",
      },
      {
        role: "assistant" as const,
        content: "What kind of event planning would be a good fit?",
      },
    ];
    const exact =
      "This fictional profile offers occasional community event planning while leaving every future request optional and self-reported.";
    expect(
      await repository.updatePendingInterview({
        personId,
        expectedRevision: 0,
        messages,
        completenessConfidence: "MODERATE",
        proposedProfile: exact,
        now: new Date("2026-07-16T13:00:00.000Z"),
      }),
    ).toBe(1);
    expect(
      await repository.updatePendingInterview({
        personId,
        expectedRevision: 0,
        messages,
        completenessConfidence: "MODERATE",
        now: new Date("2026-07-16T13:01:00.000Z"),
      }),
    ).toBeNull();
    const resumed = await repository.getPendingInterview(
      personId,
      new Date("2026-07-16T13:02:00.000Z"),
    );
    expect(resumed?.messages).toEqual(messages);
    expect(resumed?.proposedProfile).toBe(exact);
    expect(resumed?.completenessConfidence).toBe("MODERATE");

    expect(
      await repository.saveApprovedProfile({
        personId,
        exactText: exact,
        sha256: sha256(exact),
        embedding: await ai.embed(exact, 1024),
        embeddingModelId: "amazon.titan-embed-text-v2:0",
        embeddingVersion: embeddingVersion(
          "fake",
          "amazon.titan-embed-text-v2:0",
          1024,
        ),
        promptVersion: PROMPT_VERSIONS.profileDrafter,
        consentVersion: CONSENT_VERSION,
        now: new Date("2026-07-16T14:00:00.000Z"),
        expectedPendingRevision: 1,
        expectedProposedProfile: exact,
      }),
    ).toBe(true);
    expect(
      await repository.getPendingInterview(
        personId,
        new Date("2026-07-16T14:01:00.000Z"),
      ),
    ).toBeNull();
  });

  it("atomically replaces exact approved text and never retains history", async () => {
    const exactEmail = `exact-${randomUUID()}@example.invalid`;
    const id = await repository.createPerson({
      displayName: "Exact Text Fixture",
      normalizedDisplayName: "exact text fixture",
      displayEmail: exactEmail,
      normalizedEmail: exactEmail,
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    created.push(id);
    const first =
      "This exact fictional profile describes WordPress accessibility work and occasional advice. It remains self-reported.";
    const second =
      "This complete replacement describes React maintenance only, with advice offered occasionally and no on-call commitment.";
    for (const text of [first, second]) {
      await repository.saveApprovedProfile({
        personId: id,
        exactText: text,
        sha256: sha256(text),
        embedding: await ai.embed(text, 1024),
        embeddingModelId: "amazon.titan-embed-text-v2:0",
        embeddingVersion: embeddingVersion(
          "fake",
          "amazon.titan-embed-text-v2:0",
          1024,
        ),
        promptVersion: PROMPT_VERSIONS.profileDrafter,
        consentVersion: CONSENT_VERSION,
        now: new Date(),
      });
    }
    const rows = await executor.query<{ approved_text: string; count: string }>(
      "SELECT approved_text, count(*) OVER ()::text AS count FROM profiles WHERE person_id = $1",
      [id],
    );
    expect(rows.rows[0]).toMatchObject({ approved_text: second, count: "1" });
    expect(JSON.stringify(rows.rows)).not.toContain(first);
  });

  it("excludes paused profiles and retrieves seeded profiles through static hybrid SQL", async () => {
    const query = "WordPress accessibility content maintenance";
    const plan = await ai.planSearch(query);
    const candidates = await repository.hybridCandidates({
      query,
      exactTerms: plan.exact_terms,
      embedding: await ai.embed(query, 1024),
      embeddingModelId: "amazon.titan-embed-text-v2:0",
      embeddingVersion: embeddingVersion(
        "fake",
        "amazon.titan-embed-text-v2:0",
        1024,
      ),
      now: new Date(),
      limit: 25,
    });
    const web = candidates.find(
      (item) => item.id === "10000000-0000-4000-8000-000000000002",
    );
    expect(web?.approvedText).toContain("WordPress");
    const fused = reciprocalRankFusion([
      candidates
        .filter((item) => item.lexicalRank)
        .map((item) => ({ id: item.id, rank: item.lexicalRank! })),
      candidates
        .filter((item) => item.vectorRank)
        .map((item) => ({ id: item.id, rank: item.vectorRank! })),
    ]);
    expect(fused.some((item) => item.id === web?.id)).toBe(true);
    await repository.setStatus(web!.id, "PAUSED", new Date());
    const paused = await repository.hybridCandidates({
      query,
      exactTerms: plan.exact_terms,
      embedding: await ai.embed(query, 1024),
      embeddingModelId: "amazon.titan-embed-text-v2:0",
      embeddingVersion: embeddingVersion(
        "fake",
        "amazon.titan-embed-text-v2:0",
        1024,
      ),
      now: new Date(),
      limit: 25,
    });
    expect(paused.some((item) => item.id === web!.id)).toBe(false);
    await repository.setStatus(web!.id, "ACTIVE", new Date());
  });

  it("purges live content, vectors, sessions, tokens, and associations while retaining only a pseudonymous event", async () => {
    const purgeEmail = `purge-${randomUUID()}@example.invalid`;
    const id = await repository.createPerson({
      displayName: "Purge Fixture",
      normalizedDisplayName: "purge fixture",
      displayEmail: purgeEmail,
      normalizedEmail: purgeEmail,
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    const text =
      "A fictional purge profile with sewing skills and occasional craft interest, offered without any ongoing commitment.";
    await repository.saveApprovedProfile({
      personId: id,
      exactText: text,
      sha256: sha256(text),
      embedding: await ai.embed(text, 1024),
      embeddingModelId: "amazon.titan-embed-text-v2:0",
      embeddingVersion: embeddingVersion(
        "fake",
        "amazon.titan-embed-text-v2:0",
        1024,
      ),
      promptVersion: PROMPT_VERSIONS.profileDrafter,
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    await repository.purgePerson(
      id,
      sha256(`pseudonym:${id}`),
      "TEST",
      new Date(),
    );
    expect(
      (await executor.query("SELECT 1 FROM people WHERE id = $1", [id]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await executor.query("SELECT 1 FROM profiles WHERE person_id = $1", [
          id,
        ])
      ).rowCount,
    ).toBe(0);
    const purge = await executor.query<Record<string, unknown>>(
      "SELECT * FROM purge_events WHERE pseudonymous_person_ref = $1",
      [sha256(`pseudonym:${id}`)],
    );
    expect(JSON.stringify(purge.rows)).not.toContain("Purge Fixture");
    expect(JSON.stringify(purge.rows)).not.toContain(text);
  });

  it("records real-shape SES delivery and complaint feedback idempotently", async () => {
    const address = `feedback-${randomUUID()}@example.invalid`;
    const personId = await repository.createPerson({
      displayName: "Feedback Fiction",
      normalizedDisplayName: "feedback fiction",
      displayEmail: address,
      normalizedEmail: address,
      consentVersion: CONSENT_VERSION,
      now: new Date(),
    });
    created.push(personId);
    await processSesEvent(executor, {
      eventType: "Delivery",
      mail: { messageId: `delivery-${personId}`, destination: [address] },
    });
    await processSesEvent(executor, {
      eventType: "Complaint",
      mail: { messageId: `complaint-${personId}`, destination: [address] },
      complaint: { complainedRecipients: [{ emailAddress: address }] },
    });
    expect((await repository.emails(personId))[0]?.deliverability).toBe(
      "COMPLAINT",
    );
    const events = await executor.query<{ event_type: string }>(
      "SELECT event_type FROM email_events WHERE person_id = $1 ORDER BY event_type",
      [personId],
    );
    expect(events.rows.map((event) => event.event_type)).toEqual([
      "COMPLAINT",
      "DELIVERY",
    ]);
  });
});
