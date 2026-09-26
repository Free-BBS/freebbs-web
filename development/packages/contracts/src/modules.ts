import type { PermissionAction } from './permissions.js';

export const MODULE_IDS = [
  'dashboard',
  'knowledge',
  'information',
  'clubs',
  'growth',
  'events',
  'liaison',
  'sports',
  'finance',
  'admin',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export const ROLE_KEYS = [
  'platform.super_admin',
  'platform.admin',
  'counselor.youth_league_secretary',
  'counselor.youth_league',
  'counselor.practice',
  'counselor.innovation',
  'counselor.student_development',
  'student_union.executive_president',
  'student_union.presidium',
  'student_union.finance',
  'domain.arts_lead',
  'domain.sports_lead',
  'domain.liaison_lead',
  'domain.rights_development_lead',
  'department.arts_director',
  'department.sports_director',
  'department.liaison_director',
  'department.rights_development_director',
  'department.arts_member',
  'department.sports_member',
  'department.liaison_member',
  'department.rights_development_member',
  'affiliation.tuanwei_member',
  'affiliation.sast_member',
  'affiliation.tuanwei_director',
  'affiliation.tuanwei_lead',
  'affiliation.sast_director',
  'affiliation.sast_lead',
  'affiliation.tms_member',
  'affiliation.tms_director',
  'affiliation.tms_lead',
  'youth_league.organization.deputy_secretary',
  'youth_league.organization.leader',
  'youth_league.organization.member',
  'youth_league.freshman.deputy_secretary',
  'youth_league.freshman.leader',
  'youth_league.freshman.member',
  'youth_league.volunteer.deputy_secretary',
  'youth_league.volunteer.leader',
  'youth_league.volunteer.member',
  'youth_league.practice.deputy_secretary',
  'youth_league.practice.leader',
  'youth_league.practice.member',
  'youth_league.humanities.deputy_secretary',
  'youth_league.humanities.leader',
  'youth_league.humanities.member',
  'youth_league.sail.consultant',
  'youth_league.sail.mentor',
  'youth_league.sail.student',
  'youth_league.finance',
  'science_association.chair',
  'science_association.office.vice_chair',
  'science_association.office.minister',
  'science_association.office.member',
  'science_association.software.vice_chair',
  'science_association.software.minister',
  'science_association.software.member',
  'science_association.hardware.vice_chair',
  'science_association.hardware.minister',
  'science_association.hardware.member',
  'science_association.training.vice_chair',
  'science_association.training.minister',
  'science_association.training.member',
  'science_association.project.vice_chair',
  'science_association.project.minister',
  'science_association.project.member',
  'science_association.planning.vice_chair',
  'science_association.planning.minister',
  'science_association.planning.member',
  'media_center.creative.consultant',
  'media_center.creative.minister',
  'media_center.creative.member',
  'media_center.audiovisual.consultant',
  'media_center.audiovisual.minister',
  'media_center.audiovisual.member',
  'media_center.new_media_reporters.consultant',
  'media_center.new_media_reporters.minister',
  'media_center.new_media_reporters.member',
  'media_center.finance',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type ModuleStatus = 'enabled' | 'disabled';

export interface ModuleManifest {
  id: ModuleId;
  name: string;
  description: string;
  route: string;
  icon: string;
  ownerTeam: string;
  status: ModuleStatus;
  requiredPermissions: PermissionAction[];
  order: number;
}
