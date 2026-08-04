import { useState, useEffect, useCallback } from 'react';
import { VesselShell } from '../layouts/VesselShell';
import { VesselPortalView } from '../views/vessel/VesselPortalView';
import { DemoAuthProvider } from '../lib/demoAuth';
import type { ModuleKey } from '../lib/featureFlags';
import type { DrawerSection } from '../components/BridgeDrawer';

export function VesselApp({ demoMode = false }: { demoMode?: boolean }) {
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [drawerSection, setDrawerSection] = useState<DrawerSection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);

  useEffect(() => {
    const handler = (e: Event) => {
      const key = (e as CustomEvent).detail as ModuleKey;
      setDrawerSection(null);
      setActiveModule(key);
    };
    window.addEventListener('vessel-launch-module', handler);
    return () => window.removeEventListener('vessel-launch-module', handler);
  }, []);

  const handleReturnToDashboard = useCallback(() => {
    setActiveModule(null);
    setDrawerSection(null);
  }, []);

  const handleSelectDrawerSection = useCallback((section: DrawerSection) => {
    setActiveModule(null);
    setDrawerSection((prev) => (prev === section ? null : section));
  }, []);

  const handleClearDrawerSection = useCallback(() => {
    setDrawerSection(null);
  }, []);

  const content = (
    <VesselShell
      demoMode={demoMode}
      activeModule={activeModule}
      onReturnToDashboard={handleReturnToDashboard}
      drawerOpen={drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      drawerSection={drawerSection}
      onSelectDrawerSection={handleSelectDrawerSection}
    >
      <VesselPortalView
        activeModule={activeModule}
        onReturnToDashboard={handleReturnToDashboard}
        drawerSection={drawerSection}
        onClearDrawerSection={handleClearDrawerSection}
        lastSyncAt={null}
        localVersion="—"
      />
    </VesselShell>
  );

  if (demoMode) {
    return <DemoAuthProvider role="vessel">{content}</DemoAuthProvider>;
  }
  return content;
}
