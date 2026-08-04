/**
 * Session security hooks for shipboard portals:
 * - useInactivityLogout: auto-logout after configurable idle period
 * - useSessionGuard: single concurrent login enforcement via DB session tokens
 * - useTenantSecuritySettings: read per-tenant security config
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { isDemoMode } from './demoData';

// ── Types ────────────────────────────────────────────────────────────

export interface TenantSecuritySettings {
  inactivity_timeout_minutes: number;
  enforce_single_session: boolean;
}

export interface SessionTokenRow {
  user_id: string;
  session_token: string;
  device_info: string | null;
  updated_at: string;
}

// ── Tenant security settings reader ──────────────────────────────────

const LS_DEMO_SECURITY = 'mpc-demo-tenant-security-settings';

export function getDemoSecuritySettings(tenantId: string): TenantSecuritySettings {
  try {
    const raw = localStorage.getItem(LS_DEMO_SECURITY);
    if (raw) {
      const all = JSON.parse(raw) as Record<string, TenantSecuritySettings>;
      return all[tenantId] ?? { inactivity_timeout_minutes: 15, enforce_single_session: true };
    }
  } catch { /* ignore */ }
  return { inactivity_timeout_minutes: 15, enforce_single_session: true };
}

export function setDemoSecuritySettings(tenantId: string, settings: TenantSecuritySettings): void {
  try {
    let all: Record<string, TenantSecuritySettings> = {};
    const raw = localStorage.getItem(LS_DEMO_SECURITY);
    if (raw) all = JSON.parse(raw);
    all[tenantId] = settings;
    localStorage.setItem(LS_DEMO_SECURITY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function useTenantSecuritySettings(tenantId: string | null | undefined): {
  settings: TenantSecuritySettings | null;
  loading: boolean;
} {
  const [settings, setSettings] = useState<TenantSecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) { setSettings(null); setLoading(false); return; }

    if (isDemoMode()) {
      setSettings(getDemoSecuritySettings(tenantId));
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      const { data } = await supabase
        .from('tenant_security_settings')
        .select('inactivity_timeout_minutes, enforce_single_session')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!active) return;
      setSettings(data ?? { inactivity_timeout_minutes: 15, enforce_single_session: true });
      setLoading(false);
    })();

    return () => { active = false; };
  }, [tenantId]);

  return { settings, loading };
}

// ── Inactivity auto-logout ───────────────────────────────────────────

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click',
];

export function useInactivityLogout(
  timeoutMinutes: number | null | undefined,
  onTimeout: () => void,
  enabled: boolean = true,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onTimeout);
  callbackRef.current = onTimeout;

  useEffect(() => {
    if (!enabled || !timeoutMinutes || timeoutMinutes <= 0) return;

    const ms = timeoutMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(), ms);
    };

    // Start timer immediately
    resetTimer();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetTimer);
      }
    };
  }, [timeoutMinutes, enabled]);
}

// ── Concurrent login prevention (single session enforcement) ─────────

function generateSessionToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const LS_DEMO_SESSIONS = 'mpc-demo-active-sessions';

interface DemoSessionEntry {
  user_id: string;
  session_token: string;
  updated_at: string;
}

function getDemoActiveSessions(): Record<string, DemoSessionEntry> {
  try {
    const raw = localStorage.getItem(LS_DEMO_SESSIONS);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function setDemoActiveSession(userId: string, token: string): void {
  const all = getDemoActiveSessions();
  all[userId] = { user_id: userId, session_token: token, updated_at: new Date().toISOString() };
  localStorage.setItem(LS_DEMO_SESSIONS, JSON.stringify(all));
}

function getDemoActiveSessionToken(userId: string): string | null {
  return getDemoActiveSessions()[userId]?.session_token ?? null;
}

/**
 * Generates and stores a new session token for a demo-mode user.
 * Returns the token so the demo auth provider can include it in state.
 */
export function generateDemoSessionToken(userId: string): string {
  const token = generateSessionToken();
  setDemoActiveSession(userId, token);
  return token;
}

export { getDemoActiveSessionToken };

/**
 * Registers a new session token for the current user on login, overwriting
 * any previous token (which terminates the old device's session).
 * Returns the new token. Works in both production (Supabase) and demo mode.
 */
export async function registerSessionToken(
  userId: string,
  deviceInfo?: string,
): Promise<string | null> {
  const token = generateSessionToken();

  if (isDemoMode()) {
    setDemoActiveSession(userId, token);
    return token;
  }

  const { error } = await supabase
    .from('user_session_tokens')
    .upsert(
      { user_id: userId, session_token: token, device_info: deviceInfo ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  if (error) return null;
  return token;
}

/**
 * Clears the session token for a user on logout.
 */
export async function clearSessionToken(userId: string): Promise<void> {
  if (isDemoMode()) {
    const all = getDemoActiveSessions();
    delete all[userId];
    localStorage.setItem(LS_DEMO_SESSIONS, JSON.stringify(all));
    return;
  }
  await supabase.from('user_session_tokens').delete().eq('user_id', userId);
}

/**
 * useSessionGuard — subscribes to the user_session_tokens row for the
 * current user. If another device logs in (overwriting the token), this
 * hook fires onConflict, which the caller uses to force-logout.
 *
 * In demo mode, polls localStorage every 3 seconds (no realtime in demo).
 */
export function useSessionGuard(
  userId: string | null | undefined,
  localToken: string | null,
  enforced: boolean,
  onConflict: () => void,
): void {
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;

  // Production: realtime subscription
  useEffect(() => {
    if (!userId || !localToken || !enforced || isDemoMode()) return;

    const channel = supabase
      .channel(`session-guard-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_session_tokens',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as SessionTokenRow;
          if (newRow.session_token !== localToken) {
            conflictRef.current();
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, localToken, enforced]);

  // Demo: poll localStorage
  useEffect(() => {
    if (!userId || !localToken || !enforced || !isDemoMode()) return;

    const interval = setInterval(() => {
      const currentToken = getDemoActiveSessionToken(userId);
      if (currentToken && currentToken !== localToken) {
        conflictRef.current();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [userId, localToken, enforced]);
}
