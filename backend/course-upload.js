const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const sharp = require('sharp');
const { isValidUsername: defaultIsValidUsername } = require('./username-policy');
const {
  canManageCourse,
  createCourseMapsRouter,
  isValidNodeId,
  normalizeNodeId,
  resolveKnowledgeSections,
} = require('./course-maps');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TOKEN_PATTERN = /^fbcu_[A-Za-z0-9_-]{43}$/;
const SECTION_KEYS = ['knowledgeMarkdown', 'basicInfoMarkdown', 'applicationsMarkdown'];
const FILE_TYPES = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

function fail(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.publicCode = code;
  throw error;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function ensureCourseUploadTables(pool) {
  const migration = await fs.promises.readFile(
    path.join(__dirname, '../database/migrations/027_course_upload_tokens.sql'),
    'utf8',
  );
  for (const statement of migration
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    await pool.execute(statement);
  }
}

function toToken(row) {
  return {
    id: Number(row.id),
    name: row.name,
    prefix: row.token_prefix,
    scope: 'course:upload',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
  };
}

function toNode(row) {
  const node = {
    id: row.node_id,
    title: row.title,
    summary: row.summary || '',
    position: { x: Number(row.position_x), y: Number(row.position_y) },
    sections: resolveKnowledgeSections(row),
  };
  return { ...node, revision: hashToken(JSON.stringify(node)), updatedAt: row.updated_at || null };
}

function validateNodePatch(body, existing) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请提供知识点 JSON 对象');
  const keys = Object.keys(body);
  if (
    keys.some(
      (key) => !['title', 'summary', 'position', 'sections', 'expectedRevision'].includes(key),
    ) ||
    !keys.some((key) => key !== 'expectedRevision')
  )
    fail(400, '知识点字段不受支持或未提供修改内容');
  const current = existing ? toNode(existing) : null;
  if (
    body.expectedRevision !== undefined &&
    body.expectedRevision !== (current?.revision || 'new')
  ) {
    fail(409, '知识点已被修改，请重新读取后合并内容', 'revision_conflict');
  }
  const node = current || {
    title: '',
    summary: '',
    position: { x: 0, y: 0 },
    sections: { knowledgeMarkdown: '', basicInfoMarkdown: '', applicationsMarkdown: '' },
  };
  for (const [key, limit] of [
    ['title', 160],
    ['summary', 500],
  ]) {
    if (Object.hasOwn(body, key)) {
      if (typeof body[key] !== 'string' || body[key].length > limit)
        fail(400, `${key} 格式或长度不正确`);
      node[key] = body[key].trim();
    }
  }
  if (!node.title) fail(400, '新知识点必须提供标题');
  if (Object.hasOwn(body, 'position')) {
    if (
      !body.position ||
      typeof body.position !== 'object' ||
      Array.isArray(body.position) ||
      Object.keys(body.position).some((key) => !['x', 'y'].includes(key))
    )
      fail(400, 'position 格式不正确');
    for (const key of ['x', 'y']) {
      if (Object.hasOwn(body.position, key)) {
        const value = body.position[key];
        if (!Number.isInteger(value) || value < 0 || value > 10000)
          fail(400, '坐标必须是 0 至 10000 的整数');
        node.position[key] = value;
      }
    }
  }
  if (Object.hasOwn(body, 'sections')) {
    if (
      !body.sections ||
      typeof body.sections !== 'object' ||
      Array.isArray(body.sections) ||
      Object.keys(body.sections).some((key) => !SECTION_KEYS.includes(key))
    )
      fail(400, 'sections 格式不正确');
    for (const key of SECTION_KEYS) {
      if (Object.hasOwn(body.sections, key)) {
        if (typeof body.sections[key] !== 'string' || body.sections[key].length > 500000) {
          fail(400, '每个 Markdown 分区必须为不超过 500000 字符的字符串');
        }
        node.sections[key] = body.sections[key];
      }
    }
  }
  return node;
}

function decodeFile(body) {
  const fileName = body?.fileName;
  if (
    typeof fileName !== 'string' ||
    !fileName.trim() ||
    fileName.length > 180 ||
    /[\\/]/.test(fileName) ||
    Array.from(fileName).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    fileName === '.' ||
    fileName === '..'
  ) {
    fail(400, '文件名无效，不允许包含路径或控制字符');
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!FILE_TYPES[extension])
    fail(400, '支持 PDF、TXT、MD、CSV、DOCX、XLSX、PPTX、ZIP；图片请使用 images 接口');
  const encoded = body.contentBase64;
  if (
    typeof encoded !== 'string' ||
    !encoded ||
    encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(encoded.replace(/={1,2}$/, ''))
  ) {
    fail(400, '请提供 20MB 以内文件的标准 Base64 内容');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES)
    fail(400, '文件大小必须在 1 字节至 20MB 之间');
  if (extension === '.pdf' && buffer.subarray(0, 5).toString() !== '%PDF-')
    fail(400, 'PDF 文件内容无效');
  if (
    ['.zip', '.docx', '.xlsx', '.pptx'].includes(extension) &&
    !['504b0304', '504b0506', '504b0708'].includes(buffer.subarray(0, 4).toString('hex'))
  ) {
    fail(400, '文件内容与扩展名不匹配');
  }
  if (['.txt', '.md', '.csv'].includes(extension)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      fail(400, '文本文件必须使用 UTF-8 编码');
    }
    if (buffer.includes(0)) fail(400, '文本文件不得包含空字节');
  }
  return { fileName: fileName.trim(), extension, contentType: FILE_TYPES[extension], buffer };
}

function toFile(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    nodeId: row.node_id || null,
    contentType: row.content_type,
    size: Number(row.byte_size),
    sha256: row.sha256,
    url: `/api/course-upload/files/${row.id}`,
    markdown: `[${row.file_name.replace(/[[\]\\]/g, '\\$&')}](/api/course-upload/files/${row.id})`,
    createdAt: row.created_at,
  };
}

function createCourseUploadRouter({
  pool,
  requireAuth,
  uploadDir,
  isValidUsername = defaultIsValidUsername,
}) {
  const router = express.Router();
  const fileDir = path.join(uploadDir, 'course-agent-files');
  const route = (handler) => async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      if (response.headersSent) return;
      const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
      response.status(status).json({
        message: status === 500 ? '课程上传操作失败，请稍后重试' : error.message,
        ...(error.publicCode ? { code: error.publicCode } : {}),
      });
    }
  };
  async function tokenUser(request, database = pool) {
    const token = (request.get('authorization') || '').replace(/^Bearer /i, '');
    if (!TOKEN_PATTERN.test(token)) fail(401, '请提供有效的课程上传 Token');
    const [rows] = await database.execute(
      `SELECT t.id AS token_id, u.id, u.username, u.is_admin
       FROM course_upload_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [hashToken(token)],
    );
    const user = rows[0];
    if (!user) fail(401, 'Token 已失效、过期或撤销');
    if (!isValidUsername(user.username))
      fail(403, '请先登录网站修改不符合规则的用户名', 'username_change_required');
    return user;
  }
  async function courseAccess(request, database = pool, lock = false) {
    const user = await tokenUser(request, database);
    const slug = String(request.params.slug || '').toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) fail(400, '课程标识无效');
    const [rows] = await database.execute(
      `SELECT id, slug, name FROM courses WHERE slug = ? AND is_active = 1${lock ? ' FOR UPDATE' : ''}`,
      [slug],
    );
    const course = rows[0];
    if (!course) fail(404, '课程不存在');
    if (!(await canManageCourse(database, user, course.id)))
      fail(403, '需要该课程的资料负责人权限');
    await database.execute(
      'UPDATE course_upload_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [user.token_id],
    );
    return { course, user };
  }
  async function transaction(handler) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await handler(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async function readNode(database, courseId, nodeId, lock = false) {
    const [rows] = await database.execute(
      `SELECT n.node_id, n.title, n.summary, n.position_x, n.position_y, n.document_markdown,
              n.updated_at, s.knowledge_markdown, s.basic_info_markdown, s.applications_markdown
       FROM course_map_nodes n LEFT JOIN course_map_node_sections s
         ON s.course_id = n.course_id AND s.node_id = n.node_id
       WHERE n.course_id = ? AND n.node_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [courseId, nodeId],
    );
    return rows[0] || null;
  }

  router.get(
    '/tokens',
    route(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      response.set('Cache-Control', 'no-store');
      const [rows] = await pool.execute(
        `SELECT id, name, token_prefix, created_at, expires_at, last_used_at, revoked_at
       FROM course_upload_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
        [user.id],
      );
      response.json({ tokens: rows.map(toToken) });
    }),
  );
  router.post(
    '/tokens',
    route(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
      const expiresInDays = request.body.expiresInDays ?? 90;
      if (
        !name ||
        name.length > 80 ||
        !Number.isInteger(expiresInDays) ||
        expiresInDays < 1 ||
        expiresInDays > 365
      ) {
        fail(400, '请输入 1 至 80 字符的名称，有效期为 1 至 365 天');
      }
      const token = `fbcu_${crypto.randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
      const id = await transaction(async (connection) => {
        await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
        const [rows] = await connection.execute(
          `SELECT COUNT(*) AS total FROM course_upload_tokens
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
          [user.id],
        );
        if (Number(rows[0].total) >= 20)
          fail(400, '最多保留 20 个有效 Token，请先撤销不用的 Token');
        const [result] = await connection.execute(
          `INSERT INTO course_upload_tokens (user_id, name, token_hash, token_prefix, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
          [user.id, name, hashToken(token), token.slice(0, 12), expiresAt],
        );
        return result.insertId;
      });
      response.set('Cache-Control', 'no-store');
      response.status(201).json({ token, id, name, expiresAt, scope: 'course:upload' });
    }),
  );
  router.delete(
    '/tokens/:id',
    route(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      if (!/^\d{1,20}$/.test(request.params.id)) fail(400, 'Token 编号无效');
      const [result] = await pool.execute(
        `UPDATE course_upload_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND user_id = ?`,
        [request.params.id, user.id],
      );
      if (!result.affectedRows) fail(404, 'Token 不存在');
      response.json({ ok: true });
    }),
  );

  router.get('/skill.zip', (request, response) => {
    response.download(path.join(__dirname, '../public/downloads/freebbs-course-upload.zip'));
  });
  router.get('/docs', (request, response) => {
    response.type('text/plain').sendFile(path.join(__dirname, '../docs/course-upload-api.md'));
  });
  router.get(
    '/public/courses/:slug/files',
    route(async (request, response) => {
      const [rows] = await pool.execute(
        `SELECT f.* FROM course_uploaded_files f JOIN courses c ON c.id = f.course_id
       WHERE c.slug = ? AND c.is_active = 1 ORDER BY f.created_at DESC LIMIT 200`,
        [request.params.slug],
      );
      response.json({ files: rows.map(toFile) });
    }),
  );
  router.get(
    '/files/:id',
    route(async (request, response) => {
      if (!/^[a-f0-9-]{36}$/.test(request.params.id)) fail(404, '文件不存在');
      const [rows] = await pool.execute(
        `SELECT f.* FROM course_uploaded_files f JOIN courses c ON c.id = f.course_id
       WHERE f.id = ? AND c.is_active = 1 LIMIT 1`,
        [request.params.id],
      );
      const file = rows[0];
      if (!file || !/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(file.stored_name)) fail(404, '文件不存在');
      response.set({
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      response.download(path.join(fileDir, file.stored_name), file.file_name, (error) => {
        if (error && !response.headersSent) response.status(404).json({ message: '文件不存在' });
      });
    }),
  );
  router.get(
    '/courses',
    route(async (request, response) => {
      const user = await tokenUser(request);
      const [rows] = await pool.execute(
        `SELECT c.id, c.slug, c.name FROM courses c WHERE c.is_active = 1 AND
       (? = 1 OR EXISTS (SELECT 1 FROM course_material_managers m WHERE m.course_id = c.id AND m.user_id = ?))
       ORDER BY c.sort_order, c.id`,
        [user.is_admin ? 1 : 0, user.id],
      );
      await pool.execute(
        'UPDATE course_upload_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
        [user.token_id],
      );
      response.json({ courses: rows });
    }),
  );
  router.get(
    '/courses/:slug/nodes/:nodeId',
    route(async (request, response) => {
      const { course } = await courseAccess(request);
      const node = await readNode(pool, course.id, normalizeNodeId(request.params.nodeId));
      if (!node) fail(404, '知识点不存在');
      response.json({ course, node: toNode(node) });
    }),
  );
  router.put(
    '/courses/:slug/nodes/:nodeId',
    route(async (request, response) => {
      const nodeId = normalizeNodeId(request.params.nodeId);
      if (!isValidNodeId(nodeId)) fail(400, '知识点编号须形如 SS-01-01');
      const result = await transaction(async (connection) => {
        const { course, user } = await courseAccess(request, connection, true);
        const existing = await readNode(connection, course.id, nodeId, true);
        const node = validateNodePatch(request.body, existing);
        await connection.execute(
          `INSERT INTO course_map_nodes (course_id, node_id, title, summary, position_x, position_y,
                                      document_markdown, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title),
         summary = VALUES(summary), position_x = VALUES(position_x), position_y = VALUES(position_y),
         document_markdown = VALUES(document_markdown), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
          [
            course.id,
            nodeId,
            node.title,
            node.summary,
            node.position.x,
            node.position.y,
            node.sections.knowledgeMarkdown,
            user.id,
            user.id,
          ],
        );
        await connection.execute(
          `INSERT INTO course_map_node_sections (course_id, node_id, knowledge_markdown, basic_info_markdown, applications_markdown)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE knowledge_markdown = VALUES(knowledge_markdown),
         basic_info_markdown = VALUES(basic_info_markdown), applications_markdown = VALUES(applications_markdown)`,
          [course.id, nodeId, ...SECTION_KEYS.map((key) => node.sections[key])],
        );
        await connection.execute(
          'UPDATE rag_index_state SET requested_revision = requested_revision + 1, requested_at = CURRENT_TIMESTAMP WHERE id = 1',
        );
        return {
          created: !existing,
          course,
          node: toNode(await readNode(connection, course.id, nodeId)),
        };
      });
      response.status(result.created ? 201 : 200).json(result);
    }),
  );
  router.get(
    '/courses/:slug/files',
    route(async (request, response) => {
      const { course } = await courseAccess(request);
      const [rows] = await pool.execute(
        'SELECT * FROM course_uploaded_files WHERE course_id = ? ORDER BY created_at DESC LIMIT 200',
        [course.id],
      );
      response.json({ files: rows.map(toFile) });
    }),
  );
  router.post(
    '/courses/:slug/files',
    route(async (request, response) => {
      await courseAccess(request);
      const file = decodeFile(request.body);
      const digest = hashToken(file.buffer);
      const nodeId = request.body.nodeId ? normalizeNodeId(request.body.nodeId) : null;
      if (nodeId && !isValidNodeId(nodeId)) fail(400, '知识点编号无效');
      let writtenPath;
      try {
        const result = await transaction(async (connection) => {
          const { course, user } = await courseAccess(request, connection, true);
          if (nodeId && !(await readNode(connection, course.id, nodeId))) fail(404, '知识点不存在');
          const [existing] = await connection.execute(
            'SELECT * FROM course_uploaded_files WHERE course_id = ? AND sha256 = ? LIMIT 1',
            [course.id, digest],
          );
          if (existing[0]) return { created: false, file: toFile(existing[0]) };
          const id = crypto.randomUUID();
          const storedName = `${id}${file.extension}`;
          await fs.promises.mkdir(fileDir, { recursive: true, mode: 0o700 });
          writtenPath = path.join(fileDir, storedName);
          await fs.promises.writeFile(writtenPath, file.buffer, { flag: 'wx', mode: 0o600 });
          await connection.execute(
            `INSERT INTO course_uploaded_files (id, course_id, node_id, file_name, stored_name, content_type,
            byte_size, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              course.id,
              nodeId,
              file.fileName,
              storedName,
              file.contentType,
              file.buffer.length,
              digest,
              user.id,
            ],
          );
          const [rows] = await connection.execute(
            'SELECT * FROM course_uploaded_files WHERE id = ?',
            [id],
          );
          return { created: true, file: toFile(rows[0]) };
        });
        response.status(result.created ? 201 : 200).json(result);
      } catch (error) {
        if (writtenPath) await fs.promises.unlink(writtenPath).catch(() => {});
        throw error;
      }
    }),
  );
  router.post(
    '/courses/:slug/images',
    route(async (request, response) => {
      const { course, user } = await courseAccess(request);
      const encoded = request.body?.imageDataUrl;
      const match =
        typeof encoded === 'string' &&
        encoded.match(/^data:image\/(?:png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[1].length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
        fail(400, '请提供 20MB 以内的 PNG、JPEG、WEBP、GIF 或 AVIF 图片');
      const buffer = Buffer.from(match[1], 'base64');
      if (!buffer.length || buffer.length > MAX_FILE_BYTES) fail(400, '图片大小无效');
      let output;
      try {
        output = await sharp(buffer, { animated: false, limitInputPixels: 40000000 })
          .rotate()
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 86 })
          .toBuffer();
      } catch {
        fail(400, '图片无法解码或分辨率过大');
      }
      const fileName = `course-agent-${course.slug}-${user.id}-${crypto.randomUUID()}.webp`;
      await fs.promises.mkdir(uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(uploadDir, fileName), output, { flag: 'wx' });
      const url = `/uploads/${fileName}`;
      response.status(201).json({ url, markdown: `![图片说明](${url})` });
    }),
  );

  // The existing editor routes stay available to agents, behind a token and current course ACL.
  router.use(
    '/courses/:slug',
    route(async (request, response, next) => {
      await courseAccess(request);
      next();
    }),
  );
  router.use(
    '/courses',
    createCourseMapsRouter({
      pool,
      uploadDir,
      requireAuth: async (request, response) => {
        try {
          return await tokenUser(request);
        } catch (error) {
          response
            .status(error.status || 401)
            .json({ message: error.message, code: error.publicCode });
          return null;
        }
      },
      getOptionalAuthUser: (request) => tokenUser(request),
    }),
  );
  return router;
}

module.exports = {
  createCourseUploadRouter,
  ensureCourseUploadTables,
  hashToken,
  toNode,
  validateNodePatch,
  decodeFile,
};
