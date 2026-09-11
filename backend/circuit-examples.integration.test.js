const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const mysql = require('mysql2/promise');
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

function asInput(example) {
  return {
    title: example.title,
    description: example.description,
    document: structuredClone(example.document),
  };
}

test(
  'circuit examples support safe administrator publishing and persistent initial seeds',
  {
    skip: process.env.RUN_CIRCUIT_EXAMPLES_INTEGRATION !== '1',
    timeout: 60000,
  },
  async (t) => {
    const database = `freebbs_examples_test_${crypto.randomBytes(6).toString('hex')}`;
    assert.match(database, /^freebbs_examples_test_[0-9a-f]{12}$/);
    const root = path.resolve(__dirname, '..');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-examples-'));
    const mysqlOptions = {
      host: process.env.BACKEND_IP || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      multipleStatements: true,
    };
    const db = await mysql.createConnection(mysqlOptions);
    let backend;
    let logs = '';
    async function stopBackend() {
      if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await once(backend, 'exit');
      }
    }
    t.after(async () => {
      await stopBackend();
      await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await db.end();
      await fs.rm(temp, { recursive: true, force: true });
    });
    for (const file of ['schema.sql', 'seed.sql']) {
      await db.query(
        (await fs.readFile(path.join(root, 'database', file), 'utf8')).replaceAll(
          'free_bbs',
          database,
        ),
      );
    }
    const port = await reservePort();
    const backendEnv = {
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
      UPLOAD_DIR: path.join(temp, 'uploads'),
      AGENT_SERVICE_TOKEN: '',
      AGENT_SETTINGS_REQUIRED: 'false',
      TSINGHUA_CONNECTOR_REQUIRED: 'false',
      TSINGHUA_CONNECTOR_MODE: 'disabled',
      BOTMAIL_SMTP: '',
      BOTMAIL_USER: '',
      BOTMAIL_PASS: '',
      BOTMAIL_FROM: '',
    };
    const base = `http://127.0.0.1:${port}/api`;
    async function startBackend() {
      backend = spawn(process.execPath, ['backend/server.js'], {
        cwd: root,
        env: backendEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      backend.stdout.on('data', (chunk) => {
        logs += chunk;
      });
      backend.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        try {
          if ((await fetch(`${base}/health`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      assert.ok(ready, logs);
    }
    await startBackend();
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
          '示例测试',
          studentId,
          `${studentId}@example.invalid`,
          hashPassword('free-bbs'),
          'student',
        ],
      );
      return { id: inserted.insertId, ...(await login(username)) };
    }
    const admin = await login('admin');
    const student = await createUser('examples_student', '2026000701');
    const legacy = await createUser('旧用户名', '2026000702');
    let seeds;
    let custom;
    let studentCircuit;

    await t.test(
      'startup seeds three public examples once and only administrators may manage',
      async () => {
        const guest = await api('/circuit-examples');
        assert.equal(guest.canManage, false);
        assert.equal(guest.examples.length, 3);
        assert.ok(guest.examples.every((example) => !Object.hasOwn(example, 'document')));
        assert.equal((await api('/circuit-examples', { token: student.token })).canManage, false);
        assert.equal((await api('/circuit-examples', { token: admin.token })).canManage, true);
        seeds = await Promise.all(
          guest.examples.map(async ({ id }) => (await api(`/circuit-examples/${id}`)).example),
        );
        assert.deepEqual(
          seeds.map((example) => example.title),
          ['电阻分压实验', 'RC 充电响应', '二极管伏安与整流'],
        );
        assert.ok(
          seeds.every(
            (example) => example.revision === 1 && example.document.components.length === 5,
          ),
        );
        for (const [route, method, body] of [
          ['/circuit-examples', 'POST', asInput(seeds[0])],
          [
            `/circuit-examples/${seeds[0].id}`,
            'PUT',
            { ...asInput(seeds[0]), expectedRevision: 1 },
          ],
          [`/circuit-examples/${seeds[0].id}`, 'DELETE', { expectedRevision: 1 }],
        ]) {
          await api(route, { method, body, expected: 401 });
          await api(route, { token: student.token, method, body, expected: 403 });
          const blocked = await api(route, { token: legacy.token, method, body, expected: 403 });
          assert.equal(blocked.code, 'username_change_required');
        }
        await db.execute("UPDATE users SET role = 'student', is_admin = 0 WHERE id = ?", [
          admin.user.id,
        ]);
        assert.equal((await api('/circuit-examples', { token: admin.token })).canManage, false);
        await api('/circuit-examples', {
          token: admin.token,
          method: 'POST',
          body: asInput(seeds[0]),
          expected: 403,
        });
        await db.execute("UPDATE users SET role = 'admin', is_admin = 1 WHERE id = ?", [
          admin.user.id,
        ]);
      },
    );

    await t.test(
      'admin create, validation, update and concurrent revision checks work',
      async () => {
        custom = (
          await api('/circuit-examples', {
            token: admin.token,
            method: 'POST',
            body: { ...asInput(seeds[0]), title: '管理员自定义示例' },
            expected: 201,
          })
        ).example;
        assert.equal(custom.revision, 1);
        assert.ok(Number.isInteger(custom.id));
        const invalid = asInput(custom);
        invalid.document.components[0].params.waveform = 'javascript';
        await api('/circuit-examples', {
          token: admin.token,
          method: 'POST',
          body: invalid,
          expected: 400,
        });
        await api('/circuit-examples', {
          token: admin.token,
          method: 'POST',
          body: { ...asInput(custom), seed_key: 'builtin-divider-v1' },
          expected: 400,
        });
        await api(`/circuit-examples/${custom.id}`, {
          token: admin.token,
          method: 'PUT',
          body: asInput(custom),
          expected: 400,
        });
        for (const id of ['0', '01', '1.2', '1%0A', '1%20OR%201=1'])
          await api(`/circuit-examples/${id}`, { expected: 400 });
        await api('/circuit-examples/4294967295', { expected: 404 });
        custom = (
          await api(`/circuit-examples/${custom.id}`, {
            token: admin.token,
            method: 'PUT',
            body: { ...asInput(custom), title: '更新后的示例', expectedRevision: 1 },
          })
        ).example;
        assert.equal(custom.revision, 2);
        const concurrent = await Promise.all(
          ['并发示例甲', '并发示例乙'].map((title) =>
            api(`/circuit-examples/${custom.id}`, {
              token: admin.token,
              method: 'PUT',
              body: { ...asInput(custom), title, expectedRevision: 2 },
              expected: null,
            }),
          ),
        );
        assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
        custom = (await api(`/circuit-examples/${custom.id}`)).example;
        assert.equal(custom.revision, 3);
        assert.equal(
          custom.title,
          concurrent.find((result) => result.status === 200).example.title,
        );
        const staleDelete = await api(`/circuit-examples/${custom.id}`, {
          token: admin.token,
          method: 'DELETE',
          body: { expectedRevision: 1 },
          expected: 409,
        });
        assert.equal(staleDelete.code, 'revision_conflict');
      },
    );

    await t.test(
      'published student circuits remain independent from example edits and deletion',
      async () => {
        studentCircuit = (
          await api('/circuits', {
            token: student.token,
            method: 'POST',
            body: asInput(seeds[0]),
            expected: 201,
          })
        ).circuit;
        const changed = asInput(seeds[0]);
        changed.title = '管理员改过的初始分压示例';
        changed.document.components[0].params.dc = 10;
        const edited = (
          await api(`/circuit-examples/${seeds[0].id}`, {
            token: admin.token,
            method: 'PUT',
            body: { ...changed, expectedRevision: 1 },
          })
        ).example;
        assert.equal(edited.revision, 2);
        const deleted = await api(`/circuit-examples/${seeds[1].id}`, {
          token: admin.token,
          method: 'DELETE',
          body: { expectedRevision: 1 },
        });
        assert.equal(deleted.ok, true);
        assert.equal(deleted.revision, 2);
        await api(`/circuit-examples/${seeds[1].id}`, { expected: 404 });
        await api(`/circuit-examples/${seeds[1].id}`, {
          token: admin.token,
          method: 'PUT',
          body: { ...asInput(seeds[1]), expectedRevision: 2 },
          expected: 404,
        });
        await api(`/circuit-examples/${seeds[1].id}`, {
          token: admin.token,
          method: 'DELETE',
          body: { expectedRevision: 2 },
          expected: 404,
        });
        const beforeRestart = await api('/circuit-examples');
        await stopBackend();
        await startBackend();
        assert.deepEqual(
          (await api('/circuit-examples')).examples,
          beforeRestart.examples,
          'startup must not overwrite edits or restore deleted seeds',
        );
        assert.equal(
          (await api(`/circuit-examples/${seeds[0].id}`)).example.document.components[0].params.dc,
          10,
        );
        assert.deepEqual(
          (await api(`/circuits/${studentCircuit.cid}`)).circuit.document,
          studentCircuit.document,
        );
        const [[counts]] = await db.query(
          'SELECT COUNT(*) AS total, SUM(is_deleted) AS deleted FROM circuit_examples',
        );
        assert.equal(counts.total, 4);
        assert.equal(Number(counts.deleted), 1);
      },
    );

    await t.test(
      'failed create, update and soft delete all roll back without publishing partial data',
      async () => {
        const [[beforeCount]] = await db.query('SELECT COUNT(*) AS count FROM circuit_examples');
        await db.query(
          "CREATE TRIGGER fail_example_create AFTER INSERT ON circuit_examples FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected example insert failure'",
        );
        try {
          await api('/circuit-examples', {
            token: admin.token,
            method: 'POST',
            body: asInput(custom),
            expected: 500,
          });
        } finally {
          await db.query('DROP TRIGGER fail_example_create');
        }
        const [[afterCount]] = await db.query('SELECT COUNT(*) AS count FROM circuit_examples');
        assert.equal(afterCount.count, beforeCount.count);
        const before = (await api(`/circuit-examples/${custom.id}`)).example;
        await db.query(
          "CREATE TRIGGER fail_example_update AFTER UPDATE ON circuit_examples FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected example update failure'",
        );
        try {
          await api(`/circuit-examples/${custom.id}`, {
            token: admin.token,
            method: 'PUT',
            body: { ...asInput(custom), title: '不应保留', expectedRevision: custom.revision },
            expected: 500,
          });
          await api(`/circuit-examples/${custom.id}`, {
            token: admin.token,
            method: 'DELETE',
            body: { expectedRevision: custom.revision },
            expected: 500,
          });
        } finally {
          await db.query('DROP TRIGGER fail_example_update');
        }
        assert.deepEqual((await api(`/circuit-examples/${custom.id}`)).example, before);
        await api(`/circuit-examples/${custom.id}`, {
          token: admin.token,
          method: 'DELETE',
          body: { expectedRevision: custom.revision },
        });
        await api(`/circuit-examples/${custom.id}`, { expected: 404 });
        await api(`/circuit-examples/${seeds[0].id}`, {
          token: admin.token,
          method: 'DELETE',
          body: { expectedRevision: 2 },
        });
        await api(`/circuit-examples/${seeds[0].id}`, { expected: 404 });
        const remaining = (await api('/circuit-examples')).examples;
        await stopBackend();
        await startBackend();
        assert.deepEqual((await api('/circuit-examples')).examples, remaining);
        assert.deepEqual(
          (await api(`/circuits/${studentCircuit.cid}`)).circuit.document,
          studentCircuit.document,
        );
      },
    );
  },
);
