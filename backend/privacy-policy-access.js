function createPrivacyPolicyAccess({ verifyToken, requireAccepted, getUserById }) {
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
      // A removed account has no acceptance row either. Preserve authentication's
      // 401 response instead of directing that session to an unusable policy flow.
      // Accepted sessions avoid this additional account lookup.
      if (error.status === 428) {
        let user;
        try {
          user = await getUserById(payload.sub);
        } catch {
          response.status(503).json({
            message: '暂时无法确认隐私政策状态，请稍后重试',
            code: 'privacy_policy_unavailable',
          });
          return undefined;
        }
        if (!user) {
          response.status(401).json({ message: '用户不存在' });
          return undefined;
        }
      }
      response.status(error.status || 503).json({
        message: error.status ? error.message : '暂时无法确认隐私政策状态，请稍后重试',
        code: error.status ? error.code : 'privacy_policy_unavailable',
      });
      return undefined;
    }
  };
}

module.exports = { createPrivacyPolicyAccess };
