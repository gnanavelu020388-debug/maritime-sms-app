import { LayoutDashboard, Building2, FolderTree, Users, ShieldCheck, Activity, CreditCard, DatabaseBackup, Anchor, X, Rocket, Lock, Grid3x3 } from 'lucide-react';
import { SECTIONS, PLATFORM_NAME, PLATFORM_SHORT } from '../constants';
import { useStore } from '../store';
import type { SectionId } from '../types';
import { canAccessSection, INTERNAL_ROLE_LABEL, type InternalRole } from '../lib/permissions';

const ICONS: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  tenants: Building2,
  provisioning: Rocket,
  sms: FolderTree,
  users: Users,
  security: ShieldCheck,
  monitoring: Activity,
  billing: CreditCard,
  backups: DatabaseBackup,
  features: Grid3x3,
};

export function Sidebar({
  active,
  onNavigate,
  open,
  onClose,
  roleKey,
}: {
  active: SectionId;
  onNavigate: (id: SectionId) => void;
  open: boolean;
  onClose: () => void;
  roleKey: InternalRole;
}) {
  const { tenants } = useStore();
  const activeCount = tenants.filter((t) => t.status === 'active').length;
  const archivedCount = tenants.filter((t) => t.status === 'archived').length;
  const groups = ['Operate', 'Govern', 'Commercial'] as const;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-ink-200/70 bg-white transition-transform duration-300 dark:border-ink-800 dark:bg-ink-900 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-ink-200/70 px-5 dark:border-ink-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 text-white shadow-elev-2">
              <Anchor className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-ink-900 dark:text-white">{PLATFORM_NAME}</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Super Admin Console</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-lg p-1.5 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-5">
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-400">{group}</p>
              <div className="space-y-1">
                {SECTIONS.filter((s) => s.group === group).map((s) => {
                  const Icon = ICONS[s.id] ?? LayoutDashboard;
                  const isActive = active === s.id;
                  const allowed = canAccessSection(roleKey, s.id as SectionId);
                  const showArchived = s.id === 'tenants' && archivedCount > 0;
                  return (
                    <button
                      key={s.id}
                      disabled={!allowed}
                      onClick={() => {
                        if (!allowed) return;
                        onNavigate(s.id as SectionId);
                        onClose();
                      }}
                      className={`sidebar-link w-full text-left ${!allowed ? 'cursor-not-allowed opacity-40' : ''} ${isActive
                        ? 'bg-primary-50 text-primary-700 shadow-elev-1 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white'}`}
                    >
                      <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-primary-600 dark:text-primary-400' : ''}`} />
                      <span className="flex-1 truncate">{s.label}</span>
                      {!allowed && <Lock className="h-3 w-3 shrink-0 text-ink-400" />}
                      {s.id === 'tenants' && (
                        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                          {showArchived ? `${activeCount}·${archivedCount}A` : activeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-200/70 p-4 dark:border-ink-800">
          <div className="rounded-xl bg-gradient-to-br from-ink-50 to-primary-50/50 p-3 dark:from-ink-800 dark:to-primary-900/20">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-xs font-bold text-white">SA</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink-900 dark:text-white">{INTERNAL_ROLE_LABEL[roleKey]}</p>
                <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">Platform Console · Internal Access Matrix</p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[10px] text-ink-400">{PLATFORM_SHORT} v2.4.0 · Build 2026.07</p>
        </div>
      </aside>
    </>
  );
}
