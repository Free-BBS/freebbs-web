import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canManageStoredCollection, canCreateCollection } from './access.js';
import { departmentsForActor } from '../../core/authorization/role-scope-context.js';
import { actorOrganizations, resolvePublisher } from './registrations.js';
import { collectionSchema } from './schemas.js';
import type { CollectionsRouterOptions } from './router.js';
import {
  readCollectionFeature,
  withCollectionFeature,
  type CollectionFeatureState,
} from './feature-storage.js';
import { downloadName, parseRoster, xlsxBuffer } from './spreadsheets.js';
import { readCollectionUpload } from './uploads.js';

function send(response: Response, status: number, data: unknown) {
  response.status(status).json({ data, requestId: response.locals.requestId });
}
export function assertRecipientIdentity(
  actor: AuthorizationContext,
  state: CollectionFeatureState,
  mode: 'open' | 'named' | 'restricted' | undefined,
) {
  if (!mode || mode === 'open') return;
  if (!actor.studentId?.trim() || !actor.displayName.trim())
    throw new HttpError(
      403,
      'verified_identity_required',
      '定向表单需要登录身份中提供的姓名与学号',
    );
  if (
    mode === 'restricted' &&
    !state.recipients.some(
      (item) => item.studentId === actor.studentId && item.name === actor.displayName,
    )
  )
    throw new HttpError(404, 'collection_not_found', '未找到表单');
}
export function createCollectionManagementRouter(
  options: CollectionsRouterOptions,
  directory: string,
  configured: boolean,
): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  });
  router.get('/templates', async (request, response) => {
    const auth = await options.authenticate(request.headers);
    if (auth.status !== 200) {
      send(response, auth.status, { error: { code: auth.code, message: auth.message } });
      return;
    }
    const departments = departmentsForActor(auth.user);
    const namespaces = [
      `personal:${auth.user.uid}`,
      ...departments.map((item) => `department:${item.id}`),
      ...actorOrganizations(auth.user).map((id) => `organization:${id}`),
    ];
    const states = await Promise.all(
      namespaces.map((namespace) => readCollectionFeature(directory, `templates:${namespace}`)),
    );
    send(
      response,
      200,
      states.flatMap((state) => state.templates ?? []),
    );
  });
  router.post('/templates', async (request, response) => {
    const auth = await options.authenticate(request.headers);
    if (auth.status !== 200) {
      send(response, auth.status, { error: { code: auth.code, message: auth.message } });
      return;
    }
    if (!canCreateCollection(auth.user))
      throw new HttpError(403, 'forbidden', '当前身份不能创建部门模板');
    if (!configured) throw new HttpError(503, 'collection_storage_unavailable', '模板存储尚未配置');
    const parsed = z
      .object({ name: z.string().trim().min(1).max(100), schema: collectionSchema })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', '模板内容无效');
    const publisher = resolvePublisher(auth.user, parsed.data.schema, undefined);
    const departmentId = publisher.schema.publisherDepartmentId;
    const namespace = departmentId
      ? `department:${departmentId}`
      : publisher.organizationId
        ? `organization:${publisher.organizationId}`
        : `personal:${auth.user.uid}`;
    const saved = await withCollectionFeature(
      directory,
      `templates:${namespace}`,
      async (state) => {
        state.templates ??= [];
        if (state.templates.length >= 100)
          throw new HttpError(409, 'template_limit', '每个部门最多保存 100 个模板');
        const template = {
          id: randomUUID(),
          name: parsed.data.name,
          schema: publisher.schema,
          ownerUid: auth.user.uid,
          ...(departmentId ? { departmentId } : {}),
        };
        state.templates.push(template);
        return template;
      },
    );
    send(response, 201, saved);
  });
  async function manager(request: Request, response: Response) {
    const auth = await options.authenticate(request.headers);
    if (auth.status !== 200) {
      send(response, auth.status, { error: { code: auth.code, message: auth.message } });
      return null;
    }
    const form = await options.store.collectionForms.get(String(request.params.formId));
    if (!form || !(await canManageStoredCollection(options.store, auth.user, form)))
      throw new HttpError(404, 'collection_not_found', '未找到表单');
    return form;
  }
  function query(request: Request) {
    const result = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        query: z.string().max(200).default(''),
        completion: z.enum(['all', 'completed', 'pending']).default('all'),
        versionId: z.string().min(1).max(100).optional(),
      })
      .safeParse(request.query);
    if (!result.success) throw new HttpError(400, 'invalid_query', '查询参数无效');
    return result.data;
  }
  router.get('/forms/:formId/results', async (request, response) => {
    const form = await manager(request, response);
    if (!form) return;
    const { page, pageSize, query: search, versionId: selectedVersion } = query(request);
    const versions = (await options.store.collectionVersions.list({ query: form.id })).filter(
      (item) => item.formId === form.id && item.publishedAt !== null,
    );
    if (selectedVersion && !versions.some((item) => item.id === selectedVersion))
      throw new HttpError(404, 'version_not_found', '未找到该表单的发布版本');
    const versionId = form.publishedVersionId ?? form.currentDraftVersionId;
    const version = versionId ? await options.store.collectionVersions.get(versionId) : null;
    const state = await readCollectionFeature(directory, form.id);
    const native = (await options.store.collectionResponses.list({ query: form.id })).filter(
      (item) => item.formId === form.id && item.status === 'submitted',
    );
    const responses = [...native, ...state.responses]
      .filter((item) => !selectedVersion || item.versionId === selectedVersion)
      .map((item) => ({
        id: item.id,
        versionId: item.versionId,
        respondentUid: item.respondentUid,
        identity: state.identities[item.id] ?? state.identities[item.respondentUid] ?? null,
        submittedAt: item.submittedAt,
        answers: item.answers,
        guest: 'receiptHash' in item,
      }));
    const filtered = responses
      .filter(
        (item) =>
          !search ||
          JSON.stringify([item.respondentUid, item.identity, item.answers])
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const choices: Record<string, Record<string, number>> = {};
    for (const field of (selectedVersion
      ? versions.find((item) => item.id === selectedVersion)?.schema.fields
      : version?.schema.fields) ?? [])
      if (['single_choice', 'multiple_choice'].includes(field.kind)) {
        choices[field.id] = Object.fromEntries(field.options.map((option) => [option, 0]));
        for (const item of responses) {
          const answer = item.answers[field.id];
          for (const value of Array.isArray(answer) ? answer : [answer])
            if (typeof value === 'string' && value in choices[field.id]!)
              choices[field.id]![value] = (choices[field.id]![value] ?? 0) + 1;
        }
      }
    send(response, 200, {
      form: {
        id: form.id,
        title: version?.schema.title ?? form.title,
        status: form.status,
        canManage: true,
        schema: version?.schema,
      },
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      versions: versions
        .sort((a, b) => b.version - a.version)
        .map((item) => ({ id: item.id, version: item.version, schema: item.schema })),
      stats: {
        submitted: responses.length,
        authenticated: responses.filter((item) => !item.guest).length,
        guests: responses.filter((item) => item.guest).length,
        choices,
      },
    });
  });
  router.post(
    '/forms/:formId/recipients/import',
    async (request, response, next) => {
      const form = await manager(request, response);
      if (!form) return;
      if (!configured)
        throw new HttpError(503, 'collection_storage_unavailable', '名单存储尚未配置');
      response.locals.managedForm = form;
      next();
    },
    upload.single('file'),
    async (request, response) => {
      if (!request.file) throw new HttpError(400, 'missing_upload', '请选择名单文件');
      const parsed = await parseRoster(request.file.buffer, request.file.originalname);
      const result = await withCollectionFeature(
        directory,
        String(request.params.formId),
        async (state) => {
          let imported = 0,
            duplicates = parsed.duplicates;
          const errors = [...parsed.errors];
          for (const item of parsed.recipients) {
            const previous = state.recipients.find(
              (existing) => existing.studentId === item.studentId,
            );
            if (previous) {
              if (previous.name === item.name) duplicates++;
              else
                errors.push({
                  row: parsed.rowNumbers[item.studentId] ?? 2,
                  message: `学号 ${item.studentId} 已绑定其他姓名，未覆盖`,
                });
            } else {
              state.recipients.push(item);
              imported++;
            }
          }
          if (state.recipients.length > 10000)
            throw new HttpError(400, 'roster_too_large', '名单总人数不能超过 10000');
          return {
            imported,
            duplicates,
            errors: errors.slice(0, 100),
            errorCount: errors.length,
            total: state.recipients.length,
          };
        },
      );
      send(response, 200, result);
    },
  );
  async function recipientRows(formId: string) {
    const state = await readCollectionFeature(directory, formId);
    const submissions = (await options.store.collectionResponses.list({ query: formId })).filter(
      (item) => item.formId === formId && item.status === 'submitted',
    );
    return state.recipients.map((item) => {
      const matching = submissions.filter((response) => {
        const identity = state.identities[response.id] ?? state.identities[response.respondentUid];
        return identity?.name === item.name && identity.studentId === item.studentId;
      });
      return {
        ...item,
        completed: matching.length > 0,
        submissionCount: matching.length,
        submittedAt:
          matching
            .map((response) => response.submittedAt)
            .sort()
            .at(-1) ?? null,
      };
    });
  }
  router.get('/forms/:formId/recipients', async (request, response) => {
    const form = await manager(request, response);
    if (!form) return;
    const { page, pageSize, query: search, completion } = query(request);
    const all = await recipientRows(form.id);
    const items = all.filter(
      (item) =>
        (!search || `${item.name} ${item.studentId}`.includes(search)) &&
        (completion === 'all' || item.completed === (completion === 'completed')),
    );
    send(response, 200, {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
      stats: {
        total: all.length,
        completed: all.filter((item) => item.completed).length,
        pending: all.filter((item) => !item.completed).length,
      },
    });
  });
  router.get('/forms/:formId/recipients/export', async (request, response) => {
    const form = await manager(request, response);
    if (!form) return;
    const rows = await recipientRows(form.id);
    response
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadName(`${form.title}-完成名单`, 'xlsx'))}`,
      )
      .send(
        await xlsxBuffer([
          ['姓名', '学号', '完成情况', '提交次数', '最后提交时间'],
          ...rows.map((item) => [
            item.name,
            item.studentId,
            item.completed ? '已完成' : '未完成',
            item.submissionCount,
            item.submittedAt,
          ]),
        ]),
      );
  });
  router.get('/forms/:formId/guest-assets/:assetId', async (request, response) => {
    const form = await manager(request, response);
    if (!form) return;
    const id = String(request.params.assetId);
    if (!z.string().uuid().safeParse(id).success)
      throw new HttpError(404, 'asset_not_found', '未找到文件');
    const state = await readCollectionFeature(directory, form.id);
    const asset = state.responses
      .flatMap((item) => Object.values(item.answers))
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .find(
        (value) => value && typeof value === 'object' && (value as { id?: string }).id === id,
      ) as { name: string; mimeType: string } | undefined;
    if (!asset) throw new HttpError(404, 'asset_not_found', '未找到文件');
    const bytes = await readCollectionUpload(join(directory, 'guest-assets'), id);
    if (!bytes) throw new HttpError(404, 'asset_not_found', '未找到文件');
    response
      .set('Content-Type', asset.mimeType)
      .set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadName(asset.name))}`,
      )
      .send(bytes);
  });
  return router;
}
