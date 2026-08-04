/*
# Crew Sign-On/Sign-Off Workflow & Vessel-Level Access Controls

## Summary
Implements the operational crew handover engine and hard-locked vessel boundary access.

## Changes

### 1. crew_assignments — RLS policies
- Allow company_admin and dpa roles (via tenant membership) to INSERT, UPDATE, SELECT all assignments in their tenant.
- Allow vessel-role users to SELECT their own active assignment row (needed to resolve vessel context on login).

### 2. sms_documents — vessel-level read gate for vessel-role users
- Existing policy allowed any tenant_user to read approved docs.
- New policy: vessel-role users can only SELECT if they have an active (signed_off_at IS NULL) crew_assignment in that tenant.
- company_admin and dpa roles retain unrestricted read within their tenant.

### 3. New RPC: get_my_active_assignment()
- SECURITY DEFINER function that returns the caller's active crew_assignment row.
- Used by the frontend auth context to resolve which vessel a vessel-role user is currently assigned to.
- Returns NULL if the user has no active assignment (ashore / unassigned).

### 4. Helper function: auth_is_vessel_crew_with_active_assignment(tenant_id)
- SECURITY DEFINER function used inside RLS policies to avoid infinite recursion.
- Checks that auth.uid() has an active crew_assignment in the given tenant.
*/

-- ============================================================
-- SECTION 1: crew_assignments RLS
-- ============================================================
ALTER TABLE crew_assignments ENABLE ROW LEVEL SECURITY;

-- Company admin / DPA can read all assignments in their tenant
DROP POLICY IF EXISTS "ca_dpa_select_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_select_crew_assignments" ON crew_assignments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.tenant_id = crew_assignments.tenant_id
      AND tu.role IN ('company_admin', 'dpa')
  )
);

-- Vessel users can read their own assignment rows
DROP POLICY IF EXISTS "vessel_select_own_assignment" ON crew_assignments;
CREATE POLICY "vessel_select_own_assignment" ON crew_assignments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.id = crew_assignments.user_id
  )
);

-- Company admin / DPA can insert new assignments in their tenant
DROP POLICY IF EXISTS "ca_dpa_insert_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_insert_crew_assignments" ON crew_assignments FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.tenant_id = crew_assignments.tenant_id
      AND tu.role IN ('company_admin', 'dpa')
  )
);

-- Company admin / DPA can update (sign-off) assignments in their tenant
DROP POLICY IF EXISTS "ca_dpa_update_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_update_crew_assignments" ON crew_assignments FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.tenant_id = crew_assignments.tenant_id
      AND tu.role IN ('company_admin', 'dpa')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.tenant_id = crew_assignments.tenant_id
      AND tu.role IN ('company_admin', 'dpa')
  )
);

-- ============================================================
-- SECTION 2: Helper SECURITY DEFINER function for RLS use
-- ============================================================
CREATE OR REPLACE FUNCTION is_active_vessel_crew(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get the tenant_users.id for the calling auth user in this tenant
  SELECT tu.id INTO v_user_id
  FROM tenant_users tu
  WHERE tu.auth_uid = auth.uid()
    AND tu.tenant_id = p_tenant_id
    AND tu.role = 'vessel';

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM crew_assignments ca
    WHERE ca.user_id = v_user_id
      AND ca.tenant_id = p_tenant_id
      AND ca.signed_off_at IS NULL
  );
END;
$$;

-- ============================================================
-- SECTION 3: sms_documents — vessel-level read gate
-- Drop and recreate the vessel-read policy to add assignment check
-- ============================================================

-- Company admin / DPA: read all docs in their tenant (unchanged)
DROP POLICY IF EXISTS "ca_dpa_select_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_select_sms_documents" ON sms_documents FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.auth_uid = auth.uid()
      AND tu.tenant_id = sms_documents.tenant_id
      AND tu.role IN ('company_admin', 'dpa')
  )
);

-- Vessel users: ONLY approved docs AND only when actively signed on to a vessel in this tenant
DROP POLICY IF EXISTS "vessel_select_sms_documents" ON sms_documents;
CREATE POLICY "vessel_select_sms_documents" ON sms_documents FOR SELECT
TO authenticated
USING (
  approval_state = 'approved'
  AND is_active_vessel_crew(tenant_id)
);

-- ============================================================
-- SECTION 4: get_my_active_assignment() RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_active_assignment()
RETURNS TABLE (
  assignment_id   uuid,
  vessel_id       uuid,
  vessel_name     text,
  tenant_id       uuid,
  user_id         uuid,
  rank            text,
  signed_on_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id         AS assignment_id,
    ca.vessel_id,
    v.name        AS vessel_name,
    ca.tenant_id,
    ca.user_id,
    ca.rank,
    ca.signed_on_at
  FROM crew_assignments ca
  JOIN vessels v ON v.id = ca.vessel_id
  WHERE ca.signed_off_at IS NULL
    AND ca.user_id = (
      SELECT tu.id FROM tenant_users tu WHERE tu.auth_uid = auth.uid() LIMIT 1
    )
  LIMIT 1;
END;
$$;
