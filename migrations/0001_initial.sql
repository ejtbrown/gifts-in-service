BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE person_status AS ENUM ('ACTIVE', 'PAUSED', 'INACTIVE_STALE', 'PENDING_PURGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE deliverability_status AS ENUM ('DELIVERABLE', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'COMPLAINT', 'SUPPRESSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE magic_link_purpose AS ENUM ('LOGIN_OR_CREATE', 'RECONFIRM', 'ADD_EMAIL', 'STAFF_INVITE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  normalized_display_name text NOT NULL CHECK (normalized_display_name = lower(btrim(normalized_display_name))),
  status person_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  content_updated_at timestamptz,
  last_verified_at timestamptz,
  last_verification_request_at timestamptz,
  deactivated_at timestamptz,
  scheduled_purge_at timestamptz,
  consent_version text NOT NULL,
  consent_accepted_at timestamptz NOT NULL,
  CHECK ((status IN ('INACTIVE_STALE', 'PENDING_PURGE')) = (deactivated_at IS NOT NULL)),
  CHECK (scheduled_purge_at IS NULL OR deactivated_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS person_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  display_email text NOT NULL CHECK (char_length(display_email) <= 254),
  normalized_email text NOT NULL CHECK (normalized_email = lower(btrim(normalized_email))),
  verified_at timestamptz,
  is_primary boolean NOT NULL DEFAULT false,
  deliverability deliverability_status NOT NULL DEFAULT 'DELIVERABLE',
  bounced_at timestamptz,
  complained_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, normalized_email),
  CHECK (NOT is_primary OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_verified_email_per_person
  ON person_emails(person_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS person_emails_normalized_email_idx ON person_emails(normalized_email);

CREATE TABLE IF NOT EXISTS profiles (
  person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  approved_text text NOT NULL CHECK (char_length(approved_text) BETWEEN 50 AND 6000),
  approved_text_sha256 char(64) NOT NULL CHECK (approved_text_sha256 ~ '^[a-f0-9]{64}$'),
  embedding vector(__EMBEDDING_DIMENSION__) NOT NULL,
  embedding_model_id text NOT NULL,
  embedding_version text NOT NULL,
  profile_prompt_version text NOT NULL,
  approved_at timestamptz NOT NULL,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('english', approved_text)) STORED
);
CREATE INDEX IF NOT EXISTS profiles_search_document_idx ON profiles USING gin(search_document);
CREATE INDEX IF NOT EXISTS profiles_approved_text_trgm_idx ON profiles USING gin(approved_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_embedding_hnsw_idx ON profiles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  purpose magic_link_purpose NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  normalized_email_context text NOT NULL,
  pending_display_name text,
  consent_version text,
  verification_cycle_id uuid,
  abuse_email_hash char(64),
  abuse_network_hash char(64),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  superseded_at timestamptz,
  CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS magic_link_cleanup_idx ON magic_link_tokens(expires_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS magic_link_cycle_idx ON magic_link_tokens(verification_cycle_id) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS member_sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  mailbox_normalized_email text,
  selected_person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  csrf_hash char(64) NOT NULL,
  issued_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX IF NOT EXISTS member_session_cleanup_idx ON member_sessions(absolute_expires_at);

CREATE TABLE IF NOT EXISTS profile_approval_tokens (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  pending_session_hash char(64),
  approved_text_sha256 char(64) NOT NULL,
  consent_version text NOT NULL,
  prompt_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  cognito_subject text NOT NULL,
  effective_groups text[] NOT NULL,
  effective_permissions text[] NOT NULL,
  csrf_hash char(64) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state_hash char(64) PRIMARY KEY,
  nonce_hash char(64) NOT NULL,
  pkce_verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  pseudonymous_person_ref char(64),
  event_type text NOT NULL,
  verification_cycle_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  scheduled_at timestamptz NOT NULL,
  attempted_at timestamptz,
  completed_at timestamptz,
  email_record_ids uuid[] NOT NULL DEFAULT '{}',
  outcome text,
  error_class text
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  effective_roles text[] NOT NULL DEFAULT '{}',
  action text NOT NULL,
  target_uuid uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  result_uuids uuid[] NOT NULL DEFAULT '{}',
  model_version text,
  prompt_version text,
  succeeded boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (NOT (metadata ?| ARRAY['email','displayName','approvedText','profileText','token','conversation','cookie']))
);
CREATE INDEX IF NOT EXISTS audit_occurred_idx ON audit_events(occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_query_payloads (
  audit_event_id uuid PRIMARY KEY REFERENCES audit_events(id) ON DELETE CASCADE,
  protected_query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redacted_at timestamptz
);

CREATE TABLE IF NOT EXISTS purge_events (
  pseudonymous_person_ref char(64) PRIMARY KEY,
  purged_at timestamptz NOT NULL,
  reason text NOT NULL,
  backup_expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS email_events (
  ses_message_id text NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  email_record_id uuid REFERENCES person_emails(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  normalized_outcome text NOT NULL,
  PRIMARY KEY (ses_message_id, event_type)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
