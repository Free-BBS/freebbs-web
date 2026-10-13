import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { UserContext } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { isDevelopmentBusinessAdmin } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import { matchesMapBearer, resolveMapTokenDigest } from '../map-bridge/credentials.js';
import type { CollaborationOptions } from '../collaboration/router.js';
import {
  connectorStatus,
  dispatchMessage,
  postAdapter,
  type ConnectorMessage,
} from './transport.js';
import { syncArticleFeed } from './feed.js';
export interface ImportedExperience {
  id: string;
  uid: string;
  title: string;
  occurredAt: string;
  domain: string;
  provider: 'map';
  updatedAt: string;
}
interface Job extends ConnectorMessage {
  id: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'sending' | 'sent' | 'failed';
  error: string;
  revision: number;
}
export function canConfigureDevelopment(user: UserContext) {
  return isDevelopmentBusinessAdmin(user);
}
const messageSchema = z
  .object({
    channel: z.enum(['email', 'webhook']),
    title: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(10000),
    recipients: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  })
  .strict();
export function createConnectorsRouter(
  options: CollaborationOptions & { environment?: NodeJS.ProcessEnv },
) {
  const router = Router();
  const environment = options.environment ?? process.env;
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const jobs = featureStorage<Job>(directory, 'connector-jobs');
  function requireStorage() {
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      throw new HttpError(503, 'storage_not_configured', '连接资料存储尚未配置');
  }
  router.post('/map/experiences', async (request) => {
    requireStorage();
    const digest = resolveMapTokenDigest(environment);
    if (!digest) throw new HttpError(503, 'connector_not_configured', 'Map经历接入尚未配置');
    if (!matchesMapBearer(request.headers.authorization, digest))
      throw new HttpError(401, 'invalid_token', '无效的接入令牌');
    throw new HttpError(410, 'map_binding_required', '请绑定账号后使用新的 Map 同步接口');
  });
  router.use(async (request, response, next) => {
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (!canConfigureDevelopment(identity.user))
      throw new HttpError(403, 'forbidden', '只有平台管理员可以管理连接设置');
    requireStorage();
    response.locals.user = identity.user;
    next();
  });
  router.get('/status', (_request, response) =>
    response.json({ data: connectorStatus(environment), requestId: response.locals.requestId }),
  );
  router.post('/feed/sync', async (_request, response) =>
    response.json({
      data: await syncArticleFeed(directory, environment),
      requestId: response.locals.requestId,
    }),
  );
  router.get('/jobs', async (_request, response) =>
    response.json({
      data: (await jobs.list())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100),
      requestId: response.locals.requestId,
    }),
  );
  router.post('/jobs', async (request, response) => {
    const input = messageSchema.safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'invalid_request', '请填写完整通知内容与接收对象');
    const at = new Date().toISOString();
    const job: Job = {
      ...input.data,
      id: randomUUID(),
      ownerUid: (response.locals.user as UserContext).uid,
      createdAt: at,
      updatedAt: at,
      status: 'draft',
      error: '',
      revision: 1,
    };
    await jobs.change(job.id, () => ({ record: job, result: null }));
    response.status(201).json({ data: job, requestId: response.locals.requestId });
  });
  router.post('/jobs/:id/send', async (request, response) => {
    const input = z
      .object({ revision: z.number().int().min(1) })
      .strict()
      .safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'invalid_revision', '请刷新发送记录');
    const job = await jobs.change(String(request.params.id), (current) => {
      if (!current) throw new HttpError(404, 'not_found', '未找到通知');
      if (current.revision !== input.data.revision || current.status !== 'draft')
        throw new HttpError(
          409,
          'already_dispatching',
          '该通知已经处理，请检查发送记录，避免重复发送',
        );
      current.status = 'sending';
      current.revision++;
      current.updatedAt = new Date().toISOString();
      return { record: current, result: current };
    });
    try {
      await dispatchMessage(environment, job);
      await jobs.change(job.id, (current) => {
        current!.status = 'sent';
        current!.revision++;
        current!.updatedAt = new Date().toISOString();
        return { record: current!, result: null };
      });
    } catch (error) {
      await jobs.change(job.id, (current) => {
        current!.status = 'failed';
        current!.error = error instanceof HttpError ? error.message : '发送失败';
        current!.revision++;
        current!.updatedAt = new Date().toISOString();
        return { record: current!, result: null };
      });
      throw error;
    }
    response.json({ data: { sent: true }, requestId: response.locals.requestId });
  });
  router.post('/transfer/:kind', async (request, response) => {
    if (!['cloud', 'publication'].includes(String(request.params.kind)))
      throw new HttpError(404, 'not_found', '未知转存工具');
    const input = z
      .object({
        title: z.string().trim().min(1).max(160),
        sourceUrl: z.string().url().max(2000),
        destination: z.string().trim().min(1).max(200),
        note: z.string().max(2000).default(''),
      })
      .strict()
      .safeParse(request.body);
    if (!input.success || !input.data.sourceUrl.startsWith('https://'))
      throw new HttpError(400, 'invalid_request', '请提供HTTPS素材链接和转存位置');
    await postAdapter(
      environment,
      request.params.kind === 'cloud'
        ? 'DEVELOPMENT_CLOUD_ADAPTER_URL'
        : 'DEVELOPMENT_PUBLICATION_ADAPTER_URL',
      { ...input.data, actorUid: (response.locals.user as UserContext).uid },
    );
    response.json({ data: { accepted: true }, requestId: response.locals.requestId });
  });
  return router;
}
