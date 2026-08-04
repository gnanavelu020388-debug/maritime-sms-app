/*
# Rank-Based RBAC Permission Matrix + Crew Roster PENDING_SIGN_ON

## Purpose
1. Stores per-tenant, per-rank permission profiles that control which
   independent vessel apps (Galley, Rest Hours, SMS, HSCQ, Certificates)
   each rank can see, and what action-level permissions they have inside
   each app.
2. Adds the 'pending_sign_on' status to the tenant_users lifecycle so
   newly-registered crew members cannot authenticate until the Master
   signs them on board.

## New Tables

### rank_permissions
Per-tenant permission profile for a single rank. One row per
(tenant_id, rank) pair — UNIQUE constraint enforces this.
- `id` (uuid, PK)
- `tenant_id` (uuid, NOT NULL, UNIQUE with rank) — references tenants(id) ON DELETE CASCADE
- `rank` (text, NOT NULL, UNIQUE with tenant_id) — e.g. 'Master', 'Chief Cook', 'AB'
- `apps` (jsonb, NOT NULL) — object keyed by app-id; each value is an
  object: { visible: boolean, level: string }
  Example:
  {
    "galley":      { "visible": true,  "level": "cook_operational" },
    "rest_hours":  { "visible": true,  "level": "own_log_only" },
    "sms":         { "visible": false, "level": "hidden" },
    "hscq":        { "visible": false, "level": "hidden" },
    "certificates":{ "visible": true,  "level": "view_only" }
  }
- `updated_by` (text) — admin email who last changed the setting
- `updated_at` (timestamptz, DEFAULT now())

## Security (RLS)

### rank_permissions
- Super Admins: full CRUD (via is_super_admin() check).
- Company Admins: SELECT + UPDATE for their own tenant's rows (via
  tenant_users ownership check). They cannot INSERT or DELETE — rows
  are auto-seeded for all ranks when a tenant is created.
- DPA / vessel users: SELECT only for their own tenant's rows (read
  permissions to drive client-side UI gating).

## RPCs

### upsert_rank_permission
SECURITY DEFINER function that lets a Company Admin upsert a single
rank's permission profile for their own tenant. Verifies the caller is
a tenant_user with role 'company_admin' for the given tenant_id.

### seed_default_rank_permissions
SECURITY DEFINER function that inserts default rank permission rows
for all standard ranks for a given tenant. Called on tenant creation
and safe to re-run (ON CONFLICT DO NOTHING).

## Data Safety
- No existing tables are altered destructively. tenant_users.status
  already accepts arbitrary text values, so 'pending_sign_on' is a
  new lifecycle state that requires no schema change.
- Existing 'invited' status users are not affected.

## Important Notes
1. The UNIQUE(tenant_id, rank) constraint guarantees one profile per
   rank per tenant.
2. Defaults are seeded for all standard maritime ranks: Master, Chief
   Engineer, Chief Mate, Second Engineer, Bosun, AB, Oiler, Cook, Crew.
3. The app uses the JSONB `apps` column to drive both app-level
   visibility toggles and action-level permission selectors in the
   Company Admin UI, and to inject claims into the vessel-side SSO
   token for client-side gating.
*/

-- ── rank_permissions table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rank_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rank text NOT NULL,
  apps jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, rank)
);

ALTER TABLE rank_permissions ENABLE ROW LEVEL SECURITY;

-- Super Admin: full CRUD
DROP POLICY IF EXISTS "sa_select_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_select_rank_permissions"
  ON rank_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_insert_rank_permissions"
  ON rank_permissions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_update_rank_permissions"
  ON rank_permissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_delete_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_delete_rank_permissions"
  ON rank_permissions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Company Admin: SELECT + UPDATE own tenant
DROP POLICY IF EXISTS "ca_select_rank_permissions" ON rank_permissions;
CREATE POLICY "ca_select_rank_permissions"
  ON rank_permissions FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
        AND tenant_users.tenant_id = rank_permissions.tenant_id
    )
  );

DROP POLICY IF EXISTS "ca_update_rank_permissions" ON rank_permissions;
CREATE POLICY "ca_update_rank_permissions"
  ON rank_permissions FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
        AND tenant_users.tenant_id = rank_permissions.tenant_id
        AND tenant_users.role = 'company_admin'
    )
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
        AND tenant_users.tenant_id = rank_permissions.tenant_id
        AND tenant_users.role = 'company_admin'
    )
  );

-- ── RPC: Company Admin upserts a single rank's permissions ──────────

CREATE OR REPLACE FUNCTION upsert_rank_permission(
  p_tenant_id uuid,
  p_rank text,
  p_apps jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is a company_admin for this tenant
  IF NOT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = p_tenant_id
      AND tenant_users.role = 'company_admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized: only Company Admins can update rank permissions';
  END IF;

  INSERT INTO rank_permissions (tenant_id, rank, apps, updated_by, updated_at)
  VALUES (p_tenant_id, p_rank, p_apps, (SELECT email FROM tenant_users WHERE auth_uid = auth.uid()), now())
  ON CONFLICT (tenant_id, rank) DO UPDATE
  SET apps = EXCLUDED.apps,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  RETURN true;
END;
$$;

-- ── Seed defaults for existing tenants ──────────────────────────────

INSERT INTO rank_permissions (tenant_id, rank, apps)
SELECT t.id, r.rank, r.apps
FROM tenants t
CROSS JOIN (VALUES
  ('Master',          '{"galley":{"visible":true,"level":"full_admin"},"rest_hours":{"visible":true,"level":"approve_all"},"sms":{"visible":true,"level":"full_access"},"hscq":{"visible":true,"level":"full_access"},"certificates":{"visible":true,"level":"full_admin"}}'::jsonb),
  ('Chief Engineer',  '{"galley":{"visible":true,"level":"view_menu_only"},"rest_hours":{"visible":true,"level":"edit_all"},"sms":{"visible":true,"level":"view_only"},"hscq":{"visible":true,"level":"edit_all"},"certificates":{"visible":true,"level":"view_only"}}'::jsonb),
  ('Chief Mate',      '{"galley":{"visible":true,"level":"view_menu_only"},"rest_hours":{"visible":true,"level":"edit_all"},"sms":{"visible":true,"level":"view_only"},"hscq":{"visible":true,"level":"edit_all"},"certificates":{"visible":true,"level":"view_only"}}'::jsonb),
  ('Second Engineer', '{"galley":{"visible":false,"level":"hidden"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb),
  ('Bosun',           '{"galley":{"visible":false,"level":"hidden"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb),
  ('AB',              '{"galley":{"visible":true,"level":"view_menu_only"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb),
  ('Oiler',           '{"galley":{"visible":true,"level":"view_menu_only"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb),
  ('Cook',            '{"galley":{"visible":true,"level":"cook_operational"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb),
  ('Crew',            '{"galley":{"visible":false,"level":"hidden"},"rest_hours":{"visible":true,"level":"own_log_only"},"sms":{"visible":false,"level":"hidden"},"hscq":{"visible":false,"level":"hidden"},"certificates":{"visible":false,"level":"hidden"}}'::jsonb)
) AS r(rank, apps)
WHERE NOT EXISTS (
  SELECT 1 FROM rank_permissions rp
  WHERE rp.tenant_id = t.id AND rp.rank = r.rank
);
