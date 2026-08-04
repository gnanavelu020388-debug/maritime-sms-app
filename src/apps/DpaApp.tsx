import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DpaShell, type DpaSection } from '../layouts/DpaShell';
import { DpaDashboard } from '../views/dpa/DpaDashboard';
import { SmsApprovalsView } from '../views/dpa/SmsApprovalsView';
import { SmsLibraryView } from '../views/dpa/SmsLibraryView';
import { MasterSmsLibraryView } from '../views/dpa/MasterSmsLibraryView';
import { VesselsView } from '../views/company/VesselsView';
import { CrewRosterView } from '../views/company/CrewRosterView';
import { CompanyAuditView } from '../views/company/CompanyAuditView';
import { CompanySecuritySettings } from '../views/company/CompanySecuritySettings';
import { DemoAuthProvider } from '../lib/demoAuth';
import { Modal } from '../components/Modal';
import { useAuth } from '../lib/auth';
import { useFeatureFlags } from '../lib/featureFlags';

export function DpaApp({ demoMode = false }: { demoMode?: boolean }) {
  const { tenant } = useAuth();
  const { isEnabled, loading: flagsLoading } = useFeatureFlags(tenant?.id);
  const [active, setActive] = useState<DpaSection>('dashboard');
  const [blockedSection, setBlockedSection] = useState<DpaSection | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail as DpaSection;
      // Feature-gate: block SMS-related routes if SMS module is disabled
      if (['approvals', 'library', 'master_library', 'fleet', 'crew', 'audit', 'security'].includes(section) && !isEnabled('sms_documentation')) {
        setBlockedSection(section);
        return;
      }
      setActive(section);
    };
    window.addEventListener('dpa-nav', handler);
    return () => window.removeEventListener('dpa-nav', handler);
  }, [isEnabled]);

  const content = (
    <DpaShell active={active} demoMode={demoMode}>
      {active === 'dashboard' && <DpaDashboard onNavigate={setActive} />}
      {active === 'approvals' && isEnabled('sms_documentation') && <SmsApprovalsView />}
      {active === 'library' && isEnabled('sms_documentation') && <SmsLibraryView />}
      {active === 'master_library' && isEnabled('sms_documentation') && <MasterSmsLibraryView />}
      {active === 'fleet' && isEnabled('sms_documentation') && <VesselsView />}
      {active === 'crew' && isEnabled('sms_documentation') && <CrewRosterView />}
      {active === 'audit' && isEnabled('sms_documentation') && <CompanyAuditView />}
      {active === 'security' && isEnabled('sms_documentation') && <CompanySecuritySettings />}

      {blockedSection && (
        <Modal
          open
          onClose={() => setBlockedSection(null)}
          title="Module Not Enabled"
          icon={<AlertTriangle className="h-5 w-5 text-ink-400" />}
          size="sm"
          footer={<button onClick={() => setBlockedSection(null)} className="btn-primary">Back to Dashboard</button>}
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            This module is not enabled for your organization. Please contact your platform administrator if you believe this is an error.
          </p>
        </Modal>
      )}
    </DpaShell>
  );

  if (demoMode) {
    return <DemoAuthProvider role="dpa">{content}</DemoAuthProvider>;
  }
  return content;
}
