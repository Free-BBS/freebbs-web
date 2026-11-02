const { SystemSettingsError } = require('./system-settings');
const { toPublicModerationSettings } = require('./moderation-settings');

function mountModerationSettingsRoutes(app, { requireAdmin, store, sendError }) {
  const route = '/api/admin/system-settings/moderation';
  const respond = (method, suffix, operation) => {
    app[method](`${route}${suffix}`, async (request, response) => {
      try {
        const actor = await requireAdmin(request, response);
        if (!actor) return;
        const settings = await operation(request, actor);
        response.set('Cache-Control', 'no-store');
        response.json(toPublicModerationSettings(settings));
      } catch (error) {
        sendError(response, error, '监管 API 设置操作失败');
      }
    });
  };
  respond('get', '', () => store.readSettings());
  respond('patch', '', (request, actor) => {
    const body = request.body;
    const allowed = new Set(['baseUrl', 'apiKey', 'textModel', 'imageModel']);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Object.keys(body).length ||
      Object.keys(body).some((key) => !allowed.has(key))
    )
      throw new SystemSettingsError('请提交有效的监管 API 设置。');
    return store.updateSettings({ ...body, actorId: actor.id });
  });
  respond('delete', '/api-key', () => store.deleteApiKey());
}

module.exports = { mountModerationSettingsRoutes };
