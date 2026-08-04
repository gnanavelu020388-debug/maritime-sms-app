/**
 * PermissionsMatrixView — Company Admin Role & Permissions Configurator
 *
 * Hierarchical checkbox UI matching the spec:
 *   Select Rank: [ Chief Cook ▼ ]
 *   [x] Enable Galley Management App
 *       ├── [x] View Inventory & Stores
 *       ├── [x] Log Daily Meals
 *       ├── [x] Draft Food Requisitions
 *       └── [ ] Approve Food Orders  ← (Only Master can approve)
 *   [x] Enable Rest Hours App
 *       ├── [x] Log Own Work/Rest Hours
 *       └── [ ] View / Edit Other Crew Hours
 *   [ ] Enable SMS / Safety Module  ← (App is hidden)
 */

import { useEffect, useState, useMemo } from 'react';
import {
  Shield, Save, Loader2, ChevronDown, ChevronRight, Lock,
  UtensilsCrossed, Moon, ShieldCheck, LifeBuoy, Award, Check,
  RotateCcw, Eye, EyeOff, Info, Plus, Pencil, Trash2, X,
  Ship, Building2, Navigation, Users, BookOpen, BarChart3,
  ShieldAlert, SatelliteDish, FileCheck2, Clock, Layers, Ban, Zap,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { CORE_RANKS, type Rank } from '../../lib/supabase';
import { useFeatureFlags } from '../../lib/featureFlags';
import {
  APP_IDS, APP_LABELS, APP_ACTIONS, APP_PRESETS, appsForTenant,
  unlicensedApps,
  DEFAULT_RANK_PERMISSIONS, useRankPermissions, saveRankPermission,
  emptyActionsFor, allTrueActionsFor,
  useRanksForTenant, saveCustomRank, updateCustomRank, deleteCustomRank,
  DEFAULT_RANK_DESCRIPTIONS,
  type AppId, type ActionMap, type RankPermissionMap, type AppPermission,
  type RankDef,
} from '../../lib/rankPermissions';
import {
  SHORE_ACTIONS, DEFAULT_SHORE_PERMISSIONS, DEFAULT_SHORE_ROLES,
  useShoreRolesForTenant, useShoreRolePermissions, saveShoreRolePermission,
  saveCustomShoreRole, updateCustomShoreRole, deleteCustomShoreRole,
  SHORE_MODULE_ACTIONS, ALL_SHORE_ACTION_KEYS, shoreModuleActionsByModule,
  SHORE_ACCORDION_GROUPS, shoreActionsByGroup, dpaFullAuthority,
  isModuleActionKey, parseModuleActionKey,
  type ShoreRoleDef, type ShorePermissionMap, type ShoreAccordionGroup,
} from '../../lib/shoreRoles';
import { Modal } from '../../components/Modal';

const APP_ICON_MAP: Record<AppId, React.ComponentType<{ className?: string }>> = {
  sms_documentation: FileCheck2,
  rest_hours: Clock,
  haccp_galley: UtensilsCrossed,
  certification_manager: Award,
  satellite_sync: SatelliteDish,
  voyage_logging: Navigation,
  crew_matrix: Users,
  electronic_logbooks: BookOpen,
  advanced_analytics: BarChart3,
  risk_assessment: ShieldAlert,
};



// ── Dirty-state bridge for navigation guard ───────────────────────────
// CompanyApp reads this synchronously to decide whether to intercept nav.
let _dirtyRanksCount = 0;
let _dirtyShoreRolesCount = 0;

export function getPermissionsDirtyState(): boolean {
  return _dirtyRanksCount > 0 || _dirtyShoreRolesCount > 0;
}

export function PermissionsMatrixView() {
  const { tenant } = useAuth();
  const { flags } = useFeatureFlags(tenant?.id);
  const { permissions, loading, refresh } = useRankPermissions(tenant?.id);
  const { ranks: rankDefs, loading: ranksLoading, refresh: refreshRanks } = useRanksForTenant(tenant?.id);
  const { roles: shoreRoleDefs, loading: shoreRolesLoading, refresh: refreshShoreRoles } = useShoreRolesForTenant(tenant?.id);
  const { permissions: shorePerms, loading: shorePermsLoading, refresh: refreshShorePerms } = useShoreRolePermissions(tenant?.id);
  const visibleApps = appsForTenant(flags);
  const [activeTab, setActiveTab] = useState<'shipboard' | 'shoreside'>('shipboard');
  const [localPerms, setLocalPerms] = useState<Record<string, RankPermissionMap>>({});
  const [selectedRank, setSelectedRank] = useState<string>('Master');
  const [savingRank, setSavingRank] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showAddRank, setShowAddRank] = useState(false);
  const [editingRank, setEditingRank] = useState<RankDef | null>(null);
  const [deletingRank, setDeletingRank] = useState<RankDef | null>(null);
  const [rankBusy, setRankBusy] = useState(false);

  // Shoreside state
  const [localShorePerms, setLocalShorePerms] = useState<Record<string, ShorePermissionMap>>({});
  const [selectedShoreRole, setSelectedShoreRole] = useState<string>('Designated Person Ashore (DPA)');
  const [savingShoreRole, setSavingShoreRole] = useState<string | null>(null);
  const [showAddShoreRole, setShowAddShoreRole] = useState(false);
  const [editingShoreRole, setEditingShoreRole] = useState<ShoreRoleDef | null>(null);
  const [deletingShoreRole, setDeletingShoreRole] = useState<ShoreRoleDef | null>(null);
  const [shoreRoleBusy, setShoreRoleBusy] = useState(false);
  const [shoreAccordions, setShoreAccordions] = useState<Record<ShoreAccordionGroup, boolean>>({ governance: false, sms: false, modules: false });
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());

  const rankOrder: string[] = useMemo(() => rankDefs.map((d) => d.rank), [rankDefs]);
  const rankDescMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of rankDefs) m[d.rank] = d.description;
    return m;
  }, [rankDefs]);

  useEffect(() => {
    if (permissions && Object.keys(permissions).length > 0) {
      setLocalPerms(JSON.parse(JSON.stringify(permissions)));
    }
  }, [permissions]);

  useEffect(() => {
    if (shorePerms && Object.keys(shorePerms).length > 0) {
      setLocalShorePerms(JSON.parse(JSON.stringify(shorePerms)));
    }
  }, [shorePerms]);

  const dirtyRanks = useMemo(() => {
    const dirty = new Set<string>();
    for (const rank of Object.keys(localPerms)) {
      const saved = permissions[rank];
      const local = localPerms[rank];
      if (JSON.stringify(saved) !== JSON.stringify(local)) dirty.add(rank);
    }
    return dirty;
  }, [localPerms, permissions]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  // ── Mutations on local state ───────────────────────────────────────

  function toggleAppVisibility(rank: string, app: AppId) {
    setLocalPerms((prev) => {
      const rankPerms = { ...(prev[rank] ?? {}) };
      const current = rankPerms[app] ?? { visible: false, actions: emptyActionsFor(app) };
      const newVisible = !current.visible;
      rankPerms[app] = {
        visible: newVisible,
        actions: newVisible
          ? { ...current.actions } // keep existing action toggles when enabling
          : emptyActionsFor(app),   // clear all actions when hiding
      };
      return { ...prev, [rank]: rankPerms };
    });
  }

  function toggleAction(rank: string, app: AppId, actionKey: string) {
    setLocalPerms((prev) => {
      const rankPerms = { ...(prev[rank] ?? {}) };
      const current = rankPerms[app] ?? { visible: true, actions: emptyActionsFor(app) };
      rankPerms[app] = {
        visible: current.visible,
        actions: { ...current.actions, [actionKey]: !current.actions[actionKey] },
      };
      return { ...prev, [rank]: rankPerms };
    });
  }

  function applyPreset(rank: string, app: AppId, presetActions: ActionMap) {
    setLocalPerms((prev) => {
      const rankPerms = { ...(prev[rank] ?? {}) };
      const isHidden = Object.values(presetActions).every((v) => !v);
      rankPerms[app] = {
        visible: !isHidden,
        actions: { ...presetActions },
      };
      return { ...prev, [rank]: rankPerms };
    });
  }

  function enableAllActions(rank: string, app: AppId) {
    setLocalPerms((prev) => {
      const rankPerms = { ...(prev[rank] ?? {}) };
      rankPerms[app] = { visible: true, actions: allTrueActionsFor(app) };
      return { ...prev, [rank]: rankPerms };
    });
  }

  function disableAllActions(rank: string, app: AppId) {
    setLocalPerms((prev) => {
      const rankPerms = { ...(prev[rank] ?? {}) };
      const current = rankPerms[app] ?? { visible: true, actions: emptyActionsFor(app) };
      rankPerms[app] = { visible: current.visible, actions: emptyActionsFor(app) };
      return { ...prev, [rank]: rankPerms };
    });
  }

  function toggleCollapse(app: string) {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(app)) next.delete(app); else next.add(app);
      return next;
    });
  }

  async function saveRank(rank: string) {
    if (!tenant) return;
    setSavingRank(rank);
    const { error } = await saveRankPermission(tenant.id, rank, localPerms[rank] ?? {});
    setSavingRank(null);
    if (error) {
      showToast(`Failed to save ${rank}: ${error}`, false);
    } else {
      showToast(`${rank} permissions saved — applies on next vessel login`, true);
      refresh();
    }
  }

  function resetRank(rank: string) {
    setLocalPerms((prev) => ({
      ...prev,
      [rank]: JSON.parse(JSON.stringify(DEFAULT_RANK_PERMISSIONS[rank] ?? {})),
    }));
  }

  function resetAll() {
    const reset: Record<string, RankPermissionMap> = {};
    for (const rank of rankOrder) {
      reset[rank] = JSON.parse(JSON.stringify(DEFAULT_RANK_PERMISSIONS[rank] ?? {}));
    }
    setLocalPerms(reset);
  }

  async function handleAddRank(name: string, description: string) {
    if (!tenant) return;
    setRankBusy(true);
    const { error } = await saveCustomRank(tenant.id, name, description);
    setRankBusy(false);
    if (error) {
      showToast(`Failed to add rank: ${error}`, false);
    } else {
      showToast(`Custom rank "${name}" added — now configure its permissions`, true);
      refreshRanks();
      setShowAddRank(false);
      setSelectedRank(name);
    }
  }

  async function handleEditRank(oldName: string, newName: string, description: string) {
    if (!tenant) return;
    setRankBusy(true);
    const { error } = await updateCustomRank(tenant.id, oldName, newName, description);
    setRankBusy(false);
    if (error) {
      showToast(`Failed to update rank: ${error}`, false);
    } else {
      showToast(`Rank updated to "${newName}"`, true);
      refreshRanks();
      setEditingRank(null);
      if (selectedRank === oldName) setSelectedRank(newName);
    }
  }

  async function handleDeleteRank(rank: string) {
    if (!tenant) return;
    setRankBusy(true);
    const { error } = await deleteCustomRank(tenant.id, rank);
    setRankBusy(false);
    if (error) {
      showToast(`Failed to delete rank: ${error}`, false);
    } else {
      showToast(`Custom rank "${rank}" deleted`, true);
      refreshRanks();
      setDeletingRank(null);
      if (selectedRank === rank) setSelectedRank('Master');
    }
  }

  // ── Shoreside handlers ──────────────────────────────────────────

  const shoreRoleOrder: string[] = useMemo(() => shoreRoleDefs.map((d) => d.role), [shoreRoleDefs]);

  const dirtyShoreRoles = useMemo(() => {
    const dirty = new Set<string>();
    if (!shorePerms) return dirty;
    for (const role of shoreRoleOrder) {
      const orig = shorePerms[role];
      const local = localShorePerms[role];
      if (!orig || !local) continue;
      for (const key of ALL_SHORE_ACTION_KEYS) {
        if ((orig[key] ?? false) !== (local[key] ?? false)) {
          dirty.add(role);
          break;
        }
      }
    }
    return dirty;
  }, [shorePerms, localShorePerms, shoreRoleOrder]);

  // ── Sync module-level dirty counters for navigation guard ──────────
  useEffect(() => {
    _dirtyRanksCount = dirtyRanks.size;
  }, [dirtyRanks]);
  useEffect(() => {
    _dirtyShoreRolesCount = dirtyShoreRoles.size;
  }, [dirtyShoreRoles]);

  // ── Navigation guard event handlers ───────────────────────────────
  useEffect(() => {
    const saveAndNav = () => {
      if (activeTab === 'shipboard') {
        const rank = selectedRank;
        if (dirtyRanks.has(rank)) {
          setSavingRank(rank);
          saveRankPermission(tenant?.id ?? '', rank, localPerms[rank] ?? {}).then(({ error }) => {
            setSavingRank(null);
            if (!error) {
              refresh();
              window.dispatchEvent(new CustomEvent('permissions-saved-complete'));
            }
          });
        } else {
          window.dispatchEvent(new CustomEvent('permissions-saved-complete'));
        }
      } else {
        const role = selectedShoreRole;
        if (dirtyShoreRoles.has(role) && localShorePerms[role]) {
          setSavingShoreRole(role);
          saveShoreRolePermission(tenant?.id ?? '', role, localShorePerms[role]).then(({ error }) => {
            setSavingShoreRole(null);
            if (!error) {
              refreshShorePerms();
              window.dispatchEvent(new CustomEvent('permissions-saved-complete'));
            }
          });
        } else {
          window.dispatchEvent(new CustomEvent('permissions-saved-complete'));
        }
      }
    };
    const discardAndNav = () => {
      if (activeTab === 'shipboard') {
        setLocalPerms((prev) => {
          const reset = { ...prev };
          for (const rank of dirtyRanks) {
            reset[rank] = JSON.parse(JSON.stringify(permissions[rank] ?? DEFAULT_RANK_PERMISSIONS[rank] ?? {}));
          }
          return reset;
        });
      } else {
        if (shorePerms) setLocalShorePerms(JSON.parse(JSON.stringify(shorePerms)));
      }
    };
    window.addEventListener('permissions-save-and-navigate', saveAndNav);
    window.addEventListener('permissions-discard-and-navigate', discardAndNav);
    return () => {
      window.removeEventListener('permissions-save-and-navigate', saveAndNav);
      window.removeEventListener('permissions-discard-and-navigate', discardAndNav);
    };
  }, [activeTab, selectedRank, selectedShoreRole, dirtyRanks, dirtyShoreRoles, localPerms, localShorePerms, permissions, shorePerms, tenant?.id, refresh, refreshShorePerms]);

  function toggleShoreAction(role: string, actionKey: string) {
    setLocalShorePerms((prev) => {
      const rolePerms = prev[role] ?? {};
      return {
        ...prev,
        [role]: { ...rolePerms, [actionKey]: !rolePerms[actionKey] },
      };
    });
  }

  function resetShoreRole(role: string) {
    if (shorePerms[role]) {
      setLocalShorePerms((prev) => ({ ...prev, [role]: JSON.parse(JSON.stringify(shorePerms[role])) }));
    }
  }

  function applyDpaFullAuthority(role: string) {
    setLocalShorePerms((prev) => ({ ...prev, [role]: dpaFullAuthority() }));
    showToast(`Full DPA Authority applied to ${role} — review and Save to persist`, true);
  }

  function toggleShoreAccordion(group: ShoreAccordionGroup) {
    setShoreAccordions((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  function resetAllShore() {
    if (shorePerms) setLocalShorePerms(JSON.parse(JSON.stringify(shorePerms)));
  }

  async function saveShoreRole(role: string) {
    if (!tenant) return;
    setSavingShoreRole(role);
    const perms = localShorePerms[role];
    if (!perms) { setSavingShoreRole(null); return; }
    const { error } = await saveShoreRolePermission(tenant.id, role, perms);
    setSavingShoreRole(null);
    if (error) {
      showToast(`Failed to save ${role}: ${error}`, false);
    } else {
      showToast(`Permissions saved for ${role}`, true);
      refreshShorePerms();
    }
  }

  async function handleAddShoreRole(name: string, description: string) {
    if (!tenant) return;
    setShoreRoleBusy(true);
    const { error } = await saveCustomShoreRole(tenant.id, name, description);
    setShoreRoleBusy(false);
    if (error) {
      showToast(`Failed to add shore role: ${error}`, false);
    } else {
      showToast(`Custom shore role "${name}" added`, true);
      refreshShoreRoles();
      setShowAddShoreRole(false);
    }
  }

  async function handleEditShoreRole(oldName: string, newName: string, description: string) {
    if (!tenant) return;
    setShoreRoleBusy(true);
    const { error } = await updateCustomShoreRole(tenant.id, oldName, newName, description);
    setShoreRoleBusy(false);
    if (error) {
      showToast(`Failed to update shore role: ${error}`, false);
    } else {
      showToast(`Shore role updated`, true);
      refreshShoreRoles();
      setEditingShoreRole(null);
    }
  }

  async function handleDeleteShoreRole(role: string) {
    if (!tenant) return;
    setShoreRoleBusy(true);
    const { error } = await deleteCustomShoreRole(tenant.id, role);
    setShoreRoleBusy(false);
    if (error) {
      showToast(`Failed to delete shore role: ${error}`, false);
    } else {
      showToast(`Custom shore role "${role}" deleted`, true);
      refreshShoreRoles();
      setDeletingShoreRole(null);
      if (selectedShoreRole === role) setSelectedShoreRole(DEFAULT_SHORE_ROLES[0].role);
    }
  }

  if (loading || ranksLoading || shoreRolesLoading || shorePermsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  // Ensure selectedRank is valid
  if (rankOrder.length > 0 && !rankOrder.includes(selectedRank)) {
    setSelectedRank(rankOrder[0]);
  }

  const selectedPerms = localPerms[selectedRank] ?? normalizeSafe(DEFAULT_RANK_PERMISSIONS[selectedRank]);
  const isDirty = dirtyRanks.has(selectedRank);
  const totalDirty = dirtyRanks.size;

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.ok ? 'bg-success-500 text-white' : 'bg-danger-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink-900 dark:text-white">
            <Shield className="h-5 w-5 text-primary-500" /> Role &amp; Permissions Configurator
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Configure app visibility and action permissions for shipboard ranks and shoreside roles.
          </p>
        </div>
        {activeTab === 'shipboard' && totalDirty > 0 && (
          <button onClick={resetAll} className="btn-secondary flex items-center gap-2 !text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All Unsaved ({totalDirty})
          </button>
        )}
        {activeTab === 'shoreside' && dirtyShoreRoles.size > 0 && (
          <button onClick={resetAllShore} className="btn-secondary flex items-center gap-2 !text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All Unsaved ({dirtyShoreRoles.size})
          </button>
        )}
      </div>

      {/* Top-level tabs: Shipboard vs Shoreside */}
      <div className="flex gap-2 border-b border-ink-200 dark:border-ink-800">
        <button
          onClick={() => setActiveTab('shipboard')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
            activeTab === 'shipboard'
              ? 'border-primary-500 text-primary-700 dark:text-primary-300'
              : 'border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
          }`}
        >
          <Ship className="h-4 w-4" /> Shipboard Ranks
        </button>
        <button
          onClick={() => setActiveTab('shoreside')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
            activeTab === 'shoreside'
              ? 'border-accent-500 text-accent-700 dark:text-accent-300'
              : 'border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
          }`}
        >
          <Building2 className="h-4 w-4" /> Shoreside Roles
        </button>
      </div>

      {/* ── SHIPBOARD TAB ── */}
      {activeTab === 'shipboard' && (
        <>
      {/* Rank selector tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {rankOrder.map((rank) => {
          const isSelected = selectedRank === rank;
          const rankDirty = dirtyRanks.has(rank);
          const def = rankDefs.find((d) => d.rank === rank);
          const isCustom = def?.is_custom ?? false;
          return (
            <div key={rank} className="group relative flex items-center">
              <button
                onClick={() => setSelectedRank(rank)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  isSelected
                    ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
                }`}
              >
                {rank}
                {isCustom && <span className="ml-0.5 rounded bg-accent-100 px-1 text-[9px] font-bold uppercase text-accent-600 dark:bg-accent-900/30 dark:text-accent-400">Custom</span>}
                {rankDirty && <span className="h-2 w-2 rounded-full bg-warning-500" />}
              </button>
              {isCustom && (
                <div className="absolute -top-2 -right-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); setEditingRank(def ?? null); }} className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink-400 shadow-sm hover:text-primary-500 dark:bg-ink-800" title="Edit rank">
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeletingRank(def ?? null); }} className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink-400 shadow-sm hover:text-danger-500 dark:bg-ink-800" title="Delete rank">
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button
          onClick={() => setShowAddRank(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-primary-300 px-3 py-2 text-sm font-semibold text-primary-600 transition hover:border-primary-400 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-400 dark:hover:bg-primary-900/20"
        >
          <Plus className="h-4 w-4" /> Add Custom Rank
        </button>
      </div>

      {/* Selected rank configurator card */}
      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        {/* Rank header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <div>
            <p className="text-lg font-bold text-ink-900 dark:text-white">{selectedRank}</p>
            <p className="text-xs text-ink-400">{rankDescMap[selectedRank] ?? DEFAULT_RANK_DESCRIPTIONS[selectedRank] ?? ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="rounded-full bg-warning-100 px-2.5 py-1 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-300">
                Unsaved changes
              </span>
            )}
            <button onClick={() => resetRank(selectedRank)} className="btn-secondary flex items-center gap-1.5 !px-3 !py-1.5 !text-xs">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
            <button
              onClick={() => saveRank(selectedRank)}
              disabled={savingRank === selectedRank || !isDirty}
              className="btn-primary flex items-center gap-1.5 !px-3 !py-1.5 !text-xs disabled:opacity-40"
            >
              {savingRank === selectedRank ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save {selectedRank}
            </button>
          </div>
        </div>

        {/* ── INDEPENDENT PER-MODULE PERMISSION CARDS ── */}
        <div className="space-y-3">
          {visibleApps.map((app) => {
            const appPerm = selectedPerms[app] ?? { visible: false, actions: emptyActionsFor(app) };
            const Icon = APP_ICON_MAP[app];
            const enabledActions = Object.entries(appPerm.actions).filter(([, v]) => v).length;
            const totalActions = APP_ACTIONS[app].length;
            const isCollapsed = !expandedApps.has(app);
            return (
              <div
                key={app}
                className={`rounded-xl border transition ${
                  appPerm.visible
                    ? 'border-primary-200 bg-white dark:border-primary-800/60 dark:bg-ink-900'
                    : 'border-ink-200 bg-ink-50/40 dark:border-ink-800 dark:bg-ink-900/40'
                }`}
              >
                {/* ── MODULE CARD HEADER ── */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 dark:border-ink-800">
                  {/* Left: Chevron + Icon + Name + Master Toggle */}
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => toggleCollapse(app)}
                      className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-800"
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => toggleAppVisibility(selectedRank, app)}
                      className="flex items-center gap-2.5"
                    >
                      <Checkbox checked={appPerm.visible} />
                      <Icon className={`h-5 w-5 shrink-0 ${appPerm.visible ? 'text-primary-500' : 'text-ink-400'}`} />
                      <div className="text-left">
                        <p className={`text-sm font-bold ${appPerm.visible ? 'text-ink-900 dark:text-white' : 'text-ink-500 dark:text-ink-400'}`}>
                          {APP_LABELS[app]}
                        </p>
                        <p className="text-[10px] text-ink-400">
                          {appPerm.visible ? `${enabledActions}/${totalActions} actions enabled` : 'App hidden for this rank'}
                        </p>
                      </div>
                    </button>
                    {/* Collapsed status badge */}
                    {isCollapsed && (
                      <span className={`ml-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        appPerm.visible
                          ? 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                          : 'bg-ink-100 text-ink-400 dark:bg-ink-800'
                      }`}>
                        {appPerm.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {appPerm.visible ? `${enabledActions}/${totalActions}` : 'Hidden'}
                      </span>
                    )}
                  </div>

                  {/* Right: Quick-set preset buttons + visibility pill */}
                  {!isCollapsed && (
                    <div className="flex items-center gap-1.5">
                      {APP_PRESETS[app].map((p) => (
                        <button
                          key={p.label}
                          onClick={() => applyPreset(selectedRank, app, p.actions)}
                          className="rounded-md border border-ink-200 px-2.5 py-1 text-[10px] font-bold text-ink-500 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 dark:border-ink-700 dark:text-ink-400 dark:hover:border-primary-700 dark:hover:bg-primary-900/20"
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        onClick={() => enableAllActions(selectedRank, app)}
                        className="rounded-md border border-success-200 px-2.5 py-1 text-[10px] font-bold text-success-600 transition hover:bg-success-50 dark:border-success-700 dark:text-success-400 dark:hover:bg-success-900/20"
                      >
                        All
                      </button>
                      <button
                        onClick={() => disableAllActions(selectedRank, app)}
                        className="rounded-md border border-ink-200 px-2.5 py-1 text-[10px] font-bold text-ink-400 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-500 dark:hover:bg-ink-800"
                      >
                        None
                      </button>
                      <div className="mx-1 h-4 w-px bg-ink-200 dark:bg-ink-700" />
                      <button
                        onClick={() => toggleAppVisibility(selectedRank, app)}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
                          appPerm.visible
                            ? 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                            : 'bg-ink-100 text-ink-400 dark:bg-ink-800'
                        }`}
                      >
                        {appPerm.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {appPerm.visible ? 'Enabled' : 'Hidden'}
                      </button>
                    </div>
                  )}
                </div>

                {/* ── 2-ROW PERMISSIONS MATRIX (inside this module box) ── */}
                {!isCollapsed && (
                <div className="overflow-x-auto border-t border-ink-100 dark:border-ink-800">
                  <table className="w-full border-collapse">
                    {/* ROW 1: Action name headers — ONLY this module's actions */}
                    <thead>
                      <tr className="border-b border-ink-100 dark:border-ink-800">
                        {APP_ACTIONS[app].map((action) => (
                          <th
                            key={action.key}
                            className="px-2 py-2.5 text-center align-bottom"
                          >
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-[11px] font-bold leading-tight text-ink-700 dark:text-ink-200">
                                {action.label}
                              </span>
                              {action.note && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-accent-100 px-1.5 py-0.5 text-[8px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                                  {action.note}
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {/* ROW 2: Checkbox controls — one directly under each header */}
                    <tbody>
                      <tr>
                        {APP_ACTIONS[app].map((action) => {
                          const checked = appPerm.actions[action.key] ?? false;
                          const changed = (permissions[selectedRank]?.[app]?.actions?.[action.key] ?? false) !== checked;
                          return (
                            <td key={action.key} className="px-2 py-3.5 text-center">
                              <button
                                onClick={() => toggleAction(selectedRank, app, action.key)}
                                disabled={!appPerm.visible}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-md border-2 transition ${
                                  !appPerm.visible
                                    ? 'cursor-not-allowed border-ink-200 bg-ink-50 opacity-40 dark:border-ink-700 dark:bg-ink-800'
                                    : checked
                                      ? `border-primary-500 bg-primary-500 text-white shadow-sm ${changed ? 'ring-2 ring-warning-300 ring-offset-1' : ''}`
                                      : `border-ink-300 bg-white hover:border-primary-400 hover:bg-primary-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:border-primary-600 ${changed ? 'ring-2 ring-warning-300 ring-offset-1' : ''}`
                                }`}
                                title={action.label + (action.note ? ` (${action.note})` : '')}
                              >
                                {checked && <Check className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unlicensed modules */}
        {unlicensedApps(flags).length > 0 && (
          <div className="border-t border-ink-100 bg-ink-50/30 px-5 py-4 dark:border-ink-800 dark:bg-ink-900/20">
            <div className="mb-2 flex items-center gap-2">
              <Ban className="h-4 w-4 text-ink-400" />
              <span className="text-xs font-bold uppercase tracking-wide text-ink-400">Unlicensed by Super Admin</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {unlicensedApps(flags).map((app) => {
                const Icon = APP_ICON_MAP[app];
                return (
                  <div
                    key={app}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-ink-200 bg-white/50 px-3 py-1.5 text-ink-400 dark:border-ink-700 dark:bg-ink-800/30"
                  >
                    <Icon className="h-3.5 w-3.5 opacity-40" />
                    <span className="text-xs font-medium opacity-60">{APP_LABELS[app]}</span>
                    <Lock className="h-3 w-3 opacity-30" />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-400">These modules are disabled in the Super Admin Tenant Feature Matrix and cannot be configured until licensed.</p>
          </div>
        )}

        {/* Save bar */}
        <div className="flex items-center justify-between border-t border-ink-100 bg-ink-50/50 px-5 py-3 dark:border-ink-800 dark:bg-ink-900/50">
          <p className="text-xs text-ink-400">
            {isDirty ? 'You have unsaved changes for this rank.' : 'All changes saved.'}
          </p>
          <button
            onClick={() => saveRank(selectedRank)}
            disabled={savingRank === selectedRank || !isDirty}
            className="btn-primary flex items-center gap-1.5 !px-4 !py-2 !text-xs disabled:opacity-40"
          >
            {savingRank === selectedRank ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isDirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Summary matrix — compact overview of all ranks */}
      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="border-b border-ink-100 px-5 py-3 dark:border-ink-800">
          <p className="text-sm font-bold text-ink-900 dark:text-white">Fleet Permission Summary</p>
          <p className="text-xs text-ink-400">Quick overview of app visibility across all ranks</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase text-ink-400 dark:border-ink-800">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Rank</th>
                {visibleApps.map((app) => (
                  <th key={app} className="px-3 py-2.5 text-center font-semibold">{APP_LABELS[app].split(' ')[0]}</th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold">Dirty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {rankOrder.map((rank) => {
                const rankPerms = localPerms[rank] ?? DEFAULT_RANK_PERMISSIONS[rank] ?? {};
                return (
                  <tr
                    key={rank}
                    onClick={() => setSelectedRank(rank)}
                    className={`cursor-pointer transition hover:bg-ink-50/40 dark:hover:bg-ink-800/40 ${selectedRank === rank ? 'bg-primary-50/40 dark:bg-primary-900/10' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink-800 dark:text-white">{rank}</p>
                    </td>
                    {visibleApps.map((app) => {
                      const visible = rankPerms[app]?.visible ?? false;
                      const actions = rankPerms[app]?.actions ?? {};
                      const enabledCount = Object.values(actions).filter(Boolean).length;
                      return (
                        <td key={app} className="px-3 py-2.5 text-center">
                          {visible ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-0.5 text-[10px] font-bold text-success-700 dark:bg-success-900/30 dark:text-success-300">
                              <Eye className="h-3 w-3" /> {enabledCount}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-400 dark:bg-ink-800">
                              <EyeOff className="h-3 w-3" />
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      {dirtyRanks.has(rank) && <span className="h-2 w-2 inline-block rounded-full bg-warning-500" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SSO injection info */}
      <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-800 dark:bg-primary-900/20">
        <div className="mb-2 flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary-600 dark:text-primary-300" />
          <h3 className="text-sm font-bold text-primary-900 dark:text-primary-200">SSO &amp; Permissions Injection</h3>
        </div>
        <p className="text-xs text-primary-700 dark:text-primary-300">
          When a vessel user logs in, their rank permissions are injected into the session as token claims. Each vessel app reads these claims to dynamically hide or disable unauthorized navigation items, buttons, and management views. Changes saved here take effect on the user's next login.
        </p>
      </div>
      {showAddRank && (
        <AddCustomRankModal
          existingRanks={rankOrder}
          busy={rankBusy}
          onClose={() => setShowAddRank(false)}
          onSave={handleAddRank}
        />
      )}

      {editingRank && (
        <AddCustomRankModal
          existingRanks={rankOrder.filter((r) => r !== editingRank.rank)}
          busy={rankBusy}
          initialName={editingRank.rank}
          initialDescription={editingRank.description}
          isEdit
          onClose={() => setEditingRank(null)}
          onSave={(name, desc) => handleEditRank(editingRank.rank, name, desc)}
        />
      )}

      {deletingRank && (
        <Modal open onClose={() => setDeletingRank(null)} title="Delete Custom Rank" subtitle={deletingRank.rank} icon={<Trash2 className="h-5 w-5" />} size="md"
          footer={<><button onClick={() => setDeletingRank(null)} className="btn-secondary" disabled={rankBusy}>Cancel</button>
            <button disabled={rankBusy} onClick={() => handleDeleteRank(deletingRank.rank)} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
              {rankBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Rank'}
            </button></>}>
          <p className="text-sm text-ink-600 dark:text-ink-300">Are you sure you want to delete the custom rank <strong>{deletingRank.rank}</strong>? Crew members currently assigned to this rank will keep their rank label, but their permissions will fall back to defaults on next login.</p>
        </Modal>
      )}
        </>
      )}

      {/* ── SHORESIDE TAB ── */}
      {activeTab === 'shoreside' && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {shoreRoleOrder.map((role) => {
                const isActive = selectedShoreRole === role;
                const isDirty = dirtyShoreRoles.has(role);
                const def = shoreRoleDefs.find((d) => d.role === role);
                const isCustom = def?.is_custom;
                return (
                  <button
                    key={role}
                    onClick={() => setSelectedShoreRole(role)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${
                      isActive
                        ? 'bg-accent-50 text-accent-700 ring-1 ring-accent-300 dark:bg-accent-900/20 dark:text-accent-300 dark:ring-accent-700'
                        : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                    }`}
                  >
                    {isCustom && <Plus className="h-3 w-3 text-accent-500" />}
                    {role}
                    {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-warning-500" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowAddShoreRole(true)}
              className="btn-primary flex items-center gap-1.5 !text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add Custom Shore Role
            </button>
          </div>

          {/* Shoreside permission configurator */}
          {(() => {
            const roleDef = shoreRoleDefs.find((d) => d.role === selectedShoreRole);
            const perms = localShorePerms[selectedShoreRole] ?? {};
            const origPerms = shorePerms[selectedShoreRole] ?? {};
            const isDirty = dirtyShoreRoles.has(selectedShoreRole);
            const isCustom = roleDef?.is_custom;
            return (
              <>
              <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-ink-900 dark:text-white">{selectedShoreRole}</h3>
                      {isCustom && <BadgeCustom />}
                      {isDirty && <span className="flex items-center gap-1 text-xs font-semibold text-warning-600"><span className="h-1.5 w-1.5 rounded-full bg-warning-500" /> Unsaved</span>}
                    </div>
                    <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{roleDef?.description ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isCustom && (
                      <>
                        <button onClick={() => setEditingShoreRole(roleDef ?? null)} className="btn-ghost flex items-center gap-1.5 !text-xs">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                        <button onClick={() => setDeletingShoreRole(roleDef ?? null)} className="btn-ghost flex items-center gap-1.5 !text-xs !text-danger-600 hover:!bg-danger-50">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                    {isDirty && (
                      <button onClick={() => resetShoreRole(selectedShoreRole)} className="btn-secondary flex items-center gap-1.5 !text-xs">
                        <RotateCcw className="h-3.5 w-3.5" /> Revert
                      </button>
                    )}
                    <button
                      onClick={() => saveShoreRole(selectedShoreRole)}
                      disabled={!isDirty || savingShoreRole === selectedShoreRole}
                      className="btn-primary flex items-center gap-1.5 !text-xs disabled:opacity-50"
                    >
                      {savingShoreRole === selectedShoreRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </button>
                  </div>
                </div>

                <div className="mb-4 rounded-lg bg-accent-50 p-3 text-xs text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Shoreside roles control administrative privileges for office-based staff. These permissions determine what actions shore personnel can perform across the company portal and vessel fleet.</p>
                  </div>
                </div>

                {/* DPA Full Authority preset button */}
                {selectedShoreRole.toLowerCase().includes('dpa') && (
                  <div className="mb-4 flex items-center gap-3 rounded-lg border-2 border-accent-300 bg-accent-50 p-3 dark:border-accent-700 dark:bg-accent-900/20">
                    <ShieldCheck className="h-5 w-5 shrink-0 text-accent-600 dark:text-accent-400" />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-accent-800 dark:text-accent-200">DPA Full Authority Preset</p>
                      <p className="text-[11px] text-accent-600 dark:text-accent-400">Instantly grants all administrative privileges and Full Control across all licensed modules for the Designated Person Ashore.</p>
                    </div>
                    <button
                      onClick={() => applyDpaFullAuthority(selectedShoreRole)}
                      className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-accent-700"
                    >
                      <Zap className="h-3.5 w-3.5" /> Set Full DPA Authority
                    </button>
                  </div>
                )}

                {/* 3-Accordion Layout */}
                <div className="space-y-3">
                  {SHORE_ACCORDION_GROUPS.map((group) => {
                    const isOpen = shoreAccordions[group.key];
                    const groupActions = group.key === 'modules' ? [] : shoreActionsByGroup(group.key);
                    const moduleGroups = group.key === 'modules' ? shoreModuleActionsByModule() : [];

                    // Count modified items in this group
                    let modCount = 0;
                    for (const a of groupActions) {
                      if ((perms[a.key] ?? false) !== (origPerms[a.key] ?? false)) modCount++;
                    }
                    for (const mg of moduleGroups) {
                      for (const a of mg.actions) {
                        if ((perms[a.key] ?? false) !== (origPerms[a.key] ?? false)) modCount++;
                      }
                    }

                    return (
                      <div key={group.key} className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700">
                        <button
                          onClick={() => toggleShoreAccordion(group.key)}
                          className="flex w-full items-center justify-between bg-ink-50 px-4 py-3 text-left transition hover:bg-ink-100 dark:bg-ink-800/50 dark:hover:bg-ink-800"
                        >
                          <div className="flex items-center gap-2.5">
                            {isOpen ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
                            {group.key === 'governance' && <Shield className="h-4 w-4 text-primary-500" />}
                            {group.key === 'sms' && <ShieldCheck className="h-4 w-4 text-accent-500" />}
                            {group.key === 'modules' && <Layers className="h-4 w-4 text-teal-500" />}
                            <div>
                              <span className="text-sm font-bold text-ink-800 dark:text-ink-200">{group.label}</span>
                              <p className="text-[11px] text-ink-400">{group.description}</p>
                            </div>
                          </div>
                          {modCount > 0 && (
                            <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-600 dark:bg-warning-900/30 dark:text-warning-400">{modCount} modified</span>
                          )}
                        </button>

                        {isOpen && (
                          <div className="border-t border-ink-100 p-4 dark:border-ink-800">
                            {/* Accordion A & B: flat checkbox list */}
                            {group.key !== 'modules' && (
                              <div className="space-y-1.5">
                                {groupActions.map((action) => {
                                  const checked = perms[action.key] ?? false;
                                  const orig = origPerms[action.key] ?? false;
                                  const changed = checked !== orig;
                                  return (
                                    <label
                                      key={action.key}
                                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                                        changed
                                          ? 'border-warning-200 bg-warning-50/40 dark:border-warning-800 dark:bg-warning-900/10'
                                          : 'border-ink-100 hover:border-ink-200 dark:border-ink-800 dark:hover:border-ink-700'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleShoreAction(selectedShoreRole, action.key)}
                                        className="h-4 w-4 rounded accent-teal-600"
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm font-semibold text-ink-800 dark:text-ink-200">{action.label}</p>
                                        {action.note && <p className="text-[11px] text-ink-400">{action.note}</p>}
                                      </div>
                                      {changed && <span className="text-[10px] font-bold text-warning-600">MODIFIED</span>}
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {/* Accordion C: dynamic module grid with radio-style 3 choices */}
                            {group.key === 'modules' && (
                              <div className="space-y-3">
                                {moduleGroups.map((modGroup) => {
                                  const modIcon = APP_ICON_MAP[modGroup.moduleKey as AppId] ?? Shield;
                                  const isUnlicensed = flags && !flags.has(modGroup.moduleKey);
                                  const viewKey = `mod:${modGroup.moduleKey}:view`;
                                  const editKey = `mod:${modGroup.moduleKey}:edit`;
                                  const fullKey = `mod:${modGroup.moduleKey}:full`;
                                  const viewChecked = perms[viewKey] ?? false;
                                  const editChecked = perms[editKey] ?? false;
                                  const fullChecked = perms[fullKey] ?? false;
                                  const viewOrig = origPerms[viewKey] ?? false;
                                  const editOrig = origPerms[editKey] ?? false;
                                  const fullOrig = origPerms[fullKey] ?? false;

                                  if (isUnlicensed) {
                                    return (
                                      <div key={modGroup.moduleKey} className="flex items-center gap-2 rounded-lg border border-dashed border-ink-200 bg-ink-50/30 p-3 dark:border-ink-700 dark:bg-ink-900/20">
                                        <modIcon className="h-4 w-4 text-ink-300" />
                                        <span className="text-sm font-medium text-ink-400">{modGroup.moduleLabel}</span>
                                        <span className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase text-ink-400">
                                          <Lock className="h-3 w-3" /> Unlicensed by Super Admin
                                        </span>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={modGroup.moduleKey} className="rounded-lg border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-800/50">
                                      <div className="mb-2 flex items-center gap-2">
                                        <modIcon className="h-4 w-4 text-teal-600" />
                                        <span className="text-sm font-semibold text-ink-800 dark:text-ink-200">{modGroup.moduleLabel}</span>
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        {/* No Access */}
                                        <button
                                          onClick={() => {
                                            toggleShoreAction(selectedShoreRole, viewKey);
                                            if (editChecked) toggleShoreAction(selectedShoreRole, editKey);
                                            if (fullChecked) toggleShoreAction(selectedShoreRole, fullKey);
                                          }}
                                          className={`rounded-lg border-2 p-2.5 text-xs font-bold transition ${
                                            !viewChecked && !editChecked && !fullChecked
                                              ? 'border-danger-300 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-300'
                                              : 'border-ink-200 text-ink-500 hover:border-ink-300 dark:border-ink-700 dark:text-ink-400'
                                          }`}
                                        >
                                          No Access
                                        </button>
                                        {/* View Only */}
                                        <button
                                          onClick={() => {
                                            if (!viewChecked) toggleShoreAction(selectedShoreRole, viewKey);
                                            if (editChecked) toggleShoreAction(selectedShoreRole, editKey);
                                            if (fullChecked) toggleShoreAction(selectedShoreRole, fullKey);
                                          }}
                                          className={`rounded-lg border-2 p-2.5 text-xs font-bold transition ${
                                            viewChecked && !editChecked && !fullChecked
                                              ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                                              : 'border-ink-200 text-ink-500 hover:border-ink-300 dark:border-ink-700 dark:text-ink-400'
                                          }`}
                                        >
                                          View Only
                                        </button>
                                        {/* Edit / Full Control */}
                                        <button
                                          onClick={() => {
                                            if (!viewChecked) toggleShoreAction(selectedShoreRole, viewKey);
                                            if (!editChecked) toggleShoreAction(selectedShoreRole, editKey);
                                            if (!fullChecked) toggleShoreAction(selectedShoreRole, fullKey);
                                          }}
                                          className={`rounded-lg border-2 p-2.5 text-xs font-bold transition ${
                                            fullChecked
                                              ? 'border-success-300 bg-success-50 text-success-700 dark:border-success-700 dark:bg-success-900/20 dark:text-success-300'
                                              : editChecked
                                                ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                                                : 'border-ink-200 text-ink-500 hover:border-ink-300 dark:border-ink-700 dark:text-ink-400'
                                          }`}
                                        >
                                          {fullChecked ? 'Full Control' : 'Edit / Full'}
                                        </button>
                                      </div>
                                      {(viewOrig !== viewChecked || editOrig !== editChecked || fullOrig !== fullChecked) && (
                                        <p className="mt-1.5 text-[10px] font-bold text-warning-600">● Modified</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              </>
            );
          })()}

          {/* Shoreside modals */}
          {showAddShoreRole && (
            <AddCustomShoreRoleModal
              existingRoles={shoreRoleOrder}
              busy={shoreRoleBusy}
              onClose={() => setShowAddShoreRole(false)}
              onSave={handleAddShoreRole}
            />
          )}

          {editingShoreRole && (
            <AddCustomShoreRoleModal
              existingRoles={shoreRoleOrder.filter((r) => r !== editingShoreRole.role)}
              busy={shoreRoleBusy}
              initialName={editingShoreRole.role}
              initialDescription={editingShoreRole.description}
              isEdit
              onClose={() => setEditingShoreRole(null)}
              onSave={(name, desc) => handleEditShoreRole(editingShoreRole.role, name, desc)}
            />
          )}

          {deletingShoreRole && (
            <Modal open onClose={() => setDeletingShoreRole(null)} title="Delete Custom Shore Role" subtitle={deletingShoreRole.role} icon={<Trash2 className="h-5 w-5" />} size="md"
              footer={<><button onClick={() => setDeletingShoreRole(null)} className="btn-secondary" disabled={shoreRoleBusy}>Cancel</button>
                <button disabled={shoreRoleBusy} onClick={() => handleDeleteShoreRole(deletingShoreRole.role)} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
                  {shoreRoleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Role'}
                </button></>}>
              <p className="text-sm text-ink-600 dark:text-ink-300">Are you sure you want to delete the custom shore role <strong>{deletingShoreRole.role}</strong>? Staff members currently assigned to this role will keep their role label, but their permissions will fall back to defaults on next login.</p>
            </Modal>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ${toast.ok ? 'bg-success-600' : 'bg-danger-600'}`}>
          {toast.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function AddCustomRankModal({ existingRanks, busy, onClose, onSave, initialName, initialDescription, isEdit }: {
  existingRanks: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
  initialName?: string;
  initialDescription?: string;
  isEdit?: boolean;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Rank name is required.'); return; }
    if (existingRanks.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      setError('A rank with this name already exists.'); return;
    }
    onSave(trimmed, description.trim());
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Custom Rank' : 'Add Custom Rank'} icon={isEdit ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy || !name.trim()} onClick={handleSave} className="btn-primary flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {isEdit ? 'Save Changes' : 'Add Rank'}
        </button></>}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <X className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <div>
          <label className="label">Rank Name *</label>
          <input className="input" placeholder="e.g. Assistant 5th Engineer, ETO, Crane Operator" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
          <p className="mt-1 text-[11px] text-ink-400">This will appear in the rank dropdown when registering or editing crew members.</p>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[80px] resize-y" placeholder="Brief description of this rank's responsibilities…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Checkbox component ───────────────────────────────────────────────

function BadgeCustom() {
  return (
    <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
      CUSTOM
    </span>
  );
}

function AddCustomShoreRoleModal({ existingRoles, busy, onClose, onSave, initialName, initialDescription, isEdit }: {
  existingRoles: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
  initialName?: string;
  initialDescription?: string;
  isEdit?: boolean;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Role name is required.'); return; }
    if (existingRoles.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      setError('A shore role with this name already exists.'); return;
    }
    onSave(trimmed, description.trim());
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Custom Shore Role' : 'Add Custom Shore Role'} icon={isEdit ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy || !name.trim()} onClick={handleSave} className="btn-primary flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {isEdit ? 'Save Changes' : 'Add Role'}
        </button></>}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <X className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <div>
          <label className="label">Role Name *</label>
          <input className="input" placeholder="e.g. Technical Superintendent, HSQE Auditor, Crewing Officer" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
          <p className="mt-1 text-[11px] text-ink-400">This will appear in the role dropdown when registering shoreside staff.</p>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[80px] resize-y" placeholder="Brief description of this role's responsibilities…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        checked
          ? 'border-primary-500 bg-primary-500 text-white'
          : 'border-ink-300 bg-white dark:border-ink-600 dark:bg-ink-800'
      }`}
    >
      {checked && <Check className="h-3 w-3" />}
    </span>
  );
}

// ── Helper ───────────────────────────────────────────────────────────

function normalizeSafe(perms: RankPermissionMap | undefined): RankPermissionMap {
  const result: RankPermissionMap = {};
  for (const app of APP_IDS) {
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
