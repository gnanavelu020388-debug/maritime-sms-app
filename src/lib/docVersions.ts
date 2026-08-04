/**
 * Document versioning library — preserves revision history for SMS documents.
 * Each re-upload saves the previous content as a historical version in
 * sms_document_versions, enabling point-in-time recovery and audit trails.
 */

import { supabase, type SmsDocRow } from './supabase';
import { isDemoMode } from './demoData';

export interface DocVersionRow {
  id: string;
  tenant_id: string;
  document_id: string;
  revision: number;
  version_label: string;
  content: string | null;
  content_kind: string;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * Save a snapshot of a document's current content as a new revision.
 * Called before any content update to preserve the previous version.
 */
export async function saveDocumentVersion(
  tenantId: string,
  doc: SmsDocRow,
  uploadedBy: string
): Promise<DocVersionRow | null> {
  if (isDemoMode()) {
    // In demo mode, store versions in memory only
    return {
      id: `demo-v-${Date.now()}`,
      tenant_id: tenantId,
      document_id: doc.id,
      revision: parseInt(doc.version.replace(/^v/, '').split('.')[1] ?? '1', 10),
      version_label: doc.version,
      content: doc.content,
      content_kind: doc.content_kind ?? 'rich_text',
      uploaded_by: uploadedBy,
      created_at: new Date().toISOString(),
    };
  }

  // Determine the next revision number
  const { data: existing } = await supabase
    .from('sms_document_versions')
    .select('revision')
    .eq('tenant_id', tenantId)
    .eq('document_id', doc.id)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextRevision = (existing?.revision ?? 0) + 1;

  const { data, error } = await supabase
    .from('sms_document_versions')
    .insert({
      tenant_id: tenantId,
      document_id: doc.id,
      revision: nextRevision,
      version_label: doc.version,
      content: doc.content,
      content_kind: doc.content_kind ?? 'rich_text',
      uploaded_by: uploadedBy,
    })
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return data as DocVersionRow;
}

/**
 * Fetch all historical versions of a document, newest first.
 */
export async function fetchDocumentVersions(
  tenantId: string,
  documentId: string
): Promise<DocVersionRow[]> {
  if (isDemoMode()) return [];

  const { data, error } = await supabase
    .from('sms_document_versions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('document_id', documentId)
    .order('revision', { ascending: false });

  if (error || !data) return [];
  return data as DocVersionRow[];
}

/**
 * Restore a document to a previous revision's content.
 * Returns the content and version_label to apply to the document.
 */
export async function restoreDocumentVersion(
  tenantId: string,
  documentId: string,
  revision: number
): Promise<{ content: string | null; version_label: string } | null> {
  if (isDemoMode()) return null;

  const { data, error } = await supabase
    .from('sms_document_versions')
    .select('content, version_label')
    .eq('tenant_id', tenantId)
    .eq('document_id', documentId)
    .eq('revision', revision)
    .maybeSingle();

  if (error || !data) return null;
  return data as { content: string | null; version_label: string };
}
