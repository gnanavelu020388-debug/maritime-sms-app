import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type PlatformRole, type InternalRole, type TenantRow, type TenantUserRow, type ActiveAssignment } from './supabase';
import { startFeatureFlagRealtime, stopFeatureFlagRealtime, clearFeatureFlagCache } from './featureFlags';
import { registerSessionToken, clearSessionToken } from './sessionSecurity';
import { DEFAULT_RANK_PERMISSIONS, type RankPermissionMap } from './rankPermissions';

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: PlatformRole | null;
  internalRole: InternalRole | null;
  adminName: string | null;
  tenant: TenantRow | null;
  tenantUser: TenantUserRow | null;
  activeAssignment: ActiveAssignment | null;
  loading: boolean;
  error: string | null;
  sessionToken: string | null;
  sessionConflict: boolean;
  rankPermissions: RankPermissionMap | null;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string, asSuperAdmin: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  sessionToken: string | null;
  sessionConflict: boolean;
  dismissSessionConflict: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let demoGetter: (() => AuthContextValue | null) | null = null;

export function _registerDemoAuthGetter(getter: () => AuthContextValue | null) {
  demoGetter = getter;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    role: null,
    internalRole: null,
    adminName: null,
    tenant: null,
    tenantUser: null,
    activeAssignment: null,
    loading: true,
    error: null,
    sessionToken: null,
    sessionConflict: false,
    rankPermissions: null,
  });

  async function resolveRoleAndTenant(uid: string, email?: string): Promise<Pick<AuthState, 'role' | 'tenant' | 'tenantUser' | 'activeAssignment' | 'internalRole' | 'adminName' | 'rankPermissions'>> {
    // Check super_admins first — resolve internal access-matrix role + display name
    const { data: sa } = await supabase
      .from('super_admins')
      .select('id, internal_role, name, display_name')
      .eq('auth_uid', uid)
      .maybeSingle();
    if (sa) {
      return {
        role: 'super_admin',
        internalRole: (sa.internal_role as InternalRole) ?? 'super_admin',
        adminName: sa.display_name ?? sa.name ?? null,
        tenant: null,
        tenantUser: null,
        activeAssignment: null,
        rankPermissions: null,
      };
    }

    // Otherwise look up tenant_users by auth_uid, or claim a provisioned row by email
    const { data: tuByUid } = await supabase
      .from('tenant_users')
      .select('*')
      .eq('auth_uid', uid)
      .maybeSingle();

    let tu = tuByUid as TenantUserRow | null;

    if (!tu && email) {
      // Claim a provisioned row via SECURITY DEFINER RPC (bypasses RLS — new users
      // have no tenant yet so direct SELECT/UPDATE would be blocked by policies).
      await supabase.rpc('claim_tenant_user');
      // After the claim, re-fetch by auth_uid (now set)
      const { data: claimed } = await supabase
        .from('tenant_users')
        .select('*')
        .eq('auth_uid', uid)
        .maybeSingle();
      tu = claimed as TenantUserRow | null;
    }

    if (!tu) return { role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, rankPermissions: null };

    const tenantUser = tu;
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantUser.tenant_id)
      .maybeSingle();

    // Tenant archiving: instantly block login for all users of an archived
    // tenant across both shore and ship portals. Records are retained for
    // compliance, only access is revoked.
    if (tenant && (tenant as TenantRow).status === 'archived') {
      await supabase.auth.signOut();
      return {
        role: null,
        internalRole: null,
        adminName: null,
        tenant: null,
        tenantUser: null,
        activeAssignment: null,
        rankPermissions: null,
      };
    }

    // For vessel-role users, resolve their active crew assignment (vessel boundary)
    let activeAssignment: ActiveAssignment | null = null;
    if (tenantUser.role === 'vessel') {
      const { data: aa } = await supabase.rpc('get_my_active_assignment');
      activeAssignment = (aa as ActiveAssignment) ?? null;
    }

    let rankPermissions: RankPermissionMap | null = null;
    if (tenantUser) {
      const { data: rp } = await supabase
        .from('rank_permissions')
        .select('apps')
        .eq('tenant_id', tenantUser.tenant_id)
        .eq('rank', tenantUser.rank)
        .maybeSingle();
      rankPermissions = (rp as { apps: RankPermissionMap } | null)?.apps
        ?? DEFAULT_RANK_PERMISSIONS[tenantUser.rank] ?? null;
    }

    return { role: tenantUser.role as PlatformRole,
      internalRole: null,
      adminName: tenantUser.name,
      tenant: (tenant as TenantRow) ?? null,
      tenantUser,
      activeAssignment,
      rankPermissions,
    };
  }

  // Register a new session token after a successful auth state change.
  // This overwrites any previous token, terminating the old device.
  async function registerNewSessionToken(uid: string, email?: string): Promise<string | null> {
    let deviceInfo = 'Unknown browser';
    if (typeof navigator !== 'undefined') {
      deviceInfo = navigator.userAgent.slice(0, 200);
    }
    const token = await registerSessionToken(uid, deviceInfo);
    return token;
  }

  async function refresh() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, rankPermissions: null });
      return;
    }
    const resolved = await resolveRoleAndTenant(session.user.id, session.user.email);
    setState({ user: session.user, session, ...resolved, loading: false, error: null });
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!session?.user) {
        setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, rankPermissions: null });
        return;
      }
      const resolved = await resolveRoleAndTenant(session.user.id, session.user.email);
      const token = await registerNewSessionToken(session.user.id, session.user.email);
      if (!mounted) return;
      setState({ user: session.user, session, ...resolved, loading: false, error: null, sessionToken: token, sessionConflict: false });
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (!session?.user) {
          stopFeatureFlagRealtime();
          clearFeatureFlagCache();
          setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, sessionToken: null, sessionConflict: false, rankPermissions: null });
          return;
        }
        startFeatureFlagRealtime();
        const resolved = await resolveRoleAndTenant(session.user.id, session.user.email);
        const token = await registerNewSessionToken(session.user.id, session.user.email);
        setState({ user: session.user, session, ...resolved, loading: false, error: null, sessionToken: token, sessionConflict: false });
      })();
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signUp = async (email: string, password: string, name: string, asSuperAdmin: boolean) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (!data.user) return { error: 'Sign-up failed — no user returned.' };

    if (asSuperAdmin) {
      const { error: saError } = await supabase
        .from('super_admins')
        .insert({ auth_uid: data.user.id, name, email, internal_role: 'super_admin' });
      if (saError) return { error: `Account created but super-admin registration failed: ${saError.message}` };
    }
    return { error: null };
  };

  const signOut = async () => {
    stopFeatureFlagRealtime();
    clearFeatureFlagCache();
    if (state.user) {
      await clearSessionToken(state.user.id);
    }
    await supabase.auth.signOut();
    setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, sessionToken: null, sessionConflict: false, rankPermissions: null });
  };

  const dismissSessionConflict = () => {
    setState((s) => ({ ...s, sessionConflict: false }));
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, refresh, dismissSessionConflict }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  if (demoGetter) {
    const demo = demoGetter();
    if (demo) return demo;
  }
  throw new Error('useAuth must be used within AuthProvider');
}
