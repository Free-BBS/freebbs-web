const cheerio = require('cheerio');
const { extractLearnCsrfToken } = require('./direct-cas-client');
const { CampusConnectorError } = require('./errors');
const { LEARN_ORIGIN, parseHomework } = require('../tsinghua-learn-connector');

const PREFIX = '/b/wlxt/kczy/zy/student/';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function plainText(html, limit = 30000) {
  const $ = cheerio.load(String(html || ''));
  $('script,style,iframe,object').remove();
  $('br').replaceWith('\n');
  $('p,div,li').append('\n');
  return $.root().text().trim().slice(0, limit);
}

function fail(code, message, status = 502) {
  throw new CampusConnectorError(code, message, { status });
}

async function readLimited(response, limit = MAX_PAGE_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    fail('homework_response_too_large', '学堂返回的内容过大。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) fail('homework_response_too_large', '学堂返回的内容过大。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseHomeworkPage(html, homework) {
  const $ = cheerio.load(html);
  $('script,style,iframe,object').remove();
  const attachments = [];
  const roles = ['assignment', 'answer', 'submitted', 'feedback'];
  $('.list.fujian.clearfix').each((index, element) => {
    $(element)
      .find('a[href]')
      .each((_unused, anchor) => {
        try {
          const link = new URL($(anchor).attr('href'), LEARN_ORIGIN);
          const download = new URL(link.searchParams.get('downloadUrl') || link.href, LEARN_ORIGIN);
          const match = download.pathname.match(
            /^\/b\/wlxt\/kczy\/zy\/student\/downloadFile\/([^/]+)\/([A-Za-z0-9._:-]{1,256})$/,
          );
          if (
            download.origin !== LEARN_ORIGIN ||
            download.username ||
            download.password ||
            !match ||
            match[1] !== homework.providerCourseId
          )
            return;
          const id = match[2];
          const role = id === homework.submittedFileId ? 'submitted' : roles[index] || 'attachment';
          if (attachments.some((item) => item.id === id)) return;
          attachments.push({ id, role, name: $(anchor).text().trim().slice(0, 255) || '附件' });
        } catch {
          /* Ignore unrecognized links; never turn them into an open proxy. */
        }
      });
  });
  if (
    homework.submittedFileId &&
    /^[A-Za-z0-9._:-]{1,256}$/.test(homework.submittedFileId) &&
    !attachments.some((item) => item.id === homework.submittedFileId)
  ) {
    attachments.push({
      id: homework.submittedFileId,
      role: 'submitted',
      name: homework.submittedFileName || '已交附件',
    });
  }
  const submitted = $('.boxbox').eq(1).find('div.right').eq(2);
  return {
    attachments,
    submittedContentKnown: submitted.length > 0,
    // Display plain text: upstream HTML must never execute in the workbench origin.
    submittedContent: plainText(submitted.html() || '', 20000),
    answer: plainText($('.list.calendar.clearfix > .fl.right > .c55').eq(1).html() || '', 20000),
  };
}

function createHomeworkClient({ authorizedFetch, assertActive = async () => {} }) {
  let csrf = '';
  async function request(path, options = {}) {
    await assertActive();
    const url = new URL(path, LEARN_ORIGIN);
    if (csrf) url.searchParams.set('_csrf', csrf);
    let response;
    try {
      response = await authorizedFetch(url, {
        ...options,
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error instanceof CampusConnectorError) throw error;
      fail('homework_upstream_unavailable', '网络学堂请求未完成，请稍后核对结果。');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      fail('homework_redirect_blocked', '学堂返回了跳转，请重新连接或在原站下载。', 409);
    }
    if ([401, 403].includes(response.status)) {
      await response.body?.cancel();
      fail('homework_authorization_required', '学堂会话已失效，请重新连接。', 409);
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail('homework_upstream_rejected', '网络学堂暂时无法完成请求。');
    }
    return response;
  }
  async function html(path) {
    const response = await request(path);
    const body = await readLimited(response);
    if (/(?:name=["']i_user["']|登录网络学堂)/i.test(body)) {
      fail('homework_authorization_required', '学堂会话已失效，请重新连接。', 409);
    }
    return body;
  }
  async function initialize() {
    csrf = extractLearnCsrfToken(await html('/f/wlxt/index/course/student/'));
    if (!csrf) fail('homework_csrf_missing', '无法读取学堂操作令牌，请重新连接。', 409);
  }
  async function json(path, body) {
    const response = await request(path, {
      method: 'POST',
      body,
      headers: {
        Origin: LEARN_ORIGIN,
        Referer: `${LEARN_ORIGIN}/f/wlxt/index/course/student/`,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
    });
    let payload;
    try {
      payload = JSON.parse(await readLimited(response));
    } catch (error) {
      if (error instanceof CampusConnectorError) throw error;
      fail('homework_invalid_response', '学堂未返回预期结果。');
    }
    if (payload.result !== 'success')
      fail('homework_operation_rejected', '学堂未接受本次操作，请在原站查看作业要求。', 409);
    return payload;
  }
  async function list(course) {
    const items = new Map();
    for (const [endpoint, status] of [
      ['zyListWj', 'unsubmitted'],
      ['zyListYjwg', 'submitted'],
      ['zyListYpg', 'graded'],
    ]) {
      const aoData = [
        { name: 'wlkcid', value: course.providerCourseId },
        { name: 'iDisplayStart', value: 0 },
        { name: 'iDisplayLength', value: -1 },
        { name: 'sEcho', value: 1 },
        { name: 'iColumns', value: 8 },
      ];
      const payload = await json(
        `${PREFIX}${endpoint}`,
        new URLSearchParams({ aoData: JSON.stringify(aoData) }),
      );
      const parsed = parseHomework(payload, course, status);
      if (parsed.warnings.some((warning) => warning.code !== 'homework_deadline_unrecognized'))
        fail('homework_schema_changed', '部分作业无法解析，请在学堂核对。');
      for (const item of parsed.homework) items.set(item.sourceReference, item);
    }
    return [...items.values()];
  }
  async function detail(homework) {
    if (!homework.providerHomeworkId || !homework.providerStudentHomeworkId) {
      fail('homework_identifier_missing', '缺少作业标识，请重新同步后查看。', 409);
    }
    const params = new URLSearchParams({
      wlkcid: homework.providerCourseId,
      xszyid: homework.providerStudentHomeworkId,
    });
    const page = await html(`/f/wlxt/kczy/zy/student/viewCj?${params}`);
    const payload = await json(
      `${PREFIX}detail`,
      new URLSearchParams({ id: homework.providerHomeworkId }),
    );
    return {
      ...homework,
      ...parseHomeworkPage(page, homework),
      description: plainText(payload.msg),
    };
  }
  async function download(homework, fileId) {
    return request(`${PREFIX}downloadFile/${homework.providerCourseId}/${fileId}`);
  }
  return { initialize, list, detail, download };
}

module.exports = {
  createHomeworkClient,
  parseHomeworkPage,
  readLimited,
  MAX_DOWNLOAD_BYTES,
  fail,
};
