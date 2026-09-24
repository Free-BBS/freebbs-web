import type { ReactNode } from 'react';

export interface ModulePageHeaderProps {
  title: string;
  description?: string;
  kicker?: string;
  actions?: ReactNode;
}

export function ModulePageHeader({ title, description, kicker, actions }: ModulePageHeaderProps) {
  return (
    <header className="module-page-header">
      <div className="module-page-header-copy">
        {kicker ? <p className="module-page-kicker">{kicker}</p> : null}
        <h2>{title}</h2>
        {description ? <p className="module-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="module-page-actions">{actions}</div> : null}
    </header>
  );
}
