const { CampusConnectorError } = require('./errors');
const { LEARN_ORIGIN, createDirectCasClient } = require('./direct-cas-client');

const ADAPTER_ID = 'tsinghua_direct_cas';
const ADAPTER_VERSION = 'direct-cas-v1';
const GRANT_VERSION = 1;
const MAX_GRANT_BYTES = 60 * 1024;
const MAX_GRANT_COOKIES = 128;
const MAX_COOKIE_VALUE_BYTES = 8 * 1024;
const LEARN_HOST = 'learn.tsinghua.edu.cn';
const ROOT_COOKIE_DOMAIN = 'tsinghua.edu.cn';
const ALLOWED_GRANT_COOKIE_DOMAINS = new Set([LEARN_HOST, ROOT_COOKIE_DOMAIN]);
const COOKIE_FIELDS = new Set([
  'name',
  'value',
  'domain',
  'path',
  'hostOnly',
  'secure',
  'httpOnly',
  'sameSite',
  'expiresAt',
]);
const ALLOWED_SYNC_REQUESTS = Object.freeze([
  Object.freeze({
    method: 'GET',
    pattern: /^\/b\/kc\/zhjw_v_code_xnxq\/getCurrentAndNextSemester$/,
  }),
  Object.freeze({
    method: 'GET',
    pattern:
      /^\/b\/wlxt\/kc\/v_wlkc_xs_xkb_kcb_extend\/student\/loadCourseBySemesterId\/[A-Za-z0-9._:-]{1,128}\/zh$/,
  }),
  Object.freeze({
    method: 'POST',
    pattern: /^\/b\/wlxt\/kcgg\/wlkc_ggb\/student\/pageListXs$/,
  }),
  Object.freeze({
    method: 'POST',
    pattern: /^\/b\/wlxt\/kczy\/zy\/student\/(?:zyListWj|zyListYjwg|zyListYpg)$/,
  }),
]);

const GRANT_FIELDS = new Set(['version', 'origin', 'cookies']);

function connectorError(code, message, status = 500) {
  return new CampusConnectorError(code, message, { status });
}

function invalidGrant(message = '清华会话凭据格式无效。') {
  return connectorError('connector_grant_invalid', message, 500);
}

function hasExactFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  return (
    fields.length === expectedFields.size && fields.every((field) => expectedFields.has(field))
  );
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function validateGrantCookie(cookie) {
  if (!hasExactFields(cookie, COOKIE_FIELDS)) throw invalidGrant();

  const { name, value, domain, path, hostOnly, secure, httpOnly, sameSite, expiresAt } = cookie;
  if (
    typeof name !== 'string' ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
    typeof value !== 'string' ||
    Buffer.byteLength(value) > MAX_COOKIE_VALUE_BYTES ||
    hasControlCharacter(value) ||
    value.includes(';') ||
    typeof domain !== 'string' ||
    !ALLOWED_GRANT_COOKIE_DOMAINS.has(domain) ||
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.length > 2_048 ||
    hasControlCharacter(path) ||
    /[?#\\]/u.test(path) ||
    typeof hostOnly !== 'boolean' ||
    typeof secure !== 'boolean' ||
    typeof httpOnly !== 'boolean' ||
    !['', 'lax', 'strict', 'none'].includes(sameSite) ||
    (expiresAt !== null && !Number.isSafeInteger(expiresAt)) ||
    (domain === ROOT_COOKIE_DOMAIN && hostOnly)
  ) {
    throw invalidGrant();
  }

  return Object.freeze({
    name,
    value,
    domain,
    path,
    hostOnly,
    secure,
    httpOnly,
    sameSite,
    expiresAt,
  });
}

function parseOpaqueGrant(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_GRANT_BYTES) {
    throw invalidGrant();
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidGrant('清华会话凭据无法读取。');
  }
  if (
    !hasExactFields(parsed, GRANT_FIELDS) ||
    parsed.version !== GRANT_VERSION ||
    parsed.origin !== LEARN_ORIGIN ||
    !Array.isArray(parsed.cookies) ||
    parsed.cookies.length < 1 ||
    parsed.cookies.length > MAX_GRANT_COOKIES
  ) {
    throw invalidGrant();
  }

  const cookieKeys = new Set();
  const cookies = parsed.cookies.map((candidate) => {
    const cookie = validateGrantCookie(candidate);
    const key = `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
    if (cookieKeys.has(key)) throw invalidGrant();
    cookieKeys.add(key);
    return cookie;
  });

  return Object.freeze({
    version: GRANT_VERSION,
    origin: LEARN_ORIGIN,
    cookies: Object.freeze(cookies),
  });
}

function targetBlocked() {
  return connectorError('connector_target_blocked', '授权会话只能用于网络学堂固定只读接口。', 400);
}

function validateSyncTarget(rawUrl, method) {
  let url;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(String(rawUrl || ''));
  } catch {
    throw targetBlocked();
  }

  if (
    url.origin !== LEARN_ORIGIN ||
    url.protocol !== 'https:' ||
    url.hostname !== LEARN_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.toString().length > 4_096 ||
    !ALLOWED_SYNC_REQUESTS.some((rule) => rule.method === method && rule.pattern.test(url.pathname))
  ) {
    throw targetBlocked();
  }
  return url;
}

function cookieMatches(cookie, url, nowMilliseconds) {
  if (cookie.expiresAt !== null && cookie.expiresAt <= nowMilliseconds) return false;
  const domainMatches = cookie.hostOnly
    ? url.hostname === cookie.domain
    : url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`);
  const pathMatches =
    url.pathname === cookie.path ||
    (url.pathname.startsWith(cookie.path) &&
      (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'));
  return domainMatches && pathMatches && (!cookie.secure || url.protocol === 'https:');
}

function createAuthorizedFetch(opaqueGrant, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const grant = parseOpaqueGrant(opaqueGrant);

  return async function authorizedFetch(rawUrl, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      throw connectorError('connector_method_blocked', '授权会话仅允许网络学堂只读同步请求。', 400);
    }
    const url = validateSyncTarget(rawUrl, method);
    const currentTime = now();
    if (!Number.isFinite(currentTime)) throw new TypeError('now must return a finite timestamp');

    const matchingCookies = grant.cookies
      .filter((cookie) => cookieMatches(cookie, url, currentTime))
      .sort((left, right) => right.path.length - left.path.length);
    if (!matchingCookies.length) {
      throw connectorError(
        'connector_authorization_required',
        '清华会话已经失效，请重新认证。',
        409,
      );
    }

    const headers = new Headers(options.headers || {});
    headers.delete('Authorization');
    headers.delete('Proxy-Authorization');
    headers.set(
      'Cookie',
      matchingCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    );

    const xsrfCookie = matchingCookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
    headers.delete('X-XSRF-TOKEN');
    if (xsrfCookie) {
      let xsrfToken;
      try {
        xsrfToken = decodeURIComponent(xsrfCookie.value);
      } catch {
        throw invalidGrant('清华会话中的防跨站令牌格式无效。');
      }
      if (hasControlCharacter(xsrfToken)) {
        throw invalidGrant('清华会话中的防跨站令牌格式无效。');
      }
      headers.set('X-XSRF-TOKEN', xsrfToken);
    }

    return fetchImpl(url, {
      ...options,
      credentials: 'omit',
      headers,
      method,
      redirect: 'manual',
    });
  };
}

function createTsinghuaCasAdapter({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const directCasClient = createDirectCasClient({ fetchImpl, now });
  return Object.freeze({
    id: ADAPTER_ID,
    version: ADAPTER_VERSION,
    authorizationStrategy: 'credentials',
    authenticateDirect(credentials) {
      return directCasClient.login(credentials);
    },
    createAuthorizedFetch(opaqueGrant) {
      return createAuthorizedFetch(opaqueGrant, { fetchImpl, now });
    },
    async revoke() {
      return undefined;
    },
  });
}

module.exports = {
  ADAPTER_ID,
  ADAPTER_VERSION,
  createAuthorizedFetch,
  createTsinghuaCasAdapter,
  parseOpaqueGrant,
};
