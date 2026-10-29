import {
  canGrantClassSecretaries,
  isDevelopmentBusinessAdmin,
  secretaryClassIds,
} from '@freebbs-development/contracts';
import type {
  OrganizationGroupAnswer,
  OrganizationGroupDeadline,
  OrganizationGroupEntry,
  OrganizationGroupEntryQuery,
  OrganizationGroupEntryValues,
  OrganizationGroupFile,
  OrganizationGroupMember,
  OrganizationGroupResource,
  OrganizationGroupScope,
  OrganizationGroupSettings,
  OrganizationGroupVersion,
  OrganizationGroupVersionInput,
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
  UserContext,
} from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';

export const WORKSPACE_ID = 'youth_league.organization';
export const now = () => new Date().toISOString();
export const ACTIVITY_PHOTO_LIMIT = 5;
export const ACTIVITY_PHOTO_BYTES = 5 * 1024 ** 2;
export function classActivityTemplate(): OrganizationGroupVersionInput {
  return {
    template: 'class_activity_v2',
    activityTypes: [
      ['theme_day', '主题团日'],
      ['branch_work', '支部事业'],
      ['social_practice', '社会实践'],
      ['volunteering', '志愿服务'],
      ['study', '学风建设'],
      ['sports', '体育建设'],
      ['aesthetics', '美育建设'],
      ['party_youth', '党团共建'],
      ['publicity', '宣传成果'],
    ].map(([id, label]) => ({ id: id!, label: label! })),
    fields: [],
    corePresentation: {
      classId: { label: '班级' },
      participantCount: { label: '参与人数' },
      activityDate: { label: '活动时间' },
      activityTypeId: { label: '活动标签' },
      activityTypeIds: { label: '活动标签' },
      summary: { label: '活动内容', help: '200 字以内' },
      photos: { label: '活动照片', help: '选填，最多 5 张，每张不超过 5 MiB' },
      difficulties: { label: '备注' },
      participantNames: { label: '具体参与人员', help: '请填写本次活动的具体参与人员' },
    },
  };
}
export interface StoredAsset extends OrganizationGroupFile {
  ownerUid: string;
  binding: { kind: 'entry' | 'resource'; id: string } | null;
}
export interface StoredEntry extends Omit<
  OrganizationGroupEntry,
  'classLabel' | 'activityTypeLabel' | 'photos' | 'extraPhotos' | 'canEdit' | 'editBlockedReason'
> {
  photoIds: string[];
  extraPhotoIds: string[];
  difficulties: string;
}
export type StoredDeadline = Omit<OrganizationGroupDeadline, 'displayStatus'>;
export type StoredResource = Omit<OrganizationGroupResource, 'file'>;
export interface OrganizationState {
  id: string;
  revision: number;
  settings: OrganizationGroupSettings;
  classes: Array<{ id: string; label: string }>;
  members: OrganizationGroupMember[];
  managerUids: string[];
  years: OrganizationGroupYear[];
  versions: OrganizationGroupVersion[];
  assets: StoredAsset[];
  entries: StoredEntry[];
  deadlines: StoredDeadline[];
  resources: StoredResource[];
  retries: Array<{ uid: string; key: string; digest: string; entryId: string }>;
  audit: Array<{
    at: string;
    uid: string;
    action: string;
    targetId: string;
    revision: number;
    changes?: Record<string, { before: unknown; after: unknown }>;
  }>;
}
export function initialState(): OrganizationState {
  const initialVersion: OrganizationGroupVersion = {
    ...classActivityTemplate(),
    id: 'a54c0c28-2a2e-4ce6-a42d-202620270001',
    yearId: '2026-2027',
    number: 1,
    publishedAt: now(),
    publishedBy: 'system',
  };
  return {
    id: WORKSPACE_ID,
    revision: 1,
    settings: {
      activeYearId: '2026-2027',
      viewScope: { kind: 'own' },
      hideDifficulties: false,
      ordinaryExport: false,
      maxPhotos: ACTIVITY_PHOTO_LIMIT,
      maxPhotoBytes: ACTIVITY_PHOTO_BYTES,
      maxResourceBytes: 50 * 1024 ** 2,
    },
    classes: [],
    members: [],
    managerUids: [],
    years: [
      {
        id: '2026-2027',
        label: '2026—2027',
        revision: 1,
        startDate: null,
        endDate: null,
        archived: false,
        submissionOpen: true,
        editOpen: true,
        currentVersionId: initialVersion.id,
        draft: null,
      },
    ],
    versions: [initialVersion],
    assets: [],
    entries: [],
    deadlines: [],
    resources: [],
    retries: [],
    audit: [],
  };
}
export function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
function globalCounselor(
  user: UserContext,
  roles = user.roles.filter((role) => role.startsWith('counselor.')),
) {
  const appointments = (user as AuthorizationContext).roleScopes;
  if (appointments === undefined) return roles.some((role) => user.roles.includes(role));
  return appointments.some(
    (row) =>
      row.subjectUid === user.uid &&
      roles.includes(row.roleKey) &&
      user.roles.includes(row.roleKey) &&
      row.scope.type === 'public' &&
      row.scope.id === '*' &&
      (row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()),
  );
}
const businessSupervisor = (user: UserContext) =>
  isDevelopmentBusinessAdmin(user) ||
  globalCounselor(user, ['counselor.youth_league_secretary', 'counselor.youth_league']);
export const grantAdministrator = (user: UserContext) =>
  businessSupervisor(user) && !user.previewing;
export const manages = (s: OrganizationState, user: UserContext) =>
  businessSupervisor(user) || s.managerUids.includes(user.uid);
export const departmentMember = (user: UserContext) =>
  user.roles.some((role) =>
    [
      'youth_league.organization.member',
      'youth_league.organization.leader',
      'youth_league.organization.deputy_secretary',
    ].includes(role),
  ) && canGrantClassSecretaries({ ...user, previewing: false });
export const viewsAll = (s: OrganizationState, user: UserContext) =>
  manages(s, user) || departmentMember(user) || globalCounselor(user);
export const submitClasses = (s: OrganizationState, user: UserContext) =>
  secretaryClassIds(user).filter((id) => s.classes.some((row) => row.id === id));
export function member(s: OrganizationState, user: UserContext) {
  return s.members.find(
    (row) => row.uid === user.uid && Boolean(user.studentId) && row.studentId === user.studentId,
  );
}
export const moduleAccess = (s: OrganizationState, user: UserContext) =>
  viewsAll(s, user) || Boolean(member(s, user)) || secretaryClassIds(user).length > 0;
export function requireAccess(s: OrganizationState, user: UserContext) {
  if (!moduleAccess(s, user))
    fail(403, 'module_forbidden', '尚未配置您的组织组访问范围，请联系管理者');
}
export function requireManager(s: OrganizationState, user: UserContext) {
  if (user.previewing || !manages(s, user))
    fail(403, 'forbidden', '只有已授权的组织组管理者可以操作');
}
export function revision(current: number, expected: number) {
  if (current !== expected) fail(409, 'revision_conflict', '页面已更新，请重新加载后再保存');
}
export function year(s: OrganizationState, id: string) {
  const value = s.years.find((row) => row.id === id);
  if (!value) fail(404, 'not_found', '未找到学年');
  return value;
}
export function version(s: OrganizationState, id: string) {
  const value = s.versions.find((row) => row.id === id);
  if (!value) fail(404, 'not_found', '未找到问卷版本');
  return value;
}
export function audit(
  s: OrganizationState,
  user: UserContext,
  action: string,
  targetId: string,
  value: number,
  before?: object,
  after?: object,
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (before && after)
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const previous = (before as Record<string, unknown>)[name];
      const next = (after as Record<string, unknown>)[name];
      if (JSON.stringify(previous) !== JSON.stringify(next))
        changes[name] = { before: previous ?? null, after: next ?? null };
    }
  s.audit.push({
    at: now(),
    uid: user.uid,
    action,
    targetId,
    revision: value,
    ...(before && after ? { changes } : {}),
  });
}
export function submissionReason(
  s: OrganizationState,
  user: UserContext,
  y: OrganizationGroupYear,
): string | null {
  if (user.previewing) return '预览模式不能填报活动';
  if (!moduleAccess(s, user)) return '尚未配置访问权限';
  if (y.archived) return '该学年已归档';
  if (!y.submissionOpen) return '新活动填报已关闭';
  if (!y.currentVersionId) return '管理者尚未发布问卷';
  if (!submitClasses(s, user).length) return '尚未为您授予已配置班级的团支书身份，请联系组织组';
  return null;
}
export function editReason(s: OrganizationState, user: UserContext, e: StoredEntry): string | null {
  if (user.previewing) return '预览模式不能修改活动';
  if (e.authorUid !== user.uid) return '只能修改本人记录';
  if (!visibleEntry(s, user, e)) return '当前无权查看该记录';
  if (year(s, e.yearId).archived) return '该学年已归档';
  if (!year(s, e.yearId).editOpen) return '记录修改已关闭';
  if (e.locked) return '该记录已锁定';
  if (!submitClasses(s, user).includes(e.classId)) return '已不在允许填报的班级范围';
  return null;
}
export function visibleEntry(s: OrganizationState, user: UserContext, e: StoredEntry) {
  if (!moduleAccess(s, user)) return false;
  if (viewsAll(s, user)) return true;
  // Historical view settings must never turn a secretary's own ledger into a shared ledger.
  return e.authorUid === user.uid;
}
export function visibleScope(
  s: OrganizationState,
  user: UserContext,
  scope: OrganizationGroupScope,
) {
  if (!moduleAccess(s, user)) return false;
  if (manages(s, user)) return true;
  if (scope.kind === 'all') return true;
  if (scope.kind === 'department') return departmentMember(user);
  if (scope.kind === 'users') return scope.ids.includes(user.uid);
  const row = member(s, user);
  return (
    scope.kind === 'classes' &&
    (submitClasses(s, user).some((id) => scope.ids.includes(id)) ||
      Boolean(row && scope.ids.includes(row.classId)))
  );
}
export function validateScope(s: OrganizationState, scope: OrganizationGroupScope) {
  if (scope.kind === 'classes' && scope.ids.some((id) => !s.classes.some((row) => row.id === id)))
    fail(400, 'invalid_scope', '可见范围包含未知班级');
  if (
    scope.kind === 'users' &&
    scope.ids.some((id) => !s.members.some((row) => row.uid === id) && !s.managerUids.includes(id))
  )
    fail(400, 'invalid_scope', '可见范围包含未配置用户');
}
export function visibleResource(s: OrganizationState, user: UserContext, resource: StoredResource) {
  if (!visibleScope(s, user, resource.scope)) return false;
  if (!resource.deadlineId) return true;
  const parent = s.deadlines.find((row) => row.id === resource.deadlineId);
  return Boolean(
    parent && parent.yearId === resource.yearId && visibleScope(s, user, parent.scope),
  );
}
export function fileDto(asset: StoredAsset): OrganizationGroupFile {
  return {
    id: asset.id,
    originalName: asset.originalName,
    mime: asset.mime,
    size: asset.size,
    previewable: asset.previewable,
    purpose: asset.purpose,
    yearId: asset.yearId,
    createdAt: asset.createdAt,
  };
}
export function entryDto(
  s: OrganizationState,
  user: UserContext,
  e: StoredEntry,
  editable = false,
): OrganizationGroupEntry {
  const { photoIds, extraPhotoIds, ...values } = e;
  const activityTypeIds = entryTypeIds(e);
  const activityTypeLabels = activityTypeIds.map(
    (id) => version(s, e.versionId).activityTypes.find((row) => row.id === id)?.label ?? id,
  );
  const dto: OrganizationGroupEntry = {
    ...values,
    activityTypeIds,
    activityTypeLabels,
    participantNames: e.participantNames ?? '',
    classLabel: s.classes.find((row) => row.id === e.classId)?.label ?? e.classId,
    activityTypeLabel: activityTypeLabels.join('、'),
    photos: s.assets.filter((row) => photoIds.includes(row.id)).map(fileDto),
    extraPhotos: s.assets.filter((row) => extraPhotoIds.includes(row.id)).map(fileDto),
    canEdit: !editReason(s, user, e),
    editBlockedReason: editReason(s, user, e),
  };
  if (s.settings.hideDifficulties && !viewsAll(s, user) && !editable) delete dto.difficulties;
  return dto;
}
export function workspaceDto(s: OrganizationState, user: UserContext): OrganizationGroupWorkspace {
  const manager = manages(s, user);
  const own = member(s, user);
  const y = year(s, s.settings.activeYearId);
  const reason = submissionReason(s, user, y);
  return {
    ...s.settings,
    revision: s.revision,
    departmentId: WORKSPACE_ID,
    classes: s.classes,
    members: manager ? s.members : own ? [own] : [],
    managerUids: manager ? s.managerUids : [],
    years: s.years.map((row) => ({ ...row, draft: manager ? row.draft : null })),
    versions: s.versions,
    canManage: manager,
    canViewAll: viewsAll(s, user),
    canGrantSecretaries: canGrantClassSecretaries(user) && !user.previewing,
    canGrantManagers: grantAdministrator(user),
    canExport: viewsAll(s, user) || (moduleAccess(s, user) && s.settings.ordinaryExport),
    allowedSubmitClassIds: submitClasses(s, user),
    setupRequired: !s.classes.length || !y.currentVersionId,
    canSubmit: reason === null,
    submissionBlockedReason: reason,
  };
}
export function deadlineDto(d: StoredDeadline): OrganizationGroupDeadline {
  return {
    ...d,
    displayStatus:
      d.status === 'cancelled'
        ? 'cancelled'
        : Date.parse(d.dueAt) <= Date.now()
          ? 'expired'
          : 'upcoming',
  };
}
export function resourceDto(s: OrganizationState, r: StoredResource): OrganizationGroupResource {
  const asset = s.assets.find((a) => a.id === r.fileId);
  if (!asset) fail(503, 'asset_unavailable', '资料文件不可用');
  return { ...r, file: fileDto(asset) };
}
export function validateDateBounds(y: OrganizationGroupYear, date: string | null | undefined) {
  if (date && ((y.startDate && date < y.startDate) || (y.endDate && date > y.endDate)))
    fail(400, 'activity_date_out_of_year', '活动日期超出配置的学年范围');
}
export function validateValues(
  s: OrganizationState,
  user: UserContext,
  y: OrganizationGroupYear,
  v: OrganizationGroupVersion,
  values: OrganizationGroupEntryValues,
) {
  if (!s.classes.some((row) => row.id === values.classId))
    fail(400, 'invalid_class', '请选择已配置班级');
  if (!submitClasses(s, user).includes(values.classId))
    fail(403, 'class_forbidden', '无权为该班级填报');
  const typeIds = entryTypeIds(values);
  if (
    !typeIds.length ||
    new Set(typeIds).size !== typeIds.length ||
    typeIds.some((id) => !v.activityTypes.some((row) => row.id === id))
  )
    fail(400, 'invalid_activity_type', '请选择原版本中有效的活动类型');
  if (!values.summary.trim() || Array.from(values.summary).length > 200) {
    const label =
      v.corePresentation?.summary?.label ??
      (v.template === 'class_activity_v2' ? '活动内容' : '活动简述');
    fail(400, 'invalid_summary', `${label}必填且最多 200 个字符（包含空格与换行）`);
  }
  validateDateBounds(y, values.activityDate);
  if (v.template === 'class_activity_v2') {
    if (!values.activityDate) fail(400, 'activity_date_required', '请填写活动时间');
    if (!values.participantNames?.trim() || Array.from(values.participantNames).length > 4000)
      fail(
        400,
        'participant_names_required',
        `${v.corePresentation?.participantNames?.label ?? '具体参与人员'}必填且最多 4000 字`,
      );
  }
  if (
    (v.template !== 'class_activity_v2' && values.photoIds.length < 1) ||
    values.photoIds.length > photoLimit(s, v) ||
    new Set(values.photoIds).size !== values.photoIds.length
  )
    fail(400, 'invalid_photos', `照片数量须在允许范围内，最多 ${photoLimit(s, v)} 张`);
  const answers = values.extraAnswers ?? {};
  const extraPhotos: string[] = [];
  if (Object.keys(answers).some((id) => !v.fields.some((f) => f.id === id)))
    fail(400, 'unknown_answer', '答案包含原版本不存在的字段');
  for (const field of v.fields) {
    const answer: OrganizationGroupAnswer | undefined = answers[field.id];
    const empty =
      answer === undefined || answer === '' || (Array.isArray(answer) && !answer.length);
    if (empty) {
      if (field.required) fail(400, 'required_answer', `请填写${field.label}`);
      continue;
    }
    if (field.kind === 'integer') {
      if (
        typeof answer !== 'number' ||
        !Number.isSafeInteger(answer) ||
        (field.min !== undefined && answer < field.min) ||
        (field.max !== undefined && answer > field.max)
      )
        fail(400, 'invalid_answer', `${field.label}须为规定范围内的整数`);
    } else if (field.kind === 'multi_choice' || field.kind === 'image') {
      if (
        !Array.isArray(answer) ||
        new Set(answer).size !== answer.length ||
        answer.some((x) => typeof x !== 'string')
      )
        fail(400, 'invalid_answer', `${field.label}答案无效`);
      if (field.kind === 'multi_choice' && answer.some((x) => !field.options?.includes(x)))
        fail(400, 'invalid_answer', `${field.label}包含无效选项`);
      if (field.kind === 'image') {
        if (answer.length > photoLimit(s, v)) fail(400, 'invalid_answer', `${field.label}照片过多`);
        extraPhotos.push(...answer);
      }
    } else {
      if (
        typeof answer !== 'string' ||
        Array.from(answer).length > (field.maxLength ?? (field.kind === 'long_text' ? 4000 : 500))
      )
        fail(400, 'invalid_answer', `${field.label}答案长度或格式无效`);
      if (field.kind === 'choice' && !field.options?.includes(answer))
        fail(400, 'invalid_answer', `${field.label}选项无效`);
      if (field.kind === 'date' && !validDate(answer))
        fail(400, 'invalid_answer', `${field.label}日期无效`);
    }
  }
  if (
    new Set([...values.photoIds, ...extraPhotos]).size !==
      values.photoIds.length + extraPhotos.length ||
    values.photoIds.length + extraPhotos.length >
      (v.template === 'class_activity_v2' ? photoLimit(s, v) : 60)
  )
    fail(
      400,
      'invalid_photos',
      `照片不能重复使用，单条记录照片总数最多 ${v.template === 'class_activity_v2' ? photoLimit(s, v) : 60} 张`,
    );
  if (
    v.template === 'class_activity_v2' &&
    [...values.photoIds, ...extraPhotos].some(
      (id) => (s.assets.find((asset) => asset.id === id)?.size ?? 0) > photoBytes(s, v),
    )
  )
    fail(400, 'file_too_large', '每张活动照片不得超过 5 MiB');
  return extraPhotos;
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function bindAssets(
  s: OrganizationState,
  user: UserContext,
  ids: string[],
  yearId: string,
  purpose: StoredAsset['purpose'],
  kind: 'entry' | 'resource',
  targetId: string,
  entryVersion?: OrganizationGroupVersion,
) {
  if (purpose === 'activity_photo' && (!entryVersion || entryVersion.yearId !== yearId))
    fail(500, 'missing_photo_version', '活动照片绑定缺少对应问卷版本');
  const maximumBytes =
    purpose === 'activity_photo' ? photoBytes(s, entryVersion!) : s.settings.maxResourceBytes;
  for (const id of ids) {
    const a = s.assets.find((row) => row.id === id);
    if (
      !a ||
      a.purpose !== purpose ||
      a.yearId !== yearId ||
      a.ownerUid !== user.uid ||
      (!a.binding && Date.parse(a.createdAt) < Date.now() - 7 * 86400000) ||
      (a.binding && (a.binding.kind !== kind || a.binding.id !== targetId))
    )
      fail(403, 'asset_forbidden', '附件用途、学年、拥有者、保留期限或绑定记录不匹配');
    if (a.size > maximumBytes) fail(400, 'file_too_large', '附件超过当前配置大小限制');
  }
  for (const id of ids) s.assets.find((row) => row.id === id)!.binding = { kind, id: targetId };
}
export function filteredEntries(
  s: OrganizationState,
  user: UserContext,
  query: OrganizationGroupEntryQuery,
) {
  const q = query.query?.toLocaleLowerCase() ?? '';
  const seeDifficulties = !s.settings.hideDifficulties || viewsAll(s, user);
  const rows = s.entries.filter(
    (e) =>
      visibleEntry(s, user, e) &&
      e.yearId === (query.yearId ?? s.settings.activeYearId) &&
      (!query.classId || e.classId === query.classId) &&
      (!query.activityTypeId || entryTypeIds(e).includes(query.activityTypeId)) &&
      (!query.authorUid || e.authorUid === query.authorUid) &&
      (!query.dateFrom || Boolean(e.activityDate && e.activityDate >= query.dateFrom)) &&
      (!query.dateTo || Boolean(e.activityDate && e.activityDate <= query.dateTo)) &&
      (!q ||
        `${e.summary} ${e.participantNames ?? ''} ${seeDifficulties ? e.difficulties : ''} ${Object.values(e.extraAnswers).join(' ')}`
          .toLocaleLowerCase()
          .includes(q)),
  );
  const sort = query.sort ?? 'created_desc';
  rows.sort((a, b) => {
    let delta = 0;
    if (sort.startsWith('participants')) delta = a.participantCount - b.participantCount;
    else if (sort.startsWith('date'))
      delta = (a.activityDate ?? '').localeCompare(b.activityDate ?? '');
    else delta = a.createdAt.localeCompare(b.createdAt);
    if (sort.endsWith('desc')) delta *= -1;
    return delta || a.id.localeCompare(b.id);
  });
  return rows;
}
export function statistics(rows: StoredEntry[]) {
  const byClass: Record<string, number> = Object.create(null) as Record<string, number>;
  const byActivityType: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const e of rows) {
    byClass[e.classId] = (byClass[e.classId] ?? 0) + 1;
    for (const id of entryTypeIds(e)) byActivityType[id] = (byActivityType[id] ?? 0) + 1;
  }
  return {
    activityCount: rows.length,
    participantTimes: rows.reduce((sum, e) => sum + e.participantCount, 0),
    byClass,
    byActivityType,
  };
}
export function entryTypeIds(e: { activityTypeId?: string; activityTypeIds?: string[] }): string[] {
  return e.activityTypeIds ?? (e.activityTypeId ? [e.activityTypeId] : []);
}
export function photoLimit(s: OrganizationState, v: OrganizationGroupVersion) {
  return v.template === 'class_activity_v2' ? ACTIVITY_PHOTO_LIMIT : s.settings.maxPhotos;
}
export function photoBytes(s: OrganizationState, v: OrganizationGroupVersion) {
  return v.template === 'class_activity_v2' ? ACTIVITY_PHOTO_BYTES : s.settings.maxPhotoBytes;
}
