BEGIN;

CREATE TABLE IF NOT EXISTS staff_trusted_devices (
  trust_hash char(64) PRIMARY KEY CHECK (trust_hash ~ '^[a-f0-9]{64}$'),
  cognito_subject text NOT NULL,
  cognito_username text NOT NULL CHECK (length(cognito_username) BETWEEN 1 AND 256),
  login_identifier text NOT NULL CHECK (length(login_identifier) BETWEEN 1 AND 254),
  device_key text NOT NULL CHECK (length(device_key) BETWEEN 1 AND 55),
  device_group_key text NOT NULL CHECK (length(device_group_key) BETWEEN 1 AND 256),
  device_credentials_ciphertext text NOT NULL CHECK (length(device_credentials_ciphertext) BETWEEN 40 AND 4096),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '30 days'),
  CHECK (last_used_at >= created_at)
);

CREATE INDEX IF NOT EXISTS staff_trusted_device_subject_idx
  ON staff_trusted_devices(cognito_subject, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_trusted_device_cleanup_idx
  ON staff_trusted_devices(expires_at);

COMMIT;
