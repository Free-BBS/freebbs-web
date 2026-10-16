const fullPageDepartments = new Set([
  'youth_league.organization',
  'youth_league.sail',
  'youth_league.humanities',
  'media_center.creative',
  'media_center.audiovisual',
]);

export function usesFullPageShowcase(departmentId: string | undefined): boolean {
  return departmentId !== undefined && fullPageDepartments.has(departmentId);
}

export function isFullPageShowcasePath(pathname: string): boolean {
  return fullPageShowcaseParent(pathname) !== undefined;
}

export function fullPageShowcaseParent(pathname: string): string | undefined {
  const route = pathname
    .replace(/\/+$/, '')
    .match(/^(?:\/development)?\/organizations\/([^/]+)\/([^/]+)$/);
  return route !== null && usesFullPageShowcase(`${route[1]}.${route[2]}`)
    ? `/organizations/${route[1]}`
    : undefined;
}
import { ORGANIZATION_GALLERY } from '../catalog.js';

const departmentPaths = new Set(
  ORGANIZATION_GALLERY.flatMap((organization) =>
    organization.key === 'tms'
      ? ['/organizations/tms', '/organizations/tms/position']
      : organization.departments.map(
          (department) => `/organizations/${organization.key}/${department.key}`,
        ),
  ),
);

export function isDepartmentShowcasePath(pathname: string): boolean {
  return departmentPaths.has(pathname.replace(/^\/development(?=\/)/, '').replace(/\/+$/, ''));
}
