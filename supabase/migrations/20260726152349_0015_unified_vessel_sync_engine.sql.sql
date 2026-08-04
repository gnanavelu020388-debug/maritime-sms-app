/*
# Unified Vessel Sync Engine — Module-Agnostic Sync Infrastructure

## Purpose
Replaces the SMS-only sync pipeline with a unified, module-agnostic data
replication engine that serves ALL current and future platform modules
(SMS, Rest Hours, HACCP/Galley, Certification Manager, Electronic Logbooks, etc.)
through a single common data contract and network pipeline.

## New Tables

### 1. vessel_sync_outbox
The unified bottom-up queue for ALL vessel-to-shore data replication.
Every module writes pending payload entries here; the sync engine drains
the queue during satellite check-ins. No module needs its own sync engine.

- `id` (uuid, PK)
- `tenant_id` (uuid, FK → tenants, ON DELETE CASCADE)
- `vessel_id` (uuid, FK → vessels, ON DELETE CASCADE)
- `module_key` (text, NOT NULL) — e.g. 'sms_documentation', 'rest_hours', 'haccp_galley'
- `operation` (text, NOT NULL) — 'upsert' | 'delete' | 'batch_upsert'
- `entity_type` (text, NOT NULL) — e.g. 'document', 'rest_hours_log', 'galley_requisition'
- `entity_id` (text, NOT NULL) — the primary key of the entity in its module table
- `payload` (jsonb, NOT NULL DEFAULT '{}') — the full JSON data payload for this entry
- `status` (text, NOT NULL DEFAULT 'pending') — 'pending' | 'syncing' | 'synced' | 'failed'
- `attempts` (integer, DEFAULT 0) — retry counter for failed entries
- `last_error` (text) — last error message if status = 'failed'
- `priority` (integer, DEFAULT 0) — higher priority entries sync first (0 = normal, 10 = urgent)
- `created_at` (timestamptz, DEFAULT now())
- `synced_at` (timestamptz) — when the entry was successfully replicated to shore

Indexes:
- `idx_vessel_sync_outbox_tenant_vessel` on (tenant_id, vessel_id, status, priority DESC)
- `idx_vessel_sync_outbox_module` on (tenant_id, module_key, status)
- `idx_vessel_sync_outbox_status` on (status, created_at) — for the sync drain query

### 2. vessel_sync_state
Centralized per-vessel connectivity and sync state. The Super Admin panel
reads from this table to display vessel connectivity, last sync timestamp,
and payload transit state for the ENTIRE vessel — not per-module.

- `id` (uuid, PK)
- `tenant_id` (uuid, FK → tenants, ON DELETE CASCADE)
- `vessel_id` (uuid, FK → vessels, ON DELETE CASCADE, UNIQUE)
- `connection_mode` (text, DEFAULT 'VESSEL_SERVER_LAN') — 'VESSEL_SERVER_LAN' | 'CLOUD_DIRECT'
- `server_reachable` (boolean, DEFAULT false)
- `last_heartbeat_at` (timestamptz) — last successful LAN heartbeat
- `last_sync_at` (timestamptz) — last successful sync check-in (any module)
- `pending_outbox_count` (integer, DEFAULT 0) — count of pending outbox entries across ALL modules
- `failed_outbox_count` (integer, DEFAULT 0) — count of failed outbox entries
- `active_module_keys` (jsonb, DEFAULT '[]') — array of module keys currently syncing for this vessel
- `total_payloads_synced` (bigint, DEFAULT 0) — lifetime count of synced payloads
- `total_bytes_synced` (bigint, DEFAULT 0) — estimated total bytes transferred
- `updated_at` (timestamptz, DEFAULT now())

Indexes:
- `idx_vessel_sync_state_tenant` on (tenant_id, vessel_id)

## Security (RLS)

### vessel_sync_outbox
- Super Admin: full CRUD (via is_super_admin() check)
- company_admin / dpa: full CRUD within their own tenant
- vessel users: INSERT + SELECT within their own tenant (vessel writes entries, reads status)

### vessel_sync_state
- Super Admin: full CRUD
- All tenant users (company_admin, dpa, vessel): SELECT within their own tenant
- vessel users: UPDATE within their own tenant (the sync worker updates state)
- company_admin / dpa: UPDATE within their own tenant

## Important Notes
1. The outbox uses a `module_key` column so the sync engine can gate entries
   by tenant_feature_flags — if a module is disabled for a tenant, its outbox
   entries are skipped during sync drain.
2. The `payload` jsonb column holds the complete entity data, so the sync
   engine doesn't need to know the schema of each module — it just packages
   and transmits the JSON.
3. vessel_sync_state is a single row per vessel (UNIQUE vessel_id) that
   aggregates sync status across ALL modules. The Super Admin monitoring
   panel reads this table instead of querying individual module tables.
4. Both tables are safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS first).
5. The existing sms_delta_packages table remains for top-down SMS version
   pushes — it is complementary to this bottom-up outbox queue.
*/

-- ════════════════════════════════════════════════════════════
-- 1. vessel_sync_outbox — unified bottom-up sync queue
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vessel_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  operation text NOT NULL DEFAULT 'upsert',
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

ALTER TABLE vessel_sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_tenant_vessel
  ON vessel_sync_outbox (tenant_id, vessel_id, status, priority DESC);

CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_module
  ON vessel_sync_outbox (tenant_id, module_key, status);

CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_status
  ON vessel_sync_outbox (status, created_at);

-- Super Admin: full CRUD
DROP POLICY IF EXISTS "sa_select_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_select_all_sync_outbox"
  ON vessel_sync_outbox FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_insert_all_sync_outbox"
  ON vessel_sync_outbox FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_update_all_sync_outbox"
  ON vessel_sync_outbox FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_delete_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_delete_all_sync_outbox"
  ON vessel_sync_outbox FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users: SELECT within own tenant
DROP POLICY IF EXISTS "tenant_select_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_select_own_sync_outbox"
  ON vessel_sync_outbox FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- Tenant vessel users: INSERT within own tenant (vessel writes outbox entries)
DROP POLICY IF EXISTS "tenant_insert_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_insert_own_sync_outbox"
  ON vessel_sync_outbox FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- Tenant users: UPDATE within own tenant (update sync status after drain)
DROP POLICY IF EXISTS "tenant_update_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_update_own_sync_outbox"
  ON vessel_sync_outbox FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- Tenant users: DELETE within own tenant
DROP POLICY IF EXISTS "tenant_delete_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_delete_own_sync_outbox"
  ON vessel_sync_outbox FOR DELETE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- ════════════════════════════════════════════════════════════
-- 2. vessel_sync_state — centralized per-vessel sync/connectivity state
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vessel_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL UNIQUE REFERENCES vessels(id) ON DELETE CASCADE,
  connection_mode text NOT NULL DEFAULT 'VESSEL_SERVER_LAN',
  server_reachable boolean NOT NULL DEFAULT false,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  pending_outbox_count integer NOT NULL DEFAULT 0,
  failed_outbox_count integer NOT NULL DEFAULT 0,
  active_module_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_payloads_synced bigint NOT NULL DEFAULT 0,
  total_bytes_synced bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vessel_sync_state ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vessel_sync_state_tenant
  ON vessel_sync_state (tenant_id, vessel_id);

-- Super Admin: full CRUD
DROP POLICY IF EXISTS "sa_select_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_select_all_sync_state"
  ON vessel_sync_state FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_insert_all_sync_state"
  ON vessel_sync_state FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_update_all_sync_state"
  ON vessel_sync_state FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_delete_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_delete_all_sync_state"
  ON vessel_sync_state FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- Tenant users: SELECT within own tenant (all roles can read sync state)
DROP POLICY IF EXISTS "tenant_select_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_select_own_sync_state"
  ON vessel_sync_state FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- Tenant users: INSERT within own tenant (create sync state row on first heartbeat)
DROP POLICY IF EXISTS "tenant_insert_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_insert_own_sync_state"
  ON vessel_sync_state FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- Tenant users: UPDATE within own tenant (sync worker updates state after check-in)
DROP POLICY IF EXISTS "tenant_update_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_update_own_sync_state"
  ON vessel_sync_state FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
    AND tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.auth_uid = auth.uid())
  );

-- ════════════════════════════════════════════════════════════
-- 3. Seed sync state rows for existing vessels
-- ════════════════════════════════════════════════════════════
INSERT INTO vessel_sync_state (tenant_id, vessel_id, connection_mode, server_reachable, last_sync_at)
SELECT v.tenant_id, v.id, 'VESSEL_SERVER_LAN', false, v.last_sync_at
FROM vessels v
WHERE NOT EXISTS (
  SELECT 1 FROM vessel_sync_state s WHERE s.vessel_id = v.id
);