import { useEffect, useState } from 'react';
import {
  Anchor, KeyRound, Loader2, BadgeCheck, AlertTriangle,
  ShieldAlert, ChevronDown, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { supabase, type TenantUserRow, type Rank } from '../../lib/supabase';
import { isDemoMode, getEffectiveDemoUsers, getEffectiveDemoAssignments } from '../../lib/demoData';
import { logAudit } from '../../lib/audit';
import { postSyncEvent } from '../../lib/syncChannel';

export function EmergencyControlsPanel({
  tenantId, vesselId, vesselName, actorEmail, actorRank,
}: {
  tenantId: string;
  vesselId: string | null;
  vesselName: string;
  actorEmail: string;
  actorRank: Rank | null;
}) {
  const [activeSection, setActiveSection] = useState<'password' | 'handover' | null>(null);
  const [onboard, setOnboard] = useState<TenantUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [resetFor, setResetFor] = useState<TenantUserRow | null>(null);
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);

  const [handoverCode, setHandoverCode] = useState('');
  const [seamansBook, setSeamansBook] = useState('');
  const [cocNumber, setCocNumber] = useState('');
  const [newMasterName, setNewMasterName] = useState('');

  const load = async () => {
    if (!tenantId || !vesselId) { setLoading(false); return; }
    setLoading(true);
    if (isDemoMode()) {
      const allUsers = getEffectiveDemoUsers(tenantId);
      const allAssignments = getEffectiveDemoAssignments(tenantId);
      const onboardUserIds = new Set(allAssignments.filter((a) => a.vessel_id === vesselId && !a.signed_off_at).map((a) => a.user_id));
      setOnboard(allUsers.filter((u) => onboardUserIds.has(u.id)));
      setLoading(false);
      return;
    }
    const [{ data: assignments }, { data: users }] = await Promise.all([
      supabase.from('crew_assignments').select('user_id').eq('tenant_id', tenantId).eq('vessel_id', vesselId).is('signed_off_at', null),
      supabase.from('tenant_users').select('*').eq('tenant_id', tenantId).eq('role', 'vessel'),
    ]);
    const onboardIds = new Set((assignments as { user_id: string }[])?.map((a) => a.user_id) ?? []);
    setOnboard((users as TenantUserRow[])?.filter((u) => onboardIds.has(u.id)) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId, vesselId]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 6000);
  }

  function generateOtp(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let otp = '';
    for (let i = 0; i < 8; i++) otp += chars[Math.floor(Math.random() * chars.length)];
    return otp;
  }

  async function handleGeneratePasswordReset(user: TenantUserRow) {
    setBusy(true);
    const otp = generateOtp();
    setGeneratedOtp(otp);

    if (!isDemoMode()) {
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: otp });
      if (error) {
        showToast(`Failed to reset password: ${error.message}`, false);
        setBusy(false);
        return;
      }
    }

    await logAudit({
      tenantId,
      actorEmail,
      category: 'security',
      action: `EMERGENCY PASSWORD RESET: Master ${actorEmail} generated temporary OTP for ${user.name} (${user.rank}) on ${vesselName}.`,
      target: user.email,
      location: vesselName,
      severity: 'critical',
    });
    postSyncEvent({ type: 'CREW_UPDATED', tenantId, payload: { action: 'password_reset', userId: user.id, vessel: vesselName } });
    setBusy(false);
  }

  async function handleMasterHandover() {
    if (!handoverCode || !seamansBook || !cocNumber || !newMasterName) return;
    setBusy(true);

    await logAudit({
      tenantId,
      actorEmail,
      category: 'security',
      action: `EMERGENCY MASTER HANDOVER: ${newMasterName} executed emergency handover on ${vesselName}. Handover code: ${handoverCode}. Seaman's Book: ${seamansBook}. CoC: ${cocNumber}.`,
      target: newMasterName,
      location: vesselName,
      severity: 'critical',
    });

    await logAudit({
      tenantId,
      actorEmail: 'system@vessel',
      category: 'security',
      action: `DPA ALERT: Master Handover Executed on ${vesselName}. Incoming Master: ${newMasterName}. Verification: Seaman's Book ${seamansBook}, CoC ${cocNumber}. Immediate review recommended.`,
      target: 'dpa',
      location: vesselName,
      severity: 'critical',
    });

    postSyncEvent({ type: 'CREW_UPDATED', tenantId, payload: { action: 'master_handover', vessel: vesselName, newMaster: newMasterName } });
    setBusy(false);
    showToast(`Emergency Master Handover executed for ${newMasterName}. DPA has been alerted on shore. Audit entry created.`, true);
    setActiveSection(null);
    setHandoverCode('');
    setSeamansBook('');
    setCocNumber('');
    setNewMasterName('');
  }

  if (loading) {
    return <div className="py-10 text-center text-sm text-ink-400">Loading emergency controls…</div>;
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.ok ? 'bg-success-500 text-white' : 'bg-danger-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-danger-200 bg-danger-50 p-4 dark:border-danger-800 dark:bg-danger-900/20">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-100 text-danger-600 dark:bg-danger-900/40 dark:text-danger-400">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-danger-800 dark:text-danger-200">Emergency Onboard Controls</p>
          <p className="mt-1 text-xs text-danger-700 dark:text-danger-300">
            These tools are for use at sea when shore office IT support is unavailable. All actions are logged with <strong>critical severity</strong> to the audit trail and immediately alert the DPA on shore.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <button
          onClick={() => { setActiveSection(activeSection === 'password' ? null : 'password'); setGeneratedOtp(null); }}
          className="flex w-full items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-100 text-warning-600 dark:bg-warning-900/30 dark:text-warning-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-ink-900 dark:text-white">Emergency Password Reset</h3>
              <p className="text-[11px] text-ink-400">Generate a temporary OTP for a crew member who forgot their credentials</p>
            </div>
          </div>
          {activeSection === 'password' ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
        </button>

        {activeSection === 'password' && (
          <div className="border-t border-ink-100 p-4 dark:border-ink-800">
            {onboard.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-400">No crew currently on board.</p>
            ) : (
              <div className="space-y-2">
                {onboard.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 rounded-lg border border-ink-100 p-3 dark:border-ink-800">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                      {u.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-ink-800 dark:text-white">{u.name}</p>
                      <p className="text-[11px] text-ink-400">{u.rank}</p>
                    </div>
                    <button
                      onClick={() => { setResetFor(u); handleGeneratePasswordReset(u); }}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg bg-warning-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-warning-600 disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Generate OTP
                    </button>
                  </div>
                ))}

                {generatedOtp && resetFor && (
                  <div className="mt-4 rounded-lg border-2 border-success-300 bg-success-50 p-4 dark:border-success-700 dark:bg-success-900/20">
                    <div className="flex items-center gap-2">
                      <BadgeCheck className="h-5 w-5 text-success-600 dark:text-success-400" />
                      <p className="text-sm font-bold text-success-800 dark:text-success-200">Temporary Password Generated</p>
                    </div>
                    <p className="mt-2 text-xs text-success-700 dark:text-success-300">
                      Give this temporary password to <strong>{resetFor.name}</strong>. They must log in and change it immediately:
                    </p>
                    <div className="mt-2 rounded-lg border border-success-300 bg-white p-3 text-center dark:bg-ink-900">
                      <code className="text-2xl font-bold tracking-widest text-success-700 dark:text-success-300">{generatedOtp}</code>
                    </div>
                    <p className="mt-2 text-[11px] text-success-600 dark:text-success-400">
                      This action has been logged as critical severity. The DPA on shore has been notified.
                    </p>
                    <button onClick={() => { setGeneratedOtp(null); setResetFor(null); }} className="mt-3 w-full rounded-lg bg-success-600 py-2 text-xs font-bold text-white hover:bg-success-700">
                      Done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <button
          onClick={() => setActiveSection(activeSection === 'handover' ? null : 'handover')}
          className="flex w-full items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-100 text-danger-600 dark:bg-danger-900/30 dark:text-danger-400">
              <Anchor className="h-5 w-5" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-ink-900 dark:text-white">Emergency Master Handover Protocol</h3>
              <p className="text-[11px] text-ink-400">Transfer Master authority without waiting for shore office IT</p>
            </div>
          </div>
          {activeSection === 'handover' ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
        </button>

        {activeSection === 'handover' && (
          <div className="border-t border-ink-100 p-4 dark:border-ink-800">
            <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>Emergency use only.</strong> The incoming Master must provide a one-time handover code and Seaman's Book / CoC verification.
                Upon execution, the DPA on shore is immediately alerted with a critical audit entry: "Master Handover Executed on {vesselName}".
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Incoming Master's Full Name *</label>
                <input className="input" placeholder="e.g. Capt. Jane Smith" value={newMasterName} onChange={(e) => setNewMasterName(e.target.value)} />
              </div>
              <div>
                <label className="label">One-Time Handover Code *</label>
                <input className="input font-mono" placeholder="e.g. HDVR-2026-8842" value={handoverCode} onChange={(e) => setHandoverCode(e.target.value)} />
                <p className="mt-1 text-[11px] text-ink-400">Pre-issued by Company Admin or DPA before voyage.</p>
              </div>
              <div>
                <label className="label">Seaman's Book Number *</label>
                <input className="input font-mono" placeholder="e.g. SB-7492013" value={seamansBook} onChange={(e) => setSeamansBook(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Certificate of Competency (CoC) Number *</label>
                <input className="input font-mono" placeholder="e.g. CoC-MST-2025-04412" value={cocNumber} onChange={(e) => setCocNumber(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setActiveSection(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={handleMasterHandover}
                disabled={busy || !handoverCode || !seamansBook || !cocNumber || !newMasterName}
                className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700 flex items-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                Execute Emergency Handover
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
