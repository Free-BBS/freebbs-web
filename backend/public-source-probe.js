const crypto = require('crypto');

const PUBLIC_NOTICE_SOURCE = Object.freeze({
  id: 'thu-learning-notices',
  name: '清华大学学生学习与发展指导中心 · 通知公告',
  url: 'https://learning.tsinghua.edu.cn/xwgg/tzgg.htm',
  homepage: 'https://learning.tsinghua.edu.cn/',
});
const PARSER_VERSION = 'thu-learning-notices-v1';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MIN_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

let cachedProbe = null;

class PublicSourceProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublicSourceProbeError';
    this.code = code;
  }
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return String(value || '').replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, token) => {
      const normalized = token.toLowerCase();
      if (normalized.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return namedEntities[normalized] || entity;
    },
  );
}

function normalizeHtmlText(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
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

function resolveSafeNoticeUrl(value, baseUrl = PUBLIC_NOTICE_SOURCE.url) {
  try {
    const url = new URL(decodeHtmlEntities(value), baseUrl);
    return isTsinghuaHttpsUrl(url) ? url.toString() : '';
  } catch {
    return '';
  }
}

function parsePublicNotices(html, baseUrl = PUBLIC_NOTICE_SOURCE.url) {
  const notices = [];
  const seen = new Set();
  const itemPattern = /<li\b[^>]*class=(['"])[^'"]*\blist-item\b[^'"]*\1[^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of String(html || '').matchAll(itemPattern)) {
    const itemHtml = match[2];
    const hrefMatch = itemHtml.match(/<a\b[^>]*href=(['"])(.*?)\1/i);
    const titleMatch = itemHtml.match(/<h3\b[^>]*title=(['"])(.*?)\1/i);
    const headingMatch = itemHtml.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const monthDayMatch = itemHtml.match(
      /<p\b[^>]*class=(['"])[^'"]*\bmd\b[^'"]*\1[^>]*>([\s\S]*?)<\/p>/i,
    );
    const yearMatch = itemHtml.match(
      /<p\b[^>]*class=(['"])[^'"]*\byear\b[^'"]*\1[^>]*>([\s\S]*?)<\/p>/i,
    );
    const url = resolveSafeNoticeUrl(hrefMatch?.[2], baseUrl);
    const title = normalizeHtmlText(titleMatch?.[2] || headingMatch?.[1]);
    const monthDay = normalizeHtmlText(monthDayMatch?.[2]);
    const year = normalizeHtmlText(yearMatch?.[2]);
    const date =
      /^\d{4}$/.test(year) && /^\d{2}-\d{2}$/.test(monthDay) ? `${year}-${monthDay}` : '';

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    notices.push({
      id: crypto.createHash('sha256').update(url).digest('hex').slice(0, 20),
      title,
      date,
      url,
    });
  }

  return notices;
}

function validateSourceUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'learning.tsinghua.edu.cn' ||
    url.username ||
    url.password
  ) {
    throw new PublicSourceProbeError('redirect_not_allowed', '公开源跳转到了非白名单地址');
  }
  return url;
}

async function fetchPublicDocument({ fetchImpl, timeoutMs }) {
  let currentUrl = validateSourceUrl(PUBLIC_NOTICE_SOURCE.url);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'FREE-BBS/1.0 public-source-verifier',
      },
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new PublicSourceProbeError('redirect_limit', '公开源重定向异常');
      }
      currentUrl = validateSourceUrl(new URL(location, currentUrl));
      continue;
    }

    if (!response.ok) {
      throw new PublicSourceProbeError('upstream_http_error', `公开源返回 HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new PublicSourceProbeError('unexpected_content_type', '公开源没有返回 HTML');
    }

    const advertisedLength = Number(response.headers.get('content-length') || 0);
    if (advertisedLength > MAX_RESPONSE_BYTES) {
      throw new PublicSourceProbeError('response_too_large', '公开源响应超过安全上限');
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) {
      throw new PublicSourceProbeError('response_too_large', '公开源响应超过安全上限');
    }

    return {
      bytes,
      contentType,
      finalUrl: currentUrl.toString(),
      lastModified: response.headers.get('last-modified') || '',
      remoteDate: response.headers.get('date') || '',
      status: response.status,
    };
  }

  throw new PublicSourceProbeError('redirect_limit', '公开源重定向异常');
}

function cloneProbe(value) {
  return JSON.parse(JSON.stringify(value));
}

async function probePublicNoticeSource({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  useCache = true,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new PublicSourceProbeError('fetch_unavailable', '当前运行环境不支持网络请求');
  }

  const requestedAt = now();
  const requestedAtMs = requestedAt.getTime();
  if (useCache && cachedProbe && cachedProbe.expiresAt > requestedAtMs) {
    return {
      ...cloneProbe(cachedProbe.value),
      cached: true,
      servedAt: requestedAt.toISOString(),
    };
  }

  const startedAt = process.hrtime.bigint();
  let document;
  try {
    document = await fetchPublicDocument({ fetchImpl, timeoutMs });
  } catch (error) {
    if (error instanceof PublicSourceProbeError) {
      throw error;
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new PublicSourceProbeError('upstream_timeout', '公开源请求超时');
    }
    throw new PublicSourceProbeError('upstream_unavailable', '公开源当前不可访问');
  }

  const html = document.bytes.toString('utf8').replace(/^\uFEFF/, '');
  const items = parsePublicNotices(html, document.finalUrl);
  if (!items.length) {
    throw new PublicSourceProbeError('parser_no_results', '页面可访问，但没有解析出通知条目');
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const result = {
    runId: crypto.randomUUID(),
    source: PUBLIC_NOTICE_SOURCE,
    fetchedAt: requestedAt.toISOString(),
    servedAt: requestedAt.toISOString(),
    cached: false,
    network: 'live',
    status: document.status,
    finalUrl: document.finalUrl,
    contentType: document.contentType,
    remoteDate: document.remoteDate,
    lastModified: document.lastModified,
    responseBytes: document.bytes.length,
    durationMs: Math.round(durationMs),
    contentSha256: crypto.createHash('sha256').update(document.bytes).digest('hex'),
    parserVersion: PARSER_VERSION,
    itemCount: items.length,
    items: items.slice(0, 10).map((item) => ({
      ...item,
      itemHash: item.id,
    })),
    safeguards: {
      authenticationUsed: false,
      detailsFollowed: 0,
      fixedSourceAllowlist: true,
      minimumRefreshSeconds: MIN_REFRESH_MS / 1000,
      maximumResponseBytes: MAX_RESPONSE_BYTES,
      robotsStatus: 'unknown',
    },
  };

  if (useCache) {
    cachedProbe = {
      expiresAt: requestedAtMs + MIN_REFRESH_MS,
      value: cloneProbe(result),
    };
  }

  return result;
}

module.exports = {
  MAX_RESPONSE_BYTES,
  MIN_REFRESH_MS,
  PARSER_VERSION,
  PUBLIC_NOTICE_SOURCE,
  PublicSourceProbeError,
  isTsinghuaHttpsUrl,
  parsePublicNotices,
  probePublicNoticeSource,
  resolveSafeNoticeUrl,
};
