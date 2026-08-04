/**
 * CompanySecuritySettings — Company Admin panel for configuring shipboard
 * session security: inactivity auto-logout timer and concurrent login toggle.
 * Persists to tenant_security_settings (production) or localStorage (demo).
 */

import { useEffect, useState } from 'react';
import { Shield, Clock, Monitor, Save, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import {
  useTenantSecuritySettings,
  setDemoSecuritySettings,
  type TenantSecuritySettings,
} from '../../lib/sessionSecurity';
import { isDemoMode } from '../../lib/demoData';
import { Toaster } from '../Toaster';

export function CompanySecuritySettings() {
  const { tenant, tenantUser } = useAuth();
  const { settings, loading } = useTenantSecuritySettings(tenant?.id);
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const [enforceSingle, setEnforceSingle] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (settings) {
      setTimeoutMinutes(settings.inactivity_timeout_minutes);
      setEnforceSingle(settings.enforce_single_session);
    }
  }, [settings]);

  async function handleSave() {
    if (!tenant?.id) return;
    setSaving(true);
    const newSettings: TenantSecuritySettings = {
      inactivity_timeout_minutes: timeoutMinutes,
      enforce_single_session: enforceSingle,
    };

    if (isDemoMode()) {
      setDemoSecuritySettings(tenant.id, newSettings);
      setSaving(false);
      setToast({ msg: 'Security settings saved (demo mode)', ok: true });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const { error } = await supabase.rpc('update_tenant_security_setting', {
      p_tenant_id: tenant.id,
      p_inactivity_timeout_minutes: timeoutMinutes,
      p_enforce_single_session: enforceSingle,
    });

    setSaving(false);
    if (error) {
      setToast({ msg: `Failed to save: ${error.message}`, ok: false });
    } else {
      setToast({ msg: 'Security settings saved — applies to all shipboard users', ok: true });
    }
    setTimeout(() => setToast(null), 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${
            toast.ok
              ? 'bg-success-500 text-white'
              : 'bg-danger-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-white">Security Settings</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Configure shipboard session security for {tenant?.company}. Changes apply to all vessel users immediately.
        </p>
      </div>

      {/* Inactivity Timeout */}
      <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">Shipboard Auto-Logout Inactivity Timer</h3>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              Vessel users are automatically logged out after this many minutes of no activity (mouse, keyboard, or touch).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-ink-200 dark:bg-ink-700 accent-warning-500"
          />
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-700 dark:bg-ink-800">
            <input
              type="number"
              min={5}
              max={120}
              value={timeoutMinutes}
              onChange={(e) => {
                const v = Math.max(5, Math.min(120, Number(e.target.value) || 5));
                setTimeoutMinutes(v);
              }}
              className="w-16 bg-transparent text-center text-sm font-bold text-ink-900 outline-none dark:text-white"
            />
            <span className="text-xs text-ink-500">min</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${timeoutMinutes <= 10 ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>
            {timeoutMinutes <= 10 ? 'Strict' : timeoutMinutes <= 30 ? 'Standard' : 'Relaxed'}
          </span>
          <span className="text-ink-400">
            Range: 5–120 minutes · Default: 15 minutes
          </span>
        </div>
      </div>

      {/* Concurrent Login Enforcement */}
      <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
            <Monitor className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">Single Concurrent Login Enforcement</h3>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              When enabled, a user can only be logged in on one device at a time. If they sign in on a second device, the first session is automatically terminated.
            </p>
          </div>
        </div>

        <button
          onClick={() => setEnforceSingle((v) => !v)}
          className={`flex items-center gap-3 rounded-lg border p-3 transition ${
            enforceSingle
              ? 'border-accent-300 bg-accent-50 dark:border-accent-700 dark:bg-accent-900/20'
              : 'border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-800/50'
          }`}
        >
          <div className={`relative h-6 w-11 rounded-full transition ${enforceSingle ? 'bg-accent-500' : 'bg-ink-300 dark:bg-ink-600'}`}>
            <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enforceSingle ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-ink-900 dark:text-white">
              {enforceSingle ? 'Enabled — One session per user' : 'Disabled — Multiple sessions allowed'}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {enforceSingle ? 'Second logins will terminate the previous session automatically.' : 'Users can be logged in on multiple devices simultaneously.'}
            </p>
          </div>
        </button>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-ink-400">
          {tenantUser?.email && <>Last updated by: {settings ? '' : '—'}</>}
        </span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Security Settings'}
        </button>
      </div>
    </div>
  );
}
