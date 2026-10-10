import {
  canEditDepartment,
  departmentForRoute,
  type ApiEnvelope,
  type DepartmentDefinition,
  type DepartmentActivitiesPayload,
} from '@freebbs-development/contracts';
import { Router } from 'express';
import multer from 'multer';
import { extname, isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import type { CollectionsRouterOptions } from './router.js';
import { readDepartmentHome, saveDepartmentHome } from './department-home-storage.js';
import { listRegistrations } from './registrations.js';

function send<T>(response: Response, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(200).json(envelope);
}
export function createDepartmentRouter(options: CollectionsRouterOptions): Router {
  const router = Router();
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const configured =
    options.nodeEnvironment !== 'production' ||
    (options.uploadDirectory !== undefined && isAbsolute(options.uploadDirectory));
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 64 },
  }).single('file');
  async function identity(request: Request, response: Response) {
    const result = await options.authenticate(request.headers);
    if (result.status !== 200) throw new HttpError(result.status, result.code, result.message);
    const department = departmentForRoute(
      String(request.params.organizationKey),
      String(request.params.departmentKey),
    );
    if (!department) throw new HttpError(404, 'department_not_found', '未找到部门');
    response.locals.department = department;
    response.locals.departmentActor = result.user;
    return { actor: result.user, department };
  }
  function requireStorage() {
    if (!configured)
      throw new HttpError(503, 'upload_not_configured', '部门主页存储尚未配置，请联系管理员');
  }
  const route = '/:organizationKey/:departmentKey';
  router.get(`${route}/home`, async (request, response) => {
    const { actor, department } = await identity(request, response);
    requireStorage();
    send(response, {
      ...(await readDepartmentHome(directory, department.id)),
      canEdit: canEditDepartment(actor.roles, department.id),
    });
  });
  router.put(
    `${route}/home`,
    async (request, response, next) => {
      const { actor, department } = await identity(request, response);
      if (!canEditDepartment(actor.roles, department.id))
        throw new HttpError(403, 'forbidden', '只有本部门成员可以更新主页');
      requireStorage();
      next();
    },
    (request, response, next) => {
      upload(request, response, (error: unknown) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
          return next(new HttpError(413, 'upload_too_large', '文件超过 5 MiB 上限'));
        next(new HttpError(400, 'invalid_multipart', '上传内容不完整或格式不正确'));
      });
    },
    async (request, response) => {
      const department = response.locals.department as DepartmentDefinition;
      const actor = response.locals.departmentActor as AuthorizationContext;
      const file = request.file;
      if (!file) throw new HttpError(400, 'missing_upload', '请选择 HTML 文件');
      const body = z
        .object({
          revision: z
            .string()
            .regex(/^(0|[1-9]\d*)$/)
            .transform(Number)
            .refine(Number.isSafeInteger),
        })
        .strict()
        .safeParse(request.body);
      if (!body.success) throw new HttpError(400, 'invalid_request', '请提供有效的主页版本');
      if (
        !['.html', '.htm'].includes(extname(file.originalname).toLowerCase()) ||
        /[/\\<>:"|?*]/u.test(file.originalname) ||
        [...file.originalname].some((character) => character.charCodeAt(0) < 32)
      )
        throw new HttpError(400, 'unsupported_file_type', '请选择 .html 或 .htm 文件');
      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      } catch {
        throw new HttpError(400, 'invalid_encoding', 'HTML 文件必须使用 UTF-8 编码');
      }
      let binaryControl = false;
      for (let index = 0; index < html.length; index += 1) {
        const code = html.charCodeAt(index);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
          binaryControl = true;
          break;
        }
      }
      if (!html.trim() || binaryControl)
        throw new HttpError(400, 'invalid_html', '文件为空或包含二进制内容');
      send(response, {
        ...(await saveDepartmentHome(directory, department.id, {
          html,
          originalFilename: file.originalname,
          revision: body.data.revision,
          editor: { uid: actor.uid, displayName: actor.displayName, avatarUrl: actor.avatarUrl },
        })),
        canEdit: true,
      });
    },
  );
  router.get(`${route}/activities`, async (request, response) => {
    const { actor, department } = await identity(request, response);
    const items = (await listRegistrations(options.store, actor, true)).filter(
      ({ publisherDepartmentId }) => publisherDepartmentId === department.id,
    );
    const payload: DepartmentActivitiesPayload = {
      departmentId: department.id,
      active: items.filter(({ status }) => status !== 'closed'),
      past: items.filter(({ status }) => status === 'closed'),
    };
    send(response, payload);
  });
  return router;
}
