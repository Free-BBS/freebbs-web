import { ROLE_KEYS, type RoleKey } from './modules.js';

export const SOCIAL_ORGANIZATION_IDS = [
  'arts_center',
  'liaison_center',
  'sports_center',
  'rights_development_center',
  'tuanwei',
  'sast',
  'tms',
  'media_center',
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
  {
    id: 'media_center',
    name: '学生媒体中心',
    tagKey: 'social_org.media_center',
    roles: {
      member: 'media_center.creative.member',
      director: 'media_center.creative.minister',
      lead: 'media_center.creative.consultant',
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

const UNION_ORGANIZATIONS = [
  'arts_center',
  'liaison_center',
  'sports_center',
  'rights_development_center',
] as const;

/** Business membership projection. Counselors supervise departments without holding a position. */
export function organizationMembershipsForRole(roleKey: string): OrganizationRole[] {
  const legacy = ORGANIZATION_BY_ROLE.get(roleKey as RoleKey);
  if (legacy !== undefined) return [{ ...legacy }];
  if (roleKey === 'student_union.executive_president' || roleKey === 'student_union.presidium') {
    return UNION_ORGANIZATIONS.map((organizationId) => ({ organizationId, level: 'lead' }));
  }
  if (roleKey === 'student_union.finance') {
    return UNION_ORGANIZATIONS.map((organizationId) => ({ organizationId, level: 'member' }));
  }
  const organizationId = roleKey.startsWith('youth_league.')
    ? 'tuanwei'
    : roleKey.startsWith('science_association.')
      ? 'sast'
      : roleKey.startsWith('media_center.')
        ? 'media_center'
        : null;
  if (organizationId === null) return [];
  // Reject unknown role strings even if their prefix resembles an organization.
  if (!ROLE_KEYS.includes(roleKey as RoleKey)) return [];
  const level: OrganizationLevel =
    roleKey === 'science_association.office.vice_chair'
      ? 'member'
      : roleKey === 'science_association.chair' ||
          /\.(deputy_secretary|vice_chair|consultant)$/.test(roleKey)
        ? 'lead'
        : /\.(leader|minister|mentor)$/.test(roleKey)
          ? 'director'
          : 'member';
  return [{ organizationId, level }];
}

export function organizationMembershipsForRoles(roles: readonly string[]): OrganizationRole[] {
  const memberships = new Map<SocialOrganizationId, OrganizationRole>();
  const rank: Record<OrganizationLevel, number> = { member: 0, director: 1, lead: 2 };
  for (const role of roles)
    for (const membership of organizationMembershipsForRole(role)) {
      const previous = memberships.get(membership.organizationId);
      if (previous === undefined || rank[membership.level] > rank[previous.level]) {
        memberships.set(membership.organizationId, membership);
      }
    }
  return [...memberships.values()];
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
