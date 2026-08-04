CREATE TABLE IF NOT EXISTS tenant_rank_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rank text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, rank)
);

ALTER TABLE tenant_rank_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_rank_defs" ON tenant_rank_definitions FOR SELECT
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

CREATE POLICY "insert_own_rank_defs" ON tenant_rank_definitions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

CREATE POLICY "update_own_rank_defs" ON tenant_rank_definitions FOR UPDATE
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  )) WITH CHECK (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

CREATE POLICY "delete_own_rank_defs" ON tenant_rank_definitions FOR DELETE
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

CREATE INDEX idx_tenant_rank_defs_tenant ON tenant_rank_definitions(tenant_id);