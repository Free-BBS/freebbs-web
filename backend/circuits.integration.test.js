const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const mysql = require('mysql2/promise');
const sharp = require('sharp');
const engine = require('../public/circuit-engine');
const { hashPassword } = require('./password');
const { solveAuthChallenge } = require('./test-helpers/auth');

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => {
    server.close(resolve);
  });
  return port;
}

function draft(title = 'RC 低通滤波') {
  return {
    title,
    description: '学生创建的可引用电路',
    document: {
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', x: 240, y: 160, rotation: 0, params: { resistance: 1000 } },
      ],
      wires: [],
      analysis: { type: 'dc' },
    },
  };
}

test(
  'circuit API preserves ownership and immutable revisions against an isolated full MySQL schema',
  { skip: process.env.RUN_CIRCUITS_INTEGRATION !== '1', timeout: 60000 },
  async (t) => {
    const database = `freebbs_circuits_test_${crypto.randomBytes(6).toString('hex')}`;
    assert.match(database, /^freebbs_circuits_test_[0-9a-f]{12}$/);
    const root = path.resolve(__dirname, '..');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-circuits-'));
    const mysqlOptions = {
      host: process.env.BACKEND_IP || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      multipleStatements: true,
    };
    const db = await mysql.createConnection(mysqlOptions);
    const agentRequests = [];
    let recognitionCircuit = {
      title: '图像识别分压电路',
      description: 'V1=6V，R1=1kΩ，R2=2kΩ',
      document: {
        version: 1,
        components: [
          { id: 'V1', type: 'voltage', x: 200, y: 300, rotation: 90, params: { dc: 6 } },
          {
            id: 'R1',
            type: 'resistor',
            x: 500,
            y: 200,
            rotation: 90,
            params: { resistance: 1000 },
          },
          {
            id: 'R2',
            type: 'resistor',
            x: 500,
            y: 400,
            rotation: 90,
            params: { resistance: 2000 },
          },
          { id: 'G1', type: 'ground', x: 500, y: 540, params: {} },
        ],
        wires: [
          { id: 'w1', from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
          { id: 'w2', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'R2', pin: 0 } },
          { id: 'w3', from: { componentId: 'R2', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
          { id: 'w4', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
        ],
        analysis: { type: 'dc' },
      },
    };
    if (process.env.CIRCUIT_RECOGNITION_RESULT) {
      const recognized = JSON.parse(
        await fs.readFile(process.env.CIRCUIT_RECOGNITION_RESULT, 'utf8'),
      );
      recognitionCircuit = recognized.circuit;
    }
    const agent = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      agentRequests.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (request.url === '/v1/chat/completions') {
        response.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    recognized: true,
                    circuit: recognitionCircuit,
                    warnings: [],
                  }),
                },
              },
            ],
          }),
        );
        return;
      }
      response.end(JSON.stringify({ answer: '已根据保存版本读取电路。' }));
    });
    agent.listen(0, '127.0.0.1');
    await once(agent, 'listening');
    let backend;
    let logs = '';
    t.after(async () => {
      if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await once(backend, 'exit');
      }
      await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await db.end();
      await new Promise((resolve) => {
        agent.close(resolve);
      });
      await fs.rm(temp, { recursive: true, force: true });
    });
    for (const file of ['schema.sql', 'seed.sql']) {
      const source = await fs.readFile(path.join(root, 'database', file), 'utf8');
      await db.query(source.replaceAll('free_bbs', database));
    }
    const port = await reservePort();
    backend = spawn(process.execPath, ['backend/server.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        BACKEND_IP: mysqlOptions.host,
        MYSQL_PORT: String(mysqlOptions.port),
        MYSQL_USER: mysqlOptions.user,
        MYSQL_PASSWORD: mysqlOptions.password,
        MYSQL_DATABASE: database,
        MYSQL_SOCKET: '',
        AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
        SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        LLM_BASE_URL: `http://127.0.0.1:${agent.address().port}/v1`,
        LLM_MODEL: 'test-vision-model',
        CIRCUIT_VISION_MODEL: 'test-recognition-model',
        UPLOAD_DIR: path.join(temp, 'uploads'),
        AGENT_URL: `http://127.0.0.1:${agent.address().port}`,
        AGENT_SERVICE_TOKEN: '',
        AGENT_SETTINGS_REQUIRED: 'false',
        TSINGHUA_CONNECTOR_REQUIRED: 'false',
        TSINGHUA_CONNECTOR_MODE: 'disabled',
        BOTMAIL_SMTP: '',
        BOTMAIL_USER: '',
        BOTMAIL_PASS: '',
        BOTMAIL_FROM: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    backend.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const base = `http://127.0.0.1:${port}/api`;
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if ((await fetch(`${base}/health`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* waiting for isolated backend startup */
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    assert.ok(ready, logs);

    async function api(route, { token, method = 'GET', body, expected = 200 } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (expected !== null)
        assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
      return { status: response.status, ...result };
    }
    async function login(identifier) {
      const challenge = await api('/auth/login-challenge', {
        method: 'POST',
        body: { identifier },
      });
      return api('/auth/login', {
        method: 'POST',
        body: { identifier, password: 'free-bbs', captcha: solveAuthChallenge(challenge) },
      });
    }
    async function createUser(username, studentId) {
      const [inserted] = await db.execute(
        'INSERT INTO users (uid,username,full_name,student_id,email,password_hash,role) VALUES (?,?,?,?,?,?,?)',
        [
          crypto.randomBytes(16).toString('hex'),
          username,
          '仿真测试',
          studentId,
          `${studentId}@example.invalid`,
          hashPassword('free-bbs'),
          'student',
        ],
      );
      return { id: inserted.insertId, ...(await login(username)) };
    }
    const admin = await login('admin');
    const owner = await createUser('circuit_owner', '2026000501');
    const other = await createUser('circuit_other', '2026000502');
    const legacy = await createUser('旧用户名', '2026000503');
    let original;
    let otherCircuit;

    await t.test(
      'ordinary students create unique CIDs; visitors can read but cannot create or list',
      async () => {
        await api('/circuits', { method: 'POST', body: draft(), expected: 401 });
        await api('/circuits?mine=1', { expected: 401 });
        original = (
          await api('/circuits', {
            token: owner.token,
            method: 'POST',
            body: draft(),
            expected: 201,
          })
        ).circuit;
        otherCircuit = (
          await api('/circuits', {
            token: other.token,
            method: 'POST',
            body: draft('另一位同学'),
            expected: 201,
          })
        ).circuit;
        assert.match(original.cid, /^c_[0-9a-f]{24}$/);
        assert.notEqual(original.cid, otherCircuit.cid);
        assert.equal(original.revision, 1);
        assert.equal(original.canEdit, true);
        assert.equal(original.owner.uid, owner.user.uid);
        assert.equal(original.owner.username, 'circuit_owner');
        assert.equal(original.document.components[0].params.resistance, 1000);
        const guest = (await api(`/circuits/${original.cid}`)).circuit;
        assert.equal(guest.canEdit, false);
        assert.deepEqual(guest.document, original.document);
        const list = await api('/circuits?mine=1&limit=1', { token: owner.token });
        assert.equal(list.circuits.length, 1);
        assert.equal(list.circuits[0].cid, original.cid);
        assert.equal(list.hasMore, false);
        assert.equal(Object.hasOwn(list.circuits[0], 'document'), false);
        await api('/circuits', { token: owner.token, expected: 400 });
      },
    );

    await t.test(
      'ownership and current username policy protect every authenticated route',
      async () => {
        const update = { ...draft('外人覆盖'), expectedRevision: 1 };
        await api(`/circuits/${original.cid}`, {
          token: other.token,
          method: 'PUT',
          body: update,
          expected: 403,
        });
        for (const [route, method, body] of [
          ['/circuits', 'POST', draft()],
          ['/circuits?mine=1', 'GET', undefined],
          [`/circuits/${original.cid}`, 'GET', undefined],
          [`/circuits/${original.cid}`, 'PUT', update],
        ]) {
          const blocked = await api(route, { token: legacy.token, method, body, expected: 403 });
          assert.equal(blocked.code, 'username_change_required');
        }
        await db.execute('UPDATE users SET username = ? WHERE id = ?', ['用户名改变', owner.id]);
        const blocked = await api('/circuits?mine=1', { token: owner.token, expected: 403 });
        assert.equal(
          blocked.code,
          'username_change_required',
          'a previously valid token must read current username',
        );
        await db.execute('UPDATE users SET username = ? WHERE id = ?', ['circuit_owner', owner.id]);
        assert.deepEqual(
          (await api(`/circuits/${original.cid}`)).circuit.document,
          original.document,
        );
      },
    );

    await t.test(
      'new revisions retain exact old snapshots and concurrent writers cannot overwrite',
      async () => {
        const first = draft('第二版');
        first.document.components[0].params.resistance = 2200;
        const updated = (
          await api(`/circuits/${original.cid}`, {
            token: owner.token,
            method: 'PUT',
            body: { ...first, expectedRevision: 1 },
          })
        ).circuit;
        assert.equal(updated.revision, 2);
        assert.equal(updated.document.components[0].params.resistance, 2200);
        const pinned = (await api(`/circuits/${original.cid}?revision=1`)).circuit;
        assert.deepEqual(pinned.document, original.document);
        assert.equal(pinned.title, original.title);
        assert.equal(pinned.revision, 1);
        assert.equal(pinned.latestRevision, 2);
        const stale = await api(`/circuits/${original.cid}`, {
          token: owner.token,
          method: 'PUT',
          body: { ...draft('旧稿覆盖'), expectedRevision: 1 },
          expected: 409,
        });
        assert.equal(stale.code, 'revision_conflict');
        const concurrent = await Promise.all(
          ['并发甲', '并发乙'].map((title) =>
            api(`/circuits/${original.cid}`, {
              token: owner.token,
              method: 'PUT',
              body: { ...draft(title), expectedRevision: 2 },
              expected: null,
            }),
          ),
        );
        assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
        const latest = (await api(`/circuits/${original.cid}`)).circuit;
        assert.equal(latest.revision, 3);
        assert.equal(
          latest.title,
          concurrent.find((result) => result.status === 200).circuit.title,
        );
        const [revisions] = await db.execute(
          'SELECT revision FROM circuit_revisions WHERE cid = ? ORDER BY revision',
          [original.cid],
        );
        assert.deepEqual(
          revisions.map((row) => row.revision),
          [1, 2, 3],
        );
      },
    );

    await t.test(
      'direct Max chat and discussion @max send saved circuit versions to the agent',
      async () => {
        const circuitLink = `/circuit?cid=${original.cid}&revision=2&view=schematic`;
        const direct = await api('/ai/chat', {
          token: owner.token,
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: `分析 ${circuitLink}` },
              { role: 'assistant', content: '想了解什么？' },
              { role: 'user', content: '电阻值和连接情况？' },
            ],
          },
        });
        assert.equal(direct.answer, '已根据保存版本读取电路。');
        const directRequest = agentRequests.at(-1);
        assert.equal(directRequest.agent, 'navigation');
        assert.equal(directRequest.context.circuits[0].revision, 2);
        assert.equal(directRequest.context.circuits[0].latestRevision, 3);
        assert.equal(directRequest.context.circuits[0].components[0].params.resistance, 2200);
        assert.match(directRequest.messages.at(-1).content, /"resistance":2200/);

        const { post } = await api('/discussion/posts', {
          token: owner.token,
          method: 'POST',
          expected: 201,
          body: {
            boardSlug: 'circuit',
            title: '请 Max 读电路',
            contentMarkdown: `[第二版电路](${circuitLink})`,
          },
        });
        const preview = { type: 'circuit', cid: original.cid, revision: 2, view: 'schematic' };
        assert.deepEqual(post.preview, preview);
        const { posts } = await api('/discussion/posts?board=circuit');
        const summary = posts.find((item) => item.id === post.id);
        assert.deepEqual(summary.preview, preview);
        assert.equal(Object.hasOwn(summary, 'contentMarkdown'), false);
        const trigger = await api(`/discussion/posts/${post.id}/comments`, {
          token: other.token,
          method: 'POST',
          expected: 201,
          body: { contentMarkdown: '@max 读取正文电路，告诉我元件参数。' },
        });
        assert.equal(trigger.maxPending, true);
        let reply;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const { comments } = await api(`/discussion/posts/${post.id}/comments`);
          reply = comments.find((comment) => comment.author.username === 'max_the_agent');
          if (reply) break;
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        }
        assert.ok(reply, logs);
        assert.equal(reply.parentCommentId, trigger.comment.id);
        assert.equal(reply.contentMarkdown, '已根据保存版本读取电路。');
        const mentionRequest = agentRequests.find((request) => request.agent === 'comment_mention');
        assert.equal(mentionRequest.context.circuits[0].cid, original.cid);
        assert.equal(mentionRequest.context.circuits[0].revision, 2);
        assert.match(mentionRequest.message, /"resistance":2200/);
      },
    );

    await t.test(
      'invalid documents, revision query injection and forged ownership are rejected',
      async () => {
        const invalid = draft();
        invalid.document.components[0].params.resistance = -1;
        await api('/circuits', {
          token: owner.token,
          method: 'POST',
          body: invalid,
          expected: 400,
        });
        await api('/circuits', {
          token: owner.token,
          method: 'POST',
          body: { ...draft(), owner_id: other.id },
          expected: 400,
        });
        await api(`/circuits/${original.cid}`, {
          token: owner.token,
          method: 'PUT',
          body: draft(),
          expected: 400,
        });
        for (const revision of ['0', '-1', '1.5', '1%0A', '1%20OR%201=1', '1&revision=2']) {
          await api(`/circuits/${original.cid}?revision=${revision}`, { expected: 400 });
        }
        await api('/circuits/c_invalid', { expected: 400 });
        await api(`/circuits/${original.cid}?revision=999`, { expected: 404 });
        await api('/circuits/c_ffffffffffffffffffffffff', { expected: 404 });
        await api('/circuits?mine=1&limit=101', { token: owner.token, expected: 400 });
      },
    );

    await t.test('database failures roll back both current circuit and revision rows', async () => {
      const [[before]] = await db.query('SELECT COUNT(*) AS count FROM circuits');
      await db.query(
        "CREATE TRIGGER fail_circuit_create BEFORE INSERT ON circuit_revisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected circuit revision failure'",
      );
      try {
        await api('/circuits', {
          token: owner.token,
          method: 'POST',
          body: draft('事务失败'),
          expected: 500,
        });
      } finally {
        await db.query('DROP TRIGGER fail_circuit_create');
      }
      const [[after]] = await db.query('SELECT COUNT(*) AS count FROM circuits');
      assert.equal(
        after.count,
        before.count,
        'failed initial snapshot must not leave an empty circuit',
      );
      await db.query(
        "CREATE TRIGGER fail_circuit_update AFTER UPDATE ON circuits FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected circuit head failure'",
      );
      try {
        await api(`/circuits/${original.cid}`, {
          token: owner.token,
          method: 'PUT',
          body: { ...draft('事务失败'), expectedRevision: 3 },
          expected: 500,
        });
      } finally {
        await db.query('DROP TRIGGER fail_circuit_update');
      }
      assert.equal((await api(`/circuits/${original.cid}`)).circuit.revision, 3);
      const [[count]] = await db.execute(
        'SELECT COUNT(*) AS count FROM circuit_revisions WHERE cid = ?',
        [original.cid],
      );
      assert.equal(count.count, 3, 'failed head update must remove the newly inserted revision');
    });

    await t.test(
      'admin edits retain ownership; pagination works; account deletion preserves public citations',
      async () => {
        const byAdmin = (
          await api(`/circuits/${original.cid}`, {
            token: admin.token,
            method: 'PUT',
            body: { ...draft('管理员修订'), expectedRevision: 3 },
          })
        ).circuit;
        assert.equal(byAdmin.revision, 4);
        assert.equal(byAdmin.owner.uid, original.owner.uid);
        await api('/circuits', {
          token: owner.token,
          method: 'POST',
          body: draft('第二个电路'),
          expected: 201,
        });
        const page1 = await api('/circuits?mine=1&limit=1', { token: owner.token });
        const page2 = await api('/circuits?mine=1&limit=1&offset=1', { token: owner.token });
        assert.equal(page1.hasMore, true);
        assert.equal(page2.hasMore, false);
        assert.notEqual(page1.circuits[0].cid, page2.circuits[0].cid);
        await api(`/admin/users/${owner.id}`, { token: admin.token, method: 'DELETE' });
        const retained = (await api(`/circuits/${original.cid}?revision=1`)).circuit;
        assert.deepEqual(retained.document, original.document);
        assert.equal(retained.owner.uid, null);
        assert.equal(retained.owner.username, '已注销用户');
        assert.equal(retained.canEdit, false);
        await api('/circuits?mine=1', { token: owner.token, expected: 401 });
        assert.equal(
          (await api(`/circuits/${otherCircuit.cid}`, { token: other.token })).circuit.canEdit,
          true,
        );
      },
    );

    await t.test(
      'image recognition returns an editable circuit that saves and reads back with correct simulation',
      async () => {
        await api('/ai/circuit/recognize', { method: 'POST', body: {}, expected: 401 });
        await api('/admin/system-settings/model', {
          token: admin.token,
          method: 'PATCH',
          body: { apiKey: 'isolated-vision-key' },
        });
        const png = await sharp({
          create: { width: 320, height: 240, channels: 3, background: 'white' },
        })
          .png()
          .toBuffer();
        const [[before]] = await db.query('SELECT COUNT(*) AS count FROM circuits');
        const recognized = await api('/ai/circuit/recognize', {
          token: other.token,
          method: 'POST',
          body: { imageDataUrl: `data:image/png;base64,${png.toString('base64')}` },
        });
        const [[after]] = await db.query('SELECT COUNT(*) AS count FROM circuits');
        assert.equal(
          after.count,
          before.count,
          'recognition does not automatically publish a circuit',
        );
        const modelRequest = agentRequests.at(-1);
        assert.equal(modelRequest.model, 'test-recognition-model');
        assert.match(
          modelRequest.messages[1].content[1].image_url.url,
          /^data:image\/jpeg;base64,/,
        );
        assert.ok(recognized.warnings.length);
        const saved = (
          await api('/circuits', {
            token: other.token,
            method: 'POST',
            body: recognized.circuit,
            expected: 201,
          })
        ).circuit;
        assert.match(saved.cid, /^c_[0-9a-f]{24}$/);
        assert.equal(saved.owner.uid, other.user.uid);
        const read = (await api(`/circuits/${saved.cid}?revision=1`)).circuit;
        assert.deepEqual(read.document, recognized.circuit.document);
        const result = engine.simulate(read.document);
        assert.ok(
          Math.abs(result.traces.find((trace) => trace.id === 'V:R2').values[0] - 4) < 1e-8,
        );
        assert.ok(
          Math.abs(result.traces.find((trace) => trace.id === 'I:R1').values[0] - 0.002) < 1e-8,
        );
      },
    );
  },
);
