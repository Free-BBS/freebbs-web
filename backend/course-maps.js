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
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BACKGROUND_URL_LENGTH = 512;
const SAFE_LOCAL_BACKGROUND_PATH = /^\/(?:assets|uploads)\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

const LEGACY_SECTION_HEADINGS = {
  basicInfo: /^(?:基本信息|知识点信息|知识信息|概览|附录(?:[:：].*)?|主要依据与修订)$/,
  knowledge: /^(?:知识|知识正文|知识点正文|核心知识|核心解释|知识详解)$/,
  applications: /^(?:知识点应用|知识背景与应用|背景与应用|应用与拓展|应用场景|实际应用|典型应用)$/,
};
const LEGACY_METADATA_LABELS = new Set([
  '课程名称',
  '课程ID',
  '章节/单元',
  '小节',
  '知识点名称',
  '知识点ID',
  '知识点类型',
  '知识点层级',
  '难度（1-5）',
  '重要程度（1-5）',
  '建议学习时长',
  '填写人',
  '复核人',
  '状态',
  '备注',
  '关联知识点',
  '关系类型',
  '关系说明',
  '主要依据',
  '复核',
  '基本信息与正式表格一致',
  '关联与正式表格一致',
  '教学范围已复核',
  '内容准确性已复核',
  '版本',
  '日期',
  '修订记录',
  '修改人',
  '修改内容',
  '复核结论',
]);

function normalizeLegacySectionHeading(value) {
  return String(value || '')
    .trim()
    .replace(
      /^(?:(?:第?[零一二三四五六七八九十百]+(?:章|节|部分)?)|(?:[（(]?\d+(?:\.\d+)*[）)]?))[.．、:：\s-]+/,
      '',
    )
    .trim();
}

function getLegacyMetadataLabel(line) {
  const match = String(line || '').match(/^\s*([^:：]{1,40}?)\s*[:：]/);
  const label = match?.[1]?.trim() || '';
  return LEGACY_METADATA_LABELS.has(label) ? label : '';
}

function isLegacyMetadataValueLine(line) {
  const value = String(line || '').trim();
  return !value || /^(?:".*"|'[^']*'|\[.*\]|\{.*\}|true|false|null)$/i.test(value);
}

function splitLeadingLegacyMetadata(markdown) {
  const lines = String(markdown || '').split('\n');
  const metadata = [];
  let metadataFieldCount = 0;
  let bodyStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (getLegacyMetadataLabel(line)) {
      metadata.push(line);
      metadataFieldCount += 1;
      continue;
    }

    if (metadataFieldCount && isLegacyMetadataValueLine(line)) {
      metadata.push(line);
      continue;
    }

    bodyStart = index;
    break;
  }

  const knowledgeMarkdown = bodyStart >= 0 ? lines.slice(bodyStart).join('\n').trim() : '';
  if (metadataFieldCount < 4 || !knowledgeMarkdown) {
    return { knowledgeMarkdown: String(markdown || '').trim(), basicInfoMarkdown: '' };
  }

  return {
    knowledgeMarkdown,
    basicInfoMarkdown: metadata.join('\n').trim(),
  };
}

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

function normalizeMapBackgroundUrl(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length > MAX_BACKGROUND_URL_LENGTH) {
    return null;
  }
  if (normalized.startsWith('/')) {
    if (
      !SAFE_LOCAL_BACKGROUND_PATH.test(normalized) ||
      normalized.includes('..') ||
      normalized.includes('//')
    ) {
      return null;
    }
    return normalized;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function decodeImageDataUrl(value) {
  const imageDataUrl = String(value || '');
  const match = imageDataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|heic|heif|bmp|tiff|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i,
  );
  if (!match) {
    return null;
  }
  const fileBuffer = Buffer.from(match[2], 'base64');
  if (!fileBuffer.length || fileBuffer.length > MAX_IMAGE_BYTES) {
    return null;
  }
  return fileBuffer;
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

function splitLegacyKnowledgeDocument(markdown, title = '') {
  const source = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const sections = { knowledgeMarkdown: '', basicInfoMarkdown: '', applicationsMarkdown: '' };
  if (!source) {
    return sections;
  }

  const buckets = { knowledge: [], basicInfo: [], applications: [] };
  let activeSection = 'knowledge';
  let activeSectionLevel = 0;
  for (const line of source.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2].trim();
      const normalizedLabel = normalizeLegacySectionHeading(label);
      const explicitSection = Object.entries(LEGACY_SECTION_HEADINGS).find(([, pattern]) =>
        pattern.test(normalizedLabel),
      )?.[0];
      if (explicitSection) {
        activeSection = explicitSection;
        activeSectionLevel = level;
        continue;
      }
      if (activeSection !== 'knowledge' && level <= activeSectionLevel) {
        activeSection = 'knowledge';
        activeSectionLevel = 0;
      }
      if (level === 1 && label === String(title || '').trim()) {
        continue;
      }
    }
    buckets[activeSection].push(line);
  }

  sections.knowledgeMarkdown = buckets.knowledge.join('\n').trim();
  sections.basicInfoMarkdown = buckets.basicInfo.join('\n').trim();
  sections.applicationsMarkdown = buckets.applications.join('\n').trim();

  if (!sections.basicInfoMarkdown) {
    const recoveredMetadata = splitLeadingLegacyMetadata(sections.knowledgeMarkdown);
    sections.knowledgeMarkdown = recoveredMetadata.knowledgeMarkdown;
    sections.basicInfoMarkdown = recoveredMetadata.basicInfoMarkdown;
  }

  return sections;
}

function resolveKnowledgeSections(row) {
  const legacySections = splitLegacyKnowledgeDocument(row.document_markdown, row.title);
  const hasStructuredSections =
    row.knowledge_markdown !== undefined && row.knowledge_markdown !== null;
  if (!hasStructuredSections) {
    return legacySections;
  }

  const persistedSections = {
    knowledgeMarkdown: row.knowledge_markdown || '',
    basicInfoMarkdown: row.basic_info_markdown || '',
    applicationsMarkdown: row.applications_markdown || '',
  };
  const recoveredSections = splitLegacyKnowledgeDocument(
    persistedSections.knowledgeMarkdown,
    row.title,
  );
  const hasSeparateSupplementaryContent = Boolean(
    persistedSections.basicInfoMarkdown.trim() || persistedSections.applicationsMarkdown.trim(),
  );
  const containsRecoverableLegacySections = Boolean(
    recoveredSections.basicInfoMarkdown || recoveredSections.applicationsMarkdown,
  );
  return !hasSeparateSupplementaryContent && containsRecoverableLegacySections
    ? recoveredSections
    : persistedSections;
}

function toMapNode(row, includeMarkdown = false) {
  const sections = resolveKnowledgeSections(row);
  return {
    id: row.node_id,
    title: row.title,
    summary: row.summary || '',
    position: {
      x: Number(row.position_x || 0),
      y: Number(row.position_y || 0),
    },
    hasDocument: Boolean(row.has_document ?? sections.knowledgeMarkdown),
    updatedAt: row.updated_at || null,
    ...(includeMarkdown
      ? {
          markdown: sections.knowledgeMarkdown,
          sections,
        }
      : {}),
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
    `CREATE TABLE IF NOT EXISTS course_map_settings (
      course_id BIGINT PRIMARY KEY,
      background_url VARCHAR(512) NULL,
      updated_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_course_map_settings_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      CONSTRAINT fk_course_map_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
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
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS course_map_node_sections (
      course_id BIGINT NOT NULL,
      node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      knowledge_markdown MEDIUMTEXT NULL,
      basic_info_markdown MEDIUMTEXT NULL,
      applications_markdown MEDIUMTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (course_id, node_id),
      CONSTRAINT fk_course_map_node_sections_node
        FOREIGN KEY (course_id, node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS rag_index_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      requested_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      requested_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
  await pool.execute(`INSERT IGNORE INTO rag_index_state (id, requested_revision) VALUES (1, 0)`);

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

async function markRagIndexDirty(pool) {
  await pool.execute(
    `UPDATE rag_index_state
     SET requested_revision = requested_revision + 1,
         requested_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  );
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
      const [settingsRows] = await pool.execute(
        `SELECT background_url
         FROM course_map_settings
         WHERE course_id = ?
         LIMIT 1`,
        [course.id],
      );
      response.json({
        course: {
          ...toCourse(course),
          canEditMap: await canManageCourse(pool, currentUser, course.id),
        },
        backgroundUrl: settingsRows[0]?.background_url || '',
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
        `SELECT n.node_id, n.title, n.summary, n.position_x, n.position_y,
                n.document_markdown, n.updated_at,
                s.knowledge_markdown, s.basic_info_markdown, s.applications_markdown
         FROM course_map_nodes n
         LEFT JOIN course_map_node_sections s
           ON s.course_id = n.course_id AND s.node_id = n.node_id
         WHERE n.course_id = ? AND n.node_id = ?
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
      await markRagIndexDirty(pool);
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
      await markRagIndexDirty(pool);
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
      const requestedSections = request.body.sections;
      const usesStructuredSections = requestedSections && typeof requestedSections === 'object';
      const sections = usesStructuredSections
        ? {
            knowledgeMarkdown: String(requestedSections.knowledgeMarkdown || ''),
            basicInfoMarkdown: String(requestedSections.basicInfoMarkdown || ''),
            applicationsMarkdown: String(requestedSections.applicationsMarkdown || ''),
          }
        : {
            knowledgeMarkdown: String(request.body.markdown || ''),
            basicInfoMarkdown: '',
            applicationsMarkdown: '',
          };
      if (Object.values(sections).some((markdown) => markdown.length > MAX_MARKDOWN_LENGTH)) {
        response.status(400).json({ message: '每个 Markdown 分区不能超过 500000 个字符' });
        return;
      }
      const [nodeRows] = await pool.execute(
        `SELECT 1 FROM course_map_nodes WHERE course_id = ? AND node_id = ? LIMIT 1`,
        [access.course.id, nodeId],
      );
      if (!nodeRows[0]) {
        response.status(404).json({ message: '知识结点不存在' });
        return;
      }
      if (usesStructuredSections) {
        await pool.execute(
          `INSERT INTO course_map_node_sections (
            course_id, node_id, knowledge_markdown, basic_info_markdown, applications_markdown
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            knowledge_markdown = VALUES(knowledge_markdown),
            basic_info_markdown = VALUES(basic_info_markdown),
            applications_markdown = VALUES(applications_markdown)`,
          [
            access.course.id,
            nodeId,
            sections.knowledgeMarkdown,
            sections.basicInfoMarkdown,
            sections.applicationsMarkdown,
          ],
        );
      } else {
        await pool.execute(
          `INSERT INTO course_map_node_sections (course_id, node_id, knowledge_markdown)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE knowledge_markdown = VALUES(knowledge_markdown)`,
          [access.course.id, nodeId, sections.knowledgeMarkdown],
        );
      }
      await pool.execute(
        `UPDATE course_map_nodes
         SET document_markdown = ?, updated_by = ?
         WHERE course_id = ? AND node_id = ?`,
        [sections.knowledgeMarkdown, access.user.id, access.course.id, nodeId],
      );
      await markRagIndexDirty(pool);
      response.json({
        ok: true,
        nodeId,
        hasDocument: Boolean(sections.knowledgeMarkdown.trim()),
        sections,
      });
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
      await markRagIndexDirty(pool);
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
      await markRagIndexDirty(pool);
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
      await markRagIndexDirty(pool);
      response.json({ ok: true });
    } catch (error) {
      sendCourseError(response, error, '删除连接失败');
    }
  });

  router.put('/:slug/map/background', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }

      let backgroundUrl;
      if (Object.hasOwn(request.body, 'imageDataUrl')) {
        const fileBuffer = decodeImageDataUrl(request.body.imageDataUrl);
        if (!fileBuffer) {
          response.status(400).json({ message: '请上传 20MB 以内的有效图片文件' });
          return;
        }
        const outputBuffer = await sharp(fileBuffer, { animated: false })
          .rotate()
          .resize({ width: 3840, height: 2160, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer();
        const fileName = `course-map-background-${access.course.slug}-${access.user.id}-${Date.now()}-${crypto
          .randomBytes(8)
          .toString('hex')}.webp`;
        await fs.promises.mkdir(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), outputBuffer);
        backgroundUrl = `/uploads/${fileName}`;
      } else if (Object.hasOwn(request.body, 'backgroundUrl')) {
        backgroundUrl = normalizeMapBackgroundUrl(request.body.backgroundUrl);
        if (backgroundUrl === null) {
          response.status(400).json({
            message: '背景地址需为 HTTPS 图片地址，或站内 /assets、/uploads 图片路径',
          });
          return;
        }
      } else {
        response.status(400).json({ message: '请提供背景图片或背景地址' });
        return;
      }

      await pool.execute(
        `INSERT INTO course_map_settings (course_id, background_url, updated_by)
         VALUES (?, NULLIF(?, ''), ?)
         ON DUPLICATE KEY UPDATE
           background_url = VALUES(background_url),
           updated_by = VALUES(updated_by)`,
        [access.course.id, backgroundUrl, access.user.id],
      );
      response.json({ backgroundUrl });
    } catch (error) {
      sendCourseError(response, error, '保存课程地图背景失败');
    }
  });

  router.post('/:slug/map/uploads/images', async (request, response) => {
    try {
      await ensureCourseMapTables(pool);
      const access = await requireCourseManager(request, response);
      if (!access) {
        return;
      }
      const fileBuffer = decodeImageDataUrl(request.body.imageDataUrl);
      if (!fileBuffer) {
        response.status(400).json({ message: '请上传 20MB 以内的有效图片文件' });
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
  normalizeMapBackgroundUrl,
  normalizeNodeId,
  normalizeLegacySectionHeading,
  resolveKnowledgeSections,
  splitLegacyKnowledgeDocument,
};
