/*
# Account-claim policy for tenant_users

## Purpose
When a Super Admin provisions a tenant_user by email (auth_uid = null), the
provisioned person later signs up with that same email. We need to auto-link
their new auth.users id to the existing tenant_user row.

The existing `tenant_users_self_update` policy requires `auth_uid = auth.uid()`,
which fails when auth_uid is still null. This migration adds a claim policy
allowing an authenticated user to set auth_uid on a provisioned row that
matches their email and has no auth_uid yet.

## Security
- UPDATE policy: a user may update a tenant_user row IF auth_uid IS NULL AND
  the row's email matches the email in auth.users for the current user.
- WITH CHECK ensures after the update auth_uid equals the caller (can't hijack
  another row).
*/

DROP POLICY IF EXISTS "tenant_users_claim_by_email" ON tenant_users;
CREATE POLICY "tenant_users_claim_by_email" ON tenant_users
  FOR UPDATE TO authenticated
  USING (
    auth_uid IS NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (auth_uid = auth.uid());
