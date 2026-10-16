import { forwardRef, type ReactNode } from 'react';
import type { OrganizationExhibit } from './catalog.js';
import { OrganizationBreadcrumb } from './OrganizationBreadcrumb.js';
import '../../styles/organization-viewport.css';

export const OrganizationDepartmentViewport = forwardRef<
  HTMLElement,
  {
    organization: OrganizationExhibit;
    departmentLabel: string;
    fullPage?: boolean;
    children: ReactNode;
  }
>(function OrganizationDepartmentViewport(
  { organization, departmentLabel, fullPage = false, children },
  ref,
) {
  return (
    <section
      ref={ref}
      className={`organization-page organization-page--${organization.key} organization-department-viewport${fullPage ? ' organization-department-viewport--html' : ''}`}
    >
      <OrganizationBreadcrumb
        organization={organization}
        departmentLabel={organization.key === 'tms' ? undefined : departmentLabel}
        compact
      />
      {fullPage ? (
        children
      ) : (
        <div
          className="organization-department-scroll"
          role="region"
          aria-label={`${departmentLabel}页面内容`}
          tabIndex={0}
        >
          <div className="module-page organization-department-body">{children}</div>
        </div>
      )}
    </section>
  );
});
