import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { HttpError } from '../../core/errors/http-error.js';
import type { createAtlasService } from './atlas-service.js';

export function createAtlasRouter(options: {
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
  service: ReturnType<typeof createAtlasService>;
}) {
  const router = Router();
  router.use(['/atlas', '/showcase'], async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      identity.user.previewing ||
      (identity.user.viewer && identity.user.viewer.uid !== identity.user.uid)
    )
      throw new HttpError(403, 'preview_identity_denied', '请使用本人账号查看私人图鉴');
    response.locals.atlasUser = identity.user;
    next();
  });
  router.get('/atlas', async (_request, response) => {
    response.json({
      data: await options.service.getAtlas(response.locals.atlasUser.uid),
      requestId: response.locals.requestId,
    });
  });
  router.put('/showcase', async (request, response) => {
    if (response.locals.atlasUser.previewing)
      throw new HttpError(403, 'preview_write_denied', '预览身份不能更改成就陈列');
    const input = z
      .object({
        ids: z.array(z.string().min(1).max(100).nullable()).max(6),
        revision: z.number().int().min(0),
      })
      .strict()
      .safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'invalid_showcase', '请提交有效的成就陈列');
    response.json({
      data: await options.service.saveShowcase(
        response.locals.atlasUser.uid,
        input.data.ids,
        input.data.revision,
      ),
      requestId: response.locals.requestId,
    });
  });
  return router;
}
