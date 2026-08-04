/**
 * ShoreLaunchpadView — unified app-card grid for shore-based roles
 * (DPA, Technical Superintendent, HSEQ, Company Admin).
 *
 * Mirrors the Master Dashboard card design but filters by BOTH:
 *   - Tenant licensing (Super Admin Feature Matrix)
 *   - Shore role permissions (mod:<key>:view|edit|full)
 *
 * Cards route to the appropriate shore workspace section via onNavigate.
 */

import { useState } from 'react';
import {
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert, ArrowRight, Lock,
  Building2, ChevronDown, ChevronUp, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  MODULE_KEYS, MODULE_LABELS, LIVE_MODULES, LAUNCHPAD_EXCLUDED,
  useFeatureFlags, useModuleDefinitions, getDisplayName, type ModuleKey,
} from '../lib/featureFlags';
import { getShorePermsForRole, resolveShoreRoleName, canDoShore, type ShorePermissionMap } from '../lib/shoreRoles';
import { roleLabel } from '../lib/auth-utils';

const ICON_MAP: Record<string, LucideIcon> = {
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert,
};

interface ModuleColor {
  gradient: string;
  iconBg: string;
  iconText: string;
  border: string;
  hoverBorder: string;
  hoverShadow: string;
  badgeBg: string;
  badgeText: string;
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
  },
};

function getModuleColor(key: string): ModuleColor {
  return MODULE_COLORS[key] ?? MODULE_COLORS.sms_documentation;
}

interface ShoreLaunchpadViewProps {
  /** Called when a live module card is clicked — parent routes to the right section. */
  onNavigate: (key: ModuleKey) => void;
  /** Called when the "Back to Apps Launchpad" button is clicked from a sub-workspace. */
  onReturnToLaunchpad?: () => void;
  /** If provided, shows a "Back to Apps" button at the top. */
  showBackButton?: boolean;
  /** Accent theme — 'primary' for Company Admin, 'accent' for DPA. */
  accent?: 'primary' | 'accent';
}

export function ShoreLaunchpadView({
  onNavigate,
  onReturnToLaunchpad,
  showBackButton = false,
  accent = 'primary',
}: ShoreLaunchpadViewProps) {
  const { tenant, tenantUser, role } = useAuth();
  const { isEnabled } = useFeatureFlags(tenant?.id);
  const { defs } = useModuleDefinitions();
  const [isLaunchpadOpen, setIsLaunchpadOpen] = useState(false);

  const shoreRoleName = resolveShoreRoleName(tenantUser?.rank);
  const perms: ShorePermissionMap | null = tenant
    ? getShorePermsForRole(tenant.id, shoreRoleName)
    : null;

  const allModules = MODULE_KEYS
    .filter((key) => !LAUNCHPAD_EXCLUDED.has(key))
    .map((key) => {
      const licensed = isEnabled(key);
      const hasView = canDoShore(perms, `mod:${key}:view`);
      const hasEdit = canDoShore(perms, `mod:${key}:edit`);
      const hasFull = canDoShore(perms, `mod:${key}:full`);
      const permitted = hasView || hasEdit || hasFull;
      return {
        key,
        label: getDisplayName(key, defs),
        description: defs?.get(key)?.description ?? MODULE_LABELS[key].description,
        licensed,
        permitted,
        Icon: ICON_MAP[MODULE_LABELS[key].icon] ?? FileCheck2,
        color: getModuleColor(key),
      };
    });

  const available = allModules
    .filter((m) => m.licensed && m.permitted)
    .sort((a, b) => a.label.localeCompare(b.label));
  const restricted = allModules
    .filter((m) => !(m.licensed && m.permitted))
    .sort((a, b) => a.label.localeCompare(b.label));

  const accentGradient = accent === 'accent'
    ? 'from-accent-500 to-primary-500'
    : 'from-primary-500 to-accent-500';

  return (
    <div className="space-y-4">
      {/* Back button */}
      {showBackButton && onReturnToLaunchpad && (
        <button
          onClick={onReturnToLaunchpad}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-600 transition hover:border-primary-300 hover:text-primary-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-primary-600"
        >
          <Building2 className="h-4 w-4" />
          Back to Apps Launchpad
        </button>
      )}

      {/* Collapsible Launchpad toggle banner */}
      <button
        onClick={() => setIsLaunchpadOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200/70 bg-white px-4 py-2.5 shadow-sm transition hover:border-accent-300 hover:shadow-md dark:border-ink-800 dark:bg-ink-900 dark:hover:border-accent-700"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${accentGradient} text-white`}>
            <Building2 className="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-bold text-ink-900 dark:text-white">Shore Operations Launchpad</span>
            <span className="text-xs text-ink-500 dark:text-ink-400">{available.length} apps available</span>
          </div>
        </div>
        <span className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
          isLaunchpadOpen
            ? 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
            : 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
        }`}>
          {isLaunchpadOpen ? 'Hide Apps' : `Show Apps (${available.length})`}
          {isLaunchpadOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Collapsible App Grid — hidden by default */}
      {isLaunchpadOpen && (
        <>
      {/* Available Apps — vibrant color-accented cards */}
      {available.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Available Apps</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {available.map(({ key, label, description, Icon, color }) => {
              const isLive = LIVE_MODULES.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => isLive && onNavigate(key)}
                  disabled={!isLive}
                  className={`group relative flex flex-col items-start gap-2.5 overflow-hidden rounded-xl border-2 bg-white p-4 text-left transition-all duration-200 dark:bg-ink-900 ${
                    isLive
                      ? `cursor-pointer ${color.border} ${color.hoverBorder} hover:-translate-y-1 hover:shadow-lg ${color.hoverShadow} dark:hover:shadow-lg`
                      : `cursor-default ${color.border} opacity-90`
                  }`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${color.gradient}`} />
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${color.iconBg} ${color.iconText} shadow-md transition-transform duration-200 ${isLive ? 'group-hover:scale-110' : ''}`}>
                    <Icon className="h-5 w-5" />
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

      {/* Restricted Apps — muted gray with lock badges */}
      {restricted.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Access Restricted</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {restricted.map(({ key, label, description, Icon, licensed, permitted }) => (
              <div
                key={key}
                className="group relative flex flex-col items-start gap-2.5 overflow-hidden rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/60 p-4 dark:border-ink-700 dark:bg-ink-800/40"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-ink-200 dark:bg-ink-700" />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-400 dark:text-ink-500">{label}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-400 dark:text-ink-600">{description}</p>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-3 py-1.5 text-[10px] font-bold text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                  <Lock className="h-3 w-3" />
                  {!licensed ? 'Not Licensed' : !permitted ? 'Hidden for Role' : 'Access Restricted'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
