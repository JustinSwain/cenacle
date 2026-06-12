-- Enforce one prayer signal per member per request. If earlier versions allowed
-- duplicate taps through a race, keep the earliest row and remove the rest
-- before adding the unique index.
DELETE FROM prayers
WHERE id NOT IN (
  SELECT MIN(id)
  FROM prayers
  GROUP BY request_id, member_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prayers_request_member_unique
  ON prayers(request_id, member_id);
