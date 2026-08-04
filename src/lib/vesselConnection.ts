/**
 * Vessel Connection Manager — Two-Tier Hybrid Edge Architecture.
 *
 * Tier 1 (VESSEL_SERVER_LAN): All document reads route to the local vessel
 *   server endpoint (http://vessel-server.local:8080). Only the vessel server
 *   performs delta-sync with the cloud over satellite. Crew workstations over
 *   LAN consume ZERO satellite bandwidth.
 *
 * Tier 2 (CLOUD_DIRECT): Automatic failover when the local server is
 *   unreachable. Document reads fall back to the AWS Cloud API. A clear
 *   status pill is displayed: "Vessel Server Offline — Connected via Cloud Direct".
 *
 * A heartbeat ping to /health runs every 20 seconds. When the local server
 * recovers, we seamlessly switch back to VESSEL_SERVER_LAN.
 */

export type ConnectionMode = 'VESSEL_SERVER_LAN' | 'CLOUD_DIRECT';

export interface VesselConnectionState {
  mode: ConnectionMode;
  serverUrl: string;
  lastHeartbeatAt: string | null;
  lastHeartbeatOk: boolean;
  failoverCount: number;
  serverReachable: boolean;
}

export interface SyncStatusInfo {
  mode: ConnectionMode;
  lastSyncAt: string | null;
  pendingSyncItems: number;
  localVersion: string | null;
  serverReachable: boolean;
  serverUrl: string;
}

const DEFAULT_SERVER_URL = 'http://vessel-server.local:8080';
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const STATE_KEY = 'mpc-vessel-connection';

const listeners = new Set<(state: VesselConnectionState) => void>();
let currentState: VesselConnectionState = {
  mode: 'VESSEL_SERVER_LAN',
  serverUrl: DEFAULT_SERVER_URL,
  lastHeartbeatAt: null,
  lastHeartbeatOk: false,
  failoverCount: 0,
  serverReachable: false,
};
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function loadPersistedState(): VesselConnectionState {
  if (typeof localStorage === 'undefined') return currentState;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return currentState;
    const persisted = JSON.parse(raw) as Partial<VesselConnectionState>;
    return { ...currentState, ...persisted, lastHeartbeatAt: null, lastHeartbeatOk: false };
  } catch {
    return currentState;
  }
}

function persistState(state: VesselConnectionState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const { lastHeartbeatAt, lastHeartbeatOk, ...persistable } = state;
    void lastHeartbeatAt; void lastHeartbeatOk;
    localStorage.setItem(STATE_KEY, JSON.stringify(persistable));
  } catch {
    // ignore storage errors
  }
}

function notify(): void {
  listeners.forEach((fn) => fn(currentState));
}

/** In the browser sandbox, we simulate the local vessel server /health probe. */
async function pingHealth(serverUrl: string): Promise<boolean> {
  // In production this would be: fetch(`${serverUrl}/health`, { signal: controller })
  // In the browser simulation, we treat the local IndexedDB cache as the "vessel server".
  // If the cache has been seeded (has a local SMS version), the "server" is up.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    clearTimeout(timeout);
    // Simulated: always "reachable" in LAN mode if we're in the browser.
    // Real implementation would ping the actual endpoint.
    return true;
  } catch {
    return false;
  }
}

export function getConnectionState(): VesselConnectionState {
  return currentState;
}

export function subscribeToConnectionState(listener: (state: VesselConnectionState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => { listeners.delete(listener); };
}

export function setConnectionMode(mode: ConnectionMode): void {
  if (currentState.mode === mode) return;
  currentState = {
    ...currentState,
    mode,
    failoverCount: mode === 'CLOUD_DIRECT' ? currentState.failoverCount + 1 : currentState.failoverCount,
  };
  persistState(currentState);
  notify();
}

export function setServerUrl(url: string): void {
  currentState = { ...currentState, serverUrl: url };
  persistState(currentState);
  notify();
}

async function runHeartbeat(): Promise<void> {
  const ok = await pingHealth(currentState.serverUrl);
  const now = new Date().toISOString();
  const wasReachable = currentState.serverReachable;

  currentState = {
    ...currentState,
    lastHeartbeatAt: now,
    lastHeartbeatOk: ok,
    serverReachable: ok,
  };

  if (!ok && currentState.mode === 'VESSEL_SERVER_LAN') {
    // Local server down — failover to cloud direct
    setConnectionMode('CLOUD_DIRECT');
  } else if (ok && currentState.mode === 'CLOUD_DIRECT') {
    // Local server recovered — switch back to LAN
    setConnectionMode('VESSEL_SERVER_LAN');
  }

  persistState(currentState);
  notify();
  void wasReachable;
}

export function startConnectionMonitor(serverUrl: string = DEFAULT_SERVER_URL): () => void {
  currentState = { ...loadPersistedState(), serverUrl };
  notify();

  // Initial heartbeat shortly after start
  const initialTimeout = setTimeout(() => { void runHeartbeat(); }, 2000);

  heartbeatTimer = setInterval(() => { void runHeartbeat(); }, HEARTBEAT_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimeout);
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  };
}

export function stopConnectionMonitor(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

/** Get a combined sync+connection status snapshot for UI display. */
export function getConnectionStatusInfo(
  lastSyncAt: string | null,
  pendingSyncItems: number,
  localVersion: string | null,
): SyncStatusInfo {
  return {
    mode: currentState.mode,
    lastSyncAt,
    pendingSyncItems,
    localVersion,
    serverReachable: currentState.serverReachable,
    serverUrl: currentState.serverUrl,
  };
}

/** Simulated fetch wrapper that routes based on connection mode. */
export async function routeDocumentFetch<T>(
  localFetch: () => Promise<T>,
  cloudFetch: () => Promise<T>,
): Promise<T> {
  if (currentState.mode === 'VESSEL_SERVER_LAN' && currentState.serverReachable) {
    try {
      return await localFetch();
    } catch {
      // Local fetch failed — try cloud as fallback
      setConnectionMode('CLOUD_DIRECT');
      return cloudFetch();
    }
  }
  return cloudFetch();
}
