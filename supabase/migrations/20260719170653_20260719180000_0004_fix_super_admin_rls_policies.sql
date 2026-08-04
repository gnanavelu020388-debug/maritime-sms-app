/*
# Fix super_admin RLS policies on all tables

## Problem
The `FOR ALL` policies for super_admin use both `USING` and `WITH CHECK` with `is_super_admin()`.
For INSERT, PostgreSQL evaluates the USING clause of a FOR ALL policy even though USING is
semantically for row-visibility checks — this can cause RLS failures on insert.

## Fix
Replace each `FOR ALL` super_admin policy with 4 explicit per-verb policies
(SELECT, INSERT, UPDATE, DELETE) so each verb gets the correct clause only.

## Tables affected
- tenants
- tenant_users
- vessels
- crew_assignments
- sms_documents
*/

-- ===== tenants =====
DROP POLICY IF EXISTS "tenants_super_admin_all" ON tenants;

DROP POLICY IF EXISTS "tenants_sa_select" ON tenants;
CREATE POLICY "tenants_sa_select" ON tenants FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_insert" ON tenants;
CREATE POLICY "tenants_sa_insert" ON tenants FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_update" ON tenants;
CREATE POLICY "tenants_sa_update" ON tenants FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_delete" ON tenants;
CREATE POLICY "tenants_sa_delete" ON tenants FOR DELETE TO authenticated
  USING (is_super_admin());

-- ===== tenant_users =====
DROP POLICY IF EXISTS "tenant_users_super_admin_all" ON tenant_users;

DROP POLICY IF EXISTS "tenant_users_sa_select" ON tenant_users;
CREATE POLICY "tenant_users_sa_select" ON tenant_users FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_insert" ON tenant_users;
CREATE POLICY "tenant_users_sa_insert" ON tenant_users FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_update" ON tenant_users;
CREATE POLICY "tenant_users_sa_update" ON tenant_users FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_delete" ON tenant_users;
CREATE POLICY "tenant_users_sa_delete" ON tenant_users FOR DELETE TO authenticated
  USING (is_super_admin());

-- ===== vessels =====
DROP POLICY IF EXISTS "vessels_super_admin_all" ON vessels;

DROP POLICY IF EXISTS "vessels_sa_select" ON vessels;
CREATE POLICY "vessels_sa_select" ON vessels FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_insert" ON vessels;
CREATE POLICY "vessels_sa_insert" ON vessels FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_update" ON vessels;
CREATE POLICY "vessels_sa_update" ON vessels FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_delete" ON vessels;
CREATE POLICY "vessels_sa_delete" ON vessels FOR DELETE TO authenticated
  USING (is_super_admin());

-- ===== crew_assignments =====
DROP POLICY IF EXISTS "crew_super_admin_all" ON crew_assignments;

DROP POLICY IF EXISTS "crew_sa_select" ON crew_assignments;
CREATE POLICY "crew_sa_select" ON crew_assignments FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_insert" ON crew_assignments;
CREATE POLICY "crew_sa_insert" ON crew_assignments FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_update" ON crew_assignments;
CREATE POLICY "crew_sa_update" ON crew_assignments FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_delete" ON crew_assignments;
CREATE POLICY "crew_sa_delete" ON crew_assignments FOR DELETE TO authenticated
  USING (is_super_admin());

-- ===== sms_documents =====
DROP POLICY IF EXISTS "sms_docs_super_admin_all" ON sms_documents;

DROP POLICY IF EXISTS "sms_docs_sa_select" ON sms_documents;
CREATE POLICY "sms_docs_sa_select" ON sms_documents FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_insert" ON sms_documents;
CREATE POLICY "sms_docs_sa_insert" ON sms_documents FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_update" ON sms_documents;
CREATE POLICY "sms_docs_sa_update" ON sms_documents FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_delete" ON sms_documents;
CREATE POLICY "sms_docs_sa_delete" ON sms_documents FOR DELETE TO authenticated
  USING (is_super_admin());
