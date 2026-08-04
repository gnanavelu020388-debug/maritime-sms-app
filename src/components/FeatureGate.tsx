/**
 * FeatureGate — conditionally renders children based on whether
 * a module/feature is enabled for the current tenant.
 * If disabled, renders nothing (or an optional fallback).
 */

import type { ReactNode } from 'react';
import { useFeatureFlags, type ModuleKey } from '../lib/featureFlags';

interface FeatureGateProps {
  feature: ModuleKey;
  tenantId: string | null | undefined;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ feature, tenantId, children, fallback = null }: FeatureGateProps) {
  const { isEnabled, loading } = useFeatureFlags(tenantId);

  if (loading) return null;
  if (!isEnabled(feature)) return <>{fallback}</>;
  return <>{children}</>;
}
