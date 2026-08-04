/**
 * Rank-Based RBAC Permission System — Granular Action Model
 *
 * Each platform module has a set of named actions (booleans). Company Admins
 * toggle individual actions per rank in a hierarchical checkbox configurator.
 *
 * App IDs are now 1:1 with Super Admin feature-flag ModuleKeys, so the
 * Permissions Matrix dynamically shows exactly the modules licensed for the
 * tenant by the Super Admin Tenant Feature Matrix.
 *
 * On login, the user's rank_permissions are injected into the auth context
 * (simulating JWT claims) so vessel-side apps can dynamically hide/disable
 * unauthorized navigation items, buttons, and management views.
 */

import { useEffect, useState } from 'react';
import { supabase, type Rank, ALL_RANKS, CORE_RANKS } from './supabase';
import { isDemoMode } from './demoData';
import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from './featureFlags';

// ── Custom Rank Definitions ──────────────────────────────────────────

export interface RankDef {
  rank: string;
  description: string;
  is_custom: boolean;
  created_at?: string;
}

export const DEFAULT_RANK_DESCRIPTIONS: Record<string, string> = {
  Master: 'Full command authority — all apps, all approvals',
  'Chief Engineer': 'Engine department head — engineering + rest hour oversight',
  'Chief Mate': 'Deck department head — cargo + rest hour oversight',
  'Second Engineer': 'Engine officer — own rest hours + operational logs',
  Bosun: 'Deck crew supervisor — own rest hours + deck operations',
  AB: 'Able Seaman — own rest hours + galley view only',
  Oiler: 'Engine room rating — own rest hours + galley view only',
  Cook: 'Chief Cook — galley operations + own rest hours',
  Crew: 'General crew — own rest hours only',
  DPA: 'Designated Person Ashore — SMS oversight and approvals',
};

function defaultRankDefs(): RankDef[] {
  return ALL_RANKS.map((r) => ({
    rank: r,
    description: DEFAULT_RANK_DESCRIPTIONS[r] ?? '',
    is_custom: false,
  }));
}

const LS_DEMO_RANK_DEFS = 'mpc-demo-rank-defs';

function getDemoRankDefs(tenantId: string): RankDef[] {
  try {
    const raw = localStorage.getItem(`${LS_DEMO_RANK_DEFS}-${tenantId}`);
    if (raw) return JSON.parse(raw) as RankDef[];
  } catch { /* ignore */ }
  return defaultRankDefs();
}

function saveDemoRankDefs(tenantId: string, defs: RankDef[]): void {
  localStorage.setItem(`${LS_DEMO_RANK_DEFS}-${tenantId}`, JSON.stringify(defs));
}

export function getDemoCustomRanks(tenantId: string): RankDef[] {
  return getDemoRankDefs(tenantId).filter((d) => d.is_custom);
}

export function demoAddCustomRank(tenantId: string, rank: string, description: string): void {
  const defs = getDemoRankDefs(tenantId);
  if (!defs.some((d) => d.rank === rank)) {
    defs.push({ rank, description, is_custom: true, created_at: new Date().toISOString() });
    saveDemoRankDefs(tenantId, defs);
  }
}

export function demoEditCustomRank(tenantId: string, oldRank: string, newRank: string, description: string): void {
  const defs = getDemoRankDefs(tenantId);
  const idx = defs.findIndex((d) => d.rank === oldRank);
  if (idx >= 0) {
    defs[idx] = { ...defs[idx], rank: newRank, description };
    saveDemoRankDefs(tenantId, defs);
  }
}

export function demoDeleteCustomRank(tenantId: string, rank: string): void {
  const defs = getDemoRankDefs(tenantId).filter((d) => !(d.rank === rank && d.is_custom));
  saveDemoRankDefs(tenantId, defs);
}

export function useRanksForTenant(tenantId: string | null | undefined): {
  ranks: RankDef[];
  loading: boolean;
  refresh: () => void;
} {
  const [ranks, setRanks] = useState<RankDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setRanks([]); setLoading(false); return; }
    if (isDemoMode()) {
      setRanks(getDemoRankDefs(tenantId));
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('tenant_rank_definitions')
        .select('rank, description, is_custom, created_at')
        .eq('tenant_id', tenantId)
        .order('is_custom', { ascending: true })
        .order('rank');
      if (!active) return;
      if (data && data.length > 0) {
        setRanks(data as RankDef[]);
      } else {
        setRanks(defaultRankDefs());
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tenantId, tick]);

  return { ranks, loading: loading, refresh: () => setTick((t) => t + 1) };
}

export async function saveCustomRank(
  tenantId: string,
  rank: string,
  description: string,
): Promise<{ error: string | null }> {
  if (isDemoMode()) {
    demoAddCustomRank(tenantId, rank, description);
    return { error: null };
  }
  const { error } = await supabase.from('tenant_rank_definitions').upsert({
    tenant_id: tenantId,
    rank,
    description,
    is_custom: true,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function updateCustomRank(
  tenantId: string,
  oldRank: string,
  newRank: string,
  description: string,
): Promise<{ error: string | null }> {
  if (isDemoMode()) {
    demoEditCustomRank(tenantId, oldRank, newRank, description);
    return { error: null };
  }
  const { error: delErr } = await supabase
    .from('tenant_rank_definitions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('rank', oldRank);
  if (delErr) return { error: delErr.message };
  const { error: insErr } = await supabase.from('tenant_rank_definitions').upsert({
    tenant_id: tenantId,
    rank: newRank,
    description,
    is_custom: true,
  });
  if (insErr) return { error: insErr.message };
  return { error: null };
}

export async function deleteCustomRank(
  tenantId: string,
  rank: string,
): Promise<{ error: string | null }> {
  if (isDemoMode()) {
    demoDeleteCustomRank(tenantId, rank);
    return { error: null };
  }
  const { error } = await supabase
    .from('tenant_rank_definitions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('rank', rank)
    .eq('is_custom', true);
  if (error) return { error: error.message };
  return { error: null };
}

// ── App IDs are now ModuleKey — 1:1 with Super Admin feature flags ──

export type AppId = ModuleKey;

export const APP_IDS: AppId[] = [...MODULE_KEYS] as AppId[];

export const APP_LABELS: Record<AppId, string> = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, MODULE_LABELS[k].label]),
) as Record<AppId, string>;

/** Returns the modules licensed for the tenant (enabled in Super Admin Feature Matrix). */
export function appsForTenant(enabledModules: Set<ModuleKey>): AppId[] {
  return MODULE_KEYS.filter((m) => enabledModules.has(m)) as AppId[];
}

/** Returns the modules NOT licensed for the tenant — shown as "Unlicensed by Super Admin". */
export function unlicensedApps(enabledModules: Set<ModuleKey>): AppId[] {
  return MODULE_KEYS.filter((m) => !enabledModules.has(m)) as AppId[];
}

// ── Action definitions per module ────────────────────────────────────
// Each action has a key (stored in DB), a human label, and an optional
// `note` (e.g. "Only Master can approve").

export interface ActionDef {
  key: string;
  label: string;
  note?: string;
}

function genericActions(): ActionDef[] {
  return [
    { key: 'view', label: 'View Records' },
    { key: 'edit', label: 'Edit / Create Records' },
    { key: 'approve', label: 'Approve / Sign Off', note: 'Typically Master / DPA only' },
    { key: 'manage', label: 'Manage Configuration', note: 'Administrative control' },
  ];
}

export const APP_ACTIONS: Record<AppId, ActionDef[]> = {
  sms_documentation: [
    { key: 'view', label: 'View SMS Documents' },
    { key: 'search', label: 'Search & Filter Manuals' },
    { key: 'print', label: 'Print Manuals' },
    { key: 'edit', label: 'Edit SMS Documents', note: 'DPA / shoreside only' },
    { key: 'upload', label: 'Upload New Documents', note: 'DPA / shoreside only' },
    { key: 'approve', label: 'Approve SMS Revisions', note: 'DPA only' },
  ],
  rest_hours: [
    { key: 'view_own', label: 'View Own Work/Rest Hours' },
    { key: 'log_own', label: 'Log Own Work/Rest Hours' },
    { key: 'view_others', label: 'View Other Crew Hours' },
    { key: 'edit_others', label: 'Edit Other Crew Hours', note: 'Typically officers only' },
    { key: 'approve_others', label: 'Approve Rest Hour Compliance', note: 'Typically Master / Chief Mate only' },
  ],
  haccp_galley: [
    { key: 'view_inventory', label: 'View Inventory & Stores' },
    { key: 'log_daily_meals', label: 'Log Daily Meals' },
    { key: 'draft_requisitions', label: 'Draft Food Requisitions' },
    { key: 'approve_food_orders', label: 'Approve Food Orders', note: 'Typically Master only' },
    { key: 'manage_stores', label: 'Manage Stores & Suppliers' },
  ],
  certification_manager: [
    { key: 'view', label: 'View Certificates' },
    { key: 'add', label: 'Add New Certificates' },
    { key: 'edit', label: 'Edit Certificate Details' },
    { key: 'revoke', label: 'Revoke Certificates', note: 'DPA / Master only' },
    { key: 'verify', label: 'Verify Certificate Compliance', note: 'DPA only' },
  ],
  satellite_sync: genericActions(),
  voyage_logging: genericActions(),
  crew_matrix: genericActions(),
  electronic_logbooks: genericActions(),
  advanced_analytics: [
    { key: 'view', label: 'View Dashboards & Reports' },
    { key: 'export', label: 'Export Reports' },
    { key: 'configure', label: 'Configure KPIs & Alerts', note: 'Administrative control' },
  ],
  risk_assessment: [
    { key: 'view', label: 'View Risk Assessments' },
    { key: 'edit', label: 'Create / Edit Assessments' },
    { key: 'approve', label: 'Approve Risk Assessments', note: 'Master / DPA only' },
    { key: 'close', label: 'Close Out Assessments', note: 'Master / DPA only' },
  ],
};

// ── Types ────────────────────────────────────────────────────────────

export type ActionMap = Record<string, boolean>;

export interface AppPermission {
  visible: boolean;
  actions: ActionMap;
}

export type RankPermissionMap = Partial<Record<AppId, AppPermission>>;

export interface RankPermissionRow {
  id: string;
  tenant_id: string;
  rank: string;
  apps: RankPermissionMap;
  updated_by: string | null;
  updated_at: string;
}

// ── Action presets per module (for quick-set buttons) ────────────────

export interface ActionPreset {
  label: string;
  actions: ActionMap;
}

function genericPresets(): ActionPreset[] {
  return [
    { label: 'Full Access', actions: { view: true, edit: true, approve: true, manage: true } },
    { label: 'Edit All', actions: { view: true, edit: true, approve: false, manage: false } },
    { label: 'View Only', actions: { view: true, edit: false, approve: false, manage: false } },
    { label: 'Hidden', actions: { view: false, edit: false, approve: false, manage: false } },
  ];
}

export const APP_PRESETS: Record<AppId, ActionPreset[]> = {
  sms_documentation: [
    { label: 'Full Access', actions: { view: true, search: true, print: true, edit: true, upload: true, approve: true } },
    { label: 'View Only', actions: { view: true, search: true, print: true, edit: false, upload: false, approve: false } },
    { label: 'Hidden', actions: { view: false, search: false, print: false, edit: false, upload: false, approve: false } },
  ],
  rest_hours: [
    { label: 'Approve All', actions: { view_own: true, log_own: true, view_others: true, edit_others: true, approve_others: true } },
    { label: 'Edit All', actions: { view_own: true, log_own: true, view_others: true, edit_others: true, approve_others: false } },
    { label: 'Own Log Only', actions: { view_own: true, log_own: true, view_others: false, edit_others: false, approve_others: false } },
    { label: 'Hidden', actions: { view_own: false, log_own: false, view_others: false, edit_others: false, approve_others: false } },
  ],
  haccp_galley: [
    { label: 'Full Admin', actions: { view_inventory: true, log_daily_meals: true, draft_requisitions: true, approve_food_orders: true, manage_stores: true } },
    { label: 'Cook Operational', actions: { view_inventory: true, log_daily_meals: true, draft_requisitions: true, approve_food_orders: false, manage_stores: false } },
    { label: 'View Menu Only', actions: { view_inventory: true, log_daily_meals: false, draft_requisitions: false, approve_food_orders: false, manage_stores: false } },
    { label: 'Hidden', actions: { view_inventory: false, log_daily_meals: false, draft_requisitions: false, approve_food_orders: false, manage_stores: false } },
  ],
  certification_manager: [
    { label: 'Full Admin', actions: { view: true, add: true, edit: true, revoke: true, verify: true } },
    { label: 'View Only', actions: { view: true, add: false, edit: false, revoke: false, verify: false } },
    { label: 'Hidden', actions: { view: false, add: false, edit: false, revoke: false, verify: false } },
  ],
  satellite_sync: genericPresets(),
  voyage_logging: genericPresets(),
  crew_matrix: genericPresets(),
  electronic_logbooks: genericPresets(),
  advanced_analytics: [
    { label: 'Full Access', actions: { view: true, export: true, configure: true } },
    { label: 'View & Export', actions: { view: true, export: true, configure: false } },
    { label: 'View Only', actions: { view: true, export: false, configure: false } },
    { label: 'Hidden', actions: { view: false, export: false, configure: false } },
  ],
  risk_assessment: [
    { label: 'Full Access', actions: { view: true, edit: true, approve: true, close: true } },
    { label: 'Edit All', actions: { view: true, edit: true, approve: false, close: false } },
    { label: 'View Only', actions: { view: true, edit: false, approve: false, close: false } },
    { label: 'Hidden', actions: { view: false, edit: false, approve: false, close: false } },
  ],
};

// ── Empty action map helper ──────────────────────────────────────────

export function emptyActionsFor(app: AppId): ActionMap {
  const map: ActionMap = {};
  for (const a of APP_ACTIONS[app]) map[a.key] = false;
  return map;
}

export function allTrueActionsFor(app: AppId): ActionMap {
  const map: ActionMap = {};
  for (const a of APP_ACTIONS[app]) map[a.key] = true;
  return map;
}

// ── Default permissions per rank ─────────────────────────────────────

function preset(app: AppId, presetLabel: string): AppPermission {
  const p = APP_PRESETS[app].find((x) => x.label === presetLabel)!;
  return { visible: presetLabel !== 'Hidden', actions: { ...p.actions } };
}

/** Generate a "Full Access" permission for a module. */
function fullAccess(app: AppId): AppPermission {
  return { visible: true, actions: allTrueActionsFor(app) };
}

/** Generate a "View Only" permission for a module. */
function viewOnly(app: AppId): AppPermission {
  const actions = emptyActionsFor(app);
  const firstAction = APP_ACTIONS[app][0];
  if (firstAction) actions[firstAction.key] = true;
  return { visible: true, actions };
}

/** Generate a "Hidden" permission for a module. */
function hidden(app: AppId): AppPermission {
  return { visible: false, actions: emptyActionsFor(app) };
}

/** Build a full default permission map for a rank from a recipe. */
function buildRank(
  recipe: Partial<Record<AppId, 'full' | 'view' | 'hidden'>>,
): RankPermissionMap {
  const map: RankPermissionMap = {};
  for (const app of MODULE_KEYS) {
    const level = recipe[app];
    if (level === 'full') map[app] = fullAccess(app);
    else if (level === 'view') map[app] = viewOnly(app);
    else map[app] = hidden(app);
  }
  return map;
}

export const DEFAULT_RANK_PERMISSIONS: Record<string, RankPermissionMap> = {
  Master: buildRank({
    sms_documentation: 'full',
    rest_hours: 'full',
    haccp_galley: 'full',
    certification_manager: 'full',
    satellite_sync: 'full',
    voyage_logging: 'full',
    crew_matrix: 'full',
    electronic_logbooks: 'full',
    advanced_analytics: 'full',
    risk_assessment: 'full',
  }),
  'Chief Engineer': buildRank({
    sms_documentation: 'view',
    rest_hours: 'full',
    haccp_galley: 'view',
    certification_manager: 'view',
    satellite_sync: 'view',
    voyage_logging: 'view',
    crew_matrix: 'view',
    electronic_logbooks: 'full',
    advanced_analytics: 'view',
    risk_assessment: 'view',
  }),
  'Chief Mate': buildRank({
    sms_documentation: 'view',
    rest_hours: 'full',
    haccp_galley: 'view',
    certification_manager: 'view',
    satellite_sync: 'view',
    voyage_logging: 'full',
    crew_matrix: 'view',
    electronic_logbooks: 'view',
    advanced_analytics: 'view',
    risk_assessment: 'view',
  }),
  'Second Engineer': buildRank({
    rest_hours: 'view',
    electronic_logbooks: 'view',
  }),
  Bosun: buildRank({
    rest_hours: 'view',
  }),
  AB: buildRank({
    rest_hours: 'view',
    haccp_galley: 'view',
  }),
  Oiler: buildRank({
    rest_hours: 'view',
    haccp_galley: 'view',
  }),
  Cook: buildRank({
    rest_hours: 'view',
    haccp_galley: 'full',
  }),
  Crew: buildRank({
    rest_hours: 'view',
  }),
  DPA: buildRank({
    sms_documentation: 'full',
    certification_manager: 'view',
    risk_assessment: 'view',
    advanced_analytics: 'view',
  }),
};

// ── Demo-mode storage ────────────────────────────────────────────────

const LS_DEMO_RANK_PERMS = 'mpc-demo-rank-permissions';

function getDemoRankPerms(tenantId: string): Record<string, RankPermissionMap> {
  try {
    const raw = localStorage.getItem(LS_DEMO_RANK_PERMS);
    if (raw) {
      const all = JSON.parse(raw) as Record<string, Record<string, RankPermissionMap>>;
      return all[tenantId] ?? {};
    }
  } catch { /* ignore */ }
  return {};
}

function setDemoRankPerms(tenantId: string, rank: string, perms: RankPermissionMap): void {
  try {
    let all: Record<string, Record<string, RankPermissionMap>> = {};
    const raw = localStorage.getItem(LS_DEMO_RANK_PERMS);
    if (raw) all = JSON.parse(raw);
    if (!all[tenantId]) all[tenantId] = {};
    all[tenantId][rank] = perms;
    localStorage.setItem(LS_DEMO_RANK_PERMS, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ── Normalize: fill missing actions with false, merge defaults ───────

function normalizePerms(perms: RankPermissionMap | null | undefined): RankPermissionMap {
  const result: RankPermissionMap = {};
  for (const app of MODULE_KEYS) {
    const existing = perms?.[app];
    if (existing) {
      const actions: ActionMap = {};
      for (const def of APP_ACTIONS[app]) {
        actions[def.key] = existing.actions?.[def.key] ?? false;
      }
      result[app] = { visible: existing.visible ?? false, actions };
    } else {
      result[app] = { visible: false, actions: emptyActionsFor(app) };
    }
  }
  return result;
}

// ── Hook: load all rank permissions for a tenant ─────────────────────

export function useRankPermissions(tenantId: string | null | undefined): {
  permissions: Record<string, RankPermissionMap>;
  loading: boolean;
  refresh: () => void;
} {
  const [permissions, setPermissions] = useState<Record<string, RankPermissionMap>>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setPermissions({}); setLoading(false); return; }

    if (isDemoMode()) {
      const demoPerms = getDemoRankPerms(tenantId);
      const map: Record<string, RankPermissionMap> = {};
      for (const rank of Object.keys(DEFAULT_RANK_PERMISSIONS)) {
        map[rank] = demoPerms[rank]
          ? normalizePerms(demoPerms[rank])
          : normalizePerms(DEFAULT_RANK_PERMISSIONS[rank]);
      }
      setPermissions(map);
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      const { data } = await supabase
        .from('rank_permissions')
        .select('rank, apps')
        .eq('tenant_id', tenantId);

      if (!active) return;
      const map: Record<string, RankPermissionMap> = {};
      for (const row of (data ?? []) as { rank: string; apps: RankPermissionMap }[]) {
        map[row.rank] = normalizePerms(row.apps);
      }
      for (const rank of Object.keys(DEFAULT_RANK_PERMISSIONS)) {
        if (!map[rank]) map[rank] = normalizePerms(DEFAULT_RANK_PERMISSIONS[rank]);
      }
      setPermissions(map);
      setLoading(false);
    })();

    return () => { active = false; };
  }, [tenantId, tick]);

  const refresh = () => setTick((t) => t + 1);

  return { permissions, loading, refresh };
}

// ── Hook: load a single rank's permissions (for vessel-side SSO) ─────

export function usePermissionsForRank(
  tenantId: string | null | undefined,
  rank: Rank | null | undefined,
): RankPermissionMap | null {
  const { permissions } = useRankPermissions(tenantId);
  if (!rank) return null;
  return permissions[rank] ?? normalizePerms(DEFAULT_RANK_PERMISSIONS[rank]) ?? null;
}

// ── Save a single rank's permissions ─────────────────────────────────

export async function saveRankPermission(
  tenantId: string,
  rank: string,
  perms: RankPermissionMap,
): Promise<{ error: string | null }> {
  if (isDemoMode()) {
    setDemoRankPerms(tenantId, rank, perms);
    return { error: null };
  }

  const { error } = await supabase.rpc('upsert_rank_permission', {
    p_tenant_id: tenantId,
    p_rank: rank,
    p_apps: perms as Record<string, unknown>,
  });

  if (error) return { error: error.message };
  return { error: null };
}

// ── Permission helpers (consumed by vessel-side apps) ────────────────

export function isAppVisible(perms: RankPermissionMap | null, app: AppId): boolean {
  return perms?.[app]?.visible ?? false;
}

export function canDo(
  perms: RankPermissionMap | null,
  app: AppId,
  actionKey: string,
): boolean {
  const appPerm = perms?.[app];
  if (!appPerm || !appPerm.visible) return false;
  return appPerm.actions?.[actionKey] ?? false;
}

export function getAppActions(perms: RankPermissionMap | null, app: AppId): ActionMap {
  return perms?.[app]?.actions ?? emptyActionsFor(app);
}

// ── Crew registration status ─────────────────────────────────────────

export const CREW_STATUS = {
  PENDING_SIGN_ON: 'pending_sign_on',
  ACTIVE: 'active',
  INVITED: 'invited',
  LOCKED: 'locked',
  INACTIVE: 'inactive',
} as const;

export function canAuthenticate(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === 'active' || status === 'invited';
}

export { CORE_RANKS };
