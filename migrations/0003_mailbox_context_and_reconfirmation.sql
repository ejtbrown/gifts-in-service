BEGIN;

ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS pending_display_email text;
ALTER TABLE member_sessions ADD COLUMN IF NOT EXISTS mailbox_display_email text;
ALTER TABLE member_sessions ADD COLUMN IF NOT EXISTS verification_cycle_id uuid;

COMMIT;
