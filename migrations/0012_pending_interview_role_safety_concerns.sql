BEGIN;

ALTER TABLE pending_interviews
  ADD COLUMN IF NOT EXISTS role_safety_concerns jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_role_safety_concerns_shape
    CHECK (
      jsonb_typeof(role_safety_concerns) = 'array'
      AND jsonb_array_length(role_safety_concerns) <= 5
      AND role_safety_concerns <@ '["INFANT_CARE","CHILD_SUPERVISION","VULNERABLE_ADULT_CARE","PASSENGER_TRANSPORT","FINANCIAL_HANDLING"]'::jsonb
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
