import { randomUUID } from "node:crypto";
import { FakeAiAdapter, PROMPT_VERSIONS } from "../../packages/ai/src/index.js";
import { sha256 } from "../../packages/auth/src/index.js";
import { PostgresExecutor, Repository } from "../../packages/db/src/index.js";
import type {
  EmailAdapter,
  OutboundEmail,
} from "../../packages/email/src/index.js";
import {
  CONSENT_VERSION,
  WEEK_MS,
  embeddingVersion,
} from "../../packages/shared/src/index.js";
import { runLifecycle } from "../../services/lifecycle-worker/src/worker.js";
import { afterAll, describe, expect, it } from "vitest";

class CaptureLifecycleEmail implements EmailAdapter {
  messages: OutboundEmail[] = [];
  send(message: OutboundEmail): Promise<{ messageId: string }> {
    this.messages.push(message);
    return Promise.resolve({ messageId: `lifecycle-${this.messages.length}` });
  }
}

const executor = new PostgresExecutor(
  process.env.DATABASE_URL ??
    "postgres://gis:gis-local-only@localhost:5432/gifts_in_service",
);
const repository = new Repository(executor);
const ai = new FakeAiAdapter();
const email = new CaptureLifecycleEmail();
const created: string[] = [];

afterAll(async () => {
  for (const id of created)
    await executor.query("DELETE FROM people WHERE id = $1", [id]);
  await executor.close();
});

describe("time-controlled stale profile lifecycle", () => {
  it("removes pending interviews at their 30-day expiry", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const address = `expired-${randomUUID()}@example.invalid`;
    const personId = await repository.createPerson({
      displayName: "Expired Interview Fiction",
      normalizedDisplayName: "expired interview fiction",
      displayEmail: address,
      normalizedEmail: address,
      consentVersion: CONSENT_VERSION,
      now: startedAt,
    });
    created.push(personId);
    await repository.startPendingInterview({
      personId,
      openingMessage: "What would you like to share?",
      initialCompletenessConfidence: "LOW",
      now: startedAt,
    });

    await runLifecycle(
      executor,
      email,
      {
        publicBaseUrl: "https://fictional.invalid",
        appName: "Gifts in Service",
        tokenHmacKey: "t".repeat(32),
        purgeHmacKey: "p".repeat(32),
        backupRetentionDays: 35,
      },
      new Date("2026-01-31T00:00:00.000Z"),
    );

    expect(
      (
        await executor.query(
          "SELECT 1 FROM pending_interviews WHERE person_id = $1::uuid",
          [personId],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("sends idempotent reminders, deactivates at 58 weeks, and purges at 62 weeks", async () => {
    const address = `lifecycle-${randomUUID()}@example.invalid`;
    const verifiedAt = new Date("2025-01-01T00:00:00.000Z");
    const personId = await repository.createPerson({
      displayName: "Lifecycle Fiction",
      normalizedDisplayName: "lifecycle fiction",
      displayEmail: address,
      normalizedEmail: address,
      consentVersion: CONSENT_VERSION,
      now: verifiedAt,
    });
    created.push(personId);
    const text =
      "This fictional profile offers occasional event setup and planning help, without lifting or an ongoing commitment.";
    await repository.saveApprovedProfile({
      personId,
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
      now: verifiedAt,
    });
    const week59 = new Date(verifiedAt.getTime() + 59 * WEEK_MS);
    const first = await runLifecycle(
      executor,
      email,
      {
        publicBaseUrl: "https://fictional.invalid",
        appName: "Gifts in Service",
        tokenHmacKey: "t".repeat(32),
        purgeHmacKey: "p".repeat(32),
        backupRetentionDays: 35,
      },
      week59,
    );
    expect(first.processed).toBe(4);
    expect(email.messages).toHaveLength(4);
    expect(
      email.messages.some((message) =>
        message.text.includes("permanently removed on"),
      ),
    ).toBe(true);
    expect(
      email.messages.every((message) => !message.text.includes(text)),
    ).toBe(true);
    expect((await repository.getPerson(personId))?.status).toBe(
      "INACTIVE_STALE",
    );
    const repeated = await runLifecycle(
      executor,
      email,
      {
        publicBaseUrl: "https://fictional.invalid",
        appName: "Gifts in Service",
        tokenHmacKey: "t".repeat(32),
        purgeHmacKey: "p".repeat(32),
        backupRetentionDays: 35,
      },
      week59,
    );
    expect(repeated.processed).toBe(0);
    expect(email.messages).toHaveLength(4);
    const week63 = new Date(verifiedAt.getTime() + 63 * WEEK_MS);
    const purge = await runLifecycle(
      executor,
      email,
      {
        publicBaseUrl: "https://fictional.invalid",
        appName: "Gifts in Service",
        tokenHmacKey: "t".repeat(32),
        purgeHmacKey: "p".repeat(32),
        backupRetentionDays: 35,
      },
      week63,
    );
    expect(purge.purged).toBe(1);
    expect(await repository.getPerson(personId)).toBeNull();
    created.splice(created.indexOf(personId), 1);
  });
});
