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

function createFrontendToolsRouter({ pool, requireAuth, getOptionalAuthUser, generateHtml }) {
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
    try {
      const answer = await generateHtml({ user, prompt, currentHtml });
      response.json({ html: extractStandaloneHtml(answer) });
    } catch (error) {
      response.status(error.status || 502).json({
        message: error.status ? error.message : 'AI 暂时没有生成可用的 HTML，请换一种描述重试',
        code: error.code || 'tool_generation_failed',
      });
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
