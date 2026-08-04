import { supabase, type SmsDocRow } from './supabase';
import {
  getLocalSmsVersion,
  setLocalSmsVersion,
  getLocalDocuments,
  cacheAllDocuments,
  applyDeltaToCache,
  isCacheSeeded,
  setLastSyncAt,
  getLastSyncAt,
  setPendingUpdate,
  broadcastSmsUpdate,
  type PendingUpdate,
} from './localVesselDb';
import { fetchEnabledFeatures } from './featureFlags';
import { isDemoMode } from './demoData';
import type {
  SyncModuleKey,
  SyncOutboxEntry,
  UnifiedSyncResult,
} from './syncTypes';

/**
 * Unified Satellite Sync Service — vessel-side background worker.
 *
 * This is the SINGLE common sync pipeline for all platform modules.
 * New modules (Rest Hours, HACCP/Galley, Electronic Logbooks, etc.) hook
 * into this engine by writing entries to vessel_sync_outbox — they do NOT
 * create their own sync loops or network code.
 *
 * The pipeline has two directions:
 *
 *  1. TOP-DOWN (DPA → vessel): SMS delta packages and other top-down
 *     pushes are downloaded and applied atomically via the existing
 *     sms_delta_packages table. Future modules can add their own
 *     top-down delta tables and hook into the same check-in cycle.
 *
 *  2. BOTTOM-UP (vessel → shore): The vessel_sync_outbox queue is drained
 *     on each check-in. Entries for modules DISABLED in tenant_feature_flags
 *     are skipped — only enabled modules sync.
 *
 * Top-Down SMS Version Collision Guard for offline ships:
 *
 *  When a vessel server goes offline and reconnects after multiple DPA
 *  updates have been pushed, it:
 *    1. Atomic Version Swap: downloads the latest delta as a single atomic
 *       package and applies it in one IDB transaction — never piecemeal.
 *    2. Version Vector Pinning: compares local version vs cloud baseline
 *       using semver ordering (not string equality). If local < cloud,
 *       it applies the latest DPA-approved baseline.
 *
 * If satellite connectivity is lost, the local server continues serving
 * cached SMS files seamlessly — all reads go through the local DB and
 * check-ins simply fail silently without throwing.
 */

/** Default check-in cadence (1 minute for lightweight delta polling). The actual vessel auto-sync interval is configurable per-tenant via the Super Admin panel; see fetchSyncConfig in featureFlags.ts. */
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

export interface SyncResult {
  applied: boolean;
  fromVersion: string | null;
  toVersion: string | null;
  error: string | null;
}

interface DeltaRow {
  id: string;
  tenant_id: string;
  from_version: string;
  to_version: string;
  delta_payload: {
    upserted: SmsDocRow[];
    deleted: { id: string; tree_kind: string }[];
  };
  deployed_by: string;
  created_at: string;
}

/** Parse a semver string "3.2.1" → [3, 2, 1]. Returns [0,0,0] on parse failure. */
function parseSemver(v: string): number[] {
  const parts = v.replace(/^v/, '').split('.').map((p) => parseInt(p, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns true if `a` is strictly greater than `b` in semver ordering. */
function semverGreaterThan(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

/**
 * Seed the local cache from the cloud on first login.
 * This is the only operation that transfers the full document set —
 * subsequent syncs use lightweight deltas only.
 */
export async function seedLocalCache(tenantId: string): Promise<void> {
  if (await isCacheSeeded(tenantId)) return;
  const { data, error } = await supabase
    .from('sms_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('approval_state', 'approved')
    .order('sort_order');

  if (error) throw new Error(`Seed failed: ${error.message}`);
  const docs = (data as SmsDocRow[]) ?? [];
  await cacheAllDocuments(tenantId, docs);

  const { data: tenant } = await supabase
    .from('tenants')
    .select('sms_version')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenant?.sms_version) {
    await setLocalSmsVersion(tenantId, tenant.sms_version);
  }
}

// ── BOTTOM-UP: Outbox drain (vessel → shore) ──────────────────────────

/**
 * Drain pending entries from the vessel_sync_outbox queue.
 *
 * This is the unified bottom-up replication path for ALL modules. Each
 * module writes outbox entries; this function drains them to shore.
 * Entries for modules DISABLED in tenant_feature_flags are skipped —
 * only enabled modules sync through this pipeline.
 *
 * Returns the number of entries successfully drained.
 */
export async function drainSyncOutbox(
  tenantId: string,
  vesselId: string | undefined,
): Promise<number> {
  if (isDemoMode()) return 0;
  if (!vesselId) return 0;

  // Fetch enabled feature flags for this tenant to gate outbox entries
  const enabledModules = await fetchEnabledFeatures(tenantId);
  const enabledModuleArray = Array.from(enabledModules);

  if (enabledModuleArray.length === 0) return 0;

  // Query pending outbox entries, filtered to enabled modules only
  const { data: pendingEntries, error } = await supabase
    .from('vessel_sync_outbox')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('vessel_id', vesselId)
    .eq('status', 'pending')
    .in('module_key', enabledModuleArray)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(100);

  if (error || !pendingEntries) return 0;

  const entries = pendingEntries as unknown as SyncOutboxEntry[];
  if (entries.length === 0) return 0;

  // Mark entries as 'syncing'
  const entryIds = entries.map((e) => e.id);
  await supabase
    .from('vessel_sync_outbox')
    .update({ status: 'syncing' })
    .in('id', entryIds);

  // Process each entry — in a real deployment, this transmits over satellite.
  // Here we mark them as synced (the payload is already in the database).
  let drained = 0;
  for (const entry of entries) {
    const { error: updateError } = await supabase
      .from('vessel_sync_outbox')
      .update({
        status: 'synced',
        synced_at: new Date().toISOString(),
        attempts: entry.attempts + 1,
      })
      .eq('id', entry.id);

    if (!updateError) {
      drained++;
    } else {
      // Mark as failed with error message
      await supabase
        .from('vessel_sync_outbox')
        .update({
          status: 'failed',
          attempts: entry.attempts + 1,
          last_error: updateError.message,
        })
        .eq('id', entry.id);
    }
  }

  return drained;
}

/**
 * Update the centralized vessel_sync_state row after a check-in.
 * This is what the Super Admin panel reads for fleet-wide sync status.
 */
async function updateVesselSyncState(
  tenantId: string,
  vesselId: string | undefined,
  lastSyncAt: string,
  outboxDrained: number,
): Promise<void> {
  if (!vesselId) return;

  // Count remaining pending/failed outbox entries across ALL modules
  const { count: pendingCount } = await supabase
    .from('vessel_sync_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('vessel_id', vesselId)
    .eq('status', 'pending');

  const { count: failedCount } = await supabase
    .from('vessel_sync_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('vessel_id', vesselId)
    .eq('status', 'failed');

  // Upsert the sync state row
  await supabase
    .from('vessel_sync_state')
    .upsert({
      tenant_id: tenantId,
      vessel_id: vesselId,
      last_sync_at: lastSyncAt,
      pending_outbox_count: pendingCount ?? 0,
      failed_outbox_count: failedCount ?? 0,
      server_reachable: true,
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vessel_id' });
}

/**
 * Perform a single unified satellite check-in.
 *
 * This is the SINGLE entry point for all sync activity. It handles:
 *   1. Bottom-up: drains the vessel_sync_outbox queue (gated by feature flags)
 *   2. Top-down: applies SMS delta packages (version collision guard)
 *   3. State: updates the centralized vessel_sync_state row
 *
 * Returns the result so the caller can update UI state.
 * Never throws — on network failure, returns { applied: false, error }.
 */
export async function performSyncCheckIn(
  tenantId: string,
  vesselId?: string,
): Promise<SyncResult> {
  const localVersion = await getLocalSmsVersion(tenantId);

  if (!localVersion) {
    try {
      await seedLocalCache(tenantId);
      const seededVersion = await getLocalSmsVersion(tenantId);
      // Drain outbox on first seed too
      await drainSyncOutbox(tenantId, vesselId);
      await updateVesselSyncState(tenantId, vesselId, new Date().toISOString(), 0);
      return { applied: true, fromVersion: null, toVersion: seededVersion, error: null };
    } catch (err) {
      return { applied: false, fromVersion: null, toVersion: null, error: (err as Error).message };
    }
  }

  // ── Bottom-up: drain outbox queue (gated by feature flags) ──
  const outboxDrained = await drainSyncOutbox(tenantId, vesselId);

  // ── Top-down: SMS delta packages ──
  const { data, error } = await supabase
    .from('sms_delta_packages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return { applied: false, fromVersion: localVersion, toVersion: localVersion, error: error.message };
  }

  const deltas = (data as DeltaRow[]) ?? [];

  // Version Vector Pinning: find the latest delta whose to_version > localVersion.
  // Among all deltas newer than local, pick the one with the highest to_version
  // (so an offline ship that missed multiple pushes jumps straight to the latest).
  let targetDelta: DeltaRow | null = null;
  for (const d of deltas) {
    if (semverGreaterThan(d.to_version, localVersion)) {
      if (!targetDelta || semverGreaterThan(d.to_version, targetDelta.to_version)) {
        targetDelta = d;
      }
    }
  }

  let appliedVersion = false;
  let resultVersion = localVersion;

  if (targetDelta) {
    // Atomic Version Swap: apply the entire delta in a single IDB transaction.
    // The delta_payload contains the full approved document set for this version,
    // so applying it atomically replaces the local baseline — no partial state.
    const payload = targetDelta.delta_payload;
    if (payload?.upserted) {
      await applyDeltaToCache(tenantId, {
        upserted: payload.upserted,
        deleted: payload.deleted ?? [],
      });
    }

    // Only update the local version after the atomic apply succeeds
    await setLocalSmsVersion(tenantId, targetDelta.to_version);
    resultVersion = targetDelta.to_version;
    appliedVersion = true;

    // Active Lock Guard: set pending update notification for all shipboard sessions
    const pending: PendingUpdate = {
      version: targetDelta.to_version,
      downloadedAt: new Date().toISOString(),
      deployedBy: targetDelta.deployed_by,
      docCount: payload?.upserted?.length ?? 0,
    };
    await setPendingUpdate(tenantId, pending);

    // Broadcast to all active browser tabs on this vessel workstation
    broadcastSmsUpdate(tenantId, targetDelta.to_version);
  }

  const syncTime = new Date().toISOString();
  await setLastSyncAt(tenantId, syncTime);

  // Update centralized sync state (read by Super Admin panel)
  await updateVesselSyncState(tenantId, vesselId, syncTime, outboxDrained);

  return {
    applied: appliedVersion,
    fromVersion: appliedVersion ? targetDelta!.from_version : localVersion,
    toVersion: resultVersion,
    error: null,
  };
}

/**
 * Start the background sync loop for a vessel session.
 * Returns a cleanup function that stops the interval.
 * The loop catches all errors silently — the local server must keep
 * serving cached SMS files even if satellite is down.
 */
export function startSyncLoop(
  tenantId: string,
  onSync?: (result: SyncResult) => void,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  vesselId?: string,
): () => void {
  // Clamp to sane bounds: minimum 10s, maximum 30min
  const safeInterval = Math.min(Math.max(intervalMs, 10_000), 1_800_000);

  const initialTimeout = setTimeout(() => {
    performSyncCheckIn(tenantId, vesselId)
      .then((result) => onSync?.(result))
      .catch(() => { /* satellite down — local server continues serving */ });
  }, 3000);

  const interval = setInterval(() => {
    performSyncCheckIn(tenantId, vesselId)
      .then((result) => onSync?.(result))
      .catch(() => { /* satellite down — local server continues serving */ });
  }, safeInterval);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}

/**
 * Manual replication trigger — calls performSyncCheckIn which drains ALL
 * pending module outbox queues simultaneously AND applies top-down deltas.
 *
 * This is the shore-replication function invoked by the "Replicate to Shore Now"
 * button on the Master/Chief Engineer vessel dashboard. It acts as a GLOBAL
 * push for all pending vessel module queues — not just SMS.
 */
export async function replicateToShoreNow(
  tenantId: string,
  vesselId?: string,
): Promise<SyncResult> {
  return performSyncCheckIn(tenantId, vesselId);
}

export async function getSyncStatus(tenantId: string): Promise<{
  localVersion: string | null;
  lastSyncAt: string | null;
}> {
  const [localVersion, lastSyncAt] = await Promise.all([
    getLocalSmsVersion(tenantId),
    getLastSyncAt(tenantId),
  ]);
  return { localVersion, lastSyncAt };
}

/** Re-export for convenience — check if local cache has documents. */
export async function hasLocalDocs(tenantId: string, treeKind: string): Promise<boolean> {
  const docs = await getLocalDocuments(tenantId, treeKind);
  return docs.length > 0;
}

/**
 * Enqueue a payload entry into the unified sync outbox.
 *
 * This is the SINGLE API that all modules use to queue data for shore
 * replication. New modules call this with their module_key and payload —
 * the sync engine handles the rest (feature flag gating, retry, state update).
 */
export async function enqueueSyncEntry(
  tenantId: string,
  vesselId: string,
  moduleKey: SyncModuleKey,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  operation: 'upsert' | 'delete' | 'batch_upsert' = 'upsert',
  priority = 0,
): Promise<boolean> {
  if (isDemoMode()) return true;

  const { error } = await supabase.from('vessel_sync_outbox').insert({
    tenant_id: tenantId,
    vessel_id: vesselId,
    module_key: moduleKey,
    operation,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    status: 'pending',
    priority,
  });

  return !error;
}

/**
 * Fetch the centralized sync state for a vessel.
 * Used by the Super Admin panel and the vessel connection pill.
 */
export async function getVesselSyncState(
  tenantId: string,
  vesselId: string,
): Promise<{
  pendingOutbox: number;
  failedOutbox: number;
  lastSyncAt: string | null;
  connectionMode: string;
} | null> {
  if (isDemoMode()) {
    return {
      pendingOutbox: 0,
      failedOutbox: 0,
      lastSyncAt: null,
      connectionMode: 'VESSEL_SERVER_LAN',
    };
  }

  const { data, error } = await supabase
    .from('vessel_sync_state')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('vessel_id', vesselId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    pending_outbox_count: number;
    failed_outbox_count: number;
    last_sync_at: string | null;
    connection_mode: string;
  };

  return {
    pendingOutbox: row.pending_outbox_count,
    failedOutbox: row.failed_outbox_count,
    lastSyncAt: row.last_sync_at,
    connectionMode: row.connection_mode,
  };
}
