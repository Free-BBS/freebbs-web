const express = require('express');
const { getPolicyLibrary } = require('./moderation-policy');

function toDetail(submission) {
  return {
    ...submission,
    contentMarkdown: submission.payload?.content || '',
    boardSlug: submission.payload?.boardSlug || '',
    postId: submission.payload?.postId || null,
    parentCommentId: submission.payload?.parentCommentId || null,
    attachments: (submission.attachments || []).map((attachment) => ({
      id: attachment.id,
      url: `/api/moderation/attachments/${attachment.id}`,
      mimeType: attachment.mimeType,
    })),
  };
}

function createModerationRouter({
  service,
  attachmentStore,
  requireAuth,
  getOptionalAuthUser,
  enabled,
  aiTest,
  audit,
}) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  const authenticated = (handler) => async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (user) await handler(request, response, user);
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status ? error.message : '审核服务暂时不可用，请稍后重试',
      });
    }
  };
  const auditAccess = async (user, writing = false) => {
    if (!enabled || !audit || (writing && !aiTest?.enabled))
      throw Object.assign(new Error('本机审核记录功能尚未启用。'), { status: 503 });
    if (!(await service.isReviewer(user.id)))
      throw Object.assign(new Error('需要审核负责人权限。'), { status: 403 });
  };
  const exactBody = (body, fields) => {
    if (
      !body ||
      Array.isArray(body) ||
      typeof body !== 'object' ||
      Object.keys(body).some((key) => !fields.includes(key))
    )
      throw Object.assign(new Error('复核或样例字段无效。'), { status: 400 });
    return body;
  };
  router.get(
    '/policies',
    authenticated(async (_request, response, user) => {
      if (!enabled || !(await service.isReviewer(user.id)))
        throw Object.assign(new Error('需要审核负责人权限。'), { status: 403 });
      response.json({ library: getPolicyLibrary() });
    }),
  );
  router.get(
    '/submissions/:id/ai-history',
    authenticated(async (request, response, user) => {
      await auditAccess(user);
      response.json(await audit.history({ id: request.params.id, reviewerId: user.id }));
    }),
  );
  router.post(
    '/submissions/:id/ai-runs/:runId/feedback',
    authenticated(async (request, response, user) => {
      await auditAccess(user, true);
      const body = exactBody(request.body, [
        'verdict',
        'decision',
        'categories',
        'ruleIds',
        'supportPriority',
        'note',
        'requestId',
      ]);
      response.json(
        await audit.feedback({
          id: request.params.id,
          runId: request.params.runId,
          reviewerId: user.id,
          body,
        }),
      );
    }),
  );
  router.post(
    '/submissions/:id/ai-runs/:runId/regression',
    authenticated(async (request, response, user) => {
      await auditAccess(user, true);
      const body = exactBody(request.body, [
        'title',
        'content',
        'expectedDecision',
        'categories',
        'ruleIds',
        'supportPriority',
        'reason',
        'syntheticConfirmed',
        'requestId',
      ]);
      response.json(
        await audit.regression({
          id: request.params.id,
          runId: request.params.runId,
          reviewerId: user.id,
          body,
        }),
      );
    }),
  );
  router.get(
    '/regressions/export',
    authenticated(async (_request, response, user) => {
      await auditAccess(user, true);
      response.setHeader(
        'Content-Disposition',
        'attachment; filename="freebbs-policy-regressions.json"',
      );
      response.json(await audit.exportRegressions({ reviewerId: user.id }));
    }),
  );
  router.get(
    '/session',
    authenticated(async (_request, response, user) => {
      response.json({
        enabled,
        reviewer: await service.isReviewer(user.id),
        isAdmin: Boolean(user.is_admin),
        mode: enabled ? 'manual' : 'disabled',
        aiTestEnabled: Boolean(enabled && aiTest?.enabled),
      });
    }),
  );
  router.get(
    '/ai-models',
    authenticated(async (_request, response, user) => {
      if (!enabled || !aiTest?.enabled) {
        response.status(503).json({ message: '本机 AI 试审尚未启用。' });
        return;
      }
      response.json(await aiTest.listModels({ reviewerId: user.id }));
    }),
  );
  router.get(
    '/mine',
    authenticated(async (request, response, user) => {
      response.json(await service.mine({ authorId: user.id, before: request.query.before }));
    }),
  );
  router.get(
    '/submissions',
    authenticated(async (request, response, user) => {
      response.json(
        await service.list({
          reviewerId: user.id,
          status: request.query.status || 'pending',
          before: request.query.before,
        }),
      );
    }),
  );
  router.get(
    '/submissions/:id',
    authenticated(async (request, response, user) => {
      response.json({
        submission: toDetail(await service.detail({ id: request.params.id, userId: user.id })),
      });
    }),
  );
  router.post(
    '/submissions/:id/privacy-preview',
    authenticated(async (request, response, user) => {
      const body = request.body;
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== 'object' ||
        Object.keys(body).some((key) => !['expectedVersion', 'extraTerms'].includes(key))
      ) {
        response.status(400).json({ message: '本地脱敏预览仅接受版本和补充脱敏词。' });
        return;
      }
      response.json({
        preview: await service.previewPrivacy({
          id: request.params.id,
          reviewerId: user.id,
          expectedVersion: body.expectedVersion,
          extraTerms: body.extraTerms,
        }),
      });
    }),
  );
  router.post(
    '/submissions/:id/ai-test',
    authenticated(async (request, response, user) => {
      if (!enabled || !aiTest?.enabled) {
        response.status(503).json({ message: '本机 AI 试审尚未启用。' });
        return;
      }
      const body = request.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => !['expectedVersion', 'inputMode', 'extraTerms', 'model'].includes(key),
        )
      ) {
        response.status(400).json({ message: '试审仅接受稿件版本、输入模式、补充信息和模型。' });
        return;
      }
      response.json({
        result: await aiTest.run({
          id: request.params.id,
          reviewerId: user.id,
          expectedVersion: body.expectedVersion,
          inputMode: body.inputMode,
          extraTerms: body.extraTerms,
          model: body.model,
        }),
      });
    }),
  );
  router.post(
    '/submissions/:id/decision',
    authenticated(async (request, response, user) => {
      response.json({
        submission: await service.decide({
          id: request.params.id,
          reviewerId: user.id,
          decision: request.body.decision,
          reason: request.body.reason,
          requestId: request.body.requestId,
          expectedVersion: request.body.expectedVersion,
        }),
      });
    }),
  );
  router.get(
    '/reviewers',
    authenticated(async (_request, response, user) => {
      response.json({ reviewers: await service.listReviewers({ actorId: user.id }) });
    }),
  );
  router.get(
    '/reviewer-candidates',
    authenticated(async (request, response, user) => {
      response.json({
        users: await service.searchReviewerCandidates({ actorId: user.id, q: request.query.q }),
      });
    }),
  );
  router.patch(
    '/reviewers/:userId',
    authenticated(async (request, response, user) => {
      response.json(
        await service.setReviewer({
          actorId: user.id,
          userId: request.params.userId,
          active: request.body.enabled,
        }),
      );
    }),
  );
  router.get('/attachments/:id', async (request, response) => {
    try {
      const user = await getOptionalAuthUser(request);
      const attachment = await attachmentStore.read({ id: request.params.id, userId: user?.id });
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Disposition', 'inline');
      response.send(attachment.buffer);
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status ? error.message : '图片暂时不可用',
      });
    }
  });
  return router;
}

module.exports = { createModerationRouter, toDetail };
