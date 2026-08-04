/**
 * ModuleLaunchpad — unified grid of ALL platform modules for the current tenant.
 * Each module renders with its real feature-flag state from useFeatureFlags():
 *   - Active / Enabled modules → "Active" badge, clickable if LIVE
 *   - Modules not enabled by Super Admin → "Not Licensed" badge, greyed out
 *
 * Display names come from the platform-wide module_definitions table via
 * the useModuleDefinitions hook, so Super Admin renames propagate here
 * in real time without a page refresh.
 */

import { useMemo } from 'react';
import {
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { MODULE_KEYS, MODULE_LABELS, LIVE_MODULES, LAUNCHPAD_EXCLUDED, useFeatureFlags, useModuleDefinitions, getDisplayName, type ModuleKey } from '../lib/featureFlags';

const ICON_MAP: Record<string, LucideIcon> = {
  FileCheck2, Clock, UtensilsCrossed, Award, SatelliteDish, Navigation,
  Users, BookOpen, BarChart3, ShieldAlert,
};

interface ModuleLaunchpadProps {
  tenantId: string | null | undefined;
  activeModule?: ModuleKey | null;
  onSelectModule?: (key: ModuleKey) => void;
  compact?: boolean;
}

export function ModuleLaunchpad({ tenantId, activeModule, onSelectModule, compact = false }: ModuleLaunchpadProps) {
  const { isEnabled, loading } = useFeatureFlags(tenantId);
  const { defs } = useModuleDefinitions();

  const allModules = useMemo(
    () =>
      MODULE_KEYS.map((key) => ({
        key,
        label: getDisplayName(key, defs),
        description: defs?.get(key)?.description ?? MODULE_LABELS[key].description,
        enabled: isEnabled(key),
        Icon: ICON_MAP[MODULE_LABELS[key].icon] ?? FileCheck2,
      })).filter((m) => !LAUNCHPAD_EXCLUDED.has(m.key)),
    [isEnabled, defs]
  );

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MODULE_KEYS.slice(0, 4).map((k) => (
          <div key={k} className="h-28 animate-pulse rounded-xl bg-ink-100 dark:bg-ink-800" />
        ))}
      </div>
    );
  }

  const enabledModules = allModules.filter((m) => m.enabled);
  const disabledModules = allModules.filter((m) => !m.enabled);

  if (allModules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400 dark:border-ink-700 dark:text-ink-500">
        No modules registered for this tenant.
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {allModules.map(({ key, label, Icon, enabled }) => {
          const isActive = activeModule === key;
          const isLive = LIVE_MODULES.includes(key);
          return (
            <span
              key={key}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                !enabled
                  ? 'border-dashed border-ink-200 bg-ink-50 text-ink-400 dark:border-ink-700 dark:bg-ink-800/50 dark:text-ink-500'
                  : isLive
                    ? isActive
                      ? 'cursor-pointer border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                      : 'cursor-pointer border-ink-200 bg-white text-ink-700 hover:border-teal-400 hover:bg-teal-50/40 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800'
                    : 'border-ink-200 bg-white text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
              }`}
              onClick={() => enabled && isLive && onSelectModule?.(key)}
            >
              <Icon className="h-4 w-4" />
              {label}
              {enabled ? (
                isLive ? (
                  <span className="text-[10px] font-bold text-teal-500 dark:text-teal-400">Active</span>
                ) : (
                  <span className="text-[10px] font-bold text-ink-400">Active</span>
                )
              ) : (
                <span className="text-[10px] font-bold text-ink-400">Not Licensed</span>
              )}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {allModules.map(({ key, label, description, Icon, enabled }) => {
        const isLive = LIVE_MODULES.includes(key);
        return (
          <div
            key={key}
            onClick={() => enabled && isLive && onSelectModule?.(key)}
            className={`group relative flex flex-col items-start gap-2 rounded-xl border p-4 transition ${
              enabled && isLive
                ? 'cursor-pointer border-ink-200 bg-white hover:border-teal-400 hover:shadow-md dark:border-ink-700 dark:bg-ink-900 dark:hover:border-teal-600'
                : enabled
                  ? 'border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900'
                  : 'border-dashed border-ink-200 bg-ink-50/60 dark:border-ink-700 dark:bg-ink-800/40'
            }`}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
              enabled
                ? 'bg-teal-100 text-teal-600 group-hover:bg-teal-600 group-hover:text-white dark:bg-teal-900/40 dark:text-teal-300'
                : 'bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500'
            }`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-900 dark:text-white">
                {label}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-400 dark:text-ink-500">{description}</p>
            </div>
            <div className="flex w-full items-center justify-between">
              {enabled && isLive ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-teal-600 dark:text-teal-400">
                  Active <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                </span>
              ) : enabled ? (
                <span className="text-xs font-semibold text-ink-400">
                  Active
                </span>
              ) : (
                <span className="text-xs font-semibold text-ink-400">
                  Not Licensed
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
