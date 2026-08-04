import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  ShieldCheck, Play, RotateCcw, AlertTriangle, Lock, CheckCircle2, FileJson, Server, Clock, ArrowRight, ShieldAlert, Settings2, ChevronDown, ChevronRight, Search, Trash2,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Badge, StatusBadge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { CriticalActionWizard } from '../components/CriticalActionWizard';
import { useStore } from '../store';
import { useAuth } from '../lib/auth';
import { formatGb, relativeTime, formatUtc, uid } from '../constants';
import type { BackupSnapshot, Tenant } from '../types';
import type { Capabilities } from '../lib/permissions';

type BackupFreq = '6h' | '12h' | '24h' | 'custom';

const FREQ_LABELS: Record<BackupFreq, string> = {
  '6h': 'Every 6 Hours',
  '12h': 'Every 12 Hours',
  '24h': 'Every 24 Hours (Daily)',
  'custom': 'Custom',
};

export function BackupsView({ caps }: { caps: Capabilities }) {
  const { backups, tenants, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [manualOpen, setManualOpen] = useState(false);
  const [restoreFor, setRestoreFor] = useState<BackupSnapshot | null>(null);
  const [deleteSnap, setDeleteSnap] = useState<BackupSnapshot | null>(null);
  const [backupFreq, setBackupFreq] = useState<BackupFreq>('24h');
  const [freqOpen, setFreqOpen] = useState(false);
  const [customHrs, setCustomHrs] = useState(48);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const isolation = useMemo(
    () => tenants.map((t) => {
      const snaps = backups.filter((b) => b.tenantId === t.id);
      const latest = snaps[0];
      const totalSize = snaps.reduce((s, b) => s + b.sizeGb, 0);
      return { tenant: t, count: snaps.length, latest, totalSize, snapshots: snaps };
    }),
    [tenants, backups],
  );

  const filteredIsolation = useMemo(() => {
    if (!searchQuery) return isolation;
    const q = searchQuery.toLowerCase();
    return isolation.filter((r) => r.tenant.company.toLowerCase().includes(q) || r.tenant.id.toLowerCase().includes(q));
  }, [isolation, searchQuery]);

  const triggerManual = (tenant: Tenant) => {
    const snap: BackupSnapshot = {
      id: `SNP-${uid('r').slice(-6)}`,
      tenantId: tenant.id,
      company: tenant.company,
      takenAt: new Date().toISOString(),
      sizeGb: +((tenant.storageGb.used) * 0.045).toFixed(2),
      type: 'manual',
      status: 'completed',
      expiry: new Date(Date.now() + 30 * 86400000).toISOString(),
    };
    dispatch({ type: 'BACKUP_ADD', snapshot: snap });
    toast({ tone: 'success', title: 'Manual snapshot triggered', message: `${tenant.company} snapshot ${snap.id} started.` });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Tenant Data Backup & Recovery</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Isolated snapshots & high-security restore — strictly scoped by Company ID.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-Backup Frequency Selector */}
          <div className="relative">
            <button
              onClick={() => setFreqOpen((o) => !o)}
              className="btn-secondary"
              title="Auto-backup frequency"
            >
              <Clock className="h-4 w-4" /> {FREQ_LABELS[backupFreq]} <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {freqOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setFreqOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-ink-200 bg-white p-1.5 shadow-elev-3 dark:border-ink-800 dark:bg-ink-900">
                  <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">Auto-Backup Frequency</p>
                  {(['6h', '12h', '24h', 'custom'] as BackupFreq[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setBackupFreq(f); if (f !== 'custom') { setFreqOpen(false); toast({ tone: 'info', title: 'Backup frequency updated', message: `Auto-backup set to ${FREQ_LABELS[f]}.` }); } }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        backupFreq === f ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800'
                      }`}
                    >
                      {FREQ_LABELS[f]}
                      {backupFreq === f && <CheckCircle2 className="h-4 w-4" />}
                    </button>
                  ))}
                  {backupFreq === 'custom' && (
                    <div className="mt-1.5 border-t border-ink-200 px-2.5 pt-2 dark:border-ink-800">
                      <label className="label">Custom interval (hours)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={168}
                          value={customHrs}
                          onChange={(e) => setCustomHrs(+e.target.value)}
                          className="input py-1.5"
                        />
                        <button
                          onClick={() => { setFreqOpen(false); toast({ tone: 'info', title: 'Custom frequency set', message: `Auto-backup every ${customHrs} hours.` }); }}
                          className="btn-primary px-3 py-1.5 text-xs"
                        >Set</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setManualOpen(true)} disabled={!caps.backupRestore} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-4 w-4" /> Manual snapshot</button>
        </div>
      </div>

      {/* Unified Master-Detail Backup Dashboard */}
      <Card title="Multi-Tenant Isolation Dashboard" subtitle="Click a company row to expand its 30-day snapshot history — all times in UTC / GMT" icon={<ShieldCheck className="h-4 w-4" />}>
        {/* Global Search Bar */}
        <div className="mb-3 relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search companies, tenant IDs…"
            className="input pl-9"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-ink-200/70 dark:border-ink-800">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="min-w-[220px] px-4 py-3 font-semibold">Company / Tenant</th>
                <th className="w-28 px-4 py-3 font-semibold">Status</th>
                <th className="w-32 px-4 py-3 font-semibold">Total Storage</th>
                <th className="min-w-[260px] px-4 py-3 font-semibold">Latest Snapshot (UTC)</th>
                <th className="min-w-[200px] px-4 py-3 font-semibold">Quick Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {filteredIsolation.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-400">No tenants found.</td>
                </tr>
              ) : (
                filteredIsolation.map((row) => {
                  const isExpanded = expandedId === row.tenant.id;
                  return (
                    <Fragment key={row.tenant.id}>
                      {/* Parent company row */}
                      <tr
                        className={`cursor-pointer bg-white transition-colors hover:bg-primary-50/40 dark:bg-ink-900 dark:hover:bg-ink-800/50 ${isExpanded ? 'bg-primary-50/60 dark:bg-ink-800/60' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : row.tenant.id)}
                      >
                        <td className="px-3 py-3 text-center">
                          {isExpanded
                            ? <ChevronDown className="mx-auto h-4 w-4 text-primary-600 dark:text-primary-400" />
                            : <ChevronRight className="mx-auto h-4 w-4 text-ink-400" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
                              {row.tenant.company.split(' ').slice(0, 2).map((w) => w[0]).join('')}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{row.tenant.company}</p>
                              <p className="font-mono text-[11px] text-ink-400">{row.tenant.id} · {row.count} snapshots</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={row.tenant.status} /></td>
                        <td className="px-4 py-3"><span className="text-ink-600 dark:text-ink-300">{formatGb(row.totalSize)}</span></td>
                        <td className="px-4 py-3">
                          {row.latest ? (
                            <div>
                              <p className="font-mono text-xs font-semibold text-ink-800 dark:text-ink-100">{formatUtc(row.latest.takenAt)}</p>
                              <p className="text-[11px] text-ink-400">{relativeTime(row.latest.takenAt)} · {row.latest.type}</p>
                            </div>
                          ) : <span className="text-xs text-ink-400">—</span>}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => triggerManual(row.tenant)}
                              disabled={!caps.backupRestore}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                              title="Manual snapshot"
                            >
                              <Play className="h-3 w-3" /> Snapshot
                            </button>
                            <button
                              onClick={() => toast({ tone: 'info', title: 'Logs opened', message: `Backup log for ${row.tenant.company} (${row.tenant.id}).` })}
                              className="btn-ghost rounded-lg p-1.5 text-xs"
                              title="View logs"
                            >
                              <FileJson className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => toast({ tone: 'info', title: 'Frequency config', message: `${row.tenant.company} auto-backup: ${FREQ_LABELS[backupFreq]}.` })}
                              className="btn-ghost rounded-lg p-1.5 text-xs"
                              title="Configure frequency"
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded child: snapshot history sub-table */}
                      {isExpanded && (
                        <tr className="bg-ink-50/40 dark:bg-ink-950/30">
                          <td colSpan={6} className="px-4 py-3">
                            {row.snapshots.length === 0 ? (
                              <p className="py-4 text-center text-xs text-ink-400">No snapshots recorded for this tenant.</p>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-ink-200/60 dark:border-ink-700/60">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-ink-100/70 text-[10px] uppercase tracking-wide text-ink-500 dark:bg-ink-800/60 dark:text-ink-400">
                                    <tr>
                                      <th className="min-w-[220px] px-3 py-2 font-semibold">Snapshot Time (UTC)</th>
                                      <th className="w-24 px-3 py-2 font-semibold">Type</th>
                                      <th className="w-24 px-3 py-2 font-semibold">Size</th>
                                      <th className="w-28 px-3 py-2 font-semibold">Status</th>
                                      <th className="min-w-[200px] px-3 py-2 font-semibold">Expiry Date (UTC)</th>
                                      <th className="w-20 px-3 py-2 font-semibold text-center">Restore</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                                    {row.snapshots.map((b) => (
                                      <tr key={b.id} className="bg-white hover:bg-primary-50/30 dark:bg-ink-900 dark:hover:bg-ink-800/40">
                                        <td className="px-3 py-2">
                                          <p className="font-mono font-semibold text-ink-800 dark:text-ink-100">{formatUtc(b.takenAt)}</p>
                                          <p className="text-[10px] text-ink-400">{relativeTime(b.takenAt)}</p>
                                        </td>
                                        <td className="px-3 py-2"><Badge tone={b.type === 'manual' ? 'warning' : b.type === 'pre-restore' ? 'danger' : 'info'}>{b.type}</Badge></td>
                                        <td className="px-3 py-2 text-ink-600 dark:text-ink-300">{formatGb(b.sizeGb)}</td>
                                        <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                                        <td className="px-3 py-2 font-mono text-ink-500">{formatUtc(b.expiry)}</td>
                                        <td className="px-3 py-2 text-center">
                                          <div className="flex items-center justify-center gap-1">
                                            <button
                                              disabled={b.status !== 'completed' || !caps.backupRestore}
                                              onClick={() => setRestoreFor(b)}
                                              className="btn-ghost rounded-md p-1.5 text-danger-600 hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-danger-400 dark:hover:bg-danger-900/30"
                                              title={caps.backupRestore ? 'Isolated restore' : 'Restore restricted to Super-Admin'}
                                            >
                                              <RotateCcw className="h-4 w-4" />
                                            </button>
                                            <button
                                              disabled={!caps.backupRestore}
                                              onClick={() => setDeleteSnap(b)}
                                              className="btn-ghost rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                                              title="Delete snapshot"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {manualOpen && <ManualSnapshotModal tenants={tenants} onClose={() => setManualOpen(false)} onCreate={(snap) => { dispatch({ type: 'BACKUP_ADD', snapshot: snap }); toast({ tone: 'success', title: 'Manual snapshot triggered', message: `${snap.company} snapshot ${snap.id} started.` }); setManualOpen(false); }} />}

      {restoreFor && <RestoreWizard snapshot={restoreFor} onClose={() => setRestoreFor(null)} onConfirm={() => { dispatch({ type: 'BACKUP_RESTORE', snapshotId: restoreFor.id }); toast({ tone: 'danger', title: 'Isolated restore executed', message: `${restoreFor.company} data restored from ${restoreFor.id}. Logged to audit ledger.` }); setRestoreFor(null); }} />}

      {deleteSnap && (
        <CriticalActionWizard
          target={{
            kind: 'Backup Snapshot',
            title: deleteSnap.id,
            subtitle: deleteSnap.tenantId,
            rows: [
              { label: 'Snapshot ID', value: deleteSnap.id },
              { label: 'Company', value: deleteSnap.company },
              { label: 'Tenant ID', value: deleteSnap.tenantId },
              { label: 'Taken (UTC)', value: formatUtc(deleteSnap.takenAt) },
              { label: 'Size', value: formatGb(deleteSnap.sizeGb) },
              { label: 'Type', value: deleteSnap.type },
              { label: 'Status', value: deleteSnap.status },
              { label: 'Expiry (UTC)', value: formatUtc(deleteSnap.expiry) },
            ],
            acknowledgements: [
              `I acknowledge this will permanently remove snapshot ${deleteSnap.id} for ${deleteSnap.company}.`,
              'I understand this snapshot cannot be used for future isolated restores once deleted.',
              'I confirm other snapshots for this tenant will remain available.',
            ],
            confirmPhrase: `DELETE ${deleteSnap.id}`,
            confirmHint: `DELETE ${deleteSnap.id}`,
          }}
          actorEmail={user?.email ?? 'unknown'}
          onClose={() => setDeleteSnap(null)}
          onExecute={(payload) => {
            dispatch({ type: 'BACKUP_DELETE', snapshotId: deleteSnap.id });
            toast({ tone: 'danger', title: 'Snapshot permanently deleted', message: `${deleteSnap.id} removed. Audit entry: ${payload.timestamp}.` });
            setDeleteSnap(null);
          }}
        />
      )}
    </div>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-ink-500">{icon}{label}</span>
      <span className="font-semibold text-ink-800 dark:text-ink-100">{value}</span>
    </div>
  );
}

function ManualSnapshotModal({ tenants, onClose, onCreate }: { tenants: Tenant[]; onClose: () => void; onCreate: (s: BackupSnapshot) => void }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const tenant = tenants.find((t) => t.id === tenantId);

  const run = () => {
    setRunning(true);
    let p = 0;
    const h = setInterval(() => {
      p += 8;
      setProgress(Math.min(100, p));
      if (p >= 100) {
        clearInterval(h);
        const snap: BackupSnapshot = {
          id: `SNP-${uid('r').slice(-6)}`,
          tenantId,
          company: tenant?.company ?? '',
          takenAt: new Date().toISOString(),
          sizeGb: +((tenant?.storageGb.used ?? 0) * 0.045).toFixed(2),
          type: 'manual',
          status: 'completed',
          expiry: new Date(Date.now() + 30 * 86400000).toISOString(),
          reason: reason || undefined,
        };
        onCreate(snap);
      }
    }, 180);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="On-Demand Manual Snapshot"
      subtitle="Trigger an immediate backup for a specific company"
      icon={<Play className="h-5 w-5" />}
      footer={running ? <button disabled className="btn-secondary">Running…</button> : <><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={run} disabled={!tenantId} className="btn-primary"><Play className="h-4 w-4" /> Trigger backup</button></>}
    >
      {running ? (
        <div className="space-y-4 py-4 text-center">
          <Server className="mx-auto h-10 w-10 animate-pulse-soft text-primary-500" />
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Snapshotting {tenant?.company}…</p>
          <ProgressBar value={progress} size="lg" showLabel />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Company</label>
            <select className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.company} · {t.id}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reason (optional)</label>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pre SMS push staging" />
          </div>
          <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-800/50">
            Snapshot will be isolated to <span className="font-mono font-semibold">{tenantId}</span> and retained for 30 days. All manual triggers are recorded in the audit ledger.
          </div>
        </div>
      )}
    </Modal>
  );
}

function RestoreWizard({ snapshot, onClose, onConfirm }: { snapshot: BackupSnapshot; onClose: () => void; onConfirm: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [typed, setTyped] = useState('');
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const match = typed.trim() === snapshot.company;

  return (
    <Modal
      open
      onClose={onClose}
      title="High-Security Isolated Recovery"
      subtitle={`Restore ${snapshot.company} data from ${snapshot.id}`}
      icon={<ShieldAlert className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          {step > 1 && step < 4 && <button onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="btn-secondary">Back</button>}
          {step === 1 && <button onClick={() => setStep(2)} className="btn-primary">Begin verification</button>}
          {step === 2 && <button onClick={() => setStep(3)} disabled={!ack1 || !ack2} className="btn-danger">Proceed to confirmation</button>}
          {step === 3 && <button onClick={() => { setStep(4); setTimeout(onConfirm, 1400); }} disabled={!match} className="btn-danger"><RotateCcw className="h-4 w-4" /> Execute restore</button>}
          {step === 4 && <button disabled className="btn-secondary">Restoring…</button>}
        </>
      }
    >
      {/* Stepper */}
      <div className="mb-5 flex items-center gap-2">
        {['Verify', 'Acknowledge', 'Confirm', 'Restore'].map((label, i) => {
          const n = i + 1;
          const active = step >= n;
          return (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${active ? 'bg-danger-600 text-white' : 'bg-ink-100 text-ink-400 dark:bg-ink-800'}`}>
                {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              <span className={`text-xs font-semibold ${active ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400'}`}>{label}</span>
              {n < 4 && <div className={`h-0.5 flex-1 ${step > n ? 'bg-danger-500' : 'bg-ink-200 dark:bg-ink-700'}`} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-200/70 p-4 dark:border-ink-800">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Snapshot details</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-ink-500">Company:</span> <span className="font-semibold text-ink-800 dark:text-ink-100">{snapshot.company}</span></div>
              <div><span className="text-ink-500">Company ID:</span> <span className="font-mono font-semibold text-ink-800 dark:text-ink-100">{snapshot.tenantId}</span></div>
              <div><span className="text-ink-500">Snapshot ID:</span> <span className="font-mono font-semibold text-ink-800 dark:text-ink-100">{snapshot.id}</span></div>
              <div><span className="text-ink-500">Size:</span> <span className="font-semibold text-ink-800 dark:text-ink-100">{formatGb(snapshot.sizeGb)}</span></div>
              <div><span className="text-ink-500">Taken:</span> <span className="text-ink-800 dark:text-ink-100">{formatUtc(snapshot.takenAt)}</span></div>
              <div><span className="text-ink-500">Type:</span> <span className="text-ink-800 dark:text-ink-100">{snapshot.type}</span></div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This will <strong>overwrite</strong> the current data set for <strong>{snapshot.company}</strong> ({snapshot.tenantId}). The operation is irreversible and isolated to this single tenant.</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
            <input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-danger-600 focus:ring-danger-500" />
            <span className="text-sm text-ink-700 dark:text-ink-200">I understand this restore will overwrite all current SMS documents, forms, logs and user accounts for <strong>{snapshot.company}</strong>.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
            <input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-danger-600 focus:ring-danger-500" />
            <span className="text-sm text-ink-700 dark:text-ink-200">I confirm this restore is scoped to <span className="font-mono font-semibold">{snapshot.tenantId}</span> only and will not affect any other tenant on the platform.</span>
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <Lock className="mr-1.5 inline h-4 w-4" />
            To execute the restore, type the exact company name to confirm.
          </div>
          <div>
            <label className="label">Type company name: <span className="font-mono text-danger-600 dark:text-danger-400">{snapshot.company}</span></label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={snapshot.company}
              className={`input ${typed && !match ? 'border-danger-400 focus:ring-danger-500/20' : typed && match ? 'border-success-400 focus:ring-success-500/20' : ''}`}
            />
            {typed && (
              <p className={`mt-1.5 text-xs ${match ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                {match ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Name matches — restore armed.</> : <><AlertTriangle className="mr-1 inline h-3 w-3" />Name does not match yet.</>}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 py-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/40">
            <RotateCcw className="h-7 w-7 animate-spin text-danger-600 dark:text-danger-400" style={{ animationDuration: '1.4s' }} />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-white">Restoring {snapshot.company}…</p>
            <p className="mt-1 text-xs text-ink-500">Isolated data overwrite in progress · audit ledger entry dispatched</p>
          </div>
          <div className="mx-auto max-w-xs">
            <ProgressBar value={100} tone="danger" indeterminate size="lg" />
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-1.5 font-mono text-xs text-ink-500 dark:bg-ink-800/50">
            <FileJson className="h-3.5 w-3.5" /> {snapshot.tenantId} <ArrowRight className="h-3 w-3" /> restore complete
          </div>
        </div>
      )}
    </Modal>
  );
}
