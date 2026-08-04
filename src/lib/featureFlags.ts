/**
 * Feature flags system — per-tenant module enablement.
 * Fetches from the tenant_feature_flags table, gated by tenant_id.
 * If a flag is not found for a tenant, the feature is treated as disabled.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import {
  isDemoMode,
  getDemoFeatureFlags,
  getDemoFeatureFlagsForTenant,
  demoSetFeatureFlag,
  getDemoSyncConfigForTenant,
  demoSetSyncConfig,
  getDemoModuleDef,
  getDemoModuleDefs,
  demoSetModuleDef,
} from './demoData';
import { postSyncEvent, onSyncEvent, type SyncEvent } from './syncChannel';

/** All platform modules that can be toggled per tenant. */
export const MODULE_KEYS = [
  'sms_documentation',
  'rest_hours',
  'haccp_galley',
  'certification_manager',
  'satellite_sync',
  'voyage_logging',
  'crew_matrix',
  'electronic_logbooks',
  'advanced_analytics',
  'risk_assessment',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, { label: string; description: string; icon: string }> = {
  sms_documentation: { label: 'SMS Documentation', description: 'Safety Management System manuals, procedures, and policies', icon: 'FileCheck2' },
  rest_hours: { label: 'Rest Hours Engine', description: 'MLC-compliant rest hour tracking and fatigue management', icon: 'Clock' },
  haccp_galley: { label: 'HACCP / Galley', description: 'Food safety, galley inspections, and HACCP compliance', icon: 'UtensilsCrossed' },
  certification_manager: { label: 'Certification Manager', description: 'Crew certification, vessel certificates, and expiry tracking', icon: 'Award' },
  satellite_sync: { label: 'Satellite Sync', description: 'Priority satellite data synchronization and queue management', icon: 'SatelliteDish' },
  voyage_logging: { label: 'Voyage Logging', description: 'Voyage data recording and port arrival/departure logs', icon: 'Navigation' },
  crew_matrix: { label: 'Crew Matrix', description: 'Crew competency matrices and familiarization tracking', icon: 'Users' },
  electronic_logbooks: { label: 'Electronic Logbooks', description: 'Digital oil record, garbage, and cargo logbooks', icon: 'BookOpen' },
  advanced_analytics: { label: 'Advanced Analytics', description: 'Fleet performance analytics and trend dashboards', icon: 'BarChart3' },
  risk_assessment: { label: 'Risk Assessment', description: 'Operational risk assessments and mitigation tracking', icon: 'ShieldAlert' },
};

/** Modules that have fully built views and are clickable in the launchpad.
 * Other enabled modules show as "Coming Soon" — they're feature-flagged but
 * their UI hasn't been built yet. */
export const LIVE_MODULES: ModuleKey[] = [
  'sms_documentation',
];

/** Internal core modules excluded from the pluggable module launchpad grid.
 * These are always-accessible features surfaced via dedicated sidebar
 * navigation (e.g. Crew & User Directory), not as platform module tiles.
 * They remain in MODULE_KEYS and TOGGLEABLE_MODULE_KEYS so the Super Admin
 * Feature Matrix can still toggle them — they just don't appear as tiles. */
export const LAUNCHPAD_EXCLUDED: ReadonlySet<ModuleKey> = new Set<ModuleKey>([
  'crew_matrix',
]);

/** Modules enabled by default for new tenants (all modules on by default).
 * Used by the Feature Matrix to set initial toggle state. */
export const DEFAULT_ENABLED_MODULES: ModuleKey[] = MODULE_KEYS.slice();

/** Module keys shown as toggleable columns in the Super Admin Feature Matrix.
 * 1:1 parity with MODULE_KEYS — every registered module is toggleable, including
 * satellite_sync, so Super Admin can enable/disable it per tenant. */
export const TOGGLEABLE_MODULE_KEYS: ModuleKey[] = MODULE_KEYS.slice();

export interface FeatureFlagRow {
  id: string;
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  custom_config: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: string;
}

export interface SyncConfigRow {
  id: string;
  tenant_id: string;
  auto_sync_interval_hours: number;
  manual_replicate_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** In-memory cache so multiple components sharing a tenant see the same flags. */
let flagCache: Map<string, Set<ModuleKey>> = new Map();
let syncConfigCache: Map<string, SyncConfigRow> = new Map();

/** Module definitions cache — platform-wide custom display names. */
export interface ModuleDefinitionRow {
  id: string;
  feature_key: ModuleKey;
  display_name: string;
  description: string | null;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
}
let moduleDefCache: Map<ModuleKey, ModuleDefinitionRow> | null = null;

/** Callbacks notified whenever any tenant's flags change (realtime or manual). */
const flagListeners = new Set<(tenantId: string) => void>();

/** Callbacks notified whenever module definitions change (realtime or manual). */
const moduleDefListeners = new Set<() => void>();

/** Register a listener that fires when feature flags change for any tenant. */
export function onFeatureFlagsChanged(cb: (tenantId: string) => void): () => void {
  flagListeners.add(cb);
  return () => { flagListeners.delete(cb); };
}

/** Cross-window sync: when another tab broadcasts FEATURE_FLAGS_CHANGED,
 * invalidate cache and notify local listeners so hooks re-fetch. */
if (typeof window !== 'undefined') {
  onSyncEvent((evt: SyncEvent) => {
    if (evt.type === 'FEATURE_FLAGS_CHANGED' && evt.tenantId) {
      flagCache.delete(evt.tenantId);
      syncConfigCache.delete(evt.tenantId);
      notifyFlagChange(evt.tenantId);
    }
  });
}

function notifyFlagChange(tenantId: string) {
  flagListeners.forEach((cb) => cb(tenantId));
}

function notifyModuleDefChange() {
  moduleDefListeners.forEach((cb) => cb());
}

/** Fetch all enabled feature keys for a tenant. */
export async function fetchEnabledFeatures(tenantId: string): Promise<Set<ModuleKey>> {
  if (isDemoMode()) {
    // Read from localStorage demo store. Any module key explicitly set
    // FALSE is excluded; any not present defaults to enabled.
    const overrides = getDemoFeatureFlagsForTenant(tenantId);
    const enabled = new Set<ModuleKey>();
    for (const k of MODULE_KEYS) {
      const explicit = overrides.get(k);
      if (explicit === false) continue; // explicitly disabled
      enabled.add(k);
    }
    return enabled;
  }
  const cached = flagCache.get(tenantId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('tenant_feature_flags')
    .select('feature_key, enabled')
    .eq('tenant_id', tenantId)
    .eq('enabled', true);

  if (error) {
    const fallback = new Set<ModuleKey>();
    flagCache.set(tenantId, fallback);
    return fallback;
  }

  const enabled = new Set<ModuleKey>(
    (data ?? []).map((r) => r.feature_key as ModuleKey)
  );
  flagCache.set(tenantId, enabled);
  return enabled;
}

/** Fetch the sync config for a tenant, falling back to 6-hour default. */
export async function fetchSyncConfig(tenantId: string): Promise<SyncConfigRow> {
  const defaultConfig: SyncConfigRow = {
    id: 'default',
    tenant_id: tenantId,
    auto_sync_interval_hours: 6,
    manual_replicate_enabled: true,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };

  if (isDemoMode()) {
    const stored = getDemoSyncConfigForTenant(tenantId);
    if (stored) {
      return {
        ...defaultConfig,
        auto_sync_interval_hours: stored.auto_sync_interval_hours,
        manual_replicate_enabled: stored.manual_replicate_enabled,
        updated_by: stored.updated_by,
        updated_at: stored.updated_at,
      };
    }
    return defaultConfig;
  }

  const cached = syncConfigCache.get(tenantId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('tenant_sync_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) {
    return defaultConfig;
  }

  syncConfigCache.set(tenantId, data as SyncConfigRow);
  return data as SyncConfigRow;
}

/** Super-admin: fetch all feature flags for ALL tenants (for the Feature Matrix view). */
export async function fetchAllFeatureFlags(): Promise<FeatureFlagRow[]> {
  if (isDemoMode()) {
    // Read from localStorage demo store and shape as FeatureFlagRow[] so the
    // Feature Matrix load() can consume them with the same code path.
    const entries = getDemoFeatureFlags();
    return entries.map((e, i) => ({
      id: `demo-${i}`,
      tenant_id: e.tenant_id,
      feature_key: e.feature_key,
      enabled: e.enabled,
      custom_config: null,
      updated_by: e.updated_by,
      updated_at: e.updated_at,
    }));
  }
  const { data, error } = await supabase
    .from('tenant_feature_flags')
    .select('*')
    .order('tenant_id')
    .order('feature_key');

  if (error || !data) return [];
  return data as FeatureFlagRow[];
}

/** Super-admin: set a feature flag for a tenant.
 * Returns true only when the row is confirmed written to the database.
 * Detects silent RLS rejection (no error but no data) which Supabase
 * returns when row-level security blocks the write. */
export async function setFeatureFlag(
  tenantId: string,
  featureKey: ModuleKey,
  enabled: boolean,
  updatedBy: string
): Promise<boolean> {
  if (isDemoMode()) {
    demoSetFeatureFlag(tenantId, featureKey, enabled, updatedBy);
    notifyFlagChange(tenantId);
    // Broadcast to other windows (Company Admin, Vessel Portal) so they re-fetch
    postSyncEvent({ type: 'FEATURE_FLAGS_CHANGED', tenantId, payload: { tenantId, featureKey, enabled } });
    return true;
  }

  const { data, error } = await supabase
    .from('tenant_feature_flags')
    .upsert(
      { tenant_id: tenantId, feature_key: featureKey, enabled, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,feature_key' }
    )
    .select()
    .maybeSingle();

  if (error || !data) return false;

  flagCache.delete(tenantId);
  notifyFlagChange(tenantId);
  return true;
}

/** Super-admin: set sync interval for a tenant. */
export async function setSyncConfig(
  tenantId: string,
  intervalHours: number,
  manualReplicateEnabled: boolean,
  updatedBy: string
): Promise<boolean> {
  if (isDemoMode()) {
    demoSetSyncConfig(tenantId, intervalHours, manualReplicateEnabled, updatedBy);
    notifyFlagChange(tenantId);
    return true;
  }

  const { data, error } = await supabase
    .from('tenant_sync_config')
    .upsert(
      {
        tenant_id: tenantId,
        auto_sync_interval_hours: intervalHours,
        manual_replicate_enabled: manualReplicateEnabled,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    )
    .select()
    .maybeSingle();

  // Detect silent RLS rejection: no error but no data returned means the
  // upsert was blocked by row-level security (Supabase returns null data).
  if (error || !data) return false;

  syncConfigCache.set(tenantId, data as SyncConfigRow);
  notifyFlagChange(tenantId);
  return true;
}

/** Clear in-memory caches (used on sign-out). */
export function clearFeatureFlagCache(): void {
  flagCache = new Map();
  syncConfigCache = new Map();
  moduleDefCache = null;
}

/** Supabase realtime channel for feature flags + module definitions. Shared singleton. */
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeStarted = false;

/** Start a global Supabase realtime subscription that listens for changes to
 * tenant_feature_flags, tenant_sync_config, and module_definitions — invalidating
 * caches and notifying all mounted hooks so all three role views stay in sync.
 * Safe to call multiple times — only starts one channel. */
export function startFeatureFlagRealtime(): void {
  if (realtimeStarted || isDemoMode()) return;
  realtimeStarted = true;

  realtimeChannel = supabase
    .channel('tenant_feature_flags_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tenant_feature_flags' },
      (payload) => {
        const row = payload.new as FeatureFlagRow | undefined;
        if (row?.tenant_id) {
          flagCache.delete(row.tenant_id);
          notifyFlagChange(row.tenant_id);
        }
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tenant_sync_config' },
      (payload) => {
        const row = payload.new as SyncConfigRow | undefined;
        if (row?.tenant_id) {
          syncConfigCache.delete(row.tenant_id);
          notifyFlagChange(row.tenant_id);
        }
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'module_definitions' },
      () => {
        moduleDefCache = null;
        notifyModuleDefChange();
      },
    )
    .subscribe();
}

/** Stop the realtime subscription (used on sign-out). */
export function stopFeatureFlagRealtime(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeStarted = false;
}

/**
 * React hook: subscribe to feature flags for the current tenant.
 * Fetches on mount and re-fetches when notified of realtime changes.
 * Returns { flags: Set<ModuleKey>, loading: boolean, isEnabled(key): boolean }.
 */
export function useFeatureFlags(tenantId: string | null | undefined) {
  const [flags, setFlags] = useState<Set<ModuleKey>>(new Set<ModuleKey>());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const refresh = () => {
      // Force re-fetch by bypassing cache
      flagCache.delete(tenantId);
      fetchEnabledFeatures(tenantId).then((f) => {
        if (mounted) { setFlags(f); setLoading(false); }
      });
    };

    // Initial fetch
    refresh();

    // Subscribe to realtime changes for this tenant
    const unsub = onFeatureFlagsChanged((changedTenantId) => {
      if (changedTenantId === tenantId) refresh();
    });

    return () => { mounted = false; unsub(); };
  }, [tenantId]);

  const isEnabled = useCallback(
    (key: ModuleKey): boolean => flags.has(key),
    [flags]
  );

  return { flags, loading, isEnabled };
}

/** React hook: subscribe to sync config for the current tenant with
 * realtime updates. When Super Admin changes the sync interval or manual
 * replicate setting, this hook re-fetches and the vessel UI updates instantly. */
export function useSyncConfig(tenantId: string | null | undefined) {
  const [config, setConfig] = useState<SyncConfigRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const refresh = () => {
      syncConfigCache.delete(tenantId);
      fetchSyncConfig(tenantId).then((c) => {
        if (mounted) { setConfig(c); setLoading(false); }
      });
    };

    refresh();

    const unsub = onFeatureFlagsChanged((changedTenantId) => {
      if (changedTenantId === tenantId) refresh();
    });

    return () => { mounted = false; unsub(); };
  }, [tenantId]);

  return { config, loading };
}

// ── Module Definitions (platform-wide custom display names) ───────────

/** Fetch all module definitions, falling back to hardcoded defaults. */
export async function fetchModuleDefinitions(): Promise<Map<ModuleKey, ModuleDefinitionRow>> {
  if (isDemoMode()) {
    const map = new Map<ModuleKey, ModuleDefinitionRow>();
    const overrides = getDemoModuleDefs();
    MODULE_KEYS.forEach((k, i) => {
      const override = overrides.find((d) => d.feature_key === k);
      map.set(k, {
        id: k,
        feature_key: k,
        display_name: override?.display_name ?? MODULE_LABELS[k].label,
        description: MODULE_LABELS[k].description,
        sort_order: i + 1,
        updated_by: override?.updated_by ?? null,
        updated_at: override?.updated_at ?? new Date().toISOString(),
      });
    });
    return map;
  }
  if (moduleDefCache) return moduleDefCache;

  const { data, error } = await supabase
    .from('module_definitions')
    .select('*')
    .order('sort_order');

  const map = new Map<ModuleKey, ModuleDefinitionRow>();
  if (!error && data) {
    for (const row of data as ModuleDefinitionRow[]) {
      map.set(row.feature_key as ModuleKey, row);
    }
  }
  // Fill any missing keys with hardcoded defaults
  MODULE_KEYS.forEach((k, i) => {
    if (!map.has(k)) {
      map.set(k, {
        id: k,
        feature_key: k,
        display_name: MODULE_LABELS[k].label,
        description: MODULE_LABELS[k].description,
        sort_order: i + 1,
        updated_by: null,
        updated_at: new Date().toISOString(),
      });
    }
  });
  moduleDefCache = map;
  return map;
}

/** Super-admin: update a module definition's display name. */
export async function setModuleDisplayName(
  featureKey: ModuleKey,
  displayName: string,
  updatedBy: string,
): Promise<boolean> {
  if (isDemoMode()) {
    demoSetModuleDef(featureKey, displayName, updatedBy);
    moduleDefCache = null;
    notifyModuleDefChange();
    return true;
  }
  const { error } = await supabase
    .from('module_definitions')
    .upsert(
      { feature_key: featureKey, display_name: displayName, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'feature_key' },
    );
  if (error) return false;
  moduleDefCache = null;
  notifyModuleDefChange();
  return true;
}

/** Get the display name for a single module key, falling back to the hardcoded default. */
export function getDisplayName(
  key: ModuleKey,
  defs: Map<ModuleKey, ModuleDefinitionRow> | null,
): string {
  return defs?.get(key)?.display_name ?? MODULE_LABELS[key].label;
}

/**
 * React hook: subscribe to module definitions with realtime updates.
 * When Super Admin renames a module, every mounted component using this
 * hook re-fetches and re-renders with the new display name instantly.
 */
export function useModuleDefinitions() {
  const [defs, setDefs] = useState<Map<ModuleKey, ModuleDefinitionRow> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      moduleDefCache = null;
      fetchModuleDefinitions().then((m) => {
        if (mounted) { setDefs(m); setLoading(false); }
      });
    };
    refresh();
    const unsub = onModuleDefinitionsChanged(refresh);
    return () => { mounted = false; unsub(); };
  }, []);

  return { defs, loading };
}

/** Register a listener that fires when module definitions change. */
export function onModuleDefinitionsChanged(cb: () => void): () => void {
  moduleDefListeners.add(cb);
  return () => { moduleDefListeners.delete(cb); };
}
