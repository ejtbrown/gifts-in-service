import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { emitMetric } from "@gis/shared";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface EmailAdapter {
  send(message: OutboundEmail): Promise<{ messageId: string }>;
}

export interface MagicLinkEmailInput {
  appName: string;
  magicLink: string;
  expiresAt: Date;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const centralDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function magicLinkEmail(
  input: MagicLinkEmailInput,
): Omit<OutboundEmail, "to" | "idempotencyKey"> {
  const expiresAt = centralDateTime.format(input.expiresAt);
  return {
    subject: `${input.appName} secure link`,
    text: `${input.appName} secure link\n\nOpen this secure link. It expires at ${expiresAt} and can be used once.\n\n${input.magicLink}\n\nIf you did not request this, ignore this message. No profile details are included.`,
    html: `<!doctype html><html lang="en"><body><h1>${escapeHtml(input.appName)} secure link</h1><p>Open the secure link below. It expires at ${escapeHtml(expiresAt)} and can be used once.</p><p><a href="${escapeHtml(input.magicLink)}">Open Gifts in Service</a></p><p>If you did not request this, ignore this message. No profile details are included.</p></body></html>`,
  };
}

export class MailpitEmailAdapter implements EmailAdapter {
  readonly #transport: nodemailer.Transporter;
  readonly #from: string;

  constructor(
    smtpUrl: string,
    from = "Gifts in Service <no-reply@example.invalid>",
  ) {
    this.#transport = nodemailer.createTransport(smtpUrl);
    this.#from = from;
  }

  async send(message: OutboundEmail): Promise<{ messageId: string }> {
    const result = (await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { "X-GIS-Idempotency-Key": message.idempotencyKey },
    })) as { messageId: string };
    return { messageId: result.messageId };
  }
}

export class SesEmailAdapter implements EmailAdapter {
  readonly #client: SESv2Client;
  readonly #from: string;
  readonly #configurationSet: string;

  constructor(region: string, from: string, configurationSet: string) {
    this.#client = new SESv2Client({ region, maxAttempts: 3 });
    this.#from = from;
    this.#configurationSet = configurationSet;
  }

  async send(message: OutboundEmail): Promise<{ messageId: string }> {
    const started = Date.now();
    try {
      const result = await this.#client.send(
        new SendEmailCommand({
          FromEmailAddress: this.#from,
          Destination: { ToAddresses: [message.to] },
          ConfigurationSetName: this.#configurationSet,
          EmailTags: [
            {
              Name: "IdempotencyKey",
              Value: message.idempotencyKey.slice(0, 256),
            },
          ],
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }),
      );
      if (!result.MessageId) throw new Error("SesMissingMessageId");
      emitMetric("SesSends", 1, "Count", "SendEmail");
      emitMetric(
        "SesLatency",
        Date.now() - started,
        "Milliseconds",
        "SendEmail",
      );
      return { messageId: result.MessageId };
    } catch (error) {
      emitMetric("SesErrors", 1, "Count", "SendEmail");
      throw error;
    }
  }
}
