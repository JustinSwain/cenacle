-- Short invite codes are easy to type, so login attempts are rate-limited by
-- hashed client IP and attempted code hash. Raw IPs and raw codes are never
-- stored in this table.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  succeeded   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_subject_time
  ON login_attempts(subject, created_at);
