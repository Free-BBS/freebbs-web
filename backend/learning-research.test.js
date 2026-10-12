const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { listenAllowedLoopback } = require('../scripts/fixtures/allowed-loopback');
const {
  createLearningResearchRouter,
  createMemoryResearchStore,
  createMysqlResearchStore,
  ensureLearningResearchTables,
  validateFeedback,
  validateStudy,
  validateAttempt,
  researchSummary,
  availableStage,
} = require('./learning-research');

const users = [{ id: 1 }, { id: 2 }, { id: 3, is_admin: true }];
const feedback = (overrides = {}) => ({
  requestKey: crypto.randomUUID(),
  module: 'learning',
  purpose: 'understand',
  helpfulness: 3,
  barriers: ['content'],
  comment: '私人的原文不提供给管理员',
  consent: true,
  ...overrides,
});
const question = (phase) => ({
  id: `${phase}_1`,
  prompt: `${phase}：卷积输出采用哪种运算？`,
  options: [
    { id: 'a', label: '卷积' },
    { id: 'b', label: '直接相加' },
  ],
  correctOption: 'a',
});
const definition = (overrides = {}) => ({
  requestKey: crypto.randomUUID(),
  title: '平台对卷积学习的支持',
  description: '观察不同学习目的下的理解、保持与迁移。',
  knowledgeTarget: '能解释卷积和识别使用条件',
  comparability: '课程部核查四套阶段题的概念覆盖，不把题数相同当作难度等价。',
  selectionNote: '自愿参与，无随机对照，不宣称因果效应。',
  questionVersion: 'signals-v1',
  modules: ['learning', 'max'],
  minDelayedHours: 24,
  phases: Object.fromEntries(
    ['baseline', 'post', 'delayed', 'transfer'].map((phase) => [phase, [question(phase)]]),
  ),
  ...overrides,
});
async function fixture(t, options = {}) {
  let now = new Date('2026-10-11T04:00:00Z');
  const fixtureUsers = options.users || users;
  const store = createMemoryResearchStore({ users: fixtureUsers, clock: () => now, ...options });
  const app = express();
  app.use(express.json());
  async function requireAuth(req, res) {
    const user = fixtureUsers.find((entry) => String(entry.id) === req.headers.authorization);
    if (!user) {
      res.status(401).json({ message: '需要登录' });
      return null;
    }
    return user;
  }
  async function requireAdmin(req, res) {
    const user = await requireAuth(req, res);
    if (user && !user.is_admin) {
      res.status(403).json({ message: '需要管理员权限' });
      return null;
    }
    return user;
  }
  app.use('/api', createLearningResearchRouter({ store, requireAuth, requireAdmin }));
  const server = http.createServer(app);
  await listenAllowedLoopback(server);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, { user = 1, method = 'GET', body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: String(user), 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  return {
    store,
    call,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    setNow: (value) => {
      now = new Date(value);
    },
  };
}

test('structured feedback requires bounded fields, explicit consent, and consistent barriers', () => {
  assert.equal(validateFeedback(feedback()).helpfulness, 3);
  for (const value of [
    feedback({ consent: false }),
    feedback({ helpfulness: 9 }),
    feedback({ role: 'admin' }),
    feedback({ barriers: ['none', 'technical'] }),
    feedback({ comment: 'x'.repeat(1001) }),
    feedback({ module: 'all_users_notes' }),
  ])
    assert.throws(() => validateFeedback(value), /研究|模块|障碍/);
});
test('study definitions reject unscored tasks, forged scoring, unmatched forms and missing scientific scope', () => {
  const valid = definition();
  assert.equal(validateStudy(valid).questionVersion, 'signals-v1');
  for (const value of [
    definition({ score: 999 }),
    definition({ minDelayedHours: 0 }),
    definition({ knowledgeTarget: '' }),
    definition({ comparability: '' }),
    definition({ phases: { ...valid.phases, post: [question('post'), { ...question('post2') }] } }),
    definition({
      phases: { ...valid.phases, baseline: [{ ...question('baseline'), correctOption: 'forged' }] },
    }),
  ])
    assert.throws(() => validateStudy(value));
  assert.throws(() =>
    validateAttempt({
      requestKey: crypto.randomUUID(),
      phase: 'post',
      answers: {},
      assistance: 'none',
      score: 100,
    }),
  );
});
test('owner-only feedback reaches storage, retries are idempotent, admins receive aggregates and deletion recomputes', async (t) => {
  const { call } = await fixture(t);
  const input = feedback();
  const created = await call('/feedback', { method: 'POST', body: input });
  assert.equal(created.status, 201);
  assert.equal((await call('/feedback', { method: 'POST', body: input })).body.duplicate, true);
  assert.equal(
    (await call('/feedback', { method: 'POST', body: { ...input, helpfulness: 4 } })).status,
    409,
  );
  assert.equal((await call('/me')).body.feedback[0].comment, input.comment);
  assert.equal((await call('/me', { user: 2 })).body.feedback.length, 0);
  const admin = await call('/admin', { user: 3 });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.feedback.responseCount, 1);
  assert.equal(admin.body.feedback.respondentCount, 1);
  assert.equal(admin.body.feedback.helpfulness.mean, null);
  assert.equal(admin.body.feedback.responseCoverage, 1 / 3);
  const serialized = JSON.stringify(admin.body);
  assert.ok(!serialized.includes(input.comment));
  assert.ok(!serialized.includes('userId'));
  assert.ok(!serialized.includes('answers'));
  const { id } = created.body.feedback;
  assert.equal((await call(`/feedback/${id}`, { method: 'DELETE', user: 2 })).status, 404);
  assert.equal((await call(`/feedback/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/feedback', { method: 'POST', body: input })).status, 409);
  assert.equal((await call('/admin', { user: 3 })).body.feedback.respondentCount, 0);
  assert.equal((await call('/me')).body.feedback.length, 0);
});
test('all research endpoints authenticate and publication/aggregate endpoints require administrator', async (t) => {
  const { call } = await fixture(t);
  for (const path of ['/me', '/studies', '/admin'])
    assert.equal((await call(path, { user: 999 })).status, 401);
  assert.equal((await call('/admin')).status, 403);
  assert.equal((await call('/studies', { method: 'POST', body: definition() })).status, 403);
  assert.match((await call('/me')).headers.get('cache-control'), /no-store/);
});
test('real voluntary study flow hides future tasks/answers, grades server-side, enforces baseline/order/delay and clears participation', async (t) => {
  const { call, advance } = await fixture(t);
  const input = definition();
  const created = await call('/studies', { user: 3, method: 'POST', body: input });
  assert.equal(created.status, 201);
  const studyId = created.body.study.id;
  assert.equal(
    (await call('/studies', { user: 3, method: 'POST', body: input })).body.study.id,
    studyId,
  );
  const list = (await call('/studies')).body.studies[0];
  assert.equal(list.enrolled, false);
  assert.deepEqual(list.questions, []);
  assert.ok(!JSON.stringify(list).includes('correctOption'));
  assert.ok(!JSON.stringify(list).includes('baseline_1'));
  const joinBody = { requestKey: crypto.randomUUID(), consent: true, goal: 'understand' };
  assert.equal(
    (await call(`/studies/${studyId}/join`, { method: 'POST', body: joinBody })).status,
    201,
  );
  assert.equal(
    (await call(`/studies/${studyId}/join`, { method: 'POST', body: joinBody })).body.duplicate,
    true,
  );
  let stage = (await call('/studies')).body.studies[0];
  assert.equal(stage.nextPhase, 'baseline');
  assert.equal(stage.questions[0].id, 'baseline_1');
  assert.ok(!JSON.stringify(stage).includes('post_1'));
  assert.ok(!JSON.stringify(stage).includes('correctOption'));
  const attempt = (phase, correct = false) => ({
    requestKey: crypto.randomUUID(),
    phase,
    answers: { [`${phase}_1`]: correct ? 'a' : 'b' },
    assistance: 'none',
  });
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: attempt('post') })).status,
    409,
  );
  const before = attempt('baseline');
  const scored = await call(`/studies/${studyId}/attempts`, { method: 'POST', body: before });
  assert.equal(scored.status, 201);
  assert.equal(scored.body.attempt.score, 0);
  assert.ok(!JSON.stringify(scored.body).includes('correctOption'));
  assert.ok(!JSON.stringify(scored.body).includes('answers'));
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: before })).body.duplicate,
    true,
  );
  assert.equal(
    (
      await call(`/studies/${studyId}/attempts`, {
        method: 'POST',
        body: attempt('baseline', true),
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: attempt('post', true) }))
      .body.attempt.score,
    1,
  );
  [stage] = (await call('/studies')).body.studies;
  assert.equal(stage.nextPhase, 'delayed');
  assert.deepEqual(stage.questions, []);
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: attempt('delayed') }))
      .status,
    409,
  );
  advance(24 * 3600000);
  assert.equal((await call('/studies')).body.studies[0].questions[0].id, 'delayed_1');
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: attempt('delayed', true) }))
      .status,
    201,
  );
  assert.equal(
    (
      await call(`/studies/${studyId}/attempts`, {
        method: 'POST',
        body: attempt('transfer', true),
      })
    ).status,
    201,
  );
  assert.equal((await call('/studies')).body.studies[0].nextPhase, null);
  const admin = (await call('/admin', { user: 3 })).body;
  assert.equal(admin.studies[0].paired.pairCount, 1);
  assert.equal(admin.studies[0].retention.pairCount, 1);
  assert.equal(admin.studies[0].stages[3].submittedCount, 1);
  assert.equal(admin.studies[0].paired.meanChange, null);
  assert.equal(
    (await call(`/studies/${studyId}/participation`, { method: 'DELETE', user: 2 })).status,
    404,
  );
  assert.equal((await call(`/studies/${studyId}/participation`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/me')).body.enrollments.length, 0);
  assert.equal((await call('/admin', { user: 3 })).body.studies[0].participantCount, 0);
  assert.equal(
    (await call(`/studies/${studyId}/join`, { method: 'POST', body: joinBody })).status,
    409,
  );
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: before })).status,
    409,
  );
});
test('unknown options, additional answers, self-reported marks and nonparticipant attempts cannot become objective evidence', async (t) => {
  const { call } = await fixture(t);
  const created = await call('/studies', { user: 3, method: 'POST', body: definition() });
  const studyId = created.body.study.id;
  const value = {
    requestKey: crypto.randomUUID(),
    phase: 'baseline',
    answers: { baseline_1: 'a' },
    assistance: 'max',
  };
  assert.equal(
    (await call(`/studies/${studyId}/attempts`, { method: 'POST', body: value })).status,
    403,
  );
  await call(`/studies/${studyId}/join`, {
    method: 'POST',
    body: { requestKey: crypto.randomUUID(), consent: true, goal: 'explore' },
  });
  for (const body of [
    { ...value, score: 100 },
    { ...value, answers: { baseline_1: 'z' } },
    { ...value, answers: { baseline_1: 'a', added: 'a' } },
    { ...value, answers: {} },
  ])
    assert.equal(
      (await call(`/studies/${studyId}/attempts`, { method: 'POST', body })).status,
      400,
    );
  assert.equal((await call('/me')).body.enrollments[0].attempts.length, 0);
});
test('feedback quotas resist request floods but idempotent retries do not spend quota', async (t) => {
  const { call, advance } = await fixture(t);
  const first = feedback();
  for (let count = 0; count < 20; count += 1)
    assert.equal(
      (await call('/feedback', { method: 'POST', body: count === 0 ? first : feedback() })).status,
      201,
    );
  assert.equal((await call('/feedback', { method: 'POST', body: first })).status, 200);
  const blocked = await call('/feedback', { method: 'POST', body: feedback() });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  advance(60001);
  assert.equal((await call('/feedback', { method: 'POST', body: feedback() })).status, 201);
});
test('summary keeps earlier baseline, separates missing/assisted evidence, and never equates transfer to grade gain', () => {
  const study = {
    id: crypto.randomUUID(),
    ...validateStudy(definition()),
    createdAt: '2026-10-01T00:00:00Z',
  };
  const enrollments = Array.from({ length: 6 }, (_, index) => ({
    userId: String(index + 1),
    studyId: study.id,
    goal: index < 3 ? 'understand' : 'explore',
    joinedAt: '2026-09-01T00:00:00Z',
  }));
  const attempts = enrollments.flatMap((entry, index) => [
    {
      ...entry,
      id: `before${index}`,
      phase: 'baseline',
      score: 0,
      maxScore: 1,
      questionVersion: 'signals-v1',
      assistance: 'none',
      createdAt: '2026-09-30T00:00:00Z',
    },
    ...(index < 5
      ? [
          {
            ...entry,
            id: `after${index}`,
            phase: 'post',
            score: 1,
            maxScore: 1,
            questionVersion: 'signals-v1',
            assistance: index < 4 ? 'none' : 'max',
            createdAt: '2026-10-11T00:00:00Z',
          },
        ]
      : []),
  ]);
  const result = researchSummary({
    feedback: [],
    studies: [study],
    enrollments,
    attempts,
    registeredUserCount: 6,
    since: new Date('2026-10-04T00:00:00Z'),
    window: '7',
  });
  assert.equal(result.studies[0].participantCount, 5);
  assert.equal(result.studies[0].retainedCohort.participantCount, 6);
  assert.equal(
    result.studies[0].retainedCohort.stages.find((row) => row.phase === 'post').missingCount,
    1,
  );
  assert.equal(result.studies[0].paired.pairCount, 5);
  assert.equal(result.studies[0].paired.meanChange, 100);
  assert.equal(result.studies[0].paired.independentPairCount, 4);
  assert.equal(result.studies[0].paired.independentMeanChange, null);
  assert.equal(result.studies[0].stages[2].missingCount, 5);
  assert.equal(result.studies[0].stages[3].meanPercent, null);
  assert.ok(result.studies[0].limitations.some((message) => message.includes('自报')));
  assert.ok(result.studies[0].limitations.some((message) => message.includes('随机')));
});
test('retention purges source data and aggregates without altering default activity recording', async (t) => {
  const { call, advance } = await fixture(t);
  await call('/feedback', { method: 'POST', body: feedback() });
  advance(181 * 86400000);
  assert.equal((await call('/me')).body.feedback.length, 0);
  assert.equal((await call('/admin', { user: 3 })).body.feedback.respondentCount, 0);
  assert.equal((await call('/me')).body.policy.voluntary, true);
});
test('availability uses post submission timestamp instead of client timestamps', () => {
  const study = { ...validateStudy(definition()) };
  const enrollment = { goal: 'practice' };
  const attempts = [
    { phase: 'baseline', createdAt: '2026-10-01T00:00:00Z' },
    { phase: 'post', createdAt: '2026-10-11T00:00:00Z' },
  ];
  const stage = availableStage(study, enrollment, attempts, new Date('2026-10-11T23:59:59Z'));
  assert.equal(stage.availableAt, '2026-10-12T00:00:00.000Z');
  assert.deepEqual(stage.questions, []);
});
test('MySQL migration creates durable tables for evidence, definitions, enrollment, idempotence and quota', async () => {
  const calls = [];
  await ensureLearningResearchTables({
    async execute(sql) {
      calls.push(sql);
      return [[], []];
    },
  });
  assert.equal(calls.length, 6);
  assert.ok(calls.every((sql) => /CREATE TABLE IF NOT EXISTS/.test(sql)));
  assert.ok(calls.some((sql) => /UNIQUE KEY uq_research_phase/.test(sql)));
  assert.ok(calls.some((sql) => /PRIMARY KEY \(user_id, request_key\)/.test(sql)));
  assert.ok(calls.every((sql) => !/learning_entries|ai_dialog|learning_analytics/.test(sql)));
});
test('MySQL owner deletion includes owner predicate and removes only matching retry receipt', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {
      return undefined;
    },
    async commit() {
      return undefined;
    },
    async rollback() {
      return undefined;
    },
    release() {},
    async execute(query, params) {
      const sql = typeof query === 'string' ? query : query.sql;
      calls.push({ sql, params, options: query });
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlResearchStore({
    async getConnection() {
      return connection;
    },
  });
  assert.equal(await store.removeFeedback(7, '12'), true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ sql }) => /user_id = \?/.test(sql)));
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[1].params, [7, '12']);
  assert.match(calls[2].sql, /UPDATE.*feedback.id/);
  assert.deepEqual(JSON.parse(calls[2].params[0]), { removed: true });
});

test('respondent-balanced feedback prevents repeated submissions from weighting one person more heavily', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    userId: '1',
    module: 'learning',
    purpose: 'understand',
    helpfulness: 4,
    barriers: ['none'],
  }));
  for (let userId = 2; userId <= 5; userId += 1)
    rows.push({
      id: String(userId + 20),
      userId: String(userId),
      module: 'learning',
      purpose: 'understand',
      helpfulness: 0,
      barriers: ['content'],
    });
  const result = researchSummary({
    feedback: rows,
    studies: [],
    enrollments: [],
    attempts: [],
    registeredUserCount: 5,
  });
  assert.equal(result.feedback.responseCount, 24);
  assert.equal(result.feedback.respondentCount, 5);
  assert.equal(result.feedback.helpfulness.mean, 0.8);
  assert.equal(result.feedback.modules[0].meanHelpfulness, 0.8);
  assert.equal(result.feedback.helpfulness.basis, 'respondent_balanced_mean');
});

test('MySQL feedback mutation persists receipt and quota in one transaction, with owner and server time', async () => {
  const calls = [];
  const events = [];
  const now = new Date('2026-10-11T04:00:00Z');
  const connection = {
    async beginTransaction() {
      events.push('begin');
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
    async execute(query, params) {
      const sql = typeof query === 'string' ? query : query.sql;
      calls.push({ sql, params, options: query });
      if (/SELECT window_start/.test(sql))
        return [[{ window_start: '2026-10-11 04:00:00.000', request_count: 0 }]];
      if (/SELECT payload_hash/.test(sql)) return [[]];
      if (/INSERT INTO learning_research_feedback/.test(sql)) return [{ insertId: 55 }];
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlResearchStore(
    {
      async getConnection() {
        return connection;
      },
    },
    { clock: () => now },
  );
  const value = validateFeedback(feedback());
  const result = await store.addFeedback(7, value);
  assert.equal(result.feedback.id, '55');
  assert.equal(result.duplicate, false);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE user_id = user_id$/);
  assert.doesNotMatch(calls[0].sql, /INSERT IGNORE|UPDATE window_start|UPDATE request_count/);
  const receipt = calls.find(({ sql }) => /INSERT INTO learning_research_requests/.test(sql));
  assert.equal(receipt.params[0], 7);
  assert.equal(receipt.params[1], value.requestKey);
  assert.equal(receipt.params[4], '2026-10-11 04:00:00.000');
  assert.ok(calls.some(({ sql }) => /FOR UPDATE/.test(sql)));
  assert.equal(calls.find(({ sql }) => /SELECT window_start/.test(sql)).options.dateStrings, true);
  const insert = calls.find(({ sql }) => /INSERT INTO learning_research_feedback/.test(sql));
  assert.equal(insert.params[0], 7);
  assert.equal(JSON.parse(insert.params[1]).comment, value.comment);
});

test('MySQL quota rejection rolls back without inserting feedback or receipts', async () => {
  const events = [];
  const calls = [];
  const connection = {
    async beginTransaction() {
      events.push('begin');
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
    async execute(query) {
      const sql = typeof query === 'string' ? query : query.sql;
      calls.push(sql);
      if (/SELECT window_start/.test(sql))
        return [[{ window_start: '2026-10-11 04:00:00.000', request_count: 20 }]];
      if (/SELECT payload_hash/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlResearchStore(
    {
      async getConnection() {
        return connection;
      },
    },
    { clock: () => new Date('2026-10-11T04:00:01Z') },
  );
  await assert.rejects(
    () => store.addFeedback(7, validateFeedback(feedback())),
    (error) => error.status === 429,
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
  assert.ok(
    !calls.some((sql) =>
      /INSERT INTO learning_research_feedback|INSERT INTO learning_research_requests/.test(sql),
    ),
  );
});

function failingTransactionPool({
  failures,
  code = 'ER_LOCK_DEADLOCK',
  failAt = 'execute',
  rollbackError,
} = {}) {
  const events = [];
  const error = Object.assign(new Error(code), { code });
  let connections = 0;
  const pool = {
    async getConnection() {
      connections += 1;
      const id = connections;
      let executes = 0;
      return {
        async beginTransaction() {
          events.push(`${id}:begin`);
        },
        async execute() {
          executes += 1;
          events.push(`${id}:execute`);
          if (failAt === 'execute' && executes === 2 && id <= failures) throw error;
          return [{ affectedRows: 1 }];
        },
        async commit() {
          events.push(`${id}:commit`);
          if (failAt === 'commit' && id <= failures) throw error;
        },
        async rollback() {
          events.push(`${id}:rollback`);
          if (rollbackError) throw rollbackError;
        },
        release() {
          events.push(`${id}:release`);
        },
      };
    },
  };
  return { pool, events, error, connectionCount: () => connections };
}

test('MySQL deadlocks roll back and release before retrying the complete transaction, at most three times', async () => {
  const txFixture = failingTransactionPool({ failures: 2 });
  const store = createMysqlResearchStore(txFixture.pool);
  assert.equal(await store.removeFeedback(7, '12'), true);
  assert.equal(txFixture.connectionCount(), 3);
  assert.deepEqual(
    txFixture.events.filter((event) => !event.endsWith(':execute')),
    [
      '1:begin',
      '1:rollback',
      '1:release',
      '2:begin',
      '2:rollback',
      '2:release',
      '3:begin',
      '3:commit',
      '3:release',
    ],
  );
  const exhausted = failingTransactionPool({ failures: Infinity });
  await assert.rejects(
    createMysqlResearchStore(exhausted.pool).removeFeedback(7, '12'),
    (error) => error === exhausted.error,
  );
  assert.equal(exhausted.connectionCount(), 3);
  assert.equal(exhausted.events.filter((event) => event.endsWith(':rollback')).length, 3);
  assert.equal(exhausted.events.filter((event) => event.endsWith(':release')).length, 3);
});

test('MySQL transactions do not retry timeouts, domain errors, uncertain commits or failed rollbacks', async () => {
  for (const options of [
    { failures: Infinity, code: 'ER_LOCK_WAIT_TIMEOUT' },
    { failures: Infinity, code: 'ECONNREFUSED' },
    { failures: Infinity, code: 'RESEARCH_CONFLICT' },
    { failures: Infinity, code: 'ECONNRESET', failAt: 'commit' },
    { failures: Infinity, rollbackError: new Error('rollback failed') },
  ]) {
    const txFixture = failingTransactionPool(options);
    await assert.rejects(
      createMysqlResearchStore(txFixture.pool).removeFeedback(7, '12'),
      (error) => error === (options.rollbackError || txFixture.error),
    );
    assert.equal(txFixture.connectionCount(), 1);
    assert.equal(txFixture.events.at(-1), '1:release');
  }
});

test('study identifiers and scoring keys must be strings, never coerced numbers', () => {
  assert.throws(() => validateStudy(definition({ questionVersion: 12 })));
  for (const override of [
    { id: 1 },
    {
      options: [
        { id: 1, label: '一' },
        { id: 2, label: '二' },
      ],
      correctOption: 1,
    },
    { correctOption: 1 },
  ]) {
    const { phases } = definition();
    phases.baseline = [{ ...question('baseline'), ...override }];
    assert.throws(() => validateStudy(definition({ phases })));
  }
});

test('MySQL date selects preserve UTC wall time independently of server local timezone', async () => {
  const studyId = crypto.randomUUID();
  const { requestKey: ignored, ...studyDefinition } = validateStudy(definition());
  const queries = [];
  const store = createMysqlResearchStore({
    async execute(options) {
      assert.equal(options.dateStrings, true);
      queries.push(options.sql);
      if (/FROM learning_research_studies/.test(options.sql))
        return [
          [
            {
              id: studyId,
              definition_json: JSON.stringify(studyDefinition),
              created_at: '2026-10-11 04:00:00.000',
            },
          ],
        ];
      if (/FROM learning_research_enrollments/.test(options.sql))
        return [
          [
            {
              user_id: 1,
              study_id: studyId,
              goal: 'practice',
              joined_at: '2026-10-11 04:00:00.000',
            },
          ],
        ];
      if (/FROM learning_research_attempts/.test(options.sql))
        return [
          [
            {
              id: 2,
              user_id: 1,
              study_id: studyId,
              phase: 'post',
              score: 1,
              max_score: 1,
              assistance: 'none',
              question_version: 'signals-v1',
              created_at: '2026-10-11 04:00:00.000',
            },
          ],
        ];
      return [
        [
          {
            id: 1,
            user_id: 1,
            content_json: JSON.stringify(validateFeedback(feedback())),
            created_at: '2026-10-11 04:00:00.000',
          },
        ],
      ];
    },
  });
  const study = (await store.studies())[0];
  const enrollment = (await store.enrollments(1))[0];
  const attempt = (await store.attempts(1))[0];
  assert.equal(study.createdAt, '2026-10-11T04:00:00.000Z');
  assert.equal(enrollment.joinedAt, '2026-10-11T04:00:00.000Z');
  assert.equal(attempt.createdAt, '2026-10-11T04:00:00.000Z');
  assert.equal((await store.feedback(1))[0].createdAt, '2026-10-11T04:00:00.000Z');
  assert.equal(queries.length, 4);
});

test('withdrawal and phase submission leave no source evidence whichever operation happens first', async () => {
  const store = createMemoryResearchStore({ users });
  const value = validateStudy(definition());
  const studyId = (await store.addStudy(3, value)).study.id;
  const joined = { requestKey: crypto.randomUUID(), goal: 'understand' };
  await store.join(1, studyId, joined);
  const attempted = validateAttempt({
    requestKey: crypto.randomUUID(),
    phase: 'baseline',
    answers: { baseline_1: 'a' },
    assistance: 'none',
  });
  await Promise.all([store.attempt(1, studyId, attempted), store.withdraw(1, studyId)]);
  assert.deepEqual(await store.enrollments(1), []);
  assert.deepEqual(await store.attempts(1), []);
  await assert.rejects(
    () => store.join(1, studyId, joined),
    (error) => error.status === 409,
  );
  await assert.rejects(
    () => store.attempt(1, studyId, attempted),
    (error) => error.status === 409,
  );
  await store.join(1, studyId, { requestKey: crypto.randomUUID(), goal: 'practice' });
  const outcomes = await Promise.allSettled([
    store.withdraw(1, studyId),
    store.attempt(1, studyId, { ...attempted, requestKey: crypto.randomUUID() }),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[1].reason.status, 403);
  assert.deepEqual(await store.attempts(1), []);
});

test('full 10000-row study coverage is grouped by participant, goal and assistance without dropping baseline', () => {
  const study = {
    id: crypto.randomUUID(),
    ...validateStudy(definition()),
    createdAt: '2026-10-01T00:00:00Z',
  };
  const enrollments = Array.from({ length: 2500 }, (_, index) => ({
    userId: String(index),
    studyId: study.id,
    goal: index < 1250 ? 'understand' : 'explore',
    joinedAt: '2026-09-01T00:00:00Z',
  }));
  const attempts = enrollments.flatMap((row) =>
    ['baseline', 'post', 'delayed', 'transfer'].map((phase) => ({
      ...row,
      id: `${row.userId}-${phase}`,
      phase,
      score: phase === 'baseline' ? 0 : 1,
      maxScore: 2,
      assistance: row.goal === 'understand' ? 'none' : 'max',
      questionVersion: 'signals-v1',
      createdAt: phase === 'baseline' ? '2026-09-01T00:00:00Z' : '2026-10-11T00:00:00Z',
    })),
  );
  const result = researchSummary({
    studies: [study],
    feedback: [],
    enrollments,
    attempts,
    registeredUserCount: 2500,
    since: new Date('2026-10-04T00:00:00Z'),
  });
  assert.equal(result.dataCoverage.complete, true);
  assert.equal(result.studies[0].paired.pairCount, 2500);
  assert.equal(result.studies[0].paired.meanChange, 50);
  assert.equal(result.studies[0].paired.independentPairCount, 1250);
  assert.equal(result.studies[0].paired.assistedPairCount, 1250);
  assert.equal(result.studies[0].retention.meanChange, 0);
  assert.equal(
    result.studies[0].byGoal.find((row) => row.goal === 'explore').paired.meanChange,
    50,
  );
});

test('development outcomes are bounded voluntary self-reports, while omission remains unknown', async (t) => {
  assert.deepEqual(validateFeedback(feedback()).outcomes, []);
  assert.deepEqual(validateFeedback(feedback({ outcomes: [] })).outcomes, []);
  for (const outcomes of [
    null,
    ['grade_certified'],
    ['clarity', 'none'],
    ['clarity', 'clarity'],
    ['clarity', 'independence', 'direction', 'exploration'],
  ])
    assert.throws(() => validateFeedback(feedback({ outcomes })));
  const { call } = await fixture(t);
  await call('/feedback', { method: 'POST', body: feedback() });
  await call('/feedback', {
    method: 'POST',
    body: feedback({ outcomes: ['clarity', 'direction'] }),
  });
  await call('/feedback', { method: 'POST', body: feedback({ outcomes: ['clarity'] }) });
  const owner = (await call('/me')).body;
  assert.equal(owner.feedback.find((row) => row.outcomes.length === 0).outcomes.length, 0);
  const admin = (await call('/admin', { user: 3 })).body;
  assert.equal(admin.feedback.outcomeResponseCount, 2);
  assert.equal(admin.feedback.outcomeRespondentCount, 1);
  assert.equal(admin.feedback.outcomesUnknownResponseCount, 1);
  const clarity = admin.feedback.byOutcome.find((row) => row.outcome === 'clarity');
  assert.equal(clarity.responseCount, 2);
  assert.equal(clarity.respondentCount, 1);
  assert.equal(admin.feedback.byOutcome.find((row) => row.outcome === 'none').respondentCount, 0);
  assert.ok(admin.limitations.some((value) => value.includes('能力认证')));
});

test('research analysis canary observes distinct delayed states from real enrollment and scored requests', async (t) => {
  const cohort = [1, 2, 4, 5].map((id) => ({ id }));
  cohort.push({ id: 3, is_admin: true });
  const { call, setNow } = await fixture(t, { users: cohort });
  setNow('2026-10-01T00:00:00Z');
  const published = await call('/studies', { user: 3, method: 'POST', body: definition() });
  const studyId = published.body.study.id;
  for (const user of [1, 2, 4, 5]) {
    assert.equal(
      (
        await call(`/studies/${studyId}/join`, {
          user,
          method: 'POST',
          body: {
            requestKey: crypto.randomUUID(),
            consent: true,
            goal: user === 1 ? 'explore' : 'understand',
          },
        })
      ).status,
      201,
    );
  }
  const submit = async (user, phase, correct = true, assistance = 'none') => {
    const result = await call(`/studies/${studyId}/attempts`, {
      user,
      method: 'POST',
      body: {
        requestKey: crypto.randomUUID(),
        phase,
        answers: { [`${phase}_1`]: correct ? 'a' : 'b' },
        assistance,
      },
    });
    assert.equal(result.status, 201);
    return result.body.attempt;
  };
  // User 1 begins at the ceiling; user 2 shows a task-score change with help.
  await submit(1, 'baseline');
  await submit(1, 'post');
  await submit(2, 'baseline', false);
  await submit(4, 'baseline', false);
  setNow('2026-10-01T23:00:00Z');
  await submit(2, 'post', true, 'max');
  setNow('2026-10-02T00:00:00Z');
  const lists = await Promise.all(
    [1, 2, 4, 5].map(async (user) => (await call('/studies', { user })).body.studies[0]),
  );
  assert.equal(lists[0].nextPhase, 'delayed');
  assert.equal(lists[0].questions.length, 1);
  assert.equal(lists[1].nextPhase, 'delayed');
  assert.equal(lists[1].questions.length, 0);
  assert.equal(lists[1].availableAt, '2026-10-02T23:00:00.000Z');
  assert.equal(lists[2].nextPhase, 'post');
  assert.equal(lists[3].nextPhase, 'baseline');
  const admin = (await call('/admin?window=7', { user: 3 })).body.studies[0];
  const delayed = admin.stages.find((row) => row.phase === 'delayed');
  assert.equal(admin.participantCount, 4);
  assert.equal(admin.retainedCohort.participantCount, 4);
  assert.equal(delayed.submittedCount, 0);
  assert.equal(delayed.missingCount, 4);
  assert.equal(delayed.meanPercent, null);
  assert.deepEqual(delayed.eligibility, {
    available: true,
    eligibleCount: 1,
    awaitingSubmissionCount: 1,
    notYetDueCount: 1,
    missingPrerequisiteCount: 2,
  });
  assert.deepEqual(
    admin.retainedCohort.stages.find((row) => row.phase === 'delayed').eligibility,
    delayed.eligibility,
  );
  assert.equal(admin.paired.pairCount, 2);
  assert.equal(admin.paired.meanChange, null);
  assert.equal(admin.paired.independentPairCount, 1);
  assert.equal(admin.paired.assistedPairCount, 1);
  assert.ok(admin.limitations.some((value) => value.includes('尚未到期')));
  for (const row of admin.stages) {
    assert.equal(
      row.eligibility.awaitingSubmissionCount +
        row.eligibility.notYetDueCount +
        row.eligibility.missingPrerequisiteCount,
      row.missingCount,
    );
    assert.equal(
      row.eligibility.eligibleCount,
      row.submittedCount + row.eligibility.awaitingSubmissionCount,
    );
  }
  await submit(1, 'delayed');
  let updated = (await call('/admin?window=7', { user: 3 })).body.studies[0];
  assert.equal(updated.stages.find((row) => row.phase === 'delayed').eligibility.eligibleCount, 1);
  assert.equal(
    updated.stages.find((row) => row.phase === 'transfer').eligibility.awaitingSubmissionCount,
    1,
  );
  setNow('2026-10-02T22:59:59.999Z');
  [updated] = (await call('/admin?window=7', { user: 3 })).body.studies;
  assert.equal(updated.stages.find((row) => row.phase === 'delayed').eligibility.notYetDueCount, 1);
  assert.equal((await call('/studies', { user: 2 })).body.studies[0].questions.length, 0);
  setNow('2026-10-02T23:00:00Z');
  [updated] = (await call('/admin?window=7', { user: 3 })).body.studies;
  assert.equal(updated.stages.find((row) => row.phase === 'delayed').eligibility.notYetDueCount, 0);
  assert.equal(updated.stages.find((row) => row.phase === 'delayed').eligibility.eligibleCount, 2);
  assert.equal((await call('/studies', { user: 2 })).body.studies[0].questions.length, 1);
});

test('strategic canary keeps perceived help, ceiling performance, earlier baseline, dropout and research versions distinct', async (t) => {
  const cohort = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));
  cohort.push({ id: 99, is_admin: true });
  const { call, setNow } = await fixture(t, { users: cohort });
  setNow('2026-09-01T00:00:00Z');
  const v1 = (await call('/studies', { user: 99, method: 'POST', body: definition() })).body.study
    .id;
  const v2 = (
    await call('/studies', {
      user: 99,
      method: 'POST',
      body: definition({ questionVersion: 'signals-v2' }),
    })
  ).body.study.id;
  const submit = async (studyId, user, phase, correct, assistance = 'none') => {
    const result = await call(`/studies/${studyId}/attempts`, {
      user,
      method: 'POST',
      body: {
        requestKey: crypto.randomUUID(),
        phase,
        answers: { [`${phase}_1`]: correct ? 'a' : 'b' },
        assistance,
      },
    });
    assert.equal(result.status, 201);
    return result.body.attempt;
  };
  for (let user = 1; user <= 10; user += 1) {
    assert.equal(
      (
        await call(`/studies/${v1}/join`, {
          user,
          method: 'POST',
          body: {
            requestKey: crypto.randomUUID(),
            consent: true,
            goal: user <= 5 ? 'understand' : 'explore',
          },
        })
      ).status,
      201,
    );
    await submit(v1, user, 'baseline', user > 5);
  }
  setNow('2026-10-11T00:00:00Z');
  for (let user = 1; user <= 9; user += 1)
    await submit(v1, user, 'post', true, user === 9 ? 'max' : 'none');
  // A successful task change does not override a person's report of no help.
  await call('/feedback', {
    user: 1,
    method: 'POST',
    body: feedback({ helpfulness: 0, outcomes: ['none'] }),
  });
  // An already high-scoring participant can benefit from exploration without a score gain.
  await call('/feedback', {
    user: 6,
    method: 'POST',
    body: feedback({ helpfulness: 4, purpose: 'explore', outcomes: ['exploration'] }),
  });
  await call('/feedback', {
    user: 6,
    method: 'POST',
    body: feedback({ helpfulness: 0, purpose: 'explore' }),
  });
  for (const user of [2, 3, 4])
    await call('/feedback', {
      user,
      method: 'POST',
      body: feedback({ helpfulness: 4, outcomes: ['clarity'] }),
    });
  await call(`/studies/${v2}/join`, {
    user: 1,
    method: 'POST',
    body: { requestKey: crypto.randomUUID(), consent: true, goal: 'understand' },
  });
  await submit(v2, 1, 'baseline', true);
  const windowed = (await call('/admin?window=7', { user: 99 })).body;
  const first = windowed.studies.find((study) => study.id === v1);
  const second = windowed.studies.find((study) => study.id === v2);
  assert.equal(windowed.feedback.respondentCount, 5);
  assert.equal(windowed.feedback.responseCount, 6);
  assert.equal(windowed.feedback.helpfulness.mean, 2.8);
  assert.equal(
    windowed.feedback.byOutcome.find((row) => row.outcome === 'none').respondentCount,
    1,
  );
  assert.equal(
    windowed.feedback.byOutcome.find((row) => row.outcome === 'exploration').respondentCount,
    1,
  );
  assert.equal(first.participantCount, 9);
  assert.equal(first.retainedCohort.participantCount, 10);
  assert.equal(first.paired.pairCount, 9);
  assert.equal(first.paired.meanChange, 55.56);
  assert.equal(first.byGoal.find((row) => row.goal === 'understand').paired.meanChange, 100);
  assert.equal(first.byGoal.find((row) => row.goal === 'explore').paired.meanChange, null);
  assert.equal(first.stages.find((row) => row.phase === 'post').missingCount, 0);
  assert.equal(first.retainedCohort.stages.find((row) => row.phase === 'post').missingCount, 1);
  assert.equal(
    first.retainedCohort.stages.find((row) => row.phase === 'post').eligibility
      .awaitingSubmissionCount,
    1,
  );
  assert.equal(second.questionVersion, 'signals-v2');
  assert.equal(second.paired.pairCount, 0);
  const highBaseline = (await call('/me', { user: 6 })).body.enrollments.find(
    (entry) => entry.studyId === v1,
  ).attempts;
  assert.equal(highBaseline.find((attempt) => attempt.phase === 'baseline').score, 1);
  assert.equal(highBaseline.find((attempt) => attempt.phase === 'post').score, 1);
  setNow('2026-10-12T00:00:00Z');
  await submit(v1, 1, 'delayed', false);
  await submit(v1, 2, 'delayed', true);
  await submit(v1, 1, 'transfer', true);
  await submit(v1, 2, 'transfer', false);
  const followup = (await call('/admin?window=all', { user: 99 })).body.studies.find(
    (study) => study.id === v1,
  );
  assert.equal(followup.retention.pairCount, 2);
  assert.equal(followup.retention.meanChange, null);
  assert.equal(followup.stages.find((row) => row.phase === 'transfer').submittedCount, 2);
  assert.equal(followup.stages.find((row) => row.phase === 'transfer').meanPercent, null);
  assert.equal(
    followup.stages.find((row) => row.phase === 'delayed').eligibility.awaitingSubmissionCount,
    7,
  );
});

test('incomplete research source makes eligibility unknown rather than classifying clipped evidence as missing prerequisites', () => {
  const study = {
    id: crypto.randomUUID(),
    ...validateStudy(definition()),
    createdAt: '2026-10-01T00:00:00Z',
  };
  const enrollments = [
    { userId: '1', studyId: study.id, goal: 'understand', joinedAt: '2026-10-01T00:00:00Z' },
  ];
  const attempts = Array.from({ length: 10001 }, (_, index) => ({
    id: String(index),
    userId: String(index + 2),
    studyId: study.id,
    phase: 'post',
    score: 1,
    maxScore: 1,
    assistance: 'none',
    questionVersion: 'signals-v1',
    createdAt: '2026-10-11T00:00:00Z',
  }));
  const result = researchSummary({
    feedback: [],
    studies: [study],
    enrollments,
    attempts,
    registeredUserCount: 10002,
  });
  assert.equal(result.dataCoverage.complete, false);
  for (const row of [...result.studies[0].stages, ...result.studies[0].retainedCohort.stages]) {
    assert.equal(row.eligibility.available, false);
    assert.equal(row.eligibility.eligibleCount, null);
    assert.equal(row.eligibility.missingPrerequisiteCount, null);
  }
});

test('expired participation and attempts are removed once and stay absent on repeated pruning requests', async (t) => {
  const { call, advance, store } = await fixture(t);
  const studyId = (await call('/studies', { user: 3, method: 'POST', body: definition() })).body
    .study.id;
  await call(`/studies/${studyId}/join`, {
    method: 'POST',
    body: { requestKey: crypto.randomUUID(), consent: true, goal: 'practice' },
  });
  await call(`/studies/${studyId}/attempts`, {
    method: 'POST',
    body: {
      requestKey: crypto.randomUUID(),
      phase: 'baseline',
      answers: { baseline_1: 'a' },
      assistance: 'none',
    },
  });
  assert.equal((await call('/me')).body.enrollments[0].attempts.length, 1);
  advance(180 * 86400000);
  assert.equal((await call('/me')).body.enrollments.length, 1);
  advance(1);
  assert.equal((await call('/me')).body.enrollments.length, 0);
  await store.prune();
  await store.prune();
  assert.deepEqual(await store.attempts(1), []);
  assert.equal(
    (await call('/admin?window=all', { user: 3 })).body.studies[0].retainedCohort.participantCount,
    0,
  );
  assert.equal((await call('/studies')).body.studies[0].enrolled, false);
});

test('feedback clipping alone does not make independently complete stage eligibility unknown', () => {
  const study = {
    id: crypto.randomUUID(),
    ...validateStudy(definition()),
    createdAt: '2026-10-01T00:00:00Z',
  };
  const enrollments = [
    { userId: '1', studyId: study.id, goal: 'understand', joinedAt: '2026-10-01T00:00:00Z' },
  ];
  const rows = Array.from({ length: 10001 }, (_, index) => ({
    id: String(index),
    userId: '1',
    module: 'learning',
    purpose: 'understand',
    helpfulness: 3,
    barriers: ['none'],
  }));
  const result = researchSummary({
    feedback: rows,
    studies: [study],
    enrollments,
    attempts: [],
    registeredUserCount: 1,
  });
  assert.equal(result.dataCoverage.complete, false);
  assert.equal(result.feedback.responseCoverage, null);
  assert.equal(result.studies[0].stages[0].eligibility.available, true);
  assert.equal(result.studies[0].stages[0].eligibility.awaitingSubmissionCount, 1);
});
