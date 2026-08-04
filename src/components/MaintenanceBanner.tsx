import { useState, useEffect, useCallback } from 'react';
import { Megaphone, X, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { useStore } from '../store';
import { readPersistedBanner } from '../lib/syncChannel';
import type { MaintenanceBanner as BannerData } from '../types';
import { Modal } from './Modal';
import { Badge } from './Badge';

const ICONS = { info: Info, warning: AlertTriangle, critical: AlertOctagon };
const TONES = {
  info: 'bg-primary-600 text-white',
  warning: 'bg-warning-500 text-white',
  critical: 'bg-danger-600 text-white',
};
const SEVERITY_LABEL = { info: 'Info', warning: 'Warning', critical: 'Critical' };
const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

/**
 * MaintenanceBanner — platform-wide scrolling marquee notice.
 *
 * Renders a continuous right-to-left CSS marquee at the top of every
 * workspace (Super Admin, Company Admin, Vessel Portal) and the login
 * screen. Hovering pauses the scroll; clicking opens a modal with the
 * full untruncated notice; the fixed X button dismisses for the session.
 *
 * State is synced in real-time across all open tabs via BroadcastChannel
 * and persisted to localStorage so newly-opened tabs pick it up instantly.
 */
export function MaintenanceBanner() {
  const { maintenance, dispatch } = useStore();
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Sync from localStorage on mount and cross-tab storage events
  useEffect(() => {
    const checkBanner = () => {
      const persisted = readPersistedBanner();
      if (persisted && !maintenance) {
        dispatch({ type: 'MAINTENANCE_REMOTE', banner: persisted as BannerData });
        setLocallyDismissed(false);
      } else if (!persisted && maintenance) {
        dispatch({ type: 'MAINTENANCE_REMOTE', banner: null });
      }
    };
    checkBanner();
    window.addEventListener('storage', checkBanner);
    return () => window.removeEventListener('storage', checkBanner);
  }, [maintenance, dispatch]);

  // Reset dismiss when a new banner arrives
  useEffect(() => {
    if (maintenance) setLocallyDismissed(false);
  }, [maintenance?.publishedAt]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLocallyDismissed(true);
  }, []);

  if (!maintenance || locallyDismissed) return null;

  const Icon = ICONS[maintenance.severity];
  const scrollText = `PLATFORM NOTICE — ${maintenance.message}`;
  const displayText = `${scrollText}     •     ${scrollText}     •     `;

  return (
    <>
      <div
        className={`relative z-40 flex items-center gap-2 py-2 text-sm font-medium shadow-elev-1 cursor-pointer select-none ${TONES[maintenance.severity]} animate-slide-down`}
        onClick={() => setShowModal(true)}
        role="alert"
      >
        {/* Fixed left icon */}
        <div className="flex shrink-0 items-center gap-1.5 pl-3">
          <Icon className="h-4 w-4" />
          <Megaphone className="h-4 w-4 opacity-70" />
        </div>

        {/* Marquee scroll area */}
        <div className="marquee-container relative flex-1 overflow-hidden">
          <div className="marquee-track">
            <span>{displayText}</span>
            <span aria-hidden="true">{displayText}</span>
          </div>
          {/* Fade edges */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/20 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/20 to-transparent" />
        </div>

        {/* Fixed dismiss button */}
        <button
          onClick={handleDismiss}
          className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20 transition-colors hover:bg-white/40"
          aria-label="Dismiss banner"
          title="Dismiss for this session"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Click-to-expand modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Platform Notice"
        subtitle="Full maintenance announcement"
        icon={<Megaphone className="h-5 w-5" />}
        size="md"
        footer={
          <button onClick={() => setShowModal(false)} className="btn-primary">
            Close
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={SEVERITY_TONE[maintenance.severity]} dot>
              {SEVERITY_LABEL[maintenance.severity]}
            </Badge>
            <span className="text-xs text-ink-500 dark:text-ink-400">
              {new Date(maintenance.publishedAt).toLocaleString('en-GB', { hour12: false })}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-100">
            {maintenance.message}
          </p>
          <p className="text-xs text-ink-400">
            Published by {maintenance.publishedBy}
          </p>
        </div>
      </Modal>
    </>
  );
}

/**
 * StandaloneBanner — for routes outside the StoreProvider context
 * (e.g. the login/AuthView). Reads directly from localStorage without
 * needing the store; still receives real-time cross-tab updates via
 * the storage event listener.
 */
export function StandaloneBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const check = () => {
      const persisted = readPersistedBanner();
      setBanner(persisted as BannerData | null);
      if (persisted) setDismissed(false);
    };
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  }, []);

  if (!banner || dismissed) return null;

  const Icon = ICONS[banner.severity];
  const scrollText = `PLATFORM NOTICE — ${banner.message}`;
  const displayText = `${scrollText}     •     ${scrollText}     •     `;

  return (
    <>
      <div
        className={`relative z-40 flex items-center gap-2 py-2 text-sm font-medium shadow-elev-1 cursor-pointer select-none ${TONES[banner.severity]} animate-slide-down`}
        onClick={() => setShowModal(true)}
        role="alert"
      >
        <div className="flex shrink-0 items-center gap-1.5 pl-3">
          <Icon className="h-4 w-4" />
          <Megaphone className="h-4 w-4 opacity-70" />
        </div>
        <div className="marquee-container relative flex-1 overflow-hidden">
          <div className="marquee-track">
            <span>{displayText}</span>
            <span aria-hidden="true">{displayText}</span>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/20 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/20 to-transparent" />
        </div>
        <button
          onClick={handleDismiss}
          className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20 transition-colors hover:bg-white/40"
          aria-label="Dismiss banner"
          title="Dismiss for this session"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Platform Notice"
        subtitle="Full maintenance announcement"
        icon={<Megaphone className="h-5 w-5" />}
        size="md"
        footer={
          <button onClick={() => setShowModal(false)} className="btn-primary">
            Close
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={SEVERITY_TONE[banner.severity]} dot>
              {SEVERITY_LABEL[banner.severity]}
            </Badge>
            <span className="text-xs text-ink-500 dark:text-ink-400">
              {new Date(banner.publishedAt).toLocaleString('en-GB', { hour12: false })}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-100">
            {banner.message}
          </p>
          <p className="text-xs text-ink-400">
            Published by {banner.publishedBy}
          </p>
        </div>
      </Modal>
    </>
  );
}
