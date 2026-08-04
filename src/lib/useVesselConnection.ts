import { useEffect, useState } from 'react';
import {
  startConnectionMonitor,
  subscribeToConnectionState,
  type VesselConnectionState,
} from '../lib/vesselConnection';
import { getSyncStatus } from './syncService';

/**
 * Vessel connection orchestrator hook.
 *
 * Wires up:
 *  1. The connection-mode heartbeat monitor (LAN → Cloud Direct failover).
 *  2. The PWA service worker for offline SMS document caching.
 *  3. Live sync status (last sync time, local SMS version, pending items).
 */
export function useVesselConnection(tenantId: string | undefined) {
  const [conn, setConn] = useState<VesselConnectionState | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<string | null>(null);

  // Start the heartbeat monitor + subscribe to connection state changes
  useEffect(() => {
    if (!tenantId) return;
    const stopMonitor = startConnectionMonitor();
    const unsubConn = subscribeToConnectionState(setConn);

    // Load initial sync status
    getSyncStatus(tenantId).then((s) => {
      setLastSyncAt(s.lastSyncAt);
      setLocalVersion(s.localVersion);
    });

    return () => {
      stopMonitor();
      unsubConn();
    };
  }, [tenantId]);

  // Register the PWA service worker for offline SMS caching
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/vessel-sw.js').catch(() => {
      // SW registration failure is non-fatal — app still works online
    });
  }, []);

  return {
    conn,
    lastSyncAt,
    localVersion,
  };
}
