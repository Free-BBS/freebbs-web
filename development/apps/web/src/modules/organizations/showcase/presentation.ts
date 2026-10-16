const fullPageDepartments = new Set(['youth_league.sail', 'media_center.creative']);

export function usesFullPageShowcase(departmentId: string | undefined): boolean {
  return departmentId !== undefined && fullPageDepartments.has(departmentId);
}

export function isFullPageShowcasePath(pathname: string): boolean {
  const route = pathname
    .replace(/\/+$/, '')
    .match(/^(?:\/development)?\/organizations\/([^/]+)\/([^/]+)$/);
  return route !== null && usesFullPageShowcase(`${route[1]}.${route[2]}`);
}
