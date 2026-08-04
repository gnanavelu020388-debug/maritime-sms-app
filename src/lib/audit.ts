import { supabase } from './supabase';
import { postSyncEvent } from './syncChannel';

interface LogPayload {
  tenantId?: string | null;
  actorEmail: string;
  category: string;
  action: string;
  target?: string;
  location?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export async function logAudit({ tenantId, actorEmail, category, action, target, location, severity = 'info' }: LogPayload) {
  try {
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId ?? null,
      actor_email: actorEmail,
      category,
      action,
      target: target ?? null,
      ip_address: 'client',
      location: location ?? 'platform',
      severity,
    });
  } catch {
    // audit logging should never block the user flow
  }
  // Broadcast to all open windows so the Super Admin Immutable Audit Trail
  // streams live across tabs without requiring a manual page refresh.
  postSyncEvent({
    type: 'AUDIT_LOGGED',
    tenantId: tenantId ?? null,
    payload: { actorEmail, category, action, target, location, severity },
  });
}
