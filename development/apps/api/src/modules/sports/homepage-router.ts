import { Router } from 'express';
import multer from 'multer';
import { extname, isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { ApiEnvelope } from '@freebbs-development/contracts';
import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canMaintainSportsCard, canonicalSportsTeam } from './card-authorization.js';
import { readSportsHomepage, saveSportsHomepage } from './homepage-storage.js';
import type { SportsRouterOptions } from './router.js';

export function createSportsHomepageRouter(options: SportsRouterOptions) {
  const router = Router();
  const storageDirectory = options.homepageDirectory ?? resolve('.data/collection-uploads');
  const configured =
    options.nodeEnvironment !== 'production' ||
    (options.homepageDirectory !== undefined && isAbsolute(options.homepageDirectory));
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 64 },
  }).single('file');
  const multipartRevision = z
    .object({
      revision: z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .transform(Number)
        .refine(Number.isSafeInteger),
    })
    .strict();
  const revisionBody = z
    .object({ revision: z.number().int().nonnegative().refine(Number.isSafeInteger) })
    .strict();
  function send(response: Response, data: unknown) {
    const envelope: ApiEnvelope<unknown> = { data, requestId: response.locals.requestId as string };
    response.status(200).json(envelope);
  }
  function directory() {
    if (!configured) throw new HttpError(503, 'upload_not_configured', '代表队主页存储尚未配置');
    return storageDirectory;
  }
  async function identity(request: Request, write: boolean) {
    const result = await options.authenticate(request.headers);
    if (result.status !== 200) throw new HttpError(result.status, result.code, result.message);
    const teamId = String(request.params.teamId);
    const team = await options.store.sportsTeams.get(teamId);
    if (!canonicalSportsTeam(team, teamId))
      throw new HttpError(404, 'sports_team_not_found', '未找到代表队');
    const canEdit = await canMaintainSportsCard(options.store, result.user, teamId);
    if (write && !canEdit) throw new HttpError(403, 'forbidden', '没有维护这支代表队主页的权限');
    if (
      !write &&
      (!authorize(result.user, {
        action: 'sports.team.read',
        resource: 'sports_team',
        scope: team.scope,
      }).allowed ||
        (team.status !== 'active' && !canEdit))
    )
      throw new HttpError(404, 'sports_team_not_found', '未找到代表队');
    return { actor: result.user, teamId, canEdit };
  }
  const route = '/teams/:teamId/homepage';
  router.get(route, async (request, response) => {
    const { teamId, canEdit } = await identity(request, false);
    send(response, { ...(await readSportsHomepage(directory(), teamId)), canEdit });
  });
  router.put(
    route,
    async (request, response, next) => {
      response.locals.sportsHomeIdentity = await identity(request, true);
      directory();
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
      const { actor, teamId } = response.locals.sportsHomeIdentity as Awaited<
        ReturnType<typeof identity>
      >;
      const file = request.file;
      if (!file) throw new HttpError(400, 'missing_upload', '请选择 HTML 文件');
      const body = multipartRevision.safeParse(request.body);
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
      if (
        !html.trim() ||
        [...html].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 && code !== 9 && code !== 10 && code !== 13;
        })
      )
        throw new HttpError(400, 'invalid_html', '文件为空或包含二进制内容');
      const saved = await saveSportsHomepage(directory(), teamId, {
        html,
        originalFilename: file.originalname,
        revision: body.data.revision,
        editor: { uid: actor.uid, displayName: actor.displayName, avatarUrl: actor.avatarUrl },
      });
      await recordAuditEvent(options.store, {
        actorUid: actor.uid,
        action: 'sports.team.homepage_updated',
        resourceType: 'sports_team',
        resourceId: teamId,
        details: { revision: saved.revision, originalFilename: saved.originalFilename },
      });
      send(response, { ...saved, canEdit: true });
    },
  );
  router.delete(route, async (request, response) => {
    const { actor, teamId } = await identity(request, true);
    const body = revisionBody.safeParse(request.body);
    if (!body.success) throw new HttpError(400, 'invalid_request', '请提供有效的主页版本');
    const saved = await saveSportsHomepage(directory(), teamId, {
      html: null,
      originalFilename: null,
      revision: body.data.revision,
      editor: { uid: actor.uid, displayName: actor.displayName, avatarUrl: actor.avatarUrl },
    });
    await recordAuditEvent(options.store, {
      actorUid: actor.uid,
      action: 'sports.team.homepage_deleted',
      resourceType: 'sports_team',
      resourceId: teamId,
      details: { revision: saved.revision },
    });
    send(response, { ...saved, canEdit: true });
  });
  return router;
}
