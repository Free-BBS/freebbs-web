import { Router, type Response } from 'express';
import { z } from 'zod';
import type { OrganizationGroupClass, UserContext } from '@freebbs-development/contracts';
import { CLASS_SECRETARY_TAG } from '@freebbs-development/contracts';
import { directoryPage, type UserDirectory } from '../../core/auth/user-directory.js';
import {
  classSecretaryDto,
  requireClassSecretaryAuthority,
  updateClassSecretary,
} from '../../core/authorization/class-secretaries.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'invalid_request', '授权参数无效');
  return result.data;
}
function send(response: Response, data: unknown) {
  response.json({ data, requestId: response.locals.requestId });
}
export function createClassSecretariesRouter(options: {
  store: DevelopmentStore;
  directory?: UserDirectory;
  readClasses: () => Promise<readonly OrganizationGroupClass[]>;
}): Router {
  const router = Router();
  router.use((_request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'private, no-store');
      requireClassSecretaryAuthority(response.locals.actor as UserContext);
      if (!options.directory)
        throw new HttpError(503, 'user_directory_unavailable', '用户目录暂不可用');
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get('/', async (request, response) => {
    const q = parse(
      z
        .object({
          query: z.string().trim().max(100).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict(),
      request.query,
    );
    const page = await directoryPage(options.directory!, q);
    const [rows, classes] = await Promise.all([
      options.store.tagAssignments.list({
        tagKey: CLASS_SECRETARY_TAG,
        subjectUids: page.items.map((item) => item.uid),
      }),
      options.readClasses(),
    ]);
    send(response, {
      ...page,
      items: page.items.map((user) => classSecretaryDto(user, rows)),
      classes,
    });
  });
  router.get('/:uid', async (request, response) => {
    const uid = parse(z.string().trim().min(1).max(100), request.params.uid);
    const user = await options.directory!.get(uid);
    if (!user || user.uid !== uid) throw new HttpError(404, 'user_not_found', '未找到该用户');
    send(
      response,
      classSecretaryDto(
        user,
        await options.store.tagAssignments.list({ subjectUid: uid, tagKey: CLASS_SECRETARY_TAG }),
      ),
    );
  });
  router.put('/:uid', async (request, response) => {
    const uid = parse(z.string().trim().min(1).max(100), request.params.uid);
    const input = parse(
      z
        .object({
          classIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).max(100),
          revision: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      request.body,
    );
    send(
      response,
      await updateClassSecretary({
        store: options.store,
        directory: options.directory!,
        actor: response.locals.actor as UserContext,
        uid,
        input,
        classes: await options.readClasses(),
      }),
    );
  });
  return router;
}
