import { useState } from 'react';
import { StoreProvider } from '../store';
import { Sidebar } from '../components/Sidebar';
import { Topbar } from '../components/Topbar';
import { MaintenanceBanner } from '../components/MaintenanceBanner';
import { ImpersonationOverlay } from '../components/ImpersonationOverlay';
import { Toaster } from '../components/Toaster';
import { DashboardView } from '../views/DashboardView';
import { TenantsView } from '../views/TenantsView';
import { SmsView } from '../views/SmsView';
import { UsersView } from '../views/UsersView';
import { SecurityView } from '../views/SecurityView';
import { MonitoringView } from '../views/MonitoringView';
import { BillingView } from '../views/BillingView';
import { BackupsView } from '../views/BackupsView';
import { ProvisioningView } from '../views/ProvisioningView';
import { FeatureMatrixView } from '../views/FeatureMatrixView';
import type { SectionId } from '../types';
import type { User } from '@supabase/supabase-js';
import { roleLabel } from '../lib/auth-utils';
import type { PlatformRole, InternalRole } from '../lib/supabase';
import { INTERNAL_ROLE_LABEL, INTERNAL_ROLE_SUMMARY, canAccessSection, capabilitiesFor, type Capabilities } from '../lib/permissions';
import { LogOut, Lock } from 'lucide-react';
import { DemoSessionSwitcher } from '../components/DemoSessionSwitcher';

export function SuperAdminShell({ user, role, internalRole, onSignOut, demoMode = false }: { user: User; role: PlatformRole; internalRole: InternalRole | null; onSignOut: () => void; demoMode?: boolean }) {
  const [active, setActive] = useState<SectionId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const roleKey: InternalRole = internalRole ?? 'super_admin';
  const caps = capabilitiesFor(roleKey);

  // If the current section is outside this role's access matrix, show a
  // locked access-denied screen instead of the view.
  const sectionDenied = !canAccessSection(roleKey, active);

  return (
    <StoreProvider>
      <div className="flex h-screen overflow-hidden bg-ink-50 dark:bg-ink-950">
        <Sidebar active={active} onNavigate={setActive} open={sidebarOpen} onClose={() => setSidebarOpen(false)} roleKey={roleKey} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MaintenanceBanner />
          <ImpersonationOverlay />
          <Topbar active={active} onMenu={() => setSidebarOpen(true)} />
          <div className="flex items-center justify-between border-b border-ink-100 bg-white px-4 py-2 dark:border-ink-800 dark:bg-ink-900">
            <span className="text-xs text-ink-500">Signed in as <strong className="text-ink-800 dark:text-white">{user.email}</strong> · <span className="font-semibold text-primary-600">{INTERNAL_ROLE_LABEL[roleKey]}</span></span>
            <button onClick={() => demoMode ? setShowSwitcher(true) : onSignOut()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1920px] animate-fade-in">
              {sectionDenied ? (
                <AccessDenied roleKey={roleKey} />
              ) : (
                <>
                  {active === 'dashboard' && <DashboardView caps={caps} />}
                  {active === 'tenants' && <TenantsView caps={caps} />}
                  {active === 'provisioning' && <ProvisioningView caps={caps} />}
                  {active === 'sms' && <SmsView caps={caps} />}
                  {active === 'users' && <UsersView caps={caps} />}
                  {active === 'security' && <SecurityView caps={caps} />}
                  {active === 'monitoring' && <MonitoringView caps={caps} />}
                  {active === 'billing' && <BillingView caps={caps} />}
                  {active === 'backups' && <BackupsView caps={caps} />}
                  {active === 'features' && <FeatureMatrixView caps={caps} />}
                </>
              )}
            </div>
          </main>
        </div>
        {demoMode && <DemoSessionSwitcher open={showSwitcher} onClose={() => setShowSwitcher(false)} />}
        <Toaster />
      </div>
    </StoreProvider>
  );
}

function AccessDenied({ roleKey }: { roleKey: InternalRole }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
        <Lock className="h-7 w-7" />
      </div>
      <p className="text-lg font-bold text-ink-900 dark:text-white">Access restricted</p>
      <p className="max-w-md text-sm text-ink-500 dark:text-ink-400">
        Your role <strong>{INTERNAL_ROLE_LABEL[roleKey]}</strong> does not include this console area. {INTERNAL_ROLE_SUMMARY[roleKey]}
      </p>
    </div>
  );
}
