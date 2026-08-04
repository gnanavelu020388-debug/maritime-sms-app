/*
# Fix infinite recursion in tenant-scoped RLS policies

## Problem
Several policies on `tenant_users`, `tenants`, `vessels`, `crew_assignments`,
and `sms_documents` contain subqueries like:
    SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid()
These subqueries hit `tenant_users`, which is RLS-protected, so Postgres
re-evaluates the `tenant_users` SELECT policy — which runs the same subquery
again — producing "infinite recursion detected in policy for relation
tenant_users".

## Fix
1. Add two SECURITY DEFINER helper functions that read `tenant_users`
   with the function owner's privileges (bypassing RLS), so policy
   subqueries no longer recurse:
   - `auth_tenant_id()`  -> the caller's tenant_id, or NULL
   - `auth_tenant_role()` -> the caller's role in that tenant, or NULL
2. Rewrite every tenant-scoped policy to call these helpers instead of
   subquerying `tenant_users` directly.

## Security
- Helper functions are SECURITY DEFINER, STABLE, owned by the migration
  runner (postgres). They only expose the caller's OWN tenant_id and role
  — no cross-tenant data leaks.
- All other policy semantics (super_admin full access, tenant read-own,
  company_admin/dpa write, vessel read-approved-only) are preserved.
*/

-- ============ Helper functions (SECURITY DEFINER -> bypass RLS) ============

CREATE OR REPLACE FUNCTION auth_tenant_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT tenant_id FROM tenant_users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_tenant_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM tenant_users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

-- ============ tenants: tenant read-own (was recursive) ============

DROP POLICY IF EXISTS "tenants_own_read" ON tenants;
CREATE POLICY "tenants_own_read" ON tenants
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenants.id = auth_tenant_id()
  );

-- ============ tenant_users: tenant read-own (was recursive) ============

DROP POLICY IF EXISTS "tenant_users_own_tenant_read" ON tenant_users;
CREATE POLICY "tenant_users_own_tenant_read" ON tenant_users
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
  );

-- ============ tenant_users: company_admin/dpa manage (was recursive) ============

DROP POLICY IF EXISTS "tenant_users_company_admin_manage" ON tenant_users;
CREATE POLICY "tenant_users_company_admin_manage" ON tenant_users
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

-- ============ vessels: tenant read (was recursive) ============

DROP POLICY IF EXISTS "vessels_tenant_read" ON vessels;
CREATE POLICY "vessels_tenant_read" ON vessels
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
  );

-- ============ vessels: company_admin write (was recursive) ============

DROP POLICY IF EXISTS "vessels_tenant_company_admin_write" ON vessels;
CREATE POLICY "vessels_tenant_company_admin_write" ON vessels
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  );

-- ============ crew_assignments: tenant read (was recursive) ============

DROP POLICY IF EXISTS "crew_tenant_read" ON crew_assignments;
CREATE POLICY "crew_tenant_read" ON crew_assignments
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
  );

-- ============ crew_assignments: company_admin write (was recursive) ============

DROP POLICY IF EXISTS "crew_company_admin_write" ON crew_assignments;
CREATE POLICY "crew_company_admin_write" ON crew_assignments
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  );

-- ============ sms_documents: tenant admin write (was recursive) ============

DROP POLICY IF EXISTS "sms_docs_tenant_admin_write" ON sms_documents;
CREATE POLICY "sms_docs_tenant_admin_write" ON sms_documents
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

-- ============ sms_documents: vessel read approved only (was recursive) ============

DROP POLICY IF EXISTS "sms_docs_vessel_read_approved" ON sms_documents;
CREATE POLICY "sms_docs_vessel_read_approved" ON sms_documents
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND approval_state = 'approved'
    AND auth_tenant_role() = 'vessel'
  );

-- ============ audit_logs: tenant read-own (was recursive) ============

DROP POLICY IF EXISTS "audit_tenant_read_own" ON audit_logs;
CREATE POLICY "audit_tenant_read_own" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
  );
