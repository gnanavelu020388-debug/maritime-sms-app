import { supabase } from './supabase';
import { bumpVersion, buildAndStoreDelta } from './deltaPackager';
import {
  isDemoMode,
  getDemoTenant,
  demoUpdateTenantSmsVersion,
} from './demoData';
import { postSyncEvent } from './syncChannel';

/**
 * Shared baseline deployment — called by DPA "Approve & Push to Fleet" actions.
 *
 * 1. Bumps the fleet SMS version (e.g. v3.2.1 → v3.2.2)
 * 2. Builds and persists a delta package (cloud mode) or records the version (demo mode)
 * 3. Broadcasts SMS_UPDATED so vessel sync loops pick up the new baseline
 *
 * Returns the new version string, or null on failure.
 */
export async function deployBaseline(
  tenantId: string,
  deployedByEmail: string,
): Promise<string | null> {
  if (isDemoMode()) {
    const tenant = getDemoTenant(tenantId);
    const newVersion = bumpVersion(tenant.sms_version);
    demoUpdateTenantSmsVersion(tenantId, newVersion);
    postSyncEvent({
      type: 'SMS_UPDATED',
      tenantId,
      payload: { action: 'baseline_deployed', version: newVersion },
    });
    return newVersion;
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('sms_version')
    .eq('id', tenantId)
    .maybeSingle();

  const currentVersion = (tenant as { sms_version: string } | null)?.sms_version ?? '1.0.0';
  const newVersion = bumpVersion(currentVersion);

  await supabase
    .from('tenants')
    .update({ sms_version: newVersion, updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  const delta = await buildAndStoreDelta(tenantId, currentVersion, newVersion, deployedByEmail);
  if (!delta) return null;

  postSyncEvent({
    type: 'SMS_UPDATED',
    tenantId,
    payload: { action: 'baseline_deployed', version: newVersion },
  });

  return newVersion;
}
