import { randomUUID } from 'node:crypto';
import { DEMO_CENTER_USERS, organizationById } from '@freebbs-development/contracts';

import { queryMemoryAuditLogs } from './audit-query.js';
import { encodeDateOnly, encodeUtcDateTime } from './date-codec.js';
import {
  BUILT_IN_PERMISSIONS,
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_TAG_DEFINITIONS,
  BUILT_IN_TAG_PERMISSIONS,
} from '../bootstrap/built-in-definitions.js';
import { RecordConflictError } from './record-conflict-error.js';

import type {
  ActivityRecord,
  ActivityRegistrationRecord,
  ActivityMilestoneRecord,
  CompetitionFixtureRecord,
  ProposalRecord,
  AnnouncementRecord,
  AuditLogRecord,
  ClubMembershipRecord,
  ClubRecord,
  CollectionFormRecord,
  CollectionResponseRecord,
  CollectionVersionRecord,
  ConsultationRecord,
  InformationLikeRecord,
  InformationReplyRecord,
  DevelopmentStore,
  DevelopmentAccessRecord,
  FinanceRecord,
  FestivalSubmissionRecord,
  KnowledgeEntryRecord,
  LiaisonOutcomeRecord,
  LiaisonPostRecord,
  LiaisonProblemRecord,
  LiaisonProblemVisibility,
  LiaisonResourceRecord,
  LiaisonTeamMemberRecord,
  LiaisonTeamRecord,
  ListFilters,
  ModuleOwnerRecord,
  ModuleRecord,
  NewRecord,
  Page,
  PageRequest,
  PermissionRecord,
  RecordPatch,
  RecordRepository,
  RoleAssignmentRecord,
  RolePermissionRecord,
  RoleRecord,
  SportsCheckinRecord,
  SportsMatchRecord,
  SportsTeamShowcaseRecord,
  SportsTeamMemberRecord,
  SportsTeamRecord,
  ShowcaseArticleRecord,
  ShowcaseLikeRecord,
  StoredRecord,
  SubjectRecord,
  TagAssignmentRecord,
  TagDefinitionRecord,
  TagPermissionRecord,
} from './types.js';

interface MemoryState {
  subjects: SubjectRecord[];
  developmentAccess: DevelopmentAccessRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  roleAssignments: RoleAssignmentRecord[];
  tagDefinitions: TagDefinitionRecord[];
  tagAssignments: TagAssignmentRecord[];
  tagPermissions: TagPermissionRecord[];
  modules: ModuleRecord[];
  moduleOwners: ModuleOwnerRecord[];
  auditLogs: AuditLogRecord[];
  knowledge: KnowledgeEntryRecord[];
  announcements: AnnouncementRecord[];
  consultations: ConsultationRecord[];
  informationReplies: InformationReplyRecord[];
  informationLikes: InformationLikeRecord[];
  proposals: ProposalRecord[];
  clubs: ClubRecord[];
  clubMemberships: ClubMembershipRecord[];
  activities: ActivityRecord[];
  activityMilestones: ActivityMilestoneRecord[];
  competitionFixtures: CompetitionFixtureRecord[];
  activityRegistrations: ActivityRegistrationRecord[];
  collectionForms: CollectionFormRecord[];
  collectionVersions: CollectionVersionRecord[];
  collectionResponses: CollectionResponseRecord[];
  showcaseArticles: ShowcaseArticleRecord[];
  showcaseLikes: ShowcaseLikeRecord[];
  festivalSubmissions: FestivalSubmissionRecord[];
  sportsTeams: SportsTeamRecord[];
  sportsTeamMembers: SportsTeamMemberRecord[];
  sportsCheckins: SportsCheckinRecord[];
  sportsMatches: SportsMatchRecord[];
  sportsTeamShowcases: SportsTeamShowcaseRecord[];
  liaisonResources: LiaisonResourceRecord[];
  liaisonProblems: LiaisonProblemRecord[];
  liaisonTeams: LiaisonTeamRecord[];
  liaisonTeamMembers: LiaisonTeamMemberRecord[];
  liaisonPosts: LiaisonPostRecord[];
  liaisonOutcomes: LiaisonOutcomeRecord[];
  financeRecords: FinanceRecord[];
}

type CollectionName = keyof MemoryState;
interface StateHolder {
  current: MemoryState;
  transactionTail: Promise<void>;
}

function missingReferenceError(message: string): Error {
  return Object.assign(new Error(message), {
    code: 'ER_NO_REFERENCED_ROW_2',
    errno: 1452,
  });
}

function referencedRowError(message: string): Error {
  return Object.assign(new Error(message), {
    code: 'ER_ROW_IS_REFERENCED_2',
    errno: 1451,
  });
}

async function withWriteLock<T>(holder: StateHolder, operation: () => Promise<T>): Promise<T> {
  const previous = holder.transactionTail;
  let release: () => void = () => {};
  holder.transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

const searchFields: Record<CollectionName, string[]> = {
  subjects: ['uid', 'displayName'],
  developmentAccess: ['subjectUid', 'studentId', 'username'],
  roles: ['key', 'name'],
  permissions: ['action', 'resource'],
  rolePermissions: ['roleKey', 'action', 'resource'],
  roleAssignments: ['subjectUid', 'roleKey'],
  tagDefinitions: ['key', 'name', 'description'],
  tagAssignments: ['subjectUid', 'tagKey'],
  tagPermissions: ['tagKey', 'action', 'resource'],
  modules: ['moduleId', 'name', 'description'],
  moduleOwners: ['moduleId', 'ownerType', 'ownerId'],
  auditLogs: ['actorUid', 'action', 'resourceType', 'resourceId'],
  knowledge: ['title', 'body', 'category', 'summary'],
  announcements: ['title', 'body'],
  consultations: ['title', 'body', 'requesterUid', 'assigneeUid', 'reply'],
  informationReplies: ['targetType', 'targetId', 'authorUid', 'body'],
  informationLikes: ['targetType', 'targetId', 'userUid'],
  proposals: ['title', 'problemDescription', 'proposedSolution', 'category', 'submitterUid'],
  clubs: [
    'name',
    'description',
    'technicalSupportNote',
    'category',
    'contactName',
    'publicContact',
  ],
  clubMemberships: ['clubId', 'memberUid'],
  activities: ['title', 'description', 'technicalSupportNote', 'location', 'contact'],
  activityMilestones: ['activityId', 'title', 'type', 'description'],
  competitionFixtures: ['activityId', 'round', 'participantA', 'participantB', 'location'],
  activityRegistrations: ['activityId', 'participantUid'],
  collectionForms: ['title', 'description', 'organizationId'],
  collectionVersions: ['formId'],
  collectionResponses: ['formId', 'versionId', 'respondentUid'],
  showcaseArticles: ['title', 'excerpt', 'body', 'organizationId'],
  showcaseLikes: ['articleId', 'userUid'],
  festivalSubmissions: ['title', 'description', 'authorName'],
  sportsTeams: ['name', 'description', 'season', 'trainingSchedule'],
  sportsTeamMembers: ['teamId', 'memberUid'],
  sportsCheckins: ['teamId', 'memberUid'],
  sportsMatches: ['title', 'location'],
  sportsTeamShowcases: ['teamId', 'markdown', 'updatedByUid'],
  liaisonResources: ['name', 'description', 'category'],
  liaisonProblems: [
    'title',
    'summary',
    'background',
    'sourceName',
    'expectedOutcome',
    'constraints',
    'publicContact',
  ],
  liaisonTeams: ['problemId', 'name', 'proposal', 'maintainerUid'],
  liaisonTeamMembers: ['problemId', 'teamId', 'memberUid'],
  liaisonPosts: ['problemId', 'teamId', 'authorUid', 'body'],
  liaisonOutcomes: ['problemId', 'teamId', 'title', 'description', 'linkUrl'],
  financeRecords: ['title', 'kind'],
};

function collectionDefaults(collection: CollectionName): Record<string, unknown> {
  switch (collection) {
    case 'festivalSubmissions':
      return { reviewerUid: null, reviewedAt: null, reviewNote: '' };
    case 'knowledge':
      return {
        audience: 'general',
        organizationId: null,
        category: 'general',
        tags: [],
        summary: '',
        maintainedAt: null,
        maintainerUid: null,
      };
    case 'consultations':
    case 'proposals':
      return { dueAt: null };
    case 'sportsTeams':
      return { season: '', trainingSchedule: '' };
    case 'clubs':
      return { organizationId: null, category: 'general', contactName: '', publicContact: '' };
    case 'activities':
      return {
        registrationDeadline: null,
        capacity: null,
        contact: '',
        endsAt: null,
        location: '',
        organizationId: null,
        standingActivity: false,
      };
    case 'liaisonProblems':
      return {
        summary: '',
        tags: [],
        startsAt: null,
        deadline: null,
        publicContact: '',
        reviewerUid: null,
        reviewedAt: null,
        reviewNote: null,
      };
    case 'liaisonPosts':
      return { teamId: null, hiddenAt: null, hiddenByUid: null };
    case 'liaisonOutcomes':
      return { linkUrl: null, attachmentRef: null, adoptedAt: null, adoptedByUid: null };
    case 'financeRecords':
      return {
        organizationId: null,
        reviewerUid: null,
        reviewedAt: null,
        reviewDecision: null,
      };
    default:
      return {};
  }
}

function normalizedValues<T extends object>(value: T): T {
  const result = structuredClone(value) as Record<string, unknown>;
  // Undefined means omitted, not a request to erase defaults or existing values.
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) delete result[key];
  }
  for (const key of [
    'expiresAt',
    'startsAt',
    'endsAt',
    'occursAt',
    'scheduledAt',
    'reviewedAt',
    'maintainedAt',
    'dueAt',
    'registrationDeadline',
    'deadline',
    'joinedAt',
    'submittedAt',
    'adoptedAt',
    'hiddenAt',
  ]) {
    if (!Object.hasOwn(result, key) || result[key] === null || result[key] === undefined) continue;
    const encoded = encodeUtcDateTime(result[key] as string);
    result[key] = encoded?.toISOString() ?? null;
  }
  if (typeof result.checkinDate === 'string')
    result.checkinDate = encodeDateOnly(result.checkinDate);
  if (
    Object.hasOwn(result, 'sizeBytes') &&
    (!Number.isSafeInteger(result.sizeBytes) || (result.sizeBytes as number) < 1)
  ) {
    throw new TypeError('sizeBytes must be a positive safe integer');
  }
  if (
    typeof result.amountCents === 'number' &&
    (!Number.isSafeInteger(result.amountCents) || result.amountCents < 0)
  ) {
    throw new TypeError('amountCents must be a non-negative safe integer');
  }
  if (
    Object.hasOwn(result, 'version') &&
    (!Number.isSafeInteger(result.version) || (result.version as number) < 1)
  ) {
    throw new TypeError('version must be a positive safe integer');
  }
  return result as T;
}
const publicScope = { type: 'public', id: '*' } as const;
const seedTime = '2026-07-22T00:00:00.000Z';

function stored<T extends StoredRecord>(
  id: string,
  input: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
): T {
  return { id, createdAt: seedTime, updatedAt: seedTime, ...input } as T;
}

function createEmptyState(): MemoryState {
  return {
    subjects: [],
    developmentAccess: [],
    roles: [],
    permissions: [],
    rolePermissions: [],
    roleAssignments: [],
    tagDefinitions: [],
    tagAssignments: [],
    tagPermissions: [],
    modules: [],
    moduleOwners: [],
    auditLogs: [],
    knowledge: [],
    announcements: [],
    consultations: [],
    informationReplies: [],
    informationLikes: [],
    proposals: [],
    clubs: [],
    clubMemberships: [],
    activities: [],
    activityMilestones: [],
    competitionFixtures: [],
    activityRegistrations: [],
    collectionForms: [],
    collectionVersions: [],
    collectionResponses: [],
    showcaseArticles: [],
    showcaseLikes: [],
    festivalSubmissions: [],
    sportsTeams: [],
    sportsMatches: [],
    sportsTeamShowcases: [],
    sportsTeamMembers: [],
    sportsCheckins: [],
    liaisonResources: [],
    liaisonProblems: [],
    liaisonTeams: [],
    liaisonTeamMembers: [],
    liaisonPosts: [],
    liaisonOutcomes: [],
    financeRecords: [],
  };
}

function createDemoState(): MemoryState {
  const state = createEmptyState();
  state.subjects = [
    stored('subject-admin', {
      uid: 'demo-admin',
      displayName: '发展端管理员',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-student', {
      uid: 'demo-student',
      displayName: '普通同学',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-rights-member', {
      uid: 'demo-rights-member',
      displayName: '权益发展中心部员',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-liaison-member', {
      uid: 'demo-liaison-member',
      displayName: '联络中心部员',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-sports', {
      uid: 'demo-sports-lead',
      displayName: '体育负责人',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-sports-director', {
      uid: 'demo-sports-director',
      displayName: '体育中心部长',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-captain', {
      uid: 'demo-captain',
      displayName: '篮球队队长',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('subject-tuanwei-lead', {
      uid: 'demo-tuanwei-lead',
      displayName: '团委负责人',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.roles = BUILT_IN_ROLES.map((definition, index) =>
    stored<RoleRecord>(`role-governance-${index}`, {
      ...definition,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  );
  state.permissions = BUILT_IN_PERMISSIONS.map((definition, index) =>
    stored<PermissionRecord>(`permission-governance-${index}`, {
      ...definition,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  );
  state.rolePermissions = BUILT_IN_ROLE_PERMISSIONS.map((definition, index) =>
    stored<RolePermissionRecord>(`role-permission-governance-${index}`, {
      ...definition,
      status: 'active',
      ownerUid: 'demo-admin',
    }),
  );
  state.roleAssignments = [
    stored('assignment-admin', {
      subjectUid: 'demo-admin',
      roleKey: 'platform.super_admin',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('assignment-rights-member', {
      subjectUid: 'demo-rights-member',
      roleKey: 'department.rights_development_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('assignment-liaison-member', {
      subjectUid: 'demo-liaison-member',
      roleKey: 'department.liaison_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('assignment-sports-lead', {
      subjectUid: 'demo-sports-lead',
      roleKey: 'domain.sports_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('assignment-sports-director', {
      subjectUid: 'demo-sports-director',
      roleKey: 'department.sports_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('assignment-tuanwei-lead', {
      subjectUid: 'demo-tuanwei-lead',
      roleKey: 'affiliation.tuanwei_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.tagDefinitions = [
    stored('tag-captain-definition', {
      key: 'sports.team_captain',
      requiredScopeType: 'sports_team',
      metadata: { resourceTypes: ['sports_team'] },
      name: '体育代表队队长',
      description: '仅在绑定代表队内生效。',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('tag-extension-definition', {
      key: 'extension.custom',
      requiredScopeType: null,
      metadata: { resourceTypes: [] },
      name: '扩展权限标签',
      description: '为后续模块保留的标签接口。',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    ...BUILT_IN_TAG_DEFINITIONS.filter(({ key }) => key !== 'sports.team_captain').map(
      (definition, index) =>
        stored<TagDefinitionRecord>(`tag-organization-${index}`, {
          ...definition,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        }),
    ),
  ];
  state.tagAssignments = [
    stored('tag-captain-a', {
      subjectUid: 'demo-captain',
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
    stored('tag-rights-organization', {
      subjectUid: 'demo-rights-member',
      tagKey: 'social_org.rights_development_center',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'social_organization', id: 'rights_development_center' },
    }),
    stored('tag-liaison-organization', {
      subjectUid: 'demo-liaison-member',
      tagKey: 'social_org.liaison_center',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'social_organization', id: 'liaison_center' },
    }),
    stored('tag-sports-lead-organization', {
      subjectUid: 'demo-sports-lead',
      tagKey: 'social_org.sports_center',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'social_organization', id: 'sports_center' },
    }),
    stored('tag-sports-director-organization', {
      subjectUid: 'demo-sports-director',
      tagKey: 'social_org.sports_center',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'social_organization', id: 'sports_center' },
    }),
    stored('tag-tuanwei-organization', {
      subjectUid: 'demo-tuanwei-lead',
      tagKey: 'social_org.tuanwei',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'social_organization', id: 'tuanwei' },
    }),
  ];
  for (const profile of DEMO_CENTER_USERS) {
    const suffix = profile.uid.slice('demo-'.length);
    const existing = state.subjects.find(({ uid }) => uid === profile.uid);
    if (existing) existing.displayName = profile.displayName;
    else
      state.subjects.push(
        stored(`subject-${suffix}`, {
          uid: profile.uid,
          displayName: profile.displayName,
          avatarUrl: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        }),
      );
    if (
      !state.roleAssignments.some(
        ({ subjectUid, roleKey }) => subjectUid === profile.uid && roleKey === profile.role,
      )
    ) {
      state.roleAssignments.push(
        stored(`assignment-${suffix}`, {
          subjectUid: profile.uid,
          roleKey: profile.role,
          expiresAt: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        }),
      );
    }
    const organization = organizationById(profile.organizationId);
    if (
      !state.tagAssignments.some(
        ({ subjectUid, tagKey }) => subjectUid === profile.uid && tagKey === organization.tagKey,
      )
    ) {
      state.tagAssignments.push(
        stored(`tag-${suffix}-organization`, {
          subjectUid: profile.uid,
          tagKey: organization.tagKey,
          expiresAt: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: { type: 'social_organization', id: profile.organizationId },
        }),
      );
    }
  }
  state.tagPermissions = BUILT_IN_TAG_PERMISSIONS.map((definition, index) =>
    stored<TagPermissionRecord>(`tag-permission-governance-${index}`, {
      ...definition,
      status: 'active',
      ownerUid: 'demo-admin',
    }),
  );

  const moduleNames: Array<[ModuleRecord['moduleId'], string]> = [
    ['dashboard', '工作台'],
    ['knowledge', '经验库'],
    ['information', '信息与咨询'],
    ['clubs', '趣缘群体'],
    ['growth', '个人成长档案'],
    ['events', '活动'],
    ['liaison', '联络资源'],
    ['sports', '体育代表队'],
    ['finance', '财务治理'],
    ['admin', '权限与模块管理'],
  ];
  state.modules = moduleNames.map(([moduleId, name]) =>
    stored(`module-${moduleId}`, {
      moduleId,
      name,
      description: `${name}模块`,
      enabled: true,
      status: 'enabled',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  );

  state.knowledge = [
    stored('knowledge-workflow', {
      category: '活动指南',
      tags: ['十月预告', '活动流程'],
      summary: '十月活动立项、审批和复盘速查。',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
      type: 'workflow',
      title: '活动立项与复盘流程',
      body: '从立项、审批到复盘的标准步骤。',
      audience: 'general',
      organizationId: null,
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('knowledge-faq', {
      category: '部门交接',
      tags: ['十月预告', '交接'],
      summary: '秋季部门账号、资料与联系人交接说明。',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
      type: 'faq',
      title: '部门交接常见问题',
      body: '集中说明账号、资料和联系人交接。',
      audience: 'general',
      organizationId: null,
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('knowledge-sports-handover', {
      category: '代表队管理',
      tags: ['十月预告', '代表队'],
      summary: '秋季代表队训练、招募和赛事交接清单。',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-sports-lead',
      type: 'workflow',
      title: '体育中心代表队交接清单',
      body: '整理代表队联系人、训练安排、报名节点、常见问题与年度复盘。',
      audience: 'social_org',
      organizationId: 'sports_center',
      status: 'published',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'social_organization', id: 'sports_center' },
    }),
  ];
  state.announcements = [
    stored('announcement-club', {
      title: '秋季趣缘群体招新开放',
      body: '欢迎同学浏览并加入感兴趣的趣缘群体。',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('announcement-consultation', {
      title: '权益咨询窗口更新时间',
      body: '工作日咨询将在两个工作日内完成分流。',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.consultations = [
    stored('consultation-venue', {
      dueAt: '2026-10-08T10:00:00.000Z',
      title: '活动场地申请',
      body: '请问教学楼公共空间如何申请？',
      requesterUid: 'demo-student',
      assigneeUid: 'demo-admin',
      reply: '请填写场地预约表并等待管理员确认。',
      status: 'in_progress',
      ownerUid: 'demo-student',
      scope: publicScope,
    }),
    stored('consultation-rights', {
      dueAt: '2026-10-10T10:00:00.000Z',
      title: '校园权益建议',
      body: '希望延长公共讨论空间开放时间。',
      requesterUid: 'demo-student',
      assigneeUid: 'demo-admin',
      reply: null,
      status: 'in_progress',
      ownerUid: 'demo-student',
      scope: publicScope,
    }),
  ];
  state.proposals = [
    stored('proposal-night-lighting', {
      dueAt: '2026-10-15T10:00:00.000Z',
      title: '校园夜间照明优化',
      problemDescription: '部分公共活动区域夜间照明不足，影响同学通行与活动。',
      proposedSolution: '梳理重点点位并与相关部门共同推进照明巡检和补充。',
      category: '校园空间',
      submitterUid: 'demo-student',
      assigneeUid: 'demo-rights-member',
      publicProgress: '已收集首批点位，正在核实现场情况。',
      internalNote: '下一步联系物业与相关场馆负责人。',
      status: 'reviewing',
      ownerUid: 'demo-student',
      scope: publicScope,
    }),
  ];
  state.clubs = [
    stored('club-music', {
      category: '文艺交流',
      contactName: '音乐俱乐部联络员',
      publicContact: '每周五学生活动中心排练室',
      name: '校园音乐俱乐部',
      description: '排练、分享与小型演出。',
      organizationId: 'liaison_center',
      technicalSupportStatus: 'requested',
      technicalSupportNote: '需要演出音响调试支持。',
      status: 'active',
      ownerUid: 'demo-liaison-member',
      scope: publicScope,
    }),
    stored('club-running', {
      category: '体育户外',
      contactName: '跑团联络员',
      publicContact: '每周三东大操场集合点',
      name: '自由跑团',
      description: '每周轻松跑与训练交流。',
      organizationId: 'liaison_center',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: publicScope,
    }),
  ];
  state.clubMemberships = [
    stored('membership-music', {
      clubId: 'club-music',
      memberUid: 'demo-student',
      status: 'active',
      ownerUid: 'demo-student',
      scope: { type: 'club', id: 'club-music' },
    }),
    stored('membership-running', {
      clubId: 'club-running',
      memberUid: 'demo-captain',
      status: 'active',
      ownerUid: 'demo-captain',
      scope: { type: 'club', id: 'club-running' },
    }),
  ];
  state.activities = [
    stored('activity-orientation', {
      registrationDeadline: '2026-09-04T10:00:00.000Z',
      capacity: 120,
      contact: '联络中心活动咨询台',
      title: '新生社群见面会',
      description: '一次认识各趣缘群体的开放活动。',
      clubId: null,
      startsAt: '2026-09-05T10:00:00.000Z',
      endsAt: '2026-09-05T12:00:00.000Z',
      location: '中央主楼大厅',
      organizationId: 'liaison_center',
      standingActivity: false,
      technicalSupportStatus: 'requested',
      technicalSupportNote: '需要现场网络与投影支持。',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('activity-night-run', {
      registrationDeadline: '2026-09-11T10:00:00.000Z',
      capacity: 60,
      contact: '跑团联络员（东大操场集合点）',
      title: '校园夜跑',
      description: '五公里轻松跑。',
      clubId: 'club-running',
      startsAt: '2026-09-12T19:00:00.000Z',
      endsAt: '2026-09-12T21:00:00.000Z',
      location: '东大操场',
      organizationId: 'sports_center',
      standingActivity: false,
      technicalSupportStatus: 'confirmed',
      technicalSupportNote: '路线签到设备已确认。',
      status: 'published',
      ownerUid: 'demo-sports-lead',
      scope: publicScope,
    }),
    stored('activity-ma-john-cup', {
      registrationDeadline: '2026-10-08T10:00:00.000Z',
      capacity: 240,
      contact: '体育中心赛事咨询台',
      title: '马约翰杯',
      description: '学院代表队参加的常设综合体育赛事，集中展示赛程与比赛进展。',
      clubId: null,
      startsAt: '2026-10-10T08:00:00.000Z',
      endsAt: '2026-11-15T10:00:00.000Z',
      location: '清华大学各体育场馆',
      organizationId: 'sports_center',
      standingActivity: true,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'published',
      ownerUid: 'demo-sports-lead',
      scope: publicScope,
    }),
  ];
  state.activityMilestones = [
    stored('milestone-ma-host', {
      activityId: 'activity-ma-john-cup',
      occursAt: '2026-09-01T10:00:00.000Z',
      title: '主持人推送',
      type: 'promotion',
      description: '发布主持人和赛事志愿者招募信息。',
      completed: true,
      displayOrder: 1,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-ma-john-cup' },
    }),
    stored('milestone-ma-registration', {
      activityId: 'activity-ma-john-cup',
      occursAt: '2026-09-10T10:00:00.000Z',
      title: '队员招募推送',
      type: 'registration',
      description: '各代表队开放报名与选拔。',
      completed: true,
      displayOrder: 2,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-ma-john-cup' },
    }),
    stored('milestone-ma-preliminary', {
      activityId: 'activity-ma-john-cup',
      occursAt: '2026-10-10T08:00:00.000Z',
      title: '初赛',
      type: 'competition',
      description: '各项目初赛与小组赛开始。',
      completed: false,
      displayOrder: 3,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-ma-john-cup' },
    }),
    stored('milestone-ma-final', {
      activityId: 'activity-ma-john-cup',
      occursAt: '2026-11-15T08:00:00.000Z',
      title: '决赛',
      type: 'competition',
      description: '决赛日与闭幕总结。',
      completed: false,
      displayOrder: 4,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-ma-john-cup' },
    }),
  ];
  state.competitionFixtures = [
    stored('fixture-ma-group-1', {
      activityId: 'activity-ma-john-cup',
      round: '小组赛',
      participantA: '电子系',
      participantB: '自动化系',
      scheduledAt: '2026-10-10T11:00:00.000Z',
      location: '东大操场',
      score: null,
      status: 'scheduled',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-ma-john-cup' },
    }),
  ];
  state.activityRegistrations = [
    stored('registration-orientation', {
      activityId: 'activity-orientation',
      participantUid: 'demo-student',
      status: 'registered',
      ownerUid: 'demo-student',
      scope: { type: 'activity', id: 'activity-orientation' },
    }),
    stored('registration-night-run', {
      activityId: 'activity-night-run',
      participantUid: 'demo-captain',
      status: 'registered',
      ownerUid: 'demo-captain',
      scope: { type: 'activity', id: 'activity-night-run' },
    }),
  ];
  state.collectionForms = [
    stored('collection-autumn-workshop', {
      title: '秋季工作坊许愿池',
      description: '告诉我们你最想参加的工作坊，让下一场活动从大家的想法开始。',
      coverUrl: null,
      organizationId: 'tuanwei',
      currentDraftVersionId: 'collection-version-workshop-1',
      publishedVersionId: 'collection-version-workshop-1',
      opensAt: '2026-09-20T00:00:00.000Z',
      closesAt: '2026-10-20T15:59:59.000Z',
      capacity: 300,
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('collection-media-showcase', {
      title: '镜头里的校园生活',
      description: '投稿一张照片或一段短片，记录你眼中的校园日常。',
      coverUrl: null,
      organizationId: null,
      currentDraftVersionId: 'collection-version-media-1',
      publishedVersionId: 'collection-version-media-1',
      opensAt: '2026-09-24T00:00:00.000Z',
      closesAt: '2026-11-01T15:59:59.000Z',
      capacity: null,
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.collectionVersions = [
    stored('collection-version-workshop-1', {
      formId: 'collection-autumn-workshop',
      version: 1,
      schema: {
        title: '秋季工作坊许愿池',
        description: '选出你最想参加的主题，也欢迎留下新的想法。',
        fields: [
          {
            id: 'workshop-choice',
            kind: 'multiple_choice',
            label: '想参加哪些工作坊？',
            helpText: '可以多选',
            options: ['LaTeX 排版', 'Unity 入门', '滑冰体验', '冰球体验'],
            rules: [{ id: 'required-workshop', kind: 'required', value: true }],
          },
          {
            id: 'new-idea',
            kind: 'long_text',
            label: '还有什么新想法？',
            helpText: '选填',
            options: [],
            rules: [],
          },
        ],
        formRules: [{ id: 'attempt-workshop', kind: 'attempt_limit', value: 1 }],
      },
      publishedAt: '2026-09-20T00:00:00.000Z',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('collection-version-media-1', {
      formId: 'collection-media-showcase',
      version: 1,
      schema: {
        title: '镜头里的校园生活',
        description: '上传作品和作品说明。',
        fields: [
          {
            id: 'work-title',
            kind: 'short_text',
            label: '作品标题',
            helpText: '20 字以内',
            options: [],
            rules: [{ id: 'required-title', kind: 'required', value: true }],
          },
          {
            id: 'work-file',
            kind: 'video',
            label: '视频作品',
            helpText: 'MP4 / WebM，最大 100 MiB',
            options: [],
            rules: [
              { id: 'required-file', kind: 'required', value: true },
              { id: 'video-types', kind: 'file_types', value: ['video/mp4', 'video/webm'] },
              { id: 'video-size', kind: 'file_size', value: 104857600 },
            ],
          },
        ],
        formRules: [{ id: 'attempt-media', kind: 'attempt_limit', value: 2 }],
      },
      publishedAt: '2026-09-24T00:00:00.000Z',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.collectionResponses = [
    stored('collection-response-workshop', {
      formId: 'collection-autumn-workshop',
      versionId: 'collection-version-workshop-1',
      respondentUid: 'demo-student',
      attempt: 1,
      answers: { 'workshop-choice': ['LaTeX 排版'], 'new-idea': '希望增加摄影工作坊' },
      submittedAt: '2026-09-25T08:00:00.000Z',
      status: 'submitted',
      ownerUid: 'demo-student',
      scope: publicScope,
    }),
  ];
  state.showcaseArticles = [
    stored('showcase-autumn', {
      title: '把秋天装进一张活动清单',
      excerpt: '本周的讲座、工作坊与运动体验，一次为你整理好。',
      body: '九月的最后一周，校园里仍有许多值得停下脚步的事情。我们把分散在各处的活动整理成一份轻盈的清单，希望你能找到愿意出发的一项。\n\n从一场不设门槛的工作坊开始，也可以在傍晚加入操场上的训练。报名完成后，相关记录会收进“我的报名”。',
      coverUrl: null,
      externalUrl: null,
      organizationId: null,
      publishedAt: '2026-09-25T10:00:00.000Z',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('showcase-volunteer', {
      title: '一次志愿活动如何被共同完成',
      excerpt: '从发起、招募到现场协作，看看一张表单背后的故事。',
      body: '一项顺利的志愿活动，往往始于清楚的问题和克制的信息收集。组织者只询问真正需要的内容，也让参与者随时知道下一步会发生什么。',
      coverUrl: null,
      externalUrl: null,
      organizationId: 'tuanwei',
      publishedAt: '2026-09-22T08:00:00.000Z',
      status: 'published',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
  ];
  state.showcaseLikes = [
    stored('showcase-like-autumn', {
      articleId: 'showcase-autumn',
      userUid: 'demo-student',
      status: 'active',
      ownerUid: 'demo-student',
      scope: publicScope,
    }),
  ];
  state.sportsTeams = [
    stored('team-basketball', {
      season: '2026秋季',
      trainingSchedule: '每周二、四 18:00–20:00，篮球馆',
      name: '院篮球队',
      description: '学院篮球代表队。',
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
    stored('team-badminton', {
      season: '2026秋季',
      trainingSchedule: '每周三 18:00–20:00，羽毛球馆',
      name: '院羽毛球队',
      description: '学院羽毛球代表队。',
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'team-badminton' },
    }),
  ];
  state.sportsMatches = [
    stored('ma-cup-basketball-live', {
      title: '马杯篮球小组赛 · 电院 vs 自动化',
      coverUrl: null,
      startsAt: '2026-09-22T04:00:00.000Z',
      endsAt: '2026-09-22T06:00:00.000Z',
      location: '九龙湖校区篮球馆 1 号场',
      result: '电院 72–68 自动化',
      liveUrl: 'https://example.com/ma-cup/live',
      replayUrl: null,
      status: 'active',
      ownerUid: 'demo-sports-member',
      scope: publicScope,
    }),
    stored('ma-cup-badminton-upcoming', {
      title: '马杯羽毛球团体赛',
      coverUrl: null,
      startsAt: '2026-09-22T10:30:00.000Z',
      endsAt: '2026-09-22T12:00:00.000Z',
      location: '体育馆羽毛球场',
      result: null,
      liveUrl: null,
      replayUrl: null,
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: publicScope,
    }),
  ];
  state.sportsTeamShowcases = [
    stored('showcase-basketball', {
      teamId: 'team-basketball',
      markdown:
        '# 向篮筐出发\n\n院篮球队由热爱篮球的同学组成。我们在训练中磨合，也在每一次比赛里并肩向前。\n\n> 欢迎关注我们的马杯赛程。',
      updatedByUid: 'demo-captain',
      status: 'active',
      ownerUid: 'demo-captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
  ];
  state.sportsTeamMembers = [
    stored('sports-member-basketball-captain', {
      teamId: 'team-basketball',
      memberUid: 'demo-captain',
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
    stored('sports-member-basketball-student', {
      teamId: 'team-basketball',
      memberUid: 'demo-student',
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
  ];
  state.sportsCheckins = [
    stored('checkin-basketball-1', {
      teamId: 'team-basketball',
      memberUid: 'demo-captain',
      checkinDate: '2026-07-21',
      status: 'present',
      ownerUid: 'demo-captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
    stored('checkin-basketball-2', {
      teamId: 'team-basketball',
      memberUid: 'demo-student',
      checkinDate: '2026-07-21',
      status: 'present',
      ownerUid: 'demo-captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    }),
  ];
  state.liaisonResources = [
    stored('liaison-tuanwei', {
      name: '校团委活动联络窗口',
      description: '大型活动审批与资源协调。',
      category: 'contact',
      visibility: 'public',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    }),
    stored('liaison-venue', {
      name: '公共场地预约说明',
      description: '常用场地管理部门和预约入口。',
      category: 'venue',
      visibility: 'organization',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'freebbs' },
    }),
  ];
  state.liaisonProblems = [
    stored('liaison-problem-lab-energy', {
      title: '校园能耗数据可视化',
      summary: '把匿名化能耗指标转化为同学可理解的交互展示。',
      background: '校内课题组希望验证面向校园公共空间的数据叙事方案。',
      sourceType: 'lab',
      sourceName: '校园计算实验室',
      tags: ['数据可视化', '前端', '校园治理'],
      expectedOutcome: '可运行原型、设计说明和一次公开演示。',
      constraints: '只能使用匿名化样例数据，不得上传原始敏感数据。',
      startsAt: '2026-10-01T00:00:00.000Z',
      deadline: '2026-11-15T00:00:00.000Z',
      publicContact: '联络中心公开咨询台',
      internalContactNote: '演示数据由联络中心线下转交。',
      recorderUid: 'demo-liaison-member',
      reviewerUid: 'demo-tuanwei-lead',
      reviewedAt: '2026-09-20T08:00:00.000Z',
      reviewNote: '已确认公开范围与匿名化要求。',
      status: 'open',
      ownerUid: 'demo-liaison-member',
      scope: publicScope,
    }),
    stored('liaison-problem-company-accessibility', {
      title: '公共服务页面无障碍检查工具',
      summary: '为常见校园服务页面制作轻量的可访问性检查原型。',
      background: '合作企业希望与同学共同验证前端无障碍检查流程。',
      sourceType: 'company',
      sourceName: '校企联合创新伙伴',
      tags: ['无障碍', 'Web', '工具开发'],
      expectedOutcome: '检查清单、命令行原型和示例报告。',
      constraints: '首期只分析公开页面，不采集账号或个人信息。',
      startsAt: '2026-10-10T00:00:00.000Z',
      deadline: null,
      publicContact: '联络中心公开咨询台',
      internalContactNote: '企业联系人信息由联络中心保管。',
      recorderUid: 'demo-liaison-member',
      reviewerUid: 'demo-admin',
      reviewedAt: '2026-09-22T08:00:00.000Z',
      reviewNote: '公开内容已脱敏。',
      status: 'open',
      ownerUid: 'demo-liaison-member',
      scope: publicScope,
    }),
  ];
  state.liaisonTeams = [
    stored('liaison-team-energy-story', {
      problemId: 'liaison-problem-lab-energy',
      name: '数据叙事队',
      proposal: '先建立公共指标卡片，再制作可解释的趋势视图。',
      maintainerUid: 'demo-student',
      status: 'active',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_problem', id: 'liaison-problem-lab-energy' },
    }),
    stored('liaison-team-energy-map', {
      problemId: 'liaison-problem-lab-energy',
      name: '空间可视化队',
      proposal: '使用匿名化建筑指标制作校园能耗地图原型。',
      maintainerUid: 'demo-captain',
      status: 'active',
      ownerUid: 'demo-captain',
      scope: { type: 'liaison_problem', id: 'liaison-problem-lab-energy' },
    }),
  ];
  state.liaisonTeamMembers = [
    stored('liaison-member-energy-story', {
      problemId: 'liaison-problem-lab-energy',
      teamId: 'liaison-team-energy-story',
      memberUid: 'demo-student',
      role: 'maintainer',
      joinedAt: '2026-10-02T08:00:00.000Z',
      status: 'active',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_team', id: 'liaison-team-energy-story' },
    }),
    stored('liaison-member-energy-map', {
      problemId: 'liaison-problem-lab-energy',
      teamId: 'liaison-team-energy-map',
      memberUid: 'demo-captain',
      role: 'maintainer',
      joinedAt: '2026-10-03T08:00:00.000Z',
      status: 'active',
      ownerUid: 'demo-captain',
      scope: { type: 'liaison_team', id: 'liaison-team-energy-map' },
    }),
  ];
  state.liaisonPosts = [
    stored('liaison-post-energy-question', {
      problemId: 'liaison-problem-lab-energy',
      teamId: null,
      authorUid: 'demo-student',
      kind: 'discussion',
      body: '公开样例数据会提供哪些时间粒度？',
      hiddenAt: null,
      hiddenByUid: null,
      status: 'visible',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_problem', id: 'liaison-problem-lab-energy' },
    }),
    stored('liaison-post-energy-story-progress', {
      problemId: 'liaison-problem-lab-energy',
      teamId: 'liaison-team-energy-story',
      authorUid: 'demo-student',
      kind: 'progress',
      body: '已完成指标卡片的信息层级草图。',
      hiddenAt: null,
      hiddenByUid: null,
      status: 'visible',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_problem', id: 'liaison-problem-lab-energy' },
    }),
    stored('liaison-post-energy-map-progress', {
      problemId: 'liaison-problem-lab-energy',
      teamId: 'liaison-team-energy-map',
      authorUid: 'demo-captain',
      kind: 'progress',
      body: '已完成地图底图和匿名化样例数据接入。',
      hiddenAt: null,
      hiddenByUid: null,
      status: 'visible',
      ownerUid: 'demo-captain',
      scope: { type: 'liaison_problem', id: 'liaison-problem-lab-energy' },
    }),
  ];
  state.liaisonOutcomes = [
    stored('liaison-outcome-energy-story-v1', {
      problemId: 'liaison-problem-lab-energy',
      teamId: 'liaison-team-energy-story',
      version: 1,
      title: '能耗指标叙事原型',
      description: '包含关键指标卡片、趋势解释和公开演示说明。',
      linkUrl: 'https://example.invalid/freebbs/energy-story',
      attachmentRef: null,
      submittedAt: '2026-10-20T08:00:00.000Z',
      adoptedAt: '2026-10-22T08:00:00.000Z',
      adoptedByUid: 'demo-liaison-member',
      status: 'adopted',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_team', id: 'liaison-team-energy-story' },
    }),
  ];
  state.financeRecords = [
    stored('finance-orientation-budget', {
      title: '新生见面会预算',
      kind: 'budget',
      amountCents: 150000,
      activityId: 'activity-orientation',
      organizationId: 'liaison_center',
      reviewerUid: 'demo-tuanwei-lead',
      reviewedAt: '2026-07-22T08:00:00.000Z',
      reviewDecision: 'approved',
      status: 'approved',
      ownerUid: 'demo-liaison-member',
      scope: { type: 'activity', id: 'activity-orientation' },
    }),
    stored('finance-night-run-settlement', {
      title: '校园夜跑物资结算',
      kind: 'settlement',
      amountCents: 48600,
      activityId: 'activity-night-run',
      organizationId: 'sports_center',
      reviewerUid: null,
      reviewedAt: null,
      reviewDecision: null,
      status: 'submitted',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'activity', id: 'activity-night-run' },
    }),
  ];
  return state;
}

class MemoryRepository<T extends StoredRecord> implements RecordRepository<T> {
  constructor(
    private readonly holder: StateHolder,
    private readonly collection: CollectionName,
    private readonly allowRowLock: boolean,
  ) {}

  async create(input: NewRecord<T>): Promise<T> {
    return withWriteLock(this.holder, async () => {
      const normalizedInput = normalizedValues(input);
      const recordInput = {
        ...collectionDefaults(this.collection),
        ...normalizedInput,
      } as NewRecord<T>;
      this.assertLiaisonReferences(recordInput);
      const conflictMessage = this.conflictMessage(recordInput);
      if (conflictMessage !== undefined) throw new RecordConflictError(conflictMessage);
      const now = new Date().toISOString();
      const record = {
        ...recordInput,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      } as unknown as T;
      this.records().push(record);
      return structuredClone(record);
    });
  }

  async get(id: string): Promise<T | null> {
    const record = this.records().find((candidate) => candidate.id === id);
    return record ? structuredClone(record) : null;
  }

  async getForUpdate(id: string): Promise<T | null> {
    if (!this.allowRowLock) throw new Error('Row locking requires a store transaction');
    return this.get(id);
  }

  async listForUpdate(filters: ListFilters = {}): Promise<T[]> {
    if (!this.allowRowLock) throw new Error('Row locking requires a store transaction');
    return (await this.list(filters)).sort((left, right) => left.id.localeCompare(right.id));
  }

  async list(filters: ListFilters = {}): Promise<T[]> {
    return this.filteredRecords(filters);
  }

  async countActiveByProblemIds(problemIds: readonly string[]): Promise<Record<string, number>> {
    if (this.collection !== 'liaisonTeams') {
      throw new Error('Team aggregation requires the liaison team repository');
    }
    const requested = new Set(problemIds);
    if (requested.size > 100) throw new RangeError('At most 100 problem ids may be aggregated');
    const counts: Record<string, number> = {};
    for (const team of this.records() as unknown as LiaisonTeamRecord[]) {
      if (team.status !== 'active' || !requested.has(team.problemId)) continue;
      counts[team.problemId] = (counts[team.problemId] ?? 0) + 1;
    }
    return counts;
  }

  private filteredRecords(filters: ListFilters = {}): T[] {
    const query = filters.query?.trim().toLocaleLowerCase();
    return this.records()
      .filter((record) => !filters.status || record.status === filters.status)
      .filter((record) => !filters.scopeType || record.scope.type === filters.scopeType)
      .filter((record) => !filters.scopeId || record.scope.id === filters.scopeId)
      .filter((record) => {
        const fields = record as unknown as Record<string, unknown>;
        return (
          ['category', 'season', 'organizationId', 'standingActivity'].every(
            (key) =>
              filters[key as keyof ListFilters] === undefined ||
              fields[key] === filters[key as keyof ListFilters],
          ) &&
          (filters.tag === undefined ||
            (Array.isArray(fields.tags) && fields.tags.includes(filters.tag)))
        );
      })
      .filter((record) => {
        if (!query) return true;
        const searchable = record as unknown as Record<string, unknown>;
        // Search each decoded tag, never JSON syntax or separators between tags.
        if (
          (this.collection === 'knowledge' || this.collection === 'liaisonProblems') &&
          Array.isArray(searchable.tags) &&
          searchable.tags.some((tag) => String(tag).toLocaleLowerCase().includes(query))
        )
          return true;
        return searchFields[this.collection]
          .map((key) => String(searchable[key] ?? ''))
          .join(' ')
          .toLocaleLowerCase()
          .includes(query);
      })
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )
      .map((record) => structuredClone(record));
  }

  async page(filters: ListFilters | undefined, request: PageRequest): Promise<Page<T>> {
    validatePageRequest(request);
    const records = await this.list(filters);
    const offset = (request.page - 1) * request.pageSize;
    return {
      items: records.slice(offset, offset + request.pageSize),
      page: request.page,
      pageSize: request.pageSize,
      total: records.length,
    };
  }

  async pageVisible(
    filters: ListFilters | undefined,
    request: PageRequest,
    visibility: LiaisonProblemVisibility,
  ): Promise<Page<LiaisonProblemRecord>> {
    if (this.collection !== 'liaisonProblems') {
      throw new Error('Authorized liaison pagination requires the liaison problem repository');
    }
    validatePageRequest(request);
    const records = (this.filteredRecords(filters) as unknown as LiaisonProblemRecord[]).filter(
      (problem) => liaisonProblemIsVisible(problem, visibility),
    );
    const offset = (request.page - 1) * request.pageSize;
    return {
      items: records.slice(offset, offset + request.pageSize),
      page: request.page,
      pageSize: request.pageSize,
      total: records.length,
    };
  }

  async update(id: string, patch: RecordPatch<T>): Promise<T | null> {
    return withWriteLock(this.holder, async () => {
      const records = this.records();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return null;
      const existing = records[index];
      if (!existing) return null;
      const normalizedPatch = normalizedValues(patch);
      if (Object.keys(normalizedPatch).length === 0) return structuredClone(existing);
      this.assertReferencedKeyUpdateAllowed(existing, normalizedPatch);
      const candidate = { ...existing, ...normalizedPatch } as NewRecord<T>;
      this.assertLiaisonReferences(candidate);
      const conflictMessage = this.conflictMessage(candidate, existing.id);
      if (conflictMessage !== undefined) throw new RecordConflictError(conflictMessage);
      const updated = {
        ...existing,
        ...normalizedPatch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      } as T;
      records[index] = updated;
      return structuredClone(updated);
    });
  }

  async delete(id: string): Promise<boolean> {
    return withWriteLock(this.holder, async () => {
      const records = this.records();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return false;
      const existing = records[index];
      if (!existing) return false;
      this.assertDeleteAllowed(existing);
      records.splice(index, 1);
      return true;
    });
  }

  private assertLiaisonReferences(input: NewRecord<T>): void {
    const state = this.holder.current;
    const candidate = input as unknown as Record<string, unknown>;
    const subjectExists = (uid: unknown): boolean =>
      typeof uid === 'string' && state.subjects.some((subject) => subject.uid === uid);
    const nullableSubjectExists = (uid: unknown): boolean => uid === null || subjectExists(uid);
    const problemExists = (problemId: unknown): boolean =>
      typeof problemId === 'string' &&
      state.liaisonProblems.some((problem) => problem.id === problemId);
    const matchingTeamExists = (problemId: unknown, teamId: unknown): boolean =>
      typeof problemId === 'string' &&
      typeof teamId === 'string' &&
      state.liaisonTeams.some((team) => team.id === teamId && team.problemId === problemId);

    switch (this.collection) {
      case 'liaisonProblems':
        if (
          !subjectExists(candidate.recorderUid) ||
          !nullableSubjectExists(candidate.reviewerUid)
        ) {
          throw missingReferenceError('Liaison problem references a missing subject');
        }
        break;
      case 'liaisonTeams':
        if (!problemExists(candidate.problemId)) {
          throw missingReferenceError('Liaison team references a missing problem');
        }
        if (!subjectExists(candidate.maintainerUid)) {
          throw missingReferenceError('Liaison team references a missing maintainer');
        }
        break;
      case 'liaisonTeamMembers':
        if (!matchingTeamExists(candidate.problemId, candidate.teamId)) {
          throw missingReferenceError('Liaison membership references a missing matching team');
        }
        if (!subjectExists(candidate.memberUid)) {
          throw missingReferenceError('Liaison membership references a missing subject');
        }
        break;
      case 'liaisonPosts':
        if (!problemExists(candidate.problemId)) {
          throw missingReferenceError('Liaison post references a missing problem');
        }
        if (
          candidate.teamId !== null &&
          !matchingTeamExists(candidate.problemId, candidate.teamId)
        ) {
          throw missingReferenceError('Liaison post references a missing matching team');
        }
        if (!subjectExists(candidate.authorUid) || !nullableSubjectExists(candidate.hiddenByUid)) {
          throw missingReferenceError('Liaison post references a missing subject');
        }
        break;
      case 'liaisonOutcomes':
        if (!matchingTeamExists(candidate.problemId, candidate.teamId)) {
          throw missingReferenceError('Liaison outcome references a missing matching team');
        }
        if (!nullableSubjectExists(candidate.adoptedByUid)) {
          throw missingReferenceError('Liaison outcome references a missing adopter');
        }
        break;
    }
  }

  private assertDeleteAllowed(record: T): void {
    const state = this.holder.current;
    if (this.collection === 'liaisonProblems') {
      const problemId = record.id;
      if (
        state.liaisonTeams.some((team) => team.problemId === problemId) ||
        state.liaisonPosts.some((post) => post.problemId === problemId)
      ) {
        throw referencedRowError('Liaison problem is still referenced');
      }
    }
    if (this.collection === 'liaisonTeams') {
      const teamId = record.id;
      if (
        state.liaisonTeamMembers.some((member) => member.teamId === teamId) ||
        state.liaisonPosts.some((post) => post.teamId === teamId) ||
        state.liaisonOutcomes.some((outcome) => outcome.teamId === teamId)
      ) {
        throw referencedRowError('Liaison team is still referenced');
      }
    }
    if (this.collection === 'subjects') {
      const uid = (record as unknown as SubjectRecord).uid;
      if (
        state.liaisonProblems.some(
          (problem) => problem.recorderUid === uid || problem.reviewerUid === uid,
        ) ||
        state.liaisonTeams.some((team) => team.maintainerUid === uid) ||
        state.liaisonTeamMembers.some((member) => member.memberUid === uid) ||
        state.liaisonPosts.some((post) => post.authorUid === uid || post.hiddenByUid === uid) ||
        state.liaisonOutcomes.some((outcome) => outcome.adoptedByUid === uid)
      ) {
        throw referencedRowError('Subject is still referenced by liaison records');
      }
    }
  }

  private assertReferencedKeyUpdateAllowed(record: T, patch: RecordPatch<T>): void {
    const values = patch as Record<string, unknown>;
    if (
      this.collection === 'liaisonTeams' &&
      Object.hasOwn(values, 'problemId') &&
      values.problemId !== (record as unknown as LiaisonTeamRecord).problemId
    ) {
      this.assertDeleteAllowed(record);
    }
    if (
      this.collection === 'subjects' &&
      Object.hasOwn(values, 'uid') &&
      values.uid !== (record as unknown as SubjectRecord).uid
    ) {
      this.assertDeleteAllowed(record);
    }
  }

  private hasAssignmentConflict(input: NewRecord<T>, excludeId?: string): boolean {
    const candidate = input as unknown as {
      subjectUid: string;
      roleKey?: string;
      tagKey?: string;
      scope: { type: string; id: string };
    };
    const assignmentKey = this.collection === 'roleAssignments' ? 'roleKey' : 'tagKey';
    return this.records().some((record) => {
      if (record.id === excludeId) return false;
      const existing = record as unknown as typeof candidate;
      return (
        existing.subjectUid === candidate.subjectUid &&
        existing[assignmentKey] === candidate[assignmentKey] &&
        existing.scope.type === candidate.scope.type &&
        existing.scope.id === candidate.scope.id
      );
    });
  }

  private conflictMessage(input: NewRecord<T>, excludeId?: string): string | undefined {
    if (
      (this.collection === 'roleAssignments' || this.collection === 'tagAssignments') &&
      this.hasAssignmentConflict(input, excludeId)
    ) {
      return 'Assignment already exists';
    }
    if (this.collection === 'tagPermissions') {
      const candidate = input as unknown as {
        tagKey: string;
        action: string;
        resource: string;
        scope: { type: string; id: string };
      };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.tagKey === candidate.tagKey &&
            current.action === candidate.action &&
            current.resource === candidate.resource &&
            current.scope.type === candidate.scope.type &&
            current.scope.id === candidate.scope.id
          );
        })
      ) {
        return 'Tag permission already exists';
      }
    }
    if (this.collection === 'clubMemberships') {
      const candidate = input as unknown as { clubId: string; memberUid: string };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return current.clubId === candidate.clubId && current.memberUid === candidate.memberUid;
        })
      ) {
        return 'Membership already exists';
      }
    }
    if (this.collection === 'sportsTeamMembers') {
      const candidate = input as unknown as { teamId: string; memberUid: string };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return current.teamId === candidate.teamId && current.memberUid === candidate.memberUid;
        })
      ) {
        return 'Membership already exists';
      }
    }
    if (this.collection === 'activityRegistrations') {
      const candidate = input as unknown as { activityId: string; participantUid: string };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.activityId === candidate.activityId &&
            current.participantUid === candidate.participantUid
          );
        })
      ) {
        return 'Registration already exists';
      }
    }
    if (this.collection === 'collectionVersions') {
      const candidate = input as unknown as { formId: string; version: number };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return current.formId === candidate.formId && current.version === candidate.version;
        })
      ) {
        return 'Collection version already exists';
      }
    }
    if (this.collection === 'collectionResponses') {
      const candidate = input as unknown as {
        formId: string;
        versionId: string;
        respondentUid: string;
        attempt: number;
      };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.formId === candidate.formId &&
            current.versionId === candidate.versionId &&
            current.respondentUid === candidate.respondentUid &&
            current.attempt === candidate.attempt
          );
        })
      ) {
        return 'Collection response already exists';
      }
    }
    if (this.collection === 'showcaseLikes') {
      const candidate = input as unknown as { articleId: string; userUid: string };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return current.articleId === candidate.articleId && current.userUid === candidate.userUid;
        })
      ) {
        return 'Showcase like already exists';
      }
    }
    if (this.collection === 'liaisonTeamMembers') {
      const candidate = input as unknown as {
        problemId: string;
        teamId: string;
        memberUid: string;
      };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.problemId === candidate.problemId &&
            current.teamId === candidate.teamId &&
            current.memberUid === candidate.memberUid
          );
        })
      ) {
        return 'Liaison team membership already exists';
      }
    }
    if (this.collection === 'liaisonOutcomes') {
      const candidate = input as unknown as {
        problemId: string;
        teamId: string;
        version: number;
      };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.problemId === candidate.problemId &&
            current.teamId === candidate.teamId &&
            current.version === candidate.version
          );
        })
      ) {
        return 'Liaison outcome version already exists';
      }
    }
    if (this.collection === 'sportsCheckins') {
      const candidate = input as unknown as {
        teamId: string;
        memberUid: string;
        checkinDate: string;
      };
      if (
        this.records().some((record) => {
          if (record.id === excludeId) return false;
          const current = record as unknown as typeof candidate;
          return (
            current.teamId === candidate.teamId &&
            current.memberUid === candidate.memberUid &&
            current.checkinDate === candidate.checkinDate
          );
        })
      ) {
        return 'Check-in already exists';
      }
    }
    return undefined;
  }

  private records(): T[] {
    return this.holder.current[this.collection] as unknown as T[];
  }
}

function buildStore(holder: StateHolder, inTransaction = false): DevelopmentStore {
  const repository = <T extends StoredRecord>(collection: CollectionName) =>
    new MemoryRepository<T>(holder, collection, inTransaction);
  const store: DevelopmentStore = {
    async transaction<T>(operation: (transactionStore: DevelopmentStore) => Promise<T>) {
      return withWriteLock(holder, async () => {
        const transactionHolder: StateHolder = {
          current: structuredClone(holder.current),
          transactionTail: Promise.resolve(),
        };
        const result = await operation(buildStore(transactionHolder, true));
        holder.current = structuredClone(transactionHolder.current);
        return result;
      });
    },
    queryAuditLogs: async (query) => queryMemoryAuditLogs(holder.current.auditLogs, query),
    subjects: repository('subjects'),
    developmentAccess: repository('developmentAccess'),
    roles: repository('roles'),
    permissions: repository('permissions'),
    rolePermissions: repository('rolePermissions'),
    roleAssignments: repository('roleAssignments'),
    tagDefinitions: repository('tagDefinitions'),
    tagAssignments: repository('tagAssignments'),
    tagPermissions: repository('tagPermissions'),
    modules: repository('modules'),
    moduleOwners: repository('moduleOwners'),
    auditLogs: repository('auditLogs'),
    knowledge: repository('knowledge'),
    announcements: repository('announcements'),
    consultations: repository('consultations'),
    informationReplies: repository('informationReplies'),
    informationLikes: repository('informationLikes'),
    proposals: repository('proposals'),
    clubs: repository('clubs'),
    clubMemberships: repository('clubMemberships'),
    activities: repository('activities'),
    activityMilestones: repository('activityMilestones'),
    competitionFixtures: repository('competitionFixtures'),
    activityRegistrations: repository('activityRegistrations'),
    collectionForms: repository('collectionForms'),
    collectionVersions: repository('collectionVersions'),
    collectionResponses: repository('collectionResponses'),
    showcaseArticles: repository('showcaseArticles'),
    showcaseLikes: repository('showcaseLikes'),
    festivalSubmissions: repository('festivalSubmissions'),
    sportsTeams: repository('sportsTeams'),
    sportsMatches: repository('sportsMatches'),
    sportsTeamShowcases: repository('sportsTeamShowcases'),
    sportsTeamMembers: repository('sportsTeamMembers'),
    sportsCheckins: repository('sportsCheckins'),
    liaisonResources: repository('liaisonResources'),
    liaisonProblems: repository('liaisonProblems'),
    liaisonTeams: repository('liaisonTeams'),
    liaisonTeamMembers: repository('liaisonTeamMembers'),
    liaisonPosts: repository('liaisonPosts'),
    liaisonOutcomes: repository('liaisonOutcomes'),
    financeRecords: repository('financeRecords'),
  };
  return store;
}

function validatePageRequest(request: PageRequest): void {
  if (!Number.isInteger(request.page) || request.page < 1) {
    throw new RangeError('page must be an integer greater than or equal to 1');
  }
  if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) {
    throw new RangeError('pageSize must be an integer between 1 and 100');
  }
}

function scopedAccessAllows(access: LiaisonProblemVisibility['read'], id: string): boolean {
  if (access.deniedIds.includes(id)) return false;
  return access.all || access.ids.includes(id);
}

function liaisonProblemIsVisible(
  problem: LiaisonProblemRecord,
  visibility: LiaisonProblemVisibility,
): boolean {
  if (!scopedAccessAllows(visibility.read, problem.id)) return false;
  return (
    visibility.publicStatuses.includes(problem.status) ||
    problem.ownerUid === visibility.actorUid ||
    scopedAccessAllows(visibility.maintain, problem.id) ||
    (problem.status === 'pending_review' && scopedAccessAllows(visibility.review, problem.id))
  );
}

export interface MemoryStoreOptions {
  seed?: boolean;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): DevelopmentStore {
  return buildStore({
    current: options.seed === false ? createEmptyState() : createDemoState(),
    transactionTail: Promise.resolve(),
  });
}
