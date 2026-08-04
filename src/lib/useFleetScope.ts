import { useMemo } from 'react';
import { useAuth } from './auth';
import type { VesselRow } from './supabase';
import type { SmsProfileWithVessels } from './smsProfiles';
import { isDemoMode, getEffectiveDemoVessels } from './demoData';

export interface FleetScopeState {
  scope: 'global' | 'specific';
  assignedVesselIds: string[];
  assignedFleetProfileIds: string[];
  isGlobal: boolean;
  isRestricted: boolean;
  filterVessels: <T extends { id: string }>(vessels: T[]) => T[];
  filterProfiles: <T extends SmsProfileWithVessels>(profiles: T[]) => T[];
  canAccessVessel: (vesselId: string) => boolean;
  canAccessProfile: (profileId: string) => boolean;
}

export function useFleetScope(): FleetScopeState {
  const { tenantUser } = useAuth();

  const scope = tenantUser?.fleet_scope ?? 'global';
  const assignedVesselIds = tenantUser?.assigned_vessel_ids ?? [];
  const assignedFleetProfileIds = tenantUser?.assigned_fleet_profile_ids ?? [];
  const isGlobal = scope === 'global';
  const isRestricted = !isGlobal && assignedVesselIds.length > 0;

  const filterVessels = useMemo(() => {
    return <T extends { id: string }>(vessels: T[]): T[] => {
      if (isGlobal) return vessels;
      const allowed = new Set(assignedVesselIds);
      return vessels.filter((v) => allowed.has(v.id));
    };
  }, [isGlobal, assignedVesselIds.join(',')]);

  const filterProfiles = useMemo(() => {
    return <T extends SmsProfileWithVessels>(profiles: T[]): T[] => {
      if (isGlobal) return profiles;
      const allowedVessels = new Set(assignedVesselIds);
      const allowedProfiles = new Set(assignedFleetProfileIds);
      return profiles.filter((p) => {
        if (allowedProfiles.has(p.id)) return true;
        if (p.vesselIds.length > 0 && p.vesselIds.some((vid) => allowedVessels.has(vid))) return true;
        return false;
      });
    };
  }, [isGlobal, assignedVesselIds.join(','), assignedFleetProfileIds.join(',')]);

  const canAccessVessel = useMemo(() => {
    const allowed = new Set(assignedVesselIds);
    return (vesselId: string) => isGlobal || allowed.has(vesselId);
  }, [isGlobal, assignedVesselIds.join(',')]);

  const canAccessProfile = useMemo(() => {
    const allowedProfiles = new Set(assignedFleetProfileIds);
    const allowedVessels = new Set(assignedVesselIds);
    return (profileId: string) => isGlobal || allowedProfiles.has(profileId) || allowedVessels.size === 0;
  }, [isGlobal, assignedFleetProfileIds.join(','), assignedVesselIds.join(',')]);

  return {
    scope,
    assignedVesselIds,
    assignedFleetProfileIds,
    isGlobal,
    isRestricted,
    filterVessels,
    filterProfiles,
    canAccessVessel,
    canAccessProfile,
  };
}

export function useScopedVessels(allVessels: VesselRow[]): VesselRow[] {
  const { filterVessels } = useFleetScope();
  return filterVessels(allVessels);
}

export function getDemoScopedVessels(tenantId: string, assignedVesselIds: string[], isGlobal: boolean): VesselRow[] {
  if (isGlobal) return getEffectiveDemoVessels(tenantId);
  const allowed = new Set(assignedVesselIds);
  return getEffectiveDemoVessels(tenantId).filter((v) => allowed.has(v.id));
}

export { isDemoMode };
