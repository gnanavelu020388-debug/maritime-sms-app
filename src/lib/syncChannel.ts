/**
 * Cross-window BroadcastChannel for real-time state sync.
 *
 * All three platform windows (Super Admin, Company Admin, Vessel Portal)
 * listen on this channel so that state changes in one tab immediately
 * propagate to every other open tab — no manual page refresh required.
 */

const CHANNEL_NAME = 'maritime_platform_sync';
const BANNER_LS_KEY = 'mpc-maintenance-banner';

export type SyncEventType =
  | 'SMS_UPDATED'
  | 'CREW_UPDATED'
  | 'VESSELS_UPDATED'
  | 'AUDIT_LOGGED'
  | 'PROFILES_UPDATED'
  | 'BANNER_PUBLISHED'
  | 'BANNER_CLEARED'
  | 'FEATURE_FLAGS_CHANGED';

export interface SyncEvent {
  type: SyncEventType;
  tenantId: string | null;
  payload: unknown;
}

export interface BannerPayload {
  message: string;
  severity: 'info' | 'warning' | 'critical';
  publishedAt: string;
  publishedBy: string;
}

type Listener = (event: SyncEvent) => void;

let channel: BroadcastChannel | null = null;
let listeners: Set<Listener> = new Set();

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => {
      const data = e.data as SyncEvent;
      if (data && data.type) {
        listeners.forEach((fn) => fn(data));
      }
    };
  }
  return channel;
}

/** Broadcast a sync event to all other open tabs/windows. */
export function postSyncEvent(event: SyncEvent): void {
  const ch = getChannel();
  if (!ch) return;
  ch.postMessage(event);
}

/** Subscribe to incoming sync events from other tabs. Returns an unsubscribe function. */
export function onSyncEvent(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- Maintenance banner persistence (shared across all tabs) ----

/** Read the persisted banner from localStorage so all windows start in sync. */
export function readPersistedBanner(): BannerPayload | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BANNER_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BannerPayload;
  } catch {
    return null;
  }
}

/** Persist (or clear) the banner so newly-opened tabs pick it up immediately. */
export function writePersistedBanner(banner: BannerPayload | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (banner) {
      localStorage.setItem(BANNER_LS_KEY, JSON.stringify(banner));
    } else {
      localStorage.removeItem(BANNER_LS_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

/** Publish a maintenance banner: persist + broadcast to all tabs. */
export function publishBanner(banner: BannerPayload): void {
  writePersistedBanner(banner);
  postSyncEvent({ type: 'BANNER_PUBLISHED', tenantId: null, payload: banner });
}

/** Clear the maintenance banner: persist removal + broadcast to all tabs. */
export function clearBanner(): void {
  writePersistedBanner(null);
  postSyncEvent({ type: 'BANNER_CLEARED', tenantId: null, payload: null });
}

/** Broadcast that a tenant's feature flags changed so other windows (Company Admin,
 * Vessel Portal) re-fetch and update their module visibility in real time. */
export function publishFeatureFlagsChanged(tenantId: string): void {
  postSyncEvent({ type: 'FEATURE_FLAGS_CHANGED', tenantId, payload: { tenantId } });
}
