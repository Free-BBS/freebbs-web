const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  createLearningAnalyticsRouter,
  createMemoryAnalyticsStore,
  createMysqlAnalyticsStore,
  recordAssessmentEvent,
  validateClientEvent,
  ensureLearningAnalyticsTables,
  journeyEvidence,
} = require('./learning-analytics');

const users = [
  { id: 1, username: '学生甲', is_admin: false },
  { id: 2, username: '学生乙', is_admin: false },
  { id: 3, username: '课程负责人', is_admin: false },
  { id: 4, username: '管理员', is_admin: true },
];
const contexts = [
  { course_id: 1, slug: 'signals', node_id: 'SS-01-01' },
  { course_id: 1, slug: 'signals', node_id: 'SS-01-02' },
  { course_id: 2, slug: 'private', node_id: 'PR-01-01', allowedUserIds: [2] },
  { course_id: 3, slug: 'inactive', node_id: 'IN-01-01', is_active: false },
];
const event = (overrides = {}) => ({
  requestKey: crypto.randomUUID(),
  courseSlug: 'signals',
  nodeId: 'SS-01-01',
  type: 'navigation',
  metadata: { action: 'visit', tool: 'content', sessionId: crypto.randomUUID() },
  ...overrides,
});
const businessAttempt = (overrides = {}) => ({
  id: '1',
  user_id: 1,
  course_id: 1,
  node_id: 'SS-01-01',
  is_official: 1,
  status: 'graded',
  verdict: 'pass',
  created_at: '2026-10-01T01:00:00Z',
  ...overrides,
});
const evidenceAttempt = (overrides = {}) =>
  businessAttempt({
    question_id: 'SS-01-01-Q1',
    document_version: 'a'.repeat(64),
    question_version: '1',
    ...overrides,
  });
const choiceEvent = (overrides = {}) =>
  event({
    type: 'action',
    metadata: {
      action: 'learning_start_set',
      level: 'new',
      goal: null,
      documentVersion: 'a'.repeat(64),
    },
    ...overrides,
  });
async function fixture(t, options = {}) {
  let now = new Date('2026-10-01T02:00:00Z');
  const store = createMemoryAnalyticsStore({ contexts, users, clock: () => now, ...options });
  const app = express();
  app.use(express.json());
  const requireAuth = async (req, res) => {
    const user = users.find((entry) => String(entry.id) === req.headers.authorization);
    if (!user) {
      res.status(401).json({ message: '需要登录' });
      return null;
    }
    return user;
  };
  const requireAdmin = async (req, res) => {
    const user = await requireAuth(req, res);
    if (user && !user.is_admin) {
      res.status(403).json({ message: '需要管理员权限' });
      return null;
    }
    return user;
  };
  app.use(
    '/api/learning-analytics',
    createLearningAnalyticsRouter({ store, requireAuth, requireAdmin }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  async function call(method, suffix, body, userId = 1) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/learning-analytics${suffix}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { Authorization: String(userId) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      data: await response.json(),
      cache: response.headers.get('cache-control'),
      retryAfter: response.headers.get('retry-after'),
    };
  }
  return {
    store,
    call,
    advance(seconds) {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

test('every personal and admin endpoint requires authentication and private cache control', async (t) => {
  const { call } = await fixture(t);
  for (const [method, suffix, body] of [
    ['GET', '/preferences'],
    ['PUT', '/preferences', { enabled: true }],
    ['POST', '/events', event()],
    ['GET', '/summary'],
    ['GET', '/export'],
    ['DELETE', '/events'],
    ['GET', '/admin/overview'],
  ]) {
    const result = await call(method, suffix, body, null);
    assert.equal(result.status, 401);
    assert.equal(result.cache, 'private, no-store');
  }
});

test('process collection defaults off and cannot be enabled with nonboolean or extra fields', async (t) => {
  const { call, store } = await fixture(t);
  assert.equal((await call('GET', '/preferences')).data.preferences.enabled, false);
  assert.deepEqual((await call('POST', '/events', event())).data, {
    recorded: false,
    reason: 'disabled',
  });
  assert.equal(store.rows.length, 0);
  for (const body of [
    { enabled: 'true' },
    { enabled: 1 },
    { enabled: true, userId: 2 },
    { enabled: true, note: 'private' },
  ])
    assert.equal((await call('PUT', '/preferences', body)).status, 400);
  assert.equal(
    (await call('PUT', '/preferences', { enabled: true })).data.preferences.enabled,
    true,
  );
});

test('enabled events are UUID-idempotent and changed payload is rejected', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  const body = event();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => call('POST', '/events', body)),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.data.duplicate).length, 11);
  assert.equal(store.rows.length, 1);
  assert.equal((await call('POST', '/events', { ...body, nodeId: 'SS-01-02' })).status, 409);
  assert.equal(
    (await call('POST', '/events', { ...body, requestKey: body.requestKey.toUpperCase() })).data
      .duplicate,
    true,
  );
});

test('the event API rejects client grades, timestamps, ownership and all free text', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  for (const key of [
    'score',
    'pass',
    'verdict',
    'timestamp',
    'createdAt',
    'userId',
    'source',
    'answer',
    'notes',
    'chat',
  ])
    assert.equal((await call('POST', '/events', { ...event(), [key]: 'forged' })).status, 400, key);
  for (const key of [
    'score',
    'answer',
    'note',
    'quote',
    'prompt',
    'url',
    'questionId',
    'verdict',
    'documentVersion',
  ])
    assert.equal(
      (await call('POST', '/events', event({ metadata: { action: 'visit', [key]: 'private' } })))
        .status,
      400,
      key,
    );
  for (const body of [
    event({ type: 'assessment' }),
    event({ metadata: { action: '任意私有文字' } }),
    event({ metadata: { action: 'visit', tool: 'chat secret' } }),
    event({ metadata: { action: 'visit', sessionId: 'bad' } }),
    event({ requestKey: '11111111-1111-1111-1111-111111111111' }),
  ])
    assert.equal((await call('POST', '/events', body)).status, 400);
  assert.equal(store.rows.length, 0);
});

test('course and node must exist, remain active and be accessible to the current user', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  for (const body of [
    event({ courseSlug: 'missing' }),
    event({ nodeId: 'SS-99-99' }),
    event({ courseSlug: 'inactive', nodeId: 'IN-01-01' }),
  ])
    assert.equal((await call('POST', '/events', body)).status, 404);
  assert.equal(
    (await call('POST', '/events', event({ courseSlug: 'private', nodeId: 'PR-01-01' }))).status,
    403,
  );
  assert.equal(store.rows.length, 0);
});

test('delta validation rejects excess, fractional, negative and nonengagement time', () => {
  for (const deltaSeconds of [-1, 31, 0.5, '30', null, Infinity]) {
    assert.throws(
      () =>
        validateClientEvent(
          event({ type: 'engagement', deltaSeconds, metadata: { sessionId: crypto.randomUUID() } }),
        ),
      { status: 400 },
    );
  }
  assert.throws(() => validateClientEvent(event({ deltaSeconds: 1 })), { status: 400 });
  assert.throws(
    () =>
      validateClientEvent(
        event({
          type: 'engagement',
          metadata: { sessionId: crypto.randomUUID(), action: 'visit' },
        }),
      ),
    { status: 400 },
  );
  assert.throws(
    () => validateClientEvent(event({ type: 'action', metadata: { action: 'visit' } })),
    { status: 400 },
  );
});

test('active seconds use server elapsed time and do not double-count rapid or parallel sessions', async (t) => {
  const { call, store, advance } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  advance(12);
  const body = event({
    type: 'engagement',
    deltaSeconds: 30,
    metadata: { tool: 'content', sessionId: crypto.randomUUID() },
  });
  const first = await call('POST', '/events', body);
  assert.equal(first.data.deltaSeconds, 12);
  const second = await call('POST', '/events', { ...body, requestKey: crypto.randomUUID() });
  assert.equal(second.data.deltaSeconds, 0);
  advance(30);
  const parallel = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(
        'POST',
        '/events',
        event({
          type: 'engagement',
          deltaSeconds: 30,
          metadata: { sessionId: crypto.randomUUID() },
        }),
      ),
    ),
  );
  assert.equal(
    parallel.reduce((sum, result) => sum + result.data.deltaSeconds, 0),
    30,
  );
  assert.equal(
    store.rows.reduce((sum, row) => sum + row.delta_seconds, 0),
    42,
  );
  assert.equal((await call('GET', '/summary?window=all')).data.process.activeSeconds, 42);
});

test('turning collection off stops browser and trusted events without deleting existing records', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await call('POST', '/events', event());
  await call('PUT', '/preferences', { enabled: false });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => call('POST', '/events', event())),
  );
  assert.ok(results.every((result) => result.data.recorded === false));
  assert.deepEqual(
    await recordAssessmentEvent(store, {
      user: users[0],
      context: contexts[0],
      attempt: { id: '1', official: true, status: 'graded', verdict: 'pass' },
    }),
    { recorded: false, reason: 'disabled' },
  );
  assert.equal(store.rows.length, 1);
});

test('student summary/export/delete always use their own identity, including injected selectors', async (t) => {
  const { call, store } = await fixture(t);
  for (const id of [1, 2]) {
    await call('PUT', '/preferences', { enabled: true }, id);
    await call('POST', '/events', event(), id);
  }
  assert.equal((await call('GET', '/summary?window=all&userId=2')).data.process.eventCount, 1);
  assert.equal((await call('GET', '/export?userId=2')).data.events.length, 1);
  assert.equal((await call('GET', '/export', undefined, 2)).data.events.length, 1);
  const deleted = await call('DELETE', '/events?userId=2');
  assert.equal(deleted.data.deleted, 1);
  assert.equal(deleted.data.preferences.enabled, false);
  assert.equal(store.rows.length, 1);
  assert.equal(String(store.rows[0].user_id), '2');
  assert.equal((await call('POST', '/events', event())).data.recorded, false);
});

test('delete versus record races cannot recreate process rows after deletion is acknowledged', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await Promise.all([
    ...Array.from({ length: 20 }, () => call('POST', '/events', event())),
    call('DELETE', '/events'),
  ]);
  assert.equal(store.rows.length, 0);
  assert.equal((await call('GET', '/preferences')).data.preferences.enabled, false);
});

test('business assessment results remain visible with consent off and survive analytics deletion', async (t) => {
  const businessAttempts = [
    businessAttempt(),
    businessAttempt({ id: '2', status: 'pending_review', verdict: null }),
    businessAttempt({ id: '3', is_official: 0, verdict: 'practice_only' }),
    businessAttempt({ id: '4', user_id: 2, verdict: 'fail' }),
  ];
  const { call, store } = await fixture(t, { businessAttempts });
  const summary = (await call('GET', '/summary?window=all')).data;
  assert.equal(summary.preferences.enabled, false);
  assert.equal(summary.process.eventCount, 0);
  assert.deepEqual(summary.selftest, {
    attempts: 3,
    officialAttempts: 2,
    passed: 1,
    failed: 0,
    pendingReview: 1,
    practiceAttempts: 1,
  });
  await call('DELETE', '/events');
  assert.equal(store.businessAttempts.length, 4);
  assert.deepEqual((await call('GET', '/summary?window=all')).data.selftest, summary.selftest);
  assert.deepEqual((await call('GET', '/export')).data.events, []);
});

test('explicit starting point, goal and path recording stays off without consent and accepts only bounded enums', async (t) => {
  const { call, store } = await fixture(t);
  assert.deepEqual((await call('POST', '/events', choiceEvent())).data, {
    recorded: false,
    reason: 'disabled',
  });
  assert.equal(store.rows.length, 0);
  await call('PUT', '/preferences', { enabled: true });
  assert.equal((await call('POST', '/events', choiceEvent())).status, 201);
  for (const metadata of [
    { action: 'learning_start_set', level: 'expert' },
    { action: 'learning_start_set', level: 'new', goal: 'review' },
    { action: 'learning_start_set', level: 'new', goal: 'private motivation' },
    { action: 'learning_start_set', level: 'new', pathType: 'custom' },
    { action: 'learning_start_set', goal: 'concepts' },
    { action: 'recommendation_choose', pathType: 'private path text' },
    { action: 'recommendation_choose' },
    { action: 'learning_start_set', level: 'new', documentVersion: 'not-a-version' },
    { action: 'visit', level: 'new' },
    { action: 'learning_start_set', level: 'new', assessmentRole: 'exploration' },
  ])
    assert.equal((await call('POST', '/events', choiceEvent({ metadata }))).status, 400);
  assert.equal(store.rows.length, 1);
  assert.equal((await call('POST', '/events', choiceEvent({ type: 'navigation' }))).status, 400);
});

test('person can inspect corrected starting points while admin cohorts retain the first explicit choice', async (t) => {
  const { call, store, advance } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await call('POST', '/events', choiceEvent());
  advance(1);
  await call(
    'POST',
    '/events',
    choiceEvent({ metadata: { action: 'learning_start_set', level: 'basic', goal: 'practice' } }),
  );
  store.businessAttempts.push(evidenceAttempt({ created_at: '2026-10-01T02:00:02Z' }));
  const own = (await call('GET', '/summary?window=all&userId=2')).data.journey;
  assert.equal(own.units.length, 1);
  assert.equal(own.units[0].initialChoice.level, 'new');
  assert.equal(own.units[0].currentChoice.level, 'basic');
  assert.equal(own.units[0].revisions, 1);
  assert.equal(own.units[0].officialAttempts, 1);
  const admin = (await call('GET', '/admin/overview?window=all', undefined, 4)).data.journey;
  assert.equal(admin.cohorts.length, 1);
  assert.equal(admin.cohorts[0].level, 'new');
  assert.equal(admin.cohorts[0].goal, null);
  assert.equal(admin.missingGoalUnits, 1);
  assert.equal(admin.revisedUnits, 1);
  assert.equal(admin.units, undefined);
  assert.doesNotMatch(
    JSON.stringify(admin),
    /userId|selectedAt|documentVersion|question_id|答案|SECRET/,
  );
  await call('DELETE', '/events');
  const erased = (await call('GET', '/summary?window=all')).data;
  assert.equal(erased.journey.units[0].currentChoice, null);
  assert.equal(erased.selftest.passed, 1);
});

test('journey denominator includes unclassified evidence and never defaults missing goals or retroactively attributes earlier work', () => {
  const choice = (id, metadata, node = 'SS-01-01') => ({
    id: String(id),
    user_id: 1,
    course_id: 1,
    course_slug: 'signals',
    node_id: node,
    event_type: 'action',
    event_source: 'browser',
    metadata_json: metadata,
    created_at: '2026-10-01T02:00:00Z',
  });
  const attempts = [
    evidenceAttempt({ id: '1', created_at: '2026-10-01T01:00:00Z' }),
    evidenceAttempt({ id: '2', created_at: '2026-10-01T03:00:00Z' }),
    evidenceAttempt({ id: '3', user_id: 2, created_at: '2026-10-01T03:00:00Z' }),
    evidenceAttempt({ id: '4', node_id: 'SS-01-02', created_at: '2026-10-01T03:00:00Z' }),
  ];
  const result = journeyEvidence(
    [choice(1, { action: 'learning_start_set', level: 'new', documentVersion: 'a'.repeat(64) })],
    attempts,
  );
  assert.equal(result.unit, 'learner_course_node');
  assert.equal(result.observedUnits, 3);
  assert.equal(result.learners, 2);
  assert.equal(result.classifiedUnits, 1);
  assert.equal(result.missingStartUnits, 2);
  assert.equal(result.missingGoalUnits, 1);
  assert.equal(result.preChoiceAttemptUnits, 1);
  assert.equal(result.cohorts[0].attemptedUnits, 1);
  assert.equal(result.cohorts[0].retryUnits, 0);
  assert.equal(result.cohorts[0].limitedSample, true);
  assert.equal(result.delayedReview.status, 'not_collected');
  assert.equal(result.transfer.status, 'not_collected');
});

test('cohort retries and corrections require formal graded same-question same-version evidence after choice', () => {
  const start = {
    id: '1',
    user_id: 1,
    course_id: 1,
    node_id: 'SS-01-01',
    event_type: 'action',
    event_source: 'browser',
    metadata_json: {
      action: 'learning_start_set',
      level: 'familiar',
      goal: 'practice',
      documentVersion: 'a'.repeat(64),
    },
    created_at: '2026-10-01T00:00:00Z',
  };
  const attempts = [
    evidenceAttempt({ id: '1', verdict: 'fail' }),
    evidenceAttempt({ id: '2', verdict: 'pass', question_version: '2' }),
    evidenceAttempt({ id: '3', verdict: 'pass', document_version: 'b'.repeat(64) }),
    evidenceAttempt({ id: '4', verdict: 'practice_only', is_official: 0 }),
    evidenceAttempt({ id: '5', verdict: null, status: 'pending_review' }),
  ];
  let cohort = journeyEvidence([start], attempts).cohorts[0];
  assert.equal(cohort.retryUnits, 0);
  assert.equal(cohort.correctedUnits, 0);
  attempts.push(evidenceAttempt({ id: '6', verdict: 'pass' }));
  cohort = journeyEvidence([start], attempts).cohorts[0];
  assert.equal(cohort.retryUnits, 1);
  assert.equal(cohort.correctedUnits, 1);
  assert.equal(cohort.practiceUnits, 1);
  assert.equal(cohort.gradedOfficialUnits, 1);
});

test('exploration choice is not participation; only trusted exploration attempts count and review is deduplicated', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await call('POST', '/events', choiceEvent());
  await call(
    'POST',
    '/events',
    choiceEvent({
      metadata: {
        action: 'recommendation_choose',
        pathType: 'alternative',
        goal: 'explore',
      },
    }),
  );
  const overview = async () =>
    (await call('GET', '/admin/overview?window=all', undefined, 4)).data.journey;
  assert.equal((await overview()).cohorts[0].explorationChoiceUnits, 1);
  assert.equal((await overview()).cohorts[0].explorationAttemptUnits, 0);
  store.businessAttempts.push(
    evidenceAttempt({
      id: '99',
      is_official: 0,
      verdict: 'practice_only',
      created_at: '2026-10-01T02:00:01Z',
    }),
  );
  for (const reviewed of [false, true])
    await recordAssessmentEvent(store, {
      user: users[0],
      context: contexts[0],
      reviewed,
      attempt: {
        id: '99',
        userId: '1',
        status: 'graded',
        verdict: 'practice_only',
        official: false,
        assessmentRole: 'exploration',
        documentVersion: 'a'.repeat(64),
      },
    });
  assert.equal((await overview()).cohorts[0].explorationAttemptUnits, 1);
  assert.equal(
    (await call('GET', '/summary?window=all')).data.journey.units[0].explorationAttempts,
    1,
  );
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        choiceEvent({
          metadata: {
            action: 'recommendation_choose',
            pathType: 'custom',
            assessmentRole: 'exploration',
          },
        }),
      )
    ).status,
    400,
  );
});

test('exploration review timestamp and same-millisecond attempts cannot manufacture post-choice participation', () => {
  const events = [
    {
      id: '1',
      user_id: 1,
      course_id: 1,
      node_id: 'SS-01-01',
      event_type: 'action',
      event_source: 'browser',
      metadata_json: { action: 'learning_start_set', level: 'new' },
      created_at: '2026-10-01T02:00:00Z',
    },
    {
      id: '2',
      user_id: 1,
      course_id: 1,
      node_id: 'SS-01-01',
      event_type: 'assessment',
      event_source: 'server',
      metadata_json: { attemptId: '99', assessmentRole: 'exploration', reviewed: true },
      created_at: '2026-10-01T03:00:00Z',
    },
  ];
  const result = journeyEvidence(events, [
    evidenceAttempt({
      id: '99',
      is_official: 0,
      verdict: 'practice_only',
      created_at: '2026-10-01T01:00:00Z',
    }),
    evidenceAttempt({ id: '100', created_at: '2026-10-01T02:00:00Z' }),
  ]);
  assert.equal(result.cohorts[0].explorationAttemptUnits, 0);
  assert.equal(result.cohorts[0].attemptedUnits, 0);
  assert.equal(result.preChoiceAttemptUnits, 1);
  assert.equal(result.ambiguousTimeUnits, 1);
});

test('minimal journey SQL is owner scoped, UTC-normalized, and does not read answers, chats or question snapshots', async () => {
  const queries = [];
  const store = createMysqlAnalyticsStore({
    async execute(sql, values) {
      queries.push({ sql, values });
      return [[]];
    },
  });
  const since = new Date('2026-10-01T00:00:00Z');
  await store.journeyEventRows(1, since);
  await store.journeyAttemptRows(1, since);
  assert.deepEqual(
    queries.map((query) => query.values),
    [
      [1, '2026-10-01 00:00:00.000'],
      [1, '2026-10-01 00:00:00.000'],
    ],
  );
  assert.match(queries[0].sql, /e.user_id = \?/);
  assert.match(queries[1].sql, /a.user_id = \?/);
  assert.match(queries[0].sql, /CAST\(e.created_at AS CHAR\)/);
  assert.match(queries[1].sql, /CAST\(a.created_at AS CHAR\)/);
  assert.doesNotMatch(JSON.stringify(queries), /answer_json|question_snapshot|chat|note|email/);
});

test('manual markers are separate from trusted assessment events and no stars are awarded', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await call(
    'POST',
    '/events',
    event({ type: 'action', metadata: { action: 'mark_learned', tool: 'content' } }),
  );
  const payload = {
    user: users[0],
    context: contexts[0],
    attempt: { id: '1', official: true, status: 'graded', verdict: 'pass' },
  };
  Object.defineProperty(payload.attempt, 'answer', {
    get() {
      throw new Error('private answer accessed');
    },
  });
  await recordAssessmentEvent(store, payload);
  await recordAssessmentEvent(store, payload);
  const summary = (await call('GET', '/summary?window=all')).data;
  assert.equal(summary.process.manualMarks, 1);
  assert.equal(summary.process.assessmentEvents, 1);
  assert.equal(summary.selftest.passed, 0);
  const exported = (await call('GET', '/export')).data;
  assert.equal(exported.events.find((row) => row.type === 'assessment').source, 'server');
  assert.doesNotMatch(JSON.stringify(exported), /answer|score|feedback|stars|能力分数/);
});

test('reviewed assessment process events belong to the student, not the course manager', async (t) => {
  const { call, store } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true }, 1);
  await recordAssessmentEvent(store, {
    user: users[2],
    context: contexts[0],
    reviewed: true,
    attempt: { id: '1', userId: '1', official: true, status: 'graded', verdict: 'pass' },
  });
  assert.equal((await call('GET', '/summary?window=all')).data.process.assessmentEvents, 1);
  assert.equal(
    (await call('GET', '/summary?window=all', undefined, 3)).data.process.assessmentEvents,
    0,
  );
  await assert.rejects(
    recordAssessmentEvent(store, {
      user: users[2],
      context: contexts[0],
      reviewed: true,
      attempt: { id: '2', official: true, status: 'graded', verdict: 'pass' },
    }),
    { status: 400 },
  );
});

test('admin overview is unavailable to students and course managers and exposes counts only', async (t) => {
  const privateBusiness = businessAttempt({
    answer_json: 'SECRET_ANSWER',
    feedback: 'SECRET_FEEDBACK',
  });
  const { call } = await fixture(t, { businessAttempts: [privateBusiness] });
  await call('PUT', '/preferences', { enabled: true });
  await call('POST', '/events', event());
  for (const user of [1, 2, 3])
    assert.equal((await call('GET', '/admin/overview?window=all', undefined, user)).status, 403);
  const admin = await call('GET', '/admin/overview?window=all', undefined, 4);
  assert.equal(admin.status, 200);
  assert.equal(admin.data.userCount, 4);
  assert.equal(admin.data.enabledUserCount, 1);
  assert.equal(admin.data.limitedSample, true);
  assert.equal(admin.data.users[0].nickname, '学生甲');
  assert.equal(admin.data.users[0].courseCount, 1);
  assert.equal(admin.data.selftest.passed, 1);
  assert.doesNotMatch(
    JSON.stringify(admin.data),
    /SECRET|answer|metadata|requestKey|rank|score|email/,
  );
});

test('effectiveness evidence separates official same-version change from practice, pending and missing follow-up', async (t) => {
  const businessAttempts = [
    evidenceAttempt({ id: '1', verdict: 'fail' }),
    evidenceAttempt({ id: '2', verdict: 'pass' }),
    evidenceAttempt({ id: '3', user_id: 2, verdict: 'pass' }),
    evidenceAttempt({ id: '4', user_id: 2, verdict: 'fail' }),
    evidenceAttempt({ id: '5', question_id: 'SS-01-01-Q2', verdict: 'fail' }),
    evidenceAttempt({
      id: '6',
      question_id: 'SS-01-01-Q2',
      is_official: 0,
      verdict: 'practice_only',
    }),
    evidenceAttempt({ id: '7', status: 'pending_review', verdict: null }),
    evidenceAttempt({ id: '8', user_id: 3, status: 'pending_review', verdict: null }),
    businessAttempt({ id: '9' }),
  ];
  const { call } = await fixture(t, { businessAttempts });
  const response = await call('GET', '/admin/overview?window=all', undefined, 4);
  const evidence = response.data.effectiveness;
  assert.equal(evidence.officialLearners, 3);
  assert.equal(evidence.gradedSequences, 3);
  assert.equal(evidence.comparableSequences, 2);
  assert.equal(evidence.comparableLearners, 2);
  assert.equal(evidence.failedComparableSequences, 1);
  assert.equal(evidence.failedComparableLearners, 1);
  assert.equal(evidence.improvedSequences, 1);
  assert.equal(evidence.improvedLearners, 1);
  assert.equal(evidence.notRetriedFailedSequences, 1);
  assert.equal(evidence.regressedSequences, 1);
  assert.equal(evidence.limitedSample, true);
  assert.equal(evidence.courses[0].comparableSequences, 2);
  assert.equal(evidence.scope, 'within_window_same_question_and_document_version');
  assert.match(evidence.interpretation, /不能单独证明平台因果效果/);
  assert.doesNotMatch(JSON.stringify(evidence), /user_id|question_id|answer|rank|percent/);
  assert.equal((await call('GET', '/summary?window=all')).data.effectiveness, undefined);
});

test('improvement never joins different students, nodes, courses, question IDs or either content version', async (t) => {
  const pairs = [
    { user_id: 2 },
    { course_id: 2 },
    { node_id: 'SS-01-02' },
    { question_id: 'SS-01-01-Q2' },
    { document_version: 'b'.repeat(64) },
    { question_version: '2' },
    { question_version: '1 ' },
  ];
  for (const difference of pairs) {
    const { call } = await fixture(t, {
      businessAttempts: [
        evidenceAttempt({ id: '1', verdict: 'fail' }),
        evidenceAttempt({ id: '2', verdict: 'pass', ...difference }),
      ],
    });
    const evidence = (await call('GET', '/admin/overview?window=all', undefined, 4)).data
      .effectiveness;
    assert.equal(evidence.comparableSequences, 0, JSON.stringify(difference));
    assert.equal(evidence.improvedSequences, 0, JSON.stringify(difference));
    assert.equal(evidence.notRetriedFailedSequences, 1, JSON.stringify(difference));
  }
});

test('first and last evidence both belong to the selected submission window, not all-time first attempts or review date', async (t) => {
  const now = new Date();
  const oldSubmission = new Date(now.getTime() - 90 * 86400000).toISOString();
  const { call } = await fixture(t, {
    businessAttempts: [
      evidenceAttempt({
        id: '1',
        verdict: 'fail',
        created_at: oldSubmission,
        updated_at: now.toISOString(),
      }),
      evidenceAttempt({ id: '2', verdict: 'pass', created_at: now.toISOString() }),
    ],
  });
  const recent = (await call('GET', '/admin/overview?window=7', undefined, 4)).data.effectiveness;
  assert.equal(recent.comparableSequences, 0);
  assert.equal(recent.improvedSequences, 0);
  const all = (await call('GET', '/admin/overview?window=all', undefined, 4)).data.effectiveness;
  assert.equal(all.comparableSequences, 1);
  assert.equal(all.improvedSequences, 1);
});

test('participation evidence counts authorized tool users and actions, without equating usage to benefit', async (t) => {
  const { call } = await fixture(t);
  await call('PUT', '/preferences', { enabled: true });
  await call('PUT', '/preferences', { enabled: true }, 2);
  for (const userId of [1, 1, 2])
    await call(
      'POST',
      '/events',
      event({ metadata: { action: 'tool_open', tool: 'notes' } }),
      userId,
    );
  await call(
    'POST',
    '/events',
    event({ type: 'action', metadata: { action: 'annotation_save', tool: 'notes' } }),
  );
  await call('POST', '/events', event({ metadata: { action: 'tool_open', tool: 'feedback' } }), 3);
  const evidence = (await call('GET', '/admin/overview?window=all', undefined, 4)).data
    .effectiveness;
  assert.deepEqual(evidence.tools, [{ tool: 'notes', users: 2, events: 3 }]);
  assert.deepEqual(evidence.actions, [{ action: 'annotation_save', users: 1, events: 1 }]);
  assert.equal(evidence.comparableSequences, 0);
});

test('export pagination includes all own analytics records without mixing another user', async (t) => {
  const { call, store, advance } = await fixture(t);
  await store.setPreferences(1, true);
  await store.setPreferences(2, true);
  for (let index = 0; index < 503; index += 1) {
    if (index && index % 120 === 0) advance(60);
    await store.record(1, contexts[0], validateClientEvent(event()));
  }
  await store.record(2, contexts[0], validateClientEvent(event()));
  const first = (await call('GET', '/export')).data;
  assert.equal(first.scope, 'learning_analytics_only');
  assert.equal(first.retentionDays, 180);
  assert.equal(first.events.length, 500);
  const second = (await call('GET', `/export?before=${first.nextCursor}`)).data;
  assert.equal(second.events.length, 3);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.events, ...second.events].map((row) => row.id)).size, 503);
  assert.equal((await call('GET', '/export?before=-1')).status, 400);
});

test('retention removes only analytics older than 180 days while retaining consent and business data', async (t) => {
  const { call, store, advance } = await fixture(t, { businessAttempts: [businessAttempt()] });
  await call('PUT', '/preferences', { enabled: true });
  await call('POST', '/events', event());
  advance(179 * 86400);
  await call('POST', '/events', event());
  advance(2 * 86400);
  const exported = (await call('GET', '/export')).data;
  assert.equal(exported.events.length, 1);
  assert.equal(exported.preferences.enabled, true);
  assert.equal(store.businessAttempts.length, 1);
});

test('invalid windows are rejected for both own and admin summary', async (t) => {
  const { call } = await fixture(t);
  for (const window of ['0', '90', 'all%20OR%201=1', '7&window=30']) {
    assert.equal((await call('GET', `/summary?window=${window}`)).status, 400);
    assert.equal((await call('GET', `/admin/overview?window=${window}`, undefined, 4)).status, 400);
  }
});

test('MySQL records lock preferences and deduplicate before insert with trusted server time', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {
      queries.push('begin');
    },
    async commit() {
      queries.push('commit');
    },
    async rollback() {
      queries.push('rollback');
    },
    release() {
      queries.push('release');
    },
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('FOR UPDATE')) return [[{ enabled: 1, elapsed_seconds: 5 }]];
      if (sql.includes('SELECT payload_hash')) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlAnalyticsStore({
    async getConnection() {
      return connection;
    },
  });
  const body = validateClientEvent(
    event({ type: 'engagement', deltaSeconds: 30, metadata: { sessionId: crypto.randomUUID() } }),
  );
  assert.equal((await store.record(1, contexts[0], body)).deltaSeconds, 5);
  assert.ok(queries[1].sql.includes('FOR UPDATE'));
  assert.ok(queries[2].sql.includes('SELECT payload_hash'));
  const insert = queries.find((query) =>
    query.sql?.includes('INSERT INTO learning_analytics_events'),
  );
  assert.ok(insert.sql.includes('UTC_TIMESTAMP(3)'));
  assert.equal(insert.values[5], 5);
  assert.deepEqual(queries.slice(-2), ['commit', 'release']);
});

test('MySQL deletes atomically disable recording first and never touch private business tables', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {
      /* Fake transaction starts. */
    },
    async commit() {
      queries.push('commit');
    },
    async rollback() {
      /* No writes in the fake connection. */
    },
    release() {
      /* No actual connection exists. */
    },
    async execute(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 2 }];
    },
  };
  const store = createMysqlAnalyticsStore({
    async getConnection() {
      return connection;
    },
  });
  assert.equal(await store.remove(1), 2);
  assert.match(queries[0].sql, /learning_analytics_preferences/);
  assert.match(queries[1].sql, /DELETE FROM learning_analytics_events WHERE user_id = \?/);
  assert.deepEqual(queries[1].values, [1]);
  assert.doesNotMatch(
    JSON.stringify(queries),
    /learning_entries|learning_assessment_attempts|ai_dialog|notes/,
  );
});

test('MySQL recording checks disabled consent under lock before touching the event table', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {
      queries.push('begin');
    },
    async commit() {
      queries.push('commit');
    },
    async rollback() {
      queries.push('rollback');
    },
    release() {
      queries.push('release');
    },
    async execute(sql) {
      queries.push(sql);
      return [[{ enabled: '0' }]];
    },
  };
  const store = createMysqlAnalyticsStore({
    async getConnection() {
      return connection;
    },
  });
  assert.deepEqual(await store.record(1, contexts[0], validateClientEvent(event())), {
    recorded: false,
    reason: 'disabled',
  });
  assert.equal(queries.length, 4);
  assert.match(queries[1], /FOR UPDATE/);
  assert.doesNotMatch(queries[1], /learning_analytics_events/);
  assert.deepEqual(queries.slice(-2), ['commit', 'release']);
});

test('MySQL conflicting UUID rolls back and releases the lock without inserting an event', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {
      queries.push('begin');
    },
    async commit() {
      queries.push('commit');
    },
    async rollback() {
      queries.push('rollback');
    },
    release() {
      queries.push('release');
    },
    async execute(sql) {
      queries.push(sql);
      if (sql.includes('FOR UPDATE')) return [[{ enabled: 1 }]];
      return [[{ payload_hash: 'another-payload' }]];
    },
  };
  const store = createMysqlAnalyticsStore({
    async getConnection() {
      return connection;
    },
  });
  await assert.rejects(store.record(1, contexts[0], validateClientEvent(event())), { status: 409 });
  assert.equal(
    queries.some((query) => query.includes('INSERT INTO')),
    false,
  );
  assert.deepEqual(queries.slice(-2), ['rollback', 'release']);
});

test('MySQL UTC timestamps bypass driver timezone conversion and are exported as UTC', async () => {
  const queries = [];
  const store = createMysqlAnalyticsStore({
    async execute(sql) {
      queries.push(sql);
      return [[{ enabled: 1, updated_at: '2026-10-01 02:00:00.123' }]];
    },
  });
  assert.equal((await store.preferences(1)).updatedAt, '2026-10-01T02:00:00.123Z');
  await store.exportRows(1, '9');
  assert.match(queries[0], /CAST\(updated_at AS CHAR\)/);
  assert.match(queries[1], /CAST\(e.created_at AS CHAR\)/);
});

test('migration initializes only analytics tables and aggregate SQL never selects private payloads', async () => {
  const statements = [];
  await ensureLearningAnalyticsTables({
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SHOW COLUMNS'))
        return [[{ Field: 'browser_window_started_at' }, { Field: 'browser_event_count' }]];
      if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'idx_learning_analytics_retention' }]];
      return [[]];
    },
  });
  assert.equal(statements.length, 4);
  assert.match(statements[0], /enabled TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(statements[1], /UNIQUE KEY uq_learning_analytics_request \(user_id, request_key\)/);
  assert.match(statements[1], /KEY idx_learning_analytics_retention \(created_at, id\)/);
  assert.equal(
    statements.some((sql) => sql.startsWith('ALTER')),
    false,
  );
  const queries = [];
  const store = createMysqlAnalyticsStore({
    async execute(sql, values) {
      queries.push({ sql, values });
      return [[]];
    },
  });
  await store.businessRows(1, new Date());
  await store.processRows(1, new Date());
  await store.assessmentEvidenceRows(new Date('2026-10-01T00:00:00Z'));
  await store.participationRows(new Date('2026-10-01T00:00:00Z'));
  await store.users();
  await store.prune();
  assert.ok(queries[0].sql.includes('a.user_id = ?'));
  assert.doesNotMatch(
    JSON.stringify(queries),
    /answer_json|question_snapshot|feedback|full_name|email|learning_entries/,
  );
  assert.match(queries[2].sql, /a\.document_version, BINARY a\.question_version/);
  assert.match(queries[2].sql, /a\.is_official = 1 AND a\.status = 'graded'/);
  assert.match(queries[2].sql, /MIN\(a\.id\).*first_id/);
  assert.deepEqual(queries[2].values, ['2026-10-01 00:00:00.000']);
  assert.deepEqual(queries[3].values, ['2026-10-01 00:00:00.000', '2026-10-01 00:00:00.000']);
  assert.match(queries[5].sql, /INTERVAL 180 DAY/);
  const source = fs.readFileSync(path.join(__dirname, 'learning-analytics.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /UPDATE learning_assessment_attempts|DELETE FROM learning_assessment_attempts|UPDATE users|learning_entries/,
  );
});

test('browser quota is per-user, permits idempotent retries, and resets after 60 seconds', async (t) => {
  const { call, store, advance } = await fixture(t);
  await store.setPreferences(1, true);
  await store.setPreferences(2, true);
  const body = event();
  await store.record(1, contexts[0], validateClientEvent(body));
  for (let index = 1; index < 120; index += 1)
    await store.record(
      1,
      contexts[index % 2],
      validateClientEvent(event({ nodeId: contexts[index % 2].node_id })),
    );
  const limited = await call('POST', '/events', event({ nodeId: 'SS-01-02' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfter, '60');
  assert.equal(limited.data.code, 'learning_analytics_rate_limited');
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        event({ type: 'action', metadata: { action: 'path_save', tool: 'continue' } }),
      )
    ).status,
    429,
  );
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        event({
          type: 'engagement',
          deltaSeconds: 10,
          metadata: { sessionId: crypto.randomUUID() },
        }),
      )
    ).status,
    429,
  );
  assert.equal((await call('POST', '/events', body)).data.duplicate, true);
  assert.equal((await call('POST', '/events', { ...body, nodeId: 'SS-01-02' })).status, 409);
  assert.equal((await call('POST', '/events', event(), 2)).status, 201);
  advance(20);
  assert.equal((await call('POST', '/events', event())).retryAfter, '40');
  advance(40);
  assert.equal((await call('POST', '/events', event())).status, 201);
  assert.equal(store.rows.filter((row) => row.user_id === 1).length, 121);
});

test('parallel requests cannot exceed quota and trusted assessments do not consume it', async (t) => {
  const { call, store } = await fixture(t);
  await store.setPreferences(1, true);
  for (let index = 0; index < 119; index += 1)
    await store.record(1, contexts[0], validateClientEvent(event()));
  const results = await Promise.all(
    Array.from({ length: 12 }, () => call('POST', '/events', event())),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 429).length, 11);
  for (let index = 1; index <= 125; index += 1)
    await recordAssessmentEvent(store, {
      user: users[0],
      context: contexts[0],
      attempt: { id: String(index), official: true, status: 'graded', verdict: 'pass' },
    });
  assert.equal(store.rows.length, 245);
  assert.equal((await call('POST', '/events', event())).status, 429);
});

test('disabled collection spends no quota, consent toggles cannot reset it, and controls remain usable', async (t) => {
  const { call, store } = await fixture(t);
  for (let index = 0; index < 130; index += 1)
    assert.equal(
      (await store.record(1, contexts[0], validateClientEvent(event()))).reason,
      'disabled',
    );
  assert.equal(store.quotaSize(), 0);
  await store.setPreferences(1, true);
  for (let index = 0; index < 120; index += 1)
    await store.record(1, contexts[0], validateClientEvent(event()));
  assert.equal((await call('GET', '/export')).status, 200);
  assert.equal((await call('GET', '/summary')).status, 200);
  assert.equal((await call('PUT', '/preferences', { enabled: false })).status, 200);
  assert.equal((await call('POST', '/events', event())).data.reason, 'disabled');
  await call('PUT', '/preferences', { enabled: true });
  assert.equal((await call('POST', '/events', event())).status, 429);
  assert.equal((await call('DELETE', '/events')).data.deleted, 120);
  assert.equal((await call('POST', '/events', event())).data.reason, 'disabled');
  await call('PUT', '/preferences', { enabled: true });
  assert.equal((await call('POST', '/events', event())).status, 429);
});

test('memory quota buckets expire and remain bounded without evicting an active user', async () => {
  let now = new Date('2026-10-01T02:00:00Z');
  const store = createMemoryAnalyticsStore({
    contexts,
    clock: () => now,
    browserQuotaMaxBuckets: 2,
  });
  for (const id of [1, 2, 3]) await store.setPreferences(id, true);
  for (const id of [1, 2]) await store.record(id, contexts[0], validateClientEvent(event()));
  await assert.rejects(store.record(3, contexts[0], validateClientEvent(event())), { status: 429 });
  assert.equal(store.quotaSize(), 2);
  await store.record(1, contexts[0], validateClientEvent(event()));
  now = new Date(now.getTime() + 60000);
  await store.record(3, contexts[0], validateClientEvent(event()));
  assert.equal(store.quotaSize(), 1);
});

test('browser quota cannot be avoided by switching courses', async (t) => {
  const { call, store } = await fixture(t);
  await store.setPreferences(2, true);
  for (let index = 0; index < 120; index += 1)
    await store.record(2, contexts[0], validateClientEvent(event()));
  assert.equal(
    (await call('POST', '/events', event({ courseSlug: 'private', nodeId: 'PR-01-01' }), 2)).status,
    429,
  );
});

test('MySQL quota is checked under the same preference lock, after UUID deduplication', async () => {
  const queries = [];
  let storedHash;
  let count = 119;
  const connection = {
    async beginTransaction() {
      queries.push('begin');
    },
    async commit() {
      queries.push('commit');
    },
    async rollback() {
      queries.push('rollback');
    },
    release() {
      queries.push('release');
    },
    async execute(sql, values) {
      queries.push(sql);
      if (sql.includes('FOR UPDATE'))
        return [[{ enabled: 1, browser_event_count: count, browser_window_seconds: 17 }]];
      if (sql.includes('SELECT payload_hash'))
        return [storedHash ? [{ payload_hash: storedHash }] : []];
      if (sql.includes('INSERT INTO learning_analytics_events')) storedHash = values.at(8);
      if (sql.includes('browser_event_count = browser_event_count + 1')) count += 1;
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlAnalyticsStore({
    async getConnection() {
      return connection;
    },
  });
  const body = validateClientEvent(event());
  await store.record(1, contexts[0], body);
  assert.equal(count, 120);
  queries.length = 0;
  assert.equal((await store.record(1, contexts[0], body)).duplicate, true);
  assert.equal(count, 120);
  assert.equal(
    queries.some((sql) => sql.startsWith('UPDATE')),
    false,
  );
  storedHash = undefined;
  queries.length = 0;
  await assert.rejects(store.record(1, contexts[0], validateClientEvent(event())), {
    status: 429,
    retryAfterSeconds: 43,
  });
  assert.match(queries[1], /FOR UPDATE/);
  assert.match(queries[2], /SELECT payload_hash/);
  assert.equal(
    queries.some((sql) => sql.startsWith('INSERT')),
    false,
  );
  assert.deepEqual(queries.slice(-2), ['rollback', 'release']);
  await store.record(1, contexts[0], {
    requestKey: crypto.randomUUID(),
    source: 'server',
    type: 'assessment',
    deltaSeconds: 0,
    metadata: {},
  });
  assert.equal(count, 120);
});

test('existing analytics schemas add only missing quota columns and the retention index', async () => {
  const statements = [];
  await ensureLearningAnalyticsTables({
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'browser_window_started_at' }]];
      return [[]];
    },
  });
  const alterations = statements.filter((sql) => sql.startsWith('ALTER'));
  assert.equal(alterations.length, 2);
  assert.match(alterations[0], /ADD COLUMN browser_event_count/);
  assert.doesNotMatch(alterations[0], /ADD COLUMN browser_window_started_at/);
  assert.match(alterations[1], /\(created_at, id\)/);
  await ensureLearningAnalyticsTables({
    async execute(sql) {
      if (sql.startsWith('ALTER')) {
        const error = new Error('another process initialized this field');
        error.code = sql.includes('ADD COLUMN') ? 'ER_DUP_FIELDNAME' : 'ER_DUP_KEYNAME';
        throw error;
      }
      return [[]];
    },
  });
});

test('independent MySQL store instances share the locked quota rather than process-local counters', async () => {
  let count = 119;
  let lock = Promise.resolve();
  const hashes = new Map();
  const pool = {
    async getConnection() {
      let unlock;
      return {
        async beginTransaction() {
          const previous = lock;
          lock = new Promise((resolve) => {
            unlock = resolve;
          });
          await previous;
        },
        async commit() {
          unlock();
        },
        async rollback() {
          unlock();
        },
        release() {
          /* The fake owns no sockets. */
        },
        async execute(sql, values) {
          if (sql.includes('FOR UPDATE'))
            return [[{ enabled: 1, browser_event_count: count, browser_window_seconds: 3 }]];
          if (sql.includes('SELECT payload_hash'))
            return [hashes.has(values[1]) ? [{ payload_hash: hashes.get(values[1]) }] : []];
          if (sql.includes('INSERT INTO learning_analytics_events'))
            hashes.set(values[7], values[8]);
          if (sql.includes('browser_event_count = browser_event_count + 1')) count += 1;
          return [{ affectedRows: 1 }];
        },
      };
    },
  };
  const stores = [createMysqlAnalyticsStore(pool), createMysqlAnalyticsStore(pool)];
  const results = await Promise.allSettled(
    Array.from({ length: 15 }, (_, index) =>
      stores[index % 2].record(1, contexts[0], validateClientEvent(event())),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    results
      .filter((result) => result.status === 'rejected')
      .every((result) => result.reason.status === 429),
  );
  assert.equal(count, 120);
  assert.equal(hashes.size, 1);
});
