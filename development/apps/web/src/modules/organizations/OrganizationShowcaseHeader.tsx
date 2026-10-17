import { Link, useLocation } from 'react-router-dom';
import { findOrganization } from './catalog.js';
import { findShowcase } from './showcase/registry.js';
import { OrganizationBreadcrumb } from './OrganizationBreadcrumb.js';

export function OrganizationShowcaseHeader() {
  const { pathname } = useLocation();
  const path = pathname.replace(/^\/development(?=\/)/, '').replace(/\/+$/, '');
  const [, , organizationKey, departmentKey] = path.split('/');
  const organization = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = organization?.departments.find((item) => item.key === departmentKey);
  const content = department ? findShowcase(`${organizationKey}.${departmentKey}`) : undefined;

  return (
    <div className="organization-header-heading">
      <h1 className="main-site-header-title">
        <Link to="/organizations">风采展示</Link>
      </h1>
      {organization ? (
        <OrganizationBreadcrumb
          organization={organization}
          departmentLabel={
            department ? (content?.shortName ?? content?.name ?? department.name) : undefined
          }
          header
        />
      ) : null}
    </div>
  );
}
