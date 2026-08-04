/*
# Tenant Feature Flags, Sync Config, and Document Versioning Infrastructure

## Purpose
Extends the maritime platform with three new infrastructure tables to support
upcoming modules (Rest Hours, HACCP/Galley, Certification Manager):

1. **tenant_feature_flags** — Per-tenant module/feature enablement matrix
2. **tenant_sync_config** — Per-tenant vessel auto-sync frequency configuration
3. **sms_document_versions** — Document revision history for version tracking

## New Tables

### tenant_feature_flags
- `id` (uuid, PK)
- `tenant_id` (uuid, FK → tenants, ON DELETE CASCADE)
- `feature_key` (text, NOT NULL) — e.g. 'sms_documentation', 'rest_hours', 'haccp_galley', 'certification_manager', 'satellite_sync'
- `enabled` (boolean, DEFAULT false)
- `custom_config` (jsonb, DEFAULT '{}') — optional feature-specific config
- `updated_by` (text) — admin email who last changed the flag
- `updated_at` (timestamptz, DEFAULT now())
- UNIQUE(tenant_id, feature_key)

### tenant_sync_config
- `id` (uuid, PK)
- `tenant_id` (uuid, FK → tenants, ON DELETE CASCADE, UNIQUE)
- `auto_sync_interval_hours` (integer, DEFAULT 6, CHECK 1-24)
- `manual_replicate_enabled` (boolean, DEFAULT true)
- `updated_by` (text)
- `updated_at` (timestamptz, DEFAULT now())

### sms_document_versions
- `id` (uuid, PK)
- `tenant_id` (uuid, FK → tenants, ON DELETE CASCADE)
- `document_id` (uuid, FK → sms_documents, ON DELETE CASCADE)
- `revision` (integer, NOT NULL) — e.g. 1, 2, 3
- `version_label` (text, NOT NULL) — e.g. 'v1.0.0'
- `content` (text) — snapshot of content at this revision
- `content_kind` (text) — 'rich_text' or 'pdf'
- `uploaded_by` (text)
- `created_at` (timestamptz, DEFAULT now())

## Security (RLS)
All three tables have RLS enabled with ownership scoping via tenant_users membership:
- super_admins: full CRUD (via service role / internal platform access)
- tenant users: SELECT only on their own tenant's feature flags and sync config
  (writes are super-admin-only through the platform panel)
- tenant users: SELECT + INSERT on their own tenant's document versions

## Important Notes
1. Feature flags use a UNIQUE(tenant_id, feature_key) constraint so each
   tenant can have exactly one enable/disable state per feature.
2. Sync config is one row per tenant (UNIQUE tenant_id).
3. Document versions preserve the full content snapshot at each revision,
   enabling "restore to previous version" functionality.
4. All tables are safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS first).
*/

-- ════════════════════════════════════════════════════════════
-- 1. tenant_feature_flags
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  custom_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, feature_key)
);

ALTER TABLE tenant_feature_flags ENABLE ROW LEVEL SECURITY;

-- Super admins can do everything (they are platform-level, not tenant-scoped)
-- We check via the super_admins table membership
DROP POLICY IF EXISTS "sa_select_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_select_all_feature_flags"
  ON tenant_feature_flags FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_insert_all_feature_flags"
  ON tenant_feature_flags FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_update_all_feature_flags"
  ON tenant_feature_flags FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_delete_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_delete_all_feature_flags"
  ON tenant_feature_flags FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users can read their own tenant's feature flags (to know what's enabled)
DROP POLICY IF EXISTS "tenant_select_own_feature_flags" ON tenant_feature_flags;
CREATE POLICY "tenant_select_own_feature_flags"
  ON tenant_feature_flags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = tenant_feature_flags.tenant_id
    )
  );

-- ════════════════════════════════════════════════════════════
-- 2. tenant_sync_config
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tenant_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  auto_sync_interval_hours integer NOT NULL DEFAULT 6 CHECK (auto_sync_interval_hours BETWEEN 1 AND 24),
  manual_replicate_enabled boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_sync_config ENABLE ROW LEVEL SECURITY;

-- Super admins: full CRUD
DROP POLICY IF EXISTS "sa_select_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_select_all_sync_config"
  ON tenant_sync_config FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_insert_all_sync_config"
  ON tenant_sync_config FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_update_all_sync_config"
  ON tenant_sync_config FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users can read their own sync config (vessel needs the interval)
DROP POLICY IF EXISTS "tenant_select_own_sync_config" ON tenant_sync_config;
CREATE POLICY "tenant_select_own_sync_config"
  ON tenant_sync_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = tenant_sync_config.tenant_id
    )
  );

-- ════════════════════════════════════════════════════════════
-- 3. sms_document_versions
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sms_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES sms_documents(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  version_label text NOT NULL,
  content text,
  content_kind text DEFAULT 'rich_text',
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying versions of a specific document
CREATE INDEX IF NOT EXISTS idx_sms_doc_versions_document
  ON sms_document_versions(tenant_id, document_id, revision DESC);

ALTER TABLE sms_document_versions ENABLE ROW LEVEL SECURITY;

-- Super admins: full access
DROP POLICY IF EXISTS "sa_select_all_doc_versions" ON sms_document_versions;
CREATE POLICY "sa_select_all_doc_versions"
  ON sms_document_versions FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_doc_versions" ON sms_document_versions;
CREATE POLICY "sa_insert_all_doc_versions"
  ON sms_document_versions FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users: SELECT + INSERT on their own tenant's versions
DROP POLICY IF EXISTS "tenant_select_own_doc_versions" ON sms_document_versions;
CREATE POLICY "tenant_select_own_doc_versions"
  ON sms_document_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = sms_document_versions.tenant_id
    )
  );

DROP POLICY IF EXISTS "tenant_insert_own_doc_versions" ON sms_document_versions;
CREATE POLICY "tenant_insert_own_doc_versions"
  ON sms_document_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.auth_uid = auth.uid()
      AND tenant_users.tenant_id = sms_document_versions.tenant_id
    )
  );

-- ════════════════════════════════════════════════════════════
-- 4. Seed default feature flags + sync config for existing tenants
-- ════════════════════════════════════════════════════════════
-- Enable SMS Documentation (already-built module) for all existing tenants
INSERT INTO tenant_feature_flags (tenant_id, feature_key, enabled)
SELECT t.id, 'sms_documentation', true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_feature_flags f
  WHERE f.tenant_id = t.id AND f.feature_key = 'sms_documentation'
);

-- Create default sync config (6-hour interval) for existing tenants
INSERT INTO tenant_sync_config (tenant_id, auto_sync_interval_hours, manual_replicate_enabled)
SELECT t.id, 6, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_sync_config s WHERE s.tenant_id = t.id
);