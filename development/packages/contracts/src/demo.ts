import type { RoleKey } from './modules.js';
import type { SocialOrganizationId } from './organizations.js';

export const DEMO_CENTER_USERS = [
  {
    uid: 'demo-arts-member',
    displayName: '文艺中心部员',
    organizationId: 'arts_center',
    role: 'department.arts_member',
  },
  {
    uid: 'demo-arts-director',
    displayName: '文艺中心部长',
    organizationId: 'arts_center',
    role: 'department.arts_director',
  },
  {
    uid: 'demo-arts-lead',
    displayName: '文艺中心负责人',
    organizationId: 'arts_center',
    role: 'domain.arts_lead',
  },
  {
    uid: 'demo-sports-member',
    displayName: '体育中心部员',
    organizationId: 'sports_center',
    role: 'department.sports_member',
  },
  {
    uid: 'demo-sports-director',
    displayName: '体育中心部长',
    organizationId: 'sports_center',
    role: 'department.sports_director',
  },
  {
    uid: 'demo-sports-lead',
    displayName: '体育中心负责人',
    organizationId: 'sports_center',
    role: 'domain.sports_lead',
  },
  {
    uid: 'demo-liaison-member',
    displayName: '联络中心部员',
    organizationId: 'liaison_center',
    role: 'department.liaison_member',
  },
  {
    uid: 'demo-liaison-director',
    displayName: '联络中心部长',
    organizationId: 'liaison_center',
    role: 'department.liaison_director',
  },
  {
    uid: 'demo-liaison-lead',
    displayName: '联络中心负责人',
    organizationId: 'liaison_center',
    role: 'domain.liaison_lead',
  },
  {
    uid: 'demo-rights-member',
    displayName: '权发中心部员',
    organizationId: 'rights_development_center',
    role: 'department.rights_development_member',
  },
  {
    uid: 'demo-rights-director',
    displayName: '权发中心部长',
    organizationId: 'rights_development_center',
    role: 'department.rights_development_director',
  },
  {
    uid: 'demo-rights-lead',
    displayName: '权发中心负责人',
    organizationId: 'rights_development_center',
    role: 'domain.rights_development_lead',
  },
] as const satisfies readonly {
  uid: string;
  displayName: string;
  organizationId: SocialOrganizationId;
  role: RoleKey;
}[];

export const DEMO_USERS = [
  { uid: 'demo-student', displayName: '普通同学' },
  { uid: 'demo-admin', displayName: '平台管理员' },
  ...DEMO_CENTER_USERS,
  { uid: 'demo-captain', displayName: '代表队队长' },
  { uid: 'demo-tuanwei-lead', displayName: '团委负责人' },
] as const;

export type DemoUserId = (typeof DEMO_USERS)[number]['uid'];
export const DEMO_USER_IDS: readonly DemoUserId[] = DEMO_USERS.map(({ uid }) => uid);
