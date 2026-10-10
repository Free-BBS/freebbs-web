import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  type DevelopmentIdentitySection,
} from './development-identities.js';
import type { RoleKey } from './modules.js';
import type { SocialOrganizationId } from './organizations.js';
import type { UnifiedRegistration } from './collections.js';

export type DepartmentId =
  | `student_union.${'arts_center' | 'sports_center' | 'liaison_center' | 'rights_development_center'}`
  | `youth_league.${'organization' | 'freshman' | 'volunteer' | 'practice' | 'humanities' | 'sail'}`
  | `science_association.${'office' | 'software' | 'hardware' | 'training' | 'project' | 'planning'}`
  | `media_center.${'creative' | 'audiovisual' | 'new_media_reporters'}`
  | 'tms.position';
export interface DepartmentDefinition {
  id: DepartmentId;
  organizationKey: DevelopmentIdentitySection['id'];
  departmentKey: string;
  name: string;
  organizationName: string;
  organizationId: SocialOrganizationId | null;
  roleKeys: readonly RoleKey[];
}
export const DEPARTMENT_DIRECTORY: readonly DepartmentDefinition[] =
  DEVELOPMENT_IDENTITY_SECTIONS.filter(({ id }) => id !== 'counselors').flatMap((section) =>
    section.groups
      .filter(({ id }) => id === 'tms.position' || !/\.(executive|chair|finance)$/.test(id))
      .map((group) => {
        const departmentKey = group.id.split('.').at(-1)!;
        return {
          id: group.id as DepartmentId,
          organizationKey: section.id,
          departmentKey,
          name: section.id === 'tms' ? section.label : group.label,
          organizationName: section.label,
          organizationId:
            section.id === 'student_union'
              ? (departmentKey as SocialOrganizationId)
              : section.id === 'youth_league'
                ? ('tuanwei' as const)
                : section.id === 'science_association'
                  ? ('sast' as const)
                  : section.id === 'tms'
                    ? ('tms' as const)
                    : null,
          roleKeys: group.options.map(({ roleKey }) => roleKey),
        };
      }),
  );
export function departmentById(id: string): DepartmentDefinition | undefined {
  return DEPARTMENT_DIRECTORY.find((department) => department.id === id);
}
export function departmentForRoute(
  organizationKey: string,
  departmentKey: string,
): DepartmentDefinition | undefined {
  return DEPARTMENT_DIRECTORY.find(
    (department) =>
      department.organizationKey === organizationKey && department.departmentKey === departmentKey,
  );
}
export function departmentsForRoles(roles: readonly RoleKey[]): DepartmentDefinition[] {
  return DEPARTMENT_DIRECTORY.filter((department) =>
    department.roleKeys.some((role) => roles.includes(role)),
  );
}
export function canEditDepartment(roles: readonly RoleKey[], id: string): boolean {
  const department = departmentById(id);
  return (
    department !== undefined &&
    (roles.includes('platform.super_admin') ||
      department.roleKeys.some((role) => roles.includes(role)))
  );
}
export function legacyDepartmentId(
  organizationId: SocialOrganizationId | null | undefined,
): DepartmentId | null {
  if (organizationId === 'tms') return 'tms.position';
  return (
    DEPARTMENT_DIRECTORY.find(
      (department) =>
        department.organizationKey === 'student_union' &&
        department.organizationId === organizationId,
    )?.id ?? null
  );
}
export interface DepartmentHomePayload {
  departmentId: DepartmentId;
  html: string | null;
  originalFilename: string | null;
  revision: number;
  updatedAt: string | null;
  editor: { uid: string; displayName: string; avatarUrl: string | null } | null;
  canEdit: boolean;
}
export interface DepartmentActivitySummary extends UnifiedRegistration {
  startsAt: string | null;
  endsAt: string | null;
  detailsPath: string;
}
export interface DepartmentActivitiesPayload {
  departmentId: DepartmentId;
  active: DepartmentActivitySummary[];
  past: DepartmentActivitySummary[];
}
