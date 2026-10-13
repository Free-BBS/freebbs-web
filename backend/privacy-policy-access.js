function createPrivacyPolicyAccess({ verifyToken, requireAccepted }) {
  return async (request, response, next) => {
    // Express routes are case insensitive unless explicitly configured otherwise.
    const path = String(request.path || '').toLowerCase();
    if (
      !path.startsWith('/api/') ||
      path === '/api/health' ||
      path === '/api/privacy-policy' ||
      path.startsWith('/api/privacy-policy/') ||
      path.startsWith('/api/auth/')
    )
      return next();
    const authorization = request.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const payload = verifyToken(token);
    // Leave authentication errors and genuinely public access to the route.
    if (!payload?.sub) return next();
    try {
      request.privacyPolicy = await requireAccepted(payload.sub);
      request.privacyPolicyUserId = payload.sub;
      return next();
    } catch (error) {
      response.set('Cache-Control', 'no-store');
      response.status(error.status || 503).json({
        message: error.status ? error.message : '暂时无法确认隐私政策状态，请稍后重试',
        code: error.status ? error.code : 'privacy_policy_unavailable',
      });
      return undefined;
    }
  };
}

module.exports = { createPrivacyPolicyAccess };
