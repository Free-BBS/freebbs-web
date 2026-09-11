const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const filePath = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const mysql = require('mysql2/promise');
const {
  validateSurvey,
  validateAnswers,
  chooseWinners,
  ensureSurveyTables,
  createSurveyService,
  createSurveysRouter,
} = require('./surveys');

function fixture(extra = {}) {
  return {
    title: '本科生测试',
    description: '报名说明',
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 60000).toISOString(),
    winnerCount: 2,
    drawMode: 'auto',
    repeatDays: 0,
    questions: [
      { label: '年级', type: 'single', required: true, options: ['一年级', '二年级'] },
      { label: '体验方向', type: 'multiple', required: true, options: ['问答', '电路'] },
      { label: '备注', type: 'text', required: false },
    ],
    ...extra,
  };
}
function entry(contact) {
  return {
    contact,
    receipt: crypto.randomBytes(32).toString('hex'),
    answers: { q1: '一年级', q2: ['问答'] },
  };
}

test('survey validation rejects invalid schedule, recurrence and ambiguous choices', () => {
  assert.equal(validateSurvey(fixture()).questions[0].id, 'q1');
  for (const extra of [
    { title: '' },
    { closesAt: 'invalid' },
    { opensAt: '2030-01-01', closesAt: '2020-01-01' },
    { winnerCount: -1 },
    { winnerCount: 1.5 },
    { repeatDays: 1, opensAt: '2030-01-01', closesAt: '2030-01-03' },
    { questions: [] },
    { drawMode: 'bogus' },
    { questions: [{ type: 'single', label: 'a', options: ['a', 'a'] }] },
  ])
    assert.throws(() => validateSurvey(fixture(extra)));
});
test('required, optional and typed answers are enforced on the server', () => {
  const { questions } = validateSurvey(fixture());
  assert.deepEqual(validateAnswers(questions, entry('a@b.cn').answers), {
    q1: '一年级',
    q2: ['问答'],
    q3: '',
  });
  for (const answers of [
    {},
    { q1: '不存在', q2: ['问答'] },
    { q1: '一年级', q2: [] },
    { q1: '一年级', q2: ['问答', '问答'] },
    { q1: '一年级', q2: '问答' },
    { ...entry('a@b.cn').answers, q4: 'extra' },
    { ...entry('a@b.cn').answers, q3: 'a'.repeat(5001) },
  ])
    assert.throws(() => validateAnswers(questions, answers));
});
test('drawing produces distinct eligible winners without mutating the pool', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(
    chooseWinners(ids, 2, (min, max) => max - 1),
    ['d', 'a'],
  );
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(chooseWinners([], 3), []);
  assert.equal(new Set(chooseWinners(ids, 10)).size, 4);
  // Enumerate every possible partial Fisher–Yates path: each ordered pair occurs once.
  const pairs = new Set();
  for (let first = 0; first < 4; first += 1)
    for (let second = 1; second < 4; second += 1) {
      const sequence = [first, second];
      pairs.add(chooseWinners(ids, 2, () => sequence.shift()).join(','));
    }
  assert.equal(pairs.size, 12);
});

test(
  'MySQL: public lifecycle, permissions, concurrent submissions/draws and recurring recovery',
  { skip: !process.env.SURVEY_TEST_MYSQL_SOCKET, timeout: 30000 },
  async (t) => {
    const database = `survey_test_${crypto.randomBytes(6).toString('hex')}`;
    const options = {
      socketPath: process.env.SURVEY_TEST_MYSQL_SOCKET,
      user: process.env.SURVEY_TEST_MYSQL_USER || 'root',
      password: process.env.SURVEY_TEST_MYSQL_PASSWORD || '',
    };
    const root = await mysql.createConnection(options);
    await root.query(`CREATE DATABASE \`${database}\``);
    const pool = mysql.createPool({ ...options, database, connectionLimit: 8 });
    let server;
    t.after(async () => {
      if (server)
        await new Promise((resolve) => {
          server.close(resolve);
        });
      await pool.end();
      await root.query(`DROP DATABASE \`${database}\``);
      await root.end();
    });
    await ensureSurveyTables(pool);
    await ensureSurveyTables(pool);
    if (process.env.SURVEY_TEST_MYSQL_PORT) {
      // Simulate production migrations after the backend already upgraded its own tables.
      await pool.query(
        'CREATE TABLE schema_migrations (version VARCHAR(255) PRIMARY KEY, executed_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
      );
      const previous = fs
        .readdirSync(filePath.join(__dirname, '../database/migrations'))
        .filter(
          (file) => file.endsWith('.sql') && !file.startsWith('032_') && !file.startsWith('033_'),
        );
      for (const version of previous)
        await pool.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      const env = {
        ...process.env,
        PATH: `/usr/bin:${process.env.PATH}`,
        BACKEND_IP: '127.0.0.1',
        MYSQL_PORT: process.env.SURVEY_TEST_MYSQL_PORT,
        MYSQL_USER: options.user,
        MYSQL_PASSWORD: options.password,
        MYSQL_DATABASE: database,
      };
      const run = promisify(execFile);
      await run('bash', ['scripts/migrate.sh'], { cwd: filePath.join(__dirname, '..'), env });
      await ensureSurveyTables(pool);
      await run('bash', ['scripts/migrate.sh'], { cwd: filePath.join(__dirname, '..'), env });
      const [versions] = await pool.query(
        "SELECT version FROM schema_migrations WHERE version IN ('032_surveys.sql','033_survey_login.sql')",
      );
      assert.equal(versions.length, 2);
    }

    const service = createSurveyService(pool);
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createSurveysRouter({
        pool,
        service,
        getOptionalAuthUser: async (req) =>
          req.headers.authorization === 'Bearer test-admin' ? { id: 1 } : null,
        requireAdmin: async (req, res) => {
          if (req.headers.authorization === 'Bearer test-admin') return { id: 1 };
          res.status(403).json({ message: '需要管理员权限' });
          return null;
        },
      }),
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(path, method = 'GET', body = undefined, admin = false) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(admin ? { Authorization: 'Bearer test-admin' } : {}),
        },
        ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    }
    const created = await call('/admin/surveys', 'POST', fixture(), true);
    assert.equal(created.status, 201);
    const { id } = created.data;
    assert.equal((await call(`/surveys/${id}`)).status, 404);
    for (const [suffix, method] of [
      ['', 'GET'],
      ['', 'POST'],
      [`/${id}`, 'PUT'],
      [`/${id}/publish`, 'POST'],
      [`/${id}/draw`, 'POST'],
      [`/${id}/entries`, 'GET'],
      [`/${id}/cancel`, 'POST'],
      [`/${id}/stop-repeat`, 'POST'],
    ])
      assert.equal((await call(`/admin/surveys${suffix}`, method, {})).status, 403);
    assert.equal(
      (await call(`/admin/surveys/${id}`, 'PUT', fixture({ title: '更新草稿' }), true)).status,
      200,
    );
    assert.equal((await call(`/admin/surveys/${id}/publish`, 'POST', {}, true)).status, 200);
    assert.equal((await call(`/admin/surveys/${id}`, 'PUT', fixture(), true)).status, 409);
    assert.equal((await call(`/admin/surveys/${id}/draw`, 'POST', {}, true)).status, 400);
    const candidate = entry('Test@example.com');
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () => call(`/surveys/${id}/entries`, 'POST', candidate)),
    );
    assert.ok(parallel.every((result) => result.status === 201));
    assert.equal(
      (await call(`/surveys/${id}/entries`, 'POST', entry('test@EXAMPLE.com'))).status,
      409,
    );
    assert.equal(
      (
        await call(`/surveys/${id}/entries`, 'POST', {
          ...entry('invalid@example.com'),
          answers: {},
        })
      ).status,
      400,
    );
    await Promise.all(
      ['b', 'c', 'd'].map((name) =>
        call(`/surveys/${id}/entries`, 'POST', entry(`${name}@example.com`)),
      ),
    );
    const publicData = await call(`/surveys/${id}`);
    assert.ok(!JSON.stringify(publicData).includes('contact'));
    assert.ok(!JSON.stringify(publicData).includes(candidate.receipt));
    assert.equal(
      (await call(`/surveys/${id}/result`, 'POST', { receipt: candidate.receipt })).data.result,
      'pending',
    );
    await pool.execute(
      'UPDATE surveys SET closes_at=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id=?',
      [id],
    );
    assert.equal(
      (await call(`/surveys/${id}/entries`, 'POST', entry('late@example.com'))).status,
      409,
    );
    const draws = await Promise.all([
      service.draw(id, 1),
      service.draw(id, 'automatic', true),
      service.draw(id, 2),
    ]);
    assert.equal(draws.filter((value) => !value.alreadyDrawn).length, 1);
    const [[counts]] = await pool.execute(
      'SELECT COUNT(*) AS total, SUM(winner) AS winners FROM survey_entries WHERE survey_id=?',
      [id],
    );
    assert.equal(counts.total, 4);
    assert.equal(Number(counts.winners), 2);
    const result = await call(`/surveys/${id}/result`, 'POST', { receipt: candidate.receipt });
    assert.ok(['won', 'lost'].includes(result.data.result));
    assert.equal(
      (await call(`/surveys/${id}/result`, 'POST', { receipt: 'a'.repeat(64) })).status,
      404,
    );
    const exported = await call(`/admin/surveys/${id}/entries`, 'GET', undefined, true);
    assert.equal(exported.data.entries.length, 4);
    assert.ok(!JSON.stringify(exported).includes('receipt_hash'));
    // Separate service instances simulate multiple backend workers after downtime.
    const recurring = validateSurvey(
      fixture({
        opensAt: new Date(Date.now() - 10 * 86400000),
        closesAt: new Date(Date.now() - 9 * 86400000),
        repeatDays: 7,
        requiresLogin: true,
      }),
    );
    const recurringId = await service.insert(pool, recurring, 1, 'published');
    await Promise.all([service.tick(), createSurveyService(pool).tick()]);
    const [[parent]] = await pool.execute('SELECT * FROM surveys WHERE id=?', [recurringId]);
    assert.equal(parent.status, 'drawn');
    assert.ok(parent.next_id);
    const [[next]] = await pool.execute('SELECT * FROM surveys WHERE id=?', [parent.next_id]);
    assert.equal(next.status, 'published');
    assert.equal(next.requires_login, 1);
    assert.ok(next.closes_at > new Date());
    const [[total]] = await pool.query('SELECT COUNT(*) AS n FROM surveys');
    assert.equal(total.n, 3);
    await call(`/admin/surveys/${recurringId}/stop-repeat`, 'POST', {}, true);
    const [stopped] = await pool.query('SELECT repeat_days FROM surveys');
    assert.ok(stopped.every((row) => row.repeat_days === 0));
    const manual = await service.insert(
      pool,
      validateSurvey(
        fixture({
          drawMode: 'manual',
          opensAt: new Date(Date.now() - 60000),
          closesAt: new Date(Date.now() - 1000),
        }),
      ),
      1,
      'published',
    );
    await service.tick();
    const [[manualRow]] = await pool.execute('SELECT status FROM surveys WHERE id=?', [manual]);
    assert.equal(manualRow.status, 'published');
    await service.draw(manual, 1);
    const [[empty]] = await pool.execute('SELECT status FROM surveys WHERE id=?', [manual]);
    assert.equal(empty.status, 'drawn');
    const future = await service.insert(
      pool,
      validateSurvey(
        fixture({ opensAt: new Date(Date.now() + 60000), closesAt: new Date(Date.now() + 120000) }),
      ),
      1,
      'published',
    );
    assert.equal(
      (await call(`/surveys/${future}/entries`, 'POST', entry('future@example.com'))).status,
      409,
    );
    assert.equal((await call(`/admin/surveys/${future}/cancel`, 'POST', {}, true)).status, 200);
    assert.equal((await call(`/surveys/${future}`)).data.survey.status, 'cancelled');
    const restricted = await service.insert(
      pool,
      validateSurvey(fixture({ requiresLogin: true })),
      1,
      'published',
    );
    const publicRestricted = await call(`/surveys/${restricted}`);
    assert.equal(publicRestricted.status, 200);
    assert.equal(publicRestricted.data.survey.requiresLogin, true);
    assert.ok((await call('/surveys')).data.surveys.some((survey) => survey.id === restricted));
    assert.equal(
      (
        await call(`/surveys/${restricted}/entries`, 'POST', {
          ...entry('anon@example.com'),
          userId: 1,
        })
      ).status,
      401,
    );
    const loggedEntry = entry('logged@example.com');
    assert.equal(
      (await call(`/surveys/${restricted}/entries`, 'POST', loggedEntry, true)).status,
      201,
    );
    assert.equal(
      (await call(`/surveys/${restricted}/entries`, 'POST', loggedEntry, true)).status,
      201,
    );
    assert.equal(
      (await call(`/surveys/${restricted}/entries`, 'POST', entry('another@example.com'), true))
        .status,
      409,
    );
    assert.equal((await call(`/surveys/${restricted}/entries`, 'POST', loggedEntry)).status, 401);
    assert.equal(
      (await call(`/surveys/${restricted}/result`, 'POST', { receipt: loggedEntry.receipt })).data
        .result,
      'pending',
    );
    const extra = Array.from({ length: 201 }, () => [
      crypto.randomUUID(),
      '分页活动',
      '',
      '[]',
      new Date(),
      new Date(Date.now() + 60000),
      1,
      'manual',
      1,
    ]);
    await pool.query(
      'INSERT INTO surveys (id,title,description,questions,opens_at,closes_at,winner_count,draw_mode,created_by) VALUES ?',
      [extra],
    );
    const pageOne = (await call('/admin/surveys?page=0', 'GET', undefined, true)).data;
    const pageTwo = (await call('/admin/surveys?page=1', 'GET', undefined, true)).data;
    assert.equal(pageOne.surveys.length, 200);
    assert.equal(pageOne.nextPage, 1);
    assert.equal(pageTwo.nextPage, null);
    assert.ok(pageTwo.surveys.length > 0);
    assert.ok([...pageOne.surveys, ...pageTwo.surveys].some((survey) => survey.id === id));
    assert.equal(
      new Set([...pageOne.surveys, ...pageTwo.surveys].map((survey) => survey.id)).size,
      pageOne.surveys.length + pageTwo.surveys.length,
    );
  },
);
