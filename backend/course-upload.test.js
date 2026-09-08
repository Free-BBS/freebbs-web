const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');
const {
  createCourseUploadRouter,
  hashToken,
  toNode,
  validateNodePatch,
  decodeFile,
} = require('./course-upload');

const agentToken = `fbcu_${'a'.repeat(43)}`;
const initialNode = {
  node_id: 'SS-01-01',
  title: '原标题',
  summary: '原简介',
  position_x: 200,
  position_y: 350,
  knowledge_markdown: '原知识',
  basic_info_markdown: '重要信息',
  applications_markdown: '原应用',
  document_markdown: '原知识',
  updated_at: '2026-09-08 12:00:00',
};

function mockPool() {
  const state = {
    user: { id: 5, username: 'student_manager', is_admin: 0 },
    manager: true,
    nodes: { 'SS-01-01': structuredClone(initialNode) },
    files: [],
    revision: 0,
    tokens: [
      {
        id: 1,
        user_id: 5,
        name: 'test',
        token_hash: hashToken(agentToken),
        token_prefix: agentToken.slice(0, 12),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
      },
    ],
    commits: 0,
    rollbacks: 0,
    failSections: false,
    background: '',
  };
  const pool = {
    state,
    async execute(statement, params = []) {
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (sql.includes('FROM course_upload_tokens t JOIN users')) {
        const token = state.tokens.find(
          (item) =>
            item.token_hash === params[0] && !item.revoked_at && item.expires_at > new Date(),
        );
        return [token ? [{ ...state.user, token_id: token.id }] : []];
      }
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 5 }]];
      if (sql.startsWith('SELECT COUNT(*) AS total FROM course_upload_tokens'))
        return [[{ total: state.tokens.filter((item) => !item.revoked_at).length }]];
      if (sql.startsWith('INSERT INTO course_upload_tokens')) {
        const id = state.tokens.length + 1;
        state.tokens.push({
          id,
          user_id: params[0],
          name: params[1],
          token_hash: params[2],
          token_prefix: params[3],
          expires_at: params[4],
        });
        return [{ insertId: id }];
      }
      if (sql.startsWith('SELECT id, name, token_prefix'))
        return [state.tokens.filter((item) => item.user_id === params[0])];
      if (sql.startsWith('UPDATE course_upload_tokens SET revoked_at')) {
        const token = state.tokens.find(
          (item) => item.id === Number(params[0]) && item.user_id === params[1],
        );
        if (token) token.revoked_at = new Date();
        return [{ affectedRows: token ? 1 : 0 }];
      }
      if (sql.startsWith('UPDATE course_upload_tokens SET last_used_at'))
        return [{ affectedRows: 1 }];
      if (
        sql.startsWith('SELECT id, slug, name FROM courses') ||
        sql.startsWith('SELECT id, slug, name, code')
      ) {
        return [params[0] === 'signals' ? [{ id: 7, slug: 'signals', name: '信号与系统' }] : []];
      }
      if (sql.startsWith('SELECT c.id, c.slug, c.name'))
        return [
          state.manager || state.user.is_admin
            ? [{ id: 7, slug: 'signals', name: '信号与系统' }]
            : [],
        ];
      if (sql.includes('FROM course_material_managers'))
        return [state.manager ? [{ course_id: 7 }] : []];
      if (sql.startsWith('SELECT n.node_id'))
        return [state.nodes[params[1]] ? [state.nodes[params[1]]] : []];
      if (sql.startsWith('INSERT INTO course_map_nodes')) {
        const [, id, title, summary, x, y, knowledge] = params;
        state.nodes[id] = {
          ...state.nodes[id],
          node_id: id,
          title,
          summary,
          position_x: x,
          position_y: y,
          document_markdown: knowledge,
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO course_map_node_sections')) {
        if (state.failSections) throw new Error('Simulated DB failure without exposing secrets');
        const [, id, knowledge, basic, applications] = params;
        Object.assign(state.nodes[id], {
          knowledge_markdown: knowledge,
          basic_info_markdown: basic,
          applications_markdown: applications,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE rag_index_state')) {
        state.revision += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM course_uploaded_files WHERE course_id = ? AND sha256'))
        return [
          state.files.filter((item) => item.course_id === params[0] && item.sha256 === params[1]),
        ];
      if (
        sql.startsWith('SELECT * FROM course_uploaded_files WHERE id') ||
        (sql.startsWith('SELECT f.* FROM course_uploaded_files') && sql.includes('f.id = ?'))
      )
        return [state.files.filter((item) => item.id === params[0])];
      if (
        sql.startsWith('SELECT * FROM course_uploaded_files') ||
        sql.startsWith('SELECT f.* FROM course_uploaded_files')
      )
        return [state.files];
      if (sql.startsWith('INSERT INTO course_uploaded_files')) {
        const [id, course, node, name, stored, contentType, size, digest, user] = params;
        state.files.push({
          id,
          course_id: course,
          node_id: node,
          file_name: name,
          stored_name: stored,
          content_type: contentType,
          byte_size: size,
          sha256: digest,
          uploaded_by: user,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO course_map_settings')) {
        [, state.background] = params;
        return [{ affectedRows: 1 }];
      }
      if (
        sql.startsWith('CREATE TABLE') ||
        sql.startsWith('INSERT IGNORE') ||
        sql.startsWith('INSERT INTO courses')
      )
        return [{ affectedRows: 1 }];
      if (sql === "SELECT id FROM courses WHERE slug = 'signals' LIMIT 1") return [[]];
      throw new Error(`Unmocked SQL: ${sql}`);
    },
    async getConnection() {
      let snapshot;
      return {
        execute: (...args) => pool.execute(...args),
        async beginTransaction() {
          snapshot = structuredClone(state);
        },
        async commit() {
          state.commits += 1;
        },
        async rollback() {
          Object.assign(state, snapshot);
          state.rollbacks += 1;
        },
        release() {},
      };
    },
  };
  return pool;
}

async function harness(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'course-agent-test-'));
  const pool = mockPool();
  const app = express();
  app.use(express.json({ limit: '28mb' }));
  app.use(
    '/api/course-upload',
    createCourseUploadRouter({
      pool,
      uploadDir: path.join(dir, 'uploads'),
      requireAuth: async (req, response) => {
        if (req.get('authorization') !== 'Bearer session') {
          response.status(401).json({ message: '登录失效' });
          return null;
        }
        return pool.state.user;
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/course-upload`;
  async function request(route, method = 'GET', body = undefined, token = agentToken) {
    return fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  return { pool, request, dir, base };
}

test('partial node patch preserves other Markdown sections and each omitted coordinate', () => {
  const next = validateNodePatch(
    { sections: { knowledgeMarkdown: '新正文' }, position: { x: 640 } },
    initialNode,
  );
  assert.deepEqual(next.sections, {
    knowledgeMarkdown: '新正文',
    basicInfoMarkdown: '重要信息',
    applicationsMarkdown: '原应用',
  });
  assert.deepEqual(next.position, { x: 640, y: 350 });
  assert.equal(next.title, '原标题');
  assert.throws(
    () => validateNodePatch({ expectedRevision: 'stale', title: '覆盖' }, initialNode),
    (error) => error.status === 409,
  );
  assert.equal(
    validateNodePatch({ expectedRevision: toNode(initialNode).revision, summary: '' }, initialNode)
      .summary,
    '',
  );
});

test('validates patch and file formats, bounds, and traversal', () => {
  for (const patch of [
    { title: 17 },
    { position: { x: -1 } },
    { position: { x: 0.2 } },
    { sections: { knowledgeMarkdown: {} } },
    { sections: { unknown: 'x' } },
    { unknown: 5 },
    { sections: { knowledgeMarkdown: 'x'.repeat(500001) } },
  ]) {
    assert.throws(
      () => validateNodePatch(patch, initialNode),
      (error) => error.status === 400,
    );
  }
  const good = { fileName: '讲义.md', contentBase64: Buffer.from('## 正文').toString('base64') };
  assert.equal(decodeFile(good).buffer.toString(), '## 正文');
  for (const body of [
    { ...good, fileName: '../a.md' },
    { ...good, fileName: 'x\\a.md' },
    { ...good, fileName: 'x.html' },
    { ...good, fileName: 'x.pdf' },
    { ...good, fileName: 'x.docx' },
    { ...good, contentBase64: '%%%' },
    { ...good, contentBase64: Buffer.from([0xff]).toString('base64') },
  ]) {
    assert.throws(
      () => decodeFile(body),
      (error) => error.status === 400,
    );
  }
});

test('accepts the documented 20 MB file limit without regex stack overflow', () => {
  const source = Buffer.alloc(20 * 1024 * 1024, 65);
  assert.equal(
    decodeFile({ fileName: 'large.txt', contentBase64: source.toString('base64') }).buffer.length,
    source.length,
  );
  assert.throws(
    () =>
      decodeFile({
        fileName: 'large.txt',
        contentBase64: Buffer.alloc(source.length + 1, 65).toString('base64'),
      }),
    (error) => error.status === 400,
  );
});

test('a student assigned as manager can create scoped hashed Token; only owner can revoke it', async (t) => {
  const { pool, request } = await harness(t);
  const denied = await request('/tokens', 'GET');
  assert.equal(denied.status, 401);
  const created = await request(
    '/tokens',
    'POST',
    { name: '备课助手', expiresInDays: 30 },
    'session',
  );
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.token, /^fbcu_[A-Za-z0-9_-]{43}$/);
  assert.equal(pool.state.tokens[1].token_hash, hashToken(body.token));
  const list = await (await request('/tokens', 'GET', undefined, 'session')).json();
  assert.equal(JSON.stringify(list).includes(body.token), false);
  assert.equal(JSON.stringify(list).includes(pool.state.tokens[1].token_hash), false);
  const outsider = await request('/tokens/700', 'DELETE', undefined, 'session');
  assert.equal(outsider.status, 404);
  assert.equal((await request(`/tokens/${body.id}`, 'DELETE', undefined, 'session')).status, 200);
  assert.equal((await request('/courses', 'GET', undefined, body.token)).status, 401);
});

test('token access rechecks permissions, username, expiration, revocation, and course', async (t) => {
  const { pool, request } = await harness(t);
  assert.equal((await request('/courses')).status, 200);
  assert.equal((await request('/courses', 'GET', undefined, 'session')).status, 401);
  assert.equal((await request('/courses/missing/nodes/SS-01-01')).status, 404);
  pool.state.manager = false;
  assert.equal((await request('/courses/signals/nodes/SS-01-01')).status, 403);
  pool.state.user.is_admin = 1;
  assert.equal((await request('/courses/signals/nodes/SS-01-01')).status, 200);
  pool.state.user.username = '旧用户';
  assert.equal((await request('/courses')).status, 403);
  pool.state.user.username = 'fixed_user';
  pool.state.tokens[0].expires_at = new Date(0);
  assert.equal((await request('/courses')).status, 401);
  pool.state.tokens[0].expires_at = new Date(Date.now() + 86400000);
  pool.state.tokens[0].revoked_at = new Date();
  assert.equal((await request('/courses')).status, 401);
});

test('transactional upsert persists only supplied fields, increments RAG revision, rejects stale revision', async (t) => {
  const { pool, request } = await harness(t);
  const { revision } = toNode(pool.state.nodes['SS-01-01']);
  const result = await request('/courses/signals/nodes/SS-01-01', 'PUT', {
    sections: { knowledgeMarkdown: '新正文' },
    expectedRevision: revision,
  });
  assert.equal(result.status, 200);
  const { node } = await result.json();
  assert.equal(node.sections.basicInfoMarkdown, '重要信息');
  assert.deepEqual(node.position, { x: 200, y: 350 });
  assert.equal(pool.state.revision, 1);
  assert.equal(pool.state.commits, 1);
  const stale = await request('/courses/signals/nodes/SS-01-01', 'PUT', {
    title: '覆盖',
    expectedRevision: revision,
  });
  assert.equal(stale.status, 409);
  assert.equal(pool.state.nodes['SS-01-01'].title, '原标题');
  assert.equal(pool.state.revision, 1);
  const created = await request('/courses/signals/nodes/SS-02-01', 'PUT', {
    title: '第二章',
    expectedRevision: 'new',
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).node.title, '第二章');
});

test('upsert rolls back node writes when sections fail and hides internal errors', async (t) => {
  const { pool, request } = await harness(t);
  pool.state.failSections = true;
  const result = await request('/courses/signals/nodes/SS-01-01', 'PUT', { title: '错误更新' });
  assert.equal(result.status, 500);
  assert.equal(pool.state.nodes['SS-01-01'].title, '原标题');
  assert.equal(pool.state.revision, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.doesNotMatch(await result.text(), /Simulated|secret/);
});

test('course files use random paths, deduplicate identical bytes, and download as attachment', async (t) => {
  const { pool, request, dir } = await harness(t);
  const payload = {
    fileName: '第一章.md',
    contentBase64: Buffer.from('# 讲义').toString('base64'),
    nodeId: 'SS-01-01',
  };
  const uploaded = await request('/courses/signals/files', 'POST', payload);
  assert.equal(uploaded.status, 201);
  const { file } = await uploaded.json();
  assert.equal(file.nodeId, 'SS-01-01');
  assert.equal(
    (await fs.promises.readdir(path.join(dir, 'uploads', 'course-agent-files'))).length,
    1,
  );
  assert.equal(pool.state.files[0].stored_name.includes('第一章'), false);
  const repeated = await request('/courses/signals/files', 'POST', payload);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).file.id, file.id);
  assert.equal(pool.state.files.length, 1);
  const download = await request(`/files/${file.id}`, 'GET', undefined, '');
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await download.text(), '# 讲义');
  pool.state.manager = false;
  assert.equal(
    (await request('/courses/signals/files', 'POST', { ...payload, fileName: 'other.md' })).status,
    403,
  );
  assert.equal(pool.state.files.length, 1);
});

test('image uploads decode and transcode WebP, disallow invalid bytes and current outsiders', async (t) => {
  const { pool, request, dir } = await harness(t);
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#2545ab' } })
    .png()
    .toBuffer();
  const result = await request('/courses/signals/images', 'POST', {
    imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
  });
  assert.equal(result.status, 201);
  const body = await result.json();
  const image = await sharp(path.join(dir, 'uploads', path.basename(body.url))).metadata();
  assert.equal(image.format, 'webp');
  assert.equal(
    (
      await request('/courses/signals/images', 'POST', {
        imageDataUrl: 'data:image/png;base64,YWJj',
      })
    ).status,
    400,
  );
  pool.state.manager = false;
  assert.equal(
    (
      await request('/courses/signals/images', 'POST', {
        imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      })
    ).status,
    403,
  );
});

test('existing editor background API works through token guard and rejects unassigned courses', async (t) => {
  const { pool, request } = await harness(t);
  const result = await request('/courses/signals/map/background', 'PUT', {
    backgroundUrl: '/assets/course-maps/background.webp',
  });
  assert.equal(result.status, 200);
  assert.equal(pool.state.background, '/assets/course-maps/background.webp');
  pool.state.manager = false;
  assert.equal(
    (await request('/courses/signals/map/background', 'PUT', { backgroundUrl: '' })).status,
    403,
  );
  assert.equal(pool.state.background, '/assets/course-maps/background.webp');
});
