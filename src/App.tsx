import { AuthProvider, useAuth } from './lib/auth';
import { DemoAuthProvider } from './lib/demoAuth';
import { AuthView } from './views/AuthView';
import { SuperAdminShell } from './layouts/SuperAdminShell';
import { CompanyApp } from './apps/CompanyApp';
import { DpaApp } from './apps/DpaApp';
import { VesselApp } from './apps/VesselApp';
import { Loader2 } from 'lucide-react';
import type { PlatformRole } from './lib/supabase';
import type { User } from '@supabase/supabase-js';

function getDemoView(): PlatformRole | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'superadmin' || view === 'company' || view === 'dpa' || view === 'vessel') {
    return view === 'superadmin' ? 'super_admin' : view === 'company' ? 'company_admin' : view === 'dpa' ? 'dpa' : 'vessel';
  }
  return null;
}

function DemoRouter({ role }: { role: PlatformRole }) {
  if (role === 'super_admin') {
    const user = { id: 'demo-sa', email: 'admin@maritime-platform.io' } as unknown as User;
    return <SuperAdminShell user={user} role={role} internalRole="super_admin" onSignOut={() => {}} demoMode />;
  }
  if (role === 'company_admin') return <CompanyApp demoMode />;
  if (role === 'dpa') return <DpaApp demoMode />;
  if (role === 'vessel') return <VesselApp demoMode />;
  return null;
}

function Router() {
  const { user, role, internalRole, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 dark:bg-ink-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!user) return <AuthView />;

  if (role === 'super_admin') return <SuperAdminShell user={user} role={role} internalRole={internalRole} onSignOut={signOut} />;

  if (role === 'company_admin') return <CompanyApp />;
  if (role === 'dpa') return <DpaApp />;

  if (role === 'vessel') return <VesselApp />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-50 p-4 text-center dark:bg-ink-950">
      <p className="text-lg font-semibold text-ink-800 dark:text-white">Account not provisioned</p>
      <p className="text-sm text-ink-500">Your account exists but hasn't been assigned to a tenant or role. Contact your platform administrator.</p>
      <button onClick={signOut} className="btn-secondary mt-2">Sign Out</button>
    </div>
  );
}

export default function App() {
  const demoRole = getDemoView();

  if (demoRole) {
    return (
      <DemoAuthProvider role={demoRole}>
        <DemoRouter role={demoRole} />
      </DemoAuthProvider>
    );
  }

  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
