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
  assert.equal((await sharp(outputPath).metadata()).format, 'webp');
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
