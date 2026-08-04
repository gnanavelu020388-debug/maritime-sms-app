import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  Activity, Satellite, AlertTriangle, Copy, Check, Bug, Terminal, FileWarning, ShieldAlert, TrendingUp, ArrowUpRight, Search, Filter, Package, HardDrive, Users as UsersIcon, Ship, RefreshCw, UploadCloud, GitBranch, Clock,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Badge, StatusBadge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useStore } from '../store';
import { formatBytes, relativeTime, formatGb, formatCurrency } from '../constants';
import { PLAN_TIERS, PLAN_DEFAULTS } from '../constants';
import type { ErrorLog, SatellitePayload, Tenant, PlanTier } from '../types';
import type { Capabilities } from '../lib/permissions';
import { supabase } from '../lib/supabase';

type BreachType = 'vessels' | 'storage' | 'seats';

function detectBreaches(t: Tenant): BreachType[] {
  const out: BreachType[] = [];
  if (t.vessels.used > t.vessels.max) out.push('vessels');
  if (t.storageGb.used > t.storageGb.max) out.push('storage');
  if (t.seats.used / t.seats.max > 0.9) out.push('seats');
  return out;
}

export function MonitoringView({ caps: _caps }: { caps: Capabilities }) {
  const { satellite, tenants, errorLogs, dispatch, toast } = useStore();
  const [copied, setCopied] = useState<string | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<Tenant | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>('Professional');
  const [breachFilter, setBreachFilter] = useState<'all' | BreachType>('all');

  const breaches = useMemo(
    () => tenants.filter((t) => t.status !== 'archived' && detectBreaches(t).length > 0),
    [tenants],
  );

  const filteredBreaches = useMemo(
    () => breachFilter === 'all' ? breaches : breaches.filter((t) => detectBreaches(t).includes(breachFilter)),
    [breaches, breachFilter],
  );

  const breachColumns: Column<Tenant>[] = useMemo(() => [
    {
      key: 'company',
      header: 'Tenant',
      width: 'min-w-[200px]',
      sortValue: (t) => t.company,
      render: (t) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
            {t.company.split(' ').slice(0, 2).map((w) => w[0]).join('')}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{t.company}</p>
            <p className="truncate text-[11px] text-ink-400">{t.id} · {t.plan} plan</p>
          </div>
        </div>
      ),
    },
    {
      key: 'breaches',
      header: 'Breaches',
      render: (t) => (
        <div className="flex flex-wrap gap-1">
          {detectBreaches(t).map((b) => <BreachPill key={b} type={b} />)}
        </div>
      ),
    },
    {
      key: 'vessels',
      header: 'Vessels',
      sortValue: (t) => t.vessels.used - t.vessels.max,
      render: (t) => (
        <span className={`text-xs font-bold ${t.vessels.used > t.vessels.max ? 'text-danger-600 dark:text-danger-400' : 'text-ink-600 dark:text-ink-300'}`}>
          {t.vessels.used} / {t.vessels.max}
          {t.vessels.used > t.vessels.max && <span className="ml-1 text-[10px]">OVER</span>}
        </span>
      ),
    },
    {
      key: 'storage',
      header: 'Storage',
      sortValue: (t) => t.storageGb.used - t.storageGb.max,
      render: (t) => (
        <span className={`text-xs font-bold ${t.storageGb.used > t.storageGb.max ? 'text-danger-600 dark:text-danger-400' : 'text-ink-600 dark:text-ink-300'}`}>
          {formatGb(t.storageGb.used)} / {formatGb(t.storageGb.max)}
          {t.storageGb.used > t.storageGb.max && <span className="ml-1 text-[10px]">OVER</span>}
        </span>
      ),
    },
    {
      key: 'seats',
      header: 'Users',
      sortValue: (t) => t.seats.used / t.seats.max,
      render: (t) => (
        <span className={`text-xs font-bold ${t.seats.used / t.seats.max > 0.9 ? 'text-warning-600 dark:text-warning-400' : 'text-ink-600 dark:text-ink-300'}`}>
          {t.seats.used} / {t.seats.max}
          {t.seats.used / t.seats.max > 0.9 && <span className="ml-1 text-[10px]">NEAR</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'min-w-[180px]',
      render: (t) => {
        const next = nextPlanUp(t.plan);
        return (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setUpgradeFor(t); setSelectedPlan(next); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
              title="Open upgrade modal"
            >
              <TrendingUp className="h-3.5 w-3.5" /> Upgrade
            </button>
            <button className="btn-ghost rounded-lg p-1.5 text-xs" title="View tenant"><ArrowUpRight className="h-3.5 w-3.5" /></button>
          </div>
        );
      },
    },
  ], []);

  const satColumns: Column<SatellitePayload>[] = [
    { key: 'vessel', header: 'Vessel Source', sortValue: (p) => p.vessel, render: (p) => <span className="font-medium text-ink-800 dark:text-ink-100">{p.vessel}</span> },
    { key: 'id', header: 'Payload ID', sortValue: (p) => p.id, render: (p) => <span className="font-mono text-xs text-ink-600 dark:text-ink-300">{p.id}</span> },
    { key: 'size', header: 'Size', sortValue: (p) => p.sizeKb, render: (p) => formatBytes(p.sizeKb) },
    { key: 'node', header: 'Connection Node', sortValue: (p) => p.node, render: (p) => <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${p.node === 'Starlink' ? 'bg-primary-500' : p.node === 'VSAT' ? 'bg-accent-500' : 'bg-warning-500'}`} />{p.node}</span> },
    { key: 'status', header: 'Status', sortValue: (p) => p.status, render: (p) => <StatusBadge status={p.status} /> },
    { key: 'received', header: 'Received', sortValue: (p) => p.receivedAt, render: (p) => <span className="text-xs text-ink-500">{relativeTime(p.receivedAt)}</span> },
  ];

  const errColumns: Column<ErrorLog>[] = [
    { key: 'ts', header: 'Timestamp', sortValue: (e) => e.ts, render: (e) => <span className="font-mono text-xs text-ink-600 dark:text-ink-300">{new Date(e.ts).toLocaleString('en-GB', { hour12: false })}</span> },
    { key: 'level', header: 'Level', sortValue: (e) => e.level, render: (e) => <Badge tone={e.level === 'critical' ? 'danger' : e.level === 'error' ? 'warning' : 'info'}>{e.level}</Badge> },
    { key: 'source', header: 'Source', sortValue: (e) => e.source, render: (e) => <span className="font-mono text-xs text-ink-700 dark:text-ink-200">{e.source}</span> },
    { key: 'message', header: 'Message', render: (e) => <span className="text-sm text-ink-800 dark:text-ink-100">{e.message}</span> },
    { key: 'tenant', header: 'Tenant', render: (e) => e.tenantId ? <span className="font-mono text-xs text-ink-500">{e.tenantId}</span> : <span className="text-xs text-ink-400">platform</span> },
    {
      key: 'actions', header: 'Payload',
      render: (e) => (
        <button
          onClick={() => { navigator.clipboard?.writeText(e.payload); setCopied(e.id); setTimeout(() => setCopied(null), 1500); toast({ tone: 'success', title: 'Payload copied', message: 'Error payload copied to developer clipboard.' }); }}
          className="btn-ghost rounded-md p-1.5"
          title="Copy payload to developer clipboard"
        >
          {copied === e.id ? <Check className="h-4 w-4 text-success-500" /> : <Copy className="h-4 w-4" />}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-white">Platform Monitoring</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">Satellite traffic, license compliance & technical error logs.</p>
      </div>

      {/* Sync traffic summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat icon={<Satellite className="h-4 w-4" />} label="Active streams" value={satellite.filter((s) => s.status === 'syncing').length} tone="info" />
        <MiniStat icon={<Activity className="h-4 w-4" />} label="Processed today" value={satellite.filter((s) => s.status === 'processed').length} tone="success" />
        <MiniStat icon={<AlertTriangle className="h-4 w-4" />} label="Queued payloads" value={satellite.filter((s) => s.status === 'queued').length} tone="warning" />
        <MiniStat icon={<FileWarning className="h-4 w-4" />} label="Failed handshakes" value={satellite.filter((s) => s.status === 'failed').length} tone="danger" />
      </div>

      <Card title="Satellite Sync Traffic Queue" subtitle="Payloads streaming back to cloud via intermittent VSAT / Starlink" icon={<Satellite className="h-4 w-4" />}>
        <DataTable columns={satColumns} rows={satellite} pageSize={8} searchable searchPlaceholder="Search vessels, payloads…" searchFn={(p, q) => p.vessel.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.node.toLowerCase().includes(q)} />
      </Card>

      {/* ── TOP-DOWN FLEET SYNC STATUS MATRIX (SMS baseline pushes) ── */}
      <FleetSyncMatrix />

      <Card title="Offline Data Collision Logic Guard" subtitle="Backend deduplication rule for offline sync (bottom-up vessel reports)" icon={<ShieldAlert className="h-4 w-4" />}>
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-dashed border-accent-300 bg-accent-50/40 p-4 dark:border-accent-800 dark:bg-accent-900/10">
            <p className="text-xs font-bold uppercase tracking-wide text-accent-700 dark:text-accent-300">Deduplication rule</p>
            <p className="mt-1.5 text-sm text-ink-700 dark:text-ink-200">When duplicate forms arrive from distinct vessels (e.g. Report #1002), the engine automatically appends a unique index pattern to prevent cross-over overwrites.</p>
            <div className="mt-3 rounded-lg bg-white p-3 font-mono text-xs dark:bg-ink-900">
              <span className="text-ink-400">original:</span> <span className="text-ink-700 dark:text-ink-200">Report-1002</span>
              <br />
              <span className="text-ink-400">deduped:</span> <span className="font-bold text-accent-600 dark:text-accent-400">[VesselName]-Report-1002</span>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Recent dedup events</p>
            {[
              { vessel: 'VALLE STAR', report: 'VALLE-STAR-Report-1002' },
              { vessel: 'PACIFIC HORIZON', report: 'PACIFIC-HORIZON-Report-1002' },
              { vessel: 'NORDIC BREEZE', report: 'NORDIC-BREEZE-Report-1002' },
            ].map((d) => (
              <div key={d.report} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-2.5 dark:border-ink-800">
                <span className="font-mono text-xs text-ink-600 dark:text-ink-300">{d.report}</span>
                <Badge tone="success" dot>Indexed</Badge>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-success-50/60 p-3 text-xs text-success-700 dark:bg-success-900/20 dark:text-success-300">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>Bottom-up report syncs and top-down SMS baseline pushes operate on independent queues — no cross-blocking.</span>
          </div>
        </div>
      </Card>

      <Card title="License Compliance — Over-Limit Flagging" subtitle="Tenants exceeding tier limits or approaching seat capacity" icon={<FileWarning className="h-4 w-4" />}>
        <DataTable
          columns={breachColumns}
          rows={filteredBreaches}
          pageSize={6}
          searchPlaceholder="Search companies, IDs, plans…"
          searchFn={(t, q) =>
            t.company.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            t.plan.toLowerCase().includes(q) ||
            t.region.toLowerCase().includes(q)
          }
          emptyMessage="No compliance breaches detected — all tenants within limits."
          toolbar={
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-ink-400" />
              {(['all','vessels','storage','seats'] as const).map((bt) => (
                <button
                  key={bt}
                  onClick={() => setBreachFilter(bt)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                    breachFilter === bt
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700'
                  }`}
                >
                  {bt === 'all' ? 'All Breaches' : bt}
                </button>
              ))}
            </div>
          }
        />
      </Card>

      <Card title="Platform Technical Error Logs" subtitle="System-level crashes, failed API handshakes & database exceptions" icon={<Bug className="h-4 w-4" />} actions={<Badge tone="neutral">{errorLogs.length} entries</Badge>}>
        <DataTable columns={errColumns} rows={errorLogs} pageSize={6} searchable={false} />
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-800/50">
          <Terminal className="h-3.5 w-3.5" />
          Copy payload utility copies the raw JSON stack to your clipboard for forwarding to the platform engineering team.
        </div>
      </Card>

      {upgradeFor && (
        <UpgradeModal
          tenant={upgradeFor}
          selectedPlan={selectedPlan}
          onSelectPlan={setSelectedPlan}
          onClose={() => setUpgradeFor(null)}
          onConfirm={(plan) => {
            dispatch({ type: 'TENANT_SET_PLAN', id: upgradeFor.id, plan });
            toast({ tone: 'success', title: 'Tier upgraded', message: `${upgradeFor.company} → ${plan}. Limits recalculated from tier config.` });
            setUpgradeFor(null);
          }}
        />
      )}
    </div>
  );
}

const PLAN_ORDER: PlanTier[] = ['Standard', 'Professional', 'Enterprise', 'Custom'];

function nextPlanUp(current: PlanTier): PlanTier {
  const idx = PLAN_ORDER.indexOf(current);
  return idx >= 0 && idx < PLAN_ORDER.length - 1 ? PLAN_ORDER[idx + 1] : 'Enterprise';
}

function BreachPill({ type }: { type: BreachType }) {
  const map: Record<BreachType, { label: string; tone: 'danger' | 'warning' }> = {
    vessels: { label: 'Vessels', tone: 'danger' },
    storage: { label: 'Storage', tone: 'danger' },
    seats: { label: 'Users', tone: 'warning' },
  };
  const { label, tone } = map[type];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        tone === 'danger'
          ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300'
          : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
      }`}
    >
      {label}
    </span>
  );
}

function UpgradeModal({ tenant, selectedPlan, onSelectPlan, onClose, onConfirm }: {
  tenant: Tenant;
  selectedPlan: PlanTier;
  onSelectPlan: (p: PlanTier) => void;
  onClose: () => void;
  onConfirm: (plan: PlanTier) => void;
}) {
  const currentDefs = PLAN_DEFAULTS[tenant.plan];
  const targetDefs = PLAN_DEFAULTS[selectedPlan];
  const rows: { label: string; icon: ReactNode; used: number; currentMax: number; targetMax: number; fmt?: (n: number) => string }[] = [
    { label: 'Vessels', icon: <Ship className="h-4 w-4" />, used: tenant.vessels.used, currentMax: tenant.vessels.max, targetMax: targetDefs.vessels },
    { label: 'Storage', icon: <HardDrive className="h-4 w-4" />, used: tenant.storageGb.used, currentMax: tenant.storageGb.max, targetMax: targetDefs.storageGb, fmt: formatGb },
    { label: 'Users', icon: <UsersIcon className="h-4 w-4" />, used: tenant.seats.used, currentMax: tenant.seats.max, targetMax: targetDefs.seats },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title="Upgrade Tenant Tier"
      subtitle={`${tenant.company} · ${tenant.id}`}
      icon={<TrendingUp className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onConfirm(selectedPlan)}
            disabled={selectedPlan === tenant.plan}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrendingUp className="h-4 w-4" /> Confirm & Upgrade Tier
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
          <div>
            <p className="text-xs text-ink-500">Current plan</p>
            <p className="text-lg font-bold text-ink-900 dark:text-white">{tenant.plan}</p>
          </div>
          <div className="text-ink-300"><ArrowUpRight className="h-6 w-6" /></div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Target plan</p>
            <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{selectedPlan}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Resource</th>
                <th className="px-4 py-2.5 font-semibold">Current Usage</th>
                <th className="px-4 py-2.5 font-semibold">{tenant.plan} Limit</th>
                <th className="px-4 py-2.5 font-semibold">{selectedPlan} Limit</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {rows.map((r) => {
                const fmt = r.fmt ?? ((n: number) => String(n));
                const over = r.used > r.currentMax;
                const resolves = r.used <= r.targetMax;
                return (
                  <tr key={r.label} className="bg-white dark:bg-ink-900">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 text-ink-700 dark:text-ink-200">
                        {r.icon}<span className="font-semibold">{r.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-ink-900 dark:text-white">{fmt(r.used)}</td>
                    <td className="px-4 py-2.5 text-ink-500">{fmt(r.currentMax)}</td>
                    <td className="px-4 py-2.5 font-bold text-primary-600 dark:text-primary-400">{fmt(r.targetMax)}</td>
                    <td className="px-4 py-2.5">
                      {over ? (
                        resolves
                          ? <Badge tone="success" dot>Resolves breach</Badge>
                          : <Badge tone="warning" dot>Still over</Badge>
                      ) : (
                        <Badge tone="neutral">Within limit</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <label className="label">Select new plan</label>
          <select
            value={selectedPlan}
            onChange={(e) => onSelectPlan(e.target.value as PlanTier)}
            className="input"
          >
            {PLAN_TIERS.map((p) => (
              <option key={p} value={p} disabled={p === tenant.plan}>
                {p}{p === tenant.plan ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            Monthly revenue will adjust to {formatCurrency(PLAN_DEFAULTS[selectedPlan].monthly)}/mo based on the {selectedPlan} tier.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'info' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    info: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
  };
  return (
    <div className="card p-4">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</div>
      <p className="text-2xl font-bold text-ink-900 dark:text-white">{value}</p>
      <p className="text-xs text-ink-500 dark:text-ink-400">{label}</p>
    </div>
  );
}

// ── Fleet Sync Status Matrix (top-down SMS baseline pushes) ──────────────

interface FleetSyncRow {
  vesselName: string;
  company: string;
  smsVersion: string;
  lastSync: string | null;
  pendingDeltas: number;
  pendingOutbox: number;
  failedOutbox: number;
  connectionMode: string;
  status: 'synced' | 'pending' | 'offline' | 'stale';
}

function FleetSyncMatrix() {
  const [rows, setRows] = useState<FleetSyncRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [vesselsRes, tenantsRes, deltasRes, syncStateRes] = await Promise.all([
          supabase.from('vessels').select('id, tenant_id, name, sms_active_version, last_sync_at'),
          supabase.from('tenants').select('id, company, sms_version'),
          supabase.from('sms_delta_packages').select('tenant_id, to_version, created_at'),
          supabase.from('vessel_sync_state').select('vessel_id, last_sync_at, pending_outbox_count, failed_outbox_count, connection_mode, server_reachable'),
        ]);

        const vessels = (vesselsRes.data as { id: string; tenant_id: string; name: string; sms_active_version: string; last_sync_at: string | null }[]) ?? [];
        const tenants = (tenantsRes.data as { id: string; company: string; sms_version: string }[]) ?? [];
        const deltas = (deltasRes.data as { tenant_id: string; to_version: string; created_at: string }[]) ?? [];
        const syncStates = (syncStateRes.data as { vessel_id: string; last_sync_at: string | null; pending_outbox_count: number; failed_outbox_count: number; connection_mode: string; server_reachable: boolean }[]) ?? [];

        const tenantMap = new Map(tenants.map((t) => [t.id, t]));
        const syncStateMap = new Map(syncStates.map((s) => [s.vessel_id, s]));

        const syncRows: FleetSyncRow[] = vessels.map((v) => {
          const tenant = tenantMap.get(v.tenant_id);
          const tenantDeltas = deltas.filter((d) => d.tenant_id === v.tenant_id);
          const pendingDeltas = tenantDeltas.filter((d) => d.to_version !== v.sms_active_version).length;
          const syncState = syncStateMap.get(v.id);

          // Use centralized sync state for last_sync and outbox counts
          const lastSync = syncState?.last_sync_at ?? v.last_sync_at;
          const pendingOutbox = syncState?.pending_outbox_count ?? 0;
          const failedOutbox = syncState?.failed_outbox_count ?? 0;
          const connectionMode = syncState?.connection_mode ?? 'VESSEL_SERVER_LAN';

          let status: FleetSyncRow['status'] = 'synced';
          if (!lastSync) {
            status = 'offline';
          } else if (pendingDeltas > 0 || pendingOutbox > 0) {
            status = 'pending';
          } else {
            const syncedAt = new Date(lastSync).getTime();
            const dayMs = 24 * 60 * 60 * 1000;
            if (Date.now() - syncedAt > 3 * dayMs) status = 'stale';
          }

          return {
            vesselName: v.name,
            company: tenant?.company ?? '—',
            smsVersion: v.sms_active_version,
            lastSync,
            pendingDeltas,
            pendingOutbox,
            failedOutbox,
            connectionMode,
            status,
          };
        });

        if (mounted) {
          setRows(syncRows);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const stats = {
    total: rows.length,
    synced: rows.filter((r) => r.status === 'synced').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    offline: rows.filter((r) => r.status === 'offline').length,
    stale: rows.filter((r) => r.status === 'stale').length,
  };

  const statusBadge = (s: FleetSyncRow['status']) => {
    const map = {
      synced: { tone: 'success' as const, label: 'Synced' },
      pending: { tone: 'warning' as const, label: 'Pending' },
      offline: { tone: 'danger' as const, label: 'Offline' },
      stale: { tone: 'neutral' as const, label: 'Stale' },
    };
    const { tone, label } = map[s];
    return <Badge tone={tone} dot className="!text-[10px]">{label}</Badge>;
  };

  return (
    <Card
      title="Fleet Sync Status Matrix — Unified Vessel Sync"
      subtitle="Centralized sync state across all modules (SMS, Rest Hours, Galley, etc.) per vessel"
      icon={<GitBranch className="h-4 w-4" />}
      actions={<Badge tone="neutral">{stats.total} vessels</Badge>}
    >
      <div className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FleetSyncStat icon={<Check className="h-3.5 w-3.5" />} label="Synced" value={stats.synced} tone="success" />
          <FleetSyncStat icon={<UploadCloud className="h-3.5 w-3.5" />} label="Pending" value={stats.pending} tone="warning" />
          <FleetSyncStat icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Offline" value={stats.offline} tone="danger" />
          <FleetSyncStat icon={<Clock className="h-3.5 w-3.5" />} label="Stale (>3d)" value={stats.stale} tone="neutral" />
        </div>

        {/* Vessel matrix table */}
        {loading ? (
          <div className="py-8 text-center text-sm text-ink-400">Loading fleet sync data…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-400">No vessels found.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50/80 text-[11px] uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Vessel</th>
                  <th className="px-4 py-2.5 font-semibold">Company</th>
                  <th className="px-4 py-2.5 font-semibold">SMS Version</th>
                  <th className="px-4 py-2.5 font-semibold">Last Sync</th>
                  <th className="px-4 py-2.5 font-semibold">Pending Deltas</th>
                  <th className="px-4 py-2.5 font-semibold">Outbox Queue</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.map((r) => (
                  <tr key={r.vesselName} className="bg-white transition-colors hover:bg-primary-50/30 dark:bg-ink-900 dark:hover:bg-ink-800/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Ship className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                        <span className="font-medium text-ink-800 dark:text-ink-200">{r.vesselName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">{r.company}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs font-bold text-primary-600 dark:text-primary-400">v{r.smsVersion}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                      {r.lastSync ? new Date(r.lastSync).toLocaleDateString() + ' ' + new Date(r.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.pendingDeltas > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
                          <RefreshCw className="h-2.5 w-2.5" /> {r.pendingDeltas} pending
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.pendingOutbox > 0 || r.failedOutbox > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {r.pendingOutbox > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-400">
                              <UploadCloud className="h-2.5 w-2.5" /> {r.pendingOutbox} queued
                            </span>
                          )}
                          {r.failedOutbox > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                              <AlertTriangle className="h-2.5 w-2.5" /> {r.failedOutbox} failed
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-lg bg-primary-50/60 p-3 text-xs text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
          <Package className="h-3.5 w-3.5 shrink-0" />
          <span>All modules (SMS, Rest Hours, Galley, etc.) share a single unified sync pipeline. Top-down delta pushes and bottom-up outbox queues flow through the same satellite link — no module needs its own network engine.</span>
        </div>
      </div>
    </Card>
  );
}

function FleetSyncStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const tones = {
    success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
    neutral: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
      <div className={`flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}>{icon}</div>
      <div>
        <p className="text-lg font-bold text-ink-900 dark:text-white">{value}</p>
        <p className="text-[10px] font-medium text-ink-500 dark:text-ink-400">{label}</p>
      </div>
    </div>
  );
}
