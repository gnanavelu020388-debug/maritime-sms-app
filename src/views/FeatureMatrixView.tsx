/**
 * FeatureMatrixView — Super Admin panel for per-tenant module enablement
 * and sync configuration. Shows a matrix of all modules × all tenants
 * with toggle switches, plus sync interval controls per tenant.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Grid3x3, RefreshCw, Save, CheckCircle2, XCircle, Loader2, Zap,
  Search, Clock, AlertTriangle, Pencil, Check,
} from 'lucide-react';
import type { Capabilities } from '../lib/permissions';
import { useStore } from '../store';
import { SUPER_ADMIN_NAME } from '../constants';
import {
  MODULE_KEYS, TOGGLEABLE_MODULE_KEYS, MODULE_LABELS, LIVE_MODULES, DEFAULT_ENABLED_MODULES,
  fetchAllFeatureFlags, setFeatureFlag, setSyncConfig,
  useModuleDefinitions, setModuleDisplayName, getDisplayName,
  type ModuleKey, type FeatureFlagRow,
} from '../lib/featureFlags';
import { isDemoMode, getDemoFeatureFlagsForTenant, getDemoSyncConfigForTenant } from '../lib/demoData';
import { supabase, type TenantRow } from '../lib/supabase';

interface FlagMap {
  [tenantId: string]: { [key in ModuleKey]?: boolean };
}

interface SyncConfigState {
  intervalHours: number;
  manualReplicate: boolean;
}

const SYNC_PRESETS = [2, 4, 6, 8, 12, 24];

export function FeatureMatrixView({ caps }: { caps: Capabilities }) {
  const { tenants: mockTenants, dispatch } = useStore();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [flags, setFlags] = useState<FlagMap>({});
  const [syncStates, setSyncStates] = useState<Record<string, SyncConfigState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingHeader, setEditingHeader] = useState<ModuleKey | null>(null);
  const [headerDraft, setHeaderDraft] = useState('');
  const [savingHeader, setSavingHeader] = useState<ModuleKey | null>(null);

  const { defs } = useModuleDefinitions();

  const canEdit = caps.featureFlagEdit;

  const load = useCallback(async () => {
    setLoading(true);
    if (isDemoMode()) {
      const demoTenants = mockTenants
        .filter((t) => t.status !== 'archived')
        .map((t) => ({
          id: t.demoTenantId ?? t.id,
          company: t.company,
          contact_email: t.contactEmail,
          plan: t.plan,
          status: t.status,
          vessels_max: t.vessels.max,
          seats_max: t.seats.max,
          storage_gb_max: t.storageGb.max,
          monthly_revenue: t.monthlyRevenue,
          region: t.region,
          mfa_enforced: t.mfaEnforced,
          modules: t.modules,
          sms_version: 'v1.0.0',
          created_at: t.createdAt,
          contract_expires: t.contractExpires,
          updated_at: new Date().toISOString(),
        })) as unknown as TenantRow[];
      setTenants(demoTenants);
      const f: FlagMap = {};
      const s: Record<string, SyncConfigState> = {};
      demoTenants.forEach((t) => {
        // Read from the persistent demo store so toggles survive navigation.
        const overrides = getDemoFeatureFlagsForTenant(t.id);
        f[t.id] = {} as FlagMap[string];
        MODULE_KEYS.forEach((k) => {
          const explicit = overrides.get(k);
          f[t.id][k] = explicit === false ? false : DEFAULT_ENABLED_MODULES.includes(k);
        });
        const sc = getDemoSyncConfigForTenant(t.id);
        s[t.id] = {
          intervalHours: sc?.auto_sync_interval_hours ?? 6,
          manualReplicate: sc?.manual_replicate_enabled ?? true,
        };
      });
      setFlags(f);
      setSyncStates(s);
      setLoading(false);
      return;
    }

    const [{ data: tenantData }, flagRows] = await Promise.all([
      supabase.from('tenants').select('*').neq('status', 'archived').order('company'),
      fetchAllFeatureFlags(),
    ]);

    const tList = (tenantData ?? []) as unknown as TenantRow[];
    setTenants(tList);

    const f: FlagMap = {};
    const s: Record<string, SyncConfigState> = {};
    tList.forEach((t) => {
      f[t.id] = {} as FlagMap[string];
      MODULE_KEYS.forEach((k) => {
        const row = flagRows.find((r: FeatureFlagRow) => r.tenant_id === t.id && r.feature_key === k);
        f[t.id][k] = row?.enabled ?? DEFAULT_ENABLED_MODULES.includes(k);
      });
    });

    const { data: syncRows } = await supabase.from('tenant_sync_config').select('*');
    tList.forEach((t) => {
      const sr = (syncRows ?? []).find((r: { tenant_id: string }) => r.tenant_id === t.id) as
        | { auto_sync_interval_hours: number; manual_replicate_enabled: boolean }
        | undefined;
      s[t.id] = {
        intervalHours: sr?.auto_sync_interval_hours ?? 6,
        manualReplicate: sr?.manual_replicate_enabled ?? true,
      };
    });

    setFlags(f);
    setSyncStates(s);
    setLoading(false);
  }, [mockTenants]);

  useEffect(() => { load(); }, [load]);

  const toggleFlag = useCallback(async (tenantId: string, key: ModuleKey, enabled: boolean) => {
    setFlags((prev) => ({ ...prev, [tenantId]: { ...prev[tenantId], [key]: enabled } }));
    setSaving(`${tenantId}:${key}`);
    const ok = await setFeatureFlag(tenantId, key, enabled, SUPER_ADMIN_NAME);
    setSaving(null);
    if (!ok) {
      // Revert local state to match the actual DB state — the write failed
      // (RLS rejection or network error), so the toggle must snap back.
      setFlags((prev) => ({ ...prev, [tenantId]: { ...prev[tenantId], [key]: !enabled } }));
      setToast({ msg: `Failed to ${enabled ? 'enable' : 'disable'} ${getDisplayName(key, defs)} — database write was rejected. Changes were not saved.`, ok: false });
    } else {
      // Mirror into the same-window store so the Master Tenant Ledger stays
      // in sync. BroadcastChannel doesn't echo back to the sender, so we
      // dispatch locally — remote windows get it via the broadcast.
      dispatch({ type: 'TENANT_TOGGLE_MODULE_REMOTE', id: tenantId, module: key, enabled });
      setToast({ msg: `${getDisplayName(key, defs)} ${enabled ? 'enabled' : 'disabled'} for ${tenants.find((t) => t.id === tenantId)?.company}`, ok: true });
    }
    setTimeout(() => setToast(null), 3500);
  }, [tenants, defs]);

  const saveSync = useCallback(async (tenantId: string) => {
    const state = syncStates[tenantId];
    if (!state) return;
    setSaving(`${tenantId}:sync`);
    const ok = await setSyncConfig(tenantId, state.intervalHours, state.manualReplicate, SUPER_ADMIN_NAME);
    setSaving(null);
    setToast({ msg: ok ? `Sync config saved for ${tenants.find((t) => t.id === tenantId)?.company}` : 'Failed to save sync config', ok });
    setTimeout(() => setToast(null), 3500);
  }, [syncStates, tenants]);

  const saveHeaderRename = useCallback(async (key: ModuleKey) => {
    const trimmed = headerDraft.trim();
    if (!trimmed || trimmed === getDisplayName(key, defs)) {
      setEditingHeader(null);
      return;
    }
    setSavingHeader(key);
    const ok = await setModuleDisplayName(key, trimmed, SUPER_ADMIN_NAME);
    setSavingHeader(null);
    setEditingHeader(null);
    setToast({
      msg: ok ? `Module renamed to "${trimmed}" — updates fleet-wide` : 'Failed to rename module',
      ok,
    });
    setTimeout(() => setToast(null), 3000);
  }, [headerDraft, defs]);

  const startEditingHeader = useCallback((key: ModuleKey) => {
    setEditingHeader(key);
    setHeaderDraft(getDisplayName(key, defs));
  }, [defs]);

  const filteredTenants = tenants.filter((t) =>
    t.company.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink-900 dark:text-white">
            <Grid3x3 className="h-6 w-6 text-primary-500" /> Tenant Feature Matrix
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Enable or disable platform modules per company. Configure vessel auto-sync frequency and manual replication access.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies…"
            className="input pl-9 !py-2 !text-sm"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-200/70 bg-white px-4 py-2.5 text-xs dark:border-ink-800 dark:bg-ink-900">
        <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
          <CheckCircle2 className="h-4 w-4 text-success-500" /> Enabled
        </span>
        <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
          <XCircle className="h-4 w-4 text-ink-300" /> Disabled
        </span>
        <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
          <Zap className="h-3.5 w-3.5 text-warning-500" /> Live module
        </span>
        <span className="ml-auto text-ink-400">
          {filteredTenants.length} tenant{filteredTenants.length !== 1 ? 's' : ''} · {TOGGLEABLE_MODULE_KEYS.length} modules
        </span>
      </div>

      {/* Feature Matrix */}
      <div className="overflow-x-auto rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 bg-ink-50/80 dark:border-ink-800 dark:bg-ink-950/50">
            <tr>
              <th className="sticky left-0 z-10 min-w-[180px] bg-ink-50/80 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
                Company
              </th>
              {TOGGLEABLE_MODULE_KEYS.map((k) => (
                <th key={k} className="px-2 py-3 text-center" title={MODULE_LABELS[k].description}>
                  <div className="flex flex-col items-center gap-1">
                    {canEdit && editingHeader === k ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={headerDraft}
                          onChange={(e) => setHeaderDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveHeaderRename(k);
                            if (e.key === 'Escape') setEditingHeader(null);
                          }}
                          className="w-28 rounded border border-primary-400 px-1.5 py-0.5 text-center text-xs font-bold text-ink-700 outline-none dark:border-primary-600 dark:bg-ink-800 dark:text-ink-200"
                          placeholder={MODULE_LABELS[k].label}
                        />
                        <button
                          onClick={() => saveHeaderRename(k)}
                          disabled={savingHeader === k}
                          className="rounded p-0.5 text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30"
                          title="Save name"
                        >
                          {savingHeader === k ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => setEditingHeader(null)}
                          className="rounded p-0.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                          title="Cancel"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`group inline-flex items-center gap-1 ${canEdit ? 'cursor-pointer' : ''}`}
                        onClick={() => canEdit && startEditingHeader(k)}
                        title={canEdit ? 'Click to rename' : undefined}
                      >
                        <span className="text-xs font-bold text-ink-600 dark:text-ink-300">{getDisplayName(k, defs)}</span>
                        {canEdit && (
                          <Pencil className="h-3 w-3 text-ink-300 opacity-0 transition group-hover:opacity-100" />
                        )}
                      </div>
                    )}
                    {LIVE_MODULES.includes(k) && (
                      <span className="flex items-center gap-0.5 rounded bg-warning-100 px-1 text-[8px] font-bold text-warning-600 dark:bg-warning-900/30 dark:text-warning-400">
                        <Zap className="h-2 w-2" /> LIVE
                      </span>
                    )}
                  </div>
                </th>
              ))}
              <th className="min-w-[140px] px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                Sync Interval
              </th>
              <th className="min-w-[100px] px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {filteredTenants.map((t) => {
              const tFlags = flags[t.id] ?? {};
              const syncState = syncStates[t.id] ?? { intervalHours: 6, manualReplicate: true };
              return (
                <tr key={t.id} className="hover:bg-primary-50/30 dark:hover:bg-ink-800/40">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 dark:bg-ink-900">
                    <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{t.company}</p>
                    <p className="text-xs text-ink-400">{t.plan} · {t.region}</p>
                  </td>
                  {TOGGLEABLE_MODULE_KEYS.map((k) => {
                    const enabled = tFlags[k] ?? false;
                    const isSaving = saving === `${t.id}:${k}`;
                    return (
                      <td key={k} className="px-2 py-3 text-center">
                        <button
                          onClick={() => canEdit && toggleFlag(t.id, k, !enabled)}
                          disabled={!canEdit || isSaving}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            enabled
                              ? 'bg-success-500'
                              : 'bg-ink-200 dark:bg-ink-700'
                          } ${!canEdit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          title={enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                          {isSaving && <Loader2 className="absolute -right-1 -top-1 h-3 w-3 animate-spin text-primary-500" />}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-ink-400" />
                        <select
                          value={syncState.intervalHours}
                          onChange={(e) => canEdit && setSyncStates((prev) => ({
                            ...prev,
                            [t.id]: { ...prev[t.id], intervalHours: parseInt(e.target.value, 10) },
                          }))}
                          disabled={!canEdit}
                          className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-semibold text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 disabled:opacity-50"
                        >
                          {SYNC_PRESETS.map((h) => (
                            <option key={h} value={h}>{h}h</option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-1 text-[10px] text-ink-500 dark:text-ink-400">
                        <input
                          type="checkbox"
                          checked={syncState.manualReplicate}
                          onChange={(e) => canEdit && setSyncStates((prev) => ({
                            ...prev,
                            [t.id]: { ...prev[t.id], manualReplicate: e.target.checked },
                          }))}
                          disabled={!canEdit}
                          className="h-3 w-3 rounded accent-teal-600"
                        />
                        Manual replicate
                      </label>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => saveSync(t.id)}
                      disabled={!canEdit || saving === `${t.id}:sync`}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
                    >
                      {saving === `${t.id}:sync` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50/60 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Disabling a module hides its navigation links, UI buttons, and blocks API access at the permissions level for that tenant. Sync interval changes take effect on the vessel's next sync cycle.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ${toast.ok ? 'bg-success-600' : 'bg-danger-600'}`}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
