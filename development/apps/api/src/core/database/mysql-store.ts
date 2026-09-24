import { randomUUID } from 'node:crypto';

import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';

import { queryMySqlAuditLogs } from './audit-query.js';
import {
  decodeDateOnly,
  decodeUtcDateTime,
  encodeDateOnly,
  encodeUtcDateTime,
} from './date-codec.js';
import { loadMySqlConfig, type MySqlConfig } from './migrate.js';
import { checkMySqlReadiness } from './mysql-readiness.js';
import { RecordConflictError } from './record-conflict-error.js';
import type {
  ActivityRecord,
  ActivityMilestoneRecord,
  ActivityRegistrationRecord,
  AnnouncementRecord,
  AuditLogRecord,
  CompetitionFixtureRecord,
  ClubMembershipRecord,
  ClubRecord,
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
  ProposalRecord,
  PageRequest,
  PermissionRecord,
  RecordPatch,
  RecordRepository,
  RoleAssignmentRecord,
  RolePermissionRecord,
  RoleRecord,
  SportsCheckinRecord,
  SportsTeamMemberRecord,
  SportsTeamRecord,
  SportsMatchRecord,
  SportsTeamShowcaseRecord,
  StoredRecord,
  SubjectRecord,
  TagAssignmentRecord,
  TagDefinitionRecord,
  TagPermissionRecord,
} from './types.js';

type Executor = Pool | PoolConnection;
type RecordInput<T extends StoredRecord> = NewRecord<T> & Record<string, unknown>;
type SqlValue = string | number | boolean | Date | Buffer | null;

interface FieldDefinition {
  key: string;
  column: string;
  encode?: (value: unknown) => unknown;
  decode?: (value: unknown) => unknown;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }
  throw new TypeError('Repository field cannot be encoded as a MySQL value');
}

interface RepositoryDefinition {
  table: string;
  fields: FieldDefinition[];
  searchColumns: string[];
  conflictMessage?: string;
}

const field = (
  key: string,
  column: string,
  transforms: Pick<FieldDefinition, 'encode' | 'decode'> = {},
): FieldDefinition => ({ key, column, ...transforms });

const booleanField = (key: string, column: string) =>
  field(key, column, { encode: (value) => (value ? 1 : 0), decode: (value) => Boolean(value) });
const defaultedField = (key: string, column: string, fallback: unknown) =>
  field(key, column, {
    encode: (value) => value ?? fallback,
    decode: (value) => value ?? fallback,
  });
const tagsField = field('tags', 'tags', {
  encode: (value) => JSON.stringify(value ?? []),
  decode: (value) => (typeof value === 'string' ? (JSON.parse(value) as string[]) : (value ?? [])),
});
const utcDateTimeField = (key: string, column: string) =>
  field(key, column, {
    encode: (value) => encodeUtcDateTime(value as string | Date | null | undefined),
    decode: (value) => (value === null || value === undefined ? null : decodeUtcDateTime(value)),
  });
const dateOnlyField = (key: string, column: string) =>
  field(key, column, {
    encode: (value) => encodeDateOnly(String(value)),
    decode: (value) => decodeDateOnly(String(value)),
  });
const safeIntegerField = (key: string, column: string) =>
  field(key, column, {
    encode: (value) => safeInteger(value),
    decode: (value) => safeInteger(value),
  });
const positiveIntegerField = (key: string, column: string) =>
  field(key, column, {
    encode: (value) => positiveInteger(value, key),
    decode: (value) => positiveInteger(value, key),
  });
const jsonField = (key: string, column: string) =>
  field(key, column, {
    encode: (value) => JSON.stringify(value ?? {}),
    decode: (value) => {
      if (typeof value !== 'string') return value ?? {};
      return JSON.parse(value) as Record<string, unknown>;
    },
  });
function safeInteger(value: unknown): number {
  const number =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as number);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError('amountCents must be a non-negative safe integer');
  }
  return number;
}
function positiveInteger(value: unknown, key: string): number {
  const number =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as number);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${key} must be a positive safe integer`);
  }
  return number;
}

const definitions = {
  developmentAccess: {
    table: 'development_access_grants',
    fields: [
      defaultedField('subjectUid', 'subject_uid', null),
      defaultedField('studentId', 'student_id', null),
      defaultedField('username', 'username', null),
      field('accessLevel', 'access_level'),
    ],
    searchColumns: ['subject_uid', 'student_id', 'username'],
  },
  festivalSubmissions: {
    table: 'festival_submissions',
    fields: [
      field('title', 'title'),
      field('description', 'description'),
      field('authorName', 'author_name'),
      booleanField('displayConsent', 'display_consent'),
      field('mimeType', 'mime_type'),
      positiveIntegerField('sizeBytes', 'size_bytes'),
      field('storageKey', 'storage_key'),
      defaultedField('reviewerUid', 'reviewer_uid', null),
      utcDateTimeField('reviewedAt', 'reviewed_at'),
      defaultedField('reviewNote', 'review_note', ''),
    ],
    searchColumns: ['title', 'description', 'author_name'],
  },
  subjects: {
    table: 'subjects',
    fields: [
      field('uid', 'uid'),
      field('displayName', 'display_name'),
      field('avatarUrl', 'avatar_url'),
    ],
    searchColumns: ['uid', 'display_name'],
  },
  roles: {
    table: 'roles',
    fields: [field('key', 'role_key'), field('name', 'name')],
    searchColumns: ['role_key', 'name'],
  },
  permissions: {
    table: 'permissions',
    fields: [field('action', 'action'), field('resource', 'resource')],
    searchColumns: ['action', 'resource'],
  },
  rolePermissions: {
    table: 'role_permissions',
    fields: [
      field('roleKey', 'role_key'),
      field('action', 'action'),
      field('resource', 'resource'),
      field('effect', 'effect'),
    ],
    searchColumns: ['role_key', 'action', 'resource'],
  },
  roleAssignments: {
    table: 'role_assignments',
    conflictMessage: 'Assignment already exists',
    fields: [
      field('subjectUid', 'subject_uid'),
      field('roleKey', 'role_key'),
      utcDateTimeField('expiresAt', 'expires_at'),
    ],
    searchColumns: ['subject_uid', 'role_key'],
  },
  tagDefinitions: {
    table: 'tag_definitions',
    fields: [
      field('key', 'tag_key'),
      field('name', 'name'),
      field('description', 'description'),
      field('requiredScopeType', 'required_scope_type'),
      jsonField('metadata', 'metadata'),
    ],
    searchColumns: ['tag_key', 'name', 'description'],
  },
  tagAssignments: {
    table: 'tag_assignments',
    conflictMessage: 'Assignment already exists',
    fields: [
      field('subjectUid', 'subject_uid'),
      field('tagKey', 'tag_key'),
      utcDateTimeField('expiresAt', 'expires_at'),
    ],
    searchColumns: ['subject_uid', 'tag_key'],
  },
  tagPermissions: {
    table: 'tag_permissions',
    conflictMessage: 'Tag permission already exists',
    fields: [
      field('tagKey', 'tag_key'),
      field('action', 'action'),
      field('resource', 'resource'),
      field('effect', 'effect'),
    ],
    searchColumns: ['tag_key', 'action', 'resource'],
  },
  modules: {
    table: 'modules',
    fields: [
      field('moduleId', 'module_id'),
      field('name', 'name'),
      field('description', 'description'),
      booleanField('enabled', 'enabled'),
    ],
    searchColumns: ['module_id', 'name', 'description'],
  },
  moduleOwners: {
    table: 'module_owners',
    fields: [
      field('moduleId', 'module_id'),
      field('ownerType', 'owner_type'),
      field('ownerId', 'owner_id'),
    ],
    searchColumns: ['module_id', 'owner_type', 'owner_id'],
  },
  auditLogs: {
    table: 'audit_logs',
    fields: [
      field('actorUid', 'actor_uid'),
      field('action', 'action'),
      field('resourceType', 'resource_type'),
      field('resourceId', 'resource_id'),
      jsonField('details', 'details'),
    ],
    searchColumns: ['actor_uid', 'action', 'resource_type', 'resource_id'],
  },
  knowledge: {
    table: 'knowledge_entries',
    fields: [
      defaultedField('category', 'category', 'general'),
      tagsField,
      defaultedField('summary', 'summary', ''),
      utcDateTimeField('maintainedAt', 'maintained_at'),
      defaultedField('maintainerUid', 'maintainer_uid', null),
      field('type', 'entry_type'),
      field('title', 'title'),
      field('body', 'body'),
      field('audience', 'audience', {
        encode: (value) => value ?? 'general',
        decode: (value) => value ?? 'general',
      }),
      field('organizationId', 'organization_id'),
    ],
    searchColumns: ['title', 'body', 'category', 'summary'],
  },
  announcements: {
    table: 'announcements',
    fields: [
      field('title', 'title'),
      field('body', 'body'),
      defaultedField('pinned', 'is_pinned', false),
    ],
    searchColumns: ['title', 'body'],
  },
  consultations: {
    table: 'consultations',
    fields: [
      utcDateTimeField('dueAt', 'due_at'),
      field('title', 'title'),
      field('body', 'body'),
      defaultedField('visibility', 'visibility', 'private'),
      field('requesterUid', 'requester_uid'),
      field('assigneeUid', 'assignee_uid'),
      field('reply', 'reply'),
    ],
    searchColumns: ['title', 'body', 'requester_uid', 'assignee_uid', 'reply'],
  },
  informationReplies: {
    table: 'information_replies',
    fields: [
      field('targetType', 'target_type'),
      field('targetId', 'target_id'),
      field('authorUid', 'author_uid'),
      field('kind', 'reply_kind'),
      field('body', 'body'),
    ],
    searchColumns: ['target_type', 'target_id', 'author_uid', 'body'],
  },
  informationLikes: {
    table: 'information_likes',
    conflictMessage: 'Information like already exists',
    fields: [
      field('targetType', 'target_type'),
      field('targetId', 'target_id'),
      field('userUid', 'user_uid'),
    ],
    searchColumns: ['target_type', 'target_id', 'user_uid'],
  },
  proposals: {
    table: 'proposals',
    fields: [
      utcDateTimeField('dueAt', 'due_at'),
      field('title', 'title'),
      field('problemDescription', 'problem_description'),
      field('proposedSolution', 'proposed_solution'),
      field('category', 'category'),
      field('submitterUid', 'submitter_uid'),
      field('assigneeUid', 'assignee_uid'),
      field('publicProgress', 'public_progress'),
      field('internalNote', 'internal_note'),
    ],
    searchColumns: [
      'title',
      'problem_description',
      'proposed_solution',
      'category',
      'submitter_uid',
    ],
  },
  clubs: {
    table: 'clubs',
    fields: [
      defaultedField('category', 'category', 'general'),
      defaultedField('contactName', 'contact_name', ''),
      defaultedField('publicContact', 'public_contact', ''),
      field('name', 'name'),
      field('description', 'description'),
      field('technicalSupportStatus', 'technical_support_status'),
      field('technicalSupportNote', 'technical_support_note'),
      field('organizationId', 'organization_id'),
    ],
    searchColumns: [
      'name',
      'description',
      'technical_support_note',
      'category',
      'contact_name',
      'public_contact',
    ],
  },
  clubMemberships: {
    table: 'club_memberships',
    conflictMessage: 'Membership already exists',
    fields: [field('clubId', 'club_id'), field('memberUid', 'member_uid')],
    searchColumns: ['club_id', 'member_uid'],
  },
  activities: {
    table: 'activities',
    fields: [
      utcDateTimeField('registrationDeadline', 'registration_deadline'),
      defaultedField('capacity', 'capacity', null),
      defaultedField('contact', 'contact', ''),
      field('title', 'title'),
      field('description', 'description'),
      field('clubId', 'club_id'),
      utcDateTimeField('startsAt', 'starts_at'),
      utcDateTimeField('endsAt', 'ends_at'),
      field('location', 'location', {
        encode: (value) => value ?? '',
        decode: (value) => value ?? '',
      }),
      field('organizationId', 'organization_id'),
      booleanField('standingActivity', 'standing_activity'),
      field('technicalSupportStatus', 'technical_support_status'),
      field('technicalSupportNote', 'technical_support_note'),
    ],
    searchColumns: ['title', 'description', 'technical_support_note', 'location', 'contact'],
  },
  activityMilestones: {
    table: 'activity_milestones',
    fields: [
      field('activityId', 'activity_id'),
      utcDateTimeField('occursAt', 'occurs_at'),
      field('title', 'title'),
      field('type', 'milestone_type'),
      field('description', 'description'),
      booleanField('completed', 'completed'),
      field('displayOrder', 'display_order'),
    ],
    searchColumns: ['activity_id', 'title', 'milestone_type', 'description'],
  },
  competitionFixtures: {
    table: 'competition_fixtures',
    fields: [
      field('activityId', 'activity_id'),
      field('round', 'round_name'),
      field('participantA', 'participant_a'),
      field('participantB', 'participant_b'),
      utcDateTimeField('scheduledAt', 'scheduled_at'),
      field('location', 'location'),
      field('score', 'score'),
    ],
    searchColumns: ['activity_id', 'round_name', 'participant_a', 'participant_b', 'location'],
  },
  activityRegistrations: {
    table: 'activity_registrations',
    conflictMessage: 'Registration already exists',
    fields: [field('activityId', 'activity_id'), field('participantUid', 'participant_uid')],
    searchColumns: ['activity_id', 'participant_uid'],
  },
  sportsTeams: {
    table: 'sports_teams',
    fields: [
      field('name', 'name'),
      field('description', 'description'),
      defaultedField('season', 'season', ''),
      defaultedField('trainingSchedule', 'training_schedule', ''),
    ],
    searchColumns: ['name', 'description', 'season', 'training_schedule'],
  },
  sportsMatches: {
    table: 'sports_matches',
    fields: [
      field('title', 'title'),
      field('coverUrl', 'cover_url'),
      utcDateTimeField('startsAt', 'starts_at'),
      utcDateTimeField('endsAt', 'ends_at'),
      field('location', 'location'),
      field('result', 'result'),
      field('liveUrl', 'live_url'),
      field('replayUrl', 'replay_url'),
    ],
    searchColumns: ['title', 'location'],
  },
  sportsTeamShowcases: {
    table: 'sports_team_showcases',
    conflictMessage: 'A showcase already exists for this sports team',
    fields: [
      field('teamId', 'team_id'),
      field('markdown', 'markdown'),
      field('updatedByUid', 'updated_by_uid'),
    ],
    searchColumns: ['team_id', 'markdown', 'updated_by_uid'],
  },
  sportsTeamMembers: {
    table: 'sports_team_members',
    conflictMessage: 'Membership already exists',
    fields: [field('teamId', 'team_id'), field('memberUid', 'member_uid')],
    searchColumns: ['team_id', 'member_uid'],
  },
  sportsCheckins: {
    table: 'sports_checkins',
    conflictMessage: 'Check-in already exists',
    fields: [
      field('teamId', 'team_id'),
      field('memberUid', 'member_uid'),
      dateOnlyField('checkinDate', 'checkin_date'),
    ],
    searchColumns: ['team_id', 'member_uid'],
  },
  liaisonResources: {
    table: 'liaison_resources',
    fields: [
      field('name', 'name'),
      field('description', 'description'),
      field('category', 'category'),
      field('visibility', 'visibility'),
    ],
    searchColumns: ['name', 'description', 'category'],
  },
  liaisonProblems: {
    table: 'liaison_problems',
    fields: [
      field('title', 'title'),
      defaultedField('summary', 'summary', ''),
      field('background', 'background'),
      field('sourceType', 'source_type'),
      field('sourceName', 'source_name'),
      tagsField,
      field('expectedOutcome', 'expected_outcome'),
      field('constraints', 'constraints_text'),
      utcDateTimeField('startsAt', 'starts_at'),
      utcDateTimeField('deadline', 'deadline'),
      defaultedField('publicContact', 'public_contact', ''),
      field('internalContactNote', 'internal_contact_note'),
      field('recorderUid', 'recorder_uid'),
      field('reviewerUid', 'reviewer_uid'),
      utcDateTimeField('reviewedAt', 'reviewed_at'),
      field('reviewNote', 'review_note'),
    ],
    searchColumns: [
      'title',
      'summary',
      'background',
      'source_name',
      'expected_outcome',
      'constraints_text',
      'public_contact',
    ],
  },
  liaisonTeams: {
    table: 'liaison_teams',
    fields: [
      field('problemId', 'problem_id'),
      field('name', 'name'),
      field('proposal', 'proposal'),
      field('maintainerUid', 'maintainer_uid'),
    ],
    searchColumns: ['problem_id', 'name', 'proposal', 'maintainer_uid'],
  },
  liaisonTeamMembers: {
    table: 'liaison_team_members',
    conflictMessage: 'Liaison team membership already exists',
    fields: [
      field('problemId', 'problem_id'),
      field('teamId', 'team_id'),
      field('memberUid', 'member_uid'),
      field('role', 'member_role'),
      utcDateTimeField('joinedAt', 'joined_at'),
    ],
    searchColumns: ['problem_id', 'team_id', 'member_uid'],
  },
  liaisonPosts: {
    table: 'liaison_posts',
    fields: [
      field('problemId', 'problem_id'),
      field('teamId', 'team_id'),
      field('authorUid', 'author_uid'),
      field('kind', 'post_kind'),
      field('body', 'body'),
      utcDateTimeField('hiddenAt', 'hidden_at'),
      field('hiddenByUid', 'hidden_by_uid'),
    ],
    searchColumns: ['problem_id', 'team_id', 'author_uid', 'body'],
  },
  liaisonOutcomes: {
    table: 'liaison_outcomes',
    conflictMessage: 'Liaison outcome version already exists',
    fields: [
      field('problemId', 'problem_id'),
      field('teamId', 'team_id'),
      positiveIntegerField('version', 'version'),
      field('title', 'title'),
      field('description', 'description'),
      field('linkUrl', 'link_url'),
      field('attachmentRef', 'attachment_ref'),
      utcDateTimeField('submittedAt', 'submitted_at'),
      utcDateTimeField('adoptedAt', 'adopted_at'),
      field('adoptedByUid', 'adopted_by_uid'),
    ],
    searchColumns: ['problem_id', 'team_id', 'title', 'description', 'link_url'],
  },
  financeRecords: {
    table: 'finance_records',
    fields: [
      field('title', 'title'),
      field('kind', 'record_kind'),
      safeIntegerField('amountCents', 'amount_cents'),
      field('activityId', 'activity_id'),
      field('organizationId', 'organization_id'),
      field('reviewerUid', 'reviewer_uid'),
      utcDateTimeField('reviewedAt', 'reviewed_at'),
      field('reviewDecision', 'review_decision'),
    ],
    searchColumns: ['title', 'record_kind'],
  },
} satisfies Record<string, RepositoryDefinition>;
function escapeLikeQuery(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isDuplicateEntryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062;
}

function validatePageRequest(request: PageRequest): void {
  if (!Number.isInteger(request.page) || request.page < 1) {
    throw new RangeError('page must be an integer greater than or equal to 1');
  }
  if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) {
    throw new RangeError('pageSize must be an integer between 1 and 100');
  }
}

function buildWhere(
  definition: RepositoryDefinition,
  filters: ListFilters,
): { where: string; values: SqlValue[] } {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  for (const key of ['category', 'season', 'organizationId', 'standingActivity'] as const) {
    if (filters[key] === undefined) continue;
    const mapped = definition.fields.find((candidate) => candidate.key === key);
    if (!mapped) {
      clauses.push('1 = 0');
      continue;
    }
    // Match the application's exact string equality, independent of table collation.
    clauses.push(
      key === 'standingActivity'
        ? `${mapped.column} = ?`
        : `CAST(${mapped.column} AS BINARY) = CAST(? AS BINARY)`,
    );
    values.push(filters[key]!);
  }
  if (filters.tag !== undefined) {
    if (definition.fields.some(({ key }) => key === 'tags')) {
      clauses.push('JSON_CONTAINS(tags, ?)');
      values.push(JSON.stringify(filters.tag));
    } else clauses.push('1 = 0');
  }
  if (filters.status) {
    clauses.push('status = ?');
    values.push(filters.status);
  }
  if (filters.scopeType) {
    clauses.push('scope_type = ?');
    values.push(filters.scopeType);
  }
  if (filters.scopeId) {
    clauses.push('scope_id = ?');
    values.push(filters.scopeId);
  }
  if (filters.query?.trim() && definition.searchColumns.length > 0) {
    const query = filters.query.trim().toLocaleLowerCase();
    const textMatch = `LOWER(CONCAT_WS(' ', ${definition.searchColumns.join(', ')})) LIKE ? ESCAPE '\\\\'`;
    values.push(`%${escapeLikeQuery(query)}%`);
    if (definition.table === 'knowledge_entries' || definition.table === 'liaison_problems') {
      // JSON_TABLE unescapes values; LOCATE treats punctuation as literal characters.
      const tagAlias =
        definition.table === 'knowledge_entries' ? 'knowledge_tags' : 'liaison_problem_tags';
      clauses.push(
        `(${textMatch} OR EXISTS (SELECT 1 FROM JSON_TABLE(tags, '$[*]' COLUMNS (tag_value VARCHAR(80) PATH '$')) AS ${tagAlias} WHERE LOCATE(CAST(? AS BINARY), CAST(LOWER(${tagAlias}.tag_value) AS BINARY)) > 0))`,
      );
      values.push(query);
    } else clauses.push(textMatch);
  }
  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

function buildScopedRecordAccess(access: LiaisonProblemVisibility['read']): {
  clause: string;
  values: SqlValue[];
} {
  const allowedIds = [...new Set(access.ids)];
  const deniedIds = [...new Set(access.deniedIds)];
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  if (!access.all) {
    if (allowedIds.length === 0) return { clause: '1 = 0', values };
    clauses.push(`id IN (${allowedIds.map(() => '?').join(', ')})`);
    values.push(...allowedIds);
  }
  if (deniedIds.length > 0) {
    clauses.push(`id NOT IN (${deniedIds.map(() => '?').join(', ')})`);
    values.push(...deniedIds);
  }
  return { clause: clauses.length === 0 ? '1 = 1' : clauses.join(' AND '), values };
}

function buildLiaisonProblemVisibilityWhere(visibility: LiaisonProblemVisibility): {
  clause: string;
  values: SqlValue[];
} {
  const read = buildScopedRecordAccess(visibility.read);
  const maintain = buildScopedRecordAccess(visibility.maintain);
  const review = buildScopedRecordAccess(visibility.review);
  const statuses = [...new Set(visibility.publicStatuses)];
  const publicClause =
    statuses.length === 0 ? '1 = 0' : `status IN (${statuses.map(() => '?').join(', ')})`;
  return {
    clause: `(${read.clause}) AND (${publicClause} OR owner_uid = ? OR (${maintain.clause}) OR (status = ? AND (${review.clause})))`,
    values: [
      ...read.values,
      ...statuses,
      visibility.actorUid,
      ...maintain.values,
      'pending_review',
      ...review.values,
    ],
  };
}

class MySqlRepository<T extends StoredRecord> implements RecordRepository<T> {
  constructor(
    private readonly executor: Executor,
    private readonly definition: RepositoryDefinition,
    private readonly allowRowLock: boolean,
  ) {}

  async create(input: NewRecord<T>): Promise<T> {
    const recordInput = input as RecordInput<T>;
    const id = randomUUID();
    const now = new Date();
    const columns = [
      'id',
      ...this.definition.fields.map(({ column }) => column),
      'status',
      'owner_uid',
      'scope_type',
      'scope_id',
      'created_at',
      'updated_at',
    ];
    const values: SqlValue[] = [
      id,
      ...this.definition.fields.map(({ key, encode }) =>
        toSqlValue(encode ? encode(recordInput[key]) : recordInput[key]),
      ),
      input.status,
      input.ownerUid,
      input.scope.type,
      input.scope.id,
      now,
      now,
    ];
    const placeholders = columns.map(() => '?').join(', ');
    try {
      await this.executor.execute(
        `INSERT INTO ${this.definition.table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    } catch (error) {
      if (this.definition.conflictMessage !== undefined && isDuplicateEntryError(error)) {
        throw new RecordConflictError(this.definition.conflictMessage, { cause: error });
      }
      throw error;
    }
    const created = await this.get(id);
    if (!created) throw new Error(`Failed to read created ${this.definition.table} record`);
    return created;
  }

  async get(id: string): Promise<T | null> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table} WHERE id = ? LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? this.decode(row) : null;
  }

  async getForUpdate(id: string): Promise<T | null> {
    if (!this.allowRowLock) throw new Error('Row locking requires a store transaction');
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table} WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    return row ? this.decode(row) : null;
  }

  async listForUpdate(filters: ListFilters = {}): Promise<T[]> {
    if (!this.allowRowLock) throw new Error('Row locking requires a store transaction');
    const { where, values } = buildWhere(this.definition, filters);
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table}${where} ORDER BY id FOR UPDATE`,
      values,
    );
    return rows.map((row) => this.decode(row));
  }

  async list(filters: ListFilters = {}): Promise<T[]> {
    const { where, values } = buildWhere(this.definition, filters);
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table}${where} ORDER BY created_at DESC, id DESC`,
      values,
    );
    return rows.map((row) => this.decode(row));
  }

  async countActiveByProblemIds(problemIds: readonly string[]): Promise<Record<string, number>> {
    if (this.definition.table !== 'liaison_teams') {
      throw new Error('Team aggregation requires the liaison team repository');
    }
    const requested = [...new Set(problemIds)];
    if (requested.length > 100) throw new RangeError('At most 100 problem ids may be aggregated');
    if (requested.length === 0) return {};
    const placeholders = requested.map(() => '?').join(', ');
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT problem_id, COUNT(*) AS total FROM liaison_teams WHERE status = ? AND problem_id IN (${placeholders}) GROUP BY problem_id`,
      ['active', ...requested],
    );
    return Object.fromEntries(
      rows.map((row) => [String(row.problem_id), Number(row.total)] as const),
    );
  }

  async page(filters: ListFilters | undefined, request: PageRequest): Promise<Page<T>> {
    validatePageRequest(request);
    const { where, values } = buildWhere(this.definition, filters ?? {});
    const [countRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${this.definition.table}${where}`,
      values,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const offset = (request.page - 1) * request.pageSize;
    const [rows] = await this.executor.query<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table}${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, request.pageSize, offset],
    );
    return {
      items: rows.map((row) => this.decode(row)),
      page: request.page,
      pageSize: request.pageSize,
      total,
    };
  }

  async pageVisible(
    filters: ListFilters | undefined,
    request: PageRequest,
    visibility: LiaisonProblemVisibility,
  ): Promise<Page<LiaisonProblemRecord>> {
    if (this.definition.table !== 'liaison_problems') {
      throw new Error('Authorized liaison pagination requires the liaison problem repository');
    }
    validatePageRequest(request);
    const base = buildWhere(this.definition, filters ?? {});
    const authorized = buildLiaisonProblemVisibilityWhere(visibility);
    const where = `${base.where}${base.where === '' ? ' WHERE ' : ' AND '}${authorized.clause}`;
    const values = [...base.values, ...authorized.values];
    const [countRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${this.definition.table}${where}`,
      values,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const offset = (request.page - 1) * request.pageSize;
    const [rows] = await this.executor.query<RowDataPacket[]>(
      `SELECT * FROM ${this.definition.table}${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, request.pageSize, offset],
    );
    return {
      items: rows.map((row) => this.decode(row)) as unknown as LiaisonProblemRecord[],
      page: request.page,
      pageSize: request.pageSize,
      total,
    };
  }
  async update(id: string, patch: RecordPatch<T>): Promise<T | null> {
    const patchRecord = patch as Record<string, unknown>;
    const assignments: string[] = [];
    const values: SqlValue[] = [];
    for (const { key, column, encode } of this.definition.fields) {
      if (!Object.hasOwn(patchRecord, key) || patchRecord[key] === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(toSqlValue(encode ? encode(patchRecord[key]) : patchRecord[key]));
    }
    if (Object.hasOwn(patchRecord, 'status') && patch.status !== undefined) {
      assignments.push('status = ?');
      values.push(patch.status);
    }
    if (Object.hasOwn(patchRecord, 'ownerUid') && patch.ownerUid !== undefined) {
      assignments.push('owner_uid = ?');
      values.push(patch.ownerUid);
    }
    if (Object.hasOwn(patchRecord, 'scope') && patch.scope) {
      assignments.push('scope_type = ?', 'scope_id = ?');
      values.push(patch.scope.type, patch.scope.id);
    }
    if (assignments.length === 0) return this.get(id);
    assignments.push('updated_at = ?');
    values.push(new Date(), id);
    try {
      const [result] = await this.executor.execute<ResultSetHeader>(
        `UPDATE ${this.definition.table} SET ${assignments.join(', ')} WHERE id = ?`,
        values,
      );
      return result.affectedRows > 0 ? this.get(id) : null;
    } catch (error) {
      if (this.definition.conflictMessage !== undefined && isDuplicateEntryError(error)) {
        throw new RecordConflictError(this.definition.conflictMessage, { cause: error });
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const [result] = await this.executor.execute<ResultSetHeader>(
      `DELETE FROM ${this.definition.table} WHERE id = ?`,
      [id],
    );
    return result.affectedRows > 0;
  }

  private decode(row: RowDataPacket): T {
    const record: Record<string, unknown> = {
      id: String(row.id),
      status: String(row.status),
      ownerUid: String(row.owner_uid),
      scope: { type: String(row.scope_type), id: String(row.scope_id) },
      createdAt: decodeUtcDateTime(row.created_at),
      updatedAt: decodeUtcDateTime(row.updated_at),
    };
    for (const { key, column, decode } of this.definition.fields) {
      record[key] = decode?.(row[column]) ?? row[column];
    }
    return record as T;
  }
}

function buildMySqlStore(executor: Executor, pool: Pool, inTransaction: boolean): DevelopmentStore {
  const repository = <T extends StoredRecord>(definition: RepositoryDefinition) =>
    new MySqlRepository<T>(executor, definition, inTransaction);
  const store: DevelopmentStore = {
    async transaction<T>(operation: (transactionStore: DevelopmentStore) => Promise<T>) {
      if (inTransaction) return operation(store);
      const connection = await pool.getConnection();
      let transactionStarted = false;
      try {
        await connection.beginTransaction();
        transactionStarted = true;
        const result = await operation(buildMySqlStore(connection, pool, true));
        await connection.commit();
        return result;
      } catch (error) {
        if (transactionStarted) await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    queryAuditLogs: (query) => queryMySqlAuditLogs(executor, query),
    subjects: repository<SubjectRecord>(definitions.subjects),
    developmentAccess: repository<DevelopmentAccessRecord>(definitions.developmentAccess),
    roles: repository<RoleRecord>(definitions.roles),
    permissions: repository<PermissionRecord>(definitions.permissions),
    rolePermissions: repository<RolePermissionRecord>(definitions.rolePermissions),
    roleAssignments: repository<RoleAssignmentRecord>(definitions.roleAssignments),
    tagDefinitions: repository<TagDefinitionRecord>(definitions.tagDefinitions),
    tagAssignments: repository<TagAssignmentRecord>(definitions.tagAssignments),
    tagPermissions: repository<TagPermissionRecord>(definitions.tagPermissions),
    modules: repository<ModuleRecord>(definitions.modules),
    moduleOwners: repository<ModuleOwnerRecord>(definitions.moduleOwners),
    auditLogs: repository<AuditLogRecord>(definitions.auditLogs),
    knowledge: repository<KnowledgeEntryRecord>(definitions.knowledge),
    announcements: repository<AnnouncementRecord>(definitions.announcements),
    consultations: repository<ConsultationRecord>(definitions.consultations),
    informationReplies: repository<InformationReplyRecord>(definitions.informationReplies),
    informationLikes: repository<InformationLikeRecord>(definitions.informationLikes),
    proposals: repository<ProposalRecord>(definitions.proposals),
    clubs: repository<ClubRecord>(definitions.clubs),
    clubMemberships: repository<ClubMembershipRecord>(definitions.clubMemberships),
    activities: repository<ActivityRecord>(definitions.activities),
    festivalSubmissions: repository<FestivalSubmissionRecord>(definitions.festivalSubmissions),
    activityMilestones: repository<ActivityMilestoneRecord>(definitions.activityMilestones),
    competitionFixtures: repository<CompetitionFixtureRecord>(definitions.competitionFixtures),
    activityRegistrations: repository<ActivityRegistrationRecord>(
      definitions.activityRegistrations,
    ),
    sportsTeams: repository<SportsTeamRecord>(definitions.sportsTeams),
    sportsMatches: repository<SportsMatchRecord>(definitions.sportsMatches),
    sportsTeamShowcases: repository<SportsTeamShowcaseRecord>(definitions.sportsTeamShowcases),
    sportsTeamMembers: repository<SportsTeamMemberRecord>(definitions.sportsTeamMembers),
    sportsCheckins: repository<SportsCheckinRecord>(definitions.sportsCheckins),
    liaisonResources: repository<LiaisonResourceRecord>(definitions.liaisonResources),
    liaisonProblems: repository<LiaisonProblemRecord>(definitions.liaisonProblems),
    liaisonTeams: repository<LiaisonTeamRecord>(definitions.liaisonTeams),
    liaisonTeamMembers: repository<LiaisonTeamMemberRecord>(definitions.liaisonTeamMembers),
    liaisonPosts: repository<LiaisonPostRecord>(definitions.liaisonPosts),
    liaisonOutcomes: repository<LiaisonOutcomeRecord>(definitions.liaisonOutcomes),
    financeRecords: repository<FinanceRecord>(definitions.financeRecords),
  };
  return store;
}

export interface MySqlStoreOptions {
  pool?: Pool;
  config?: MySqlConfig;
  environment?: NodeJS.ProcessEnv;
}

export interface MySqlStoreHandle {
  store: DevelopmentStore;
  pool: Pool;
  getAppliedMigrationCount(): Promise<number>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

async function countAppliedMigrations(pool: Pool): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM development_schema_migrations',
  );
  const count = Number(rows[0]?.total);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('MySQL returned an invalid applied migration count');
  }
  return count;
}
export function buildMySqlPoolOptions(config: MySqlConfig) {
  return { ...config, connectionLimit: 10, dateStrings: true, timezone: 'Z' as const };
}
export function createMySqlStore(options: MySqlStoreOptions = {}): MySqlStoreHandle {
  const pool =
    options.pool ??
    createPool(buildMySqlPoolOptions(options.config ?? loadMySqlConfig(options.environment)));
  return {
    store: buildMySqlStore(pool, pool, false),
    pool,
    getAppliedMigrationCount: () => countAppliedMigrations(pool),
    checkReadiness: () => checkMySqlReadiness(pool),
    close: () => pool.end(),
  };
}
