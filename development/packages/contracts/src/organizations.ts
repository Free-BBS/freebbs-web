import type { RoleKey } from './modules.js';

export const SOCIAL_ORGANIZATION_IDS = [
  'arts_center',
  'liaison_center',
  'sports_center',
  'rights_development_center',
  'tuanwei',
  'sast',
  'tms',
] as const;

export type SocialOrganizationId = (typeof SOCIAL_ORGANIZATION_IDS)[number];
export type OrganizationLevel = 'member' | 'director' | 'lead';

export interface SocialOrganizationDefinition {
  id: SocialOrganizationId;
  name: string;
  tagKey: `social_org.${SocialOrganizationId}`;
  roles: Readonly<Record<OrganizationLevel, RoleKey>>;
}

export const SOCIAL_ORGANIZATIONS: readonly SocialOrganizationDefinition[] = [
  {
    id: 'arts_center',
    name: '文艺中心',
    tagKey: 'social_org.arts_center',
    roles: {
      member: 'department.arts_member',
      director: 'department.arts_director',
      lead: 'domain.arts_lead',
    },
  },
  {
    id: 'liaison_center',
    name: '联络中心',
    tagKey: 'social_org.liaison_center',
    roles: {
      member: 'department.liaison_member',
      director: 'department.liaison_director',
      lead: 'domain.liaison_lead',
    },
  },
  {
    id: 'sports_center',
    name: '体育中心',
    tagKey: 'social_org.sports_center',
    roles: {
      member: 'department.sports_member',
      director: 'department.sports_director',
      lead: 'domain.sports_lead',
    },
  },
  {
    id: 'rights_development_center',
    name: '权益发展中心',
    tagKey: 'social_org.rights_development_center',
    roles: {
      member: 'department.rights_development_member',
      director: 'department.rights_development_director',
      lead: 'domain.rights_development_lead',
    },
  },
  {
    id: 'tuanwei',
    name: '团委',
    tagKey: 'social_org.tuanwei',
    roles: {
      member: 'affiliation.tuanwei_member',
      director: 'affiliation.tuanwei_director',
      lead: 'affiliation.tuanwei_lead',
    },
  },
  {
    id: 'sast',
    name: '科协',
    tagKey: 'social_org.sast',
    roles: {
      member: 'affiliation.sast_member',
      director: 'affiliation.sast_director',
      lead: 'affiliation.sast_lead',
    },
  },
  {
    id: 'tms',
    name: 'TMS',
    tagKey: 'social_org.tms',
    roles: {
      member: 'affiliation.tms_member',
      director: 'affiliation.tms_director',
      lead: 'affiliation.tms_lead',
    },
  },
] as const;

export interface OrganizationRole {
  organizationId: SocialOrganizationId;
  level: OrganizationLevel;
}

const ORGANIZATION_BY_ROLE = new Map<RoleKey, OrganizationRole>(
  SOCIAL_ORGANIZATIONS.flatMap((organization) =>
    (Object.entries(organization.roles) as Array<[OrganizationLevel, RoleKey]>).map(
      ([level, roleKey]) => [roleKey, { organizationId: organization.id, level }],
    ),
  ),
);

export function organizationForRole(roleKey: RoleKey): OrganizationRole | null {
  return ORGANIZATION_BY_ROLE.get(roleKey) ?? null;
}

export function organizationById(
  organizationId: SocialOrganizationId,
): SocialOrganizationDefinition {
  const definition = SOCIAL_ORGANIZATIONS.find(({ id }) => id === organizationId);
  if (definition === undefined) {
    throw new Error(`Unknown social organization: ${organizationId}`);
  }
  return definition;
}
