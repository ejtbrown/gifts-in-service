BEGIN;

CREATE INDEX IF NOT EXISTS magic_link_add_email_person_quota_idx
  ON magic_link_tokens(person_id, issued_at DESC)
  WHERE purpose = 'ADD_EMAIL';

CREATE INDEX IF NOT EXISTS magic_link_add_email_recipient_quota_idx
  ON magic_link_tokens(abuse_email_hash, issued_at DESC)
  WHERE purpose = 'ADD_EMAIL';

COMMIT;
