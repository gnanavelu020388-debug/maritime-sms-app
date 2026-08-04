import { useEffect, useState, useMemo } from 'react';
import {
  Anchor, Clock, Loader2, UserCheck, CheckCircle2, AlertTriangle,
  Zap, Users, Search, UtensilsCrossed,
} from 'lucide-react';
import { supabase, type TenantUserRow, type CrewAssignmentRow, type Rank } from '../../lib/supabase';
import {
  isDemoMode,
  getEffectiveDemoUsers, getEffectiveDemoAssignments,
  demoSignOn, demoSetUserStatus, demoSignOff,
} from '../../lib/demoData';
import { logAudit } from '../../lib/audit';
import { postSyncEvent } from '../../lib/syncChannel';
import { CREW_STATUS } from '../../lib/rankPermissions';
import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from '../../lib/featureFlags';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';

interface PendingCrew {
  user: TenantUserRow;
  assignment: CrewAssignmentRow | null;
}

export function CrewSignOnPanel({
  tenantId, vesselId, vesselName, actorEmail, actorRank, enabledModules,
}: {
  tenantId: string;
  vesselId: string | null;
  vesselName: string;
  actorEmail: string;
  actorRank: Rank | null;
  enabledModules: Set<string>;
}) {
  const [pending, setPending] = useState<PendingCrew[]>([]);
  const [onboard, setOnboard] = useState<PendingCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [signOnFor, setSignOnFor] = useState<TenantUserRow | null>(null);
  const [firstMeal, setFirstMeal] = useState('lunch');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const licensedModuleLabels = useMemo(() => {
    return MODULE_KEYS.filter((k) => enabledModules.has(k)).map((k) => MODULE_LABELS[k as ModuleKey].label);
  }, [enabledModules]);

  const load = async () => {
    if (!tenantId || !vesselId) { setLoading(false); return; }
    setLoading(true);
    if (isDemoMode()) {
      const allUsers = getEffectiveDemoUsers(tenantId);
      const allAssignments = getEffectiveDemoAssignments(tenantId);
      const vesselAssignments = allAssignments.filter((a) => a.vessel_id === vesselId);
      const pendingUsers = allUsers.filter(
        (u) => u.role === 'vessel' && u.status === CREW_STATUS.PENDING_SIGN_ON,
      );
      const onboardUsers = allUsers.filter((u) => {
        const a = vesselAssignments.find((a) => a.user_id === u.id && !a.signed_off_at);
        return !!a;
      });
      setPending(pendingUsers.map((u) => ({
        user: u,
        assignment: vesselAssignments.find((a) => a.user_id === u.id) ?? null,
      })));
      setOnboard(onboardUsers.map((u) => ({
        user: u,
        assignment: vesselAssignments.find((a) => a.user_id === u.id && !a.signed_off_at) ?? null,
      })));
      setLoading(false);
      return;
    }
    const [{ data: users }, { data: assignments }] = await Promise.all([
      supabase.from('tenant_users').select('*').eq('tenant_id', tenantId).eq('role', 'vessel').order('name'),
      supabase.from('crew_assignments').select('*').eq('tenant_id', tenantId).eq('vessel_id', vesselId).is('signed_off_at', null),
    ]);
    const userList = (users as TenantUserRow[]) ?? [];
    const activeAssignments = (assignments as CrewAssignmentRow[]) ?? [];
    setPending(userList.filter((u) => u.status === CREW_STATUS.PENDING_SIGN_ON).map((u) => ({
      user: u,
      assignment: activeAssignments.find((a) => a.user_id === u.id) ?? null,
    })));
    setOnboard(userList.filter((u) => activeAssignments.some((a) => a.user_id === u.id)).map((u) => ({
      user: u,
      assignment: activeAssignments.find((a) => a.user_id === u.id) ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId, vesselId]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  }

  async function executeSignOn(user: TenantUserRow, meal: string) {
    if (!vesselId) return;
    setBusy(user.id);
    const signedOnAt = new Date().toISOString();

    if (isDemoMode()) {
      demoSetUserStatus(tenantId, user.id, 'active');
      demoSignOn(tenantId, user.id, vesselId, user.rank);
    } else {
      await supabase.from('tenant_users').update({ status: 'active', updated_at: signedOnAt }).eq('id', user.id);
      await supabase.from('crew_assignments').insert({
        vessel_id: vesselId, tenant_id: tenantId, user_id: user.id, rank: user.rank,
        signed_on_at: signedOnAt, notes: `First meal: ${meal}`,
      });
    }

    await logAudit({
      tenantId,
      actorEmail,
      category: 'crew',
      action: `MASTER SIGN-ON: ${user.name} (${user.rank}) signed on to ${vesselName}. Universal access activated across ${licensedModuleLabels.length} licensed modules: ${licensedModuleLabels.join(', ')}. First meal: ${meal}.`,
      target: user.email,
      location: vesselName,
      severity: 'info',
    });

    if (enabledModules.has('haccp_galley')) {
      await logAudit({
        tenantId,
        actorEmail,
        category: 'galley',
        action: `VICTUALLING CASCADE: Headcount +1 (${user.name}) on ${vesselName}. Daily meal provisioning calculations adjusted automatically. First meal registered: ${meal}.`,
        target: user.email,
        location: vesselName,
        severity: 'info',
      });
    }

    postSyncEvent({ type: 'CREW_UPDATED', tenantId, payload: { action: 'master_sign_on', userId: user.id, vessel: vesselName, modules: licensedModuleLabels } });
    setBusy(null);
    setSignOnFor(null);
    showToast(`${user.name} signed on successfully. Login access unlocked across ${licensedModuleLabels.length} licensed modules. ${enabledModules.has('haccp_galley') ? 'Galley victualling headcount updated (+1).' : ''}`, true);
    load();
  }

  async function executeSignOff(user: TenantUserRow, assignment: CrewAssignmentRow | null) {
    if (!assignment) return;
    setBusy(user.id);
    if (isDemoMode()) {
      demoSignOff(tenantId, assignment.id);
      demoSetUserStatus(tenantId, user.id, 'active');
    } else {
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() }).eq('id', assignment.id);
    }
    await logAudit({
      tenantId,
      actorEmail,
      category: 'crew',
      action: `MASTER SIGN-OFF: ${user.name} (${user.rank}) signed off from ${vesselName}. Universal access revoked.`,
      target: user.email,
      location: vesselName,
      severity: 'warning',
    });
    if (enabledModules.has('haccp_galley')) {
      await logAudit({
        tenantId,
        actorEmail,
        category: 'galley',
        action: `VICTUALLING CASCADE: Headcount -1 (${user.name}) on ${vesselName}. Daily meal provisioning calculations adjusted.`,
        target: user.email,
        location: vesselName,
        severity: 'info',
      });
    }
    postSyncEvent({ type: 'CREW_UPDATED', tenantId, payload: { action: 'master_sign_off', userId: user.id, vessel: vesselName } });
    setBusy(null);
    showToast(`${user.name} signed off. Login access revoked. ${enabledModules.has('haccp_galley') ? 'Galley victualling headcount updated (-1).' : ''}`, true);
    load();
  }

  const filteredPending = pending.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.user.name.toLowerCase().includes(q) || p.user.rank.toLowerCase().includes(q);
  });

  if (loading) {
    return <div className="py-10 text-center text-sm text-ink-400">Loading crew data…</div>;
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.ok ? 'bg-success-500 text-white' : 'bg-danger-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
            <Anchor className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink-900 dark:text-white">Crew Sign-On Management</h2>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {vesselName} · Acting as {actorRank}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Universal Access Activation</p>
            <p className="mt-0.5">Signing on a crew member instantly unlocks their login access across <strong>all {licensedModuleLabels.length} licensed platform modules</strong> ({licensedModuleLabels.join(', ')}). The Galley/HACCP module also receives a victualling headcount update (+1) to adjust meal provisioning automatically.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 p-4 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning-500" />
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">Pending Sign-On Approvals</h3>
            {pending.length > 0 && <Badge tone="warning" className="!text-[10px]">{pending.length}</Badge>}
          </div>
          {pending.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input className="input !py-1.5 !text-xs pl-8" placeholder="Search pending crew…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
        </div>
        {filteredPending.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success-400" />
            <p className="text-sm text-ink-500">No pending crew members awaiting sign-on.</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {filteredPending.map((p) => (
              <div key={p.user.id} className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning-100 text-xs font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-300">
                  {p.user.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink-900 dark:text-white">{p.user.name}</p>
                  <p className="text-[11px] text-ink-400">{p.user.rank} · {p.user.email}</p>
                </div>
                <button
                  onClick={() => { setSignOnFor(p.user); setFirstMeal('lunch'); }}
                  disabled={busy === p.user.id}
                  className="flex items-center gap-1.5 rounded-lg bg-success-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-success-600 disabled:opacity-40"
                >
                  {busy === p.user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                  Sign On
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-2 border-b border-ink-100 p-4 dark:border-ink-800">
          <Users className="h-4 w-4 text-success-500" />
          <h3 className="text-sm font-bold text-ink-900 dark:text-white">Crew Currently On Board</h3>
          <Badge tone="success" className="!text-[10px]">{onboard.length}</Badge>
        </div>
        {onboard.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-400">No crew currently signed on.</div>
        ) : (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {onboard.map((p) => (
              <div key={p.user.id} className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success-100 text-xs font-bold text-success-700 dark:bg-success-900/30 dark:text-success-300">
                  {p.user.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink-900 dark:text-white">{p.user.name}</p>
                  <p className="text-[11px] text-ink-400">
                    {p.user.rank} · Signed on {p.assignment?.signed_on_at ? new Date(p.assignment.signed_on_at).toLocaleDateString() : '—'}
                  </p>
                </div>
                <button
                  onClick={() => executeSignOff(p.user, p.assignment)}
                  disabled={busy === p.user.id}
                  className="rounded-lg bg-warning-50 px-3 py-2 text-xs font-bold text-warning-700 transition hover:bg-warning-100 disabled:opacity-40 dark:bg-warning-900/30 dark:text-warning-300"
                >
                  {busy === p.user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Sign Off'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {signOnFor && (
        <Modal
          open
          onClose={() => setSignOnFor(null)}
          title="Confirm Crew Sign-On"
          subtitle={`${signOnFor.name} · ${signOnFor.rank}`}
          icon={<UserCheck className="h-5 w-5" />}
          size="md"
          footer={
            <>
              <button onClick={() => setSignOnFor(null)} className="btn-secondary" disabled={busy === signOnFor.id}>Cancel</button>
              <button
                onClick={() => executeSignOn(signOnFor, firstMeal)}
                disabled={busy === signOnFor.id}
                className="btn-primary !bg-success-600 !text-white hover:!bg-success-700 flex items-center gap-2"
              >
                {busy === signOnFor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm Sign-On
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 dark:border-primary-800 dark:bg-primary-900/20">
              <p className="text-sm font-bold text-primary-800 dark:text-primary-200">Universal Access Activation</p>
              <p className="mt-1 text-xs text-primary-700 dark:text-primary-300">
                {signOnFor.name} will gain login access to <strong>all {licensedModuleLabels.length} licensed modules</strong>:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {licensedModuleLabels.map((label) => (
                  <span key={label} className="rounded-md bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {enabledModules.has('haccp_galley') && (
              <div className="flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 p-3 text-xs text-success-700 dark:border-success-800 dark:bg-success-900/20 dark:text-success-300">
                <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">Galley Victualling Cascade</p>
                  <p className="mt-0.5">The HACCP/Galley module will automatically update victualling headcount (+1) and adjust daily meal provisioning calculations.</p>
                </div>
              </div>
            )}

            <div>
              <label className="label">First Meal On Board *</label>
              <p className="mb-2 text-[11px] text-ink-400">Used for galley victualling calculations — the first meal the crew member will consume on board.</p>
              <div className="grid grid-cols-3 gap-2">
                {['breakfast', 'lunch', 'dinner'].map((meal) => (
                  <button
                    key={meal}
                    onClick={() => setFirstMeal(meal)}
                    className={`rounded-lg border-2 p-2.5 text-sm font-semibold capitalize transition ${
                      firstMeal === meal
                        ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/20 dark:text-primary-300'
                        : 'border-ink-200 text-ink-500 hover:border-ink-300 dark:border-ink-700 dark:text-ink-400'
                    }`}
                  >
                    {meal}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Sign-on time will be recorded as <strong>{new Date().toLocaleString()}</strong>. This action is logged to the audit trail and visible to the DPA on shore.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
