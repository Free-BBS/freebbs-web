import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isBusinessAdmin, type PresentationUser } from './Can.js';

export function SystemSettingsRouteGuard({
  user,
  children,
}: {
  user: PresentationUser | null;
  children: ReactNode;
}) {
  if (!user || user.previewing || !isBusinessAdmin(user))
    return <Navigate to="/community" replace />;
  return <>{children}</>;
}
