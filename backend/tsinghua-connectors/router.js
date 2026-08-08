const express = require('express');
const { asCampusConnectorError } = require('./errors');
const { safeCallbackResult } = require('./broker');
const { readDirectCasStage } = require('./direct-cas-diagnostics');

const CALLBACK_PARAMETER_NAMES = new Set(['code', 'ticket', 'error', 'error_description']);
const AUTHORIZATION_CORRELATION_COOKIE = 'freebbs_tsinghua_authorization';
const AUTHORIZATION_CORRELATION_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_CALLBACK_PATH = '/api/workbench/connectors/tsinghua/callback';
const DIRECT_LOGIN_BODY_LIMIT = 4 * 1024;
const DIRECT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DIRECT_LOGIN_MAX_ATTEMPTS = 5;
const DIRECT_LOGIN_MAX_IP_ATTEMPTS = 50;
const DIRECT_LOGIN_FIELDS = new Set(['username', 'password', 'fingerprint', 'consent']);
const DIRECT_LOGIN_FINGERPRINT_PATTERN = /^[0-9A-Fa-f]{32}$/;

function noStore(response) {
  response.set('Cache-Control', 'no-store');
  response.set('Pragma', 'no-cache');
}

function rejectBody(request, response) {
  const contentLength = String(request.headers['content-length'] || '').trim();
  const transferEncoding = String(request.headers['transfer-encoding'] || '').trim();
  const hasDeclaredBody = Boolean(transferEncoding || (contentLength && contentLength !== '0'));
  if (hasDeclaredBody || (request.body && Object.keys(request.body).length)) {
    response.status(400).json({
      code: 'connector_request_body_not_allowed',
      message: '此操作不接受账号、密码、Cookie、URL 或其他浏览器凭据。',
    });
    return true;
  }
  return false;
}

function sanitizeCallbackParams(query) {
  const result = {};
  for (const name of CALLBACK_PARAMETER_NAMES) {
    const value = query?.[name];
    if (typeof value === 'string' && value.length <= 2048) {
      result[name] = value;
    }
  }
  return result;
}

function readSingleCookie(request, name) {
  const matches = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (matches.length !== 1) return '';

  try {
    return decodeURIComponent(matches[0]);
  } catch {
    return '';
  }
}

function correlationCookieOptions(secure, expiresAt) {
  const options = {
    httpOnly: true,
    path: AUTHORIZATION_CALLBACK_PATH,
    sameSite: 'lax',
    secure,
  };
  const expiry = new Date(expiresAt);
  if (!Number.isNaN(expiry.getTime())) options.expires = expiry;
  return options;
}

function createDirectLoginRateLimiter({
  now = () => Date.now(),
  windowMs = DIRECT_LOGIN_WINDOW_MS,
  maxAttempts = DIRECT_LOGIN_MAX_ATTEMPTS,
  maxIpAttempts = DIRECT_LOGIN_MAX_IP_ATTEMPTS,
} = {}) {
  const attempts = new Map();

  function consume(request, userId) {
    const currentTime = now();
    const remoteAddress = String(request.ip || request.socket?.remoteAddress || 'unknown');
    const buckets = [
      { key: `user:${userId}`, limit: maxAttempts },
      { key: `ip:${remoteAddress}`, limit: Math.max(maxAttempts, maxIpAttempts) },
    ].map(({ key, limit }) => ({
      key,
      limit,
      values: (attempts.get(key) || []).filter((timestamp) => currentTime - timestamp < windowMs),
    }));
    const blocked = buckets.find(({ values, limit }) => values.length >= limit);
    if (blocked) {
      const retryAt = blocked.values[0] + windowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - currentTime) / 1000)),
      };
    }
    buckets.forEach(({ key, values }) => {
      attempts.set(key, [...values, currentTime]);
    });
    if (attempts.size > 10_000) {
      for (const [key, values] of attempts) {
        const active = values.filter((timestamp) => currentTime - timestamp < windowMs);
        if (active.length) attempts.set(key, active);
        else attempts.delete(key);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { consume };
}

function parseDirectLoginBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !DIRECT_LOGIN_FIELDS.has(field))) return null;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
  if (
    body.consent !== true ||
    !/^[A-Za-z0-9._-]{2,64}$/.test(username) ||
    !password ||
    password.length > 256 ||
    !DIRECT_LOGIN_FINGERPRINT_PATTERN.test(fingerprint)
  ) {
    return null;
  }
  return { username, password, fingerprint };
}

function clearDirectLoginValues(request, credentials) {
  if (credentials) {
    const sensitiveCredentials = credentials;
    sensitiveCredentials.username = '';
    sensitiveCredentials.password = '';
    sensitiveCredentials.fingerprint = '';
  }
  if (!request.body || typeof request.body !== 'object') return;
  for (const field of Object.keys(request.body)) {
    delete request.body[field];
  }
}

function createCampusConnectorRouter({
  broker,
  requireAuth,
  frontendBaseUrl,
  correlationCookieSecure,
  allowLoopbackHttp = false,
  directLoginLimiter = createDirectLoginRateLimiter(),
}) {
  if (!broker || typeof requireAuth !== 'function') {
    throw new TypeError('broker and requireAuth are required');
  }
  const router = express.Router();
  const directLoginJsonParser = express.json({
    limit: DIRECT_LOGIN_BODY_LIMIT,
    strict: true,
    type: 'application/json',
  });
  const syncJsonParser = express.json({ limit: 1024, strict: true, type: 'application/json' });
  const frontendOrigin = new URL(frontendBaseUrl || 'http://127.0.0.1:3000');
  const secureCorrelationCookie =
    typeof correlationCookieSecure === 'boolean'
      ? correlationCookieSecure
      : frontendOrigin.protocol === 'https:';

  router.use((request, response, next) => {
    noStore(response);
    next();
  });

  router.post(
    '/direct-login',
    async (request, response, next) => {
      try {
        const user = await requireAuth(request, response);
        if (!user) return;
        request.campusConnectorUser = user;
        next();
      } catch (error) {
        const safeError = asCampusConnectorError(error);
        response.status(safeError.status).json({
          code: safeError.code,
          message: safeError.message,
        });
      }
    },
    (request, response, next) => {
      if (request.secure || allowLoopbackHttp === true) {
        next();
        return;
      }
      response.status(403).json({
        code: 'direct_authorization_https_required',
        message: '清华账号登录仅允许通过安全 HTTPS 连接。',
      });
    },
    (request, response, next) => {
      if (!request.is('application/json')) {
        response.status(415).json({
          code: 'connector_json_required',
          message: '登录请求必须使用 application/json。',
        });
        return;
      }
      directLoginJsonParser(request, response, (error) => {
        if (!error) {
          next();
          return;
        }
        const tooLarge = error?.type === 'entity.too.large';
        response.status(tooLarge ? 413 : 400).json({
          code: tooLarge ? 'connector_request_too_large' : 'connector_json_invalid',
          message: tooLarge ? '登录请求超过安全大小限制。' : '登录请求体无效。',
        });
      });
    },
    async (request, response) => {
      const credentials = parseDirectLoginBody(request.body);
      if (!credentials) {
        clearDirectLoginValues(request, null);
        response.status(400).json({
          code: 'direct_authorization_input_invalid',
          message: '请输入有效账号，并明确同意凭据使用说明。',
        });
        return;
      }

      try {
        const rateLimit = directLoginLimiter.consume(request, request.campusConnectorUser.id);
        if (!rateLimit.allowed) {
          response.set('Retry-After', String(rateLimit.retryAfterSeconds));
          response.status(429).json({
            code: 'direct_authorization_rate_limited',
            message: '登录尝试过于频繁，请稍后再试。',
          });
          return;
        }

        credentials.userId = request.campusConnectorUser.id;
        await broker.connectDirect(credentials);
        response.status(201).json({
          connector: await broker.getStatus(request.campusConnectorUser.id),
        });
      } catch (error) {
        const safeError = asCampusConnectorError(error);
        const stage = readDirectCasStage(safeError) || 'internal';
        response.status(safeError.status).json({
          code: safeError.code,
          message: safeError.message,
          stage,
        });
      } finally {
        clearDirectLoginValues(request, credentials);
      }
    },
  );

  router.get('/status', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      response.json({ connector: await broker.getStatus(user.id) });
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      response.status(safeError.status).json({ code: safeError.code, message: safeError.message });
    }
  });

  router.post('/authorization-attempts', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user || rejectBody(request, response)) return;
      const attempt = await broker.beginAuthorization({
        userId: user.id,
        returnPath: '/workbench',
      });
      const browserBinding = String(attempt?.browserBinding || '');
      if (!AUTHORIZATION_CORRELATION_PATTERN.test(browserBinding)) {
        throw new Error('connector browser binding unavailable');
      }
      response.cookie(
        AUTHORIZATION_CORRELATION_COOKIE,
        browserBinding,
        correlationCookieOptions(secureCorrelationCookie, attempt.expiresAt),
      );
      response.status(201).json({
        authorizationUrl: attempt.authorizationUrl,
        expiresAt: attempt.expiresAt,
      });
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      response.status(safeError.status).json({ code: safeError.code, message: safeError.message });
    }
  });

  router.get('/callback', async (request, response) => {
    let result = 'authorization_failed';
    try {
      const completed = await broker.completeAuthorization({
        state: request.query.state,
        browserBinding: readSingleCookie(request, AUTHORIZATION_CORRELATION_COOKIE),
        callbackParams: sanitizeCallbackParams(request.query),
      });
      result = safeCallbackResult(completed.result);
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      result = safeCallbackResult(safeError.code);
    }

    response.clearCookie(
      AUTHORIZATION_CORRELATION_COOKIE,
      correlationCookieOptions(secureCorrelationCookie),
    );

    const destination = new URL('/workbench', frontendOrigin.origin);
    destination.searchParams.set('connector', 'tsinghua');
    destination.searchParams.set('result', result);
    response.redirect(303, destination.toString());
  });

  router.delete('/connection', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user || rejectBody(request, response)) return;
      await broker.disconnect(user.id);
      response.status(204).end();
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      response.status(safeError.status).json({ code: safeError.code, message: safeError.message });
    }
  });

  router.post('/sync-runs', syncJsonParser, async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      const fields =
        request.body && typeof request.body === 'object' ? Object.keys(request.body) : [];
      if (fields.some((field) => field !== 'semesterId')) {
        response.status(400).json({
          code: 'connector_request_body_not_allowed',
          message: '同步请求只接受网络学堂返回的学期标识。',
        });
        return;
      }
      response
        .status(202)
        .json({ run: await broker.requestSync(user.id, request.body?.semesterId || null) });
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      response.status(safeError.status).json({ code: safeError.code, message: safeError.message });
    }
  });

  router.get('/sync-runs/:publicId', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      const publicId = String(request.params.publicId || '');
      if (!/^csr_[a-f0-9]{24}$/.test(publicId)) {
        response.status(404).json({ code: 'sync_run_not_found', message: '同步任务不存在。' });
        return;
      }
      response.json({ run: await broker.getSyncRun(user.id, publicId) });
    } catch (error) {
      const safeError = asCampusConnectorError(error);
      response.status(safeError.status).json({ code: safeError.code, message: safeError.message });
    }
  });

  return router;
}

module.exports = {
  AUTHORIZATION_CALLBACK_PATH,
  AUTHORIZATION_CORRELATION_COOKIE,
  createDirectLoginRateLimiter,
  createCampusConnectorRouter,
  parseDirectLoginBody,
  readSingleCookie,
  rejectBody,
  sanitizeCallbackParams,
};
