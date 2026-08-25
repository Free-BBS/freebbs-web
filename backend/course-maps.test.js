const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');
const {
  createCourseMapsRouter,
  isValidNodeId,
  normalizeMapBackgroundUrl,
  normalizeNodeId,
  normalizeLegacySectionHeading,
  resolveKnowledgeSections,
  splitLegacyKnowledgeDocument,
} = require('./course-maps');

test('normalizes knowledge node ids to uppercase ASCII', () => {
  assert.equal(normalizeNodeId(' ss-01-01 '), 'SS-01-01');
});

test('accepts structured ASCII knowledge node ids', () => {
  assert.equal(isValidNodeId('SS-01-01'), true);
  assert.equal(isValidNodeId('CIRCUIT-A1-02'), true);
});

test('rejects unsafe or unstructured knowledge node ids', () => {
  assert.equal(isValidNodeId('signal-basics'), false);
  assert.equal(isValidNodeId('SS 01 01'), false);
  assert.equal(isValidNodeId('信号-01-01'), false);
  assert.equal(isValidNodeId('../SS-01'), false);
});

test('normalizes safe course map background locations', () => {
  assert.equal(normalizeMapBackgroundUrl(''), '');
  assert.equal(
    normalizeMapBackgroundUrl(' /uploads/course-map-background-signals.webp '),
    '/uploads/course-map-background-signals.webp',
  );
  assert.equal(
    normalizeMapBackgroundUrl('/assets/course-maps/signals.webp'),
    '/assets/course-maps/signals.webp',
  );
  assert.equal(
    normalizeMapBackgroundUrl('https://cdn.example.test/maps/signals.webp'),
    'https://cdn.example.test/maps/signals.webp',
  );
});

test('rejects unsafe course map background locations', () => {
  assert.equal(normalizeMapBackgroundUrl('/uploads/../private.txt'), null);
  assert.equal(normalizeMapBackgroundUrl('/discussion/avatar.png'), null);
  assert.equal(normalizeMapBackgroundUrl('http://cdn.example.test/map.webp'), null);
  assert.equal(normalizeMapBackgroundUrl('https://user:secret@example.test/map.webp'), null);
  assert.equal(normalizeMapBackgroundUrl('data:image/png;base64,AAAA'), null);
});

test('splits legacy knowledge documents into independent content sections', () => {
  const sections = splitLegacyKnowledgeDocument(
    `# 傅里叶变换

## 基本信息

- 难度：3
- 别名：FT

## 核心知识

傅里叶变换把信号从时域转换到频域。

### 定义

$$X(\\omega)=\\int x(t)e^{-j\\omega t}dt$$

## 知识点应用

- 频谱分析
- 滤波器设计`,
    '傅里叶变换',
  );

  assert.equal(sections.basicInfoMarkdown, '- 难度：3\n- 别名：FT');
  assert.match(sections.knowledgeMarkdown, /傅里叶变换把信号从时域转换到频域/);
  assert.match(sections.knowledgeMarkdown, /### 定义/);
  assert.doesNotMatch(sections.knowledgeMarkdown, /基本信息|知识点应用|难度/);
  assert.equal(sections.applicationsMarkdown, '- 频谱分析\n- 滤波器设计');
});

test('keeps ordinary markdown unchanged when a legacy document has no known sections', () => {
  const markdown = '## 定义\n\n正文内容。\n\n## 推导\n\n推导内容。';
  assert.deepEqual(splitLegacyKnowledgeDocument(markdown), {
    knowledgeMarkdown: markdown,
    basicInfoMarkdown: '',
    applicationsMarkdown: '',
  });
});

test('normalizes numbered legacy section headings', () => {
  assert.equal(normalizeLegacySectionHeading('0. 基本信息'), '基本信息');
  assert.equal(normalizeLegacySectionHeading('1. 知识背景与应用'), '知识背景与应用');
  assert.equal(normalizeLegacySectionHeading('2. 知识点正文'), '知识点正文');
  assert.equal(normalizeLegacySectionHeading('二、知识点正文'), '知识点正文');
});

test('extracts only knowledge content from numbered course documents', () => {
  const sections = splitLegacyKnowledgeDocument(
    `# 0. 基本信息

课程名称：高等微积分

## 知识点名称

名称：数域

# 1. 知识背景与应用

## 1.1 知识点概述

本知识点为引出实数域做铺垫。

## 1.2 与其他课程或知识点的联系

相关知识点名称：实数域

# 2. 知识点正文

## 2.1 从数集到数域

这样的数系称为数域。

## 2.2 数域的定义

设 F 是一个非空集合。

# 附录：主要依据与修订

## 主要依据

依据 ID：CAL-PPT-WXF-S1-001

## 修订记录

v0.4`,
    '数域',
  );

  assert.match(sections.knowledgeMarkdown, /## 2\.1 从数集到数域/);
  assert.match(sections.knowledgeMarkdown, /这样的数系称为数域/);
  assert.match(sections.knowledgeMarkdown, /## 2\.2 数域的定义/);
  assert.doesNotMatch(
    sections.knowledgeMarkdown,
    /基本信息|高等微积分|知识背景与应用|实数域做铺垫|附录|依据 ID|修订记录/,
  );
  assert.match(sections.basicInfoMarkdown, /课程名称：高等微积分/);
  assert.match(sections.basicInfoMarkdown, /依据 ID：CAL-PPT-WXF-S1-001/);
  assert.match(sections.applicationsMarkdown, /本知识点为引出实数域做铺垫/);
  assert.match(sections.applicationsMarkdown, /相关知识点名称：实数域/);
});

test('recovers numbered legacy content previously saved into the knowledge section', () => {
  const sections = resolveKnowledgeSections({
    title: '数域',
    document_markdown: '旧兼容字段',
    knowledge_markdown: `# 0. 基本信息

课程名称：高等微积分

# 1. 知识背景与应用

用于引出实数域。

# 2. 知识点正文

## 2.1 从数集到数域

这样的数系称为数域。

# 附录：主要依据与修订

依据 ID：CAL-PPT-WXF-S1-001`,
    basic_info_markdown: '',
    applications_markdown: '',
  });

  assert.equal(sections.knowledgeMarkdown, '## 2.1 从数集到数域\n\n这样的数系称为数域。');
  assert.match(sections.basicInfoMarkdown, /课程名称：高等微积分/);
  assert.match(sections.basicInfoMarkdown, /依据 ID：CAL-PPT-WXF-S1-001/);
  assert.equal(sections.applicationsMarkdown, '用于引出实数域。');
});

function createMockCourseMapPool() {
  let backgroundUrl = '/assets/course-maps/initial.webp';
  const writes = [];
  const course = {
    id: 7,
    slug: 'signals',
    name: '信号系统',
    code: 'Signals and Systems',
    board_slug: 'signal',
    description: '',
    summary: '',
    sort_order: 20,
  };

  return {
    get backgroundUrl() {
      return backgroundUrl;
    },
    writes,
    async execute(statement, parameters = []) {
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (sql === "SELECT id FROM courses WHERE slug = 'signals' LIMIT 1") {
        return [[]];
      }
      if (sql.startsWith('SELECT id, slug, name, code, board_slug')) {
        return [[course]];
      }
      if (sql.includes('FROM course_map_nodes') && sql.includes('ORDER BY position_y')) {
        return [[]];
      }
      if (sql.includes('FROM course_map_edges') && sql.includes('ORDER BY created_at')) {
        return [[]];
      }
      if (sql.includes('SELECT background_url FROM course_map_settings')) {
        return [backgroundUrl ? [{ background_url: backgroundUrl }] : []];
      }
      if (sql.includes('FROM course_material_managers')) {
        return [Number(parameters[1]) === 22 ? [{ course_id: course.id }] : []];
      }
      if (sql.startsWith('INSERT INTO course_map_settings')) {
        backgroundUrl = parameters[1] || '';
        writes.push(parameters);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

test('serves persisted backgrounds publicly and restricts background changes to course managers', async (t) => {
  const uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'course-map-background-'));
  const pool = createMockCourseMapPool();
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(
    '/api/courses',
    createCourseMapsRouter({
      pool,
      uploadDir,
      getOptionalAuthUser: async () => null,
      requireAuth: async (request, response) => {
        const authorization = request.get('authorization');
        if (!authorization) {
          response.status(401).json({ message: '请先登录' });
          return null;
        }
        return {
          id: authorization === 'Bearer manager' ? 22 : 23,
          is_admin: false,
        };
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/courses/signals/map`;

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.promises.rm(uploadDir, { recursive: true, force: true });
  });

  const publicResponse = await fetch(baseUrl);
  assert.equal(publicResponse.status, 200);
  assert.equal((await readJson(publicResponse)).backgroundUrl, pool.backgroundUrl);

  const forbiddenResponse = await fetch(`${baseUrl}/background`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer outsider',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backgroundUrl: '/assets/course-maps/forbidden.webp' }),
  });
  assert.equal(forbiddenResponse.status, 403);
  assert.equal(pool.writes.length, 0);

  const unsafeResponse = await fetch(`${baseUrl}/background`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer manager',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backgroundUrl: 'data:image/png;base64,AAAA' }),
  });
  assert.equal(unsafeResponse.status, 400);
  assert.equal(pool.writes.length, 0);

  const configuredResponse = await fetch(`${baseUrl}/background`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer manager',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backgroundUrl: '/assets/course-maps/configured.webp' }),
  });
  assert.equal(configuredResponse.status, 200);
  assert.equal(
    (await readJson(configuredResponse)).backgroundUrl,
    '/assets/course-maps/configured.webp',
  );
  assert.equal(pool.backgroundUrl, '/assets/course-maps/configured.webp');

  const imageBuffer = await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: '#07152d',
    },
  })
    .png()
    .toBuffer();
  const uploadedResponse = await fetch(`${baseUrl}/background`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer manager',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`,
    }),
  });
  assert.equal(uploadedResponse.status, 200);
  const uploadedBody = await readJson(uploadedResponse);
  assert.match(
    uploadedBody.backgroundUrl,
    /^\/uploads\/course-map-background-signals-22-\d+-[a-f0-9]{16}\.webp$/,
  );
  const outputPath = path.join(uploadDir, path.basename(uploadedBody.backgroundUrl));
  const outputBuffer = await fs.promises.readFile(outputPath);
  assert.equal((await sharp(outputBuffer).metadata()).format, 'webp');
  assert.equal(pool.backgroundUrl, uploadedBody.backgroundUrl);

  const clearedResponse = await fetch(`${baseUrl}/background`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer manager',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backgroundUrl: '' }),
  });
  assert.equal(clearedResponse.status, 200);
  assert.equal((await readJson(clearedResponse)).backgroundUrl, '');
  assert.equal(pool.backgroundUrl, '');
});
