import { ROLE_KEYS, type RoleKey } from '@freebbs-development/contracts';
import type { PermissionRule, RolePermissionCatalog } from './policy.js';

const rules = (
  ...entries: Array<readonly [string, string, PermissionRule['scope']?]>
): PermissionRule[] =>
  entries.map(([action, resource, scope]) => ({
    action,
    resource,
    ...(scope === undefined ? {} : { scope }),
  }));

export const BASE_STUDENT_PERMISSIONS: readonly PermissionRule[] = [
  ...rules(
    ['dashboard.read', 'dashboard'],
    ['knowledge.read', 'knowledge_entry'],
    ['information.announcement.read', 'announcement'],
    ['information.consultation.create', 'consultation'],
    ['information.proposal.read', 'proposal'],
    ['information.proposal.create', 'proposal'],
    ['clubs.read', 'club'],
    ['clubs.join', 'club_membership'],
    ['clubs.leave', 'club_membership'],
    ['events.read', 'activity'],
    ['events.register', 'activity_registration'],
    ['events.cancel_registration', 'activity_registration'],
    ['sports.team.read', 'sports_team'],
    ['sports.match.read', 'sports_match'],
    ['sports.showcase.read', 'sports_showcase'],
    ['liaison.problem.read', 'liaison_problem'],
    ['liaison.problem.join', 'liaison_problem'],
    ['liaison.problem.post', 'liaison_problem'],
    ['liaison.problem.outcome.submit', 'liaison_outcome'],
  ),
  {
    action: 'liaison.resource.read',
    resource: 'liaison_resource',
    scope: { type: 'public', id: '*' },
  },
];
const BASE_ROLE_PERMISSION_CATALOG: Partial<RolePermissionCatalog> = {
  'platform.super_admin': rules(['*', '*'], ['liaison.problem.review', 'liaison_problem']),
  'domain.arts_lead': rules(
    ['events.*', '*'],
    ['knowledge.*', '*'],
    ['finance.record.read', 'finance_record', { type: 'social_organization', id: 'arts_center' }],
    ['finance.record.create', 'finance_record', { type: 'social_organization', id: 'arts_center' }],
    ['finance.record.update', 'finance_record', { type: 'social_organization', id: 'arts_center' }],
  ),
  'domain.sports_lead': rules(
    ['sports.*', '*'],
    ['events.*', '*'],
    ['knowledge.*', '*'],
    ['finance.record.read', 'finance_record', { type: 'social_organization', id: 'sports_center' }],
    [
      'finance.record.create',
      'finance_record',
      { type: 'social_organization', id: 'sports_center' },
    ],
    [
      'finance.record.update',
      'finance_record',
      { type: 'social_organization', id: 'sports_center' },
    ],
  ),
  'domain.liaison_lead': rules(
    ['clubs.*', '*'],
    ['liaison.resource.*', '*'],
    ['liaison.problem.read', 'liaison_problem'],
    ['liaison.problem.create', 'liaison_problem'],
    ['liaison.problem.update', 'liaison_problem'],
    ['liaison.problem.submit_review', 'liaison_problem'],
    ['liaison.problem.join', 'liaison_problem'],
    ['liaison.problem.post', 'liaison_problem'],
    ['liaison.problem.outcome.submit', 'liaison_outcome'],
    ['liaison.problem.outcome.manage', 'liaison_outcome'],
    ['information.*', '*'],
    ['events.*', '*'],
    ['knowledge.*', '*'],
    [
      'finance.record.read',
      'finance_record',
      { type: 'social_organization', id: 'liaison_center' },
    ],
    [
      'finance.record.create',
      'finance_record',
      { type: 'social_organization', id: 'liaison_center' },
    ],
    [
      'finance.record.update',
      'finance_record',
      { type: 'social_organization', id: 'liaison_center' },
    ],
  ),
  'domain.rights_development_lead': rules(
    ['events.*', '*'],
    [
      'finance.record.read',
      'finance_record',
      { type: 'social_organization', id: 'rights_development_center' },
    ],
    [
      'finance.record.create',
      'finance_record',
      { type: 'social_organization', id: 'rights_development_center' },
    ],
    [
      'finance.record.update',
      'finance_record',
      { type: 'social_organization', id: 'rights_development_center' },
    ],
    ['information.consultation.*', 'consultation'],
    ['information.proposal.manage', 'proposal'],
    ['knowledge.*', '*'],
  ),
  'department.arts_director': rules(
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
  ),
  'department.sports_director': rules(
    ['sports.team.create', 'sports_team'],
    ['sports.team.update', 'sports_team'],
    ['sports.checkin.read', 'sports_checkin'],
    ['sports.checkin.create', 'sports_checkin'],
    ['sports.match.create', 'sports_match'],
    ['sports.match.update', 'sports_match'],
    ['sports.match.delete', 'sports_match'],
    ['sports.showcase.update', 'sports_showcase'],
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
  ),
  'department.liaison_director': rules(
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['clubs.create', 'club'],
    ['clubs.update', 'club'],
    ['liaison.resource.create', 'liaison_resource'],
    ['liaison.resource.update', 'liaison_resource'],
    ['liaison.problem.create', 'liaison_problem'],
    ['liaison.problem.update', 'liaison_problem'],
    ['liaison.problem.submit_review', 'liaison_problem'],
    ['liaison.problem.outcome.manage', 'liaison_outcome'],
    ['information.announcement.create', 'announcement'],
    ['information.announcement.publish', 'announcement'],
    ['information.consultation.triage', 'consultation'],
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
  ),
  'department.rights_development_director': rules(
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['information.consultation.triage', 'consultation'],
    ['information.proposal.manage', 'proposal'],
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
  ),
  'department.arts_member': rules(
    ['events.create', 'activity'],
    ['knowledge.create', 'knowledge_entry'],
  ),
  'department.sports_member': rules(
    ['sports.team.read', 'sports_team'],
    ['sports.checkin.read', 'sports_checkin'],
    ['sports.match.create', 'sports_match'],
    ['sports.match.update', 'sports_match'],
    ['sports.match.delete', 'sports_match'],
    ['events.create', 'activity'],
    ['knowledge.create', 'knowledge_entry'],
  ),
  'department.liaison_member': rules(
    ['events.create', 'activity'],
    ['clubs.create', 'club'],
    ['clubs.update', 'club'],
    ['liaison.resource.read', 'liaison_resource'],
    ['liaison.resource.create', 'liaison_resource'],
    ['liaison.problem.create', 'liaison_problem'],
    ['liaison.problem.update', 'liaison_problem'],
    ['liaison.problem.submit_review', 'liaison_problem'],
    ['liaison.problem.outcome.manage', 'liaison_outcome'],
    ['information.announcement.create', 'announcement'],
    ['knowledge.create', 'knowledge_entry'],
  ),
  'department.rights_development_member': rules(
    ['events.create', 'activity'],
    ['information.consultation.read', 'consultation'],
    ['information.consultation.triage', 'consultation'],
    ['information.proposal.manage', 'proposal'],
    ['knowledge.create', 'knowledge_entry'],
  ),
  'affiliation.tuanwei_member': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['events.create', 'activity'],
  ),
  'affiliation.sast_member': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['events.create', 'activity'],
    ['events.technical_support', 'activity'],
    ['clubs.technical_support', 'club'],
  ),
  'affiliation.tuanwei_director': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['information.announcement.publish', 'announcement'],
  ),
  'affiliation.tuanwei_lead': rules(
    ['knowledge.*', '*'],
    ['events.*', '*'],
    ['information.announcement.publish', 'announcement'],
    ['finance.*', '*'],
    ['liaison.problem.review', 'liaison_problem'],
  ),
  'affiliation.sast_director': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
    ['events.create', 'activity'],
    ['events.update', 'activity'],
    ['events.technical_support', 'activity'],
    ['clubs.technical_support', 'club'],
  ),
  'affiliation.sast_lead': rules(
    ['knowledge.*', '*'],
    ['events.*', '*'],
    ['clubs.technical_support', 'club'],
    ['finance.record.read', 'finance_record', { type: 'social_organization', id: 'sast' }],
    ['finance.record.create', 'finance_record', { type: 'social_organization', id: 'sast' }],
    ['finance.record.update', 'finance_record', { type: 'social_organization', id: 'sast' }],
  ),
  'affiliation.tms_member': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['events.create', 'activity'],
  ),
  'affiliation.tms_director': rules(
    ['knowledge.create', 'knowledge_entry'],
    ['knowledge.publish', 'knowledge_entry'],
    ['events.create', 'activity'],
    ['events.update', 'activity'],
  ),
  'affiliation.tms_lead': rules(
    ['knowledge.*', '*'],
    ['events.*', '*'],
    ['finance.record.read', 'finance_record', { type: 'social_organization', id: 'tms' }],
    ['finance.record.create', 'finance_record', { type: 'social_organization', id: 'tms' }],
    ['finance.record.update', 'finance_record', { type: 'social_organization', id: 'tms' }],
  ),
};

function inheritedPermissionProfile(roleKey: RoleKey): RoleKey | null {
  if (roleKey.startsWith('youth_league.')) {
    if (roleKey.endsWith('.deputy_secretary') || roleKey.endsWith('.consultant'))
      return 'affiliation.tuanwei_lead';
    if (roleKey.endsWith('.leader') || roleKey.endsWith('.mentor'))
      return 'affiliation.tuanwei_director';
    if (roleKey.endsWith('.member') || roleKey.endsWith('.student'))
      return 'affiliation.tuanwei_member';
  }
  if (roleKey === 'science_association.chair' || roleKey.endsWith('.vice_chair'))
    return 'affiliation.sast_lead';
  if (roleKey.startsWith('science_association.') && roleKey.endsWith('.minister'))
    return 'affiliation.sast_director';
  if (roleKey.startsWith('science_association.') && roleKey.endsWith('.member'))
    return 'affiliation.sast_member';
  return null;
}

export const ROLE_PERMISSION_CATALOG: RolePermissionCatalog = Object.fromEntries(
  ROLE_KEYS.map((roleKey) => {
    const inherited = inheritedPermissionProfile(roleKey);
    return [
      roleKey,
      BASE_ROLE_PERMISSION_CATALOG[roleKey] ??
        (inherited ? BASE_ROLE_PERMISSION_CATALOG[inherited] : undefined) ??
        [],
    ];
  }),
) as unknown as RolePermissionCatalog;

export const SPORTS_CAPTAIN_RULES: readonly PermissionRule[] = rules(
  ['sports.checkin.read', 'sports_checkin'],
  ['sports.checkin.create', 'sports_checkin'],
  ['sports.showcase.update', 'sports_showcase'],
);
export const ADMIN_PERMISSION_RULES: readonly PermissionRule[] = rules(
  ['admin.manage', 'admin'],
  ['admin.module.update', 'module'],
  ['admin.role_assignment.grant', 'role_assignment'],
  ['admin.role_assignment.revoke', 'role_assignment'],
  ['admin.tag_assignment.grant', 'tag_assignment'],
  ['admin.tag_assignment.revoke', 'tag_assignment'],
);
export const ALL_PERMISSION_RULES: readonly PermissionRule[] = [
  ...BASE_STUDENT_PERMISSIONS,
  ...Object.values(ROLE_PERMISSION_CATALOG).flat(),
  ...SPORTS_CAPTAIN_RULES,
  ...ADMIN_PERMISSION_RULES,
];
