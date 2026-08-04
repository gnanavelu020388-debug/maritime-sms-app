/*
# Add profile_id to sms_documents — bind documents to SMS Fleet Profiles

## Purpose
Enforces strict multi-tenant relational interlinking:
Tenant → Vessels → SMS Profiles → Documents → Audit Logs.

Documents are now explicitly bound to an SMS Fleet Profile via profile_id.
Vessels see only DPA-approved documents published under their assigned profile.

## Changes

1. New Column
   - `sms_documents.profile_id` (uuid, nullable, references `sms_profiles(id)`)
   - NULL means "universal" — visible to all vessels in the tenant (backwards compatible).
   - Non-NULL means the document is only visible to vessels assigned to that profile.
   - ON DELETE SET NULL: deleting a profile makes its docs universal rather than losing them.

2. Backfill
   - All existing documents are assigned to their tenant's default profile,
     so current docs remain visible to all vessels.

3. Index
   - Added an index on (tenant_id, profile_id) for fast profile-scoped queries
     used by the Vessel Portal.

## Security
- No RLS policy changes. Existing tenant-scoped RLS on sms_documents remains in effect.
- profile_id is a data attribute, not a security boundary — RLS still enforces tenant isolation.
*/

ALTER TABLE sms_documents
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES sms_profiles(id) ON DELETE SET NULL;

-- Backfill: assign existing docs to their tenant's default profile
UPDATE sms_documents d
SET profile_id = sub.default_profile_id
FROM (
  SELECT tenant_id, id AS default_profile_id
  FROM sms_profiles
  WHERE is_default = true
) AS sub
WHERE d.tenant_id = sub.tenant_id
  AND d.profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_documents_profile
  ON sms_documents (tenant_id, profile_id);