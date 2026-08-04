import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type {
  AuditCategory,
  AuditEvent,
  BackupSnapshot,
  DocTreeKind,
  DocumentNode,
  ErrorLog,
  ImpersonationState,
  InternalUser,
  Invoice,
  MaintenanceBanner,
  ModuleKey,
  PlanTier,
  SatellitePayload,
  SmsSnapshot,
  SshRole,
  Tenant,
  TenantGuardrails,
  TenantStatus,
  TierConfig,
} from './types';
import { SUPER_ADMIN_ID, SUPER_ADMIN_NAME, uid, DEFAULT_TIER_CONFIGS, PLAN_DEFAULTS } from './constants';
import { onSyncEvent, publishBanner, clearBanner, readPersistedBanner, type SyncEvent, type BannerPayload } from './lib/syncChannel';
import {
  buildAuditLog,
  buildBackups,
  buildErrorLogs,
  buildInternalUsers,
  buildInvoices,
  buildMasterDocTree,
  buildSatellitePayloads,
  buildSmsSnapshots,
  buildSystemRoles,
  buildTenants,
  cloneDocTree,
  addDocChild,
  removeDocNode,
  renameDocNode,
  updateDocContent,
} from './data/mock';

interface Toast {
  id: string;
  title: string;
  message?: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

interface State {
  tenants: Tenant[];
  satellite: SatellitePayload[];
  masterDocTrees: Record<DocTreeKind, DocumentNode>;
  smsPushVersion: string;
  tierConfigs: TierConfig[];
  audit: AuditEvent[];
  invoices: Invoice[];
  backups: BackupSnapshot[];
  internalUsers: InternalUser[];
  systemRoles: SshRole[];
  errorLogs: ErrorLog[];
  maintenance: MaintenanceBanner | null;
  impersonation: ImpersonationState;
  globalMfaEnforced: boolean;
  globalGuardrails: TenantGuardrails;
  smsSnapshots: SmsSnapshot[];
  toasts: Toast[];
  theme: 'light' | 'dark';
}

type Action =
  | { type: 'TOAST_ADD'; toast: Toast }
  | { type: 'TOAST_DISMISS'; id: string }
  | { type: 'THEME_SET'; theme: 'light' | 'dark' }
  | { type: 'MAINTENANCE_PUBLISH'; banner: MaintenanceBanner }
  | { type: 'MAINTENANCE_CLEAR' }
  | { type: 'TENANT_CREATE'; tenant: Tenant }
  | { type: 'TENANT_UPDATE'; id: string; patch: Partial<Tenant> }
  | { type: 'TENANT_SET_STATUS'; id: string; status: TenantStatus }
  | { type: 'TENANT_DELETE'; id: string }
  | { type: 'TENANT_SET_PLAN'; id: string; plan: PlanTier }
  | { type: 'TENANT_TOGGLE_MODULE'; id: string; module: ModuleKey }
  | { type: 'TENANT_TOGGLE_MODULE_REMOTE'; id: string; module: ModuleKey; enabled: boolean }
  | { type: 'TIER_CONFIG_UPDATE'; index: number; patch: Partial<TierConfig> }
  | { type: 'SATELLITE_TICK'; payloads: SatellitePayload[] }
  | { type: 'SMS_PUSH'; version: string; targets: string[] }
  | { type: 'DOC_ADD'; tree: DocTreeKind; parentId: string; node: DocumentNode }
  | { type: 'DOC_RENAME'; tree: DocTreeKind; nodeId: string; label: string }
  | { type: 'DOC_DELETE'; tree: DocTreeKind; nodeId: string }
  | { type: 'DOC_UPDATE_CONTENT'; tree: DocTreeKind; nodeId: string; content: string; contentKind: 'rich_text' | 'pdf' }
  | { type: 'BACKUP_ADD'; snapshot: BackupSnapshot }
  | { type: 'BACKUP_RESTORE'; snapshotId: string }
  | { type: 'BACKUP_DELETE'; snapshotId: string }
  | { type: 'INVOICE_ADD'; invoice: Invoice }
  | { type: 'USER_RESET_PASSWORD'; id: string }
  | { type: 'USER_LOCK_TOGGLE'; id: string }
  | { type: 'USER_INVITE'; user: InternalUser }
  | { type: 'USER_EDIT'; id: string; name: string; email: string; role: InternalUser['role'] }
  | { type: 'USER_DELETE'; id: string; mode: 'soft' | 'hard' }
  | { type: 'MFA_GLOBAL_TOGGLE'; enforced: boolean }
  | { type: 'IMPERSONATE_START'; tenantId: string }
  | { type: 'IMPERSONATE_END' }
  | { type: 'AUDIT_ADD'; event: AuditEvent }
  | { type: 'MAINTENANCE_REMOTE'; banner: MaintenanceBanner | null }
  | { type: 'TENANT_FREEZE'; id: string; frozen: boolean }
  | { type: 'TENANT_ROLLBACK'; snapshotId: string }
  | { type: 'GUARDRAILS_UPDATE'; id: string; patch: Partial<TenantGuardrails> }
  | { type: 'GUARDRAILS_GLOBAL_UPDATE'; patch: Partial<TenantGuardrails> };

const initialTenants = buildTenants();
const initialState: State = {
  tenants: initialTenants,
  satellite: buildSatellitePayloads(),
  masterDocTrees: {
    sms: buildMasterDocTree('sms'),
    fleet_circulars: buildMasterDocTree('fleet_circulars'),
    flag_state: buildMasterDocTree('flag_state'),
  },
  smsPushVersion: '2.4.0',
  tierConfigs: DEFAULT_TIER_CONFIGS.map((t) => ({ ...t })),
  audit: buildAuditLog(initialTenants),
  invoices: buildInvoices(initialTenants),
  backups: buildBackups(initialTenants),
  internalUsers: buildInternalUsers(),
  systemRoles: buildSystemRoles(),
  errorLogs: buildErrorLogs(),
  maintenance: readPersistedBanner() as MaintenanceBanner | null,
  impersonation: { active: false, tenantId: null, startedAt: null },
  globalMfaEnforced: true,
  globalGuardrails: { workspaceFrozen: false, maxSubfolderDepth: 4, maxUploadSizeMb: 50 },
  smsSnapshots: buildSmsSnapshots(initialTenants),
  toasts: [],
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem('mpc-theme') === 'dark') ? 'dark' : 'light',
};

// When a tier config changes or a tenant's plan changes, recalculate that
// tenant's max limits from the matching tier config. Returns the updated
// tenants array so the caller can detect over-limit states downstream.
function applyTierLimits(tenants: Tenant[], tierConfigs: TierConfig[], planFor?: { id: string; plan: PlanTier }): Tenant[] {
  return tenants.map((t) => {
    const plan = planFor && planFor.id === t.id ? planFor.plan : t.plan;
    const cfg = tierConfigs.find((c) => c.name === plan) ?? { name: plan, vessels: t.vessels.max, seats: t.seats.max, storageGb: t.storageGb.max, monthly: t.monthlyRevenue, annual: 0 };
    return {
      ...t,
      plan,
      vessels: { ...t.vessels, max: cfg.vessels || t.vessels.max },
      seats: { ...t.seats, max: cfg.seats || t.seats.max },
      storageGb: { ...t.storageGb, max: cfg.storageGb || t.storageGb.max },
      monthlyRevenue: cfg.monthly || t.monthlyRevenue,
    };
  });
}

function pushAudit(state: State, event: Omit<AuditEvent, 'id' | 'ts' | 'actor'> & { actor?: string }): State {
  const full: AuditEvent = {
    id: uid('aud'),
    ts: new Date().toISOString(),
    actor: event.actor ?? SUPER_ADMIN_ID,
    ...event,
  };
  return { ...state, audit: [full, ...state.audit].slice(0, 400) };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'TOAST_ADD':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'TOAST_DISMISS':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'THEME_SET':
      return { ...state, theme: action.theme };
    case 'MAINTENANCE_PUBLISH': {
      const next = pushAudit(state, {
        category: 'system',
        action: 'Maintenance banner published',
        target: 'platform',
        companyId: null,
        ip: '10.42.1.8',
        scope: 'system',
        severity: 'info',
      });
      publishBanner(action.banner);
      return { ...next, maintenance: action.banner };
    }
    case 'MAINTENANCE_CLEAR': {
      const next = pushAudit(state, {
        category: 'system',
        action: 'Maintenance banner cleared',
        target: 'platform',
        companyId: null,
        ip: '10.42.1.8',
        scope: 'system',
        severity: 'info',
      });
      clearBanner();
      return { ...next, maintenance: null };
    }
    case 'MAINTENANCE_REMOTE': {
      // Received from another tab via BroadcastChannel — apply without re-broadcasting
      return { ...state, maintenance: action.banner };
    }
    case 'TENANT_CREATE': {
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Tenant provisioned: ${action.tenant.company}`,
        target: action.tenant.company,
        companyId: action.tenant.id,
        ip: '10.42.1.8',
        scope: 'tenant',
        severity: 'info',
      });
      return { ...next, tenants: [action.tenant, ...state.tenants] };
    }
    case 'TENANT_UPDATE': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Tenant edited: ${tenant?.company ?? action.id}`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'tenant',
        severity: 'info',
      });
      return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) };
    }
    case 'TENANT_SET_STATUS': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Tenant ${action.status}: ${tenant?.company ?? action.id}`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'tenant',
        severity: action.status === 'suspended' ? 'warning' : 'info',
      });
      return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, status: action.status } : t)) };
    }
    case 'TENANT_DELETE': {
      const t = state.tenants.find((x) => x.id === action.id);
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Tenant permanently deleted: ${t?.company ?? action.id} (${t?.id ?? ''})`,
        target: t?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'tenant',
        severity: 'critical',
      });
      return {
        ...next,
        tenants: state.tenants.filter((x) => x.id !== action.id),
        backups: state.backups.filter((b) => b.tenantId !== action.id),
      };
    }
    case 'TENANT_SET_PLAN': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Plan tier changed to ${action.plan}: ${tenant?.company ?? action.id}`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'billing',
        severity: 'info',
      });
      // Cascade: recalculate max limits from the tier config for this plan
      const tenants = applyTierLimits(state.tenants, state.tierConfigs, { id: action.id, plan: action.plan });
      return { ...next, tenants };
    }
    case 'TENANT_TOGGLE_MODULE': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const has = tenant?.modules.includes(action.module);
      const next = pushAudit(state, {
        category: 'tenant',
        action: `Module ${has ? 'revoked' : 'granted'}: ${action.module}`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'tenant',
        severity: 'info',
      });
      return {
        ...next,
        tenants: state.tenants.map((t) =>
          t.id === action.id
            ? { ...t, modules: has ? t.modules.filter((m) => m !== action.module) : [...t.modules, action.module] }
            : t,
        ),
      };
    }
    case 'TENANT_TOGGLE_MODULE_REMOTE': {
      // Cross-window sync: mirror a feature flag change that already happened
      // in another window (e.g. Super Admin Feature Matrix). No audit event
      // — the originating window already logged it.
      return {
        ...state,
        tenants: state.tenants.map((t) =>
          t.id === action.id || t.demoTenantId === action.id
            ? {
                ...t,
                modules: action.enabled
                  ? t.modules.includes(action.module) ? t.modules : [...t.modules, action.module]
                  : t.modules.filter((m) => m !== action.module),
              }
            : t,
        ),
      };
    }
    case 'TIER_CONFIG_UPDATE': {
      const tierConfigs = state.tierConfigs.map((t, i) => (i === action.index ? { ...t, ...action.patch } : t));
      // Cascade: recalculate max limits for every tenant on the edited tier
      const tenants = applyTierLimits(state.tenants, tierConfigs);
      const changedTier = tierConfigs[action.index];
      const next = pushAudit(state, {
        category: 'billing',
        action: `Tier config updated: ${changedTier.name}`,
        target: changedTier.name,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'billing',
        severity: 'info',
      });
      return { ...next, tierConfigs, tenants };
    }
    case 'SATELLITE_TICK':
      return { ...state, satellite: action.payloads };
    case 'SMS_PUSH': {
      // Flexible Template model: clone active master trees into each target
      // tenant's workspace. Company Admin receives full edit capability.
      const targets = action.targets;
      const tenants = state.tenants.map((t) => {
        if (!targets.includes(t.id)) return t;
        return {
          ...t,
          docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[],
          docClones: {
            sms: cloneDocTree(state.masterDocTrees.sms, true),
            fleet_circulars: cloneDocTree(state.masterDocTrees.fleet_circulars, true),
            flag_state: cloneDocTree(state.masterDocTrees.flag_state, true),
          },
        };
      });
      const next = pushAudit(state, {
        category: 'sms',
        action: `Flexible template push ${action.version} cloned to ${targets.length} tenant(s)`,
        target: 'platform',
        companyId: null,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'warning',
      });
      return { ...next, tenants, smsPushVersion: action.version };
    }
    case 'DOC_ADD': {
      const root = state.masterDocTrees[action.tree];
      const updated = addDocChild(structuredClone(root), action.parentId, action.node);
      const next = pushAudit(state, {
        category: 'sms',
        action: `Document node added: ${action.node.label} (${action.tree})`,
        target: action.tree,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'info',
      });
      return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } };
    }
    case 'DOC_RENAME': {
      const root = state.masterDocTrees[action.tree];
      const updated = renameDocNode(structuredClone(root), action.nodeId, action.label);
      return { ...state, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } };
    }
    case 'DOC_DELETE': {
      const root = state.masterDocTrees[action.tree];
      const updated = removeDocNode(structuredClone(root), action.nodeId);
      const next = pushAudit(state, {
        category: 'sms',
        action: `Document node deleted (${action.tree})`,
        target: action.tree,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'warning',
      });
      return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } };
    }
    case 'DOC_UPDATE_CONTENT': {
      const root = state.masterDocTrees[action.tree];
      const updated = updateDocContent(structuredClone(root), action.nodeId, action.content, action.contentKind);
      const next = pushAudit(state, {
        category: 'sms',
        action: `Document content updated (${action.tree})`,
        target: action.tree,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'info',
      });
      return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } };
    }
    case 'BACKUP_ADD': {
      const next = pushAudit(state, {
        category: 'backup',
        action: `Manual snapshot triggered: ${action.snapshot.company}`,
        target: action.snapshot.company,
        companyId: action.snapshot.tenantId,
        ip: '10.42.1.8',
        scope: 'backup',
        severity: 'info',
      });
      return { ...next, backups: [action.snapshot, ...state.backups] };
    }
    case 'BACKUP_RESTORE': {
      const snap = state.backups.find((b) => b.id === action.snapshotId);
      const next = pushAudit(state, {
        category: 'backup',
        action: `Isolated restore executed: ${snap?.company ?? action.snapshotId}`,
        target: snap?.company ?? action.snapshotId,
        companyId: snap?.tenantId ?? null,
        ip: '10.42.1.8',
        scope: 'backup',
        severity: 'critical',
      });
      return next;
    }
    case 'BACKUP_DELETE': {
      const snap = state.backups.find((b) => b.id === action.snapshotId);
      const next = pushAudit(state, {
        category: 'backup',
        action: `Backup snapshot deleted: ${snap?.id ?? action.snapshotId} (${snap?.company ?? ''})`,
        target: snap?.id ?? action.snapshotId,
        companyId: snap?.tenantId ?? null,
        ip: '10.42.1.8',
        scope: 'backup',
        severity: 'critical',
      });
      return { ...next, backups: state.backups.filter((b) => b.id !== action.snapshotId) };
    }
    case 'INVOICE_ADD': {
      const next = pushAudit(state, {
        category: 'billing',
        action: `Invoice generated: ${action.invoice.id}`,
        target: action.invoice.company,
        companyId: action.invoice.tenantId,
        ip: '10.42.1.8',
        scope: 'billing',
        severity: 'info',
      });
      return { ...next, invoices: [action.invoice, ...state.invoices] };
    }
    case 'USER_RESET_PASSWORD': {
      const u = state.internalUsers.find((x) => x.id === action.id);
      const next = pushAudit(state, {
        category: 'security',
        action: `Password reset issued: ${u?.email ?? action.id}`,
        target: u?.email ?? action.id,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'warning',
      });
      return next;
    }
    case 'USER_LOCK_TOGGLE': {
      const u = state.internalUsers.find((x) => x.id === action.id);
      const locked = u?.status === 'locked';
      const next = pushAudit(state, {
        category: 'security',
        action: `Account ${locked ? 'unlocked' : 'locked'}: ${u?.email ?? action.id}`,
        target: u?.email ?? action.id,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'warning',
      });
      return {
        ...next,
        internalUsers: state.internalUsers.map((x) =>
          x.id === action.id ? { ...x, status: locked ? 'active' : 'locked' } : x,
        ),
      };
    }
    case 'USER_INVITE': {
      const next = pushAudit(state, {
        category: 'security',
        action: `Internal staff invited: ${action.user.email}`,
        target: action.user.email,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'info',
      });
      return { ...next, internalUsers: [action.user, ...state.internalUsers] };
    }
    case 'USER_EDIT': {
      const u = state.internalUsers.find((x) => x.id === action.id);
      const next = pushAudit(state, {
        category: 'security',
        action: `Staff account edited: ${u?.email ?? action.id} → ${action.email} (${action.role})`,
        target: action.email,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'warning',
      });
      return {
        ...next,
        internalUsers: state.internalUsers.map((x) =>
          x.id === action.id ? { ...x, name: action.name, email: action.email, role: action.role } : x,
        ),
      };
    }
    case 'USER_DELETE': {
      const u = state.internalUsers.find((x) => x.id === action.id);
      const verb = action.mode === 'soft' ? 'revoked & archived' : 'permanently removed';
      const next = pushAudit(state, {
        category: 'security',
        action: `Staff account ${verb}: ${u?.email ?? action.id}`,
        target: u?.email ?? action.id,
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'critical',
      });
      if (action.mode === 'soft') {
        return {
          ...next,
          internalUsers: state.internalUsers.map((x) =>
            x.id === action.id ? { ...x, status: 'locked' as const, mfa: false } : x,
          ),
        };
      }
      return { ...next, internalUsers: state.internalUsers.filter((x) => x.id !== action.id) };
    }
    case 'MFA_GLOBAL_TOGGLE': {
      const next = pushAudit(state, {
        category: 'security',
        action: `Global MFA enforcement ${action.enforced ? 'enabled' : 'disabled'}`,
        target: 'platform',
        companyId: null,
        ip: '10.42.1.8',
        scope: 'security',
        severity: 'warning',
      });
      return { ...next, globalMfaEnforced: action.enforced };
    }
    case 'IMPERSONATE_START': {
      const tenant = state.tenants.find((t) => t.id === action.tenantId);
      const next = pushAudit(state, {
        category: 'impersonation',
        action: `Login As — impersonation started: ${tenant?.company ?? action.tenantId}`,
        target: tenant?.contactEmail ?? action.tenantId,
        companyId: action.tenantId,
        ip: '10.42.1.8',
        scope: 'impersonation',
        severity: 'critical',
        impersonation: true,
      });
      return { ...next, impersonation: { active: true, tenantId: action.tenantId, startedAt: new Date().toISOString() } };
    }
    case 'IMPERSONATE_END': {
      const next = pushAudit(state, {
        category: 'impersonation',
        action: 'Impersonation session ended',
        target: state.impersonation.tenantId ?? 'platform',
        companyId: state.impersonation.tenantId,
        ip: '10.42.1.8',
        scope: 'impersonation',
        severity: 'warning',
        impersonation: true,
      });
      return { ...next, impersonation: { active: false, tenantId: null, startedAt: null } };
    }
    case 'TENANT_FREEZE': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const next = pushAudit(state, {
        category: 'sms',
        action: `Workspace ${action.frozen ? 'frozen' : 'unfrozen'}: ${tenant?.company ?? action.id}`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: action.frozen ? 'critical' : 'warning',
      });
      return {
        ...next,
        tenants: state.tenants.map((t) =>
          t.id === action.id
            ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), workspaceFrozen: action.frozen } }
            : t,
        ),
      };
    }
    case 'TENANT_ROLLBACK': {
      const snap = state.smsSnapshots.find((s) => s.id === action.snapshotId);
      if (!snap) return state;
      const tenants = state.tenants.map((t) =>
        t.id === snap.tenantId
          ? { ...t, docClones: { sms: cloneDocTree(snap.docClones.sms, true), fleet_circulars: cloneDocTree(snap.docClones.fleet_circulars, true), flag_state: cloneDocTree(snap.docClones.flag_state, true) } }
          : t,
      );
      const next = pushAudit(state, {
        category: 'sms',
        action: `SMS tree rollback to snapshot: ${snap.label} (${snap.company})`,
        target: snap.company,
        companyId: snap.tenantId,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'critical',
      });
      return { ...next, tenants };
    }
    case 'GUARDRAILS_UPDATE': {
      const tenant = state.tenants.find((t) => t.id === action.id);
      const next = pushAudit(state, {
        category: 'sms',
        action: `Guardrails updated: ${tenant?.company ?? action.id} (depth=${action.patch.maxSubfolderDepth ?? '—'}, maxUpload=${action.patch.maxUploadSizeMb ?? '—'}MB)`,
        target: tenant?.company ?? action.id,
        companyId: action.id,
        ip: '10.42.1.8',
        scope: 'sms',
        severity: 'warning',
      });
      return {
        ...next,
        tenants: state.tenants.map((t) =>
          t.id === action.id
            ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), ...action.patch } }
            : t,
        ),
      };
    }
    case 'GUARDRAILS_GLOBAL_UPDATE': {
      const next = pushAudit(state, {
        category: 'sms',
        action: `Global guardrails updated (depth=${action.patch.maxSubfolderDepth ?? '—'}, maxUpload=${action.patch.maxUploadSizeMb ?? '—'}MB)`,
        target: 'Platform-wide',
        companyId: null,
        ip: 'local',
        scope: 'platform',
        severity: 'warning',
      });
      return { ...next, globalGuardrails: { ...state.globalGuardrails, ...action.patch } };
    }
    case 'AUDIT_ADD':
      return { ...state, audit: [action.event, ...state.audit].slice(0, 400) };
    default:
      return state;
  }
}

interface StoreCtx extends State {
  dispatch: React.Dispatch<Action>;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('mpc-theme', state.theme);
    } catch {
      /* ignore */
    }
  }, [state.theme]);

  // Cross-window real-time sync: inject live audit events from other tabs
  // (Company Admin, Vessel Portal) into the Super Admin Immutable Audit Trail.
  useEffect(() => {
    const off = onSyncEvent((evt: SyncEvent) => {
      if (evt.type === 'AUDIT_LOGGED') {
        const p = evt.payload as {
          actorEmail: string;
          category: string;
          action: string;
          target?: string;
          severity?: 'info' | 'warning' | 'critical';
          location?: string;
        };
        dispatch({
          type: 'AUDIT_ADD',
          event: {
            id: uid('evt'),
            ts: new Date().toISOString(),
            actor: p.actorEmail,
            category: (p.category as AuditCategory) ?? 'system',
            action: p.action,
            target: p.target ?? '',
            companyId: evt.tenantId,
            ip: 'remote',
            scope: p.location ?? 'tenant',
            severity: p.severity ?? 'info',
          },
        });
      } else if (evt.type === 'BANNER_PUBLISHED') {
        const banner = evt.payload as BannerPayload;
        dispatch({ type: 'MAINTENANCE_REMOTE', banner: banner as MaintenanceBanner });
      } else if (evt.type === 'BANNER_CLEARED') {
        dispatch({ type: 'MAINTENANCE_REMOTE', banner: null });
      } else if (evt.type === 'FEATURE_FLAGS_CHANGED' && evt.tenantId) {
        // Cross-window: a feature flag was toggled in another window (e.g. Super Admin
        // Tenant Feature Matrix). Update the matching tenant's modules array in-memory
        // so the Master Tenant Ledger stays in sync.
        const p = evt.payload as { featureKey?: string; enabled?: boolean };
        if (p.featureKey && typeof p.enabled === 'boolean') {
          dispatch({ type: 'TENANT_TOGGLE_MODULE_REMOTE', id: evt.tenantId, module: p.featureKey as ModuleKey, enabled: p.enabled });
        }
      }
    });
    return off;
  }, []);

  // Live satellite sync simulation
  useEffect(() => {
    const handle = setInterval(() => {
      dispatch({
        type: 'SATELLITE_TICK',
        payloads: state.satellite.map((p) => {
          if (p.status === 'syncing') {
            const progress = Math.min(100, p.progress + 6 + Math.random() * 10);
            return progress >= 100 ? { ...p, progress: 100, status: 'processed' as const } : { ...p, progress };
          }
          if (p.status === 'queued' && Math.random() > 0.7) {
            return { ...p, status: 'syncing' as const, progress: 5 };
          }
          return p;
        }),
      });
    }, 2200);
    return () => clearInterval(handle);
  }, [state.satellite]);

  const value = useMemo<StoreCtx>(
    () => ({
      ...state,
      dispatch,
      toast: (t) => {
        const id = uid('toast');
        dispatch({ type: 'TOAST_ADD', toast: { ...t, id } });
        setTimeout(() => dispatch({ type: 'TOAST_DISMISS', id }), 4200);
      },
      dismissToast: (id) => dispatch({ type: 'TOAST_DISMISS', id }),
    }),
    [state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

export { SUPER_ADMIN_ID, SUPER_ADMIN_NAME };
