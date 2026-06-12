-- Anonymous posting is no longer part of the product. Existing rows are made
-- normal named requests; the legacy column remains for compatibility.
UPDATE requests SET is_anonymous = 0 WHERE is_anonymous != 0;
