/*
# Harden RBAC boundaries on sms_documents

## Summary
Splits the single `sms_docs_tenant_admin_write` FOR ALL policy into explicit
INSERT / UPDATE / DELETE policies for Company Admin / DPA roles, each scoped
strictly to the caller's tenant via `tenant_id = auth_tenant_id()`. Drops the
redundant `sms_docs_vessel_read_approved` SELECT policy (broader, no assignment
check) in favour of the stricter `vessel_select_sms_documents` (requires an
active crew assignment). Super Admin policies are unchanged.

## RBAC Matrix (after this migration)
1. Super Admin (`is_super_admin()`)
   - SELECT, INSERT, UPDATE, DELETE on ALL rows across ALL tenants.
   - Retains ultimate platform governance and template defaults.
2. Company Admin / DPA (`auth_tenant_role() IN ('company_admin','dpa')`)
   - SELECT all docs in own tenant (existing `ca_dpa_select_sms_documents`).
   - INSERT / UPDATE / DELETE only rows where `tenant_id = auth_tenant_id()`.
   - Can NEVER mutate another tenant's rows or global base templates.
3. Vessel users (Master, Chief Engineer, Chief Mate, Crew — `role = 'vessel'`)
   - SELECT only `approval_state = 'approved'` docs AND only when they have an
     active crew_assignment (signed_off_at IS NULL) in that tenant.
   - ZERO write policies — cannot insert, update, or delete any row.

## Security changes
- Dropped: `sms_docs_tenant_admin_write` (FOR ALL — replaced by 3 explicit policies).
- Dropped: `sms_docs_vessel_read_approved` (redundant — stricter policy retained).
- Added: `ca_dpa_insert_sms_documents`, `ca_dpa_update_sms_documents`,
  `ca_dpa_delete_sms_documents` — each with `tenant_id = auth_tenant_id()` scope.
- Retained: `ca_dpa_select_sms_documents`, `vessel_select_sms_documents`,
  `sms_docs_sa_select/insert/update/delete`.

## Important notes
1. The `tenant_id` column on `sms_documents` is the tenant/company isolation
   key (equivalent to a `company_id` column). Every write policy checks
   `tenant_id = auth_tenant_id()` so a Company Admin or DPA can never cross
   tenant boundaries.
2. Vessel users have NO insert/update/delete policies — RLS denies all writes
   by default when no matching policy exists.
3. `auth_tenant_id()`, `auth_tenant_role()`, and `is_super_admin()` are
   pre-existing SECURITY DEFINER helper functions used across the schema.
*/

-- ============================================================
-- 1. Drop the FOR ALL policy and the redundant vessel SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "sms_docs_tenant_admin_write" ON sms_documents;
DROP POLICY IF EXISTS "sms_docs_vessel_read_approved" ON sms_documents;

-- ============================================================
-- 2. Company Admin / DPA — explicit INSERT (tenant-scoped)
--    Prevents inserting rows into other tenants (WITH CHECK enforces
--    that the new row's tenant_id matches the caller's tenant).
-- ============================================================
DROP POLICY IF EXISTS "ca_dpa_insert_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_insert_sms_documents" ON sms_documents FOR INSERT
TO authenticated
WITH CHECK (
  NOT is_super_admin()
  AND tenant_id = auth_tenant_id()
  AND auth_tenant_role() IN ('company_admin', 'dpa')
);

-- ============================================================
-- 3. Company Admin / DPA — explicit UPDATE (tenant-scoped)
--    USING gates which rows can be updated; WITH CHECK ensures the
--    updated row stays in the caller's tenant.
-- ============================================================
DROP POLICY IF EXISTS "ca_dpa_update_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_update_sms_documents" ON sms_documents FOR UPDATE
TO authenticated
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

-- ============================================================
-- 4. Company Admin / DPA — explicit DELETE (tenant-scoped)
--    USING gates which rows can be deleted.
-- ============================================================
DROP POLICY IF EXISTS "ca_dpa_delete_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_delete_sms_documents" ON sms_documents FOR DELETE
TO authenticated
USING (
  NOT is_super_admin()
  AND tenant_id = auth_tenant_id()
  AND auth_tenant_role() IN ('company_admin', 'dpa')
);