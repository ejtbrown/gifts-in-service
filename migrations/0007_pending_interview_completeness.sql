BEGIN;

ALTER TABLE pending_interviews
  ADD COLUMN IF NOT EXISTS completeness_confidence text NOT NULL DEFAULT 'LOW';

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_completeness_confidence
    CHECK (completeness_confidence IN ('LOW', 'MODERATE', 'HIGH'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
