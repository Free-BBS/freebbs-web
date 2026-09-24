import {
  MODULE_IDS,
  ROLE_KEYS,
  SOCIAL_ORGANIZATIONS,
  type ModuleId,
  type PermissionAction,
  type RoleKey,
  type ScopeRef,
} from '@freebbs-development/contracts';
import {
  ALL_PERMISSION_RULES,
  ROLE_PERMISSION_CATALOG,
  SPORTS_CAPTAIN_RULES,
} from '../authorization/permission-catalog.js';

const publicScope: ScopeRef = { type: 'public', id: '*' };
const sportsTeamScope: ScopeRef = { type: 'sports_team', id: '*' };

const roleNames: Readonly<Record<RoleKey, string>> = {
  'platform.super_admin': 'Platform super administrator',
  'domain.arts_lead': '文艺中心负责人',
  'domain.sports_lead': '体育中心负责人',
  'domain.liaison_lead': '联络中心负责人',
  'domain.rights_development_lead': '权发中心负责人',
  'department.arts_director': '文艺中心部长',
  'department.sports_director': '体育中心部长',
  'department.liaison_director': '联络中心部长',
  'department.rights_development_director': '权发中心部长',
  'department.arts_member': '文艺中心部员',
  'department.sports_member': '体育中心部员',
  'department.liaison_member': '联络中心部员',
  'department.rights_development_member': '权发中心部员',
  'affiliation.tuanwei_member': 'Youth League affiliation member',
  'affiliation.sast_member': 'SAST affiliation member',
  'affiliation.tuanwei_director': 'Youth League affiliation director',
  'affiliation.tuanwei_lead': 'Youth League affiliation lead',
  'affiliation.sast_director': 'SAST affiliation director',
  'affiliation.sast_lead': 'SAST affiliation lead',
  'affiliation.tms_member': 'TMS member',
  'affiliation.tms_director': 'TMS director',
  'affiliation.tms_lead': 'TMS lead',
};

const moduleNames: Readonly<Record<ModuleId, string>> = {
  dashboard: 'Dashboard',
  knowledge: 'Knowledge',
  information: 'Information and consultation',
  clubs: 'Clubs',
  growth: 'Personal growth archive',
  events: 'Events',
  liaison: 'Liaison resources',
  sports: '無体育',
  finance: 'Finance governance',
  admin: 'Permissions and modules',
};

export const BUILT_IN_ROLES = ROLE_KEYS.map((key) => ({ key, name: roleNames[key] }));

const seenPermissions = new Set<string>();
export const BUILT_IN_PERMISSIONS = ALL_PERMISSION_RULES.flatMap(({ action, resource }) => {
  const identity = `${action}\u0000${resource}`;
  if (seenPermissions.has(identity)) return [];
  seenPermissions.add(identity);
  return [{ action: action as PermissionAction, resource }];
});

export const BUILT_IN_ROLE_PERMISSIONS = ROLE_KEYS.flatMap((roleKey) =>
  ROLE_PERMISSION_CATALOG[roleKey].map(({ action, resource, scope }) => ({
    roleKey,
    action: action as PermissionAction,
    resource,
    effect: 'allow' as const,
    scope: scope ?? publicScope,
  })),
);

export const BUILT_IN_TAG_DEFINITIONS = [
  ...SOCIAL_ORGANIZATIONS.map((organization) => ({
    key: organization.tagKey,
    name: organization.name,
    description: `${organization.name} membership managed by organization level assignments.`,
    requiredScopeType: 'social_organization',
    metadata: {
      managedBy: 'organization_membership',
      organizationId: organization.id,
    },
  })),
  {
    key: 'sports.team_captain',
    name: 'Sports team captain',
    description: 'Grants check-in and showcase permissions within one assigned sports team.',
    requiredScopeType: 'sports_team',
    metadata: { resourceTypes: ['sports_team'] },
  },
] as const;

export const BUILT_IN_TAG_PERMISSIONS = SPORTS_CAPTAIN_RULES.map(({ action, resource }) => ({
  tagKey: 'sports.team_captain',
  action: action as PermissionAction,
  resource,
  effect: 'allow' as const,
  scope: sportsTeamScope,
}));

export const BUILT_IN_MODULES = MODULE_IDS.map((moduleId) => ({
  moduleId,
  name: moduleNames[moduleId],
  description: `${moduleNames[moduleId]} module`,
  enabled: true,
}));
