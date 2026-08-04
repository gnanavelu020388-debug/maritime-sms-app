-- Internal Access Matrix: classify super_admins into internal roles.
-- super_admin: Super-Admin, platform_auditor: Platform Auditor,
-- global_support: Global Support Staff.
ALTER TABLE super_admins
  ADD COLUMN IF NOT EXISTS internal_role text NOT NULL DEFAULT 'super_admin'
    CHECK (internal_role IN ('super_admin','platform_auditor','global_support')),
  ADD COLUMN IF NOT EXISTS display_name text;

-- Backfill existing super_admins to the unrestricted role.
UPDATE super_admins SET internal_role = 'super_admin' WHERE internal_role IS NULL;

-- Helper: resolve the internal role for the current auth user.
-- Returns 'super_admin' | 'platform_auditor' | 'global_support' | NULL.
CREATE OR REPLACE FUNCTION my_internal_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT internal_role FROM super_admins WHERE auth_uid = auth.uid();
$$;

-- Tenant archiving: block login for users of archived tenants.
-- tenant_users.status drives access; archived tenant rows are retained for
-- compliance (SMS history + audit logs), only login is blocked.
CREATE OR REPLACE FUNCTION is_tenant_archived(tenant_uuid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE id = tenant_uuid AND status = 'archived');
$$;
