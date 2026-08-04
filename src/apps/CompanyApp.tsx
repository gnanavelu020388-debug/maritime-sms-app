import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { CompanyShell, type CompanySection } from '../layouts/CompanyShell';
import { CompanyOverview } from '../views/company/CompanyOverview';
import { VesselsView } from '../views/company/VesselsView';
import { SmsDpaView } from '../views/company/SmsDpaView';
import { MasterSmsLibraryView } from '../views/dpa/MasterSmsLibraryView';
import { CrewRosterView } from '../views/company/CrewRosterView';
import { PermissionsMatrixView, getPermissionsDirtyState } from '../views/company/PermissionsMatrixView';
import { CompanyAuditView } from '../views/company/CompanyAuditView';
import { CompanySecuritySettings } from '../views/company/CompanySecuritySettings';
import { DemoAuthProvider } from '../lib/demoAuth';
import { Modal } from '../components/Modal';
import { useAuth } from '../lib/auth';
import { useFeatureFlags } from '../lib/featureFlags';

export function CompanyApp({ demoMode = false }: { demoMode?: boolean }) {
  const { tenant } = useAuth();
  const { isEnabled, loading: flagsLoading } = useFeatureFlags(tenant?.id);
  const [active, setActive] = useState<CompanySection>('overview');
  const [blockedSection, setBlockedSection] = useState<CompanySection | null>(null);
  const [pendingNav, setPendingNav] = useState<CompanySection | null>(null);
  const navQueue = useRef<CompanySection | null>(null);

  const performNav = useCallback((section: CompanySection) => {
    navQueue.current = null;
    // Feature-gate: block route access if the underlying module is disabled
    if ((section === 'sms_dpa' || section === 'master_library') && !isEnabled('sms_documentation')) {
      setBlockedSection(section);
      return;
    }
    setActive(section);
  }, [isEnabled]);

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as CompanySection;
      // If we're on the permissions page, check for unsaved changes
      if (active === 'permissions' && target !== 'permissions') {
        if (getPermissionsDirtyState()) {
          setPendingNav(target);
          navQueue.current = target;
          return;
        }
      }
      performNav(target);
    };
    window.addEventListener('company-nav', handler);
    return () => window.removeEventListener('company-nav', handler);
  }, [active, performNav]);

  const handleSaveAndContinue = useCallback(() => {
    // Trigger save via global event, then navigate
    window.dispatchEvent(new CustomEvent('permissions-save-and-navigate'));
    setPendingNav(null);
  }, []);

  const handleDiscard = useCallback(() => {
    window.dispatchEvent(new CustomEvent('permissions-discard-and-navigate'));
    if (navQueue.current) {
      performNav(navQueue.current);
    }
    setPendingNav(null);
  }, [performNav]);

  const handleCancelNav = useCallback(() => {
    navQueue.current = null;
    setPendingNav(null);
  }, []);

  // Listen for save-complete event from PermissionsMatrixView
  useEffect(() => {
    const handler = () => {
      if (navQueue.current) {
        performNav(navQueue.current);
      }
    };
    window.addEventListener('permissions-saved-complete', handler);
    return () => window.removeEventListener('permissions-saved-complete', handler);
  }, [performNav]);

  const content = (
    <CompanyShell active={active} demoMode={demoMode}>
      {active === 'overview' && <CompanyOverview onNavigate={setActive} />}
      {active === 'vessels' && <VesselsView />}
      {active === 'sms_dpa' && <SmsDpaView />}
      {active === 'master_library' && <MasterSmsLibraryView />}
      {active === 'crew_management' && <CrewRosterView />}
      {active === 'permissions' && <PermissionsMatrixView />}
      {active === 'audit' && <CompanyAuditView />}
      {active === 'security' && <CompanySecuritySettings />}

      {/* Unsaved Changes Navigation Guard */}
      {pendingNav && (
        <Modal
          open
          onClose={handleCancelNav}
          title="Unsaved Changes Alert"
          subtitle="Role & Permissions Matrix"
          icon={<AlertTriangle className="h-5 w-5 text-warning-500" />}
          size="md"
          footer={
            <div className="flex w-full items-center justify-end gap-3">
              <button onClick={handleCancelNav} className="btn-secondary">
                Stay on Page
              </button>
              <button onClick={handleDiscard} className="rounded-lg border border-danger-300 bg-white px-4 py-2 text-sm font-bold text-danger-600 transition hover:bg-danger-50 dark:border-danger-700 dark:bg-ink-800 dark:text-danger-400 dark:hover:bg-danger-900/20">
                Discard Changes
              </button>
              <button onClick={handleSaveAndContinue} className="btn-primary flex items-center gap-1.5">
                Save &amp; Continue
              </button>
            </div>
          }
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            You have unsaved changes in the <strong>Role &amp; Permissions Matrix</strong>.
            Save before leaving or your changes will be discarded.
          </p>
        </Modal>
      )}

      {/* FEATURE-GATE: blocked route access modal */}
      {blockedSection && (
        <Modal
          open
          onClose={() => setBlockedSection(null)}
          title="Module Not Enabled"
          icon={<AlertTriangle className="h-5 w-5 text-ink-400" />}
          size="sm"
          footer={
            <button onClick={() => setBlockedSection(null)} className="btn-primary">Back to Overview</button>
          }
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            This module is not enabled for your organization. Please contact your platform administrator if you believe this is an error.
          </p>
        </Modal>
      )}
    </CompanyShell>
  );

  if (demoMode) {
    return <DemoAuthProvider role="company_admin">{content}</DemoAuthProvider>;
  }
  return content;
}
