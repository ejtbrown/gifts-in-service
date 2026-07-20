import { randomUUID } from "node:crypto";
import { generateOpaqueSecret, keyedHash } from "@gis/auth";
import { Repository, type SqlExecutor } from "@gis/db";
import type { EmailAdapter } from "@gis/email";
import {
  formatChurchDate,
  lifecycleActionsDue,
  lifecycleDates,
  type LifecycleAction,
} from "@gis/shared";

interface LifecyclePerson extends Record<string, unknown> {
  id: string;
  last_verified_at: Date;
  status: "ACTIVE" | "PAUSED" | "INACTIVE_STALE" | "PENDING_PURGE";
}

interface DeliverableEmail extends Record<string, unknown> {
  id: string;
  display_email: string;
}

export interface LifecycleWorkerConfig {
  publicBaseUrl: string;
  appName: string;
  tokenHmacKey: string;
  purgeHmacKey: string;
  backupRetentionDays: number;
}

function subject(action: LifecycleAction, appName: string): string {
  if (action === "DEACTIVATE")
    return `${appName} profile hidden until reconfirmed`;
  if (action === "PURGE") return `${appName} profile removal notice`;
  return `Please reconfirm your ${appName} profile`;
}

function reminderBody(
  action: LifecycleAction,
  dates: ReturnType<typeof lifecycleDates>,
  magicLink: string,
): string {
  if (action === "FINAL_REMINDER") {
    return `Please review your profile. It will be hidden on ${formatChurchDate(dates.deactivateAt)} and permanently removed on ${formatChurchDate(dates.purgeAt)} unless reconfirmed.\n\n${magicLink}`;
  }
  if (action === "DEACTIVATE") {
    return `Your profile is now hidden from staff search. It is scheduled for permanent removal on ${formatChurchDate(dates.purgeAt)} unless you reconfirm it.\n\n${magicLink}`;
  }
  return `Please review and reconfirm your profile. This message contains no profile text.\n\n${magicLink}`;
}

export async function runLifecycle(
  executor: SqlExecutor,
  email: EmailAdapter,
  config: LifecycleWorkerConfig,
  now = new Date(),
): Promise<{ processed: number; purged: number }> {
  const repository = new Repository(executor);
  const people = await executor.query<LifecyclePerson>(
    `SELECT id::text, last_verified_at, status::text
     FROM people WHERE last_verified_at IS NOT NULL AND last_verified_at <= $1::timestamptz - interval '52 weeks'
     ORDER BY id`,
    [now],
  );
  let processed = 0;
  let purged = 0;
  for (const person of people.rows) {
    const dates = lifecycleDates(person.last_verified_at);
    for (const action of lifecycleActionsDue(person.last_verified_at, now)) {
      const key = `${person.id}:${person.last_verified_at.toISOString()}:${action}`;
      const event = await executor.query<{ id: string }>(
        `INSERT INTO lifecycle_events(person_id, event_type, idempotency_key, scheduled_at, attempted_at)
         VALUES ($1::uuid, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO UPDATE SET attempted_at = EXCLUDED.attempted_at
         WHERE lifecycle_events.completed_at IS NULL
         RETURNING id::text`,
        [person.id, action, key, now, now],
      );
      const eventId = event.rows[0]?.id;
      if (!eventId) continue;
      if (action === "PURGE") {
        const pseudonymous = keyedHash(person.id, config.purgeHmacKey);
        await executor.query(
          `UPDATE lifecycle_events SET pseudonymous_person_ref = $2 WHERE id = $1::uuid`,
          [eventId, pseudonymous],
        );
        await repository.purgePerson(
          person.id,
          pseudonymous,
          "STALE_LIFECYCLE",
          now,
          config.backupRetentionDays,
        );
        purged += 1;
        break;
      }
      if (action === "DEACTIVATE")
        await repository.setStatus(person.id, "INACTIVE_STALE", now);
      const addresses = await executor.query<DeliverableEmail>(
        `SELECT id::text, display_email FROM person_emails
         WHERE person_id = $1::uuid AND verified_at IS NOT NULL AND deliverability = 'DELIVERABLE'`,
        [person.id],
      );
      const sentIds: string[] = [];
      const cycle = randomUUID();
      for (const address of addresses.rows) {
        const token = generateOpaqueSecret(config.tokenHmacKey);
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await executor.query(
          `INSERT INTO magic_link_tokens(token_hash, purpose, person_id, normalized_email_context,
             pending_display_email, verification_cycle_id, issued_at, expires_at)
           VALUES ($1, 'RECONFIRM', $2::uuid, (SELECT normalized_email FROM person_emails WHERE id = $3::uuid),
             $4, $5::uuid, $6, $7)`,
          [
            token.hash,
            person.id,
            address.id,
            address.display_email,
            cycle,
            now,
            expiresAt,
          ],
        );
        const magicLink = `${config.publicBaseUrl}/magic#token=${token.raw}`;
        const text = reminderBody(action, dates, magicLink);
        await email.send({
          to: address.display_email,
          subject: subject(action, config.appName),
          text,
          html: `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`,
          idempotencyKey: `${eventId}:${address.id}`,
        });
        sentIds.push(address.id);
      }
      await executor.query(
        `UPDATE lifecycle_events SET completed_at = $2, outcome = $3, email_record_ids = $4::uuid[] WHERE id = $1::uuid`,
        [
          eventId,
          now,
          addresses.rowCount > 0 ? "COMPLETED" : "NO_DELIVERABLE_ADDRESS",
          sentIds,
        ],
      );
      processed += 1;
    }
  }
  await executor.query(
    "DELETE FROM magic_link_tokens WHERE expires_at < $1::timestamptz - interval '1 day'",
    [now],
  );
  await executor.query(
    "DELETE FROM member_sessions WHERE absolute_expires_at < $1::timestamptz - interval '1 day'",
    [now],
  );
  await executor.query(
    "DELETE FROM pending_interviews WHERE expires_at <= $1::timestamptz",
    [now],
  );
  await executor.query(
    "DELETE FROM staff_sessions WHERE expires_at < $1::timestamptz - interval '1 day'",
    [now],
  );
  await executor.query(
    `UPDATE audit_query_payloads SET protected_query = '[REDACTED]', redacted_at = $1
     WHERE expires_at <= $1 AND redacted_at IS NULL`,
    [now],
  );
  return { processed, purged };
}
