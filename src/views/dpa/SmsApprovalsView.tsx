import { useEffect, useState, useCallback } from 'react';
import {
  FileText, Clock, CheckCircle2, XCircle, Loader2,
  ChevronDown, ChevronRight, Folder, FileEdit, Printer, Shield, Layers,
  Ship, Inbox, Filter, ExternalLink, Upload, Pencil, PenTool, Eye,
  AlertCircle, FilePlus2, X, Save, BookOpen, UserCircle, Trash2,
} from 'lucide-react';
import { supabase, type SmsDocRow } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAudit } from '../../lib/audit';
import { postSyncEvent, onSyncEvent } from '../../lib/syncChannel';
import {
  isDemoMode, getEffectiveDemoSmsDocs, demoApproveSmsDoc, demoRejectSmsDoc,
  demoCreateSmsDoc, demoUpdateSmsDocContent, demoRenameSmsDoc, demoDeleteSmsDoc,
  demoGetWorkspaceFrozen,
} from '../../lib/demoData';
import { loadProfiles, type SmsProfileWithVessels } from '../../lib/smsProfiles';
import { useFleetScope } from '../../lib/useFleetScope';
import { deployBaseline } from '../../lib/deployBaseline';
import { getShorePermsForRole, canDoShore, resolveShoreRoleName, dpaFullAuthority } from '../../lib/shoreRoles';
import { Modal } from '../../components/Modal';

interface Crumb {
  label: string;
  kind: 'root' | 'folder' | 'document';
}

const BUILTIN_TABS = [
  { key: 'sms', label: 'SMS Documents', subtitle: 'Safety Management System' },
  { key: 'fleet_circulars', label: 'Fleet Circulars', subtitle: 'Company-wide directives' },
  { key: 'flag_state', label: 'Flag State Documents', subtitle: 'Flag authority requirements' },
];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openDocInNewTab(node: SmsDocRow) {
  const title = escapeHtml(node.label);
  const body = escapeHtml(node.content ?? '');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Georgia,serif;max-width:1100px;margin:32px auto;padding:40px 56px;line-height:1.8;color:#1a202c;background:#fff;}h1{color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:24px;font-family:system-ui,sans-serif;}.meta{font-size:12px;color:#718096;margin-bottom:24px;font-family:system-ui,sans-serif;}.content{white-space:pre-wrap;font-size:15px;}</style></head><body><h1>${title}</h1><div class="meta">SMS Document &middot; ${node.approval_state} &middot; v${node.version}</div><div class="content">${body}</div></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function BreadcrumbChips({ crumbs, size = 'sm' }: { crumbs: Crumb[]; size?: 'sm' | 'xs' }) {
  const chipSize = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const iconSize = size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  return (
    <div className="flex flex-wrap items-center gap-1">
      {crumbs.flatMap((c, i) => {
        const els: React.ReactNode[] = [];
        if (i > 0) els.push(<ChevronRight key={`sep-${i}`} className={`${iconSize} shrink-0 text-ink-300 dark:text-ink-600`} />);
        els.push(
          <span key={`crumb-${i}`} className={`inline-flex items-center gap-1 rounded font-medium ${chipSize} ${
            c.kind === 'root' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' :
            c.kind === 'document' ? 'bg-accent-100 font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' :
            'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
          }`}>
            {c.kind === 'folder' && <Folder className={`${iconSize} shrink-0 text-ink-400 dark:text-ink-500`} />}
            {c.label}
          </span>
        );
        return els;
      })}
    </div>
  );
}

export function SmsApprovalsView() {
  const { tenant, tenantUser, refresh } = useAuth();
  const fleetScope = useFleetScope();
  const [pendingDocs, setPendingDocs] = useState<SmsDocRow[]>([]);
  const [allDocsIndex, setAllDocsIndex] = useState<Map<string, SmsDocRow>>(new Map());
  const [selectedDoc, setSelectedDoc] = useState<SmsDocRow | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [workspaceFrozen, setWorkspaceFrozen] = useState(false);
  const [profiles, setProfiles] = useState<SmsProfileWithVessels[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [filterTreeKind, setFilterTreeKind] = useState<string>('all');

  // Permission-gated action modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<SmsDocRow | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureTitle, setSignatureTitle] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Section-by-section collapsible reader state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [sectionMode, setSectionMode] = useState(true);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  // ── Shore permissions ─────────────────────────────────────────────
  // DPA accounts always have full SMS authorities regardless of any
  // Company Admin permission overrides, per ISM Code requirements.
  const rawShoreRoleName = tenantUser?.rank ?? 'DPA';
  const resolvedRoleName = resolveShoreRoleName(rawShoreRoleName);
  const isDpaRole = resolvedRoleName === 'Designated Person Ashore (DPA)' ||
    (tenantUser?.email?.toLowerCase() ?? '') === 'dpa@nordicreef.no';
  const shorePerms = tenant
    ? (isDpaRole ? dpaFullAuthority() : getShorePermsForRole(tenant.id, resolvedRoleName))
    : null;
  const canApprove = canDoShore(shorePerms, 'approve_sms');
  const canEdit = canDoShore(shorePerms, 'edit_sms');
  const canUpload = canDoShore(shorePerms, 'upload_sms');
  const canDeploy = canDoShore(shorePerms, 'deploy_sms');

  const loadPending = useCallback(() => {
    if (!tenant) return;
    let all: SmsDocRow[];
    if (isDemoMode()) {
      all = getEffectiveDemoSmsDocs(tenant.id);
    } else {
      supabase.from('sms_documents').select('*').eq('tenant_id', tenant.id).order('updated_at', { ascending: false })
        .then(({ data }) => { all = (data as SmsDocRow[]) ?? []; applyData(all); });
      return;
    }
    applyData(all);

    function applyData(raw: SmsDocRow[]) {
      const effectiveProfileId = activeProfileId ?? (fleetScope.isRestricted ? (profiles.find((p) => fleetScope.canAccessProfile(p.id))?.id ?? null) : null);
      const filtered = effectiveProfileId ? raw.filter((d) => d.profile_id === null || d.profile_id === effectiveProfileId) : raw;
      const idx = new Map<string, SmsDocRow>();
      filtered.forEach((r) => idx.set(r.id, r));
      setAllDocsIndex(idx);
      const pending = filtered.filter((r) => r.approval_state === 'pending_dpa');
      setPendingDocs(pending);
      if (selectedDoc && !pending.find((d) => d.id === selectedDoc.id)) {
        setSelectedDoc(null);
        setRejectMode(false);
        setRejectComments('');
      }
    }
  }, [tenant, activeProfileId, selectedDoc, fleetScope.isRestricted, profiles]);

  useEffect(() => { loadPending(); }, [loadPending, syncTick]);

  useEffect(() => {
    if (!tenant) return;
    loadProfiles(tenant.id).then((list) => {
      const scoped = fleetScope.filterProfiles(list);
      setProfiles(scoped);
      if (fleetScope.isRestricted) {
        if (!activeProfileId || !scoped.some((p) => p.id === activeProfileId)) {
          setActiveProfileId(scoped.length > 0 ? scoped[0].id : null);
        }
      } else if (!activeProfileId && scoped.length > 0) {
        setActiveProfileId(scoped[0].id);
      }
    });
  }, [tenant, syncTick, fleetScope.isGlobal, fleetScope.assignedVesselIds.join(','), fleetScope.assignedFleetProfileIds.join(',')]);

  useEffect(() => {
    if (!tenant || !isDemoMode()) return;
    setWorkspaceFrozen(demoGetWorkspaceFrozen(tenant.id));
  }, [tenant, syncTick]);

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

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  }

  function resolveCrumbs(doc: SmsDocRow): Crumb[] {
    const tabLabel = BUILTIN_TABS.find((t) => t.key === doc.tree_kind)?.label ?? doc.tree_kind.replace(/_/g, ' ');
    const crumbs: Crumb[] = [{ label: tabLabel, kind: 'root' }];
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
    chain.forEach((label) => crumbs.push({ label, kind: 'folder' }));
    crumbs.push({ label: doc.label, kind: 'document' });
    return crumbs;
  }

  function getParentFolderLabel(doc: SmsDocRow): string | null {
    if (!doc.parent_id) return null;
    return allDocsIndex.get(doc.parent_id)?.label ?? null;
  }

  // ── Approve & Deploy with DPA digital signature ───────────────────
  async function handleApprove(doc: SmsDocRow) {
    if (!tenant) return;
    setShowSignModal(true);
    setSelectedDoc(doc);
  }

  async function executeApproveAndDeploy() {
    if (!tenant || !selectedDoc || !signatureName.trim() || !signatureTitle.trim()) return;
    setDeploying(true);
    const oldVersion = tenant.sms_version;
    if (isDemoMode()) {
      demoApproveSmsDoc(tenant.id, selectedDoc.id);
    } else {
      await supabase.from('sms_documents').update({ approval_state: 'approved' }).eq('id', selectedDoc.id).eq('tenant_id', tenant.id);
    }
    let newVersion: string | null = null;
    if (canDeploy) {
      newVersion = await deployBaseline(tenant.id, tenantUser!.email);
    }
    const versionLabel = newVersion ?? oldVersion;
    await logAudit({
      tenantId: tenant.id,
      actorEmail: tenantUser!.email,
      category: 'sms',
      action: `DPA APPROVED & DEPLOYED: ${selectedDoc.label} (SMS v${oldVersion} → v${versionLabel}). Digital signature: ${signatureName} (${signatureTitle}). Document deployed to all fleet vessels.`,
      target: selectedDoc.tree_kind,
      location: tenant!.company,
      severity: 'warning',
    });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'approved', docId: selectedDoc.id, label: selectedDoc.label, version: versionLabel } });
    await refresh();
    setDeploying(false);
    setShowSignModal(false);
    setSignatureName('');
    setSignatureTitle('');
    setSelectedDoc(null);
    setRejectMode(false);
    setRejectComments('');
    setSyncTick((t) => t + 1);
    showToast(`Approved & deployed to fleet. SMS v${versionLabel}. Signed by ${signatureName}.`, true);
  }

  async function handleReject(doc: SmsDocRow) {
    if (!tenant) return;
    setRejectingId(doc.id);
    if (isDemoMode()) {
      demoRejectSmsDoc(tenant.id, doc.id, rejectComments);
    } else {
      await supabase.from('sms_documents').update({
        approval_state: 'rejected',
        rejection_comments: rejectComments.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', doc.id).eq('tenant_id', tenant.id);
    }
    await logAudit({ tenantId: tenant.id, actorEmail: tenantUser!.email, category: 'sms', action: `DPA rejected: ${doc.label}`, target: doc.tree_kind, location: tenant!.company, severity: 'warning' });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'rejected', docId: doc.id, label: doc.label } });
    setRejectingId(null);
    setSelectedDoc(null);
    setRejectMode(false);
    setRejectComments('');
    setSyncTick((t) => t + 1);
    showToast(`Document rejected with comments.`, true);
  }

  async function handlePurge(doc: SmsDocRow) {
    if (!tenant) return;
    setPurgingId(doc.id);
    if (isDemoMode()) {
      demoDeleteSmsDoc(tenant.id, doc.id);
    } else {
      await supabase.from('sms_documents').delete().eq('id', doc.id).eq('tenant_id', tenant.id);
    }
    await logAudit({
      tenantId: tenant.id,
      actorEmail: tenantUser!.email,
      category: 'sms',
      action: `DRAFT_PURGED: DPA discarded draft "${doc.label}" permanently from the review queue.`,
      target: doc.tree_kind,
      location: tenant!.company,
      severity: 'warning',
    });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'draft_purged', docId: doc.id, label: doc.label } });
    setPurgingId(null);
    setShowPurgeModal(false);
    setSelectedDoc(null);
    setSyncTick((t) => t + 1);
    showToast(`Draft "${doc.label}" purged permanently.`, true);
  }

  // ── Upload new SMS document ────────────────────────────────────────
  async function handleUpload(data: {
    label: string; docId: string; treeKind: string; profileId: string | null;
    parentId: string | null; content: string; contentKind: 'rich_text' | 'pdf';
  }) {
    if (!tenant) return;
    if (isDemoMode()) {
      demoCreateSmsDoc(tenant.id, {
        parent_id: data.parentId,
        tree_kind: data.treeKind,
        label: data.label,
        node_kind: 'document',
        content_kind: data.contentKind,
        content: data.content,
        profile_id: data.profileId,
        author_name: tenantUser?.name ?? 'DPA',
        author_role: 'DPA',
        author_origin: 'Shoreside HQ',
      });
    } else {
      await supabase.from('sms_documents').insert({
        tenant_id: tenant.id,
        parent_id: data.parentId,
        tree_kind: data.treeKind,
        label: data.label,
        node_kind: 'document',
        content_kind: data.contentKind,
        content: data.content,
        approval_state: 'pending_dpa',
        version: '1.0.0',
        sort_order: 999,
        profile_id: data.profileId,
        author_name: tenantUser?.name ?? 'DPA',
        author_role: 'DPA',
        author_origin: 'Shoreside HQ',
      });
    }
    await logAudit({
      tenantId: tenant.id,
      actorEmail: tenantUser!.email,
      category: 'sms',
      action: `SMS Upload: ${data.label} (${data.treeKind}) — submitted for DPA approval. Doc ID: ${data.docId}`,
      target: data.treeKind,
      location: tenant!.company,
    });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'uploaded', label: data.label } });
    setShowUploadModal(false);
    setSyncTick((t) => t + 1);
    showToast(`"${data.label}" uploaded and submitted for DPA approval.`, true);
  }

  // ── Edit SMS section content ───────────────────────────────────────
  function startEdit(doc: SmsDocRow) {
    setEditingDoc(doc);
    setEditContent(doc.content ?? '');
    setEditLabel(doc.label);
  }

  async function saveEdit() {
    if (!tenant || !editingDoc) return;
    setSavingEdit(true);
    if (isDemoMode()) {
      demoRenameSmsDoc(tenant.id, editingDoc.id, editLabel);
      demoUpdateSmsDocContent(tenant.id, editingDoc.id, editContent, editingDoc.content_kind ?? 'rich_text', tenantUser?.name ?? 'DPA', 'DPA', 'Shoreside HQ');
    } else {
      await supabase.from('sms_documents').update({
        label: editLabel,
        content: editContent,
        approval_state: 'pending_dpa',
        author_name: tenantUser?.name ?? 'DPA',
        author_role: 'DPA',
        author_origin: 'Shoreside HQ',
        updated_at: new Date().toISOString(),
      }).eq('id', editingDoc.id).eq('tenant_id', tenant.id);
    }
    await logAudit({
      tenantId: tenant.id,
      actorEmail: tenantUser!.email,
      category: 'sms',
      action: `SMS Edit: ${editingDoc.label} — content updated and resubmitted for DPA approval`,
      target: editingDoc.tree_kind,
      location: tenant!.company,
    });
    postSyncEvent({ type: 'SMS_UPDATED', tenantId: tenant.id, payload: { action: 'edited', docId: editingDoc.id } });
    setSavingEdit(false);
    setEditingDoc(null);
    setSyncTick((t) => t + 1);
    showToast(`Section "${editLabel}" updated and resubmitted for approval.`, true);
  }

  // ── Section-by-section reader helpers ──────────────────────────────
  const sectionGroups = useCallback(() => {
    // Group pending docs by their parent folder (section)
    const groups = new Map<string, { sectionLabel: string; docs: SmsDocRow[] }>();
    for (const doc of pendingDocs) {
      const parentLabel = getParentFolderLabel(doc) ?? 'Unsectioned';
      const key = doc.parent_id ?? 'root';
      if (!groups.has(key)) groups.set(key, { sectionLabel: parentLabel, docs: [] });
      groups.get(key)!.docs.push(doc);
    }
    return [...groups.values()];
  }, [pendingDocs, allDocsIndex]);

  function toggleSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredPending = filterTreeKind === 'all' ? pendingDocs : pendingDocs.filter((d) => d.tree_kind === filterTreeKind);
  const treeKinds = ['all', ...Array.from(new Set(pendingDocs.map((d) => d.tree_kind)))];
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  const selectedCrumbs = selectedDoc ? resolveCrumbs(selectedDoc) : [];
  const sections = sectionGroups();

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)]">
      {toast && (
        <div className={`fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.ok ? 'bg-success-500 text-white' : 'bg-danger-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent-500" />
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">SMS Approvals Queue</h1>
        </div>
        <p className="text-sm text-ink-500 dark:text-ink-400">Review and approve pending SMS document revisions before deployment to fleet.</p>
      </div>

      {workspaceFrozen && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
          <Shield className="h-4 w-4 shrink-0" />
          <span><strong>Workspace Frozen by Super Admin.</strong> SMS approvals are suspended until the freeze is lifted.</span>
        </div>
      )}

      {/* Profile selector + tree-kind filter + view toggle */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500"><Layers className="h-3.5 w-3.5" /> Profile:</div>
        <div className="relative">
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink-800 hover:border-accent-400 dark:border-ink-700 dark:bg-ink-800 dark:text-white"
          >
            <Ship className="h-3.5 w-3.5 text-accent-500" />
            {activeProfile?.name ?? 'All Profiles'}
            <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
          </button>
          {profileDropdownOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setProfileDropdownOpen(false)} />
              <div className="absolute left-0 z-40 mt-1 min-w-[260px] rounded-lg border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
                {!fleetScope.isRestricted && (
                <button
                  onClick={() => { setActiveProfileId(null); setProfileDropdownOpen(false); }}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  All Profiles
                </button>
                )}
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setActiveProfileId(p.id); setProfileDropdownOpen(false); }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800 ${activeProfileId === p.id ? 'font-bold text-accent-700 dark:text-accent-300' : 'text-ink-700 dark:text-ink-200'}`}
                  >
                    <span className="flex items-center gap-2 truncate"><Ship className="h-3.5 w-3.5 text-accent-500" />{p.name}</span>
                    <span className="text-[10px] text-ink-400">{p.vesselCount} vessel{p.vesselCount !== 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="h-5 w-px bg-ink-200 dark:bg-ink-700" />
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500"><Filter className="h-3.5 w-3.5" /> Type:</div>
        {treeKinds.map((k) => (
          <button
            key={k}
            onClick={() => setFilterTreeKind(k)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filterTreeKind === k ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300' : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'}`}
          >
            {k === 'all' ? 'All' : BUILTIN_TABS.find((t) => t.key === k)?.label ?? k.replace(/_/g, ' ')}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSectionMode(true)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${sectionMode ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-ink-500 hover:bg-ink-100'}`}
          >
            Section View
          </button>
          <button
            onClick={() => setSectionMode(false)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${!sectionMode ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-ink-500 hover:bg-ink-100'}`}
          >
            List View
          </button>
        </div>
      </div>

      {/* Split-screen: queue list + document reviewer */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        {/* Left: Pending queue */}
        <div className="flex max-h-[520px] flex-col min-h-0 rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900 lg:max-h-none">
          <div className="flex shrink-0 items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
            <Inbox className="h-4 w-4 text-warning-500" />
            <span className="text-sm font-bold text-ink-900 dark:text-white">Pending Review</span>
            <span className="ml-auto rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">{filteredPending.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredPending.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success-400" />
                <p className="text-sm text-ink-500">No documents pending review.</p>
                <p className="mt-1 text-xs text-ink-400">All SMS drafts have been processed.</p>
              </div>
            ) : sectionMode ? (
              /* Section-by-section collapsible list */
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                {sections.map((section) => {
                  const key = section.docs[0]?.parent_id ?? 'root';
                  const isExpanded = expandedSections.has(key);
                  const sectionFiltered = section.docs.filter((d) => filterTreeKind === 'all' || d.tree_kind === filterTreeKind);
                  if (sectionFiltered.length === 0) return null;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggleSection(key)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/30"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
                        <Folder className="h-4 w-4 text-accent-500" />
                        <span className="flex-1 truncate text-sm font-bold text-ink-800 dark:text-ink-200">{section.sectionLabel}</span>
                        <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">{sectionFiltered.length}</span>
                      </button>
                      {isExpanded && sectionFiltered.map((doc) => (
                        <PendingDocRow
                          key={doc.id}
                          doc={doc}
                          isSelected={selectedDoc?.id === doc.id}
                          onClick={() => { setSelectedDoc(doc); setRejectMode(false); setRejectComments(''); }}
                          parentFolder={getParentFolderLabel(doc)}
                          crumbs={resolveCrumbs(doc)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat list view (original) */
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                {filteredPending.map((doc) => (
                  <PendingDocRow
                    key={doc.id}
                    doc={doc}
                    isSelected={selectedDoc?.id === doc.id}
                    onClick={() => { setSelectedDoc(doc); setRejectMode(false); setRejectComments(''); }}
                    parentFolder={getParentFolderLabel(doc)}
                    crumbs={resolveCrumbs(doc)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Document reviewer */}
        <div className="flex min-h-[420px] flex-col min-h-0 rounded-xl border border-ink-200/70 bg-white dark:border-ink-800 dark:bg-ink-900 lg:min-h-0">
          {!selectedDoc ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16">
              <FileEdit className="h-12 w-12 text-ink-300" />
              <p className="mt-3 text-sm font-semibold text-ink-500">Select a document from the queue</p>
              <p className="mt-1 text-xs text-ink-400">Review the draft content, then approve &amp; deploy to fleet or reject with comments.</p>
            </div>
          ) : (
            <>
              {/* Reviewer header */}
              <div className="shrink-0 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-ink-900 dark:text-white">{selectedDoc.label}</h3>
                      <span className="rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">PENDING</span>
                    </div>
                    <div className="mt-2">
                      <BreadcrumbChips crumbs={selectedCrumbs} size="sm" />
                    </div>
                    {/* Author / origin metadata + change type */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold ${selectedDoc.node_kind === 'folder' ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'}`}>
                        {selectedDoc.node_kind === 'folder' ? <Folder className="h-3.5 w-3.5" /> : <UserCircle className="h-3.5 w-3.5" />}
                        {selectedDoc.node_kind === 'folder' ? 'FOLDER CREATION' : 'SUBMISSION'}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-[11px] font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                        {selectedDoc.node_kind === 'folder' ? 'New Folder' : selectedDoc.content_kind === 'pdf' ? 'PDF Document' : 'Rich Text Document'}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                        <UserCircle className="h-3.5 w-3.5" />
                        {selectedDoc.author_name ?? 'Unknown'} ({selectedDoc.author_role ?? 'Unknown Role'}) — {selectedDoc.author_origin ?? 'Unknown Source'}
                      </span>
                      <span className="text-[11px] text-ink-400">Updated {new Date(selectedDoc.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* Edit Section button — gated by canEdit */}
                    {canEdit && (
                      <button
                        onClick={() => startEdit(selectedDoc)}
                        className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs font-bold text-accent-700 transition hover:bg-accent-100 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300"
                        title="Edit this section's content"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit Section
                      </button>
                    )}
                    <button onClick={() => openDocInNewTab(selectedDoc)} className="rounded-lg p-2 text-ink-400 hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40" title="Open in new tab">
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button onClick={() => window.print()} className="rounded-lg p-2 text-ink-400 hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/40" title="Print">
                      <Printer className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Draft content */}
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-3 flex items-center gap-2">
                  {selectedDoc.node_kind === 'folder' ? (
                    <>
                      <Folder className="h-4 w-4 text-accent-500" />
                      <span className="text-xs font-bold uppercase tracking-wide text-accent-600 dark:text-accent-400">New Folder — Pending Approval</span>
                    </>
                  ) : (
                    <>
                      <FileEdit className="h-4 w-4 text-warning-500" />
                      <span className="text-xs font-bold uppercase tracking-wide text-warning-600 dark:text-warning-400">Admin-Uploaded Draft</span>
                    </>
                  )}
                </div>
                {selectedDoc.node_kind === 'folder' ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-accent-200 bg-accent-50/30 py-16 dark:border-accent-800 dark:bg-accent-900/10">
                    <Folder className="h-12 w-12 text-accent-400" />
                    <p className="mt-3 text-sm font-semibold text-ink-600 dark:text-ink-300">{selectedDoc.label}</p>
                    <p className="mt-1 text-xs text-ink-400">This is a new folder/subfolder awaiting approval. Approving will make it visible to the fleet.</p>
                  </div>
                ) : selectedDoc.content_kind === 'pdf' ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-200 bg-ink-50 py-16 dark:border-ink-700 dark:bg-ink-800/50">
                    <FileText className="h-12 w-12 text-warning-400" />
                    <p className="mt-3 text-sm font-semibold text-ink-600 dark:text-ink-300">PDF: {selectedDoc.content}</p>
                    <button onClick={() => openDocInNewTab(selectedDoc)} className="mt-3 text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400">Open PDF in new tab →</button>
                  </div>
                ) : selectedDoc.content ? (
                  <div className="rounded-lg border border-ink-200 bg-white p-6 dark:border-ink-700 dark:bg-ink-800">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700 dark:text-ink-200">{selectedDoc.content}</pre>
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-ink-400">No content in this draft.</div>
                )}
              </div>

              {/* Rejection comments */}
              {rejectMode && (
                <div className="shrink-0 border-t border-ink-100 bg-danger-50/30 px-5 py-4 dark:border-ink-800 dark:bg-danger-900/10">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-danger-600 dark:text-danger-400">Rejection Comments</label>
                  <textarea
                    autoFocus
                    className="input min-h-[80px] resize-y"
                    placeholder="Explain why this document is being rejected. The Company Admin will see these comments."
                    value={rejectComments}
                    onChange={(e) => setRejectComments(e.target.value)}
                  />
                </div>
              )}

              {/* Sticky action bar */}
              <div className="shrink-0 border-t-2 border-ink-100 bg-ink-50/50 px-5 py-4 dark:border-ink-800 dark:bg-ink-900/50">
                {!rejectMode ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setRejectMode(true); setRejectComments(''); }}
                        disabled={!!approvingId || workspaceFrozen || !canApprove}
                        className="inline-flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2 text-sm font-bold text-danger-700 transition hover:bg-danger-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300"
                        title={!canApprove ? 'You do not have permission to reject SMS revisions' : ''}
                      >
                        <XCircle className="h-4 w-4" /> Reject with Comments
                      </button>
                      <button
                        onClick={() => setShowPurgeModal(true)}
                        disabled={!!approvingId || !!rejectingId || workspaceFrozen || !canApprove}
                        className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-ink-50 px-4 py-2 text-sm font-bold text-ink-600 transition hover:bg-danger-50 hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-danger-900/20 dark:hover:text-danger-300"
                        title={!canApprove ? 'You do not have permission to purge SMS drafts' : ''}
                      >
                        <Trash2 className="h-4 w-4" /> Purge / Discard Draft
                      </button>
                    </div>
                    <button
                      onClick={() => handleApprove(selectedDoc)}
                      disabled={!!approvingId || !!rejectingId || workspaceFrozen || !canApprove}
                      className="inline-flex items-center gap-2 rounded-lg bg-success-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-success-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                      title={!canApprove ? 'You do not have permission to approve SMS revisions' : ''}
                    >
                      {approvingId === selectedDoc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenTool className="h-4 w-4" />}
                      Approve &amp; Deploy to Fleet
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => { setRejectMode(false); setRejectComments(''); }} className="btn-secondary">Cancel</button>
                    <button
                      onClick={() => handleReject(selectedDoc)}
                      disabled={!!rejectingId || !rejectComments.trim()}
                      className="inline-flex items-center gap-2 rounded-lg bg-danger-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-danger-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rejectingId === selectedDoc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Confirm Rejection
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Upload Modal ── */}
      {showUploadModal && tenant && (
        <UploadSmsModal
          tenantId={tenant.id}
          profiles={profiles}
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUpload}
        />
      )}

      {/* ── Edit Section Modal ── */}
      {editingDoc && (
        <Modal
          open
          onClose={() => setEditingDoc(null)}
          title="Edit SMS Section"
          subtitle={editingDoc.label}
          icon={<Pencil className="h-5 w-5" />}
          size="lg"
          footer={
            <>
              <button onClick={() => setEditingDoc(null)} className="btn-secondary" disabled={savingEdit}>Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit || !editLabel.trim()} className="btn-primary !bg-accent-600 !text-white hover:!bg-accent-700 flex items-center gap-2">
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save &amp; Resubmit for Approval
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="label">Section Title</label>
              <input className="input" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
            </div>
            <div>
              <label className="label">Content</label>
              <textarea
                className="input min-h-[300px] resize-y font-sans text-sm leading-relaxed"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Edit the SMS section content…"
              />
              <p className="mt-1 text-[11px] text-ink-400">Saving will mark this section as pending DPA approval again for re-review.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── DPA Digital Signature Modal ── */}
      {showSignModal && selectedDoc && (
        <Modal
          open
          onClose={() => !deploying && setShowSignModal(false)}
          title="DPA Digital Signature — Approve & Deploy"
          subtitle={selectedDoc.label}
          icon={<PenTool className="h-5 w-5" />}
          size="md"
          footer={
            <>
              <button onClick={() => setShowSignModal(false)} className="btn-secondary" disabled={deploying}>Cancel</button>
              <button
                onClick={executeApproveAndDeploy}
                disabled={deploying || !signatureName.trim() || !signatureTitle.trim()}
                className="btn-primary !bg-success-600 !text-white hover:!bg-success-700 flex items-center gap-2"
              >
                {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenTool className="h-4 w-4" />}
                Sign &amp; Deploy to Fleet
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-800 dark:bg-success-900/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success-600 dark:text-success-400" />
                <p className="text-sm font-bold text-success-800 dark:text-success-200">Approve &amp; Deploy</p>
              </div>
              <p className="mt-2 text-xs text-success-700 dark:text-success-300">
                You are about to approve <strong>{selectedDoc.label}</strong> and deploy it to all fleet vessels. This action will bump the SMS version and push the approved document to every vessel's local library via satellite sync.
              </p>
            </div>
            <div>
              <label className="label">DPA Full Name (Digital Signature) *</label>
              <input className="input" placeholder="e.g. Capt. John Harbour" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">Title / Authority *</label>
              <input className="input" placeholder="e.g. Designated Person Ashore" value={signatureTitle} onChange={(e) => setSignatureTitle(e.target.value)} />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>This digital signature will be recorded in the audit trail with critical severity. The DPA signature confirms compliance with ISM Code requirements for SMS revision approval.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* PURGE / DISCARD DRAFT CONFIRMATION MODAL */}
      {showPurgeModal && selectedDoc && (
        <Modal
          open
          onClose={() => setShowPurgeModal(false)}
          title="Purge / Discard Draft"
          subtitle={selectedDoc.label}
          icon={<Trash2 className="h-5 w-5 text-danger-500" />}
          size="sm"
          footer={
            <>
              <button onClick={() => setShowPurgeModal(false)} className="btn-secondary" disabled={!!purgingId}>Cancel</button>
              <button
                onClick={() => handlePurge(selectedDoc)}
                disabled={!!purgingId}
                className="inline-flex items-center gap-2 rounded-lg bg-danger-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-danger-700 disabled:opacity-50"
              >
                {purgingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Discard Permanently
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-danger-300 bg-danger-50 p-4 dark:border-danger-700 dark:bg-danger-900/20">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
              <div>
                <p className="text-sm font-bold text-danger-800 dark:text-danger-300">Discard this submission package permanently?</p>
                <p className="mt-1 text-sm text-danger-700 dark:text-danger-400">This will remove the draft from the DPA review queue and the submitter's local tree. The action will be logged in the Audit &amp; Compliance Ledger for ISM tracking. This cannot be undone.</p>
              </div>
            </div>
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-700 dark:bg-ink-800">
              <p className="text-xs font-semibold text-ink-500">{selectedDoc.node_kind === 'folder' ? 'Folder' : 'Document'}: {selectedDoc.label}</p>
              <p className="text-xs text-ink-400">Status: {selectedDoc.approval_state === 'pending_dpa' ? 'Pending DPA Approval' : 'Rejected'}</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PendingDocRow({ doc, isSelected, onClick, parentFolder, crumbs }: {
  doc: SmsDocRow;
  isSelected: boolean;
  onClick: () => void;
  parentFolder: string | null;
  crumbs: Crumb[];
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-ink-50 px-4 py-3 text-left transition hover:bg-ink-50 dark:border-ink-800/50 dark:hover:bg-ink-800/30 ${isSelected ? 'bg-accent-50/50 dark:bg-accent-900/20' : ''}`}
      style={{ paddingLeft: '2rem' }}
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${doc.node_kind === 'folder' ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300'}`}>
        {doc.node_kind === 'folder' ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-ink-800 dark:text-ink-200">{doc.label}</p>
        {parentFolder && (
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <Folder className="h-2.5 w-2.5 text-ink-400" />
            {parentFolder}
          </span>
        )}
        <div className="mt-1.5">
          <BreadcrumbChips crumbs={crumbs.slice(0, -1)} size="xs" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Clock className="h-3 w-3 text-ink-400" />
          <span className="text-[10px] text-ink-400">{new Date(doc.updated_at).toLocaleString()}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${doc.node_kind === 'folder' ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : doc.content_kind === 'pdf' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400' : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'}`}>
            {doc.node_kind === 'folder' ? 'FOLDER' : doc.content_kind === 'pdf' ? 'PDF' : 'TEXT'}
          </span>
          {doc.author_name && (
            <span className="text-[10px] text-ink-400">by {doc.author_name}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Upload SMS Modal ─────────────────────────────────────────────────

function UploadSmsModal({ tenantId, profiles, onClose, onUpload }: {
  tenantId: string;
  profiles: SmsProfileWithVessels[];
  onClose: () => void;
  onUpload: (data: {
    label: string; docId: string; treeKind: string; profileId: string | null;
    parentId: string | null; content: string; contentKind: 'rich_text' | 'pdf';
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [docId, setDocId] = useState('');
  const [treeKind, setTreeKind] = useState('sms');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!label.trim()) return;
    setSaving(true);
    await onUpload({
      label: label.trim(),
      docId: docId.trim() || `SMS-${Date.now()}`,
      treeKind,
      profileId,
      parentId: null,
      content,
      contentKind: 'rich_text',
    });
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload New SMS Document / Circular"
      icon={<FilePlus2 className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !label.trim()} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload &amp; Submit for Approval
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Document Title *</label>
            <input className="input" placeholder="e.g. 6.1 Heavy Weather Operating Procedures" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="label">Doc ID / Reference</label>
            <input className="input font-mono" placeholder="e.g. SMS-601-2026" value={docId} onChange={(e) => setDocId(e.target.value)} />
          </div>
          <div>
            <label className="label">Category *</label>
            <select className="input" value={treeKind} onChange={(e) => setTreeKind(e.target.value)}>
              {BUILTIN_TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Target Fleet Profile</label>
            <select className="input" value={profileId ?? ''} onChange={(e) => setProfileId(e.target.value || null)}>
              <option value="">All Profiles (Universal)</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.vesselCount} vessels)</option>)}
            </select>
            <p className="mt-1 text-[11px] text-ink-400">Scope this document to a specific fleet profile or make it universal.</p>
          </div>
        </div>
        <div>
          <label className="label">Document Content</label>
          <textarea
            className="input min-h-[200px] resize-y font-sans text-sm leading-relaxed"
            placeholder="Paste or type the SMS document content here…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-ink-400">The document will be submitted with PENDING_DPA status. The DPA must review and approve before it deploys to vessels.</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Once uploaded, this document enters the DPA approval queue. After DPA review and digital signature, it will be deployed to all assigned fleet vessels via satellite sync.</p>
        </div>
      </div>
    </Modal>
  );
}
