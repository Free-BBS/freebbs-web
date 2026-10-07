const express = require('express');

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
  router.get(
    '/session',
    authenticated(async (_request, response, user) => {
      response.json({
        enabled,
        reviewer: await service.isReviewer(user.id),
        isAdmin: Boolean(user.is_admin),
        mode: enabled ? 'manual' : 'disabled',
      });
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
