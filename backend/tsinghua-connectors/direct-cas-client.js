/* eslint-disable max-classes-per-file, no-cond-assign, no-control-regex */

const { CampusConnectorError } = require('./errors');
const {
  attachDirectCasStage,
  createDirectCasError,
  isDirectCasErrorCode,
} = require('./direct-cas-diagnostics');

const LEARN_ORIGIN = 'https://learn.tsinghua.edu.cn';
const ID_ORIGIN = 'https://id.tsinghua.edu.cn';
const LEARN_HOST = 'learn.tsinghua.edu.cn';
const ID_HOST = 'id.tsinghua.edu.cn';
const LEARN_LOGIN_URL = `${LEARN_ORIGIN}/f/login`;
const LEARN_COURSE_HOME_URL = `${LEARN_ORIGIN}/f/wlxt/index/course/student/`;
const LEARN_SEMESTER_URL = `${LEARN_ORIGIN}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;
const CAS_FORM_PATH = /^\/do\/off\/ui\/auth\/login\/form\/[a-f0-9]{16,64}\/\d+$/i;
const CAS_CHECK_PATH = '/do/off/ui/auth/login/check';
const CAS_SUCCESS_MARKER = '登录成功。正在重定向到';
const LEARN_CALLBACK_PATH = '/f/login';
const LEARN_ROAMING_PATH = '/b/j_spring_security_thauth_roaming_entry';
const LEARN_ROAMING_ALIAS_PATH = '/f/j_spring_security_thauth_roaming_entry';
const ALLOWED_HOSTS = new Set([LEARN_HOST, ID_HOST]);
const CAS_TICKET_PATTERN = /^[A-Za-z0-9._~-]{1,2048}$/;
const LEARN_CSRF_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;
const ALLOWED_COOKIE_DOMAINS = new Set([LEARN_HOST, ID_HOST, 'tsinghua.edu.cn']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 35_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 10;
const DIRECT_GRANT_MAX_AGE_MS = 8 * 60 * 60 * 1_000;
const MAX_GRANT_BYTES = 60 * 1024;
const MAX_COOKIE_COUNT = 128;
const MAX_COOKIE_BYTES = 8 * 1024;
const BROWSER_FINGERPRINT_PATTERN = /^[0-9A-Fa-f]{32}$/;
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const DEVICE_NAME = 'windows,Chrome/131';
const LOGIN_SCOPES = Object.freeze(['semesters', 'courses', 'course_notices', 'homework']);

function safeError(code, stage) {
  return createDirectCasError(code, stage);
}

function validateAllowedUrl(value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ''));
  } catch {
    throw safeError('cas_target_blocked');
  }

  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !ALLOWED_HOSTS.has(url.hostname) ||
    url.toString().length > 4_096
  ) {
    throw safeError('cas_target_blocked');
  }
  return url;
}

function decodeHtml(value) {
  const named = Object.freeze({ amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' });
  return String(value || '').replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (entity, token) => {
      const normalized = token.toLowerCase();
      if (normalized.startsWith('#x')) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      if (normalized.startsWith('#')) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return named[normalized] || entity;
    },
  );
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = decodeHtml(value);
  }
  return attributes;
}

function extractCasUrl(learnHtml) {
  const source = decodeHtml(learnHtml);
  const pattern =
    /https:\/\/id\.tsinghua\.edu\.cn\/do\/off\/ui\/auth\/login\/form\/[a-f0-9]{16,64}\/\d+(?:\?[^\s"'<>]*)?/gi;
  const matches = source.match(pattern) || [];
  for (const candidate of matches) {
    const url = validateAllowedUrl(candidate);
    if (url.hostname === ID_HOST && CAS_FORM_PATH.test(url.pathname)) {
      return url;
    }
  }
  throw safeError('cas_schema_changed');
}

function extractLearnRoamingUrl(identityHtml) {
  const source = String(identityHtml || '');
  const hasSuccessMarker = decodeHtml(source).includes(CAS_SUCCESS_MARKER);
  const anchors = [...source.matchAll(/<a\b([^>]*)>/gi)];
  if (anchors.length > 256) {
    throw safeError('cas_identity_response_unrecognized', 'credential_submit');
  }

  const candidates = new Map();
  for (const match of anchors) {
    const href = String(parseAttributes(match[1]).href || '');
    if (
      !href ||
      href.length > 4_096 ||
      href !== href.trim() ||
      /[\u0000-\u001f\u007f]/.test(href)
    ) {
      continue;
    }

    let url;
    try {
      if (/^https:\/\//i.test(href)) {
        const authority = href.match(/^https:\/\/([^/?#]+)(?=\/)/i);
        if (!authority || authority[1].toLowerCase() !== LEARN_HOST) continue;
        url = new URL(href);
      } else if (hasSuccessMarker && href.startsWith('/')) {
        url = new URL(href, LEARN_ORIGIN);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    const isRoamingTarget =
      url.pathname === LEARN_ROAMING_PATH || url.pathname === LEARN_ROAMING_ALIAS_PATH;
    const isSuccessfulLearnCallback = hasSuccessMarker && url.pathname === LEARN_CALLBACK_PATH;
    if (
      url.protocol !== 'https:' ||
      url.hostname !== LEARN_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      (!isRoamingTarget && !isSuccessfulLearnCallback)
    ) {
      continue;
    }

    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== 'ticket') continue;
    const ticket = entries[0][1];
    if (!CAS_TICKET_PATTERN.test(ticket)) continue;

    const continuation = new URL(`${LEARN_ORIGIN}${url.pathname}`);
    continuation.searchParams.set('ticket', ticket);
    candidates.set(continuation.toString(), continuation.toString());
  }

  if (candidates.size > 1) {
    throw safeError('cas_identity_response_unrecognized', 'credential_submit');
  }
  return candidates.values().next().value || null;
}

function extractLearnCsrfToken(learnHtml) {
  const source = decodeHtml(String(learnHtml || ''));
  const candidates = new Set();
  const matches = [...source.matchAll(/[?&]_csrf=([A-Za-z0-9._~-]{8,512})(?=["'&<>\s])/g)];
  if (matches.length > 4_096) {
    throw safeError('cas_login_unverified', 'session_verify');
  }
  for (const match of matches) {
    if (LEARN_CSRF_PATTERN.test(match[1])) candidates.add(match[1]);
  }

  const inputTags = [...source.matchAll(/<input\b([^>]*)>/gi)].slice(0, 512);
  for (const inputMatch of inputTags) {
    const attributes = parseAttributes(inputMatch[1]);
    const token = String(attributes.value || '');
    if (attributes.name === '_csrf' && LEARN_CSRF_PATTERN.test(token)) {
      candidates.add(token);
    }
  }

  if (candidates.size !== 1) {
    return null;
  }
  return candidates.values().next().value;
}

function captchaIsVisible(html) {
  const source = String(html || '');
  const container = source.match(/<[^>]+\bid\s*=\s*["']c_code["'][^>]*>/i);
  if (!container) return false;
  const attributes = parseAttributes(container[0]);
  const classes = String(attributes.class || '')
    .split(/\s+/)
    .filter(Boolean);
  return !classes.includes('hidden');
}

function extractCasForm(html, pageUrl) {
  const source = String(html || '');
  if (captchaIsVisible(source)) {
    throw safeError('cas_interactive_verification_required');
  }

  const forms = [...source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  let selected = null;
  for (const match of forms) {
    const attributes = parseAttributes(match[1]);
    if (
      attributes.id === 'theform' ||
      (/\bname\s*=\s*["']i_user["']/i.test(match[2]) &&
        /\bname\s*=\s*["']i_pass["']/i.test(match[2]))
    ) {
      selected = { attributes, body: match[2] };
      break;
    }
  }
  if (!selected || String(selected.attributes.method || 'get').toLowerCase() !== 'post') {
    throw safeError('cas_schema_changed');
  }

  let actionUrl;
  try {
    actionUrl = validateAllowedUrl(new URL(selected.attributes.action || '', pageUrl));
  } catch {
    throw safeError('cas_target_blocked');
  }
  if (actionUrl.hostname !== ID_HOST || actionUrl.pathname !== CAS_CHECK_PATH || actionUrl.search) {
    throw safeError('cas_target_blocked');
  }

  const keyElement = source.match(
    /<[^>]+\bid\s*=\s*["']sm2publicKey["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  );
  const publicKey = String(keyElement?.[1] || '').replace(/\s+/g, '');
  if (!/^04[0-9a-f]{128}$/i.test(publicKey)) {
    throw safeError('cas_schema_changed');
  }

  const inputs = Object.create(null);
  let hasUsername = false;
  let hasPassword = false;
  let hasFingerprint = false;
  const inputTags = [...selected.body.matchAll(/<input\b([^>]*)>/gi)].slice(0, 64);
  for (const inputMatch of inputTags) {
    const attributes = parseAttributes(inputMatch[1]);
    const name = String(attributes.name || '');
    const type = String(attributes.type || 'text').toLowerCase();
    if (name === 'i_user') hasUsername = true;
    if (name === 'i_pass') hasPassword = true;
    if (name === 'fingerPrint' && type === 'hidden') hasFingerprint = true;
    if (
      type === 'hidden' &&
      name !== 'i_user' &&
      name !== 'i_pass' &&
      /^[A-Za-z0-9_.:-]{1,80}$/.test(name) &&
      String(attributes.value || '').length <= 2_048
    ) {
      inputs[name] = String(attributes.value || '');
    }
  }
  if (!hasUsername || !hasPassword || !hasFingerprint) {
    throw safeError('cas_schema_changed');
  }

  return { actionUrl, inputs, publicKey };
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return String(value)
    .split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSetCookieHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().flatMap(splitSetCookieHeader);
  }
  return splitSetCookieHeader(headers.get?.('set-cookie'));
}

function defaultCookiePath(pathname) {
  if (!pathname || !pathname.startsWith('/') || pathname === '/') return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function domainMatches(hostname, cookie) {
  if (cookie.hostOnly) return hostname === cookie.domain;
  return hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname, cookiePath) {
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || pathname[cookiePath.length] === '/';
}

function parseSetCookie(rawValue, responseUrl, nowMilliseconds) {
  const source = String(rawValue || '');
  if (!source || Buffer.byteLength(source) > MAX_COOKIE_BYTES) return null;
  const segments = source.split(';');
  const first = segments.shift() || '';
  const separator = first.indexOf('=');
  if (separator <= 0) return null;

  const name = first.slice(0, separator).trim();
  const value = first.slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || /[\u0000-\u001f\u007f;]/.test(value)) {
    return null;
  }

  const response = validateAllowedUrl(responseUrl);
  const cookie = {
    name,
    value,
    domain: response.hostname,
    sourceHost: response.hostname,
    path: defaultCookiePath(response.pathname),
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: '',
    expiresAt: null,
  };
  let maxAgeWasPresent = false;

  for (const rawSegment of segments) {
    const attributeSeparator = rawSegment.indexOf('=');
    const attributeName = (
      attributeSeparator < 0 ? rawSegment : rawSegment.slice(0, attributeSeparator)
    )
      .trim()
      .toLowerCase();
    const attributeValue = (
      attributeSeparator < 0 ? '' : rawSegment.slice(attributeSeparator + 1)
    ).trim();

    if (attributeName === 'domain') {
      const domain = attributeValue.replace(/^\./, '').toLowerCase();
      if (
        !ALLOWED_COOKIE_DOMAINS.has(domain) ||
        !(response.hostname === domain || response.hostname.endsWith(`.${domain}`))
      ) {
        return null;
      }
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (attributeName === 'path' && attributeValue.startsWith('/')) {
      cookie.path = attributeValue.slice(0, 2_048);
    } else if (attributeName === 'secure') {
      cookie.secure = true;
    } else if (attributeName === 'httponly') {
      cookie.httpOnly = true;
    } else if (attributeName === 'samesite') {
      const sameSite = attributeValue.toLowerCase();
      cookie.sameSite = ['lax', 'strict', 'none'].includes(sameSite) ? sameSite : '';
    } else if (attributeName === 'max-age' && /^-?\d+$/.test(attributeValue)) {
      maxAgeWasPresent = true;
      const seconds = Number(attributeValue);
      cookie.expiresAt = Number.isSafeInteger(seconds)
        ? nowMilliseconds + Math.max(seconds, 0) * 1_000
        : nowMilliseconds;
    } else if (attributeName === 'expires' && !maxAgeWasPresent) {
      const timestamp = Date.parse(attributeValue);
      if (Number.isFinite(timestamp)) cookie.expiresAt = timestamp;
    }
  }

  if (name.startsWith('__Secure-') && !cookie.secure) return null;
  if (name.startsWith('__Host-') && (!cookie.secure || !cookie.hostOnly || cookie.path !== '/')) {
    return null;
  }
  return cookie;
}

class TsinghuaCookieJar {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.cookies = new Map();
    this.sequence = 0;
  }

  setCookies(responseUrl, values) {
    for (const rawValue of values || []) {
      const cookie = parseSetCookie(rawValue, responseUrl, this.now());
      if (!cookie) continue;
      const key = `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
      if (cookie.expiresAt !== null && cookie.expiresAt <= this.now()) {
        this.cookies.delete(key);
        continue;
      }
      const previousSequence = this.cookies.get(key)?.sequence;
      this.cookies.set(key, {
        ...cookie,
        sequence: previousSequence ?? this.sequence,
      });
      this.sequence += 1;
      if (this.cookies.size > MAX_COOKIE_COUNT) {
        throw safeError('cas_cookie_limit_exceeded');
      }
    }
  }

  purgeExpired() {
    const currentTime = this.now();
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= currentTime) {
        this.cookies.delete(key);
      }
    }
  }

  matchingCookies(input) {
    const url = input instanceof URL ? input : new URL(String(input));
    if (!ALLOWED_HOSTS.has(url.hostname)) return [];
    this.purgeExpired();
    return [...this.cookies.values()]
      .filter(
        (cookie) =>
          domainMatches(url.hostname, cookie) &&
          pathMatches(url.pathname || '/', cookie.path) &&
          (!cookie.secure || url.protocol === 'https:'),
      )
      .sort(
        (left, right) => right.path.length - left.path.length || left.sequence - right.sequence,
      );
  }

  getCookieHeader(input) {
    return this.matchingCookies(input)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  serializeForLearn() {
    this.purgeExpired();
    return [...this.cookies.values()]
      .filter((cookie) => cookie.sourceHost === LEARN_HOST && domainMatches(LEARN_HOST, cookie))
      .sort((left, right) => right.path.length - left.path.length || left.sequence - right.sequence)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        hostOnly: cookie.hostOnly,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expiresAt: cookie.expiresAt,
      }));
  }
}

function cancelWithoutWaiting(operation) {
  try {
    const result = operation?.();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Cancellation is best effort.
  }
}

function remainingMilliseconds(deadline, now) {
  const remaining = deadline - now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw safeError('cas_timeout');
  }
  return remaining;
}

async function raceBodyOperation(operation, { deadline, now, controller, cancel }) {
  const remaining = remainingMilliseconds(deadline, now);
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller?.abort();
      cancelWithoutWaiting(cancel);
      reject(safeError('cas_timeout'));
    }, remaining);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } catch (error) {
    if (error instanceof CampusConnectorError) throw error;
    if (controller?.signal?.aborted || now() >= deadline || error?.name === 'AbortError') {
      throw safeError('cas_timeout');
    }
    throw safeError('cas_network_error');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readBoundedBody(response, maximumBytes, { deadline, now, controller }) {
  const advertisedLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    controller?.abort();
    cancelWithoutWaiting(() => response.body?.cancel?.());
    throw safeError('cas_response_too_large');
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const arrayBuffer = await raceBodyOperation(() => response.arrayBuffer(), {
      deadline,
      now,
      controller,
      cancel: () => response.body?.cancel?.(),
    });
    const bytes = Buffer.from(arrayBuffer);
    if (bytes.length > maximumBytes) {
      controller?.abort();
      cancelWithoutWaiting(() => response.body?.cancel?.());
      throw safeError('cas_response_too_large');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let reading = true;
  try {
    while (reading) {
      const result = await raceBodyOperation(() => reader.read(), {
        deadline,
        now,
        controller,
        cancel: () => reader.cancel(),
      });
      if (result.done) {
        reading = false;
        continue;
      }
      const chunk = Buffer.from(result.value);
      totalBytes += chunk.length;
      if (totalBytes > maximumBytes) {
        controller?.abort();
        cancelWithoutWaiting(() => reader.cancel());
        throw safeError('cas_response_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }
  }
  return Buffer.concat(chunks, totalBytes);
}

function normalizeCredentials(username, password, fingerprint) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  const normalizedFingerprint = typeof fingerprint === 'string' ? fingerprint : '';
  if (
    !normalizedUsername ||
    normalizedUsername.length > 128 ||
    /[\s\u0000-\u001f\u007f]/.test(normalizedUsername) ||
    !normalizedPassword ||
    normalizedPassword.length > 1_024 ||
    /[\u0000\r\n]/.test(normalizedPassword) ||
    !BROWSER_FINGERPRINT_PATTERN.test(normalizedFingerprint)
  ) {
    throw safeError('cas_credentials_invalid');
  }
  return {
    username: normalizedUsername,
    password: normalizedPassword,
    fingerprint: normalizedFingerprint,
  };
}

function normalizeLimit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw safeError('cas_configuration_invalid');
  }
  return value;
}

function requireSm2() {
  try {
    const dependency = require('sm-crypto');
    if (typeof dependency?.sm2?.doEncrypt !== 'function') {
      throw new Error('missing sm2');
    }
    return dependency.sm2;
  } catch {
    throw safeError('cas_dependency_unavailable');
  }
}

function identityNoteIsVisible(attributesSource) {
  const attributes = parseAttributes(attributesSource);
  const classes = String(attributes.class || '')
    .split(/\s+/)
    .filter(Boolean);
  const style = String(attributes.style || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  return !(
    Object.hasOwn(attributes, 'hidden') ||
    String(attributes['aria-hidden'] || '').toLowerCase() === 'true' ||
    classes.includes('hidden') ||
    classes.includes('d-none') ||
    /(?:^|;)display:none(?:;|$)/.test(style) ||
    /(?:^|;)visibility:hidden(?:;|$)/.test(style)
  );
}

function classifyIdentityPage(html) {
  const source = String(html || '');
  const note = source.match(
    /<([a-z][\w:-]*)\b([^>]*\bid\s*=\s*["']c_note["'][^>]*)>([\s\S]*?)<\/\1\s*>/i,
  );
  const noteText =
    note && identityNoteIsVisible(note[2])
      ? decodeHtml(note[3])
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  if (captchaIsVisible(source) || /短信验证码|动态口令|二次认证|双重认证|安全验证/.test(source)) {
    return safeError('cas_interactive_verification_required');
  }
  if (/\bBAD_CREDENTIALS\b/.test(source) || /用户名或密码|账号或密码/.test(noteText)) {
    return safeError('cas_credentials_rejected');
  }
  return safeError('cas_identity_response_unrecognized', 'credential_submit');
}

function validateSemesterPayload(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.message !== 'success'
  )
    return false;
  const semester = payload.result?.xnxq || payload.result?.id || payload.xnxq;
  return typeof semester === 'string' && semester.length > 0 && semester.length <= 128;
}

function createDirectCasClient({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs,
  totalTimeoutMs,
  maxResponseBytes,
  maxRedirects,
  sm2Impl = null,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw safeError('cas_configuration_invalid');
  }
  const requestTimeoutMs = normalizeLimit(timeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
  const operationTimeoutMs = normalizeLimit(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, 120_000);
  const responseLimit = normalizeLimit(
    maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    2 * 1024 * 1024,
  );
  const redirectLimit = normalizeLimit(maxRedirects, DEFAULT_MAX_REDIRECTS, 20);

  async function fetchOnce({ jar, url: rawUrl, method = 'GET', body, headers = {}, deadline }) {
    const url = validateAllowedUrl(rawUrl);
    const requestDeadline = Math.min(deadline, now() + requestTimeoutMs);
    const remainingMs = remainingMilliseconds(requestDeadline, now);

    const controller = new AbortController();
    const outgoingHeaders = {
      Accept: DEFAULT_ACCEPT,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'User-Agent': USER_AGENT,
      ...headers,
    };
    delete outgoingHeaders.Cookie;
    delete outgoingHeaders.cookie;
    delete outgoingHeaders.Authorization;
    delete outgoingHeaders.authorization;
    const cookieHeader = jar.getCookieHeader(url);
    if (cookieHeader) outgoingHeaders.Cookie = cookieHeader;

    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(safeError('cas_timeout'));
      }, remainingMs);
    });

    let response;
    try {
      const requestPromise = Promise.resolve().then(() =>
        fetchImpl(url.toString(), {
          method,
          body,
          headers: outgoingHeaders,
          redirect: 'manual',
          signal: controller.signal,
        }),
      );
      response = await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof CampusConnectorError) throw error;
      if (controller.signal.aborted || error?.name === 'AbortError') throw safeError('cas_timeout');
      throw safeError('cas_network_error');
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response || !Number.isInteger(response.status) || !response.headers) {
      throw safeError('cas_response_invalid');
    }
    jar.setCookies(url, readSetCookieHeaders(response.headers));
    return { response, url, controller, requestDeadline };
  }

  function cancelBody(response, controller) {
    controller?.abort();
    cancelWithoutWaiting(() => response.body?.cancel?.());
  }

  async function follow({ jar, url, method = 'GET', body, headers = {}, deadline }) {
    let currentUrl = validateAllowedUrl(url);
    let currentMethod = method;
    let currentBody = body;
    let currentHeaders = { ...headers };
    const visited = new Set();

    for (let count = 0; count <= redirectLimit; count += 1) {
      const visitKey = `${currentMethod} ${currentUrl.toString()}`;
      if (visited.has(visitKey)) throw safeError('cas_redirect_limit');
      visited.add(visitKey);

      const result = await fetchOnce({
        jar,
        url: currentUrl,
        method: currentMethod,
        body: currentBody,
        headers: currentHeaders,
        deadline,
      });
      const { response, controller, requestDeadline } = result;
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status)) {
        const responseBody = await readBoundedBody(response, responseLimit, {
          deadline: requestDeadline,
          now,
          controller,
        });
        return { body: responseBody, response, url: currentUrl };
      }
      if (!location || count === redirectLimit) {
        cancelBody(response, controller);
        throw safeError(location ? 'cas_redirect_limit' : 'cas_redirect_location_missing');
      }

      let destination;
      try {
        destination = validateAllowedUrl(new URL(location, currentUrl));
      } catch {
        cancelBody(response, controller);
        throw safeError('cas_redirect_blocked');
      }

      if (
        (response.status === 307 || response.status === 308) &&
        currentMethod === 'POST' &&
        destination.origin !== currentUrl.origin
      ) {
        cancelBody(response, controller);
        throw safeError('cas_redirect_blocked');
      }

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
      ) {
        currentMethod = 'GET';
        currentBody = undefined;
        currentHeaders = { ...currentHeaders };
        delete currentHeaders['Content-Type'];
        delete currentHeaders['content-type'];
      }
      if (destination.origin !== currentUrl.origin) {
        currentHeaders = { ...currentHeaders };
        delete currentHeaders.Origin;
        delete currentHeaders.origin;
        delete currentHeaders.Referer;
        delete currentHeaders.referer;
      }
      cancelBody(response, controller);
      currentUrl = destination;
    }
    throw safeError('cas_redirect_limit');
  }

  async function verifySession(jar, deadline, csrfToken) {
    if (!LEARN_CSRF_PATTERN.test(String(csrfToken || ''))) {
      throw safeError('cas_login_unverified');
    }
    const verificationUrl = new URL(LEARN_SEMESTER_URL);
    verificationUrl.searchParams.set('_csrf', csrfToken);
    const verificationHeaders = {
      Accept: 'application/json, text/javascript, */*;q=0.8',
      Origin: LEARN_ORIGIN,
      Referer: LEARN_COURSE_HOME_URL,
      'X-Requested-With': 'XMLHttpRequest',
    };
    const xsrfCookie = jar
      .matchingCookies(verificationUrl)
      .find((cookie) => cookie.name === 'XSRF-TOKEN');
    if (xsrfCookie) {
      try {
        const xsrfToken = decodeURIComponent(xsrfCookie.value);
        if (LEARN_CSRF_PATTERN.test(xsrfToken)) {
          verificationHeaders['X-XSRF-TOKEN'] = xsrfToken;
        }
      } catch {
        // The URL CSRF token remains the primary, verified mechanism.
      }
    }
    const { response, url, controller, requestDeadline } = await fetchOnce({
      jar,
      url: verificationUrl,
      headers: verificationHeaders,
      deadline,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      cancelBody(response, controller);
      throw safeError('cas_login_unverified');
    }
    if (response.status !== 200 || url.hostname !== LEARN_HOST) {
      cancelBody(response, controller);
      throw safeError('cas_login_unverified');
    }
    const bytes = await readBoundedBody(response, responseLimit, {
      deadline: requestDeadline,
      now,
      controller,
    });
    let payload;
    try {
      payload = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw safeError('cas_login_unverified');
    }
    if (!validateSemesterPayload(payload)) throw safeError('cas_login_unverified');
  }

  async function login({
    username: rawUsername,
    password: rawPassword,
    fingerprint: rawFingerprint,
  } = {}) {
    let stage = 'input_validation';
    try {
      const { username, password, fingerprint } = normalizeCredentials(
        rawUsername,
        rawPassword,
        rawFingerprint,
      );
      const deadline = now() + operationTimeoutMs;
      const jar = new TsinghuaCookieJar({ now });

      stage = 'learn_entry';
      const entry = await follow({ jar, url: LEARN_LOGIN_URL, deadline });
      let casPage = entry;
      if (entry.url.hostname === LEARN_HOST) {
        stage = 'cas_form_parse';
        const casUrl = extractCasUrl(entry.body.toString('utf8'));
        stage = 'cas_form_fetch';
        casPage = await follow({ jar, url: casUrl, deadline });
      }
      stage = 'cas_form_parse';
      if (casPage.url.hostname !== ID_HOST || !CAS_FORM_PATH.test(casPage.url.pathname)) {
        throw safeError('cas_schema_changed');
      }

      const form = extractCasForm(casPage.body.toString('utf8'), casPage.url);
      stage = 'credential_encrypt';
      let encryptedPassword;
      try {
        const cipherText = (sm2Impl || requireSm2()).doEncrypt(password, form.publicKey, 1);
        encryptedPassword = `04${cipherText}`;
      } catch (error) {
        if (error instanceof CampusConnectorError) throw error;
        throw safeError('cas_encryption_failed');
      }
      if (!/^04[0-9a-f]{128,520}$/i.test(String(encryptedPassword || ''))) {
        throw safeError('cas_encryption_output_invalid');
      }

      const postBody = new URLSearchParams({
        ...form.inputs,
        deviceName: DEVICE_NAME,
        fingerPrint: fingerprint,
        i_captcha: '',
        i_user: username,
        i_pass: encryptedPassword,
      }).toString();
      stage = 'credential_submit';
      let completed = await follow({
        jar,
        url: form.actionUrl,
        method: 'POST',
        body: postBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: ID_ORIGIN,
          Referer: casPage.url.toString(),
        },
        deadline,
      });

      if (completed.url.hostname === ID_HOST) {
        const identityHtml = completed.body.toString('utf8');
        const contentType = String(completed.response.headers.get('content-type') || '').trim();
        const isCasCheckHtml =
          completed.url.pathname === CAS_CHECK_PATH &&
          !completed.url.search &&
          completed.response.status === 200 &&
          /^text\/html(?:;|$)/i.test(contentType);
        const roamingUrl = isCasCheckHtml ? extractLearnRoamingUrl(identityHtml) : null;
        if (!roamingUrl) throw classifyIdentityPage(identityHtml);
        completed = await follow({ jar, url: roamingUrl, deadline });
      }
      if (
        completed.url.hostname !== LEARN_HOST ||
        completed.response.status < 200 ||
        completed.response.status >= 300
      ) {
        throw safeError('cas_login_unverified');
      }

      stage = 'session_verify';
      let csrfToken = extractLearnCsrfToken(completed.body.toString('utf8'));
      if (!csrfToken && completed.url.pathname !== new URL(LEARN_COURSE_HOME_URL).pathname) {
        const courseHome = await follow({
          jar,
          url: LEARN_COURSE_HOME_URL,
          deadline,
        });
        const contentType = String(courseHome.response.headers.get('content-type') || '').trim();
        if (
          courseHome.response.status !== 200 ||
          courseHome.url.hostname !== LEARN_HOST ||
          courseHome.url.pathname !== new URL(LEARN_COURSE_HOME_URL).pathname ||
          !/^text\/html(?:;|$)/i.test(contentType)
        ) {
          throw safeError('cas_login_unverified');
        }
        csrfToken = extractLearnCsrfToken(courseHome.body.toString('utf8'));
      }
      await verifySession(jar, deadline, csrfToken);
      stage = 'grant_issue';
      const cookies = jar.serializeForLearn();
      if (!cookies.length) throw safeError('cas_login_unverified');
      const grant = JSON.stringify({
        version: 1,
        origin: LEARN_ORIGIN,
        cookies,
      });
      if (Buffer.byteLength(grant) > MAX_GRANT_BYTES) throw safeError('cas_grant_too_large');

      const grantIssuedAt = now();
      const hardExpiresAt = grantIssuedAt + DIRECT_GRANT_MAX_AGE_MS;
      const persistentExpiries = cookies
        .map((cookie) => cookie.expiresAt)
        .filter((value) => Number.isFinite(value) && value > grantIssuedAt);
      const result = {
        subject: username.toLowerCase(),
        opaqueGrant: grant,
        scopes: [...LOGIN_SCOPES],
        expiresAt: new Date(Math.min(hardExpiresAt, ...persistentExpiries)).toISOString(),
      };
      return result;
    } catch (error) {
      if (error instanceof CampusConnectorError && isDirectCasErrorCode(error.code)) {
        throw attachDirectCasStage(error, stage);
      }
      throw safeError('cas_internal_error', stage);
    }
  }

  return Object.freeze({ login });
}

async function loginWithDirectCas(options = {}) {
  const { username, password, fingerprint, ...clientOptions } = options;
  return createDirectCasClient(clientOptions).login({ username, password, fingerprint });
}

module.exports = {
  CAS_CHECK_PATH,
  DIRECT_GRANT_MAX_AGE_MS,
  ID_ORIGIN,
  LEARN_LOGIN_URL,
  LEARN_ORIGIN,
  LEARN_SEMESTER_URL,
  TsinghuaCookieJar,
  createDirectCasClient,
  extractCasForm,
  extractLearnCsrfToken,
  extractCasUrl,
  extractLearnRoamingUrl,
  loginWithDirectCas,
  parseSetCookie,
  validateAllowedUrl,
};
