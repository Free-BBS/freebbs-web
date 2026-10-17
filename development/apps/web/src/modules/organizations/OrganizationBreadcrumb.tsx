import { Link } from 'react-router-dom';
import type { OrganizationExhibit } from './catalog.js';

export function OrganizationBreadcrumb({
  organization,
  departmentLabel,
  compact = false,
  header = false,
}: {
  organization?: OrganizationExhibit;
  departmentLabel?: string;
  compact?: boolean;
  header?: boolean;
}) {
  const currentDepartmentLabel = organization?.key === 'tms' ? undefined : departmentLabel;

  return (
    <nav
      className={`organization-breadcrumb${compact ? ' organization-breadcrumb--compact' : ''}${header ? ' organization-breadcrumb--header' : ''}`}
      aria-label="展厅位置"
    >
      {organization ? (
        <>
          {!header ? (
            <>
              <Link to="/organizations">风采展示</Link>
              <span aria-hidden="true">/</span>
            </>
          ) : null}
          {currentDepartmentLabel ? (
            <>
              <Link to={`/organizations/${organization.key}`}>{organization.name}</Link>
              <span aria-hidden="true">{header ? '·' : '/'}</span>
              <span aria-current="page">{currentDepartmentLabel}</span>
            </>
          ) : (
            <span aria-current="page">{organization.name}</span>
          )}
        </>
      ) : (
        <span aria-current="page">风采展示</span>
      )}
    </nav>
  );
}
