import { useId, type ReactNode } from 'react';

export interface DetailSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function DetailSection({ title, description, actions, children }: DetailSectionProps) {
  const titleId = useId();
  return (
    <section className="detail-section" aria-labelledby={titleId}>
      <header className="detail-section-header">
        <div>
          <h3 id={titleId}>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="detail-section-actions">{actions}</div> : null}
      </header>
      <div className="detail-section-body">{children}</div>
    </section>
  );
}
