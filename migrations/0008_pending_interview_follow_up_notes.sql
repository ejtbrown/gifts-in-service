BEGIN;

ALTER TABLE pending_interviews
  ADD COLUMN IF NOT EXISTS follow_up_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_follow_up_notes_shape
    CHECK (
      jsonb_typeof(follow_up_notes) = 'array'
      AND jsonb_array_length(follow_up_notes) <= 8
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_follow_up_notes_require_low_confidence
    CHECK (
      jsonb_array_length(follow_up_notes) = 0
      OR completeness_confidence = 'LOW'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
