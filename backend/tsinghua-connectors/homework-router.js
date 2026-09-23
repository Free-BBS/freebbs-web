const express = require('express');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { asCampusConnectorError } = require('./errors');
const { MAX_DOWNLOAD_BYTES, fail } = require('./homework-client');

function createHomeworkRouter({ service, requireAuth, frontendBaseUrl }) {
  const router = express.Router();
  const { origin } = new URL(frontendBaseUrl);
  const active = new Map();
  router.use(async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    try {
      if (
        (request.headers.origin && request.headers.origin !== origin) ||
        (request.method !== 'GET' && request.headers.origin !== origin)
      ) {
        fail('homework_origin_blocked', '请从本站工作台操作。', 403);
      }
      const user = await requireAuth(request, response);
      if (!user) return;
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.set('Allow', 'GET, HEAD');
        fail('homework_read_only', '作业模块仅支持查询和下载，不允许提交。', 405);
      }
      if (
        (active.get(user.id) || 0) >= 2 ||
        [...active.values()].reduce((a, b) => a + b, 0) >= 16
      ) {
        fail('homework_busy', '作业请求正在处理中，请稍后再试。', 429);
      }
      active.set(user.id, (active.get(user.id) || 0) + 1);
      response.once('close', () => {
        const count = (active.get(user.id) || 1) - 1;
        if (count) active.set(user.id, count);
        else active.delete(user.id);
      });
      request.homeworkUser = user;
      next();
    } catch (error) {
      next(error);
    }
  });
  router.param('semesterId', (request, _response, next, value) => {
    if (!/^[\w-]{1,32}$/.test(value)) {
      try {
        fail('homework_invalid_semester', '学期标识无效。', 400);
      } catch (error) {
        return next(error);
      }
    }
    return next();
  });
  const base = '/semesters/:semesterId';
  const item = `${base}/items/:reference`;
  function wrap(handler) {
    return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
  }
  const args = (request) => [
    request.homeworkUser.id,
    request.params.semesterId,
    request.params.reference,
  ];
  router.get(
    base,
    wrap(async (request, response) => {
      response.json(await service.list(request.homeworkUser.id, request.params.semesterId));
    }),
  );
  router.get(
    item,
    wrap(async (request, response) => {
      response.json({ homework: await service.getDetail(...args(request)) });
    }),
  );
  router.get(
    `${item}/attachments/:attachmentId`,
    wrap(async (request, response) => {
      const { response: upstream, attachment } = await service.download(
        ...args(request),
        request.params.attachmentId,
      );
      const type = upstream.headers.get('content-type') || '';
      const declaredSize = Number(upstream.headers.get('content-length'));
      if (
        /text\/html|application\/json/i.test(type) ||
        declaredSize > MAX_DOWNLOAD_BYTES ||
        !upstream.body
      ) {
        await upstream.body?.cancel();
        fail('homework_download_invalid', '附件响应无效或超过 50 MB，请在学堂下载。');
      }
      response.set('Content-Type', 'application/octet-stream');
      response.set(
        'Content-Disposition',
        `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, '%27')}`,
      );
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_DOWNLOAD_BYTES) callback(new Error('download limit exceeded'));
          else callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(upstream.body), limit, response);
    }),
  );
  // Express requires four parameters to recognize an error handler.
  // eslint-disable-next-line no-unused-vars
  router.use((error, _request, response, next) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const safe = asCampusConnectorError(error);
    response.status(safe.status).json({ code: safe.code, message: safe.message });
  });
  return router;
}

module.exports = { createHomeworkRouter };
