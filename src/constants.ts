import type { DocTreeKind, ModuleKey, PlanTier, TierConfig } from './types';

export const PLATFORM_NAME = 'Maritime Platform Console';
export const PLATFORM_SHORT = 'MPC';
export const SUPER_ADMIN_ID = 'SA-001';
export const SUPER_ADMIN_NAME = 'Ellis Hawthorne';

export const MODULES: { key: ModuleKey; label: string; description: string }[] = [
  { key: 'voyage_logging', label: 'Voyage Logging', description: 'Official voyage logbook entries & sign-off workflow' },
  { key: 'crew_matrix', label: 'Crew Matrix', description: 'Crew competency, certification & rank assignments' },
  { key: 'electronic_logbooks', label: 'Electronic Logbooks', description: 'Engine, deck & GMDSS electronic record books' },
  { key: 'advanced_analytics', label: 'Advanced Analytics', description: 'Cross-fleet KPI, risk & trend dashboards' },
  { key: 'satellite_sync', label: 'Satellite Sync', description: 'Offline-first payload queue via VSAT / Starlink' },
  { key: 'risk_assessment', label: 'Risk Assessment', description: 'Job hazard analysis & residual risk tracking' },
];

export const PLAN_TIERS: PlanTier[] = ['Standard', 'Professional', 'Enterprise', 'Custom'];

export const PLAN_DEFAULTS: Record<PlanTier, { vessels: number; seats: number; storageGb: number; monthly: number }> = {
  Standard: { vessels: 5, seats: 25, storageGb: 50, monthly: 1200 },
  Professional: { vessels: 20, seats: 100, storageGb: 250, monthly: 4200 },
  Enterprise: { vessels: 80, seats: 500, storageGb: 1000, monthly: 14500 },
  Custom: { vessels: 0, seats: 0, storageGb: 0, monthly: 0 },
};

// Editable tier configuration used by the Billing Tier Constructor.
// Changes here cascade into the Tenant Ledger limits.
export const DEFAULT_TIER_CONFIGS: TierConfig[] = [
  { name: 'Standard', monthly: 1200, annual: 13200, vessels: 5, storageGb: 50, seats: 25 },
  { name: 'Professional', monthly: 4200, annual: 46200, vessels: 20, storageGb: 250, seats: 100 },
  { name: 'Enterprise', monthly: 14500, annual: 159500, vessels: 80, storageGb: 1000, seats: 500 },
  { name: 'Custom', monthly: 0, annual: 0, vessels: 0, storageGb: 0, seats: 0 },
];

export const DOC_TREE_KINDS: { key: DocTreeKind; label: string; subtitle: string }[] = [
  { key: 'sms', label: 'SMS Documents', subtitle: 'Safety Management System baseline' },
  { key: 'fleet_circulars', label: 'Fleet Circulars', subtitle: 'Company-wide fleet directives' },
  { key: 'flag_state', label: 'Flag State Documents', subtitle: 'Flag authority requirements' },
];

export const SAT_NODES: ('Starlink' | 'VSAT' | 'FBB')[] = ['Starlink', 'VSAT', 'FBB'];

export const SECTIONS: { id: string; label: string; group: 'Operate' | 'Govern' | 'Commercial'; description: string }[] = [
  { id: 'dashboard', label: 'High-Level Dashboard', group: 'Operate', description: 'Platform-wide KPIs & live satellite sync' },
  { id: 'tenants', label: 'Tenant & Company Management', group: 'Govern', description: 'Onboard, suspend, configure tenant accounts' },
  { id: 'features', label: 'Tenant Feature Matrix', group: 'Govern', description: 'Per-tenant module enablement & sync configuration' },
  { id: 'provisioning', label: 'Live Provisioning Studio', group: 'Govern', description: 'Create real tenants & provision users end-to-end' },
  { id: 'sms', label: 'Master SMS Template Engine', group: 'Govern', description: 'Regulatory baseline hierarchy & push distribution' },
  { id: 'users', label: 'User & Role Configuration', group: 'Govern', description: 'Internal staff access & maritime rank blueprint' },
  { id: 'security', label: 'Platform Security & Audits', group: 'Govern', description: 'Immutable ledger & impersonation tracking' },
  { id: 'monitoring', label: 'Platform Monitoring', group: 'Operate', description: 'Satellite traffic, license compliance & errors' },
  { id: 'billing', label: 'Billing & Subscriptions', group: 'Commercial', description: 'SaaS tier constructor & contract lifecycle' },
  { id: 'backups', label: 'Tenant Backup & Recovery', group: 'Operate', description: 'Isolated snapshots & high-security restore' },
];

export function formatCurrency(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatBytes(kb: number): string {
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1024 / 1024).toFixed(2)} GB`;
}

export function formatGb(gb: number): string {
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  if (gb < 1024) return `${gb.toFixed(1)} GB`;
  return `${(gb / 1024).toFixed(2)} TB`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatUtc(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss} UTC / GMT`;
}

export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
