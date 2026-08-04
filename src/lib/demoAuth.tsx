import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { PlatformRole, InternalRole, TenantRow, TenantUserRow, ActiveAssignment } from './supabase';
import type { AuthContextValue } from './auth';
import { _registerDemoAuthGetter } from './auth';
import { DEMO_TENANTS, getDemoTenant, getEffectiveDemoVessels, getEffectiveDemoAssignments, getEffectiveDemoUsers, type DemoTenantId } from './demoData';
import { generateDemoSessionToken, getDemoActiveSessionToken } from './sessionSecurity';
import { DEFAULT_RANK_PERMISSIONS, type RankPermissionMap } from './rankPermissions';
import { resolveShoreRoleName } from './shoreRoles';

function getUrlTenant(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('tenant');
}

function buildDemoUser(email: string): User {
  return {
    id: `demo-${email}`,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: '2025-01-01T00:00:00Z',
  } as unknown as User;
}

function buildDemoSession(user: User): Session {
  return {
    access_token: 'demo-token',
    refresh_token: 'demo-refresh',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    token_type: 'bearer',
    user,
  } as unknown as Session;
}

export interface DemoSession {
  role: PlatformRole;
  tenantId: DemoTenantId;
  vesselId: string | null;
  userId: string | null;
}

function resolveTenantId(role: PlatformRole): DemoTenantId {
  if (role === 'super_admin') return 'tnt-pacific-horizon';
  const fromUrl = getUrlTenant();
  if (fromUrl && DEMO_TENANTS.some((t) => t.id === fromUrl)) return fromUrl as DemoTenantId;
  return 'tnt-pacific-horizon';
}

function resolveDefaultVesselId(tenantId: string): string | null {
  const vessels = getEffectiveDemoVessels(tenantId);
  return vessels[0]?.id ?? null;
}

function getUrlUser(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('user');
}

function resolveDefaultUserId(tenantId: string, role: PlatformRole): string | null {
  const fromUrl = getUrlUser();
  if (fromUrl) {
    const exists = getEffectiveDemoUsers(tenantId).some((u) => u.id === fromUrl);
    if (exists) return fromUrl;
  }
  if (role !== 'vessel') return null;
  const assignments = getEffectiveDemoAssignments(tenantId).filter((a) => !a.signed_off_at);
  return assignments[0]?.user_id ?? null;
}

function buildDemoContext(session: DemoSession): AuthContextValue {
  const tenant = getDemoTenant(session.tenantId) as TenantRow;

  if (session.role === 'super_admin') {
    const email = 'admin@maritime-platform.io';
    const user = buildDemoUser(email);
    const sbSession = buildDemoSession(user);
    return {
      user, session: sbSession, loading: false, error: null,
      role: 'super_admin' as PlatformRole, internalRole: 'super_admin' as InternalRole,
      adminName: 'Platform Admin', tenant: null, tenantUser: null, activeAssignment: null,
      signIn: async () => ({ error: null }), signUp: async () => ({ error: null }),
      signOut: async () => {}, refresh: async () => {},
      sessionToken: null, sessionConflict: false, dismissSessionConflict: () => {},
      rankPermissions: null,
    };
  }

  // Company admin / DPA / vessel
  const roleUsers = getEffectiveDemoUsers(session.tenantId);
  let tenantUser: TenantUserRow;
  let email: string;

  if (session.role === 'company_admin') {
    const matchByRank = (u: TenantUserRow) => resolveShoreRoleName(u.rank) === 'Company Admin' || u.role === 'company_admin';
    tenantUser = session.userId
      ? roleUsers.find((u) => u.id === session.userId) ?? roleUsers.find(matchByRank) ?? roleUsers[0]
      : roleUsers.find(matchByRank) ?? roleUsers[0];
    email = tenantUser.email;
  } else if (session.role === 'dpa') {
    const matchByRank = (u: TenantUserRow) => resolveShoreRoleName(u.rank) === 'Designated Person Ashore (DPA)' || u.role === 'dpa';
    tenantUser = session.userId
      ? roleUsers.find((u) => u.id === session.userId) ?? roleUsers.find(matchByRank) ?? roleUsers[0]
      : roleUsers.find(matchByRank) ?? roleUsers[0];
    email = tenantUser.email;
  } else {
    // vessel
    const targetUser = session.userId
      ? roleUsers.find((u) => u.id === session.userId) ?? roleUsers[0]
      : roleUsers.find((u) => u.role === 'vessel') ?? roleUsers[0];
    tenantUser = targetUser;
    email = targetUser.email;
  }

  const user = buildDemoUser(email);
  const sbSession = buildDemoSession(user);
  const sessionToken = generateDemoSessionToken(tenantUser.id);

  let activeAssignment: ActiveAssignment | null = null;
  if (session.role === 'vessel') {
    const targetVesselId = session.vesselId ?? resolveDefaultVesselId(session.tenantId);
    const vessel = getEffectiveDemoVessels(session.tenantId).find((v) => v.id === targetVesselId);
    const assignment = getEffectiveDemoAssignments(session.tenantId).find(
      (a) => a.vessel_id === (targetVesselId ?? '') && a.user_id === tenantUser.id && !a.signed_off_at,
    );
    // If no exact assignment match, create a synthetic one for the selected vessel+user
    if (vessel) {
      activeAssignment = assignment
        ? {
            assignment_id: assignment.id, vessel_id: vessel.id, vessel_name: vessel.name,
            tenant_id: vessel.tenant_id, user_id: tenantUser.id, rank: tenantUser.rank as ActiveAssignment['rank'],
            signed_on_at: assignment.signed_on_at,
          }
        : {
            assignment_id: `synthetic-${tenantUser.id}-${vessel.id}`, vessel_id: vessel.id, vessel_name: vessel.name,
            tenant_id: vessel.tenant_id, user_id: tenantUser.id, rank: tenantUser.rank as ActiveAssignment['rank'],
            signed_on_at: '2026-06-01T00:00:00Z',
          };
    }
  }

  const adminName = tenantUser.rank === 'DPA' ? `${tenantUser.name} (DPA)` : tenantUser.name;

  const rankPermissions: RankPermissionMap | null =
    DEFAULT_RANK_PERMISSIONS[tenantUser.rank] ?? null;

  return {
    user, session: sbSession, loading: false, error: null,
    role: session.role, internalRole: null, adminName,
    tenant, tenantUser, activeAssignment,
    signIn: async () => ({ error: null }), signUp: async () => ({ error: null }),
    signOut: async () => {}, refresh: async () => {},
    sessionToken, sessionConflict: false, dismissSessionConflict: () => {},
    rankPermissions,
  };
}

interface DemoAuthContextValue extends AuthContextValue {
  demoSession: DemoSession;
  switchSession: (session: DemoSession) => void;
  switchVessel: (vesselId: string | null) => void;
  switchUser: (userId: string | null) => void;
}

const DemoContext = createContext<DemoAuthContextValue | null>(null);

const demoRef: { current: DemoAuthContextValue | null } = { current: null };
_registerDemoAuthGetter(() => demoRef.current);

export function DemoAuthProvider({ role, children }: { role: PlatformRole; children: ReactNode }) {
  const [session, setSession] = useState<DemoSession>(() => {
    const tenantId = resolveTenantId(role);
    return {
      role,
      tenantId,
      vesselId: role === 'vessel' ? resolveDefaultVesselId(tenantId) : null,
      userId: resolveDefaultUserId(tenantId, role),
    };
  });

  const switchSession = useCallback((newSession: DemoSession) => {
    setSession(newSession);
    // Update URL to reflect new tenant for shareable state
    if (typeof window !== 'undefined' && newSession.role !== 'super_admin') {
      const params = new URLSearchParams(window.location.search);
      params.set('tenant', newSession.tenantId);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);
    }
  }, []);

  const switchVessel = useCallback((vesselId: string | null) => {
    setSession((s) => ({ ...s, vesselId }));
  }, []);

  const switchUser = useCallback((userId: string | null) => {
    setSession((s) => ({ ...s, userId }));
  }, []);

  const authValue = buildDemoContext(session);
  const value: DemoAuthContextValue = {
    ...authValue,
    demoSession: session,
    switchSession,
    switchVessel,
    switchUser,
  };
  demoRef.current = value;

  return (
    <DemoContext.Provider value={value}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemoAuth(): DemoAuthContextValue | null {
  return useContext(DemoContext);
}
