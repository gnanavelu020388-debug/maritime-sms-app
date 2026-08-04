import type { SmsDocRow } from './supabase';
import type { SyncModuleKey } from './syncTypes';

/**
 * Local Master Ship Server (LAN) — simulated vessel-side database.
 *
 * In production this runs on the ship's onboard server at http://192.168.1.X:8080.
 * In the browser we simulate it with IndexedDB-backed storage so that all
 * vessel-side reads (document tree, search index, PDF references) resolve
 * locally with ZERO satellite data usage. The syncService periodically
 * check-ins with Azure Cloud (Supabase) to pull delta patches and refresh
 * this local store.
 *
 * All shipboard workstations share this local server, so only the server
 * itself ever touches the satellite link.
 *
 * The database has two object store categories:
 *   1. `sms_documents` — the existing SMS document cache (top-down deltas)
 *   2. `module_data_<key>` — generic per-module stores for all other modules
 *      (Rest Hours, HACCP/Galley, Electronic Logbooks, etc.). Each module
 *      gets its own object store, created dynamically via the module registry.
 */

const DB_NAME = 'mpc-vessel-local';
const STORE_DOCS = 'sms_documents';
const STORE_META = 'vessel_meta';
const STORE_MODULE_PREFIX = 'module_';
const DB_VERSION = 2;

/** Module keys that have dedicated local stores. SMS uses the legacy store. */
const registeredModules: Set<SyncModuleKey> = new Set();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const store = db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
        store.createIndex('tenant_tree', ['tenant_id', 'tree_kind'], { unique: false });
        store.createIndex('approval', 'approval_state', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      // Create object stores for any registered non-SMS modules
      for (const modKey of registeredModules) {
        const storeName = STORE_MODULE_PREFIX + modKey;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          store.createIndex('tenant_id', 'tenant_id', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Register a module so its local object store is created on next DB open.
 * Call this early in the module's initialization (before any reads/writes).
 * SMS does not need to register — it uses the legacy `sms_documents` store.
 */
export async function registerModuleStore(modKey: SyncModuleKey): Promise<void> {
  if (modKey === 'sms_documentation' || registeredModules.has(modKey)) return;
  registeredModules.add(modKey);
  // Bump the DB version to trigger onupgradeneeded for the new store
  dbPromise = null;
  await openDb();
}

interface MetaRow {
  key: string;
  value: unknown;
}

async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => {
      const row = req.result as MetaRow | undefined;
      resolve(row ? (row.value as T) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value } as MetaRow);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── SMS document cache (legacy + top-down delta target) ────────────────

/** Replace the full cached document set for a tenant (used on initial seed / full resync). */
export async function cacheAllDocuments(tenantId: string, docs: SmsDocRow[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite');
    const store = tx.objectStore(STORE_DOCS);
    store.clear();
    docs.forEach((d) => store.put(d));
    tx.oncomplete = () => {
      void setMeta(`last_full_sync:${tenantId}`, new Date().toISOString());
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Read approved documents for a tenant + tree_kind from the LOCAL cache (no satellite). */
export async function getLocalDocuments(
  tenantId: string,
  treeKind: string,
  onlyApproved = true,
): Promise<SmsDocRow[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readonly');
    const store = tx.objectStore(STORE_DOCS);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as SmsDocRow[]) ?? [];
      const filtered = all.filter(
        (d) =>
          d.tenant_id === tenantId &&
          d.tree_kind === treeKind &&
          (!onlyApproved || d.approval_state === 'approved'),
      );
      filtered.sort((a, b) => a.sort_order - b.sort_order);
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Apply a delta patch to the local cache (upsert + delete). */
export async function applyDeltaToCache(
  tenantId: string,
  delta: { upserted: SmsDocRow[]; deleted: { id: string }[] },
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite');
    const store = tx.objectStore(STORE_DOCS);
    for (const doc of delta.upserted) {
      if (doc.tenant_id === tenantId) store.put(doc);
    }
    for (const del of delta.deleted) {
      store.delete(del.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Generic module data store (for all non-SMS modules) ────────────────

/**
 * Upsert a batch of entities into a module's local store.
 * Each entity must have an `id` field and a `tenant_id` field.
 */
export async function upsertModuleData(
  modKey: SyncModuleKey,
  tenantId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  await registerModuleStore(modKey);
  const db = await openDb();
  const storeName = STORE_MODULE_PREFIX + modKey;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const entry of entries) {
      if (entry.tenant_id === tenantId) {
        store.put(entry);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete entities by ID from a module's local store.
 */
export async function deleteModuleData(
  modKey: SyncModuleKey,
  ids: string[],
): Promise<void> {
  if (modKey === 'sms_documentation' || ids.length === 0) return;
  await registerModuleStore(modKey);
  const db = await openDb();
  const storeName = STORE_MODULE_PREFIX + modKey;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Read all entities for a tenant from a module's local store.
 */
export async function getLocalModuleData(
  modKey: SyncModuleKey,
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  if (modKey === 'sms_documentation') {
    // SMS uses the legacy store; redirect to the typed reader
    return getLocalDocuments(tenantId, 'sms') as unknown as Record<string, unknown>[];
  }
  await registerModuleStore(modKey);
  const db = await openDb();
  const storeName = STORE_MODULE_PREFIX + modKey;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const idx = store.index('tenant_id');
    const req = idx.getAll(tenantId);
    req.onsuccess = () => {
      resolve((req.result as Record<string, unknown>[]) ?? []);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Apply a unified module delta to the local cache (upsert + delete).
 * This is the generic counterpart to applyDeltaToCache — works for any module.
 */
export async function applyModuleDelta(
  modKey: SyncModuleKey,
  tenantId: string,
  delta: { entries: Record<string, unknown>[]; deleted_ids: string[] },
): Promise<void> {
  if (delta.entries.length > 0) {
    await upsertModuleData(modKey, tenantId, delta.entries);
  }
  if (delta.deleted_ids.length > 0) {
    await deleteModuleData(modKey, delta.deleted_ids);
  }
}

// ── Meta / version / sync timestamp helpers ────────────────────────────

export async function getLocalSmsVersion(tenantId: string): Promise<string | null> {
  return getMeta<string>(`sms_version:${tenantId}`);
}

export async function setLocalSmsVersion(tenantId: string, version: string): Promise<void> {
  await setMeta(`sms_version:${tenantId}`, version);
}

export async function isCacheSeeded(tenantId: string): Promise<boolean> {
  const v = await getMeta<string>(`sms_version:${tenantId}`);
  return v !== null;
}

export async function getLastSyncAt(tenantId: string): Promise<string | null> {
  return getMeta<string>(`last_sync:${tenantId}`);
}

export async function setLastSyncAt(tenantId: string, iso: string): Promise<void> {
  await setMeta(`last_sync:${tenantId}`, iso);
}

/** Pending SMS update notification state — set when a new version is downloaded. */
export interface PendingUpdate {
  version: string;
  downloadedAt: string;
  deployedBy: string;
  docCount: number;
}

export async function getPendingUpdate(tenantId: string): Promise<PendingUpdate | null> {
  return getMeta<PendingUpdate>(`pending_update:${tenantId}`);
}

export async function setPendingUpdate(tenantId: string, update: PendingUpdate | null): Promise<void> {
  await setMeta(`pending_update:${tenantId}`, update);
}

/** Cross-tab broadcast: notify all active shipboard browser sessions. */
const UPDATE_CHANNEL = 'mpc-vessel-sms-update';

export function broadcastSmsUpdate(tenantId: string, version: string): void {
  const channel = new BroadcastChannel(UPDATE_CHANNEL);
  channel.postMessage({ tenantId, version, ts: new Date().toISOString() });
  channel.close();
}

export function subscribeSmsUpdates(
  tenantId: string,
  onUpdate: (version: string) => void,
): () => void {
  const channel = new BroadcastChannel(UPDATE_CHANNEL);
  channel.onmessage = (e) => {
    if (e.data?.tenantId === tenantId && e.data?.version) {
      onUpdate(e.data.version);
    }
  };
  return () => channel.close();
}
