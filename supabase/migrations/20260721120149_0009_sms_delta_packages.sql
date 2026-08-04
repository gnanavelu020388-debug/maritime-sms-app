/*
# SMS Delta Package Storage — Satellite Delta Synchronization

## Purpose
Stores lightweight JSON delta packages compiled by the DPA during
"Approve & Deploy". Each delta captures only the newly added/modified
SMS documents between two version numbers, so vessels can download a
small patch over satellite instead of re-fetching the entire document
tree. The vessel's local Master Ship Server polls this table during
periodic satellite check-ins.

## New Table
- `sms_delta_packages`
  - `id` uuid PK
  - `tenant_id` uuid FK → tenants (cascade delete)
  - `from_version` text — the SMS version this delta builds on (e.g. '1.0.0')
  - `to_version` text   — the new SMS version after applying this delta (e.g. '1.1.0')
  - `delta_payload` jsonb — the lightweight diff payload:
      { upserted: SmsDocRow[], deleted: { id, tree_kind }[], version: string }
  - `deployed_by` text — DPA email who triggered the deploy
  - `created_at` timestamptz

## Indexes
- `idx_sms_delta_tenant` on (tenant_id, created_at DESC) — vessel check-in queries
- `idx_sms_delta_to_version` on (tenant_id, to_version) — lookup by target version

## Security (RLS)
- Super Admin: full access.
- company_admin / dpa: full access within their own tenant (they build the deltas).
- vessel users: read-only within their own tenant (the sync worker downloads deltas).
*/

CREATE TABLE IF NOT EXISTS sms_delta_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_version text NOT NULL,
  to_version text NOT NULL,
  delta_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deployed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_delta_packages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sms_delta_tenant
  ON sms_delta_packages (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_delta_to_version
  ON sms_delta_packages (tenant_id, to_version);

-- Super Admin: full access
DROP POLICY IF EXISTS "sms_delta_super_admin_all" ON sms_delta_packages;
CREATE POLICY "sms_delta_super_admin_all" ON sms_delta_packages
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- company_admin / dpa: full access within own tenant (build & deploy deltas)
DROP POLICY IF EXISTS "sms_delta_tenant_admin_write" ON sms_delta_packages;
CREATE POLICY "sms_delta_tenant_admin_write" ON sms_delta_packages
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role IN ('company_admin','dpa'))
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role IN ('company_admin','dpa'))
  );

-- vessel users: read-only within own tenant (sync worker downloads deltas)
DROP POLICY IF EXISTS "sms_delta_vessel_read" ON sms_delta_packages;
CREATE POLICY "sms_delta_vessel_read" ON sms_delta_packages
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );
