/**
 * DEVELOPER DIRECTIVE & ARCHITECTURE RULES:
 * 1. MULTI-TENANCY ISOLATION: The entire interface must be strictly multi-tenant aware.
 *    All data filtering, backup logs, manual triggers, and account states must map
 *    explicitly to a clean Company ID or Tenant Token.
 * 2. SCOPE LIMITATION: Do not expose core application infrastructure software code or
 *    hardware hosting backups here. This interface is exclusively for managing individual
 *    shipping company business data packages (SMS documents, forms, logs, user accounts).
 *    Core application scaling remains strictly inside the Azure Portal.
 * 3. IMMUTABLE SECURITY LEDGER: Every single administrative state change, user impersonation,
 *    and backup/restore command must dispatch an entry to an unalterable audit trail tracker
 *    capturing Admin ID, Company ID, Timestamp, Action, and Scope parameters.
 */

// ============================================================
// Domain model — multi-tenant maritime super admin platform
// ============================================================

export type PlanTier = 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
export type TenantStatus = 'active' | 'suspended' | 'trial' | 'provisioning' | 'archived';

export type ModuleKey =
  | 'voyage_logging'
  | 'crew_matrix'
  | 'electronic_logbooks'
  | 'advanced_analytics'
  | 'satellite_sync'
  | 'risk_assessment';

export interface Tenant {
  id: string;
  company: string;
  contactEmail: string;
  plan: PlanTier;
  status: TenantStatus;
  seats: { used: number; max: number };
  vessels: { used: number; max: number };
  storageGb: { used: number; max: number };
  modules: ModuleKey[];
  mfaEnforced: boolean;
  createdAt: string;
  contractExpires: string;
  monthlyRevenue: number;
  region: string;
  // Inherited document trees cloned to this tenant's workspace via flexible template push
  docTrees: DocTreeKind[];
  docClones: Record<DocTreeKind, DocumentNode>;
  guardrails?: TenantGuardrails;
  demoTenantId?: string | null;
}

// ---- Master SMS / Fleet / Flag State document trees (flexible template model) ----
export type DocTreeKind = 'sms' | 'fleet_circulars' | 'flag_state';
export type DocContentKind = 'rich_text' | 'pdf';

export type ApprovalState = 'draft' | 'pending_dpa' | 'approved';
export type SyncState = 'synced' | 'pending_satellite' | 'syncing' | 'failed';

export interface DocumentNode {
  id: string;
  label: string;
  kind: 'folder' | 'document';
  parentId: string | null;
  contentKind?: DocContentKind;
  content?: string;       // rich-text body or PDF filename reference
  version: string;
  approvalState?: ApprovalState; // tenant-side DPA approval flow
  syncState?: SyncState;         // satellite sync state for tenant workspace nodes
  creatorEmail?: string;         // who created/modified this node (tenant workspace)
  updatedAt: string;
  children: DocumentNode[];
}

// Governance settings per tenant workspace
export interface TenantGuardrails {
  workspaceFrozen: boolean;
  maxSubfolderDepth: number;
  maxUploadSizeMb: number;
}

// Point-in-time snapshot of a tenant's SMS tree
export interface SmsSnapshot {
  id: string;
  tenantId: string;
  company: string;
  takenAt: string;
  label: string;
  docClones: Record<DocTreeKind, DocumentNode>;
}

export interface SshNode {
  id: string;
  label: string;
  kind: 'root' | 'category' | 'procedure';
  parent: string | null;
  version: string;
  children: SshNode[];
}

export type SatelliteLink = 'Starlink' | 'VSAT' | 'FBB';

export interface SatellitePayload {
  id: string;
  vessel: string;
  tenantId: string;
  sizeKb: number;
  node: SatelliteLink;
  status: 'syncing' | 'queued' | 'processed' | 'failed';
  progress: number;
  receivedAt: string;
}

export type AuditCategory =
  | 'auth'
  | 'impersonation'
  | 'tenant'
  | 'sms'
  | 'billing'
  | 'backup'
  | 'security'
  | 'system';

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  category: AuditCategory;
  action: string;
  target: string;
  companyId: string | null;
  ip: string;
  scope: string;
  severity: 'info' | 'warning' | 'critical';
  impersonation?: boolean;
}

export type InvoiceStatus = 'paid' | 'overdue' | 'processing' | 'draft';

export interface InvoiceLineItem {
  description: string;
  amount: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  company: string;
  amount: number;
  currency: string;
  period: string;
  issued: string;
  status: InvoiceStatus;
  lineItems?: InvoiceLineItem[];
  dueDate?: string;
}

export interface BackupSnapshot {
  id: string;
  tenantId: string;
  company: string;
  takenAt: string;
  sizeGb: number;
  type: 'auto' | 'manual' | 'pre-restore';
  status: 'completed' | 'running' | 'failed' | 'expired';
  expiry: string;
  reason?: string;
}

export interface SshRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  scope: 'tenant' | 'platform';
  system: boolean;
}

export interface InternalUser {
  id: string;
  name: string;
  email: string;
  role: 'Super-Admin' | 'Platform Auditor' | 'Global Support Staff';
  status: 'active' | 'locked' | 'invited';
  lastActive: string;
  mfa: boolean;
}

export interface ErrorLog {
  id: string;
  ts: string;
  level: 'error' | 'warn' | 'critical';
  source: string;
  message: string;
  tenantId: string | null;
  payload: string;
}

export interface MaintenanceBanner {
  message: string;
  severity: 'info' | 'warning' | 'critical';
  publishedAt: string;
  publishedBy: string;
}

export interface ImpersonationState {
  active: boolean;
  tenantId: string | null;
  startedAt: string | null;
}

export type SectionId =
  | 'dashboard'
  | 'tenants'
  | 'provisioning'
  | 'sms'
  | 'users'
  | 'security'
  | 'monitoring'
  | 'billing'
  | 'backups'
  | 'features';

// Editable SaaS tier configuration — drives the Billing Tier Constructor
// and cascades into the Tenant Ledger limits.
export interface TierConfig {
  name: PlanTier;
  monthly: number;
  annual: number;
  vessels: number;
  storageGb: number;
  seats: number;
}
