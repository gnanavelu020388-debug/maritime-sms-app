import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ShieldCheck, Filter, Eye, Lock, AlertOctagon, ScrollText, Download, ShieldAlert, ChevronRight, ChevronDown, User, Mail, Globe, Target, Clock, GitCompare } from 'lucide-react';
import { Card } from '../components/Card';
import { Badge, StatusBadge } from '../components/Badge';
import { useStore } from '../store';
import { relativeTime, formatUtc } from '../constants';
import type { AuditEvent, AuditCategory, InternalUser } from '../types';
import type { Capabilities } from '../lib/permissions';

const CATEGORY_TONE: Record<AuditCategory, 'info' | 'warning' | 'danger' | 'success' | 'accent' | 'neutral'> = {
  auth: 'info',
  impersonation: 'danger',
  tenant: 'info',
  sms: 'accent',
  billing: 'success',
  backup: 'warning',
  security: 'warning',
  system: 'neutral',
};

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-primary-500',
  warning: 'bg-warning-500',
  critical: 'bg-danger-500',
};

type AdminRole = 'Super-Admin' | 'Platform Auditor' | 'Global Support Staff';

function buildActorMap(users: InternalUser[]): Record<string, InternalUser> {
  const map: Record<string, InternalUser> = {};
  for (const u of users) map[u.id] = u;
  return map;
}

function actorRole(actorId: string, actorMap: Record<string, InternalUser>): AdminRole | null {
  return actorMap[actorId]?.role ?? null;
}

// Classify an audit action into the role-specific tracking bucket
function roleActionBucket(e: AuditEvent): 'support' | 'auditor' | 'superadmin' | 'general' {
  const a = e.action.toLowerCase();
  if (e.impersonation || a.includes('password reset') || a.includes('contact edit') || a.includes('account locked')) return 'support';
  if (a.includes('security log') || a.includes('compliance export') || a.includes('restricted') || a.includes('mfa challenge') || a.includes('mfa enforcement')) return 'auditor';
  if (a.includes('tier') || a.includes('pricing') || a.includes('suspend') || a.includes('archiv') || a.includes('restore') || a.includes('backup') || a.includes('plan tier')) return 'superadmin';
  return 'general';
}

// Generate a synthetic before/after delta based on the action
function auditDelta(e: AuditEvent): { field: string; before: string; after: string }[] {
  const a = e.action.toLowerCase();
  if (a.includes('suspend')) return [{ field: 'tenant.status', before: 'Active', after: 'Suspended' }];
  if (a.includes('activ')) return [{ field: 'tenant.status', before: 'Suspended', after: 'Active' }];
  if (a.includes('plan tier') || a.includes('tier overrid')) return [{ field: 'tenant.plan', before: 'Standard', after: 'Professional' }, { field: 'tenant.vessels.max', before: '5', after: '20' }];
  if (a.includes('pricing')) return [{ field: 'tierConfig.monthly', before: '$1,200', after: '$1,500' }];
  if (a.includes('archiv')) return [{ field: 'tenant.status', before: 'Active', after: 'Archived' }];
  if (a.includes('restore')) return [{ field: 'tenant.data_state', before: 'current (live)', after: 'restored from snapshot' }];
  if (a.includes('backup') || a.includes('snapshot')) return [{ field: 'backup.snapshot_count', before: '6', after: '7' }, { field: 'backup.last_snapshot_id', before: '—', after: `SNP-${e.id.slice(-4)}` }];
  if (a.includes('password reset')) return [{ field: 'user.password', before: '********', after: '******** (reset)' }, { field: 'user.locked', before: 'false', after: 'true' }];
  if (a.includes('locked')) return [{ field: 'user.locked', before: 'false', after: 'true' }];
  if (a.includes('mfa enforcement')) return [{ field: 'platform.global_mfa', before: 'false', after: 'true' }];
  if (a.includes('mfa challenge')) return [{ field: 'auth.mfa_verified', before: 'false', after: 'true' }];
  if (a.includes('sign-in')) return [{ field: 'auth.session', before: '—', after: 'established' }];
  if (a.includes('impersonation started')) return [{ field: 'session.impersonating', before: 'false', after: 'true' }, { field: 'session.target_tenant', before: '—', after: e.target }];
  if (a.includes('impersonation ended')) return [{ field: 'session.impersonating', before: 'true', after: 'false' }];
  if (a.includes('invoice')) return [{ field: 'invoice.status', before: 'draft', after: 'issued' }];
  if (a.includes('renewal email')) return [{ field: 'contract.reminder_sent', before: 'false', after: 'true' }];
  if (a.includes('sms push')) return [{ field: 'sms.version', before: '2.3.0', after: '2.4.0' }];
  if (a.includes('maintenance')) return [{ field: 'platform.banner', before: '—', after: 'published' }];
  return [{ field: 'state', before: '—', after: e.action }];
}

export function SecurityView({ caps }: { caps: Capabilities }) {
  const { audit, internalUsers } = useStore();
  const [impersonationOnly, setImpersonationOnly] = useState(false);
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | AdminRole>('all');
  const [actorQuery, setActorQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const actorMap = useMemo(() => buildActorMap(internalUsers), [internalUsers]);

  const filtered = useMemo(() => audit.filter((e) => {
    if (impersonationOnly && !e.impersonation) return false;
    if (category !== 'all' && e.category !== category) return false;
    if (roleFilter !== 'all') {
      const role = actorRole(e.actor, actorMap);
      if (role !== roleFilter) return false;
    }
    if (actorQuery) {
      const q = actorQuery.toLowerCase();
      const user = actorMap[e.actor];
      const email = user?.email ?? '';
      const name = user?.name ?? '';
      if (!e.actor.toLowerCase().includes(q) && !email.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [audit, impersonationOnly, category, roleFilter, actorQuery, actorMap]);

  const stats = {
    total: audit.length,
    critical: audit.filter((e) => e.severity === 'critical').length,
    impersonation: audit.filter((e) => e.impersonation).length,
    security: audit.filter((e) => e.category === 'security').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-white">Platform Security & Audit Trail</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">Immutable ledger of every administrative state change across the platform.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={<ScrollText className="h-4 w-4" />} label="Total events" value={stats.total} tone="primary" />
        <StatTile icon={<AlertOctagon className="h-4 w-4" />} label="Critical severity" value={stats.critical} tone="danger" />
        <StatTile icon={<Eye className="h-4 w-4" />} label="Impersonation events" value={stats.impersonation} tone="warning" />
        <StatTile icon={<Lock className="h-4 w-4" />} label="Security actions" value={stats.security} tone="accent" />
      </div>

      <Card
        title="Immutable Transaction Log Ledger"
        subtitle="Append-only · expand any row for full event inspection · all times UTC / GMT"
        icon={<ShieldCheck className="h-4 w-4" />}
        actions={
          <button onClick={() => {}} disabled={!caps.securityEdit} className="btn-secondary shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" /> Export ledger</button>
        }
      >
        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-ink-400" />
            <button
              onClick={() => setImpersonationOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${impersonationOnly ? 'border-danger-300 bg-danger-50 text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-300' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'}`}
            >
              <Eye className="h-3.5 w-3.5" /> Impersonation only
            </button>
            <select value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | 'all')} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <option value="all">All categories</option>
              {(Object.keys(CATEGORY_TONE) as AuditCategory[]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Role filter */}
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'all' | AdminRole)} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <option value="all">All Roles</option>
              <option value="Super-Admin">Super-Admin</option>
              <option value="Platform Auditor">Platform Auditor</option>
              <option value="Global Support Staff">Global Support Staff</option>
            </select>
          </div>

          {/* Actor search */}
          <div className="relative w-full sm:max-w-xs">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              placeholder="Search actor email or Admin ID…"
              className="input pl-9 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Expandable audit table */}
        <div className="overflow-x-auto rounded-xl border border-ink-200/70 dark:border-ink-800">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="min-w-[180px] px-4 py-3 font-semibold">Timestamp (UTC)</th>
                <th className="min-w-[140px] px-4 py-3 font-semibold">Actor (Admin ID)</th>
                <th className="w-36 px-4 py-3 font-semibold">Role</th>
                <th className="w-32 px-4 py-3 font-semibold">Category</th>
                <th className="min-w-[260px] px-4 py-3 font-semibold">Action</th>
                <th className="min-w-[160px] px-4 py-3 font-semibold">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-400">No audit events match the current filters.</td></tr>
              ) : (
                filtered.slice(0, 10).map((e) => {
                  const isExpanded = expandedId === e.id;
                  const user = actorMap[e.actor];
                  const role = user?.role ?? 'Unknown';
                  const bucket = roleActionBucket(e);
                  return (
                    <Fragment key={e.id}>
                      <tr
                        className={`cursor-pointer bg-white transition-colors hover:bg-primary-50/40 dark:bg-ink-900 dark:hover:bg-ink-800/50 ${isExpanded ? 'bg-primary-50/60 dark:bg-ink-800/60' : ''} ${e.impersonation ? 'ring-1 ring-inset ring-danger-200 dark:ring-danger-900/50' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : e.id)}
                      >
                        <td className="px-3 py-3 text-center">
                          {isExpanded
                            ? <ChevronDown className="mx-auto h-4 w-4 text-primary-600 dark:text-primary-400" />
                            : <ChevronRight className="mx-auto h-4 w-4 text-ink-400" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_STYLE[e.severity]}`} />
                            <div>
                              <p className="font-mono text-xs font-semibold text-ink-800 dark:text-ink-100">{formatUtc(e.ts)}</p>
                              <p className="text-[11px] text-ink-400">{relativeTime(e.ts)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold text-ink-700 dark:text-ink-200" title={e.actor}>{e.actor}</p>
                            <p className="truncate text-[11px] text-ink-400">{user?.name ?? 'System'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            bucket === 'support' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                            : bucket === 'auditor' ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                            : bucket === 'superadmin' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                            : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
                          }`}>
                            {role}
                          </span>
                        </td>
                        <td className="px-4 py-3"><Badge tone={CATEGORY_TONE[e.category]}>{e.category}</Badge></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-ink-800 dark:text-ink-100">{e.action}</span>
                            {e.impersonation && <Badge tone="danger" dot pulse><ShieldAlert className="h-3 w-3" /> Impersonation</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="block truncate text-xs text-ink-600 dark:text-ink-300" title={e.target}>{e.target}</span>
                        </td>
                      </tr>

                      {/* Expanded event detail drawer */}
                      {isExpanded && (
                        <tr className="bg-ink-50/50 dark:bg-ink-950/30">
                          <td colSpan={7} className="px-4 py-4">
                            <EventDetailDrawer event={e} user={user} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 10 && (
          <p className="mt-3 text-center text-xs text-ink-400">Showing 10 of {filtered.length} filtered records. Refine filters to narrow results.</p>
        )}
        <span className="mt-3 block text-xs text-ink-500">{filtered.length} records match current filters</span>
      </Card>

      <Card title="Impersonation Log Isolation View" subtitle="All read/write activity during administrative override sessions" icon={<Eye className="h-4 w-4" />}>
        <div className="space-y-2">
          {audit.filter((e) => e.impersonation).slice(0, 6).map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50/40 p-3 dark:border-danger-900/50 dark:bg-danger-900/10">
              <ShieldAlert className="h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 dark:text-white">{e.action}</p>
                <p className="text-xs text-ink-500">{e.actor} · {e.target} · {e.ip} · {relativeTime(e.ts)}</p>
              </div>
              <Badge tone="danger">{e.severity}</Badge>
            </div>
          ))}
          {audit.filter((e) => e.impersonation).length === 0 && (
            <p className="py-6 text-center text-sm text-ink-400">No impersonation events recorded.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function EventDetailDrawer({ event, user }: { event: AuditEvent; user?: InternalUser }) {
  const delta = auditDelta(event);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Actor Info */}
      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500"><User className="h-3.5 w-3.5" /> Actor Info</p>
        <dl className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-ink-500">Full name</dt>
            <dd className="font-semibold text-ink-800 dark:text-ink-100">{user?.name ?? 'System'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1 text-ink-500"><Mail className="h-3 w-3" /> Email</dt>
            <dd className="font-mono text-ink-700 dark:text-ink-200">{user?.email ?? 'system@platform'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-500">Admin role</dt>
            <dd><Badge tone="neutral">{user?.role ?? 'System'}</Badge></dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1 text-ink-500"><Globe className="h-3 w-3" /> Source IP</dt>
            <dd className="font-mono text-ink-700 dark:text-ink-200">{event.ip}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-500">Admin ID</dt>
            <dd className="font-mono text-ink-700 dark:text-ink-200">{event.actor}</dd>
          </div>
        </dl>
      </div>

      {/* Timestamp + Target */}
      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500"><Clock className="h-3.5 w-3.5" /> Timestamp & Target</p>
        <dl className="space-y-2 text-xs">
          <div>
            <dt className="text-ink-500">Date / time (UTC)</dt>
            <dd className="mt-0.5 font-mono font-semibold text-ink-800 dark:text-ink-100">{formatUtc(event.ts)}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Relative</dt>
            <dd className="text-ink-600 dark:text-ink-300">{relativeTime(event.ts)}</dd>
          </div>
          <div className="border-t border-ink-100 pt-2 dark:border-ink-800">
            <dt className="flex items-center gap-1 text-ink-500"><Target className="h-3 w-3" /> Target entity</dt>
            <dd className="mt-0.5 font-semibold text-ink-800 dark:text-ink-100">{event.target}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Tenant / Company ID</dt>
            <dd className="font-mono text-ink-700 dark:text-ink-200">{event.companyId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Scope</dt>
            <dd><Badge tone={CATEGORY_TONE[event.category]}>{event.scope}</Badge></dd>
          </div>
        </dl>
      </div>

      {/* Field-Level Audit Delta */}
      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500"><GitCompare className="h-3.5 w-3.5" /> Field-Level Audit Delta</p>
        <div className="overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-50/80 text-[10px] uppercase tracking-wide text-ink-500 dark:bg-ink-800/60">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">Field</th>
                <th className="px-2.5 py-1.5 font-semibold">Before</th>
                <th className="px-2.5 py-1.5 font-semibold">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {delta.map((d) => (
                <tr key={d.field} className="bg-white dark:bg-ink-900">
                  <td className="px-2.5 py-1.5 font-mono text-ink-600 dark:text-ink-300">{d.field}</td>
                  <td className="px-2.5 py-1.5 text-ink-400 line-through">{d.before}</td>
                  <td className="px-2.5 py-1.5 font-semibold text-success-600 dark:text-success-400">{d.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {event.impersonation && (
          <p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-danger-600 dark:text-danger-400">
            <ShieldAlert className="h-3 w-3" /> Executed during impersonation session
          </p>
        )}
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'primary' | 'danger' | 'warning' | 'accent' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
    warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    accent: 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</div>
        <span className="text-2xl font-bold text-ink-900 dark:text-white">{value}</span>
      </div>
      <p className="mt-2 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
    </div>
  );
}
