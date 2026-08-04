/*
# Enforce 1:1 vessel-to-profile mutual exclusivity

## Background
The `sms_profile_vessels` junction table was originally many-to-many (PK on
`profile_id, vessel_id`), allowing a vessel to be assigned to multiple SMS
profiles simultaneously. The product requirement is strict mutual exclusivity:
each vessel belongs to exactly ONE SMS fleet profile at a time.

## Changes
1. Add a UNIQUE constraint on `vessel_id` alone so the database rejects any
   insert that would give a vessel a second profile binding.
2. Clean up any existing duplicate assignments before adding the constraint
   (keep the most recent `assigned_at` row per vessel).
3. Add an index on `vessel_id` (already exists, but ensure it's there).

## Security
- No RLS policy changes. Existing policies remain intact.
- The constraint is a data-integrity guard, not a security control.
*/

-- Step 1: Remove duplicate vessel assignments, keeping the most recent one per vessel
DELETE FROM sms_profile_vessels pv
WHERE EXISTS (
  SELECT 1 FROM sms_profile_vessels pv2
  WHERE pv2.vessel_id = pv.vessel_id
    AND pv2.assigned_at > pv.assigned_at
);

-- Step 2: Add unique constraint on vessel_id (1 vessel = 1 profile)
DROP INDEX IF EXISTS idx_sms_profile_vessels_vessel_unique;
CREATE UNIQUE INDEX idx_sms_profile_vessels_vessel_unique ON sms_profile_vessels(vessel_id);

-- Step 3: Ensure the standard lookup index still exists
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_vessel ON sms_profile_vessels(vessel_id);
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_profile ON sms_profile_vessels(profile_id);
