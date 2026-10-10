const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const { createModerationAiClient } = require('../backend/moderation-ai-client');
const { createModerationAudit } = require('../backend/moderation-audit');
const { CONTRACT_VERSION } = require('../backend/moderation-ai-diagnostics');
const {
  FORMAT,
  parseArguments,
  validateDocument,
  validateTestConfig,
  safeError,
  evaluate,
  runRegression,
  createReportWriter,
  main,
} = require('./moderation-policy-regression');

const PRIVATE = 'synthetic-secret-never-a-real-key';
const config = (extra = {}) => ({
  DISCUSSION_MODERATION_ENABLED: 'true',
  DISCUSSION_MODERATION_AI_TEST_ENABLED: 'true',
  API_HOST: '127.0.0.1',
  PUBLIC_WEB_URL: 'http://127.0.0.1:3000',
  BACKEND_IP: '127.0.0.1',
  MYSQL_PORT: 3307,
  MYSQL_DATABASE: 'free_bbs',
  MYSQL_USER: 'freebbs_test',
  MYSQL_PASSWORD: PRIVATE,
  SETTINGS_ENCRYPTION_KEY: PRIVATE,
  ...extra,
});
const fixture = (extra = {}) => ({
  id: 'case-1',
  title: '虚构政策建议',
  content: '我认为申请流程可以更透明，希望公布标准。',
  expectedDecision: 'no_risk_detected',
  categories: [],
  ruleIds: [],
  supportPriority: 'none',
  reason: '正常讨论，没有其他具体有害行为。',
  syntheticConfirmed: true,
  policyVersion: POLICY_VERSION,
  ...extra,
});
const exported = (cases = [fixture()]) => ({
  format: FORMAT,
  policyVersion: POLICY_VERSION,
  exportedAt: '2026-10-08T01:00:00.000Z',
  cases,
});
const assessment = (extra = {}) => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '正常批评。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
  ...extra,
});
const response = (value = assessment()) =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

function harness({
  fetchResult = () => response(),
  clientFactory = createModerationAiClient,
} = {}) {
  const calls = [];
  const settingsReads = [];
  const pools = [];
  const loaded = [];
  const snapshots = [];
  let closed = 0;
  const pool = {
    end: async () => {
      closed += 1;
    },
  };
  const loadModule = (name) => {
    loaded.push(name);
    if (name === '../node_modules/mysql2/promise')
      return {
        createPool: (options) => {
          pools.push(options);
          return pool;
        },
      };
    if (name === '../backend/system-settings')
      return {
        createSystemSettingsStore: (options) => {
          assert.equal(options.pool, pool);
          assert.equal(options.encryptionKey, PRIVATE);
          return {
            readSettings: async (options2) => {
              settingsReads.push(options2);
              return {
                baseUrl: 'https://cloud.infini-ai.com/maas/v1',
                model: 'glm-5.1',
                revision: 5,
                ...(options2.includeSecret ? { apiKey: PRIVATE } : {}),
              };
            },
          };
        },
      };
    if (name === '../backend/moderation-ai-client')
      return { createModerationAiClient: clientFactory };
    assert.fail(`Unexpected module ${name}`);
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return fetchResult(url, options);
  };
  return {
    calls,
    settingsReads,
    pools,
    loaded,
    snapshots,
    get closed() {
      return closed;
    },
    deps: { loadModule, fetchImpl },
    run: (extra = {}) =>
      runRegression({
        document: exported(),
        config: config(),
        loadModule,
        fetchImpl,
        persist: (report) => snapshots.push(structuredClone(report)),
        ...extra,
      }),
  };
}

function memoryIO(initial = {}) {
  const files = new Map(Object.entries(initial));
  const directories = new Set();
  const events = [];
  return {
    files,
    events,
    statSync(file) {
      events.push(['stat', file]);
      if (!files.has(file)) throw new Error(PRIVATE);
      return { isFile: () => true, size: Buffer.byteLength(files.get(file)) };
    },
    readFileSync(file) {
      events.push(['read', file]);
      if (!files.has(file)) throw new Error(PRIVATE);
      return files.get(file);
    },
    mkdirSync(file, options) {
      events.push(['mkdir', file]);
      if (directories.has(file) && !options?.recursive) throw new Error(PRIVATE);
      directories.add(file);
    },
    writeFileSync(file, data, options) {
      events.push(['write', file]);
      if (options?.flag === 'wx' && files.has(file)) throw new Error(PRIVATE);
      files.set(file, data);
    },
    appendFileSync(file, data) {
      events.push(['append', file]);
      files.set(file, (files.get(file) || '') + data);
    },
    renameSync(from, to) {
      events.push(['rename', from, to]);
      if (!files.has(from)) throw new Error(PRIVATE);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

test('CLI defaults to preview and only accepts bounded named arguments and absolute paths', () => {
  assert.equal(parseArguments(['--input', 'F:\\test\\cases.json']).run, false);
  assert.equal(
    parseArguments(['--input', 'F:\\test\\cases.json', '--run', '--model', 'kimi-k2.6']).model,
    'kimi-k2.6',
  );
  for (const args of [
    [],
    ['--run'],
    ['--input', 'relative.json'],
    ['--input', 'F:\\cases.json', '--input', 'F:\\other.json'],
    ['--input', 'F:\\cases.json', '--unknown'],
    ['--input', 'F:\\cases.json', '--model', 'bad model'],
    ['--help', '--run'],
  ])
    assert.throws(() => parseArguments(args));
});

test('preview reads only the exported fixture file, without config, database, API or reports', async () => {
  const input = 'F:\\test\\cases.json';
  const io = memoryIO({ [input]: JSON.stringify(exported()) });
  const output = [];
  const code = await main(['--input', input], {
    io,
    write: (value) => output.push(value),
    noProcessSignals: true,
    runnerDependencies: {
      loadModule: () => assert.fail('No runtime modules in preview'),
      fetchImpl: () => assert.fail('No API in preview'),
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(io.events, [
    ['stat', input],
    ['read', input],
  ]);
  assert.equal(output[0].plannedCalls, 1);
  assert.equal(output[0].run, false);
  assert.doesNotMatch(JSON.stringify(output), /synthetic-secret|apiKey|MYSQL_PASSWORD/);
});

test('preview reports skipped legacy cases but never upgrades a mixed or old-version export', async () => {
  const input = 'F:\\test\\cases.json';
  const io = memoryIO({ [input]: JSON.stringify({ ...exported(), skippedLegacyCount: 4 }) });
  const outputs = [];
  assert.equal(await main(['--input', input], { io, write: (value) => outputs.push(value) }), 0);
  assert.equal(outputs[0].skippedLegacyCount, 4);
  assert.deepEqual(io.events, [
    ['stat', input],
    ['read', input],
  ]);
  for (const data of [
    { ...exported(), policyVersion: 'freebbs-policy-2026-10-08-v1' },
    { ...exported(), policyVersion: 'freebbs-policy-2026-10-08-v2' },
    exported([
      fixture(),
      fixture({ id: 'old-case', policyVersion: 'freebbs-policy-2026-10-08-v1' }),
    ]),
    exported([
      fixture({ expectedDecision: 'high_risk', categories: ['harassment'], ruleIds: ['HAR-001'] }),
    ]),
  ])
    assert.throws(() => validateDocument(data));
});

test('exports reject extra identity metadata, real-data flags, duplicate IDs, wrong versions and impossible labels', () => {
  const invalid = [
    { ...exported(), author: 'should-not-read' },
    { ...exported(), format: 'raw-post-export' },
    { ...exported(), policyVersion: 'old-version' },
    { ...exported(), exportedAt: 'yesterday' },
    { ...exported(), skippedLegacyCount: -1 },
    { ...exported(), skippedLegacyCount: '2' },
    exported([]),
    exported(Array.from({ length: 101 }, (_, index) => fixture({ id: `case-${index}` }))),
    exported([fixture(), fixture()]),
    ...[
      { authorId: 12 },
      { syntheticConfirmed: false },
      { policyVersion: 'old-version' },
      { id: 12 },
      { content: 'x'.repeat(6001) },
      { title: 'x'.repeat(121) },
      { reason: '' },
      { content: 'x\u0000y' },
      { expectedDecision: 'approved' },
      { categories: ['privacy'] },
      { ruleIds: ['INVENTED'] },
      {
        expectedDecision: 'high_risk',
        categories: ['sexual_content'],
        ruleIds: ['未成年保护-001'],
      },
      { expectedDecision: 'high_risk', categories: ['sexual_minors'], ruleIds: ['性剥削-001'] },
      { ruleIds: ['EXP-001', 'EXP-001'] },
      { supportPriority: 'urgent' },
      { expectedDecision: 'high_risk', categories: ['privacy'], ruleIds: [] },
      { ruleIds: ['关怀-002'], supportPriority: 'attention' },
    ].map((extra) => exported([fixture(extra)])),
  ];
  for (const value of invalid)
    assert.throws(() => validateDocument(value), JSON.stringify(value).slice(0, 150));
  const valid = exported([
    fixture({
      ruleIds: ['关怀-002'],
      supportPriority: 'urgent',
      reason: '无违规，但存在需立即人工关怀的信号。',
    }),
  ]);
  assert.deepEqual(validateDocument(valid), valid);
});

test('isolated configuration requires both test flags, loopback app and exact local test database', () => {
  assert.equal(validateTestConfig(config({ BACKEND_IP: 'localhost' })).host, '127.0.0.1');
  for (const extra of [
    { DISCUSSION_MODERATION_ENABLED: false },
    { DISCUSSION_MODERATION_AI_TEST_ENABLED: '' },
    { API_HOST: '0.0.0.0' },
    { PUBLIC_WEB_URL: 'https://freebbs.example' },
    { PUBLIC_WEB_URL: 'http://user:pass@127.0.0.1:3000' },
    { BACKEND_IP: '192.168.1.10' },
    { MYSQL_PORT: 3306 },
    { MYSQL_DATABASE: 'production' },
    { MYSQL_SOCKET: '/tmp/mysql.sock' },
    { MYSQL_USER: '' },
  ])
    assert.throws(() => validateTestConfig(config(extra)));
});

test('live execution uses managed settings and one serial request for each exact fabricated fixture', async () => {
  let running = 0;
  const h = harness({
    fetchResult: async () => {
      running += 1;
      assert.equal(running, 1);
      await new Promise(setImmediate);
      running -= 1;
      return response();
    },
  });
  const fixtures = [
    fixture(),
    fixture({
      id: 'case-2',
      content: '正常讨论；其中的网址 https://example.com 只是文字，不应抓取。',
    }),
  ];
  const report = await h.run({ document: exported(fixtures), model: 'kimi-k2.6' });
  assert.equal(report.status, 'completed');
  assert.equal(report.summary.matchedLabels, 2);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.settingsReads, [
    { includeSecret: false },
    { includeSecret: true },
    { includeSecret: true },
  ]);
  assert.equal(h.closed, 1);
  assert.equal(h.pools[0].multipleStatements, false);
  assert.equal(h.pools[0].host, '127.0.0.1');
  assert.equal(h.snapshots[0].results.length, 0);
  for (const [index, call] of h.calls.entries()) {
    assert.equal(call.url, 'https://cloud.infini-ai.com/maas/v1/chat/completions');
    const request = JSON.parse(call.options.body);
    const sent = JSON.parse(request.messages[1].content);
    assert.equal(request.model, 'kimi-k2.6');
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.deepEqual(sent, {
      title: fixtures[index].title,
      content: fixtures[index].content,
      inputMode: 'synthetic_original',
      redactionCounts: {},
      hasImages: false,
    });
    assert.doesNotMatch(
      JSON.stringify(sent),
      /expectedDecision|ruleIds|syntheticConfirmed|reason|case-1/,
    );
  }
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret|apiKey|MYSQL_PASSWORD/);
});

test('comparison requires exact complete category and rule sets, but leaves explanation for humans', () => {
  const expected = fixture({
    expectedDecision: 'high_risk',
    categories: ['privacy', 'harassment'],
    ruleIds: ['隐私-002', '骚扰-001'],
  });
  const valid = assessment({
    decision: 'high_risk',
    categories: ['harassment', 'privacy'],
    ruleMatches: [{ ruleId: '骚扰-001' }, { ruleId: '隐私-002' }],
  });
  assert.equal(evaluate(valid, expected).result, 'matched');
  assert.equal(evaluate(valid, expected).reasonRequiresHumanReview, true);
  const mismatch = evaluate(
    {
      ...valid,
      decision: 'needs_review',
      categories: [...valid.categories, 'fraud'],
      ruleMatches: [{ ruleId: '骚扰-001' }],
      supportPriority: 'attention',
    },
    expected,
  );
  assert.deepEqual(mismatch.differences, ['decision', 'categories', 'ruleIds', 'supportPriority']);
  assert.equal(mismatch.result, 'review');
});

test('invalid configuration, unavailable model and unwritable reports stop before paid requests', async () => {
  for (const options of [
    { config: config({ MYSQL_PORT: 3306 }) },
    { model: 'unlisted-model' },
    {
      persist: () => {
        throw new Error(PRIVATE);
      },
    },
  ]) {
    const h = harness();
    const report = await h.run(options);
    assert.equal(report.status, 'failed');
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-secret/);
  }
});

test('three consecutive API failures stop without retry and never record upstream raw errors', async () => {
  const h = harness({
    fetchResult: () => new Response(JSON.stringify({ error: PRIVATE }), { status: 400 }),
  });
  const report = await h.run({
    document: exported(Array.from({ length: 5 }, (_, index) => fixture({ id: `case-${index}` }))),
  });
  assert.equal(report.status, 'stopped');
  assert.equal(report.stopReason, 'three_consecutive_api_failures');
  assert.equal(report.results.length, 3);
  assert.equal(h.calls.length, 3);
  assert.equal(report.summary.failed, 3);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret/);
});

test('successful response resets the consecutive failure counter', async () => {
  let attempt = 0;
  const h = harness({
    fetchResult: () => {
      attempt += 1;
      return attempt === 3 ? response() : new Response(PRIVATE, { status: 500 });
    },
  });
  const report = await h.run({
    document: exported(Array.from({ length: 6 }, (_, index) => fixture({ id: `case-${index}` }))),
  });
  assert.equal(h.calls.length, 6);
  assert.equal(report.stopReason, 'three_consecutive_api_failures');
  assert.equal(report.summary.validResults, 1);
});

test('provider timeout remains bounded by the real client deadline and becomes a safe failed case', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const fetchStarted = new Promise((resolve) => {
    started = resolve;
  });
  let signal;
  const h = harness({
    fetchResult: (_url, options) => {
      signal = options.signal;
      started();
      return new Promise(() => {});
    },
  });
  const pending = h.run();
  await fetchStarted;
  t.mock.timers.tick(15000);
  const report = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(report.results[0].error.status, 504);
  assert.equal(h.calls.length, 1);
  assert.equal(h.closed, 1);
});

test('explicit request guard rejects a second request even if a changed client attempts a fallback', async () => {
  const h = harness({
    clientFactory: ({ fetchImpl }) => ({
      listModels: async () => ({ defaultModel: 'glm-5.1', models: [{ id: 'glm-5.1' }] }),
      assess: async () => {
        await fetchImpl('https://cloud.infini-ai.com/maas/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
        });
        await fetchImpl('https://cloud.infini-ai.com/maas/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
        });
        assert.fail('Second request must fail');
      },
    }),
  });
  const report = await h.run({ document: exported([fixture(), fixture({ id: 'next' })]) });
  assert.equal(report.stopReason, 'request_limit_exceeded');
  assert.equal(h.calls.length, 1);
  assert.equal(report.results.length, 1);
});

test('interruption or report failure after a result prevents the next paid request', async () => {
  let stopped = false;
  const interrupted = harness();
  const report = await interrupted.run({
    document: exported([fixture(), fixture({ id: 'next' })]),
    shouldStop: () => stopped,
    onProgress: () => {
      stopped = true;
    },
  });
  assert.equal(report.status, 'interrupted');
  assert.equal(interrupted.calls.length, 1);
  const broken = harness();
  const failed = await broken.run({
    document: exported([fixture(), fixture({ id: 'next' })]),
    persist: (value) => {
      if (value.results.length) throw new Error(PRIVATE);
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(broken.calls.length, 1);
});

test('report writers use distinct directories and preserve complete JSON snapshots', () => {
  const io = memoryIO();
  const first = createReportWriter('F:\\reports', io);
  const second = createReportWriter('F:\\reports', io);
  assert.notEqual(path.dirname(first.reportPath), path.dirname(second.reportPath));
  first.persist({ results: [{ id: 1 }] });
  first.persist({ results: [{ id: 1 }, { id: 2 }] });
  second.persist({ results: [] });
  assert.deepEqual(JSON.parse(io.files.get(first.reportPath)).results, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(JSON.parse(io.files.get(second.reportPath)).results, []);
  assert.ok(![...io.files.keys()].some((name) => name.endsWith('.tmp')));
});

test('main run writes a sanitized report and safe summary without exposing configuration', async () => {
  const input = 'F:\\test\\cases.json';
  const configPath = 'F:\\test\\config.json';
  const io = memoryIO({
    [input]: JSON.stringify(exported()),
    [configPath]: JSON.stringify(config()),
  });
  const outputs = [];
  const h = harness();
  const code = await main(
    ['--input', input, '--config', configPath, '--output', 'F:\\test\\reports', '--run'],
    {
      io,
      write: (value) => outputs.push(value),
      noProcessSignals: true,
      runnerDependencies: h.deps,
    },
  );
  assert.equal(code, 0);
  assert.equal(h.calls.length, 1);
  const summary = outputs.at(-1);
  assert.equal(summary.event, 'summary');
  assert.equal(summary.matchedLabels, 1);
  const report = JSON.parse(io.files.get(summary.reportJson));
  assert.equal(report.results.length, 1);
  assert.equal(report.status, 'completed');
  assert.doesNotMatch(JSON.stringify(outputs), /synthetic-secret|MYSQL_PASSWORD/);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret|MYSQL_PASSWORD/);
  assert.equal(
    safeError({ message: PRIVATE, cause: PRIVATE, stack: PRIVATE }).message,
    '本地准备、执行或报告写入失败；未输出原始错误。',
  );
});

test('safe errors preserve legacy fields and whitelist diagnostic metadata', () => {
  const legacy = safeError({ status: 502, message: PRIVATE, code: PRIVATE });
  assert.deepEqual(legacy, {
    code: 'execution_failed',
    status: 502,
    message: '模型调用或返回格式校验失败。',
  });
  const diagnostics = {
    version: 1,
    contractVersion: CONTRACT_VERSION,
    failureCode: 'content_json_invalid',
    httpStatus: 200,
    jsonSyntaxKind: 'trailing_content',
    contentShape: {
      startsWithObject: true,
      endsWithObject: false,
      startsWithFence: false,
      singleJsonFence: false,
      fencedJsonParseable: false,
      decodedJsonStringObject: false,
      hasBom: false,
      privateField: PRIVATE,
    },
    responseText: PRIVATE,
    requestHeaders: { Authorization: PRIVATE },
  };
  const result = safeError({ status: 502, diagnostics, message: PRIVATE, cause: PRIVATE });
  assert.deepEqual({ code: result.code, status: result.status, message: result.message }, legacy);
  assert.equal(result.diagnostics.failureCode, 'content_json_invalid');
  assert.equal(result.diagnostics.httpStatus, 200);
  assert.equal(result.diagnostics.jsonSyntaxKind, 'trailing_content');
  assert.equal(Object.keys(result.diagnostics.contentShape).length, 7);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-secret|responseText|requestHeaders|privateField/,
  );
  for (const invalid of [
    { ...diagnostics, version: 2 },
    { ...diagnostics, contractVersion: PRIVATE },
    { ...diagnostics, failureCode: PRIVATE },
    PRIVATE,
  ]) {
    assert.deepEqual(safeError({ status: 502, diagnostics: invalid }), legacy);
  }
});

test('regression records only the fixed contract version on successful client rows', async () => {
  for (const clientContract of [CONTRACT_VERSION, undefined, PRIVATE]) {
    const h = harness({
      clientFactory: () => ({
        listModels: async () => ({ defaultModel: 'glm-5.1', models: [{ id: 'glm-5.1' }] }),
        assess: async () => ({
          assessment: assessment(),
          policyVersion: POLICY_VERSION,
          contractVersion: clientContract,
          policyDecision: null,
          settingsRevision: 5,
          elapsedMs: 1,
        }),
      }),
    });
    const report = await h.run();
    assert.equal(report.contractVersion, CONTRACT_VERSION);
    assert.equal(
      report.results[0].contractVersion,
      clientContract === CONTRACT_VERSION ? CONTRACT_VERSION : undefined,
    );
    assert.doesNotMatch(JSON.stringify(report), /synthetic-secret/);
  }
});

test('regression retains safe response diagnostics in its saved failure row', async () => {
  const h = harness({
    fetchResult: () => new Response(PRIVATE, { status: 429 }),
  });
  const report = await h.run();
  assert.equal(report.results[0].error.status, 502);
  assert.equal(report.results[0].error.diagnostics.failureCode, 'http_error');
  assert.equal(report.results[0].error.diagnostics.httpStatus, 429);
  assert.equal(h.snapshots.at(-1).results[0].error.diagnostics.contractVersion, CONTRACT_VERSION);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret/);
});

test('completed plans still return nonzero for API failures or changed expected labels', async () => {
  const input = 'F:\\test\\cases.json';
  const configPath = 'F:\\test\\config.json';
  for (const [fixtureValue, fetchResult, expectedCode] of [
    [fixture(), () => new Response(PRIVATE, { status: 500 }), 1],
    [fixture({ ruleIds: ['关怀-001'], supportPriority: 'attention' }), () => response(), 2],
  ]) {
    const io = memoryIO({
      [input]: JSON.stringify(exported([fixtureValue])),
      [configPath]: JSON.stringify(config()),
    });
    const outputs = [];
    const h = harness({ fetchResult });
    const code = await main(
      ['--input', input, '--config', configPath, '--output', 'F:\\reports', '--run'],
      {
        io,
        write: (value) => outputs.push(value),
        noProcessSignals: true,
        runnerDependencies: h.deps,
      },
    );
    assert.equal(code, expectedCode);
    assert.equal(outputs.at(-1).status, 'completed');
    assert.equal(h.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(outputs), /synthetic-secret/);
  }
});

test('the actual workbench export contract validates and runs without private audit metadata', async () => {
  const { id: _id, ...value } = fixture();
  const caseId = '11111111-2222-4333-8444-555555555555';
  const reads = [];
  const db = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    execute: async (sql) => {
      reads.push(sql);
      if (sql.startsWith('SELECT user_id FROM moderation_reviewers')) return [[{ user_id: 7 }]];
      if (sql.startsWith('SELECT c.id, c.case_json'))
        return [[{ id: caseId, case_json: JSON.stringify(value) }]];
      if (sql.startsWith('SELECT COUNT(*) AS skipped')) return [[{ skipped: 2 }]];
      assert.fail('Export should not read original content or model secrets');
    },
  };
  const audit = createModerationAudit({ pool: { getConnection: async () => db } });
  const document = await audit.exportRegressions({ reviewerId: 7 });
  assert.equal(reads.length, 3);
  assert.deepEqual(validateDocument(document), document);
  assert.doesNotMatch(JSON.stringify(document), /reviewerId|submissionId|runId|authorId|apiKey/);
  const h = harness();
  const report = await h.run({ document });
  assert.equal(report.status, 'completed');
  assert.equal(report.skippedLegacyCount, 2);
  assert.equal(report.results[0].fixture.id, caseId);
  assert.equal(h.calls.length, 1);
  assert.equal(report.summary.matchedLabels, 1);
});
