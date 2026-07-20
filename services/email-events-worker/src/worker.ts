import type { SqlExecutor } from "@gis/db";
import { z } from "zod";

const sesEventSchema = z.object({
  mail: z.object({
    messageId: z.string().min(1),
    destination: z.array(z.string().email()).optional(),
    tags: z.record(z.string(), z.array(z.string())).optional(),
  }),
  eventType: z.enum([
    "Send",
    "Delivery",
    "Bounce",
    "Complaint",
    "Reject",
    "DeliveryDelay",
    "SEND",
    "DELIVERY",
    "BOUNCE",
    "COMPLAINT",
    "REJECT",
    "DELIVERY_DELAY",
  ]),
  bounce: z
    .object({
      bounceType: z.string(),
      bouncedRecipients: z.array(
        z.object({ emailAddress: z.string().email() }),
      ),
    })
    .optional(),
  complaint: z
    .object({
      complainedRecipients: z.array(
        z.object({ emailAddress: z.string().email() }),
      ),
    })
    .optional(),
});

export async function processSesEvent(
  executor: SqlExecutor,
  input: unknown,
  now = new Date(),
): Promise<void> {
  const event = sesEventSchema.parse(input);
  const eventType = event.eventType
    .replaceAll(/([a-z])([A-Z])/gu, "$1_$2")
    .toUpperCase();
  const recipients =
    event.bounce?.bouncedRecipients.map((item) => item.emailAddress) ??
    event.complaint?.complainedRecipients.map((item) => item.emailAddress) ??
    event.mail.destination ??
    [];
  const normalizedOutcome =
    eventType === "BOUNCE" ? (event.bounce?.bounceType ?? "BOUNCE") : eventType;
  for (const address of recipients) {
    const normalized = address.trim().toLowerCase();
    const records = await executor.query<{ id: string; person_id: string }>(
      "SELECT id::text, person_id::text FROM person_emails WHERE normalized_email = $1",
      [normalized],
    );
    for (const record of records.rows) {
      await executor.transaction(async (transaction) => {
        if (eventType === "BOUNCE" || eventType === "COMPLAINT") {
          await transaction.query(
            `UPDATE person_emails SET deliverability = $2::deliverability_status,
               bounced_at = CASE WHEN $2 IN ('HARD_BOUNCE','SOFT_BOUNCE') THEN $3 ELSE bounced_at END,
               complained_at = CASE WHEN $2 = 'COMPLAINT' THEN $3 ELSE complained_at END
             WHERE id = $1::uuid`,
            [
              record.id,
              eventType === "COMPLAINT"
                ? "COMPLAINT"
                : event.bounce?.bounceType === "Permanent"
                  ? "HARD_BOUNCE"
                  : "SOFT_BOUNCE",
              now,
            ],
          );
        }
        await transaction.query(
          `INSERT INTO email_events(ses_message_id, person_id, email_record_id, event_type, occurred_at, normalized_outcome)
           VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [
            event.mail.messageId,
            record.person_id,
            record.id,
            eventType,
            now,
            normalizedOutcome,
          ],
        );
      });
    }
  }
}
