import { forwardRef, type ReactNode } from 'react';
import type { OrganizationExhibit } from './catalog.js';
import '../../styles/organization-viewport.css';

export const OrganizationDepartmentViewport = forwardRef<
  HTMLElement,
  {
    organization?: OrganizationExhibit;
    departmentLabel?: string;
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
      className={`organization-page${organization ? ` organization-page--${organization.key}` : ''} organization-department-viewport${fullPage ? ' organization-department-viewport--html' : ''}`}
    >
      {fullPage ? (
        children
      ) : (
        <div
          className="organization-department-scroll"
          role="region"
          aria-label={`${departmentLabel ?? organization?.name ?? '风采展示'}页面内容`}
          tabIndex={0}
        >
          <div className="module-page organization-department-body">{children}</div>
        </div>
      )}
    </section>
  );
});
