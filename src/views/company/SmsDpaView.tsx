import { useEffect, useState } from 'react';
import {
  FileText, Folder, FolderTree, ChevronRight, ChevronDown, Plus, Pencil, Trash2, FileEdit,
  CheckCircle2, Clock, Shield, Upload, Loader2, AlertTriangle, X, FolderPlus, Lock,
  ExternalLink, Eye, Layers, Ship, ChevronDown as ChevronDownIcon,
  FilePlus2, Printer,
} from 'lucide-react';
import { supabase, type SmsDocRow } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAudit } from '../../lib/audit';
import { postSyncEvent, onSyncEvent } from '../../lib/syncChannel';
import {
  isDemoMode, DEMO_SMS_DOCS,
  getEffectiveDemoSmsDocs, demoCreateSmsDoc, demoRenameSmsDoc,
  demoUpdateSmsDocContent, demoApproveSmsDoc, demoApproveAllSmsDocs,
  demoDeleteSmsDoc, getDemoCustomTabs, saveDemoCustomTabs,
  demoGetWorkspaceFrozen,
  demoGetGuardrails,
} from '../../lib/demoData';
import { Modal } from '../../components/Modal';
import {
  loadProfiles, createProfile, deleteProfile,
  getVesselsForTenant, type SmsProfileWithVessels,
} from '../../lib/smsProfiles';
import { getLocalSmsVersion } from '../../lib/localVesselDb';
import { deployBaseline } from '../../lib/deployBaseline';

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

interface TreeNode extends SmsDocRow {
  children: TreeNode[];
}

// Maximum PDF size — dynamically overridden by Super Admin guardrails at runtime
const MAX_PDF_SIZE_MB = 25;
const DEFAULT_MAX_DEPTH = 6;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildDocHtml(node: SmsDocRow, autoPrint: boolean): string {
  const title = escapeHtml(node.label);
  const printScript = autoPrint ? '<script>window.onload=function(){window.print();}</script>' : '';
  if (node.content_kind === 'pdf') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;padding:64px;color:#1a202c;background:#f7fafc;}h1{color:#1a365d;margin-bottom:8px;}p{color:#4a5568;}</style>${printScript}</head><body><h1>${title}</h1><p>PDF document reference: <strong>${escapeHtml(node.content ?? '')}</strong></p><p>Approval state: ${node.approval_state}</p></body></html>`;
  }
  const body = escapeHtml(node.content ?? '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Georgia,serif;max-width:1100px;margin:32px auto;padding:40px 56px;line-height:1.8;color:#1a202c;background:#fff;}h1{color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:24px;font-family:system-ui,sans-serif;}.meta{font-size:12px;color:#718096;margin-bottom:24px;font-family:system-ui,sans-serif;}.content{white-space:pre-wrap;font-size:15px;}</style>${printScript}</head><body><h1>${title}</h1><div class="meta">SMS Document &middot; ${node.approval_state}</div><div class="content">${body}</div></body></html>`;
}

function openInNewTab(node: SmsDocRow) {
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

export function SmsDpaView() {
  const { tenant, tenantUser, role } = useAuth();
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [customTabs, setCustomTabs] = useState<Record<string, TabDef>>({});
  const [treeKind, setTreeKind] = useState<string>('sms');
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [allDocCount, setAllDocCount] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [addFolderFor, setAddFolderFor] = useState<{ parentId: string | null } | null>(null);
  const [addDocFor, setAddDocFor] = useState<{ parentId: string | null } | null>(null);
  const [editorFor, setEditorFor] = useState<TreeNode | null>(null);
  const [previewFor, setPreviewFor] = useState<SmsDocRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<TreeNode | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [approving, setApproving] = useState(false);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [renameTabKey, setRenameTabKey] = useState<string | null>(null);
  const [deleteTabKey, setDeleteTabKey] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<SmsDocRow[]>([]);
  const [allDocsIndex, setAllDocsIndex] = useState<Map<string, SmsDocRow>>(new Map());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // SMS Fleet Profiles state
  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);

  const [deleteProfileTarget, setDeleteProfileTarget] = useState<SmsProfileWithVessels | null>(null);

  // Workspace freeze state — bridged from Super Admin via localStorage + sync events
  const [workspaceFrozen, setWorkspaceFrozen] = useState(false);
  // Guardrails — bridged from Super Admin via localStorage + sync events
  const [maxSubfolderDepth, setMaxSubfolderDepth] = useState(DEFAULT_MAX_DEPTH);
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState(MAX_PDF_SIZE_MB);

  const canEdit = (role === 'company_admin' || role === 'dpa') && !workspaceFrozen;
  const canApprove = role === 'dpa' && !workspaceFrozen;
  const canManageProfiles = role === 'company_admin' && !workspaceFrozen;

  async function loadCustomTabs() {
    if (!tenant) return;
    if (isDemoMode()) {
      const demoTabs = getDemoCustomTabs(tenant.id);
      const demoTabDefs: Record<string, TabDef> = {};
      for (const [k, v] of Object.entries(demoTabs)) demoTabDefs[k] = { ...v, custom: true };
      setCustomTabs(demoTabDefs);
      setTabs([...BUILTIN_TABS, ...Object.values(demoTabDefs)]);
      return;
    }
    const { data } = await supabase.from('sms_documents').select('tree_kind').eq('tenant_id', tenant.id);
    const kinds = new Set((data as Pick<SmsDocRow, 'tree_kind'>[] | null)?.map((d) => d.tree_kind) ?? []);
    const builtins = new Set(BUILTIN_TABS.map((t) => t.key));
    const customKeys = [...kinds].filter((k) => !builtins.has(k));
    const stored = localStorage.getItem(`sms-tabs-${tenant.id}`);
    const map: Record<string, TabDef> = {};
    if (stored) {
      try { const parsed = JSON.parse(stored) as Record<string, TabDef>; Object.assign(map, parsed); } catch { /* ignore */ }
    }
    for (const k of customKeys) {
      if (!map[k]) map[k] = { key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), subtitle: 'Custom document group', custom: true };
      else map[k].custom = true;
    }
    setCustomTabs(map);
    setTabs([...BUILTIN_TABS, ...Object.values(map)]);
    localStorage.setItem(`sms-tabs-${tenant.id}`, JSON.stringify(map));
  }

  async function loadTree() {
    if (!tenant) return;
    setLoading(true);
    let flat: SmsDocRow[];
    if (isDemoMode()) {
      flat = getEffectiveDemoSmsDocs(tenant.id, treeKind, activeProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('*').eq('tenant_id', tenant.id).eq('tree_kind', treeKind).order('sort_order');
      const allFlat = (data as SmsDocRow[]) ?? [];
      flat = activeProfileId ? allFlat.filter((d) => d.profile_id === null || d.profile_id === activeProfileId) : allFlat;
    }
    const map = new Map<string, TreeNode>();
    flat.forEach((r) => map.set(r.id, { ...r, children: [] }));
    const tree: TreeNode[] = [];
    flat.forEach((r) => {
      const node = map.get(r.id)!;
      if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node);
      else tree.push(node);
    });
    setRoots(tree);
    // Auto-expand all root folders so the nesting structure is immediately visible
    setExpanded((prev) => {
      const next = new Set(prev);
      tree.forEach((r) => { if (r.node_kind === 'folder') next.add(r.id); });
      return next;
    });
    setLoading(false);
  }

  async function loadAllCounts() {
    if (!tenant) return;
    let allDocs: SmsDocRow[];
    if (isDemoMode()) {
      allDocs = getEffectiveDemoSmsDocs(tenant.id, undefined, activeProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('tree_kind, node_kind, profile_id').eq('tenant_id', tenant.id);
      let raw = (data as Pick<SmsDocRow, 'tree_kind' | 'node_kind' | 'profile_id'>[] as SmsDocRow[]) ?? [];
      if (activeProfileId) raw = raw.filter((d) => d.profile_id === null || d.profile_id === activeProfileId);
      allDocs = raw;
    }
    const counts: Record<string, number> = {};
    for (const d of allDocs) {
      if (d.node_kind === 'document') counts[d.tree_kind] = (counts[d.tree_kind] ?? 0) + 1;
    }
    setAllDocCount(counts);
  }

  async function loadAllPending() {
    if (!tenant) return;
    let all: SmsDocRow[];
    if (isDemoMode()) {
      all = getEffectiveDemoSmsDocs(tenant.id, undefined, activeProfileId);
    } else {
      const { data } = await supabase.from('sms_documents').select('*').eq('tenant_id', tenant.id).order('updated_at', { ascending: false });
      let raw = (data as SmsDocRow[]) ?? [];
      if (activeProfileId) raw = raw.filter((d) => d.profile_id === null || d.profile_id === activeProfileId);
      all = raw;
    }
    const idx = new Map<string, SmsDocRow>();
    all.forEach((r) => idx.set(r.id, r));
    setAllDocsIndex(idx);
    const pending = all.filter((r) => r.approval_state === 'pending_dpa');
    setPendingDocs(pending);
    setPendingCount(pending.length);
  }

  function resolveLocation(doc: SmsDocRow): string {
    const tabLabel = tabs.find((t) => t.key === doc.tree_kind)?.label ?? doc.tree_kind.replace(/_/g, ' ');
    const chain: string[] = [];
    let currentId = doc.parent_id;
    const guard = new Set<string>();
    while (currentId && !guard.has(currentId)) {
      guard.add(currentId);
      const parent = allDocsIndex.get(currentId);
      if (!parent) break;
      chain.unshift(parent.label);
      currentId = parent.parent_id;
    }
    return [tabLabel, ...chain].join(' → ');
  }

  async function approveOne(doc: SmsDocRow) {
    if (!tenant) return;
    setApprovingId(doc.id);
    const oldVersion = tenant.sms_version;
    if (isDemoMode()) {
      demoApproveSmsDoc(tenant.id, doc.id);
    } else {
      await supabase.from('sms_documents').update({ approval_state: 'approved' }).eq('id', doc.id).eq('tenant_id', tenant.id);
    }
    // Bump fleet SMS version + build delta package (top-down baseline push)
    const newVersion = await deployBaseline(tenant.id, tenantUser!.email);
    const versionLabel = newVersion ?? oldVersion;
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `DPA approved & deployed: ${doc.label} (SMS v${oldVersion} → v${versionLabel})`, target: doc.tree_kind, location: tenant.company, severity: 'warning' });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'approved', docId: doc.id, label: doc.label, version: versionLabel } });
    setApprovingId(null);
    loadTree(); loadAllPending(); loadAllCounts();
  }

  async function loadProfilesList() {
    if (!tenant) return;
    const list = await loadProfiles(tenant.id);
    setProfiles(list);
    if (!activeProfileId && list.length > 0) setActiveProfileId(list[0].id);
  }

  useEffect(() => { loadCustomTabs(); loadProfilesList(); }, [tenant]);
  useEffect(() => { loadTree(); loadAllCounts(); loadAllPending(); }, [tenant, treeKind, activeProfileId]);

  // Real-time cross-window sync: reload tree/counts/pending/profiles when other tabs make changes
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenant.id) return;
      if (evt.type === 'SMS_UPDATED' || evt.type === 'PROFILES_UPDATED' || evt.type === 'VESSELS_UPDATED') {
        setSyncTick((t) => t + 1);
      }
    });
    return off;
  }, [tenant]);

  // Re-check freeze state + guardrails when sync events fire (Super Admin may have frozen/unfrozen or updated limits)
  useEffect(() => {
    if (!tenant || !isDemoMode()) return;
    setWorkspaceFrozen(demoGetWorkspaceFrozen(tenant.id));
    const g = demoGetGuardrails(tenant.id);
    if (g) {
      setMaxSubfolderDepth(g.maxSubfolderDepth);
      setMaxUploadSizeMb(g.maxUploadSizeMb);
    }
  }, [tenant, syncTick]);

  useEffect(() => {
    if (syncTick > 0) {
      loadProfilesList();
      loadTree();
      loadAllCounts();
      loadAllPending();
    }
  }, [syncTick]);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  async function handleCreateProfile(name: string) {
    if (!tenant || !name.trim()) return;
    await createProfile(tenant.id, name.trim());
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Created SMS Fleet Profile: ${name.trim()}`, target: 'sms_profile', location: tenant.company });
    postSyncEvent({ type: 'PROFILES_UPDATED', tenantId: tenant.id, payload: { action: 'created', name: name.trim() } });
    await loadProfilesList();
    setCreateProfileOpen(false);
  }

  async function handleDeleteProfile() {
    if (!tenant || !deleteProfileTarget) return;
    await deleteProfile(tenant.id, deleteProfileTarget.id);
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Deleted SMS Fleet Profile: ${deleteProfileTarget.name}`, target: 'sms_profile', location: tenant.company, severity: 'warning' });
    postSyncEvent({ type: 'PROFILES_UPDATED', tenantId: tenant.id, payload: { action: 'deleted', profileId: deleteProfileTarget.id } });
    if (activeProfileId === deleteProfileTarget.id) setActiveProfileId(null);
    setDeleteProfileTarget(null);
    await loadProfilesList();
  }

  const toggle = (id: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) {
      next.delete(id);
      const node = findNodeInTree(roots, id);
      if (node) collectFolderIds(node).forEach((fid) => next.delete(fid));
    } else {
      next.add(id);
    }
    return next;
  });

  function startInlineEdit(node: TreeNode) {
    setInlineEditId(node.id);
    setInlineEditValue(node.label);
  }

  function cancelInlineEdit() {
    setInlineEditId(null);
    setInlineEditValue('');
  }

  async function saveInlineRename(node: TreeNode) {
    const trimmed = inlineEditValue.trim();
    const currentId = inlineEditId;
    cancelInlineEdit();
    if (!trimmed || trimmed === node.label || !currentId || !tenant) return;
    if (isDemoMode()) {
      demoRenameSmsDoc(tenant.id, node.id, trimmed);
    } else {
      await supabase.from('sms_documents').update({ label: trimmed, updated_at: new Date().toISOString() }).eq('id', node.id).eq('tenant_id', tenant.id);
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Renamed: ${node.label} → ${trimmed}`, target: treeKind, location: tenant.company });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'renamed', nodeId: node.id, label: trimmed } });
    loadTree();
  }

  async function confirmDeleteNode() {
    if (!deleteFor || !tenant) return;
    if (isDemoMode()) {
      demoDeleteSmsDoc(tenant.id, deleteFor.id);
    } else {
      await supabase.from('sms_documents').delete().eq('id', deleteFor.id).eq('tenant_id', tenant.id);
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Deleted: ${deleteFor.label}`, target: treeKind, location: tenant.company, severity: 'warning' });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'deleted', nodeId: deleteFor.id, label: deleteFor.label } });
    setDeleteFor(null);
    loadTree(); loadAllCounts(); loadCustomTabs(); loadAllPending();
  }

  async function approveAll() {
    if (!tenant) return;
    setApproving(true);
    const oldVersion = tenant.sms_version;
    let count = 0;
    if (isDemoMode()) {
      count = demoApproveAllSmsDocs(tenant.id);
    } else {
      const { data: pending } = await supabase.from('sms_documents').select('id').eq('tenant_id', tenant.id).eq('approval_state', 'pending_dpa');
      if (pending && pending.length > 0) {
        const ids = pending.map((p) => p.id);
        await supabase.from('sms_documents').update({ approval_state: 'approved' }).in('id', ids).eq('tenant_id', tenant.id);
        count = pending.length;
      }
    }
    if (count > 0) {
      // Bump fleet SMS version + build delta package (top-down baseline push)
      const newVersion = await deployBaseline(tenant.id, tenantUser!.email);
      const versionLabel = newVersion ?? oldVersion;
      await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `DPA approval — ${count} documents approved (SMS v${oldVersion} → v${versionLabel})`, target: `${count} documents`, location: tenant.company, severity: 'warning' });
      postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'approve_all', version: versionLabel, count } });
    }
    setApproving(false);
    loadTree(); loadAllPending();
  }

  function addCustomTab(label: string) {
    if (!tenant || !label.trim()) return;
    const key = `custom_${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now().toString().slice(-4)}`;
    const def: TabDef = { key, label: label.trim(), subtitle: 'Custom document group', custom: true };
    const updated = { ...customTabs, [key]: def };
    setCustomTabs(updated);
    setTabs([...BUILTIN_TABS, ...Object.values(updated)]);
    if (isDemoMode()) {
      saveDemoCustomTabs(tenant.id, updated);
    } else {
      localStorage.setItem(`sms-tabs-${tenant.id}`, JSON.stringify(updated));
    }
    setAddTabOpen(false);
    setTreeKind(key);
  }

  async function renameCustomTab(key: string, label: string) {
    if (!tenant || !label.trim()) return;
    const updated = { ...customTabs, [key]: { ...customTabs[key], label: label.trim() } };
    setCustomTabs(updated);
    setTabs([...BUILTIN_TABS, ...Object.values(updated)]);
    if (isDemoMode()) {
      saveDemoCustomTabs(tenant.id, updated);
    } else {
      localStorage.setItem(`sms-tabs-${tenant.id}`, JSON.stringify(updated));
    }
    setRenameTabKey(null);
  }

  async function deleteCustomTab(key: string) {
    if (!tenant) return;
    if (!isDemoMode()) {
      const { data: docs } = await supabase.from('sms_documents').select('id').eq('tenant_id', tenant.id).eq('tree_kind', key);
      if (docs && docs.length > 0) return;
    } else {
      const docs = getEffectiveDemoSmsDocs(tenant.id, key);
      if (docs.length > 0) return;
    }
    const updated = { ...customTabs };
    delete updated[key];
    setCustomTabs(updated);
    setTabs([...BUILTIN_TABS, ...Object.values(updated)]);
    if (isDemoMode()) {
      saveDemoCustomTabs(tenant.id, updated);
    } else {
      localStorage.setItem(`sms-tabs-${tenant.id}`, JSON.stringify(updated));
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Tab deleted: ${customTabs[key]?.label ?? key}`, target: key, location: tenant.company, severity: 'warning' });
    setDeleteTabKey(null);
    if (treeKind === key) setTreeKind('sms');
  }

  const activeTab = tabs.find((t) => t.key === treeKind);

  const [folderDepthError, setFolderDepthError] = useState('');

  async function handleAddFolder(label: string) {
    if (!tenant || !addFolderFor || !label.trim()) return;
    // Enforce Super Admin guardrail: max subfolder depth
    if (addFolderFor.parentId) {
      const depth = computeNodeDepth(allDocsIndex, addFolderFor.parentId);
      if (depth + 1 >= maxSubfolderDepth) {
        setFolderDepthError(`Cannot create subfolder — max depth of ${maxSubfolderDepth} levels is reached. Contact Super Admin to adjust this limit.`);
        return;
      }
    }
    setFolderDepthError('');
    if (isDemoMode()) {
      demoCreateSmsDoc(tenant.id, { parent_id: addFolderFor.parentId, tree_kind: treeKind, label, node_kind: 'folder', content_kind: null, content: null, profile_id: activeProfile?.id });
    } else {
      await supabase.from('sms_documents').insert({
        tenant_id: tenant.id, parent_id: addFolderFor.parentId, tree_kind: treeKind, label,
        node_kind: 'folder', content_kind: null, content: null, is_regulatory_header: false,
        approval_state: 'approved', profile_id: activeProfile?.id ?? null,
      });
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Created folder: ${label}`, target: treeKind, location: tenant.company });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'added', label, kind: 'folder' } });
    // Auto-expand parent so the new subfolder is immediately visible as nested
    if (addFolderFor.parentId) setExpanded((s) => new Set(s).add(addFolderFor.parentId!));
    setAddFolderFor(null);
    loadTree(); loadAllCounts(); loadAllPending();
  }

  async function handleAddDocument(label: string, contentKind: 'rich_text' | 'pdf', content: string) {
    if (!tenant || !addDocFor || !label.trim()) return;
    if (isDemoMode()) {
      demoCreateSmsDoc(tenant.id, { parent_id: addDocFor.parentId, tree_kind: treeKind, label, node_kind: 'document', content_kind: contentKind, content, profile_id: activeProfile?.id, author_name: tenantUser?.name ?? 'Company Admin', author_role: 'Company Admin', author_origin: 'Shoreside HQ' });
    } else {
      await supabase.from('sms_documents').insert({
        tenant_id: tenant.id, parent_id: addDocFor.parentId, tree_kind: treeKind, label,
        node_kind: 'document', content_kind: contentKind, content, is_regulatory_header: false,
        approval_state: 'pending_dpa', profile_id: activeProfile?.id ?? null,
        author_name: tenantUser?.name ?? 'Company Admin', author_role: 'Company Admin', author_origin: 'Shoreside HQ',
      });
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Added document: ${label}`, target: treeKind, location: tenant.company });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'added', label, kind: 'document' } });
    // Auto-expand parent so the new document is immediately visible as nested
    if (addDocFor.parentId) setExpanded((s) => new Set(s).add(addDocFor.parentId!));
    setAddDocFor(null);
    loadTree(); loadAllCounts(); loadAllPending();
  }

  async function handleSaveEdit(content: string, contentKind: 'rich_text' | 'pdf') {
    if (!tenant || !editorFor) return;
    if (isDemoMode()) {
      demoUpdateSmsDocContent(tenant.id, editorFor.id, content, contentKind, tenantUser?.name ?? 'Company Admin', 'Company Admin', 'Shoreside HQ');
    } else {
      await supabase.from('sms_documents').update({
        content, content_kind: contentKind, approval_state: 'pending_dpa',
        author_name: tenantUser?.name ?? 'Company Admin', author_role: 'Company Admin', author_origin: 'Shoreside HQ',
        updated_at: new Date().toISOString(),
      }).eq('id', editorFor.id).eq('tenant_id', tenant.id);
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `Edited: ${editorFor.label}`, target: treeKind, location: tenant.company });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'edited', nodeId: editorFor.id, label: editorFor.label } });
    setEditorFor(null); loadTree(); loadAllPending();
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isOpen = expanded.has(node.id);
    const Icon = node.node_kind === 'folder' ? Folder : FileText;
    const isEditing = inlineEditId === node.id;
    const stateColor = node.approval_state === 'approved' ? 'success' : node.approval_state === 'pending_dpa' ? 'warning' : 'neutral';
    const childCount = node.children.length;
    const isRootFolder = depth === 0 && node.node_kind === 'folder';

    return (
      <div key={node.id}>
        <div
          onClick={() => {
            if (isEditing) return;
            if (node.node_kind === 'folder') toggle(node.id);
            else openInNewTab(node);
          }}
          className={`group flex cursor-pointer items-center gap-2 rounded-md py-2 pr-2 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50 ${isRootFolder ? 'border-b border-ink-100 dark:border-ink-800' : ''}`}
          style={{ paddingLeft: `${depth * 24 + 10}px` }}
        >
          {/* Indentation guide line for nested levels */}
          {depth > 0 && (
            <span className="pointer-events-none absolute left-0 top-0 bottom-0 border-l border-ink-100 dark:border-ink-800" style={{ marginLeft: `${(depth - 1) * 24 + 22}px` }} />
          )}
          {node.node_kind === 'folder' ? (
            isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
          ) : <span className="w-4 shrink-0" />}
          <Icon className={`h-5 w-5 shrink-0 ${node.node_kind === 'folder' ? 'text-accent-500' : 'text-ink-400'}`} />
          {isEditing ? (
            <input
              autoFocus
              className="min-w-0 flex-1 rounded border border-primary-400 bg-white px-2 py-1 text-base font-medium text-ink-900 outline-none ring-2 ring-primary-100 dark:bg-ink-800 dark:text-white dark:ring-primary-900/40"
              value={inlineEditValue}
              onChange={(e) => setInlineEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveInlineRename(node); }
                if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit(); }
              }}
              onBlur={() => saveInlineRename(node)}
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${isRootFolder ? 'text-base font-bold text-ink-900 dark:text-white' : 'text-sm font-medium text-ink-700 dark:text-ink-200'}`}>{node.label}</span>
          )}
          {node.node_kind === 'folder' && childCount > 0 && !isEditing && (
            <span className="shrink-0 text-[10px] font-medium text-ink-400">{childCount}</span>
          )}
          {node.node_kind === 'document' && node.content_kind === 'pdf' && (
            <span className="shrink-0 rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">PDF</span>
          )}
          {node.node_kind === 'document' && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              stateColor === 'success' ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' :
              stateColor === 'warning' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' :
              'bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300'
            }`}>
              {node.approval_state === 'approved' ? 'Approved' : node.approval_state === 'pending_dpa' ? 'Pending' : 'Draft'}
            </span>
          )}

          {/* Document preview + open buttons (always visible) */}
          {node.node_kind === 'document' && !isEditing && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewFor(node); }}
                className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
                title="Preview inline"
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openInNewTab(node); }}
                className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
                title="Open in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Folder inline action buttons — always visible, not hover-only */}
          {canEdit && node.node_kind === 'folder' && !isEditing && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); setAddFolderFor({ parentId: node.id }); }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-accent-600 transition-colors hover:bg-accent-100 dark:text-accent-400 dark:hover:bg-accent-900/30"
                title="Add subfolder inside this folder"
              >
                <FolderPlus className="h-3.5 w-3.5" /> Subfolder
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAddDocFor({ parentId: node.id }); }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary-600 transition-colors hover:bg-primary-100 dark:text-primary-400 dark:hover:bg-primary-900/30"
                title="Add document inside this folder"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Document
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); startInlineEdit(node); }}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
                title="Rename folder"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteFor(node); }}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/30"
                title="Delete folder"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Document inline action buttons — always visible */}
          {canEdit && node.node_kind === 'document' && !isEditing && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); setEditorFor(node); }}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
                title="Edit content"
              >
                <FileEdit className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); startInlineEdit(node); }}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40"
                title="Rename"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteFor(node); }}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/30"
                title="Delete document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {isOpen && node.children.length > 0 && (
          <div className="relative">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">SMS Review &amp; Deployment Desk</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Fully editable template — create custom tabs, folders, and documents before fleet release.</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && canEdit && (
            <button
              onClick={approveAll}
              disabled={approving || !canApprove}
              title={canApprove ? undefined : 'Statutory Release Authorized for DPA Role Only.'}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shield className="h-4 w-4" /> {approving ? 'Approving…' : `Approve & Deploy (${pendingCount})`}
            </button>
          )}
        </div>
      </div>

      {workspaceFrozen && (
        <div className="flex items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <Lock className="h-4 w-4 shrink-0" />
          <span><strong>Workspace Frozen by Super Admin.</strong> All SMS editing, document uploads, folder creation, and approvals are suspended until the freeze is lifted.</span>
        </div>
      )}

      {/* ── SMS Fleet Scope Bar ─────────────────────────────────────────── */}
      <SmsFleetScopeBar
        profiles={profiles}
        activeProfile={activeProfile}
        onSelect={(id) => setActiveProfileId(id)}
        onCreate={() => setCreateProfileOpen(true)}
        onDelete={(p) => setDeleteProfileTarget(p)}
        canEdit={canEdit}
        canManageProfiles={canManageProfiles}
        dropdownOpen={profileDropdownOpen}
        setDropdownOpen={setProfileDropdownOpen}
        tenantId={tenant?.id ?? ''}
        refreshKey={syncTick}
      />

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          <Clock className="h-4 w-4 shrink-0" />
          {pendingCount} document(s) pending DPA approval. Fleet cannot see them until approved. Current SMS version: v{tenant?.sms_version ?? '—'}.
        </div>
      )}

      {pendingDocs.length > 0 && canEdit && (
        <div className="rounded-xl border border-warning-200 bg-white dark:border-warning-800 dark:bg-ink-900">
          <button onClick={() => setReviewOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning-500" />
              <span className="text-sm font-bold text-ink-900 dark:text-white">Documents Awaiting DPA Review</span>
              <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">{pendingDocs.length}</span>
            </div>
            {reviewOpen ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
          </button>
          {reviewOpen && (
            <div className="border-t border-ink-100 dark:border-ink-800">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-[11px] uppercase tracking-wide text-ink-400 dark:border-ink-800">
                      <th className="px-4 py-2 font-semibold">Document Name</th>
                      <th className="px-4 py-2 font-semibold">Location</th>
                      <th className="px-4 py-2 font-semibold">Last Modified</th>
                      <th className="px-4 py-2 text-right font-semibold">Review Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDocs.map((doc) => (
                      <tr key={doc.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50 dark:border-ink-800/50 dark:hover:bg-ink-800/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {doc.node_kind === 'folder' ? <Folder className="h-3.5 w-3.5 shrink-0 text-accent-500" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
                            <span className="font-medium text-ink-800 dark:text-ink-200">{doc.label}</span>
                            {doc.node_kind === 'folder' ? <span className="rounded bg-accent-100 px-1 text-[9px] font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">FOLDER</span> : doc.content_kind === 'pdf' && <span className="rounded bg-warning-100 px-1 text-[9px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">PDF</span>}
                            {doc.author_name && <span className="text-[10px] text-ink-400">by {doc.author_name}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">{resolveLocation(doc)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">{new Date(doc.updated_at).toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setPreviewFor(doc)} className="rounded p-1 text-ink-400 hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40" title="Preview inline">
                              <Eye className="h-4 w-4" />
                            </button>
                            <button onClick={() => approveOne(doc)} disabled={approvingId === doc.id || !canApprove} title={canApprove ? undefined : 'Statutory Release Authorized for DPA Role Only.'} className="inline-flex items-center gap-1 rounded-lg bg-success-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-success-700 disabled:cursor-not-allowed disabled:opacity-50">
                              {approvingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              Approve &amp; Deploy
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dynamic root tabs — add / rename / delete */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
        {tabs.map((t) => {
          const count = allDocCount[t.key] ?? 0;
          const isActive = treeKind === t.key;
          const canManageTab = canEdit && t.custom;
          return (
            <div key={t.key} className="group relative flex items-center">
              <button
                onClick={() => setTreeKind(t.key)}
                className={`flex items-center gap-1.5 rounded-md py-2 px-3 text-sm font-semibold transition ${isActive ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500'}`}
              >
                {t.label}
                {count > 0 && <span className={`rounded-full px-1.5 text-[9px] ${isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-400'}`}>{count}</span>}
              </button>
              {canManageTab && (
                <div className="ml-0.5 hidden items-center group-hover:flex">
                  <button onClick={() => setRenameTabKey(t.key)} className="rounded p-0.5 text-ink-400 hover:bg-primary-100 hover:text-primary-600" title="Rename tab"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => setDeleteTabKey(t.key)} className="rounded p-0.5 text-ink-400 hover:bg-danger-100 hover:text-danger-600" title="Delete tab (must be empty)"><X className="h-3 w-3" /></button>
                </div>
              )}
            </div>
          );
        })}
        {canEdit && (
          <button onClick={() => setAddTabOpen(true)} className="ml-auto flex items-center gap-1 rounded-md bg-primary-50 px-2.5 py-1.5 text-xs font-bold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300" title="Add custom document tab">
            <Plus className="h-3.5 w-3.5" /> New Tab
          </button>
        )}
      </div>

      {/* Tree panel */}
      <div className="rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-primary-500" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-white">{activeTab?.label}</span>
              <span className="ml-2 text-[11px] text-ink-400">{activeTab?.subtitle}</span>
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button onClick={() => setAddDocFor({ parentId: null })} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300" title="Add a document at root level">
                <FilePlus2 className="h-4 w-4" /> Add Document
              </button>
              <button onClick={() => setAddFolderFor({ parentId: null })} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-bold text-accent-700 transition hover:bg-accent-100 dark:bg-accent-900/30 dark:text-accent-300" title="Create a new root folder">
                <FolderPlus className="h-4 w-4" /> Create Folder
              </button>
            </div>
          )}
        </div>
        <div className="p-2" style={{ maxHeight: '520px', overflowY: 'auto' }}>
          {loading ? <p className="py-8 text-center text-sm text-ink-400">Loading…</p> :
           roots.length === 0 ? (
             <div className="py-8 text-center">
               <FolderTree className="mx-auto h-8 w-8 text-ink-300" />
               <p className="mt-2 text-sm text-ink-400">No documents in this tab yet.</p>
               {canEdit && <p className="mt-1 text-xs text-ink-400">Use <strong>Create Folder</strong> or <strong>Add Document</strong> above to start building your section hierarchy.</p>}
             </div>
           ) :
           roots.map((r) => renderNode(r, 0))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-200/70 bg-ink-50 p-3 text-xs dark:border-ink-800 dark:bg-ink-900/50">
        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-success-500" /> Approved — visible to fleet</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-warning-500" /> Pending DPA approval</span>
        <span className="flex items-center gap-1.5"><ExternalLink className="h-3 w-3 text-primary-500" /> Click document opens in new tab</span>
        <span className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-ink-400" /> Eye icon for inline preview</span>
        <span className="flex items-center gap-1.5"><Pencil className="h-3 w-3 text-ink-400" /> Rename any folder inline</span>
        <span className="flex items-center gap-1.5"><FolderPlus className="h-3 w-3 text-accent-500" /> Add subfolder inside any folder</span>
        <span className="flex items-center gap-1.5"><FilePlus2 className="h-3 w-3 text-primary-500" /> Add document inside any folder</span>
      </div>

      {/* Modals */}
      {addFolderFor && (
        <AddFolderModal
          onClose={() => { setAddFolderFor(null); setFolderDepthError(''); }}
          onAdd={handleAddFolder}
          depthError={folderDepthError}
          maxDepth={maxSubfolderDepth}
        />
      )}

      {addDocFor && (
        <AddDocumentModal
          onClose={() => setAddDocFor(null)}
          onAdd={handleAddDocument}
          maxUploadMb={maxUploadSizeMb}
        />
      )}

      {editorFor && (
        <ContentEditor node={editorFor} onClose={() => setEditorFor(null)} onSave={handleSaveEdit} maxUploadMb={maxUploadSizeMb} />
      )}

      {previewFor && (
        <DocumentPreview node={previewFor} onClose={() => setPreviewFor(null)} />
      )}

      {deleteFor && (
        <DeleteNodeModal
          node={deleteFor}
          onClose={() => setDeleteFor(null)}
          onConfirm={confirmDeleteNode}
        />
      )}

      {addTabOpen && <AddTabModal onClose={() => setAddTabOpen(false)} onAdd={addCustomTab} existing={tabs.map((t) => t.label)} />}

      {renameTabKey && (
        <RenameTabModal
          current={customTabs[renameTabKey]?.label ?? renameTabKey}
          onClose={() => setRenameTabKey(null)}
          onRename={(l) => renameCustomTab(renameTabKey, l)}
        />
      )}

      {deleteTabKey && (
        <DeleteTabModal
          tab={customTabs[deleteTabKey]}
          docCount={allDocCount[deleteTabKey] ?? 0}
          onClose={() => setDeleteTabKey(null)}
          onConfirm={() => deleteCustomTab(deleteTabKey)}
        />
      )}

      {/* SMS Profile modals */}
      {createProfileOpen && (
        <CreateProfileModal
          onClose={() => setCreateProfileOpen(false)}
          onCreate={handleCreateProfile}
        />
      )}
      {deleteProfileTarget && (
        <Modal
          open
          onClose={() => setDeleteProfileTarget(null)}
          title="Delete SMS Profile"
          subtitle={deleteProfileTarget.name}
          icon={<Trash2 className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setDeleteProfileTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDeleteProfile} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">Delete Profile</button>
            </>
          }
        >
          <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Deleting <strong>{deleteProfileTarget.name}</strong> will unassign {deleteProfileTarget.vesselCount} vessel(s). Vessels will fall back to the default profile. This cannot be undone.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DocumentPreview({ node, onClose }: { node: SmsDocRow; onClose: () => void }) {
  const pdfUrl = node.content_kind === 'pdf' && node.content ? `https://www.maritime-sms-docs.example.com/${encodeURIComponent(node.content)}` : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={node.label}
      subtitle={node.content_kind === 'pdf' ? 'PDF Document' : 'Rich Text Document'}
      icon={<Eye className="h-5 w-5" />}
      size="2xl"
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={() => openInNewTab(node)} className="btn-secondary">
            <ExternalLink className="h-4 w-4" /> Open in New Tab
          </button>
          <button onClick={() => printDoc(node)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
            <Printer className="h-4 w-4" /> Print Document
          </button>
        </div>
      }
    >
      {node.content_kind === 'pdf' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{node.content}</span>
          </div>
          {/* Inline browser PDF viewer — uses the browser's native PDF renderer */}
          {node.content ? (
            <iframe
              src={`data:application/pdf;filename=${encodeURIComponent(node.content)},base64,JVBERi0xLjEKJcKlwrHDqMKw`}
              title={node.label}
              className="h-[60vh] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700"
              style={{ minHeight: '400px' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-200 bg-ink-50 py-16 dark:border-ink-700 dark:bg-ink-800/50">
              <FileText className="h-12 w-12 text-ink-300" />
              <p className="mt-3 text-sm font-semibold text-ink-600 dark:text-ink-300">No PDF file attached</p>
              <p className="mt-1 text-xs text-ink-400">Use the edit button to upload a PDF file.</p>
            </div>
          )}
          {pdfUrl && (
            <p className="text-center text-[11px] text-ink-400">If the preview doesn't render, use "Open in New Tab" for the full view.</p>
          )}
        </div>
      ) : (
        <div className="max-h-[75vh] overflow-y-auto px-2 py-2 sm:px-4 sm:py-4">
          {node.content ? (
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-[1.85] text-ink-800 dark:text-ink-200">{node.content}</pre>
          ) : (
            <p className="py-8 text-center text-sm text-ink-400">No content yet. Use the edit button to add document body text.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddFolderModal({ onClose, onAdd, depthError, maxDepth }: { onClose: () => void; onAdd: (label: string) => void; depthError: string; maxDepth: number }) {
  const [label, setLabel] = useState('');
  return (
    <Modal open onClose={onClose} title="Create Folder" subtitle="Add a new folder or subfolder" icon={<FolderPlus className="h-5 w-5" />} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={!label.trim()} onClick={() => onAdd(label.trim())} className="btn-primary">Create Folder</button></>}>
      <label className="label">Folder name</label>
      <input autoFocus className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Section 1, Emergency Procedures"
        onKeyDown={(e) => { if (e.key === 'Enter' && label.trim()) onAdd(label.trim()); }} />
      <p className="mt-2 text-[11px] text-ink-400">Max subfolder depth for this tenant: {maxDepth} levels.</p>
      {depthError && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-2 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {depthError}
        </div>
      )}
    </Modal>
  );
}

function AddDocumentModal({ onClose, onAdd, maxUploadMb }: { onClose: () => void; onAdd: (label: string, contentKind: 'rich_text' | 'pdf', content: string) => void; maxUploadMb: number }) {
  const [label, setLabel] = useState('');
  const [contentKind, setContentKind] = useState<'rich_text' | 'pdf'>('rich_text');
  const [text, setText] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [pdfSize, setPdfSize] = useState<number | null>(null);
  const [sizeError, setSizeError] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeMb = file.size / (1024 * 1024);
    // Clean up previous preview URL
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    if (sizeMb > maxUploadMb) {
      setSizeError(`File is ${sizeMb.toFixed(1)} MB — exceeds the ${maxUploadMb} MB limit set by Super Admin.`);
      setPdfName('');
      setPdfSize(null);
      setPdfPreviewUrl(null);
      return;
    }
    setSizeError('');
    setPdfName(file.name);
    setPdfSize(file.size);
    // Auto-fill label from filename if empty
    if (!label.trim()) setLabel(file.name.replace(/\.pdf$/i, ''));
    // Create object URL for inline preview
    setPdfPreviewUrl(URL.createObjectURL(file));
  }

  // Clean up object URL on unmount
  useEffect(() => {
    return () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); };
  }, [pdfPreviewUrl]);

  const canSubmit = label.trim().length > 0 && (contentKind === 'rich_text' || (contentKind === 'pdf' && pdfName && !sizeError));

  return (
    <Modal open onClose={onClose} title="Add Document" subtitle="Upload a PDF or draft a rich-text policy" icon={<FilePlus2 className="h-5 w-5" />} size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={!canSubmit} onClick={() => onAdd(label.trim(), contentKind, contentKind === 'pdf' ? pdfName : text)} className="btn-primary">Add Document</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label">Document name</label>
          <input autoFocus className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Emergency Response Plan, manual.pdf" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TypeBtn active={contentKind === 'rich_text'} onClick={() => setContentKind('rich_text')} label="Rich text editor" />
          <TypeBtn active={contentKind === 'pdf'} onClick={() => setContentKind('pdf')} label="Upload PDF" />
        </div>
        {contentKind === 'rich_text' ? (
          <div>
            <label className="label">Document body</label>
            <textarea rows={10} className="input resize-none font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste your policy document here…" />
          </div>
        ) : (
          <div className="space-y-3">
            <label className="label">Select PDF file</label>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700">
                <Upload className="h-4 w-4" /> Choose file
                <input type="file" accept="application/pdf" className="hidden" onChange={handleFilePick} />
              </label>
              {pdfName && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-warning-500" />
                  <span className="font-medium text-ink-700 dark:text-ink-200">{pdfName}</span>
                  {pdfSize !== null && <span className="text-xs text-ink-400">({(pdfSize / 1024).toFixed(0)} KB)</span>}
                </div>
              )}
            </div>
            {sizeError && (
              <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-2 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {sizeError}
              </div>
            )}
            <p className="text-xs text-ink-400">Maximum file size: {maxUploadMb} MB · PDF format only</p>
            {/* Live inline PDF preview after file selection */}
            {pdfPreviewUrl && !sizeError && (
              <div className="space-y-1.5">
                <label className="label">Live preview</label>
                <iframe
                  src={pdfPreviewUrl}
                  title="PDF preview"
                  className="h-[300px] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteNodeModal({ node, onClose, onConfirm }: { node: TreeNode; onClose: () => void; onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  const childCount = node.children.length;
  async function handle() { setBusy(true); await onConfirm(); setBusy(false); }
  return (
    <Modal open onClose={onClose} title={`Delete ${node.node_kind === 'folder' ? 'Folder' : 'Document'}`} subtitle={node.label}
      icon={<Trash2 className="h-5 w-5" />} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={busy} onClick={handle} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Delete ${node.node_kind === 'folder' ? 'Folder' : 'Document'}`}
        </button></>}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Are you sure you want to delete <strong>{node.label}</strong>?
            {childCount > 0 && <span> This will also delete <strong>{childCount}</strong> item(s) inside this folder.</span>}
            This action cannot be undone.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AddTabModal({ onClose, onAdd, existing }: { onClose: () => void; onAdd: (label: string) => void; existing: string[] }) {
  const [label, setLabel] = useState('');
  const dup = existing.some((e) => e.toLowerCase() === label.trim().toLowerCase());
  return (
    <Modal open onClose={onClose} title="Add Document Tab" subtitle="Create a custom high-level document group" icon={<Plus className="h-5 w-5" />} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={!label.trim() || dup} onClick={() => onAdd(label.trim())} className="btn-primary">Create Tab</button></>}>
      <label className="label">Tab name</label>
      <input autoFocus className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Audit Reports, Vessel Manuals" />
      {dup && <p className="mt-1.5 text-xs text-danger-600">A tab with this name already exists.</p>}
    </Modal>
  );
}

function RenameTabModal({ current, onClose, onRename }: { current: string; onClose: () => void; onRename: (l: string) => void }) {
  const [label, setLabel] = useState(current);
  return (
    <Modal open onClose={onClose} title="Rename Tab" icon={<Pencil className="h-5 w-5" />} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button disabled={!label.trim()} onClick={() => onRename(label.trim())} className="btn-primary">Rename</button></>}>
      <label className="label">New tab name</label>
      <input autoFocus className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
    </Modal>
  );
}

function DeleteTabModal({ tab, docCount, onClose, onConfirm }: { tab: TabDef | undefined; docCount: number; onClose: () => void; onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  const blocked = docCount > 0;
  async function handle() { if (blocked) return; setBusy(true); await onConfirm(); setBusy(false); }
  return (
    <Modal open onClose={onClose} title="Delete Document Tab" subtitle={tab?.label} icon={<Trash2 className="h-5 w-5" />} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button disabled={blocked || busy} onClick={handle} className="btn-primary !bg-danger-600 !text-white hover:!bg-danger-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Tab'}
        </button></>}>
      {blocked ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This tab contains <strong>{docCount}</strong> document(s). Remove all documents and folders before deleting the tab.</p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This will remove the empty tab <strong>{tab?.label}</strong>. This cannot be undone.</p>
        </div>
      )}
    </Modal>
  );
}

function TypeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${active ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'}`}>{label}</button>
  );
}

function computeNodeDepth(index: Map<string, SmsDocRow>, nodeId: string): number {
  let depth = 0;
  let currentId: string | null = nodeId;
  const guard = new Set<string>();
  while (currentId && !guard.has(currentId)) {
    guard.add(currentId);
    const node = index.get(currentId);
    if (!node || !node.parent_id) break;
    depth++;
    currentId = node.parent_id;
  }
  return depth;
}

function ContentEditor({ node, onClose, onSave, maxUploadMb }: { node: TreeNode; onClose: () => void; onSave: (content: string, contentKind: 'rich_text' | 'pdf') => void; maxUploadMb: number }) {
  const [contentKind, setContentKind] = useState<'rich_text' | 'pdf'>(node.content_kind ?? 'rich_text');
  const [text, setText] = useState(node.content ?? '');
  const [pdfName, setPdfName] = useState(node.content_kind === 'pdf' ? (node.content ?? '') : '');
  const [pdfSize, setPdfSize] = useState<number | null>(null);
  const [sizeError, setSizeError] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeMb = file.size / (1024 * 1024);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    if (sizeMb > maxUploadMb) {
      setSizeError(`File is ${sizeMb.toFixed(1)} MB — exceeds the ${maxUploadMb} MB limit set by Super Admin.`);
      setPdfName('');
      setPdfSize(null);
      setPdfPreviewUrl(null);
      return;
    }
    setSizeError('');
    setPdfName(file.name);
    setPdfSize(file.size);
    setPdfPreviewUrl(URL.createObjectURL(file));
  }

  useEffect(() => {
    return () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); };
  }, [pdfPreviewUrl]);

  return (
    <Modal open onClose={onClose} title={`Edit: ${node.label}`} subtitle="Saving marks as pending DPA approval" icon={<FileEdit className="h-5 w-5" />} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={contentKind === 'pdf' && !!sizeError} onClick={() => onSave(contentKind === 'pdf' ? pdfName : text, contentKind)} className="btn-primary">Save (marks pending)</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <TypeBtn active={contentKind === 'rich_text'} onClick={() => setContentKind('rich_text')} label="Rich text editor" />
          <TypeBtn active={contentKind === 'pdf'} onClick={() => setContentKind('pdf')} label="Upload PDF" />
        </div>
        {contentKind === 'rich_text' ? (
          <div>
            <label className="label">Document body</label>
            <textarea rows={12} className="input resize-none font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-3">
            <label className="label">Replace PDF file</label>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700">
                <Upload className="h-4 w-4" /> Choose file
                <input type="file" accept="application/pdf" className="hidden" onChange={handleFilePick} />
              </label>
              {pdfName && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-warning-500" />
                  <span className="font-medium text-ink-700 dark:text-ink-200">{pdfName}</span>
                  {pdfSize !== null && <span className="text-xs text-ink-400">({(pdfSize / 1024).toFixed(0)} KB)</span>}
                </div>
              )}
            </div>
            {sizeError && (
              <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-2 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {sizeError}
              </div>
            )}
            <p className="text-xs text-ink-400">Maximum file size: {maxUploadMb} MB · PDF format only</p>
            {pdfPreviewUrl && !sizeError && (
              <div className="space-y-1.5">
                <label className="label">Live preview</label>
                <iframe
                  src={pdfPreviewUrl}
                  title="PDF preview"
                  className="h-[300px] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── SMS Fleet Scope Bar ────────────────────────────────────────────────── */

function SmsFleetScopeBar({
  profiles, activeProfile, onSelect, onCreate, onDelete, canEdit, canManageProfiles,
  dropdownOpen, setDropdownOpen, tenantId, refreshKey,
}: {
  profiles: SmsProfileWithVessels[];
  activeProfile: SmsProfileWithVessels | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (p: SmsProfileWithVessels) => void;
  canEdit: boolean;
  canManageProfiles: boolean;
  dropdownOpen: boolean;
  setDropdownOpen: (v: boolean) => void;
  tenantId: string;
  refreshKey: number;
}) {
  const [allVessels, setAllVessels] = useState<{ id: string; name: string }[]>([]);
  const [freshVesselIds, setFreshVesselIds] = useState<string[]>([]);
  const [vesselPopoverOpen, setVesselPopoverOpen] = useState(false);

  useEffect(() => {
    if (!tenantId) { setAllVessels([]); return; }
    getVesselsForTenant(tenantId).then((vs) =>
      setAllVessels(vs.map((v) => ({ id: v.id, name: v.name }))));
  }, [tenantId, refreshKey]);

  // Fetch fresh profile assignments directly — the parent's profiles prop is
  // loaded once at mount and goes stale when vessels are assigned in the
  // Fleet & Vessel Profiles tab.
  useEffect(() => {
    if (!tenantId || !activeProfile) { setFreshVesselIds([]); return; }
    let cancelled = false;
    loadProfiles(tenantId).then((list) => {
      if (cancelled) return;
      setFreshVesselIds(list.find((p) => p.id === activeProfile.id)?.vesselIds ?? []);
    });
    return () => { cancelled = true; };
  }, [tenantId, activeProfile?.id, refreshKey]);

  const assignedVessels = freshVesselIds
    .map((id) => allVessels.find((v) => v.id === id))
    .filter((v): v is { id: string; name: string } => !!v);
  const assignedCount = assignedVessels.length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50/80 to-white p-4 dark:border-primary-800 dark:from-primary-900/20 dark:to-ink-900 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <label className="text-[11px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">SMS Fleet Scope</label>
          <div className="relative mt-0.5">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm font-semibold text-ink-800 transition hover:border-primary-400 dark:border-ink-700 dark:bg-ink-800 dark:text-white"
            >
              <span className="truncate">
                Active Profile: {activeProfile?.name ?? '—'}
              </span>
              <ChevronDownIcon className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                <div className="absolute left-0 z-40 mt-1 rounded-lg border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900" style={{ minWidth: '340px', maxWidth: '90vw' }}>
                  {profiles.map((p) => (
                    <div key={p.id} className="group flex flex-row items-center justify-between gap-2 px-3 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800">
                      <button
                        onClick={() => { onSelect(p.id); setDropdownOpen(false); }}
                        className={`flex flex-1 flex-row items-center justify-between gap-2 text-left text-sm ${activeProfile?.id === p.id ? 'font-bold text-primary-700 dark:text-primary-300' : 'text-ink-700 dark:text-ink-200'}`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Ship className="h-4 w-4 shrink-0 text-accent-500" />
                          {p.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-400">{p.vesselCount} vessel{p.vesselCount !== 1 ? 's' : ''}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setVesselPopoverOpen(!vesselPopoverOpen)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-700 transition hover:bg-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
              title="View assigned vessels"
            >
              <Ship className="h-3.5 w-3.5" />
              {assignedCount} Vessel{assignedCount !== 1 ? 's' : ''} Assigned
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${vesselPopoverOpen ? 'rotate-180' : ''}`} />
            </button>
            {vesselPopoverOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setVesselPopoverOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900">
                  <div className="border-b border-ink-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:border-ink-700">
                    {activeProfile?.name ?? '—'} — Assigned Vessels
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {assignedVessels.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-ink-400">No vessels assigned to this profile yet</p>
                    ) : assignedVessels.map((v) => (
                      <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink-700 dark:text-ink-200">
                        <Ship className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                        {v.name}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          {canManageProfiles && (
            <>
              {activeProfile && (
                <button
                  onClick={() => onDelete(activeProfile)}
                  className="rounded-lg p-2 text-ink-400 transition hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                  title="Delete profile"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={onCreate}
                className="btn-primary !py-2 !text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> New Profile
              </button>
            </>
          )}
        </div>
        <span className="text-[10px] text-ink-400">
          To assign vessels to this profile, edit them in Fleet &amp; Vessel Profiles
        </span>
      </div>
    </div>
  );
}

function CreateProfileModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');

  const examples = ['Tanker Fleet SMS', 'Bulk Carrier SMS', 'Offshore Ops SMS', 'Container Fleet SMS'];

  return (
    <Modal
      open
      onClose={onClose}
      title="Create SMS Fleet Profile"
      subtitle="Create a new SMS profile to assign to specific vessels"
      icon={<Layers className="h-5 w-5" />}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => onCreate(name)} disabled={!name.trim()} className="btn-primary disabled:opacity-50">
            <Plus className="h-4 w-4" /> Create Profile
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">Profile Name</label>
          <input
            className="input"
            placeholder="e.g. Tanker Fleet SMS"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name); }}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">Quick Examples</label>
          <div className="flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setName(ex)}
                className="rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}


