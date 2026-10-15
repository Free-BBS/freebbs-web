const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const {
  createCourseClient,
  CourseApiError,
} = require('../docs/course-authoring/tools/课程接口.cjs');
const {
  prepareUpload,
  uploadKnowledgePoint,
} = require('../docs/course-authoring/tools/上传知识点.cjs');
const { downloadCourse } = require('../docs/course-authoring/tools/下载课程.cjs');

const execute = promisify(execFile);

const TOKEN = `fbcu_${'a'.repeat(43)}`;
const REVISION = 'a'.repeat(64);
const NEW_REVISION = 'b'.repeat(64);
const root = path.join(__dirname, '..');

function files(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-author-channel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs
    .readFileSync(path.join(root, 'docs/course-authoring/examples/知识点/SS-01-01.md'), 'utf8')
    .replace(/示例编写者|示例复核者/g, '课程复核人')
    .replace(/尚未经过课程负责人审核/g, '已由课程组本地复核');
  const file = path.join(directory, '完整稿.md');
  fs.writeFileSync(file, source);
  return { directory, file, source };
}

async function site(t, options = {}) {
  const requests = [];
  let node = {
    id: 'SS-01-01',
    title: '现有知识点',
    summary: '现有概览',
    position: { x: 12, y: 34 },
    revision: REVISION,
    sections: {
      basicInfoMarkdown: '现有基本信息',
      applicationsMarkdown: '现有起源',
      knowledgeMarkdown:
        '现有正文\n```freebbs-quiz\n{"privateAnswer":"secret grading fixture"}\n```',
    },
  };
  let absent = Boolean(options.absent);
  let readCount = 0;
  let mapCount = 0;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = body ? JSON.parse(body) : undefined;
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      payload,
    });
    if (options.delay)
      await new Promise((resolve) => {
        setTimeout(resolve, options.delay);
      });
    if (options.largeResponse) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(`{"oversize":"${'x'.repeat(17 * 1024 * 1024)}"}`);
      return;
    }
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (options.status) return send(options.status, { message: TOKEN });
    if (options.redirect) {
      response.writeHead(302, { Location: '/should-not-follow' });
      return response.end();
    }
    if (request.url.endsWith('/map')) {
      mapCount += 1;
      const id = options.badId || node.id;
      return send(200, {
        course: { slug: 'signals' },
        nodes: [{ id, title: options.changedMap && mapCount > 1 ? '已变更' : '知识点' }],
        edges: [],
      });
    }
    if (request.url.endsWith('/nodes/SS-01-01')) {
      if (request.method === 'GET') {
        readCount += 1;
        if (options.readBackFailure && readCount > 1) return send(503, {});
        if (options.readBackMismatch && readCount > 1)
          return send(200, { node: { ...node, title: '其他修改' } });
        if (options.echoToken) return send(200, { token: TOKEN, node });
        if (options.incomplete) return send(200, { node: { id: node.id, revision: REVISION } });
        return absent ? send(404, {}) : send(200, { course: { slug: 'signals' }, node });
      }
      if (options.putFailure) return send(options.putFailure, {});
      if (payload.expectedRevision !== (absent ? 'new' : node.revision)) return send(409, {});
      node = {
        ...node,
        ...payload,
        sections: payload.sections,
        position: { ...node.position, ...payload.position },
        revision: NEW_REVISION,
      };
      absent = false;
      return send(200, { course: { slug: 'signals' }, node });
    }
    return send(404, {});
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { client: createCourseClient({ baseUrl: origin, token: TOKEN }), origin, requests };
}

test('complete real author template is split and validated without writing', async (t) => {
  const { file } = files(t);
  const { client, requests } = await site(t);
  const result = await uploadKnowledgePoint(file, { revision: REVISION }, client);
  assert.equal(result.published, false);
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET'],
  );
  const { patch } = prepareUpload(file, { revision: REVISION });
  assert.match(patch.sections.basicInfoMarkdown, /课程标识：signals/);
  assert.match(patch.sections.applicationsMarkdown, /### 知识起源/);
  assert.match(patch.sections.knowledgeMarkdown, /### 练习与思考/);
  assert.doesNotMatch(patch.sections.knowledgeMarkdown, /## 0\. 基本信息/);
});

test('explicit publish sends one three-section PUT and verifies real author readback', async (t) => {
  const { file } = files(t);
  const { client, requests } = await site(t);
  const result = await uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client);
  assert.equal(result.published, true);
  assert.equal(result.verified, true);
  assert.equal(result.revision, NEW_REVISION);
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET', 'PUT', 'GET'],
  );
  assert.equal(requests[1].payload.expectedRevision, REVISION);
  assert.equal(requests[1].payload.title, '连续时间卷积');
  assert.equal(requests[1].payload.position, undefined);
  assert.deepEqual(Object.keys(requests[1].payload.sections).sort(), [
    'applicationsMarkdown',
    'basicInfoMarkdown',
    'knowledgeMarkdown',
  ]);
  assert.match(requests[1].payload.sections.knowledgeMarkdown, /```freebbs-quiz/);
  assert.ok(requests.every((item) => item.authorization === `Bearer ${TOKEN}`));
  assert.ok(requests.every((item) => !item.url.includes(TOKEN)));
  assert.doesNotMatch(JSON.stringify(result), /secret grading|privateAnswer|fbcu_/);
});

test('stale revision and existing-node creation cannot refresh-and-overwrite', async (t) => {
  const { file } = files(t);
  for (const revision of [NEW_REVISION, 'new']) {
    const { client, requests } = await site(t);
    await assert.rejects(
      uploadKnowledgePoint(file, { revision, x: 0, y: 0, publish: true }, client),
      (error) => error.status === 409,
    );
    assert.deepEqual(
      requests.map((item) => item.method),
      ['GET'],
    );
  }
});

test('new node requires two explicit coordinates and accepts zero', async (t) => {
  const { file } = files(t);
  assert.throws(() => prepareUpload(file, { revision: 'new', x: 0 }), /--x 和 --y/);
  const { client, requests } = await site(t, { absent: true });
  const result = await uploadKnowledgePoint(
    file,
    { revision: 'new', x: 0, y: 0, publish: true },
    client,
  );
  assert.equal(result.verified, true);
  assert.deepEqual(requests[1].payload.position, { x: 0, y: 0 });
  assert.equal(requests[1].payload.expectedRevision, 'new');
});

test('each explicitly changed coordinate is sent without moving its omitted counterpart', async (t) => {
  const { file } = files(t);
  const { client, requests } = await site(t);
  assert.equal(
    (await uploadKnowledgePoint(file, { revision: REVISION, x: 0, publish: true }, client))
      .verified,
    true,
  );
  assert.deepEqual(requests[1].payload.position, { x: 0 });
});

test('placeholders, invalid UTF-8, unreviewed demo and invalid coordinates fail before network', async (t) => {
  const { file, source } = files(t);
  const { client, requests } = await site(t);
  for (const content of [
    source.replace('课程复核人', '{{参与同学}}'),
    source.replace('课程复核人', '示例编写者'),
    Buffer.from([0xff, 0xfe]),
  ]) {
    fs.writeFileSync(file, content);
    await assert.rejects(uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client));
  }
  fs.writeFileSync(file, source);
  for (const x of ['', '-1', '1.5', 10001, 'NaN'])
    assert.throws(() => prepareUpload(file, { revision: REVISION, x }));
  assert.deepEqual(requests, []);
});

test('401 and 403 stop before any write without displaying server error body', async (t) => {
  const { file } = files(t);
  for (const status of [401, 403]) {
    const { client, requests } = await site(t, { status });
    await assert.rejects(
      uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client),
      (error) => error.status === status && !error.message.includes(TOKEN),
    );
    assert.deepEqual(
      requests.map((item) => item.method),
      ['GET'],
    );
  }
});

test('PUT conflict stops without retry or a latest-revision overwrite', async (t) => {
  const { file } = files(t);
  const { client, requests } = await site(t, { putFailure: 409 });
  await assert.rejects(
    uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client),
    (error) => error.status === 409,
  );
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET', 'PUT'],
  );
});

test('ambiguous publish failure requires read-only inspection instead of automatic resend', async (t) => {
  const { file } = files(t);
  const { client, requests } = await site(t, { putFailure: 503 });
  await assert.rejects(
    uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client),
    /可能已经保存.*不要直接重传/,
  );
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET', 'PUT'],
  );
});

test('failed or mismatching readback is explicitly unverified and never retries the PUT', async (t) => {
  const { file } = files(t);
  for (const mode of ['readBackFailure', 'readBackMismatch']) {
    const { client, requests } = await site(t, { [mode]: true });
    const result = await uploadKnowledgePoint(file, { revision: REVISION, publish: true }, client);
    assert.equal(result.published, true);
    assert.equal(result.verified, false);
    assert.match(result.message, /不要直接重传/);
    assert.deepEqual(
      requests.map((item) => item.method),
      ['GET', 'PUT', 'GET'],
    );
  }
});

test('CLI default performs only the same GET and does not print raw grading or credentials', async (t) => {
  const { file } = files(t);
  const { origin, requests } = await site(t);
  const result = await execute(
    process.execPath,
    [path.join(root, 'docs/course-authoring/tools/上传知识点.cjs'), file, '--revision', REVISION],
    { env: { ...process.env, FREEBBS_BASE_URL: origin, FREEBBS_UPLOAD_TOKEN: TOKEN } },
  );
  assert.equal(JSON.parse(result.stdout).published, false);
  assert.doesNotMatch(result.stdout + result.stderr, /fbcu_|secret grading|privateAnswer/);
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET'],
  );
});

test('author-only download keeps raw grading and all three sections without guessing a complete template', async (t) => {
  const { directory } = files(t);
  const { client, requests } = await site(t);
  const output = path.join(directory, '作者快照');
  const result = await downloadCourse('signals', output, client);
  assert.equal(result.complete, true);
  assert.equal(result.nodes, 1);
  assert.deepEqual(
    requests.map((item) => item.method),
    ['GET', 'GET', 'GET'],
  );
  assert.equal(requests[1].url, '/api/course-upload/courses/signals/nodes/SS-01-01');
  const nodeDirectory = path.join(output, '知识点/SS-01-01');
  const raw = JSON.parse(fs.readFileSync(path.join(nodeDirectory, '节点原始.json'), 'utf8'));
  assert.match(raw.node.sections.knowledgeMarkdown, /secret grading fixture/);
  assert.equal(
    fs.readFileSync(path.join(nodeDirectory, '正文.md'), 'utf8'),
    raw.node.sections.knowledgeMarkdown,
  );
  assert.equal(
    fs.readFileSync(path.join(nodeDirectory, '基本信息.md'), 'utf8'),
    raw.node.sections.basicInfoMarkdown,
  );
  assert.equal(
    fs.readFileSync(path.join(nodeDirectory, '背景与应用.md'), 'utf8'),
    raw.node.sections.applicationsMarkdown,
  );
  assert.equal(fs.readFileSync(path.join(nodeDirectory, 'revision.txt'), 'utf8').trim(), REVISION);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, '快照清单.json'), 'utf8'));
  assert.equal(manifest.atomicSnapshot, false);
  assert.equal(manifest.assetsDownloaded, false);
  assert.equal(manifest.nodes[0].sha256.length, 64);
  assert.doesNotMatch(JSON.stringify(result), /privateAnswer|secret grading|fbcu_/);
});

test('download refuses an existing output directory or malformed course before network', async (t) => {
  const { directory } = files(t);
  const { client, requests } = await site(t);
  await assert.rejects(downloadCourse('signals', directory, client), /不会覆盖/);
  await assert.rejects(
    downloadCourse('../signals', path.join(directory, '新目录'), client),
    /slug/,
  );
  assert.deepEqual(requests, []);
});

test('malicious map path and changing map cannot create a misleading snapshot', async (t) => {
  const { directory } = files(t);
  for (const [name, mode] of [
    ['路径', { badId: '../elsewhere' }],
    ['改版', { changedMap: true }],
  ]) {
    const { client, requests } = await site(t, mode);
    const output = path.join(directory, name);
    await assert.rejects(downloadCourse('signals', output, client));
    assert.equal(fs.existsSync(output), false);
    assert.ok(requests.every((request) => request.method === 'GET'));
  }
});

test('permission loss or incomplete node cannot produce a full-author success claim', async (t) => {
  const { directory } = files(t);
  for (const [name, mode] of [
    ['权限', { status: 403 }],
    ['缺分区', { incomplete: true }],
    ['凭据回显', { echoToken: true }],
  ]) {
    const { client } = await site(t, mode);
    const output = path.join(directory, name);
    await assert.rejects(downloadCourse('signals', output, client));
    assert.equal(fs.existsSync(output), false);
  }
});

test('no credential redirect and HTTPS origin policy are applied to both channels', async (t) => {
  const { client, requests } = await site(t, { redirect: true });
  await assert.rejects(
    client.getMap('signals'),
    (error) => error instanceof CourseApiError && error.status === 302,
  );
  assert.equal(requests.length, 1);
  for (const baseUrl of [
    'http://example.test',
    'https://user:pass@example.test',
    'https://example.test/api',
    'https://example.test/?x=1',
  ])
    assert.throws(() => createCourseClient({ baseUrl, token: TOKEN }));
  assert.throws(() => createCourseClient({ baseUrl: 'https://www.free-bbs.cn', token: 'short' }));
});

test('network timeout and bounded response stop instead of retrying requests', async (t) => {
  const oversized = await site(t, { largeResponse: true });
  await assert.rejects(oversized.client.getMap('signals'), /超出限制/);
  assert.equal(oversized.requests.length, 1);
  const delayed = await site(t, { delay: 50 });
  const client = createCourseClient({ baseUrl: delayed.origin, token: TOKEN, timeoutMs: 20 });
  await assert.rejects(client.getMap('signals'), /异常.*回读/);
  // A loaded CI worker may abort before the server accepts the first request.
  assert.ok(delayed.requests.length <= 1);
});
