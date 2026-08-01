const crypto = require('crypto');

const PORTAL_TARGETS = Object.freeze({
  learn: Object.freeze({
    id: 'learn',
    name: '清华大学网络学堂',
    url: 'https://learn.tsinghua.edu.cn/',
  }),
  info: Object.freeze({
    id: 'info',
    name: '清华大学信息门户',
    url: 'https://info.tsinghua.edu.cn/',
  }),
});
const MAX_RESPONSE_BYTES = 128 * 1024;
const PROBE_CACHE_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const portalCache = new Map();

class PortalBoundaryProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PortalBoundaryProbeError';
    this.code = code;
  }
}

function isTsinghuaHttpsUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'tsinghua.edu.cn' || url.hostname.endsWith('.tsinghua.edu.cn')) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function classifyPortalResponse({ status, location, bodyText }) {
  if (status === 401 || status === 403) {
    return 'auth_required';
  }
  if ([301, 302, 303, 307, 308].includes(status)) {
    return /(?:cas|login|oauth|auth|sso|redirectByStuOrTeacher|统一身份)/i.test(location || '')
      ? 'auth_required'
      : 'redirect_boundary';
  }
  if (status >= 500) {
    return 'upstream_unavailable';
  }
  if (status >= 400) {
    return 'request_blocked';
  }
  if (/(?:cas|统一身份认证|用户登录|登录网络学堂|login)/i.test(bodyText || '')) {
    return 'auth_required';
  }
  return 'reachable';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function probePortalBoundary(
  targetId,
  {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    useCache = true,
  } = {},
) {
  const target = PORTAL_TARGETS[targetId];
  if (!target) {
    throw new PortalBoundaryProbeError('unknown_target', '未知的校内系统探测目标');
  }
  if (typeof fetchImpl !== 'function') {
    throw new PortalBoundaryProbeError('fetch_unavailable', '当前运行环境不支持网络请求');
  }

  const checkedAt = now();
  const cached = portalCache.get(targetId);
  if (useCache && cached && cached.expiresAt > checkedAt.getTime()) {
    return { ...clone(cached.value), cached: true, servedAt: checkedAt.toISOString() };
  }

  const startedAt = process.hrtime.bigint();
  let response;
  try {
    response = await fetchImpl(target.url, {
      credentials: 'omit',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'FREE-BBS/1.0 portal-boundary-verifier',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new PortalBoundaryProbeError('upstream_timeout', `${target.name}请求超时`);
    }
    throw new PortalBoundaryProbeError('upstream_unavailable', `${target.name}当前不可访问`);
  }

  const advertisedLength = Number(response.headers.get('content-length') || 0);
  if (advertisedLength > MAX_RESPONSE_BYTES) {
    throw new PortalBoundaryProbeError('response_too_large', `${target.name}响应超过安全上限`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    throw new PortalBoundaryProbeError('response_too_large', `${target.name}响应超过安全上限`);
  }

  const rawLocation = response.headers.get('location') || '';
  let safeLocation = '';
  if (rawLocation) {
    try {
      const resolved = new URL(rawLocation, target.url);
      safeLocation = isTsinghuaHttpsUrl(resolved) ? resolved.toString() : '[已阻止的非白名单跳转]';
    } catch {
      safeLocation = '[无效跳转]';
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const bodyText = contentType.toLowerCase().includes('text/html')
    ? bytes.toString('utf8').slice(0, 32_768)
    : '';
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const result = {
    runId: crypto.randomUUID(),
    target,
    checkedAt: checkedAt.toISOString(),
    servedAt: checkedAt.toISOString(),
    cached: false,
    network: 'live',
    status: response.status,
    classification: classifyPortalResponse({
      status: response.status,
      location: safeLocation,
      bodyText,
    }),
    redirectLocation: safeLocation,
    contentType,
    remoteDate: response.headers.get('date') || '',
    responseBytes: bytes.length,
    durationMs: Math.round(durationMs),
    contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    safeguards: {
      authenticationUsed: false,
      credentialsSent: false,
      cookiesSent: false,
      responseCookieDiscarded: Boolean(response.headers.get('set-cookie')),
      redirectFollowed: false,
      fixedTargetAllowlist: true,
    },
  };

  if (useCache) {
    portalCache.set(targetId, {
      expiresAt: checkedAt.getTime() + PROBE_CACHE_MS,
      value: clone(result),
    });
  }
  return result;
}

async function probePrimaryTsinghuaPortals(options = {}) {
  const targetIds = Object.keys(PORTAL_TARGETS);
  const results = await Promise.all(
    targetIds.map(async (targetId) => {
      try {
        return await probePortalBoundary(targetId, options);
      } catch (error) {
        return {
          target: PORTAL_TARGETS[targetId],
          checkedAt: (options.now ? options.now() : new Date()).toISOString(),
          network: 'failed',
          error: {
            code: error.code || 'portal_probe_failed',
            message: error.message || '校内系统边界探测失败',
          },
        };
      }
    }),
  );
  return results;
}

module.exports = {
  PORTAL_TARGETS,
  PortalBoundaryProbeError,
  classifyPortalResponse,
  isTsinghuaHttpsUrl,
  probePortalBoundary,
  probePrimaryTsinghuaPortals,
};
