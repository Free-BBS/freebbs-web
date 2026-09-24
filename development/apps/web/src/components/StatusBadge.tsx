import type { ReactNode } from 'react';

export type StatusBadgeStatus = 'neutral' | 'success' | 'warning' | 'error';

export interface StatusBadgeProps {
  children: ReactNode;
  status?: StatusBadgeStatus;
  className?: string;
}

export function StatusBadge({ children, status = 'neutral', className }: StatusBadgeProps) {
  const classes = ['status-badge', className].filter(Boolean).join(' ');

  return (
    <span className={classes} data-status={status} data-tone={status}>
      {children}
    </span>
  );
}
