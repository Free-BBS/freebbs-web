import type {
  FestivalSubmissionStatus,
  ModuleId,
  PermissionAction,
  RoleKey,
  ScopeRef,
  SocialOrganizationId,
} from '@freebbs-development/contracts';

export interface StoredRecord {
  id: string;
  status: string;
  ownerUid: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
}

type DefaultedContentKeys<T> = Extract<
  keyof T,
  | 'tags'
  | 'summary'
  | 'maintainedAt'
  | 'maintainerUid'
  | 'dueAt'
  | 'contactName'
  | 'publicContact'
  | 'registrationDeadline'
  | 'capacity'
  | 'contact'
  | 'season'
  | 'trainingSchedule'
  | (T extends KnowledgeEntryRecord | ClubRecord ? 'category' : never)
  | (T extends LiaisonProblemRecord
      ? 'startsAt' | 'deadline' | 'reviewerUid' | 'reviewedAt' | 'reviewNote'
      : never)
  | (T extends FestivalSubmissionRecord ? 'reviewerUid' | 'reviewedAt' | 'reviewNote' : never)
  | (T extends LiaisonPostRecord ? 'teamId' | 'hiddenAt' | 'hiddenByUid' : never)
  | (T extends LiaisonOutcomeRecord
      ? 'linkUrl' | 'attachmentRef' | 'adoptedAt' | 'adoptedByUid'
      : never)
>;
export type NewRecord<T extends StoredRecord> = Pick<
  StoredRecord,
  'status' | 'ownerUid' | 'scope'
> &
  Omit<T, 'id' | 'createdAt' | 'updatedAt' | DefaultedContentKeys<T>> &
  Partial<Pick<T, DefaultedContentKeys<T>>>;
export type RecordPatch<T extends StoredRecord> = Partial<NewRecord<T>>;

export interface ListFilters {
  category?: string;
  tag?: string;
  season?: string;
  organizationId?: string;
  standingActivity?: boolean;
  status?: string;
  scopeType?: string;
  scopeId?: string;
  query?: string;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditLogQuery extends PageRequest {
  actorUid?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string;
  to?: string;
}

export interface RecordRepository<T extends StoredRecord> {
  create(input: NewRecord<T>): Promise<T>;
  get(id: string): Promise<T | null>;
  getForUpdate(id: string): Promise<T | null>;
  listForUpdate(filters?: ListFilters): Promise<T[]>;
  list(filters?: ListFilters): Promise<T[]>;
  page(filters: ListFilters | undefined, request: PageRequest): Promise<Page<T>>;
  update(id: string, patch: RecordPatch<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

export interface ScopedRecordAccess {
  all: boolean;
  ids: string[];
  deniedIds: string[];
}

export interface LiaisonProblemVisibility {
  actorUid: string;
  publicStatuses: LiaisonProblemStatus[];
  read: ScopedRecordAccess;
  maintain: ScopedRecordAccess;
  review: ScopedRecordAccess;
}

export interface LiaisonProblemRepository extends RecordRepository<LiaisonProblemRecord> {
  pageVisible(
    filters: ListFilters | undefined,
    request: PageRequest,
    visibility: LiaisonProblemVisibility,
  ): Promise<Page<LiaisonProblemRecord>>;
}

export interface LiaisonTeamRepository extends RecordRepository<LiaisonTeamRecord> {
  countActiveByProblemIds(problemIds: readonly string[]): Promise<Record<string, number>>;
}

export interface SubjectRecord extends StoredRecord {
  uid: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DevelopmentAccessRecord extends StoredRecord {
  subjectUid: string | null;
  studentId: string | null;
  username: string | null;
  accessLevel: 'member' | 'lead';
}

export interface RoleRecord extends StoredRecord {
  key: RoleKey;
  name: string;
}

export interface PermissionRecord extends StoredRecord {
  action: PermissionAction;
  resource: string;
}

export interface RolePermissionRecord extends StoredRecord {
  roleKey: RoleKey;
  action: PermissionAction;
  resource: string;
  effect: 'allow' | 'deny';
}

export interface RoleAssignmentRecord extends StoredRecord {
  subjectUid: string;
  roleKey: RoleKey;
  expiresAt: string | null;
}

export interface TagDefinitionRecord extends StoredRecord {
  key: string;
  name: string;
  description: string;
  requiredScopeType: string | null;
  metadata: Record<string, unknown>;
}

export interface TagAssignmentRecord extends StoredRecord {
  subjectUid: string;
  tagKey: string;
  expiresAt: string | null;
}

export interface TagPermissionRecord extends StoredRecord {
  tagKey: string;
  action: PermissionAction;
  resource: string;
  effect: 'allow' | 'deny';
}

export interface ModuleRecord extends StoredRecord {
  moduleId: ModuleId;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ModuleOwnerRecord extends StoredRecord {
  moduleId: ModuleId;
  ownerType: 'role' | 'subject' | 'team';
  ownerId: string;
}

export interface AuditLogRecord extends StoredRecord {
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
}

export interface KnowledgeEntryRecord extends StoredRecord {
  category: string;
  tags: string[];
  summary: string;
  maintainedAt: string | null;
  maintainerUid: string | null;
  type: 'workflow' | 'faq' | 'contact' | 'retrospective' | 'notice';
  title: string;
  body: string;
  audience?: 'general' | 'social_org';
  organizationId?: SocialOrganizationId | null;
}

export interface AnnouncementRecord extends StoredRecord {
  title: string;
  body: string;
  pinned?: boolean;
}

export interface ConsultationRecord extends StoredRecord {
  dueAt: string | null;
  title: string;
  body: string;
  visibility?: 'public' | 'private';
  requesterUid: string;
  assigneeUid: string | null;
  reply: string | null;
}

export interface InformationReplyRecord extends StoredRecord {
  targetType: 'announcement' | 'consultation';
  targetId: string;
  authorUid: string;
  kind: 'reply' | 'supplement';
  body: string;
}

export interface InformationLikeRecord extends StoredRecord {
  targetType: 'announcement' | 'consultation';
  targetId: string;
  userUid: string;
}

export interface ProposalRecord extends StoredRecord {
  dueAt: string | null;
  title: string;
  problemDescription: string;
  proposedSolution: string;
  category: string;
  submitterUid: string;
  assigneeUid: string | null;
  publicProgress: string;
  internalNote: string;
}

export type TechnicalSupportStatus = 'not_requested' | 'requested' | 'confirmed';

export interface ClubRecord extends StoredRecord {
  category: string;
  contactName: string;
  publicContact: string;
  name: string;
  description: string;
  organizationId?: SocialOrganizationId | null;
  technicalSupportStatus: TechnicalSupportStatus;
  technicalSupportNote: string | null;
}

export interface ClubMembershipRecord extends StoredRecord {
  clubId: string;
  memberUid: string;
}

export interface ActivityRecord extends StoredRecord {
  registrationDeadline: string | null;
  capacity: number | null;
  contact: string;
  title: string;
  description: string;
  clubId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  location?: string;
  organizationId?: SocialOrganizationId | null;
  standingActivity?: boolean;
  technicalSupportStatus: TechnicalSupportStatus;
  technicalSupportNote: string | null;
}

export interface ActivityMilestoneRecord extends StoredRecord {
  activityId: string;
  occursAt: string;
  title: string;
  type: string;
  description: string;
  completed: boolean;
  displayOrder: number;
}

export interface CompetitionFixtureRecord extends StoredRecord {
  activityId: string;
  round: string;
  participantA: string;
  participantB: string;
  scheduledAt: string;
  location: string;
  score: string | null;
}

export interface ActivityRegistrationRecord extends StoredRecord {
  activityId: string;
  participantUid: string;
}

export interface FestivalSubmissionRecord extends StoredRecord {
  title: string;
  description: string;
  authorName: string;
  status: FestivalSubmissionStatus;
  displayConsent: boolean;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  reviewerUid: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}

export interface SportsTeamRecord extends StoredRecord {
  season: string;
  trainingSchedule: string;
  name: string;
  description: string;
}

export interface SportsTeamMemberRecord extends StoredRecord {
  teamId: string;
  memberUid: string;
}

export interface SportsCheckinRecord extends StoredRecord {
  teamId: string;
  memberUid: string;
  checkinDate: string;
}

export interface SportsMatchRecord extends StoredRecord {
  title: string;
  coverUrl: string | null;
  startsAt: string;
  endsAt: string;
  location: string;
  result: string | null;
  liveUrl: string | null;
  replayUrl: string | null;
}

export interface SportsTeamShowcaseRecord extends StoredRecord {
  teamId: string;
  markdown: string;
  updatedByUid: string;
}

export interface LiaisonResourceRecord extends StoredRecord {
  name: string;
  description: string;
  category: string;
  visibility: 'public' | 'organization' | 'restricted';
}

export type LiaisonProblemStatus =
  'draft' | 'pending_review' | 'rejected' | 'open' | 'paused' | 'closed' | 'archived';

export interface LiaisonProblemRecord extends StoredRecord {
  status: LiaisonProblemStatus;
  title: string;
  summary: string;
  background: string;
  sourceType: 'lab' | 'company' | 'campus' | 'other';
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  internalContactNote: string;
  recorderUid: string;
  reviewerUid: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface LiaisonTeamRecord extends StoredRecord {
  problemId: string;
  name: string;
  proposal: string;
  maintainerUid: string;
}

export interface LiaisonTeamMemberRecord extends StoredRecord {
  problemId: string;
  teamId: string;
  memberUid: string;
  role: 'maintainer' | 'member';
  joinedAt: string;
}

export interface LiaisonPostRecord extends StoredRecord {
  problemId: string;
  teamId: string | null;
  authorUid: string;
  kind: 'discussion' | 'progress';
  body: string;
  hiddenAt: string | null;
  hiddenByUid: string | null;
}

export interface LiaisonOutcomeRecord extends StoredRecord {
  problemId: string;
  teamId: string;
  version: number;
  title: string;
  description: string;
  linkUrl: string | null;
  attachmentRef: string | null;
  submittedAt: string;
  adoptedAt: string | null;
  adoptedByUid: string | null;
}

export interface FinanceRecord extends StoredRecord {
  title: string;
  kind: 'budget' | 'settlement';
  amountCents: number;
  activityId?: string | null;
  organizationId?: SocialOrganizationId | null;
  reviewerUid?: string | null;
  reviewedAt?: string | null;
  reviewDecision?: 'approved' | 'rejected' | null;
}

export interface DevelopmentStore {
  transaction<T>(operation: (store: DevelopmentStore) => Promise<T>): Promise<T>;
  queryAuditLogs(query: AuditLogQuery): Promise<Page<AuditLogRecord>>;
  subjects: RecordRepository<SubjectRecord>;
  developmentAccess: RecordRepository<DevelopmentAccessRecord>;
  roles: RecordRepository<RoleRecord>;
  permissions: RecordRepository<PermissionRecord>;
  rolePermissions: RecordRepository<RolePermissionRecord>;
  roleAssignments: RecordRepository<RoleAssignmentRecord>;
  tagDefinitions: RecordRepository<TagDefinitionRecord>;
  tagAssignments: RecordRepository<TagAssignmentRecord>;
  tagPermissions: RecordRepository<TagPermissionRecord>;
  modules: RecordRepository<ModuleRecord>;
  moduleOwners: RecordRepository<ModuleOwnerRecord>;
  auditLogs: RecordRepository<AuditLogRecord>;
  knowledge: RecordRepository<KnowledgeEntryRecord>;
  announcements: RecordRepository<AnnouncementRecord>;
  consultations: RecordRepository<ConsultationRecord>;
  informationReplies: RecordRepository<InformationReplyRecord>;
  informationLikes: RecordRepository<InformationLikeRecord>;
  proposals: RecordRepository<ProposalRecord>;
  clubs: RecordRepository<ClubRecord>;
  clubMemberships: RecordRepository<ClubMembershipRecord>;
  activities: RecordRepository<ActivityRecord>;
  activityMilestones: RecordRepository<ActivityMilestoneRecord>;
  competitionFixtures: RecordRepository<CompetitionFixtureRecord>;
  activityRegistrations: RecordRepository<ActivityRegistrationRecord>;
  festivalSubmissions: RecordRepository<FestivalSubmissionRecord>;
  sportsTeams: RecordRepository<SportsTeamRecord>;
  sportsTeamMembers: RecordRepository<SportsTeamMemberRecord>;
  sportsCheckins: RecordRepository<SportsCheckinRecord>;
  sportsMatches: RecordRepository<SportsMatchRecord>;
  sportsTeamShowcases: RecordRepository<SportsTeamShowcaseRecord>;
  liaisonResources: RecordRepository<LiaisonResourceRecord>;
  liaisonProblems: LiaisonProblemRepository;
  liaisonTeams: LiaisonTeamRepository;
  liaisonTeamMembers: RecordRepository<LiaisonTeamMemberRecord>;
  liaisonPosts: RecordRepository<LiaisonPostRecord>;
  liaisonOutcomes: RecordRepository<LiaisonOutcomeRecord>;
  financeRecords: RecordRepository<FinanceRecord>;
}
