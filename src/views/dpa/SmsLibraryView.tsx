import { useAuth } from '../../lib/auth';
import { SmsLibrarySplitView } from '../../components/SmsLibrarySplitView';
import { getShorePermsForRole, canDoShore, resolveShoreRoleName, dpaFullAuthority } from '../../lib/shoreRoles';
import { Shield } from 'lucide-react';
import type { RankPermissionMap } from '../../lib/rankPermissions';
import { Badge } from '../../components/Badge';

const DPA_SMS_PERMS: RankPermissionMap = {
  sms_documentation: {
    visible: true,
    actions: { view: true, search: true, print: true, edit: true, upload: true, approve: true },
  },
};

const BUILTIN_TABS = [
  { key: 'sms', label: 'SMS Documents' },
  { key: 'fleet_circulars', label: 'Fleet Circulars' },
  { key: 'flag_state', label: 'Flag State Documents' },
];

export function SmsLibraryView() {
  const { tenant, activeAssignment, tenantUser, refresh } = useAuth();
  if (!tenant) return null;

  const rawShoreRoleName = tenantUser?.rank ?? 'DPA';
  const resolvedRoleName = resolveShoreRoleName(rawShoreRoleName);
  const isDpaRole = resolvedRoleName === 'Designated Person Ashore (DPA)' ||
    (tenantUser?.email?.toLowerCase() ?? '') === 'dpa@nordicreef.no';
  const shorePerms = isDpaRole ? dpaFullAuthority() : getShorePermsForRole(tenant.id, resolvedRoleName);
  const canEdit = canDoShore(shorePerms, 'edit_sms');
  const canUpload = canDoShore(shorePerms, 'upload_sms');
  const canApprove = canDoShore(shorePerms, 'approve_sms');

  return (
    <div className="space-y-4">
      {/* Permission-gated action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
        <Shield className="h-4 w-4 text-accent-500" />
        <span className="text-xs font-semibold text-ink-500">SMS Authorities:</span>
        {canApprove && <Badge tone="success" className="!text-[10px]">Approve</Badge>}
        {canEdit && <Badge tone="info" className="!text-[10px]">Edit</Badge>}
        {canUpload && <Badge tone="primary" className="!text-[10px]">Upload</Badge>}

      </div>

      <SmsLibrarySplitView
        tenantId={tenant.id}
        vesselId={activeAssignment?.vessel_id ?? null}
        readOnly={false}
        enableProfileSelector
        rankPermissions={DPA_SMS_PERMS}
        authorName={tenantUser?.name ?? 'DPA'}
        authorRole="DPA"
        authorOrigin="Shoreside HQ"
      />
    </div>
  );
}
