import { useEffect, useMemo, useState } from 'react';
import { Ship, Plus, Ban, Anchor, Clock, RefreshCw, Trash2, Loader2, AlertTriangle, Hash, Users, LogIn, LogOut, FileText, CheckCircle2, X, Info, Pencil, Layers } from 'lucide-react';
import { supabase, type VesselRow, type CrewAssignmentRow, type TenantUserRow, type Rank, ALL_RANKS } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAudit } from '../../lib/audit';
import { postSyncEvent, onSyncEvent } from '../../lib/syncChannel';
import { isDemoMode, getEffectiveDemoUsers, getEffectiveDemoVessels, getEffectiveDemoAssignments, demoSignOff, demoSignOn, demoCreateVessel, demoDeleteVessel, demoUpdateVessel, demoUpdateVesselSync } from '../../lib/demoData';
import { loadProfiles, assignVesselToProfile, getProfileForVessel, getVesselProfileMap, countApprovedDocsForProfile, type SmsProfileWithVessels } from '../../lib/smsProfiles';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { DataTable, type Column } from '../../components/DataTable';
import { useFleetScope } from '../../lib/useFleetScope';

interface FleetRow extends VesselRow {
  crewOnboard: number;
  profileName: string | null;
  profileVersion: string | null;
  profileId: string | null;
}

export function VesselsView() {
  const { tenant, tenantUser } = useAuth();
  const fleetScope = useFleetScope();
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<VesselRow | null>(null);
  const [manningFor, setManningFor] = useState<VesselRow | null>(null);
  const [smsStatusFor, setSmsStatusFor] = useState<FleetRow | null>(null);
  const [editFor, setEditFor] = useState<FleetRow | null>(null);
  const [editForProfileId, setEditForProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [syncFeedback, setSyncFeedback] = useState<{ vesselId: string; msg: string; ok: boolean } | null>(null);

  const atLimit = tenant ? rows.length >= tenant.vessels_max : false;

  const filteredRows = useMemo(() => {
    if (scopeFilter === 'all') return rows;
    return rows.filter((r) => r.profileId === scopeFilter);
  }, [rows, scopeFilter]);

  async function load() {
    if (!tenant) return;
    setLoading(true);
    const profileList = await loadProfiles(tenant.id);
    setProfiles(profileList);
    if (isDemoMode()) {
      const demoVessels = getEffectiveDemoVessels(tenant.id);
      const active = getEffectiveDemoAssignments(tenant.id).filter((a) => !a.signed_off_at);
      const counts: Record<string, number> = {};
      for (const a of active) counts[a.vessel_id] = (counts[a.vessel_id] ?? 0) + 1;
      // Resolve profile per vessel
      const enriched = await Promise.all(demoVessels.map(async (v) => {
        const prof = await getProfileForVessel(tenant.id, v.id);
        return { ...v, crewOnboard: counts[v.id] ?? 0, profileName: prof?.name ?? null, profileVersion: prof?.version ?? null, profileId: prof?.id ?? null };
      }));
      setRows(fleetScope.filterVessels(enriched));
      setLoading(false);
      return;
    }
    const [{ data: vesselRows }, { data: active }] = await Promise.all([
      supabase.from('vessels').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('crew_assignments').select('vessel_id').eq('tenant_id', tenant.id).is('signed_off_at', null),
    ]);
    const vesselList = fleetScope.filterVessels((vesselRows as VesselRow[]) ?? []);
    const activeAssignments = (active as Pick<CrewAssignmentRow, 'vessel_id'>[]) ?? [];
    const counts: Record<string, number> = {};
    for (const a of activeAssignments) counts[a.vessel_id] = (counts[a.vessel_id] ?? 0) + 1;
    const enriched = await Promise.all(vesselList.map(async (v) => {
      const prof = await getProfileForVessel(tenant.id, v.id);
      return { ...v, crewOnboard: counts[v.id] ?? 0, profileName: prof?.name ?? null, profileVersion: prof?.version ?? null, profileId: prof?.id ?? null };
    }));
    setRows(fleetScope.filterVessels(enriched));
    setLoading(false);
  }

  useEffect(() => { load(); }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenant.id) return;
      if (evt.type === 'PROFILES_UPDATED' || evt.type === 'VESSELS_UPDATED' || evt.type === 'CREW_UPDATED') load();
    });
    return off;
  }, [tenant]);

  async function doSync(r: FleetRow) {
    setSyncing(r.id);
    setSyncFeedback(null);
    try {
      const profileVersion = r.profileVersion ?? tenant!.sms_version;
      // Check for new DPA-approved circulars/amendments under this vessel's profile
      const newDocCount = await countApprovedDocsForProfile(tenant!.id, r.profileId, r.last_sync_at ?? undefined);
      const now = new Date().toISOString();
      if (isDemoMode()) {
        demoUpdateVesselSync(tenant!.id, r.id, profileVersion);
      } else {
        await supabase.from('vessels').update({ last_sync_at: now, sms_active_version: profileVersion }).eq('id', r.id);
      }
      await logAudit({
        tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'sms',
        action: `Manual SMS Synchronization Triggered: ${r.name}${newDocCount > 0 ? ` — ${newDocCount} new approved document(s) synced` : ' — no new documents'}`,
        target: r.imo_number, location: r.name, severity: newDocCount > 0 ? 'warning' : 'info',
      });
      postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant!.id, payload: { action: 'vessel_sync', vessel: r.name, version: profileVersion, newDocs: newDocCount } });
      setSyncFeedback({ vesselId: r.id, msg: newDocCount > 0 ? `${newDocCount} new approved document(s) synced` : 'No new documents found — already up to date', ok: true });
      await load();
    } catch {
      setSyncFeedback({ vesselId: r.id, msg: 'Sync failed — please try again', ok: false });
    }
    setSyncing(null);
    setTimeout(() => setSyncFeedback(null), 5000);
  }

  async function confirmDelete(v: VesselRow) {
    if (isDemoMode()) {
      demoDeleteVessel(tenant!.id, v.id);
    } else {
      // Explicitly clean up dependent records before vessel deletion to avoid
      // any FK constraint issues. crew_assignments and sms_profile_vessels both
      // have ON DELETE CASCADE, but we clean them explicitly for safety + audit clarity.
      await Promise.all([
        supabase.from('crew_assignments').delete().eq('vessel_id', v.id).eq('tenant_id', tenant!.id),
        supabase.from('sms_profile_vessels').delete().eq('vessel_id', v.id),
      ]);
      // Now safe to delete the vessel — tenant-scoped for security
      const { error } = await supabase.from('vessels').delete().eq('id', v.id).eq('tenant_id', tenant!.id);
      if (error) {
        setDeleteFor(null);
        return;
      }
    }
    await logAudit({ tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'crew', action: `Vessel deleted: ${v.name} (IMO ${v.imo_number})`, target: v.imo_number, location: v.name, severity: 'critical' });
    postSyncEvent({ type: 'VESSELS_UPDATED', tenantId: tenant!.id, payload: { action: 'vessel_deleted', vesselId: v.id } });
    postSyncEvent({ type: 'PROFILES_UPDATED', tenantId: tenant!.id, payload: { action: 'vessel_deleted', vesselId: v.id } });
    setDeleteFor(null);
    load();
  }

  const columns: Column<FleetRow>[] = [
    {
      key: 'name',
      header: 'Vessel / IMO',
      width: 'w-[20%]',
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
            <Anchor className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="whitespace-nowrap text-[13px] font-bold text-ink-900 dark:text-white">{r.name}</p>
            <p className="flex items-center gap-0.5 text-[11px] text-ink-400">
              <Hash className="h-2.5 w-2.5" />{r.imo_number}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'flag',
      header: 'Flag / Port',
      width: 'w-[11%]',
      sortValue: (r) => r.flag_state ?? '',
      render: (r) => (
        <div className="leading-tight">
          <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">{r.flag_state ?? '—'}</p>
          <p className="text-[11px] text-ink-400">{r.port_of_registry ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 'w-[10%]',
      sortValue: (r) => r.vessel_type ?? '',
      render: (r) => <span className="text-[12px] font-medium text-ink-700 dark:text-ink-200">{r.vessel_type ?? '—'}</span>,
    },
    {
      key: 'gt',
      header: 'GT',
      width: 'w-[8%]',
      sortValue: (r) => r.gross_tonnage ?? 0,
      render: (r) => <span className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">{r.gross_tonnage != null ? r.gross_tonnage.toLocaleString() : '—'}</span>,
    },
    {
      key: 'kw',
      header: 'Power (kW)',
      width: 'w-[9%]',
      sortValue: (r) => r.kw_power ?? 0,
      render: (r) => <span className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">{r.kw_power != null ? r.kw_power.toLocaleString() : '—'}</span>,
    },
    {
      key: 'class',
      header: 'Class Society',
      width: 'w-[11%]',
      sortValue: (r) => r.class_society ?? '',
      render: (r) => <span className="text-[12px] font-medium text-ink-700 dark:text-ink-200">{r.class_society ?? '—'}</span>,
    },
    {
      key: 'scope',
      header: 'SMS Scope',
      width: 'w-[12%]',
      sortValue: (r) => r.profileName ?? 'zzz',
      render: (r) =>
        r.profileName ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-[10px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" title="SMS Fleet Profile">
            <Layers className="h-3 w-3" />
            {r.profileName}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-400 dark:bg-ink-800 dark:text-ink-500">No Profile</span>
        ),
    },
    {
      key: 'crew',
      header: 'Active Crew',
      width: 'w-[8%]',
      sortValue: (r) => r.crewOnboard,
      render: (r) =>
        r.crewOnboard > 0 ? (
          <button
            onClick={() => setManningFor(r)}
            className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700 transition hover:bg-success-200 dark:bg-success-900/30 dark:text-success-300 dark:hover:bg-success-900/50"
            title="Click to open Vessel Manning drawer"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success-500" />
            {r.crewOnboard} on board
          </button>
        ) : (
          <button
            onClick={() => setManningFor(r)}
            className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-500 transition hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:hover:bg-ink-700"
            title="Click to manage manning"
          >
            No Active Crew
          </button>
        ),
    },
    {
      key: 'sms',
      header: 'SMS Version',
      width: 'w-[8%]',
      sortValue: (r) => r.profileVersion ?? r.sms_active_version,
      render: (r) => {
        const version = r.profileVersion ?? r.sms_active_version;
        const isUpToDate = r.profileVersion ? r.sms_active_version === r.profileVersion : true;
        return (
          <button
            onClick={() => setSmsStatusFor(r)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold transition hover:ring-2 hover:ring-primary-200 dark:hover:ring-primary-800 ${
              isUpToDate
                ? 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300'
                : 'bg-warning-100 text-warning-700 hover:bg-warning-200 dark:bg-warning-900/30 dark:text-warning-400'
            }`}
            title="Click to view Vessel SMS Status"
          >
            v{version}
            {!isUpToDate && <span className="ml-0.5 text-[9px]">●</span>}
          </button>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[17%]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button onClick={() => doSync(r)} disabled={syncing === r.id} className="btn-secondary !px-2 !py-1 !text-[11px]" title={r.last_sync_at ? `Last sync: ${new Date(r.last_sync_at).toLocaleString()}` : 'Never synced'}>
            <RefreshCw className={`h-3 w-3 ${syncing === r.id ? 'animate-spin' : ''}`} /> Sync
          </button>
          {syncFeedback && syncFeedback.vesselId === r.id && (
            <span className={`text-[10px] font-semibold ${syncFeedback.ok ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
              {syncFeedback.msg}
            </span>
          )}
          <button
            onClick={async () => {
              setEditFor(r);
              if (tenant) {
                const map = await getVesselProfileMap(tenant.id);
                setEditForProfileId(map[r.id] ?? null);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary-600 transition hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
            title="Edit vessel profile"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            onClick={() => setDeleteFor(r)}
            disabled={r.crewOnboard > 0}
            title={r.crewOnboard > 0 ? 'Cannot delete a vessel with active crew on board' : 'Delete vessel profile'}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${r.crewOnboard > 0 ? 'cursor-not-allowed bg-ink-100 text-ink-300 dark:bg-ink-800 dark:text-ink-600' : 'bg-danger-50 text-danger-600 hover:bg-danger-100 dark:bg-danger-900/30 dark:text-danger-300'}`}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Fleet &amp; Vessel Profiles</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">{rows.length} of {tenant?.vessels_max} licensed hulls</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={atLimit}
          className={`btn-primary ${atLimit ? 'cursor-not-allowed opacity-50' : ''}`}
          title={atLimit ? 'License limit reached — increase in Super Admin panel' : 'Create new vessel'}
        >
          <Plus className="h-4 w-4" /> Create Vessel Profile
        </button>
      </div>

      {atLimit && (
        <div className="flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          <Ban className="h-4 w-4 shrink-0" />
          License limit reached ({tenant?.vessels_max} vessels). Contact your Super Admin to upgrade the plan tier.
        </div>
      )}

      {/* SMS Fleet Scope navigation tabs */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
          <button
            onClick={() => setScopeFilter('all')}
            className={`flex items-center gap-1.5 rounded-md py-2 px-3 text-sm font-semibold transition ${scopeFilter === 'all' ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500 dark:text-ink-400'}`}
          >
            All Vessels
            <span className={`rounded-full px-1.5 text-[9px] ${scopeFilter === 'all' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-400'}`}>{rows.length}</span>
          </button>
          {profiles.map((p) => {
            const count = rows.filter((r) => r.profileId === p.id).length;
            const isActive = scopeFilter === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setScopeFilter(p.id)}
                className={`flex items-center gap-1.5 rounded-md py-2 px-3 text-sm font-semibold transition ${isActive ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500 dark:text-ink-400'}`}
              >
                {p.name}
                <span className={`rounded-full px-1.5 text-[9px] ${isActive ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-ink-400">Loading vessels…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center dark:border-ink-700">
          <Ship className="mx-auto h-9 w-9 text-ink-300" />
          <p className="mt-2 text-sm text-ink-500">No vessel profiles yet. Create your first hull to begin.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center dark:border-ink-700">
          <Layers className="mx-auto h-9 w-9 text-ink-300" />
          <p className="mt-2 text-sm text-ink-500">No vessels assigned to this SMS Fleet Scope.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filteredRows}
          pageSize={50}
          compact
          fullWidth
          searchable
          searchPlaceholder="Search fleet by name, IMO, flag…"
          searchFn={(r, q) =>
            r.name.toLowerCase().includes(q) ||
            r.imo_number.toLowerCase().includes(q) ||
            (r.flag_state ?? '').toLowerCase().includes(q) ||
            (r.vessel_type ?? '').toLowerCase().includes(q) ||
            (r.class_society ?? '').toLowerCase().includes(q) ||
            (r.profileName ?? '').toLowerCase().includes(q)
          }
          emptyMessage="No vessels match your search."
        />
      )}

      {showForm && tenant && (
        <VesselForm
          profiles={profiles}
          onClose={() => setShowForm(false)}
          onSave={async (v, profileId) => {
            const effectiveProfileId = profileId ?? null;
            if (isDemoMode()) {
              const profile = profiles.find((p) => p.id === effectiveProfileId);
              const version = profile?.version ?? tenant.sms_version;
              const newVesselId = demoCreateVessel(tenant.id, v, version);
              if (effectiveProfileId) await assignVesselToProfile(tenant.id, effectiveProfileId, newVesselId);
              await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'crew', action: `Vessel profile created: ${v.name}`, target: v.imo_number, location: v.name });
            } else {
              const profile = profiles.find((p) => p.id === effectiveProfileId);
              const version = profile?.version ?? tenant.sms_version;
              const { data: created, error } = await supabase.from('vessels').insert({ ...v, tenant_id: tenant.id, sms_active_version: version }).select().single();
              if (!error && created && effectiveProfileId) {
                await assignVesselToProfile(tenant.id, effectiveProfileId, created.id);
              }
              if (!error) {
                await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'crew', action: `Vessel profile created: ${v.name}`, target: v.imo_number, location: v.name });
              }
            }
            postSyncEvent({ type: 'VESSELS_UPDATED', tenantId: tenant.id, payload: { action: 'vessel_created', name: v.name } });
            postSyncEvent({ type: 'PROFILES_UPDATED', tenantId: tenant.id, payload: { action: 'vessel_created', name: v.name } });
            setShowForm(false);
            await load();
          }}
        />
      )}

      {deleteFor && (
        <DeleteVesselModal
          vessel={deleteFor}
          onClose={() => setDeleteFor(null)}
          onConfirm={() => confirmDelete(deleteFor)}
        />
      )}

      {editFor && tenant && (
        <VesselForm
          profiles={profiles}
          editVessel={editFor}
          currentProfileId={editForProfileId}
          onClose={() => { setEditFor(null); setEditForProfileId(null); }}
          onSave={async (v, profileId) => {
            if (isDemoMode()) {
              demoUpdateVessel(tenant.id, editFor.id, v);
              await assignVesselToProfile(tenant.id, profileId ?? '', editFor.id);
              await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'crew', action: `Vessel profile updated: ${v.name}`, target: v.imo_number, location: v.name });
            } else {
              await supabase.from('vessels').update(v).eq('id', editFor.id).eq('tenant_id', tenant.id);
              await assignVesselToProfile(tenant.id, profileId ?? '', editFor.id);
              await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'crew', action: `Vessel profile updated: ${v.name}`, target: v.imo_number, location: v.name });
            }
            postSyncEvent({ type: 'PROFILES_UPDATED', tenantId: tenant.id, payload: { action: 'vessel_edited', vesselId: editFor.id, profileId } });
            postSyncEvent({ type: 'VESSELS_UPDATED', tenantId: tenant.id, payload: { action: 'vessel_edited', vesselId: editFor.id, profileId } });
            setEditFor(null);
            setEditForProfileId(null);
            await load();
          }}
        />
      )}

      {manningFor && tenant && (
        <VesselManningDrawer
          vessel={manningFor}
          onClose={() => setManningFor(null)}
          onChanged={load}
        />
      )}

      {smsStatusFor && tenant && (
        <VesselSmsStatusDrawer
          vessel={smsStatusFor}
          onClose={() => setSmsStatusFor(null)}
          onSync={() => { doSync(smsStatusFor); }}
          syncing={syncing === smsStatusFor.id}
          onSaveVersion={async (version: string) => {
            if (isDemoMode()) {
              demoUpdateVesselSync(tenant.id, smsStatusFor.id, version);
            } else {
              await supabase.from('vessels').update({ sms_active_version: version }).eq('id', smsStatusFor.id).eq('tenant_id', tenant.id);
            }
            await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Vessel SMS version set to v${version} for ${smsStatusFor.name}`, target: smsStatusFor.imo_number, location: smsStatusFor.name });
            postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'vessel_version_set', vesselId: smsStatusFor.id, version } });
            setSmsStatusFor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function DeleteVesselModal({ vessel, onClose, onConfirm }: {
  vessel: VesselRow;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const match = confirmText.trim().toLowerCase() === vessel.name.toLowerCase();

  async function handleConfirm() {
    if (!match) return;
    setBusy(true);
    await onConfirm();
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Delete Vessel Profile" subtitle={`${vessel.name} · IMO ${vessel.imo_number}`}
      icon={<Trash2 className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={!match || busy} onClick={handleConfirm} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Permanently'}
        </button></>}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This permanently deletes <strong>{vessel.name}</strong> and all associated crew assignment history. This cannot be undone.</p>
        </div>
        <div>
          <label className="label">Type the vessel name <span className="font-mono font-bold text-danger-600">{vessel.name}</span> to confirm</label>
          <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={vessel.name} autoFocus />
        </div>
      </div>
    </Modal>
  );
}

function VesselForm({ profiles, editVessel, currentProfileId, onClose, onSave }: { profiles: SmsProfileWithVessels[]; editVessel?: VesselRow | null; currentProfileId?: string | null; onClose: () => void; onSave: (v: Omit<VesselRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'last_sync_at' | 'sms_active_version'>, profileId: string | null) => void }) {
  const isEdit = !!editVessel;
  const [form, setForm] = useState({
    name: editVessel?.name ?? '',
    imo_number: editVessel?.imo_number ?? '',
    call_sign: editVessel?.call_sign ?? '',
    flag_state: editVessel?.flag_state ?? '',
    port_of_registry: editVessel?.port_of_registry ?? '',
    gross_tonnage: editVessel?.gross_tonnage?.toString() ?? '',
    kw_power: editVessel?.kw_power?.toString() ?? '',
    vessel_type: editVessel?.vessel_type ?? '',
    class_society: editVessel?.class_society ?? '',
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string>(currentProfileId ?? '');

  return (
    <Modal
      open onClose={onClose} title={isEdit ? 'Edit Vessel Profile' : 'Create Vessel Profile'} subtitle={isEdit ? editVessel!.name : 'Core identifiers & technical specs'} icon={<Ship className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={!form.name || !form.imo_number} onClick={() => onSave({
          ...form,
          gross_tonnage: form.gross_tonnage ? +form.gross_tonnage : null,
          kw_power: form.kw_power ? +form.kw_power : null,
        }, selectedProfileId || null)} className="btn-primary">{isEdit ? 'Save Changes' : 'Create'}</button></>}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vessel Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="IMO Number" value={form.imo_number} onChange={(v) => setForm({ ...form, imo_number: v })} required />
        <Field label="Call Sign" value={form.call_sign} onChange={(v) => setForm({ ...form, call_sign: v })} />
        <Field label="Flag State" value={form.flag_state} onChange={(v) => setForm({ ...form, flag_state: v })} />
        <Field label="Port of Registry" value={form.port_of_registry} onChange={(v) => setForm({ ...form, port_of_registry: v })} />
        <Field label="Vessel Type" value={form.vessel_type} onChange={(v) => setForm({ ...form, vessel_type: v })} />
        <Field label="Gross Tonnage" value={form.gross_tonnage} onChange={(v) => setForm({ ...form, gross_tonnage: v })} type="number" />
        <Field label="kW Power" value={form.kw_power} onChange={(v) => setForm({ ...form, kw_power: v })} type="number" />
        <Field label="Class Society" value={form.class_society} onChange={(v) => setForm({ ...form, class_society: v })} />
        <div className="sm:col-span-2">
          <label className="label">Assigned SMS Profile <span className="text-[11px] font-normal text-ink-400">(determines the vessel's active document baseline)</span></label>
          <select
            className="input"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
          >
            <option value="">— Select an SMS Profile —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>
            ))}
          </select>
          {selectedProfileId && (
            <p className="mt-1.5 text-[11px] text-success-600 dark:text-success-400">
              Vessel will be bound to SMS version v{profiles.find((p) => p.id === selectedProfileId)?.version}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-danger-500"> *</span>}</label>
      <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Vessel Manning Drawer ──────────────────────────────────────────────────
// Opens from the "Active Crew" badge in the fleet table. Shows all officers
// currently signed on to the vessel, with quick Sign Off buttons, plus a
// Sign On panel to assign ashore crew to this vessel.

interface ManningCrew {
  user: TenantUserRow;
  assignment: CrewAssignmentRow | null;
}

function VesselManningDrawer({ vessel, onClose, onChanged }: {
  vessel: VesselRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { tenant, tenantUser } = useAuth();
  const [onboard, setOnboard] = useState<ManningCrew[]>([]);
  const [ashorePool, setAshorePool] = useState<TenantUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadManning() {
    if (!tenant) return;
    setLoading(true);
    if (isDemoMode()) {
      const allUsers = getEffectiveDemoUsers(tenant.id).filter((u) => u.role === 'vessel' && u.status !== 'inactive');
      const allActiveAssignments = getEffectiveDemoAssignments(tenant.id);
      const thisVesselAssignments = allActiveAssignments.filter((a) => a.vessel_id === vessel.id);
      const onb: ManningCrew[] = thisVesselAssignments.map((a) => ({
        user: allUsers.find((u) => u.id === a.user_id) as TenantUserRow,
        assignment: a,
      })).filter((r) => r.user);
      const allAssignedUserIds = new Set(allActiveAssignments.map((a) => a.user_id));
      const ashore = allUsers.filter((u) => !allAssignedUserIds.has(u.id));
      setOnboard(onb);
      setAshorePool(ashore);
      setLoading(false);
      return;
    }
    const [{ data: thisVesselAssignments }, { data: allActiveAssignments }, { data: users }] = await Promise.all([
      supabase.from('crew_assignments').select('*').eq('vessel_id', vessel.id).is('signed_off_at', null),
      supabase.from('crew_assignments').select('user_id').eq('tenant_id', tenant.id).is('signed_off_at', null),
      supabase.from('tenant_users').select('*').eq('tenant_id', tenant.id).eq('role', 'vessel').neq('status', 'inactive').order('name'),
    ]);
    const assignmentList = (thisVesselAssignments as CrewAssignmentRow[]) ?? [];
    const userList = (users as TenantUserRow[]) ?? [];
    const allAssignedUserIds = new Set((allActiveAssignments ?? []).map((a: { user_id: string }) => a.user_id));
    const onb: ManningCrew[] = assignmentList.map((a) => ({
      user: userList.find((u) => u.id === a.user_id) as TenantUserRow,
      assignment: a,
    })).filter((r) => r.user);
    const ashore = userList.filter((u) => !allAssignedUserIds.has(u.id));
    setOnboard(onb);
    setAshorePool(ashore);
    setLoading(false);
  }

  useEffect(() => { loadManning(); }, [vessel.id]);

  async function handleSignOff(row: ManningCrew) {
    if (!row.assignment) return;
    setBusy(row.user.id);
    if (isDemoMode()) {
      demoSignOff(tenant!.id, row.assignment.id);
    } else {
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() }).eq('id', row.assignment.id);
    }
    await logAudit({
      tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'crew',
      action: `Sign-Off: ${row.user.name} (${row.assignment.rank}) from ${vessel.name}`,
      target: row.user.email, location: vessel.name, severity: 'warning',
    });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'sign_off', userId: row.user.id, vessel: vessel.name } });
    setBusy(null);
    onChanged();
    loadManning();
  }

  async function handleSignOn(user: TenantUserRow) {
    setBusy(user.id);
    if (isDemoMode()) {
      demoSignOn(tenant!.id, user.id, vessel.id, user.rank);
    } else {
      // Enforce mutual exclusivity: sign off any existing active assignment first
      await supabase.from('crew_assignments').update({ signed_off_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('tenant_id', tenant!.id).is('signed_off_at', null);
      const { error } = await supabase.from('crew_assignments').insert({
        vessel_id: vessel.id, tenant_id: tenant!.id, user_id: user.id, rank: user.rank,
      });
      if (error) { setBusy(null); return; }
    }
    await logAudit({
      tenantId: tenant!.id, actorEmail: tenantUser!.email, category: 'crew',
      action: `Sign-On: ${user.name} → ${user.rank} on ${vessel.name}`,
      target: user.email, location: vessel.name,
    });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId: tenant!.id, payload: { action: 'sign_on', userId: user.id, vessel: vessel.name, rank: user.rank } });
    setBusy(null);
    onChanged();
    loadManning();
  }

  return (
    <Modal
      open onClose={onClose}
      title="Officers & Crew On Board"
      subtitle={`${vessel.name} · ${onboard.length} signed on · ${vessel.vessel_type ?? 'Vessel'}`}
      icon={<Users className="h-5 w-5" />}
      size="3xl"
      scrollable
      footer={<button onClick={onClose} className="btn-secondary">Close</button>}
    >
      {loading ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-500" /></div>
      ) : (
        <div className="space-y-4">
          {/* Currently on board */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              <Anchor className="h-3.5 w-3.5 text-success-500" /> Currently On Board
              {onboard.length > 0 && <span className="ml-1 rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-bold text-success-700 dark:bg-success-900/40 dark:text-success-300">{onboard.length}</span>}
            </h3>
            {onboard.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-200 py-5 text-center dark:border-ink-700">
                <Anchor className="mx-auto mb-1 h-5 w-5 text-ink-300" />
                <p className="text-sm text-ink-400">No crew currently signed on to this vessel.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-ink-200/70 dark:border-ink-800">
                {onboard.map((row, i) => (
                  <div key={row.user.id} className={`flex items-center gap-3 px-3 py-2.5 ${i < onboard.length - 1 ? 'border-b border-ink-100 dark:border-ink-800' : ''} bg-white dark:bg-ink-900 hover:bg-success-50/30 dark:hover:bg-success-900/10 transition-colors`}>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-300">
                      <Users className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-800 dark:text-white">{row.user.name}</p>
                      <p className="text-[11px] text-ink-400">Since {row.assignment ? new Date(row.assignment.signed_on_at).toLocaleDateString() : '—'}</p>
                    </div>
                    <Badge tone="success" className="!text-[10px] shrink-0">{row.assignment?.rank}</Badge>
                    <button
                      onClick={() => handleSignOff(row)}
                      disabled={busy === row.user.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning-50 px-2 py-1 text-[11px] font-bold text-warning-700 transition hover:bg-warning-100 disabled:opacity-40 dark:bg-warning-900/30 dark:text-warning-300"
                    >
                      {busy === row.user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                      Sign Off
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available to sign on */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              <LogIn className="h-3.5 w-3.5 text-primary-500" /> UNASSIGNED / STANDBY CREW POOL ({ashorePool.length})
            </h3>
            {ashorePool.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-200 py-5 text-center dark:border-ink-700">
                <p className="text-sm text-ink-400">All seafarers are currently signed on to a vessel.</p>
              </div>
            ) : (
              <div className="max-h-[380px] overflow-y-auto overscroll-contain rounded-lg border border-ink-200/70 dark:border-ink-800">
                {ashorePool.map((user, i) => (
                  <div key={user.id} className={`flex items-center gap-3 px-3 py-2.5 ${i < ashorePool.length - 1 ? 'border-b border-ink-100 dark:border-ink-800' : ''} bg-white dark:bg-ink-900 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 transition-colors`}>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
                      <Users className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-800 dark:text-white">{user.name}</p>
                      <p className="truncate text-[11px] text-ink-400">{user.email}</p>
                    </div>
                    <Badge tone="neutral" className="!text-[10px] shrink-0">{user.rank}</Badge>
                    <button
                      onClick={() => handleSignOn(user)}
                      disabled={busy === user.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success-50 px-2 py-1 text-[11px] font-bold text-success-700 transition hover:bg-success-100 disabled:opacity-40 dark:bg-success-900/30 dark:text-success-300"
                    >
                      {busy === user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                      Sign On
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {onboard.length === 0 && ashorePool.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-200 p-6 text-center dark:border-ink-700">
              <p className="text-sm text-ink-400">No vessel crew found in this tenant.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function VesselSmsStatusDrawer({ vessel, onClose, onSync, syncing, onSaveVersion }: {
  vessel: FleetRow;
  onClose: () => void;
  onSync: () => void;
  syncing: boolean;
  onSaveVersion: (version: string) => Promise<void>;
}) {
  const activeVersion = vessel.profileVersion ?? vessel.sms_active_version;
  const isUpToDate = vessel.profileVersion ? vessel.sms_active_version === vessel.profileVersion : true;
  const [versionInput, setVersionInput] = useState(String(activeVersion ?? ''));
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Vessel SMS Status — ${vessel.name}`}
      subtitle={`IMO ${vessel.imo_number}`}
      icon={<FileText className="h-5 w-5" />}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={onSync} disabled={syncing} className="btn-primary">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-900/50">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Assigned SMS Profile</p>
            <p className="text-sm font-bold text-ink-900 dark:text-white">{vessel.profileName ?? 'Default (no profile assigned)'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Active Version</p>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="text"
                className="w-28 rounded border border-ink-200 px-2 py-1 text-sm font-bold text-primary-700 dark:border-ink-600 dark:bg-ink-900 dark:text-primary-300"
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
                placeholder="v1.0.0, Rev 4.0, E-1.0…"
              />
              <button
                disabled={saving || !versionInput.trim()}
                onClick={async () => {
                  setSaving(true);
                  await onSaveVersion(versionInput.trim());
                  setSaving(false);
                }}
                className="rounded bg-primary-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Version'}
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Sync Status</p>
            <div className="mt-1 flex items-center gap-1.5">
              {isUpToDate ? (
                <><CheckCircle2 className="h-4 w-4 text-success-500" /><span className="text-sm font-bold text-success-600 dark:text-success-400">Up to Date</span></>
              ) : (
                <><Clock className="h-4 w-4 text-warning-500" /><span className="text-sm font-bold text-warning-600 dark:text-warning-400">Pending Update</span></>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Last Successful Sync</p>
          <p className="mt-1 text-sm font-semibold text-ink-700 dark:text-ink-200">
            {vessel.last_sync_at ? new Date(vessel.last_sync_at).toLocaleString() : 'Never synced'}
          </p>
        </div>

        {!isUpToDate && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>This vessel's active SMS version (v{vessel.sms_active_version}) is behind the profile version (v{vessel.profileVersion}). Click <strong>Sync Now</strong> to pull the latest DPA-approved documents.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
