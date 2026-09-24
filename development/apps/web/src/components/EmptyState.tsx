import { useId, type ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  variant?: 'empty' | 'error';
  action?: ReactNode;
}

export function EmptyState({ title, description, variant = 'empty', action }: EmptyStateProps) {
  const titleId = useId();

  return (
    <section
      className="empty-state"
      data-state={variant}
      aria-labelledby={titleId}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <h2 id={titleId}>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}
