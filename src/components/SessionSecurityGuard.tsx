/**
 * SessionSecurityGuard — mounts the inactivity timeout + concurrent login
 * detection hooks for a shipboard/company portal. Shows a full-screen
 * notification when the session is terminated from another device.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  useInactivityLogout,
  useSessionGuard,
  useTenantSecuritySettings,
} from '../lib/sessionSecurity';
import { isDemoMode } from '../lib/demoData';

export function SessionSecurityGuard({ children }: { children: ReactNode }) {
  const { user, signOut, sessionToken, sessionConflict, dismissSessionConflict } = useAuth();

  // Read tenant security settings via the tenantUser's tenant_id
  // For demo mode, we read from localStorage via the hook directly.
  // The tenantId comes from the auth context's tenant, but the hook
  // is also called in the shell directly. Here we just need the timeout.
  // We get the tenantId from a separate mechanism — the shells pass it
  // via a custom event or we read it from the auth context.
  // Simplified: use the user's auth_uid to look up tenant.
  const [tenantId, setTenantId] = useState<string | null>(null);

  // In demo mode, the auth context doesn't have a real tenant ID accessible
  // here easily. The shells pass tenant via props. We use a module-level
  // setter so shells can provide the tenantId.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | null;
      setTenantId(detail);
    };
    window.addEventListener('session-security-tenant', handler);
    return () => window.removeEventListener('session-security-tenant', handler);
  }, []);

  const { settings } = useTenantSecuritySettings(tenantId);
  const timeoutMinutes = settings?.inactivity_timeout_minutes ?? 15;
  const enforceSingle = settings?.enforce_single_session ?? true;

  const [inactivityTriggered, setInactivityTriggered] = useState(false);

  useInactivityLogout(timeoutMinutes, () => setInactivityTriggered(true), !!user);
  useSessionGuard(user?.id ?? null, sessionToken, enforceSingle, () => {
    // Conflict detected — force logout
    dismissSessionConflict();
    signOut();
  });

  // Auto-logout when inactivity is triggered
  useEffect(() => {
    if (inactivityTriggered && user) {
      signOut();
    }
  }, [inactivityTriggered, user, signOut]);

  if (sessionConflict || inactivityTriggered) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 p-6 text-center dark:bg-ink-950">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
          {inactivityTriggered ? (
            <Clock className="h-8 w-8 text-danger-500" />
          ) : (
            <AlertTriangle className="h-8 w-8 text-danger-500" />
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">
            {inactivityTriggered ? 'Session Expired — Inactivity Timeout' : 'Logged Out: Account Accessed from Another Terminal'}
          </h1>
          <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
            {inactivityTriggered
              ? `You were automatically logged out after ${timeoutMinutes} minutes of inactivity for security purposes.`
              : 'Your account was signed in on another device. For security, this session has been terminated. Only one active session is allowed per user.'}
          </p>
        </div>
        <button onClick={() => signOut()} className="btn-primary mt-2 flex items-center gap-2">
          <LogOut className="h-4 w-4" /> Return to Sign In
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

/** Helper for shells to broadcast their tenantId to the SessionSecurityGuard. */
export function broadcastSecurityTenant(tenantId: string | null | undefined) {
  window.dispatchEvent(new CustomEvent('session-security-tenant', { detail: tenantId ?? null }));
}
