import type { AdminAuditLog, Page } from './admin.js';
import type { UserContext } from './auth.js';
import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  identityLabels,
  type DevelopmentIdentitySection,
} from './development-identities.js';
import type { ModuleManifest, ModuleId, RoleKey } from './modules.js';
import { SOCIAL_ORGANIZATIONS, type SocialOrganizationId } from './organizations.js';

export const DUAL_PLATFORM_ADMIN_ROLE_KEYS = [
  'counselor.youth_league_secretary',
  'counselor.youth_league',
  'counselor.student_development',
] as const satisfies readonly RoleKey[];
export const DEVELOPMENT_ADMIN_ROLE_KEYS = [
  'platform.admin',
  ...DUAL_PLATFORM_ADMIN_ROLE_KEYS,
] as const satisfies readonly RoleKey[];
export const LEARNING_ADMIN_ROLE_KEYS = [
  'platform.learning_admin',
  ...DUAL_PLATFORM_ADMIN_ROLE_KEYS,
] as const satisfies readonly RoleKey[];
/** High-privilege global appointments can be changed only by the configured platform root. */
export const ROOT_MANAGED_ROLE_KEYS = [
  'platform.admin',
  'platform.learning_admin',
  ...DUAL_PLATFORM_ADMIN_ROLE_KEYS,
] as const satisfies readonly RoleKey[];

/** Flags are resolved from active, unexpired public:* appointments by the server. */
export function isDevelopmentBusinessAdmin(
  user: Pick<UserContext, 'roles' | 'businessAdmin' | 'rootAdmin'> | null | undefined,
): boolean {
  return (
    user?.rootAdmin === true ||
    (user?.businessAdmin === true &&
      DEVELOPMENT_ADMIN_ROLE_KEYS.some((role) => user.roles.includes(role)))
  );
}
export function isLearningPlatformAdmin(
  user:
    Pick<UserContext, 'roles' | 'learningAdmin' | 'mainSiteAdmin' | 'rootAdmin'> | null | undefined,
): boolean {
  return (
    user?.rootAdmin === true ||
    (user?.learningAdmin === true &&
      (user.mainSiteAdmin === true ||
        LEARNING_ADMIN_ROLE_KEYS.some((role) => user.roles.includes(role))))
  );
}
export function isDevelopmentLead(roles: readonly RoleKey[]): boolean {
  return roles.includes('platform.super_admin');
}
/** Original development access is required, including in demo contexts. */
export function canManageDevelopmentAccess(
  user: Pick<UserContext, 'roles' | 'previewing' | 'viewer' | 'developmentAccess'>,
): boolean {
  if (user.previewing || !isDevelopmentLead(user.roles)) return false;
  return user.viewer?.canManageDevelopment === true && user.developmentAccess === 'lead';
}
export interface DevelopmentBusinessAdminBootstrapStatus {
  canInitialize: boolean;
  globalAdminCount: number;
}
export interface DevelopmentBusinessAdminBootstrapInput {
  uid: string;
  reason?: string;
}
export interface DevelopmentBusinessAdminBootstrapResult {
  initialized: true;
  uid: string;
}
export type DevelopmentAssignableRole = Exclude<RoleKey, 'platform.super_admin'>;
export interface DevelopmentDirectoryFilters {
  query?: string;
  page?: number;
  pageSize?: number;
  organizationId?: string;
  roleKey?: string;
  admission?: 'admitted' | 'not_admitted' | 'member' | 'lead';
}
export interface SystemSettingsUser {
  /** Existing main-site role/is_admin source, displayed read-only. */
  legacyLearningAdmin?: boolean;
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
  roles: DevelopmentAssignableRole[];
  captainTeamIds: string[];
  revision: string;
  canReceiveNotifications: boolean;
}
export interface SystemSettingsUserInput {
  revision: string;
  roles: DevelopmentAssignableRole[];
  captainTeamIds: string[];
}
export interface SystemSettingsOrganization {
  id: SocialOrganizationId;
  name: string;
  description: string;
}
export interface SystemSettingsRole {
  key: DevelopmentAssignableRole;
  name: string;
}
export interface SystemSettingsOrganizations {
  revision: number;
  organizations: SystemSettingsOrganization[];
  roles: SystemSettingsRole[];
}
export interface SystemSettingsOrganizationsInput {
  revision: number;
  organizations?: SystemSettingsOrganization[];
  roles?: SystemSettingsRole[];
}

const sectionOrganizations: Partial<
  Record<DevelopmentIdentitySection['id'], SocialOrganizationId>
> = {
  youth_league: 'tuanwei',
  science_association: 'sast',
  tms: 'tms',
  media_center: 'media_center',
};
const groupOrganizations: Readonly<Record<string, SocialOrganizationId>> = {
  'student_union.arts_center': 'arts_center',
  'student_union.sports_center': 'sports_center',
  'student_union.liaison_center': 'liaison_center',
  'student_union.rights_development_center': 'rights_development_center',
};
function renamedOrganization(
  id: SocialOrganizationId | undefined,
  metadata: SystemSettingsOrganizations,
): string | undefined {
  if (!id) return undefined;
  const name = metadata.organizations.find((row) => row.id === id)?.name;
  return name && name !== SOCIAL_ORGANIZATIONS.find((row) => row.id === id)?.name
    ? name
    : undefined;
}
function customizedRoleName(
  role: RoleKey,
  metadata: SystemSettingsOrganizations,
): string | undefined {
  const name = metadata.roles.find((row) => row.key === role)?.name;
  if (role === 'platform.admin' && name === '平台管理员') return undefined;
  const canonical = identityLabels([role])[0];
  const legacyDefault = canonical
    ?.replace('办公室·新生组', '新生组')
    .replace('学习培养部', '学培部')
    .replace('智能策划部', '策划部');
  if (name === legacyDefault && name !== canonical) return undefined;
  if (role === 'science_association.office.vice_chair' && name === '办公室副主席') return undefined;
  return name && name !== identityLabels([role])[0] ? name : undefined;
}
/** Apply persisted display metadata while keeping canonical keys and default concise options. */
export function systemSettingsIdentitySections(
  metadata: SystemSettingsOrganizations,
): readonly DevelopmentIdentitySection[] {
  return DEVELOPMENT_IDENTITY_SECTIONS.map((section) => {
    const sectionName = renamedOrganization(sectionOrganizations[section.id], metadata);
    return {
      ...section,
      label: sectionName ?? section.label,
      groups: section.groups.map((group) => ({
        ...group,
        label: renamedOrganization(groupOrganizations[group.id], metadata) ?? group.label,
        options: group.options.map((option) => ({
          ...option,
          label:
            customizedRoleName(option.roleKey, metadata) ??
            (group.id === 'science_association.chair' && sectionName
              ? `${sectionName}主席`
              : option.label),
        })),
      })),
    };
  });
}
/** Captions use exactly the same renamed hierarchy; explicit custom role names stand alone. */
export function systemSettingsIdentityLabels(
  roles: readonly RoleKey[],
  metadata: SystemSettingsOrganizations,
): string[] {
  const selected = new Set(roles);
  const labels: string[] = [];
  if (selected.has('platform.learning_admin'))
    labels.push(customizedRoleName('platform.learning_admin', metadata) ?? '学习端管理员');
  if (selected.has('platform.admin'))
    labels.push(customizedRoleName('platform.admin', metadata) ?? '发展端管理员');
  for (const section of systemSettingsIdentitySections(metadata)) {
    const parentName = renamedOrganization(sectionOrganizations[section.id], metadata);
    for (const group of section.groups)
      for (const option of group.options) {
        if (!selected.has(option.roleKey)) continue;
        const custom = customizedRoleName(option.roleKey, metadata);
        if (custom) {
          labels.push(custom);
          continue;
        }
        if (
          ['counselors.position', 'student_union.executive', 'science_association.chair'].includes(
            group.id,
          )
        )
          labels.push(option.label);
        else if (group.id === 'tms.position')
          labels.push(parentName ? `${parentName}${option.label}` : `TMS ${option.label}`);
        else if (group.id === 'science_association.finance') labels.push(option.label);
        else if (group.id === 'student_union.finance') labels.push(`学生会${option.label}`);
        else if (group.id === 'youth_league.finance')
          labels.push(`${parentName ?? '团委'}${option.label}`);
        else if (group.id === 'media_center.finance') labels.push(`学生媒体中心${option.label}`);
        else labels.push(`${parentName ?? ''}${group.label}${option.label}`);
      }
  }
  return labels;
}
export interface SystemSettingsModuleInput {
  moduleId: Exclude<ModuleId, 'admin'>;
  enabled: boolean;
}
export interface DevelopmentNotification {
  id: string;
  kind: 'announcement' | 'reward';
  title: string;
  body: string;
  link: string | null;
  authorUid: string;
  authorDisplayName: string;
  createdAt: string;
  readAt: string | null;
}
export interface SystemSettingsRecipient {
  uid: string;
  displayName: string;
  username: string;
  studentId: string | null;
}
export interface DevelopmentNotificationInput {
  requestId: string;
  title: string;
  body: string;
  recipientUids: string[];
  link?: string | null;
}
export interface SystemSettingsNotificationHistory extends Omit<DevelopmentNotification, 'readAt'> {
  requestId: string;
  recipients: SystemSettingsRecipient[];
  recipientCount: number;
}
export interface DevelopmentNotificationResult {
  id: string;
  recipientCount: number;
  replayed: boolean;
}
export interface DevelopmentRewardInput {
  requestId: string;
  recipientUids: string[];
  title: string;
  reason: string;
  electric: number;
  magnetic: number;
}
export interface DevelopmentRewardResult {
  batchId: number | string;
  recipientCount: number;
  electric: number;
  magnetic: number;
  totalElectric: number;
  totalMagnetic: number;
  replayed: boolean;
}
export interface DevelopmentRewardProvider {
  grant(actorUid: string, input: DevelopmentRewardInput): Promise<DevelopmentRewardResult>;
}
export interface SystemSettingsRewardHistory extends DevelopmentRewardResult {
  id: string;
  requestId: string;
  title: string;
  reason: string;
  recipients: SystemSettingsRecipient[];
  actorUid: string;
  actorDisplayName: string;
  createdAt: string;
}
export interface SystemSettingsBootstrap {
  users: SystemSettingsUser[];
  usersPage?: Page<SystemSettingsUser>;
  identitySections: readonly DevelopmentIdentitySection[];
  organizations: SystemSettingsOrganizations;
  sportsTeams: Array<{ id: string; name: string }>;
  modules: ModuleManifest[];
  notifications: SystemSettingsNotificationHistory[];
  rewards: SystemSettingsRewardHistory[];
  audits: Page<AdminAuditLog>;
  rewardMode: 'shared-wallet' | 'demo' | 'unavailable';
}
