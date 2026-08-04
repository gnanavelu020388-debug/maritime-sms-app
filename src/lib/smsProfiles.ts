import { supabase } from './supabase';
import { isDemoMode, getEffectiveDemoVessels, DEMO_TENANTS } from './demoData';

export interface SmsProfile {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface SmsProfileWithVessels extends SmsProfile {
  vesselIds: string[];
  vesselCount: number;
}

function lsKey(tenantId: string) {
  return `sms-profiles-${tenantId}`;
}

function lsAssignmentsKey(tenantId: string) {
  return `sms-profile-assignments-${tenantId}`;
}

function readLsProfiles(tenantId: string): SmsProfile[] {
  try {
    const raw = localStorage.getItem(lsKey(tenantId));
    if (raw) return JSON.parse(raw) as SmsProfile[];
  } catch { /* ignore */ }
  // Seed sensible defaults so both Inspector and Company Admin start in sync
  const seeded = seedDefaultProfiles(tenantId);
  writeLsProfiles(tenantId, seeded);
  return seeded;
}

function seedDefaultProfiles(tenantId: string): SmsProfile[] {
  const now = '2025-03-10T00:00:00Z';
  const universal: SmsProfile = {
    id: `profile-universal-${tenantId}`,
    tenant_id: tenantId,
    name: 'Universal Fleet Baseline',
    version: '1.0.0',
    is_default: true,
    created_at: now,
    updated_at: now,
  };
  // Second profile name based on tenant's vessel mix; ID matches buildBulkCarrierProfileDocs
  const tenantName = DEMO_TENANTS.find((t) => t.id === tenantId)?.company ?? '';
  let secondName = 'Fleet SMS Profile';
  if (tenantName.includes('Atlantic') || tenantName.includes('Tanker')) secondName = 'Tanker Fleet SMS';
  else if (tenantName.includes('Pacific')) secondName = 'Bulk Carrier SMS';
  else if (tenantName.includes('Nordic')) secondName = 'Reefer Fleet SMS';
  else if (tenantName.includes('Crescent')) secondName = 'General Cargo SMS';

  const second: SmsProfile = {
    id: `profile-bulk-${tenantId}`,
    tenant_id: tenantId,
    name: secondName,
    version: '1.0.0',
    is_default: false,
    created_at: now,
    updated_at: now,
  };
  return [universal, second];
}

function writeLsProfiles(tenantId: string, profiles: SmsProfile[]) {
  localStorage.setItem(lsKey(tenantId), JSON.stringify(profiles));
}

/** Demo-mode assignments: vesselId -> profileId (1:1 mapping). */
type DemoAssignments = Record<string, string>;

function seedDefaultAssignments(tenantId: string): DemoAssignments {
  const universalId = `profile-universal-${tenantId}`;
  const vesselIds = getEffectiveDemoVessels(tenantId).map((v) => v.id);
  const assignments: DemoAssignments = {};
  for (const vid of vesselIds) {
    assignments[vid] = universalId;
  }
  return assignments;
}

function readLsAssignments(tenantId: string): DemoAssignments {
  try {
    const raw = localStorage.getItem(lsAssignmentsKey(tenantId));
    if (!raw) {
      // Seed defaults so the Universal Fleet Baseline shows its assigned vessels
      const seeded = seedDefaultAssignments(tenantId);
      writeLsAssignments(tenantId, seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw);
    // Migrate old multi-profile format (Record<string, string[]>) to 1:1
    if (typeof parsed === 'object' && parsed !== null) {
      const migrated: DemoAssignments = {};
      for (const [vid, val] of Object.entries(parsed)) {
        if (Array.isArray(val)) {
          // Old format: keep the first assignment only
          if (val.length > 0) migrated[vid] = val[0];
        } else if (typeof val === 'string') {
          migrated[vid] = val;
        }
      }
      // Ensure any newly-added demo vessels get a default assignment
      const liveVesselIds = new Set(getEffectiveDemoVessels(tenantId).map((v) => v.id));
      const universalId = `profile-universal-${tenantId}`;
      for (const vid of liveVesselIds) {
        if (!(vid in migrated)) migrated[vid] = universalId;
      }
      return migrated;
    }
  } catch { /* ignore */ }
  return {};
}

function writeLsAssignments(tenantId: string, assignments: DemoAssignments) {
  localStorage.setItem(lsAssignmentsKey(tenantId), JSON.stringify(assignments));
}

export async function loadProfiles(tenantId: string): Promise<SmsProfileWithVessels[]> {
  if (isDemoMode()) {
    const profiles = readLsProfiles(tenantId);
    const assignments = readLsAssignments(tenantId);
    const liveVesselIds = new Set(getEffectiveDemoVessels(tenantId).map((v) => v.id));
    return profiles.map((p) => {
      const vesselIds = Object.entries(assignments)
        .filter(([vid, pid]) => pid === p.id && liveVesselIds.has(vid))
        .map(([vid]) => vid);
      return { ...p, vesselIds, vesselCount: vesselIds.length };
    });
  }

  const { data: profiles } = await supabase
    .from('sms_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('created_at');

  const profileList = (profiles as SmsProfile[]) ?? [];
  const { data: assignments } = await supabase
    .from('sms_profile_vessels')
    .select('profile_id, vessel_id, tenant_id!inner(id)')
    .eq('tenant_id', tenantId);

  const assignMap: Record<string, string[]> = {};
  for (const a of (assignments as { profile_id: string; vessel_id: string }[] | null) ?? []) {
    if (!assignMap[a.profile_id]) assignMap[a.profile_id] = [];
    assignMap[a.profile_id].push(a.vessel_id);
  }

  return profileList.map((p) => ({
    ...p,
    vesselIds: assignMap[p.id] ?? [],
    vesselCount: (assignMap[p.id] ?? []).length,
  }));
}

export async function createProfile(tenantId: string, name: string): Promise<SmsProfile | null> {
  if (isDemoMode()) {
    const profiles = readLsProfiles(tenantId);
    const profile: SmsProfile = {
      id: `profile-${Date.now()}`,
      tenant_id: tenantId,
      name,
      version: '1.0.0',
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    profiles.push(profile);
    writeLsProfiles(tenantId, profiles);
    return profile;
  }

  const { data, error } = await supabase
    .from('sms_profiles')
    .insert({ tenant_id: tenantId, name })
    .select('*')
    .maybeSingle();
  if (error || !data) return null;
  return data as SmsProfile;
}

export async function deleteProfile(tenantId: string, profileId: string): Promise<boolean> {
  if (isDemoMode()) {
    const profiles = readLsProfiles(tenantId).filter((p) => p.id !== profileId);
    writeLsProfiles(tenantId, profiles);
    // Remove assignments (1:1 format: just delete vessels pointing to this profile)
    const assignments = readLsAssignments(tenantId);
    for (const [vid, pid] of Object.entries(assignments)) {
      if (pid === profileId) delete assignments[vid];
    }
    writeLsAssignments(tenantId, assignments);
    return true;
  }

  const { error } = await supabase.from('sms_profiles').delete().eq('id', profileId).eq('tenant_id', tenantId);
  return !error;
}

export async function bumpProfileVersion(tenantId: string, profileId: string, newVersion: string): Promise<void> {
  if (isDemoMode()) {
    const profiles = readLsProfiles(tenantId);
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx >= 0) {
      profiles[idx].version = newVersion;
      profiles[idx].updated_at = new Date().toISOString();
      writeLsProfiles(tenantId, profiles);
    }
    return;
  }
  await supabase.from('sms_profiles').update({ version: newVersion, updated_at: new Date().toISOString() }).eq('id', profileId).eq('tenant_id', tenantId);
}

/**
 * Set the vessel list for a profile, enforcing 1:1 mutual exclusivity.
 * Vessels newly assigned to this profile are automatically unassigned from
 * any other profile they were previously bound to.
 */
export async function setProfileVessels(tenantId: string, profileId: string, vesselIds: string[]): Promise<boolean> {
  if (isDemoMode()) {
    const assignments = readLsAssignments(tenantId);
    // Remove any vessels currently assigned to this profile
    for (const [vid, pid] of Object.entries(assignments)) {
      if (pid === profileId) delete assignments[vid];
    }
    // Assign selected vessels to this profile, overwriting any previous binding
    for (const vid of vesselIds) {
      assignments[vid] = profileId;
    }
    writeLsAssignments(tenantId, assignments);
    return true;
  }

  // 1. Delete existing assignments for this profile
  const { error: delErr } = await supabase.from('sms_profile_vessels').delete().eq('profile_id', profileId);
  if (delErr) return false;

  // 2. Unassign these vessels from any OTHER profile (mutual exclusivity)
  if (vesselIds.length > 0) {
    const { error: delOtherErr } = await supabase
      .from('sms_profile_vessels')
      .delete()
      .in('vessel_id', vesselIds)
      .neq('profile_id', profileId);
    if (delOtherErr) return false;

    // 3. Insert new assignments for this profile
    const rows = vesselIds.map((vessel_id) => ({ profile_id: profileId, vessel_id }));
    const { error: insErr } = await supabase.from('sms_profile_vessels').insert(rows);
    if (insErr) return false;
  }
  return true;
}

/**
 * Assign a single vessel to a profile, enforcing 1:1 mutual exclusivity.
 * Removes any existing assignment for this vessel before inserting.
 */
export async function assignVesselToProfile(tenantId: string, profileId: string, vesselId: string): Promise<boolean> {
  if (isDemoMode()) {
    const assignments = readLsAssignments(tenantId);
    if (!profileId) {
      delete assignments[vesselId];
    } else {
      assignments[vesselId] = profileId;
    }
    writeLsAssignments(tenantId, assignments);
    return true;
  }
  // Remove any existing binding for this vessel
  await supabase.from('sms_profile_vessels').delete().eq('vessel_id', vesselId);
  if (!profileId) return true;
  const { error } = await supabase.from('sms_profile_vessels').insert({ profile_id: profileId, vessel_id: vesselId });
  return !error;
}

export async function getProfileForVessel(tenantId: string, vesselId: string): Promise<SmsProfile | null> {
  if (isDemoMode()) {
    const profiles = readLsProfiles(tenantId);
    const assignments = readLsAssignments(tenantId);
    const assignedPid = assignments[vesselId];
    if (assignedPid) {
      const assigned = profiles.find((p) => p.id === assignedPid);
      if (assigned) return assigned;
    }
    return profiles[0] ?? null;
  }

  const { data: assignment } = await supabase
    .from('sms_profile_vessels')
    .select('profile_id, tenant_id!inner(id)')
    .eq('vessel_id', vesselId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (assignment) {
    const { data: profile } = await supabase
      .from('sms_profiles')
      .select('*')
      .eq('id', (assignment as { profile_id: string }).profile_id)
      .maybeSingle();
    if (profile) return profile as SmsProfile;
  }

  // Fall back to default profile
  const { data: defaultProfile } = await supabase
    .from('sms_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle();
  if (defaultProfile) return defaultProfile as SmsProfile;

  // Fall back to any profile
  const { data: anyProfile } = await supabase
    .from('sms_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (anyProfile as SmsProfile) ?? null;
}

export async function getVesselsForTenant(tenantId: string): Promise<{ id: string; name: string; vessel_type: string | null }[]> {
  if (isDemoMode()) {
    return getEffectiveDemoVessels(tenantId).map((v) => ({
      id: v.id, name: v.name, vessel_type: v.vessel_type,
    }));
  }
  const { data } = await supabase
    .from('vessels')
    .select('id, name, vessel_type')
    .eq('tenant_id', tenantId)
    .order('name');
  return (data as { id: string; name: string; vessel_type: string | null }[] | null) ?? [];
}

/**
 * Build a map of vesselId -> profileId for all assignments in a tenant.
 * Used by the Manage Vessels modal to show current bindings.
 */
export async function getVesselProfileMap(tenantId: string): Promise<Record<string, string>> {
  if (isDemoMode()) {
    return readLsAssignments(tenantId);
  }
  const { data } = await supabase
    .from('sms_profile_vessels')
    .select('vessel_id, profile_id, tenant_id!inner(id)')
    .eq('tenant_id', tenantId);
  const map: Record<string, string> = {};
  for (const a of (data as { vessel_id: string; profile_id: string }[] | null) ?? []) {
    map[a.vessel_id] = a.profile_id;
  }
  return map;
}

export async function countApprovedDocsForProfile(tenantId: string, profileId: string | null, sinceISO?: string): Promise<number> {
  if (isDemoMode()) {
    // In demo mode, count approved docs; since param ignored (demo data is static)
    return 0;
  }
  let query = supabase.from('sms_documents').select('id').eq('tenant_id', tenantId).eq('approval_state', 'approved').eq('node_kind', 'document');
  if (profileId) query = query.eq('profile_id', profileId);
  else query = query.is('profile_id', null);
  if (sinceISO) query = query.gt('updated_at', sinceISO);
  const { count } = await query;
  return count ?? 0;
}
