import { useState } from 'react';
import {
  ShieldCheck, Briefcase, Ship, Lock, Eye, Layers, AlertTriangle, CheckCircle2,
  Unlock, RotateCcw, Sliders, Save, History, ShieldAlert, Loader2, ChevronRight,
  Globe, Building2, Wifi, Table2, Pencil, Search,
} from 'lucide-react';
import { TenantInspectionBar } from '../components/TenantInspectionBar';
import { useStore } from '../store';
import { CriticalActionWizard } from '../components/CriticalActionWizard';
import { Modal } from '../components/Modal';
import { postSyncEvent } from '../lib/syncChannel';
import { isDemoMode, demoSetWorkspaceFrozen, demoGetWorkspaceFrozen, demoSetGuardrails, demoGetGuardrails } from '../lib/demoData';
import { relativeTime } from '../constants';
import type { Capabilities } from '../lib/permissions';
import type { Tenant, SmsSnapshot, TenantGuardrails, PlanTier } from '../types';

export function SmsView({ caps: _caps }: { caps: Capabilities }) {
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Master SMS Template Engine</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Inspect any tenant's live SMS workspace — full 1:1 mirror view with metadata, approval states, and sync status.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            <Layers className="h-3.5 w-3.5" /> Inspector Mode
          </span>
        </div>
      </div>

      {/* ── Section 1: Tenant Inspection Bar & Live Mirror View ──────────────── */}
      <TenantInspectionBar
        selectedId={selectedTenantId}
        onSelectTenant={setSelectedTenantId}
      />

      {/* ── Section 1b: Tenant Governance Summary Table ──────────────────────── */}
      <TenantGovernanceTable
        selectedTenantId={selectedTenantId}
        onSelectTenant={setSelectedTenantId}
      />

      {/* ── Section 2: Governance & Override Controls (dynamic) ─────────────── */}
      <GovernanceSection selectedTenantId={selectedTenantId} />

      {/* ── Section 3: Document Rights & Rank Governance ─────────────────────── */}
      <RankGovernanceSection />
    </div>
  );
}

/* ── Governance & Override Controls Section ───────────────────────────────── */

function GovernanceSection({ selectedTenantId }: { selectedTenantId: string | null }) {
  const { tenants, smsSnapshots, dispatch, toast, audit, globalGuardrails } = useStore();
  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null;

  const isGlobal = !selectedTenant;
  const guardrails = selectedTenant?.guardrails ?? globalGuardrails;

  const [maxDepth, setMaxDepth] = useState(guardrails.maxSubfolderDepth);
  const [maxUpload, setMaxUpload] = useState(guardrails.maxUploadSizeMb);
  const [rollbackFor, setRollbackFor] = useState<SmsSnapshot | null>(null);
  const isFrozen = selectedTenant ? (isDemoMode() ? demoGetWorkspaceFrozen(selectedTenant.demoTenantId ?? selectedTenant.id) : guardrails.workspaceFrozen) : false;
  const [freezeConfirm, setFreezeConfirm] = useState(false);

  // Sync local state when selection changes
  const scopeKey = selectedTenantId ?? '__global__';
  const [lastScope, setLastScope] = useState(scopeKey);
  if (lastScope !== scopeKey) {
    setLastScope(scopeKey);
    setMaxDepth(guardrails.maxSubfolderDepth);
    setMaxUpload(guardrails.maxUploadSizeMb);
  }

  const tenantSnaps = selectedTenant
    ? smsSnapshots.filter((s) => s.tenantId === selectedTenant.id)
    : [];
  const tenantAudit = selectedTenant
    ? audit.filter((a) => a.companyId === selectedTenant.id && a.category === 'sms').slice(0, 8)
    : [];

  function handleFreeze() {
    if (selectedTenant) {
      const newFrozen = !isFrozen;
      dispatch({ type: 'TENANT_FREEZE', id: selectedTenant.id, frozen: newFrozen });
      if (isDemoMode()) demoSetWorkspaceFrozen(selectedTenant.demoTenantId ?? selectedTenant.id, newFrozen);
      postSyncEvent({ type: 'SMS_UPDATED', tenantId: selectedTenant.demoTenantId ?? selectedTenant.id, payload: { action: 'workspace_freeze', frozen: newFrozen } });
      toast({
        tone: newFrozen ? 'danger' : 'success',
        title: newFrozen ? 'Workspace frozen' : 'Workspace unfrozen',
        message: newFrozen ? `${selectedTenant.company} can no longer edit SMS trees.` : `${selectedTenant.company} can resume SMS editing.`,
      });
    }
    setFreezeConfirm(false);
  }

  function handleSaveGuardrails() {
    if (selectedTenant) {
      dispatch({ type: 'GUARDRAILS_UPDATE', id: selectedTenant.id, patch: { maxSubfolderDepth: maxDepth, maxUploadSizeMb: maxUpload } });
      if (isDemoMode()) demoSetGuardrails(selectedTenant.demoTenantId ?? selectedTenant.id, { maxSubfolderDepth: maxDepth, maxUploadSizeMb: maxUpload });
      postSyncEvent({ type: 'SMS_UPDATED', tenantId: selectedTenant.demoTenantId ?? selectedTenant.id, payload: { action: 'guardrails_updated', maxDepth, maxUpload } });
      toast({ tone: 'success', title: 'Tenant guardrails updated', message: `${selectedTenant.company}: max depth ${maxDepth}, max upload ${maxUpload}MB` });
    } else {
      dispatch({ type: 'GUARDRAILS_GLOBAL_UPDATE', patch: { maxSubfolderDepth: maxDepth, maxUploadSizeMb: maxUpload } });
      if (isDemoMode()) tenants.forEach((t) => { if (t.demoTenantId) demoSetGuardrails(t.demoTenantId, { maxSubfolderDepth: maxDepth, maxUploadSizeMb: maxUpload }); });
      tenants.forEach((t) => postSyncEvent({ type: 'SMS_UPDATED', tenantId: t.demoTenantId ?? t.id, payload: { action: 'global_guardrails_updated', maxDepth, maxUpload } }));
      toast({ tone: 'success', title: 'Global defaults updated', message: `Platform-wide: max depth ${maxDepth}, max upload ${maxUpload}MB` });
    }
  }

  function handleRollback() {
    if (!rollbackFor || !selectedTenant) return;
    dispatch({ type: 'TENANT_ROLLBACK', snapshotId: rollbackFor.id });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: selectedTenant.demoTenantId ?? selectedTenant.id, payload: { action: 'sms_rollback', snapshot: rollbackFor.label } });
    toast({ tone: 'danger', title: 'SMS tree rolled back', message: `${selectedTenant.company} restored to: ${rollbackFor.label}` });
    setRollbackFor(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-primary-500" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">Governance &amp; Override Controls</h2>
        {isGlobal ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
            <Globe className="h-3 w-3" /> Global Platform Defaults
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-100 px-2 py-0.5 text-[10px] font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
            <Building2 className="h-3 w-3" /> {selectedTenant!.company}
          </span>
        )}
      </div>

      {isGlobal ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          No tenant selected — these settings define the <strong>platform-wide default guardrails</strong> applied to all new tenants. Select a tenant above in Inspector Mode to apply company-specific overrides.
        </p>
      ) : (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Override controls for <strong>{selectedTenant!.company}</strong>. Changes here take effect immediately and propagate to the Company Admin's live workspace.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Freeze Toggle */}
        <section className="rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
            {isFrozen ? <Lock className="h-4 w-4 text-danger-500" /> : <Unlock className="h-4 w-4 text-ink-400" />}
            <p className="text-sm font-bold text-ink-800 dark:text-ink-100">Workspace Freeze</p>
          </div>
          <div className="p-4">
            {isGlobal ? (
              <p className="text-xs text-ink-400">Workspace freeze is a tenant-specific control. Select a tenant to freeze or unfreeze their SMS editing.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">Block Company Admin from making SMS changes.</p>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${isFrozen ? 'text-danger-600 dark:text-danger-400' : 'text-ink-600 dark:text-ink-300'}`}>
                    {isFrozen ? 'Frozen' : 'Active'}
                  </span>
                  <button
                    onClick={() => isFrozen ? handleFreeze() : setFreezeConfirm(true)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isFrozen ? 'bg-danger-500' : 'bg-ink-300 dark:bg-ink-700'}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isFrozen ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {isFrozen && (
                  <div className="mt-3 flex items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-700 dark:bg-danger-900/10 dark:text-danger-300">
                    <Lock className="h-3 w-3" /> Edits are blocked for this company.
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Guardrails */}
        <section className="rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
            <Sliders className="h-4 w-4 text-primary-500" />
            <p className="text-sm font-bold text-ink-800 dark:text-ink-100">{isGlobal ? 'Default Guardrails' : 'Custom Guardrails'}</p>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <label className="label">Max Subfolder Depth</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={1} max={15} value={maxDepth}
                  onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                  className="flex-1 accent-primary-500"
                />
                <span className="w-10 text-center text-sm font-bold text-primary-600 dark:text-primary-400">{maxDepth}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-400">Limits nesting depth in the SMS tree. Range: 1–15 levels.</p>
            </div>
            <div>
              <label className="label">Max File Upload Size (MB)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={10} max={500} step={10} value={maxUpload}
                  onChange={(e) => setMaxUpload(parseInt(e.target.value))}
                  className="flex-1 accent-primary-500"
                />
                <span className="w-14 text-center text-sm font-bold text-primary-600 dark:text-primary-400">{maxUpload}MB</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-400">Maximum PDF upload size per document. Range: 10–500 MB.</p>
              <div className="mt-1.5 flex items-start gap-1.5">
                <Wifi className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
                <p className="text-[11px] italic text-ink-400">Adjust upload limits based on tenant VSAT / satellite internet constraints.</p>
              </div>
            </div>
            <button
              onClick={handleSaveGuardrails}
              className="btn-primary w-full"
            >
              <Save className="h-4 w-4" /> {isGlobal ? 'Save Global Defaults' : 'Save Tenant Guardrails'}
            </button>
          </div>
        </section>

        {/* Rollback (tenant-only) / Audit Stream */}
        <section className="rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
          {isGlobal ? (
            <>
              <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
                <History className="h-4 w-4 text-accent-500" />
                <p className="text-sm font-bold text-ink-800 dark:text-ink-100">Platform SMS Audit</p>
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto p-3">
                {audit.filter((a) => a.category === 'sms').slice(0, 8).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-2.5 rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800">
                    <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${ev.severity === 'critical' ? 'bg-danger-500' : ev.severity === 'warning' ? 'bg-warning-500' : 'bg-success-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink-700 dark:text-ink-200">{ev.action}</p>
                      <p className="text-[10px] text-ink-400">{ev.actor} · {relativeTime(ev.ts)}</p>
                    </div>
                  </div>
                ))}
                {audit.filter((a) => a.category === 'sms').length === 0 && (
                  <p className="py-4 text-center text-xs text-ink-400">No SMS events recorded.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
                <RotateCcw className="h-4 w-4 text-warning-500" />
                <p className="text-sm font-bold text-ink-800 dark:text-ink-100">Rollback SMS Tree</p>
              </div>
              <div className="p-3">
                <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">Restore to a previous snapshot.</p>
                {tenantSnaps.length === 0 ? (
                  <p className="py-4 text-center text-xs text-ink-400">No snapshots available.</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {tenantSnaps.map((snap) => (
                      <button
                        key={snap.id}
                        onClick={() => setRollbackFor(snap)}
                        className="flex w-full items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5 text-left transition hover:border-warning-400 hover:bg-warning-50/50 dark:border-ink-700 dark:hover:border-warning-600 dark:hover:bg-warning-900/10"
                      >
                        <History className="h-4 w-4 shrink-0 text-ink-400" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{snap.label}</p>
                          <p className="text-[10px] text-ink-400">{relativeTime(snap.takenAt)}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {tenantAudit.length > 0 && (
                <div className="border-t border-ink-100 px-3 py-2 dark:border-ink-800">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">Recent SMS Events</p>
                  <div className="space-y-1">
                    {tenantAudit.slice(0, 4).map((ev) => (
                      <div key={ev.id} className="flex items-start gap-2 text-[11px]">
                        <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${ev.severity === 'critical' ? 'bg-danger-500' : ev.severity === 'warning' ? 'bg-warning-500' : 'bg-success-500'}`} />
                        <span className="truncate text-ink-600 dark:text-ink-300">{ev.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Freeze Confirmation Modal */}
      {freezeConfirm && selectedTenant && (
        <Modal
          open
          onClose={() => setFreezeConfirm(false)}
          title="Freeze Workspace Editing?"
          subtitle={selectedTenant.company}
          icon={<Lock className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setFreezeConfirm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleFreeze} className="btn-primary !bg-danger-600 hover:!bg-danger-700">
                <Lock className="h-4 w-4" /> Freeze Workspace
              </button>
            </>
          }
        >
          <div className="flex items-start gap-2.5 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900/50 dark:bg-danger-900/20 dark:text-danger-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Company Admin for <strong>{selectedTenant.company}</strong> will be blocked from creating, editing, renaming, uploading, or deleting any SMS content until the freeze is lifted.</p>
          </div>
        </Modal>
      )}

      {/* Rollback Confirmation — Critical Action Wizard */}
      {rollbackFor && selectedTenant && (
        <CriticalActionWizard
          target={{
            kind: 'SMS Tree Snapshot',
            title: rollbackFor.label,
            subtitle: `${selectedTenant.company} — point-in-time rollback`,
            rows: [
              { label: 'Snapshot ID', value: rollbackFor.id },
              { label: 'Tenant', value: selectedTenant.company },
              { label: 'Snapshot Time', value: new Date(rollbackFor.takenAt).toLocaleString() },
              { label: 'Current State', value: 'Live workspace' },
              { label: 'Restored State', value: rollbackFor.label },
            ],
            acknowledgements: [
              `I acknowledge this will restore ${selectedTenant.company}'s SMS tree to the snapshot from ${relativeTime(rollbackFor.takenAt)}.`,
              'I understand any SMS changes made after this snapshot will be lost.',
              'I confirm this rollback is intentional and the affected Company Admin will be notified.',
            ],
            confirmPhrase: 'ROLLBACK',
            confirmHint: 'ROLLBACK',
          }}
          actorEmail="superadmin@platform.io"
          onClose={() => setRollbackFor(null)}
          onExecute={handleRollback}
        />
      )}
    </div>
  );
}

/* ── Document Rights & Rank Governance Section ────────────────────────────── */

const ACCESS_MATRIX = [
  {
    rank: 'Company Admin (Shore)',
    icon: <Briefcase className="h-4 w-4" />,
    tone: 'primary' as const,
    scope: 'Shore — full tenant administration',
    permissions: ['Draft SMS revisions', 'Upload documents', 'Provision users & vessels', 'Manage SMS Fleet Profiles'],
    restricted: [] as string[],
  },
  {
    rank: 'DPA / Superintendent (Shore)',
    icon: <ShieldCheck className="h-4 w-4" />,
    tone: 'accent' as const,
    scope: 'Shore — compliance & fleet publication',
    permissions: ['Review SMS revisions', 'Approve & Push updates to fleet'],
    restricted: [] as string[],
  },
  {
    rank: 'All Vessel Users (Master, Officers & Crew)',
    icon: <Ship className="h-4 w-4" />,
    tone: 'warning' as const,
    scope: 'STRICT READ-ONLY ACCESS',
    permissions: ['Search DPA-approved manuals', 'View active baselines', 'Print manuals', 'View vessel-assigned SMS profile only'],
    restricted: ['Editing', 'Uploading', 'Deleting documents'],
  },
];

function RankGovernanceSection() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary-500" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">Document Rights &amp; Rank Governance</h2>
      </div>
      <p className="text-xs text-ink-500">
        Master access matrix governing SMS document permissions across all tiers. Company Admins inherit these rules when provisioning users; shipboard tokens are auto-restricted to DPA-approved, published baselines scoped to the vessel's assigned SMS Fleet Profile.
      </p>

      <div className="overflow-hidden rounded-xl border border-ink-200/70 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <ShieldCheck className="h-4 w-4 text-primary-500" />
          <span className="text-sm font-bold text-ink-900 dark:text-white">Document Access &amp; Permissions Matrix</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="min-w-[200px] px-4 py-3 font-semibold">Rank / Role</th>
                <th className="min-w-[200px] px-4 py-3 font-semibold">Scope</th>
                <th className="min-w-[280px] px-4 py-3 font-semibold">Permitted Actions</th>
                <th className="min-w-[180px] px-4 py-3 font-semibold">Restricted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {ACCESS_MATRIX.map((row) => (
                <tr key={row.rank} className="bg-white dark:bg-ink-900">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        row.tone === 'primary' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                        : row.tone === 'accent' ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                        : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                      }`}>{row.icon}</span>
                      <span className="text-sm font-bold text-ink-900 dark:text-white">{row.rank}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {row.tone === 'warning' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-50 px-2 py-1 text-xs font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-300">
                        <Lock className="h-3 w-3" /> {row.scope}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{row.scope}</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {row.permissions.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-900/30 dark:text-success-300">
                          <CheckCircle2 className="h-3 w-3" /> {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {row.restricted.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {row.restricted.map((r) => (
                          <span key={r} className="inline-flex items-center gap-1 rounded-md bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-700 dark:bg-danger-900/30 dark:text-danger-300">
                            <AlertTriangle className="h-3 w-3" /> {r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-start gap-2 border-t border-ink-100 p-3 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-800/50">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Vessel users (Master, Chief Engineer, Officers, Crew &amp; Ratings) are restricted to <strong>Search, View &amp; Print</strong> of DPA-approved manuals only — scoped to their vessel's assigned SMS Fleet Profile. No editing, uploading, or deleting is permitted at any shipboard rank.</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tenant Governance Summary Table
// ============================================================

function TenantGovernanceTable({
  selectedTenantId,
  onSelectTenant,
}: {
  selectedTenantId: string | null;
  onSelectTenant: (id: string) => void;
}) {
  const { tenants } = useStore();
  const [query, setQuery] = useState('');

  const filtered = tenants.filter((t) =>
    t.company.toLowerCase().includes(query.toLowerCase()) ||
    t.id.toLowerCase().includes(query.toLowerCase()) ||
    t.region.toLowerCase().includes(query.toLowerCase())
  );

  const planBadge = (plan: PlanTier) => {
    const cls =
      plan === 'Enterprise' ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400' :
      plan === 'Professional' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400' :
      plan === 'Custom' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' :
      'bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-300';
    return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{plan}</span>;
  };

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Table2 className="h-5 w-5 text-primary-500" />
          <div>
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">Tenant Governance Summary</h3>
            <p className="text-[11px] text-ink-400">All company guardrail settings at a glance — no Inspector Mode needed.</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="text"
            placeholder="Search companies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-ink-200 bg-white py-1.5 pl-8 pr-3 text-xs text-ink-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:focus:ring-primary-900/40 sm:w-56"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-[10px] uppercase tracking-wider text-ink-400 dark:border-ink-800">
              <th className="px-3 py-2 font-semibold">Company / Tenant</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 text-center font-semibold">Max Depth</th>
              <th className="px-3 py-2 text-center font-semibold">Max Upload</th>
              <th className="px-3 py-2 text-center font-semibold">Freeze</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const g = t.guardrails;
              const isFrozen = isDemoMode() ? demoGetWorkspaceFrozen(t.demoTenantId ?? t.id) : (g?.workspaceFrozen ?? false);
              const isSelected = selectedTenantId === t.id;
              return (
                <tr
                  key={t.id}
                  className={`border-b border-ink-50 transition-colors hover:bg-primary-50/50 dark:border-ink-800/50 dark:hover:bg-ink-800/30 ${isSelected ? 'bg-primary-50 dark:bg-primary-900/10' : ''}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      <div>
                        <div className="text-xs font-bold text-ink-800 dark:text-ink-200">{t.company}</div>
                        <div className="text-[10px] text-ink-400">{t.region} · {t.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{planBadge(t.plan)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-700 dark:text-ink-300">
                      <Layers className="h-3 w-3 text-ink-400" />
                      {g?.maxSubfolderDepth ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-700 dark:text-ink-300">
                      <Briefcase className="h-3 w-3 text-ink-400" />
                      {g?.maxUploadSizeMb ? `${g.maxUploadSizeMb} MB` : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {isFrozen ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                        <Lock className="h-3 w-3" /> Frozen
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700 dark:bg-success-900/30 dark:text-success-400">
                        <Unlock className="h-3 w-3" /> Active
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => onSelectTenant(t.id)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${
                          isSelected
                            ? 'bg-primary-600 text-white'
                            : 'bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-900/30 dark:text-primary-400 dark:hover:bg-primary-900/50'
                        }`}
                        title="Edit Guardrails"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set('view', 'sms');
                          url.searchParams.set('tenant', t.id);
                          window.open(url.toString(), '_blank');
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[10px] font-bold text-ink-600 transition-colors hover:bg-ink-200 dark:bg-ink-700 dark:text-ink-300 dark:hover:bg-ink-600"
                        title="Inspect Workspace"
                      >
                        <Eye className="h-3 w-3" /> Inspect
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-400">
                  No tenants match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
