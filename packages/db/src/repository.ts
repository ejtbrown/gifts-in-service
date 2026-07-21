import {
  interviewCompletenessSchema,
  interviewMessageSchema,
  profileTextSchema,
  type InterviewCompleteness,
  type InterviewMessage,
  type ProfileStatus,
  type StaffGroup,
} from "@gis/shared";
import type { SqlExecutor } from "./executor.js";

export interface PersonSummary {
  id: string;
  displayName: string;
  status: ProfileStatus;
  approvedText: string | null;
  contentUpdatedAt: Date | null;
  lastVerifiedAt: Date | null;
  scheduledPurgeAt: Date | null;
}

export interface SearchCandidate {
  id: string;
  approvedText: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  fuzzyRank: number | null;
}

export interface StaffPersonRecord {
  id: string;
  displayName: string;
  status: ProfileStatus;
  hasApprovedProfile: boolean;
  contentUpdatedAt: Date | null;
  lastVerifiedAt: Date | null;
  scheduledPurgeAt: Date | null;
  primaryEmail: string | null;
  deliverability: string | null;
}

export interface PendingInterview {
  messages: InterviewMessage[];
  proposedProfile: string | null;
  completenessConfidence: InterviewCompleteness;
  revision: number;
  startedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0")).join(",")}]`;
}

function pendingMessages(value: string): InterviewMessage[] {
  return interviewMessageSchema.shape.messages.parse(JSON.parse(value));
}

export class Repository {
  constructor(readonly executor: SqlExecutor) {}

  async profilesForMailbox(
    normalizedEmail: string,
  ): Promise<{ id: string; displayName: string }[]> {
    const result = await this.executor.query<{
      id: string;
      display_name: string;
    }>(
      `SELECT p.id::text, p.display_name
       FROM people p JOIN person_emails e ON e.person_id = p.id
       WHERE e.normalized_email = $1 AND e.verified_at IS NOT NULL
       ORDER BY p.display_name, p.id`,
      [normalizedEmail],
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
    }));
  }

  async findExactPerson(
    normalizedEmail: string,
    normalizedDisplayName: string,
  ): Promise<string[]> {
    const result = await this.executor.query<{ id: string }>(
      `SELECT p.id::text FROM people p JOIN person_emails e ON e.person_id = p.id
       WHERE e.normalized_email = $1 AND p.normalized_display_name = $2 AND e.verified_at IS NOT NULL`,
      [normalizedEmail, normalizedDisplayName],
    );
    return result.rows.map((row) => row.id);
  }

  async getPerson(personId: string): Promise<PersonSummary | null> {
    const result = await this.executor.query<{
      id: string;
      display_name: string;
      status: ProfileStatus;
      approved_text: string | null;
      content_updated_at: Date | null;
      last_verified_at: Date | null;
      scheduled_purge_at: Date | null;
    }>(
      `SELECT p.id::text, p.display_name, p.status, pr.approved_text, p.content_updated_at,
              p.last_verified_at, p.scheduled_purge_at
       FROM people p LEFT JOIN profiles pr ON pr.person_id = p.id WHERE p.id = $1::uuid`,
      [personId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          status: row.status,
          approvedText: row.approved_text,
          contentUpdatedAt: row.content_updated_at,
          lastVerifiedAt: row.last_verified_at,
          scheduledPurgeAt: row.scheduled_purge_at,
        }
      : null;
  }

  async staffPeople(includeContact: boolean): Promise<StaffPersonRecord[]> {
    const result = await this.executor.query<{
      id: string;
      display_name: string;
      status: ProfileStatus;
      has_approved_profile: boolean;
      content_updated_at: Date | null;
      last_verified_at: Date | null;
      scheduled_purge_at: Date | null;
      primary_email: string | null;
      deliverability: string | null;
    }>(
      `SELECT p.id::text, p.display_name, p.status,
              (pr.person_id IS NOT NULL) AS has_approved_profile,
              p.content_updated_at, p.last_verified_at, p.scheduled_purge_at,
              ${includeContact ? "primary_email.display_email" : "NULL::text"} AS primary_email,
              ${includeContact ? "primary_email.deliverability::text" : "NULL::text"} AS deliverability
       FROM people p
       LEFT JOIN profiles pr ON pr.person_id = p.id
       LEFT JOIN LATERAL (
         SELECT e.display_email, e.deliverability
         FROM person_emails e
         WHERE e.person_id = p.id AND e.verified_at IS NOT NULL
         ORDER BY e.is_primary DESC, e.created_at, e.id
         LIMIT 1
       ) primary_email ON ${includeContact ? "true" : "false"}
       ORDER BY p.display_name, p.id
       LIMIT 500`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      status: row.status,
      hasApprovedProfile: row.has_approved_profile,
      contentUpdatedAt: row.content_updated_at,
      lastVerifiedAt: row.last_verified_at,
      scheduledPurgeAt: row.scheduled_purge_at,
      primaryEmail: row.primary_email,
      deliverability: row.deliverability,
    }));
  }

  async createPerson(input: {
    displayName: string;
    normalizedDisplayName: string;
    displayEmail: string;
    normalizedEmail: string;
    consentVersion: string;
    now: Date;
  }): Promise<string> {
    return this.executor.transaction(async (transaction) => {
      const person = await transaction.query<{ id: string }>(
        `INSERT INTO people(display_name, normalized_display_name, consent_version, consent_accepted_at)
         VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [
          input.displayName,
          input.normalizedDisplayName,
          input.consentVersion,
          input.now,
        ],
      );
      const id = person.rows[0]?.id;
      if (!id) throw new Error("PersonCreateFailed");
      await transaction.query(
        `INSERT INTO person_emails(person_id, display_email, normalized_email, verified_at, is_primary)
         VALUES ($1::uuid, $2, $3, $4, true)`,
        [id, input.displayEmail, input.normalizedEmail, input.now],
      );
      return id;
    });
  }

  async startPendingInterview(input: {
    personId: string;
    openingMessage: string;
    initialCompletenessConfidence: InterviewCompleteness;
    now: Date;
  }): Promise<PendingInterview> {
    return this.executor.transaction(async (transaction) => {
      await transaction.query(
        "DELETE FROM pending_interviews WHERE person_id = $1::uuid AND expires_at <= $2::timestamptz",
        [input.personId, input.now],
      );
      await transaction.query(
        `INSERT INTO pending_interviews(person_id, messages, completeness_confidence, revision, started_at, updated_at, expires_at)
         VALUES ($1::uuid, $2::jsonb, $3, 0, $4::timestamptz, $4::timestamptz,
           $4::timestamptz + interval '30 days')
         ON CONFLICT (person_id) DO NOTHING`,
        [
          input.personId,
          JSON.stringify([
            { role: "assistant", content: input.openingMessage },
          ]),
          interviewCompletenessSchema.parse(
            input.initialCompletenessConfidence,
          ),
          input.now,
        ],
      );
      const result = await transaction.query<{
        messages_json: string;
        proposed_profile: string | null;
        completeness_confidence: string;
        revision: number;
        started_at: Date;
        updated_at: Date;
        expires_at: Date;
      }>(
        `SELECT messages::text AS messages_json, proposed_profile, completeness_confidence, revision, started_at, updated_at, expires_at
         FROM pending_interviews
         WHERE person_id = $1::uuid AND expires_at > $2::timestamptz`,
        [input.personId, input.now],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PendingInterviewStartFailed");
      return {
        messages: pendingMessages(row.messages_json),
        proposedProfile: row.proposed_profile,
        completenessConfidence: interviewCompletenessSchema.parse(
          row.completeness_confidence,
        ),
        revision: row.revision,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      };
    });
  }

  async getPendingInterview(
    personId: string,
    now: Date,
  ): Promise<PendingInterview | null> {
    const result = await this.executor.query<{
      messages_json: string;
      proposed_profile: string | null;
      completeness_confidence: string;
      revision: number;
      started_at: Date;
      updated_at: Date;
      expires_at: Date;
    }>(
      `SELECT messages::text AS messages_json, proposed_profile, completeness_confidence, revision, started_at, updated_at, expires_at
       FROM pending_interviews
       WHERE person_id = $1::uuid AND expires_at > $2::timestamptz`,
      [personId, now],
    );
    const row = result.rows[0];
    return row
      ? {
          messages: pendingMessages(row.messages_json),
          proposedProfile: row.proposed_profile,
          completenessConfidence: interviewCompletenessSchema.parse(
            row.completeness_confidence,
          ),
          revision: row.revision,
          startedAt: row.started_at,
          updatedAt: row.updated_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async updatePendingInterview(input: {
    personId: string;
    expectedRevision: number;
    messages: readonly InterviewMessage[];
    completenessConfidence: InterviewCompleteness;
    proposedProfile?: string;
    now: Date;
  }): Promise<number | null> {
    const parsed = interviewMessageSchema.shape.messages.parse(input.messages);
    const proposedProfile =
      input.proposedProfile === undefined
        ? null
        : profileTextSchema.parse(input.proposedProfile);
    const completenessConfidence = interviewCompletenessSchema.parse(
      input.completenessConfidence,
    );
    const result = await this.executor.query<{ revision: number }>(
      `UPDATE pending_interviews
       SET messages = $3::jsonb,
           proposed_profile = COALESCE($5, proposed_profile),
           completeness_confidence = $6,
           revision = revision + 1,
           updated_at = $4::timestamptz
       WHERE person_id = $1::uuid AND revision = $2 AND expires_at > $4::timestamptz
       RETURNING revision`,
      [
        input.personId,
        input.expectedRevision,
        JSON.stringify(parsed),
        input.now,
        proposedProfile,
        completenessConfidence,
      ],
    );
    return result.rows[0]?.revision ?? null;
  }

  async saveApprovedProfile(input: {
    personId: string;
    exactText: string;
    sha256: string;
    embedding: readonly number[];
    embeddingModelId: string;
    embeddingVersion: string;
    promptVersion: string;
    consentVersion: string;
    now: Date;
    expectedPendingRevision?: number;
    expectedProposedProfile?: string;
  }): Promise<boolean> {
    return this.executor.transaction(async (transaction) => {
      if (input.expectedPendingRevision !== undefined) {
        const pending = await transaction.query(
          `SELECT 1
           FROM pending_interviews
           WHERE person_id = $1::uuid
             AND revision = $2
             AND expires_at > $3::timestamptz
             AND ($4::text IS NULL OR proposed_profile = $4)
           FOR UPDATE`,
          [
            input.personId,
            input.expectedPendingRevision,
            input.now,
            input.expectedProposedProfile ?? null,
          ],
        );
        if (pending.rowCount === 0) return false;
      }
      await transaction.query(
        `INSERT INTO profiles(person_id, approved_text, approved_text_sha256, embedding, embedding_model_id,
           embedding_version, profile_prompt_version, approved_at)
         VALUES ($1::uuid, $2, $3, $4::vector, $5, $6, $7, $8)
         ON CONFLICT (person_id) DO UPDATE SET
           approved_text = EXCLUDED.approved_text,
           approved_text_sha256 = EXCLUDED.approved_text_sha256,
           embedding = EXCLUDED.embedding,
           embedding_model_id = EXCLUDED.embedding_model_id,
           embedding_version = EXCLUDED.embedding_version,
           profile_prompt_version = EXCLUDED.profile_prompt_version,
           approved_at = EXCLUDED.approved_at`,
        [
          input.personId,
          input.exactText,
          input.sha256,
          vectorLiteral(input.embedding),
          input.embeddingModelId,
          input.embeddingVersion,
          input.promptVersion,
          input.now,
        ],
      );
      await transaction.query(
        `UPDATE people SET status = 'ACTIVE', content_updated_at = $2, last_verified_at = $2,
           deactivated_at = NULL, scheduled_purge_at = NULL, consent_version = $3, consent_accepted_at = $2
         WHERE id = $1::uuid`,
        [input.personId, input.now, input.consentVersion],
      );
      await transaction.query(
        "DELETE FROM pending_interviews WHERE person_id = $1::uuid",
        [input.personId],
      );
      return true;
    });
  }

  async setStatus(
    personId: string,
    status: ProfileStatus,
    now: Date,
  ): Promise<void> {
    const stale = status === "INACTIVE_STALE" || status === "PENDING_PURGE";
    await this.executor.query(
      `UPDATE people SET status = $2::person_status,
       deactivated_at = CASE WHEN $3 THEN COALESCE(deactivated_at, $4) ELSE NULL END,
       scheduled_purge_at = CASE WHEN $3 THEN COALESCE(scheduled_purge_at, $4::timestamptz + interval '4 weeks') ELSE NULL END
       WHERE id = $1::uuid`,
      [personId, status, stale, now],
    );
  }

  async verify(personId: string, now: Date): Promise<void> {
    await this.executor.query(
      `UPDATE people SET status = 'ACTIVE', last_verified_at = $2, deactivated_at = NULL, scheduled_purge_at = NULL
       WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM profiles WHERE person_id = $1::uuid)`,
      [personId, now],
    );
  }

  async updateName(
    personId: string,
    displayName: string,
    normalizedDisplayName: string,
  ): Promise<void> {
    await this.executor.query(
      "UPDATE people SET display_name = $2, normalized_display_name = $3 WHERE id = $1::uuid",
      [personId, displayName, normalizedDisplayName],
    );
  }

  async emails(personId: string): Promise<
    {
      id: string;
      displayEmail: string;
      verifiedAt: Date | null;
      isPrimary: boolean;
      deliverability: string;
    }[]
  > {
    const result = await this.executor.query<{
      id: string;
      display_email: string;
      verified_at: Date | null;
      is_primary: boolean;
      deliverability: string;
    }>(
      `SELECT id::text, display_email, verified_at, is_primary, deliverability
       FROM person_emails WHERE person_id = $1::uuid ORDER BY is_primary DESC, created_at`,
      [personId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayEmail: row.display_email,
      verifiedAt: row.verified_at,
      isPrimary: row.is_primary,
      deliverability: row.deliverability,
    }));
  }

  async hybridCandidates(input: {
    query: string;
    exactTerms: readonly string[];
    embedding: readonly number[];
    embeddingModelId: string;
    embeddingVersion: string;
    now: Date;
    limit?: number;
  }): Promise<SearchCandidate[]> {
    const limit = Math.min(input.limit ?? 25, 25);
    const result = await this.executor.query<{
      id: string;
      approved_text: string;
      lexical_rank: number | null;
      vector_rank: number | null;
      fuzzy_rank: number | null;
    }>(
      `WITH eligible AS MATERIALIZED (
         SELECT p.id, pr.approved_text, pr.search_document, pr.embedding
         FROM people p JOIN profiles pr ON pr.person_id = p.id
         WHERE p.status = 'ACTIVE' AND p.consent_accepted_at IS NOT NULL
           AND p.last_verified_at > $5::timestamptz - interval '58 weeks'
           AND pr.embedding_model_id = $3 AND pr.embedding_version = $4
       ), lexical AS (
         SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_document, websearch_to_tsquery('english', $1)) DESC, id) lexical_rank
         FROM eligible WHERE search_document @@ websearch_to_tsquery('english', $1) LIMIT $6
       ), semantic AS (
         SELECT id, row_number() OVER (ORDER BY embedding <=> $2::vector, id) vector_rank FROM eligible LIMIT $6
       ), fuzzy AS (
         SELECT id, row_number() OVER (ORDER BY similarity(approved_text, array_to_string($7::text[], ' ')) DESC, id) fuzzy_rank
         FROM eligible WHERE approved_text % array_to_string($7::text[], ' ') LIMIT $6
       ), candidates AS (
         SELECT id FROM lexical UNION SELECT id FROM semantic UNION SELECT id FROM fuzzy
       )
       SELECT e.id::text, e.approved_text, l.lexical_rank::int, s.vector_rank::int, f.fuzzy_rank::int
       FROM candidates c JOIN eligible e USING (id)
       LEFT JOIN lexical l USING (id) LEFT JOIN semantic s USING (id) LEFT JOIN fuzzy f USING (id)`,
      [
        input.query,
        vectorLiteral(input.embedding),
        input.embeddingModelId,
        input.embeddingVersion,
        input.now,
        limit,
        input.exactTerms,
      ],
    );
    return result.rows.map((row) => ({
      id: row.id,
      approvedText: row.approved_text,
      lexicalRank: row.lexical_rank,
      vectorRank: row.vector_rank,
      fuzzyRank: row.fuzzy_rank,
    }));
  }

  async purgePerson(
    personId: string,
    pseudonymousRef: string,
    reason: string,
    now: Date,
    backupDays = 35,
  ): Promise<void> {
    await this.executor.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO purge_events(pseudonymous_person_ref, purged_at, reason, backup_expires_at)
         VALUES ($1, $2::timestamptz, $3, $2::timestamptz + ($4::text || ' days')::interval)
         ON CONFLICT (pseudonymous_person_ref) DO NOTHING`,
        [pseudonymousRef, now, reason, backupDays],
      );
      await transaction.query("DELETE FROM people WHERE id = $1::uuid", [
        personId,
      ]);
    });
  }

  async writeAudit(input: {
    actorType: string;
    actorId: string;
    roles?: readonly StaffGroup[];
    action: string;
    targetId?: string;
    correlationId: string;
    resultIds?: readonly string[];
    modelVersion?: string;
    promptVersion?: string;
    succeeded: boolean;
    metadata?: Readonly<Record<string, string | number | boolean>>;
  }): Promise<string> {
    const result = await this.executor.query<{ id: string }>(
      `INSERT INTO audit_events(actor_type, actor_id, effective_roles, action, target_uuid, correlation_id,
         result_uuids, model_version, prompt_version, succeeded, metadata)
       VALUES ($1, $2, $3::text[], $4, $5::uuid, $6::uuid, $7::uuid[], $8, $9, $10, $11::jsonb) RETURNING id::text`,
      [
        input.actorType,
        input.actorId,
        input.roles ?? [],
        input.action,
        input.targetId ?? null,
        input.correlationId,
        input.resultIds ?? [],
        input.modelVersion ?? null,
        input.promptVersion ?? null,
        input.succeeded,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("AuditWriteFailed");
    return id;
  }
}
