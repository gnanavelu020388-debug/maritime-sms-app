import { useEffect, useState } from 'react';
import {
  Rocket, Building2, Users, Plus, Shield, Ship, FileText, Eye,
  Loader2, CheckCircle2, ExternalLink, RefreshCw, Trash2, KeyRound,
} from 'lucide-react';
import { supabase, type TenantRow, type TenantUserRow, type Rank } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logAudit } from '../lib/audit';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import type { Capabilities } from '../lib/permissions';

const RANK_TO_ROLE: { rank: Rank; role: 'company_admin' | 'dpa' | 'vessel'; window: string }[] = [
  { rank: 'DPA', role: 'dpa', window: 'Company / DPA Workspace' },
  { rank: 'Master', role: 'vessel', window: 'Vessel Portal (read-only)' },
  { rank: 'Chief Engineer', role: 'vessel', window: 'Vessel Portal (read-only)' },
  { rank: 'Chief Mate', role: 'vessel', window: 'Vessel Portal (read-only)' },
  { rank: 'Crew', role: 'vessel', window: 'Vessel Portal (read-only)' },
];

// Special rank used in the form to designate a Company Admin (not in the normal Rank union)
const COMPANY_ADMIN_RANK = '__company_admin__';

export function ProvisioningView({ caps }: { caps: Capabilities }) {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [usersByTenant, setUsersByTenant] = useState<Record<string, TenantUserRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [showTenant, setShowTenant] = useState(false);
  const [showUser, setShowUser] = useState<{ tenant: TenantRow } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TenantRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: t } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
    const tenants = (t as TenantRow[]) ?? [];
    setTenants(tenants);
    const map: Record<string, TenantUserRow[]> = {};
    await Promise.all(tenants.map(async (tn) => {
      const { data: u } = await supabase.from('tenant_users').select('*').eq('tenant_id', tn.id).order('name');
      map[tn.id] = (u as TenantUserRow[]) ?? [];
    }));
    setUsersByTenant(map);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function cloneMasterSms(tenantId: string) {
    // Seed the locked regulatory headers for the new tenant (Flexible Template clone)
    const headers = [
      { label: 'Section 1: General', tree_kind: 'sms' },
      { label: 'Section 2: Company Organization', tree_kind: 'sms' },
      { label: 'Section 3: Shipboard Organization', tree_kind: 'sms' },
      { label: "Section 4: Master's Authority", tree_kind: 'sms' },
      { label: 'Section 5: Crew Training', tree_kind: 'sms' },
      { label: 'Section 6: Emergency Preparedness', tree_kind: 'sms' },
      { label: 'Section 7: Maintenance', tree_kind: 'sms' },
    ];
    const rows = headers.map((h, i) => ({
      tenant_id: tenantId, parent_id: null, tree_kind: h.tree_kind, label: h.label,
      node_kind: 'folder' as const, is_regulatory_header: true, approval_state: 'approved' as const,
      sort_order: i, version: '1.0.0',
    }));
    await supabase.from('sms_documents').insert(rows);
  }

  async function createTenant(data: { company: string; contact_email: string; plan: string; vessels_max: number; seats_max: number; region: string }) {
    setBusy(true);
    setFormError(null);
    const { data: t, error } = await supabase.from('tenants').insert({
      company: data.company, contact_email: data.contact_email, plan: data.plan,
      vessels_max: data.vessels_max, seats_max: data.seats_max, region: data.region,
      status: 'active',
    }).select().single();
    if (error) {
      setFormError(error.message);
      setBusy(false);
      return;
    }
    if (t) {
      await cloneMasterSms((t as TenantRow).id);
      await logAudit({ actorEmail: user?.email ?? 'super-admin', category: 'tenant', action: `Provisioned tenant: ${data.company}`, target: data.contact_email });
    }
    setBusy(false);
    setShowTenant(false);
    load();
  }

  async function provisionUser(tenant: TenantRow, data: { name: string; email: string; roleChoice: string; nationality: string }) {
    setBusy(true);
    setFormError(null);
    const isCompanyAdmin = data.roleChoice === COMPANY_ADMIN_RANK;
    const rank = isCompanyAdmin ? ('DPA' as Rank) : (data.roleChoice as Rank);
    const role = isCompanyAdmin ? 'company_admin' : (RANK_TO_ROLE.find((r) => r.rank === data.roleChoice)?.role ?? 'vessel');
    const { error } = await supabase.from('tenant_users').insert({
      tenant_id: tenant.id, name: data.name, email: data.email.toLowerCase().trim(), rank, role, status: 'invited', nationality: data.nationality || null,
    });
    if (error) {
      setFormError(error.message);
      setBusy(false);
      return;
    }
    await logAudit({ tenantId: tenant.id, actorEmail: user?.email ?? 'super-admin', category: 'security', action: `Provisioned ${role}: ${data.name} <${data.email}>`, target: data.email, location: tenant.company });
    setBusy(false);
    setShowUser(null);
    load();
  }

  async function removeUser(u: TenantUserRow) {
    if (!confirm(`Remove ${u.name}? They will lose access immediately.`)) return;
    await supabase.from('tenant_users').delete().eq('id', u.id);
    load();
  }

  async function deleteTenant(t: TenantRow) {
    setBusy(true);
    await supabase.from('tenants').delete().eq('id', t.id);
    await logAudit({ actorEmail: user?.email ?? 'super-admin', category: 'tenant', action: `Deleted tenant: ${t.company}`, target: t.contact_email, severity: 'warning' });
    setBusy(false);
    setConfirmDelete(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink-900 dark:text-white">
            <Rocket className="h-5 w-5 text-primary-500" /> Live Provisioning Studio
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Create real tenants and provision users to exercise all three role windows end-to-end.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="btn-secondary whitespace-nowrap"><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button onClick={() => setShowTenant(true)} disabled={!caps.provisioningWrite} className="btn-primary whitespace-nowrap px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> New Tenant</button>
        </div>
      </div>

      {/* How-to */}
      <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 text-sm dark:border-primary-800 dark:bg-primary-900/20">
        <p className="mb-2 font-bold text-primary-800 dark:text-primary-300">How to view all 3 windows</p>
        <ol className="list-decimal space-y-1 pl-5 text-primary-700 dark:text-primary-300">
          <li>Create a tenant below (sets license ceilings + clones the locked SMS template).</li>
          <li>Provision users in that tenant — pick <strong>Company Admin</strong>, <strong>DPA</strong>, or a vessel rank (Master/Chief Engineer/Crew).</li>
          <li>Open the app in a new browser/incognito window and <strong>sign up with the provisioned user's email</strong> + any password (6+ chars). The account auto-links to the provisioned role on first login.</li>
          <li>Repeat per role to see all three windows: Super Admin, Company/DPA Workspace, Vessel Portal.</li>
        </ol>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-500" /></div>
      ) : tenants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 p-12 text-center dark:border-ink-700">
          <Building2 className="mx-auto h-10 w-10 text-ink-300" />
          <p className="mt-3 text-sm text-ink-500">No live tenants yet. Create your first one to start provisioning users.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tenants.map((t) => {
            const users = usersByTenant[t.id] ?? [];
            const usagePct = t.vessels_max > 0 ? 0 : 0; // vessels counted elsewhere
            return (
              <div key={t.id} className="rounded-xl border border-ink-200/70 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
                <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-ink-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold text-ink-900 dark:text-white">{t.company}</p>
                      <p className="text-xs text-ink-400">{t.contact_email} · {t.plan} · {t.region} · SMS v{t.sms_version}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="success" dot>{t.status}</Badge>
                    <span className="whitespace-nowrap text-xs font-medium text-ink-400">{users.length}/{t.seats_max} users</span>
                    <button onClick={() => setShowUser({ tenant: t })} disabled={!caps.provisioningWrite} className="btn-primary whitespace-nowrap px-4 py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Provision User</button>
                    {caps.provisioningWrite && (
                      <button onClick={() => setConfirmDelete(t)} className="rounded-lg border border-danger-200 bg-danger-50 p-1.5 text-danger-600 hover:bg-danger-100 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-400" title="Delete tenant"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  {users.length === 0 ? (
                    <p className="text-sm text-ink-400">No users provisioned yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-ink-400">
                          <tr>
                            <th className="min-w-[140px] px-4 py-3 font-semibold">Name</th>
                            <th className="min-w-[200px] px-4 py-3 font-semibold">Email (sign-in)</th>
                            <th className="min-w-[120px] px-4 py-3 font-semibold">Role</th>
                            <th className="min-w-[180px] px-4 py-3 font-semibold">Window</th>
                            <th className="min-w-[140px] px-4 py-3 font-semibold">Account</th>
                            <th className="w-16 px-4 py-3 font-semibold"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                          {users.map((u) => {
                            const window = u.role === 'company_admin' ? 'Company Admin Workspace' :
                              u.role === 'dpa' ? 'DPA Workspace' : 'Vessel Portal (read-only)';
                            return (
                              <tr key={u.id} className="hover:bg-ink-50/40 dark:hover:bg-ink-800/40">
                                <td className="px-4 py-3 font-medium text-ink-800 dark:text-white">{u.name}</td>
                                <td className="px-4 py-3 font-mono text-xs text-ink-600 dark:text-ink-300">{u.email}</td>
                                <td className="px-4 py-3">
                                  <Badge tone={u.role === 'company_admin' ? 'info' : u.role === 'dpa' ? 'accent' : 'neutral'} className="!text-[10px]">{u.role}</Badge>
                                </td>
                                <td className="px-4 py-3 text-xs text-ink-500">{window}</td>
                                <td className="px-4 py-3">
                                  {u.auth_uid ? <Badge tone="success" dot className="!text-[10px]">Linked</Badge> : <Badge tone="warning" dot className="!text-[10px]">Awaiting signup</Badge>}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button onClick={() => removeUser(u)} disabled={!caps.provisioningWrite} className="rounded p-1 text-ink-400 hover:bg-danger-100 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WindowCard icon={<Shield className="h-4 w-4" />} title="Super Admin" desc="This window. Full platform control. Self-register at signup with the Super Admin checkbox." tone="primary" />
        <WindowCard icon={<FileText className="h-4 w-4" />} title="Company Admin / DPA" desc="Provisioned here. Manage fleet, SMS docs, users, audit. DPA approves & deploys." tone="accent" />
        <WindowCard icon={<Eye className="h-4 w-4" />} title="Vessel Portal" desc="Provisioned here. Read-only: search, view, download, print approved docs only." tone="info" />
      </div>

      {showTenant && (
        <TenantFormModal busy={busy} error={formError} onClose={() => { setShowTenant(false); setFormError(null); }} onCreate={createTenant} />
      )}
      {showUser && (
        <UserFormModal tenant={showUser.tenant} busy={busy} error={formError} onClose={() => { setShowUser(null); setFormError(null); }} onCreate={(d) => provisionUser(showUser.tenant, d)} />
      )}
      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title="Delete Tenant" subtitle="This action is permanent and cannot be undone" icon={<Trash2 className="h-5 w-5 text-danger-500" />}
          footer={
            <>
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
              <button disabled={busy} onClick={() => deleteTenant(confirmDelete)} className="btn-danger">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="h-4 w-4" /> Delete Permanently</>}
              </button>
            </>
          }>
          <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 dark:border-danger-800 dark:bg-danger-900/20">
            <p className="text-sm font-semibold text-danger-800 dark:text-danger-300">You are about to delete:</p>
            <p className="mt-1 text-lg font-bold text-danger-900 dark:text-white">{confirmDelete.company}</p>
            <p className="text-xs text-danger-600 dark:text-danger-400">{confirmDelete.contact_email} · {confirmDelete.plan} · {confirmDelete.region}</p>
            <p className="mt-3 text-xs text-danger-700 dark:text-danger-300">
              All vessels, crew assignments, SMS documents, audit logs, and provisioned users for this tenant will be <strong>permanently deleted</strong> (cascade).
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WindowCard({ icon, title, desc, tone }: { icon: React.ReactNode; title: string; desc: string; tone: 'primary' | 'accent' | 'info' }) {
  const cls = {
    primary: 'border-primary-200 bg-primary-50/50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300',
    accent: 'border-accent-200 bg-accent-50/50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
    info: 'border-ink-200 bg-ink-50 text-ink-700 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300',
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">{icon}{title}</div>
      <p className="text-xs opacity-90">{desc}</p>
    </div>
  );
}

function TenantFormModal({ busy, error, onClose, onCreate }: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (d: { company: string; contact_email: string; plan: string; vessels_max: number; seats_max: number; region: string }) => void;
}) {
  const [f, setF] = useState({ company: '', contact_email: '', plan: 'Standard', vessels_max: 5, seats_max: 25, region: 'EMEA' });
  return (
    <Modal open onClose={onClose} title="Create Live Tenant" subtitle="Provisions a real company + clones the locked SMS template" icon={<Building2 className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={busy || !f.company || !f.contact_email} onClick={() => onCreate(f)} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Rocket className="h-4 w-4" /> Provision</>}</button></>}>
      {error && <div className="mb-4 rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">{error}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Company Name</label><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Contact Email</label><input className="input" type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></div>
        <div><label className="label">Plan</label><select className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option>Standard</option><option>Professional</option><option>Enterprise</option><option>Custom</option></select></div>
        <div><label className="label">Region</label><select className="input" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}><option>EMEA</option><option>APAC</option><option>Americas</option></select></div>
        <div><label className="label">Vessel License Limit</label><input type="number" className="input" value={f.vessels_max} onChange={(e) => setF({ ...f, vessels_max: +e.target.value })} /></div>
        <div><label className="label">User License Limit</label><input type="number" className="input" value={f.seats_max} onChange={(e) => setF({ ...f, seats_max: +e.target.value })} /></div>
      </div>
      <p className="mt-3 rounded-lg bg-primary-50 p-3 text-xs text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
        Creating a tenant clones the Master SMS framework (Section 1–7 regulatory headers) into their isolated workspace, hard-locked against deletion.
      </p>
    </Modal>
  );
}

function UserFormModal({ tenant, busy, error, onClose, onCreate }: {
  tenant: TenantRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (d: { name: string; email: string; roleChoice: string; nationality: string }) => void;
}) {
  const [f, setF] = useState({ name: '', email: '', roleChoice: COMPANY_ADMIN_RANK, nationality: '' });
  return (
    <Modal open onClose={onClose} title={`Provision User — ${tenant.company}`} subtitle="User will sign up with this email; account auto-links on first login" icon={<Users className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={busy || !f.name || !f.email} onClick={() => onCreate(f)} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><KeyRound className="h-4 w-4" /> Provision</>}</button></>}>
      {error && <div className="mb-4 rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">{error}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="label">Full Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label">Email (becomes their sign-in)</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Nationality</label><input className="input" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} /></div>
        <div>
          <label className="label">Role / Window</label>
          <select className="input" value={f.roleChoice} onChange={(e) => setF({ ...f, roleChoice: e.target.value })}>
            <option value={COMPANY_ADMIN_RANK}>Company Admin → Company Admin Workspace</option>
            <option value="DPA">DPA → Company / DPA Workspace</option>
            <option value="Master">Master → Vessel Portal (read-only)</option>
            <option value="Chief Engineer">Chief Engineer → Vessel Portal (read-only)</option>
            <option value="Chief Mate">Chief Mate → Vessel Portal (read-only)</option>
            <option value="Crew">Crew → Vessel Portal (read-only)</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
        <ExternalLink className="h-4 w-4 text-primary-500" />
        After provisioning, open a new incognito window → <strong>Sign Up</strong> with this email + any password (6+ chars). On login they're routed to their role's window automatically.
      </div>
    </Modal>
  );
}
