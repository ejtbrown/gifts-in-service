BEGIN;

CREATE TABLE IF NOT EXISTS pending_interviews (
  person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (updated_at >= started_at),
  CHECK (expires_at = started_at + interval '30 days')
);

CREATE INDEX IF NOT EXISTS pending_interview_cleanup_idx
  ON pending_interviews(expires_at);

-- Preserve currently usable sessions when the lifetime policy changes. The
-- browser receives a cookie with the matching remaining lifetime on its next
-- authenticated request.
UPDATE member_sessions
SET idle_expires_at = issued_at + interval '30 days',
    absolute_expires_at = issued_at + interval '30 days'
WHERE revoked_at IS NULL
  AND idle_expires_at > now()
  AND absolute_expires_at > now();

COMMIT;
