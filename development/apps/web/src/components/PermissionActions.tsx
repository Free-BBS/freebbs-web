import type { ReactNode } from 'react';

export interface PermissionActionsProps {
  allowed: boolean;
  children: ReactNode;
}

/** Presentation visibility only; API authorization remains authoritative. */
export function PermissionActions({ allowed, children }: PermissionActionsProps) {
  return allowed ? <>{children}</> : null;
}
