import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---- Domain types matching the DB schema ----

export type PlatformRole = 'super_admin' | 'company_admin' | 'dpa' | 'vessel';
export type InternalRole = 'super_admin' | 'platform_auditor' | 'global_support';
export type Rank = string;

export const ALL_RANKS: Rank[] = ['Master', 'Chief Engineer', 'Chief Mate', 'Second Engineer', 'Bosun', 'AB', 'Oiler', 'Cook', 'Crew'];
export const CORE_RANKS: Rank[] = ['Master', 'Chief Engineer', 'Chief Mate', 'Second Engineer', 'Bosun', 'AB', 'Oiler', 'Cook', 'Crew'];
export type ApprovalState = 'draft' | 'pending_dpa' | 'approved' | 'rejected';

export interface TenantRow {
  id: string;
  company: string;
  contact_email: string;
  plan: string;
  status: string;
  vessels_max: number;
  seats_max: number;
  storage_gb_max: number;
  monthly_revenue: number;
  region: string;
  mfa_enforced: boolean;
  modules: string[];
  sms_version: string;
  created_at: string;
  contract_expires: string;
  updated_at: string;
}

export interface TenantUserRow {
  id: string;
  tenant_id: string;
  auth_uid: string | null;
  name: string;
  email: string;
  employee_id: string | null;
  passport_number: string | null;
  seaman_book_number: string | null;
  nationality: string | null;
  rank: Rank;
  role: Exclude<PlatformRole, 'super_admin'>;
  status: string;
  fleet_scope: 'global' | 'specific';
  assigned_vessel_ids: string[];
  assigned_fleet_profile_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface VesselRow {
  id: string;
  tenant_id: string;
  name: string;
  imo_number: string;
  call_sign: string | null;
  flag_state: string | null;
  port_of_registry: string | null;
  gross_tonnage: number | null;
  kw_power: number | null;
  vessel_type: string | null;
  class_society: string | null;
  sms_active_version: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrewAssignmentRow {
  id: string;
  vessel_id: string;
  tenant_id: string;
  user_id: string;
  rank: Rank;
  signed_on_at: string;
  signed_off_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ActiveAssignment {
  assignment_id: string;
  vessel_id: string;
  vessel_name: string;
  tenant_id: string;
  user_id: string;
  rank: Rank;
  signed_on_at: string;
}

export interface SmsDocRow {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  tree_kind: 'sms' | 'fleet_circulars' | 'flag_state';
  label: string;
  node_kind: 'folder' | 'document';
  content_kind: 'rich_text' | 'pdf' | null;
  content: string | null;
  is_regulatory_header: boolean;
  approval_state: ApprovalState;
  version: string;
  sort_order: number;
  profile_id: string | null;
  author_name: string | null;
  author_role: string | null;
  author_origin: string | null;
  rejection_comments: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_email: string;
  category: string;
  action: string;
  target: string | null;
  ip_address: string | null;
  location: string | null;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

export function rankToRole(rank: Rank): Exclude<PlatformRole, 'super_admin'> {
  if (rank === 'DPA') return 'dpa';
  return 'vessel';
}
