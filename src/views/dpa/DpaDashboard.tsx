import { useEffect, useState } from 'react';
import {
  FileText, Clock, CheckCircle2, ArrowRight, Shield, Layers, BookOpen, Ship,
  RefreshCw, Cloud, Server, AlertTriangle, Activity,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase, type SmsDocRow, type VesselRow } from '../../lib/supabase';
import { isDemoMode, getEffectiveDemoSmsDocs, getEffectiveDemoVessels } from '../../lib/demoData';
import { loadProfiles, type SmsProfileWithVessels } from '../../lib/smsProfiles';
import { useFleetScope } from '../../lib/useFleetScope';
import { ShoreLaunchpadView } from '../../components/ShoreLaunchpadView';
import { FleetSyncWidget } from '../../components/FleetSyncWidget';
import type { DpaSection } from '../../layouts/DpaShell';

interface DpaStats {
  pendingApprovals: number;
  approvedDocs: number;
}

export function DpaDashboard({ onNavigate }: { onNavigate: (s: DpaSection) => void }) {
  const { tenant } = useAuth();
  const fleetScope = useFleetScope();
  const [stats, setStats] = useState<DpaStats>({ pendingApprovals: 0, approvedDocs: 0 });
  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [vesselCount, setVesselCount] = useState(0);
  const [vessels, setVessels] = useState<VesselRow[]>([]);

  useEffect(() => {
    if (!tenant) return;
    if (isDemoMode()) {
      const docs = getEffectiveDemoSmsDocs(tenant.id);
      const demoVessels = fleetScope.filterVessels(getEffectiveDemoVessels(tenant.id));
      setStats({
        pendingApprovals: docs.filter((d) => d.approval_state === 'pending_dpa' && d.node_kind === 'document').length,
        approvedDocs: docs.filter((d) => d.approval_state === 'approved' && d.node_kind === 'document').length,
      });
      setVesselCount(demoVessels.length);
      setVessels(demoVessels);
      loadProfiles(tenant.id).then((list) => setProfiles(fleetScope.filterProfiles(list)));
      return;
    }
    (async () => {
      let vesselCountQuery = supabase.from('vessels').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id);
      if (fleetScope.isRestricted) vesselCountQuery = vesselCountQuery.in('id', fleetScope.assignedVesselIds);
      let smsQuery = supabase.from('sms_documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id);
      const [{ count: pending }, { count: approved }, { count: vessels }] = await Promise.all([
        smsQuery.eq('approval_state', 'pending_dpa').eq('node_kind', 'document'),
        supabase.from('sms_documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('approval_state', 'approved').eq('node_kind', 'document'),
        vesselCountQuery,
      ]);
      setStats({
        pendingApprovals: pending ?? 0,
        approvedDocs: approved ?? 0,
      });
      setVesselCount(vessels ?? 0);
      let vesselDataQuery = supabase.from('vessels').select('*').eq('tenant_id', tenant.id);
      if (fleetScope.isRestricted) vesselDataQuery = vesselDataQuery.in('id', fleetScope.assignedVesselIds);
      const { data: vData } = await vesselDataQuery;
      setVessels((vData ?? []) as unknown as VesselRow[]);
      loadProfiles(tenant.id).then((list) => setProfiles(fleetScope.filterProfiles(list)));
    })();
  }, [tenant, fleetScope.isGlobal, fleetScope.assignedVesselIds.join(','), fleetScope.assignedFleetProfileIds.join(',')]);

  const cards = [
    { label: 'Pending SMS Approvals', value: stats.pendingApprovals, icon: <Clock className="h-5 w-5" />, section: 'approvals' as DpaSection, tone: 'warning' },
    { label: 'Approved SMS Documents', value: stats.approvedDocs, icon: <CheckCircle2 className="h-5 w-5" />, section: 'master_library' as DpaSection, tone: 'success' },
  ];

  return (
    <div className="space-y-5">
      {/* Consolidated Header — title + launchpad pill */}
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-accent-500" />
          <div>
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">DPA SMS Governance Dashboard</h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Designated Person Ashore · {tenant?.company}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2.5 rounded-full border border-ink-200/70 bg-white px-4 py-2 shadow-sm dark:border-ink-800 dark:bg-ink-900 sm:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent-500 to-primary-500 text-white">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold text-ink-700 dark:text-ink-200">Shore Operations</span>
          <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">{vesselCount} vessels</span>
        </div>
      </div>

      {/* Shore Operations Launchpad */}
      <ShoreLaunchpadView
        onNavigate={(key) => {
          if (key === 'sms_documentation') onNavigate('approvals');
        }}
        accent="accent"
      />

      {/* 2-Column Metrics Dashboard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: SMS Metrics & Actions */}
        <div className="space-y-4">
          {/* SMS Version + Fleet Profiles */}
          <div className="flex flex-col gap-4 rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-primary-500 text-white">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Active SMS Version</p>
                <p className="text-lg font-bold text-ink-900 dark:text-white">v{tenant?.sms_version ?? '—'}</p>
              </div>
            </div>
            <div className="h-px w-full bg-ink-100 dark:bg-ink-800" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Assigned Fleet Profiles</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {profiles.length === 0 ? (
                  <span className="text-sm text-ink-400">No profiles configured</span>
                ) : profiles.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                    <Ship className="h-3 w-3" />
                    {p.name}
                    <span className="text-accent-400">· {p.vesselCount} vessel{p.vesselCount !== 1 ? 's' : ''}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="h-px w-full bg-ink-100 dark:bg-ink-800" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Total Vessels</p>
              <p className="text-lg font-bold text-ink-900 dark:text-white">{vesselCount}</p>
            </div>
          </div>

          {/* Counter Cards */}
          <div className="grid grid-cols-2 gap-4">
            {cards.map((c) => (
              <button
                key={c.label}
                onClick={() => onNavigate(c.section)}
                className="group flex flex-col gap-3 rounded-xl border border-ink-200/70 bg-white p-4 text-left shadow-sm transition hover:border-accent-300 hover:shadow-md dark:border-ink-800 dark:bg-ink-900"
              >
                <div className="flex items-center justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    c.tone === 'warning' ? 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300' :
                    'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-300'
                  }`}>{c.icon}</div>
                  <ArrowRight className="h-4 w-4 text-ink-300 transition group-hover:translate-x-1 group-hover:text-accent-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-900 dark:text-white">{c.value}</p>
                  <p className="text-xs text-ink-500">{c.label}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Primary Actions */}
          <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <h3 className="mb-3 text-sm font-bold text-ink-900 dark:text-white">Primary Actions</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ActionCard
                icon={<FileText className="h-5 w-5" />}
                title="Review Pending SMS Documents"
                desc="Inspect admin-uploaded drafts against the approved baseline. Approve & push to fleet, or reject with comments."
                onClick={() => onNavigate('approvals')}
                tone="warning"
                badge={stats.pendingApprovals > 0 ? `${stats.pendingApprovals} pending` : undefined}
              />
              <ActionCard
                icon={<BookOpen className="h-5 w-5" />}
                title="Read / Print SMS Manuals"
                desc="Browse the approved SMS document tree. Read and print published manuals for any fleet profile."
                onClick={() => onNavigate('master_library')}
                tone="success"
                badge={`${stats.approvedDocs} approved`}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Fleet Sync Status */}
        <div>
          <FleetSyncWidget vessels={vessels} tenantId={tenant?.id ?? null} />
        </div>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick, tone, badge }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void;
  tone: 'warning' | 'success'; badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-ink-200/70 bg-ink-50/50 p-4 text-left transition hover:border-accent-300 hover:bg-accent-50/30 dark:border-ink-800 dark:bg-ink-800/30 dark:hover:bg-accent-900/20"
    >
      <div className="flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
          tone === 'warning' ? 'bg-warning-100 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300' :
          'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-300'
        }`}>{icon}</div>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            tone === 'warning' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' :
            'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
          }`}>{badge}</span>
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-ink-900 dark:text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{desc}</p>
      </div>
      <div className="flex items-center gap-1 text-xs font-semibold text-accent-600 dark:text-accent-400">
        Open <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
      </div>
    </button>
  );
}
