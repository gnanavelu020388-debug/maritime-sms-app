# Maritime Platform Console — Instruction Manual

A multi-tenant maritime Safety Management System (SMS) platform with three strictly isolated application layers. This manual covers every layer, every screen, every available option, and the technical architecture underneath.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Layer 1 — Super Admin Console](#2-layer-1--super-admin-console)
3. [Layer 2 — Company Workspace](#3-layer-2--company-workspace)
4. [Layer 3 — Vessel Portal](#4-layer-3--vessel-portal)
5. [Technical Architecture](#5-technical-architecture)
6. [Database Schema & RLS](#6-database-schema--rls)
7. [Authentication & Role Resolution](#7-authentication--role-resolution)
8. [SMS Approval Workflow](#8-sms-approval-workflow)
9. [Audit & Compliance](#9-audit--compliance)

---

## 1. Platform Overview

The platform serves three distinct user populations, each routed to a dedicated interface after login. No layer can see or modify data belonging to another layer's scope.

| Layer | Role(s) | Scope | Access Level |
|-------|---------|-------|--------------|
| Super Admin Console | `super_admin` | All tenants, platform-wide | Full platform control |
| Company Workspace | `company_admin`, `dpa` | Single tenant (their shipping company) | Read/write within their tenant |
| Vessel Portal | `vessel` | Single vessel (active crew assignment) | Read-only, approved documents only |

### Routing Contract

After authentication, `App.tsx` resolves the user's role and routes accordingly:

- `super_admin` → **SuperAdminShell** (platform-wide console)
- `company_admin` or `dpa` → **CompanyApp** (shoreside fleet management)
- `vessel` → **VesselApp** (dedicated vessel portal, scoped to active assignment)
- Authenticated but no role → "Account not provisioned" screen

If a vessel-role user has no active crew assignment, the Vessel Portal shows an **Access Denied** screen instead of the document tree.

---

## 2. Layer 1 — Super Admin Console

**Who:** Platform operators (e.g., "Ellis Hawthorne", SA-001).
**Shell:** `SuperAdminShell` — full-height sidebar + topbar layout, max width 1920px.
**Sections:** 9, grouped into Operate / Govern / Commercial.

### 2.1 High-Level Dashboard (`dashboard`)

**Group:** Operate
**Purpose:** Platform-wide KPIs and live satellite sync visualization.

- Aggregate metrics across all tenants (total companies, vessels, seats, revenue)
- Live satellite payload queue with real-time progress simulation (updates every 2.2s)
- Satellite links tracked: **Starlink**, **VSAT**, **FBB**
- Payload statuses: `syncing`, `queued`, `processed`, `failed`
- The satellite tick simulates progress: syncing payloads advance 6–16% per tick; queued payloads randomly transition to syncing

### 2.2 Tenant & Company Management (`tenants`)

**Group:** Govern
**Purpose:** Onboard, suspend, configure shipping company accounts.

Available operations:

| Operation | Description |
|-----------|-------------|
| **Create Tenant** | Provisions a new shipping company with plan, region, seat/vessel/storage limits |
| **Edit Tenant** | Updates company name, contact email, region, contract expiry |
| **Set Status** | Changes tenant status: `active`, `suspended`, `trial`, `provisioning` |
| **Set Plan** | Changes plan tier; automatically recalculates max limits from tier config |
| **Toggle Module** | Grants or revokes optional modules per tenant |

**Plan Tiers:** Standard, Professional, Enterprise, Custom

**Optional Modules:**

| Module | Description |
|--------|-------------|
| Voyage Logging | Official voyage logbook entries & sign-off workflow |
| Crew Matrix | Crew competency, certification & rank assignments |
| Electronic Logbooks | Engine, deck & GMDSS electronic record books |
| Advanced Analytics | Cross-fleet KPI, risk & trend dashboards |
| Satellite Sync | Offline-first payload queue via VSAT / Starlink |
| Risk Assessment | Job hazard analysis & residual risk tracking |

**Tenant properties tracked:** company name, contact email, plan, status, seats (used/max), vessels (used/max), storage GB (used/max), modules, MFA enforced, region, created date, contract expiry, monthly revenue, SMS version.

### 2.3 Live Provisioning Studio (`provisioning`)

**Group:** Govern
**Purpose:** Create real tenants and provision users end-to-end.

- Creates tenant records in the database (not just mock state)
- Provisions tenant users with full maritime crew fields: name, email, employee ID, passport number, seaman book number, nationality, rank, role
- Users are created with `invited` status until they sign up and claim their account
- Supports the `claim_tenant_user` RPC flow for unauthenticated users to link their auth account to a pre-provisioned row

### 2.4 Master SMS Template Engine (`sms`)

**Group:** Govern
**Purpose:** Regulatory baseline document hierarchy and fleet-wide push distribution.

**Three master document trees:**

| Tree | Key | Subtitle |
|------|-----|----------|
| SMS Documents | `sms` | Safety Management System baseline |
| Fleet Circulars | `fleet_circulars` | Company-wide fleet directives |
| Flag State Documents | `flag_state` | Flag authority requirements |

**Document tree operations:**

| Operation | Description |
|-----------|-------------|
| **Add Node** | Create a new folder or document under any parent |
| **Rename Node** | Change a node's label |
| **Delete Node** | Remove a node (and all children via cascade) |
| **Update Content** | Set rich-text body or PDF filename reference for a document |
| **Push to Tenants** | Clone the master tree into selected tenants' workspaces with a version bump |

**Push distribution (Flexible Template Model):**
- Super Admin selects target tenants and a version number
- The master tree is deep-cloned into each target tenant's `docClones` workspace
- Company Admins in those tenants receive full edit capability over their cloned copy
- The SMS push version is tracked at the platform level (e.g., `2.4.0`)

**Document node fields:** id, label, kind (folder/document), parentId, contentKind (rich_text/pdf), content, version, approvalState, updatedAt, children.

### 2.5 User & Role Configuration (`users`)

**Group:** Govern
**Purpose:** Internal platform staff access control and maritime rank blueprint.

**Internal user roles:** Super-Admin, Platform Auditor, Global Support Staff

| Operation | Description |
|-----------|-------------|
| **Invite User** | Creates a new internal staff account |
| **Reset Password** | Issues a password reset for an internal user |
| **Lock/Unlock Account** | Toggles account status between `active` and `locked` |

**Internal user fields:** name, email, role, status (active/locked/invited), last active timestamp, MFA enabled.

**System roles** are also managed here, with permissions arrays and scope (`tenant` or `platform`).

**Maritime rank blueprint (ranks):** DPA, Master, Chief Engineer, Chief Mate, Second Engineer, Bosun, AB, Oiler, Cook, Crew.

### 2.6 Platform Security & Audits (`security`)

**Group:** Govern
**Purpose:** Immutable audit ledger and impersonation tracking.

| Operation | Description |
|-----------|-------------|
| **View Audit Log** | Browse the immutable, append-only audit trail (max 400 entries in state) |
| **Toggle Global MFA** | Enable/disable platform-wide MFA enforcement |
| **Start Impersonation** | "Login As" — impersonate a tenant to see their view |
| **End Impersonation** | Return to super admin identity |
| **Publish Maintenance Banner** | Push a platform-wide banner (info/warning/critical severity) |
| **Clear Maintenance Banner** | Remove the active banner |

**Audit event fields:** timestamp, actor ID, category, action, target, company ID, IP address, scope, severity (info/warning/critical), impersonation flag.

**Audit categories:** `auth`, `impersonation`, `tenant`, `sms`, `billing`, `backup`, `security`, `system`.

**Impersonation** is flagged as `critical` severity on start and `warning` on end. An overlay appears on screen during active impersonation.

### 2.7 Platform Monitoring (`monitoring`)

**Group:** Operate
**Purpose:** Satellite traffic, license compliance, and error tracking.

- Live satellite payload queue (same data as dashboard, operational view)
- License compliance checks (seats/vessels/storage against tier limits)
- Error logs with severity levels: `error`, `warn`, `critical`
- Error log fields: timestamp, level, source, message, tenant ID, payload

### 2.8 Billing & Subscriptions (`billing`)

**Group:** Commercial
**Purpose:** SaaS tier constructor and contract lifecycle management.

**Tier Constructor — editable per-tier limits:**

| Tier | Monthly | Annual | Vessels | Storage | Seats |
|------|---------|--------|---------|---------|-------|
| Standard | $1,200 | $13,200 | 5 | 50 GB | 25 |
| Professional | $4,200 | $46,200 | 20 | 250 GB | 100 |
| Enterprise | $14,500 | $159,500 | 80 | 1,000 GB | 500 |
| Custom | $0 | $0 | 0 | 0 | 0 |

**Tier config cascading:** When a tier config is edited, **every tenant on that tier** is automatically recalculated with the new max limits. Similarly, when a tenant's plan changes, that tenant's limits are recalculated from the matching tier config.

**Invoice operations:**
- Generate invoices (status: `paid`, `overdue`, `processing`, `draft`)
- Invoice fields: tenant, company, amount, currency, period, issued date, status

### 2.9 Tenant Backup & Recovery (`backups`)

**Group:** Operate
**Purpose:** Isolated per-tenant snapshots and high-security restore.

| Operation | Description |
|-----------|-------------|
| **Trigger Manual Snapshot** | Creates a backup for a specific tenant |
| **Restore from Snapshot** | Executes an isolated restore (logged as `critical` severity) |

**Backup snapshot fields:** tenant, company, timestamp, size (GB), type (`auto`, `manual`, `pre-restore`), status (`completed`, `running`, `failed`, `expired`), expiry date, reason.

---

## 3. Layer 2 — Company Workspace

**Who:** Shoreside fleet management — `company_admin` and `dpa` roles.
**Shell:** `CompanyShell` — 256px sidebar (`w-64`) with company name and role label, topbar with email and SMS version.
**Sections:** 5, with role-based filtering (some sections are DPA-only or admin-only).

### Role-Based Navigation Filter

The sidebar dynamically filters which sections each role can see:

| Section | company_admin | dpa |
|---------|:---:|:---:|
| Overview | Yes | Yes |
| Fleet & Vessel Profiles | Yes | No |
| SMS Review & Deployment | Yes | Yes |
| Crew & User Directory | Yes | No |
| Audit & Compliance Ledger | Yes | Yes |

### 3.1 Overview (`overview`)

- Company-level KPI summary
- Quick navigation cards to other sections
- Shows current SMS version, vessel count, crew count, storage usage

### 3.2 Fleet & Vessel Profiles (`vessels`) — Company Admin only

- View and manage vessel hull profiles for the tenant
- Vessel fields: name, IMO number, call sign, flag state, port of registry, gross tonnage, KW power, vessel type, class society, SMS active version, last sync timestamp
- Add/edit/remove vessels (within tenant's vessel limit)

### 3.3 SMS Review & Deployment Desk (`sms_dpa`) — Company Admin + DPA

The core document management interface for the DPA approval workflow. This is the most feature-rich company view.

**Document tree tabs:** SMS Documents, Fleet Circulars, Flag State Documents (plus any custom tabs the company has created).

**Tree navigation:**
- Folder tree with expand/collapse, color-coded approval-state badges
- Root section headers render at `text-lg font-semibold`; nested nodes at `text-base font-medium`
- Each node shows an approval-state badge: green (approved), amber (pending_dpa), gray (draft)
- PDF documents show a "PDF" badge

**Per-node actions (visible on hover, edit roles only):**

| Action | Icon | Description |
|--------|------|-------------|
| Preview inline | Eye | Opens document in a 2xl modal preview |
| Open in new tab | ExternalLink | Opens document in a spacious browser tab |
| Add child | Plus | Create a sub-folder or document |
| Edit content | FileEdit | Open the rich-text/PDF editor |
| Rename | Pencil | Inline rename the node |
| Delete | Trash2 | Remove the node |

**Click behavior:** Clicking a document in the tree opens it in a **new browser tab** (spacious 1100px layout). The Eye icon is available for inline modal preview.

**Inline rename:** Click a node label while editing to get an inline text input matched to the tree's font size.

**Document editor modal:**
- Toggle between Rich Text and PDF reference modes
- Rich text: multi-line textarea with monospace preview
- PDF: filename reference field
- Saving sets the document to `pending_dpa` approval state and bumps the tenant's SMS version

**Pending DPA Approval workflow:**

1. A yellow warning banner shows the count of pending documents and the next SMS version number
2. Below it, a collapsible **"Documents Awaiting Your Review"** table aggregates all pending documents across all tabs and subfolders:
   - **Document Name** (with PDF badge)
   - **Location** (full breadcrumb resolved from parent chain, e.g., "SMS Documents → Section 1: General → Emergency Procedures")
   - **Last Modified** timestamp
   - **Review Actions**: inline Eye-icon preview + green "Approve & Deploy" button
3. A blue header button "Approve & Deploy (N)" allows bulk approval of all pending documents

**DPA-only approval enforcement:**
- The `canApprove` flag is `true` only when `role === 'dpa'`
- **Company Admins cannot approve documents** — both the header "Approve & Deploy" button and the per-row green buttons are disabled (grayed out, `cursor-not-allowed`, 50% opacity)
- Disabled buttons display the tooltip: **"Statutory Release Authorized for DPA Role Only."**
- Company Admins retain full edit rights (create, edit, rename, delete) but cannot release documents to the fleet

**Approving a document:**
- Sets `approval_state` to `approved`
- Bumps the tenant's SMS version (e.g., `1.0.0` → `1.1.0`)
- Logs an audit event (category: `sms`, severity: `warning`)
- Refreshes the tree, pending list, and counts

**Custom tabs:** Company Admins can create, rename, and delete custom document tree tabs beyond the three defaults.

### 3.4 Crew & User Directory (`crew_directory`) — Company Admin only

- View all tenant users with full maritime crew fields
- Manage crew assignments (sign-on/sign-off to vessels)
- Fields: name, email, employee ID, passport, seaman book, nationality, rank, role, status
- Crew sign-on creates a `crew_assignments` row linking user → vessel with a rank and signed-on timestamp
- Crew sign-off sets `signed_off_at`, ending the active assignment

### 3.5 Audit & Compliance Ledger (`audit`) — Company Admin + DPA

- View the tenant's own audit log entries (scoped by RLS to their tenant only)
- Cannot see other tenants' audit entries
- Cannot modify or delete entries (append-only by design)

---

## 4. Layer 3 — Vessel Portal

**Who:** Crew members with `vessel` role.
**Shell:** `VesselShell` — minimal topbar-only layout (no sidebar), max width 1024px.
**Access level:** Read-only. A banner explicitly states: "You are viewing DPA-approved documents only. This is a read-only workspace — no edits, uploads, or deletions are available."

### Vessel Boundary Enforcement

**Hard gate:** If the user has no active crew assignment (`activeAssignment` is null), the portal displays an **Access Denied** screen:
- Shield-X icon
- "Access Denied — No Active Vessel Assignment"
- Explanation that documents are only accessible to crew actively signed on to a vessel's Manning Deck
- Status badge: "Ashore / Unassigned"
- Instructs user to contact their Company Admin or DPA

**When signed on**, a green banner shows:
- Vessel name
- Crew rank (e.g., "Master", "Chief Engineer")
- Sign-on date
- "Access is restricted to this vessel only"

### Document Portal

**Three document tree tabs** (same three kinds, but filtered to `approved` only):

| Tab | Key |
|-----|-----|
| SMS Documents | `sms` |
| Fleet Circulars | `fleet_circulars` |
| Flag State Documents | `flag_state` |

**Data filter:** The query fetches only documents where `approval_state = 'approved'`. Drafts and pending documents are invisible to vessel users.

**Features:**

| Feature | Description |
|---------|-------------|
| **Search** | Full-text search across document labels; filters the tree recursively |
| **Expand/Collapse** | Click folders to toggle; search auto-expands all matching branches |
| **View Document** | Click a document to open it in a modal |
| **Print** | Print button in the document modal footer |
| **Download PDF** | For PDF-type documents, a download button appears |

**Document view modal:**
- Rich text documents: rendered in monospace with preserved whitespace
- PDF documents: shows a file icon, filename, and a Download button
- Subtitle shows vessel name, SMS version, and "Approved" status
- A "DPA Approved" badge appears in the tree header

---

## 5. Technical Architecture

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend framework | React + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS (custom design system) |
| Icons | Lucide React |
| Backend / Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| State management | React `useReducer` + Context (Super Admin); Supabase queries (Company/Vessel) |

### State Management

**Super Admin Console** uses a centralized reducer store (`store.tsx`):
- `StoreProvider` wraps the shell
- `useReducer` with a single `reducer` function handling all action types
- `useStore()` hook provides state + dispatch to all children
- State includes: tenants, satellite payloads, master doc trees, tier configs, audit log, invoices, backups, internal users, system roles, error logs, maintenance banner, impersonation state, global MFA flag, toasts, theme
- Satellite sync runs on a 2.2s interval via `setInterval` inside a `useEffect`
- Theme (light/dark) persists to `localStorage` under key `mpc-theme`
- Toasts auto-dismiss after 4200ms via `setTimeout`

**Company & Vessel layers** use direct Supabase queries:
- No local reducer — data is fetched per-view via `supabase.from(...).select(...)`
- Real-time updates via manual refetch after mutations
- Auth state provided by `AuthProvider` context

### Action Types (Super Admin Store)

The reducer handles 27 action types. Most produce an audit entry; a few (satellite tick, theme, toast, rename, raw audit insert) do not:

| Action | Trigger Section | Audit Category | Severity |
|--------|----------------|----------------|----------|
| `TENANT_CREATE` | Tenants | tenant | info |
| `TENANT_UPDATE` | Tenants | tenant | info |
| `TENANT_SET_STATUS` | Tenants | tenant | warning if suspended, else info |
| `TENANT_SET_PLAN` | Tenants | tenant (scope: billing) | info |
| `TENANT_TOGGLE_MODULE` | Tenants | tenant | info |
| `TIER_CONFIG_UPDATE` | Billing | billing | info |
| `SMS_PUSH` | SMS Engine | sms | warning |
| `DOC_ADD` | SMS Engine | sms | info |
| `DOC_RENAME` | SMS Engine | (no audit) | — |
| `DOC_DELETE` | SMS Engine | sms | warning |
| `DOC_UPDATE_CONTENT` | SMS Engine | sms | info |
| `BACKUP_ADD` | Backups | backup | info |
| `BACKUP_RESTORE` | Backups | backup | critical |
| `INVOICE_ADD` | Billing | billing | info |
| `USER_RESET_PASSWORD` | Users | security | warning |
| `USER_LOCK_TOGGLE` | Users | security | warning |
| `USER_INVITE` | Users | security | info |
| `MFA_GLOBAL_TOGGLE` | Security | security | warning |
| `IMPERSONATE_START` | Security | impersonation | critical |
| `IMPERSONATE_END` | Security | impersonation | warning |
| `MAINTENANCE_PUBLISH` | Security | system | info |
| `MAINTENANCE_CLEAR` | Security | system | info |
| `AUDIT_ADD` | Global | (raw insert, no pushAudit) | — |
| `SATELLITE_TICK` | Dashboard/Monitoring | (no audit) | — |
| `THEME_SET` | Global | (no audit) | — |
| `TOAST_ADD` | Global | (no audit) | — |
| `TOAST_DISMISS` | Global | (no audit) | — |

### Theme System

- Light/dark mode toggle
- Dark mode adds `dark` class to `<html>` element
- Tailwind dark variant classes throughout (e.g., `dark:bg-ink-900`)
- Persisted in `localStorage` as `mpc-theme`

### Color System

The design system uses custom color ramps:
- **primary** — blue (actions, links, active states)
- **accent** — teal/green (folder icons, highlights)
- **success** — green (approved states, active assignments)
- **warning** — amber (pending states, caution banners)
- **danger** — red (delete actions, access denied)
- **ink** — neutral grays (text, backgrounds, borders)

---

## 6. Database Schema & RLS

### Tables (7 core + auth.users)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `super_admins` | Platform admin whitelist | `auth_uid`, name, email |
| `tenants` | Shipping company accounts | company, plan, status, license ceilings, `sms_version` |
| `tenant_users` | People in a tenant | name, email, employee_id, passport, seaman_book, nationality, rank, role, status |
| `vessels` | Hull profiles | name, imo_number, call_sign, flag_state, tonnage, `sms_active_version`, `last_sync_at` |
| `crew_assignments` | Manning deck sign-on/off | vessel_id, user_id, rank, `signed_on_at`, `signed_off_at` |
| `sms_documents` | Cloned SMS tree per tenant | tree_kind, label, content, `is_regulatory_header`, `approval_state`, version, `sort_order` |
| `audit_logs` | Immutable compliance ledger | actor, action, category, ip, location, severity |

### Row Level Security (RLS) — Full Policy Matrix

RLS is enabled on **every table**. Below is the complete access matrix:

| Table | Super Admin | Company Admin | DPA | Vessel |
|-------|:-----------:|:------------:|:---:|:------:|
| `super_admins` | Read self | — | — | — |
| `tenants` | Full (all) | Read own | Read own | Read own |
| `tenant_users` | Full (all) | Full (own tenant) | Full (own tenant) | Read (own tenant) |
| `vessels` | Full (all) | Full (own tenant) | Read (own tenant) | Read (own tenant) |
| `crew_assignments` | Full (all) | Full (own tenant) | Read (own tenant) | Read (own tenant) |
| `sms_documents` | Full (all) | Full (own tenant) | Full (own tenant) | **Read approved only** |
| `audit_logs` | Read all | Read own tenant | Read own tenant | Read own tenant |

**Key RLS details:**

- `sms_documents` vessel policy: `approval_state = 'approved'` AND `role = 'vessel'` — crew physically cannot see drafts or pending documents at the database level
- `audit_logs`: INSERT-only for all authenticated users (no UPDATE/DELETE policies exist — truly immutable)
- `is_super_admin()` helper function: `SECURITY DEFINER` SQL function that checks `super_admins` table for `auth.uid()` match
- `tenant_users_company_admin_manage` policy: allows `company_admin` AND `dpa` roles to manage users in their tenant

### Indexes

```
idx_tenant_users_auth_uid        — tenant_users(auth_uid)
idx_tenant_users_tenant_id       — tenant_users(tenant_id)
idx_vessels_tenant_id            — vessels(tenant_id)
idx_crew_vessel_id               — crew_assignments(vessel_id)
idx_sms_docs_tenant_tree         — sms_documents(tenant_id, tree_kind)
idx_sms_docs_parent              — sms_documents(parent_id)
idx_audit_logs_tenant_id         — audit_logs(tenant_id)
idx_audit_logs_created_at        — audit_logs(created_at DESC)
```

### Special Database Functions

| Function | Type | Purpose |
|----------|------|---------|
| `is_super_admin()` | `SECURITY DEFINER` SQL | Checks if current user is in `super_admins` table |
| `claim_tenant_user()` | `SECURITY DEFINER` RPC | Allows a newly-signed-up user to claim a pre-provisioned `tenant_users` row by matching email (bypasses RLS since new users have no tenant yet) |
| `get_my_active_assignment()` | RPC | Returns the vessel crew assignment for the current vessel-role user where `signed_off_at IS NULL` |

---

## 7. Authentication & Role Resolution

### Auth Provider

`AuthProvider` wraps the entire app and exposes:
- `signIn(email, password)` — Supabase password auth
- `signUp(email, password, name, asSuperAdmin)` — creates auth user; optionally inserts into `super_admins`
- `signOut()` — clears session and auth state
- `refresh()` — re-resolves role/tenant from current session

### Role Resolution Flow

When a user authenticates, `resolveRoleAndTenant()` executes this sequence:

```
1. Check super_admins table for auth_uid match
   → If found: role = 'super_admin', no tenant, done.

2. Check tenant_users by auth_uid
   → If found: resolve tenant, role, activeAssignment.

3. If not found by auth_uid, attempt email-based claim:
   → Call claim_tenant_user() RPC (SECURITY DEFINER, bypasses RLS)
   → Re-fetch tenant_users by auth_uid (now set by the RPC)
   → If found: resolve tenant, role, activeAssignment.

4. If still not found: role = null → "Account not provisioned" screen
```

### Role → Rank Mapping

The `rankToRole()` function maps maritime ranks to platform roles:

| Rank | Platform Role |
|------|---------------|
| DPA | `dpa` |
| All other ranks (Master, Chief Engineer, etc.) | `vessel` |

Company Admin is set directly as `tenant_users.role = 'company_admin'` (not derived from rank).

### Session Management

- `persistSession: true` — session survives page reloads
- `autoRefreshToken: true` — tokens refresh automatically
- `detectSessionInUrl: true` — handles OAuth/email redirects
- `onAuthStateChange` listener re-resolves role/tenant on every auth event

### Auth State Shape

```typescript
interface AuthState {
  user: User | null;           // Supabase auth user
  session: Session | null;     // Active session
  role: PlatformRole | null;   // 'super_admin' | 'company_admin' | 'dpa' | 'vessel'
  tenant: TenantRow | null;    // Tenant record (null for super admin)
  tenantUser: TenantUserRow | null;  // User's tenant profile
  activeAssignment: ActiveAssignment | null;  // Vessel assignment (vessel role only)
  loading: boolean;
  error: string | null;
}
```

---

## 8. SMS Approval Workflow

The SMS document lifecycle enforces a statutory approval gate between company editors and the fleet.

### Document Lifecycle

```
                    Company Admin / DPA edits
                              │
                              ▼
                         ┌─────────┐
                         │  draft  │  ← Only visible to company_admin/dpa
                         └────┬────┘
                              │ Save
                              ▼
                      ┌──────────────┐
                      │ pending_dpa  │  ← Awaiting DPA statutory release
                      └──────┬───────┘
                             │ DPA approves (canApprove = role === 'dpa')
                             ▼
                       ┌──────────┐
                       │ approved │  ← Visible to vessel crew (fleet)
                       └──────────┘
```

### Approval Enforcement

| Role | Can Edit | Can Approve (Deploy) |
|------|:--------:|:--------------------:|
| Super Admin | Yes (via template push) | Yes (platform-level) |
| Company Admin | Yes | **No** — buttons disabled with tooltip |
| DPA | Yes | **Yes** — sole statutory authority |
| Vessel | No (read-only) | No |

### Version Bumping

Every approval increments the tenant's `sms_version` using a semantic version bump function (e.g., `1.0.0` → `1.1.0`). This version is displayed in the Company Shell topbar and the Vessel Portal header.

### Regulatory Header Lock

Documents with `is_regulatory_header = true` are safeguarded — these represent unchangeable hierarchy nodes that cannot be deleted or restructured, ensuring regulatory baseline integrity.

---

## 9. Audit & Compliance

### Immutable Ledger

The `audit_logs` table is designed as an **append-only** ledger:
- No `UPDATE` or `DELETE` RLS policies exist — once written, an entry cannot be modified
- Any authenticated user can INSERT (via `audit_insert_any` policy)
- Read access is scoped: Super Admins see all; tenant users see only their tenant's entries

### Audit Event Structure

Every administrative action dispatches an audit event with:

| Field | Description |
|-------|-------------|
| `actor_email` | Email of the user performing the action |
| `category` | `auth`, `impersonation`, `tenant`, `sms`, `billing`, `backup`, `security`, `system` |
| `action` | Human-readable description (e.g., "Tenant suspended: Acme Shipping") |
| `target` | Entity affected (company name, email, tree kind) |
| `tenant_id` | Affected tenant (null for platform-wide actions) |
| `ip_address` | Source IP (simulated as `10.42.1.8` in the Super Admin store) |
| `severity` | `info`, `warning`, or `critical` |

### Severity Guidelines

| Severity | Use Case |
|----------|----------|
| `info` | Routine operations (create, update, module toggle, invoice generation, doc add, doc content update, invite user, maintenance publish/clear) |
| `warning` | Sensitive actions (suspend tenant, SMS push, doc delete, password reset, account lock, MFA toggle, DPA approval, impersonation end) |
| `critical` | High-risk actions (restore from backup, impersonation start) |

### Impersonation Tracking

Impersonation sessions are doubly audited:
- **Start:** `critical` severity, `impersonation: true` flag, records target tenant
- **End:** `warning` severity, `impersonation: true` flag
- An on-screen `ImpersonationOverlay` component visually indicates when impersonation is active

---

*This manual reflects the current state of the Maritime Platform Console codebase. For implementation details, refer to the source files in `src/` and migrations in `supabase/migrations/`.*
