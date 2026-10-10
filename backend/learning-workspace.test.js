const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createLearningPreview } = require('../scripts/preview-learning-workspace');
const { createMemoryLearningStore } = require('../scripts/fixtures/learning-memory-store');
const {
  createMysqlLearningStore,
  ensureLearningWorkspaceTables,
  validateEntry,
  documentVersion,
  prepareEntryMetadata,
  toEntry,
} = require('./learning-workspace');

async function fixture(t) {
  const preview = createLearningPreview();
  // Unit fixtures stay independent of the preview's authored course document revisions.
  preview.store.context = createMemoryLearningStore().context;
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        preview.server.closeAllConnections();
        preview.server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${preview.server.address().port}/api/learning/signals/SS-01-01/entries`;
  async function call(method, suffix, body, as = 'student') {
    const response = await fetch(`${base}${suffix || ''}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(as ? { Authorization: `Bearer learning-preview-${as}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    return { status: response.status, data, cache: response.headers.get('cache-control') };
  }
  return { ...preview, call };
}
const note = () => ({
  kind: 'note',
  title: '我的理解',
  content: '把输入拆成小脉冲',
  requestKey: crypto.randomUUID(),
});
const contribution = () => ({
  ...note(),
  kind: 'contribution',
  category: 'correction',
  excerpt: '有关叠加的说明',
});

test('all record methods require authentication, including reviewer routes', async (t) => {
  const { call } = await fixture(t);
  for (const [method, suffix] of [
    ['GET', ''],
    ['POST', ''],
    ['PUT', '/1'],
    ['DELETE', '/1'],
    ['PATCH', '/1/review'],
  ]) {
    const result = await call(
      method,
      suffix,
      method === 'GET' || method === 'DELETE' ? undefined : note(),
      '',
    );
    assert.equal(result.status, 401);
    assert.match(result.cache, /private, no-store/);
  }
});
test('private notes persist through API reads and remain private to their author', async (t) => {
  const { call } = await fixture(t);
  assert.equal((await call('POST', '', note())).status, 201);
  assert.equal((await call('GET')).data.entries.length, 1);
  assert.equal((await call('GET', '?user_id=1', undefined, 'other')).data.entries.length, 0);
  assert.equal((await call('GET', '', undefined, 'manager')).data.entries.length, 0);
});
test('reflection saves subjective feeling without changing stars or course progress', async (t) => {
  const { call } = await fixture(t);
  const result = await call('POST', '', {
    kind: 'reflection',
    content: '公式中的平移还没懂',
    feeling: 'stuck',
    requestKey: crypto.randomUUID(),
    stars: 3,
    user_id: 2,
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.entry.feeling, 'stuck');
  assert.equal(result.data.entry.stars, undefined);
  assert.equal((await call('GET', '', undefined, 'other')).data.entries.length, 0);
});
test('same request key is idempotent and changed payload is rejected', async (t) => {
  const { call } = await fixture(t);
  const body = note();
  const results = await Promise.all([call('POST', '', body), call('POST', '', body)]);
  assert.equal(results[0].data.entry.id, results[1].data.entry.id);
  assert.equal((await call('GET')).data.entries.length, 1);
  assert.equal((await call('POST', '', { ...body, content: '不同的内容' })).status, 409);
});
test('notes use optimistic revisions and block cross-account edits/deletes', async (t) => {
  const { call } = await fixture(t);
  const { id } = (await call('POST', '', note())).data.entry;
  const update = { ...note(), content: '修改后的理解', revision: 1 };
  assert.equal((await call('PUT', `/${id}`, update, 'other')).status, 409);
  assert.equal((await call('DELETE', `/${id}`, undefined, 'manager')).status, 404);
  const results = await Promise.all([call('PUT', `/${id}`, update), call('PUT', `/${id}`, update)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await call('GET')).data.entries[0].revision, 2);
  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal((await call('GET')).data.entries.length, 0);
});
test('contributions enter course-only review, never the public discussion', async (t) => {
  const { call } = await fixture(t);
  await call('POST', '', note());
  await call('POST', '', {
    kind: 'reflection',
    content: '私有复盘',
    feeling: 'getting',
    requestKey: crypto.randomUUID(),
  });
  const result = await call('POST', '', { ...contribution(), status: 'handled', reviewed_by: 3 });
  assert.equal(result.data.entry.status, 'pending');
  assert.equal((await call('GET', '?review=pending', undefined, 'other')).status, 403);
  const inbox = await call('GET', '?review=pending', undefined, 'manager');
  assert.equal(inbox.data.entries.length, 1);
  assert.equal(inbox.data.entries[0].kind, 'contribution');
  const id = result.data.entry.id;
  assert.equal(
    (
      await call(
        'PATCH',
        `/${id}/review`,
        { status: 'handled', response: '谢谢，已核对。' },
        'other',
      )
    ).status,
    403,
  );
  assert.equal(
    (await call('PATCH', `/${id}/review`, { status: 'handled', response: '' }, 'manager')).status,
    400,
  );
  assert.equal(
    (
      await call(
        'PATCH',
        `/${id}/review`,
        { status: 'handled', response: '谢谢，已核对；正文另行修订。' },
        'manager',
      )
    ).status,
    200,
  );
  assert.equal((await call('GET')).data.entries[0].response, '谢谢，已核对；正文另行修订。');
  assert.equal(
    (await call('PATCH', `/${id}/review`, { status: 'declined', response: '重复处理' }, 'manager'))
      .status,
    409,
  );
  assert.equal((await call('DELETE', `/${id}`)).status, 404);
});
test('review cannot be used to expose or change notes', async (t) => {
  const { call } = await fixture(t);
  const { id } = (await call('POST', '', note())).data.entry;
  assert.equal(
    (
      await call(
        'PATCH',
        `/${id}/review`,
        { status: 'handled', response: '试图访问笔记' },
        'manager',
      )
    ).status,
    409,
  );
  assert.equal((await call('GET')).data.entries[0].status, 'private');
});
test('record pagination is bounded and deterministic without duplicate rows', async (t) => {
  const { call, store } = await fixture(t);
  for (let i = 0; i < 56; i += 1)
    await store.create(
      { id: 1 },
      { course_id: 1, node_id: 'SS-01-01' },
      validateEntry(note()),
      crypto.randomUUID(),
    );
  const first = (await call('GET')).data;
  const second = (await call('GET', `?before=${first.nextCursor}`)).data;
  assert.equal(first.entries.length, 50);
  assert.equal(second.entries.length, 6);
  assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size, 56);
  assert.equal(second.nextCursor, null);
});
test('invalid entry types, sizes, revision, paging and review selectors fail closed', async (t) => {
  const { call } = await fixture(t);
  for (const body of [
    { ...note(), content: ' ' },
    { ...note(), title: 'a'.repeat(121) },
    { ...note(), content: 'a'.repeat(8001) },
    { ...note(), kind: 'resource' },
    { ...contribution(), category: 'upload' },
    { ...note(), requestKey: 'x' },
    { ...note(), content: {} },
    { ...note(), kind: 'reflection', feeling: 'poor' },
  ])
    assert.equal((await call('POST', '', body)).status, 400);
  assert.equal((await call('GET', '?before=abc')).status, 400);
  assert.equal((await call('GET', '?review=all')).status, 400);
  assert.equal((await call('PUT', '/1', { ...note(), revision: '1' })).status, 400);
});
test('course/node context and manager permission do not cross course boundaries', async (t) => {
  const { server } = await fixture(t);
  const base = `http://127.0.0.1:${server.address().port}/api/learning`;
  const headers = { Authorization: 'Bearer learning-preview-manager' };
  assert.equal((await fetch(`${base}/missing/SS-01-01/entries`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/signals/invalid/entries`, { headers })).status, 400);
  assert.equal(
    (await fetch(`${base}/circuits/SS-01-01/entries?review=pending`, { headers })).status,
    403,
  );
});
test('MySQL store binds all values and scopes every operation', async () => {
  const calls = [];
  const pool = {
    execute: async (sql, params) => {
      assert.equal((sql.match(/\?/g) || []).length, params.length);
      calls.push({ sql, params });
      return /SELECT/.test(sql)
        ? [[{ id: 10, kind: 'note', revision: 3 }], []]
        : [{ affectedRows: 0 }, []];
    },
  };
  const store = createMysqlLearningStore(pool);
  const user = { id: 12 };
  const context = { course_id: 4, node_id: 'SS-01-01' };
  await store.list(user, context, '20', false);
  assert.match(calls.at(-1).sql, /user_id = \?/);
  assert.deepEqual(calls.at(-1).params, [4, 'SS-01-01', 12, '20']);
  await store.list(user, context, '', true);
  assert.match(calls.at(-1).sql, /kind = 'contribution' AND status = 'pending'/);
  await store.update(user, context, '10', validateEntry(note()), 3);
  assert.match(
    calls.at(-1).sql,
    /user_id = \?.*course_id = \?.*node_id = \?.*kind = \?.*kind IN \('note', 'path'\).*revision = \?/,
  );
  await store.remove(user, context, '10');
  assert.match(calls.at(-1).sql, /user_id = \?.*kind IN \('note', 'reflection', 'path'\)/);
  await store.review(user, context, '10', 'handled', '谢谢');
  assert.match(
    calls.at(-1).sql,
    /course_id = \?.*node_id = \?.*kind = 'contribution' AND status = 'pending'/,
  );
});
test('additive migration uses signed foreign keys matching existing users/courses', async () => {
  const statements = [];
  await ensureLearningWorkspaceTables({
    execute: async (value) => {
      statements.push(value);
      return [[{ Field: 'metadata_json' }]];
    },
  });
  const sql = statements[0];
  assert.match(sql, /^CREATE TABLE IF NOT EXISTS learning_entries/);
  assert.match(sql, /user_id BIGINT NOT NULL/);
  assert.match(sql, /course_id BIGINT NOT NULL/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM|INSERT INTO/i);
  assert.match(sql, /metadata_json JSON NULL/);
  assert.equal(statements[1], "SHOW COLUMNS FROM learning_entries LIKE 'metadata_json'");
});

test('MySQL creation keeps a server-side document fingerprint and safely replays duplicate requests', async () => {
  let row;
  const pool = {
    execute: async (sql, params) => {
      assert.equal((sql.match(/\?/g) || []).length, params.length);
      if (sql.startsWith('INSERT')) {
        if (row) {
          const error = new Error('duplicate');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        const [
          userId,
          courseId,
          nodeId,
          kind,
          title,
          content,
          feeling,
          category,
          excerpt,
          status,
          version,
          key,
          metadata,
        ] = params;
        row = {
          id: 18,
          user_id: userId,
          course_id: courseId,
          node_id: nodeId,
          kind,
          title,
          content,
          feeling,
          category,
          excerpt,
          status,
          document_version: version,
          request_key: key,
          metadata_json: metadata,
          review_response: null,
          revision: 1,
          updated_at: '2026-09-12T00:00:00Z',
        };
        return [{ insertId: 18 }];
      }
      assert.match(sql, /WHERE user_id = \? AND request_key = \?/);
      assert.deepEqual(params, [1, row.request_key]);
      return [[row]];
    },
  };
  const store = createMysqlLearningStore(pool);
  const context = { course_id: 2, node_id: 'SS-01-01', document_markdown: '正式课程正文' };
  const data = note();
  const entry = validateEntry(data);
  const first = await store.create({ id: 1 }, context, entry, data.requestKey);
  const second = await store.create({ id: 1 }, context, entry, data.requestKey);
  assert.equal(first.id, second.id);
  assert.equal(
    first.documentVersion,
    crypto.createHash('sha256').update('正式课程正文').digest('hex'),
  );
  assert.equal(first.user_id, undefined);
  await assert.rejects(
    store.create({ id: 1 }, context, { ...entry, content: '被替换的内容' }, data.requestKey),
    { status: 409 },
  );
});

const anchor = (context = { node_id: 'SS-01-01', document_markdown: '学习预览正文' }) => ({
  nodeId: context.node_id,
  documentVersion: documentVersion(context),
  blockAnchor: 'b-12345678-1',
  range: { start: 0, end: 1 },
  quote: '学',
  prefix: '',
  suffix: '习预览正文',
  wholeBlock: false,
  blockType: 'text',
});
const annotatedNote = () => ({
  ...note(),
  annotation: { style: 'highlight', color: 'purple', anchor: anchor() },
});
const resource = () => ({
  ...contribution(),
  category: 'resource',
  resource: {
    resourceLevel: 'knowledge',
    coverage: '连续时间信号',
    sourceUrl: 'https://example.org/course',
    permission: { source: '课程开放网页', license: '仅提交原链接，按来源页面授权使用' },
  },
});
const learningPath = () => ({
  kind: 'path',
  title: '我的下一步',
  requestKey: crypto.randomUUID(),
  path: [{ id: 'step-1', tool: 'content', title: '回看卷积', minutes: 12, completed: false }],
});

test('private saved paths round-trip concrete origin, quiz and cross-point question anchors', async (t) => {
  const { call } = await fixture(t);
  const body = learningPath();
  body.path = [
    {
      id: 'origin',
      tool: 'content',
      title: '读起源',
      minutes: 5,
      completed: false,
      view: 'origin',
    },
    {
      id: 'quiz',
      tool: 'feedback',
      title: '探索题',
      minutes: 8,
      completed: false,
      point: 'SS-01-02',
      quizView: 'practice',
      questionId: 'SS-01-02-Q01',
      taskId: 'explore:one',
    },
  ];
  const saved = await call('POST', '', body);
  assert.equal(saved.status, 201);
  const restored = (await call('GET', '?kind=path')).data.entries[0];
  assert.equal(restored.path[0].view, 'origin');
  assert.equal(restored.path[1].quizView, 'practice');
  assert.equal(restored.path[1].questionId, 'SS-01-02-Q01');
  assert.equal(restored.path[1].taskId, 'explore:one');
  assert.equal((await call('GET', '?kind=path', undefined, 'other')).data.entries.length, 0);
  assert.throws(
    // eslint-disable-next-line no-script-url -- Deliberately invalid input verifies the rejection boundary.
    () => validateEntry({ ...body, path: [{ ...body.path[0], view: 'javascript:alert(1)' }] }),
    { status: 400 },
  );
  assert.throws(() => validateEntry({ ...body, path: [{ ...body.path[0], quizView: 'quick' }] }), {
    status: 400,
  });
});

test('one-character private annotations preserve precise whitespace context and reject forged versions', async (t) => {
  const { call } = await fixture(t);
  const input = annotatedNote();
  input.annotation.anchor.prefix = '  ';
  const result = await call('POST', '', { ...input, documentVersion: 'forged-client-value' });
  assert.equal(result.status, 201);
  assert.equal(result.data.entry.annotation.anchor.quote, '学');
  assert.equal(result.data.entry.annotation.anchor.prefix, '  ');
  assert.equal(result.data.entry.documentVersion, anchor().documentVersion);
  assert.equal((await call('GET', '', undefined, 'manager')).data.entries.length, 0);
  assert.equal((await call('GET', '?review=pending', undefined, 'manager')).data.entries.length, 0);
  assert.equal((await call('GET', '', undefined, 'other')).data.entries.length, 0);
  const fake = annotatedNote();
  fake.annotation.anchor.documentVersion = 'f'.repeat(64);
  assert.equal((await call('POST', '', fake)).status, 409);
  const wrongNode = annotatedNote();
  wrongNode.annotation.anchor.nodeId = 'SS-01-02';
  assert.equal((await call('POST', '', wrongNode)).status, 400);
  const emptyRange = annotatedNote();
  emptyRange.annotation.anchor.range.end = 0;
  assert.equal((await call('POST', '', emptyRange)).status, 400);
});

test('annotation input rejects unsupported styles, invalid offsets and partial atomic blocks', () => {
  for (const change of [
    (value) => {
      value.annotation.style = 'script';
    },
    (value) => {
      value.annotation.color = 'red';
    },
    (value) => {
      value.annotation.anchor.range.end = 2;
    },
    (value) => {
      value.annotation.anchor.blockType = 'table';
    },
    (value) => {
      value.annotation.anchor.blockAnchor = '<script>';
    },
  ]) {
    const value = annotatedNote();
    change(value);
    assert.throws(() => validateEntry(value), { status: 400 });
  }
  const table = annotatedNote();
  table.annotation.anchor.blockType = 'table';
  table.annotation.anchor.wholeBlock = true;
  assert.equal(validateEntry(table).annotation.anchor.blockType, 'table');
});

test('body updates retain old annotations and only permit an existing unchanged historical anchor', () => {
  const entry = validateEntry(annotatedNote());
  const changed = { node_id: 'SS-01-01', document_markdown: '新版本正文' };
  const previous = { annotation: structuredClone(entry.annotation) };
  assert.throws(() => prepareEntryMetadata(entry, changed), { status: 409 });
  assert.deepEqual(prepareEntryMetadata(entry, changed, previous).annotation, previous.annotation);
  assert.deepEqual(
    prepareEntryMetadata(validateEntry(note()), changed, previous).annotation,
    previous.annotation,
  );
  const reordered = {
    annotation: {
      ...previous.annotation,
      anchor: Object.fromEntries(Object.entries(previous.annotation.anchor).reverse()),
    },
  };
  assert.deepEqual(prepareEntryMetadata(entry, changed, reordered).annotation, entry.annotation);
  const forged = structuredClone(entry);
  forged.annotation.anchor.quote = '改';
  assert.throws(() => prepareEntryMetadata(forged, changed, previous), { status: 409 });
});

test('MySQL JSON key normalization does not break metadata request replay', async () => {
  const input = annotatedNote();
  const entry = validateEntry(input);
  const context = { course_id: 1, node_id: 'SS-01-01', document_markdown: '学习预览正文' };
  const reordered = (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, nested]) => [key, reordered(nested)]),
        )
      : value;
  let row;
  const pool = {
    execute: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        if (row) {
          const error = new Error('duplicate');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        const names = [
          'user_id',
          'course_id',
          'node_id',
          'kind',
          'title',
          'content',
          'feeling',
          'category',
          'excerpt',
          'status',
          'document_version',
          'request_key',
          'metadata_json',
        ];
        row = {
          id: 7,
          revision: 1,
          ...Object.fromEntries(names.map((name, index) => [name, params[index]])),
        };
        row.metadata_json = JSON.stringify(reordered(JSON.parse(row.metadata_json)));
        return [{ insertId: 7 }];
      }
      return [[row]];
    },
  };
  const store = createMysqlLearningStore(pool);
  assert.equal((await store.create({ id: 1 }, context, entry, input.requestKey)).id, '7');
  assert.equal((await store.create({ id: 1 }, context, entry, input.requestKey)).id, '7');
  assert.equal(row.document_version, documentVersion(context));
});

test('resource links and required authorization metadata enter pending review only', async (t) => {
  const { call } = await fixture(t);
  const result = await call('POST', '', resource());
  assert.equal(result.status, 201);
  assert.equal(result.data.entry.status, 'pending');
  assert.equal(result.data.entry.resource.resourceLevel, 'knowledge');
  assert.equal(result.data.entry.resource.permission.source, '课程开放网页');
  assert.equal((await call('GET', '', undefined, 'other')).data.entries.length, 0);
  assert.equal(
    (await call('GET', '?review=pending', undefined, 'manager')).data.entries[0].category,
    'resource',
  );
  for (const sourceUrl of [
    ['java', 'script:alert(1)'].join(''),
    'file:///etc/passwd',
    'ftp://example.org/x',
    'https://user:secret@example.org/x',
  ]) {
    const bad = resource();
    bad.resource.sourceUrl = sourceUrl;
    assert.equal((await call('POST', '', bad)).status, 400);
  }
  for (const property of ['source', 'license']) {
    const bad = resource();
    delete bad.resource.permission[property];
    assert.equal((await call('POST', '', bad)).status, 400);
  }
  const correction = { ...contribution(), anchor: anchor() };
  assert.equal((await call('POST', '', correction)).data.entry.anchor.quote, '学');
  for (const scope of ['content', 'structure', 'relation', 'presentation']) {
    const suggestion = await call('POST', '', {
      ...contribution(),
      category: 'improvement',
      scope,
    });
    assert.equal(suggestion.data.entry.scope, scope);
  }
  assert.equal(
    (await call('POST', '', { ...contribution(), category: 'improvement', scope: 'all' })).status,
    400,
  );
});

test('saved learning paths use private revision-aware CRUD without exposing reviewer records', async (t) => {
  const { call } = await fixture(t);
  const first = await call('POST', '', learningPath());
  assert.equal(first.status, 201);
  assert.equal(first.data.entry.status, 'private');
  const input = { ...learningPath(), revision: 1 };
  input.path[0].completed = true;
  assert.equal((await call('PUT', `/${first.data.entry.id}`, input, 'other')).status, 409);
  assert.equal((await call('PUT', `/${first.data.entry.id}`, input)).status, 200);
  const record = (await call('GET')).data.entries[0];
  assert.equal(record.path[0].completed, true);
  assert.equal(record.revision, 2);
  assert.equal((await call('GET', '?review=pending', undefined, 'manager')).data.entries.length, 0);
  assert.equal((await call('DELETE', `/${record.id}`)).status, 200);
});

test('explicitly saving a path acknowledges the server document version while note anchors retain their history', async (t) => {
  const { call, store } = await fixture(t);
  const path = (await call('POST', '', learningPath())).data.entry;
  const originalNote = (await call('POST', '', annotatedNote())).data.entry;
  const previousVersion = path.documentVersion;
  const previousContext = store.context;
  store.context = async (...args) => {
    const context = await previousContext(...args);
    return context && { ...context, document_markdown: '已修订的课程正文' };
  };
  assert.equal((await call('GET', '?kind=path')).data.entries[0].documentVersion, previousVersion);
  assert.equal(
    (
      await call('PUT', `/${path.id}`, {
        ...learningPath(),
        revision: path.revision,
        documentVersion: 'client-forged-version',
      })
    ).status,
    200,
  );
  const savedPath = (await call('GET', '?kind=path')).data.entries[0];
  assert.equal(
    savedPath.documentVersion,
    documentVersion({ document_markdown: '已修订的课程正文' }),
  );
  assert.notEqual(savedPath.documentVersion, previousVersion);
  assert.equal(savedPath.revision, 2);
  assert.equal(
    (await call('PUT', `/${originalNote.id}`, { ...note(), revision: originalNote.revision }))
      .status,
    200,
  );
  const savedNote = (await call('GET', '?kind=note')).data.entries[0];
  assert.equal(savedNote.documentVersion, previousVersion);
  assert.deepEqual(savedNote.annotation, originalNote.annotation);
});

test('MySQL path revisions stamp only the server version and retain scoped optimistic writes', async () => {
  const calls = [];
  const store = createMysqlLearningStore({
    execute: async (sql, params) => {
      assert.equal((sql.match(/\?/g) || []).length, params.length);
      calls.push({ sql, params });
      return sql.startsWith('SELECT')
        ? [[{ id: 18, kind: 'path', revision: 2, document_version: 'old-version' }]]
        : [{ affectedRows: 1 }];
    },
  });
  const context = { course_id: 1, node_id: 'SS-01-01', document_markdown: '修订后正文' };
  assert.equal(
    await store.update({ id: 7 }, context, '18', validateEntry(learningPath()), 2),
    true,
  );
  assert.match(
    calls.at(-1).sql,
    /document_version = CASE WHEN kind = 'path' THEN \? ELSE document_version END/,
  );
  assert.deepEqual(calls.at(-1).params.slice(3), [
    documentVersion(context),
    '18',
    7,
    1,
    'SS-01-01',
    'path',
    2,
  ]);
});

test('learning path validation bounds steps, supported tools, IDs, minutes and title length', () => {
  for (const mutate of [
    (value) => {
      value.path = [];
    },
    (value) => {
      value.path = Array.from({ length: 21 }, (_, i) => ({ ...value.path[0], id: `step-${i}` }));
    },
    (value) => {
      value.path[0].minutes = 0;
    },
    (value) => {
      value.path[0].minutes = 241;
    },
    (value) => {
      value.path[0].minutes = 1.5;
    },
    (value) => {
      value.path[0].completed = 'true';
    },
    (value) => {
      value.path[0].title = 'a'.repeat(121);
    },
    (value) => {
      value.path.push({ ...value.path[0] });
    },
    (value) => {
      value.path[0].tool = 'admin';
    },
    (value) => {
      value.path[0].point = 'invalid';
    },
    (value) => {
      value.path[0].description = 'a'.repeat(601);
    },
  ]) {
    const value = learningPath();
    mutate(value);
    assert.throws(() => validateEntry(value), { status: 400 });
  }
  const discussion = learningPath();
  discussion.path[0].tool = 'discussion';
  assert.equal(validateEntry(discussion).path[0].tool, 'discussion');
  discussion.path[0].point = 'SS-01-02';
  discussion.path[0].description = '从当前卡点回看前置知识';
  assert.equal(validateEntry(discussion).path[0].point, 'SS-01-02');
  assert.equal(validateEntry(discussion).path[0].description, discussion.path[0].description);
});

test('private path skip choices survive save and reload without implying completion', async (t) => {
  const { call } = await fixture(t);
  const input = learningPath();
  input.path[0].skipped = true;
  const saved = (await call('POST', '', input)).data.entry;
  assert.equal(saved.path[0].skipped, true);
  assert.equal(saved.path[0].completed, false);
  assert.equal((await call('GET', '?kind=path')).data.entries[0].path[0].skipped, true);
  input.path[0].skipped = false;
  input.path[0].completed = true;
  assert.equal((await call('PUT', `/${saved.id}`, { ...input, revision: 1 })).status, 200);
  const resumed = (await call('GET', '?kind=path')).data.entries[0];
  assert.equal(resumed.path[0].skipped, false);
  assert.equal(resumed.path[0].completed, true);
  assert.equal(validateEntry(learningPath()).path[0].skipped, false);
  for (const skipped of [null, 'true', 1, {}]) {
    const invalid = learningPath();
    invalid.path[0].skipped = skipped;
    assert.throws(() => validateEntry(invalid), { status: 400 });
  }
  const contradictory = learningPath();
  Object.assign(contradictory.path[0], { skipped: true, completed: true });
  assert.throws(() => validateEntry(contradictory), { status: 400 });
});

test('learning path targets are checked against the authenticated course context', async (t) => {
  const { call } = await fixture(t);
  const input = learningPath();
  input.path[0].point = 'SS-01-02';
  assert.equal((await call('POST', '', input)).status, 201);
  const unknown = learningPath();
  unknown.path[0].point = 'XX-99-99';
  assert.equal((await call('POST', '', unknown)).status, 400);
  const calls = [];
  const store = createMysqlLearningStore({
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    },
  });
  await assert.rejects(
    store.create(
      { id: 1 },
      { course_id: 2, node_id: 'SS-01-01' },
      validateEntry(unknown),
      unknown.requestKey,
    ),
    { status: 400 },
  );
  assert.match(calls[0].sql, /course_id = \? AND node_id IN \(\?\)/);
  assert.deepEqual(calls[0].params, [2, 'XX-99-99']);
});

test('kind filtering finds a saved private path after more than fifty newer notes', async (t) => {
  const { call, store } = await fixture(t);
  const context = await store.context('signals', 'SS-01-01');
  const saved = (await call('POST', '', learningPath())).data.entry;
  for (let index = 0; index < 56; index += 1)
    await store.create({ id: 1 }, context, validateEntry(note()), crypto.randomUUID());
  assert.equal(
    (await call('GET')).data.entries.some((entry) => entry.kind === 'path'),
    false,
  );
  const filtered = (await call('GET', '?kind=path')).data;
  assert.deepEqual(
    filtered.entries.map((entry) => entry.id),
    [saved.id],
  );
  assert.equal(filtered.nextCursor, null);
  assert.equal((await call('GET', '?kind=path', undefined, 'other')).data.entries.length, 0);
  assert.equal((await call('GET', '?kind=path', undefined, 'manager')).data.entries.length, 0);
  const notes = (await call('GET', '?kind=note')).data;
  assert.equal(notes.entries.length, 50);
  assert.equal(
    notes.entries.every((entry) => entry.kind === 'note'),
    true,
  );
  assert.equal((await call('GET', `?kind=note&before=${notes.nextCursor}`)).data.entries.length, 6);
});

test('kind selectors reject malformed and conflicting review scopes while retaining old calls', async (t) => {
  const { call } = await fixture(t);
  for (const query of [
    '?kind=all',
    '?kind=',
    '?kind=note&kind=path',
    '?review=pending&kind=path',
    '?review=pending&kind=note',
  ])
    assert.equal((await call('GET', query, undefined, 'manager')).status, 400);
  const saved = (await call('POST', '', contribution())).data.entry;
  const pending = await call('GET', '?review=pending&kind=contribution', undefined, 'manager');
  assert.equal(pending.status, 200);
  assert.equal(pending.data.entries[0].id, saved.id);
  assert.equal(
    (await call('GET', '?kind=contribution', undefined, 'other')).data.entries.length,
    0,
  );
  const calls = [];
  const store = createMysqlLearningStore({
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    },
  });
  await store.list({ id: 1 }, { course_id: 2, node_id: 'SS-01-01' }, '40', false, 'path');
  assert.match(calls[0].sql, /user_id = \?.*AND kind = \?.*AND id < \?/);
  assert.deepEqual(calls[0].params, [2, 'SS-01-01', 1, 'path', '40']);
  await store.list({ id: 1 }, { course_id: 2, node_id: 'SS-01-01' }, '', false);
  assert.deepEqual(calls[1].params, [2, 'SS-01-01', 1]);
});

test('annotation-only paging finds older overlays without private ordinary notes displacing them', async (t) => {
  const { call, store } = await fixture(t);
  const context = await store.context('signals', 'SS-01-01');
  const saved = (await call('POST', '', annotatedNote())).data.entry;
  for (let index = 0; index < 56; index += 1)
    await store.create({ id: 1 }, context, validateEntry(note()), crypto.randomUUID());
  assert.equal(
    (await call('GET')).data.entries.some((entry) => entry.id === saved.id),
    false,
  );
  const original = (await call('GET', '?kind=note&annotations=1')).data;
  assert.deepEqual(
    original.entries.map((entry) => entry.id),
    [saved.id],
  );
  assert.equal(original.nextCursor, null);
  assert.equal(
    (await call('GET', '?kind=note&annotations=1', undefined, 'other')).data.entries.length,
    0,
  );
  assert.equal(
    (await call('GET', '?kind=note&annotations=1', undefined, 'manager')).data.entries.length,
    0,
  );
  for (let index = 0; index < 56; index += 1)
    await store.create({ id: 1 }, context, validateEntry(annotatedNote()), crypto.randomUUID());
  await store.create({ id: 2 }, context, validateEntry(annotatedNote()), crypto.randomUUID());
  await store.create(
    { id: 1 },
    { ...context, course_id: 2 },
    validateEntry(annotatedNote()),
    crypto.randomUUID(),
  );
  const first = (await call('GET', '?kind=note&annotations=1')).data;
  const second = (await call('GET', `?kind=note&annotations=1&before=${first.nextCursor}`)).data;
  assert.equal(first.entries.length, 50);
  assert.equal(second.entries.length, 7);
  assert.equal(second.nextCursor, null);
  const records = [...first.entries, ...second.entries];
  assert.equal(new Set(records.map((entry) => entry.id)).size, 57);
  assert.equal(records.at(-1).id, saved.id);
  assert.ok(
    records.every(
      (entry) => entry.kind === 'note' && entry.status === 'private' && entry.annotation,
    ),
  );
});

test('annotation filters are strict and MySQL retains the current private owner scope', async (t) => {
  const { call } = await fixture(t);
  for (const query of [
    '?annotations=1',
    '?kind=path&annotations=1',
    '?kind=reflection&annotations=1',
    '?kind=note&annotations=',
    '?kind=note&annotations=0',
    '?kind=note&annotations=true',
    '?kind=note&annotations=1&annotations=1',
    '?kind=note&annotations=1&review=pending',
  ])
    assert.equal((await call('GET', query, undefined, 'manager')).status, 400);
  const calls = [];
  const store = createMysqlLearningStore({
    execute: async (sql, params) => {
      assert.equal((sql.match(/\?/g) || []).length, params.length);
      calls.push({ sql, params });
      return [[]];
    },
  });
  await store.list({ id: 7 }, { course_id: 3, node_id: 'SS-01-01' }, '48', false, 'note', true);
  assert.match(
    calls[0].sql,
    /user_id = \?.*AND kind = \?.*JSON_EXTRACT\(metadata_json, '\$\.annotation'\) IS NOT NULL.*AND id < \?/,
  );
  assert.match(
    calls[0].sql,
    /JSON_TYPE\(JSON_EXTRACT\(metadata_json, '\$\.annotation'\)\) = 'OBJECT'/,
  );
  assert.deepEqual(calls[0].params, [3, 'SS-01-01', 7, 'note', '48']);
  await store.list({ id: 7 }, { course_id: 3, node_id: 'SS-01-01' }, '', false, 'note');
  assert.doesNotMatch(calls[1].sql, /JSON_EXTRACT/);
});

test('existing learning tables receive only the missing metadata column and tolerate a migration race', async () => {
  const statements = [];
  const pool = {
    execute: async (sql) => {
      statements.push(sql);
      if (sql.startsWith('SHOW')) return [[]];
      if (sql.startsWith('ALTER')) {
        const error = new Error('already added');
        error.code = 'ER_DUP_FIELDNAME';
        throw error;
      }
      return [{}];
    },
  };
  await ensureLearningWorkspaceTables(pool);
  assert.equal(
    statements.at(-1),
    'ALTER TABLE learning_entries ADD COLUMN metadata_json JSON NULL',
  );
  assert.equal(toEntry({ id: 1, revision: 1, metadata_json: '{invalid' }).annotation, undefined);
  assert.equal(
    toEntry({ id: 2, revision: 1, metadata_json: { annotation: { style: 'underline' } } })
      .annotation.style,
    'underline',
  );
});
