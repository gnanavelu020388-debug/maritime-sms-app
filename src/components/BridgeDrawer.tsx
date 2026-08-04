import { type ReactNode } from 'react';
import {
  ChevronLeft, ChevronRight, Users, ShieldAlert, SatelliteDish,
  HelpCircle, X, Anchor, Wifi, WifiOff,
} from 'lucide-react';
import { VesselSyncStatusCompact } from './VesselSyncStatusPill';

export type DrawerSection = 'crew' | 'emergency' | 'sync' | 'help';

interface BridgeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vesselName: string;
  crewRank: string | null;
  isMasterOrChiefEng: boolean;
  lastSyncAt: string | null;
  localVersion: string;
  onSelectSection: (section: DrawerSection) => void;
  activeSection: DrawerSection | null;
  children?: ReactNode;
}

const SECTION_ICONS: Record<DrawerSection, typeof Users> = {
  crew: Users,
  emergency: ShieldAlert,
  sync: SatelliteDish,
  help: HelpCircle,
};

const SECTION_LABELS: Record<DrawerSection, string> = {
  crew: 'Crew Sign-On & Sign-Off',
  emergency: 'Emergency Onboard Controls',
  sync: 'Vessel Sync & Offline Status',
  help: 'Help & System Info',
};

export function BridgeDrawer({
  open, onOpenChange, vesselName, crewRank, isMasterOrChiefEng,
  lastSyncAt, localVersion, onSelectSection, activeSection,
}: BridgeDrawerProps) {
  const sections: { key: DrawerSection; label: string; show: boolean }[] = [
    { key: 'crew', label: SECTION_LABELS.crew, show: isMasterOrChiefEng },
    { key: 'emergency', label: SECTION_LABELS.emergency, show: isMasterOrChiefEng },
    { key: 'sync', label: SECTION_LABELS.sync, show: true },
    { key: 'help', label: SECTION_LABELS.help, show: true },
  ];

  const visibleSections = sections.filter((s) => s.show);

  return (
    <>
      {/* Collapse/expand toggle button (floating when collapsed) */}
      <button
        onClick={() => onOpenChange(!open)}
        className={`fixed left-0 top-1/2 z-40 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-ink-200 bg-white text-ink-400 shadow-sm transition hover:bg-ink-50 hover:text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-500 dark:hover:bg-ink-800 ${
          open ? 'left-[260px]' : 'left-0'
        }`}
        title={open ? 'Collapse Bridge Drawer' : 'Expand Bridge Drawer'}
      >
        {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Drawer */}
      <aside
        className={`fixed left-0 top-14 z-30 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-ink-200 bg-white transition-all duration-200 dark:border-ink-800 dark:bg-ink-900 ${
          open ? 'w-[260px]' : 'w-0 overflow-hidden'
        }`}
      >
        {open && (
          <div className="flex h-full flex-col p-3">
            {/* Vessel identity header */}
            <div className="mb-3 rounded-lg border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-800/50">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white">
                  <Anchor className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{vesselName}</p>
                  <p className="text-[10px] text-ink-400">{crewRank ?? 'Crew'} · Bridge Command</p>
                </div>
              </div>
            </div>

            {/* Navigation items */}
            <nav className="space-y-1">
              {visibleSections.map((s) => {
                const Icon = SECTION_ICONS[s.key];
                const isActive = activeSection === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => onSelectSection(s.key)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                        : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800/50 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-left text-xs leading-tight">{s.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Sync status footer */}
            <div className="mt-auto pt-3">
              <VesselSyncStatusCompact lastSyncAt={lastSyncAt} localVersion={localVersion} />
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

/** Inline help panel for the Help & System Info drawer section. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary-500" />
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">Help & System Info</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <h3 className="text-sm font-bold text-ink-900 dark:text-white">About This Vessel Portal</h3>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          This is the shipboard vessel management system. Your access is determined by your rank and the permissions configured by your Company Admin or DPA. All actions are logged to the audit trail and synchronized to shore via satellite.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-success-500" />
            <h4 className="text-sm font-bold text-ink-900 dark:text-white">Online Mode</h4>
          </div>
          <p className="mt-1 text-xs text-ink-400">When connected, data syncs automatically to shore. All documents and logs are current.</p>
        </div>
        <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 text-warning-500" />
            <h4 className="text-sm font-bold text-ink-900 dark:text-white">Offline Mode</h4>
          </div>
          <p className="mt-1 text-xs text-ink-400">When satellite is down, all data is stored locally and queued for sync when connection returns.</p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <h4 className="text-sm font-bold text-ink-900 dark:text-white">Emergency Contacts</h4>
        <div className="mt-2 space-y-1 text-xs text-ink-500 dark:text-ink-400">
          <p>For technical issues at sea, use the Emergency Onboard Controls in the Bridge Drawer.</p>
          <p>For SMS content questions, contact your DPA via the shore office.</p>
          <p>For crew access issues, the Master can generate temporary passwords using Emergency Controls.</p>
        </div>
      </div>
    </div>
  );
}
