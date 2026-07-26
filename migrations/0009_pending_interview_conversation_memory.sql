BEGIN;

ALTER TABLE pending_interviews
  ADD COLUMN IF NOT EXISTS conversation_memory jsonb NOT NULL
  DEFAULT '{"establishedFacts":[],"closedTopics":[]}'::jsonb;

DO $$ BEGIN
  ALTER TABLE pending_interviews
    ADD CONSTRAINT pending_interviews_conversation_memory_shape
    CHECK (
      jsonb_typeof(conversation_memory) = 'object'
      AND conversation_memory ? 'establishedFacts'
      AND jsonb_typeof(conversation_memory->'establishedFacts') = 'array'
      AND jsonb_array_length(conversation_memory->'establishedFacts') <= 16
      AND conversation_memory ? 'closedTopics'
      AND jsonb_typeof(conversation_memory->'closedTopics') = 'array'
      AND jsonb_array_length(conversation_memory->'closedTopics') <= 8
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
