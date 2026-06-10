-- Adds an "edited_at" marker to requests so the UI can show when an author has
-- revised a request after posting. NULL means never edited.
ALTER TABLE requests ADD COLUMN edited_at INTEGER;
