import { useState, useEffect } from 'react';
import { Shield, User, ChevronRight, LogOut, RotateCcw, Anchor, Eye } from 'lucide-react';
import { useDemoAuth, type DemoSession } from '../lib/demoAuth';
import { DEMO_TENANTS, getEffectiveDemoVessels, getEffectiveDemoAssignments, getEffectiveDemoUsers, type DemoTenantId } from '../lib/demoData';
import { useShoreRolesForTenant, resolveShoreRoleName } from '../lib/shoreRoles';
import { Modal } from './Modal';
import { Badge } from './Badge';
import type { PlatformRole } from '../lib/supabase';

function isPlatformRole(r: string): r is PlatformRole {
  return r === 'super_admin' || r === 'company_admin' || r === 'dpa' || r === 'vessel';
}

function shoreRoleToPlatformRole(shoreRole: string): PlatformRole {
  if (shoreRole === 'Designated Person Ashore (DPA)') return 'dpa';
  return 'company_admin';
}

function matchShoreRole(userRank: string, shoreRole: string): boolean {
  if (userRank === shoreRole) return true;
  const resolved = resolveShoreRoleName(userRank);
  return resolved === shoreRole;
}

const SHORE_ROLE_COLORS = [
  'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-600 dark:bg-accent-900/20 dark:text-accent-300',
  'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/20 dark:text-primary-300',
  'border-success-500 bg-success-50 text-success-700 dark:border-success-600 dark:bg-success-900/20 dark:text-success-300',
  'border-warning-500 bg-warning-50 text-warning-700 dark:border-warning-600 dark:bg-warning-900/20 dark:text-warning-300',
  'border-primary-400 bg-primary-50/50 text-primary-600 dark:border-primary-500 dark:bg-primary-900/10 dark:text-primary-300',
];

export function DemoSessionSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useDemoAuth();
  const demoSession = ctx!.demoSession;
  const switchSession = ctx!.switchSession;

  const currentShoreRole = ctx?.tenantUser ? resolveShoreRoleName(ctx.tenantUser.rank) : null;
  const [selectedRole, setSelectedRole] = useState<string>(
    demoSession.role === 'super_admin' || demoSession.role === 'vessel'
      ? demoSession.role
      : (currentShoreRole ?? demoSession.role),
  );
  const [selectedTenant, setSelectedTenant] = useState<DemoTenantId>(demoSession.tenantId);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    demoSession.userId ?? ctx?.tenantUser?.id ?? null,
  );

  const { roles: shoreRoles, refresh: refreshShoreRoles } = useShoreRolesForTenant(selectedTenant);

  // Force a fresh re-read of localStorage data every time the modal opens.
  // The switcher stays mounted while hidden, so without this it can show
  // stale user lists from before a registration happened.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (open) {
      setTick((t) => t + 1);
      refreshShoreRoles();
    }
  }, [open, refreshShoreRoles]);

  const tenant = DEMO_TENANTS.find((t) => t.id === selectedTenant);
  // tick is read here so the dependency is explicit and the linter stays happy
  void tick;
  const tenantUsers = getEffectiveDemoUsers(selectedTenant);

  const shoreRoleUsers = !isPlatformRole(selectedRole)
    ? tenantUsers.filter((u) => matchShoreRole(u.rank, selectedRole))
    : [];

  const vesselUsers = selectedRole === 'vessel'
    ? tenantUsers.filter((u) => u.role === 'vessel')
    : [];

  function handleShoreRoleClick(role: string) {
    setSelectedRole(role);
    const users = getEffectiveDemoUsers(selectedTenant).filter((u) => matchShoreRole(u.rank, role));
    setSelectedUserId(users[0]?.id ?? null);
  }

  function handleTenantChange(tenantId: DemoTenantId) {
    setSelectedTenant(tenantId);
    if (!isPlatformRole(selectedRole)) {
      const users = getEffectiveDemoUsers(tenantId).filter((u) => matchShoreRole(u.rank, selectedRole));
      setSelectedUserId(users[0]?.id ?? null);
    } else {
      setSelectedUserId(null);
    }
  }

  function handleApply() {
    let platformRole: PlatformRole;
    let userId: string | null = null;

    if (selectedRole === 'super_admin') {
      platformRole = 'super_admin';
    } else if (selectedRole === 'vessel') {
      platformRole = 'vessel';
      userId = getEffectiveDemoAssignments(selectedTenant).find((a) => !a.signed_off_at)?.user_id ?? null;
    } else {
      platformRole = shoreRoleToPlatformRole(selectedRole);
      userId = selectedUserId;
    }

    const newSession: DemoSession = {
      role: platformRole,
      tenantId: selectedTenant,
      vesselId: platformRole === 'vessel' ? (getEffectiveDemoVessels(selectedTenant)[0]?.id ?? null) : null,
      userId,
    };
    switchSession(newSession);

    if (typeof window !== 'undefined') {
      const viewParam = platformRole === 'super_admin' ? 'superadmin' : platformRole === 'vessel' ? 'vessel' : platformRole === 'dpa' ? 'dpa' : 'company';
      const params = new URLSearchParams();
      params.set('view', viewParam);
      if (platformRole !== 'super_admin') params.set('tenant', selectedTenant);
      if (userId) params.set('user', userId);
      window.location.href = `${window.location.pathname}?${params.toString()}`;
    }
    onClose();
  }

  function handleSignOutCompletely() {
    if (typeof window !== 'undefined') {
      window.location.href = window.location.pathname;
    }
  }

  const currentRoleLabel = demoSession.role === 'super_admin'
    ? 'Super Admin'
    : demoSession.role === 'vessel'
      ? 'Vessel Master / Officer'
      : (ctx?.tenantUser?.rank ?? demoSession.role);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Demo Session Switcher"
      subtitle="Switch tenant, role, or sign out — simulate live multi-tenant navigation"
      icon={<RotateCcw className="h-5 w-5" />}
      size="lg"
      scrollable
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            onClick={handleSignOutCompletely}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
          >
            <LogOut className="h-3.5 w-3.5" /> Exit Demo
          </button>
          <button onClick={handleApply} className="btn-primary">
            <ChevronRight className="h-4 w-4" /> Switch Session
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Current session display */}
        <div className="flex items-center gap-3 rounded-lg border border-ink-200/70 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-800/50">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-white">
            <Eye className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-ink-800 dark:text-white">Current Session</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {currentRoleLabel} · {DEMO_TENANTS.find((t) => t.id === demoSession.tenantId)?.company}
            </p>
          </div>
        </div>

        {/* Role selection */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Select Role</label>

          {/* Platform roles: Super Admin + Vessel */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setSelectedRole('super_admin'); setSelectedUserId(null); }}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition ${
                selectedRole === 'super_admin'
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
              }`}
            >
              <Shield className="h-5 w-5" />
              <span className="text-xs font-semibold">Super Admin</span>
              <span className="text-[10px] text-ink-400">Platform-wide control</span>
            </button>
            <button
              onClick={() => { setSelectedRole('vessel'); setSelectedUserId(null); }}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition ${
                selectedRole === 'vessel'
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
              }`}
            >
              <Anchor className="h-5 w-5" />
              <span className="text-xs font-semibold">Vessel Master / Officer</span>
              <span className="text-[10px] text-ink-400">Onboard portal access</span>
            </button>
          </div>

          {/* Shoreside roles — dynamically loaded from Permissions Matrix */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              Shoreside Roles <span className="font-normal normal-case text-ink-300">(from Role &amp; Permissions Matrix)</span>
            </p>
            {shoreRoles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400 dark:border-ink-700">
                Loading shore roles…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {shoreRoles.map((r, idx) => {
                  const active = selectedRole === r.role;
                  const userCount = tenantUsers.filter((u) => matchShoreRole(u.rank, r.role)).length;
                  const colorCls = SHORE_ROLE_COLORS[idx % SHORE_ROLE_COLORS.length];
                  return (
                    <button
                      key={r.role}
                      onClick={() => handleShoreRoleClick(r.role)}
                      className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition ${
                        active
                          ? colorCls
                          : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span className="text-xs font-bold leading-tight">{r.role}</span>
                        {userCount > 0 && (
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                            active ? 'bg-white/40 text-current' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
                          }`}>{userCount}</span>
                        )}
                      </div>
                      <span className="text-[10px] leading-tight opacity-70">{r.description}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tenant selection — hidden for super admin */}
        {selectedRole !== 'super_admin' && (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Select Tenant Company</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO_TENANTS.map((t) => {
                const active = selectedTenant === t.id;
                const vessels = getEffectiveDemoVessels(t.id).length;
                const crew = getEffectiveDemoUsers(t.id).length;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTenantChange(t.id as DemoTenantId)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition ${
                      active
                        ? 'border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/30'
                        : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
                      {t.company.split(' ').slice(0, 2).map((w) => w[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{t.company}</p>
                      <p className="truncate text-[11px] text-ink-400">{t.region} · {t.plan} · {vessels} vessels · {crew} users</p>
                    </div>
                    {t.status === 'trial' && <Badge tone="warning" className="!text-[9px]">Trial</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* User account selector — when a shoreside role is selected */}
        {!isPlatformRole(selectedRole) && (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Select User Account <span className="font-normal normal-case text-ink-400">— {selectedRole}</span>
            </label>
            {shoreRoleUsers.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
                <User className="h-4 w-4 shrink-0" />
                <span>No users registered with this role in {tenant?.company}. Register one in <strong>Crew Roster &amp; User Management</strong> first.</span>
              </div>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {shoreRoleUsers.map((u) => {
                  const active = selectedUserId === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                        active
                          ? 'border-accent-500 bg-accent-50 dark:border-accent-500 dark:bg-accent-900/20'
                          : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800'
                      }`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-primary-500 text-[10px] font-bold text-white">
                        {u.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{u.name}</p>
                        <p className="truncate text-[11px] text-ink-400">{u.email} · {u.employee_id ?? 'No ID'}</p>
                      </div>
                      {u.status !== 'active' && (
                        <Badge tone={u.status === 'invited' ? 'info' : 'neutral'} className="!text-[9px]">{u.status}</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Vessel user preview — when role is vessel */}
        {selectedRole === 'vessel' && tenant && vesselUsers.length > 0 && (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Vessel Users in {tenant.company}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {vesselUsers.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                  <Anchor className="h-3 w-3 text-accent-500" />
                  {u.rank} {u.name}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">After switching, use the header dropdown in the Vessel Portal to change vessel or crew member.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
