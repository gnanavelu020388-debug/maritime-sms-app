import { useAuth } from '../../lib/auth';
import { SmsLibrarySplitView } from '../../components/SmsLibrarySplitView';
import type { RankPermissionMap } from '../../lib/rankPermissions';
import { Library } from 'lucide-react';

// Read-only rank permissions: the DPA may view, search, and print the
// approved SMS library, but has no edit / upload / approve actions in
// this reader view. Authoring happens exclusively in "SMS Review & Deployment".
const READER_SMS_PERMS: RankPermissionMap = {
  sms_documentation: {
    visible: true,
    actions: { view: true, search: true, print: true, edit: false, upload: false, approve: false },
  },
};

export function MasterSmsLibraryView() {
  const { tenant, activeAssignment, tenantUser } = useAuth();
  if (!tenant) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Library className="h-5 w-5 text-accent-600 dark:text-accent-400" />
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Master SMS Library</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Read-only reference of all approved Safety Management System documents across fleet profiles.
          </p>
        </div>
      </div>

      <SmsLibrarySplitView
        tenantId={tenant.id}
        vesselId={activeAssignment?.vessel_id ?? null}
        readOnly
        enableProfileSelector
        rankPermissions={READER_SMS_PERMS}
        authorName={tenantUser?.name ?? 'DPA'}
        authorRole="DPA"
        authorOrigin="Shoreside HQ"
      />
    </div>
  );
}
