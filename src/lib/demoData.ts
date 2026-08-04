import type {
  TenantRow,
  TenantUserRow,
  VesselRow,
  CrewAssignmentRow,
  SmsDocRow,
  AuditLogRow,
} from './supabase';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'superadmin' || v === 'company' || v === 'dpa' || v === 'vessel';
}

export function getDemoView(): 'superadmin' | 'company' | 'dpa' | 'vessel' | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('view');
  if (v === 'superadmin' || v === 'company' || v === 'dpa' || v === 'vessel') return v;
  return null;
}

export type DemoTenantId = 'tnt-pacific-horizon' | 'tnt-atlantic-liquid' | 'tnt-nordic-reef' | 'tnt-crescent-maritime';

export const DEMO_TENANTS: TenantRow[] = [
  {
    id: 'tnt-pacific-horizon',
    company: 'Pacific Horizon Cargo',
    contact_email: 'it.director@pacifichorizon.com',
    plan: 'Professional',
    status: 'active',
    vessels_max: 20,
    seats_max: 100,
    storage_gb_max: 250,
    monthly_revenue: 4200,
    region: 'APAC',
    mfa_enforced: true,
    modules: ['sms', 'crew', 'audit'],
    sms_version: '3.2.1',
    created_at: '2025-01-15T00:00:00Z',
    contract_expires: '2027-03-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tnt-atlantic-liquid',
    company: 'Atlantic Liquid Bulk',
    contact_email: 'fleet.ops@atlanticliquidbulk.com',
    plan: 'Enterprise',
    status: 'active',
    vessels_max: 80,
    seats_max: 500,
    storage_gb_max: 1000,
    monthly_revenue: 14500,
    region: 'EMEA',
    mfa_enforced: true,
    modules: ['sms', 'crew', 'audit', 'risk'],
    sms_version: '3.2.1',
    created_at: '2022-03-14T00:00:00Z',
    contract_expires: '2026-09-30T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
  },
  {
    id: 'tnt-nordic-reef',
    company: 'Nordic Reef Shipping',
    contact_email: 'dpa@nordicreef.no',
    plan: 'Professional',
    status: 'trial',
    vessels_max: 20,
    seats_max: 100,
    storage_gb_max: 250,
    monthly_revenue: 0,
    region: 'EMEA',
    mfa_enforced: false,
    modules: ['sms', 'crew'],
    sms_version: '3.1.9',
    created_at: '2025-11-02T00:00:00Z',
    contract_expires: '2026-08-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 'tnt-crescent-maritime',
    company: 'Crescent Marine Logistics',
    contact_email: 'admin@crescentmarine.ae',
    plan: 'Standard',
    status: 'suspended',
    vessels_max: 5,
    seats_max: 25,
    storage_gb_max: 50,
    monthly_revenue: 1200,
    region: 'MEA',
    mfa_enforced: false,
    modules: ['sms', 'crew'],
    sms_version: '3.0.5',
    created_at: '2024-06-18T00:00:00Z',
    contract_expires: '2026-12-25T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
  },
];

export function getDemoTenant(id: string): TenantRow {
  const base = DEMO_TENANTS.find((t) => t.id === id) ?? DEMO_TENANTS[0];
  // Apply localStorage overrides for sms_version
  try {
    const raw = localStorage.getItem(LS_DEMO_TENANT_OVERRIDES);
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, { sms_version?: string }>;
      const ov = overrides[base.id];
      if (ov?.sms_version) return { ...base, sms_version: ov.sms_version };
    }
  } catch { /* ignore */ }
  return base;
}

const LS_DEMO_TENANT_OVERRIDES = 'mpc-demo-tenant-overrides';

export function demoUpdateTenantSmsVersion(tenantId: string, smsVersion: string): void {
  try {
    const raw = localStorage.getItem(LS_DEMO_TENANT_OVERRIDES);
    const overrides = raw ? JSON.parse(raw) as Record<string, { sms_version?: string }> : {};
    overrides[tenantId] = { ...overrides[tenantId], sms_version: smsVersion };
    localStorage.setItem(LS_DEMO_TENANT_OVERRIDES, JSON.stringify(overrides));
  } catch { /* ignore */ }
}

const LS_DEMO_FREEZE = 'mpc-demo-workspace-freeze';

export function demoSetWorkspaceFrozen(tenantId: string, frozen: boolean): void {
  try {
    const raw = localStorage.getItem(LS_DEMO_FREEZE);
    const map = raw ? JSON.parse(raw) as Record<string, boolean> : {};
    map[tenantId] = frozen;
    localStorage.setItem(LS_DEMO_FREEZE, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function demoGetWorkspaceFrozen(tenantId: string): boolean {
  try {
    const raw = localStorage.getItem(LS_DEMO_FREEZE);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[tenantId] === true;
  } catch { /* ignore */ }
  return false;
}

// ── Demo feature flags & sync config (localStorage-backed) ─────────────────
// Unified persistent store so Super Admin toggles persist across view switches
// and propagate live to Company Admin, DPA, and Vessel Shell demo views.

const LS_DEMO_FEATURE_FLAGS = 'mpc-demo-feature-flags';
const LS_DEMO_SYNC_CONFIG = 'mpc-demo-sync-config';

export interface DemoFeatureFlagEntry {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface DemoSyncConfigEntry {
  tenant_id: string;
  auto_sync_interval_hours: number;
  manual_replicate_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** Read all demo feature flag overrides from localStorage. */
export function getDemoFeatureFlags(): DemoFeatureFlagEntry[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_FEATURE_FLAGS);
    if (raw) return JSON.parse(raw) as DemoFeatureFlagEntry[];
  } catch { /* ignore */ }
  return [];
}

/** Read demo feature flags for a single tenant as a Map<feature_key, enabled>. */
export function getDemoFeatureFlagsForTenant(tenantId: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const entry of getDemoFeatureFlags()) {
    if (entry.tenant_id === tenantId) map.set(entry.feature_key, entry.enabled);
  }
  return map;
}

/** Upsert a single demo feature flag into localStorage. */
export function demoSetFeatureFlag(
  tenantId: string,
  featureKey: string,
  enabled: boolean,
  updatedBy: string | null,
): void {
  const all = getDemoFeatureFlags();
  const idx = all.findIndex(
    (e) => e.tenant_id === tenantId && e.feature_key === featureKey,
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = { ...all[idx], enabled, updated_by: updatedBy, updated_at: now };
  } else {
    all.push({ tenant_id: tenantId, feature_key: featureKey, enabled, updated_by: updatedBy, updated_at: now });
  }
  localStorage.setItem(LS_DEMO_FEATURE_FLAGS, JSON.stringify(all));
}

/** Read all demo sync config overrides from localStorage. */
export function getDemoSyncConfigs(): DemoSyncConfigEntry[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_SYNC_CONFIG);
    if (raw) return JSON.parse(raw) as DemoSyncConfigEntry[];
  } catch { /* ignore */ }
  return [];
}

/** Read the demo sync config for a single tenant. Returns null if none saved. */
export function getDemoSyncConfigForTenant(tenantId: string): DemoSyncConfigEntry | null {
  for (const entry of getDemoSyncConfigs()) {
    if (entry.tenant_id === tenantId) return entry;
  }
  return null;
}

/** Upsert the demo sync config for a single tenant into localStorage. */
export function demoSetSyncConfig(
  tenantId: string,
  autoSyncIntervalHours: number,
  manualReplicateEnabled: boolean,
  updatedBy: string | null,
): void {
  const all = getDemoSyncConfigs();
  const idx = all.findIndex((e) => e.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = { ...all[idx], auto_sync_interval_hours: autoSyncIntervalHours, manual_replicate_enabled: manualReplicateEnabled, updated_by: updatedBy, updated_at: now };
  } else {
    all.push({ tenant_id: tenantId, auto_sync_interval_hours: autoSyncIntervalHours, manual_replicate_enabled: manualReplicateEnabled, updated_by: updatedBy, updated_at: now });
  }
  localStorage.setItem(LS_DEMO_SYNC_CONFIG, JSON.stringify(all));
}

// ── Demo module definitions (localStorage-backed) ───────────────────────────

const LS_DEMO_MODULE_DEFS = 'mpc-demo-module-definitions';

export interface DemoModuleDefEntry {
  feature_key: string;
  display_name: string;
  updated_by: string | null;
  updated_at: string;
}

/** Read all demo module definition overrides from localStorage. */
export function getDemoModuleDefs(): DemoModuleDefEntry[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_MODULE_DEFS);
    if (raw) return JSON.parse(raw) as DemoModuleDefEntry[];
  } catch { /* ignore */ }
  return [];
}

/** Read a single module's display name override. Returns null if none. */
export function getDemoModuleDef(featureKey: string): string | null {
  const all = getDemoModuleDefs();
  return all.find((d) => d.feature_key === featureKey)?.display_name ?? null;
}

/** Upsert a single module definition override into localStorage. */
export function demoSetModuleDef(
  featureKey: string,
  displayName: string,
  updatedBy: string | null,
): void {
  const all = getDemoModuleDefs();
  const idx = all.findIndex((d) => d.feature_key === featureKey);
  const now = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = { ...all[idx], display_name: displayName, updated_by: updatedBy, updated_at: now };
  } else {
    all.push({ feature_key: featureKey, display_name: displayName, updated_by: updatedBy, updated_at: now });
  }
  localStorage.setItem(LS_DEMO_MODULE_DEFS, JSON.stringify(all));
}

// ── Guardrail bridge (Super Admin → Company Admin/DPA) ──────────────────────

const LS_DEMO_GUARDRAILS = 'mpc-demo-guardrails';

interface DemoGuardrails {
  maxSubfolderDepth: number;
  maxUploadSizeMb: number;
}

export function demoSetGuardrails(tenantId: string, guardrails: DemoGuardrails): void {
  try {
    const raw = localStorage.getItem(LS_DEMO_GUARDRAILS);
    const map = raw ? JSON.parse(raw) as Record<string, DemoGuardrails> : {};
    map[tenantId] = guardrails;
    localStorage.setItem(LS_DEMO_GUARDRAILS, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function demoGetGuardrails(tenantId: string): DemoGuardrails | null {
  try {
    const raw = localStorage.getItem(LS_DEMO_GUARDRAILS);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, DemoGuardrails>;
    return map[tenantId] ?? null;
  } catch { /* ignore */ }
  return null;
}

export const DEMO_VESSELS: VesselRow[] = [
  // Pacific Horizon Shipping
  {
    id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', name: 'MV Blue Horizon', imo_number: '9456782',
    call_sign: 'V7BHZ', flag_state: 'Liberia', port_of_registry: 'Monrovia', gross_tonnage: 42850, kw_power: 9360,
    vessel_type: 'Bulk Carrier', class_society: 'DNV', sms_active_version: '3.2.1',
    last_sync_at: '2026-07-20T14:30:00Z', created_at: '2025-02-01T00:00:00Z', updated_at: '2026-07-20T14:30:00Z',
  },
  {
    id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', name: 'MV Northern Star', imo_number: '9512347',
    call_sign: '3FNS2', flag_state: 'Marshall Islands', port_of_registry: 'Majuro', gross_tonnage: 51320, kw_power: 11200,
    vessel_type: 'Container Ship', class_society: 'Lloyd\u2019s Register', sms_active_version: '3.2.0',
    last_sync_at: '2026-07-18T09:15:00Z', created_at: '2025-03-10T00:00:00Z', updated_at: '2026-07-18T09:15:00Z',
  },
  {
    id: 'vsl-ocean-pioneer', tenant_id: 'tnt-pacific-horizon', name: 'MV Ocean Pioneer', imo_number: '9387651',
    call_sign: 'A8OPN', flag_state: 'Singapore', port_of_registry: 'Singapore', gross_tonnage: 28940, kw_power: 7200,
    vessel_type: 'Chemical Tanker', class_society: 'ABS', sms_active_version: '3.1.9',
    last_sync_at: '2026-07-15T18:00:00Z', created_at: '2025-01-20T00:00:00Z', updated_at: '2026-07-15T18:00:00Z',
  },
  {
    id: 'vsl-pacific-pearl', tenant_id: 'tnt-pacific-horizon', name: 'MV Pacific Pearl', imo_number: '9678412',
    call_sign: 'D4PPL', flag_state: 'Panama', port_of_registry: 'Panama City', gross_tonnage: 35670, kw_power: 8400,
    vessel_type: 'Product Tanker', class_society: 'BV', sms_active_version: '3.2.1',
    last_sync_at: '2026-07-21T11:45:00Z', created_at: '2025-04-05T00:00:00Z', updated_at: '2026-07-21T11:45:00Z',
  },
  {
    id: 'vsl-one-reputation', tenant_id: 'tnt-pacific-horizon', name: 'MV ONE REPUTATION', imo_number: '9781234',
    call_sign: '9ORP1', flag_state: 'Singapore', port_of_registry: 'Singapore', gross_tonnage: 50890, kw_power: 10650,
    vessel_type: 'Container Ship', class_society: 'DNV', sms_active_version: '3.2.1',
    last_sync_at: '2026-07-22T08:30:00Z', created_at: '2025-05-20T00:00:00Z', updated_at: '2026-07-22T08:30:00Z',
  },
  // Atlantic Liquid Bulk
  {
    id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', name: 'MV Atlas Pride', imo_number: '9412388',
    call_sign: 'V5ATP', flag_state: 'Malta', port_of_registry: 'Valletta', gross_tonnage: 73200, kw_power: 15800,
    vessel_type: 'VLCC Tanker', class_society: 'DNV', sms_active_version: '3.2.1',
    last_sync_at: '2026-07-21T08:00:00Z', created_at: '2022-05-10T00:00:00Z', updated_at: '2026-07-21T08:00:00Z',
  },
  {
    id: 'vsl-stella-voyager', tenant_id: 'tnt-atlantic-liquid', name: 'MV Stella Voyager', imo_number: '9234567',
    call_sign: '9HSVY', flag_state: 'Greece', port_of_registry: 'Piraeus', gross_tonnage: 61800, kw_power: 13200,
    vessel_type: 'Suezmax Tanker', class_society: 'ABS', sms_active_version: '3.2.1',
    last_sync_at: '2026-07-19T16:30:00Z', created_at: '2022-08-15T00:00:00Z', updated_at: '2026-07-19T16:30:00Z',
  },
  {
    id: 'vsl-crest-breeze', tenant_id: 'tnt-atlantic-liquid', name: 'MV Crest Breeze', imo_number: '9345678',
    call_sign: 'C6CRB', flag_state: 'Cyprus', port_of_registry: 'Limassol', gross_tonnage: 47500, kw_power: 10400,
    vessel_type: 'Aframax Tanker', class_society: 'LR', sms_active_version: '3.2.0',
    last_sync_at: '2026-07-17T10:00:00Z', created_at: '2023-01-20T00:00:00Z', updated_at: '2026-07-17T10:00:00Z',
  },
  // Nordic Reef Services
  {
    id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', name: 'MV Nordic Breeze', imo_number: '9123456',
    call_sign: 'NWNBZ', flag_state: 'Norway', port_of_registry: 'Bergen', gross_tonnage: 18500, kw_power: 4800,
    vessel_type: 'Reefer Vessel', class_society: 'DNV', sms_active_version: '3.1.9',
    last_sync_at: '2026-07-16T12:00:00Z', created_at: '2025-11-10T00:00:00Z', updated_at: '2026-07-16T12:00:00Z',
  },
  {
    id: 'vsl-polar-explorer', tenant_id: 'tnt-nordic-reef', name: 'MV Polar Explorer', imo_number: '9234588',
    call_sign: 'P8PEX', flag_state: 'Norway', port_of_registry: 'Troms\u00f8', gross_tonnage: 22300, kw_power: 5600,
    vessel_type: 'Reefer Vessel', class_society: 'DNV', sms_active_version: '3.1.9',
    last_sync_at: '2026-07-14T09:00:00Z', created_at: '2025-12-01T00:00:00Z', updated_at: '2026-07-14T09:00:00Z',
  },
  // Crescent Maritime
  {
    id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', name: 'MV Crescent Trader', imo_number: '9567890',
    call_sign: 'A8CRT', flag_state: 'UAE', port_of_registry: 'Dubai', gross_tonnage: 32100, kw_power: 7800,
    vessel_type: 'General Cargo', class_society: 'BV', sms_active_version: '3.0.5',
    last_sync_at: '2026-07-10T06:00:00Z', created_at: '2024-07-01T00:00:00Z', updated_at: '2026-07-10T06:00:00Z',
  },
  {
    id: 'vsl-gulf-pioneer', tenant_id: 'tnt-crescent-maritime', name: 'MV Gulf Pioneer', imo_number: '9678901',
    call_sign: 'G4GPL', flag_state: 'Bahamas', port_of_registry: 'Nassau', gross_tonnage: 25600, kw_power: 6200,
    vessel_type: 'Container Feeder', class_society: 'ABS', sms_active_version: '3.0.5',
    last_sync_at: '2026-07-08T14:00:00Z', created_at: '2024-08-15T00:00:00Z', updated_at: '2026-07-08T14:00:00Z',
  },
];

function mkUser(
  id: string, tenantId: string, name: string, email: string, rank: TenantUserRow['rank'],
  role: TenantUserRow['role'], nationality: string, status = 'active',
  empId?: string, seamanBook?: string,
  fleetScope: 'global' | 'specific' = 'global',
  assignedVesselIds: string[] = [],
  assignedFleetProfileIds: string[] = [],
): TenantUserRow {
  return {
    id, tenant_id: tenantId, auth_uid: null, name, email,
    employee_id: empId ?? null, passport_number: null, seaman_book_number: seamanBook ?? null,
    nationality, rank, role, status,
    fleet_scope: fleetScope, assigned_vessel_ids: assignedVesselIds, assigned_fleet_profile_ids: assignedFleetProfileIds,
    created_at: '2025-01-15T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  };
}

export const DEMO_USERS: TenantUserRow[] = [
  // Pacific Horizon Shipping
  mkUser('ph-dpa', 'tnt-pacific-horizon', 'Sarah Chen', 'dpa@pacifichorizon.co', 'DPA', 'dpa', 'Singaporean', 'active', 'PHS-0001'),
  mkUser('ph-ca', 'tnt-pacific-horizon', 'Admiral Pierce', 'company.admin@pacifichorizon.co', 'Company Admin', 'company_admin', 'Singaporean', 'active', 'PHS-0000'),
  mkUser('ph-fm', 'tnt-pacific-horizon', 'Thomas Eriksson', 'fleet.manager@pacifichorizon.co', 'Fleet Manager', 'dpa', 'Swedish', 'active', 'PHS-0002'),
  mkUser('ph-master', 'tnt-pacific-horizon', 'James Whitfield', 'master@pacifichorizon.co', 'Master', 'vessel', 'British', 'active', 'PHS-0042', 'SB-99182'),
  mkUser('ph-chief-eng', 'tnt-pacific-horizon', 'Raj Kapoor', 'chief.eng@pacifichorizon.co', 'Chief Engineer', 'vessel', 'Indian', 'active', 'PHS-0058', 'SB-44721'),
  mkUser('ph-chief-mate', 'tnt-pacific-horizon', 'Maria Santos', 'chief.mate@pacifichorizon.co', 'Chief Mate', 'vessel', 'Filipino', 'active', 'PHS-0071', 'SB-77530'),
  mkUser('ph-2nd-eng', 'tnt-pacific-horizon', 'Ivan Petrov', '2nd.eng@pacifichorizon.co', 'Second Engineer', 'vessel', 'Ukrainian', 'active', 'PHS-0089', 'SB-66214'),
  mkUser('ph-bosun', 'tnt-pacific-horizon', 'Ahmed Hassan', 'bosun@pacifichorizon.co', 'Bosun', 'vessel', 'Egyptian', 'active', 'PHS-0102', 'SB-55890'),
  mkUser('ph-ab', 'tnt-pacific-horizon', 'Carlos Mendez', 'ab.seaman@pacifichorizon.co', 'AB', 'vessel', 'Mexican', 'active', 'PHS-0118', 'SB-33421'),
  mkUser('ph-oiler', 'tnt-pacific-horizon', 'Lutfi Wijaya', 'oiler@pacifichorizon.co', 'Oiler', 'vessel', 'Indonesian', 'invited', 'PHS-0125', 'SB-22187'),
  mkUser('ph-cook', 'tnt-pacific-horizon', 'Grace Okoro', 'cook@pacifichorizon.co', 'Cook', 'vessel', 'Nigerian', 'active', 'PHS-0131', 'SB-11203'),
  mkUser('ph-ts', 'tnt-pacific-horizon', 'Daniel Wexford', 'tech.super@pacifichorizon.co', 'Technical Superintendent', 'dpa', 'British', 'active', 'PHS-0003', undefined, 'specific', ['vsl-blue-horizon']),
  // Atlantic Liquid Bulk
  mkUser('al-dpa', 'tnt-atlantic-liquid', 'Margaret Foster', 'dpa@atlanticliquidbulk.com', 'DPA', 'dpa', 'British', 'active', 'ALB-0001'),
  mkUser('al-ca', 'tnt-atlantic-liquid', 'Victoria Hale', 'company.admin@atlanticliquidbulk.com', 'Company Admin', 'company_admin', 'British', 'active', 'ALB-0000'),
  mkUser('al-fm', 'tnt-atlantic-liquid', 'Henrik Larsen', 'fleet.manager@atlanticliquidbulk.com', 'Fleet Manager', 'dpa', 'Danish', 'active', 'ALB-0002'),
  mkUser('al-master', 'tnt-atlantic-liquid', 'Pierre Dubois', 'master@atlanticliquidbulk.com', 'Master', 'vessel', 'French', 'active', 'ALB-0101', 'SB-88451'),
  mkUser('al-chief-eng', 'tnt-atlantic-liquid', 'Sven Olsen', 'chief.eng@atlanticliquidbulk.com', 'Chief Engineer', 'vessel', 'Norwegian', 'active', 'ALB-0115', 'SB-77320'),
  mkUser('al-chief-mate', 'tnt-atlantic-liquid', 'Dimitri Volkov', 'chief.mate@atlanticliquidbulk.com', 'Chief Mate', 'vessel', 'Russian', 'active', 'ALB-0128', 'SB-66195'),
  mkUser('al-bosun', 'tnt-atlantic-liquid', 'Kwame Asante', 'bosun@atlanticliquidbulk.com', 'Bosun', 'vessel', 'Ghanaian', 'active', 'ALB-0142', 'SB-55870'),
  // Nordic Reef Services
  mkUser('nr-dpa', 'tnt-nordic-reef', 'Erik Johansson', 'dpa@nordicreef.no', 'DPA', 'dpa', 'Swedish', 'active', 'NRS-0001'),
  mkUser('nr-ca', 'tnt-nordic-reef', 'Magnus Sorensen', 'company.admin@nordicreef.no', 'Company Admin', 'company_admin', 'Norwegian', 'active', 'NRS-0000'),
  mkUser('nr-fm', 'tnt-nordic-reef', 'Ingrid Berg', 'fleet.manager@nordicreef.no', 'Fleet Manager', 'dpa', 'Norwegian', 'active', 'NRS-0002'),
  mkUser('nr-master', 'tnt-nordic-reef', 'Lars Anderson', 'master@nordicreef.no', 'Master', 'vessel', 'Norwegian', 'active', 'NRS-0051', 'SB-33456'),
  mkUser('nr-chief-eng', 'tnt-nordic-reef', 'Olaf Petersen', 'chief.eng@nordicreef.no', 'Chief Engineer', 'vessel', 'Danish', 'active', 'NRS-0063', 'SB-22890'),
  mkUser('nr-chief-mate', 'tnt-nordic-reef', 'Anna Lindqvist', 'chief.mate@nordicreef.no', 'Chief Mate', 'vessel', 'Finnish', 'active', 'NRS-0075', 'SB-11765'),
  // Crescent Maritime
  mkUser('cm-dpa', 'tnt-crescent-maritime', 'Rashid Al-Maktoum', 'dpa@crescentmaritime.ae', 'DPA', 'dpa', 'Emirati', 'active', 'CMT-0001'),
  mkUser('cm-ca', 'tnt-crescent-maritime', 'Fatima Al-Mansouri', 'company.admin@crescentmaritime.ae', 'Company Admin', 'company_admin', 'Emirati', 'active', 'CMT-0000'),
  mkUser('cm-fm', 'tnt-crescent-maritime', 'Yusuf Al-Rashid', 'fleet.manager@crescentmaritime.ae', 'Fleet Manager', 'dpa', 'Emirati', 'active', 'CMT-0002'),
  mkUser('cm-master', 'tnt-crescent-maritime', 'Ali Hassan', 'master@crescentmaritime.ae', 'Master', 'vessel', 'Pakistani', 'active', 'CMT-0031', 'SB-99120'),
  mkUser('cm-chief-eng', 'tnt-crescent-maritime', 'Vikram Singh', 'chief.eng@crescentmaritime.ae', 'Chief Engineer', 'vessel', 'Indian', 'active', 'CMT-0045', 'SB-88210'),
  mkUser('cm-chief-mate', 'tnt-crescent-maritime', 'Hassan Bilal', 'chief.mate@crescentmaritime.ae', 'Chief Mate', 'vessel', 'Lebanese', 'active', 'CMT-0058', 'SB-77150'),
];

export function getDemoUsersForTenant(tenantId: string): TenantUserRow[] {
  return DEMO_USERS.filter((u) => u.tenant_id === tenantId);
}

export const DEMO_ASSIGNMENTS: CrewAssignmentRow[] = [
  // Pacific Horizon
  { id: 'ph-a1', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-master', rank: 'Master', signed_on_at: '2026-06-01T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-01T00:00:00Z' },
  { id: 'ph-a2', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-01T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-01T00:00:00Z' },
  { id: 'ph-a3', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-01T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-01T00:00:00Z' },
  { id: 'ph-a4', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-bosun', rank: 'Bosun', signed_on_at: '2026-06-15T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-15T00:00:00Z' },
  { id: 'ph-a5', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-cook', rank: 'Cook', signed_on_at: '2026-06-10T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-10T00:00:00Z' },
  { id: 'ph-a6', vessel_id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-2nd-eng', rank: 'Second Engineer', signed_on_at: '2026-05-20T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-05-20T00:00:00Z' },
  { id: 'ph-a7', vessel_id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-ab', rank: 'AB', signed_on_at: '2026-05-20T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-05-20T00:00:00Z' },
  // Atlantic Liquid
  { id: 'al-a1', vessel_id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-master', rank: 'Master', signed_on_at: '2026-06-10T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-10T00:00:00Z' },
  { id: 'al-a2', vessel_id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-10T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-10T00:00:00Z' },
  { id: 'al-a3', vessel_id: 'vsl-stella-voyager', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-05T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-05T00:00:00Z' },
  { id: 'al-a4', vessel_id: 'vsl-crest-breeze', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-bosun', rank: 'Bosun', signed_on_at: '2026-06-12T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-12T00:00:00Z' },
  // Nordic Reef
  { id: 'nr-a1', vessel_id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', user_id: 'nr-master', rank: 'Master', signed_on_at: '2026-06-15T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-15T00:00:00Z' },
  { id: 'nr-a2', vessel_id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', user_id: 'nr-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-15T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-15T00:00:00Z' },
  { id: 'nr-a3', vessel_id: 'vsl-polar-explorer', tenant_id: 'tnt-nordic-reef', user_id: 'nr-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-08T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-06-08T00:00:00Z' },
  // Crescent Maritime
  { id: 'cm-a1', vessel_id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-master', rank: 'Master', signed_on_at: '2026-07-01T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-07-01T00:00:00Z' },
  { id: 'cm-a2', vessel_id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-07-01T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-07-01T00:00:00Z' },
  { id: 'cm-a3', vessel_id: 'vsl-gulf-pioneer', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-07-05T00:00:00Z', signed_off_at: null, notes: null, created_at: '2026-07-05T00:00:00Z' },
];

export function getDemoAssignmentsForTenant(tenantId: string): CrewAssignmentRow[] {
  return DEMO_ASSIGNMENTS.filter((a) => a.tenant_id === tenantId && !a.signed_off_at);
}

// ── Demo-mode mutation helpers (localStorage-backed) ──────────────────────

const LS_DEMO_ASSIGNMENTS = 'mpc-demo-assignments';

export function getDemoAssignmentOverrides(): Record<string, CrewAssignmentRow[]> {
  try {
    const raw = localStorage.getItem(LS_DEMO_ASSIGNMENTS);
    if (raw) return JSON.parse(raw) as Record<string, CrewAssignmentRow[]>;
  } catch { /* ignore */ }
  return {};
}

function saveDemoAssignmentOverrides(overrides: Record<string, CrewAssignmentRow[]>): void {
  localStorage.setItem(LS_DEMO_ASSIGNMENTS, JSON.stringify(overrides));
}

/** Return the effective demo assignments for a tenant: base + overrides. */
export function getEffectiveDemoAssignments(tenantId: string): CrewAssignmentRow[] {
  const overrides = getDemoAssignmentOverrides();
  const tenantOverrides = overrides[tenantId] ?? [];
  const overriddenIds = new Set(tenantOverrides.map((a) => a.id));
  const base = DEMO_ASSIGNMENTS.filter((a) => a.tenant_id === tenantId && !overriddenIds.has(a.id));
  return [...base, ...tenantOverrides].filter((a) => !a.signed_off_at);
}

/** Sign off a crew member in demo mode (sets signed_off_at timestamp). */
export function demoSignOff(tenantId: string, assignmentId: string): void {
  const overrides = getDemoAssignmentOverrides();
  const list = overrides[tenantId] ?? [];
  // Check overrides first
  let found = list.find((a) => a.id === assignmentId);
  if (found) {
    found.signed_off_at = new Date().toISOString();
  } else {
    // Copy from base data with override
    const base = DEMO_ASSIGNMENTS.find((a) => a.id === assignmentId && a.tenant_id === tenantId);
    if (base) {
      list.push({ ...base, signed_off_at: new Date().toISOString() });
      found = base;
    }
  }
  overrides[tenantId] = list;
  saveDemoAssignmentOverrides(overrides);
}

// ── Demo user creation (localStorage-backed) ───────────────────────────────

const LS_DEMO_USERS = 'mpc-demo-users';

export function getDemoUserOverrides(): TenantUserRow[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_USERS);
    if (raw) return JSON.parse(raw) as TenantUserRow[];
  } catch { /* ignore */ }
  return [];
}

function saveDemoUserOverrides(users: TenantUserRow[]): void {
  localStorage.setItem(LS_DEMO_USERS, JSON.stringify(users));
}

const LS_DEMO_DELETED_USERS = 'mpc-demo-deleted-users';

export function getDemoDeletedUserIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_DEMO_DELETED_USERS);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveDemoDeletedUserIds(ids: Set<string>): void {
  localStorage.setItem(LS_DEMO_DELETED_USERS, JSON.stringify([...ids]));
}

/** Return effective demo users for a tenant: base + overrides, minus deleted. */
export function getEffectiveDemoUsers(tenantId: string): TenantUserRow[] {
  const deleted = getDemoDeletedUserIds();
  const overrides = getDemoUserOverrides().filter((u) => u.tenant_id === tenantId && !deleted.has(u.id));
  const overrideIds = new Set(overrides.map((u) => u.id));
  const base = DEMO_USERS.filter((u) => u.tenant_id === tenantId && !overrideIds.has(u.id) && !deleted.has(u.id));
  return [...base, ...overrides];
}

/** Create a new demo user (provisioned via the UI). Returns the new user ID. */
export function demoCreateUser(
  tenantId: string,
  data: { name: string; email: string; employee_id: string | null; passport_number: string | null; seaman_book_number: string | null; nationality: string | null; rank: TenantUserRow['rank']; role: TenantUserRow['role']; status?: string; fleet_scope?: 'global' | 'specific'; assigned_vessel_ids?: string[]; assigned_fleet_profile_ids?: string[] },
): string {
  const overrides = getDemoUserOverrides();
  const newId = `demo-user-${Date.now()}`;
  overrides.push({
    id: newId,
    tenant_id: tenantId,
    auth_uid: null,
    name: data.name,
    email: data.email,
    employee_id: data.employee_id,
    passport_number: data.passport_number,
    seaman_book_number: data.seaman_book_number,
    nationality: data.nationality,
    rank: data.rank,
    role: data.role,
    status: (data.status as TenantUserRow['status']) ?? 'invited',
    fleet_scope: data.fleet_scope ?? 'global',
    assigned_vessel_ids: data.assigned_vessel_ids ?? [],
    assigned_fleet_profile_ids: data.assigned_fleet_profile_ids ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  saveDemoUserOverrides(overrides);
  return newId;
}

/** Permanently delete a demo user — signs off active assignments, removes from overrides or marks base user deleted. */
export function demoDeleteUser(tenantId: string, userId: string): void {
  // Sign off any active assignments (overrides + base)
  const assignOverrides = getDemoAssignmentOverrides();
  const list = assignOverrides[tenantId] ?? [];
  for (const a of list) {
    if (a.user_id === userId && !a.signed_off_at) a.signed_off_at = new Date().toISOString();
  }
  for (const baseA of DEMO_ASSIGNMENTS.filter((a) => a.user_id === userId && a.tenant_id === tenantId && !a.signed_off_at)) {
    if (!list.some((a) => a.id === baseA.id)) list.push({ ...baseA, signed_off_at: new Date().toISOString() });
  }
  assignOverrides[tenantId] = list;
  saveDemoAssignmentOverrides(assignOverrides);

  // Remove from user overrides if present
  saveDemoUserOverrides(getDemoUserOverrides().filter((u) => u.id !== userId));

  // Mark as deleted (covers base users that can't be removed from the const array)
  const deleted = getDemoDeletedUserIds();
  deleted.add(userId);
  saveDemoDeletedUserIds(deleted);
}

/** Set a demo user's status (active, locked, inactive, invited). */
export function demoSetUserStatus(tenantId: string, userId: string, status: string): void {
  const overrides = getDemoUserOverrides();
  const idx = overrides.findIndex((u) => u.id === userId && u.tenant_id === tenantId);
  if (idx >= 0) {
    overrides[idx].status = status as TenantUserRow['status'];
    overrides[idx].updated_at = new Date().toISOString();
    saveDemoUserOverrides(overrides);
  } else {
    const base = DEMO_USERS.find((u) => u.id === userId && u.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, status: status as TenantUserRow['status'], updated_at: new Date().toISOString() });
      saveDemoUserOverrides(overrides);
    }
  }
}

/** Deactivate a demo user — signs off assignments and sets status to 'inactive' (preserves record). */
export function demoDeactivateUser(tenantId: string, userId: string): void {
  // Sign off any active assignments (overrides + base)
  const assignOverrides = getDemoAssignmentOverrides();
  const list = assignOverrides[tenantId] ?? [];
  for (const a of list) {
    if (a.user_id === userId && !a.signed_off_at) a.signed_off_at = new Date().toISOString();
  }
  for (const baseA of DEMO_ASSIGNMENTS.filter((a) => a.user_id === userId && a.tenant_id === tenantId && !a.signed_off_at)) {
    if (!list.some((a) => a.id === baseA.id)) list.push({ ...baseA, signed_off_at: new Date().toISOString() });
  }
  assignOverrides[tenantId] = list;
  saveDemoAssignmentOverrides(assignOverrides);

  // Set status to 'inactive' — preserve the record, do NOT delete
  demoSetUserStatus(tenantId, userId, 'inactive');
}

// ── Demo vessel persistence (localStorage-backed) ──────────────────────────

const LS_DEMO_VESSELS = 'mpc-demo-vessels';
const LS_DEMO_DELETED_VESSELS = 'mpc-demo-deleted-vessels';

export function getDemoVesselOverrides(): VesselRow[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_VESSELS);
    if (raw) return JSON.parse(raw) as VesselRow[];
  } catch { /* ignore */ }
  return [];
}

function saveDemoVesselOverrides(vessels: VesselRow[]): void {
  localStorage.setItem(LS_DEMO_VESSELS, JSON.stringify(vessels));
}

function getDemoDeletedVesselIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_DEMO_DELETED_VESSELS);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveDemoDeletedVesselIds(ids: Set<string>): void {
  localStorage.setItem(LS_DEMO_DELETED_VESSELS, JSON.stringify([...ids]));
}

/** Return effective demo vessels for a tenant: base + overrides, minus deleted. */
export function getEffectiveDemoVessels(tenantId: string): VesselRow[] {
  const deleted = getDemoDeletedVesselIds();
  const overrides = getDemoVesselOverrides().filter((v) => v.tenant_id === tenantId && !deleted.has(v.id));
  const overrideIds = new Set(overrides.map((v) => v.id));
  const base = DEMO_VESSELS.filter((v) => v.tenant_id === tenantId && !overrideIds.has(v.id) && !deleted.has(v.id));
  return [...base, ...overrides];
}

/** Create a new demo vessel. Returns the new vessel ID. */
export function demoCreateVessel(
  tenantId: string,
  data: { name: string; imo_number: string; call_sign: string | null; flag_state: string | null; port_of_registry: string | null; gross_tonnage: number | null; kw_power: number | null; vessel_type: string | null; class_society: string | null },
  smsVersion: string,
): string {
  const overrides = getDemoVesselOverrides();
  const newId = `demo-vessel-${Date.now()}`;
  overrides.push({
    id: newId, tenant_id: tenantId,
    name: data.name, imo_number: data.imo_number, call_sign: data.call_sign,
    flag_state: data.flag_state, port_of_registry: data.port_of_registry,
    gross_tonnage: data.gross_tonnage, kw_power: data.kw_power,
    vessel_type: data.vessel_type, class_society: data.class_society,
    sms_active_version: smsVersion, last_sync_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  saveDemoVesselOverrides(overrides);
  return newId;
}

/** Delete a demo vessel — signs off crew, removes from overrides or marks base vessel deleted. */
export function demoDeleteVessel(tenantId: string, vesselId: string): void {
  const assignOverrides = getDemoAssignmentOverrides();
  const list = assignOverrides[tenantId] ?? [];
  for (const a of list) {
    if (a.vessel_id === vesselId && !a.signed_off_at) a.signed_off_at = new Date().toISOString();
  }
  for (const baseA of DEMO_ASSIGNMENTS.filter((a) => a.vessel_id === vesselId && a.tenant_id === tenantId && !a.signed_off_at)) {
    if (!list.some((a) => a.id === baseA.id)) list.push({ ...baseA, signed_off_at: new Date().toISOString() });
  }
  assignOverrides[tenantId] = list;
  saveDemoAssignmentOverrides(assignOverrides);

  saveDemoVesselOverrides(getDemoVesselOverrides().filter((v) => v.id !== vesselId));
  const deleted = getDemoDeletedVesselIds();
  deleted.add(vesselId);
  saveDemoDeletedVesselIds(deleted);
}

/** Update a demo vessel's SMS version and sync timestamp. */
export function demoUpdateVesselSync(tenantId: string, vesselId: string, smsVersion: string): void {
  const overrides = getDemoVesselOverrides();
  const idx = overrides.findIndex((v) => v.id === vesselId && v.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].sms_active_version = smsVersion;
    overrides[idx].last_sync_at = now;
    overrides[idx].updated_at = now;
    saveDemoVesselOverrides(overrides);
  } else {
    const base = DEMO_VESSELS.find((v) => v.id === vesselId && v.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, sms_active_version: smsVersion, last_sync_at: now, updated_at: now });
      saveDemoVesselOverrides(overrides);
    }
  }
}

/** Update a demo vessel's technical details. */
export function demoUpdateVessel(tenantId: string, vesselId: string, updates: Partial<Omit<VesselRow, 'id' | 'tenant_id' | 'created_at'>>): void {
  const overrides = getDemoVesselOverrides();
  const idx = overrides.findIndex((v) => v.id === vesselId && v.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx] = { ...overrides[idx], ...updates, updated_at: now };
    saveDemoVesselOverrides(overrides);
  } else {
    const base = DEMO_VESSELS.find((v) => v.id === vesselId && v.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, ...updates, updated_at: now });
      saveDemoVesselOverrides(overrides);
    }
  }
}

/** Sign on a crew member to a vessel in demo mode. */
export function demoSignOn(tenantId: string, userId: string, vesselId: string, rank: string): string {
  const overrides = getDemoAssignmentOverrides();
  const list = overrides[tenantId] ?? [];
  // Remove any existing active assignment for this user (from overrides)
  for (const a of list) {
    if (a.user_id === userId && !a.signed_off_at) {
      a.signed_off_at = new Date().toISOString();
    }
  }
  // Also sign off any matching base assignment by creating an override copy
  const baseActive = DEMO_ASSIGNMENTS.find((a) => a.user_id === userId && a.tenant_id === tenantId && !a.signed_off_at);
  if (baseActive && !list.some((a) => a.id === baseActive.id)) {
    list.push({ ...baseActive, signed_off_at: new Date().toISOString() });
  }
  const newId = `demo-assign-${Date.now()}-${userId.slice(-4)}`;
  list.push({
    id: newId,
    vessel_id: vesselId,
    tenant_id: tenantId,
    user_id: userId,
    rank: rank as CrewAssignmentRow['rank'],
    signed_on_at: new Date().toISOString(),
    signed_off_at: null,
    notes: null,
    created_at: new Date().toISOString(),
  });
  overrides[tenantId] = list;
  saveDemoAssignmentOverrides(overrides);
  return newId;
}

function mkDoc(
  id: string, tenantId: string, parentId: string | null, treeKind: string, label: string,
  kind: 'folder' | 'document', approval: 'approved' | 'pending_dpa' | 'draft', sortOrder: number,
  content?: string, contentKind?: 'rich_text' | 'pdf', regulatory = false,
  profileId?: string | null,
): SmsDocRow {
  return {
    id, tenant_id: tenantId, parent_id: parentId, tree_kind: treeKind as SmsDocRow['tree_kind'],
    label, node_kind: kind, content_kind: contentKind ?? null, content: content ?? null,
    is_regulatory_header: regulatory, approval_state: approval, version: '3.2.1', sort_order: sortOrder,
    profile_id: profileId ?? null,
    created_at: '2025-01-15T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  };
}

function buildSmsTree(tenantId: string, version: string): SmsDocRow[] {
  const prefix = tenantId.slice(0, 6);
  return [
    mkDoc(`${prefix}-sms-root`, tenantId, null, 'sms', 'Safety Management System', 'folder', 'approved', 0, undefined, undefined, true),
    mkDoc(`${prefix}-sms-100`, tenantId, `${prefix}-sms-root`, 'sms', '1. Safety & Environmental Policy', 'folder', 'approved', 1, undefined, undefined, true),
    mkDoc(`${prefix}-sms-101`, tenantId, `${prefix}-sms-100`, 'sms', '1.1 Company Health & Safety Policy', 'document', 'approved', 1,
      `It is the policy of this company to provide a safe and healthy working environment for all personnel aboard our vessels. We are committed to zero harm to people, zero spills to the environment, and zero incidents.\n\nEvery crew member has the responsibility to stop any work that they believe is unsafe.\n\nSigned,\nDPA\nVersion: ${version}`),
    mkDoc(`${prefix}-sms-102`, tenantId, `${prefix}-sms-100`, 'sms', '1.2 Drug & Alcohol Policy', 'document', 'approved', 2,
      'Zero-tolerance policy for drugs and alcohol. Blood alcohol limit is 0.04%. Random testing at sign-on, during voyage, and post-incident. Violations result in immediate sign-off and disciplinary action.'),
    mkDoc(`${prefix}-sms-103`, tenantId, `${prefix}-sms-100`, 'sms', '1.3 Environmental Protection Policy', 'document', 'approved', 3,
      'We are committed to protecting the marine environment. Zero discharge of oil, chemicals, or garbage in prohibited zones. All waste is segregated and disposed of at port facilities. MARPOL Annex I-VI compliance is mandatory.'),
    mkDoc(`${prefix}-sms-104`, tenantId, `${prefix}-sms-100`, 'sms', '1.4 Quality Management Policy (Pending Revision)', 'document', 'pending_dpa', 4,
      'Under revision to reflect updated ISO 9001:2025 requirements. Pending DPA review and approval.'),

    mkDoc(`${prefix}-sms-200`, tenantId, `${prefix}-sms-root`, 'sms', '2. Procedures & Operating Manuals', 'folder', 'approved', 2, undefined, undefined, true),
    mkDoc(`${prefix}-sms-210`, tenantId, `${prefix}-sms-200`, 'sms', '2.1 Bridge Procedures', 'folder', 'approved', 1),
    mkDoc(`${prefix}-sms-211`, tenantId, `${prefix}-sms-210`, 'sms', '2.1.1 Watchkeeping Procedures', 'document', 'approved', 1,
      'Bridge watchkeeping shall follow STCW Convention requirements. The OOW must maintain a proper lookout at all times. Handover of the watch must be formally documented. Master must be called if visibility drops below 2NM. Watch alarms must be active at all times.'),
    mkDoc(`${prefix}-sms-212`, tenantId, `${prefix}-sms-210`, 'sms', '2.1.2 Navigation in Restricted Waters', 'document', 'approved', 2,
      'When navigating in restricted waters: Master on bridge, engine room on standby, all navigation aids operational, sound signals ready, lookout posted forward if visibility restricted.'),
    mkDoc(`${prefix}-sms-220`, tenantId, `${prefix}-sms-200`, 'sms', '2.2 Engine Room Procedures', 'folder', 'approved', 2),
    mkDoc(`${prefix}-sms-221`, tenantId, `${prefix}-sms-220`, 'sms', '2.2.1 Main Engine Start/Stop Procedure', 'document', 'approved', 1,
      'Main engine start and stop per manufacturer guidelines. Start: check lube oil pressure, confirm fuel temperature, turn on starting air, engage turning gear disengagement, start on air switch to fuel. Stop: reduce to dead slow, cut fuel, engage turning gear, maintain cooling 30 min.'),
    mkDoc(`${prefix}-sms-222`, tenantId, `${prefix}-sms-220`, 'sms', '2.2.2 Bunkering Operations Procedure', 'document', 'approved', 2,
      'Bunkering requires: pre-bunkering checklist, scuppers plugged, oil spill equipment ready, communication between bunker station and supplier, sounding every 15 minutes, bunkering plan approved by Chief Engineer.'),
    mkDoc(`${prefix}-sms-230`, tenantId, `${prefix}-sms-200`, 'sms', '2.3 Cargo Operations', 'folder', 'approved', 3),
    mkDoc(`${prefix}-sms-231`, tenantId, `${prefix}-sms-230`, 'sms', '2.3.1 Cargo Loading/Unloading Procedures', 'document', 'approved', 1,
      'Cargo operations must follow the approved loading plan. Maximum bending moments and shear forces monitored. Draft surveys at start and completion. Stop cargo if any deviation or safety concern arises.'),

    mkDoc(`${prefix}-sms-300`, tenantId, `${prefix}-sms-root`, 'sms', '3. Emergency Preparedness & Response', 'folder', 'approved', 3, undefined, undefined, true),
    mkDoc(`${prefix}-sms-310`, tenantId, `${prefix}-sms-300`, 'sms', '3.1 Emergency Response Plans', 'folder', 'approved', 1),
    mkDoc(`${prefix}-sms-311`, tenantId, `${prefix}-sms-310`, 'sms', '3.1.1 Fire Emergency Plan', 'document', 'approved', 1,
      'FIRE EMERGENCY: Raise alarm, notify bridge, muster crew, close fire doors and ventilation, activate CO2 or water mist, boundary cooling, head count. DO NOT re-enter space until declared safe by Master.'),
    mkDoc(`${prefix}-sms-312`, tenantId, `${prefix}-sms-310`, 'sms', '3.1.2 Man Overboard Plan', 'document', 'approved', 2,
      'MAN OVERBOARD: Shout and throw lifebuoy, inform bridge, engine room standby, execute Williamson or Scharnow turn, post lookouts, prepare rescue boat, recover person, provide medical aid.'),
    mkDoc(`${prefix}-sms-313`, tenantId, `${prefix}-sms-310`, 'sms', '3.1.3 Oil Spill Response Plan (SOPEP)', 'document', 'approved', 3,
      'SOPEP: Stop operation causing spill, activate spill response team, deploy containment booms, use SOPEP equipment, notify port authority and company, document spill volume, file incident report within 24 hours.'),

    mkDoc(`${prefix}-sms-400`, tenantId, `${prefix}-sms-root`, 'sms', '4. Maintenance & Equipment', 'folder', 'approved', 4, undefined, undefined, true),
    mkDoc(`${prefix}-sms-410`, tenantId, `${prefix}-sms-400`, 'sms', '4.1 Planned Maintenance System', 'folder', 'approved', 1),
    mkDoc(`${prefix}-sms-411`, tenantId, `${prefix}-sms-410`, 'sms', '4.1.1 PMS Overview & Scheduling', 'document', 'approved', 1,
      'The PMS covers all critical shipboard equipment. Maintenance scheduled based on running hours, calendar intervals, and condition monitoring. Managed through AMOS software. Work orders closed within 7 days.'),
    mkDoc(`${prefix}-sms-412`, tenantId, `${prefix}-sms-410`, 'sms', '4.1.2 Critical Equipment List', 'document', 'pending_dpa', 2,
      'Critical equipment: main engine, steering gear, emergency generator, fire pumps, lifeboat engines, radar, GPS, GMDSS, bilge and ballast pumps. Draft pending DPA approval.'),

    mkDoc(`${prefix}-sms-500`, tenantId, `${prefix}-sms-root`, 'sms', '5. Training & Certification', 'folder', 'approved', 5, undefined, undefined, true),
    mkDoc(`${prefix}-sms-510`, tenantId, `${prefix}-sms-500`, 'sms', '5.1 STCW Training Requirements', 'document', 'approved', 1,
      'All crew must hold valid STCW certificates. Basic safety training renewed every 5 years. Advanced firefighting, medical first aid, survival craft, GMDSS, ship security officer as required by rank.'),
    mkDoc(`${prefix}-sms-520`, tenantId, `${prefix}-sms-500`, 'sms', '5.2 Ship-Specific Familiarization', 'document', 'approved', 2,
      'New crew must complete ship-specific familiarization within 48 hours: safety equipment, emergency alarms, muster stations, escape routes, fire damper locations, LSA and FFA locations, ship-specific procedures.'),
  ];
}

function buildFleetCirculars(tenantId: string): SmsDocRow[] {
  const prefix = tenantId.slice(0, 6);
  return [
    mkDoc(`${prefix}-fc-root`, tenantId, null, 'fleet_circulars', 'Fleet Circulars', 'folder', 'approved', 0, undefined, undefined, true),
    mkDoc(`${prefix}-fc-01`, tenantId, `${prefix}-fc-root`, 'fleet_circulars', 'FC-2026-01: IMO 2026 Sulphur Cap Update', 'document', 'approved', 1,
      'Effective 1 March 2026, the global sulphur cap is reduced to 0.45%. All vessels must ensure bunker fuel meets 0.45% sulphur max, fuel changeover procedures updated, Fuel Oil Availability Letters obtained, EGCS operational and compliant.'),
    mkDoc(`${prefix}-fc-02`, tenantId, `${prefix}-fc-root`, 'fleet_circulars', 'FC-2026-02: ISM Code Amendment — Risk Assessment', 'document', 'approved', 2,
      'IMO adopted amendments requiring enhanced risk assessment. All risk assessments must use the new 5x5 matrix. JSA required for all non-routine tasks. Risk assessments reviewed at each safety committee meeting.'),
    mkDoc(`${prefix}-fc-03`, tenantId, `${prefix}-fc-root`, 'fleet_circulars', 'FC-2026-03: Cyber Security Guideline Update', 'document', 'approved', 3,
      'All vessels must implement cyber security measures: change default passwords quarterly, USB controls, network segmentation, backup navigation data weekly, report cyber incidents immediately.'),
    mkDoc(`${prefix}-fc-04`, tenantId, `${prefix}-fc-root`, 'fleet_circulars', 'FC-2026-04: Hurricane Season Routing Advisory', 'document', 'pending_dpa', 4,
      'Updated routing guidance for hurricane season. Masters advised to maintain minimum 200NM distance from named storms. Awaiting DPA final review.'),
  ];
}

function buildFlagState(tenantId: string): SmsDocRow[] {
  const prefix = tenantId.slice(0, 6);
  return [
    mkDoc(`${prefix}-fs-root`, tenantId, null, 'flag_state', 'Flag State Documents', 'folder', 'approved', 0, undefined, undefined, true),
    mkDoc(`${prefix}-fs-01`, tenantId, `${prefix}-fs-root`, 'flag_state', 'Marine Notice 001-2026: Annual Safety Inspections', 'document', 'approved', 1,
      'All flagged vessels must undergo annual safety equipment inspections by an approved Recognized Organization. All LSA and FFA tested and certified. Fire drills witnessed by surveyor. Report submitted within 30 days.'),
    mkDoc(`${prefix}-fs-02`, tenantId, `${prefix}-fs-root`, 'flag_state', 'Marine Notice 002-2026: Crew Certification Verification', 'document', 'approved', 2,
      'All seafarers must have certifications verified through the flag state Seafarer Management System prior to deployment. Masters must maintain copies of verified credentials on board for PSC inspection.'),
    mkDoc(`${prefix}-fs-03`, tenantId, `${prefix}-fs-root`, 'flag_state', 'IMO MSC.500(105): Updated LSA Code Amendments', 'document', 'approved', 3,
      'Amendments to the LSA Code: lifeboat release hooks must meet new load testing criteria, thermal protective aids required for cold climate operations, new free-fall lifeboat launching requirements. Entry into force: 1 January 2027.'),
    mkDoc(`${prefix}-fs-04`, tenantId, `${prefix}-fs-root`, 'flag_state', 'STCW.7/Circ.22: Updated ECDIS Training Standards', 'document', 'approved', 4,
      'All deck officers on ECDIS-equipped vessels must complete type-specific ECDIS training in addition to generic training. Type-specific training must be renewed when ECDIS model is changed or upgraded.'),
  ];
}

function buildBulkCarrierProfileDocs(tenantId: string): SmsDocRow[] {
  const prefix = tenantId.slice(0, 6);
  const profileId = `profile-bulk-${tenantId}`;
  return [
    mkDoc(`${prefix}-bc-root`, tenantId, null, 'sms', 'Bulk Carrier SMS Supplement', 'folder', 'approved', 10, undefined, undefined, false, profileId),
    mkDoc(`${prefix}-bc-100`, tenantId, `${prefix}-bc-root`, 'sms', '1. Bulk Carrier Cargo Operations', 'folder', 'approved', 1, undefined, undefined, false, profileId),
    mkDoc(`${prefix}-bc-101`, tenantId, `${prefix}-bc-100`, 'sms', '1.1 Loading Manual — Bulk Carrier Specific', 'document', 'approved', 1,
      'All bulk carrier loading must comply with the IMSBC Code. Cargo declarations must be obtained before loading. Hold cleaning procedures vary by cargo grade. Draft survey at load and discharge. Trim and stability checked against approved loading manual.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-102`, tenantId, `${prefix}-bc-100`, 'sms', '1.2 Cargo Hold Preparation & Cleaning', 'document', 'approved', 2,
      'Hold preparation: sweep clean, wash with fresh water if required, dry holds completely, inspect for residue and damage. Cargo hold paint condition checked. Bilge wells cleaned and tested. Hatch cover weathertightness verified.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-103`, tenantId, `${prefix}-bc-100`, 'sms', '1.3 Liquefaction Risk Assessment (Pending)', 'document', 'pending_dpa', 3,
      'Group A cargoes (coal, nickel ore, bauxite) require liquefaction risk assessment per IMSBC Code. TML must be verified within 7 days of loading. Waiting DPA approval for updated procedure.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-200`, tenantId, `${prefix}-bc-root`, 'sms', '2. Bulk Carrier Structural Safety', 'folder', 'approved', 2, undefined, undefined, false, profileId),
    mkDoc(`${prefix}-bc-201`, tenantId, `${prefix}-bc-200`, 'sms', '2.1 Hold Frame Inspection & Maintenance', 'document', 'approved', 1,
      'Hold frames and bulkhead corrugations inspected every 6 months. Corrosion margins per class society. Web frame cracking monitored in high-stress areas. Renews planned when wastage exceeds allowable limits.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-202`, tenantId, `${prefix}-bc-200`, 'sms', '2.2 Ballast Tank Coating & Maintenance', 'document', 'approved', 2,
      'Ballast tank coating inspected annually. Rust creep measured and documented. Anodes replaced as per PMS schedule. Tank cleaning and gas freeing before entry.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-300`, tenantId, `${prefix}-bc-root`, 'sms', '3. Bulk Carrier Emergency Procedures', 'folder', 'approved', 3, undefined, undefined, false, profileId),
    mkDoc(`${prefix}-bc-301`, tenantId, `${prefix}-bc-300`, 'sms', '3.1 Cargo Shift Emergency Response', 'document', 'approved', 1,
      'In case of cargo shift: reduce speed, alter course to minimize rolling, assess stability and list, consider ballast adjustments to correct list, notify company and seek nearest port of refuge if stability compromised.', 'rich_text', false, profileId),
    mkDoc(`${prefix}-bc-302`, tenantId, `${prefix}-bc-300`, 'sms', '3.2 Flooding & Hull Failure Response', 'document', 'approved', 2,
      'If hull failure suspected: sound all tanks and holds, activate bilge/ballast pumps, assess structural integrity, contact DPA and class society, prepare for possible abandonment if situation deteriorates.', 'rich_text', false, profileId),
  ];
}

const _allSmsDocs: SmsDocRow[] = [];
for (const t of DEMO_TENANTS) {
  _allSmsDocs.push(...buildSmsTree(t.id, t.sms_version));
  _allSmsDocs.push(...buildFleetCirculars(t.id));
  _allSmsDocs.push(...buildFlagState(t.id));
  _allSmsDocs.push(...buildBulkCarrierProfileDocs(t.id));
}
export const DEMO_SMS_DOCS: SmsDocRow[] = _allSmsDocs;

export function getDemoSmsDocs(tenantId: string): SmsDocRow[] {
  return DEMO_SMS_DOCS.filter((d) => d.tenant_id === tenantId);
}

// ── Demo SMS document CRUD (localStorage-backed) ───────────────────────────

const LS_DEMO_SMS_DOCS = 'mpc-demo-sms-docs';
const LS_DEMO_SMS_DELETED = 'mpc-demo-sms-deleted';

export function getDemoSmsDocOverrides(): SmsDocRow[] {
  try {
    const raw = localStorage.getItem(LS_DEMO_SMS_DOCS);
    if (raw) return JSON.parse(raw) as SmsDocRow[];
  } catch { /* ignore */ }
  return [];
}

function saveDemoSmsDocOverrides(docs: SmsDocRow[]): void {
  localStorage.setItem(LS_DEMO_SMS_DOCS, JSON.stringify(docs));
}

function getDemoSmsDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_DEMO_SMS_DELETED);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveDemoSmsDeletedIds(ids: Set<string>): void {
  localStorage.setItem(LS_DEMO_SMS_DELETED, JSON.stringify([...ids]));
}

/** Return the effective SMS docs for a tenant: base + overrides, minus deleted, optionally filtered by tree_kind and/or profile_id. */
export function getEffectiveDemoSmsDocs(tenantId: string, treeKind?: string, profileId?: string | null): SmsDocRow[] {
  const deleted = getDemoSmsDeletedIds();
  const overrides = getDemoSmsDocOverrides().filter((d) => d.tenant_id === tenantId && !deleted.has(d.id));
  const overrideIds = new Set(overrides.map((d) => d.id));
  const base = DEMO_SMS_DOCS.filter((d) => d.tenant_id === tenantId && !overrideIds.has(d.id) && !deleted.has(d.id));
  let merged = [...base, ...overrides];
  if (treeKind) merged = merged.filter((d) => d.tree_kind === treeKind);
  if (profileId !== undefined) {
    // null profileId means "universal/shared" (profile_id IS NULL) — common baseline docs
    // a specific profileId means docs belonging to that profile OR null (shared docs always visible)
    merged = merged.filter((d) => d.profile_id === null || d.profile_id === profileId);
  }
  return merged;
}

/** Create a new SMS doc node (folder or document) in demo mode. Returns the new node ID. */
export function demoCreateSmsDoc(
  tenantId: string,
  data: { parent_id: string | null; tree_kind: string; label: string; node_kind: 'folder' | 'document'; content_kind: 'rich_text' | 'pdf' | null; content: string | null; profile_id?: string | null; author_name?: string | null; author_role?: string | null; author_origin?: string | null },
): string {
  const overrides = getDemoSmsDocOverrides();
  const newId = `demo-sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  // Determine sort_order as max sibling sort_order + 1
  const siblings = getEffectiveDemoSmsDocs(tenantId, data.tree_kind).filter((d) => d.parent_id === data.parent_id);
  const maxSort = siblings.reduce((mx, d) => Math.max(mx, d.sort_order), 0);
  overrides.push({
    id: newId,
    tenant_id: tenantId,
    parent_id: data.parent_id,
    tree_kind: data.tree_kind as SmsDocRow['tree_kind'],
    label: data.label,
    node_kind: data.node_kind,
    content_kind: data.content_kind,
    content: data.content,
    is_regulatory_header: false,
    approval_state: 'pending_dpa',
    version: '1.0.0',
    sort_order: maxSort + 1,
    profile_id: data.profile_id ?? null,
    author_name: data.author_name ?? null,
    author_role: data.author_role ?? null,
    author_origin: data.author_origin ?? null,
    rejection_comments: null,
    created_at: now,
    updated_at: now,
  });
  saveDemoSmsDocOverrides(overrides);
  return newId;
}

/** Rename an SMS doc node in demo mode (works on overrides or base nodes). */
export function demoRenameSmsDoc(tenantId: string, docId: string, newLabel: string): void {
  const overrides = getDemoSmsDocOverrides();
  const idx = overrides.findIndex((d) => d.id === docId && d.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].label = newLabel;
    overrides[idx].updated_at = now;
    saveDemoSmsDocOverrides(overrides);
  } else {
    const base = DEMO_SMS_DOCS.find((d) => d.id === docId && d.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, label: newLabel, updated_at: now });
      saveDemoSmsDocOverrides(overrides);
    }
  }
}

/** Update an SMS doc's content/content_kind in demo mode (marks pending_dpa for documents). */
export function demoUpdateSmsDocContent(tenantId: string, docId: string, content: string, contentKind: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null): void {
  const overrides = getDemoSmsDocOverrides();
  const idx = overrides.findIndex((d) => d.id === docId && d.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].content = content;
    overrides[idx].content_kind = contentKind;
    overrides[idx].approval_state = 'pending_dpa';
    if (authorName) overrides[idx].author_name = authorName;
    if (authorRole) overrides[idx].author_role = authorRole;
    if (authorOrigin) overrides[idx].author_origin = authorOrigin;
    overrides[idx].updated_at = now;
    saveDemoSmsDocOverrides(overrides);
  } else {
    const base = DEMO_SMS_DOCS.find((d) => d.id === docId && d.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, content, content_kind: contentKind, approval_state: 'pending_dpa', author_name: authorName ?? base.author_name, author_role: authorRole ?? base.author_role, author_origin: authorOrigin ?? base.author_origin, updated_at: now });
      saveDemoSmsDocOverrides(overrides);
    }
  }
}

/** Approve a single SMS doc in demo mode. */
export function demoApproveSmsDoc(tenantId: string, docId: string): void {
  const overrides = getDemoSmsDocOverrides();
  const idx = overrides.findIndex((d) => d.id === docId && d.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].approval_state = 'approved';
    overrides[idx].updated_at = now;
    saveDemoSmsDocOverrides(overrides);
  } else {
    const base = DEMO_SMS_DOCS.find((d) => d.id === docId && d.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, approval_state: 'approved', updated_at: now });
      saveDemoSmsDocOverrides(overrides);
    }
  }
}

/** Approve all pending SMS docs in demo mode for a tenant. */
export function demoApproveAllSmsDocs(tenantId: string): number {
  const all = getEffectiveDemoSmsDocs(tenantId);
  const pending = all.filter((d) => d.approval_state === 'pending_dpa');
  if (pending.length === 0) return 0;
  const overrides = getDemoSmsDocOverrides();
  const now = new Date().toISOString();
  const overrideIds = new Set(overrides.map((d) => d.id));
  for (const p of pending) {
    if (overrideIds.has(p.id)) {
      const idx = overrides.findIndex((d) => d.id === p.id);
      if (idx >= 0) { overrides[idx].approval_state = 'approved'; overrides[idx].updated_at = now; }
    } else {
      overrides.push({ ...p, approval_state: 'approved', updated_at: now });
    }
  }
  saveDemoSmsDocOverrides(overrides);
  return pending.length;
}

/** Reject a pending SMS doc in demo mode — sets state to 'rejected' with optional comments. */
export function demoRejectSmsDoc(tenantId: string, docId: string, comments?: string): void {
  const overrides = getDemoSmsDocOverrides();
  const idx = overrides.findIndex((d) => d.id === docId && d.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].approval_state = 'rejected';
    overrides[idx].rejection_comments = comments ?? null;
    overrides[idx].updated_at = now;
    saveDemoSmsDocOverrides(overrides);
  } else {
    const base = DEMO_SMS_DOCS.find((d) => d.id === docId && d.tenant_id === tenantId);
    if (base) {
      overrides.push({ ...base, approval_state: 'rejected', rejection_comments: comments ?? null, updated_at: now });
      saveDemoSmsDocOverrides(overrides);
    }
  }
}

/** Resubmit a rejected SMS doc in demo mode — sets state back to 'pending_dpa' and optionally updates content. */
export function demoResubmitSmsDoc(tenantId: string, docId: string, content?: string, contentKind?: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null): void {
  const overrides = getDemoSmsDocOverrides();
  const idx = overrides.findIndex((d) => d.id === docId && d.tenant_id === tenantId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    overrides[idx].approval_state = 'pending_dpa';
    overrides[idx].rejection_comments = null;
    if (content !== undefined) overrides[idx].content = content;
    if (contentKind !== undefined) overrides[idx].content_kind = contentKind;
    if (authorName) overrides[idx].author_name = authorName;
    if (authorRole) overrides[idx].author_role = authorRole;
    if (authorOrigin) overrides[idx].author_origin = authorOrigin;
    overrides[idx].updated_at = now;
    saveDemoSmsDocOverrides(overrides);
  } else {
    const base = DEMO_SMS_DOCS.find((d) => d.id === docId && d.tenant_id === tenantId);
    if (base) {
      overrides.push({
        ...base,
        approval_state: 'pending_dpa',
        rejection_comments: null,
        content: content !== undefined ? content : base.content,
        content_kind: contentKind !== undefined ? contentKind : base.content_kind,
        author_name: authorName ?? base.author_name,
        author_role: authorRole ?? base.author_role,
        author_origin: authorOrigin ?? base.author_origin,
        updated_at: now,
      });
      saveDemoSmsDocOverrides(overrides);
    }
  }
}

/** Delete an SMS doc node and all its descendants in demo mode. Returns the count of deleted nodes. */
export function demoDeleteSmsDoc(tenantId: string, docId: string): number {
  const all = getEffectiveDemoSmsDocs(tenantId);
  // Collect the node and all descendants
  const toDelete = new Set<string>([docId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of all) {
      if (d.parent_id && toDelete.has(d.parent_id) && !toDelete.has(d.id)) {
        toDelete.add(d.id);
        changed = true;
      }
    }
  }
  const deleted = getDemoSmsDeletedIds();
  for (const id of toDelete) deleted.add(id);
  saveDemoSmsDeletedIds(deleted);
  // Also remove from overrides
  saveDemoSmsDocOverrides(getDemoSmsDocOverrides().filter((d) => !toDelete.has(d.id)));
  return toDelete.size;
}

// ── Demo custom SMS tabs (localStorage-backed) ──────────────────────────────

const LS_DEMO_SMS_TABS = 'mpc-demo-sms-tabs';

export function getDemoCustomTabs(tenantId: string): Record<string, { key: string; label: string; subtitle: string; custom?: boolean }> {
  try {
    const raw = localStorage.getItem(`${LS_DEMO_SMS_TABS}-${tenantId}`);
    if (raw) return JSON.parse(raw) as Record<string, { key: string; label: string; subtitle: string; custom?: boolean }>;
  } catch { /* ignore */ }
  return {};
}

export function saveDemoCustomTabs(tenantId: string, tabs: Record<string, { key: string; label: string; subtitle: string; custom?: boolean }>): void {
  localStorage.setItem(`${LS_DEMO_SMS_TABS}-${tenantId}`, JSON.stringify(tabs));
}

function buildAuditLogs(tenantId: string, company: string): AuditLogRow[] {
  const prefix = tenantId.slice(0, 6);
  const tenant = getDemoTenant(tenantId);
  const dpaEmail = DEMO_USERS.find((u) => u.tenant_id === tenantId && u.role === 'dpa')?.email ?? 'dpa@example.com';
  const fmEmail = DEMO_USERS.find((u) => u.tenant_id === tenantId && u.role === 'company_admin')?.email ?? 'fm@example.com';
  return [
    { id: `${prefix}-al1`, tenant_id: tenantId, actor_user_id: null, actor_email: fmEmail, category: 'sms', action: `DPA approved: Company Health & Safety Policy Statement (delta v${tenant.sms_version})`, target: 'sms', ip_address: null, location: company, severity: 'warning', created_at: '2026-07-01T09:30:00Z' },
    { id: `${prefix}-al2`, tenant_id: tenantId, actor_user_id: null, actor_email: dpaEmail, category: 'crew', action: `Sign-On: Master on first vessel`, target: 'master', ip_address: null, location: company, severity: 'info', created_at: '2026-06-01T08:00:00Z' },
    { id: `${prefix}-al3`, tenant_id: tenantId, actor_user_id: null, actor_email: fmEmail, category: 'sms', action: `Sync check-in completed`, target: 'vessel', ip_address: null, location: company, severity: 'info', created_at: '2026-07-20T14:30:00Z' },
    { id: `${prefix}-al4`, tenant_id: tenantId, actor_user_id: null, actor_email: dpaEmail, category: 'security', action: 'Account locked: failed login attempts', target: 'user', ip_address: null, location: company, severity: 'warning', created_at: '2026-07-15T16:22:00Z' },
    { id: `${prefix}-al5`, tenant_id: tenantId, actor_user_id: null, actor_email: fmEmail, category: 'crew', action: 'User created: new crew member', target: 'crew', ip_address: null, location: company, severity: 'info', created_at: '2026-07-01T10:00:00Z' },
    { id: `${prefix}-al6`, tenant_id: tenantId, actor_user_id: null, actor_email: dpaEmail, category: 'sms', action: `DPA approved: Bunkering Operations Procedure (delta v${tenant.sms_version})`, target: 'sms', ip_address: null, location: company, severity: 'warning', created_at: '2026-06-15T11:00:00Z' },
    { id: `${prefix}-al7`, tenant_id: tenantId, actor_user_id: null, actor_email: fmEmail, category: 'security', action: 'MFA enforced for all tenant users', target: 'tenant-wide', ip_address: null, location: company, severity: 'warning', created_at: '2026-05-01T09:00:00Z' },
    { id: `${prefix}-al8`, tenant_id: tenantId, actor_user_id: null, actor_email: dpaEmail, category: 'sms', action: 'Document renamed: Fire Emergency Plan', target: 'sms', ip_address: null, location: company, severity: 'info', created_at: '2026-06-28T14:00:00Z' },
    { id: `${prefix}-al9`, tenant_id: tenantId, actor_user_id: null, actor_email: fmEmail, category: 'crew', action: `Vessel profile created`, target: 'vessel', ip_address: null, location: company, severity: 'info', created_at: '2025-04-05T09:30:00Z' },
    { id: `${prefix}-al10`, tenant_id: tenantId, actor_user_id: null, actor_email: dpaEmail, category: 'sms', action: 'Tab created: Cyber Security Guidelines', target: 'custom_cyber', ip_address: null, location: company, severity: 'info', created_at: '2026-05-20T13:00:00Z' },
  ];
}

const _allAuditLogs: AuditLogRow[] = [];
for (const t of DEMO_TENANTS) {
  _allAuditLogs.push(...buildAuditLogs(t.id, t.company));
}
export const DEMO_AUDIT_LOGS: AuditLogRow[] = _allAuditLogs;

export function getDemoAuditLogs(tenantId: string): AuditLogRow[] {
  return DEMO_AUDIT_LOGS.filter((l) => l.tenant_id === tenantId);
}
