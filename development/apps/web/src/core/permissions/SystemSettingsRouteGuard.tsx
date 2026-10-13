import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { canViewSystemSettings, type PresentationUser } from './Can.js';

export function SystemSettingsRouteGuard({
  user,
  children,
}: {
  user: PresentationUser | null;
  children: ReactNode;
}) {
  if (!canViewSystemSettings(user)) return <Navigate to="/community" replace />;
  return <>{children}</>;
}
