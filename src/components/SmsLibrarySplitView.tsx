import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  FileText, Folder, ChevronRight, ChevronDown, Search, FolderTree,
  Eye, BookOpen, Bell, FileStack, Shield,
  Printer, ExternalLink, Loader2, Ship, Layers, Clock, CheckCircle2, AlertCircle,
  Pencil, Upload, FilePlus2, FolderPlus, AlertTriangle, Plus, XCircle, RotateCcw, Trash2,
} from 'lucide-react';
import { supabase, type SmsDocRow, type Rank, type VesselRow } from '../lib/supabase';
import { canDo, type RankPermissionMap, type AppId } from '../lib/rankPermissions';
import { isDemoMode, getEffectiveDemoSmsDocs, getDemoTenant, getDemoCustomTabs, saveDemoCustomTabs, demoUpdateSmsDocContent, demoCreateSmsDoc, demoResubmitSmsDoc, demoDeleteSmsDoc, getEffectiveDemoVessels } from '../lib/demoData';
import { loadProfiles, getProfileForVessel, type SmsProfileWithVessels, type SmsProfile } from '../lib/smsProfiles';
import { useFleetScope } from '../lib/useFleetScope';
import { getLocalDocuments, getLocalSmsVersion, isCacheSeeded } from '../lib/localVesselDb';
import { seedLocalCache } from '../lib/syncService';
import { onSyncEvent, postSyncEvent } from '../lib/syncChannel';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

interface TreeNode extends SmsDocRow {
  children: TreeNode[];
}

type DocType = 'Policy' | 'Procedure' | 'Manual' | 'Record' | 'Circular';

interface TabDef {
  key: string;
  label: string;
  subtitle: string;
  custom?: boolean;
}

const BUILTIN_TABS: TabDef[] = [
  { key: 'sms', label: 'SMS Documents', subtitle: 'Safety Management System' },
  { key: 'fleet_circulars', label: 'Fleet Circulars', subtitle: 'Company-wide directives' },
  { key: 'flag_state', label: 'Flag State Documents', subtitle: 'Flag authority requirements' },
];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildDocHtml(node: SmsDocRow, autoPrint: boolean): string {
  const title = escapeHtml(node.label);
  const body = escapeHtml(node.content ?? '');
  const printScript = autoPrint ? '<script>window.onload=function(){window.print();}</script>' : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Georgia,serif;max-width:1100px;margin:32px auto;padding:40px 56px;line-height:1.8;color:#1a202c;background:#fff;}h1{color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:24px;font-family:system-ui,sans-serif;}.meta{font-size:12px;color:#718096;margin-bottom:24px;font-family:system-ui,sans-serif;}.content{white-space:pre-wrap;font-size:15px;}</style>${printScript}</head><body><h1>${title}</h1><div class="meta">SMS Document &middot; Approved &middot; v${node.version}</div><div class="content">${body}</div></body></html>`;
}

function openDocInNewTab(node: SmsDocRow) {
  const blob = new Blob([buildDocHtml(node, false)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function printDoc(node: SmsDocRow) {
  const blob = new Blob([buildDocHtml(node, true)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function inferDocType(doc: SmsDocRow): DocType {
  const label = doc.label.toLowerCase();
  if (doc.tree_kind === 'fleet_circulars') return 'Circular';
  if (label.includes('circular')) return 'Circular';
  if (label.includes('policy')) return 'Policy';
  if (label.includes('procedure') || label.includes('procedure')) return 'Procedure';
  if (label.includes('form') || label.includes('checklist')) return 'Record';
  if (label.includes('record') || label.includes('log')) return 'Record';
  if (label.includes('manual') || label.includes('guide')) return 'Manual';
  return 'Procedure';
}

function filterEmptyFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => n.node_kind === 'folder' ? { ...n, children: filterEmptyFolders(n.children) } : n)
    .filter((n) => n.node_kind === 'document' || n.children.length > 0);
}

function findNodeInTree(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeInTree(n.children, id);
    if (found) return found;
  }
  return null;
}

function collectFolderIds(node: TreeNode): string[] {
  if (node.node_kind !== 'folder') return [];
  return [node.id, ...node.children.flatMap(collectFolderIds)];
}

// Module-level cache for PDF blob URLs created from local file picks.
// Keyed by doc id (for resubmitted PDFs) or a synthetic temp key (for new uploads).
const pdfBlobUrls = new Map<string, string>();

function sanitizeTabKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom';
}

interface MetricCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}

export interface SmsLibrarySplitViewProps {
  tenantId: string;
  vesselId?: string | null;
  readOnly?: boolean;
  enableProfileSelector?: boolean;
  crewRank?: Rank | null;
  rankPermissions?: RankPermissionMap | null;
  authorName?: string | null;
  authorRole?: string | null;
  authorOrigin?: string | null;
}

export function SmsLibrarySplitView({ tenantId, vesselId, readOnly = true, enableProfileSelector = false, rankPermissions = null, authorName = null, authorRole = null, authorOrigin = null }: SmsLibrarySplitViewProps) {
  const canEdit = !readOnly && canDo(rankPermissions, 'sms_documentation' as AppId, 'edit');
  const canUpload = !readOnly && canDo(rankPermissions, 'sms_documentation' as AppId, 'upload');
  const canCreate = canEdit || canUpload;
  const canPrint = canDo(rankPermissions, 'sms_documentation' as AppId, 'print');
  const fleetScope = useFleetScope();
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [previewDoc, setPreviewDoc] = useState<SmsDocRow | null>(null);
  const [editingDoc, setEditingDoc] = useState<SmsDocRow | null>(null);

  // Folder / document creation modals
  const [addFolderFor, setAddFolderFor] = useState<{ parentId: string | null } | null>(null);
  const [addDocFor, setAddDocFor] = useState<{ parentId: string | null } | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [newTabLabel, setNewTabLabel] = useState('');
  const [resubmitPdfPreviewUrl, setResubmitPdfPreviewUrl] = useState<string | null>(null);
  const [submittingDraft, setSubmittingDraft] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SmsDocRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Add Folder modal state
  const [addFolderLabel, setAddFolderLabel] = useState('');

  // Add Document modal state
  const [addDocLabel, setAddDocLabel] = useState('');
  const [addDocText, setAddDocText] = useState('');
  const [addDocMode, setAddDocMode] = useState<'rich_text' | 'pdf'>('rich_text');
  const [addDocPdfName, setAddDocPdfName] = useState('');
  const [addDocPdfSize, setAddDocPdfSize] = useState<number | null>(null);
  const [addDocSizeError, setAddDocSizeError] = useState('');
  const [addDocPdfPreviewUrl, setAddDocPdfPreviewUrl] = useState<string | null>(null);

  const canSubmitAddDoc = addDocLabel.trim().length > 0 && (addDocMode === 'rich_text' || (addDocMode === 'pdf' && addDocPdfName && !addDocSizeError));

  function resetAddDocForm() {
    setAddDocLabel('');
    setAddDocText('');
    setAddDocMode('rich_text');
    setAddDocPdfName('');
    setAddDocPdfSize(null);
    setAddDocSizeError('');
    if (addDocPdfPreviewUrl) URL.revokeObjectURL(addDocPdfPreviewUrl);
    setAddDocPdfPreviewUrl(null);
  }

  function handleAddDocFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeMb = file.size / (1024 * 1024);
    if (addDocPdfPreviewUrl) URL.revokeObjectURL(addDocPdfPreviewUrl);
    if (sizeMb > 25) {
      setAddDocSizeError(`File is ${sizeMb.toFixed(1)} MB — exceeds the 25 MB limit.`);
      setAddDocPdfName('');
      setAddDocPdfSize(null);
      setAddDocPdfPreviewUrl(null);
      return;
    }
    setAddDocSizeError('');
    setAddDocPdfName(file.name);
    setAddDocPdfSize(file.size);
    if (!addDocLabel.trim()) setAddDocLabel(file.name.replace(/\.pdf$/i, ''));
    setAddDocPdfPreviewUrl(URL.createObjectURL(file));
  }

  useEffect(() => {
    return () => { if (addDocPdfPreviewUrl) URL.revokeObjectURL(addDocPdfPreviewUrl); };
  }, [addDocPdfPreviewUrl]);

  async function handleCreateTab() {
    const label = newTabLabel.trim();
    if (!label) return;
    const key = sanitizeTabKey(label);
    const existing = new Set(tabs.map((t) => t.key));
    let finalKey = key;
    let i = 2;
    while (existing.has(finalKey)) { finalKey = `${key}_${i++}`; }
    const newTab: TabDef = { key: finalKey, label, subtitle: 'Custom document group', custom: true };
    if (isDemoMode()) {
      const demoTabs = getDemoCustomTabs(tenantId);
      demoTabs[finalKey] = { key: finalKey, label, subtitle: 'Custom document group' };
      saveDemoCustomTabs(tenantId, demoTabs);
    } else {
      const stored = localStorage.getItem(`sms-tabs-${tenantId}`);
      const map: Record<string, TabDef> = stored ? JSON.parse(stored) : {};
      map[finalKey] = newTab;
      localStorage.setItem(`sms-tabs-${tenantId}`, JSON.stringify(map));
    }
    setTabs((prev) => [...prev, newTab]);
    setActiveTabKey(finalKey);
    setExpanded(new Set());
    setAddTabOpen(false);
    setNewTabLabel('');
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'tab_created', label } });
    showToast(`Tab "${label}" created.`, true);
  }

  async function handleResubmitFolder(docId: string) {
    if (isDemoMode()) {
      demoResubmitSmsDoc(tenantId, docId, undefined, undefined, authorName, authorRole, authorOrigin);
    } else {
      await supabase.from('sms_documents').update({
        approval_state: 'pending_dpa',
        rejection_comments: null,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
        updated_at: new Date().toISOString(),
      }).eq('id', docId).eq('tenant_id', tenantId);
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'resubmitted', docId } });
    setSyncTick((t) => t + 1);
    setPreviewDoc(null);
    showToast('Folder resubmitted for DPA approval.', true);
  }

  async function handleResubmitDocument() {
    if (!editingDoc) return;
    setSubmittingDraft(true);
    const content = (draftContent.trim() || editingDoc.content) ?? '';
    const contentKind = editingDoc.content_kind ?? 'rich_text';
    if (isDemoMode()) {
      demoResubmitSmsDoc(tenantId, editingDoc.id, content, contentKind, authorName, authorRole, authorOrigin);
    } else {
      await supabase.from('sms_documents').update({
        content,
        content_kind: contentKind,
        approval_state: 'pending_dpa',
        rejection_comments: null,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDoc.id).eq('tenant_id', tenantId);
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'resubmitted', docId: editingDoc.id, label: editingDoc.label } });
    setSubmittingDraft(false);
    setEditingDoc(null);
    setDraftContent('');
    if (resubmitPdfPreviewUrl) { URL.revokeObjectURL(resubmitPdfPreviewUrl); setResubmitPdfPreviewUrl(null); }
    showToast(`"${editingDoc.label}" resubmitted for DPA approval.`, true);
  }

  async function handleDeleteDraft() {
    if (!deleteTarget) return;
    setDeleting(true);
    if (isDemoMode()) {
      demoDeleteSmsDoc(tenantId, deleteTarget.id);
    } else {
      await supabase.from('sms_documents').delete().eq('id', deleteTarget.id).eq('tenant_id', tenantId);
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'draft_deleted', docId: deleteTarget.id, label: deleteTarget.label } });
    setDeleting(false);
    setDeleteTarget(null);
    setPreviewDoc(null);
    setSyncTick((t) => t + 1);
    showToast(`Draft "${deleteTarget.label}" deleted.`, true);
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function submitDraftRevision() {
    if (!editingDoc) return;
    setSubmittingDraft(true);
    const content = (draftContent.trim() || editingDoc.content) ?? '';
    const contentKind = editingDoc.content_kind ?? 'rich_text';
    if (isDemoMode()) {
      demoUpdateSmsDocContent(tenantId, editingDoc.id, content, contentKind, authorName, authorRole, authorOrigin);
    } else {
      await supabase.from('sms_documents').update({
        content,
        content_kind: contentKind,
        approval_state: 'pending_dpa',
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDoc.id).eq('tenant_id', tenantId);
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'draft_revision', docId: editingDoc.id, label: editingDoc.label } });
    setSubmittingDraft(false);
    setEditingDoc(null);
    setDraftContent('');
    showToast(`Draft revision submitted for DPA approval: "${editingDoc.label}"`, true);
  }

  async function handleCreateFolder(label: string) {
    if (!addFolderFor || !label.trim()) return;
    if (isDemoMode()) {
      demoCreateSmsDoc(tenantId, {
        parent_id: addFolderFor.parentId,
        tree_kind: activeTabKey,
        label: label.trim(),
        node_kind: 'folder',
        content_kind: null,
        content: null,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
      });
    } else {
      await supabase.from('sms_documents').insert({
        tenant_id: tenantId,
        parent_id: addFolderFor.parentId,
        tree_kind: activeTabKey,
        label: label.trim(),
        node_kind: 'folder',
        content_kind: null,
        content: null,
        is_regulatory_header: false,
        approval_state: 'pending_dpa',
        version: '1.0.0',
        sort_order: 999,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
      });
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'folder_created', label } });
    if (addFolderFor.parentId) setExpanded((s) => new Set(s).add(addFolderFor.parentId!));
    setAddFolderFor(null);
    setSyncTick((t) => t + 1);
    showToast(`Folder "${label.trim()}" submitted for DPA approval.`, true);
  }

  async function handleCreateDocument(label: string, contentKind: 'rich_text' | 'pdf', content: string) {
    if (!addDocFor || !label.trim()) return;
    if (isDemoMode()) {
      demoCreateSmsDoc(tenantId, {
        parent_id: addDocFor.parentId,
        tree_kind: activeTabKey,
        label: label.trim(),
        node_kind: 'document',
        content_kind: contentKind,
        content,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
      });
    } else {
      await supabase.from('sms_documents').insert({
        tenant_id: tenantId,
        parent_id: addDocFor.parentId,
        tree_kind: activeTabKey,
        label: label.trim(),
        node_kind: 'document',
        content_kind: contentKind,
        content,
        is_regulatory_header: false,
        approval_state: 'pending_dpa',
        version: '1.0.0',
        sort_order: 999,
        author_name: authorName,
        author_role: authorRole,
        author_origin: authorOrigin,
      });
    }
    postSyncEvent({ type: 'SMS_UPDATED', tenantId, payload: { action: 'document_created', label } });
    if (contentKind === 'pdf' && addDocPdfPreviewUrl) {
      // Store the blob URL so the preview modal can render the PDF inline for pending docs
      // The new doc id is the last override or the returned id; for demo we search by label
      if (isDemoMode()) {
        const allDocs = getEffectiveDemoSmsDocs(tenantId, activeTabKey);
        const created = allDocs.find((d) => d.label === label.trim() && d.content_kind === 'pdf');
        if (created) pdfBlobUrls.set(created.id, addDocPdfPreviewUrl);
      }
    }
    if (addDocFor.parentId) setExpanded((s) => new Set(s).add(addDocFor.parentId!));
    setAddDocFor(null);
    setSyncTick((t) => t + 1);
    showToast(`"${label.trim()}" submitted for DPA approval.`, true);
  }

  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [vesselProfile, setVesselProfile] = useState<SmsProfile | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [activeTabKey, setActiveTabKey] = useState<string>('sms');
  const [syncTick, setSyncTick] = useState(0);
  const [vesselListOpen, setVesselListOpen] = useState(false);
  const [vesselList, setVesselList] = useState<VesselRow[]>([]);

  const activeProfileObj = profiles.find((p) => p.id === activeProfileId) ?? null;

  const assignedVessels = activeProfileObj?.vesselIds
    ? vesselList.filter((v) => activeProfileObj.vesselIds.includes(v.id))
    : [];
  const [dataSource, setDataSource] = useState<'local' | 'cloud' | 'seeding'>('local');

  const loadTree = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    let profile: SmsProfile | null = null;
    if (vesselId) {
      profile = await getProfileForVessel(tenantId, vesselId);
    }
    setVesselProfile(profile);

    const effectiveProfileId = profile?.id ?? (enableProfileSelector ? activeProfileId : null);

    let flat: SmsDocRow[] = [];

    if (isDemoMode()) {
      flat = getEffectiveDemoSmsDocs(tenantId, activeTabKey, effectiveProfileId)
        .filter((d) =>
          d.approval_state === 'approved' ||
          d.node_kind === 'folder' ||
          (canCreate && (d.approval_state === 'pending_dpa' || d.approval_state === 'rejected'))
        );
    } else {
      try {
        const seeded = await isCacheSeeded(tenantId);
        if (!seeded) {
          setDataSource('seeding');
          await seedLocalCache(tenantId);
        }
        const rawFlat = await getLocalDocuments(tenantId, activeTabKey, true);
        flat = effectiveProfileId ? rawFlat.filter((d) => d.profile_id === null || d.profile_id === effectiveProfileId) : rawFlat;
        if (canCreate) flat = flat.filter((d) => d.approval_state === 'approved' || d.approval_state === 'pending_dpa' || d.approval_state === 'rejected' || d.node_kind === 'folder');
        else flat = flat.filter((d) => d.approval_state === 'approved' || d.node_kind === 'folder');
        setDataSource('local');
      } catch {
        setDataSource('cloud');
        const query = supabase.from('sms_documents').select('*').eq('tenant_id', tenantId).eq('tree_kind', activeTabKey).order('sort_order');
        if (!canCreate) query.eq('approval_state', 'approved');
        const { data } = await query;
        flat = (data as SmsDocRow[]) ?? [];
        if (effectiveProfileId) flat = flat.filter((d) => d.profile_id === null || d.profile_id === effectiveProfileId);
      }
    }

    const map = new Map<string, TreeNode>();
    flat.forEach((r) => map.set(r.id, { ...r, children: [] }));
    const tree: TreeNode[] = [];
    flat.forEach((r) => {
      const node = map.get(r.id)!;
      if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node);
      else tree.push(node);
    });
    const filtered = canCreate ? tree : filterEmptyFolders(tree);
    setRoots(filtered);

    setExpanded((prev) => {
      const next = new Set<string>();
      const existingFolderIds = new Set<string>();
      function collectFolderIdsInTree(nodes: TreeNode[]) {
        for (const n of nodes) {
          if (n.node_kind === 'folder') existingFolderIds.add(n.id);
          collectFolderIdsInTree(n.children);
        }
      }
      collectFolderIdsInTree(filtered);
      for (const id of prev) { if (existingFolderIds.has(id)) next.add(id); }
      return next;
    });

    setLoading(false);
  }, [tenantId, vesselId, syncTick, enableProfileSelector, activeProfileId, activeTabKey, canCreate]);

  useEffect(() => { loadTree(); }, [loadTree]);

  const loadTabs = useCallback(async () => {
    if (!tenantId) return;
    if (isDemoMode()) {
      const demoTabs = getDemoCustomTabs(tenantId);
      const demoTabDefs: TabDef[] = Object.values(demoTabs).map((v) => ({ ...v, custom: true }));
      setTabs([...BUILTIN_TABS, ...demoTabDefs]);
      return;
    }
    const stored = localStorage.getItem(`sms-tabs-${tenantId}`);
    const map: Record<string, TabDef> = {};
    if (stored) { try { Object.assign(map, JSON.parse(stored)); } catch { /* ignore */ } }
    const { data } = await supabase.from('sms_documents').select('tree_kind').eq('tenant_id', tenantId);
    const kinds = new Set((data as Pick<SmsDocRow, 'tree_kind'>[] | null)?.map((d) => d.tree_kind) ?? []);
    const builtins = new Set(BUILTIN_TABS.map((t) => t.key));
    for (const k of kinds) {
      if (!builtins.has(k) && !map[k]) map[k] = { key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), subtitle: 'Custom document group', custom: true };
    }
    setTabs([...BUILTIN_TABS, ...Object.values(map)]);
  }, [tenantId]);

  const loadTabCounts = useCallback(async () => {
    if (!tenantId) return;
    const effectiveProfileId = vesselProfile?.id ?? (enableProfileSelector ? activeProfileId : null);
    let allDocs: SmsDocRow[];
    if (isDemoMode()) {
      allDocs = getEffectiveDemoSmsDocs(tenantId, undefined, effectiveProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('tree_kind, node_kind, profile_id, approval_state').eq('tenant_id', tenantId);
      let raw = (data as SmsDocRow[]) ?? [];
      if (effectiveProfileId) raw = raw.filter((d) => d.profile_id === null || d.profile_id === effectiveProfileId);
      allDocs = raw;
    }
    const counts: Record<string, number> = {};
    for (const d of allDocs) {
      if (d.node_kind === 'document' && d.approval_state === 'approved') counts[d.tree_kind] = (counts[d.tree_kind] ?? 0) + 1;
    }
    setTabCounts(counts);
  }, [tenantId, vesselProfile?.id, enableProfileSelector, activeProfileId]);

  useEffect(() => { loadTabs(); }, [loadTabs, syncTick]);
  useEffect(() => { loadTabCounts(); }, [loadTabCounts, syncTick]);

  useEffect(() => {
    if (!tenantId) return;
    loadProfiles(tenantId).then((list) => {
      const scoped = fleetScope.filterProfiles(list);
      setProfiles(scoped);
      if (enableProfileSelector) {
        if (activeProfileId && !scoped.some((p) => p.id === activeProfileId)) {
          const def = scoped.find((p) => p.is_default) ?? scoped[0];
          setActiveProfileId(def?.id ?? null);
        } else if (!activeProfileId && scoped.length > 0) {
          const def = scoped.find((p) => p.is_default) ?? scoped[0];
          setActiveProfileId(def.id);
        }
      }
    });
  }, [tenantId, syncTick, fleetScope.isGlobal, fleetScope.assignedVesselIds.join(','), fleetScope.assignedFleetProfileIds.join(',')]);

  useEffect(() => {
    if (!tenantId) return;
    if (isDemoMode()) {
      setVesselList(fleetScope.filterVessels(getEffectiveDemoVessels(tenantId)));
    } else {
      supabase.from('vessels').select('id, tenant_id, name, imo_number, call_sign, flag_state, port_of_registry, gross_tonnage, kw_power, vessel_type, class_society, sms_active_version').eq('tenant_id', tenantId).order('name').then(({ data }) => {
        setVesselList(fleetScope.filterVessels((data as VesselRow[]) ?? []));
      });
    }
  }, [tenantId, syncTick, fleetScope.isGlobal, fleetScope.assignedVesselIds.join(',')]);

  useEffect(() => {
    if (!tenantId) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenantId) return;
      if (evt.type === 'SMS_UPDATED' || evt.type === 'PROFILES_UPDATED' || evt.type === 'VESSELS_UPDATED') {
        setSyncTick((t) => t + 1);
      }
    });
    return off;
  }, [tenantId]);

  const toggle = (id: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) {
      const node = findNodeInTree(roots, id);
      if (node) {
        collectFolderIds(node).forEach((fid) => next.delete(fid));
      } else {
        next.delete(id);
      }
    } else {
      next.add(id);
    }
    return next;
  });

  function handleTabChange(key: string) {
    if (key === activeTabKey) return;
    setActiveTabKey(key);
    setExpanded(new Set());
    setSearch('');
    setTypeFilter('all');
  }

  const metrics: MetricCard[] = useMemo(() => {
    const total = Object.values(tabCounts).reduce((a, b) => a + b, 0);
    const tabIcons: Record<string, React.ReactNode> = {
      sms: <BookOpen className="h-4 w-4" />,
      fleet_circulars: <Bell className="h-4 w-4" />,
      flag_state: <Shield className="h-4 w-4" />,
    };
    const tabTones: Record<string, string> = {
      sms: 'accent',
      fleet_circulars: 'success',
      flag_state: 'info',
    };
    const cards: MetricCard[] = [
      { label: 'Total Documents', value: total, icon: <FileStack className="h-4 w-4" />, tone: 'primary' },
    ];
    for (const tab of tabs) {
      cards.push({
        label: tab.label,
        value: tabCounts[tab.key] ?? 0,
        icon: tabIcons[tab.key] ?? <FileText className="h-4 w-4" />,
        tone: tabTones[tab.key] ?? 'warning',
      });
    }
    return cards;
  }, [tabs, tabCounts]);

  const docTypes = [
    { value: 'all', label: 'All Types' },
    { value: 'Procedure', label: 'Procedure' },
    { value: 'Policy', label: 'Policy' },
    { value: 'Record', label: 'Form / Checklist' },
    { value: 'Circular', label: 'Circular' },
  ];

  const isFiltering = !!search || typeFilter !== 'all';

  function isNodeVisible(node: TreeNode): boolean {
    if (node.node_kind === 'document') {
      if (node.approval_state !== 'approved' && !canCreate) return false;
      if (typeFilter !== 'all' && inferDocType(node) !== typeFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!node.label.toLowerCase().includes(s) && !(node.content ?? '').toLowerCase().includes(s)) return false;
      }
      return true;
    }
    // Folder: visible if itself is pending/rejected (for creators) or has visible children
    if (node.approval_state === 'pending_dpa' || node.approval_state === 'rejected') {
      return canCreate;
    }
    return node.children.some((c) => isNodeVisible(c));
  }

  function renderTreeNode(node: TreeNode, depth: number): React.ReactNode {
    if (!isNodeVisible(node)) return null;
    const isOpen = isFiltering || expanded.has(node.id);

    if (node.node_kind === 'document') {
      const docType = inferDocType(node);
      const isPending = node.approval_state === 'pending_dpa';
      const isRejected = node.approval_state === 'rejected';
      const isNotApproved = isPending || isRejected;
      return (
        <div
          key={node.id}
          onClick={() => setPreviewDoc(node)}
          className="group flex cursor-pointer items-center gap-2 rounded-md py-2 pr-3 transition-colors hover:bg-primary-50/50 dark:hover:bg-ink-800/50"
          style={{ paddingLeft: `${depth * 20 + 28}px` }}
        >
          {node.content_kind === 'pdf' ? (
            <FileText className={`h-4 w-4 shrink-0 ${isRejected ? 'text-danger-600' : 'text-danger-500'}`} />
          ) : (
            <FileText className={`h-4 w-4 shrink-0 ${isRejected ? 'text-danger-500' : 'text-primary-500'}`} />
          )}
          <span className={`min-w-0 flex-1 truncate font-medium transition-colors group-hover:text-primary-600 dark:text-ink-200 ${isNotApproved ? 'text-ink-500 italic' : 'text-ink-700'}`}>
            {node.label}
          </span>
          {node.content_kind === 'pdf' && (
            <span className="shrink-0 rounded bg-danger-100 px-1 text-[9px] font-bold text-danger-600 dark:bg-danger-900/30 dark:text-danger-400">PDF</span>
          )}
          {isPending && (
            <span className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[9px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">{node.content_kind === 'pdf' ? 'PDF PENDING' : 'PENDING'}</span>
          )}
          {isRejected && (
            <span className="shrink-0 rounded-full bg-danger-100 px-2 py-0.5 text-[9px] font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">REJECTED</span>
          )}
          {!isNotApproved && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              docType === 'Policy' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' :
              docType === 'Procedure' ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' :
              docType === 'Manual' ? 'bg-ink-100 text-ink-700 dark:bg-ink-700 dark:text-ink-200' :
              docType === 'Record' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' :
              'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
            }`}>{docType}</span>
          )}
          {!isNotApproved && <span className="shrink-0 text-[10px] text-ink-400">v{node.version}</span>}
          {canEdit && isRejected && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingDoc(node); setDraftContent(node.content ?? ''); }}
              className="shrink-0 rounded p-1 text-danger-400 transition-colors hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/40"
              title="Edit & Resubmit"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {canEdit && isNotApproved && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(node); }}
              className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/40"
              title="Delete Draft"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {canEdit && !isNotApproved && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingDoc(node); }}
              className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-accent-100 hover:text-accent-600 dark:hover:bg-accent-900/40"
              title="Edit Document / Draft Revision"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); openDocInNewTab(node); }}
            className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
            title="Open in New Tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    // Folder
    const childCount = node.children.filter((c) => c.node_kind === 'document' && c.approval_state === 'approved').length;
    const isPendingFolder = node.approval_state === 'pending_dpa';
    const isRejectedFolder = node.approval_state === 'rejected';
    return (
      <div key={node.id}>
        <div
          onClick={() => toggle(node.id)}
          className="group flex cursor-pointer items-center gap-1.5 rounded-md py-2 pr-3 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
          <Folder className={`h-4 w-4 shrink-0 ${isRejectedFolder ? 'text-danger-500' : isPendingFolder ? 'text-warning-500' : 'text-accent-500'}`} />
          <span className={`min-w-0 flex-1 truncate font-semibold ${isRejectedFolder ? 'text-danger-700 dark:text-danger-300' : isPendingFolder ? 'text-ink-500 italic' : 'text-ink-800 dark:text-ink-200'}`}>{node.label}</span>
          {isPendingFolder && (
            <span className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[9px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">PENDING</span>
          )}
          {isRejectedFolder && (
            <span className="shrink-0 rounded-full bg-danger-100 px-2 py-0.5 text-[9px] font-bold text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">REJECTED</span>
          )}
          {childCount > 0 && (
            <span className="shrink-0 rounded-full bg-ink-100 px-1.5 text-[10px] font-bold text-ink-500 dark:bg-ink-700 dark:text-ink-300">
              {childCount}
            </span>
          )}
          {canCreate && !isRejectedFolder && !isPendingFolder && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); setAddFolderFor({ parentId: node.id }); }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-accent-600 transition-colors hover:bg-accent-100 dark:text-accent-400 dark:hover:bg-accent-900/30"
                title="Add subfolder"
              >
                <FolderPlus className="h-3.5 w-3.5" /> Subfolder
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAddDocFor({ parentId: node.id }); }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary-600 transition-colors hover:bg-primary-100 dark:text-primary-400 dark:hover:bg-primary-900/30"
                title="Add document"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Document
              </button>
            </div>
          )}
          {canCreate && (isRejectedFolder || isPendingFolder) && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(node); }}
              className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/40"
              title="Delete Draft Folder"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {isOpen && node.children.map((c) => renderTreeNode(c, depth + 1))}
      </div>
    );
  }

  const smsVersion = isDemoMode() ? (getDemoTenant(tenantId)?.sms_version ?? '—') : '—';
  const activeTab = tabs.find((t) => t.key === activeTabKey);

  return (
    <div className="space-y-4">
      {/* TOP HEADER */}
      <div>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">SAFETY MANAGEMENT SYSTEM (SMS)</h1>
        </div>
      </div>

      {/* FLEET PROFILE SELECTOR */}
      {enableProfileSelector && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500"><Layers className="h-3.5 w-3.5" /> Fleet Profile:</div>
          <div className="relative">
            <button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink-800 hover:border-teal-400 dark:border-ink-700 dark:bg-ink-800 dark:text-white"
            >
              <Ship className="h-3.5 w-3.5 text-teal-500" />
              {profiles.find((p) => p.id === activeProfileId)?.name ?? 'All Profiles'}
              <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
            </button>
            {profileDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setProfileDropdownOpen(false)} />
                <div className="absolute left-0 z-40 mt-1 min-w-[260px] rounded-lg border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setActiveProfileId(p.id); setProfileDropdownOpen(false); }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800 ${activeProfileId === p.id ? 'font-bold text-teal-700 dark:text-teal-300' : 'text-ink-700 dark:text-ink-200'}`}
                    >
                      <span className="flex items-center gap-2 truncate"><Ship className="h-3.5 w-3.5 text-teal-500" />{p.name}</span>
                      <span className="text-[10px] text-ink-400">{p.vesselCount} vessel{p.vesselCount !== 1 ? 's' : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {activeProfileId && (
            <div className="relative">
              <button
                onClick={() => setVesselListOpen(!vesselListOpen)}
                className="flex items-center gap-1.5 rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-700 transition hover:bg-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:hover:bg-teal-900/50"
              >
                {activeProfileObj?.vesselCount ?? 0} Vessel{(activeProfileObj?.vesselCount ?? 0) !== 1 ? 's' : ''} Assigned
                {vesselListOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {vesselListOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setVesselListOpen(false)} />
                  <div className="absolute left-0 top-full z-40 mt-1 min-w-[320px] rounded-lg border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
                    <div className="border-b border-ink-100 px-3 py-2 dark:border-ink-800">
                      <p className="text-xs font-bold text-ink-700 dark:text-ink-200">Assigned to {activeProfileObj?.name ?? 'Profile'}</p>
                      <p className="text-[10px] text-ink-400">{assignedVessels.length} vessel{assignedVessels.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="max-h-[280px] overflow-y-auto">
                      {assignedVessels.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-ink-400">No vessels assigned to this profile.</p>
                      ) : assignedVessels.map((v) => (
                        <div key={v.id} className="flex items-center gap-2.5 px-3 py-2.5 transition hover:bg-ink-50 dark:hover:bg-ink-800">
                          <Ship className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-200">{v.name}</p>
                            <p className="text-[10px] text-ink-400">{v.vessel_type ?? 'Unknown type'} · IMO {v.imo_number ?? '—'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* METRICS BAR */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-3 rounded-xl border border-ink-200/70 bg-white p-3.5 dark:border-ink-800 dark:bg-ink-900">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              m.tone === 'primary' ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300' :
              m.tone === 'accent' ? 'bg-accent-100 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300' :
              m.tone === 'info' ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300' :
              m.tone === 'warning' ? 'bg-warning-100 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300' :
              'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-300'
            }`}>{m.icon}</div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-ink-900 dark:text-white">{m.value}</p>
              <p className="whitespace-normal text-[11px] font-medium leading-tight text-ink-500 dark:text-ink-400">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* HORIZONTAL CATEGORY TABS + INLINE NEW TAB */}
      <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {tabs.map((t) => {
            const count = tabCounts[t.key] ?? 0;
            const isActive = activeTabKey === t.key;
            return (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`flex items-center gap-1.5 rounded-md py-2 px-3 text-sm font-semibold transition ${isActive ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-300'}`}
              >
                {t.label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 text-[9px] ${isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {canCreate && (
          <button
            onClick={() => setAddTabOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-ink-300 px-2.5 py-1.5 text-xs font-bold text-ink-600 transition hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 dark:border-ink-600 dark:text-ink-300 dark:hover:border-accent-600 dark:hover:bg-accent-900/30"
          >
            <Plus className="h-3.5 w-3.5" /> New Tab
          </button>
        )}
      </div>

      {/* DOCUMENT TREE PANEL */}
      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        {/* Panel header */}
        <div className="flex flex-col gap-2 border-b border-ink-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-ink-800">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-teal-500" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-white">{activeTab?.label}</span>
              <span className="ml-2 text-[11px] text-ink-400">{activeTab?.subtitle}</span>
            </div>
            <Badge tone="neutral" className="ml-2 !text-[9px]">v{smsVersion}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {canCreate && (
              <>
                <button
                  onClick={() => setAddFolderFor({ parentId: null })}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-bold text-accent-700 transition hover:bg-accent-100 dark:bg-accent-900/30 dark:text-accent-300"
                >
                  <FolderPlus className="h-3.5 w-3.5" /> Create Folder
                </button>
                <button
                  onClick={() => setAddDocFor({ parentId: null })}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300"
                >
                  <FilePlus2 className="h-3.5 w-3.5" /> Add Document
                </button>
              </>
            )}
            <div className="relative w-full sm:w-48">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="input pl-9 !py-1.5 !text-sm"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="shrink-0 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
            >
              {docTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {/* Tree content */}
        <div className="max-h-[600px] overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
            </div>
          ) : roots.length === 0 ? (
            <div className="py-12 text-center">
              <FolderTree className="mx-auto h-8 w-8 text-ink-300" />
              <p className="mt-2 text-sm text-ink-400">No approved documents in this section.</p>
              {canCreate && <p className="mt-1 text-xs text-ink-400">Use Create Folder or Add Document above to start building your SMS hierarchy.</p>}
            </div>
          ) : (
            roots.map((r) => renderTreeNode(r, 0))
          )}
        </div>
      </div>

      {/* PREVIEW MODAL */}
      {previewDoc && (
        <Modal
          open
          onClose={() => setPreviewDoc(null)}
          title={previewDoc.label}
          subtitle={`${inferDocType(previewDoc)} · v${previewDoc.version} · ${previewDoc.approval_state === 'pending_dpa' ? 'Pending DPA Approval' : previewDoc.approval_state === 'rejected' ? 'REJECTED by DPA' : 'Approved'}`}
          icon={<Eye className="h-5 w-5" />}
          size="full"
          scrollable
          actions={
            <button
              onClick={() => openDocInNewTab(previewDoc)}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 dark:border-ink-700 dark:text-ink-300 dark:hover:border-primary-600 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
              title="Open in New Tab"
            >
              <ExternalLink className="h-4 w-4" /> Open in New Tab
            </button>
          }
          footer={
            <div className="flex w-full items-center justify-end gap-3">
              <button onClick={() => setPreviewDoc(null)} className="btn-secondary">Close</button>
              {canPrint && previewDoc.approval_state === 'approved' && (
                <button onClick={() => printDoc(previewDoc)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                  <Printer className="h-4 w-4" /> Print Document
                </button>
              )}
              {canEdit && previewDoc.approval_state === 'approved' && (
                <button
                  onClick={() => { setEditingDoc(previewDoc); setDraftContent(previewDoc.content ?? ''); setPreviewDoc(null); }}
                  className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-accent-600"
                >
                  <Pencil className="h-4 w-4" /> Draft Revision
                </button>
              )}
              {canEdit && previewDoc.approval_state === 'rejected' && previewDoc.node_kind === 'folder' && (
                <button
                  onClick={() => handleResubmitFolder(previewDoc.id)}
                  className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-primary-600"
                >
                  <RotateCcw className="h-4 w-4" /> Resubmit Folder
                </button>
              )}
              {canEdit && previewDoc.approval_state === 'rejected' && previewDoc.node_kind === 'document' && (
                <button
                  onClick={() => { setEditingDoc(previewDoc); setDraftContent(previewDoc.content ?? ''); setPreviewDoc(null); }}
                  className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-primary-600"
                >
                  <RotateCcw className="h-4 w-4" /> Edit & Resubmit
                </button>
              )}
              {canEdit && (previewDoc.approval_state === 'pending_dpa' || previewDoc.approval_state === 'rejected') && (
                <button
                  onClick={() => setDeleteTarget(previewDoc)}
                  className="flex items-center gap-2 rounded-lg border border-danger-300 bg-danger-50 px-4 py-2 font-medium text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-300"
                >
                  <Trash2 className="h-4 w-4" /> Delete Draft
                </button>
              )}
            </div>
          }
        >
          {/* REJECTION BANNER */}
          {previewDoc.approval_state === 'rejected' && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-danger-300 bg-danger-50 p-4 dark:border-danger-700 dark:bg-danger-900/20">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-danger-800 dark:text-danger-300">DPA Rejection Comments:</p>
                <p className="mt-1 text-sm text-danger-700 dark:text-danger-400">{previewDoc.rejection_comments ?? 'No comments provided by the DPA.'}</p>
              </div>
            </div>
          )}
          {/* PENDING BANNER */}
          {previewDoc.approval_state === 'pending_dpa' && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-700 dark:bg-warning-900/20">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400" />
              <div>
                <p className="text-sm font-bold text-warning-800 dark:text-warning-300">Awaiting DPA Approval</p>
                <p className="mt-1 text-sm text-warning-700 dark:text-warning-400">This {previewDoc.node_kind === 'folder' ? 'folder' : 'document'} has been submitted and is awaiting review by the DPA. It is not yet visible to the rest of the fleet.</p>
              </div>
            </div>
          )}
          {/* FOLDER PREVIEW */}
          {previewDoc.node_kind === 'folder' ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Folder className="h-12 w-12 text-accent-400" />
              <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{previewDoc.label}</p>
              <p className="text-xs text-ink-400">Folder {previewDoc.approval_state === 'rejected' ? '(rejected)' : 'awaiting approval'}.</p>
            </div>
          ) : previewDoc.content_kind === 'pdf' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <FileText className="h-4 w-4 text-danger-500" />
                <span className="font-semibold">{previewDoc.content}</span>
              </div>
              {pdfBlobUrls.has(previewDoc.id) ? (
                <iframe
                  src={pdfBlobUrls.get(previewDoc.id)!}
                  title={previewDoc.label}
                  className="h-[600px] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 py-12">
                  <FileText className="h-12 w-12 text-danger-400" />
                  <p className="text-xs text-ink-400">PDF reference: {previewDoc.content}. Use "Open in New Tab" to view externally.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="px-2 py-2 sm:px-4 sm:py-4">
              {previewDoc.content ? (
                <pre className="whitespace-pre-wrap font-sans text-[15px] leading-[1.85] text-ink-800 dark:text-ink-200">{previewDoc.content}</pre>
              ) : (
                <p className="py-8 text-center text-sm text-ink-400">No text content available.</p>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* EDIT / DRAFT REVISION / RESUBMIT MODAL */}
      {editingDoc && (
        <Modal
          open
          onClose={() => { setEditingDoc(null); setDraftContent(''); if (resubmitPdfPreviewUrl) { URL.revokeObjectURL(resubmitPdfPreviewUrl); setResubmitPdfPreviewUrl(null); } }}
          title={editingDoc.approval_state === 'rejected' ? `Edit & Resubmit: ${editingDoc.label}` : `Draft Revision: ${editingDoc.label}`}
          subtitle={`${inferDocType(editingDoc)} · v${editingDoc.version} · ${editingDoc.approval_state === 'rejected' ? 'REJECTED' : 'Approved'}`}
          icon={editingDoc.approval_state === 'rejected' ? <RotateCcw className="h-5 w-5 text-primary-500" /> : <Pencil className="h-5 w-5 text-accent-500" />}
          size="md"
          footer={
            <div className="flex w-full items-center justify-end gap-3">
              <button onClick={() => { setEditingDoc(null); setDraftContent(''); if (resubmitPdfPreviewUrl) { URL.revokeObjectURL(resubmitPdfPreviewUrl); setResubmitPdfPreviewUrl(null); } }} className="btn-secondary">Cancel</button>
              <button
                onClick={editingDoc.approval_state === 'rejected' ? handleResubmitDocument : submitDraftRevision}
                disabled={submittingDraft}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
              >
                {submittingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : editingDoc.approval_state === 'rejected' ? <RotateCcw className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}
                {editingDoc.approval_state === 'rejected' ? 'Resubmit for DPA Approval' : 'Submit for DPA Approval'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {/* REJECTION COMMENTS BANNER */}
            {editingDoc.approval_state === 'rejected' && editingDoc.rejection_comments && (
              <div className="flex items-start gap-3 rounded-lg border border-danger-300 bg-danger-50 p-3 dark:border-danger-700 dark:bg-danger-900/20">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600 dark:text-danger-400" />
                <div>
                  <p className="text-xs font-bold text-danger-800 dark:text-danger-300">DPA Rejection Comments:</p>
                  <p className="mt-1 text-sm text-danger-700 dark:text-danger-400">{editingDoc.rejection_comments}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 dark:border-warning-800 dark:bg-warning-900/20">
              <Clock className="h-4 w-4 text-warning-500" />
              <span className="text-xs font-semibold text-warning-700 dark:text-warning-300">
                {editingDoc.approval_state === 'rejected' ? 'This resubmission will be sent back to the DPA for re-review.' : 'This revision will be sent to the DPA for approval. It will not be published until approved.'}
              </span>
            </div>
            {editingDoc.content_kind === 'pdf' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800">
                  <FileText className="h-4 w-4 text-danger-500" />
                  <span className="font-semibold text-ink-700 dark:text-ink-200">{editingDoc.content}</span>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700">
                  <Upload className="h-4 w-4" /> Replace PDF
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (resubmitPdfPreviewUrl) URL.revokeObjectURL(resubmitPdfPreviewUrl);
                    const url = URL.createObjectURL(file);
                    setResubmitPdfPreviewUrl(url);
                    pdfBlobUrls.set(editingDoc.id, url);
                    setDraftContent(file.name);
                  }} />
                </label>
                {resubmitPdfPreviewUrl && (
                  <iframe src={resubmitPdfPreviewUrl} title="PDF preview" className="h-[300px] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700" />
                )}
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-bold text-ink-600 dark:text-ink-300">Revision Content</label>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={10}
                  className="input !text-sm"
                  placeholder="Enter the revised document content..."
                />
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${
          toast.ok ? 'bg-success-600 text-white' : 'bg-danger-600 text-white'
        }`}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* ADD FOLDER MODAL */}
      {addFolderFor && (
        <Modal
          open
          onClose={() => { setAddFolderFor(null); setAddFolderLabel(''); }}
          title="Create Folder"
          subtitle={addFolderFor.parentId ? 'Add a new subfolder' : 'Add a new root folder'}
          icon={<FolderPlus className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setAddFolderFor(null)} className="btn-secondary">Cancel</button>
              <button
                disabled={!addFolderLabel.trim()}
                onClick={() => handleCreateFolder(addFolderLabel.trim())}
                className="btn-primary"
              >Create Folder</button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 dark:border-warning-800 dark:bg-warning-900/20">
              <Clock className="h-4 w-4 text-warning-500" />
              <span className="text-xs font-semibold text-warning-700 dark:text-warning-300">
                This folder will be sent to the DPA for approval before it becomes visible to the fleet.
              </span>
            </div>
            <label className="label">Folder name</label>
            <input
              autoFocus
              className="input"
              value={addFolderLabel}
              onChange={(e) => setAddFolderLabel(e.target.value)}
              placeholder="e.g. Section 1, Emergency Procedures"
              onKeyDown={(e) => { if (e.key === 'Enter' && addFolderLabel.trim()) handleCreateFolder(addFolderLabel.trim()); }}
            />
          </div>
        </Modal>
      )}

      {/* ADD DOCUMENT MODAL (rich text + PDF) */}
      {addDocFor && (
        <Modal
          open
          onClose={() => { setAddDocFor(null); resetAddDocForm(); }}
          title="Add Document"
          subtitle={`Submit to ${tabs.find((t) => t.key === activeTabKey)?.label ?? 'SMS'} — pending DPA approval`}
          icon={<FilePlus2 className="h-5 w-5" />}
          size="md"
          footer={
            <>
              <button onClick={() => { setAddDocFor(null); resetAddDocForm(); }} className="btn-secondary">Cancel</button>
              <button
                disabled={!canSubmitAddDoc}
                onClick={() => {
                  handleCreateDocument(
                    addDocLabel.trim(),
                    addDocMode,
                    addDocMode === 'pdf' ? addDocPdfName : addDocText,
                  );
                  resetAddDocForm();
                }}
                className="btn-primary"
              >Submit for DPA Approval</button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 dark:border-warning-800 dark:bg-warning-900/20">
              <Clock className="h-4 w-4 text-warning-500" />
              <span className="text-xs font-semibold text-warning-700 dark:text-warning-300">
                This document will be sent to the DPA for approval before it becomes visible to the fleet.
              </span>
            </div>
            <div>
              <label className="label">Document name</label>
              <input
                autoFocus
                className="input"
                value={addDocLabel}
                onChange={(e) => setAddDocLabel(e.target.value)}
                placeholder="e.g. Emergency Response Plan, manual.pdf"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAddDocMode('rich_text')}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${addDocMode === 'rich_text' ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'}`}
              >Rich text editor</button>
              <button
                onClick={() => setAddDocMode('pdf')}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${addDocMode === 'pdf' ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'}`}
              >Upload PDF</button>
            </div>
            {addDocMode === 'rich_text' ? (
              <div>
                <label className="label">Document body</label>
                <textarea
                  rows={10}
                  className="input resize-none font-mono text-sm"
                  value={addDocText}
                  onChange={(e) => setAddDocText(e.target.value)}
                  placeholder="Type or paste your policy document here…"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <label className="label">Select PDF file</label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700">
                    <Upload className="h-4 w-4" /> Choose file
                    <input type="file" accept="application/pdf" className="hidden" onChange={handleAddDocFilePick} />
                  </label>
                  {addDocPdfName && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-warning-500" />
                      <span className="font-medium text-ink-700 dark:text-ink-200">{addDocPdfName}</span>
                      {addDocPdfSize !== null && <span className="text-xs text-ink-400">({(addDocPdfSize / 1024).toFixed(0)} KB)</span>}
                    </div>
                  )}
                </div>
                {addDocSizeError && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-2 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {addDocSizeError}
                  </div>
                )}
                <p className="text-xs text-ink-400">Maximum file size: 25 MB · PDF format only</p>
                {addDocPdfPreviewUrl && !addDocSizeError && (
                  <div className="space-y-1.5">
                    <label className="label">Live preview</label>
                    <iframe
                      src={addDocPdfPreviewUrl}
                      title="PDF preview"
                      className="h-[300px] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
      {/* ADD TAB MODAL */}
      {addTabOpen && (
        <Modal
          open
          onClose={() => { setAddTabOpen(false); setNewTabLabel(''); }}
          title="Create New Tab"
          subtitle="Add a custom document category to your SMS library"
          icon={<Plus className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button onClick={() => { setAddTabOpen(false); setNewTabLabel(''); }} className="btn-secondary">Cancel</button>
              <button
                disabled={!newTabLabel.trim()}
                onClick={handleCreateTab}
                className="btn-primary"
              >Create Tab</button>
            </>
          }
        >
          <div className="space-y-3">
            <label className="label">Tab name</label>
            <input
              autoFocus
              className="input"
              value={newTabLabel}
              onChange={(e) => setNewTabLabel(e.target.value)}
              placeholder="e.g. Vessel Specific Procedures, Port State Docs"
              onKeyDown={(e) => { if (e.key === 'Enter' && newTabLabel.trim()) handleCreateTab(); }}
            />
            <p className="text-xs text-ink-400">The tab will appear alongside your existing categories. Documents created within it will follow the same DPA approval workflow.</p>
          </div>
        </Modal>
      )}

      {/* DELETE DRAFT CONFIRMATION MODAL */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title="Delete Unapproved Draft"
          subtitle={deleteTarget.label}
          icon={<Trash2 className="h-5 w-5 text-danger-500" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary" disabled={deleting}>Cancel</button>
              <button
                onClick={handleDeleteDraft}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-danger-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-danger-700 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete Permanently
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-danger-300 bg-danger-50 p-4 dark:border-danger-700 dark:bg-danger-900/20">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
              <div>
                <p className="text-sm font-bold text-danger-800 dark:text-danger-300">Are you sure you want to delete this unapproved draft?</p>
                <p className="mt-1 text-sm text-danger-700 dark:text-danger-400">This action cannot be undone. {deleteTarget.node_kind === 'folder' ? 'All contents within this folder will also be deleted.' : ''}</p>
              </div>
            </div>
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-700 dark:bg-ink-800">
              <p className="text-xs font-semibold text-ink-500">{deleteTarget.node_kind === 'folder' ? 'Folder' : 'Document'}: {deleteTarget.label}</p>
              <p className="text-xs text-ink-400">Status: {deleteTarget.approval_state === 'pending_dpa' ? 'Pending DPA Approval' : 'Rejected'}</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
