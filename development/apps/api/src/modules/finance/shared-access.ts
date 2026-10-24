import {
  DEPARTMENT_DIRECTORY,
  type FinanceDepartment,
  type RoleKey,
  type ScopeRef,
} from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';

const globalScope = (scope: ScopeRef) => scope.type === 'public' && scope.id === '*';
const current = (expiresAt: string | null | undefined) =>
  expiresAt == null ||
  (Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now());

/** Consume only appointments loaded from the shared identity store, never finance grants. */
function appointments(actor: AuthorizationContext) {
  if (actor.previewing || (actor.viewer && actor.viewer.uid !== actor.uid)) return [];
  return (actor.roleScopes ?? []).filter(
    (assignment) =>
      assignment.subjectUid === actor.uid &&
      actor.roles.includes(assignment.roleKey) &&
      current(assignment.expiresAt),
  );
}

export function isFinanceFinalReviewer(actor: AuthorizationContext): boolean {
  if (actor.previewing || (actor.viewer && actor.viewer.uid !== actor.uid)) return false;
  return (
    actor.rootAdmin === true ||
    appointments(actor).some(
      ({ roleKey, scope }) =>
        globalScope(scope) &&
        (roleKey === 'counselor.youth_league_secretary' || roleKey === 'counselor.youth_league'),
    )
  );
}

const financeOrganization = (department: FinanceDepartment) =>
  department.id === 'student_union.sports_center' ? 'student_union' : department.portId;
const socialOrganization = (department: FinanceDepartment) =>
  DEPARTMENT_DIRECTORY.find(({ id }) => id === department.id)?.organizationId ??
  { youth_league: 'tuanwei', science_association: 'sast' }[
    department.portId as 'youth_league' | 'science_association'
  ] ??
  department.portId;

function coversDepartment(scope: ScopeRef, department: FinanceDepartment): boolean {
  return (
    globalScope(scope) ||
    (scope.type === 'department' && scope.id === department.id) ||
    (scope.type === 'organization' && scope.id === financeOrganization(department)) ||
    (['social_organization', 'social_org'].includes(scope.type) &&
      scope.id === socialOrganization(department))
  );
}

const financeOfficers: Partial<Record<RoleKey, string>> = {
  'youth_league.finance': 'youth_league',
  'student_union.finance': 'student_union',
  'science_association.office.vice_chair': 'science_association',
  'media_center.finance': 'media_center',
};
const organizationLeads: Partial<Record<RoleKey, string>> = {
  'student_union.executive_president': 'student_union',
  'student_union.presidium': 'student_union',
  'science_association.chair': 'science_association',
  'affiliation.tuanwei_lead': 'youth_league',
  'affiliation.tuanwei_director': 'youth_league',
  'affiliation.sast_lead': 'science_association',
  'affiliation.sast_director': 'science_association',
};

export function financeDepartmentAccess(
  actor: AuthorizationContext,
  department: FinanceDepartment,
): { read: boolean; submit: boolean; officer: boolean } {
  if (isFinanceFinalReviewer(actor)) return { read: true, submit: true, officer: true };
  const grants = appointments(actor);
  const directoryId = department.id === 'youth_league.tms' ? 'tms.position' : department.id;
  const definition = DEPARTMENT_DIRECTORY.find(({ id }) => id === directoryId);
  const ownDepartment = grants.some(
    ({ roleKey, scope }) =>
      definition?.roleKeys.includes(roleKey) &&
      !/(?:[._]member|\.student)$/.test(roleKey) &&
      coversDepartment(scope, department),
  );
  const officer = grants.some(
    ({ roleKey, scope }) =>
      financeOfficers[roleKey] === financeOrganization(department) &&
      coversDepartment(scope, department),
  );
  const orgLead = grants.some(
    ({ roleKey, scope }) =>
      organizationLeads[roleKey] === financeOrganization(department) &&
      coversDepartment(scope, department),
  );
  const sportsLead =
    department.portId === 'sports' &&
    grants.some(
      ({ roleKey, scope }) =>
        (roleKey === 'domain.sports_lead' || roleKey === 'department.sports_director') &&
        (globalScope(scope) ||
          (['social_organization', 'social_org'].includes(scope.type) &&
            scope.id === 'sports_center') ||
          (scope.type === 'department' && scope.id === 'student_union.sports_center')),
    );
  const supervisingCounselor = grants.some(
    ({ roleKey, scope }) =>
      coversDepartment(scope, department) &&
      ((roleKey === 'counselor.practice' && department.id === 'youth_league.practice') ||
        (roleKey === 'counselor.innovation' && department.portId === 'science_association') ||
        (roleKey === 'counselor.student_development' &&
          ['youth_league.freshman', 'youth_league.sail'].includes(department.id))),
  );
  const captain =
    !actor.previewing &&
    (!actor.viewer || actor.viewer.uid === actor.uid) &&
    department.portId === 'sports' &&
    Boolean(department.teamId) &&
    actor.tags.some(
      ({ key, scope, expiresAt }) =>
        key === 'sports.team_captain' &&
        scope?.type === 'sports_team' &&
        scope.id !== '*' &&
        scope.id === department.teamId &&
        current(expiresAt),
    );
  return {
    read: ownDepartment || officer || orgLead || sportsLead || supervisingCounselor || captain,
    submit: ownDepartment || captain,
    officer,
  };
}
