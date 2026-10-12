// Course-author API only. No website login credentials or automatic write retries.
const fs = require('node:fs');

const SECTION_KEYS = ['basicInfoMarkdown', 'applicationsMarkdown', 'knowledgeMarkdown'];
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

class CourseApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function courseSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error('课程标识须使用平台现有的小写 slug。');
  return value;
}

function nodeId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length > 64 ||
    !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(value)
  )
    throw new Error('知识点 ID 格式无效。');
  return value;
}

function revision(value) {
  if (value !== 'new' && !/^[a-f0-9]{64}$/.test(value || ''))
    throw new Error('请提供 --revision new 或此前回读的 64 位 revision。');
  return value;
}

function readUtf8(file, maximumBytes = 6 * 1024 * 1024) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > maximumBytes)
    throw new Error('请选择大小符合限制的普通 UTF-8 文件。');
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
}

function createCourseClient({
  baseUrl = process.env.FREEBBS_BASE_URL || '',
  token = process.env.FREEBBS_UPLOAD_TOKEN || '',
  timeoutMs = 30000,
} = {}) {
  let origin;
  try {
    origin = new URL(baseUrl);
  } catch {
    throw new Error('请设置 FREEBBS_BASE_URL 为 HTTPS 网站 origin。');
  }
  const localHttp =
    origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    (origin.protocol !== 'https:' && !localHttp) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('FREEBBS_BASE_URL 只接受 HTTPS origin；HTTP 仅限 localhost。');
  if (!/^fbcu_[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('请安全配置 FREEBBS_UPLOAD_TOKEN，不要把 Token 写入命令参数或文件。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new Error('网络超时设置无效。');

  async function request(method, route, payload) {
    if (
      !['GET', 'PUT'].includes(method) ||
      !/^\/courses\/[a-z0-9-]+\/(?:map|nodes\/[A-Z0-9-]+)$/.test(route)
    )
      throw new Error('此工具只允许读取课程地图和读取/更新单个知识点。');
    let response;
    try {
      response = await fetch(`${origin.origin}/api/course-upload${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new CourseApiError(response.status, '服务器发生跳转，已停止；请核对网站 origin。');
      }
      if (!response.ok) {
        await response.body?.cancel();
        const details = {
          401: 'Token 无效、过期或已撤销。',
          403: '没有该课程的资料维护权限，请联系管理员。',
          404: '课程或知识点不存在。',
          409: '内容已被修改，请回读并合并；不会自动重试或覆盖。',
        };
        throw new CourseApiError(
          response.status,
          `HTTP ${response.status}：${details[response.status] || '课程接口请求失败。'}`,
        );
      }
      const buffers = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) throw new CourseApiError(0, '课程接口返回内容超出限制。');
        buffers.push(chunk);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers));
      // Never persist an accidental echo of the current credential in an export.
      if (text.includes(token))
        throw new CourseApiError(0, '接口返回异常包含凭据，已停止且不保存。');
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof CourseApiError) throw error;
      throw new CourseApiError(0, '网络请求或返回内容异常，请回读确认；写入请求不能直接重传。');
    }
  }
  return {
    origin: origin.origin,
    getMap: (course) => request('GET', `/courses/${courseSlug(course)}/map`),
    getNode: (course, id) => request('GET', `/courses/${courseSlug(course)}/nodes/${nodeId(id)}`),
    putNode: (course, id, patch) =>
      request('PUT', `/courses/${courseSlug(course)}/nodes/${nodeId(id)}`, patch),
  };
}

function checkedNode(payload, expectedId) {
  const node = payload?.node;
  if (
    !node ||
    nodeId(node.id) !== expectedId ||
    !/^[a-f0-9]{64}$/.test(node.revision || '') ||
    SECTION_KEYS.some((key) => typeof node.sections?.[key] !== 'string')
  )
    throw new Error('作者接口未返回完整节点、三个分区和 revision，已停止。');
  return node;
}

function safeError(error) {
  const secret = process.env.FREEBBS_UPLOAD_TOKEN;
  let message = String(error?.message || '操作失败。');
  if (secret) message = message.split(secret).join('[凭据已隐藏]');
  return message.replace(/fbcu_[A-Za-z0-9_-]{43}/g, '[凭据已隐藏]');
}

module.exports = {
  CourseApiError,
  SECTION_KEYS,
  courseSlug,
  nodeId,
  revision,
  readUtf8,
  createCourseClient,
  checkedNode,
  safeError,
};
