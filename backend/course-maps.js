const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const { COURSE_SEEDS, SIGNAL_EDGE_SEEDS, SIGNAL_NODE_SEEDS } = require('./course-map-data');

const NODE_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const EDGE_TYPES = new Set(['ordered', 'related']);
const MAX_MARKDOWN_LENGTH = 500000;
const MAX_MAP_COORDINATE = 10000;

function normalizeNodeId(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function isValidNodeId(value) {
  return value.length >= 4 && value.length <= 64 && NODE_ID_PATTERN.test(value);
}

function normalizeCoordinate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(MAX_MAP_COORDINATE, Math.round(parsed)));
}

function toCourse(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    code: row.code || '',
    boardSlug: row.board_slug || '',
    description: row.description || '',
    summary: row.summary || '',
    sortOrder: Number(row.sort_order || 0),
    canEditMap: Boolean(row.can_edit_map),
  };
}

function toMapNode(row, includeMarkdown = false) {
  return {
    id: row.node_id,
    title: row.title,
    summary: row.summary || '',
    position: {
      x: Number(row.position_x || 0),
      y: Number(row.position_y || 0),
    },
    hasDocument: Boolean(row.has_document ?? row.document_markdown),
    updatedAt: row.updated_at || null,
    ...(includeMarkdown ? { markdown: row.document_markdown || '' } : {}),
  };
}

function toMapEdge(row) {
  return {
    source: row.source_node_id,
    target: row.target_node_id,
    type: row.relation_type,
  };
}

async function ensureCourseMapTables(pool) {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS courses (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(96) NOT NULL,
      code VARCHAR(128) NULL,
      board_slug VARCHAR(64) NULL,
      description TEXT NULL,
      summary TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS course_material_managers (
      course_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (course_id, user_id),
      CONSTRAINT fk_course_material_managers_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      CONSTRAINT fk_course_material_managers_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      INDEX idx_course_material_managers_user (user_id)
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS course_map_nodes (
      course_id BIGINT NOT NULL,
      node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      title VARCHAR(160) NOT NULL,
      summary VARCHAR(500) NULL,
      position_x INT NOT NULL DEFAULT 0,
      position_y INT NOT NULL DEFAULT 0,
      document_markdown MEDIUMTEXT NULL,
      created_by BIGINT NULL,
      updated_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (course_id, node_id),
      CONSTRAINT fk_course_map_nodes_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      CONSTRAINT fk_course_map_nodes_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_course_map_nodes_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
      INDEX idx_course_map_nodes_course_position (course_id, position_y, position_x)
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS course_map_edges (
      course_id BIGINT NOT NULL,
      source_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      relation_type ENUM('ordered', 'related') NOT NULL,
      created_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (course_id, source_node_id, target_node_id, relation_type),
      CONSTRAINT fk_course_map_edges_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      CONSTRAINT fk_course_map_edges_source
        FOREIGN KEY (course_id, source_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
      CONSTRAINT fk_course_map_edges_target
        FOREIGN KEY (course_id, target_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
      CONSTRAINT fk_course_map_edges_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      INDEX idx_course_map_edges_target (course_id, target_node_id)
    )`,
  );

  for (const course of COURSE_SEEDS) {
    await pool.execute(
      `INSERT INTO courses (
        slug, name, code, board_slug, description, summary, sort_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        code = VALUES(code),
        board_slug = VALUES(board_slug),
        description = COALESCE(courses.description, VALUES(description)),
        summary = COALESCE(courses.summary, VALUES(summary)),
        sort_order = VALUES(sort_order),
        is_active = 1`,
      [
        course.slug,
        course.name,
        course.code,
        course.boardSlug,
        course.description,
        course.summary,
        course.sortOrder,
      ],
    );
  }

  const [signalRows] = await pool.execute(`SELECT id FROM courses WHERE slug = 'signals' LIMIT 1`);
  const signalCourseId = signalRows[0]?.id;

  if (signalCourseId) {
    for (const node of SIGNAL_NODE_SEEDS) {
      await pool.execute(
        `INSERT IGNORE INTO course_map_nodes (
          course_id, node_id, title, summary, position_x, position_y, document_markdown
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [signalCourseId, node.nodeId, node.title, node.summary, node.x, node.y, node.markdown],
      );
    }

    for (const [source, target, relationType] of SIGNAL_EDGE_SEEDS) {
      await pool.execute(
        `INSERT IGNORE INTO course_map_edges (
          course_id, source_node_id, target_node_id, relation_type
        ) VALUES (?, ?, ?, ?)`,
        [signalCourseId, source, target, relationType],
      );
    }
  }
}

async function getCourseBySlug(pool, slug) {
  const [rows] = await pool.execute(
    `SELECT id, slug, name, code, board_slug, description, summary, sort_order
     FROM courses
     WHERE slug = ? AND is_active = 1
     LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

async function canManageCourse(pool, user, courseId) {
  if (!user || !courseId) {
    return false;
  }
  if (user.is_admin) {
    return true;
  }
  const [rows] = await pool.execute(
    `SELECT course_id
     FROM course_material_managers
     WHERE course_id = ? AND user_id = ?
     LIMIT 1`,
    [courseId, user.id],
  );
  return Boolean(rows[0]);
}

function sendCourseError(response, error, fallbackMessage) {
  if (error?.code === 'ER_DUP_ENTRY') {
    response.status(409).json({ message: '知识结点或连接已存在' });
    return;
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2') {
    response.status(400).json({ message: '连接引用了不存在的知识结点' });
    return;
  }
  response.status(500).json({ message: fallbackMessage, detail: error.message });
}

function createCourseMapsRouter({ pool, requireAuth, getOptionalAuthUser, uploadDir }) {
  const router = express.Router();

  async function requireCourseManager(request, response) {
    const user = await requireAuth(request, response);
    if (!user) {
      return null;
    }
    const course = await getCourseBySlug(pool, request.params.slug);
    if (!course) {
      response.status(404).json({ message: '课程不存在' });
      return null;
    }
    if (!(await canManageCourse(pool, user, course.id))) {
      response.status(403).json({ message: '需要该课程的资料负责人权限' });
      return null;
    }
    return { course, user };
  }

  router.get('/', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const currentUser = await getOptionalAuthUser(request);
      const [rows] = await pool.execute(
        `SELECT c.id, c.slug, c.name, c.code, c.board_slug, c.description, c.summary, c.sort_order,
                MAX(CASE WHEN ? = 1 OR m.user_id IS NOT NULL THEN 1 ELSE 0 END) AS can_edit_map
         FROM courses c
         LEFT JOIN course_material_managers m ON m.course_id = c.id AND m.user_id = ?
         WHERE c.is_active = 1
         GROUP BY c.id, c.slug, c.name, c.code, c.board_slug, c.description, c.summary, c.sort_order
         ORDER BY c.sort_order ASC, c.id ASC`,
        [currentUser?.is_admin ? 1 : 0, currentUser?.id || 0],
      );
      response.json({ courses: rows.map(toCourse) });
    } catch (error) {
      sendCourseError(response, error, '获取课程列表失败');
    }
  });

  router.get('/:slug/map', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const course = await getCourseBySlug(pool, String(request.params.slug || '').toLowerCase());
      if (!course) {
        response.status(404).json({ message: '课程不存在' });
        return;
      }
      const currentUser = await getOptionalAuthUser(request);
      const [nodeRows] = await pool.execute(
        `SELECT node_id, title, summary, position_x, position_y,
                CASE WHEN document_markdown IS NULL OR document_markdown = '' THEN 0 ELSE 1 END AS has_document,
                updated_at
         FROM course_map_nodes
         WHERE course_id = ?
         ORDER BY position_y ASC, position_x ASC, node_id ASC`,
        [course.id],
      );
      const [edgeRows] = await pool.execute(
        `SELECT source_node_id, target_node_id, relation_type
         FROM course_map_edges
         WHERE course_id = ?
         ORDER BY created_at ASC, source_node_id ASC, target_node_id ASC`,
        [course.id],
      );
      response.json({
        course: {
          ...toCourse(course),
          canEditMap: await canManageCourse(pool, currentUser, course.id),
        },
        nodes: nodeRows.map((row) => toMapNode(row)),
        edges: edgeRows.map(toMapEdge),
      });
    } catch (error) {
      sendCourseError(response, error, '获取课程地图失败');
    }
  });

  router.get('/:slug/map/nodes/:nodeId', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const course = await getCourseBySlug(pool, String(request.params.slug || '').toLowerCase());
      if (!course) {
        response.status(404).json({ message: '课程不存在' });
        return;
      }
      const nodeId = normalizeNodeId(request.params.nodeId);
      const [rows] = await pool.execute(
        `SELECT node_id, title, summary, position_x, position_y, document_markdown, updated_at
         FROM course_map_nodes
         WHERE course_id = ? AND node_id = ?
         LIMIT 1`,
        [course.id, nodeId],
      );
      if (!rows[0]) {
        response.status(404).json({ message: '知识结点不存在' });
        return;
      }
      const currentUser = await getOptionalAuthUser(request);
      response.json({
        course: {
          ...toCourse(course),
          canEditMap: await canManageCourse(pool, currentUser, course.id),
        },
        node: toMapNode(rows[0], true),
      });
    } catch (error) {
      sendCourseError(response, error, '获取知识结点失败');
    }
  });

  router.post('/:slug/map/nodes', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const nodeId = normalizeNodeId(request.body.id);
      const title = String(request.body.title || '').trim();
      const summary = String(request.body.summary || '').trim();
      const x = normalizeCoordinate(request.body.position?.x);
      const y = normalizeCoordinate(request.body.position?.y);
      if (!isValidNodeId(nodeId)) {
        response.status(400).json({ message: '结点 ID 需为形如 SS-01-01 的 ASCII 大写字符串' });
        return;
      }
      if (!title || title.length > 160 || summary.length > 500 || x === null || y === null) {
        response.status(400).json({ message: '请填写有效的标题、简介和结点位置' });
        return;
      }
      await pool.execute(
        `INSERT INTO course_map_nodes (
          course_id, node_id, title, summary, position_x, position_y, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [access.course.id, nodeId, title, summary, x, y, access.user.id, access.user.id],
      );
      const [rows] = await pool.execute(
        `SELECT node_id, title, summary, position_x, position_y, document_markdown, updated_at
         FROM course_map_nodes WHERE course_id = ? AND node_id = ? LIMIT 1`,
        [access.course.id, nodeId],
      );
      response.status(201).json({ node: toMapNode(rows[0], true) });
    } catch (error) {
      sendCourseError(response, error, '创建知识结点失败');
    }
  });

  router.patch('/:slug/map/nodes/:nodeId', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const nodeId = normalizeNodeId(request.params.nodeId);
      const title = String(request.body.title || '').trim();
      const summary = String(request.body.summary || '').trim();
      const x = normalizeCoordinate(request.body.position?.x);
      const y = normalizeCoordinate(request.body.position?.y);
      if (!title || title.length > 160 || summary.length > 500 || x === null || y === null) {
        response.status(400).json({ message: '请填写有效的标题、简介和结点位置' });
        return;
      }
      const [result] = await pool.execute(
        `UPDATE course_map_nodes
         SET title = ?, summary = ?, position_x = ?, position_y = ?, updated_by = ?
         WHERE course_id = ? AND node_id = ?`,
        [title, summary, x, y, access.user.id, access.course.id, nodeId],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '知识结点不存在' });
        return;
      }
      response.json({
        node: {
          id: nodeId,
          title,
          summary,
          position: { x, y },
        },
      });
    } catch (error) {
      sendCourseError(response, error, '更新知识结点失败');
    }
  });

  router.put('/:slug/map/nodes/:nodeId/document', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const nodeId = normalizeNodeId(request.params.nodeId);
      const markdown = String(request.body.markdown || '');
      if (markdown.length > MAX_MARKDOWN_LENGTH) {
        response.status(400).json({ message: 'Markdown 文档不能超过 500000 个字符' });
        return;
      }
      const [result] = await pool.execute(
        `UPDATE course_map_nodes
         SET document_markdown = ?, updated_by = ?
         WHERE course_id = ? AND node_id = ?`,
        [markdown, access.user.id, access.course.id, nodeId],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '知识结点不存在' });
        return;
      }
      response.json({ ok: true, nodeId, hasDocument: Boolean(markdown.trim()) });
    } catch (error) {
      sendCourseError(response, error, '保存 Markdown 文档失败');
    }
  });

  router.delete('/:slug/map/nodes/:nodeId', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const [result] = await pool.execute(
        `DELETE FROM course_map_nodes WHERE course_id = ? AND node_id = ?`,
        [access.course.id, normalizeNodeId(request.params.nodeId)],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '知识结点不存在' });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      sendCourseError(response, error, '删除知识结点失败');
    }
  });

  router.post('/:slug/map/edges', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      let source = normalizeNodeId(request.body.source);
      let target = normalizeNodeId(request.body.target);
      const type = String(request.body.type || '').trim();
      if (!isValidNodeId(source) || !isValidNodeId(target) || source === target) {
        response.status(400).json({ message: '请选择两个不同的有效知识结点' });
        return;
      }
      if (!EDGE_TYPES.has(type)) {
        response.status(400).json({ message: '连接类型必须为顺序关系或关联关系' });
        return;
      }
      if (type === 'related' && source.localeCompare(target) > 0) {
        [source, target] = [target, source];
      }
      await pool.execute(
        `INSERT INTO course_map_edges (
          course_id, source_node_id, target_node_id, relation_type, created_by
        ) VALUES (?, ?, ?, ?, ?)`,
        [access.course.id, source, target, type, access.user.id],
      );
      response.status(201).json({ edge: { source, target, type } });
    } catch (error) {
      sendCourseError(response, error, '创建连接失败');
    }
  });

  router.delete('/:slug/map/edges', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      let source = normalizeNodeId(request.body.source);
      let target = normalizeNodeId(request.body.target);
      const type = String(request.body.type || '').trim();
      if (type === 'related' && source.localeCompare(target) > 0) {
        [source, target] = [target, source];
      }
      const [result] = await pool.execute(
        `DELETE FROM course_map_edges
         WHERE course_id = ? AND source_node_id = ? AND target_node_id = ? AND relation_type = ?`,
        [access.course.id, source, target, type],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '连接不存在' });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      sendCourseError(response, error, '删除连接失败');
    }
  });

  router.post('/:slug/map/uploads/images', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const imageDataUrl = String(request.body.imageDataUrl || '');
      const match = imageDataUrl.match(
        /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|heic|heif|bmp|tiff|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i,
      );
      if (!match) {
        response.status(400).json({ message: '请上传图片文件' });
        return;
      }
      const fileBuffer = Buffer.from(match[2], 'base64');
      if (!fileBuffer.length || fileBuffer.length > 20 * 1024 * 1024) {
        response.status(400).json({ message: '图片大小需在 20MB 以内' });
        return;
      }
      const outputBuffer = await sharp(fileBuffer, { animated: false })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer();
      const fileName = `course-map-${access.course.slug}-${access.user.id}-${Date.now()}-${crypto
        .randomBytes(8)
        .toString('hex')}.webp`;
      await fs.promises.mkdir(uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(uploadDir, fileName), outputBuffer);
      response.status(201).json({
        url: `/uploads/${fileName}`,
        markdown: `![图片说明](/uploads/${fileName})`,
      });
    } catch (error) {
      sendCourseError(response, error, '上传课程图片失败');
    }
  });

  return router;
}

module.exports = {
  canManageCourse,
  createCourseMapsRouter,
  ensureCourseMapTables,
  isValidNodeId,
  normalizeNodeId,
};
