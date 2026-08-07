/* eslint-disable max-classes-per-file */

const crypto = require('crypto');

const LEARN_ORIGIN = 'https://learn.tsinghua.edu.cn';
const LEARN_HOST = 'learn.tsinghua.edu.cn';
const IDENTITY_HOST = 'id.tsinghua.edu.cn';
const PARSER_VERSION = 'tsinghua-learn-json-v1';
const SCHEMA_VERSION = 'freebbs.tsinghua.learn.snapshot.v1';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_REQUESTS = 140;
const DEFAULT_MAX_COURSES = 32;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 150;
const MAXIMUM_TIMEOUT_MS = 60_000;
const DEFAULT_SYNC_TIMEOUT_MS = 60_000;
const MAXIMUM_SYNC_TIMEOUT_MS = 120_000;
const MAXIMUM_REQUEST_INTERVAL_MS = 60_000;
const ALLOWED_API_REQUESTS = Object.freeze([
  Object.freeze({
    method: 'GET',
    pattern: /^\/b\/kc\/zhjw_v_code_xnxq\/getCurrentAndNextSemester$/,
  }),
  Object.freeze({
    method: 'GET',
    pattern: /^\/b\/wlxt\/kc\/v_wlkc_xs_xktjb_coassb\/queryxnxq$/,
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
const ALLOWED_ACTION_PATHS = new Set([
  '/f/wlxt/kcgg/wlkc_ggb/student/beforeViewXs',
  '/f/wlxt/kczy/zy/student/tijiao',
]);
const FATAL_SYNC_ERRORS = new Set([
  'authorization_required',
  'redirect_blocked',
  'request_budget_exceeded',
  'target_not_allowed',
  'upstream_rate_limited',
]);

const HOMEWORK_ENDPOINTS = Object.freeze([
  Object.freeze({ endpoint: 'zyListWj', status: 'unsubmitted' }),
  Object.freeze({ endpoint: 'zyListYjwg', status: 'submitted' }),
  Object.freeze({ endpoint: 'zyListYpg', status: 'graded' }),
]);
const HOMEWORK_STATUS_PRIORITY = Object.freeze({
  unsubmitted: 1,
  submitted: 2,
  graded: 3,
});

class TsinghuaConnectorError extends Error {
  constructor(code, message, { resource = '', retryable = false } = {}) {
    super(message);
    this.name = 'TsinghuaConnectorError';
    this.code = code;
    this.resource = resource;
    this.retryable = retryable;
  }
}

function normalizeText(value, maxLength = 4_000) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function decodeHtmlEntities(value) {
  const named = {
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
      return named[normalized] || entity;
    },
  );
}

function normalizeHtmlText(value, maxLength = 4_000) {
  let decoded = String(value || '');
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decodeHtmlEntities(decoded);
  }
  const withoutActiveContent = decoded
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  return normalizeText(withoutActiveContent, maxLength);
}

function stableReference(kind, ...parts) {
  const digest = crypto
    .createHash('sha256')
    .update([kind, ...parts].map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 24);
  return `learn:${kind}:${digest}`;
}

function normalizeIdentifier(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) {
    throw new TsinghuaConnectorError('parser_schema_mismatch', `网络学堂${label}字段不符合预期`);
  }
  return normalized;
}

function normalizeShanghaiDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = raw.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] =
    match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utcMilliseconds = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  const localCheck = new Date(utcMilliseconds + 8 * 60 * 60 * 1000);
  if (
    localCheck.getUTCFullYear() !== year ||
    localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day ||
    localCheck.getUTCHours() !== hour ||
    localCheck.getUTCMinutes() !== minute ||
    localCheck.getUTCSeconds() !== second
  ) {
    return null;
  }
  return new Date(utcMilliseconds).toISOString();
}

function buildLearnActionUrl(path, parameters) {
  const url = new URL(path, LEARN_ORIGIN);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== LEARN_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !ALLOWED_ACTION_PATHS.has(url.pathname)
  ) {
    throw new TsinghuaConnectorError('target_not_allowed', '网络学堂跳转地址不在白名单内');
  }
  for (const [key, value] of Object.entries(parameters || {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function validateLearnApiPath(path, method = 'GET') {
  if (!path.startsWith('/b/') || path.startsWith('//') || path.includes('\\')) {
    throw new TsinghuaConnectorError('target_not_allowed', '网络学堂请求路径不在白名单内');
  }

  let url;
  try {
    url = new URL(path, LEARN_ORIGIN);
  } catch {
    throw new TsinghuaConnectorError('target_not_allowed', '网络学堂请求地址无效');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== LEARN_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TsinghuaConnectorError('target_not_allowed', '网络学堂请求目标不在白名单内');
  }
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const allowed = ALLOWED_API_REQUESTS.some(
    (rule) => rule.method === normalizedMethod && rule.pattern.test(url.pathname),
  );
  if (!allowed || url.search) {
    throw new TsinghuaConnectorError('target_not_allowed', '网络学堂请求路径不在白名单内');
  }
  return url;
}

function looksLikeLoginPage(text) {
  return /(?:统一身份认证|登录网络学堂|用户登录|id\.tsinghua\.edu\.cn|cas\/login)/i.test(
    text || '',
  );
}

function isLoginRedirect(location, baseUrl) {
  if (!location) {
    return false;
  }
  try {
    const url = new URL(location, baseUrl);
    return (
      url.hostname === IDENTITY_HOST ||
      (url.hostname === LEARN_HOST &&
        /(?:\/f\/login|\/login|redirectByStuOrTeacher|sso|cas)/i.test(
          `${url.pathname}?${url.searchParams.toString()}`,
        ))
    );
  } catch {
    return false;
  }
}

async function readBoundedResponse(response, maximumBytes) {
  const advertisedLength = Number(response.headers.get('content-length') || 0);
  if (advertisedLength > maximumBytes) {
    throw new TsinghuaConnectorError('response_too_large', '网络学堂响应超过安全上限');
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) {
      throw new TsinghuaConnectorError('response_too_large', '网络学堂响应超过安全上限');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let reading = true;
  try {
    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        continue;
      }
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new TsinghuaConnectorError('response_too_large', '网络学堂响应超过安全上限');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function runWithTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error('connector timeout');
      error.name = 'TimeoutError';
      reject(error);
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

class TsinghuaLearnTransport {
  constructor({
    authorizedFetch,
    abortSignal = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRequests = DEFAULT_MAX_REQUESTS,
    minimumRequestIntervalMs = DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    clock = () => Date.now(),
    sleep = (delayMs) =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      }),
  }) {
    if (typeof authorizedFetch !== 'function') {
      throw new TypeError('authorizedFetch must be a function');
    }
    if (
      abortSignal !== null &&
      (typeof abortSignal !== 'object' || typeof abortSignal.aborted !== 'boolean')
    ) {
      throw new TypeError('abortSignal must be an AbortSignal');
    }
    const positiveIntegerLimits = [timeoutMs, maxResponseBytes, maxRequests];
    if (
      !positiveIntegerLimits.every((value) => Number.isInteger(value) && value > 0) ||
      !Number.isInteger(minimumRequestIntervalMs) ||
      minimumRequestIntervalMs < 0 ||
      timeoutMs > MAXIMUM_TIMEOUT_MS ||
      maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES ||
      maxRequests > DEFAULT_MAX_REQUESTS ||
      minimumRequestIntervalMs > MAXIMUM_REQUEST_INTERVAL_MS
    ) {
      throw new TypeError('connector limits must be bounded integers');
    }
    if (typeof clock !== 'function' || typeof sleep !== 'function') {
      throw new TypeError('clock and sleep must be functions');
    }
    this.authorizedFetch = authorizedFetch;
    this.abortSignal = abortSignal;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxRequests = maxRequests;
    this.requestCount = 0;
    this.responseEvidence = [];
    this.minimumRequestIntervalMs = minimumRequestIntervalMs;
    this.clock = clock;
    this.sleep = sleep;
    this.nextRequestAt = 0;
  }

  async waitForRateLimit() {
    const currentTime = this.clock();
    const delayMs = Math.max(0, this.nextRequestAt - currentTime);
    this.nextRequestAt = Math.max(currentTime, this.nextRequestAt) + this.minimumRequestIntervalMs;
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }
  }

  async requestJson(resource, method, path, { form } = {}) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['GET', 'POST'].includes(normalizedMethod)) {
      throw new TsinghuaConnectorError('method_not_allowed', '网络学堂连接器仅允许只读请求');
    }
    if (this.requestCount >= this.maxRequests) {
      throw new TsinghuaConnectorError('request_budget_exceeded', '本次同步已达到请求上限', {
        resource,
      });
    }

    const url = validateLearnApiPath(path, normalizedMethod);
    this.requestCount += 1;
    await this.waitForRateLimit();
    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: LEARN_ORIGIN,
      Referer: `${LEARN_ORIGIN}/`,
      'User-Agent': 'FREE-BBS/1.0 Tsinghua read-only connector',
      'X-Requested-With': 'XMLHttpRequest',
    };
    let body;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    let response;
    let bytes;
    try {
      ({ response, bytes } = await runWithTimeout(async (signal) => {
        const requestSignal = this.abortSignal
          ? AbortSignal.any([signal, this.abortSignal])
          : signal;
        const upstreamResponse = await this.authorizedFetch(url, {
          body,
          headers,
          method: normalizedMethod,
          credentials: 'omit',
          redirect: 'manual',
          signal: requestSignal,
        });
        if (!upstreamResponse || typeof upstreamResponse.status !== 'number') {
          throw new TsinghuaConnectorError(
            'invalid_transport_response',
            '授权请求通道返回了无效响应',
          );
        }
        const responseBytes = await readBoundedResponse(upstreamResponse, this.maxResponseBytes);
        return { response: upstreamResponse, bytes: responseBytes };
      }, this.timeoutMs));
    } catch (error) {
      if (error instanceof TsinghuaConnectorError) {
        if (!error.resource) {
          error.resource = resource;
        }
        throw error;
      }
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new TsinghuaConnectorError('upstream_timeout', '网络学堂请求超时', {
          resource,
          retryable: true,
        });
      }
      throw new TsinghuaConnectorError('upstream_unavailable', '网络学堂当前不可访问', {
        resource,
        retryable: true,
      });
    }

    if (response.redirected || (response.url && response.url !== url.toString())) {
      throw new TsinghuaConnectorError('redirect_blocked', '授权请求通道跟随了未允许的跳转', {
        resource,
      });
    }

    this.responseEvidence.push({
      resource,
      status: response.status,
      responseBytes: bytes.length,
      contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      setCookieObserved: Boolean(response.headers.get('set-cookie')),
    });

    const location = response.headers.get('location') || '';
    if (response.status >= 300 && response.status < 400) {
      if (isLoginRedirect(location, url)) {
        throw new TsinghuaConnectorError(
          'authorization_required',
          '清华统一身份认证已失效或尚未完成',
          { resource },
        );
      }
      throw new TsinghuaConnectorError('redirect_blocked', '网络学堂返回了未允许的跳转', {
        resource,
      });
    }
    if ([401, 403].includes(response.status)) {
      throw new TsinghuaConnectorError(
        'authorization_required',
        '清华统一身份认证已失效或尚未完成',
        { resource },
      );
    }
    if (response.status === 429) {
      throw new TsinghuaConnectorError(
        'upstream_rate_limited',
        '网络学堂请求过于频繁，请稍后重试',
        { resource, retryable: true },
      );
    }
    if (response.status >= 500) {
      throw new TsinghuaConnectorError('upstream_unavailable', '网络学堂暂时不可用', {
        resource,
        retryable: true,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new TsinghuaConnectorError('upstream_rejected', '网络学堂拒绝了本次请求', {
        resource,
      });
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const preview = bytes.subarray(0, 32_768).toString('utf8');
    if (looksLikeLoginPage(preview)) {
      throw new TsinghuaConnectorError(
        'authorization_required',
        '清华统一身份认证已失效或尚未完成',
        { resource },
      );
    }
    if (contentType.includes('text/html') || /^\s*<!doctype html/i.test(preview)) {
      throw new TsinghuaConnectorError(
        'unexpected_content_type',
        '网络学堂接口没有返回预期的 JSON',
        { resource },
      );
    }

    try {
      return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new TsinghuaConnectorError('invalid_json', '网络学堂返回了无法解析的数据', {
        resource,
      });
    }
  }
}

function expectNestedArray(payload, path, resource) {
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      throw new TsinghuaConnectorError('parser_schema_mismatch', `网络学堂${resource}结构已变化`, {
        resource,
      });
    }
    current = current[key];
  }
  if (!Array.isArray(current)) {
    throw new TsinghuaConnectorError('parser_schema_mismatch', `网络学堂${resource}结构已变化`, {
      resource,
    });
  }
  return current;
}

function parseSemester(payload) {
  const result = payload?.result;
  if (!result || typeof result !== 'object') {
    throw new TsinghuaConnectorError('parser_schema_mismatch', '网络学堂学期接口结构已变化', {
      resource: 'semester',
    });
  }
  return normalizeIdentifier(result.xnxq ?? result.id, '学期');
}

function parseSemesterList(payload) {
  let rows = payload;
  if (!Array.isArray(rows)) {
    rows = payload?.result ?? payload?.object ?? payload?.list ?? payload?.xnxq ?? [];
  }
  if (!Array.isArray(rows)) rows = [rows];
  const seen = new Set();
  const semesters = [];
  rows.forEach((row) => {
    const value = typeof row === 'string' ? row : (row?.xnxq ?? row?.id ?? row?.value);
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,32}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    semesters.push({
      id,
      label: normalizeText(
        typeof row === 'string' ? row : (row?.xnxqmc ?? row?.name ?? row?.label ?? id),
        64,
      ),
    });
  });
  return semesters;
}

function parseCourses(payload, semesterId) {
  const rows = expectNestedArray(payload, ['resultList'], '课程列表');
  const courses = [];
  const warnings = [];
  const seen = new Set();

  for (const row of rows) {
    try {
      const remoteId = normalizeIdentifier(row?.wlkcid, '课程 ID');
      const title = normalizeText(row?.kcm, 200);
      if (!title) {
        throw new TsinghuaConnectorError('parser_record_rejected', '网络学堂课程缺少名称');
      }
      const sourceReference = stableReference('course', remoteId);
      if (seen.has(sourceReference)) {
        continue;
      }
      seen.add(sourceReference);
      courses.push({
        providerCourseId: remoteId,
        sourceReference,
        title,
        teacher: normalizeText(row?.jsm, 120),
        semesterId: normalizeText(row?.xnxq || semesterId, 32),
        scheduleText: normalizeHtmlText(row?.skddxx || row?.skddxxStr || row?.sksj, 500),
        locationText: normalizeHtmlText(row?.skdd, 200),
      });
    } catch (error) {
      warnings.push({
        code: error.code || 'parser_record_rejected',
        resource: 'courses',
      });
    }
  }

  if (rows.length && !courses.length) {
    throw new TsinghuaConnectorError('parser_schema_mismatch', '网络学堂课程记录均不符合预期', {
      resource: 'courses',
    });
  }
  return { courses, warnings };
}

function parseNotices(payload, course) {
  const rows = expectNestedArray(payload, ['object', 'aaData'], '课程公告');
  const notifications = [];
  const warnings = [];
  const seen = new Set();

  for (const row of rows) {
    try {
      const remoteId = normalizeIdentifier(row?.ggid, '公告 ID');
      const title = normalizeHtmlText(row?.bt, 200);
      if (!title) {
        throw new TsinghuaConnectorError('parser_record_rejected', '网络学堂公告缺少标题');
      }
      const sourceReference = stableReference('notice', course.providerCourseId, remoteId);
      if (seen.has(sourceReference)) {
        continue;
      }
      seen.add(sourceReference);
      const publishedAtSource = normalizeText(row?.fbsjStr || row?.fbsj, 64);
      const publishedAt = normalizeShanghaiDate(publishedAtSource);
      if (publishedAtSource && !publishedAt) {
        throw new TsinghuaConnectorError(
          'parser_record_rejected',
          '网络学堂公告发布时间不符合预期',
        );
      }
      notifications.push({
        recordType: 'notification',
        sourceType: 'network_classroom',
        sourceReference,
        courseReference: course.sourceReference,
        category: 'course',
        title: `[${course.title}] ${title}`.slice(0, 200),
        body: normalizeHtmlText(row?.ggnrStr, 4_000),
        actionUrl: buildLearnActionUrl('/f/wlxt/kcgg/wlkc_ggb/student/beforeViewXs', {
          wlkcid: course.providerCourseId,
          id: remoteId,
        }),
        importance: 'normal',
        publishedAt,
        deadlineAt: null,
        publisher: normalizeText(row?.fbr, 120),
      });
    } catch (error) {
      warnings.push({
        code: error.code || 'parser_record_rejected',
        resource: 'notices',
        courseReference: course.sourceReference,
      });
    }
  }
  if (rows.length && !notifications.length) {
    throw new TsinghuaConnectorError('parser_schema_mismatch', '网络学堂公告记录均不符合预期', {
      resource: 'notices',
    });
  }
  return { notifications, warnings };
}

function parseHomework(payload, course, status) {
  const rows = expectNestedArray(payload, ['object', 'aaData'], '课程作业');
  const homework = [];
  const importantItems = [];
  const warnings = [];
  const seen = new Set();

  for (const row of rows) {
    try {
      const remoteId = normalizeIdentifier(row?.zyid || row?.xszyid, '作业 ID');
      const studentHomeworkId = normalizeIdentifier(row?.xszyid || remoteId, '学生作业 ID');
      const title = normalizeHtmlText(row?.bt, 200);
      if (!title) {
        throw new TsinghuaConnectorError('parser_record_rejected', '网络学堂作业缺少标题');
      }
      const sourceReference = stableReference('homework', course.providerCourseId, remoteId);
      if (seen.has(sourceReference)) {
        continue;
      }
      seen.add(sourceReference);
      const dueAtSource = normalizeText(row?.jzsj, 64);
      const dueAt = normalizeShanghaiDate(dueAtSource);
      if (dueAtSource && !dueAt) {
        throw new TsinghuaConnectorError(
          'parser_record_rejected',
          '网络学堂作业截止时间不符合预期',
        );
      }
      const actionUrl = buildLearnActionUrl('/f/wlxt/kczy/zy/student/tijiao', {
        wlkcid: course.providerCourseId,
        xszyid: studentHomeworkId,
      });
      const normalized = {
        recordType: 'homework',
        sourceType: 'network_classroom',
        sourceReference,
        courseReference: course.sourceReference,
        title: `[${course.title}] ${title}`.slice(0, 200),
        description: normalizeHtmlText(row?.zynr || row?.zytx, 4_000),
        actionUrl,
        startsAt: normalizeShanghaiDate(row?.kssj),
        dueAt,
        status,
      };
      homework.push(normalized);
      if (status === 'unsubmitted') {
        importantItems.push({
          recordType: 'importantItem',
          sourceType: 'network_classroom',
          sourceReference,
          dedupeKey: sourceReference,
          title: normalized.title,
          description: normalized.description,
          actionUrl,
          dueAt,
          priority: 'normal',
          status: 'draft',
        });
      }
    } catch (error) {
      warnings.push({
        code: error.code || 'parser_record_rejected',
        resource: 'homework',
        courseReference: course.sourceReference,
      });
    }
  }
  if (rows.length && !homework.length) {
    throw new TsinghuaConnectorError('parser_schema_mismatch', '网络学堂作业记录均不符合预期', {
      resource: 'homework',
    });
  }
  return { homework, importantItems, warnings };
}

function buildPageForm(courseId, columnCount) {
  return {
    aoData: JSON.stringify([
      { name: 'sEcho', value: 1 },
      { name: 'iColumns', value: columnCount },
      { name: 'iDisplayStart', value: 0 },
      { name: 'iDisplayLength', value: -1 },
      { name: 'wlkcid', value: courseId },
    ]),
  };
}

async function fetchCourseResources(transport, course) {
  const result = {
    notifications: [],
    homework: [],
    importantItems: [],
    warnings: [],
    errors: [],
    fatalError: null,
  };

  try {
    const noticePayload = await transport.requestJson(
      `notices:${course.sourceReference}`,
      'POST',
      '/b/wlxt/kcgg/wlkc_ggb/student/pageListXs',
      { form: buildPageForm(course.providerCourseId, 3) },
    );
    const parsed = parseNotices(noticePayload, course);
    result.notifications.push(...parsed.notifications);
    result.warnings.push(...parsed.warnings);
  } catch (error) {
    if (FATAL_SYNC_ERRORS.has(error.code)) {
      result.fatalError = error;
      return result;
    }
    result.errors.push({
      code: error.code || 'resource_sync_failed',
      courseReference: course.sourceReference,
      resource: 'notices',
      retryable: Boolean(error.retryable),
    });
  }

  for (const homeworkEndpoint of HOMEWORK_ENDPOINTS) {
    try {
      const homeworkPayload = await transport.requestJson(
        `homework:${homeworkEndpoint.status}:${course.sourceReference}`,
        'POST',
        `/b/wlxt/kczy/zy/student/${homeworkEndpoint.endpoint}`,
        { form: buildPageForm(course.providerCourseId, 8) },
      );
      const parsed = parseHomework(homeworkPayload, course, homeworkEndpoint.status);
      result.homework.push(...parsed.homework);
      result.importantItems.push(...parsed.importantItems);
      result.warnings.push(...parsed.warnings);
    } catch (error) {
      if (FATAL_SYNC_ERRORS.has(error.code)) {
        result.fatalError = error;
        return result;
      }
      result.errors.push({
        code: error.code || 'resource_sync_failed',
        courseReference: course.sourceReference,
        resource: `homework:${homeworkEndpoint.status}`,
        retryable: Boolean(error.retryable),
      });
      if (error.retryable) {
        break;
      }
    }
  }
  return result;
}

async function mapWithConcurrency(values, maximumConcurrency, mapper) {
  if (!values.length) {
    return [];
  }
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, maximumConcurrency), values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function dedupeByReference(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (seen.has(record.sourceReference)) {
      return false;
    }
    seen.add(record.sourceReference);
    return true;
  });
}

function dedupeHomeworkByReference(records) {
  const selected = new Map();
  records.forEach((record) => {
    const current = selected.get(record.sourceReference);
    const currentPriority = HOMEWORK_STATUS_PRIORITY[current?.status] || 0;
    const candidatePriority = HOMEWORK_STATUS_PRIORITY[record.status] || 0;
    if (!current || candidatePriority > currentPriority) {
      selected.set(record.sourceReference, record);
    }
  });
  return [...selected.values()];
}

function toPublicCourse(course) {
  return {
    sourceReference: course.sourceReference,
    title: course.title,
    teacher: course.teacher,
    semesterId: course.semesterId,
    scheduleText: course.scheduleText,
    locationText: course.locationText,
  };
}

async function performTsinghuaLearnSync({
  authorizedFetch,
  abortSignal,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maxRequests = DEFAULT_MAX_REQUESTS,
  maxCourses = DEFAULT_MAX_COURSES,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  minimumRequestIntervalMs = DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
  clock,
  sleep,
  semesterId: requestedSemesterId,
} = {}) {
  const boundedMaxRequests = Math.min(Math.max(1, Number(maxRequests) || 1), DEFAULT_MAX_REQUESTS);
  const boundedMaxResponseBytes = Math.min(
    Math.max(1, Number(maxResponseBytes) || 1),
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const boundedMaxCourses = Math.min(Math.max(1, Number(maxCourses) || 1), DEFAULT_MAX_COURSES);
  const transport = new TsinghuaLearnTransport({
    authorizedFetch,
    abortSignal,
    maxRequests: boundedMaxRequests,
    maxResponseBytes: boundedMaxResponseBytes,
    minimumRequestIntervalMs,
    clock,
    sleep,
    timeoutMs,
  });
  const semesterPayload = await transport.requestJson(
    'semester',
    'GET',
    '/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester',
  );
  const semesterId = parseSemester(semesterPayload);
  const semesterListPayload = await transport.requestJson(
    'semester-list',
    'GET',
    '/b/wlxt/kc/v_wlkc_xs_xktjb_coassb/queryxnxq',
  );
  const availableSemesters = parseSemesterList(semesterListPayload);
  if (!availableSemesters.some((semester) => semester.id === semesterId)) {
    availableSemesters.unshift({ id: semesterId, label: semesterId });
  }
  const selectedSemesterId = requestedSemesterId
    ? normalizeIdentifier(requestedSemesterId, '学期')
    : semesterId;
  if (!availableSemesters.some((semester) => semester.id === selectedSemesterId)) {
    throw new TsinghuaConnectorError('semester_not_available', '所选学期不在网络学堂列表中');
  }
  const coursePayload = await transport.requestJson(
    'courses',
    'GET',
    `/b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/${encodeURIComponent(
      selectedSemesterId,
    )}/zh`,
  );
  const parsedCourses = parseCourses(coursePayload, selectedSemesterId);
  const warnings = [...parsedCourses.warnings];
  const courses = parsedCourses.courses.slice(0, boundedMaxCourses);
  const boundedConcurrency = Math.min(
    Math.max(1, Number(maxConcurrency) || 1),
    DEFAULT_MAX_CONCURRENCY,
  );
  if (parsedCourses.courses.length > courses.length) {
    warnings.push({
      code: 'course_limit_applied',
      resource: 'courses',
      omittedCount: parsedCourses.courses.length - courses.length,
    });
  }

  let fatalError = null;
  const scheduledCourseResults = await mapWithConcurrency(
    courses,
    boundedConcurrency,
    async (course) => {
      if (fatalError) {
        return null;
      }
      const result = await fetchCourseResources(transport, course);
      fatalError ||= result.fatalError;
      return result;
    },
  );
  if (fatalError) {
    throw fatalError;
  }
  const courseResults = scheduledCourseResults.filter(Boolean);

  const notifications = dedupeByReference(courseResults.flatMap((result) => result.notifications));
  const homework = dedupeHomeworkByReference(courseResults.flatMap((result) => result.homework));
  const currentHomework = new Map(homework.map((item) => [item.sourceReference, item]));
  const importantItems = dedupeByReference(
    courseResults.flatMap((result) => result.importantItems),
  ).filter((item) => currentHomework.get(item.sourceReference)?.status === 'unsubmitted');
  const errors = courseResults.flatMap((result) => result.errors);
  warnings.push(...courseResults.flatMap((result) => result.warnings));
  const fetchedAt = now();
  if (!(fetchedAt instanceof Date) || Number.isNaN(fetchedAt.getTime())) {
    throw new TypeError('now must return a valid Date');
  }

  return {
    connectorId: 'tsinghua-learn',
    target: 'learn',
    schemaVersion: SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    fetchedAt: fetchedAt.toISOString(),
    status: errors.length || warnings.length ? 'partial' : 'complete',
    semesterId: selectedSemesterId,
    currentSemesterId: semesterId,
    availableSemesters,
    courses: courses.map(toPublicCourse),
    notifications,
    homework,
    importantItems,
    warnings,
    errors,
    evidence: {
      requestCount: transport.requestCount,
      responses: transport.responseEvidence.map((item) => ({ ...item })),
      counts: {
        courses: courses.length,
        notifications: notifications.length,
        homework: homework.length,
        importantItems: importantItems.length,
      },
      safeguards: {
        authorizedAdapterProvided: true,
        credentialsExposedToCaller: false,
        exactHostAllowlist: true,
        manualRedirectRequested: true,
        rawResponsesStored: false,
        maximumConcurrency: boundedConcurrency,
        maximumResponseBytes: boundedMaxResponseBytes,
        maximumRequests: boundedMaxRequests,
        minimumRequestIntervalMs,
      },
    },
  };
}

async function syncTsinghuaLearn(options = {}) {
  const syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  if (
    !Number.isInteger(syncTimeoutMs) ||
    syncTimeoutMs <= 0 ||
    syncTimeoutMs > MAXIMUM_SYNC_TIMEOUT_MS
  ) {
    throw new TypeError('syncTimeoutMs must be a bounded positive integer');
  }

  try {
    const snapshot = await runWithTimeout(
      (abortSignal) => performTsinghuaLearnSync({ ...options, abortSignal }),
      syncTimeoutMs,
    );
    snapshot.evidence.safeguards.maximumSyncDurationMs = syncTimeoutMs;
    return snapshot;
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new TsinghuaConnectorError('sync_timeout', '网络学堂整次同步超时', {
        retryable: true,
      });
    }
    throw error;
  }
}

function getTsinghuaConnectorCapabilities({
  learnAuthorizedTransportConfigured = false,
  infoAuthorizedTransportConfigured = false,
  acceptsPasswordFromBrowser = false,
  learnLiveSyncVerified = false,
} = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    connectors: [
      {
        id: 'tsinghua-learn',
        name: '清华大学网络学堂',
        crawlCore: 'implemented_fixture_validated',
        implementationState: 'implemented',
        validationState: learnLiveSyncVerified ? 'live_account_verified' : 'fixture_only',
        liveSyncState: learnLiveSyncVerified
          ? 'verified'
          : learnAuthorizedTransportConfigured
            ? 'transport_configured_live_sync_unverified'
            : 'blocked_pending_authorization',
        authorization: learnAuthorizedTransportConfigured
          ? 'configured'
          : 'awaiting_approved_session_broker',
        supports: ['semesters', 'courses', 'course_notices', 'homework'],
      },
      {
        id: 'tsinghua-info',
        name: '清华大学信息门户',
        crawlCore: 'boundary_probe_only',
        implementationState: 'boundary_probe_only',
        validationState: 'live_boundary_probe',
        liveSyncState: 'not_implemented',
        authorization: infoAuthorizedTransportConfigured
          ? 'configured'
          : 'awaiting_official_integration',
        supports: ['authentication_boundary_probe'],
      },
    ],
    safeguards: {
      acceptsPasswords: Boolean(acceptsPasswordFromBrowser),
      acceptsClientCookies: false,
      arbitraryTargetUrls: false,
      rawPagesPersisted: false,
    },
  };
}
function getLearnConnectorCapabilities(options = {}) {
  const capabilities = getTsinghuaConnectorCapabilities(options);
  const learn = capabilities.connectors.find((connector) => connector.id === 'tsinghua-learn');
  const isConfigured = learn.authorization === 'configured';
  return {
    schemaVersion: capabilities.schemaVersion,
    parserVersion: PARSER_VERSION,
    ...learn,
    transport: {
      mode: 'server_side_only',
      requiresOfficialAuthorization: options.authorizationStrategy !== 'direct_cas',
      state: isConfigured ? 'configured' : 'awaiting_authorized_transport',
      acceptsPasswordFromBrowser: Boolean(options.acceptsPasswordFromBrowser),
      acceptsCookieFromBrowser: false,
      acceptsArbitraryTargetUrl: false,
    },
    safeguards: {
      ...capabilities.safeguards,
      rawResponsesPersisted: false,
      redirectModeRequested: 'manual',
      exactHostAllowlist: true,
      maximumConcurrency: DEFAULT_MAX_CONCURRENCY,
      maximumCoursesPerRun: DEFAULT_MAX_COURSES,
      maximumRequestsPerRun: DEFAULT_MAX_REQUESTS,
      maximumSyncDurationMs: DEFAULT_SYNC_TIMEOUT_MS,
      maximumResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      minimumRequestIntervalMs: DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    },
  };
}

module.exports = {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_COURSES,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_MAX_RESPONSE_BYTES,
  HOMEWORK_ENDPOINTS,
  LEARN_HOST,
  DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
  LEARN_ORIGIN,
  PARSER_VERSION,
  SCHEMA_VERSION,
  TsinghuaConnectorError,
  TsinghuaLearnTransport,
  buildLearnActionUrl,
  getLearnConnectorCapabilities,
  getTsinghuaConnectorCapabilities,
  mapWithConcurrency,
  normalizeHtmlText,
  normalizeShanghaiDate,
  parseCourses,
  parseHomework,
  parseNotices,
  parseSemester,
  parseSemesterList,
  stableReference,
  syncTsinghuaLearn,
  validateLearnApiPath,
};
