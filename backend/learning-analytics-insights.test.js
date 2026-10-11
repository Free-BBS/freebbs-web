const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createMemoryAnalyticsStore,
  createMysqlAnalyticsStore,
  validateClientEvent,
  ensureLearningAnalyticsTables,
  personalInsights,
  analyticsDiagnostics,
  learningActivity,
  journeyEvidence,
} = require('./learning-analytics');

const context = {
  course_id: 1,
  course_slug: 'signals',
  course_name: '信号与系统',
  node_id: 'SS-01-01',
  node_name: '连续时间卷积',
};
const event = (overrides = {}) => ({
  id: '1',
  user_id: 1,
  ...context,
  event_type: 'navigation',
  event_source: 'browser',
  metadata_json: { action: 'visit', tool: 'content' },
  created_at: '2026-10-10T01:00:00Z',
  ...overrides,
});
const attempt = (overrides = {}) => ({
  id: '1',
  user_id: 1,
  ...context,
  question_id: 'SS-01-01-Q1',
  document_version: 'a'.repeat(64),
  question_version: '1',
  is_official: 1,
  status: 'graded',
  verdict: 'fail',
  created_at: '2026-10-10T01:00:01Z',
  ...overrides,
});
const clientEvent = (overrides = {}) =>
  validateClientEvent({
    requestKey: crypto.randomUUID(),
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    type: 'navigation',
    metadata: { action: 'visit', tool: 'content' },
    ...overrides,
  });

test('legacy off and new accounts migrate to the same minimal policy without backfilling elapsed time', async () => {
  let now = new Date('2026-10-10T01:00:00Z');
  const store = createMemoryAnalyticsStore({
    contexts: [context],
    users: [{ id: 1 }, { id: 2 }],
    clock: () => now,
    initialPreferences: [
      {
        user_id: 1,
        enabled: false,
        updated_at: '2026-01-01T00:00:00Z',
        last_engagement_at: new Date('2026-01-01T00:00:00Z'),
      },
    ],
  });
  for (const id of [1, 2, 3]) {
    const settings = await store.preferences(id);
    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.policy, {
      mode: 'required_minimal',
      version: 2,
      defaultEnabled: true,
      canDisable: false,
    });
    assert.equal(settings.updatedAt, now.toISOString());
    assert.equal(
      (
        await store.record(
          id,
          context,
          clientEvent({
            type: 'engagement',
            deltaSeconds: 30,
            metadata: { sessionId: crypto.randomUUID() },
          }),
        )
      ).deltaSeconds,
      0,
    );
  }
  now = new Date(now.getTime() + 6000);
  const original = (await store.preferences(1)).updatedAt;
  await store.setPreferences(1, true);
  assert.equal((await store.preferences(1)).updatedAt, original);
  assert.equal(
    (
      await store.record(
        1,
        context,
        clientEvent({
          type: 'engagement',
          deltaSeconds: 30,
          metadata: { sessionId: crypto.randomUUID() },
        }),
      )
    ).deltaSeconds,
    6,
  );
  await assert.rejects(store.setPreferences(1, false), { status: 409 });
});

test('clearing only analytics keeps mandatory recording and gives no pre-clear engagement credit', async () => {
  let now = new Date('2026-10-10T01:00:00Z');
  const businessAttempts = [attempt({ answer_json: 'PRIVATE_ANSWER' })];
  const store = createMemoryAnalyticsStore({
    contexts: [context],
    users: [{ id: 1 }],
    businessAttempts,
    clock: () => now,
  });
  await store.record(1, context, clientEvent());
  now = new Date(now.getTime() + 30000);
  assert.equal(await store.remove(1), 1);
  assert.equal((await store.preferences(1)).enabled, true);
  assert.equal(store.businessAttempts[0].answer_json, 'PRIVATE_ANSWER');
  assert.equal(
    (
      await store.record(
        1,
        context,
        clientEvent({
          type: 'engagement',
          deltaSeconds: 30,
          metadata: { sessionId: crypto.randomUUID() },
        }),
      )
    ).deltaSeconds,
    0,
  );
  assert.equal(store.rows.length, 1);
});

test('personal next steps rely on latest official submissions, not browser grades, time or practice', () => {
  const events = [
    event({
      delta_seconds: 100000,
      metadata_json: { action: 'mark_learned', verdict: 'pass', answer: 'PRIVATE_TEXT' },
    }),
  ];
  const rows = [
    attempt(),
    attempt({
      id: '2',
      is_official: 0,
      verdict: 'practice_only',
      created_at: '2026-10-10T01:00:02Z',
    }),
    attempt({
      id: '3',
      question_id: 'SS-01-01-Q2',
      status: 'pending_review',
      verdict: null,
      answer_json: 'PRIVATE_ANSWER',
      feedback: 'PRIVATE_FEEDBACK',
    }),
  ];
  const result = personalInsights(events, rows);
  assert.equal(result.waitingForRetryCount, 1);
  assert.equal(result.needsReviewCount, 1);
  assert.deepEqual(
    result.nextSteps.map((value) => [value.id, value.tool, value.quizView]),
    [
      ['revisit_recorded_question', 'feedback', 'mistakes'],
      ['pending_review', 'feedback', 'quick'],
    ],
  );
  assert.equal(result.nextSteps[0].courseName, '信号与系统');
  assert.equal(result.nextSteps[0].nodeName, '连续时间卷积');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|answer|score|mastery|level|rank/);
  const corrected = personalInsights(events, [
    ...rows,
    attempt({
      id: '4',
      verdict: 'pass',
      document_version: 'b'.repeat(64),
      created_at: '2026-10-10T01:00:03Z',
    }),
  ]);
  assert.equal(
    corrected.waitingForRetryCount,
    0,
    'A later observed official version does not resurrect an older failed question',
  );
  assert.equal(corrected.needsReviewCount, 1);
});

test('personal suggestions offer actual lightweight entry points without claiming formal success', () => {
  const cases = [
    { events: [event()], attempts: [], id: 'resume_reading', tool: 'content' },
    {
      events: [event({ event_type: 'action', metadata_json: { action: 'annotation_save' } })],
      attempts: [],
      id: 'review_annotation',
      tool: 'notes',
    },
    {
      events: [],
      attempts: [attempt({ is_official: 0, verdict: 'practice_only' })],
      id: 'continue_practice',
      tool: 'feedback',
    },
  ];
  for (const entry of cases) {
    const result = personalInsights(entry.events, entry.attempts);
    assert.equal(result.nextSteps[0].id, entry.id);
    assert.equal(result.nextSteps[0].tool, entry.tool);
    assert.equal(result.waitingForRetryCount, 0);
    assert.equal(result.needsReviewCount, 0);
    assert.match(result.interpretation, /不改变已保存路径/);
  }
  assert.deepEqual(personalInsights([], []).nextSteps, []);
});

test('coverage uses all accounts, ordered observed transitions and deduplicated question attention', () => {
  const events = [event(), event({ id: '2', user_id: 2 })];
  const rows = [
    attempt({ is_official: 0, verdict: 'practice_only' }),
    attempt({ id: '2', created_at: '2026-10-10T01:00:02Z' }),
    attempt({ id: '3', verdict: 'pass', created_at: '2026-10-10T01:00:03Z' }),
    attempt({ id: '4', user_id: 3, status: 'pending_review', verdict: null }),
  ];
  const result = analyticsDiagnostics(
    events,
    rows,
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, is_admin: true }],
    journeyEvidence(events, rows),
  );
  assert.deepEqual(result.coverage, {
    eligibleUsers: 4,
    processLearners: 2,
    businessLearners: 2,
    observedLearners: 3,
    businessOnlyLearners: 1,
    observedUnits: 3,
    denominator: 'all_account_users_not_student_enrolment_or_period_active_users',
    unit: 'users_except_observedUnits_learner_course_node',
  });
  assert.deepEqual(
    result.transitions.map((row) => [row.fromUnits, row.progressedUnits, row.ratio]),
    [
      [2, 1, 0.5],
      [1, 1, 1],
      [1, 1, 1],
    ],
  );
  assert.equal(result.attention[0].pendingReviewAttempts, 1);
  assert.equal(result.attention[0].waitingForRetryQuestions, 0);
  assert.equal(result.attention[0].nodeName, '连续时间卷积');
  assert.equal(result.transitions[0].label, '记录阅读 → 之后作答');
  assert.equal(result.quality.limitedSample, true);
  assert.equal(result.quality.startingPointOptional, true);
  assert.deepEqual(result.notCollected, ['delayedReview', 'transfer', 'causalEffect']);
  assert.doesNotMatch(JSON.stringify(result), /userId|question_id|answer|score|mastery|rank/);
});

test('same-time, before-reading and cross-version attempts are not fabricated into conversion', () => {
  const events = [event()];
  const rows = [
    attempt({ is_official: 0, verdict: 'practice_only', created_at: events[0].created_at }),
    attempt({ id: '2', document_version: 'b'.repeat(64), created_at: '2026-10-10T01:00:00Z' }),
  ];
  const result = analyticsDiagnostics(events, rows, [{ id: 1 }], journeyEvidence(events, rows));
  assert.equal(result.transitions[0].progressedUnits, 0);
  assert.equal(result.transitions[1].progressedUnits, 0);
  const empty = analyticsDiagnostics([], [], [], journeyEvidence([], []));
  assert.ok(empty.transitions.every((row) => row.ratio === null));
  assert.equal(empty.quality.limitedSample, true);
});

test('Beijing activity groups attempts across UTC midnight, excludes older display days and marks absence', () => {
  const now = new Date('2026-10-11T08:00:00Z');
  const result = learningActivity(
    [
      { date: '2026-10-11', visits: '2', active_seconds: '45' },
      { date: '2026-09-01', visits: 1, active_seconds: 3 },
    ],
    [
      attempt({ created_at: '2026-10-10T16:00:00Z' }),
      attempt({ id: '2', created_at: '2026-10-10T15:59:59Z' }),
    ],
    now,
  );
  assert.deepEqual(result.days, [
    { date: '2026-10-10', visits: 0, activeSeconds: 0, attempts: 1 },
    { date: '2026-10-11', visits: 2, activeSeconds: 45, attempts: 1 },
  ]);
  assert.equal(result.timezone, 'Asia/Shanghai');
  assert.equal(result.earlierRecordedDays, 1);
  assert.equal(result.from, '2026-09-28');
  assert.equal(result.to, '2026-10-11');
  assert.equal(result.fromDate, result.from);
  assert.equal(result.toDate, result.to);
  assert.deepEqual(learningActivity([], [], now).days, []);
  assert.match(result.interpretation, /空日期不等于没有学习/);
});

test('MySQL activity and personal evidence are owner/window scoped and never query private texts', async () => {
  const queries = [];
  const store = createMysqlAnalyticsStore({
    async execute(sql, values) {
      queries.push({ sql, values });
      return [[]];
    },
  });
  const since = new Date('2026-10-01T02:00:00Z');
  await store.activityRows(1, since);
  await store.journeyAttemptRows(1, since);
  await store.journeyEventRows(1, since);
  await store.assessmentEvidenceRows(since, 1);
  await store.participationRows(since, 1);
  assert.match(queries[0].sql, /INTERVAL 8 HOUR/);
  assert.match(queries[0].sql, /e.user_id = \?/);
  assert.match(queries[0].sql, /e.created_at >= \?/);
  assert.deepEqual(queries[0].values, [1, '2026-10-01 02:00:00.000']);
  assert.match(queries[1].sql, /c.name AS course_name/);
  assert.match(queries[1].sql, /n.title AS node_name/);
  assert.match(queries[1].sql, /LEFT JOIN course_map_nodes/);
  assert.match(
    queries[2].sql,
    /'tool', JSON_UNQUOTE\(JSON_EXTRACT\(e.metadata_json, '\$\.tool'\)\)/,
  );
  assert.deepEqual(queries[3].values, [1, '2026-10-01 02:00:00.000']);
  assert.match(queries[3].sql, /AND a.user_id = \?/);
  assert.deepEqual(queries[4].values, [1, '2026-10-01 02:00:00.000', 1, '2026-10-01 02:00:00.000']);
  assert.equal(queries[4].sql.match(/AND e.user_id = \?/g).length, 2);
  assert.doesNotMatch(
    JSON.stringify(queries),
    /answer_json|question_snapshot|feedback|learning_entries|ai_dialog|email/,
  );
});

test('unattributed practice is unknown, not falsely counted as no exploration; attribution stays owner and node scoped', () => {
  const rows = [attempt({ is_official: 0, verdict: 'practice_only' })];
  const role = (assessmentRole, overrides = {}) =>
    event({
      event_type: 'assessment',
      event_source: 'server',
      metadata_json: { attemptId: '1', assessmentRole },
      ...overrides,
    });
  for (const scenario of [
    { events: [], known: false, count: 0, unknown: 1 },
    { events: [role('practice')], known: true, count: 0, unknown: 0 },
    { events: [role('exploration')], known: true, count: 1, unknown: 0 },
    { events: [role('exploration', { user_id: 2 })], known: false, count: 0, unknown: 1 },
    { events: [role('exploration', { node_id: 'SS-01-02' })], known: false, count: 0, unknown: 1 },
    {
      events: [role('exploration', { event_source: 'browser' })],
      known: false,
      count: 0,
      unknown: 1,
    },
  ]) {
    const journey = journeyEvidence(scenario.events, rows, { personal: true });
    const unit = journey.units.find(
      (value) => value.nodeId === context.node_id && value.attempts === 1,
    );
    assert.equal(unit.explorationEvidenceKnown, scenario.known);
    assert.equal(unit.explorationAttempts, scenario.count);
    assert.equal(unit.explorationUnattributedAttempts, scenario.unknown);
    assert.equal(
      analyticsDiagnostics(scenario.events, rows, [], journey).quality
        .explorationUnattributedAttempts,
      scenario.unknown,
    );
  }
});

test('memory and stateful MySQL transaction adapters agree on activation, elapsed credit, duplicate, conflict, clear and retained quota', async () => {
  let now = new Date('2026-10-10T01:00:00Z');
  const settings = new Map([
    [
      1,
      {
        enabled: 0,
        updated_at: '2026-01-01T00:00:00Z',
        last: new Date('2026-01-01T00:00:00Z'),
        count: 0,
        window: null,
      },
    ],
  ]);
  let sqlRows = [];
  let snapshot;
  let serial = 0;
  const connection = {
    async beginTransaction() {
      snapshot = { settings: structuredClone(settings), rows: structuredClone(sqlRows) };
    },
    async commit() {
      snapshot = null;
    },
    async rollback() {
      settings.clear();
      for (const [id, row] of snapshot.settings) settings.set(id, row);
      sqlRows = snapshot.rows;
    },
    release() {},
    async execute(raw, values) {
      const sql = raw.replace(/\s+/g, ' ').trim();
      const userId = values?.[0];
      if (sql.startsWith('INSERT INTO learning_analytics_preferences')) {
        let row = settings.get(userId);
        if (!row) {
          row = { enabled: 0, count: 0, window: null };
          settings.set(userId, row);
        }
        if (!sql.includes('IF(enabled') || Number(row.enabled) !== 1) {
          row.last = new Date(now);
          row.updated_at = new Date(now);
        }
        row.enabled = 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM learning_analytics_preferences')) {
        const row = settings.get(userId);
        if (!sql.includes('FOR UPDATE')) return [[row]];
        return [
          [
            {
              enabled: row.enabled,
              browser_event_count: row.count,
              browser_window_seconds: row.window ? (now - row.window) / 1000 : null,
              elapsed_seconds: Math.max(0, (now - row.last) / 1000),
            },
          ],
        ];
      }
      if (sql.startsWith('SELECT payload_hash'))
        return [sqlRows.filter((row) => row.user_id === userId && row.request_key === values[1])];
      if (sql.startsWith('INSERT INTO learning_analytics_events')) {
        serial += 1;
        sqlRows.push({
          id: String(serial),
          user_id: userId,
          course_id: values[1],
          node_id: values[2],
          event_type: values[3],
          event_source: values[4],
          delta_seconds: values[5],
          metadata_json: JSON.parse(values[6]),
          request_key: values[7],
          payload_hash: values[8],
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE learning_analytics_preferences')) {
        const row = settings.get(userId);
        if (sql.includes('browser_window_started_at')) {
          row.window = new Date(now);
          row.count = 1;
        } else if (sql.includes('browser_event_count')) row.count += 1;
        else if (sql.includes('last_engagement_at')) row.last = new Date(now);
        else assert.fail(`Unexpected update: ${sql}`);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM learning_analytics_events')) {
        const previous = sqlRows.length;
        sqlRows = sqlRows.filter((row) => row.user_id !== userId);
        return [{ affectedRows: previous - sqlRows.length }];
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    },
  };
  const mysql = createMysqlAnalyticsStore({
    execute: (...args) => connection.execute(...args),
    async getConnection() {
      return connection;
    },
  });
  const memory = createMemoryAnalyticsStore({
    contexts: [context],
    users: [{ id: 1 }],
    clock: () => now,
    initialPreferences: [
      { user_id: 1, enabled: false, last_engagement_at: new Date('2026-01-01T00:00:00Z') },
    ],
  });
  assert.deepEqual(await mysql.preferences(1), await memory.preferences(1));
  const bothRecord = async (value) => {
    const results = await Promise.all([
      mysql.record(1, context, value),
      memory.record(1, context, value),
    ]);
    assert.deepEqual(results[0], results[1]);
    return results[0];
  };
  const first = clientEvent();
  await bothRecord(first);
  await bothRecord(first);
  for (const store of [mysql, memory])
    await assert.rejects(
      store.record(1, context, { ...first, metadata: { action: 'tool_open', tool: 'notes' } }),
      { status: 409 },
    );
  now = new Date(now.getTime() + 9000);
  const engagement = () =>
    clientEvent({
      type: 'engagement',
      deltaSeconds: 30,
      metadata: { sessionId: crypto.randomUUID() },
    });
  assert.equal((await bothRecord(engagement())).deltaSeconds, 9);
  assert.equal(await mysql.remove(1), await memory.remove(1));
  assert.equal((await bothRecord(engagement())).deltaSeconds, 0);
  let filled = 0;
  for (;;) {
    const value = clientEvent();
    const results = await Promise.allSettled([
      mysql.record(1, context, value),
      memory.record(1, context, value),
    ]);
    assert.equal(results[0].status, results[1].status);
    if (results[0].status === 'rejected') {
      assert.equal(results[0].reason.status, 429);
      assert.equal(results[1].reason.status, 429);
      break;
    }
    filled += 1;
    assert.ok(filled < 120);
  }
  assert.equal(
    filled,
    117,
    'Clear did not reset the two pre-clear requests and one post-clear request quota',
  );
  assert.equal(await mysql.remove(1), await memory.remove(1));
  for (const store of [mysql, memory]) {
    assert.equal((await store.preferences(1)).enabled, true);
    await assert.rejects(store.setPreferences(1, false), { status: 409 });
    await assert.rejects(store.record(1, context, clientEvent()), { status: 429 });
  }
  now = new Date(now.getTime() + 60000);
  await bothRecord(clientEvent());
  assert.equal(sqlRows.length, memory.rows.length);
  assert.equal(sqlRows[0].delta_seconds, memory.rows[0].delta_seconds);
  assert.equal(sqlRows[0].request_key, memory.rows[0].request_key);
});

test('missing authoritative assessment tables are marked unavailable, not mistaken for zero achievement', async () => {
  const store = createMysqlAnalyticsStore({
    async execute() {
      const error = new Error('table not installed');
      error.code = 'ER_NO_SUCH_TABLE';
      throw error;
    },
  });
  const rows = await store.journeyAttemptRows(1, null);
  assert.equal(rows.available, false);
  assert.equal(personalInsights([], rows).assessmentDataStatus, 'not_available');
  assert.equal(
    analyticsDiagnostics([], rows, [], journeyEvidence([], rows)).quality.assessmentDataStatus,
    'not_available',
  );
  assert.equal(learningActivity([], rows).assessmentDataStatus, 'not_available');
});

test('deployment activation is repeatable, covers legacy off and missing users, and leaves business data and quotas untouched', async () => {
  const statements = [];
  const preferences = new Map([
    [1, { enabled: 0, last: 'old', updated: 'old', quota: 119 }],
    [2, { enabled: 1, last: 'keep', updated: 'keep', quota: 33 }],
  ]);
  let clock = 'migration-one';
  const pool = {
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SHOW COLUMNS'))
        return [[{ Field: 'browser_window_started_at' }, { Field: 'browser_event_count' }]];
      if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'idx_learning_analytics_retention' }]];
      if (sql.startsWith('UPDATE learning_analytics_preferences'))
        for (const row of preferences.values())
          if (row.enabled !== 1) {
            row.enabled = 1;
            row.last = clock;
            row.updated = clock;
          }
      if (sql.includes('SELECT u.id, 1'))
        for (const id of [1, 2, 3])
          if (!preferences.has(id))
            preferences.set(id, { enabled: 1, last: clock, updated: clock, quota: 0 });
      return [{ affectedRows: 0 }];
    },
  };
  await ensureLearningAnalyticsTables(pool);
  clock = 'migration-two';
  await ensureLearningAnalyticsTables(pool);
  assert.deepEqual(preferences.get(1), {
    enabled: 1,
    last: 'migration-one',
    updated: 'migration-one',
    quota: 119,
  });
  assert.deepEqual(preferences.get(2), { enabled: 1, last: 'keep', updated: 'keep', quota: 33 });
  assert.deepEqual(preferences.get(3), {
    enabled: 1,
    last: 'migration-one',
    updated: 'migration-one',
    quota: 0,
  });
  assert.doesNotMatch(
    statements.slice(4).join('\n'),
    /answer|learning_entries|assessment_attempts|ai_dialog|browser_event_count\s*=/,
  );
  assert.match(statements.join('\n'), /ALTER COLUMN enabled SET DEFAULT 1/);
  assert.match(
    fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'),
    /await ensureLearningAnalyticsTables\(pool\)/,
  );
});
