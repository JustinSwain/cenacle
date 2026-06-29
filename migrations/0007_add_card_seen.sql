-- Track card impressions separately from detail reads. Seeing a card clears the
-- new-post / Prayer-Log signal; opening its detail still clears new replies.
ALTER TABLE seen ADD COLUMN card_seen_at INTEGER NOT NULL DEFAULT 0;

-- A prior detail read necessarily included a card impression.
UPDATE seen SET card_seen_at = seen_at;
