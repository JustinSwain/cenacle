-- migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  role          TEXT NOT NULL DEFAULT 'member',
  joined_at     INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES members(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  status       TEXT NOT NULL DEFAULT 'open',
  is_anonymous INTEGER NOT NULL DEFAULT 0,
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
