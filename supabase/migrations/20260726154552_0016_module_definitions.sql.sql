/*
# Module Definitions — Platform-wide custom display names for modules

## Purpose
Allows Super Admin to customize the display name of any platform module
(e.g. rename "Certification Manager" to "Cert Manager"). The custom names
are stored in a single platform-level table and read by ALL role views
(Super Admin, Company Admin, DPA, Vessel) so the entire system shows the
same customized module names. The `feature_key` matches the keys used in
`tenant_feature_flags` so the two tables join naturally.

## New Table
### module_definitions
- `id` (uuid, PK)
- `feature_key` (text, NOT NULL, UNIQUE) — matches ModuleKey in tenant_feature_flags
- `display_name` (text, NOT NULL) — the custom label shown across the platform
- `description` (text) — optional custom description
- `sort_order` (integer, DEFAULT 0) — controls column/tile ordering
- `updated_by` (text) — admin email who last changed the definition
- `updated_at` (timestamptz, DEFAULT now())

## Security (RLS)
- Super Admin: full CRUD (via is_super_admin() check)
- All authenticated users: SELECT (module definitions are platform-wide metadata
  that every role needs to read for rendering labels; they contain no tenant secrets)

## Seed
Inserts default rows for all 10 module keys with their canonical names,
so the table is populated on first deploy.

## Important Notes
1. This table is platform-level (not tenant-scoped) — one row per module key.
2. The UNIQUE constraint on feature_key ensures exactly one definition per module.
3. Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
*/

CREATE TABLE IF NOT EXISTS module_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE module_definitions ENABLE ROW LEVEL SECURITY;

-- Super Admin: full CRUD
DROP POLICY IF EXISTS "sa_select_all_module_defs" ON module_definitions;
CREATE POLICY "sa_select_all_module_defs"
  ON module_definitions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_insert_all_module_defs" ON module_definitions;
CREATE POLICY "sa_insert_all_module_defs"
  ON module_definitions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_update_all_module_defs" ON module_definitions;
CREATE POLICY "sa_update_all_module_defs"
  ON module_definitions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

DROP POLICY IF EXISTS "sa_delete_all_module_defs" ON module_definitions;
CREATE POLICY "sa_delete_all_module_defs"
  ON module_definitions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid()));

-- All authenticated tenant users: SELECT only (platform-wide metadata, no tenant secrets)
DROP POLICY IF EXISTS "tenant_select_module_defs" ON module_definitions;
CREATE POLICY "tenant_select_module_defs"
  ON module_definitions FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM super_admins WHERE super_admins.auth_uid = auth.uid())
  );

-- Seed default definitions for all known module keys
INSERT INTO module_definitions (feature_key, display_name, description, sort_order)
SELECT * FROM (VALUES
  ('sms_documentation', 'SMS Documentation', 'Safety Management System manuals, procedures, and policies', 1),
  ('rest_hours', 'Rest Hours Engine', 'MLC-compliant rest hour tracking and fatigue management', 2),
  ('haccp_galley', 'HACCP / Galley', 'Food safety, galley inspections, and HACCP compliance', 3),
  ('certification_manager', 'Certification Manager', 'Crew certification, vessel certificates, and expiry tracking', 4),
  ('satellite_sync', 'Satellite Sync', 'Priority satellite data synchronization and queue management', 5),
  ('voyage_logging', 'Voyage Logging', 'Voyage data recording and port arrival/departure logs', 6),
  ('crew_matrix', 'Crew Matrix', 'Crew competency matrices and familiarization tracking', 7),
  ('electronic_logbooks', 'Electronic Logbooks', 'Digital oil record, garbage, and cargo logbooks', 8),
  ('advanced_analytics', 'Advanced Analytics', 'Fleet performance analytics and trend dashboards', 9),
  ('risk_assessment', 'Risk Assessment', 'Operational risk assessments and mitigation tracking', 10)
) AS v(feature_key, display_name, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM module_definitions m WHERE m.feature_key = v.feature_key
);