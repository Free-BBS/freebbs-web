import type {
  ApiEnvelope,
  CollectionFormSummary,
  CollectionOutput,
  CollectionRule,
  CollectionResponseSummary,
  CollectionSchema,
  CollectionsDashboardPayload,
  ShowcaseArticle,
  SocialOrganizationId,
  UnifiedRegistration,
} from '@freebbs-development/contracts';
import { organizationById, organizationForRole } from '@freebbs-development/contracts';
import { Router } from 'express';
import multer from 'multer';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  CollectionAssetRecord,
  CollectionFormRecord,
  DevelopmentStore,
  ShowcaseArticleRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  canCreateCollection,
  canManageCollection,
  canManageCollectionModuleLibrary,
} from './access.js';
import { deleteCollectionUpload, readCollectionUpload, storeCollectionUpload } from './uploads.js';
import {
  articleRouteSchema,
  formCreateSchema,
  formDraftSchema,
  formRouteSchema,
  moduleDefinitionCreateSchema,
  responseSchema,
} from './schemas.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;
export interface CollectionsRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  uploadDirectory?: string;
  nodeEnvironment?: 'development' | 'test' | 'production';
}
interface ErrorData {
  error: { code: string; message: string };
}

function send<T>(response: Response, statusCode: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(statusCode).json(envelope);
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', '请求内容不完整或格式不正确');
  return result.data;
}

async function requireActor(
  options: CollectionsRouterOptions,
  request: Request,
  response: Response,
): Promise<AuthorizationContext | null> {
  const result = await options.authenticate(request.headers);
  if (result.status === 200) return result.user;
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
  return null;
}

const UPLOAD_FIELD_KINDS = new Set(['file', 'image', 'video', 'audio']);
const PENDING_ASSET_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_ASSETS_PER_USER = 20;

function actorOrganizations(actor: AuthorizationContext): SocialOrganizationId[] {
  return [
    ...new Set(
      actor.roles
        .map((role) => organizationForRole(role)?.organizationId)
        .filter((value): value is SocialOrganizationId => value !== undefined),
    ),
  ];
}

function resolveOrganization(
  actor: AuthorizationContext,
  requested: SocialOrganizationId | null,
): SocialOrganizationId | null {
  if (actor.roles.includes('platform.super_admin')) return requested;
  const organizations = actorOrganizations(actor);
  if (requested !== null) {
    if (!organizations.includes(requested))
      throw new HttpError(403, 'forbidden', '不能以未加入的组织创建或维护表单');
    return requested;
  }
  if (organizations.length === 1) return organizations[0] ?? null;
  if (organizations.length > 1)
    throw new HttpError(400, 'organization_required', '请选择本次表单所属的组织');
  return null;
}

function audienceAllows(actor: AuthorizationContext, schema: CollectionSchema): boolean {
  const rule = schema.formRules.find((item) => item.kind === 'audience');
  if (!rule || rule.value === 'all' || rule.value === true) return true;
  const organizations = actorOrganizations(actor);
  if (rule.value === 'social_org') return organizations.length > 0;
  if (typeof rule.value === 'string')
    return organizations.includes(rule.value as SocialOrganizationId);
  if (Array.isArray(rule.value))
    return rule.value.some((organizationId) =>
      organizations.includes(organizationId as SocialOrganizationId),
    );
  return false;
}

function scheduleBoundary(schema: CollectionSchema, key: 'start' | 'end'): string | null {
  const rule = schema.formRules.find((item) => item.kind === 'schedule');
  if (!rule || typeof rule.value !== 'object' || Array.isArray(rule.value)) return null;
  if ('mode' in rule.value) return null;
  const value = rule.value[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function effectiveWindow(form: CollectionFormRecord, schema: CollectionSchema) {
  const starts = [form.opensAt, scheduleBoundary(schema, 'start')]
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  const ends = [form.closesAt, scheduleBoundary(schema, 'end')]
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  return {
    opensAt:
      starts.length > 0
        ? new Date(Math.max(...starts.map((value) => value.getTime()))).toISOString()
        : null,
    closesAt:
      ends.length > 0
        ? new Date(Math.min(...ends.map((value) => value.getTime()))).toISOString()
        : null,
  };
}

function nativeStatus(
  form: CollectionFormRecord,
  schema: CollectionSchema,
  now = new Date(),
): UnifiedRegistration['status'] {
  if (form.status !== 'published') return 'closed';
  const window = effectiveWindow(form, schema);
  if (window.opensAt && new Date(window.opensAt) > now) return 'upcoming';
  if (window.closesAt && new Date(window.closesAt) < now) return 'closed';
  return 'open';
}

function canViewCollection(
  actor: AuthorizationContext,
  form: CollectionFormRecord,
  schema: CollectionSchema,
): boolean {
  return canManageCollection(actor, form.ownerUid) || audienceAllows(actor, schema);
}

async function formSummary(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  form: CollectionFormRecord,
): Promise<CollectionFormSummary> {
  const [responses, version] = await Promise.all([
    store.collectionResponses.list({ query: form.id }),
    form.publishedVersionId
      ? store.collectionVersions.get(form.publishedVersionId)
      : form.currentDraftVersionId
        ? store.collectionVersions.get(form.currentDraftVersionId)
        : Promise.resolve(null),
  ]);
  const window = version
    ? effectiveWindow(form, version.schema)
    : { opensAt: form.opensAt, closesAt: form.closesAt };
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    coverUrl: form.coverUrl,
    organizationId: form.organizationId,
    status: form.status as CollectionFormSummary['status'],
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    capacity: form.capacity,
    responseCount: responses.filter(
      (item) => item.formId === form.id && item.status === 'submitted',
    ).length,
    canManage: canManageCollection(actor, form.ownerUid),
    ...(version ? { schema: version.schema } : {}),
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  };
}

async function registrationFromForm(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  form: CollectionFormRecord,
): Promise<UnifiedRegistration | null> {
  if (!form.publishedVersionId) return null;
  const [version, responses] = await Promise.all([
    store.collectionVersions.get(form.publishedVersionId),
    store.collectionResponses.list({ query: form.id }),
  ]);
  if (!version) return null;
  if (!canViewCollection(actor, form, version.schema)) return null;
  const window = effectiveWindow(form, version.schema);
  const activeResponses = responses.filter(
    (item) => item.formId === form.id && item.status === 'submitted',
  );
  return {
    id: form.id,
    source: 'native_collection',
    title: form.title,
    description: form.description,
    organizer: form.organizationId ? organizationById(form.organizationId).name : 'FREE-BBS',
    organizationId: form.organizationId,
    coverUrl: form.coverUrl,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    location: null,
    capacity: form.capacity,
    registrationCount: activeResponses.length,
    registered: activeResponses.some((item) => item.respondentUid === actor.uid),
    status: nativeStatus(form, version.schema),
    schema: version.schema,
  };
}

async function articleView(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  article: ShowcaseArticleRecord,
): Promise<ShowcaseArticle> {
  const likes = (await store.showcaseLikes.list({ query: article.id })).filter(
    (like) => like.articleId === article.id && like.status === 'active',
  );
  return {
    id: article.id,
    title: article.title,
    excerpt: article.excerpt,
    body: article.body,
    coverUrl: article.coverUrl,
    externalUrl: article.externalUrl,
    organizationName: article.organizationId
      ? organizationById(article.organizationId).name
      : 'FREE-BBS',
    publishedAt: article.publishedAt,
    likeCount: likes.length,
    liked: likes.some((like) => like.userUid === actor.uid),
  };
}

function readLimit(schema: CollectionSchema, kind: 'attempt_limit' | 'capacity'): number | null {
  const rule = schema.formRules.find((item) => item.kind === kind);
  return typeof rule?.value === 'number' ? rule.value : null;
}

function validateTitleText(
  fieldLabel: string,
  value: string,
  ruleValue: CollectionRule['value'],
): void {
  if (
    typeof ruleValue === 'object' &&
    !Array.isArray(ruleValue) &&
    'mode' in ruleValue &&
    ruleValue.mode === 'title_validation'
  ) {
    const checked = ruleValue.trimWhitespace ? value.trim() : value;
    const length = [...checked].length;
    if (length < ruleValue.minLength)
      throw new HttpError(
        400,
        'title_too_short',
        `“${fieldLabel}”至少需要 ${ruleValue.minLength} 个字符`,
      );
    if (length > ruleValue.maxLength)
      throw new HttpError(
        400,
        'title_too_long',
        `“${fieldLabel}”不能超过 ${ruleValue.maxLength} 个字符`,
      );
    if (!ruleValue.allowLineBreaks && /[\r\n]/u.test(checked))
      throw new HttpError(400, 'title_line_break', `“${fieldLabel}”不能包含换行`);
    const forbiddenCharacter = [...ruleValue.forbiddenCharacters].find(
      (character) => character !== ' ' && checked.includes(character),
    );
    if (forbiddenCharacter)
      throw new HttpError(
        400,
        'title_forbidden_character',
        `“${fieldLabel}”不能包含字符“${forbiddenCharacter}”`,
      );
    const forbiddenWord = ruleValue.forbiddenWords.find((word) => checked.includes(word));
    if (forbiddenWord)
      throw new HttpError(
        400,
        'title_forbidden_word',
        `“${fieldLabel}”包含禁用词“${forbiddenWord}”`,
      );
    return;
  }
  if (typeof ruleValue !== 'string') return;
  let pattern: RegExp;
  try {
    pattern = new RegExp(ruleValue);
  } catch {
    throw new HttpError(400, 'invalid_title_rule', '标题校验规则无效');
  }
  if (!pattern.test(value))
    throw new HttpError(400, 'title_validation_failed', `“${fieldLabel}”未通过标题校验`);
}

function validateAnswers(schema: CollectionSchema, answers: Record<string, unknown>): void {
  const answerableFields = new Map(
    schema.fields
      .filter((field) => field.kind !== 'instructions' && field.kind !== 'identity')
      .map((field) => [field.id, field]),
  );
  for (const fieldId of Object.keys(answers)) {
    if (!answerableFields.has(fieldId))
      throw new HttpError(400, 'unknown_field', `回答中包含未知字段“${fieldId}”`);
  }
  for (const field of schema.fields) {
    if (field.kind === 'instructions' || field.kind === 'identity') continue;
    const value = answers[field.id];
    const required = field.rules.some((rule) => rule.kind === 'required' && rule.value === true);
    if (
      required &&
      (value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0))
    ) {
      throw new HttpError(400, 'required_answer_missing', `“${field.label}”尚未填写`);
    }
    if (value === undefined || value === null || value === '') continue;
    if ((field.kind === 'short_text' || field.kind === 'long_text') && typeof value !== 'string') {
      throw new HttpError(400, 'invalid_answer', `“${field.label}”需要填写文字`);
    }
    if (field.kind === 'datetime') {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/u.test(
          value,
        ) ||
        Number.isNaN(Date.parse(value))
      ) {
        throw new HttpError(400, 'invalid_answer', `“${field.label}”的日期时间格式无效`);
      }
    }
    if (field.kind === 'multiple_choice') {
      if (
        !Array.isArray(value) ||
        value.some((choice) => typeof choice !== 'string' || !field.options.includes(choice)) ||
        new Set(value).size !== value.length
      ) {
        throw new HttpError(400, 'invalid_answer', `“${field.label}”需要选择有效选项`);
      }
    }
    if (
      field.kind === 'single_choice' &&
      (typeof value !== 'string' || !field.options.includes(value))
    ) {
      throw new HttpError(400, 'invalid_answer', `“${field.label}”的选项无效`);
    }
    if (UPLOAD_FIELD_KINDS.has(field.kind)) {
      const assets = Array.isArray(value) ? value : [value];
      const uploadLimit = field.rules.find((rule) => rule.kind === 'upload_count')?.value;
      if (typeof uploadLimit === 'number' && assets.length > uploadLimit) {
        throw new HttpError(400, 'upload_count_exceeded', `“${field.label}”的文件数量超过上限`);
      }
      const allowedTypes = field.rules.find((rule) => rule.kind === 'file_types')?.value;
      const sizeLimit = field.rules.find((rule) => rule.kind === 'file_size')?.value;
      for (const asset of assets) {
        if (!asset || typeof asset !== 'object')
          throw new HttpError(400, 'invalid_asset', `“${field.label}”的文件记录无效`);
        const record = asset as {
          id?: unknown;
          name?: unknown;
          mimeType?: unknown;
          sizeBytes?: unknown;
          url?: unknown;
        };
        if (
          typeof record.id !== 'string' ||
          typeof record.name !== 'string' ||
          typeof record.mimeType !== 'string' ||
          typeof record.sizeBytes !== 'number' ||
          record.url !== `/api/development/v1/collections/assets/${record.id}`
        ) {
          throw new HttpError(400, 'invalid_asset', `“${field.label}”的文件记录无效`);
        }
        if (
          Array.isArray(allowedTypes) &&
          allowedTypes.length > 0 &&
          !allowedTypes.includes(record.mimeType)
        ) {
          throw new HttpError(400, 'unsupported_file_type', `“${field.label}”含有不支持的文件格式`);
        }
        if (typeof sizeLimit === 'number' && record.sizeBytes > sizeLimit) {
          throw new HttpError(400, 'upload_too_large', `“${field.label}”含有超过大小上限的文件`);
        }
      }
    }
    const titleRule = field.rules.find((rule) => rule.kind === 'title_pattern');
    if (titleRule) {
      const titles =
        typeof value === 'string'
          ? [value]
          : UPLOAD_FIELD_KINDS.has(field.kind)
            ? (Array.isArray(value) ? value : [value])
                .map((asset) =>
                  asset && typeof asset === 'object' && 'name' in asset
                    ? (asset as { name?: unknown }).name
                    : null,
                )
                .filter((name): name is string => typeof name === 'string')
            : [];
      for (const title of titles) validateTitleText(field.label, title, titleRule.value);
    }
  }
}

function assetPayload(asset: CollectionAssetRecord) {
  return {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    url: `/api/development/v1/collections/assets/${asset.id}`,
  };
}

async function validateAssetAnswers(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  form: CollectionFormRecord,
  schema: CollectionSchema,
  answers: Record<string, unknown>,
): Promise<CollectionAssetRecord[]> {
  const claimedIds = new Set<string>();
  const records: CollectionAssetRecord[] = [];
  for (const field of schema.fields.filter((item) => UPLOAD_FIELD_KINDS.has(item.kind))) {
    const value = answers[field.id];
    if (value === undefined || value === null || value === '') continue;
    const assets = Array.isArray(value) ? value : [value];
    const allowedTypes = field.rules.find((rule) => rule.kind === 'file_types')?.value;
    const sizeLimit = field.rules.find((rule) => rule.kind === 'file_size')?.value;
    for (const claimed of assets) {
      if (!claimed || typeof claimed !== 'object' || !('id' in claimed))
        throw new HttpError(400, 'invalid_asset', `“${field.label}”的文件记录无效`);
      const id = (claimed as { id?: unknown }).id;
      if (typeof id !== 'string' || claimedIds.has(id))
        throw new HttpError(400, 'invalid_asset', `“${field.label}”的文件记录无效`);
      claimedIds.add(id);
      const asset = await store.collectionAssets.getForUpdate(id);
      if (
        !asset ||
        asset.status !== 'pending' ||
        asset.responseId !== null ||
        asset.uploaderUid !== actor.uid ||
        asset.formId !== form.id ||
        asset.fieldId !== field.id
      ) {
        throw new HttpError(400, 'invalid_asset', `“${field.label}”的文件不属于本次填写`);
      }
      const canonical = assetPayload(asset);
      const candidate = claimed as Record<string, unknown>;
      if (
        candidate.name !== canonical.name ||
        candidate.mimeType !== canonical.mimeType ||
        candidate.sizeBytes !== canonical.sizeBytes ||
        candidate.url !== canonical.url
      ) {
        throw new HttpError(400, 'asset_metadata_mismatch', `“${field.label}”的文件信息不一致`);
      }
      if (
        Array.isArray(allowedTypes) &&
        allowedTypes.length > 0 &&
        !allowedTypes.includes(asset.mimeType)
      ) {
        throw new HttpError(400, 'unsupported_file_type', `“${field.label}”含有不支持的文件格式`);
      }
      if (typeof sizeLimit === 'number' && asset.sizeBytes > sizeLimit) {
        throw new HttpError(400, 'upload_too_large', `“${field.label}”含有超过大小上限的文件`);
      }
      records.push(asset);
    }
  }
  return records;
}

async function cleanupExpiredAssets(
  store: DevelopmentStore,
  directory: string,
  now: Date,
): Promise<void> {
  const cutoff = now.getTime() - PENDING_ASSET_TTL_MS;
  const candidates = (await store.collectionAssets.list()).filter(
    (asset) =>
      asset.status === 'expired' ||
      (asset.status === 'pending' && new Date(asset.createdAt).getTime() <= cutoff),
  );
  for (const candidate of candidates) {
    const storageKey = await store.transaction(async (transactionStore) => {
      const current = await transactionStore.collectionAssets.getForUpdate(candidate.id);
      if (!current) return null;
      if (
        current.status !== 'expired' &&
        (current.status !== 'pending' || new Date(current.createdAt).getTime() > cutoff)
      )
        return null;
      if (current.status !== 'expired')
        await transactionStore.collectionAssets.update(current.id, { status: 'expired' });
      return current.storageKey;
    });
    if (!storageKey) continue;
    await deleteCollectionUpload(directory, storageKey);
    await store.collectionAssets.delete(candidate.id);
  }
}

function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportPayload(
  output: CollectionOutput,
  schema: CollectionSchema,
  responses: Array<{
    respondentUid: string;
    submittedAt: string;
    answers: Record<string, unknown>;
  }>,
): { body: string; contentType: string } {
  if (output.kind === 'json') {
    return {
      body: JSON.stringify(
        { title: schema.title, exportedAt: new Date().toISOString(), responses },
        null,
        2,
      ),
      contentType: 'application/json; charset=utf-8',
    };
  }
  if (output.kind === 'summary') {
    const rows = [
      ['指标', '结果'],
      ['表单', schema.title],
      ['有效提交', responses.length],
    ];
    for (const field of schema.fields.filter((item) =>
      ['single_choice', 'multiple_choice'].includes(item.kind),
    )) {
      const counts = new Map<string, number>();
      for (const response of responses) {
        const raw = response.answers[field.id];
        for (const choice of Array.isArray(raw) ? raw : raw ? [raw] : []) {
          if (typeof choice === 'string') counts.set(choice, (counts.get(choice) ?? 0) + 1);
        }
      }
      for (const [choice, count] of counts) rows.push([`${field.label} · ${choice}`, count]);
    }
    return {
      body: `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`,
      contentType: 'text/csv; charset=utf-8',
    };
  }
  const headers = ['学号 / 用户标识', '提交时间', ...schema.fields.map((field) => field.label)];
  const rows = responses.map((item) => [
    item.respondentUid,
    item.submittedAt,
    ...schema.fields.map((field) => item.answers[field.id]),
  ]);
  return {
    body: `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`,
    contentType:
      output.kind === 'excel'
        ? 'application/vnd.ms-excel; charset=utf-8'
        : 'text/csv; charset=utf-8',
  };
}

export function createCollectionsRouter(options: CollectionsRouterOptions): Router {
  const router = Router();
  const uploadDirectory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const uploadDirectoryConfigured =
    options.nodeEnvironment !== 'production' ||
    (options.uploadDirectory !== undefined && isAbsolute(options.uploadDirectory));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });

  router.post(
    '/assets',
    async (request, response, next) => {
      const actor = await requireActor(options, request, response);
      if (!actor) return;
      if (!uploadDirectoryConfigured)
        throw new HttpError(503, 'upload_not_configured', '萬事集文件存储尚未配置，请联系管理员');
      response.locals.collectionsActor = actor;
      next();
    },
    upload.single('file'),
    async (request, response) => {
      const actor = response.locals.collectionsActor as AuthorizationContext;
      if (!request.file) throw new HttpError(400, 'missing_upload', '请选择要上传的文件');
      const uploadTarget = parse(
        z.object({
          formId: z.string().trim().min(1).max(128),
          fieldId: z.string().trim().min(1).max(128),
        }),
        request.body,
      );
      const form = await options.store.collectionForms.get(uploadTarget.formId);
      const version = form?.publishedVersionId
        ? await options.store.collectionVersions.get(form.publishedVersionId)
        : null;
      if (!form || !version || !audienceAllows(actor, version.schema))
        throw new HttpError(404, 'collection_not_found', '未找到表单');
      if (nativeStatus(form, version.schema) !== 'open')
        throw new HttpError(409, 'collection_closed', '当前表单尚未开放或已经截止');
      const field = version.schema.fields.find(
        (item) => item.id === uploadTarget.fieldId && UPLOAD_FIELD_KINDS.has(item.kind),
      );
      if (!field) throw new HttpError(400, 'invalid_upload_field', '上传字段不存在');
      const allowedTypes = field.rules.find((rule) => rule.kind === 'file_types')?.value;
      if (
        Array.isArray(allowedTypes) &&
        allowedTypes.length > 0 &&
        !allowedTypes.includes(request.file.mimetype)
      )
        throw new HttpError(400, 'unsupported_file_type', '文件格式不在表单允许范围内');
      const sizeLimit = field.rules.find((rule) => rule.kind === 'file_size')?.value;
      if (typeof sizeLimit === 'number' && request.file.size > sizeLimit)
        throw new HttpError(413, 'upload_too_large', '文件超过表单设置的大小上限');

      await cleanupExpiredAssets(options.store, uploadDirectory, new Date());
      const pendingCount = (await options.store.collectionAssets.list({ query: actor.uid })).filter(
        (asset) => asset.uploaderUid === actor.uid && asset.status === 'pending',
      ).length;
      if (pendingCount >= MAX_PENDING_ASSETS_PER_USER)
        throw new HttpError(429, 'pending_upload_limit', '请先完成当前提交，再继续上传文件');

      const stored = await storeCollectionUpload({
        buffer: request.file.buffer,
        originalName: request.file.originalname,
        mimeType: request.file.mimetype,
        directory: uploadDirectory,
        ...(typeof sizeLimit === 'number' ? { maxBytes: sizeLimit } : {}),
      });
      try {
        const created = await options.store.collectionAssets.create({
          formId: form.id,
          fieldId: field.id,
          uploaderUid: actor.uid,
          responseId: null,
          name: stored.name,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.id,
          status: 'pending',
          ownerUid: actor.uid,
          scope: { type: 'collection_form', id: form.id },
        });
        send(response, 201, assetPayload(created));
      } catch (error) {
        await deleteCollectionUpload(uploadDirectory, stored.id);
        throw error;
      }
    },
  );

  router.get('/module-definitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const modules = await options.store.collectionModuleDefinitions.list({ status: 'active' });
    send(
      response,
      200,
      modules.map(({ id, name, description, fieldKind, defaultLabel }) => ({
        id,
        name,
        description,
        fieldKind,
        defaultLabel,
      })),
    );
  });

  router.post('/module-definitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    if (!canManageCollectionModuleLibrary(actor))
      throw new HttpError(403, 'forbidden', '当前身份不能维护模块库');
    const input = parse(moduleDefinitionCreateSchema, request.body);
    const created = await options.store.collectionModuleDefinitions.create({
      ...input,
      status: 'active',
      ownerUid: actor.uid,
      scope: { type: 'public', id: '*' },
    });
    send(response, 201, {
      id: created.id,
      name: created.name,
      description: created.description,
      fieldKind: created.fieldKind,
      defaultLabel: created.defaultLabel,
    });
  });

  router.get('/assets/:assetId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const assetId = z.string().uuid().safeParse(request.params.assetId);
    if (!assetId.success) throw new HttpError(404, 'asset_not_found', '未找到文件');
    const asset = await options.store.collectionAssets.get(assetId.data);
    const form = asset ? await options.store.collectionForms.get(asset.formId) : null;
    if (
      !asset ||
      !form ||
      !['pending', 'attached'].includes(asset.status) ||
      (asset.uploaderUid !== actor.uid && !canManageCollection(actor, form.ownerUid))
    )
      throw new HttpError(404, 'asset_not_found', '未找到文件');
    const file = await readCollectionUpload(uploadDirectory, asset.storageKey);
    if (!file) throw new HttpError(404, 'asset_not_found', '未找到文件');
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.name.replace(/[\r\n]/gu, '_'))}`,
    );
    response.status(200).send(file);
  });

  router.get('/dashboard', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const [forms, articles] = await Promise.all([
      options.store.collectionForms.list({ status: 'published' }),
      options.store.showcaseArticles.list({ status: 'published' }),
    ]);
    const featured = (
      await Promise.all(forms.map((form) => registrationFromForm(options.store, actor, form)))
    )
      .filter((item): item is UnifiedRegistration => item !== null)
      .slice(0, 8);
    const showcase = await Promise.all(
      articles.slice(0, 4).map((article) => articleView(options.store, actor, article)),
    );
    const payload: CollectionsDashboardPayload = {
      featured,
      showcase,
      canCreate: canCreateCollection(actor),
    };
    send(response, 200, payload);
  });

  router.get('/registrations', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const [forms, activities, activityRegistrations] = await Promise.all([
      options.store.collectionForms.list({ status: 'published' }),
      options.store.activities.list({ status: 'published' }),
      options.store.activityRegistrations.list(),
    ]);
    const native = (
      await Promise.all(forms.map((form) => registrationFromForm(options.store, actor, form)))
    ).filter((item): item is UnifiedRegistration => item !== null);
    const eventItems: UnifiedRegistration[] = activities.map((activity) => ({
      id: activity.id,
      source: 'development_activity',
      title: activity.title,
      description: activity.description,
      organizationId: activity.organizationId ?? null,
      organizer: activity.organizationId
        ? organizationById(activity.organizationId).name
        : '無活动',
      coverUrl: null,
      opensAt: null,
      closesAt: activity.registrationDeadline,
      location: activity.location ?? null,
      capacity: activity.capacity,
      registrationCount: activityRegistrations.filter((item) => item.activityId === activity.id)
        .length,
      registered: activityRegistrations.some(
        (item) => item.activityId === activity.id && item.participantUid === actor.uid,
      ),
      status:
        activity.registrationDeadline && new Date(activity.registrationDeadline) < new Date()
          ? 'closed'
          : 'open',
    }));
    send(response, 200, [...native, ...eventItems]);
  });

  router.get('/mine', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const [responses, forms, activityRegistrations, activities] = await Promise.all([
      options.store.collectionResponses.list({ query: actor.uid }),
      options.store.collectionForms.list(),
      options.store.activityRegistrations.list({ query: actor.uid }),
      options.store.activities.list(),
    ]);
    const native: CollectionResponseSummary[] = responses
      .filter((item) => item.respondentUid === actor.uid)
      .map((item) => ({
        id: item.id,
        formId: item.formId,
        formTitle: forms.find((form) => form.id === item.formId)?.title ?? '已归档表单',
        source: 'native_collection',
        submittedAt: item.submittedAt,
        status: item.status as 'submitted' | 'cancelled',
      }));
    const eventItems: CollectionResponseSummary[] = activityRegistrations
      .filter((item) => item.participantUid === actor.uid)
      .map((item) => ({
        id: item.id,
        formId: item.activityId,
        formTitle:
          activities.find((activity) => activity.id === item.activityId)?.title ?? '已归档活动',
        source: 'development_activity',
        submittedAt: item.createdAt,
        status: 'submitted',
      }));
    send(
      response,
      200,
      [...native, ...eventItems].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    );
  });

  router.post('/forms', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    if (!canCreateCollection(actor)) throw new HttpError(403, 'forbidden', '当前身份不能创建表单');
    const input = parse(formCreateSchema, request.body);
    const organizationId = resolveOrganization(actor, input.organizationId);
    const result = await options.store.transaction(async (store) => {
      const form = await store.collectionForms.create({
        title: input.title,
        description: input.description,
        coverUrl: input.coverUrl,
        organizationId,
        currentDraftVersionId: null,
        publishedVersionId: null,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        capacity: input.capacity,
        status: 'draft',
        ownerUid: actor.uid,
        scope: { type: 'public', id: '*' },
      });
      const version = await store.collectionVersions.create({
        formId: form.id,
        version: 1,
        schema: input.schema,
        publishedAt: null,
        status: 'draft',
        ownerUid: actor.uid,
        scope: { type: 'collection_form', id: form.id },
      });
      const updated = await store.collectionForms.update(form.id, {
        currentDraftVersionId: version.id,
      });
      if (!updated) throw new Error('Collection form disappeared during creation');
      return formSummary(store, actor, updated);
    });
    send(response, 201, result);
  });

  router.get('/forms/:formId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { formId } = parse(formRouteSchema, { formId: request.params.formId });
    const form = await options.store.collectionForms.get(formId);
    const publishedVersion = form?.publishedVersionId
      ? await options.store.collectionVersions.get(form.publishedVersionId)
      : null;
    if (
      !form ||
      (form.status !== 'published' && !canManageCollection(actor, form.ownerUid)) ||
      (form.status === 'published' &&
        (!publishedVersion || !canViewCollection(actor, form, publishedVersion.schema)))
    ) {
      throw new HttpError(404, 'collection_not_found', '未找到表单');
    }
    send(response, 200, await formSummary(options.store, actor, form));
  });

  router.put('/forms/:formId/draft', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { formId } = parse(formRouteSchema, request.params);
    const input = parse(formDraftSchema, request.body);
    const result = await options.store.transaction(async (store) => {
      const form = await store.collectionForms.getForUpdate(formId);
      if (!form || !canManageCollection(actor, form.ownerUid))
        throw new HttpError(404, 'collection_not_found', '未找到表单');
      const organizationId =
        input.organizationId === undefined
          ? form.organizationId
          : resolveOrganization(actor, input.organizationId);
      let draft = form.currentDraftVersionId
        ? await store.collectionVersions.getForUpdate(form.currentDraftVersionId)
        : null;
      if (!draft || draft.publishedAt) {
        const versions = await store.collectionVersions.list({ query: form.id });
        draft = await store.collectionVersions.create({
          formId: form.id,
          version:
            Math.max(
              0,
              ...versions.filter((item) => item.formId === form.id).map((item) => item.version),
            ) + 1,
          schema: input.schema,
          publishedAt: null,
          status: 'draft',
          ownerUid: actor.uid,
          scope: { type: 'collection_form', id: form.id },
        });
      } else {
        const updatedVersion = await store.collectionVersions.update(draft.id, {
          schema: input.schema,
        });
        if (!updatedVersion) throw new Error('Collection draft disappeared');
        draft = updatedVersion;
      }
      const updated = await store.collectionForms.update(form.id, {
        title: input.title ?? input.schema.title,
        description: input.description ?? input.schema.description,
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
        organizationId,
        ...(input.opensAt !== undefined ? { opensAt: input.opensAt } : {}),
        ...(input.closesAt !== undefined ? { closesAt: input.closesAt } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        currentDraftVersionId: draft.id,
      });
      if (!updated) throw new Error('Collection form disappeared');
      return formSummary(store, actor, updated);
    });
    send(response, 200, result);
  });

  router.post('/forms/:formId/publish', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { formId } = parse(formRouteSchema, request.params);
    const result = await options.store.transaction(async (store) => {
      const form = await store.collectionForms.getForUpdate(formId);
      if (!form || !canManageCollection(actor, form.ownerUid))
        throw new HttpError(404, 'collection_not_found', '未找到表单');
      if (!form.currentDraftVersionId)
        throw new HttpError(409, 'missing_draft', '没有可发布的草稿');
      const version = await store.collectionVersions.getForUpdate(form.currentDraftVersionId);
      if (!version) throw new HttpError(409, 'missing_draft', '没有可发布的草稿');
      const publishedAt = new Date().toISOString();
      await store.collectionVersions.update(version.id, { status: 'published', publishedAt });
      const updated = await store.collectionForms.update(form.id, {
        status: 'published',
        publishedVersionId: version.id,
      });
      if (!updated) throw new Error('Collection form disappeared');
      return formSummary(store, actor, updated);
    });
    send(response, 200, result);
  });

  router.get('/forms/:formId/exports/:outputId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { formId } = parse(formRouteSchema, { formId: request.params.formId });
    const outputId = String(request.params.outputId ?? '');
    const form = await options.store.collectionForms.get(formId);
    if (!form || !canManageCollection(actor, form.ownerUid))
      throw new HttpError(404, 'collection_not_found', '未找到表单');
    const versionId = form.publishedVersionId;
    const version = versionId ? await options.store.collectionVersions.get(versionId) : null;
    const output = version?.schema.outputs?.find((item) => item.id === outputId);
    if (!version || !output) throw new HttpError(404, 'output_not_found', '未找到输出模块');
    const responses = (await options.store.collectionResponses.list({ query: form.id })).filter(
      (item) =>
        item.formId === form.id && item.versionId === version.id && item.status === 'submitted',
    );
    const exported = exportPayload(output, version.schema, responses);
    const safeName = output.fileName.replace(/["\r\n]/gu, '_');
    response
      .status(200)
      .set('Content-Type', exported.contentType)
      .set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`)
      .send(exported.body);
  });

  router.post('/forms/:formId/responses', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { formId } = parse(formRouteSchema, request.params);
    const { answers } = parse(responseSchema, request.body);
    const result = await options.store.transaction(async (store) => {
      const form = await store.collectionForms.getForUpdate(formId);
      if (!form || !form.publishedVersionId)
        throw new HttpError(409, 'collection_closed', '当前表单尚未开放或已经截止');
      const version = await store.collectionVersions.get(form.publishedVersionId);
      if (!version) throw new HttpError(409, 'missing_version', '发布版本不存在');
      if (!audienceAllows(actor, version.schema))
        throw new HttpError(404, 'collection_not_found', '未找到表单');
      if (nativeStatus(form, version.schema) !== 'open')
        throw new HttpError(409, 'collection_closed', '当前表单尚未开放或已经截止');
      validateAnswers(version.schema, answers);
      const assets = await validateAssetAnswers(store, actor, form, version.schema, answers);
      const existing = (await store.collectionResponses.listForUpdate({ query: form.id })).filter(
        (item) =>
          item.formId === form.id &&
          item.respondentUid === actor.uid &&
          item.status === 'submitted',
      );
      const attemptLimit = readLimit(version.schema, 'attempt_limit') ?? 1;
      if (existing.length >= attemptLimit)
        throw new HttpError(409, 'attempt_limit_reached', '已经达到提交次数上限');
      const all = (await store.collectionResponses.listForUpdate({ query: form.id })).filter(
        (item) => item.formId === form.id && item.status === 'submitted',
      );
      const capacity = form.capacity ?? readLimit(version.schema, 'capacity');
      if (capacity !== null && all.length >= capacity)
        throw new HttpError(409, 'capacity_reached', '报名名额已满');
      const created = await store.collectionResponses.create({
        formId: form.id,
        versionId: version.id,
        respondentUid: actor.uid,
        attempt: existing.length + 1,
        answers,
        submittedAt: new Date().toISOString(),
        status: 'submitted',
        ownerUid: actor.uid,
        scope: { type: 'collection_form', id: form.id },
      });
      for (const asset of assets) {
        const updated = await store.collectionAssets.update(asset.id, {
          responseId: created.id,
          status: 'attached',
        });
        if (!updated) throw new Error('Collection asset disappeared during submission');
      }
      return created;
    });
    send(response, 201, result);
  });

  router.get('/showcase', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const articles = await options.store.showcaseArticles.list({ status: 'published' });
    send(
      response,
      200,
      await Promise.all(
        articles
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .map((article) => articleView(options.store, actor, article)),
      ),
    );
  });

  router.get('/showcase/:articleId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { articleId } = parse(articleRouteSchema, request.params);
    const article = await options.store.showcaseArticles.get(articleId);
    if (!article || article.status !== 'published')
      throw new HttpError(404, 'article_not_found', '未找到文章');
    send(response, 200, await articleView(options.store, actor, article));
  });

  router.post('/showcase/:articleId/likes', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { articleId } = parse(articleRouteSchema, request.params);
    const article = await options.store.showcaseArticles.get(articleId);
    if (!article || article.status !== 'published')
      throw new HttpError(404, 'article_not_found', '未找到文章');
    const existing = (await options.store.showcaseLikes.list({ query: articleId })).find(
      (like) => like.articleId === articleId && like.userUid === actor.uid,
    );
    if (existing) {
      if (existing.status !== 'active')
        await options.store.showcaseLikes.update(existing.id, { status: 'active' });
    } else {
      await options.store.showcaseLikes.create({
        articleId,
        userUid: actor.uid,
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'showcase_article', id: articleId },
      });
    }
    send(response, 200, await articleView(options.store, actor, article));
  });

  router.delete('/showcase/:articleId/likes', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (!actor) return;
    const { articleId } = parse(articleRouteSchema, request.params);
    const article = await options.store.showcaseArticles.get(articleId);
    if (!article || article.status !== 'published')
      throw new HttpError(404, 'article_not_found', '未找到文章');
    const existing = (await options.store.showcaseLikes.list({ query: articleId })).find(
      (like) =>
        like.articleId === articleId && like.userUid === actor.uid && like.status === 'active',
    );
    if (existing) await options.store.showcaseLikes.update(existing.id, { status: 'inactive' });
    send(response, 200, await articleView(options.store, actor, article));
  });

  return router;
}
