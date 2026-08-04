/*
# SMS Fleet Profiles — multi-vessel SMS assignment

1. New Tables
- `sms_profiles`: named SMS profile templates per tenant (e.g. "Universal Fleet Baseline", "Tanker Fleet SMS").
  - `id` (uuid PK)
  - `tenant_id` (uuid FK → tenants)
  - `name` (text, not null)
  - `version` (text, default '1.0.0')
  - `is_default` (boolean, default false — one default per tenant)
  - `created_at` / `updated_at` (timestamptz)
- `sms_profile_vessels`: junction table mapping vessels to SMS profiles (many-to-many).
  - `profile_id` (uuid FK → sms_profiles, ON DELETE CASCADE)
  - `vessel_id` (uuid FK → vessels, ON DELETE CASCADE)
  - PRIMARY KEY (profile_id, vessel_id)

2. Security
- RLS enabled on both tables.
- Tenant-scoped CRUD: users can only access rows belonging to their tenant.
- Policies use `EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id)` for ownership checks.

3. Important Notes
- Each tenant can have one default profile (`is_default = true`).
- Vessels not assigned to any profile fall back to the default profile.
- The Company Admin creates and manages profiles; the Vessel Portal reads the profile assigned to the current vessel.
*/

CREATE TABLE IF NOT EXISTS sms_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sms_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sms_profiles" ON sms_profiles;
CREATE POLICY "select_own_sms_profiles" ON sms_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id));

DROP POLICY IF EXISTS "insert_own_sms_profiles" ON sms_profiles;
CREATE POLICY "insert_own_sms_profiles" ON sms_profiles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id));

DROP POLICY IF EXISTS "update_own_sms_profiles" ON sms_profiles;
CREATE POLICY "update_own_sms_profiles" ON sms_profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id));

DROP POLICY IF EXISTS "delete_own_sms_profiles" ON sms_profiles;
CREATE POLICY "delete_own_sms_profiles" ON sms_profiles
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id));

-- Also allow super_admins to read all profiles
DROP POLICY IF EXISTS "super_admin_select_sms_profiles" ON sms_profiles;
CREATE POLICY "super_admin_select_sms_profiles" ON sms_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE auth_uid = auth.uid()));

CREATE TABLE IF NOT EXISTS sms_profile_vessels (
  profile_id uuid NOT NULL REFERENCES sms_profiles(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (profile_id, vessel_id)
);

ALTER TABLE sms_profile_vessels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "select_own_profile_vessels" ON sms_profile_vessels
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id
    ))
    OR EXISTS (SELECT 1 FROM super_admins WHERE auth_uid = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "insert_own_profile_vessels" ON sms_profile_vessels
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id
    ))
  );

DROP POLICY IF EXISTS "delete_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "delete_own_profile_vessels" ON sms_profile_vessels
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid() AND tenant_id = sms_profiles.tenant_id
    ))
  );

CREATE INDEX IF NOT EXISTS idx_sms_profiles_tenant ON sms_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_vessel ON sms_profile_vessels(vessel_id);
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_profile ON sms_profile_vessels(profile_id);
