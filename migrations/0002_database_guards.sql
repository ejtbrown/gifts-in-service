BEGIN;

CREATE OR REPLACE FUNCTION prevent_last_verified_email_removal() RETURNS trigger AS $$
BEGIN
  IF OLD.verified_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM people WHERE id = OLD.person_id)
    AND NOT EXISTS (
    SELECT 1 FROM person_emails
    WHERE person_id = OLD.person_id
      AND id <> OLD.id
      AND verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cannot remove the last verified email association';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_last_verified_email ON person_emails;
CREATE TRIGGER protect_last_verified_email
  BEFORE DELETE ON person_emails
  FOR EACH ROW EXECUTE FUNCTION prevent_last_verified_email_removal();

CREATE OR REPLACE FUNCTION prevent_profile_history() RETURNS trigger AS $$
BEGIN
  IF NEW.person_id <> OLD.person_id THEN
    RAISE EXCEPTION 'profile ownership cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profile_ownership_immutable ON profiles;
CREATE TRIGGER profile_ownership_immutable
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_profile_history();

COMMIT;
