/*
# Add claim_tenant_user() RPC function

## Problem
The client-side claim flow (SELECT tenant_users WHERE email = ? AND auth_uid IS NULL,
then UPDATE auth_uid) fails because:
1. A brand-new user has no tenant_id yet, so auth_tenant_id() returns NULL.
2. The SELECT policy (tenant_users_own_tenant_read) uses auth_tenant_id() and returns
   nothing for the new user — so the provisioned row is invisible to them.
3. The UPDATE never happens, auth_uid stays NULL, and the user sees "not provisioned".

## Fix
A single SECURITY DEFINER RPC function `claim_tenant_user` that:
- Runs with the function owner's privileges (bypasses RLS).
- Finds a tenant_users row matching the caller's email with auth_uid IS NULL.
- Sets auth_uid = auth.uid() and status = 'active' atomically.
- Returns TRUE if a row was claimed, FALSE if none found.

The client calls this once after signup/signin, then re-resolves the role.
*/

CREATE OR REPLACE FUNCTION claim_tenant_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_rows  int;
BEGIN
  -- Get the caller's email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  -- Atomically claim the provisioned row
  UPDATE tenant_users
  SET auth_uid   = auth.uid(),
      status     = 'active',
      updated_at = now()
  WHERE email    = lower(v_email)
    AND auth_uid IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
