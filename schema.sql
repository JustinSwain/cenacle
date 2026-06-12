-- Prayer app D1 schema. Full snapshot for reference; the authoritative
-- apply path is migrations/0001_init.sql (see README.md).

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,            -- SHA-256 of the invite code; raw code never stored
  token_version INTEGER NOT NULL DEFAULT 1,      -- bump to instantly invalidate all live sessions
  role          TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'admin'
  joined_at     INTEGER NOT NULL,                -- epoch ms
  last_seen_at  INTEGER                          -- epoch ms, frozen first-visit baseline for "new to you"
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES members(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',  -- general|health|family|work|spiritual|praise
  status       TEXT NOT NULL DEFAULT 'open',     -- open|answered|archived
  is_anonymous INTEGER NOT NULL DEFAULT 0,       -- legacy column; anonymous posts are no longer supported
  created_at   INTEGER NOT NULL,
  answered_at  INTEGER,
  answer_note  TEXT
);

CREATE TABLE IF NOT EXISTS prayers (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS updates (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Per-member read tracking: when a member last opened a request's detail.
-- Drives the "new to you" highlight (a request is new when its latest activity
-- post-dates the member's seen_at, or it was never opened).
CREATE TABLE IF NOT EXISTS seen (
  member_id   INTEGER NOT NULL REFERENCES members(id),
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (member_id, request_id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL,                     -- HMAC of IP or attempted code hash; raw values never stored
  created_at  INTEGER NOT NULL,
  succeeded   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prayers_request ON prayers(request_id);
CREATE INDEX IF NOT EXISTS idx_prayers_member  ON prayers(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prayers_request_member_unique
  ON prayers(request_id, member_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_updates_request ON updates(request_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_subject_time
  ON login_attempts(subject, created_at);
