BEGIN;

ALTER TABLE pending_interviews
  ADD COLUMN IF NOT EXISTS proposed_profile text;

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_proposed_profile_length
    CHECK (
      proposed_profile IS NULL
      OR char_length(proposed_profile) BETWEEN 50 AND 6000
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
