/*
# Shoreside Fleet Scope Assignment

## Purpose
Adds fleet scope columns to `tenant_users` so that Shoreside Staff (Technical Superintendents,
HSQE Managers, Fleet Managers, etc.) can be restricted to specific vessels and fleet profiles.
This enables data visibility filtering across all software modules (SMS Review, Rest Hours,
Audits, Defect Reports, Vessel Profiles).

## Changes
1. New Columns on `tenant_users`:
   - `fleet_scope` (text, NOT NULL, DEFAULT 'global') — 'global' = all fleets, 'specific' = restricted
   - `assigned_vessel_ids` (text[], DEFAULT '{}') — array of vessel UUIDs the user can access
   - `assigned_fleet_profile_ids` (text[], DEFAULT '{}') — array of SMS fleet profile IDs the user can access

2. Security
   - No new tables created.
   - No RLS policy changes — existing tenant-scoped policies on `tenant_users` remain intact.
   - Columns are additive and backward-compatible (all default to 'global' / empty arrays).

## Notes
- Shipboard crew (role = 'vessel') are unaffected — they remain locked to their active signed-on vessel.
- Only shoreside staff (role = 'dpa' or 'company_admin') use the fleet_scope filtering.
- When fleet_scope = 'global', assigned_vessel_ids and assigned_fleet_profile_ids are ignored.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_users' AND column_name = 'fleet_scope'
  ) THEN
    ALTER TABLE tenant_users ADD COLUMN fleet_scope text NOT NULL DEFAULT 'global';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_users' AND column_name = 'assigned_vessel_ids'
  ) THEN
    ALTER TABLE tenant_users ADD COLUMN assigned_vessel_ids text[] NOT NULL DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_users' AND column_name = 'assigned_fleet_profile_ids'
  ) THEN
    ALTER TABLE tenant_users ADD COLUMN assigned_fleet_profile_ids text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;
