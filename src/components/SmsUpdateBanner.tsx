import { useEffect, useState, useCallback } from 'react';
import { Bell, X, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  getPendingUpdate,
  setPendingUpdate,
  subscribeSmsUpdates,
  type PendingUpdate,
} from '../lib/localVesselDb';
import { performSyncCheckIn } from '../lib/syncService';

/**
 * SmsUpdateBanner — persistent header notification shown across all active
 * shipboard browser sessions when a new DPA-approved SMS version has been
 * downloaded via satellite sync.
 *
 * Displays: "SMS System Updated to Version [vX.Y.Z] by DPA. Click to Load Changes."
 * Clicking applies the delta and reloads the document tree from the local cache.
 * The banner persists (survives re-renders) until the user acknowledges it.
 */
export function SmsUpdateBanner() {
  const { tenant } = useAuth();
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const tenantId = tenant?.id ?? null;

  const refreshPending = useCallback(async () => {
    if (!tenantId) return;
    const p = await getPendingUpdate(tenantId);
    setPending(p);
    setDismissed(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    void refreshPending();

    // Listen for cross-tab broadcasts (other workstations on the same vessel)
    const unsub = subscribeSmsUpdates(tenantId, () => {
      void refreshPending();
    });

    return unsub;
  }, [tenantId, refreshPending]);

  // Also re-check on window focus (user returns to this tab)
  useEffect(() => {
    const handler = () => void refreshPending();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [refreshPending]);

  const handleLoadChanges = useCallback(async () => {
    if (!tenantId) return;
    setApplying(true);
    try {
      // The delta was already applied to the local DB by the sync worker.
      // Perform a confirmatory check-in, then clear the notification.
      await performSyncCheckIn(tenantId);
      await clearPendingUpdate(tenantId);
      setPending(null);
      setDismissed(true);
      // Reload the page so the document tree re-reads from the local cache
      window.location.reload();
    } finally {
      setApplying(false);
    }
  }, [tenantId]);

  const handleDismiss = useCallback(async () => {
    if (!tenantId) return;
    setDismissed(true);
    // Keep the pending update in storage — it should persist until acknowledged
    // with "Load Changes", not just dismissed. But visually hide it for this session.
  }, []);

  if (!pending || dismissed) return null;

  return (
    <div className="sticky top-14 z-20 flex items-center gap-3 border-b border-primary-300 bg-gradient-to-r from-primary-600 to-accent-600 px-4 py-2.5 text-white shadow-lg">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Bell className="h-4 w-4" />
      </div>
      <div className="flex-1 text-sm">
        <span className="font-bold">A new DPA-approved version (v{pending.version}) is available.</span>
        <span className="ml-1.5 text-white/80">Click to refresh.</span>
        <span className="ml-2 hidden text-xs text-white/60 sm:inline">
          ({pending.docCount} document{pending.docCount !== 1 ? 's' : ''} updated)
        </span>
      </div>
      <button
        onClick={handleLoadChanges}
        disabled={applying}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-50 disabled:opacity-60"
      >
        {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {applying ? 'Loading…' : 'Load Changes'}
      </button>
      <button
        onClick={handleDismiss}
        className="rounded p-1 text-white/70 transition hover:bg-white/20 hover:text-white"
        title="Dismiss for now"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Clear the stored pending update notification. */
export async function clearPendingUpdate(tenantId: string): Promise<void> {
  await setPendingUpdate(tenantId, null);
}

/** Check on mount whether there's a pending update — used by VesselShell. */
export async function checkPendingUpdate(tenantId: string): Promise<PendingUpdate | null> {
  return getPendingUpdate(tenantId);
}
