import { Router, type Response } from 'express';
import { basename } from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import type { AuthHeaders, AuthenticationResult } from '../../core/auth/auth-middleware.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { FestivalService } from './service.js';
import { festivalStorage, inspectVideo, removeUpload, storedVideoPath } from './storage.js';

interface Options {
  store: DevelopmentStore;
  authenticate(headers: AuthHeaders): Promise<AuthenticationResult>;
  uploadDirectory?: string;
  maxUploadBytes?: number;
}
const querySchema = z
  .object({
    view: z.enum(['showcase', 'mine', 'review']).default('showcase'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
const submissionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    displayConsent: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();
const reviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'unpublish', 'reapprove']),
    note: z.string().trim().max(1000).default(''),
  })
  .strict();
const idSchema = z.string().min(1).max(128);
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, 'invalid_request', '请检查作品标题、说明和提交内容。');
  return parsed.data;
}
function send(response: Response, status: number, data: unknown) {
  response.status(status).json({ data, requestId: response.locals.requestId });
}
export function createFestivalRouter(options: Options): Router {
  const router = Router();
  const storage = festivalStorage(options);
  const service = new FestivalService(options.store, storage.maxUploadBytes);
  router.use(async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const module = (await options.store.modules.list()).find((row) => row.moduleId === 'events');
    if (!module?.enabled || module.status !== 'enabled')
      throw new HttpError(503, 'module_disabled', '活动模块暂不可用。');
    const result = await options.authenticate(request.headers);
    if (result.status !== 200) {
      send(response, result.status, { error: { code: result.code, message: result.message } });
      return;
    }
    response.locals.festivalActor = result.user;
    if (
      !authorize(result.user, {
        action: 'events.read',
        resource: 'activity',
        scope: { type: 'public', id: '*' },
      }).allowed
    )
      throw new HttpError(403, 'events_forbidden', '当前账号无权访问活动栏目。');
    next();
  });
  router.get('/submissions', async (request, response) => {
    const { view, page } = parse(querySchema, request.query);
    send(
      response,
      200,
      await service.list(response.locals.festivalActor as AuthorizationContext, view, page),
    );
  });
  router.post('/submissions', async (request, response) => {
    let persisted = false;
    try {
      await new Promise<void>((resolve, reject) =>
        storage.upload(request, response, (error) => (error ? reject(error) : resolve())),
      );
      const input = parse(submissionSchema, request.body);
      const file = request.file;
      if (!file) throw new HttpError(400, 'video_required', '请选择要上传的视频。');
      const mimeType = await inspectVideo(file);
      const created = await service.create(response.locals.festivalActor as AuthorizationContext, {
        ...input,
        mimeType,
        sizeBytes: file.size,
        storageKey: file.filename,
      });
      persisted = true;
      send(response, 201, created);
    } catch (error) {
      if (!persisted) await removeUpload(request.file?.path);
      if (error instanceof multer.MulterError)
        throw new HttpError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          'invalid_upload',
          error.code === 'LIMIT_FILE_SIZE'
            ? '视频超过上传大小限制。'
            : '请一次提交一个视频，并检查表单内容。',
        );
      throw error;
    }
  });
  router.post('/submissions/:id/review', async (request, response) => {
    const { decision, note } = parse(reviewSchema, request.body);
    send(
      response,
      200,
      await service.review(
        response.locals.festivalActor as AuthorizationContext,
        parse(idSchema, request.params.id),
        decision,
        note,
      ),
    );
  });
  router.get('/submissions/:id/media', async (request, response, next) => {
    const record = await service.media(
      response.locals.festivalActor as AuthorizationContext,
      parse(idSchema, request.params.id),
    );
    response.type(record.mimeType);
    response.setHeader('Content-Disposition', 'inline');
    response.sendFile(
      basename(storedVideoPath(storage.directory, record.storageKey)),
      { root: storage.directory, cacheControl: false, lastModified: false, acceptRanges: true },
      (error) => {
        if (error && !response.headersSent)
          next(new HttpError(404, 'video_not_found', '视频文件暂时不可用，请联系管理员。'));
      },
    );
  });
  return router;
}
