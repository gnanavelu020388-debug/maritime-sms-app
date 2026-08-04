import type { SectionId } from '../types';

// Internal Access Matrix roles — stored on super_admins.internal_role.
export type InternalRole = 'super_admin' | 'platform_auditor' | 'global_support';

export const INTERNAL_ROLE_LABEL: Record<InternalRole, string> = {
  super_admin: 'Super-Admin',
  platform_auditor: 'Platform Auditor',
  global_support: 'Global Support Staff',
};

// Human-readable description of each internal role's reach.
export const INTERNAL_ROLE_SUMMARY: Record<InternalRole, string> = {
  super_admin: 'Unrestricted full access across all console views.',
  platform_auditor: 'Read-only access to Security, Audit Logs, and Platform Monitoring.',
  global_support: 'Tenant management, user account resets, and support impersonation.',
};

// Which sidebar sections each role may open at all.
const SECTION_ACCESS: Record<InternalRole, SectionId[]> = {
  super_admin: ['dashboard', 'tenants', 'provisioning', 'sms', 'users', 'security', 'monitoring', 'billing', 'backups', 'features'],
  platform_auditor: ['security', 'monitoring', 'dashboard'],
  global_support: ['tenants', 'users', 'dashboard'],
};

export function canAccessSection(role: InternalRole, section: SectionId): boolean {
  return SECTION_ACCESS[role].includes(section);
}

export function allowedSections(role: InternalRole): SectionId[] {
  return SECTION_ACCESS[role];
}

// Granular capability flags consumed by views to hide/disable controls.
export interface Capabilities {
  // Tenant ledger
  tenantEdit: boolean;       // edit company profile / limits / modules
  tenantArchive: boolean;    // archive + restore
  tenantProvision: boolean;  // create new tenant
  // SMS template engine
  smsEdit: boolean;          // add/rename/delete/edit doc nodes + push
  // Users
  userResetPassword: boolean;
  userLockToggle: boolean;
  userInvite: boolean;
  userEdit: boolean;
  userDelete: boolean;
  // Security
  securityEdit: boolean;     // MFA toggle, lock/unlock
  // Billing
  billingEdit: boolean;      // tier constructors, invoices
  // Backups
  backupRestore: boolean;    // restore snapshots
  // Provisioning studio
  provisioningWrite: boolean;
  // Maintenance banner
  maintenancePublish: boolean;
  // Impersonation ("Login As")
  impersonate: boolean;
  // Feature flags — Tenant Feature Matrix
  featureFlagEdit: boolean;
}

const SUPER_ADMIN_CAPS: Capabilities = {
  tenantEdit: true,
  tenantArchive: true,
  tenantProvision: true,
  smsEdit: true,
  userResetPassword: true,
  userLockToggle: true,
  userInvite: true,
  userEdit: true,
  userDelete: true,
  securityEdit: true,
  billingEdit: true,
  backupRestore: true,
  provisioningWrite: true,
  maintenancePublish: true,
  impersonate: true,
  featureFlagEdit: true,
};

const PLATFORM_AUDITOR_CAPS: Capabilities = {
  ...SUPER_ADMIN_CAPS,
  tenantEdit: false,
  tenantArchive: false,
  tenantProvision: false,
  smsEdit: false,
  userResetPassword: false,
  userLockToggle: false,
  userInvite: false,
  userEdit: false,
  userDelete: false,
  securityEdit: false,
  billingEdit: false,
  backupRestore: false,
  provisioningWrite: false,
  maintenancePublish: false,
  impersonate: false,
  featureFlagEdit: false,
};

const GLOBAL_SUPPORT_CAPS: Capabilities = {
  ...SUPER_ADMIN_CAPS,
  smsEdit: false,
  securityEdit: false,
  billingEdit: false,
  backupRestore: false,
  provisioningWrite: false,
  maintenancePublish: false,
  featureFlagEdit: false,
};

export function capabilitiesFor(role: InternalRole): Capabilities {
  switch (role) {
    case 'super_admin': return SUPER_ADMIN_CAPS;
    case 'platform_auditor': return PLATFORM_AUDITOR_CAPS;
    case 'global_support': return GLOBAL_SUPPORT_CAPS;
  }
}
