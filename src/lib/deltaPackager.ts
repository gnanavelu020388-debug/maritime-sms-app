import { supabase, type SmsDocRow } from './supabase';

/**
 * Delta Packager — compiles lightweight JSON delta packages on DPA "Approve & Deploy".
 *
 * When the DPA approves pending documents, the version bumps (e.g. v1.0.0 → v1.1.0).
 * Instead of pushing the entire SMS tree to every vessel, we compile only the
 * newly added/modified documents into a small JSON payload:
 *
 *   { upserted: SmsDocRow[], deleted: [{id, tree_kind}], fromVersion, toVersion }
 *
 * This delta is stored in `sms_delta_packages` so the vessel sync worker can
 * download just the patch over satellite.
 */

export interface DeltaPayload {
  upserted: SmsDocRow[];
  deleted: { id: string; tree_kind: string }[];
  from_version: string;
  to_version: string;
}

/** Bump the minor version: v1.0.0 → v1.1.0, v2.3.0 → v2.4.0 */
export function bumpVersion(v: string): string {
  const parts = v.split('.');
  const minor = parseInt(parts[1] ?? '0', 10) + 1;
  return `${parts[0] ?? '1'}.${minor}.0`;
}

/**
 * Build and persist a delta package for a tenant.
 * Captures all currently-approved documents as the "upserted" set relative to
 * the previous version. Deleted documents are tracked via the approved docs
 * that existed before but are absent now (best-effort: we compare current
 * approved set against the full table).
 *
 * Returns the stored delta payload, or null on failure.
 */
export async function buildAndStoreDelta(
  tenantId: string,
  fromVersion: string,
  toVersion: string,
  deployedBy: string,
): Promise<DeltaPayload | null> {
  // Fetch all currently-approved documents for this tenant
  const { data: approvedDocs, error } = await supabase
    .from('sms_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('approval_state', 'approved')
    .order('sort_order');

  if (error) {
    console.error('[deltaPackager] Failed to fetch approved docs:', error.message);
    return null;
  }

  const upserted = (approvedDocs as SmsDocRow[]) ?? [];

  // Best-effort deletion detection: fetch the previous delta's upserted IDs
  // and treat any that are missing from the current set as deleted.
  const deleted: { id: string; tree_kind: string }[] = [];
  const { data: prevDelta } = await supabase
    .from('sms_delta_packages')
    .select('delta_payload')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevUpserted = (prevDelta?.delta_payload as { upserted?: SmsDocRow[] } | null)?.upserted;
  if (prevUpserted && prevUpserted.length > 0) {
    const currentIds = new Set(upserted.map((d) => d.id));
    for (const doc of prevUpserted) {
      if (!currentIds.has(doc.id)) {
        deleted.push({ id: doc.id, tree_kind: doc.tree_kind });
      }
    }
  }

  const payload: DeltaPayload = {
    upserted,
    deleted,
    from_version: fromVersion,
    to_version: toVersion,
  };

  const { error: insertError } = await supabase.from('sms_delta_packages').insert({
    tenant_id: tenantId,
    from_version: fromVersion,
    to_version: toVersion,
    delta_payload: payload as unknown as Record<string, unknown>,
    deployed_by: deployedBy,
  });

  if (insertError) {
    console.error('[deltaPackager] Failed to store delta package:', insertError.message);
    return null;
  }

  return payload;
}
