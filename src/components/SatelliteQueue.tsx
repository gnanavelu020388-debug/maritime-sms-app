import { useEffect, useState } from 'react';
import { Satellite, Radio, Cloud, FileJson, ArrowRight } from 'lucide-react';
import type { SatellitePayload } from '../types';
import { formatBytes, relativeTime } from '../constants';
import { Badge } from './Badge';

const NODE_TONE: Record<string, string> = {
  Starlink: 'bg-primary-500',
  VSAT: 'bg-accent-500',
  FBB: 'bg-warning-500',
};

const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
  syncing: 'info',
  queued: 'warning',
  processed: 'success',
  failed: 'danger',
};

export function SatelliteQueue({ payloads }: { payloads: SatellitePayload[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(h);
  }, []);

  const streaming = payloads.slice(0, 7);

  return (
    <div className="space-y-4">
      {/* Horizontal animated streaming track */}
      <div className="stream-track relative overflow-hidden rounded-xl border border-ink-200/70 bg-gradient-to-r from-ink-50 via-white to-ink-50 p-4 dark:border-ink-800 dark:from-ink-950 dark:via-ink-900 dark:to-ink-950">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <Radio className="h-3.5 w-3.5 animate-pulse-soft text-primary-500" />
            Live VSAT / Starlink payload stream
          </div>
          <div className="flex items-center gap-3 text-[10px] text-ink-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary-500" />Starlink</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent-500" />VSAT</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning-500" />FBB</span>
          </div>
        </div>

        <div className="relative flex h-24 items-center">
          {/* node endpoints */}
          <div className="absolute left-0 z-10 flex flex-col items-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300">
              <Satellite className="h-5 w-5" />
            </div>
            <span className="mt-1 text-[9px] font-semibold uppercase text-ink-400">Vessels</span>
          </div>
          <div className="absolute right-0 z-10 flex flex-col items-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success-100 text-success-600 dark:bg-success-900/40 dark:text-success-400">
              <Cloud className="h-5 w-5" />
            </div>
            <span className="mt-1 text-[9px] font-semibold uppercase text-ink-400">Cloud</span>
          </div>

          {/* connection line */}
          <div className="absolute left-12 right-12 top-1/2 h-0.5 -translate-y-1/2 bg-gradient-to-r from-primary-500/30 via-accent-500/30 to-success-500/30" />

          {/* moving packets */}
          <div className="relative ml-14 mr-14 flex w-[calc(100%-7rem)] items-center gap-3 overflow-hidden">
            {streaming.map((p, i) => {
              const offset = ((tick * 0.7 + i * 60) % 100);
              return (
                <div
                  key={p.id}
                  className="absolute flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-ink-200/70 bg-white px-2 py-1 text-[10px] shadow-elev-1 dark:border-ink-700 dark:bg-ink-800"
                  style={{ left: `${offset}%`, transition: 'left 80ms linear', transform: 'translateX(-50%)' }}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${NODE_TONE[p.node] ?? 'bg-ink-400'} animate-pulse-soft`} />
                  <FileJson className="h-3 w-3 text-ink-400" />
                  <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">{p.id}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Packet detail table */}
      <div className="overflow-x-auto rounded-xl border border-ink-200/70 dark:border-ink-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Vessel Source</th>
              <th className="px-4 py-2.5 font-semibold">Payload ID</th>
              <th className="px-4 py-2.5 font-semibold">Size</th>
              <th className="px-4 py-2.5 font-semibold">Connection Node</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {payloads.slice(0, 8).map((p) => (
              <tr key={p.id} className="bg-white hover:bg-primary-50/30 dark:bg-ink-900 dark:hover:bg-ink-800/40">
                <td className="px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{p.vessel}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-600 dark:text-ink-300">
                    <FileJson className="h-3.5 w-3.5 text-ink-400" />
                    {p.id}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{formatBytes(p.sizeKb)}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${NODE_TONE[p.node]}`} />
                    <span className="text-ink-700 dark:text-ink-200">{p.node}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[p.status]} dot pulse={p.status === 'syncing'}>{p.status}</Badge>
                    {p.status === 'syncing' && (
                      <div className="hidden w-20 sm:block">
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
                          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${p.progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-500">{relativeTime(p.receivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-accent-50 p-3 text-xs text-accent-800 dark:bg-accent-900/20 dark:text-accent-300">
        <ArrowRight className="h-3.5 w-3.5" />
        Dedup guard active: duplicate payloads auto-indexed as <code className="rounded bg-white/60 px-1 font-mono dark:bg-ink-800">[VesselName]-Report-1002</code>
      </div>
    </div>
  );
}
