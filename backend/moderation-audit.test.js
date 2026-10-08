const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const { createModerationAudit, validateLabel } = require('./moderation-audit');
const { createModerationRouter } = require('./moderation-router');
const { POLICY_VERSION } = require('./moderation-policy');

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RUN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQUEST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const HASH = 'd'.repeat(64);
const clearLabel = () => ({
  decision: 'no_risk_detected',
  categories: [],
  ruleIds: [],
  supportPriority: 'none',
});
const riskLabel = () => ({
  decision: 'high_risk',
  categories: ['harassment'],
  ruleIds: ['骚扰-001'],
  supportPriority: 'none',
});
const feedbackBody = () => ({
  ...riskLabel(),
  verdict: 'correct',
  note: '依据围攻语境纠正机器意见',
  requestId: REQUEST_ID,
});
const regressionBody = () => ({
  ...riskLabel(),
  expectedDecision: 'high_risk',
  title: '虚构围攻样例',
  content: '合成例子：大家每天在这位虚构同学的帖子下羞辱他。',
  reason: '独立重写的虚构场景，测试围攻识别',
  syntheticConfirmed: true,
  requestId: REQUEST_ID,
});

function harness(options = {}) {
  const events = [];
  const inserts = [];
  const state = {
    reviewer: true,
    row: {
      id: ID,
      status: 'pending',
      version: 1,
      content_hash: HASH,
      expired: 0,
      expires_at: '2026-11-01 00:00:00.000',
      evidence_purged_at: null,
      payload_json: JSON.stringify({
        title: '不可自动导出标题',
        content: '不可自动导出的原稿内容',
      }),
    },
    run: {
      id: RUN_ID,
      submission_id: ID,
      expired: 0,
      result_json: JSON.stringify({
        policyVersion: POLICY_VERSION,
        assessment: { ...clearLabel(), ruleMatches: [], reason: '原机器结论' },
      }),
    },
    runCount: 0,
    feedbackCount: 0,
    caseCount: 0,
    existingFeedback: [],
    existingCases: [],
    reviews: [],
    exports: [],
    skippedLegacyCount: 0,
    ...options,
  };
  const db = {
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
    async execute(sql, args = []) {
      events.push({ sql, args });
      if (sql.startsWith('SELECT user_id FROM moderation_reviewers'))
        return [state.reviewer ? [{ user_id: 7 }] : []];
      if (sql.startsWith('SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_submissions'))
        return [state.row ? [state.row] : []];
      if (sql.startsWith('SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_ai_runs'))
        return [state.run ? [state.run] : []];
      if (sql.startsWith('SELECT COUNT(*) AS total FROM moderation_ai_runs'))
        return [[{ total: state.runCount }]];
      if (sql.startsWith('SELECT COUNT(*) AS total FROM moderation_ai_feedback'))
        return [[{ total: state.feedbackCount }]];
      if (sql.startsWith('SELECT COUNT(*) AS total FROM moderation_regression_cases'))
        return [[{ total: state.caseCount }]];
      if (sql.startsWith('SELECT * FROM moderation_ai_feedback WHERE reviewer_id'))
        return [state.existingFeedback];
      if (sql.startsWith('SELECT * FROM moderation_regression_cases WHERE reviewer_id'))
        return [state.existingCases];
      if (sql.startsWith('SELECT * FROM moderation_ai_feedback WHERE run_id'))
        return [state.reviews];
      if (sql.startsWith('SELECT c.id, c.case_json FROM moderation_regression_cases'))
        return [state.exports];
      if (sql.startsWith('SELECT COUNT(*) AS skipped FROM moderation_regression_cases'))
        return [[{ skipped: state.skippedLegacyCount }]];
      if (sql.startsWith('INSERT INTO')) {
        inserts.push({ sql, args });
        return [{ insertId: 9 }];
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  const audit = createModerationAudit({ pool: { getConnection: async () => db } });
  return { audit, state, events, inserts };
}

const expectStatus = (status) => (error) => error.status === status;

test('human labels allow independent nonpunitive attention and urgent support', () => {
  assert.deepEqual(validateLabel(clearLabel()), clearLabel());
  for (const [ruleId, priority] of [
    ['关怀-001', 'attention'],
    ['关怀-002', 'urgent'],
  ]) {
    const value = { ...clearLabel(), ruleIds: [ruleId], supportPriority: priority };
    assert.deepEqual(validateLabel(value), value);
  }
  assert.deepEqual(validateLabel(riskLabel()), riskLabel());
  assert.deepEqual(validateLabel({ ...clearLabel(), decision: 'needs_review' }), {
    ...clearLabel(),
    decision: 'needs_review',
  });
});

test('human labels cannot invent rules, unsupported categories or punitive support outcomes', () => {
  const invalid = [
    { ...riskLabel(), ruleIds: ['UNKNOWN-001'] },
    { ...riskLabel(), ruleIds: ['骚扰-001', '骚扰-001'] },
    { ...riskLabel(), categories: ['harassment', 'fraud'] },
    { ...riskLabel(), ruleIds: [] },
    { ...riskLabel(), categories: ['political_compliance'], ruleIds: ['政治内容-001'] },
    { ...riskLabel(), categories: ['self_harm'], ruleIds: ['关怀-002'], supportPriority: 'urgent' },
    { ...clearLabel(), ruleIds: ['关怀-002'], supportPriority: 'none' },
    { ...clearLabel(), ruleIds: ['关怀-001'], supportPriority: 'urgent' },
    { ...clearLabel(), supportPriority: 'attention' },
  ];
  for (const value of invalid)
    assert.throws(() => validateLabel(value), expectStatus(400), JSON.stringify(value));
});

test('audit access rechecks current reviewer membership before accessing evidence', async () => {
  for (const method of ['prepare', 'history', 'exportRegressions']) {
    const h = harness({ reviewer: false });
    await assert.rejects(
      h.audit[method]({ id: ID, reviewerId: 7, snapshot: { version: 1, contentHash: HASH } }),
      expectStatus(403),
    );
    assert.equal(h.events.filter((entry) => entry.sql).length, 1);
    assert.deepEqual(h.events.slice(-2), ['rollback', 'release']);
    assert.equal(h.inserts.length, 0);
  }
});

test('expired, purged or stale submissions cannot prepare a provider request or record its result', async () => {
  const changes = [
    [{ expired: 1 }, 410],
    [{ evidence_purged_at: '2026-10-08' }, 410],
    [{ payload_json: null }, 410],
    [{ status: 'approved' }, 409],
    [{ version: 2 }, 409],
    [{ content_hash: 'e'.repeat(64) }, 409],
  ];
  for (const [change, status] of changes) {
    const h = harness();
    Object.assign(h.state.row, change);
    const input = {
      id: ID,
      reviewerId: 7,
      snapshot: { version: 1, contentHash: HASH },
      input: {},
      result: {},
    };
    await assert.rejects(h.audit.prepare(input), expectStatus(status));
    await assert.rejects(h.audit.record(input), expectStatus(status));
    assert.equal(h.inserts.length, 0);
  }
});

test('validated run persists input digest and allowed result metadata without whole input or provider secrets', async () => {
  const h = harness();
  const input = { title: 'PRIVATE_INPUT_TITLE', content: 'PRIVATE_INPUT_BODY' };
  const runId = await h.audit.record({
    id: ID,
    reviewerId: 7,
    snapshot: { version: 1, contentHash: HASH },
    input,
    result: {
      version: 1,
      contentHash: HASH,
      inputMode: 'redacted',
      assessment: { ...clearLabel(), reason: '未见风险' },
      model: 'fixture-model',
      settingsRevision: 2,
      policyVersion: POLICY_VERSION,
      imageCount: 0,
      apiKey: 'NEVER_PERSIST_KEY',
      rawReasoning: 'NEVER_PERSIST_REASONING',
      rawInput: input,
    },
  });
  assert.match(runId, /^[a-f0-9-]{36}$/);
  assert.equal(h.inserts.length, 1);
  const args = h.inserts[0].args;
  assert.equal(args[5], crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'));
  const stored = JSON.parse(args[6]);
  assert.equal(stored.automaticPublication, false);
  assert.equal(stored.imagesReviewed, false);
  assert.equal(args[7], h.state.row.expires_at);
  assert.doesNotMatch(args[6], /PRIVATE_INPUT|NEVER_PERSIST/);
  assert.deepEqual(h.events.slice(-2), ['commit', 'release']);
});

test('record cap is rechecked after provider completion', async () => {
  const h = harness({ runCount: 50 });
  await assert.rejects(
    h.audit.record({
      id: ID,
      reviewerId: 7,
      snapshot: { version: 1, contentHash: HASH },
      input: {},
      result: {},
    }),
    expectStatus(429),
  );
  assert.equal(h.inserts.length, 0);
});

test('feedback retries reuse their prior result and reject changed content', async () => {
  const h = harness();
  const body = feedbackBody();
  assert.deepEqual(await h.audit.feedback({ id: ID, runId: RUN_ID, reviewerId: 7, body }), {
    id: '9',
    replayed: false,
  });
  const stored = JSON.parse(h.inserts[0].args[4]);
  assert.equal(stored.policyVersion, POLICY_VERSION);
  const submitted = { verdict: body.verdict, ...validateLabel(body), note: body.note };
  assert.equal(
    h.inserts[0].args[3],
    crypto
      .createHash('sha256')
      .update(JSON.stringify({ id: ID, runId: RUN_ID, value: submitted }))
      .digest('hex'),
  );
  h.state.existingFeedback = [{ id: 9, request_hash: h.inserts[0].args[3] }];
  assert.deepEqual(await h.audit.feedback({ id: ID, runId: RUN_ID, reviewerId: 7, body }), {
    id: '9',
    replayed: true,
  });
  await assert.rejects(
    h.audit.feedback({
      id: ID,
      runId: RUN_ID,
      reviewerId: 7,
      body: { ...body, note: '不同的复核说明' },
    }),
    expectStatus(409),
  );
  assert.equal(h.inserts.length, 1);
});

test('agree feedback cannot silently change the machine label', async () => {
  const h = harness();
  await assert.rejects(
    h.audit.feedback({
      id: ID,
      runId: RUN_ID,
      reviewerId: 7,
      body: { ...feedbackBody(), verdict: 'agree' },
    }),
    expectStatus(400),
  );
  assert.equal(h.inserts.length, 0);
});

test('old-policy runs can be corrected under current Chinese rules without rewriting historical evidence', async () => {
  for (const [oldAssessment, currentLabel] of [
    [
      { ...riskLabel(), categories: ['harassment'], ruleMatches: [{ ruleId: 'HAR-001' }] },
      riskLabel(),
    ],
    [{ ...clearLabel(), ruleMatches: [{ ruleId: 'EXP-001' }] }, clearLabel()],
    [
      {
        ...clearLabel(),
        decision: 'needs_review',
        categories: ['other'],
        ruleMatches: [{ ruleId: 'GEN-001' }],
      },
      { ...clearLabel(), decision: 'needs_review' },
    ],
  ]) {
    const h = harness();
    const originalJson = JSON.stringify({
      policyVersion: 'freebbs-policy-2026-10-08-v1',
      assessment: oldAssessment,
    });
    h.state.run.result_json = originalJson;
    for (const label of [
      currentLabel,
      {
        decision: oldAssessment.decision,
        categories: oldAssessment.categories,
        ruleIds: oldAssessment.ruleMatches.map((match) => match.ruleId),
        supportPriority: oldAssessment.supportPriority,
      },
    ]) {
      await assert.rejects(
        h.audit.feedback({
          id: ID,
          runId: RUN_ID,
          reviewerId: 7,
          body: { ...feedbackBody(), ...label, verdict: 'agree' },
        }),
        (error) => error.status === 409 && /旧版规则.*纠正/.test(error.message),
      );
    }
    await h.audit.feedback({
      id: ID,
      runId: RUN_ID,
      reviewerId: 7,
      body: { ...feedbackBody(), ...currentLabel, verdict: 'correct' },
    });
    const saved = JSON.parse(h.inserts[0].args[4]);
    assert.equal(saved.policyVersion, POLICY_VERSION);
    assert.deepEqual(saved.ruleIds, currentLabel.ruleIds);
    assert.equal(h.state.run.result_json, originalJson);
  }
});

test('uncategorized human review requires a concrete note even when agreeing with a machine concern', async () => {
  const h = harness();
  const label = { ...clearLabel(), decision: 'needs_review' };
  h.state.run.result_json = JSON.stringify({
    policyVersion: POLICY_VERSION,
    assessment: { ...label, ruleMatches: [], uncertainties: ['潜在伤害对象和语境尚不清楚。'] },
  });
  const body = { ...feedbackBody(), ...label, verdict: 'agree', note: '' };
  await assert.rejects(
    h.audit.feedback({ id: ID, runId: RUN_ID, reviewerId: 7, body }),
    expectStatus(400),
  );
  await h.audit.feedback({
    id: ID,
    runId: RUN_ID,
    reviewerId: 7,
    body: { ...body, note: '具体对象与近期行动意图需要进一步核实。' },
  });
  const saved = JSON.parse(h.inserts[0].args[4]);
  assert.deepEqual(saved.ruleIds, []);
  assert.deepEqual(saved.categories, []);
  assert.equal(saved.decision, 'needs_review');
});

test('regression creation requires explicit synthetic attestation and a completed human review', async () => {
  const h = harness();
  const request = { id: ID, runId: RUN_ID, reviewerId: 7, body: regressionBody() };
  await assert.rejects(
    h.audit.regression({ ...request, body: { ...request.body, syntheticConfirmed: false } }),
    expectStatus(400),
  );
  await assert.rejects(h.audit.regression(request), expectStatus(409));
  h.state.reviews = [{ id: 5, feedback_json: JSON.stringify({ verdict: 'escalate' }) }];
  await assert.rejects(h.audit.regression(request), expectStatus(409));
  h.state.reviews = [
    {
      id: 6,
      feedback_json: JSON.stringify({
        verdict: 'correct',
        ...riskLabel(),
        policyVersion: POLICY_VERSION,
      }),
    },
  ];
  await assert.rejects(
    h.audit.regression({
      ...request,
      body: { ...request.body, content: '  不可自动导出的原稿内容  ' },
    }),
    expectStatus(400),
  );
  assert.equal(h.inserts.length, 0);
  const result = await h.audit.regression(request);
  assert.equal(result.replayed, false);
  const stored = JSON.parse(h.inserts[0].args[6]);
  assert.equal(stored.content, request.body.content);
  assert.equal(stored.title, request.body.title);
  assert.equal(stored.syntheticConfirmed, true);
  assert.doesNotMatch(h.inserts[0].args[6], /不可自动导出/);
  assert.equal(h.inserts[0].args[2], 6);
  assert.equal(h.inserts[0].args[7], h.state.row.expires_at);
});

test('regression export is bounded and queries unexpired evidence rather than original posts', async () => {
  const value = {
    title: '虚构样例',
    content: '合成讨论文字',
    syntheticConfirmed: true,
    policyVersion: POLICY_VERSION,
  };
  const h = harness({
    exports: [{ id: REQUEST_ID, case_json: JSON.stringify(value) }],
    skippedLegacyCount: 3,
  });
  const result = await h.audit.exportRegressions({ reviewerId: 7 });
  assert.deepEqual(result.cases, [{ id: REQUEST_ID, ...value }]);
  assert.equal(result.skippedLegacyCount, 3);
  const sql = h.events.find((entry) => entry.sql?.startsWith('SELECT c.id')).sql;
  assert.match(sql, /c\.expires_at > NOW\(3\)/);
  assert.match(sql, /r\.expires_at > NOW\(3\)/);
  assert.match(sql, /s\.expires_at > NOW\(3\)/);
  assert.match(sql, /s\.evidence_purged_at IS NULL/);
  assert.match(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(c\.case_json, '\$\.policyVersion'\)\) = \?/);
  assert.deepEqual(h.events.find((entry) => entry.sql?.startsWith('SELECT c.id')).args, [
    POLICY_VERSION,
  ]);
  assert.doesNotMatch(JSON.stringify(result), /不可自动导出|reviewerId|request_hash/);
  h.state.exports = Array.from({ length: 101 }, () => ({
    id: REQUEST_ID,
    case_json: JSON.stringify(value),
  }));
  await assert.rejects(h.audit.exportRegressions({ reviewerId: 7 }), expectStatus(413));
});

test('regression labels must match latest completed review and cannot silently use stale machine labels', async () => {
  const h = harness({
    reviews: [
      {
        id: 6,
        feedback_json: JSON.stringify({
          verdict: 'correct',
          ...clearLabel(),
          policyVersion: POLICY_VERSION,
        }),
      },
    ],
  });
  await assert.rejects(
    h.audit.regression({ id: ID, runId: RUN_ID, reviewerId: 7, body: regressionBody() }),
    expectStatus(409),
  );
  assert.equal(h.inserts.length, 0);
});

test('feedback retries preserve the original fingerprint and cannot silently stamp a legacy record with the current policy', async () => {
  const body = feedbackBody();
  const value = { verdict: body.verdict, ...validateLabel(body), note: body.note };
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ id: ID, runId: RUN_ID, value }))
    .digest('hex');
  const h = harness({
    existingFeedback: [
      {
        id: 12,
        request_hash: requestHash,
        feedback_json: JSON.stringify({ ...value, policyVersion: 'previous-policy' }),
      },
    ],
  });
  assert.deepEqual(await h.audit.feedback({ id: ID, runId: RUN_ID, reviewerId: 7, body }), {
    id: '12',
    replayed: true,
  });
  assert.equal(h.inserts.length, 0);
  assert.equal(
    JSON.parse(h.state.existingFeedback[0].feedback_json).policyVersion,
    'previous-policy',
  );
});

test('missing or obsolete review versions require a new current-policy review before creating regression cases', async () => {
  for (const policyVersion of [undefined, 'previous-policy']) {
    const h = harness({
      reviews: [
        {
          id: 6,
          feedback_json: JSON.stringify({
            verdict: 'correct',
            ...riskLabel(),
            ...(policyVersion ? { policyVersion } : {}),
          }),
        },
      ],
    });
    const request = { id: ID, runId: RUN_ID, reviewerId: 7, body: regressionBody() };
    await assert.rejects(
      h.audit.regression(request),
      (error) => error.status === 409 && /重新保存人工复核/.test(error.message),
    );
    assert.equal(h.inserts.length, 0);
    await h.audit.feedback({
      id: ID,
      runId: RUN_ID,
      reviewerId: 7,
      body: { ...feedbackBody(), policyVersion: 'client-cannot-select-a-version' },
    });
    const stored = JSON.parse(h.inserts[0].args[4]);
    assert.equal(stored.policyVersion, POLICY_VERSION);
    h.state.reviews = [{ id: 9, feedback_json: JSON.stringify(stored) }];
    const created = await h.audit.regression(request);
    assert.equal(created.replayed, false);
    assert.equal(JSON.parse(h.inserts[1].args[6]).policyVersion, POLICY_VERSION);
    // A retry of this completed operation remains a replay, even if a later
    // latest-feedback record is unsuitable for creating additional cases.
    h.state.existingCases = [{ id: created.id, request_hash: h.inserts[1].args[5] }];
    h.state.reviews = [
      { id: 10, feedback_json: JSON.stringify({ verdict: 'correct', ...riskLabel() }) },
    ];
    assert.deepEqual(await h.audit.regression(request), { id: created.id, replayed: true });
    assert.equal(h.inserts.length, 2);
  }
});

async function routerHarness(t, options = {}) {
  const calls = [];
  const audit =
    options.audit ||
    Object.fromEntries(
      ['history', 'feedback', 'regression', 'exportRegressions'].map((name) => [
        name,
        async (input) => {
          calls.push({ name, input });
          if (options.failAudit) throw new Error('SECRET_PROVIDER_KEY_OR_INTERNAL_SQL');
          return name === 'history'
            ? { runs: [] }
            : name === 'exportRegressions'
              ? { cases: [] }
              : { id: REQUEST_ID };
        },
      ]),
    );
  const app = express();
  app.use(express.json());
  app.use(
    '/api/moderation',
    createModerationRouter({
      enabled: options.enabled !== false,
      aiTest: { enabled: options.aiEnabled !== false },
      audit,
      service: { isReviewer: async (id) => id === 7 },
      requireAuth: async (request, response) => {
        const token = request.headers.authorization;
        if (!token) {
          response.status(401).json({ message: '请登录' });
          return null;
        }
        return token === 'Bearer reviewer' ? { id: 7 } : { id: 8, is_admin: true };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const request = (
    route,
    { token = 'reviewer', body, method = body === undefined ? 'GET' : 'POST' } = {},
  ) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/moderation${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { request, calls };
}

const auditRoutes = () => [
  ['/policies', undefined],
  [`/submissions/${ID}/ai-history`, undefined],
  [`/submissions/${ID}/ai-runs/${RUN_ID}/feedback`, feedbackBody()],
  [
    `/submissions/${ID}/ai-runs/${RUN_ID}/regression`,
    (() => {
      const { decision: _decision, ...body } = regressionBody();
      return body;
    })(),
  ],
  ['/regressions/export', undefined],
];

test('policy and audit HTTP routes deny anonymous users and administrators outside reviewer registry', async (t) => {
  const h = await routerHarness(t);
  for (const [route, body] of auditRoutes()) {
    for (const [token, status] of [
      [null, 401],
      ['administrator', 403],
    ]) {
      const response = await h.request(route, { token, body });
      assert.equal(response.status, status, `${route}: ${token}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  }
  assert.equal(h.calls.length, 0);
});

test('policy library uses 403 while moderation is disabled, not 503 or leaked rules', async (t) => {
  const h = await routerHarness(t, { enabled: false });
  const response = await h.request('/policies');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).library, undefined);
});

test('read-only policies and history remain available when local AI trial is off, but edits and export do not', async (t) => {
  const h = await routerHarness(t, { aiEnabled: false });
  for (const [route, body] of auditRoutes()) {
    const response = await h.request(route, { body });
    assert.equal(
      response.status,
      ['/policies', `/submissions/${ID}/ai-history`].includes(route) ? 200 : 503,
      route,
    );
  }
  assert.deepEqual(
    h.calls.map((call) => call.name),
    ['history'],
  );
});

test('audit write routes reject unknown fields and array bodies before invoking persistence', async (t) => {
  const h = await routerHarness(t);
  for (const [route, body] of auditRoutes().filter(([, value]) => value !== undefined)) {
    for (const invalid of [
      [],
      { ...body, reviewerId: 999 },
      { ...body, rawOriginal: 'private original' },
    ]) {
      const response = await h.request(route, { body: invalid });
      assert.equal(response.status, 400);
    }
  }
  assert.equal(h.calls.length, 0);
});

test('audit routes use authenticated actor and trusted policy sources without invoking provider', async (t) => {
  const h = await routerHarness(t);
  const library = await (await h.request('/policies')).json();
  assert.equal(library.library.version, POLICY_VERSION);
  assert.ok(library.library.rules.length > 0);
  assert.doesNotMatch(JSON.stringify(library), /SECRET_PROVIDER|PRIVATE_INPUT/);
  for (const [route, body] of auditRoutes().slice(1)) {
    const response = await h.request(route, { body });
    assert.equal(response.status, 200, route);
  }
  for (const call of h.calls) assert.equal(call.input.reviewerId, 7);
  const exportResponse = await h.request('/regressions/export');
  assert.match(exportResponse.headers.get('content-disposition'), /^attachment;/);
});

test('database errors stay generic and reviewer revocation is checked inside the audit service', async (t) => {
  const broken = await routerHarness(t, { failAudit: true });
  const failed = await broken.request(`/submissions/${ID}/ai-history`);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /SECRET_PROVIDER|INTERNAL_SQL/);
  const h = harness({ reviewer: false });
  const revoked = await routerHarness(t, { audit: h.audit });
  const response = await revoked.request(`/submissions/${ID}/ai-history`);
  assert.equal(response.status, 403);
  assert.equal(h.events.filter((entry) => entry.sql).length, 1);
});
