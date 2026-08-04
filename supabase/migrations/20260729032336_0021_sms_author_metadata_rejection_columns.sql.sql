/*
# SMS Author Metadata & Rejection Comments

1. Purpose
   Adds author/origin tracking columns and a rejection-comments column to
   `sms_documents` so the DPA can see WHO submitted a revision, from WHERE
   (vessel or shoreside), and WHY a revision was rejected.

2. New Columns on `sms_documents`
   - `author_name` (text, nullable) — e.g. "Capt. Lars Anderson"
   - `author_role` (text, nullable) — e.g. "Master" or "DPA"
   - `author_origin` (text, nullable) — e.g. "MV Polar Explorer" or "Shoreside HQ"
   - `rejection_comments` (text, nullable) — DPA feedback when a revision is rejected

3. Notes
   - All columns are nullable so existing rows are unaffected.
   - The `approval_state` column already exists; the app now uses 'rejected'
     as a value in addition to 'draft', 'pending_dpa', 'approved'.
   - No existing columns or data are modified or removed.
*/

ALTER TABLE sms_documents
  ADD COLUMN IF NOT EXISTS author_name text,
  ADD COLUMN IF NOT EXISTS author_role text,
  ADD COLUMN IF NOT EXISTS author_origin text,
  ADD COLUMN IF NOT EXISTS rejection_comments text;