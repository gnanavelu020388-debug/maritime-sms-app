-- ============================================================================
-- MARITIME SMS PLATFORM — COMPLETE DATABASE SETUP
-- ============================================================================
-- One-file consolidation of all 3 migrations for re-deploying the backend
-- on any new Supabase project (e.g. when moving to Azure hosting).
--
-- HOW TO USE (fresh Supabase project):
--   1. Create a new project at https://supabase.com (free tier is fine).
--   2. Open the SQL Editor (left sidebar → SQL Editor → New query).
--   3. Paste this entire file and click RUN.
--   4. Copy your new project's Project URL + anon public key
--      (Settings → API) into your app's .env:
--          VITE_SUPABASE_URL=<new url>
--          VITE_SUPABASE_ANON_KEY=<new anon key>
--   5. Deploy the frontend (dist/) to Azure Static Web Apps.
--
-- WHAT THIS CREATES:
--   7 tables:  super_admins, tenants, tenant_users, vessels,
--              crew_assignments, sms_documents, audit_logs
--   RLS:       enabled on every table, with role-scoped policies
--   Indexes:   on all hot lookup columns
--   Bootstrap: first user can self-register as Super Admin
--   Claim:     provisioned users auto-link to their auth account on signup
--
-- ORDER MATTERS: tables → RLS enable → helper fn → policies → indexes.
-- This file runs top-to-bottom with no manual steps in between.
-- ============================================================================


-- ============ STEP 1: Create all tables ============

CREATE TABLE IF NOT EXISTS super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  contact_email text NOT NULL,
  plan text NOT NULL DEFAULT 'Standard',
  status text NOT NULL DEFAULT 'provisioning',
  vessels_max int NOT NULL DEFAULT 5,
  seats_max int NOT NULL DEFAULT 25,
  storage_gb_max bigint NOT NULL DEFAULT 50,
  monthly_revenue numeric NOT NULL DEFAULT 0,
  region text NOT NULL DEFAULT 'EMEA',
  mfa_enforced bool NOT NULL DEFAULT true,
  modules text[] NOT NULL DEFAULT '{}',
  sms_version text NOT NULL DEFAULT '1.0.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  contract_expires timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  employee_id text,
  passport_number text,
  seaman_book_number text,
  nationality text,
  rank text NOT NULL DEFAULT 'Crew',
  role text NOT NULL DEFAULT 'vessel',
  status text NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vessels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  imo_number text UNIQUE NOT NULL,
  call_sign text,
  flag_state text,
  port_of_registry text,
  gross_tonnage numeric,
  kw_power numeric,
  vessel_type text,
  class_society text,
  sms_active_version text NOT NULL DEFAULT '1.0.0',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crew_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  rank text NOT NULL,
  signed_on_at timestamptz NOT NULL DEFAULT now(),
  signed_off_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES sms_documents(id) ON DELETE CASCADE,
  tree_kind text NOT NULL,
  label text NOT NULL,
  node_kind text NOT NULL CHECK (node_kind IN ('folder','document')),
  content_kind text CHECK (content_kind IN ('rich_text','pdf')),
  content text,
  is_regulatory_header boolean NOT NULL DEFAULT false,
  approval_state text NOT NULL DEFAULT 'approved' CHECK (approval_state IN ('draft','pending_dpa','approved')),
  version text NOT NULL DEFAULT '1.0.0',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid,
  actor_email text NOT NULL,
  category text NOT NULL,
  action text NOT NULL,
  target text,
  ip_address text,
  location text,
  severity text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ STEP 2: Enable RLS on all tables ============

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============ STEP 3: Helper function ============

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE auth_uid = auth.uid());
$$;

-- ============ STEP 4: RLS Policies ============

-- super_admins: read self only
DROP POLICY IF EXISTS "super_admins_read_self" ON super_admins;
CREATE POLICY "super_admins_read_self" ON super_admins
  FOR SELECT TO authenticated
  USING (auth_uid = auth.uid());

-- super_admins INSERT: bootstrap (first user) or existing super admin
DROP POLICY IF EXISTS "super_admins_insert" ON super_admins;
CREATE POLICY "super_admins_insert" ON super_admins
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR NOT EXISTS (SELECT 1 FROM super_admins)
  );

-- tenants: super admin full; tenant users read own
DROP POLICY IF EXISTS "tenants_super_admin_all" ON tenants;
CREATE POLICY "tenants_super_admin_all" ON tenants
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenants_own_read" ON tenants;
CREATE POLICY "tenants_own_read" ON tenants
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = tenants.id
    )
  );

-- tenant_users: super admin full; colleagues read; company_admin/dpa manage
DROP POLICY IF EXISTS "tenant_users_super_admin_all" ON tenant_users;
CREATE POLICY "tenant_users_super_admin_all" ON tenant_users
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_own_tenant_read" ON tenant_users;
CREATE POLICY "tenant_users_own_tenant_read" ON tenant_users
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

DROP POLICY IF EXISTS "tenant_users_company_admin_manage" ON tenant_users;
CREATE POLICY "tenant_users_company_admin_manage" ON tenant_users
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

-- tenant_users self-update (own profile)
DROP POLICY IF EXISTS "tenant_users_self_update" ON tenant_users;
CREATE POLICY "tenant_users_self_update" ON tenant_users
  FOR UPDATE TO authenticated
  USING (auth_uid = auth.uid())
  WITH CHECK (auth_uid = auth.uid());

-- tenant_users claim-by-email (provisioned user links auth account on signup)
DROP POLICY IF EXISTS "tenant_users_claim_by_email" ON tenant_users;
CREATE POLICY "tenant_users_claim_by_email" ON tenant_users
  FOR UPDATE TO authenticated
  USING (
    auth_uid IS NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (auth_uid = auth.uid());

-- vessels: super admin full; tenant read; company_admin write
DROP POLICY IF EXISTS "vessels_super_admin_all" ON vessels;
CREATE POLICY "vessels_super_admin_all" ON vessels
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "vessels_tenant_read" ON vessels;
CREATE POLICY "vessels_tenant_read" ON vessels
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

DROP POLICY IF EXISTS "vessels_tenant_company_admin_write" ON vessels;
CREATE POLICY "vessels_tenant_company_admin_write" ON vessels
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role = 'company_admin')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role = 'company_admin')
  );

-- crew_assignments: super admin full; tenant read; company_admin write
DROP POLICY IF EXISTS "crew_super_admin_all" ON crew_assignments;
CREATE POLICY "crew_super_admin_all" ON crew_assignments
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "crew_tenant_read" ON crew_assignments;
CREATE POLICY "crew_tenant_read" ON crew_assignments
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

DROP POLICY IF EXISTS "crew_company_admin_write" ON crew_assignments;
CREATE POLICY "crew_company_admin_write" ON crew_assignments
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role = 'company_admin')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND EXISTS (SELECT 1 FROM tenant_users tu2 WHERE tu2.auth_uid = auth.uid() AND tu2.role = 'company_admin')
  );

-- sms_documents: super admin full; company_admin/dpa write; vessel read approved only
DROP POLICY IF EXISTS "sms_docs_super_admin_all" ON sms_documents;
CREATE POLICY "sms_docs_super_admin_all" ON sms_documents
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_tenant_admin_write" ON sms_documents;
CREATE POLICY "sms_docs_tenant_admin_write" ON sms_documents
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

DROP POLICY IF EXISTS "sms_docs_vessel_read_approved" ON sms_documents;
CREATE POLICY "sms_docs_vessel_read_approved" ON sms_documents
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
    AND approval_state = 'approved'
    AND EXISTS (SELECT 1 FROM tenant_users tu3 WHERE tu3.auth_uid = auth.uid() AND tu3.role = 'vessel')
  );

-- audit_logs: append-only (INSERT any authenticated); no UPDATE/DELETE (immutable ledger)
DROP POLICY IF EXISTS "audit_insert_any" ON audit_logs;
CREATE POLICY "audit_insert_any" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "audit_super_admin_read_all" ON audit_logs;
CREATE POLICY "audit_super_admin_read_all" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "audit_tenant_read_own" ON audit_logs;
CREATE POLICY "audit_tenant_read_own" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- ============ STEP 5: Indexes ============

CREATE INDEX IF NOT EXISTS idx_tenant_users_auth_uid ON tenant_users(auth_uid);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vessels_tenant_id ON vessels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crew_vessel_id ON crew_assignments(vessel_id);
CREATE INDEX IF NOT EXISTS idx_sms_docs_tenant_tree ON sms_documents(tenant_id, tree_kind);
CREATE INDEX IF NOT EXISTS idx_sms_docs_parent ON sms_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- DONE. The backend is ready.
--
-- FIRST RUN: sign up in the app with "Register as Super Admin" checked.
-- The empty-table bootstrap policy lets the first user become Super Admin.
-- After that, only existing super admins can add more.
--
-- PROVISIONING: in the Super Admin panel → Live Provisioning Studio,
-- create tenants and provision users (Company Admin / DPA / Vessel ranks).
-- Each provisioned user signs up with their provisioned email and is
-- auto-routed to their role's window.
-- ============================================================================
