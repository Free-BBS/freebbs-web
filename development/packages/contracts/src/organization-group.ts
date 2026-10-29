/** Dedicated youth_league.organization ledger; all file URLs require authentication. */
export type OrganizationGroupAnswer = string | number | string[];
export type OrganizationGroupScope =
  { kind: 'all' | 'department' } | { kind: 'classes' | 'users'; ids: string[] };
export type OrganizationGroupViewScope =
  { kind: 'own' | 'same_class' | 'all' } | { kind: 'users'; ids: string[] };
export interface OrganizationGroupClass {
  id: string;
  label: string;
}
export interface OrganizationGroupMember {
  uid: string;
  studentId: string;
  classId: string;
  submitClassIds: string[];
}
export interface OrganizationGroupOption {
  id: string;
  label: string;
}
export interface OrganizationGroupField {
  id: string;
  label: string;
  help?: string;
  kind: 'text' | 'long_text' | 'integer' | 'date' | 'choice' | 'multi_choice' | 'image';
  required: boolean;
  options?: string[];
  maxLength?: number;
  min?: number;
  max?: number;
}
export type OrganizationGroupCoreField =
  | 'classId'
  | 'participantCount'
  | 'activityTypeId'
  | 'activityTypeIds'
  | 'participantNames'
  | 'activityDate'
  | 'summary'
  | 'photos'
  | 'difficulties';
export interface OrganizationGroupCorePresentation {
  label: string;
  help?: string;
}
export interface OrganizationGroupVersionInput {
  /** Absence identifies the original single-category questionnaire and its historical rules. */
  template?: 'class_activity_v2';
  activityTypes: OrganizationGroupOption[];
  fields: OrganizationGroupField[];
  corePresentation?: Partial<Record<OrganizationGroupCoreField, OrganizationGroupCorePresentation>>;
}
export interface OrganizationGroupVersion extends OrganizationGroupVersionInput {
  id: string;
  yearId: string;
  number: number;
  publishedAt: string;
  publishedBy: string;
}
export interface OrganizationGroupYear {
  id: string;
  label: string;
  revision: number;
  startDate: string | null;
  endDate: string | null;
  archived: boolean;
  submissionOpen: boolean;
  editOpen: boolean;
  currentVersionId: string | null;
  draft: OrganizationGroupVersionInput | null;
}
export interface OrganizationGroupSettings {
  activeYearId: string;
  viewScope: OrganizationGroupViewScope;
  hideDifficulties: boolean;
  ordinaryExport: boolean;
  maxPhotos: number;
  maxPhotoBytes: number;
  maxResourceBytes: number;
}
export interface OrganizationGroupWorkspace extends OrganizationGroupSettings {
  revision: number;
  departmentId: 'youth_league.organization';
  classes: OrganizationGroupClass[];
  /** Managers only. Ordinary users receive only their matched member row, never the full roster. */
  members: OrganizationGroupMember[];
  managerUids: string[];
  years: OrganizationGroupYear[];
  versions: OrganizationGroupVersion[];
  canManage: boolean;
  canViewAll?: boolean;
  canGrantSecretaries?: boolean;
  canGrantManagers: boolean;
  canExport: boolean;
  allowedSubmitClassIds: string[];
  setupRequired: boolean;
  canSubmit: boolean;
  submissionBlockedReason: string | null;
}
export interface OrganizationGroupSettingsPatch extends Partial<OrganizationGroupSettings> {
  revision: number;
  classes?: OrganizationGroupClass[];
  members?: OrganizationGroupMember[];
  managerUids?: string[];
}
export interface OrganizationGroupFile {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  previewable: boolean;
  purpose: 'activity_photo' | 'resource';
  yearId: string;
  createdAt: string;
}
export interface OrganizationGroupEntryValues {
  classId: string;
  participantCount: number;
  activityTypeId?: string;
  activityTypeIds?: string[];
  participantNames?: string;
  activityDate?: string | null;
  summary: string;
  difficulties?: string;
  photoIds: string[];
  extraAnswers?: Record<string, OrganizationGroupAnswer>;
}
export interface OrganizationGroupEntryCreate extends OrganizationGroupEntryValues {
  yearId: string;
  expectedVersionId: string;
}
export interface OrganizationGroupEntryPatch extends Partial<OrganizationGroupEntryValues> {
  revision: number;
}
export interface OrganizationGroupEntry {
  id: string;
  yearId: string;
  versionId: string;
  authorUid: string;
  authorName: string;
  classId: string;
  classLabel: string;
  participantCount: number;
  activityTypeId: string;
  activityTypeLabel: string;
  /** Always normalized by the API, including original single-category records. */
  activityTypeIds?: string[];
  activityTypeLabels?: string[];
  participantNames?: string;
  activityDate: string | null;
  summary: string;
  difficulties?: string;
  extraAnswers: Record<string, OrganizationGroupAnswer>;
  photos: OrganizationGroupFile[];
  extraPhotos: OrganizationGroupFile[];
  locked: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  editBlockedReason: string | null;
}
export interface OrganizationGroupStatistics {
  activityCount: number;
  participantTimes: number;
  byClass: Record<string, number>;
  byActivityType: Record<string, number>;
}
export interface OrganizationGroupEntryList {
  items: OrganizationGroupEntry[];
  total: number;
  page: number;
  pageSize: number;
  statistics: OrganizationGroupStatistics;
}
export interface OrganizationGroupEditContext {
  entry: OrganizationGroupEntry;
  version: OrganizationGroupVersion;
}
export interface OrganizationGroupEntryQuery {
  yearId?: string;
  classId?: string;
  activityTypeId?: string;
  authorUid?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  sort?:
    | 'created_desc'
    | 'created_asc'
    | 'date_asc'
    | 'date_desc'
    | 'participants_asc'
    | 'participants_desc';
  page?: number;
  pageSize?: number;
}
export interface OrganizationGroupDeadlineInput {
  yearId: string;
  title: string;
  description?: string;
  dueAt: string;
  scope: OrganizationGroupScope;
  status?: 'active' | 'cancelled';
}
export interface OrganizationGroupDeadline extends OrganizationGroupDeadlineInput {
  id: string;
  description: string;
  status: 'active' | 'cancelled';
  revision: number;
  createdBy: string;
  updatedAt: string;
  displayStatus: 'upcoming' | 'expired' | 'cancelled';
}
export interface OrganizationGroupResourceInput {
  yearId: string;
  title: string;
  description?: string;
  fileId: string;
  scope: OrganizationGroupScope;
  deadlineId?: string | null;
}
export interface OrganizationGroupResource extends OrganizationGroupResourceInput {
  id: string;
  description: string;
  file: OrganizationGroupFile;
  deadlineId: string | null;
  revision: number;
  createdBy: string;
  updatedAt: string;
}
