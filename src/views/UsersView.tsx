import { useState } from 'react';
import {
  Users, ShieldCheck, KeyRound, Lock, Unlock, Search, UserPlus, AlertTriangle,
  Pencil, Trash2,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Toggle } from '../components/Toggle';
import { Badge, StatusBadge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { CriticalActionWizard } from '../components/CriticalActionWizard';
import { useStore } from '../store';
import { useAuth } from '../lib/auth';
import { relativeTime, uid } from '../constants';
import type { InternalUser } from '../types';
import type { Capabilities } from '../lib/permissions';

const ROLE_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  'Super-Admin': 'danger',
  'Platform Auditor': 'warning',
  'Global Support Staff': 'info',
};

const ALL_ROLES: InternalUser['role'][] = ['Super-Admin', 'Platform Auditor', 'Global Support Staff'];

export function UsersView({ caps }: { caps: Capabilities }) {
  const { internalUsers, globalMfaEnforced, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InternalUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InternalUser | null>(null);

  const currentEmail = user?.email ?? '';
  const isSelf = (u: InternalUser) => u.email === currentEmail;

  const columns: Column<InternalUser>[] = [
    {
      key: 'user', header: 'Staff Member', sortValue: (u) => u.name,
      render: (u) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-xs font-bold text-primary-700 dark:text-primary-300">
            {u.name.split(' ').map((w) => w[0]).join('')}
          </div>
          <div>
            <p className="font-semibold text-ink-900 dark:text-white">{u.name}{isSelf(u) && <span className="ml-1.5 text-[10px] font-bold uppercase text-primary-600 dark:text-primary-400">(You)</span>}</p>
            <p className="text-xs text-ink-500">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role', sortValue: (u) => u.role,
      render: (u) => <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>,
    },
    {
      key: 'status', header: 'Status', sortValue: (u) => u.status,
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'mfa', header: 'MFA',
      render: (u) => u.mfa ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="warning" dot>Off</Badge>,
    },
    {
      key: 'last', header: 'Last Active', sortValue: (u) => u.lastActive,
      render: (u) => <span className="text-xs text-ink-500">{relativeTime(u.lastActive)}</span>,
    },
    {
      key: 'actions', header: 'Actions',
      render: (u) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditTarget(u)}
            disabled={!caps.userEdit}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title="Edit profile & role"
          ><Pencil className="h-4 w-4" /></button>
          <button
            onClick={() => {
              dispatch({ type: 'USER_RESET_PASSWORD', id: u.id });
              toast({ tone: 'info', title: 'Password reset issued', message: `Reset email sent to ${u.email}.` });
            }}
            disabled={!caps.userResetPassword}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title="Reset password"
          ><KeyRound className="h-4 w-4" /></button>
          <button
            onClick={() => {
              dispatch({ type: 'USER_LOCK_TOGGLE', id: u.id });
              toast({ tone: u.status === 'locked' ? 'success' : 'warning', title: u.status === 'locked' ? 'Account unlocked' : 'Account locked', message: u.email });
            }}
            disabled={!caps.userLockToggle || isSelf(u)}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title={u.status === 'locked' ? 'Unlock' : 'Lock'}
          >
            {u.status === 'locked' ? <Unlock className="h-4 w-4 text-success-600" /> : <Lock className="h-4 w-4 text-danger-600" />}
          </button>
          <button
            onClick={() => setDeleteTarget(u)}
            disabled={!caps.userDelete || isSelf(u)}
            className="btn-ghost rounded-md p-1.5 text-danger-600 hover:bg-danger-50 hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30"
            title={isSelf(u) ? 'Cannot delete your own account' : 'Delete / revoke account'}
          ><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">User & Role Configuration</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Internal platform staff accounts — Super-Admin, Platform Auditor, and Global Support Staff.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSearchOpen(true)} className="btn-secondary"><Search className="h-4 w-4" /> Search accounts</button>
          <button onClick={() => setInviteOpen(true)} disabled={!caps.userInvite} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"><UserPlus className="h-4 w-4" /> Invite staff</button>
        </div>
      </div>

      {/* Emergency Security Toolkit */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Global MFA Enforcement" subtitle="Master switch for all platform staff" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Require MFA for all internal accounts</p>
              <p className="mt-0.5 text-xs text-ink-500">When enabled, staff without MFA are forced to enroll on next sign-in.</p>
            </div>
            <Toggle checked={globalMfaEnforced} onChange={(v) => {
              if (!caps.securityEdit) return;
              dispatch({ type: 'MFA_GLOBAL_TOGGLE', enforced: v });
              toast({ tone: v ? 'success' : 'warning', title: `MFA enforcement ${v ? 'enabled' : 'disabled'}` });
            }} disabled={!caps.securityEdit} />
          </div>
          <div className="mt-3 rounded-lg bg-ink-50 p-3 dark:bg-ink-800/50">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500">Staff with MFA</span>
              <span className="font-bold text-ink-800 dark:text-ink-100">{internalUsers.filter((u) => u.mfa).length} / {internalUsers.length}</span>
            </div>
          </div>
        </Card>

        <Card title="Quick Account Actions" subtitle="Emergency security controls" icon={<KeyRound className="h-4 w-4" />}>
          <div className="space-y-2">
            <button onClick={() => setSearchOpen(true)} className="btn-secondary w-full justify-start"><Search className="h-4 w-4" /> Search any client account</button>
            <button onClick={() => toast({ tone: 'info', title: 'Bulk password reset', message: 'Reset link generated for selected tenant users.' })} className="btn-secondary w-full justify-start"><KeyRound className="h-4 w-4" /> Trigger tenant password reset</button>
            <button onClick={() => toast({ tone: 'warning', title: 'Lockdown prepared', message: 'Emergency lockdown playbook ready to execute.' })} className="btn-danger w-full justify-start"><Lock className="h-4 w-4" /> Emergency account lockdown</button>
          </div>
        </Card>

        <Card title="Access Summary" subtitle="Internal team composition" icon={<Users className="h-4 w-4" />}>
          <div className="space-y-2">
            {ALL_ROLES.map((role) => {
              const count = internalUsers.filter((u) => u.role === role).length;
              return (
                <div key={role} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div className="flex items-center gap-2">
                    <Badge tone={ROLE_TONE[role]}>{role}</Badge>
                  </div>
                  <span className="text-sm font-bold text-ink-800 dark:text-ink-100">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Internal Access Matrix" subtitle="Platform owner's internal team" icon={<Users className="h-4 w-4" />}>
        <DataTable columns={columns} rows={internalUsers} pageSize={6} searchPlaceholder="Search staff…" searchFn={(u, q) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)} />
      </Card>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onInvite={(u) => { dispatch({ type: 'USER_INVITE', user: u }); toast({ tone: 'success', title: 'Invitation sent', message: `${u.email} invited as ${u.role}.` }); setInviteOpen(false); }} />}

      {editTarget && (
        <EditStaffModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={(name, email, role) => {
            dispatch({ type: 'USER_EDIT', id: editTarget.id, name, email, role });
            toast({ tone: 'success', title: 'Staff account updated', message: `${email} saved as ${role}.` });
            setEditTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <CriticalActionWizard
          target={{
            kind: 'Staff Account',
            title: deleteTarget.name,
            subtitle: deleteTarget.id,
            rows: [
              { label: 'Staff ID', value: deleteTarget.id },
              { label: 'Name', value: deleteTarget.name },
              { label: 'Email', value: deleteTarget.email },
              { label: 'Role', value: deleteTarget.role },
              { label: 'Status', value: deleteTarget.status },
              { label: 'MFA', value: deleteTarget.mfa ? 'Enabled' : 'Disabled' },
              { label: 'Last Active', value: relativeTime(deleteTarget.lastActive) },
            ],
            acknowledgements: [
              `I acknowledge this will revoke all active session tokens for ${deleteTarget.email}.`,
              'I understand historical logs and audit trails linked to this user ID will be preserved in Platform Security & Audits.',
              'I confirm this account deletion is intentional and authorized.',
            ],
            confirmPhrase: `DELETE ${deleteTarget.id}`,
            confirmHint: `DELETE ${deleteTarget.id}`,
          }}
          actorEmail={currentEmail || 'unknown'}
          onClose={() => setDeleteTarget(null)}
          onExecute={(payload) => {
            dispatch({ type: 'USER_DELETE', id: deleteTarget.id, mode: 'hard' });
            toast({ tone: 'danger', title: 'Staff account permanently deleted', message: `${deleteTarget.email} removed. Audit entry: ${payload.timestamp}.` });
            setDeleteTarget(null);
          }}
        />
      )}

      {searchOpen && (
        <Modal open onClose={() => setSearchOpen(false)} title="Account Search" subtitle="Search any client account across all tenants" icon={<Search className="h-5 w-5" />} size="md">
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Email, company, or user ID…" className="input pl-9" />
            </div>
            <div className="space-y-2">
              {internalUsers.filter((u) => !query || u.email.includes(query) || u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{u.name}</p>
                    <p className="text-xs text-ink-500">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={u.status} />
                    <button onClick={() => { dispatch({ type: 'USER_RESET_PASSWORD', id: u.id }); toast({ tone: 'info', title: 'Password reset issued', message: u.email }); }} className="btn-ghost rounded-md p-1.5"><KeyRound className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
              {query && <div className="rounded-lg bg-warning-50 p-3 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />This tool can target any tenant user. All actions are recorded in the immutable audit ledger.</div>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (u: InternalUser) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InternalUser['role']>('Global Support Staff');
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite Internal Staff"
      subtitle="Provision a new platform team account"
      icon={<UserPlus className="h-5 w-5" />}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={!name.trim() || !email.trim()}
            onClick={() => onInvite({ id: uid('usr'), name, email, role, status: 'invited', lastActive: new Date().toISOString(), mfa: false })}
            className="btn-primary"
          >Send invitation</button>
        </>
      }
    >
      <div className="space-y-4">
        <div><label className="label">Full name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Avery" /></div>
        <div><label className="label">Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="j.avery@maritime-platform.io" /></div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as InternalUser['role'])}>
            {ALL_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function EditStaffModal({ user, onClose, onSave }: { user: InternalUser; onClose: () => void; onSave: (name: string, email: string, role: InternalUser['role']) => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<InternalUser['role']>(user.role);
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Staff Account"
      subtitle={`Update profile & role — ${user.email}`}
      icon={<Pencil className="h-5 w-5" />}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={!name.trim() || !email.trim()}
            onClick={() => onSave(name.trim(), email.trim(), role)}
            className="btn-primary"
          >Save changes</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-ink-50 p-3 dark:bg-ink-800/50">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-sm font-bold text-primary-700 dark:text-primary-300">
            {name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-white">{user.name}</p>
            <p className="text-xs text-ink-500">ID: {user.id}</p>
          </div>
        </div>
        <div><label className="label">Full name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div>
          <label className="label">Internal role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as InternalUser['role'])}>
            {ALL_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => (
              <span key={r} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${r === role ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>{r}</span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}


