/**
 * CrewRosterView — Company Admin crew management dashboard.
 *
 * 5 sub-tabs:
 *  1. Shoreside Staff
 *  2. Standby / Unassigned Pool
 *  3. Pending Sign-On Approval
 *  4. Fleet & Vessels (Active Onboard) — compact searchable vessel table
 *  5. Inactive / Terminated
 *
 * Crew actions: Deactivate & Archive (revoke login, preserve audit history),
 * Permanently Delete (purge record with confirmation).
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Users, Plus, Anchor, MapPin, Clock, Lock, Unlock, Shield, Building2,
  CheckCircle2, Ban, LogIn, LogOut, Loader2, Search, ChevronDown, ChevronRight,
  Ship, Filter, UserPlus, Clock3, AlertCircle, Pencil, Trash2,
  Globe, Target, Mail, Trash, X,
} from 'lucide-react';
import { supabase, type TenantUserRow, type CrewAssignmentRow, type VesselRow, type Rank } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAudit } from '../../lib/audit';
import { postSyncEvent, onSyncEvent } from '../../lib/syncChannel';
import {
  isDemoMode,
  getEffectiveDemoUsers, getEffectiveDemoVessels, getEffectiveDemoAssignments,
  demoSignOff, demoSignOn, demoCreateUser, demoDeactivateUser, demoSetUserStatus, demoDeleteUser,
} from '../../lib/demoData';
import { loadProfiles, type SmsProfileWithVessels } from '../../lib/smsProfiles';
import { CREW_STATUS, useRanksForTenant, type RankDef } from '../../lib/rankPermissions';
import { useShoreRolesForTenant, type FleetScope, resolveShoreRoleName } from '../../lib/shoreRoles';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';

interface PersonnelRow {
  user: TenantUserRow;
  assignment: CrewAssignmentRow | null;
  vesselName: string | null;
  vesselId: string | null;
}

type SubTab = 'shoreside' | 'standby' | 'pending' | 'fleet' | 'inactive';

const TAB_DEFS: { key: SubTab; label: string; icon: typeof Users }[] = [
  { key: 'shoreside', label: 'Shoreside Staff', icon: Building2 },
  { key: 'standby', label: 'Standby / Unassigned', icon: MapPin },
  { key: 'pending', label: 'Pending Sign-On', icon: Clock3 },
  { key: 'fleet', label: 'Fleet & Vessels', icon: Ship },
  { key: 'inactive', label: 'Inactive / Terminated', icon: Ban },
];

const RANK_BADGE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  Master: 'info',
  'Chief Engineer': 'info',
  'Chief Mate': 'info',
  'Second Engineer': 'neutral',
  Bosun: 'neutral',
  AB: 'neutral',
  Oiler: 'neutral',
  Cook: 'success',
  Crew: 'neutral',
};

function rankBadgeTone(rank: string): 'info' | 'success' | 'warning' | 'neutral' | 'danger' {
  return RANK_BADGE_TONE[rank] ?? 'neutral';
}

export function CrewRosterView() {
  const { tenant, tenantUser } = useAuth();
  const { ranks: rankDefs } = useRanksForTenant(tenant?.id);
  const { roles: shoreRoleDefs } = useShoreRolesForTenant(tenant?.id);
  const [rows, setRows] = useState<PersonnelRow[]>([]);
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SubTab>('pending');
  const [showRegister, setShowRegister] = useState(false);
  const [editing, setEditing] = useState<TenantUserRow | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<PersonnelRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<PersonnelRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [rankFilter, setRankFilter] = useState('all');

  const rankOptions = rankDefs.map((d) => ({ rank: d.rank, label: d.rank }));
  const shoreRoleOptions = shoreRoleDefs.map((d) => ({ role: d.role, label: d.role }));

  const atLimit = tenant ? rows.length >= tenant.seats_max : false;

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    if (isDemoMode()) {
      const userList = getEffectiveDemoUsers(tenant.id);
      const activeAssignments = getEffectiveDemoAssignments(tenant.id);
      const vesselList = getEffectiveDemoVessels(tenant.id);
      setVessels(vesselList);
      const personnel = userList.map((u) => {
        const assignment = activeAssignments.find((a) => a.user_id === u.id) ?? null;
        const vessel = assignment ? vesselList.find((v) => v.id === assignment.vessel_id) : null;
        return { user: u, assignment, vesselName: vessel?.name ?? null, vesselId: vessel?.id ?? null };
      });
      setRows(personnel);
      setLoading(false);
      return;
    }
    const [{ data: users }, { data: assignments }, { data: vesselRows }] = await Promise.all([
      supabase.from('tenant_users').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('crew_assignments').select('*').eq('tenant_id', tenant.id).is('signed_off_at', null),
      supabase.from('vessels').select('*').eq('tenant_id', tenant.id).order('name'),
    ]);
    const userList = (users as TenantUserRow[]) ?? [];
    const activeAssignments = (assignments as CrewAssignmentRow[]) ?? [];
    const vesselList = (vesselRows as VesselRow[]) ?? [];
    setVessels(vesselList);
    const personnel = userList.map((u) => {
      const assignment = activeAssignments.find((a) => a.user_id === u.id) ?? null;
      const vessel = assignment ? vesselList.find((v) => v.id === assignment.vessel_id) : null;
      return { user: u, assignment, vesselName: vessel?.name ?? null, vesselId: vessel?.id ?? null };
    });
    setRows(personnel);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    if (!tenant) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenant.id) return;
      if (evt.type === 'CREW_UPDATED' || evt.type === 'VESSELS_UPDATED') {
        setSyncTick((t) => t + 1);
      }
    });
    return off;
  }, [tenant]);
  useEffect(() => { if (syncTick > 0) load(); }, [syncTick, load]);

  // ── Personnel classifiers ──────────────────────────────────────────
  const isPending = (r: PersonnelRow) => r.user.status === CREW_STATUS.PENDING_SIGN_ON;
  const isOnboard = (r: PersonnelRow) => !!r.assignment && !isPending(r);
  const isInactive = (r: PersonnelRow) => r.user.status === 'inactive';
  const isStandby = (r: PersonnelRow) => !isPending(r) && !isOnboard(r) && !isInactive(r) && r.user.role === 'vessel';
  const isShoreside = (r: PersonnelRow) => r.user.role === 'dpa' || r.user.role === 'company_admin';

  const pendingRows = useMemo(() => rows.filter(isPending), [rows]);
  const standbyRows = useMemo(() => rows.filter(isStandby), [rows]);
  const shoresideRows = useMemo(() => rows.filter((r) => isShoreside(r) && !isInactive(r)), [rows]);
  const inactiveRows = useMemo(() => rows.filter(isInactive), [rows]);
  const onboardRows = useMemo(() => rows.filter(isOnboard), [rows]);

  const pendingCount = pendingRows.length;
  const onboardCount = onboardRows.length;
  const standbyCount = standbyRows.length;
  const shoresideCount = shoresideRows.length;
  const inactiveCount = inactiveRows.length;

  // ── Tab counts ─────────────────────────────────────────────────────
  const tabCounts: Record<SubTab, number> = {
    shoreside: shoresideCount,
    standby: standbyCount,
    pending: pendingCount,
    fleet: onboardCount,
    inactive: inactiveCount,
  };

  // ── Filter helper ──────────────────────────────────────────────────
  function filterBySearch(list: PersonnelRow[]): PersonnelRow[] {
    return list.filter((r) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!r.user.name.toLowerCase().includes(q) &&
            !r.user.rank.toLowerCase().includes(q) &&
            !(r.user.email ?? '').toLowerCase().includes(q) &&
            !(r.user.employee_id ?? '').toLowerCase().includes(q)) return false;
      }
      if (rankFilter !== 'all' && r.user.rank !== rankFilter) return false;
      return true;
    });
  }

  // ── Vessel-grouped data for Fleet tab ──────────────────────────────
  const vesselGroups = useMemo(() => {
    const filtered = filterBySearch(onboardRows);
    const groups = new Map<string, { vessel: VesselRow; crew: PersonnelRow[] }>();
    for (const v of vessels) groups.set(v.id, { vessel: v, crew: [] });
    for (const r of filtered) {
      if (r.vesselId) {
        const g = groups.get(r.vesselId);
        if (g) g.crew.push(r);
      }
    }
    return [...groups.values()].filter((g) => g.crew.length > 0);
  }, [onboardRows, vessels, searchQuery, rankFilter]);

  // ── Vessel search (Tab 4 specific) ─────────────────────────────────
  const [vesselSearch, setVesselSearch] = useState('');
  const filteredVesselGroups = useMemo(() => {
    if (!vesselSearch) return vesselGroups;
    const q = vesselSearch.toLowerCase();
    return vesselGroups.filter((g) =>
      g.vessel.name.toLowerCase().includes(q) ||
      (g.vessel.imo_number ?? '').toLowerCase().includes(q) ||
      (g.vessel.vessel_type ?? '').toLowerCase().includes(q),
    );
  }, [vesselGroups, vesselSearch]);

  // ── Actions ────────────────────────────────────────────────────────
  async function approveSignOn(u: TenantUserRow, vessel: VesselRow) {
    setBusy(u.id);
    if (isDemoMode()) {
      demoSetUserStatus(tenant!.id, u.id, 'active');
      demoSignOn(tenant!.id, u.id, vessel.id, u.rank);
    } else {
      await supabase.from('tenant_users').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', u.id);
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() })
        .eq('user_id', u.id).eq('tenant_id', tenant!.id).is('signed_off_at', null);
      await supabase.from('crew_assignments').insert({
        vessel_id: vessel.id, tenant_id: tenant!.id, user_id: u.id, rank: u.rank,
      });
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'crew', action: `Sign-On Approved: ${u.name} → ${u.rank} on ${vessel.name}`, target: u.email, location: vessel.name });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'sign_on_approved', userId: u.id, vessel: vessel.name } });
    setBusy(null);
    load();
  }

  async function signOff(r: PersonnelRow) {
    if (!r.assignment) return;
    setBusy(r.user.id);
    if (isDemoMode()) {
      demoSignOff(tenant!.id, r.assignment.id);
      demoSetUserStatus(tenant!.id, r.user.id, 'active');
    } else {
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() }).eq('id', r.assignment.id);
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'crew', action: `Sign-Off: ${r.user.name} from ${r.vesselName}`, target: r.user.email, location: r.vesselName ?? '', severity: 'warning' });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'sign_off', userId: r.user.id, vessel: r.vesselName } });
    setBusy(null);
    load();
  }

  async function toggleLock(u: TenantUserRow) {
    setLockBusy(u.id);
    const isLocked = u.status === 'locked';
    const next = isLocked ? 'active' : 'locked';
    if (isDemoMode()) {
      demoSetUserStatus(tenant!.id, u.id, next);
    } else {
      await supabase.from('tenant_users').update({ status: next, updated_at: new Date().toISOString() }).eq('id', u.id);
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'security', action: `${isLocked ? 'Unlocked' : 'Locked'}: ${u.name}`, target: u.email, severity: isLocked ? 'info' : 'warning' });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'status_change', userId: u.id } });
    setLockBusy(null);
    load();
  }

  async function confirmDeactivate(u: TenantUserRow) {
    setBusy(u.id);
    if (isDemoMode()) {
      demoDeactivateUser(tenant!.id, u.id);
    } else {
      await supabase.from('tenant_users').update({ status: 'inactive', updated_at: new Date().toISOString() }).eq('id', u.id);
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() }).eq('user_id', u.id).is('signed_off_at', null);
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'security', action: `Account deactivated: ${u.name} (${u.email})`, target: u.email, severity: 'warning' });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'deactivated', userId: u.id } });
    setBusy(null);
    setDeactivateFor(null);
    load();
  }

  async function confirmDelete(u: TenantUserRow) {
    setBusy(u.id);
    if (isDemoMode()) {
      demoDeleteUser(tenant!.id, u.id);
    } else {
      await supabase.from('crew_assignments').delete().eq('user_id', u.id).eq('tenant_id', tenant!.id);
      await supabase.from('tenant_users').delete().eq('id', u.id);
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'security', action: `User PERMANENTLY DELETED: ${u.name} (${u.email})`, target: u.email, severity: 'critical' });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'deleted', userId: u.id } });
    setBusy(null);
    setDeleteFor(null);
    showToast(`${u.name} has been permanently deleted from the system.`, true);
    load();
  }

  async function saveEdit(data: { name: string; email: string; employee_id: string | null; rank: Rank; status: string }) {
    if (!editing || !tenant) return;
    setBusy(editing.id);
    if (isDemoMode()) {
      demoSetUserStatus(tenant.id, editing.id, data.status);
    } else {
      await supabase.from('tenant_users').update({
        name: data.name, email: data.email, employee_id: data.employee_id, rank: data.rank,
        status: data.status, updated_at: new Date().toISOString(),
      }).eq('id', editing.id);
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'security', action: `User edited: ${data.name}`, target: data.email });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant.id, payload: { action: 'edited', name: data.name } });
    setBusy(null);
    setEditing(null);
    load();
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  function statusBadge(u: TenantUserRow) {
    if (u.status === CREW_STATUS.PENDING_SIGN_ON) return <Badge tone="warning" dot className="!text-[10px]">Pending Sign-On</Badge>;
    if (u.status === 'locked') return <Badge tone="danger" dot className="!text-[10px]">Locked</Badge>;
    if (u.status === 'inactive') return <Badge tone="neutral" dot className="!text-[10px]">Inactive</Badge>;
    if (u.status === 'invited') return <Badge tone="info" dot className="!text-[10px]">Invited</Badge>;
    return <Badge tone="success" dot className="!text-[10px]">Active</Badge>;
  }

  // ── Crew action buttons (shared across tabs) ───────────────────────
  function renderCrewActions(r: PersonnelRow) {
    const u = r.user;
    const locked = u.status === 'locked';
    return (
      <div className="flex items-center gap-1.5">
        {isPending(r) && vessels.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value=""
              disabled={busy === u.id}
              onChange={(e) => { const v = vessels.find((x) => x.id === e.target.value); if (v) approveSignOn(u, v); }}
              className="cursor-pointer rounded-md border border-success-300 bg-success-50 py-1 pl-2 pr-6 text-[11px] font-semibold text-success-700 outline-none disabled:opacity-50 dark:border-success-800 dark:bg-success-900/30 dark:text-success-300"
            >
              <option value="">Approve &amp; Sign On…</option>
              {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {busy === u.id && <Loader2 className="h-3 w-3 animate-spin text-success-500" />}
          </div>
        )}
        {isOnboard(r) && (
          <button onClick={() => signOff(r)} disabled={busy === r.user.id} className="inline-flex items-center gap-1 rounded-md bg-warning-50 px-2 py-1 text-[10px] font-bold text-warning-700 transition hover:bg-warning-100 disabled:opacity-40 dark:bg-warning-900/30 dark:text-warning-300">
            {busy === r.user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />} Sign Off
          </button>
        )}
        {isStandby(r) && vessels.length > 0 && (
          <select
            value=""
            disabled={busy === u.id}
            onChange={(e) => { const v = vessels.find((x) => x.id === e.target.value); if (v) approveSignOn(u, v); }}
            className="cursor-pointer rounded-md border border-success-300 bg-success-50 py-1 pl-2 pr-6 text-[11px] font-semibold text-success-700 outline-none disabled:opacity-50 dark:border-success-800 dark:bg-success-900/30 dark:text-success-300"
          >
            <option value="">Sign On…</option>
            {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        {u.status !== 'inactive' && u.status !== CREW_STATUS.PENDING_SIGN_ON && (
          <button onClick={() => toggleLock(u)} disabled={lockBusy === u.id} className={`rounded p-1 transition ${locked ? 'text-danger-500 hover:bg-danger-100' : 'text-ink-400 hover:bg-warning-100 hover:text-warning-600'}`} title={locked ? 'Unlock' : 'Lock account'}>
            {lockBusy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
        )}
        <button onClick={() => setEditing(u)} className="rounded p-1 text-ink-400 hover:bg-primary-100 hover:text-primary-600" title="Edit user">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {u.status !== 'inactive' && (
          <button onClick={() => setDeactivateFor(r)} disabled={isOnboard(r)} className="rounded p-1 text-ink-400 hover:bg-warning-100 hover:text-warning-600 disabled:cursor-not-allowed disabled:opacity-30" title={isOnboard(r) ? 'Sign off before deactivating' : 'Deactivate & Archive'}>
            <Ban className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={() => setDeleteFor(r)} className="rounded p-1 text-ink-400 hover:bg-danger-100 hover:text-danger-600" title="Permanently Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── Crew table (shared renderer for non-fleet tabs) ────────────────
  function renderCrewTable(list: PersonnelRow[]) {
    if (list.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center dark:border-ink-700">
          <Users className="mx-auto mb-2 h-8 w-8 text-ink-300" />
          <p className="text-sm text-ink-500">No personnel in this category.</p>
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase text-ink-400 dark:border-ink-800">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name &amp; Employee ID</th>
                <th className="px-4 py-2.5 font-semibold">Rank</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Vessel</th>
                <th className="px-4 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {list.map((r) => {
                const u = r.user;
                const locked = u.status === 'locked';
                return (
                  <tr key={u.id} className={`hover:bg-ink-50/40 dark:hover:bg-ink-800/40 ${locked ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink-800 dark:text-white">{u.name}</p>
                      <p className="text-[11px] text-ink-400">{u.employee_id ?? 'No employee ID'}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={rankBadgeTone(u.rank)} className="!text-[10px]">{u.rank}</Badge>
                    </td>
                    <td className="px-4 py-2.5">{statusBadge(u)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-500">{r.vesselName ?? <span className="text-ink-300">—</span>}</td>
                    <td className="px-4 py-2.5">{renderCrewActions(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Fleet tab: compact vessel table with inline expansion ──────────
  const [expandedVessel, setExpandedVessel] = useState<string | null>(null);

  function renderFleetTab() {
    if (loading) return <div className="py-10 text-center text-sm text-ink-400">Loading fleet data…</div>;
    if (filteredVesselGroups.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center dark:border-ink-700">
          <Ship className="mx-auto mb-2 h-8 w-8 text-ink-300" />
          <p className="text-sm text-ink-500">{vesselSearch ? 'No vessels match your search.' : 'No active crew on board any vessel.'}</p>
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        {/* Vessel search bar */}
        <div className="border-b border-ink-100 p-3 dark:border-ink-800">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              placeholder="Search vessels by name, IMO number, or type…"
              value={vesselSearch}
              onChange={(e) => setVesselSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Compact vessel table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase text-ink-400 dark:border-ink-800">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Vessel Name</th>
                <th className="px-4 py-2.5 font-semibold">Fleet Group</th>
                <th className="px-4 py-2.5 font-semibold">Active Crew</th>
                <th className="px-4 py-2.5 font-semibold">Pending Sign-Ons</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {filteredVesselGroups.map((g) => {
                const isExpanded = expandedVessel === g.vessel.id;
                const pendingForVessel = pendingRows.filter((r) => r.vesselId === g.vessel.id || (!r.vesselId && vessels.length === 1)).length;
                return (
                  <CrewRowFragment
                    key={g.vessel.id}
                    vessel={g.vessel}
                    crew={g.crew}
                    pendingCount={pendingForVessel}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedVessel(isExpanded ? null : g.vessel.id)}
                    renderActions={renderCrewActions}
                    statusBadge={statusBadge}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.ok ? 'bg-success-500 text-white' : 'bg-danger-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink-900 dark:text-white">
            <Users className="h-5 w-5 text-primary-500" /> Crew Roster &amp; User Management
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Register crew, manage sign-on approvals, and track personnel across the fleet.
          </p>
        </div>
        <button onClick={() => setShowRegister(true)} disabled={atLimit} className={`btn-primary flex items-center gap-2 ${atLimit ? 'cursor-not-allowed opacity-50' : ''}`}>
          <UserPlus className="h-4 w-4" /> Register New Crew Member
        </button>
      </div>

      {atLimit && (
        <div className="flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          <Lock className="h-4 w-4 shrink-0" />
          License ceiling reached ({tenant?.seats_max} seats). Contact your Super Admin to upgrade.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Pending" value={pendingCount} tone="warning" icon={<Clock3 className="h-4 w-4" />} />
        <StatCard label="On Board" value={onboardCount} tone="success" icon={<Anchor className="h-4 w-4" />} />
        <StatCard label="Standby" value={standbyCount} tone="neutral" icon={<MapPin className="h-4 w-4" />} />
        <StatCard label="Shoreside" value={shoresideCount} tone="primary" icon={<Building2 className="h-4 w-4" />} />
        <StatCard label="Inactive" value={inactiveCount} tone="danger" icon={<Ban className="h-4 w-4" />} />
      </div>

      {/* Pending sign-on alert */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-800 dark:bg-warning-900/20">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-100 text-warning-600 dark:bg-warning-900/40 dark:text-warning-300">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-warning-800 dark:text-warning-200">
              {pendingCount} crew member{pendingCount > 1 ? 's are' : ' is'} awaiting sign-on approval
            </p>
            <p className="text-xs text-warning-600 dark:text-warning-400">
              Pending users cannot log into vessel terminals until approved and signed on by the Master or Company Admin.
            </p>
          </div>
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-ink-200/70 bg-white p-1 dark:border-ink-800 dark:bg-ink-900">
        {TAB_DEFS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = tabCounts[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearchQuery(''); setRankFilter('all'); setVesselSearch(''); }}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                isActive
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                  : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-ink-800/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive ? 'bg-primary-200 text-primary-700 dark:bg-primary-800 dark:text-primary-200' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filter bar (hidden on fleet tab which has its own search) */}
      {activeTab !== 'fleet' && (
        <div className="flex flex-col gap-3 rounded-xl border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search by name, rank, email, or employee ID…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value)} className="cursor-pointer rounded-lg border border-ink-200 bg-white py-2 pl-8 pr-8 text-sm font-medium text-ink-700 outline-none transition hover:border-ink-300 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <option value="all">All Ranks</option>
              {rankOptions.map((r) => <option key={r.rank} value={r.rank}>{r.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          </div>
        </div>
      )}

      {/* Tab content */}
      {loading ? (
        <div className="py-10 text-center text-sm text-ink-400">Loading crew roster…</div>
      ) : (
        <>
          {activeTab === 'shoreside' && renderCrewTable(filterBySearch(shoresideRows))}
          {activeTab === 'standby' && renderCrewTable(filterBySearch(standbyRows))}
          {activeTab === 'pending' && renderCrewTable(filterBySearch(pendingRows))}
          {activeTab === 'fleet' && renderFleetTab()}
          {activeTab === 'inactive' && renderCrewTable(filterBySearch(inactiveRows))}
        </>
      )}

      {showRegister && tenant && (
        <RegisterCrewModal
          vessels={vessels}
          rankOptions={rankOptions}
          shoreRoleOptions={shoreRoleOptions}
          tenantId={tenant.id}
          onClose={() => setShowRegister(false)}
          onRegister={async (data) => {
            const isShoreside = data.accountType === 'shoreside';
            const role = isShoreside
              ? (data.rank === 'Company Admin' ? 'company_admin' : 'dpa')
              : 'vessel';
            const status = isShoreside ? 'invited' : CREW_STATUS.PENDING_SIGN_ON;
            let newUserId: string | null = null;
            if (isDemoMode()) {
              newUserId = demoCreateUser(tenant.id, {
                name: data.name, email: data.email, employee_id: data.employeeId,
                passport_number: null, seaman_book_number: null, nationality: null,
                rank: data.rank, role, status,
                fleet_scope: data.fleetScope,
                assigned_vessel_ids: isShoreside ? data.fleetVessels : [],
                assigned_fleet_profile_ids: isShoreside ? data.fleetProfiles : [],
              });
            } else {
              const { data: created } = await supabase.from('tenant_users')
                .insert({
                  tenant_id: tenant.id, name: data.name, email: data.email,
                  employee_id: data.employeeId, rank: data.rank, role,
                  status, auth_uid: data.authUid ?? null,
                  fleet_scope: isShoreside ? data.fleetScope : 'global',
                  assigned_vessel_ids: isShoreside ? data.fleetVessels : [],
                  assigned_fleet_profile_ids: isShoreside ? data.fleetProfiles : [],
                })
                .select('id')
                .single();
              newUserId = created?.id ?? null;
            }
            const actionLabel = isShoreside
              ? `Shoreside staff registered: ${data.name} (${data.rank}) — fleet scope: ${data.fleetScope === 'global' ? 'Global' : `Specific (${data.fleetVessels.length} vessels, ${data.fleetProfiles.length} profiles)`}`
              : `Crew registered: ${data.name} (${data.rank}) — pending sign-on`;
            await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'crew', action: actionLabel, target: data.email, location: tenant.company });
            postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant.id, payload: { action: 'registered', name: data.name } });
            setShowRegister(false);
            showToast(isShoreside
              ? `${data.name} registered as ${data.rank} (Shoreside). They will receive an invitation email.`
              : `${data.name} registered as ${data.rank}. Status: PENDING_SIGN_ON — cannot log in until signed on.`, true);
            load();
          }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          rankOptions={rankOptions}
          shoreRoleOptions={shoreRoleOptions}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          busy={busy === editing.id}
        />
      )}

      {deactivateFor && (
        <DeactivateModal
          row={deactivateFor}
          busy={busy === deactivateFor.user.id}
          onClose={() => setDeactivateFor(null)}
          onConfirm={() => confirmDeactivate(deactivateFor.user)}
        />
      )}

      {deleteFor && (
        <DeleteModal
          row={deleteFor}
          busy={busy === deleteFor.user.id}
          onClose={() => setDeleteFor(null)}
          onConfirm={() => confirmDelete(deleteFor.user)}
        />
      )}
    </div>
  );
}

// ── Vessel row with inline crew expansion ────────────────────────────

function CrewRowFragment({
  vessel, crew, pendingCount, isExpanded, onToggle, renderActions, statusBadge,
}: {
  vessel: VesselRow;
  crew: PersonnelRow[];
  pendingCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  renderActions: (r: PersonnelRow) => React.ReactNode;
  statusBadge: (u: TenantUserRow) => React.ReactNode;
}) {
  return (
    <>
      <tr className="cursor-pointer transition hover:bg-ink-50/40 dark:hover:bg-ink-800/40" onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
            <Ship className="h-4 w-4 text-primary-500" />
            <div>
              <p className="font-bold text-ink-900 dark:text-white">{vessel.name}</p>
              <p className="text-[10px] text-ink-400">IMO {vessel.imo_number}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-xs font-medium text-ink-600 dark:text-ink-300">{vessel.vessel_type ?? '—'}</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700 dark:bg-success-900/30 dark:text-success-300">
            <Anchor className="h-3 w-3" /> {crew.length}
          </span>
        </td>
        <td className="px-4 py-3">
          {pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-300">
              <Clock3 className="h-3 w-3" /> {pendingCount}
            </span>
          ) : <span className="text-xs text-ink-300">—</span>}
        </td>
        <td className="px-4 py-3">
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400">
            {isExpanded ? 'Collapse' : 'Expand Crew'}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-ink-50/30 dark:bg-ink-800/20">
          <td colSpan={5} className="px-4 py-3">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Rank</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Signed On</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-700">
                {crew.map((r) => (
                  <tr key={r.user.id} className="hover:bg-white/50 dark:hover:bg-ink-900/30">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-ink-800 dark:text-white">{r.user.name}</p>
                      <p className="text-[10px] text-ink-400">{r.user.employee_id ?? 'No ID'}</p>
                    </td>
                    <td className="px-3 py-2"><Badge tone={rankBadgeTone(r.user.rank)} className="!text-[10px]">{r.user.rank}</Badge></td>
                    <td className="px-3 py-2">{statusBadge(r.user)}</td>
                    <td className="px-3 py-2 text-xs text-ink-500">{r.assignment?.signed_on_at ? new Date(r.assignment.signed_on_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2">{renderActions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Stat card ────────────────────────────────────────────────────────

function StatCard({ label, value, tone, icon }: { label: string; value: number; tone: 'primary' | 'success' | 'neutral' | 'info' | 'warning' | 'danger'; icon: React.ReactNode }) {
  const cls = {
    primary: 'border-primary-200 bg-primary-50/50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300',
    success: 'border-success-200 bg-success-50/50 text-success-700 dark:border-success-800 dark:bg-success-900/20 dark:text-success-400',
    neutral: 'border-ink-200 bg-ink-50 text-ink-700 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300',
    info: 'border-primary-200 bg-primary-50/50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300',
    warning: 'border-warning-200 bg-warning-50/50 text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300',
    danger: 'border-danger-200 bg-danger-50/50 text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-400',
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold opacity-80">{icon}{label}</div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

// ── Modals ───────────────────────────────────────────────────────────

type AccountType = 'shipboard' | 'shoreside';

interface RegisterFormData {
  name: string;
  email: string;
  employeeId: string;
  password: string;
  rank: Rank;
  vesselId: string | null;
  accountType: AccountType;
  fleetScope: FleetScope;
  fleetVessels: string[];
  fleetProfiles: string[];
  authUid?: string | null;
}

const STANDBY_KEY = '__standby__';

function RegisterCrewModal({ vessels, rankOptions, shoreRoleOptions, tenantId, onClose, onRegister }: {
  vessels: VesselRow[];
  rankOptions: { rank: string; label: string }[];
  shoreRoleOptions: { role: string; label: string }[];
  tenantId: string;
  onClose: () => void;
  onRegister: (data: RegisterFormData) => Promise<void>;
}) {
  const [accountType, setAccountType] = useState<AccountType>('shipboard');
  const [form, setForm] = useState<RegisterFormData>({
    name: '', email: '', employeeId: '', password: '', rank: 'AB', vesselId: null,
    accountType: 'shipboard', fleetScope: 'global', fleetVessels: [], fleetProfiles: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fleetProfiles, setFleetProfiles] = useState<SmsProfileWithVessels[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    loadProfiles(tenantId).then(setFleetProfiles).catch(() => setFleetProfiles([]));
  }, [tenantId]);

  const vesselsByProfile = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of fleetProfiles) {
      map.set(p.id, p.vesselIds);
    }
    return map;
  }, [fleetProfiles]);

  const filteredVessels = useMemo<VesselRow[]>(() => {
    if (form.fleetProfiles.length === 0) return [];
    const allowedIds = new Set(form.fleetProfiles.flatMap((pid) => vesselsByProfile.get(pid) ?? []));
    return vessels.filter((v) => allowedIds.has(v.id));
  }, [form.fleetProfiles, vesselsByProfile, vessels]);

  const allFilteredSelected = filteredVessels.length > 0 && filteredVessels.every((v) => form.fleetVessels.includes(v.id));
  const selectedFilteredCount = filteredVessels.filter((v) => form.fleetVessels.includes(v.id)).length;

  async function handleSubmit() {
    if (!form.name || !form.email || !form.password) {
      setError('Full Name, Email, and Default Password are required.');
      return;
    }
    if (form.password.length < 6) {
      setError('Default password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    setError(null);

    if (!isDemoMode()) {
      const { data, error: signUpError } = await supabase.auth.signUp({ email: form.email, password: form.password });
      if (signUpError) {
        setError(signUpError.message);
        setSaving(false);
        return;
      }
      if (!data.user) {
        setError('Failed to create auth account.');
        setSaving(false);
        return;
      }
      await onRegister({ ...form, accountType, authUid: data.user.id });
    } else {
      await onRegister({ ...form, accountType });
    }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Register New Crew Member" icon={<UserPlus className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
        <button disabled={saving || !form.name || !form.email || !form.password} onClick={handleSubmit} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {saving ? 'Registering…' : 'Register Crew Member'}
        </button></>}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div>
          <label className="label">Account Type *</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setAccountType('shipboard'); setForm({ ...form, rank: rankOptions[0]?.rank ?? 'AB', vesselId: null, fleetScope: 'global', fleetVessels: [], fleetProfiles: [] }); }}
              className={`flex items-center gap-2.5 rounded-xl border-2 p-3 text-left transition ${
                accountType === 'shipboard'
                  ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
                  : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900'
              }`}
            >
              <Anchor className={`h-5 w-5 ${accountType === 'shipboard' ? 'text-primary-600 dark:text-primary-400' : 'text-ink-400'}`} />
              <div>
                <p className={`text-sm font-bold ${accountType === 'shipboard' ? 'text-primary-700 dark:text-primary-300' : 'text-ink-700 dark:text-ink-300'}`}>Shipboard Crew</p>
                <p className="text-[11px] text-ink-400">Vessel-based personnel — ranks & sign-on</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setAccountType('shoreside'); setForm({ ...form, rank: (shoreRoleOptions[0]?.role ?? 'DPA') as Rank, vesselId: null, fleetScope: 'global', fleetVessels: [], fleetProfiles: [] }); }}
              className={`flex items-center gap-2.5 rounded-xl border-2 p-3 text-left transition ${
                accountType === 'shoreside'
                  ? 'border-accent-400 bg-accent-50 dark:border-accent-600 dark:bg-accent-900/20'
                  : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900'
              }`}
            >
              <Building2 className={`h-5 w-5 ${accountType === 'shoreside' ? 'text-accent-600 dark:text-accent-400' : 'text-ink-400'}`} />
              <div>
                <p className={`text-sm font-bold ${accountType === 'shoreside' ? 'text-accent-700 dark:text-accent-300' : 'text-ink-700 dark:text-ink-300'}`}>Shoreside Staff</p>
                <p className="text-[11px] text-ink-400">Office-based — roles & fleet scope</p>
              </div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Full Name *</label>
            <input className="input" placeholder={accountType === 'shipboard' ? 'e.g. John Seafarer' : 'e.g. Sarah Harbour'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Employee ID / Username</label>
            <input className="input" placeholder="e.g. EMP-0042" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
          </div>
          <div>
            <label className="label">Email Address *</label>
            <input className="input" type="email" placeholder={accountType === 'shipboard' ? 'crew@company.com' : 'office@company.com'} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Default Password *</label>
            <input className="input" type="text" placeholder="Min. 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="mt-1 text-[11px] text-ink-400">{accountType === 'shipboard' ? 'Used to log in after sign-on approval.' : 'Used for first login — invitation will be sent.'}</p>
          </div>
        </div>

        {accountType === 'shipboard' && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Shipboard Rank *</label>
                <select className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value as Rank })}>
                  {rankOptions.map((r) => <option key={r.rank} value={r.rank}>{r.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink-400">Ranks populate from the Shipboard Ranks configured in the Role &amp; Permissions Matrix.</p>
              </div>
              <div>
                <label className="label">Vessel Assignment</label>
                <select className="input" value={form.vesselId ?? STANDBY_KEY} onChange={(e) => setForm({ ...form, vesselId: e.target.value === STANDBY_KEY ? null : e.target.value || null })}>
                  <option value={STANDBY_KEY}>Standby Pool (No Vessel)</option>
                  {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink-400">Assign to a vessel or place in standby pool for later sign-on.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
              <span><strong>PENDING_SIGN_ON:</strong> The new crew member will be registered with pending status. They <strong>cannot log in</strong> to any vessel terminal until the Master or Company Admin approves their sign-on. This ensures only verified, on-board personnel get system access.</span>
            </div>
          </>
        )}

        {accountType === 'shoreside' && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Shoreside Role *</label>
                <select className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value as Rank })}>
                  {shoreRoleOptions.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink-400">Roles populate from the Shoreside Roles configured in the Role &amp; Permissions Matrix.</p>
              </div>
            </div>
            <div>
              <label className="label">Fleet Assignment Scope *</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, fleetScope: 'global', fleetVessels: [], fleetProfiles: [] })}
                  className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition ${
                    form.fleetScope === 'global'
                      ? 'border-accent-400 bg-accent-50 dark:border-accent-600 dark:bg-accent-900/20'
                      : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900'
                  }`}
                >
                  <Globe className={`mt-0.5 h-4 w-4 ${form.fleetScope === 'global' ? 'text-accent-600 dark:text-accent-400' : 'text-ink-400'}`} />
                  <div>
                    <p className={`text-sm font-bold ${form.fleetScope === 'global' ? 'text-accent-700 dark:text-accent-300' : 'text-ink-700 dark:text-ink-300'}`}>All Fleets / Global</p>
                    <p className="text-[11px] text-ink-400">Full company access — all vessels (DPA, Company Admin)</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, fleetScope: 'specific' })}
                  className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition ${
                    form.fleetScope === 'specific'
                      ? 'border-accent-400 bg-accent-50 dark:border-accent-600 dark:bg-accent-900/20'
                      : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900'
                  }`}
                >
                  <Target className={`mt-0.5 h-4 w-4 ${form.fleetScope === 'specific' ? 'text-accent-600 dark:text-accent-400' : 'text-ink-400'}`} />
                  <div>
                    <p className={`text-sm font-bold ${form.fleetScope === 'specific' ? 'text-accent-700 dark:text-accent-300' : 'text-ink-700 dark:text-ink-300'}`}>Specific Sub-Fleets</p>
                    <p className="text-[11px] text-ink-400">Restrict to selected vessels (Superintendents)</p>
                  </div>
                </button>
              </div>
            </div>
            {form.fleetScope === 'specific' && (
              <div className="space-y-3">
                <div>
                  <label className="label">Assign by Fleet Profile</label>
                  <p className="mb-2 text-[11px] text-ink-400">Check one or more fleet profiles to reveal their assigned vessels below.</p>
                  <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                    {fleetProfiles.length === 0 && (
                      <p className="text-xs text-ink-400">No fleet profiles configured.</p>
                    )}
                    {fleetProfiles.map((p) => {
                      const checked = form.fleetProfiles.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const profileVessels = vesselsByProfile.get(p.id) ?? [];
                              if (e.target.checked) {
                                setForm({
                                  ...form,
                                  fleetProfiles: [...form.fleetProfiles, p.id],
                                  fleetVessels: Array.from(new Set([...form.fleetVessels, ...profileVessels])),
                                });
                              } else {
                                const otherChecked = form.fleetProfiles.filter((id) => id !== p.id);
                                const vesselsInOthers = new Set(otherChecked.flatMap((id) => vesselsByProfile.get(id) ?? []));
                                const exclusiveToRemove = profileVessels.filter((vid) => !vesselsInOthers.has(vid));
                                setForm({
                                  ...form,
                                  fleetProfiles: otherChecked,
                                  fleetVessels: form.fleetVessels.filter((vid) => !exclusiveToRemove.includes(vid)),
                                });
                              }
                            }}
                            className="h-4 w-4 rounded accent-teal-600"
                          />
                          <span className="flex-1">{p.name}</span>
                          <span className="text-[10px] text-ink-400">{p.vesselCount} vessels</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="label">Select Individual Vessels</label>
                  {form.fleetProfiles.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-ink-300 bg-ink-50 p-4 text-center dark:border-ink-700 dark:bg-ink-900/30">
                      <p className="text-xs text-ink-400">Select one or more Fleet Profiles above to view assigned vessels.</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center justify-between rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-700 dark:bg-ink-800/50">
                        <label className="flex items-center gap-2 text-xs font-bold text-ink-700 dark:text-ink-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setForm({
                                  ...form,
                                  fleetVessels: Array.from(new Set([...form.fleetVessels, ...filteredVessels.map((v) => v.id)])),
                                });
                              } else {
                                const filteredIds = new Set(filteredVessels.map((v) => v.id));
                                setForm({
                                  ...form,
                                  fleetVessels: form.fleetVessels.filter((vid) => !filteredIds.has(vid)),
                                });
                              }
                            }}
                            className="h-4 w-4 rounded accent-teal-600"
                          />
                          {allFilteredSelected ? 'Deselect All' : 'Select All'}
                        </label>
                        <span className="text-[11px] text-ink-400">{selectedFilteredCount} / {filteredVessels.length} selected</span>
                      </div>
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                        {filteredVessels.map((v) => {
                          const checked = form.fleetVessels.includes(v.id);
                          return (
                            <label key={v.id} className="flex items-center gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setForm({
                                    ...form,
                                    fleetVessels: e.target.checked
                                      ? [...form.fleetVessels, v.id]
                                      : form.fleetVessels.filter((id) => id !== v.id),
                                  });
                                }}
                                className="h-4 w-4 rounded accent-teal-600"
                              />
                              {v.name}
                            </label>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-ink-400">This staff member will only see data for the selected vessels across all modules.</p>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              <span><strong>INVITATION:</strong> Shoreside staff receive an invitation email and can log in immediately after setting their password. No sign-on approval is required.</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function EditUserModal({ user, rankOptions, shoreRoleOptions, onClose, onSave, busy }: {
  user: TenantUserRow;
  rankOptions: { rank: string; label: string }[];
  shoreRoleOptions: { role: string; label: string }[];
  onClose: () => void;
  onSave: (data: { name: string; email: string; employee_id: string | null; rank: Rank; status: string }) => void;
  busy: boolean;
}) {
  const isShoreside = user.role === 'dpa' || user.role === 'company_admin';
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    employee_id: user.employee_id ?? '',
    rank: user.rank,
    status: user.status,
  });

  const STATUS_OPTIONS = [
    { value: CREW_STATUS.PENDING_SIGN_ON, label: 'Pending Sign-On' },
    { value: 'active', label: 'Active' },
    { value: 'invited', label: 'Invited' },
    { value: 'locked', label: 'Locked' },
    { value: 'inactive', label: 'Inactive' },
  ];

  return (
    <Modal open onClose={onClose} title="Edit Crew Member" subtitle={`${user.name} · ${user.rank}`} icon={<Pencil className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy || !form.name || !form.email} onClick={() => onSave({ ...form, employee_id: form.employee_id || null })} className="btn-primary flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Save Changes
        </button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Full Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Employee ID</label>
          <input className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
        </div>
        <div>
          <label className="label">{isShoreside ? 'Shoreside Role' : 'Shipboard Rank'}</label>
          <select className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value as Rank })}>
            {isShoreside
              ? shoreRoleOptions.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)
              : rankOptions.map((r) => <option key={r.rank} value={r.rank}>{r.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-400">{isShoreside ? 'Shoreside role from the Permissions Matrix.' : 'Shipboard rank from the Permissions Matrix.'}</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-400">Pending Sign-On users cannot log in until approved. Locked users have login revoked but records preserved.</p>
        </div>
      </div>
    </Modal>
  );
}

function DeactivateModal({ row, busy, onClose, onConfirm }: {
  row: PersonnelRow;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Deactivate & Archive Account" subtitle={`${row.user.name} · ${row.user.email}`} icon={<Ban className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy} onClick={onConfirm} className="btn-primary !bg-warning-600 !text-white hover:!bg-warning-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deactivate & Archive'}
        </button></>}>
      <div className="space-y-3">
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-center dark:border-warning-800 dark:bg-warning-900/20">
          <p className="text-sm font-bold text-ink-900 dark:text-white">Deactivate account for {row.user.name} ({row.user.rank})?</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Login access will be revoked immediately. All historical audit logs, approvals, and signatures are preserved. The account moves to Inactive and can be reactivated later.</p>
        </div>
      </div>
    </Modal>
  );
}

function DeleteModal({ row, busy, onClose, onConfirm }: {
  row: PersonnelRow;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText.trim().toUpperCase() === 'DELETE';

  return (
    <Modal open onClose={onClose} title="Permanently Delete User" subtitle={`${row.user.name} · ${row.user.email}`} icon={<Trash className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy || !canConfirm} onClick={onConfirm} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Permanently Delete
        </button></>}>
      <div className="space-y-3">
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-center dark:border-danger-800 dark:bg-danger-900/20">
          <p className="text-sm font-bold text-danger-800 dark:text-danger-200">WARNING: This action cannot be undone.</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Permanent deletion</strong> will completely purge {row.user.name}'s record from the system, including all crew assignments and user data.
            This differs from deactivation, which preserves audit history. Use this only when the person should no longer exist in any system records.
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
            Type <span className="font-mono text-danger-600 dark:text-danger-400">DELETE</span> to confirm:
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="input font-mono"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}
