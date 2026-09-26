import {
  MODULE_IDS,
  ROLE_KEYS,
  SOCIAL_ORGANIZATIONS,
  identityLabels,
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

const hiddenRoleNames: Partial<Readonly<Record<RoleKey, string>>> = {
  'platform.super_admin': '发展端负责人',
  'affiliation.tuanwei_member': '团委历史身份（部员）',
  'affiliation.tuanwei_director': '团委历史身份（部长）',
  'affiliation.tuanwei_lead': '团委历史身份（负责人）',
  'affiliation.sast_member': '科协历史身份（部员）',
  'affiliation.sast_director': '科协历史身份（部长）',
  'affiliation.sast_lead': '科协历史身份（负责人）',
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

export const BUILT_IN_ROLES = ROLE_KEYS.map((key) => ({
  key,
  name: hiddenRoleNames[key] ?? identityLabels([key])[0] ?? key,
}));

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
