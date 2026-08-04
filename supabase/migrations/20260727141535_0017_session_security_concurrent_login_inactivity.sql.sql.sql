/*
# Session Security: Concurrent Login Prevention + Shipboard Inactivity Timeout

## Purpose
Implements two critical shipboard security controls:
1. Single concurrent login enforcement — when a user logs in on a second
   device, the first device's session is automatically terminated.
2. Configurable inactivity auto-logout — shipboard users are logged out
   after a tenant-configured period of no mouse/keyboard/touch activity.

## New Tables

### user_session_tokens
Tracks the single active session token per user. Only one row per user_id
exists at a time (UNIQUE constraint). When a new login occurs, the old
token is overwritten — the old device detects the mismatch and logs out.
- `id` (uuid, PK)
- `user_id` (uuid, NOT NULL, UNIQUE) — references auth.users(id) ON DELETE CASCADE
- `session_token` (text, NOT NULL) — current active session token
- `device_info` (text) — optional user-agent / device label
- `ip_address` (text) — optional source IP
- `created_at` (timestamptz, DEFAULT now())
- `updated_at` (timestamptz, DEFAULT now())

### tenant_security_settings
Per-tenant security configuration. One row per tenant (UNIQUE on tenant_id).
- `id` (uuid, PK)
- `tenant_id` (uuid, NOT NULL, UNIQUE) — references tenants(id) ON DELETE CASCADE
- `inactivity_timeout_minutes` (integer, NOT NULL, DEFAULT 15, CHECK 1–480) —
  shipboard auto-logout threshold (range 5–120 enforced in app layer)
- `enforce_single_session` (boolean, NOT NULL, DEFAULT true) —
  toggle concurrent-login prevention
- `updated_by` (text) — admin email who last changed the setting
- `updated_at` (timestamptz, DEFAULT now())

## Security (RLS)

### user_session_tokens
- Users can SELECT, INSERT, UPDATE only their own row (auth.uid() = user_id).
  This lets a client write its new token on login and poll/subscribe to
  detect when another device overwrites it.
- Super Admins can SELECT all rows (for audit / session monitoring).

### tenant_security_settings
- Super Admins: full CRUD (via is_super_admin() check).
- Tenant users (company_admin, dpa, vessel): SELECT only — they read
  the inactivity timeout to drive the client-side timer, but cannot
  change it. Company Admins update it via a SECURITY DEFINER RPC that
  verifies their ownership of the tenant.

## RPCs

### update_tenant_security_setting
SECURITY DEFINER function that lets a Company Admin update their own
tenant's inactivity_timeout_minutes and enforce_single_session. Verifies
the caller is a tenant_user with role 'company_admin' for the given
tenant_id before updating.

## Important Notes
1. The UNIQUE constraint on user_session_tokens.user_id guarantees only
   one active token per user — a second login naturally overwrites the
   first, which the first device detects via realtime subscription.
2. tenant_security_settings is seeded with defaults for all existing
   tenants (inactivity = 15 min, enforce_single_session = true).
3. Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
*/

-- ── user_session_tokens ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_session_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token text NOT NULL,
  device_info text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_session_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_session_token" ON user_session_tokens;
CREATE POLICY "select_own_session_token"
  ON user_session_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_session_token" ON user_session_tokens;
CREATE POLICY "insert_own_session_token"
  ON user_session_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_session_token" ON user_session_tokens;
CREATE POLICY "update_own_session_token"
  ON user_session_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Super Admin: SELECT all (session audit / monitoring)
DROP POLICY IF EXISTS "sa_select_all_session_tokens" ON user_session_tokens;
CREATE POLICY "sa_select_all_session_tokens"
  ON user_session_tokens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- ── tenant_security_settings ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_security_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  inactivity_timeout_minutes integer NOT NULL DEFAULT 15 CHECK (inactivity_timeout_minutes >= 1 AND inactivity_timeout_minutes <= 480),
  enforce_single_session boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_security_settings ENABLE ROW LEVEL SECURITY;

-- Super Admin: full CRUD
DROP POLICY IF EXISTS "sa_select_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_select_all_tenant_security"
  ON tenant_security_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_insert_all_tenant_security"
  ON tenant_security_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_update_all_tenant_security"
  ON tenant_security_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users: SELECT only (read timeout config, cannot change it directly)
DROP POLICY IF EXISTS "tenant_select_own_security" ON tenant_security_settings;
CREATE POLICY "tenant_select_own_security"
  ON tenant_security_settings FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
        AND tenant_users.tenant_id = tenant_security_settings.tenant_id
    )
  );

-- ── RPC: Company Admin updates own tenant security setting ──────────

CREATE OR REPLACE FUNCTION update_tenant_security_setting(
  p_tenant_id uuid,
  p_inactivity_timeout_minutes integer,
  p_enforce_single_session boolean
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
    RAISE EXCEPTION 'Not authorized: only Company Admins can update security settings';
  END IF;

  INSERT INTO tenant_security_settings (tenant_id, inactivity_timeout_minutes, enforce_single_session, updated_by, updated_at)
  VALUES (p_tenant_id, p_inactivity_timeout_minutes, p_enforce_single_session, (SELECT email FROM tenant_users WHERE auth_uid = auth.uid()), now())
  ON CONFLICT (tenant_id) DO UPDATE
  SET inactivity_timeout_minutes = EXCLUDED.inactivity_timeout_minutes,
      enforce_single_session = EXCLUDED.enforce_single_session,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  RETURN true;
END;
$$;

-- ── Seed defaults for existing tenants ──────────────────────────────

INSERT INTO tenant_security_settings (tenant_id, inactivity_timeout_minutes, enforce_single_session)
SELECT t.id, 15, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_security_settings s WHERE s.tenant_id = t.id
);
