-- Prayer app D1 schema. Full snapshot for reference; the authoritative
-- apply path is migrations/0001_init.sql (see README.md).

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,            -- SHA-256 of the invite code; raw code never stored
  token_version INTEGER NOT NULL DEFAULT 1,      -- bump to instantly invalidate all live sessions
  role          TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'admin'
  joined_at     INTEGER NOT NULL,                -- epoch ms
  last_seen_at  INTEGER                          -- epoch ms, drives "new since last visit"
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES members(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',  -- general|health|family|work|spiritual|praise
  status       TEXT NOT NULL DEFAULT 'open',     -- open|answered|archived
  is_anonymous INTEGER NOT NULL DEFAULT 0,       -- 1 = author hidden from group, still attributed internally
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

CREATE INDEX IF NOT EXISTS idx_prayers_request ON prayers(request_id);
CREATE INDEX IF NOT EXISTS idx_prayers_member  ON prayers(member_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_updates_request ON updates(request_id);
