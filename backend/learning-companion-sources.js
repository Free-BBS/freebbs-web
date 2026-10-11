const express = require('express');
const { loadCompanionContext, companionSourceManifest } = require('./learning-companion');

// Metadata for the authenticated owner's current node, never a private-text export.
function createCompanionSourcesRouter({ requireAuth, store, learningStore, loadNode }) {
  const router = express.Router();
  router.get('/sources', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const context = await loadCompanionContext({
        user,
        store,
        learningStore,
        loadNode,
        rawContext: {
          courseSlug: req.query.course,
          knowledgePointId: req.query.point,
        },
      });
      return res.json({ sources: companionSourceManifest(context) });
    } catch (error) {
      return res.status([400, 404].includes(error.status) ? error.status : 503).json({
        message: [400, 404].includes(error.status) ? error.message : '参考资料暂时无法读取',
      });
    }
  });
  return router;
}

module.exports = { createCompanionSourcesRouter };
