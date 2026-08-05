import { STAFF_SESSION_TTL_SECONDS } from "@gis/auth";
import type { SqlExecutor } from "@gis/db";
import type { StaffGroup } from "@gis/shared";

export interface RedeemedMagicLink {
  personId: string | null;
  normalizedEmail: string;
  displayEmail: string;
  pendingDisplayName: string | null;
  consentVersion: string | null;
  purpose: string;
  verificationCycleId: string | null;
}

export interface MemberSession {
  sessionHash: string;
  mailboxEmail: string | null;
  mailboxDisplayEmail: string | null;
  personId: string | null;
  csrfHash: string;
  verificationCycleId: string | null;
  absoluteExpiresAt: Date;
}

export interface StaffSession {
  sessionHash: string;
  subject: string;
  groups: StaffGroup[];
  permissions: string[];
  csrfHash: string;
}

export interface StaffTrustedDevice {
  trustHash: string;
  subject: string;
  cognitoUsername: string;
  loginIdentifier: string;
  deviceKey: string;
  deviceGroupKey: string;
  credentialsCiphertext: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RevokedStaffTrustedDevice {
  cognitoUsername: string;
  deviceKey: string;
}

export class SecurityStore {
  constructor(readonly executor: SqlExecutor) {}

  async recentMagicRequests(
    abuseEmailHash: string,
    abuseNetworkHash: string,
    since: Date,
  ): Promise<number> {
    const result = await this.executor.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM magic_link_tokens
       WHERE issued_at >= $3 AND (abuse_email_hash = $1 OR abuse_network_hash = $2)`,
      [abuseEmailHash, abuseNetworkHash, since],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async insertMagicToken(input: {
    tokenHash: string;
    purpose: "LOGIN_OR_CREATE" | "RECONFIRM" | "ADD_EMAIL" | "STAFF_INVITE";
    personId: string | null;
    normalizedEmail: string;
    displayEmail: string;
    pendingDisplayName: string | null;
    consentVersion: string | null;
    abuseEmailHash: string | null;
    abuseNetworkHash: string | null;
    expiresAt: Date;
    verificationCycleId?: string;
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO magic_link_tokens(token_hash, purpose, person_id, normalized_email_context,
         pending_display_email, pending_display_name, consent_version, abuse_email_hash, abuse_network_hash,
         expires_at, verification_cycle_id)
       VALUES ($1, $2::magic_link_purpose, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::uuid)`,
      [
        input.tokenHash,
        input.purpose,
        input.personId,
        input.normalizedEmail,
        input.displayEmail,
        input.pendingDisplayName,
        input.consentVersion,
        input.abuseEmailHash,
        input.abuseNetworkHash,
        input.expiresAt,
        input.verificationCycleId ?? null,
      ],
    );
  }

  async reserveAddEmailToken(
    input: {
      tokenHash: string;
      personId: string;
      normalizedEmail: string;
      displayEmail: string;
      abuseEmailHash: string;
      expiresAt: Date;
    },
    since: Date,
    maximumRequests: number,
  ): Promise<boolean> {
    return this.executor.transaction(async (transaction) => {
      const lockKeys = [
        `add-email:person:${input.personId}`,
        `add-email:recipient:${input.abuseEmailHash}`,
      ].sort();
      for (const lockKey of lockKeys) {
        await transaction.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [lockKey],
        );
      }
      const counts = await transaction.query<{
        person_count: string;
        recipient_count: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE person_id = $1::uuid)::text AS person_count,
           count(*) FILTER (WHERE abuse_email_hash = $2)::text AS recipient_count
         FROM magic_link_tokens
         WHERE purpose = 'ADD_EMAIL' AND issued_at >= $3::timestamptz`,
        [input.personId, input.abuseEmailHash, since],
      );
      const count = counts.rows[0];
      if (
        Number(count?.person_count ?? 0) >= maximumRequests ||
        Number(count?.recipient_count ?? 0) >= maximumRequests
      )
        return false;
      await new SecurityStore(transaction).insertMagicToken({
        tokenHash: input.tokenHash,
        purpose: "ADD_EMAIL",
        personId: input.personId,
        normalizedEmail: input.normalizedEmail,
        displayEmail: input.displayEmail,
        pendingDisplayName: null,
        consentVersion: null,
        abuseEmailHash: input.abuseEmailHash,
        abuseNetworkHash: null,
        expiresAt: input.expiresAt,
      });
      return true;
    });
  }

  async redeemMagicToken(
    tokenHash: string,
    now: Date,
  ): Promise<RedeemedMagicLink | null> {
    const result = await this.executor.query<{
      person_id: string | null;
      normalized_email_context: string;
      pending_display_email: string | null;
      pending_display_name: string | null;
      consent_version: string | null;
      purpose: string;
      verification_cycle_id: string | null;
    }>(
      `UPDATE magic_link_tokens SET used_at = $2
       WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > $2
       RETURNING person_id::text, normalized_email_context, pending_display_email, pending_display_name,
         consent_version, purpose::text, verification_cycle_id::text`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          personId: row.person_id,
          normalizedEmail: row.normalized_email_context,
          displayEmail:
            row.pending_display_email ?? row.normalized_email_context,
          pendingDisplayName: row.pending_display_name,
          consentVersion: row.consent_version,
          purpose: row.purpose,
          verificationCycleId: row.verification_cycle_id,
        }
      : null;
  }

  async createMemberSession(input: {
    sessionHash: string;
    mailboxEmail: string | null;
    mailboxDisplayEmail: string | null;
    personId: string | null;
    csrfHash: string;
    now: Date;
    verificationCycleId: string | null;
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO member_sessions(session_hash, mailbox_normalized_email, mailbox_display_email,
         selected_person_id, csrf_hash, issued_at, last_seen_at, idle_expires_at, absolute_expires_at,
         verification_cycle_id)
       VALUES ($1, $2, $3, $4::uuid, $5, $6::timestamptz, $6::timestamptz,
         $6::timestamptz + interval '30 days', $6::timestamptz + interval '30 days', $7::uuid)`,
      [
        input.sessionHash,
        input.mailboxEmail,
        input.mailboxDisplayEmail,
        input.personId,
        input.csrfHash,
        input.now,
        input.verificationCycleId,
      ],
    );
  }

  async getMemberSession(
    sessionHash: string,
    now: Date,
  ): Promise<MemberSession | null> {
    const result = await this.executor.query<{
      session_hash: string;
      mailbox_normalized_email: string | null;
      mailbox_display_email: string | null;
      selected_person_id: string | null;
      csrf_hash: string;
      verification_cycle_id: string | null;
      absolute_expires_at: Date;
    }>(
      `UPDATE member_sessions s SET last_seen_at = $2::timestamptz
       WHERE s.session_hash = $1 AND s.revoked_at IS NULL
         AND s.idle_expires_at > $2 AND s.absolute_expires_at > $2
         AND (
           s.selected_person_id IS NULL
           OR s.mailbox_normalized_email IS NULL
           OR EXISTS (
             SELECT 1 FROM person_emails e
             WHERE e.person_id = s.selected_person_id
               AND e.normalized_email = s.mailbox_normalized_email
               AND e.verified_at IS NOT NULL
           )
         )
       RETURNING s.session_hash, s.mailbox_normalized_email, s.mailbox_display_email,
         s.selected_person_id::text, s.csrf_hash, s.verification_cycle_id::text,
         s.absolute_expires_at`,
      [sessionHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          sessionHash: row.session_hash,
          mailboxEmail: row.mailbox_normalized_email,
          mailboxDisplayEmail: row.mailbox_display_email,
          personId: row.selected_person_id,
          csrfHash: row.csrf_hash,
          verificationCycleId: row.verification_cycle_id,
          absoluteExpiresAt: row.absolute_expires_at,
        }
      : null;
  }

  async rotateMemberCsrf(sessionHash: string, csrfHash: string): Promise<void> {
    await this.executor.query(
      "UPDATE member_sessions SET csrf_hash = $2 WHERE session_hash = $1",
      [sessionHash, csrfHash],
    );
  }

  async selectMemberPerson(
    sessionHash: string,
    personId: string,
    mailboxEmail: string,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE member_sessions s SET selected_person_id = $2::uuid
       WHERE s.session_hash = $1 AND s.mailbox_normalized_email = $3
         AND EXISTS (SELECT 1 FROM person_emails e WHERE e.person_id = $2::uuid
           AND e.normalized_email = $3 AND e.verified_at IS NOT NULL)`,
      [sessionHash, personId, mailboxEmail],
    );
    return result.rowCount === 1;
  }

  async revokeMemberSession(sessionHash: string, now: Date): Promise<void> {
    await this.executor.query(
      "UPDATE member_sessions SET revoked_at = $2 WHERE session_hash = $1",
      [sessionHash, now],
    );
  }

  async insertApprovalToken(input: {
    tokenHash: string;
    personId: string;
    sessionHash: string;
    approvedTextSha256: string;
    consentVersion: string;
    promptVersion: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO profile_approval_tokens(token_hash, person_id, pending_session_hash,
         approved_text_sha256, consent_version, prompt_version, expires_at)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)`,
      [
        input.tokenHash,
        input.personId,
        input.sessionHash,
        input.approvedTextSha256,
        input.consentVersion,
        input.promptVersion,
        input.expiresAt,
      ],
    );
  }

  async consumeApprovalToken(input: {
    tokenHash: string;
    personId: string;
    sessionHash: string;
    approvedTextSha256: string;
    consentVersion: string;
    promptVersion: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE profile_approval_tokens SET used_at = $7
       WHERE token_hash = $1 AND person_id = $2::uuid AND pending_session_hash = $3
         AND approved_text_sha256 = $4 AND consent_version = $5 AND prompt_version = $6
         AND used_at IS NULL AND expires_at > $7`,
      [
        input.tokenHash,
        input.personId,
        input.sessionHash,
        input.approvedTextSha256,
        input.consentVersion,
        input.promptVersion,
        input.now,
      ],
    );
    return result.rowCount === 1;
  }

  async createStaffSession(input: {
    sessionHash: string;
    subject: string;
    groups: readonly StaffGroup[];
    permissions: readonly string[];
    csrfHash: string;
    now: Date;
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO staff_sessions(session_hash, cognito_subject, effective_groups, effective_permissions,
         csrf_hash, issued_at, expires_at) VALUES ($1, $2, $3::text[], $4::text[], $5,
           $6::timestamptz, $6::timestamptz + ($7::double precision * interval '1 second'))`,
      [
        input.sessionHash,
        input.subject,
        input.groups,
        input.permissions,
        input.csrfHash,
        input.now,
        STAFF_SESSION_TTL_SECONDS,
      ],
    );
  }

  async getStaffSession(
    sessionHash: string,
    now: Date,
  ): Promise<StaffSession | null> {
    const result = await this.executor.query<{
      session_hash: string;
      cognito_subject: string;
      effective_groups: StaffGroup[];
      effective_permissions: string[];
      csrf_hash: string;
    }>(
      `SELECT session_hash, cognito_subject, effective_groups, effective_permissions, csrf_hash
       FROM staff_sessions WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [sessionHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          sessionHash: row.session_hash,
          subject: row.cognito_subject,
          groups: row.effective_groups,
          permissions: row.effective_permissions,
          csrfHash: row.csrf_hash,
        }
      : null;
  }

  async rotateStaffCsrf(sessionHash: string, csrfHash: string): Promise<void> {
    await this.executor.query(
      "UPDATE staff_sessions SET csrf_hash = $2 WHERE session_hash = $1",
      [sessionHash, csrfHash],
    );
  }

  async revokeStaffSession(sessionHash: string, now: Date): Promise<void> {
    await this.executor.query(
      "UPDATE staff_sessions SET revoked_at = $2 WHERE session_hash = $1",
      [sessionHash, now],
    );
  }

  async getStaffTrustedDevice(
    trustHash: string,
  ): Promise<StaffTrustedDevice | null> {
    const result = await this.executor.query<{
      trust_hash: string;
      cognito_subject: string;
      cognito_username: string;
      login_identifier: string;
      device_key: string;
      device_group_key: string;
      device_credentials_ciphertext: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT trust_hash, cognito_subject, cognito_username, login_identifier,
         device_key, device_group_key, device_credentials_ciphertext, expires_at, revoked_at
       FROM staff_trusted_devices WHERE trust_hash = $1`,
      [trustHash],
    );
    const row = result.rows[0];
    return row
      ? {
          trustHash: row.trust_hash,
          subject: row.cognito_subject,
          cognitoUsername: row.cognito_username,
          loginIdentifier: row.login_identifier,
          deviceKey: row.device_key,
          deviceGroupKey: row.device_group_key,
          credentialsCiphertext: row.device_credentials_ciphertext,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }
      : null;
  }

  async createStaffTrustedDevice(input: {
    trustHash: string;
    subject: string;
    cognitoUsername: string;
    loginIdentifier: string;
    deviceKey: string;
    deviceGroupKey: string;
    credentialsCiphertext: string;
    now: Date;
    expiresAt: Date;
    maximumActiveDevices?: number;
  }): Promise<RevokedStaffTrustedDevice[]> {
    return this.executor.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`staff-trusted-devices:${input.subject}`],
      );
      const expired = await transaction.query<{
        cognito_username: string;
        device_key: string;
      }>(
        `UPDATE staff_trusted_devices SET revoked_at = $2::timestamptz
         WHERE cognito_subject = $1 AND revoked_at IS NULL
           AND expires_at <= $2::timestamptz
         RETURNING cognito_username, device_key`,
        [input.subject, input.now],
      );
      await transaction.query(
        `INSERT INTO staff_trusted_devices(
           trust_hash, cognito_subject, cognito_username, login_identifier,
           device_key, device_group_key, device_credentials_ciphertext,
           created_at, last_used_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz, $9::timestamptz)`,
        [
          input.trustHash,
          input.subject,
          input.cognitoUsername,
          input.loginIdentifier,
          input.deviceKey,
          input.deviceGroupKey,
          input.credentialsCiphertext,
          input.now,
          input.expiresAt,
        ],
      );
      const revoked = await transaction.query<{
        cognito_username: string;
        device_key: string;
      }>(
        `UPDATE staff_trusted_devices SET revoked_at = $2::timestamptz
         WHERE trust_hash IN (
           SELECT trust_hash FROM staff_trusted_devices
           WHERE cognito_subject = $1 AND revoked_at IS NULL
             AND expires_at > $2::timestamptz
           ORDER BY created_at DESC, trust_hash DESC
           OFFSET $3
         )
         RETURNING cognito_username, device_key`,
        [input.subject, input.now, input.maximumActiveDevices ?? 5],
      );
      return [...expired.rows, ...revoked.rows].map((row) => ({
        cognitoUsername: row.cognito_username,
        deviceKey: row.device_key,
      }));
    });
  }

  async markStaffTrustedDeviceUsed(
    trustHash: string,
    subject: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE staff_trusted_devices SET last_used_at = $3::timestamptz
       WHERE trust_hash = $1 AND cognito_subject = $2 AND revoked_at IS NULL
         AND expires_at > $3::timestamptz`,
      [trustHash, subject, now],
    );
    return result.rowCount === 1;
  }

  async revokeStaffTrustedDevice(
    trustHash: string,
    now: Date,
    subject?: string,
  ): Promise<RevokedStaffTrustedDevice | null> {
    const result = await this.executor.query<{
      cognito_username: string;
      device_key: string;
    }>(
      `UPDATE staff_trusted_devices SET revoked_at = $2::timestamptz
       WHERE trust_hash = $1 AND revoked_at IS NULL
         AND ($3::text IS NULL OR cognito_subject = $3)
       RETURNING cognito_username, device_key`,
      [trustHash, now, subject ?? null],
    );
    const row = result.rows[0];
    return row
      ? {
          cognitoUsername: row.cognito_username,
          deviceKey: row.device_key,
        }
      : null;
  }

  async revokeStaffTrustedDevicesForSubject(
    subject: string,
    now: Date,
  ): Promise<RevokedStaffTrustedDevice[]> {
    const result = await this.executor.query<{
      cognito_username: string;
      device_key: string;
    }>(
      `UPDATE staff_trusted_devices SET revoked_at = $2::timestamptz
       WHERE cognito_subject = $1 AND revoked_at IS NULL
       RETURNING cognito_username, device_key`,
      [subject, now],
    );
    return result.rows.map((row) => ({
      cognitoUsername: row.cognito_username,
      deviceKey: row.device_key,
    }));
  }

  async revokeStaffTrustedDevicesForLogin(
    loginIdentifier: string,
    now: Date,
  ): Promise<RevokedStaffTrustedDevice[]> {
    const result = await this.executor.query<{
      cognito_username: string;
      device_key: string;
    }>(
      `UPDATE staff_trusted_devices SET revoked_at = $2::timestamptz
       WHERE (login_identifier = $1 OR cognito_username = $1)
         AND revoked_at IS NULL
       RETURNING cognito_username, device_key`,
      [loginIdentifier, now],
    );
    return result.rows.map((row) => ({
      cognitoUsername: row.cognito_username,
      deviceKey: row.device_key,
    }));
  }
}
