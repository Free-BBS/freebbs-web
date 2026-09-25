import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { isSuperAdmin, type PresentationUser } from './Can.js';

export interface SuperAdminRouteGuardProps {
  children: ReactNode;
  user: PresentationUser | null;
}

export function SuperAdminRouteGuard({ children, user }: SuperAdminRouteGuardProps) {
  if (user === null || !isSuperAdmin(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
