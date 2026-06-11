-- Per-member, per-request read tracking for the "new to you" system.
--
-- A row records the moment a member last opened a request's detail. A request
-- is "new to you" when it has activity more recent than your seen_at for it -
-- a new post by someone else, a move to the Prayer Log, or a comment from
-- someone else. Opening the request writes/updates the row, clearing it.
--
-- This replaces the single consume-on-read members.last_seen_at marker, which
-- conflated three different signals into opaque per-tab counts and advanced on
-- every /me call. last_seen_at is kept, but now means only a frozen first-visit
-- baseline (the floor below which activity counts as already seen), so members
-- are never greeted with a backlog.
CREATE TABLE IF NOT EXISTS seen (
  member_id   INTEGER NOT NULL REFERENCES members(id),
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  seen_at     INTEGER NOT NULL,                -- epoch ms the member last opened this request
  PRIMARY KEY (member_id, request_id)
);
