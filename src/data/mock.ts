import type {
  AuditEvent,
  BackupSnapshot,
  DocTreeKind,
  DocumentNode,
  ErrorLog,
  InternalUser,
  Invoice,
  PlanTier,
  SatellitePayload,
  SmsSnapshot,
  SshNode,
  SshRole,
  Tenant,
  TenantGuardrails,
} from '../types';
import { PLAN_DEFAULTS, SUPER_ADMIN_ID, SUPER_ADMIN_NAME, uid } from '../constants';

// Deterministic-ish seed data so renders are stable across reloads
const TENANT_SEED: Array<Partial<Tenant> & { company: string; region: string; demoTenantId: string | null }> = [
  {
    company: 'Atlantic Liquid Bulk',
    demoTenantId: 'tnt-atlantic-liquid',
    region: 'EMEA',
    plan: 'Enterprise',
    status: 'active',
    contactEmail: 'fleet.ops@atlanticliquidbulk.com',
    seats: { used: 412, max: 500 },
    vessels: { used: 38, max: 80 },
    storageGb: { used: 742, max: 1000 },
    modules: ['voyage_logging', 'crew_matrix', 'electronic_logbooks', 'advanced_analytics', 'satellite_sync', 'risk_assessment'],
    mfaEnforced: true,
    createdAt: '2022-03-14T09:20:00Z',
    contractExpires: '2026-09-30T00:00:00Z',
    monthlyRevenue: 14500,
  },
  {
    company: 'Pacific Horizon Cargo',
    demoTenantId: 'tnt-pacific-horizon',
    region: 'APAC',
    plan: 'Professional',
    status: 'active',
    contactEmail: 'it.director@pacifichorizon.com',
    seats: { used: 87, max: 100 },
    vessels: { used: 19, max: 20 },
    storageGb: { used: 218, max: 250 },
    modules: ['voyage_logging', 'crew_matrix', 'electronic_logbooks', 'satellite_sync'],
    mfaEnforced: true,
    createdAt: '2023-01-22T14:05:00Z',
    contractExpires: '2026-08-12T00:00:00Z',
    monthlyRevenue: 4200,
  },
  {
    company: 'Nordic Reef Shipping',
    demoTenantId: 'tnt-nordic-reef',
    region: 'EMEA',
    plan: 'Professional',
    status: 'trial',
    contactEmail: 'dpa@nordicreef.no',
    seats: { used: 41, max: 100 },
    vessels: { used: 6, max: 20 },
    storageGb: { used: 88, max: 250 },
    modules: ['voyage_logging', 'crew_matrix', 'satellite_sync', 'risk_assessment'],
    mfaEnforced: false,
    createdAt: '2025-11-02T08:00:00Z',
    contractExpires: '2026-02-01T00:00:00Z',
    monthlyRevenue: 0,
  },
  {
    company: 'Crescent Marine Logistics',
    demoTenantId: 'tnt-crescent-maritime',
    region: 'MEA',
    plan: 'Standard',
    status: 'suspended',
    contactEmail: 'admin@crescentmarine.ae',
    seats: { used: 22, max: 25 },
    vessels: { used: 6, max: 5 },
    storageGb: { used: 49, max: 50 },
    modules: ['voyage_logging', 'electronic_logbooks'],
    mfaEnforced: false,
    createdAt: '2024-06-18T11:45:00Z',
    contractExpires: '2026-07-25T00:00:00Z',
    monthlyRevenue: 1200,
  },
  {
    company: 'Polaris Tanker Group',
    demoTenantId: null,
    region: 'AMER',
    plan: 'Professional',
    status: 'archived',
    contactEmail: 'ops@polaristanker.com',
    seats: { used: 0, max: 100 },
    vessels: { used: 0, max: 20 },
    storageGb: { used: 0, max: 250 },
    modules: ['voyage_logging', 'crew_matrix'],
    mfaEnforced: true,
    createdAt: '2021-02-10T09:00:00Z',
    contractExpires: '2026-01-15T00:00:00Z',
    monthlyRevenue: 3800,
  },
];

const VESSEL_PREFIXES = ['VALLE', 'MAERSK', 'PACIFIC', 'NORDIC', 'CRESCENT', 'ATLAS', 'OCEAN', 'STELLA'];
const VESSEL_SUFFIXES = ['STAR', 'BREEZE', 'VOYAGER', 'PRIDE', 'TRADER', 'EXPLORER', 'HORIZON', 'SPIRIT'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function isoDaysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

function isoMinutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60000).toISOString();
}

export function buildTenants(): Tenant[] {
  return TENANT_SEED.map((seed, i) => {
    const id = `T-${(1000 + i).toString()}`;
    const plan = seed.plan!;
    const d = PLAN_DEFAULTS[plan];
    return {
      id,
      company: seed.company,
      contactEmail: seed.contactEmail!,
      plan,
      status: seed.status!,
      seats: { used: seed.seats!.used, max: seed.seats!.max || d.seats },
      vessels: { used: seed.vessels!.used, max: seed.vessels!.max || d.vessels },
      storageGb: { used: seed.storageGb!.used, max: seed.storageGb!.max || d.storageGb },
      modules: seed.modules!,
      mfaEnforced: seed.mfaEnforced!,
      createdAt: seed.createdAt!,
      contractExpires: seed.contractExpires!,
      monthlyRevenue: seed.monthlyRevenue!,
      region: seed.region!,
      docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[],
      docClones: {
        sms: cloneDocTree(buildMasterDocTree('sms'), true),
        fleet_circulars: cloneDocTree(buildMasterDocTree('fleet_circulars'), true),
        flag_state: cloneDocTree(buildMasterDocTree('flag_state'), true),
      },
      guardrails: { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 } as TenantGuardrails,
      demoTenantId: seed.demoTenantId,
    } as Tenant;
  });
}

const SHIP_NAMES = [
  'VALLE STAR',
  'MAERSK VOYAGER',
  'PACIFIC HORIZON',
  'NORDIC BREEZE',
  'CRESCENT TRADER',
  'ATLAS EXPLORER',
  'OCEAN PRIDE',
  'STELLA SPIRIT',
];

export function buildShips() {
  return SHIP_NAMES.map((name, i) => ({
    id: `V-${(2000 + i).toString()}`,
    name,
    tenantId: `T-${1000 + (i % 4)}`,
    imo: `IMO ${9000000 + i * 137 + 421}`,
    link: (['Starlink', 'VSAT', 'VSAT', 'FBB'] as const)[i % 4],
  }));
}

export function buildSatellitePayloads(): SatellitePayload[] {
  const out: SatellitePayload[] = [];
  const statuses: SatellitePayload['status'][] = ['syncing', 'queued', 'processed', 'failed'];
  const ships = SHIP_NAMES;
  for (let i = 0; i < 14; i++) {
    const ship = pick(ships, i);
    const status = pick(statuses, i * 3 + 1);
    const size = 12 + ((i * 37) % 480);
    out.push({
      id: `${ship.split(' ')[0]}-LOG-${1000 + i}.json`,
      vessel: ship,
      tenantId: `T-${1000 + (i % 4)}`,
      sizeKb: size,
      node: pick(['Starlink', 'VSAT', 'FBB'] as const, i),
      status,
      progress: status === 'syncing' ? 20 + ((i * 13) % 70) : status === 'processed' ? 100 : 0,
      receivedAt: isoMinutesAgo(i * 4 + 2),
    });
  }
  return out;
}

// ---- Master document trees (flexible template model) ----
// Three parallel trees the Super Admin curates and pushes to tenants.
// On push, trees are cloned into each tenant's workspace; the Company Admin
// then has full edit/rename/delete/upload freedom over their copy.

let docSeq = 0;
function doc(label: string, parentId: string | null, kind: 'folder' | 'document', contentKind?: 'rich_text' | 'pdf', content?: string): DocumentNode {
  docSeq += 1;
  return {
    id: `doc-${docSeq}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    kind,
    parentId,
    contentKind,
    content,
    version: '1.0.0',
    updatedAt: new Date(Date.now() - docSeq * 3600000).toISOString(),
    children: [],
  };
}
function folder(label: string, parentId: string | null, children: DocumentNode[]): DocumentNode {
  const f = doc(label, parentId, 'folder');
  f.children = children;
  return f;
}

export function buildMasterDocTree(kind: DocTreeKind): DocumentNode {
  const root = doc(kind === 'sms' ? 'SMS Documents' : kind === 'fleet_circulars' ? 'Fleet Circulars' : 'Flag State Documents', null, 'folder');
  if (kind === 'sms') {
    root.children = [
      folder('Deck Procedures', root.id, [
        doc('Mooring Operations Manual', root.id, 'document', 'rich_text', '## Mooring Operations\n\nAll mooring operations shall comply with…'),
        doc('Berthing Safety Checklist', root.id, 'document', 'pdf', 'berthing-safety-checklist.pdf'),
      ]),
      folder('Engine Procedures', root.id, [
        doc('Bunker Transfer Procedure', root.id, 'document', 'rich_text', '## Bunker Transfer\n\nPre-transfer checks…'),
        doc('Main Engine Lube Oil Routine', root.id, 'document', 'pdf', 'lube-oil-routine.pdf'),
      ]),
      folder('Emergency Preparedness', root.id, [
        doc('Fire Drill Sequence', root.id, 'document', 'rich_text', '## Fire Drill\n\nMuster stations and duties…'),
        doc('SOPEP Activation Steps', root.id, 'document', 'pdf', 'sopep-activation.pdf'),
      ]),
    ];
  } else if (kind === 'fleet_circulars') {
    root.children = [
      folder('Company Fleet Directives', root.id, [
        doc('Fleet Safety Circular Q2-2026', root.id, 'document', 'rich_text', '## Fleet Safety Circular\n\nEffective immediately…'),
        doc('Navigation Policy Update', root.id, 'document', 'pdf', 'nav-policy-2026.pdf'),
      ]),
      folder('Crew & Manning Circulars', root.id, [
        doc('Rest Hour Compliance Notice', root.id, 'document', 'rich_text', '## Rest Hours\n\nAll vessels must…'),
      ]),
    ];
  } else {
    root.children = [
      folder('Liberia Registry', root.id, [
        doc('Liberian Flag State Requirements', root.id, 'document', 'pdf', 'liberia-requirements.pdf'),
        doc('Annual Flag State Inspection Guide', root.id, 'document', 'rich_text', '## Flag State Inspection\n\nPreparation checklist…'),
      ]),
      folder('Marshall Islands Registry', root.id, [
        doc('MI-SMS Framework Requirements', root.id, 'document', 'pdf', 'mi-sms-framework.pdf'),
      ]),
    ];
  }
  return root;
}

// Deep-clone a master tree into a tenant's workspace copy.
// `forTenant` marks inherited nodes as draft (pending Company Admin customization).
export function cloneDocTree(node: DocumentNode, forTenant = false): DocumentNode {
  const clone: DocumentNode = {
    ...node,
    id: forTenant ? `${node.id}-clone` : node.id,
    approvalState: forTenant ? 'approved' : undefined,
    syncState: forTenant ? 'synced' : undefined,
    creatorEmail: forTenant ? 'sms@superadmin.platform' : undefined,
    children: node.children.map((c) => cloneDocTree(c, forTenant)),
  };
  return clone;
}

// Recursively find a node by id within a tree
export function findDocNode(node: DocumentNode, id: string): DocumentNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const f = findDocNode(c, id);
    if (f) return f;
  }
  return null;
}

// Recursively remove a node by id (returns mutated root)
export function removeDocNode(node: DocumentNode, id: string): DocumentNode {
  node.children = node.children.filter((c) => c.id !== id).map((c) => removeDocNode(c, id));
  return node;
}

// Add a child folder or document under a parent id
export function addDocChild(node: DocumentNode, parentId: string, child: DocumentNode): DocumentNode {
  if (node.id === parentId) {
    node.children.push(child);
    return node;
  }
  node.children = node.children.map((c) => addDocChild(c, parentId, child));
  return node;
}

// Rename a node by id
export function renameDocNode(node: DocumentNode, id: string, label: string): DocumentNode {
  if (node.id === id) node.label = label;
  node.children = node.children.map((c) => renameDocNode(c, id, label));
  return node;
}

// Update document content
export function updateDocContent(node: DocumentNode, id: string, content: string, contentKind: 'rich_text' | 'pdf'): DocumentNode {
  if (node.id === id) { node.content = content; node.contentKind = contentKind; node.updatedAt = new Date().toISOString(); }
  node.children = node.children.map((c) => updateDocContent(c, id, content, contentKind));
  return node;
}

const AUDIT_ACTIONS: Array<{ category: AuditEvent['category']; action: string; severity: AuditEvent['severity']; impersonation?: boolean }> = [
  { category: 'auth', action: 'Sign-in succeeded', severity: 'info' },
  { category: 'auth', action: 'MFA challenge passed', severity: 'info' },
  { category: 'impersonation', action: 'Login As — impersonation started', severity: 'critical', impersonation: true },
  { category: 'impersonation', action: 'Impersonation session ended', severity: 'warning', impersonation: true },
  { category: 'tenant', action: 'Tenant suspended', severity: 'warning' },
  { category: 'tenant', action: 'Tenant activated', severity: 'info' },
  { category: 'tenant', action: 'Plan tier upgraded', severity: 'info' },
  { category: 'sms', action: 'Master SMS push staged', severity: 'warning' },
  { category: 'sms', action: 'Folder created: "Emergency Procedures"', severity: 'info' },
  { category: 'sms', action: 'Document renamed: "Mooring Manual" → "Mooring Operations Manual"', severity: 'info' },
  { category: 'sms', action: 'PDF uploaded: "berthing-safety-checklist.pdf" (2.3MB)', severity: 'info' },
  { category: 'sms', action: 'Folder deleted: "Draft Procedures" (3 documents removed)', severity: 'warning' },
  { category: 'sms', action: 'Document content edited: "Safety Policy v2"', severity: 'info' },
  { category: 'sms', action: 'DPA approved: "Emergency Response Plan" (delta v3.1.0 → v3.2.0)', severity: 'warning' },
  { category: 'sms', action: 'Custom tab created: "Audit Reports"', severity: 'info' },
  { category: 'sms', action: 'Subfolder added: "Section 3 / Checklists / Monthly"', severity: 'info' },
  { category: 'billing', action: 'Invoice generated', severity: 'info' },
  { category: 'billing', action: 'Contract renewal email sent', severity: 'info' },
  { category: 'backup', action: 'Manual snapshot triggered', severity: 'info' },
  { category: 'backup', action: 'Isolated restore executed', severity: 'critical' },
  { category: 'security', action: 'Account password reset issued', severity: 'warning' },
  { category: 'security', action: 'Account locked by admin', severity: 'warning' },
  { category: 'security', action: 'Global MFA enforcement toggled', severity: 'warning' },
  { category: 'system', action: 'Maintenance banner published', severity: 'info' },
  { category: 'system', action: 'API handshake failed (retry)', severity: 'warning' },
];

const ACTORS = [SUPER_ADMIN_ID, 'PA-014', 'GS-022', 'PA-007'];
const IPS = ['10.42.1.8', '10.42.1.12', '172.16.8.4', '10.0.0.55', '203.0.113.7'];

export function buildAuditLog(tenants: Tenant[], count = 26): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = pick(AUDIT_ACTIONS, i * 5 + 2);
    const tenant = pick(tenants, i + 1);
    const actor = pick(ACTORS, i);
    out.push({
      id: uid('aud'),
      ts: isoHoursAgo(i * 3 + 1),
      actor,
      category: tpl.category,
      action: tpl.action,
      target: tpl.category === 'tenant' || tpl.category === 'billing' || tpl.category === 'backup' ? tenant.company : tpl.impersonation ? tenant.contactEmail : 'platform',
      companyId: tenant.id,
      ip: pick(IPS, i),
      scope: tpl.category,
      severity: tpl.severity,
      impersonation: tpl.impersonation,
    });
  }
  return out.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
}

export function buildInvoices(tenants: Tenant[]): Invoice[] {
  const out: Invoice[] = [];
  const statuses: Invoice['status'][] = ['paid', 'paid', 'processing', 'overdue', 'draft'];
  tenants.forEach((t, ti) => {
    for (let m = 0; m < 3; m++) {
      out.push({
        id: `INV-${20260000 + ti * 100 + m}`,
        tenantId: t.id,
        company: t.company,
        amount: t.monthlyRevenue || PLAN_DEFAULTS[t.plan as PlanTier].monthly,
        currency: 'USD',
        period: ['June 2026', 'May 2026', 'April 2026'][m],
        issued: isoDaysAgo(m * 30 + 5),
        status: pick(statuses, ti + m),
      });
    }
  });
  return out.sort((a, b) => +new Date(b.issued) - +new Date(a.issued));
}

export function buildBackups(tenants: Tenant[]): BackupSnapshot[] {
  const out: BackupSnapshot[] = [];
  tenants.forEach((t, ti) => {
    for (let d = 0; d < 7; d++) {
      const status: BackupSnapshot['status'] = d === 0 ? 'completed' : d === 6 ? 'expired' : 'completed';
      out.push({
        id: `SNP-${ti}${d}-${Math.random().toString(36).slice(2, 6)}`,
        tenantId: t.id,
        company: t.company,
        takenAt: isoDaysAgo(d, 2 + ti),
        sizeGb: +(t.storageGb.used * 0.04 + d * 0.3).toFixed(2),
        type: d === 3 ? 'manual' : 'auto',
        status,
        expiry: isoDaysAgo(d - 30, 2),
        reason: d === 3 ? 'Pre SMS push v2.4 staging' : undefined,
      });
    }
  });
  return out.sort((a, b) => +new Date(b.takenAt) - +new Date(a.takenAt));
}

export function buildInternalUsers(): InternalUser[] {
  return [
    { id: 'SA-001', name: SUPER_ADMIN_NAME, email: 'ellis.hawthorne@maritime-platform.io', role: 'Super-Admin', status: 'active', lastActive: isoMinutesAgo(3), mfa: true },
    { id: 'PA-014', name: 'Morgan Whitfield', email: 'm.whitfield@maritime-platform.io', role: 'Platform Auditor', status: 'active', lastActive: isoMinutesAgo(40), mfa: true },
    { id: 'PA-007', name: 'Priya Raghunathan', email: 'p.raghunathan@maritime-platform.io', role: 'Platform Auditor', status: 'active', lastActive: isoHoursAgo(5), mfa: true },
    { id: 'GS-022', name: 'Theo Marchetti', email: 't.marchetti@maritime-platform.io', role: 'Global Support Staff', status: 'active', lastActive: isoHoursAgo(2), mfa: false },
    { id: 'GS-031', name: 'Aiko Tanaka', email: 'a.tanaka@maritime-platform.io', role: 'Global Support Staff', status: 'locked', lastActive: isoDaysAgo(9), mfa: false },
    { id: 'PA-019', name: 'Darius Okafor', email: 'd.okafor@maritime-platform.io', role: 'Platform Auditor', status: 'invited', lastActive: isoDaysAgo(1), mfa: false },
  ];
}

export function buildSystemRoles(): SshRole[] {
  return [
    {
      id: 'role-company-admin',
      name: 'Company Admin (Shore)',
      description: 'Full tenant administration, vessel provisioning, user creation, and drafting SMS revisions.',
      permissions: ['Full tenant administration', 'Vessel provisioning', 'User creation (Shore / Ship / Crew)', 'Draft SMS document revisions', 'Create & edit fleet circulars'],
      scope: 'tenant',
      system: true,
    },
    {
      id: 'role-dpa',
      name: 'DPA / Marine Superintendent (Shore)',
      description: 'Verification cockpit, SMS review queue, fleet circular distribution, and official DPA approval/push rights.',
      permissions: ['Dedicated SMS approval queue', 'Review SMS revisions uploaded by Company Admin', 'Distribute fleet circulars', 'Approve & Push to Fleet', 'Reject & return to Company Admin'],
      scope: 'tenant',
      system: true,
    },
    {
      id: 'role-ship-command',
      name: 'Ship Command (Master & Chief Engineer)',
      description: 'Read-only pipeline for active DPA-approved SMS manuals, local master logging, and vessel execution controls.',
      permissions: ['Search & view DPA-approved SMS manuals', 'Download operational baselines', 'Print active manuals', 'Local master logging', 'Vessel execution controls'],
      scope: 'tenant',
      system: true,
    },
    {
      id: 'role-ship-officers',
      name: 'Shipboard Officers (Chief Mate, 2nd Engineer, Duty Officers)',
      description: 'Search, view, download active operational checklists, and log safety routines.',
      permissions: ['Search active operational checklists', 'View DPA-approved documents', 'Download operational baselines', 'Log safety routines'],
      scope: 'tenant',
      system: true,
    },
    {
      id: 'role-ship-crew',
      name: 'Shipboard Crew & Ratings (Bosun, AB, Oiler, Crew)',
      description: 'Read-only access to safety manuals, emergency procedures, and fleet circulars with controlled print/view permissions.',
      permissions: ['View safety manuals (read-only)', 'View emergency procedures', 'View fleet circulars', 'Controlled print of approved materials'],
      scope: 'tenant',
      system: true,
    },
  ];
}

export function buildErrorLogs(): ErrorLog[] {
  return [
    { id: uid('err'), ts: isoMinutesAgo(8), level: 'error', source: 'sync-gateway', message: 'VSAT handshake timeout for STELLA SPIRIT', tenantId: 'T-1003', payload: '{"code":"VH_TIMEOUT","node":"VSAT-12","retry":3}' },
    { id: uid('err'), ts: isoHoursAgo(1), level: 'warn', source: 'auth-service', message: 'Rate limit threshold reached for tenant T-1001', tenantId: 'T-1001', payload: '{"window":"60s","attempts":482,"limit":450}' },
    { id: uid('err'), ts: isoHoursAgo(3), level: 'critical', source: 'db-pool', message: 'Connection pool saturation on shard eu-west-1b', tenantId: null, payload: '{"shard":"eu-west-1b","active":98,"max":100,"waitMs":4200}' },
    { id: uid('err'), ts: isoHoursAgo(6), level: 'error', source: 'pdf-renderer', message: 'Invoice PDF render failed for INV-20260002', tenantId: 'T-1001', payload: '{"invoice":"INV-20260002","reason":"font_missing"}' },
    { id: uid('err'), ts: isoDaysAgo(1, 14), level: 'warn', source: 'edge-cache', message: 'Cache miss spike on /api/sms/tree', tenantId: null, payload: '{"route":"/api/sms/tree","missRate":0.62}' },
  ];
}

const TENANT_COMPANY_EMAILS: Record<string, string> = {
  'Frontline Management': 'fleet.ops@frontline.no',
  'Stella Maris Shipping': 'dpa@stellamaris.gr',
  'Hapag-Lloyd USA': 'sms.editor@hapag-lloyd.com',
  'Orient Overseas Container': 'sms.admin@oocl.com',
  'Mitsui OSK Lines': 'marine@moll.co.jp',
  'Dorian LPG (Hellas)': 'technical@dorianlpg.com',
  'Scorpio Tankers': 'ops@scorpiotankers.com',
};

export function buildSmsSnapshots(tenants: Tenant[]): SmsSnapshot[] {
  const out: SmsSnapshot[] = [];
  tenants.forEach((t, ti) => {
    const email = TENANT_COMPANY_EMAILS[t.company] ?? `admin@${t.company.toLowerCase().replace(/[^a-z]/g, '')}.com`;
    for (let d = 0; d < 3; d++) {
      out.push({
        id: `snp-sms-${ti}-${d}-${Math.random().toString(36).slice(2, 6)}`,
        tenantId: t.id,
        company: t.company,
        takenAt: isoDaysAgo(d, ti * 2),
        label: d === 0 ? 'Today — auto snapshot' : d === 1 ? 'Yesterday — auto snapshot' : `${d} days ago — manual pre-edit`,
        docClones: {
          sms: cloneDocTree(t.docClones.sms, true),
          fleet_circulars: cloneDocTree(t.docClones.fleet_circulars, true),
          flag_state: cloneDocTree(t.docClones.flag_state, true),
        },
      });
    }
  });
  return out;
}

// Seed tenant doc clones with richer metadata: creator emails, approval states, sync states
export function seedTenantDocMetadata(tenants: Tenant[]): Tenant[] {
  return tenants.map((t) => {
    const email = TENANT_COMPANY_EMAILS[t.company] ?? `admin@${t.company.toLowerCase().replace(/[^a-z]/g, '')}.com`;
    function annotate(node: DocumentNode, depth: number): DocumentNode {
      const childCount = node.children.length;
      const isLeafDoc = node.kind === 'document' && childCount === 0;
      return {
        ...node,
        creatorEmail: email,
        approvalState: node.approvalState ?? (isLeafDoc ? 'approved' : undefined),
        syncState: node.syncState ?? (isLeafDoc ? 'synced' : undefined),
        updatedAt: node.updatedAt,
        children: node.children.map((c) => annotate(c, depth + 1)),
      };
    }
    return {
      ...t,
      docClones: {
        sms: annotate(t.docClones.sms, 0),
        fleet_circulars: annotate(t.docClones.fleet_circulars, 0),
        flag_state: annotate(t.docClones.flag_state, 0),
      },
      guardrails: { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 },
    };
  });
}
