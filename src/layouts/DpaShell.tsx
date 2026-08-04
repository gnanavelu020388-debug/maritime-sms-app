import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  LayoutDashboard, FileText, BookOpen, Library, Shield, Menu, LogOut, Lock,
  Ship, Users, ScrollText, Settings, Grid3x3,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { roleLabel } from '../lib/auth-utils';
import { Toaster } from '../components/Toaster';
import { StoreProvider } from '../store';
import { MaintenanceBanner } from '../components/MaintenanceBanner';
import { DemoSessionSwitcher } from '../components/DemoSessionSwitcher';
import { VesselSyncStatusCompact } from '../components/VesselSyncStatusPill';
import { getSyncStatus } from '../lib/syncService';
import { useFeatureFlags, useModuleDefinitions, getDisplayName, type ModuleKey } from '../lib/featureFlags';
import { SessionSecurityGuard, broadcastSecurityTenant } from '../components/SessionSecurityGuard';
import { getShorePermsForRole, resolveShoreRoleName, canDoShore } from '../lib/shoreRoles';

export type DpaSection =
  | 'dashboard'
  | 'approvals'
  | 'library'
  | 'master_library'
  | 'fleet'
  | 'crew'
  | 'audit'
  | 'security';

interface NavItemDef {
  id: DpaSection;
  label: string;
  icon: ReactNode;
  feature: ModuleKey;
  perm?: string;
}

const STATIC_NAV_IDS: { id: DpaSection; icon: ReactNode; feature: ModuleKey }[] = [
  { id: 'dashboard', icon: <LayoutDashboard className="h-4 w-4" />, feature: 'sms_documentation' },
  { id: 'approvals', icon: <FileText className="h-4 w-4" />, feature: 'sms_documentation' },
  { id: 'library', icon: <BookOpen className="h-4 w-4" />, feature: 'sms_documentation' },
  { id: 'master_library', icon: <Library className="h-4 w-4" />, feature: 'sms_documentation' },
];

const DYNAMIC_NAV_IDS: { id: DpaSection; icon: ReactNode; feature: ModuleKey; perm: string }[] = [
  { id: 'fleet', icon: <Ship className="h-4 w-4" />, feature: 'sms_documentation', perm: 'manage_vessels' },
  { id: 'crew', icon: <Users className="h-4 w-4" />, feature: 'sms_documentation', perm: 'manage_crew' },
  { id: 'audit', icon: <ScrollText className="h-4 w-4" />, feature: 'sms_documentation', perm: 'view_audit' },
  { id: 'security', icon: <Settings className="h-4 w-4" />, feature: 'sms_documentation', perm: 'manage_security' },
];

export function DpaShell({ children, active, demoMode = false }: { children: ReactNode; active: DpaSection; demoMode?: boolean }) {
  const { user, role, tenant, tenantUser, signOut } = useAuth();
  const { isEnabled } = useFeatureFlags(tenant?.id);
  const { defs } = useModuleDefinitions();
  const smsLabel = getDisplayName('sms_documentation', defs);

  const STATIC_NAV: NavItemDef[] = STATIC_NAV_IDS.map((s) => ({
    ...s,
    label: s.id === 'dashboard' ? 'DPA Dashboard' : s.id === 'approvals' ? `${smsLabel} Approvals Queue` : s.id === 'library' ? 'SMS Review & Deployment' : 'Master SMS Library',
  }));

  // ── Dynamic nav based on shore role permissions ───────────────────
  const shoreNavItems = useMemo(() => {
    if (!tenant) return [];
    const shoreRoleName = resolveShoreRoleName(tenantUser?.rank);
    const perms = getShorePermsForRole(tenant.id, shoreRoleName);
    const labelMap: Record<DpaSection, string> = {
      fleet: 'Fleet & Vessel Profiles',
      crew: 'Crew & User Management',
      audit: 'Audit & Compliance Ledger',
      security: 'Security Settings',
      dashboard: 'DPA Dashboard',
      approvals: `${smsLabel} Approvals Queue`,
      library: 'SMS Review & Deployment',
      master_library: 'Master SMS Library',
    };
    return DYNAMIC_NAV_IDS.filter((item) => canDoShore(perms, item.perm)).map((item) => ({
      id: item.id,
      label: labelMap[item.id],
      icon: item.icon,
      feature: item.feature,
      perm: item.perm,
    }));
  }, [tenant, tenantUser?.rank, smsLabel]);

  const allNav = [...STATIC_NAV, ...shoreNavItems];
  const items = allNav.filter((n) => isEnabled(n.feature));

  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    getSyncStatus(tenant.id).then((s) => setLastSyncAt(s.lastSyncAt));
  }, [tenant?.id]);
  const [open, setOpen] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);

  useEffect(() => {
    broadcastSecurityTenant(tenant?.id);
  }, [tenant?.id]);

  function handleSignOut() {
    if (demoMode) {
      setShowSwitcher(true);
    } else {
      signOut();
    }
  }

  return (
    <StoreProvider>
    <SessionSecurityGuard>
      <div className="flex h-screen overflow-hidden bg-ink-50 dark:bg-ink-950">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-ink-200/70 bg-white transition-transform dark:border-ink-800 dark:bg-ink-900 lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-16 items-center gap-2 border-b border-ink-100 px-4 dark:border-ink-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-primary-500 text-white">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{tenant?.company ?? 'Company'}</p>
              <p className="truncate text-[10px] text-accent-600 dark:text-accent-400">{tenantUser?.rank ? resolveShoreRoleName(tenantUser.rank) : roleLabel(role!)} · SMS & Compliance</p>
            </div>
          </div>
          <nav className="flex flex-col gap-1 p-3">
            {items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('dpa-nav', { detail: item.id })); setOpen(false); }}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active === item.id
                    ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                    : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                }`}
              >
                {item.icon}{item.label}
              </a>
            ))}
          </nav>
          {/* Restricted access notice */}
          <div className="absolute bottom-4 left-3 right-3 rounded-lg border border-ink-200 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-800/50">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-500" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">DPA Access</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink-400">SMS review, approval &amp; publishing. Additional management links appear when your shore role permissions are enabled by the Company Admin.</p>
              </div>
            </div>
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <MaintenanceBanner />
          <header className="flex h-16 items-center justify-between border-b border-ink-100 bg-white px-4 dark:border-ink-800 dark:bg-ink-900">
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden lg:flex items-center gap-2">
              {active !== 'dashboard' && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('dpa-nav', { detail: 'dashboard' }))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-accent-300 hover:text-accent-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-accent-600"
                  title="Back to Apps Launchpad"
                >
                  <Grid3x3 className="h-4 w-4" />
                  Apps Launchpad
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <VesselSyncStatusCompact
                lastSyncAt={lastSyncAt}
                pendingSyncItems={0}
                localVersion={tenant?.sms_version ?? null}
              />
              <div className="text-right">
                <p className="text-xs font-semibold text-ink-800 dark:text-white">{user?.email}</p>
                <p className="text-[10px] text-accent-600 dark:text-accent-400">{tenantUser?.rank ? resolveShoreRoleName(tenantUser.rank) : 'DPA'} · SMS v{tenant?.sms_version ?? '—'}</p>
              </div>
              <button onClick={handleSignOut} className="rounded-lg p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30" title="Sign Out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto px-6 py-6">
            <div className="w-full animate-fade-in">{children}</div>
          </main>
        </div>
        {demoMode && <DemoSessionSwitcher open={showSwitcher} onClose={() => setShowSwitcher(false)} />}
        <Toaster />
      </div>
    </SessionSecurityGuard>
    </StoreProvider>
  );
}
