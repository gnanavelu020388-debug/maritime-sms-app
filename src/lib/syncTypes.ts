/**
 * Unified Sync Engine — Common Data Contract.
 *
 * Every platform module (SMS, Rest Hours, HACCP/Galley, Electronic Logbooks,
 * etc.) uses these shared types to enqueue data into the vessel_sync_outbox
 * and receive top-down delta packages. No module needs its own sync engine
 * or network pipeline — all replication flows through this single contract.
 */

import type { SmsDocRow } from './supabase';
import type { ModuleKey } from './featureFlags';

/** All modules that participate in the unified sync pipeline. */
export type SyncModuleKey = ModuleKey;

/** Operation type for an outbox entry. */
export type SyncOperation = 'upsert' | 'delete' | 'batch_upsert';

/** Status of an outbox entry through the sync lifecycle. */
export type SyncEntryStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/**
 * A single entry in the vessel_sync_outbox queue.
 * The `payload` jsonb holds the complete entity data — the sync engine
 * does not need to know the schema of each module's data to transport it.
 */
export interface SyncOutboxEntry {
  id: string;
  tenant_id: string;
  vessel_id: string;
  module_key: SyncModuleKey;
  operation: SyncOperation;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  status: SyncEntryStatus;
  attempts: number;
  last_error: string | null;
  priority: number;
  created_at: string;
  synced_at: string | null;
}

/**
 * Centralized per-vessel sync/connectivity state.
 * The Super Admin panel reads this to display fleet-wide sync status.
 */
export interface VesselSyncStateRow {
  id: string;
  tenant_id: string;
  vessel_id: string;
  connection_mode: 'VESSEL_SERVER_LAN' | 'CLOUD_DIRECT';
  server_reachable: boolean;
  last_heartbeat_at: string | null;
  last_sync_at: string | null;
  pending_outbox_count: number;
  failed_outbox_count: number;
  active_module_keys: string[];
  total_payloads_synced: number;
  total_bytes_synced: number;
  updated_at: string;
}

/**
 * Module-agnostic delta payload for top-down pushes (DPA → vessel).
 * Each module contributes its own entry; the sync engine applies them all
 * in a single atomic transaction. SMS documents use `documents` while
 * future modules add their own field (e.g. `rest_hours_logs`, `galley_requisitions`).
 */
export interface UnifiedDeltaPayload {
  from_version: string;
  to_version: string;
  modules: Record<SyncModuleKey, ModuleDelta>;
}

/**
 * Per-module delta within a unified payload.
 * `entries` is an array of raw JSON objects — the sync engine doesn't
 * interpret them; it just writes them to the local module store.
 */
export interface ModuleDelta {
  operation: SyncOperation;
  entries: Record<string, unknown>[];
  deleted_ids: string[];
}

/** Result of a single sync check-in, summarizing all modules. */
export interface UnifiedSyncResult {
  applied: boolean;
  modulesProcessed: SyncModuleKey[];
  fromVersion: string | null;
  toVersion: string | null;
  outboxDrained: number;
  error: string | null;
}

/**
 * Helper for modules to create a properly-typed outbox entry.
 * Any module in the platform can call this to enqueue data for shore replication
 * without knowing the details of the sync pipeline.
 */
export function createOutboxEntry(
  tenantId: string,
  vesselId: string,
  moduleKey: SyncModuleKey,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  operation: SyncOperation = 'upsert',
  priority = 0,
): Omit<SyncOutboxEntry, 'id' | 'created_at' | 'synced_at' | 'status' | 'attempts' | 'last_error'> {
  return {
    tenant_id: tenantId,
    vessel_id: vesselId,
    module_key: moduleKey,
    operation,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    priority,
  };
}

/**
 * Convert an array of SmsDocRow into the module delta format for SMS.
 * This bridges the existing SMS delta packager into the unified payload contract.
 */
export function smsDocsToModuleDelta(docs: SmsDocRow[], deletedIds: string[] = []): ModuleDelta {
  return {
    operation: 'batch_upsert',
    entries: docs as unknown as Record<string, unknown>[],
    deleted_ids: deletedIds,
  };
}
