import { useState } from 'react';
import { Building2, Plus, Pencil, Ban, CheckCircle2, LogIn, ShieldCheck, Archive, RotateCcw, ArchiveRestore, Trash2, ExternalLink, Grid3x3 } from 'lucide-react';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Toggle } from '../components/Toggle';
import { Badge, StatusBadge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { DataTable, type Column } from '../components/DataTable';
import { CriticalActionWizard, type CriticalTarget } from '../components/CriticalActionWizard';
import { useStore } from '../store';
import { useAuth } from '../lib/auth';
import { PLAN_DEFAULTS, PLAN_TIERS, formatUtc } from '../constants';
import type { Capabilities } from '../lib/permissions';
import type { DocTreeKind, DocumentNode, PlanTier, Tenant, TenantStatus } from '../types';
import { isDemoMode } from '../lib/demoData';

export function TenantsView({ caps }: { caps: Capabilities }) {
  const { tenants, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function loginAsTenant(t: Tenant) {
    const demoTenantId = t.demoTenantId;
    if (demoTenantId) {
      const params = new URLSearchParams();
      params.set('view', 'company');
      params.set('tenant', demoTenantId);
      window.open(`${window.location.pathname}?${params.toString()}`, 'maritime_company', 'width=1100,height=800,scrollbars=1');
      toast({ tone: 'info', title: 'Opening Company Admin', message: `Switching to ${t.company} workspace in a new window.` });
    } else {
      dispatch({ type: 'IMPERSONATE_START', tenantId: t.id });
      toast({ tone: 'info', title: 'Impersonation started', message: `Simulating session as ${t.company} Admin (Read-Only Audit Mode).` });
    }
  }

  // Master Tenant Ledger filter toggle: Active/Trial vs Archived.
  const visibleTenants = showArchived
    ? tenants.filter((t) => t.status === 'archived')
    : tenants.filter((t) => t.status !== 'archived');

  const columns: Column<Tenant>[] = [
    {
      key: 'company',
      header: 'Company',
      width: 'min-w-[280px]',
      sortValue: (t) => t.company,
      render: (t) => (
        <div className="flex items-center gap-2.5 py-0.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
            {t.company.split(' ').slice(0, 2).map((w) => w[0]).join('')}
          </div>
          <div className="min-w-0">
            <p className="whitespace-normal text-sm font-semibold leading-tight text-ink-900 dark:text-white">{t.company}</p>
            <p className="text-[11px] leading-tight text-ink-400">{t.id} · {t.region}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      sortValue: (t) => t.plan,
      render: (t) => (
        <select
          value={t.plan}
          disabled={!caps.tenantEdit || t.status === 'archived'}
          onChange={(e) => {
            dispatch({ type: 'TENANT_SET_PLAN', id: t.id, plan: e.target.value as PlanTier });
            toast({ tone: 'success', title: 'Plan updated', message: `${t.company} → ${e.target.value}.` });
          }}
          className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-ink-700 focus:border-primary-500 focus:outline-none disabled:opacity-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
        >
          {PLAN_TIERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ),
    },
    {
      key: 'limits',
      header: 'Assigned Limits',
      width: 'min-w-[200px]',
      render: (t) => {
        const overV = t.vessels.used > t.vessels.max;
        const overS = t.seats.used > t.seats.max;
        const overG = t.storageGb.used > t.storageGb.max;
        return (
          <div className="space-y-1 py-0.5">
            <MiniLimit label="Ships" used={t.vessels.used} max={t.vessels.max} over={overV} />
            <MiniLimit label="Users" used={t.seats.used} max={t.seats.max} over={overS} />
            <MiniLimit label="GB" used={t.storageGb.used} max={t.storageGb.max} over={overG} />
            {(overV || overS || overG) && (
              <Badge tone="danger" dot pulse className="!text-[10px]">Over Limit</Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'features',
      header: 'Feature Flags',
      render: (t) => (
        <div className="flex items-center gap-1.5 py-0.5">
          <Badge tone="info" className="!text-[10px] !px-1.5 !py-0">{t.modules.length} active</Badge>
          {caps.tenantEdit && t.status !== 'archived' && (
            <span className="text-[10px] font-medium text-ink-400" title="Module licensing is managed in the Tenant Feature Matrix">
              <Grid3x3 className="inline h-3 w-3" /> Matrix
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (t) => t.status,
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'min-w-[200px]',
      render: (t) => (
        <div className="flex items-center gap-1">
          {t.status === 'archived' ? (
            caps.tenantArchive ? (
              <button
                onClick={() => {
                  dispatch({ type: 'TENANT_SET_STATUS', id: t.id, status: 'active' });
                  toast({ tone: 'success', title: 'Tenant restored', message: `${t.company} reactivated. Login access re-enabled.` });
                }}
                className="inline-flex items-center gap-1 rounded bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold text-success-700 hover:bg-success-100 dark:bg-success-900/30 dark:text-success-300 dark:hover:bg-success-900/50"
                title="Restore Tenant"
              >
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            ) : (
              <span className="text-[10px] text-ink-400">Archived</span>
            )
          ) : (
            <>
              <button
                onClick={() => setEditing(t)}
                disabled={!caps.tenantEdit}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-ink-700 dark:hover:text-ink-200"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {t.status === 'active' || t.status === 'trial' ? (
                <button
                  onClick={() => { dispatch({ type: 'TENANT_SET_STATUS', id: t.id, status: 'suspended' }); toast({ tone: 'warning', title: 'Suspended', message: t.company }); }}
                  disabled={!caps.tenantEdit}
                  className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                  title="Suspend"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => { dispatch({ type: 'TENANT_SET_STATUS', id: t.id, status: 'active' }); toast({ tone: 'success', title: 'Activated', message: t.company }); }}
                  disabled={!caps.tenantEdit}
                  className="rounded p-1 text-ink-400 hover:bg-success-50 hover:text-success-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-success-900/30 dark:hover:text-success-400"
                  title="Activate"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.tenantArchive && (
                <button
                  onClick={() => setArchiveConfirm(t)}
                  className="rounded p-1 text-ink-400 hover:bg-ink-200 hover:text-ink-700 dark:hover:bg-ink-700 dark:hover:text-ink-200"
                  title="Archive Tenant"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.tenantArchive && (
                <button
                  onClick={() => setDeleteTarget(t)}
                  className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                  title="Delete Tenant"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.impersonate && (
                <button
                  onClick={() => loginAsTenant(t)}
                  className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                  title="Login As"
                >
                  <LogIn className="h-3 w-3" /> Login As
                </button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Tenant & Company Management</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Onboard, configure and govern shipping company tenants.</p>
        </div>
        <button onClick={() => setCreating(true)} disabled={!caps.tenantProvision} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-4 w-4" /> Provision Tenant
        </button>
      </div>

      <Card title="Master Tenant Ledger" subtitle="All shipping company accounts on the platform" icon={<Building2 className="h-4 w-4" />}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5 dark:border-ink-700 dark:bg-ink-800">
            <button
              onClick={() => setShowArchived(false)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${!showArchived ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-white' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400'}`}
            >
              Show Active / Trial
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${showArchived ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-white' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400'}`}
            >
              Show Archived
            </button>
          </div>
          <span className="text-xs text-ink-400">
            {showArchived ? `${visibleTenants.length} archived tenant(s)` : `${visibleTenants.length} active / trial tenant(s)`}
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={visibleTenants}
          pageSize={8}
          searchPlaceholder="Search companies, IDs, regions…"
          searchFn={(t, q) =>
            t.company.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            t.region.toLowerCase().includes(q) ||
            t.contactEmail.toLowerCase().includes(q)
          }
          compact
        />
      </Card>

      {(editing || creating) && (
        <TenantFormModal
          tenant={editing}
          canEditStatus={caps.tenantEdit}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={(tenant) => {
            if (editing) {
              dispatch({ type: 'TENANT_UPDATE', id: editing.id, patch: tenant });
              toast({ tone: 'success', title: 'Tenant updated', message: `${tenant.company} saved.` });
            } else {
              const newTenant: Tenant = { ...tenant, id: `T-${1000 + tenants.length + Math.floor(Math.random() * 90)}` };
              dispatch({ type: 'TENANT_CREATE', tenant: newTenant });
              toast({ tone: 'success', title: 'Tenant provisioned', message: `${newTenant.company} (${newTenant.id}) created.` });
            }
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      {archiveConfirm && (
        <Modal
          open
          onClose={() => setArchiveConfirm(null)}
          title="Archive Tenant"
          subtitle={`${archiveConfirm.company} · ${archiveConfirm.id}`}
          icon={<Archive className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setArchiveConfirm(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  dispatch({ type: 'TENANT_SET_STATUS', id: archiveConfirm.id, status: 'archived' });
                  toast({ tone: 'warning', title: 'Tenant archived', message: `${archiveConfirm.company} archived. Login blocked for all users. Records retained.` });
                  setArchiveConfirm(null);
                }}
                className="btn-primary"
              >
                <ArchiveRestore className="h-4 w-4" /> Archive & block logins
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            Archiving <strong>{archiveConfirm.company}</strong> will instantly block login access for all users across shore and ship portals.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-ink-500 dark:text-ink-400">
            <li>· All tenant database records, SMS history, and audit logs are retained for compliance.</li>
            <li>· The tenant is excluded from active subscription revenue calculations.</li>
            <li>· The tenant can be restored at any time using the Restore action.</li>
          </ul>
        </Modal>
      )}

      {deleteTarget && (
        <CriticalActionWizard
          target={{
            kind: 'Tenant',
            title: deleteTarget.company,
            subtitle: deleteTarget.id,
            rows: [
              { label: 'Tenant ID', value: deleteTarget.id },
              { label: 'Name', value: deleteTarget.company },
              { label: 'Created Date', value: formatUtc(deleteTarget.createdAt) },
              { label: 'Active Vessels', value: `${deleteTarget.vessels.used} / ${deleteTarget.vessels.max}` },
              { label: 'Assigned Users', value: `${deleteTarget.seats.used} / ${deleteTarget.seats.max}` },
              { label: 'Data Size', value: `${deleteTarget.storageGb.used} GB / ${deleteTarget.storageGb.max} GB` },
              { label: 'Plan', value: deleteTarget.plan },
              { label: 'Region', value: deleteTarget.region },
            ],
            acknowledgements: [
              `I acknowledge this will sever all shipboard SMS access for ${deleteTarget.vessels.used} active vessel(s).`,
              'I understand historical logs and audit trails will be archived in the Platform Security ledger.',
              `I confirm this deletion is scoped to ${deleteTarget.id} only and will not affect any other tenant.`,
            ],
            confirmPhrase: `DELETE ${deleteTarget.id}`,
            confirmHint: `DELETE ${deleteTarget.id}`,
          }}
          actorEmail={user?.email ?? 'unknown'}
          onClose={() => setDeleteTarget(null)}
          onExecute={(payload) => {
            dispatch({ type: 'TENANT_DELETE', id: deleteTarget.id });
            toast({ tone: 'danger', title: 'Tenant permanently deleted', message: `${deleteTarget.company} (${deleteTarget.id}) removed. Audit entry: ${payload.timestamp}.` });
            setDeleteTarget(null);
          }}
        />
      )}

    </div>
  );
}

function MiniLimit({ label, used, max, over }: { label: string; used: number; max: number; over: boolean }) {
  const pct = Math.min(100, (used / max) * 100);
  const tone = over ? 'danger' : pct > 85 ? 'warning' : 'success';
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 text-[10px] text-ink-400">{label}</span>
      <div className="w-20 shrink-0">
        <ProgressBar value={used} max={max} tone={tone as 'success' | 'warning' | 'danger'} size="sm" />
      </div>
      <span className={`text-[10px] font-medium tabular-nums ${over ? 'text-danger-600 dark:text-danger-400' : 'text-ink-500'}`}>
        {used}/{max}
      </span>
    </div>
  );
}

function TenantFormModal({ tenant, canEditStatus, onClose, onSave }: { tenant: Tenant | null; canEditStatus: boolean; onClose: () => void; onSave: (t: Tenant) => void }) {
  const [form, setForm] = useState<Tenant>(
    tenant ?? {
      id: '',
      company: '',
      contactEmail: '',
      plan: 'Professional',
      status: 'provisioning',
      seats: { used: 0, max: PLAN_DEFAULTS.Professional.seats },
      vessels: { used: 0, max: PLAN_DEFAULTS.Professional.vessels },
      storageGb: { used: 0, max: PLAN_DEFAULTS.Professional.storageGb },
      modules: ['voyage_logging', 'crew_matrix'],
      mfaEnforced: true,
      createdAt: new Date().toISOString(),
      contractExpires: new Date(Date.now() + 365 * 86400000).toISOString(),
      monthlyRevenue: PLAN_DEFAULTS.Professional.monthly,
      region: 'EMEA',
      docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[],
      docClones: {} as Record<DocTreeKind, DocumentNode>,
    },
  );

  const setPlan = (plan: PlanTier) => {
    const d = PLAN_DEFAULTS[plan];
    setForm((f) => ({ ...f, plan, vessels: { ...f.vessels, max: d.vessels }, seats: { ...f.seats, max: d.seats }, storageGb: { ...f.storageGb, max: d.storageGb }, monthlyRevenue: d.monthly }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tenant ? 'Edit Tenant' : 'Provision New Tenant'}
      subtitle="Configure company profile, limits and assigned modules"
      icon={<Building2 className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => { if (form.company.trim()) onSave(form); }} className="btn-primary" disabled={!form.company.trim()}>
            {tenant ? 'Save changes' : 'Provision tenant'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Company Name</label>
          <input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="e.g. Atlantic Liquid Bulk" />
        </div>
        <div>
          <label className="label">Contact Email</label>
          <input className="input" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="fleet.ops@company.com" />
        </div>
        <div>
          <label className="label">Region</label>
          <select className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
            {['EMEA', 'APAC', 'MEA', 'AMER'].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Plan Tier</label>
          <select className="input" value={form.plan} onChange={(e) => setPlan(e.target.value as PlanTier)}>
            {PLAN_TIERS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} disabled={!canEditStatus} onChange={(e) => setForm({ ...form, status: e.target.value as TenantStatus })}>
            {['active', 'suspended', 'trial', 'provisioning', 'archived'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Max Vessels</label>
          <input type="number" className="input" value={form.vessels.max} onChange={(e) => setForm({ ...form, vessels: { ...form.vessels, max: +e.target.value } })} />
        </div>
        <div>
          <label className="label">Max Users</label>
          <input type="number" className="input" value={form.seats.max} onChange={(e) => setForm({ ...form, seats: { ...form.seats, max: +e.target.value } })} />
        </div>
        <div>
          <label className="label">Storage Quota (GB)</label>
          <input type="number" className="input" value={form.storageGb.max} onChange={(e) => setForm({ ...form, storageGb: { ...form.storageGb, max: +e.target.value } })} />
        </div>
        <div>
          <label className="label">Monthly Revenue (USD)</label>
          <input type="number" className="input" value={form.monthlyRevenue} onChange={(e) => setForm({ ...form, monthlyRevenue: +e.target.value })} />
        </div>
        <div>
          <label className="label">Contract Expires</label>
          <input type="date" className="input" value={form.contractExpires.slice(0, 10)} onChange={(e) => setForm({ ...form, contractExpires: new Date(e.target.value).toISOString() })} />
        </div>
        <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <span className="text-sm font-medium text-ink-800 dark:text-ink-100">Enforce MFA for all tenant users</span>
          </div>
          <Toggle checked={form.mfaEnforced} onChange={(v) => setForm({ ...form, mfaEnforced: v })} />
        </div>
      </div>
    </Modal>
  );
}
