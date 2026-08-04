import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Cloud, Server, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import {
  subscribeToConnectionState,
  type VesselConnectionState,
} from '../lib/vesselConnection';
import { relativeTime } from '../constants';

/**
 * Vessel Sync Status indicator pill.
 *
 * Shows in the DPA and Vessel headers:
 *  - Last Synced Timestamp (relative, live-updating — "Just now" → "5m ago")
 *  - Pending Sync Items
 *  - Connection Pathway (Local LAN vs Cloud Direct)
 */
export function VesselSyncStatusPill({
  lastSyncAt,
  pendingSyncItems = 0,
  localVersion,
}: {
  lastSyncAt: string | null;
  pendingSyncItems?: number;
  localVersion?: string | null;
}) {
  const [conn, setConn] = useState<VesselConnectionState | null>(null);
  // Re-render every 15s so the relative timestamp ("Just now" → "5m ago") stays live.
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeToConnectionState(setConn);
    return unsub;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  if (!conn) return null;

  const isLan = conn.mode === 'VESSEL_SERVER_LAN';
  const isCloud = conn.mode === 'CLOUD_DIRECT';
  const syncLabel = lastSyncAt ? relativeTime(lastSyncAt) : 'never';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1 dark:border-ink-700 dark:bg-ink-800">
      {/* Connection pathway */}
      <div className="flex items-center gap-1">
        {isLan ? (
          <Server className="h-3 w-3 shrink-0 text-success-500" />
        ) : (
          <Cloud className="h-3 w-3 shrink-0 text-warning-500" />
        )}
        <span className={`text-[10px] font-bold ${isLan ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
          {isLan ? 'Local LAN' : 'Cloud Direct'}
        </span>
        {isCloud && (
          <span
            className="rounded bg-warning-100 px-1 py-0.5 text-[8px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400"
            title="Vessel Server Offline — Connected via Cloud Direct"
          >
            <AlertTriangle className="h-2 w-2" />
          </span>
        )}
      </div>

      <span className="h-3.5 w-px shrink-0 bg-ink-200 dark:bg-ink-700" />

      {/* Last sync + pending + version */}
      <div className="flex items-center gap-1.5 text-[9px] text-ink-400 dark:text-ink-500">
        <Clock className="h-2.5 w-2.5" />
        <span className="capitalize" title={lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleString()}` : 'Never synced'}>
          {syncLabel}
        </span>
        {pendingSyncItems > 0 && (
          <span className="flex items-center gap-0.5 font-semibold text-warning-500" title="Pending sync items">
            <RefreshCw className="h-2.5 w-2.5 animate-spin-slow" />
            {pendingSyncItems}
          </span>
        )}
        {localVersion && <span className="font-mono">v{localVersion}</span>}
      </div>

      <span className="h-3.5 w-px shrink-0 bg-ink-200 dark:bg-ink-700" />

      {/* Heartbeat + LAN status */}
      <div className="flex items-center gap-1">
        <span
          className={`h-1.5 w-1.5 rounded-full ${conn.serverReachable ? 'bg-success-500 animate-pulse-soft' : 'bg-danger-500'}`}
          title={conn.serverReachable ? 'Vessel server reachable' : 'Vessel server unreachable'}
        />
        <span className="flex items-center gap-0.5 text-[8px] uppercase tracking-wide text-ink-400 dark:text-ink-500">
          {isLan ? <Wifi className="h-2 w-2" /> : <WifiOff className="h-2 w-2" />}
          {isLan ? 'LAN OK' : 'LAN Down'}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact inline variant for tighter header layouts (DPA shell).
 */
export function VesselSyncStatusCompact({
  lastSyncAt,
  pendingSyncItems = 0,
  localVersion,
}: {
  lastSyncAt: string | null;
  pendingSyncItems?: number;
  localVersion?: string | null;
}) {
  const [conn, setConn] = useState<VesselConnectionState | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeToConnectionState(setConn);
    return unsub;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  if (!conn) return null;

  const isLan = conn.mode === 'VESSEL_SERVER_LAN';
  const syncLabel = lastSyncAt ? relativeTime(lastSyncAt) : 'not synced';

  return (
    <div className="flex min-w-[170px] items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 dark:border-ink-700 dark:bg-ink-800" title={isLan ? 'Vessel Server LAN — primary route' : 'Vessel Server Offline — Connected via Cloud Direct'}>
      {isLan ? (
        <Server className="h-3.5 w-3.5 text-success-500" />
      ) : (
        <Cloud className="h-3.5 w-3.5 text-warning-500" />
      )}
      <div className="flex flex-col">
        <span className={`text-[10px] font-bold ${isLan ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
          {isLan ? 'Local LAN' : 'Cloud Direct'}
        </span>
        <span className="text-[9px] capitalize text-ink-400 dark:text-ink-500">
          synced {syncLabel}
          {pendingSyncItems > 0 && ` · ${pendingSyncItems} pending`}
          {localVersion && ` · v${localVersion}`}
        </span>
      </div>
      <span className={`h-1.5 w-1.5 rounded-full ${conn.serverReachable ? 'bg-success-500' : 'bg-danger-500'}`} />
    </div>
  );
}
