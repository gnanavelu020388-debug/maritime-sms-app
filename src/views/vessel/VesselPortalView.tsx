import { useAuth } from '../../lib/auth';
import { useDemoAuth } from '../../lib/demoAuth';
import { SmsLibrarySplitView } from '../../components/SmsLibrarySplitView';
import {
  ShieldX, Anchor, BookX, Ship, Lock, ArrowRight, ArrowLeft,
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { MODULE_KEYS, MODULE_LABELS, LIVE_MODULES, LAUNCHPAD_EXCLUDED, useFeatureFlags, useModuleDefinitions, getDisplayName, type ModuleKey } from '../../lib/featureFlags';
import { isAppVisible, usePermissionsForRank, type AppId } from '../../lib/rankPermissions';
import { type Rank } from '../../lib/supabase';
import { CrewSignOnPanel } from './CrewSignOnPanel';
import { EmergencyControlsPanel } from './EmergencyControlsPanel';
import { HelpPanel } from '../../components/BridgeDrawer';
import type { DrawerSection } from '../../components/BridgeDrawer';

const ICON_MAP: Record<string, LucideIcon> = {
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert,
};

// ── Per-module color schemes ─────────────────────────────────────────
interface ModuleColor {
  gradient: string;
  iconBg: string;
  iconText: string;
  border: string;
  hoverBorder: string;
  hoverShadow: string;
  badgeBg: string;
  badgeText: string;
  glow: string;
}

const MODULE_COLORS: Record<string, ModuleColor> = {
  sms_documentation: {
    gradient: 'from-emerald-500 to-teal-600',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    iconText: 'text-white',
    border: 'border-emerald-200',
    hoverBorder: 'hover:border-emerald-400',
    hoverShadow: 'hover:shadow-emerald-200/50',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    glow: 'shadow-emerald-100',
  },
  certification_manager: {
    gradient: 'from-indigo-500 to-violet-600',
    iconBg: 'bg-gradient-to-br from-indigo-500 to-violet-600',
    iconText: 'text-white',
    border: 'border-indigo-200',
    hoverBorder: 'hover:border-indigo-400',
    hoverShadow: 'hover:shadow-indigo-200/50',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-900/30',
    badgeText: 'text-indigo-700 dark:text-indigo-300',
    glow: 'shadow-indigo-100',
  },
  electronic_logbooks: {
    gradient: 'from-blue-500 to-cyan-600',
    iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-600',
    iconText: 'text-white',
    border: 'border-blue-200',
    hoverBorder: 'hover:border-blue-400',
    hoverShadow: 'hover:shadow-blue-200/50',
    badgeBg: 'bg-blue-50 dark:bg-blue-900/30',
    badgeText: 'text-blue-700 dark:text-blue-300',
    glow: 'shadow-blue-100',
  },
  rest_hours: {
    gradient: 'from-amber-400 to-orange-500',
    iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500',
    iconText: 'text-white',
    border: 'border-amber-200',
    hoverBorder: 'hover:border-amber-400',
    hoverShadow: 'hover:shadow-amber-200/50',
    badgeBg: 'bg-amber-50 dark:bg-amber-900/30',
    badgeText: 'text-amber-700 dark:text-amber-300',
    glow: 'shadow-amber-100',
  },
  risk_assessment: {
    gradient: 'from-red-500 to-rose-600',
    iconBg: 'bg-gradient-to-br from-red-500 to-rose-600',
    iconText: 'text-white',
    border: 'border-red-200',
    hoverBorder: 'hover:border-red-400',
    hoverShadow: 'hover:shadow-red-200/50',
    badgeBg: 'bg-red-50 dark:bg-red-900/30',
    badgeText: 'text-red-700 dark:text-red-300',
    glow: 'shadow-red-100',
  },
  satellite_sync: {
    gradient: 'from-cyan-400 to-teal-500',
    iconBg: 'bg-gradient-to-br from-cyan-400 to-teal-500',
    iconText: 'text-white',
    border: 'border-cyan-200',
    hoverBorder: 'hover:border-cyan-400',
    hoverShadow: 'hover:shadow-cyan-200/50',
    badgeBg: 'bg-cyan-50 dark:bg-cyan-900/30',
    badgeText: 'text-cyan-700 dark:text-cyan-300',
    glow: 'shadow-cyan-100',
  },
  voyage_logging: {
    gradient: 'from-sky-400 to-blue-500',
    iconBg: 'bg-gradient-to-br from-sky-400 to-blue-500',
    iconText: 'text-white',
    border: 'border-sky-200',
    hoverBorder: 'hover:border-sky-400',
    hoverShadow: 'hover:shadow-sky-200/50',
    badgeBg: 'bg-sky-50 dark:bg-sky-900/30',
    badgeText: 'text-sky-700 dark:text-sky-300',
    glow: 'shadow-sky-100',
  },
  haccp_galley: {
    gradient: 'from-green-400 to-emerald-500',
    iconBg: 'bg-gradient-to-br from-green-400 to-emerald-500',
    iconText: 'text-white',
    border: 'border-green-200',
    hoverBorder: 'hover:border-green-400',
    hoverShadow: 'hover:shadow-green-200/50',
    badgeBg: 'bg-green-50 dark:bg-green-900/30',
    badgeText: 'text-green-700 dark:text-green-300',
    glow: 'shadow-green-100',
  },
  advanced_analytics: {
    gradient: 'from-violet-500 to-purple-600',
    iconBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
    iconText: 'text-white',
    border: 'border-violet-200',
    hoverBorder: 'hover:border-violet-400',
    hoverShadow: 'hover:shadow-violet-200/50',
    badgeBg: 'bg-violet-50 dark:bg-violet-900/30',
    badgeText: 'text-violet-700 dark:text-violet-300',
    glow: 'shadow-violet-100',
  },
  crew_matrix: {
    gradient: 'from-slate-500 to-gray-600',
    iconBg: 'bg-gradient-to-br from-slate-500 to-gray-600',
    iconText: 'text-white',
    border: 'border-slate-200',
    hoverBorder: 'hover:border-slate-400',
    hoverShadow: 'hover:shadow-slate-200/50',
    badgeBg: 'bg-slate-50 dark:bg-slate-900/30',
    badgeText: 'text-slate-700 dark:text-slate-300',
    glow: 'shadow-slate-100',
  },
};

function getModuleColor(key: string): ModuleColor {
  return MODULE_COLORS[key] ?? MODULE_COLORS.sms_documentation;
}

export function VesselPortalView({
  activeModule, onReturnToDashboard, drawerSection, onClearDrawerSection,
  lastSyncAt, localVersion,
}: {
  activeModule: ModuleKey | null;
  onReturnToDashboard: () => void;
  drawerSection: DrawerSection | null;
  onClearDrawerSection: () => void;
  lastSyncAt: string | null;
  localVersion: string;
}) {
  const { tenant, tenantUser, activeAssignment } = useAuth();
  const demo = useDemoAuth();
  const { flags, isEnabled } = useFeatureFlags(tenant?.id);
  const { defs } = useModuleDefinitions();

  const vesselId = activeAssignment?.vessel_id ?? demo?.demoSession.vesselId ?? null;
  const crewRank: Rank | null = activeAssignment?.rank ?? (tenantUser?.rank as Rank) ?? null;
  const isMasterOrChiefEng = crewRank === 'Master' || crewRank === 'Chief Engineer';

  const rankPerms = usePermissionsForRank(tenant?.id, crewRank);

  // ── SMS gate: only block the SMS documentation workspace, not core utilities ──
  const smsBlocked = !isEnabled('sms_documentation');

  // ── Hard vessel boundary ──────────────────────────────────────────
  if (!activeAssignment && !demo) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
          <ShieldX className="h-8 w-8 text-danger-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Access Denied — No Active Vessel Assignment</h1>
          <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
            Your account is not currently signed on to any vessel. Vessel SMS documents are only accessible
            to crew who are actively assigned to that vessel's Manning Deck.
          </p>
          <p className="mt-3 text-xs text-ink-400">Contact your Company Admin or DPA to be signed on to a vessel.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-2 text-xs text-ink-500 dark:bg-ink-800 dark:text-ink-300">
          <Anchor className="h-4 w-4" /> Status: <strong className="font-semibold">Ashore / Unassigned</strong>
        </div>
      </div>
    );
  }

  if (!tenant) return null;

  const vesselName = activeAssignment?.vessel_name ?? demo?.demoSession.vesselName ?? tenant?.company ?? 'Vessel';

  // ── Drawer section rendering ──────────────────────────────────────
  if (drawerSection) {
    if (drawerSection === 'crew' && isMasterOrChiefEng) {
      return (
        <CrewSignOnPanel
          tenantId={tenant.id}
          vesselId={vesselId}
          vesselName={vesselName}
          actorEmail={tenantUser?.email ?? 'demo@vessel'}
          actorRank={crewRank}
          enabledModules={flags}
        />
      );
    }
    if (drawerSection === 'emergency' && isMasterOrChiefEng) {
      return (
        <EmergencyControlsPanel
          tenantId={tenant.id}
          vesselId={vesselId}
          vesselName={vesselName}
          actorEmail={tenantUser?.email ?? 'demo@vessel'}
          actorRank={crewRank}
        />
      );
    }
    if (drawerSection === 'help') {
      return <HelpPanel onClose={onClearDrawerSection} />;
    }
    if (drawerSection === 'sync') {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-ink-200/70 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400">
                <SatelliteDish className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink-900 dark:text-white">Vessel Sync & Offline Status</h2>
                <p className="text-sm text-ink-500 dark:text-ink-400">Satellite synchronization status and connection details</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">SMS Version</p>
                <p className="mt-1 text-lg font-bold text-ink-900 dark:text-white">{localVersion}</p>
              </div>
              <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Last Sync</p>
                <p className="mt-1 text-sm font-semibold text-ink-700 dark:text-ink-300">
                  {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Pending Items</p>
                <p className="mt-1 text-lg font-bold text-success-600 dark:text-success-400">0 queued</p>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  // ── Active module rendering ───────────────────────────────────────
  if (activeModule && activeModule === 'sms_documentation') {
    if (smsBlocked) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-100 dark:bg-ink-800">
            <BookX className="h-8 w-8 text-ink-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">SMS Module Not Available</h1>
            <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
              The Safety Management System module is not enabled for your company. Contact your Company Admin or DPA for more information.
            </p>
          </div>
        </div>
      );
    }
    return (
      <SmsLibrarySplitView
        tenantId={tenant.id}
        vesselId={vesselId}
        readOnly={false}
        crewRank={crewRank}
        rankPermissions={rankPerms}
        authorName={tenantUser?.name ?? 'Unknown'}
        authorRole={crewRank ?? 'Crew'}
        authorOrigin={vesselName}
      />
    );
  }

  // ── Other live modules (placeholder for now) ──────────────────────
  if (activeModule && LIVE_MODULES.includes(activeModule) && activeModule !== 'sms_documentation') {
    const mc = getModuleColor(activeModule);
    const Icon = ICON_MAP[MODULE_LABELS[activeModule].icon] ?? FileCheck2;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${mc.gradient} text-white shadow-lg`}>
          <Icon className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">{getDisplayName(activeModule, defs)}</h1>
          <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
            This module is enabled and licensed. The full workspace is being loaded.
          </p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // ── MASTER DASHBOARD APP GRID ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  const allModules = MODULE_KEYS
    .filter((key) => !LAUNCHPAD_EXCLUDED.has(key))
    .map((key) => ({
      key,
      label: getDisplayName(key, defs),
      description: defs?.get(key)?.description ?? MODULE_LABELS[key].description,
      licensed: isEnabled(key),
      visible: isAppVisible(rankPerms, key as AppId),
      Icon: ICON_MAP[MODULE_LABELS[key].icon] ?? FileCheck2,
      color: getModuleColor(key),
    }));

  // Sort: enabled+licensed+visible first (alphabetical), then disabled/unlicensed
  const enabledSorted = allModules
    .filter((m) => m.licensed && m.visible)
    .sort((a, b) => a.label.localeCompare(b.label));
  const disabledSorted = allModules
    .filter((m) => !(m.licensed && m.visible))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      {/* Dashboard header */}
      <div className="rounded-2xl border border-ink-200/70 bg-gradient-to-br from-white to-ink-50/50 p-6 dark:border-ink-800 dark:from-ink-900 dark:to-ink-950">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 text-white shadow-lg">
            <Anchor className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink-900 dark:text-white">Master Dashboard</h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {vesselName} · {crewRank} · {enabledSorted.length} apps available
            </p>
          </div>
        </div>
      </div>

      {/* Enabled & Licensed Apps — vibrant color-accented cards */}
      {enabledSorted.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Available Apps</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {enabledSorted.map(({ key, label, description, Icon, color, }) => {
              const isLive = LIVE_MODULES.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (isLive) {
                      window.dispatchEvent(new CustomEvent('vessel-launch-module', { detail: key }));
                    }
                  }}
                  disabled={!isLive}
                  className={`group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border-2 bg-white p-5 text-left transition-all duration-200 dark:bg-ink-900 ${
                    isLive
                      ? `cursor-pointer ${color.border} ${color.hoverBorder} hover:-translate-y-1 hover:shadow-lg ${color.hoverShadow} dark:hover:shadow-lg`
                      : `cursor-default ${color.border} opacity-90`
                  }`}
                >
                  {/* Decorative gradient bar at top */}
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${color.gradient}`} />

                  {/* Icon badge — vibrant gradient */}
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${color.iconBg} ${color.iconText} shadow-md transition-transform duration-200 ${isLive ? 'group-hover:scale-110' : ''}`}>
                    <Icon className="h-7 w-7" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink-900 dark:text-white">{label}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-400 dark:text-ink-500">{description}</p>
                  </div>

                  {isLive ? (
                    <span className={`flex items-center gap-1.5 rounded-lg ${color.badgeBg} ${color.badgeText} px-3 py-1.5 text-xs font-bold transition group-hover:gap-2.5`}>
                      Open Workspace
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-bold text-ink-400 dark:bg-ink-800 dark:text-ink-500">
                      <Clock className="h-3.5 w-3.5" />
                      Enabled
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Disabled / Unlicensed Apps — muted gray with lock badges */}
      {disabledSorted.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Access Restricted</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {disabledSorted.map(({ key, label, description, Icon, licensed, visible }) => (
              <div
                key={key}
                className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50/60 p-5 dark:border-ink-700 dark:bg-ink-800/40"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-ink-200 dark:bg-ink-700" />

                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
                  <Icon className="h-7 w-7" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-400 dark:text-ink-500">{label}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-400 dark:text-ink-600">{description}</p>
                </div>

                <div className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-3 py-1.5 text-[10px] font-bold text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                  <Lock className="h-3 w-3" />
                  {licensed && !visible ? 'Hidden for Rank' : 'Access Restricted'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
