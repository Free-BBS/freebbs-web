const crypto = require('node:crypto');
const express = require('express');

const MAX_HTML_LENGTH = 180000;
const MAX_PROMPT_LENGTH = 2000;

function toolError(message, status = 400, code = 'invalid_tool') {
  return Object.assign(new Error(message), { status, code });
}

function extractStandaloneHtml(value) {
  let source = String(value || '').trim();
  const fenced = source.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) source = fenced[1].trim();
  const start = source.search(/<!doctype\s+html|<html(?:\s|>)/i);
  if (start > 0) source = source.slice(start);
  if (
    !source ||
    source.length > MAX_HTML_LENGTH ||
    !/(?:<!doctype\s+html|<html(?:\s|>))/i.test(source) ||
    !/<\/html>\s*$/i.test(source)
  ) {
    throw toolError('请提供完整的单文件 HTML（包含 html 结束标签）');
  }
  return source;
}

function serializeTool(row, viewer) {
  const owns = Number(viewer?.id) === Number(row.user_id);
  return {
    id: row.tid,
    title: row.title,
    description: row.description || '',
    prompt: owns ? row.prompt || '' : '',
    html: row.html_code,
    isPublished: Boolean(row.is_published),
    canEdit: Boolean(owns || viewer?.is_admin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.user_id,
      uid: row.uid || '',
      username: row.username,
      displayName: row.username,
      avatarPath: row.avatar_path || '',
    },
  };
}

function createFrontendToolsRouter({
  pool,
  requireAuth,
  getOptionalAuthUser,
  generateHtml,
  generationTimeoutMs = 300000,
  heartbeatMs = 15000,
}) {
  const router = express.Router();

  router.get('/', async (request, response) => {
    try {
      const viewer = await getOptionalAuthUser(request);
      const mine = request.query.scope === 'mine';
      if (mine && !viewer) {
        response.status(401).json({ message: '请登录后查看自己的小工具' });
        return;
      }
      const limit = Math.min(50, Math.max(1, Math.trunc(Number(request.query.limit) || 24)));
      const [rows] = await pool.execute(
        `SELECT t.*, u.uid, u.username, u.avatar_path
         FROM frontend_tools t
         INNER JOIN users u ON u.id = t.user_id
         WHERE ${mine ? 't.user_id = ?' : 't.is_published = 1'}
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT ${limit}`,
        mine ? [viewer.id] : [],
      );
      response.set('Cache-Control', 'private, no-store');
      response.json({ tools: rows.map((row) => serializeTool(row, viewer)) });
    } catch (error) {
      response.status(500).json({ message: '小工具广场暂时无法加载', detail: error.message });
    }
  });

  router.get('/:tid', async (request, response) => {
    try {
      const viewer = await getOptionalAuthUser(request);
      const [rows] = await pool.execute(
        `SELECT t.*, u.uid, u.username, u.avatar_path
         FROM frontend_tools t
         INNER JOIN users u ON u.id = t.user_id
         WHERE t.tid = ? AND (t.is_published = 1 OR t.user_id = ? OR ? = 1)
         LIMIT 1`,
        [String(request.params.tid || ''), viewer?.id || 0, viewer?.is_admin ? 1 : 0],
      );
      if (!rows[0]) {
        response.status(404).json({ message: '小工具不存在或尚未公开' });
        return;
      }
      response.set('Cache-Control', 'private, no-store');
      response.json({ tool: serializeTool(rows[0], viewer) });
    } catch (error) {
      response.status(500).json({ message: '读取小工具失败', detail: error.message });
    }
  });

  router.post('/generate/html', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    const prompt = String(request.body?.prompt || '').trim();
    const currentHtml = String(request.body?.currentHtml || '').trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      response.status(400).json({ message: '请用 1–2000 个字符描述要制作的小工具' });
      return;
    }
    if (currentHtml.length > MAX_HTML_LENGTH) {
      response.status(400).json({ message: '当前 HTML 过长，请精简后再让 AI 修改' });
      return;
    }
    const streaming = /\btext\/event-stream\b/i.test(request.get('accept') || '');
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, generationTimeoutMs);
    timer.unref?.();
    const send = (event) => {
      if (streaming && !response.destroyed && !response.writableEnded)
        response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    if (streaming) {
      response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      send({ status: 'preparing', message: '已连接，正在等待 AI 开始生成…' });
    }
    const heartbeat = streaming
      ? setInterval(() => {
          if (!response.destroyed) response.write(': keepalive\n\n');
        }, heartbeatMs)
      : null;
    heartbeat?.unref?.();
    let pendingHtml = '';
    let htmlCharacters = 0;
    const flushHtml = () => {
      if (!pendingHtml) return;
      send({ html_delta: pendingHtml });
      pendingHtml = '';
    };
    // Coalesce character-sized upstream chunks without buffering the whole answer.
    const htmlFlushTimer = streaming ? setInterval(flushHtml, 80) : null;
    htmlFlushTimer?.unref?.();
    let rejectAbort;
    const aborted = new Promise((_, reject) => {
      rejectAbort = () => reject(new Error('Generation aborted'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    let lastProgress = 0;
    try {
      const answer = await Promise.race([
        generateHtml({
          user,
          prompt,
          currentHtml,
          signal: controller.signal,
          onReasoning: ({ id, delta }) => send({ reasoning_id: id, reasoning_delta: delta }),
          onHtml: (delta) => {
            if (typeof delta !== 'string' || controller.signal.aborted) return;
            htmlCharacters += delta.length;
            if (htmlCharacters > MAX_HTML_LENGTH + 4000)
              throw toolError('生成的 HTML 过长，请精简需求后重试', 502);
            if (streaming) pendingHtml += delta;
          },
          onProgress: (characters) => {
            if (Date.now() - lastProgress < 250) return;
            lastProgress = Date.now();
            send({ status: 'generating', message: `正在编写 HTML · 已生成 ${characters} 字符` });
          },
        }),
        aborted,
      ]);
      controller.signal.throwIfAborted();
      flushHtml();
      send({ status: 'validating', message: '正在检查 HTML 完整性…' });
      const html = extractStandaloneHtml(answer);
      if (streaming) {
        send({ done: true, result: { answer: html, html } });
        response.end();
      } else response.json({ html });
    } catch (error) {
      if (!response.destroyed) {
        const failure = {
          message: timedOut
            ? 'AI 生成超时，原有代码未修改，请缩小需求后重试。'
            : error.status
              ? error.message
              : 'AI 暂时没有生成可用的 HTML，请换一种描述重试',
          code: timedOut ? 'tool_generation_timeout' : error.code || 'tool_generation_failed',
        };
        if (streaming) {
          send({ error: failure });
          response.end();
        } else response.status(timedOut ? 504 : error.status || 502).json(failure);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      clearInterval(htmlFlushTimer);
      response.removeListener('close', disconnect);
      controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
  });

  router.post('/', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    try {
      const title = String(request.body?.title || '').trim();
      const description = String(request.body?.description || '').trim();
      const prompt = String(request.body?.prompt || '').trim();
      const html = extractStandaloneHtml(request.body?.html);
      if (!title || title.length > 120) throw toolError('标题不能为空，且不能超过 120 个字符');
      if (description.length > 500) throw toolError('简介不能超过 500 个字符');
      if (prompt.length > MAX_PROMPT_LENGTH) throw toolError('创作描述不能超过 2000 个字符');
      const tid = `t_${crypto.randomBytes(8).toString('hex')}`;
      await pool.execute(
        `INSERT INTO frontend_tools
         (tid, user_id, title, description, prompt, html_code, is_published)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [tid, user.id, title, description, prompt, html],
      );
      const [rows] = await pool.execute(
        `SELECT t.*, u.uid, u.username, u.avatar_path
         FROM frontend_tools t INNER JOIN users u ON u.id = t.user_id
         WHERE t.tid = ? LIMIT 1`,
        [tid],
      );
      response.status(201).json({
        message: '小工具已发布到广场',
        tool: serializeTool(rows[0], user),
      });
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status ? error.message : '发布小工具失败',
        code: error.code || 'tool_publish_failed',
      });
    }
  });

  return router;
}

module.exports = {
  MAX_HTML_LENGTH,
  extractStandaloneHtml,
  serializeTool,
  createFrontendToolsRouter,
};
