/*
# Bootstrap policy for super_admins

## Purpose
Allows the very first user to self-provision as Super Admin when the `super_admins`
table is empty (first-run bootstrap). After the first super admin exists, only
existing super admins can add more.

## Security Changes
- Adds INSERT policy on `super_admins`:
  - Existing super admins can insert new super admins.
  - Any authenticated user can insert IF the table is empty (bootstrap).
*/

DROP POLICY IF EXISTS "super_admins_insert" ON super_admins;
CREATE POLICY "super_admins_insert" ON super_admins
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR NOT EXISTS (SELECT 1 FROM super_admins)
  );
