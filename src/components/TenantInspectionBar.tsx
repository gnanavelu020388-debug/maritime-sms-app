import { useState, useMemo, useEffect } from 'react';
import {
  Search, ChevronDown, Building2, Folder, FileText, ChevronRight,
  CheckCircle2, Clock, Upload, Wifi, WifiOff, Loader2, Lock, FileUp,
  Eye, Calendar, User, Layers, Ship,
} from 'lucide-react';
import { useStore } from '../store';
import { DOC_TREE_KINDS } from '../constants';
import { relativeTime } from '../constants';
import type { Tenant } from '../types';
import { supabase, type SmsDocRow } from '../lib/supabase';
import {
  isDemoMode, getEffectiveDemoSmsDocs, getDemoCustomTabs,
} from '../lib/demoData';
import { loadProfiles, getVesselsForTenant, type SmsProfileWithVessels } from '../lib/smsProfiles';
import { onSyncEvent } from '../lib/syncChannel';

interface TreeTab {
  key: string;
  label: string;
  custom?: boolean;
}

interface MirrorNode extends SmsDocRow {
  children: MirrorNode[];
}

export function TenantInspectionBar({ selectedId, onSelectTenant }: {
  selectedId: string | null;
  onSelectTenant: (id: string | null) => void;
}) {
  const { tenants } = useStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTree, setActiveTree] = useState<string>('sms');

  const activeTenants = tenants.filter((t) => t.status !== 'archived');
  const selectedTenant = selectedId ? tenants.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Inspection Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50/80 to-white p-4 dark:border-primary-800 dark:from-primary-900/20 dark:to-ink-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400">
            <Search className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <label className="text-[11px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">Inspect Tenant Workspace</label>
            <div className="relative mt-0.5">
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm font-semibold text-ink-800 transition hover:border-primary-400 dark:border-ink-700 dark:bg-ink-800 dark:text-white dark:hover:border-primary-600"
              >
                <span className="flex items-center gap-2 truncate">
                  <Building2 className="h-4 w-4 shrink-0 text-ink-400" />
                  {selectedTenant ? selectedTenant.company : 'Select Company'}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {dropdownOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900">
                    {activeTenants.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { onSelectTenant(t.id); setDropdownOpen(false); setActiveTree('sms'); }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-ink-50 dark:hover:bg-ink-800 ${selectedId === t.id ? 'bg-primary-50 font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-ink-700 dark:text-ink-200'}`}
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-ink-400" />
                        <span className="flex-1 truncate">{t.company}</span>
                        <span className="text-[10px] uppercase text-ink-400">{t.region}</span>
                        {t.guardrails?.workspaceFrozen && (
                          <Lock className="h-3.5 w-3.5 text-danger-500" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Mirror View */}
      {selectedTenant ? (
        <TenantSmsMirror tenant={selectedTenant} activeTree={activeTree} onTreeChange={setActiveTree} />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50/50 py-16 dark:border-ink-700 dark:bg-ink-900/30">
          <Layers className="h-10 w-10 text-ink-300 dark:text-ink-600" />
          <p className="mt-3 text-sm font-semibold text-ink-500 dark:text-ink-400">Select a tenant above to inspect their live SMS workspace</p>
          <p className="mt-1 text-xs text-ink-400">Full 1:1 mirror view with metadata badges, approval states, and sync status</p>
        </div>
      )}

    </div>
  );
}

// ── Live SMS Tree Mirror View ──────────────────────────────────────────────

function TenantSmsMirror({ tenant, activeTree, onTreeChange }: {
  tenant: Tenant;
  activeTree: string;
  onTreeChange: (k: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [roots, setRoots] = useState<MirrorNode[]>([]);
  const [allTabs, setAllTabs] = useState<TreeTab[]>(DOC_TREE_KINDS.map((m) => ({ key: m.key, label: m.label })));
  const [loading, setLoading] = useState(true);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const isFrozen = tenant.guardrails?.workspaceFrozen ?? false;

  // In demo mode, all live data (profiles, SMS docs, custom tabs, vessels) is keyed
  // under the demo tenant ID (tnt-*). The store tenant uses T-* IDs, so we bridge
  // via demoTenantId. In production, both are the same UUID.
  const dataTenantId = isDemoMode() ? (tenant.demoTenantId ?? tenant.id) : tenant.id;

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function loadProfilesList() {
    const profs = await loadProfiles(dataTenantId);
    setProfiles(profs);
    if (activeProfileId && !profs.some((p) => p.id === activeProfileId)) {
      setActiveProfileId(null);
    }
  }

  useEffect(() => { loadProfilesList(); }, [dataTenantId]);

  // Real-time sync: listen for SMS_UPDATED and PROFILES_UPDATED from Company Admin
  useEffect(() => {
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== dataTenantId) return;
      if (evt.type === 'SMS_UPDATED' || evt.type === 'PROFILES_UPDATED') {
        setSyncTick((t) => t + 1);
      }
    });
    return off;
  }, [dataTenantId]);

  async function loadAllTabs() {
    if (isDemoMode()) {
      const custom = getDemoCustomTabs(dataTenantId);
      const customTabs: TreeTab[] = Object.values(custom).map((v) => ({ key: v.key, label: v.label, custom: true }));
      setAllTabs([...DOC_TREE_KINDS.map((m) => ({ key: m.key, label: m.label })), ...customTabs]);
    } else {
      const { data } = await supabase.from('sms_documents').select('tree_kind').eq('tenant_id', dataTenantId);
      const kinds = new Set((data as Pick<SmsDocRow, 'tree_kind'>[] | null)?.map((d) => d.tree_kind) ?? []);
      const builtinKeys = new Set(DOC_TREE_KINDS.map((m) => m.key));
      const customKeys = [...kinds].filter((k) => !builtinKeys.has(k));
      const stored = localStorage.getItem(`sms-tabs-${dataTenantId}`);
      let customTabs: TreeTab[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Record<string, { key: string; label: string; custom?: boolean }>;
          customTabs = Object.values(parsed).map((v) => ({ key: v.key, label: v.label, custom: true }));
        } catch { /* ignore */ }
      }
      for (const k of customKeys) {
        if (!customTabs.some((t) => t.key === k)) customTabs.push({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), custom: true });
      }
      setAllTabs([...DOC_TREE_KINDS.map((m) => ({ key: m.key, label: m.label })), ...customTabs]);
    }
  }

  async function loadTree() {
    setLoading(true);
    let flat: SmsDocRow[];
    if (isDemoMode()) {
      flat = getEffectiveDemoSmsDocs(dataTenantId, activeTree, activeProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('*').eq('tenant_id', dataTenantId).eq('tree_kind', activeTree).order('sort_order');
      const allFlat = (data as SmsDocRow[]) ?? [];
      flat = activeProfileId ? allFlat.filter((d) => d.profile_id === null || d.profile_id === activeProfileId) : allFlat;
    }
    const map = new Map<string, MirrorNode>();
    flat.forEach((r) => map.set(r.id, { ...r, children: [] }));
    const tree: MirrorNode[] = [];
    flat.forEach((r) => {
      const node = map.get(r.id)!;
      if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node);
      else tree.push(node);
    });
    setRoots(tree);
    setLoading(false);
  }

  async function loadCounts() {
    let all: SmsDocRow[];
    if (isDemoMode()) {
      all = getEffectiveDemoSmsDocs(dataTenantId, undefined, activeProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('tree_kind, node_kind, profile_id').eq('tenant_id', dataTenantId);
      let raw = (data as Pick<SmsDocRow, 'tree_kind' | 'node_kind' | 'profile_id'>[] as SmsDocRow[]) ?? [];
      if (activeProfileId) raw = raw.filter((d) => d.profile_id === null || d.profile_id === activeProfileId);
      all = raw;
    }
    const counts: Record<string, number> = {};
    for (const d of all) { if (d.node_kind === 'document') counts[d.tree_kind] = (counts[d.tree_kind] ?? 0) + 1; }
    setDocCounts(counts);
  }

  const [vesselNames, setVesselNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!dataTenantId) return;
    getVesselsForTenant(dataTenantId).then((vs) => {
      const m: Record<string, string> = {};
      vs.forEach((v) => { m[v.id] = v.name; });
      setVesselNames(m);
    });
  }, [dataTenantId, syncTick]);

  useEffect(() => { loadAllTabs(); loadCounts(); loadProfilesList(); }, [dataTenantId, activeProfileId, syncTick]);
  useEffect(() => { loadTree(); }, [dataTenantId, activeTree, activeProfileId, syncTick]);

  const stats = useMemo(() => {
    let docs = 0, folders = 0, pending = 0, synced = 0, pendingSat = 0;
    function walk(n: MirrorNode) {
      if (n.node_kind === 'folder') folders++; else docs++;
      if (n.approval_state === 'pending_dpa') pending++;
      n.children.forEach(walk);
    }
    roots.forEach(walk);
    return { docs, folders, pending, synced, pendingSat };
  }, [roots]);

  return (
    <div className="space-y-3">
      {/* Tenant metadata header — full-width */}
      <div className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50/60 to-white p-4 dark:border-primary-800 dark:from-primary-900/20 dark:to-ink-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500 text-white">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-white">{tenant.company}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {tenant.region} · {tenant.plan} plan · {tenant.vessels.used} vessels · {tenant.seats.used} seats
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MetaBadge icon={<FileText className="h-3 w-3" />} label="Docs" value={stats.docs} tone="primary" />
          <MetaBadge icon={<Folder className="h-3 w-3" />} label="Folders" value={stats.folders} tone="accent" />
          <MetaBadge icon={<Clock className="h-3 w-3" />} label="Pending" value={stats.pending} tone="warning" />
          {isFrozen && (
            <span className="inline-flex items-center gap-1 rounded-md bg-danger-100 px-2 py-1 text-[10px] font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-300">
              <Lock className="h-3 w-3" /> Frozen
            </span>
          )}
        </div>
      </div>

      {/* Freeze banner */}
      {isFrozen && (
        <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50/60 p-3 text-sm font-semibold text-danger-700 dark:border-danger-900/50 dark:bg-danger-900/20 dark:text-danger-300">
          <Lock className="h-4 w-4 shrink-0" />
          Workspace editing is frozen by Super Admin. Company Admin cannot make SMS changes until lifted.
        </div>
      )}

      {/* SMS Fleet Scope profile selector + vessel assignments — mirrors Company Admin */}
      <div className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-gradient-to-r from-accent-50/60 to-white p-4 dark:border-accent-800 dark:from-accent-900/20 dark:to-ink-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500 text-white">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-accent-700 dark:text-accent-300">SMS Fleet Scope Profile</p>
            <select
              value={activeProfileId ?? ''}
              onChange={(e) => setActiveProfileId(e.target.value || null)}
              className="mt-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink-900 outline-none focus:ring-2 focus:ring-accent-300 dark:border-ink-700 dark:bg-ink-800 dark:text-white"
            >
              <option value="">All profiles (universal + shared)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeProfileId ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                <Ship className="h-3.5 w-3.5" />
                {profiles.find((p) => p.id === activeProfileId)?.vesselCount ?? 0} vessels assigned
              </span>
            </>
          ) : (
            <span className="text-xs text-ink-400">Showing all profile documents</span>
          )}
        </div>
      </div>

      {/* Vessel assignment list for the selected profile — shows real vessel names */}
      {activeProfileId && (() => {
        const prof = profiles.find((p) => p.id === activeProfileId);
        if (!prof || prof.vesselIds.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200/70 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-900/50">
            <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">Assigned vessels ({prof.vesselCount}):</span>
            {prof.vesselIds.map((vid) => (
              <span key={vid} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-ink-600 shadow-sm dark:bg-ink-800 dark:text-ink-300">
                <Ship className="h-3 w-3 text-primary-500" /> {vesselNames[vid] ?? vid.slice(0, 8)}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Tree tabs — includes custom tabs from tenant workspace */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
        {allTabs.map((tab) => {
          const isActive = activeTree === tab.key;
          const count = docCounts[tab.key] ?? 0;
          return (
            <button
              key={tab.key}
              onClick={() => onTreeChange(tab.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500 dark:text-ink-400'}`}
            >
              {tab.label}
              {count > 0 && <span className={`rounded-full px-1.5 text-[9px] ${isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-400'}`}>{count}</span>}
              {tab.custom && <span className="ml-0.5 rounded bg-accent-100 px-1 text-[8px] font-bold uppercase text-accent-600 dark:bg-accent-900/30 dark:text-accent-400">Custom</span>}
            </button>
          );
        })}
      </div>

      {/* Tree panel — full-width mirror */}
      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary-500" />
            <span className="text-sm font-bold text-ink-900 dark:text-white">Live Workspace Mirror — {tenant.company}</span>
          </div>
          <span className="text-[11px] text-ink-400">1:1 fidelity · read-only inspector view</span>
        </div>
        <div className="p-2" style={{ maxHeight: '600px', overflowY: 'auto' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
            </div>
          ) : roots.length === 0 ? (
            <div className="py-10 text-center">
              <Folder className="mx-auto h-8 w-8 text-ink-300" />
              <p className="mt-2 text-sm text-ink-400">No documents in this tab.</p>
            </div>
          ) : (
            roots.map((r) => <MirrorNode key={r.id} node={r} depth={0} expanded={expanded} onToggle={toggle} isFrozen={isFrozen} />)
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-200/70 bg-ink-50 p-3 text-xs dark:border-ink-800 dark:bg-ink-900/50">
        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-success-500" /> Approved — visible to fleet</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-warning-500" /> Pending DPA approval</span>
        <span className="flex items-center gap-1.5"><FileUp className="h-3 w-3 text-accent-500" /> PDF upload</span>
        <span className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-ink-400" /> Read-only inspector view</span>
      </div>
    </div>
  );
}

function MetaBadge({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'primary' | 'accent' | 'warning' | 'success' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    accent: 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
    warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  };
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${tones[tone]}`}>
      {icon}
      <span className="text-xs font-bold">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

function MirrorNode({ node, depth, expanded, onToggle, isFrozen }: {
  node: MirrorNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  isFrozen: boolean;
}) {
  const isOpen = expanded.has(node.id);
  const Icon = node.node_kind === 'folder' ? Folder : FileText;
  const isLocked = node.is_regulatory_header;

  return (
    <div>
      <div
        onClick={() => { if (node.node_kind === 'folder') onToggle(node.id); }}
        className={`group flex cursor-pointer items-center gap-2 rounded-md py-2 pr-2 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50`}
        style={{ paddingLeft: `${depth * 20 + 10}px` }}
      >
        {node.node_kind === 'folder' ? (
          isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        ) : <span className="w-3.5 shrink-0" />}
        <Icon className={`h-4 w-4 shrink-0 ${node.node_kind === 'folder' ? 'text-accent-500' : 'text-ink-400'}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-700 dark:text-ink-200">{node.label}</span>

        {/* Metadata badges */}
        {node.node_kind === 'document' && node.content_kind === 'pdf' && (
          <span className="shrink-0 rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">PDF</span>
        )}
        {node.node_kind === 'document' && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            node.approval_state === 'approved'
              ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
              : node.approval_state === 'pending_dpa'
              ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
              : 'bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300'
          }`}>
            {node.approval_state === 'approved' ? 'Approved' : node.approval_state === 'pending_dpa' ? 'Pending DPA' : 'Draft'}
          </span>
        )}
        {isLocked && (
          <Lock className="h-3 w-3 shrink-0 text-ink-400" />
        )}
        {isFrozen && (
          <Lock className="h-3 w-3 shrink-0 text-danger-400" />
        )}
      </div>

      {/* Metadata row for documents */}
      {node.node_kind === 'document' && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-[10px] text-ink-400 dark:text-ink-500"
          style={{ paddingLeft: `${depth * 20 + 42}px` }}
        >
          <span className="flex items-center gap-1"><Calendar className="h-2.5 w-2.5" /> {relativeTime(node.updated_at)}</span>
          <span className="flex items-center gap-1"><Eye className="h-2.5 w-2.5" /> Read-only inspector view</span>
          {node.profile_id && <span className="flex items-center gap-1"><Layers className="h-2.5 w-2.5" /> Profile: {node.profile_id}</span>}
        </div>
      )}

      {isOpen && node.children.map((c) => (
        <MirrorNode key={c.id} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} isFrozen={isFrozen} />
      ))}
    </div>
  );
}
