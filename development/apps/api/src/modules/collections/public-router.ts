import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { CollectionSchema } from '@freebbs-development/contracts';
import type { CollectionFormRecord } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import type { CollectionsRouterOptions } from './router.js';
import { effectiveWindow, effectiveCapacity, nativeStatus } from './registrations.js';
import { responseSchema } from './schemas.js';
import {
  readCollectionFeature,
  tokenHash,
  withCollectionFeature,
  type CollectionFeatureState,
  type GuestSession,
} from './feature-storage.js';
import { readCollectionUpload, storeCollectionUpload } from './uploads.js';
import { downloadName } from './spreadsheets.js';

type ValidateAnswers = (schema: CollectionSchema, answers: Record<string, unknown>) => void;
function send(response: Response, status: number, data: unknown) {
  response.status(status).json({ data, requestId: response.locals.requestId });
}
const token = z.string().regex(/^[a-f0-9]{64}$/u);
function parseToken(value: unknown) {
  const parsed = token.safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'session_not_found', '填写凭证无效');
  return parsed.data;
}
export function isPublicSchema(schema: CollectionSchema) {
  const audiences = schema.formRules.filter((rule) => rule.kind === 'audience');
  return (
    schema.publicRegistration === true &&
    (!schema.recipientMode || schema.recipientMode === 'open') &&
    audiences.every((rule) => rule.value === 'all' || rule.value === true) &&
    !schema.fields.some((field) => field.kind === 'identity')
  );
}
export function createPublicCollectionsRouter(
  options: CollectionsRouterOptions,
  directory: string,
  configured: boolean,
  validateAnswers: ValidateAnswers,
): Router {
  const router = Router();
  const assetDirectory = join(directory, 'guest-assets');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 2 },
  });
  function requireStorage() {
    if (!configured)
      throw new HttpError(
        503,
        'collection_storage_unavailable',
        '萬事集公开填写存储尚未配置，请联系管理员',
      );
  }
  async function publicForm(id: string, forSubmit = false, formRecord?: CollectionFormRecord) {
    const form = formRecord ?? (await options.store.collectionForms.get(id));
    const version = form?.publishedVersionId
      ? await options.store.collectionVersions.get(form.publishedVersionId)
      : null;
    if (
      !form ||
      form.status !== 'published' ||
      form.scope.type !== 'public' ||
      form.scope.id !== '*' ||
      !version?.publishedAt ||
      !isPublicSchema(version.schema)
    )
      throw new HttpError(404, 'collection_not_found', '未找到公开表单');
    if (forSubmit && nativeStatus(form, version.schema) !== 'open')
      throw new HttpError(409, 'collection_closed', '当前表单尚未开放或已经截止');
    return { form, version };
  }
  async function cleanSessionAssets(state: CollectionFeatureState, session: GuestSession) {
    const referenced = new Set<string>();
    for (const record of state.responses.filter((item) => item.sessionHash === session.hash)) {
      const version = await options.store.collectionVersions.get(record.versionId);
      // Keep the bookkeeping if the historical schema is unavailable; a later cleanup can retry.
      if (!version) return false;
      for (const field of version.schema.fields.filter((field) =>
        ['file', 'image', 'video', 'audio'].includes(field.kind),
      )) {
        const value = record.answers[field.id];
        for (const candidate of Array.isArray(value) ? value : [value]) {
          if (!candidate || typeof candidate !== 'object') continue;
          const asset = session.assets.find(
            (asset) =>
              asset.fieldId === field.id && asset.id === (candidate as { id?: unknown }).id,
          );
          if (
            asset &&
            ['name', 'mimeType', 'sizeBytes', 'url'].every(
              (key) =>
                (candidate as Record<string, unknown>)[key] === asset[key as keyof typeof asset],
            )
          )
            referenced.add(asset.id);
        }
      }
    }
    let entries: string[];
    try {
      entries = await readdir(assetDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      entries = [];
    }
    const retained: GuestSession['assets'] = [];
    for (const asset of session.assets) {
      if (referenced.has(asset.id) || !z.string().uuid().safeParse(asset.id).success) {
        retained.push(asset);
        continue;
      }
      try {
        // Paths come only from server-generated IDs and enumerated files, never answer URLs.
        for (const entry of entries.filter((name) => name.startsWith(`${asset.id}.`)))
          await rm(join(assetDirectory, entry), { force: true });
      } catch {
        retained.push(asset);
      }
    }
    session.assets = retained;
    return retained.every((asset) => referenced.has(asset.id));
  }
  router.get('/forms/:formId', async (request, response) => {
    requireStorage();
    const { form, version } = await publicForm(String(request.params.formId));
    const state = await readCollectionFeature(directory, form.id);
    const native = (await options.store.collectionResponses.list({ query: form.id })).filter(
      (item) => item.formId === form.id && item.status === 'submitted',
    );
    send(response, 200, {
      id: form.id,
      title: version.schema.title,
      description: version.schema.description,
      schema: version.schema,
      ...effectiveWindow(form, version.schema),
      status: nativeStatus(form, version.schema),
      capacity: effectiveCapacity(form, version.schema),
      responseCount: native.length + state.responses.length,
    });
  });
  router.post('/forms/:formId/session', async (request, response) => {
    requireStorage();
    const { form } = await publicForm(String(request.params.formId), true);
    const sessionToken = randomBytes(32).toString('hex');
    await withCollectionFeature(directory, form.id, async (state) => {
      const now = Date.now(),
        addressHash = tokenHash(request.ip ?? request.socket.remoteAddress ?? 'unknown');
      const expired = state.sessions.filter((session) => now - session.createdAt > 86400000);
      for (const session of expired) {
        if (await cleanSessionAssets(state, session))
          state.sessions = state.sessions.filter((item) => item !== session);
      }
      if (
        state.sessions.length >= 1000 ||
        state.sessions.filter(
          (session) => session.addressHash === addressHash && now - session.createdAt < 3600000,
        ).length >= 20
      )
        throw new HttpError(429, 'guest_limit_reached', '公开填写请求过多，请稍后重试');
      state.sessions.push({
        hash: tokenHash(sessionToken),
        addressHash,
        createdAt: now,
        assets: [],
      });
    });
    send(response, 201, { sessionToken, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  });
  router.post(
    '/forms/:formId/assets',
    async (request, response, next) => {
      requireStorage();
      const { form } = await publicForm(String(request.params.formId), true);
      const hash = tokenHash(parseToken(request.headers['x-collection-session']));
      const state = await readCollectionFeature(directory, form.id);
      const session = state.sessions.find(
        (session) => session.hash === hash && Date.now() - session.createdAt <= 86400000,
      );
      if (!session || state.responses.some((item) => item.sessionHash === hash))
        throw new HttpError(404, 'session_not_found', '填写凭证无效');
      response.locals.sessionHash = hash;
      next();
    },
    upload.single('file'),
    async (request, response) => {
      if (!request.file) throw new HttpError(400, 'missing_upload', '请选择文件');
      const hash = response.locals.sessionHash as string;
      const asset = await withCollectionFeature(
        directory,
        String(request.params.formId),
        async (state) => {
          const { version } = await publicForm(String(request.params.formId), true);
          const session = state.sessions.find(
            (session) => session.hash === hash && Date.now() - session.createdAt <= 86400000,
          );
          if (!session || state.responses.some((item) => item.sessionHash === hash))
            throw new HttpError(404, 'session_not_found', '填写凭证无效');
          if (session.assets.length >= 20)
            throw new HttpError(429, 'guest_upload_limit', '本次填写最多上传 20 个文件');
          const field = version.schema.fields.find(
            (field) =>
              field.id === request.body.fieldId &&
              ['file', 'image', 'video', 'audio'].includes(field.kind),
          );
          if (!field) throw new HttpError(400, 'invalid_upload_field', '上传字段不存在');
          const types = field.rules.find((rule) => rule.kind === 'file_types')?.value;
          const size = field.rules.find((rule) => rule.kind === 'file_size')?.value;
          if (Array.isArray(types) && types.length && !types.includes(request.file!.mimetype))
            throw new HttpError(400, 'unsupported_file_type', '文件格式不在允许范围');
          if (typeof size === 'number' && request.file!.size > size)
            throw new HttpError(400, 'upload_too_large', '文件超过字段大小上限');
          if (
            session.assets.reduce((total, asset) => total + asset.sizeBytes, 0) +
              request.file!.size >
            200 * 1024 * 1024
          )
            throw new HttpError(
              429,
              'guest_upload_limit',
              '本次填写上传文件总大小不能超过 200 MiB',
            );
          const stored = await storeCollectionUpload({
            buffer: request.file!.buffer,
            originalName: request.file!.originalname,
            mimeType: request.file!.mimetype,
            directory: assetDirectory,
          });
          session.assets.push({ ...stored, fieldId: field.id });
          return stored;
        },
      );
      send(response, 201, asset);
    },
  );
  router.post('/forms/:formId/responses', async (request, response) => {
    requireStorage();
    const input = responseSchema.extend({ sessionToken: token }).safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'invalid_request', '填写内容无效');
    const result = await withCollectionFeature(
      directory,
      String(request.params.formId),
      async (state) =>
        options.store.transaction(async (store) => {
          const locked = await store.collectionForms.getForUpdate(String(request.params.formId));
          if (!locked) throw new HttpError(404, 'collection_not_found', '未找到公开表单');
          const { form, version } = await publicForm(locked.id, true, locked);
          const hash = tokenHash(input.data.sessionToken);
          const session = state.sessions.find(
            (session) => session.hash === hash && Date.now() - session.createdAt <= 86400000,
          );
          if (!session) throw new HttpError(404, 'session_not_found', '填写凭证无效');
          const attemptLimit = version.schema.formRules.find(
            (rule) => rule.kind === 'attempt_limit',
          )?.value;
          if (
            state.responses.filter((item) => item.sessionHash === hash).length >=
            (typeof attemptLimit === 'number' ? attemptLimit : 1)
          )
            throw new HttpError(409, 'attempt_limit_reached', '已经达到提交次数上限');
          validateAnswers(version.schema, input.data.answers);
          const claimed = new Set<string>();
          for (const field of version.schema.fields.filter((field) =>
            ['file', 'image', 'video', 'audio'].includes(field.kind),
          )) {
            const value = input.data.answers[field.id];
            if (value == null || value === '') continue;
            for (const candidate of Array.isArray(value) ? value : [value]) {
              const asset = session.assets.find(
                (asset) =>
                  asset.id === (candidate as { id?: string }).id && asset.fieldId === field.id,
              );
              if (
                !asset ||
                claimed.has(asset.id) ||
                ['name', 'mimeType', 'sizeBytes', 'url'].some(
                  (key) =>
                    (candidate as Record<string, unknown>)[key] !==
                    asset[key as keyof typeof asset],
                )
              )
                throw new HttpError(400, 'invalid_asset', '文件不属于本次填写');
              claimed.add(asset.id);
            }
          }
          const native = (await store.collectionResponses.listForUpdate({ query: form.id })).filter(
            (item) => item.formId === form.id && item.status === 'submitted',
          );
          const capacity = effectiveCapacity(form, version.schema);
          if (
            state.responses.length >= 10000 ||
            (capacity !== null && state.responses.length + native.length >= capacity)
          )
            throw new HttpError(409, 'capacity_reached', '报名名额已满');
          const receiptToken = randomBytes(32).toString('hex'),
            receiptHash = tokenHash(receiptToken);
          const receipt = {
            id: randomUUID(),
            formId: form.id,
            versionId: version.id,
            respondentUid: '访客（未认证）',
            answers: input.data.answers,
            submittedAt: new Date().toISOString(),
            receiptHash,
            sessionHash: hash,
            status: 'submitted' as const,
          };
          state.responses.push(receipt);
          await mkdir(join(directory, 'guest-receipts'), { recursive: true });
          await writeFile(
            join(directory, 'guest-receipts', `${receiptHash}.json`),
            JSON.stringify({ formId: form.id }),
            { flag: 'wx' },
          );
          return { id: receipt.id, submittedAt: receipt.submittedAt, receiptToken };
        }),
    );
    // The response and receipt are durable before removing unused draft uploads.
    // Cleanup failures retain the session metadata for retry and must not reject a saved response.
    try {
      await withCollectionFeature(directory, String(request.params.formId), async (state) => {
        const session = state.sessions.find(
          (item) => item.hash === tokenHash(input.data.sessionToken),
        );
        if (session) await cleanSessionAssets(state, session);
      });
    } catch {
      // Expiry cleanup retries from the last successfully persisted session state.
    }
    send(response, 201, result);
  });
  async function receipt(value: unknown) {
    requireStorage();
    const receiptToken = parseToken(value),
      hash = tokenHash(receiptToken);
    let formId: string;
    try {
      formId = (
        JSON.parse(await readFile(join(directory, 'guest-receipts', `${hash}.json`), 'utf8')) as {
          formId: string;
        }
      ).formId;
    } catch {
      throw new HttpError(404, 'receipt_not_found', '未找到提交回执');
    }
    const state = await readCollectionFeature(directory, formId),
      record = state.responses.find((item) => item.receiptHash === hash);
    if (!record) throw new HttpError(404, 'receipt_not_found', '未找到提交回执');
    return { record, receiptToken, state };
  }
  router.get('/receipts/:token', async (request, response) => {
    const { record, receiptToken } = await receipt(request.params.token);
    const answers = JSON.parse(JSON.stringify(record.answers)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(answers)) {
      const map = (item: unknown) =>
        item && typeof item === 'object' && 'id' in item
          ? {
              ...item,
              url: `/api/development/v1/collections/public/receipts/${receiptToken}/assets/${String(item.id)}`,
            }
          : item;
      answers[key] = Array.isArray(value) ? value.map(map) : map(value);
    }
    response.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    send(response, 200, {
      id: record.id,
      formId: record.formId,
      submittedAt: record.submittedAt,
      answers,
    });
  });
  router.get('/receipts/:token/assets/:assetId', async (request, response) => {
    const { record } = await receipt(request.params.token);
    const id = String(request.params.assetId);
    const asset = Object.values(record.answers)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .find(
        (value) => value && typeof value === 'object' && (value as { id?: string }).id === id,
      ) as { id: string; name: string; mimeType: string } | undefined;
    if (!asset || !z.string().uuid().safeParse(id).success)
      throw new HttpError(404, 'asset_not_found', '未找到文件');
    const bytes = await readCollectionUpload(assetDirectory, id);
    if (!bytes) throw new HttpError(404, 'asset_not_found', '未找到文件');
    response
      .set('Cache-Control', 'no-store')
      .set('Content-Type', asset.mimeType)
      .set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadName(asset.name))}`,
      )
      .send(bytes);
  });
  return router;
}
