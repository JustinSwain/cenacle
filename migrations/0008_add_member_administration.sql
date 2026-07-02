-- Support routine member administration inside the app. Revocation keeps the
-- member row (and therefore authorship history) while invalidating every live
-- session and preventing the invite code from minting another one.
ALTER TABLE members ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

-- Preserve revocations made with the CLI convention from earlier releases.
UPDATE members SET active = 0 WHERE token_hash LIKE 'revoked-%';

CREATE INDEX IF NOT EXISTS idx_members_active_role
  ON members(active, role);

-- Keep a small, append-only account of privileged membership changes. Raw
-- invite codes and their hashes never enter this table.
CREATE TABLE IF NOT EXISTS admin_audit (
  id               INTEGER PRIMARY KEY,
  actor_id         INTEGER NOT NULL REFERENCES members(id),
  action           TEXT NOT NULL,
  target_member_id INTEGER NOT NULL REFERENCES members(id),
  details          TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit(created_at DESC);
