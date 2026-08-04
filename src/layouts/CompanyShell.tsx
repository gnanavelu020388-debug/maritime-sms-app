import { useState, useEffect, type ReactNode } from 'react';
import {
  LayoutDashboard, Ship, FileText, Library, Users, Shield, LogOut, Anchor, Menu, X, KeyRound, Grid3x3,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { roleLabel } from '../lib/auth-utils';
import { resolveShoreRoleName } from '../lib/shoreRoles';
import { Toaster } from '../components/Toaster';
import { StoreProvider } from '../store';
import { MaintenanceBanner } from '../components/MaintenanceBanner';
import { DemoSessionSwitcher } from '../components/DemoSessionSwitcher';
import { SessionSecurityGuard, broadcastSecurityTenant } from '../components/SessionSecurityGuard';
import { useFeatureFlags, useModuleDefinitions, getDisplayName, type ModuleKey } from '../lib/featureFlags';
import type { PlatformRole } from '../lib/supabase';

export type CompanySection = 'overview' | 'vessels' | 'crew_management' | 'permissions' | 'sms_dpa' | 'master_library' | 'audit' | 'security';

function useCompanyNav(): { id: CompanySection; label: string; icon: ReactNode; roles: PlatformRole[]; feature?: ModuleKey }[] {
  const { defs } = useModuleDefinitions();
  const smsLabel = getDisplayName('sms_documentation', defs);
  const crewLabel = getDisplayName('crew_matrix', defs);
  return [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" />, roles: ['company_admin', 'dpa'] },
    { id: 'vessels', label: 'Fleet & Vessel Profiles', icon: <Ship className="h-4 w-4" />, roles: ['company_admin'] },
    { id: 'sms_dpa', label: `${smsLabel} Review & Deployment`, icon: <FileText className="h-4 w-4" />, roles: ['company_admin', 'dpa'], feature: 'sms_documentation' },
    { id: 'master_library', label: 'Master SMS Library', icon: <Library className="h-4 w-4" />, roles: ['company_admin', 'dpa'], feature: 'sms_documentation' },
    { id: 'permissions', label: 'Role & Permissions Matrix', icon: <KeyRound className="h-4 w-4" />, roles: ['company_admin'] },
    { id: 'crew_management', label: `${crewLabel} & User Management`, icon: <Users className="h-4 w-4" />, roles: ['company_admin'] },
    { id: 'security', label: 'Security Settings', icon: <Shield className="h-4 w-4" />, roles: ['company_admin'] },
    { id: 'audit', label: 'Audit & Compliance Ledger', icon: <Shield className="h-4 w-4" />, roles: ['company_admin', 'dpa'] },
  ];
}




export function CompanyShell({ children, active, demoMode = false }: { children: ReactNode; active: CompanySection; demoMode?: boolean }) {
  const { user, role, tenant, tenantUser, signOut } = useAuth();
  const { isEnabled } = useFeatureFlags(tenant?.id);
  const [open, setOpen] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);

  useEffect(() => {
    broadcastSecurityTenant(tenant?.id);
  }, [tenant?.id]);

  const navItems = useCompanyNav();
  const items = navItems.filter((n) => role && n.roles.includes(role) && (!n.feature || isEnabled(n.feature)));

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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white">
            <Anchor className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{tenant?.company ?? 'Company'}</p>
            <p className="truncate text-[10px] text-ink-400">{(role === 'company_admin' || role === 'dpa') && tenantUser?.rank ? resolveShoreRoleName(tenantUser.rank) : roleLabel(role!)}</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('company-nav', { detail: item.id })); setOpen(false); }}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active === item.id
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
              }`}
            >
              {item.icon}{item.label}
            </a>
          ))}
        </nav>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <MaintenanceBanner />
        <header className="flex h-16 items-center justify-between border-b border-ink-100 bg-white px-4 dark:border-ink-800 dark:bg-ink-900">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:flex items-center gap-2">
            {active !== 'overview' && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('company-nav', { detail: 'overview' }))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-primary-300 hover:text-primary-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-primary-600"
                title="Back to Apps Launchpad"
              >
                <Grid3x3 className="h-4 w-4" />
                Apps Launchpad
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-semibold text-ink-800 dark:text-white">{user?.email}</p>
              <p className="text-[10px] text-ink-400">SMS v{tenant?.sms_version ?? '—'}</p>
            </div>
            <button onClick={handleSignOut} className="rounded-lg p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30" title="Sign Out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full animate-fade-in">{children}</div>
        </main>
      </div>
      {demoMode && <DemoSessionSwitcher open={showSwitcher} onClose={() => setShowSwitcher(false)} />}
      <Toaster />
    </div>
    </SessionSecurityGuard>
    </StoreProvider>
  );
}

export { X };
