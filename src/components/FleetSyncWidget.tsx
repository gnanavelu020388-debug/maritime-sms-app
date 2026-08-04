/**
 * FleetSyncWidget — real-time shore dashboard widget showing fleet sync status.
 * Displays per-vessel last sync time, SMS version, and connection status.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, Ship } from 'lucide-react';
import { supabase, type VesselRow } from '../lib/supabase';
import { isDemoMode } from '../lib/demoData';
import { relativeTime } from '../constants';

interface FleetSyncWidgetProps {
  vessels: VesselRow[];
  tenantId: string | null;
}

interface SyncInfo {
  vesselId: string;
  lastSyncAt: string | null;
  smsVersion: string | null;
}

export function FleetSyncWidget({ vessels, tenantId }: FleetSyncWidgetProps) {
  const [syncInfos, setSyncInfos] = useState<SyncInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRevisions, setPendingRevisions] = useState(0);

  useEffect(() => {
    if (!tenantId || vessels.length === 0) {
      setLoading(false);
      return;
    }

    const vesselList = vessels;

    async function load() {
      if (isDemoMode()) {
        setSyncInfos(
          vesselList.map((v) => ({
            vesselId: v.id,
            lastSyncAt: v.last_sync_at ?? new Date(Date.now() - Math.random() * 3600_000).toISOString(),
            smsVersion: v.sms_active_version ?? 'v1.0.0',
          }))
        );
        setPendingRevisions(0);
        setLoading(false);
        return;
      }

      const { data: pending } = await supabase
        .from('sms_documents')
        .select('id')
        .eq('tenant_id', tenantId!)
        .eq('approval_state', 'pending_dpa');

      setPendingRevisions(pending?.length ?? 0);

      setSyncInfos(
        vesselList.map((v) => ({
          vesselId: v.id,
          lastSyncAt: v.last_sync_at,
          smsVersion: v.sms_active_version,
        }))
      );
      setLoading(false);
    }

    load();
    // Refresh every 30 seconds for real-time updates
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, vessels.length]);

  const syncedCount = syncInfos.filter((s) => s.lastSyncAt).length;
  const staleCount = syncInfos.filter((s) => {
    if (!s.lastSyncAt) return true;
    const hoursAgo = (Date.now() - new Date(s.lastSyncAt).getTime()) / (1000 * 60 * 60);
    return hoursAgo > 12;
  }).length;

  if (loading) {
    return (
      <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div className="h-32 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-accent-500" />
          <h3 className="text-sm font-bold text-ink-900 dark:text-white">Fleet Sync Status</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 font-semibold text-success-600 dark:text-success-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {syncedCount} synced
          </span>
          {staleCount > 0 && (
            <span className="flex items-center gap-1 font-semibold text-warning-600 dark:text-warning-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {staleCount} stale
            </span>
          )}
          <span className="flex items-center gap-1 font-semibold text-warning-600 dark:text-warning-400">
            <FileClock /> {pendingRevisions} pending
          </span>
        </div>
      </div>

      {syncInfos.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-400">No vessels in fleet.</p>
      ) : (
        <div className="space-y-2">
          {vessels.map((v) => {
            const info = syncInfos.find((s) => s.vesselId === v.id);
            const isStale = !info?.lastSyncAt || (Date.now() - new Date(info.lastSyncAt).getTime()) / (1000 * 60 * 60) > 12;
            return (
              <div
                key={v.id}
                className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800"
              >
                <Ship className="h-4 w-4 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-200">{v.name}</p>
                  <p className="text-xs text-ink-400">{v.imo_number}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {info?.smsVersion && (
                    <span className="font-mono text-ink-500 dark:text-ink-400">{info.smsVersion}</span>
                  )}
                  <span className={`flex items-center gap-1 ${isStale ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}`}>
                    {isStale ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {info?.lastSyncAt ? relativeTime(info.lastSyncAt) : 'never synced'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileClock() {
  return <span className="text-xs">⏱</span>;
}
