import { Link } from 'react-router-dom';
import type { OrganizationExhibit } from './catalog.js';

export function OrganizationBreadcrumb({
  organization,
  departmentLabel,
  compact = false,
}: {
  organization: OrganizationExhibit;
  departmentLabel?: string;
  compact?: boolean;
}) {
  return (
    <nav
      className={`organization-breadcrumb${compact ? ' organization-breadcrumb--compact' : ''}`}
      aria-label="展厅位置"
    >
      <Link to="/organizations">风采展示</Link>
      <span aria-hidden="true">/</span>
      {organization.key === 'tms' && !departmentLabel ? (
        <span aria-current="page">{compact ? organization.shortName : organization.name}</span>
      ) : (
        <Link to={`/organizations/${organization.key}`} aria-label={organization.name}>
          {compact ? organization.shortName : organization.name}
        </Link>
      )}
      {departmentLabel ? (
        <>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{departmentLabel}</span>
        </>
      ) : null}
    </nav>
  );
}
