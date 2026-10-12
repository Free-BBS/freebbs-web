const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { canManageCourse, isValidNodeId } = require('./course-maps');

const ID = /^[1-9]\d{0,18}$/;
const KEY = /^[a-f0-9-]{36}$/i;
class LearningError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function field(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new LearningError(400, `请检查输入内容（最多 ${max} 字）`);
  return value.trim();
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LearningError(400, `${label}格式无效`);
  return value;
}
function documentVersion(context) {
  return crypto
    .createHash('sha256')
    .update(context.document_markdown || '')
    .digest('hex');
}
function validateAnchor(value) {
  const anchor = object(value, '原文定位');
  const range = object(anchor.range, '文字范围');
  const nodeId = field(anchor.nodeId, 120, true);
  const version = field(anchor.documentVersion, 64, true);
  const blockAnchor = field(anchor.blockAnchor, 160, true);
  const quote = typeof anchor.quote === 'string' ? anchor.quote : '';
  if (
    !isValidNodeId(nodeId) ||
    !/^[a-f0-9]{64}$/i.test(version) ||
    !/^[a-zA-Z0-9:_-]+$/.test(blockAnchor) ||
    !quote.length ||
    quote.length > 8000 ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > 10000000 ||
    range.end - range.start !== quote.length
  )
    throw new LearningError(400, '原文定位或文字范围无效，至少选择一个字符');
  const blockType = anchor.blockType || 'text';
  if (
    !['text', 'formula', 'image', 'table'].includes(blockType) ||
    (anchor.wholeBlock !== undefined && typeof anchor.wholeBlock !== 'boolean') ||
    (blockType !== 'text' && anchor.wholeBlock !== true)
  )
    throw new LearningError(400, '公式、图片和表格请按整块标注');
  // Context must preserve whitespace: trimming would change precise range relocation.
  const contextField = (contextText) => {
    if (contextText === undefined) return '';
    if (typeof contextText !== 'string' || contextText.length > 96)
      throw new LearningError(400, '原文上下文过长');
    return contextText;
  };
  return {
    nodeId,
    documentVersion: version.toLowerCase(),
    blockAnchor,
    range: { start: range.start, end: range.end },
    quote,
    prefix: contextField(anchor.prefix),
    suffix: contextField(anchor.suffix),
    wholeBlock: Boolean(anchor.wholeBlock),
    blockType,
  };
}
function validateAnnotation(value) {
  const annotation = object(value, '评注');
  if (
    !['highlight', 'underline', 'comment'].includes(annotation.style) ||
    !['yellow', 'green', 'blue', 'purple'].includes(annotation.color || 'yellow')
  )
    throw new LearningError(400, '评注样式无效');
  return {
    style: annotation.style,
    color: annotation.color || 'yellow',
    anchor: validateAnchor(annotation.anchor),
  };
}
function validateResource(value) {
  const resource = object(value, '资源投稿');
  const permission = object(resource.permission, '来源与授权声明');
  const sourceUrl = field(resource.sourceUrl, 2048, true);
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new LearningError(400, '请填写有效的资源链接');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new LearningError(400, '资源链接仅支持 HTTP 或 HTTPS');
  if (!['knowledge', 'course'].includes(resource.resourceLevel))
    throw new LearningError(400, '请选择知识点或课程级资源');
  return {
    resourceLevel: resource.resourceLevel,
    coverage: field(resource.coverage, 1200, true),
    sourceUrl: parsed.href,
    permission: {
      source: field(permission.source, 1000, true),
      license: field(permission.license, 1000, true),
    },
  };
}
function validatePath(rawPath) {
  if (!Array.isArray(rawPath) || !rawPath.length || rawPath.length > 20)
    throw new LearningError(400, '学习路径需要 1 至 20 个步骤');
  const ids = new Set();
  return rawPath.map((value) => {
    const step = object(value, '学习步骤');
    const id = field(step.id, 80, true);
    const skipped = step.skipped === undefined ? false : step.skipped;
    if (
      !/^[a-zA-Z0-9:_-]+$/.test(id) ||
      ids.has(id) ||
      ![
        'content',
        'resources',
        'feedback',
        'continue',
        'notes',
        'contribute',
        'discussion',
      ].includes(step.tool) ||
      !Number.isInteger(step.minutes) ||
      step.minutes < 1 ||
      step.minutes > 240 ||
      typeof step.completed !== 'boolean' ||
      typeof skipped !== 'boolean' ||
      (step.completed && skipped)
    )
      throw new LearningError(400, '学习步骤的入口、时间或完成状态无效');
    ids.add(id);
    const result = {
      id,
      tool: step.tool,
      title: field(step.title, 120, true),
      minutes: step.minutes,
      completed: step.completed,
      skipped,
    };
    if (step.point !== undefined) {
      result.point = field(step.point, 120, true);
      if (!isValidNodeId(result.point)) throw new LearningError(400, '学习步骤的目标知识点无效');
    }
    if (step.description !== undefined) result.description = field(step.description, 600);
    if (step.view !== undefined) {
      if (!['reading', 'origin', 'relations'].includes(step.view) || step.tool !== 'content')
        throw new LearningError(400, '学习步骤的正文位置无效');
      result.view = step.view;
    }
    if (step.quizView !== undefined) {
      if (!['practice', 'quick', 'mistakes'].includes(step.quizView) || step.tool !== 'feedback')
        throw new LearningError(400, '学习步骤的题目入口无效');
      result.quizView = step.quizView;
    }
    for (const name of ['questionId', 'taskId']) {
      if (step[name] === undefined) continue;
      const resourceId = field(step[name], 120, true);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(resourceId))
        throw new LearningError(400, '学习步骤的资源标识无效');
      result[name] = resourceId;
    }
    return result;
  });
}
function metadataFor(entry) {
  const metadata = {};
  for (const name of ['annotation', 'anchor', 'scope', 'resource', 'path'])
    if (entry[name] !== undefined) metadata[name] = entry[name];
  return metadata;
}
function prepareEntryMetadata(entry, context, previous) {
  const next = metadataFor(entry);
  const version = documentVersion(context);
  for (const anchor of [next.annotation?.anchor, next.anchor].filter(Boolean)) {
    if (anchor.nodeId !== context.node_id) throw new LearningError(400, '评注必须属于当前知识点');
    if (anchor.documentVersion !== version) {
      const priorAnchor = previous?.annotation?.anchor || previous?.anchor;
      if (!priorAnchor || !isDeepStrictEqual(priorAnchor, anchor))
        throw new LearningError(409, '课程正文已更新，请重新选择原文；当前评注输入不会丢失');
    } else anchor.documentVersion = version;
  }
  // Ordinary note edits preserve an existing private annotation when omitted.
  if (previous?.annotation && next.annotation === undefined) next.annotation = previous.annotation;
  return next;
}
function validateEntry(body) {
  if (!body || !['note', 'reflection', 'contribution', 'path'].includes(body.kind))
    throw new LearningError(400, '记录类型无效');
  const entry = {
    kind: body.kind,
    title: field(body.title, 120, body.kind !== 'reflection') || '学习复盘',
    content: field(body.content, 8000, body.kind !== 'path') || '我的学习步骤',
    feeling: body.kind === 'reflection' ? field(body.feeling, 20, true) : '',
    category: body.kind === 'contribution' ? field(body.category, 20, true) : '',
    excerpt: body.kind === 'contribution' ? field(body.excerpt, 600) : '',
  };
  if (entry.kind === 'reflection' && !['stuck', 'getting', 'practice'].includes(entry.feeling))
    throw new LearningError(400, '请选择当前学习感受');
  if (entry.kind === 'note' && body.annotation !== undefined)
    entry.annotation = validateAnnotation(body.annotation);
  if (entry.kind === 'contribution') {
    if (!['correction', 'improvement', 'resource'].includes(entry.category))
      throw new LearningError(400, '共建类型无效');
    if (entry.category === 'correction' && body.anchor !== undefined)
      entry.anchor = validateAnchor(body.anchor);
    if (entry.category === 'improvement') {
      entry.scope = body.scope || 'content';
      if (!['content', 'structure', 'relation', 'presentation'].includes(entry.scope))
        throw new LearningError(400, '改进建议范围无效');
    }
    if (entry.category === 'resource') entry.resource = validateResource(body.resource);
  }
  if (entry.kind === 'path') entry.path = validatePath(body.path);
  return entry;
}
async function ensureLearningWorkspaceTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/062_learning_workspace.sql'),
    'utf8',
  );
  await pool.execute(sql.trim().replace(/;\s*$/, ''));
  const [columns] = await pool.execute("SHOW COLUMNS FROM learning_entries LIKE 'metadata_json'");
  if (!columns?.length) {
    try {
      await pool.execute('ALTER TABLE learning_entries ADD COLUMN metadata_json JSON NULL');
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}
function toEntry(row) {
  let metadata = {};
  try {
    const value =
      typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
    if (value && typeof value === 'object' && !Array.isArray(value)) metadata = value;
  } catch {
    /* Old malformed metadata must not prevent access to the original note. */
  }
  return {
    id: String(row.id),
    kind: row.kind,
    title: row.title,
    content: row.content,
    feeling: row.feeling,
    category: row.category,
    excerpt: row.excerpt,
    status: row.status,
    response: row.review_response,
    revision: Number(row.revision),
    documentVersion: row.document_version,
    updatedAt: row.updated_at,
    ...Object.fromEntries(
      ['annotation', 'anchor', 'scope', 'resource', 'path']
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, metadata[key]]),
    ),
  };
}
function createMysqlLearningStore(pool) {
  const columns =
    'id, kind, title, content, feeling, category, excerpt, status, review_response, revision, document_version, updated_at, metadata_json';
  async function validatePathContext(entry, context) {
    const points = [...new Set((entry.path || []).map((step) => step.point).filter(Boolean))];
    if (!points.length) return;
    const [rows] = await pool.execute(
      `SELECT node_id FROM course_map_nodes WHERE course_id = ? AND node_id IN (${points.map(() => '?').join(', ')})`,
      [context.course_id, ...points],
    );
    if (points.some((point) => !rows.some((row) => row.node_id === point)))
      throw new LearningError(400, '学习路径中的目标必须属于当前课程');
  }
  return {
    async context(slug, point) {
      const [rows] = await pool.execute(
        'SELECT c.id AS course_id, n.node_id, n.document_markdown FROM courses c JOIN course_map_nodes n ON n.course_id = c.id WHERE c.slug = ? AND c.is_active = 1 AND n.node_id = ? LIMIT 1',
        [slug, point],
      );
      return rows[0] || null;
    },
    canReview: (user, context) => canManageCourse(pool, user, context.course_id),
    async list(user, context, before, review, kind, annotationOnly = false) {
      const [rows] = await pool.execute(
        `SELECT ${columns} FROM learning_entries WHERE course_id = ? AND node_id = ? AND ${review ? "kind = 'contribution' AND status = 'pending'" : 'user_id = ?'} ${kind ? 'AND kind = ?' : ''} ${annotationOnly ? "AND JSON_EXTRACT(metadata_json, '$.annotation') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(metadata_json, '$.annotation')) = 'OBJECT'" : ''} ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 51`,
        [
          context.course_id,
          context.node_id,
          ...(review ? [] : [user.id]),
          ...(kind ? [kind] : []),
          ...(before ? [before] : []),
        ],
      );
      return rows.map(toEntry);
    },
    async create(user, context, entry, key) {
      await validatePathContext(entry, context);
      const metadata = prepareEntryMetadata(entry, context);
      const values = [
        user.id,
        context.course_id,
        context.node_id,
        entry.kind,
        entry.title,
        entry.content,
        entry.feeling,
        entry.category,
        entry.excerpt,
        entry.kind === 'contribution' ? 'pending' : 'private',
        documentVersion(context),
        key,
        Object.keys(metadata).length ? JSON.stringify(metadata) : null,
      ];
      try {
        await pool.execute(
          'INSERT INTO learning_entries (user_id, course_id, node_id, kind, title, content, feeling, category, excerpt, status, document_version, request_key, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          values,
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
      const [rows] = await pool.execute(
        `SELECT ${columns}, course_id, node_id FROM learning_entries WHERE user_id = ? AND request_key = ? LIMIT 1`,
        [user.id, key],
      );
      const row = rows[0];
      if (
        !row ||
        String(row.course_id) !== String(context.course_id) ||
        row.node_id !== context.node_id ||
        Object.entries(entry).some(([name, value]) => !isDeepStrictEqual(toEntry(row)[name], value))
      )
        throw new LearningError(409, '这次提交标识已用于另一条内容，请刷新后核对记录');
      return toEntry(row);
    },
    async update(user, context, id, entry, revision) {
      await validatePathContext(entry, context);
      const [rows] = await pool.execute(
        `SELECT ${columns} FROM learning_entries WHERE id = ? AND user_id = ? AND course_id = ? AND node_id = ? AND kind = ? AND revision = ? LIMIT 1`,
        [id, user.id, context.course_id, context.node_id, entry.kind, revision],
      );
      if (!rows.length) return false;
      const metadata = prepareEntryMetadata(entry, context, toEntry(rows[0]));
      const [result] = await pool.execute(
        "UPDATE learning_entries SET title = ?, content = ?, metadata_json = ?, document_version = CASE WHEN kind = 'path' THEN ? ELSE document_version END, revision = revision + 1 WHERE id = ? AND user_id = ? AND course_id = ? AND node_id = ? AND kind = ? AND kind IN ('note', 'path') AND revision = ?",
        [
          entry.title,
          entry.content,
          Object.keys(metadata).length ? JSON.stringify(metadata) : null,
          documentVersion(context),
          id,
          user.id,
          context.course_id,
          context.node_id,
          entry.kind,
          revision,
        ],
      );
      return result.affectedRows > 0;
    },
    async remove(user, context, id) {
      const [result] = await pool.execute(
        "DELETE FROM learning_entries WHERE id = ? AND user_id = ? AND course_id = ? AND node_id = ? AND kind IN ('note', 'reflection', 'path')",
        [id, user.id, context.course_id, context.node_id],
      );
      return result.affectedRows > 0;
    },
    async review(user, context, id, decision, reply) {
      const [result] = await pool.execute(
        "UPDATE learning_entries SET status = ?, review_response = ?, reviewed_by = ?, revision = revision + 1 WHERE id = ? AND course_id = ? AND node_id = ? AND kind = 'contribution' AND status = 'pending'",
        [decision, reply, user.id, id, context.course_id, context.node_id],
      );
      return result.affectedRows > 0;
    },
  };
}
function createLearningWorkspaceRouter({
  pool,
  requireAuth,
  store = createMysqlLearningStore(pool),
}) {
  const router = express.Router();
  function route(handler) {
    return async (request, response) => {
      response.set('Cache-Control', 'private, no-store');
      try {
        const user = await requireAuth(request, response);
        if (!user) return;
        const { slug, point, id } = request.params;
        if (
          !/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug) ||
          point.length > 120 ||
          !isValidNodeId(point) ||
          (id !== undefined && !ID.test(id))
        )
          throw new LearningError(400, '课程、知识点或记录编号无效');
        const context = await store.context(slug, point);
        if (!context) throw new LearningError(404, '课程或知识点不存在');
        await handler(request, response, user, context);
      } catch (error) {
        if (!error.status)
          console.error('Learning workspace request failed:', error.code || error.name);
        response
          .status(error.status || 500)
          .json({ message: error.status ? error.message : '学习记录服务暂时不可用，请稍后重试' });
      }
    };
  }
  router.get(
    '/:slug/:point/entries',
    route(async (req, res, user, context) => {
      const before = req.query.before || '';
      if (typeof before !== 'string' || (before && !ID.test(before)))
        throw new LearningError(400, '分页位置无效');
      const review = req.query.review === 'pending';
      if (req.query.review !== undefined && !review) throw new LearningError(400, '审核范围无效');
      const kind = req.query.kind;
      if (
        kind !== undefined &&
        (typeof kind !== 'string' || !['note', 'reflection', 'contribution', 'path'].includes(kind))
      )
        throw new LearningError(400, '记录筛选类型无效');
      if (review && kind !== undefined && kind !== 'contribution')
        throw new LearningError(400, '审核收件箱只能筛选共建提交');
      const annotationOnly = req.query.annotations !== undefined;
      if (annotationOnly && (req.query.annotations !== '1' || kind !== 'note' || review))
        throw new LearningError(400, '原文评注筛选仅支持个人笔记 annotations=1');
      if (review && !(await store.canReview(user, context)))
        throw new LearningError(403, '需要本课程负责人的权限');
      const records = await store.list(user, context, before, review, kind, annotationOnly);
      const entries = records.slice(0, 50);
      res.json({ entries, nextCursor: records.length > 50 ? entries.at(-1).id : null });
    }),
  );
  router.post(
    '/:slug/:point/entries',
    route(async (req, res, user, context) => {
      const entry = validateEntry(req.body);
      if (typeof req.body.requestKey !== 'string' || !KEY.test(req.body.requestKey))
        throw new LearningError(400, '提交标识无效');
      const record = await store.create(user, context, entry, req.body.requestKey);
      res.status(201).json({ entry: record });
    }),
  );
  router.put(
    '/:slug/:point/entries/:id',
    route(async (req, res, user, context) => {
      const entry = validateEntry(req.body);
      if (
        !['note', 'path'].includes(entry.kind) ||
        !Number.isSafeInteger(req.body.revision) ||
        req.body.revision < 1
      )
        throw new LearningError(400, '仅支持修改个人笔记与学习路径，请检查版本号');
      if (!(await store.update(user, context, req.params.id, entry, req.body.revision)))
        throw new LearningError(
          409,
          '笔记已变更、已删除或不可编辑，请刷新记录后核对；当前输入不会丢失',
        );
      res.json({ ok: true });
    }),
  );
  router.delete(
    '/:slug/:point/entries/:id',
    route(async (req, res, user, context) => {
      if (!(await store.remove(user, context, req.params.id)))
        throw new LearningError(404, '个人记录不存在或不可删除');
      res.json({ ok: true });
    }),
  );
  router.patch(
    '/:slug/:point/entries/:id/review',
    route(async (req, res, user, context) => {
      if (!(await store.canReview(user, context)))
        throw new LearningError(403, '需要本课程负责人的权限');
      if (!['handled', 'declined'].includes(req.body?.status))
        throw new LearningError(400, '处理状态无效');
      const reply = field(req.body.response, 1000, true);
      if (!(await store.review(user, context, req.params.id, req.body.status, reply)))
        throw new LearningError(409, '提交已被处理或不存在，请刷新收件箱');
      res.json({ ok: true });
    }),
  );
  return router;
}
module.exports = {
  createLearningWorkspaceRouter,
  createMysqlLearningStore,
  ensureLearningWorkspaceTables,
  validateEntry,
  validateAnchor,
  prepareEntryMetadata,
  documentVersion,
  toEntry,
  LearningError,
};
