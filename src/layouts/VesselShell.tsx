import { useEffect, useState, type ReactNode } from 'react';
import {
  Anchor, LogOut, Ship, Lock, ShieldX, Zap, Loader2, ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useDemoAuth } from '../lib/demoAuth';
import { startSyncLoop, getSyncStatus, replicateToShoreNow, type SyncResult } from '../lib/syncService';
import { getLocalSmsVersion } from '../lib/localVesselDb';
import { getEffectiveDemoVessels, getEffectiveDemoAssignments, getEffectiveDemoUsers } from '../lib/demoData';
import { getProfileForVessel, type SmsProfile } from '../lib/smsProfiles';
import { DemoSessionSwitcher } from '../components/DemoSessionSwitcher';
import { useVesselConnection } from '../lib/useVesselConnection';
import { VesselSyncStatusPill } from '../components/VesselSyncStatusPill';
import { useSyncConfig, useModuleDefinitions, getDisplayName, type ModuleKey } from '../lib/featureFlags';
import type { Rank } from '../lib/supabase';
import { SessionSecurityGuard, broadcastSecurityTenant } from '../components/SessionSecurityGuard';
import { BridgeDrawer, type DrawerSection } from '../components/BridgeDrawer';

import { Toaster } from '../components/Toaster';
import { StoreProvider } from '../store';
import { SmsUpdateBanner } from '../components/SmsUpdateBanner';
import { MaintenanceBanner } from '../components/MaintenanceBanner';

export function VesselShell({
  children, demoMode = false, activeModule, onReturnToDashboard,
  drawerOpen, onDrawerOpenChange, drawerSection, onSelectDrawerSection,
}: {
  children: ReactNode;
  demoMode?: boolean;
  activeModule: ModuleKey | null;
  onReturnToDashboard: () => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  drawerSection: DrawerSection | null;
  onSelectDrawerSection: (section: DrawerSection) => void;
}) {
  const { user, tenant, activeAssignment, tenantUser, signOut } = useAuth();
  const demo = useDemoAuth();
  const [localVersion, setLocalVersion] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [isReplicating, setIsReplicating] = useState(false);
  const [syncIntervalMs, setSyncIntervalMs] = useState<number | null>(null);
  const [manualReplicateEnabled, setManualReplicateEnabled] = useState(false);
  const [showReplicateConfirm, setShowReplicateConfirm] = useState(false);
  const [replicateConfirmText, setReplicateConfirmText] = useState('');

  useEffect(() => {
    broadcastSecurityTenant(tenant?.id);
  }, [tenant?.id]);

  const { config: syncConfig } = useSyncConfig(tenant?.id);
  useEffect(() => {
    if (!syncConfig) return;
    setSyncIntervalMs(syncConfig.auto_sync_interval_hours * 60 * 60 * 1000);
    setManualReplicateEnabled(syncConfig.manual_replicate_enabled);
  }, [syncConfig]);

  const crewRank: Rank | null = activeAssignment?.rank ?? tenantUser?.rank as Rank ?? null;
  const canReplicate = (crewRank === 'Master' || crewRank === 'Chief Engineer') && manualReplicateEnabled;

  const vesselConn = useVesselConnection(tenant?.id);

  const allDemoVessels = demo && tenant ? getEffectiveDemoVessels(tenant.id) : [];
  const demoVesselUsers = demo && tenant
    ? getEffectiveDemoUsers(tenant.id).filter((u) => u.role === 'vessel')
    : [];
  const currentUserObj = demoVesselUsers.find((u) => u.id === demo?.demoSession.userId) ?? demoVesselUsers[0];

  const assignedVesselIds = demo && tenant && currentUserObj
    ? new Set(getEffectiveDemoAssignments(tenant.id).filter((a) => a.user_id === currentUserObj.id).map((a) => a.vessel_id))
    : new Set<string>();
  const demoVessels = demo && tenant
    ? (currentUserObj ? allDemoVessels.filter((v) => assignedVesselIds.has(v.id)) : allDemoVessels)
    : [];
  const currentVessel = demoVessels.find((v) => v.id === demo?.demoSession.vesselId) ?? demoVessels[0] ?? null;

  const activeVesselId = activeAssignment?.vessel_id ?? currentVessel?.id;

  useEffect(() => {
    if (!tenant?.id) return;
    const tenantId = tenant.id;
    getSyncStatus(tenantId).then((s) => {
      setLocalVersion(s.localVersion);
      setLastSync(s.lastSyncAt);
    });
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id || syncIntervalMs === null) return;
    const tenantId = tenant.id;
    const vesselId = activeVesselId;
    const stop = startSyncLoop(tenantId, () => {
      getSyncStatus(tenantId).then((s) => {
        setLocalVersion(s.localVersion);
        setLastSync(s.lastSyncAt);
      });
    }, syncIntervalMs, vesselId);
    return stop;
  }, [tenant?.id, syncIntervalMs, activeVesselId]);

  useEffect(() => {
    if (!tenant?.id) return;
    getLocalSmsVersion(tenant.id).then(setLocalVersion);
  }, [tenant?.id, tenant?.sms_version]);

  const versionLabel = localVersion ?? tenant?.sms_version ?? '—';

  const [vesselProfile, setVesselProfile] = useState<SmsProfile | null>(null);
  useEffect(() => {
    const vesselId = activeAssignment?.vessel_id ?? currentVessel?.id;
    if (!tenant?.id || !vesselId) { setVesselProfile(null); return; }
    getProfileForVessel(tenant.id, vesselId).then(setVesselProfile);
  }, [tenant?.id, activeAssignment?.vessel_id, currentVessel?.id]);

  async function handleReplicateToShore() {
    if (!tenant?.id || !canReplicate || isReplicating) return;
    setShowReplicateConfirm(true);
    setReplicateConfirmText('');
  }

  async function executeReplication() {
    if (!tenant?.id || isReplicating) return;
    setIsReplicating(true);
    setShowReplicateConfirm(false);
    try {
      const result: SyncResult = await replicateToShoreNow(tenant.id, activeVesselId);
      if (result.applied) {
        setLastSync(new Date().toISOString());
        if (result.toVersion) setLocalVersion(result.toVersion);
      }
    } catch {
      // Silently handle
    } finally {
      setIsReplicating(false);
      setReplicateConfirmText('');
    }
  }

  function handleSignOut() {
    if (demoMode) {
      setShowSwitcher(true);
    } else {
      signOut();
    }
  }

  const isMasterOrChiefEng = crewRank === 'Master' || crewRank === 'Chief Engineer';

  if (demoMode && tenant && currentUserObj && demoVessels.length === 0) {
    return (
      <StoreProvider>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 p-6 text-center dark:bg-ink-950">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
            <ShieldX className="h-8 w-8 text-danger-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">Access Blocked — No Active Vessel Assignment</h1>
            <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
              You are not currently signed on to any vessel. Shipboard users can only access the vessel they are actively assigned to by Company Admin.
            </p>
            <p className="mt-3 text-xs text-ink-400">Contact your Company Admin or DPA to be signed on to a vessel.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-2 text-xs text-ink-500 dark:bg-ink-800 dark:text-ink-300">
            <Anchor className="h-4 w-4" /> Status: <strong className="font-semibold">Ashore / Unassigned</strong>
          </div>
          <button onClick={handleSignOut} className="btn-secondary mt-2">Back to Session Switcher</button>
        </div>
      </StoreProvider>
    );
  }

  const { defs } = useModuleDefinitions();
  const activeModuleLabel = activeModule ? getDisplayName(activeModule, defs) : null;

  const isInModule = activeModule !== null || drawerSection !== null;
  const vesselName = activeAssignment?.vessel_name ?? currentVessel?.name ?? tenant?.company ?? 'Vessel Portal';

  return (
    <StoreProvider>
    <SessionSecurityGuard>
    <div className="flex min-h-screen flex-col bg-ink-50 dark:bg-ink-950">
      <MaintenanceBanner />

      {/* Top bar — minimal and clean */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-100 bg-white/95 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95">
        <div className="flex items-center gap-3">
          {/* Return to Dashboard button — shown when inside a module or drawer section */}
          {isInModule && (
            <button
              onClick={onReturnToDashboard}
              className="flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-900/20 dark:text-primary-300 dark:hover:bg-primary-900/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Master Dashboard
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white">
              <Anchor className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-900 dark:text-white">{vesselName}</p>
              <p className="text-[10px] text-ink-400">
                {crewRank ? `${crewRank}` : 'Crew'}{activeModule ? ` · ${activeModuleLabel ?? 'Module'}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <VesselSyncStatusPill
            lastSyncAt={lastSync ?? vesselConn.lastSyncAt}
            pendingSyncItems={0}
            localVersion={versionLabel}
          />

          {canReplicate && (
            <button
              onClick={handleReplicateToShore}
              disabled={isReplicating}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                isReplicating
                  ? 'bg-ink-200 text-ink-400 dark:bg-ink-700 dark:text-ink-500'
                  : 'bg-warning-500 text-white hover:bg-warning-600 shadow-sm'
              }`}
              title="Manually trigger data replication to shore now (requires confirmation)"
            >
              {isReplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {isReplicating ? 'Replicating…' : 'Replicate to Shore Now'}
            </button>
          )}

          {showReplicateConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowReplicateConfirm(false)}>
              <div className="w-full max-w-md rounded-xl border border-warning-200 bg-white p-6 dark:border-warning-800 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-900/30">
                    <ShieldAlert className="h-5 w-5 text-warning-600 dark:text-warning-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink-900 dark:text-white">Confirm Shore Replication</h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">Dual-authentication security check</p>
                  </div>
                </div>
                <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">
                  You are about to manually replicate <strong>all pending vessel data across every active module</strong> to the shore server. This action is logged in the audit trail.
                  Your identity: <strong className="font-semibold">{tenantUser?.name}</strong> ({crewRank})
                </p>
                <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
                  Type <span className="font-mono text-warning-600 dark:text-warning-400">REPLICATE</span> to confirm:
                </p>
                <input
                  value={replicateConfirmText}
                  onChange={(e) => setReplicateConfirmText(e.target.value)}
                  placeholder="REPLICATE"
                  className="input mb-4 font-mono"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowReplicateConfirm(false)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    onClick={executeReplication}
                    disabled={replicateConfirmText.trim().toUpperCase() !== 'REPLICATE' || isReplicating}
                    className="flex-1 rounded-lg bg-warning-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-warning-600 disabled:opacity-40"
                  >
                    {isReplicating ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Confirm Replication'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold text-ink-800 dark:text-white">{tenantUser?.name ?? user?.email}</p>
            <p className="text-[10px] text-ink-400">SMS v{versionLabel}{lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString()}` : ''}</p>
          </div>

          {demoMode && currentVessel && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300" title="Vessel locked to your active sign-on assignment">
              <Lock className="h-3 w-3 text-ink-400" />
              <Ship className="h-3.5 w-3.5 text-primary-500" />
              <span className="max-w-[120px] truncate">{currentVessel.name}</span>
            </div>
          )}

          {demoMode && currentUserObj && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300" title="Crew identity locked to your authenticated sign-on">
              <Lock className="h-3 w-3 text-ink-400" />
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[9px] font-bold text-accent-600">
                {currentUserObj.name.split(' ').map((w) => w[0]).join('')}
              </div>
              <span className="max-w-[120px] truncate">{currentUserObj.rank} {currentUserObj.name}</span>
            </div>
          )}

          <button onClick={handleSignOut} className="rounded-lg p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30" title="Sign Out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <SmsUpdateBanner />

      <div className="flex flex-1">
        {/* Bridge Drawer — state lifted to VesselApp */}
        <BridgeDrawer
          open={drawerOpen}
          onOpenChange={onDrawerOpenChange}
          vesselName={vesselName}
          crewRank={crewRank}
          isMasterOrChiefEng={isMasterOrChiefEng}
          lastSyncAt={lastSync ?? vesselConn.lastSyncAt}
          localVersion={versionLabel}
          activeSection={drawerSection}
          onSelectSection={onSelectDrawerSection}
        />

        {/* Main content area — offset by drawer width when open */}
        <main className={`flex-1 overflow-x-hidden px-6 py-6 transition-all duration-200 ${drawerOpen ? 'ml-[260px]' : 'ml-0'}`}>
          {children}
        </main>
      </div>

      {demoMode && <DemoSessionSwitcher open={showSwitcher} onClose={() => setShowSwitcher(false)} />}
      <Toaster />
    </div>
    </SessionSecurityGuard>
    </StoreProvider>
  );
}
