import { useState } from 'react';
import {
  X, Lock, Unlock, RotateCcw, Sliders, Save, AlertTriangle, CheckCircle2,
  History, ShieldAlert, Loader2, ChevronRight,
} from 'lucide-react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { CriticalActionWizard } from './CriticalActionWizard';
import { relativeTime } from '../constants';
import type { Tenant, SmsSnapshot } from '../types';

export function TenantControlDrawer({ tenant, open, onClose }: {
  tenant: Tenant;
  open: boolean;
  onClose: () => void;
}) {
  const { smsSnapshots, dispatch, toast, audit } = useStore();
  const [maxDepth, setMaxDepth] = useState(tenant.guardrails?.maxSubfolderDepth ?? 3);
  const [maxUpload, setMaxUpload] = useState(tenant.guardrails?.maxUploadSizeMb ?? 25);
  const [rollbackFor, setRollbackFor] = useState<SmsSnapshot | null>(null);
  const [freezeConfirm, setFreezeConfirm] = useState(false);

  if (!open) return null;

  const isFrozen = tenant.guardrails?.workspaceFrozen ?? false;
  const tenantSnaps = smsSnapshots.filter((s) => s.tenantId === tenant.id);
  const tenantAudit = audit.filter((a) => a.companyId === tenant.id && a.category === 'sms').slice(0, 12);
  const actorEmail = 'superadmin@platform.io';

  function handleFreeze() {
    dispatch({ type: 'TENANT_FREEZE', id: tenant.id, frozen: !isFrozen });
    toast({
      tone: isFrozen ? 'success' : 'danger',
      title: isFrozen ? 'Workspace unfrozen' : 'Workspace frozen',
      message: isFrozen ? `${tenant.company} can resume SMS editing.` : `${tenant.company} can no longer edit SMS trees.`,
    });
    setFreezeConfirm(false);
  }

  function handleSaveGuardrails() {
    dispatch({ type: 'GUARDRAILS_UPDATE', id: tenant.id, patch: { maxSubfolderDepth: maxDepth, maxUploadSizeMb: maxUpload } });
    toast({ tone: 'success', title: 'Guardrails updated', message: `${tenant.company}: max depth ${maxDepth}, max upload ${maxUpload}MB` });
  }

  function handleRollback() {
    if (!rollbackFor) return;
    dispatch({ type: 'TENANT_ROLLBACK', snapshotId: rollbackFor.id });
    toast({ tone: 'danger', title: 'SMS tree rolled back', message: `${tenant.company} restored to: ${rollbackFor.label}` });
    setRollbackFor(null);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-white shadow-elev-4 dark:bg-ink-900 print:hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isFrozen ? 'bg-danger-100 text-danger-600 dark:bg-danger-900/40 dark:text-danger-400' : 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'}`}>
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Tenant Governance</h2>
              <p className="text-xs text-ink-500 dark:text-ink-400">{tenant.company} · Override Controls</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-lg p-2 text-ink-400 hover:text-ink-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Freeze Toggle */}
          <section className="rounded-xl border border-ink-200 dark:border-ink-800">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isFrozen ? 'bg-danger-100 text-danger-600 dark:bg-danger-900/30 dark:text-danger-400' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>
                  {isFrozen ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-ink-800 dark:text-ink-100">Freeze Workspace Editing</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">Blocks Company Admin from making SMS changes</p>
                </div>
              </div>
              <button
                onClick={() => isFrozen ? handleFreeze() : setFreezeConfirm(true)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isFrozen ? 'bg-danger-500' : 'bg-ink-300 dark:bg-ink-700'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isFrozen ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {isFrozen && (
              <div className="flex items-center gap-2 border-t border-danger-100 bg-danger-50/50 px-4 py-2 text-xs font-semibold text-danger-700 dark:border-danger-900/30 dark:bg-danger-900/10 dark:text-danger-300">
                <Lock className="h-3 w-3" /> Workspace is currently frozen. Company Admin edits are blocked.
              </div>
            )}
          </section>

          {/* Rollback */}
          <section className="rounded-xl border border-ink-200 dark:border-ink-800">
            <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <RotateCcw className="h-4 w-4 text-warning-500" />
              <p className="text-sm font-bold text-ink-800 dark:text-ink-100">Rollback SMS Tree</p>
            </div>
            <div className="p-3">
              <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">Restore SMS layout to a previous daily point-in-time snapshot.</p>
              {tenantSnaps.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No snapshots available.</p>
              ) : (
                <div className="space-y-2">
                  {tenantSnaps.map((snap) => (
                    <button
                      key={snap.id}
                      onClick={() => setRollbackFor(snap)}
                      className="flex w-full items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5 text-left transition hover:border-warning-400 hover:bg-warning-50/50 dark:border-ink-700 dark:hover:border-warning-600 dark:hover:bg-warning-900/10"
                    >
                      <History className="h-4 w-4 shrink-0 text-ink-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{snap.label}</p>
                        <p className="text-[10px] text-ink-400">{relativeTime(snap.takenAt)} · {new Date(snap.takenAt).toLocaleString()}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Guardrails */}
          <section className="rounded-xl border border-ink-200 dark:border-ink-800">
            <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <Sliders className="h-4 w-4 text-primary-500" />
              <p className="text-sm font-bold text-ink-800 dark:text-ink-100">System Guardrails</p>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="label">Max Subfolder Depth</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={1} max={6} value={maxDepth}
                    onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                    className="flex-1 accent-primary-500"
                  />
                  <span className="w-10 text-center text-sm font-bold text-primary-600 dark:text-primary-400">{maxDepth}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">Limits nesting depth in the SMS tree (e.g., 3 levels).</p>
              </div>
              <div>
                <label className="label">Max File Upload Size (MB)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={5} max={100} step={5} value={maxUpload}
                    onChange={(e) => setMaxUpload(parseInt(e.target.value))}
                    className="flex-1 accent-primary-500"
                  />
                  <span className="w-12 text-center text-sm font-bold text-primary-600 dark:text-primary-400">{maxUpload}MB</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">Maximum PDF upload size per document (e.g., 25MB).</p>
              </div>
              <button
                onClick={handleSaveGuardrails}
                className="btn-primary w-full"
              >
                <Save className="h-4 w-4" /> Save Guardrails
              </button>
            </div>
          </section>

          {/* SMS Audit Trail (real-time event stream for this tenant) */}
          <section className="rounded-xl border border-ink-200 dark:border-ink-800">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-accent-500" />
                <p className="text-sm font-bold text-ink-800 dark:text-ink-100">SMS Event Stream</p>
              </div>
              <span className="badge bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">Immutable</span>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto p-3">
              {tenantAudit.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No SMS events for this tenant.</p>
              ) : tenantAudit.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2.5 rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800">
                  <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    ev.severity === 'critical' ? 'bg-danger-500' : ev.severity === 'warning' ? 'bg-warning-500' : 'bg-success-500'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-700 dark:text-ink-200">{ev.action}</p>
                    <p className="text-[10px] text-ink-400">{ev.actor} · {relativeTime(ev.ts)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Freeze Confirmation Modal */}
      {freezeConfirm && (
        <Modal
          open
          onClose={() => setFreezeConfirm(false)}
          title="Freeze Workspace Editing?"
          subtitle={tenant.company}
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
            <p>Company Admin for <strong>{tenant.company}</strong> will be blocked from creating, editing, renaming, uploading, or deleting any SMS content until the freeze is lifted.</p>
          </div>
        </Modal>
      )}

      {/* Rollback Confirmation — Critical Action Wizard */}
      {rollbackFor && (
        <CriticalActionWizard
          target={{
            kind: 'SMS Tree Snapshot',
            title: rollbackFor.label,
            subtitle: `${tenant.company} — point-in-time rollback`,
            rows: [
              { label: 'Snapshot ID', value: rollbackFor.id },
              { label: 'Tenant', value: tenant.company },
              { label: 'Snapshot Time', value: new Date(rollbackFor.takenAt).toLocaleString() },
              { label: 'Current State', value: 'Live workspace' },
              { label: 'Restored State', value: rollbackFor.label },
            ],
            acknowledgements: [
              `I acknowledge this will restore ${tenant.company}'s SMS tree to the snapshot from ${relativeTime(rollbackFor.takenAt)}.`,
              'I understand any SMS changes made after this snapshot will be lost.',
              'I confirm this rollback is intentional and the affected Company Admin will be notified.',
            ],
            confirmPhrase: 'ROLLBACK',
            confirmHint: 'ROLLBACK',
          }}
          actorEmail={actorEmail}
          onClose={() => setRollbackFor(null)}
          onExecute={handleRollback}
        />
      )}
    </>
  );
}
