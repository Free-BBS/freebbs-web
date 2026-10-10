const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const { createModerationAiClient } = require('../backend/moderation-ai-client');
const { FORMAT } = require('./moderation-policy-regression');
const {
  DEFAULTS,
  MANIFEST_FORMAT,
  parseArguments,
  validateModels,
  validateManifest,
  preparePlan,
  runEvaluation,
  listAvailableModels,
  createBatchWriter,
  main,
} = require('./moderation-model-evaluation');

const PRIVATE = 'private-config-never-output';
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
  title: '虚构校园建议',
  content: '我希望申请流程更透明，可以公布标准。',
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
  exportedAt: '2026-10-10T01:00:00.000Z',
  cases,
});
const metadata = (extra = {}) => ({
  ruleFocus: ['政治内容-001'],
  bucket: 'normal',
  smoke: true,
  rationale: 'META_IS_NOT_SENT，仅用作测试说明。',
  ...extra,
});
const manifestFor = (document = exported()) => ({
  format: MANIFEST_FORMAT,
  policyVersion: POLICY_VERSION,
  annotationStatus: 'draft_pending_owner_review',
  syntheticOnly: true,
  cases: Object.fromEntries(document.cases.map((item) => [item.id, metadata()])),
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
  const reads = [];
  const pools = [];
  const snapshots = [];
  const modelSnapshots = [];
  let closed = 0;
  const loadModule = (name) => {
    if (name === '../node_modules/mysql2/promise')
      return {
        createPool: (options) => {
          pools.push(options);
          return {
            end: async () => {
              closed += 1;
            },
          };
        },
      };
    if (name === '../backend/system-settings')
      return {
        createSystemSettingsStore: () => ({
          readSettings: async (options) => {
            reads.push(options);
            return {
              baseUrl: 'https://cloud.infini-ai.com/maas/v1',
              model: 'glm-5.1',
              revision: 9,
              ...(options.includeSecret ? { apiKey: PRIVATE } : {}),
            };
          },
        }),
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
    reads,
    pools,
    snapshots,
    modelSnapshots,
    get closed() {
      return closed;
    },
    deps: { loadModule, fetchImpl },
    run: (extra = {}) =>
      runEvaluation({
        document: exported(),
        config: config(),
        loadModule,
        fetchImpl,
        persist: (value) => snapshots.push(structuredClone(value)),
        persistModel: (model, value) =>
          modelSnapshots.push({ model, report: structuredClone(value) }),
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

test('CLI defaults to two models and smoke preview; deduplicates models and bounds arguments', () => {
  const defaults = parseArguments([]);
  assert.equal(defaults.run, false);
  assert.equal(defaults.suite, 'smoke');
  assert.deepEqual(defaults.models, ['glm-5.1', 'kimi-k2.6']);
  assert.deepEqual(parseArguments(['--models', 'kimi-k2.6,glm-5.1,kimi-k2.6']).models, [
    'kimi-k2.6',
    'glm-5.1',
  ]);
  assert.equal(parseArguments(['--input', 'F:\\cases.json']).manifest, null);
  for (const args of [
    ['--run', '--run'],
    ['--input', 'relative.json'],
    ['--models', ''],
    ['--models', 'glm-5.1,'],
    ['--models', 'a,b,c,d,e,f,g'],
    ['--models', 'bad model'],
    ['--suite', 'random'],
    ['--list-models', '--run'],
    ['--list-models', '--models', 'glm-5.1'],
    ['--help', '--run'],
    ['--unknown'],
  ])
    assert.throws(() => parseArguments(args));
  assert.equal(validateModels(['a', 'a']).length, 1);
});

test('preview only reads fixture and manifest; no config, modules, API, directories or reports', async () => {
  const io = memoryIO({
    [DEFAULTS.input]: JSON.stringify(exported()),
    [DEFAULTS.manifest]: JSON.stringify(manifestFor()),
  });
  const outputs = [];
  const code = await main([], {
    io,
    write: (value) => outputs.push(value),
    runnerDependencies: {
      loadModule: () => assert.fail('No modules in preview'),
      fetchImpl: () => assert.fail('No API in preview'),
    },
  });
  assert.equal(code, 0);
  assert.equal(outputs[0].plannedCalls, 2);
  assert.equal(outputs[0].caseCount, 1);
  assert.deepEqual(io.events, [
    ['stat', DEFAULTS.input],
    ['read', DEFAULTS.input],
    ['stat', DEFAULTS.manifest],
    ['read', DEFAULTS.manifest],
  ]);
});

test('external input without manifest runs all its cases even with the default smoke selector', async () => {
  const input = 'F:\\cases.json';
  const document = exported([fixture(), fixture({ id: 'second' })]);
  const io = memoryIO({ [input]: JSON.stringify(document) });
  const output = [];
  assert.equal(await main(['--input', input], { io, write: (value) => output.push(value) }), 0);
  assert.equal(output[0].plannedCalls, 4);
  assert.equal(io.events.length, 2);
});

test('plans select smoke consistently across every model and cap the total at 600 calls', () => {
  const document = exported([fixture(), fixture({ id: 'second' })]);
  const manifest = manifestFor(document);
  manifest.cases.second.smoke = false;
  assert.equal(preparePlan({ document, manifest }).plannedCalls, 2);
  assert.equal(preparePlan({ document, manifest, suite: 'full' }).plannedCalls, 4);
  const large = exported(Array.from({ length: 100 }, (_, i) => fixture({ id: `case-${i}` })));
  assert.equal(
    preparePlan({ document: large, models: ['a', 'b', 'c', 'd', 'e', 'f'] }).plannedCalls,
    600,
  );
  assert.throws(() =>
    preparePlan({ document: exported([...large.cases, fixture({ id: 'too-many' })]) }),
  );
  assert.throws(() =>
    preparePlan({
      document,
      manifest: { ...manifest, cases: { ...manifest.cases, 'case-1': metadata({ smoke: false }) } },
    }),
  );
});

test('manifest validates exact case mapping, version, synthetic data, known focus IDs and complete legal alternative tuples', () => {
  const document = exported([
    fixture({ expectedDecision: 'high_risk', categories: ['privacy'], ruleIds: ['隐私-002'] }),
  ]);
  const manifest = manifestFor(document);
  manifest.cases['case-1'].acceptedExpectations = [
    {
      expectedDecision: 'high_risk',
      categories: ['privacy', 'harassment'],
      ruleIds: ['隐私-002', '骚扰-001'],
      supportPriority: 'none',
    },
  ];
  assert.deepEqual(validateManifest(manifest, document), manifest);
  for (const invalid of [
    { ...manifest, policyVersion: 'old' },
    { ...manifest, syntheticOnly: false },
    { ...manifest, extra: 'no' },
    { ...manifest, cases: {} },
    { ...manifest, cases: { ...manifest.cases, unwanted: metadata() } },
    ...[
      { ruleFocus: ['EXP-001'] },
      { bucket: 'unknown' },
      { smoke: 'true' },
      { sourceUser: 10 },
      { acceptedExpectations: [{}] },
      {
        acceptedExpectations: [
          {
            expectedDecision: 'high_risk',
            categories: ['privacy'],
            ruleIds: [],
            supportPriority: 'none',
          },
        ],
      },
      {
        acceptedExpectations: [
          {
            expectedDecision: 'needs_review',
            categories: ['privacy'],
            ruleIds: ['隐私-002'],
            supportPriority: 'none',
          },
        ],
      },
      { acceptedExpectations: Array(9).fill(manifest.cases['case-1'].acceptedExpectations[0]) },
      { acceptedExpectations: Array(2).fill(manifest.cases['case-1'].acceptedExpectations[0]) },
    ].map((extra) => ({
      ...manifest,
      cases: { 'case-1': { ...manifest.cases['case-1'], ...extra } },
    })),
  ])
    assert.throws(() => validateManifest(invalid, document));
});

test('model listing reads only public settings catalog, never decrypts a key or calls provider', async () => {
  const h = harness();
  const catalog = await listAvailableModels({ config: config(), ...h.deps });
  assert.ok(catalog.models.some((item) => item.id === 'kimi-k2.6'));
  assert.deepEqual(h.reads, [{ includeSecret: false }]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.closed, 1);
  const io = memoryIO({ [DEFAULTS.config]: JSON.stringify(config()) });
  const outputs = [];
  assert.equal(
    await main(['--list-models'], {
      io,
      write: (value) => outputs.push(value),
      runnerDependencies: h.deps,
    }),
    0,
  );
  assert.equal(outputs[0].event, 'models');
  assert.equal(io.events.length, 2);
  assert.doesNotMatch(JSON.stringify(outputs), /private-config|apiKey|MYSQL_PASSWORD/);
});

test('all models are preflighted before the first paid call and unknown final model costs zero', async () => {
  const h = harness();
  const comparison = await h.run({ models: ['glm-5.1', 'kimi-k2.6', 'not-in-the-catalog'] });
  assert.equal(comparison.status, 'failed');
  assert.equal(comparison.stopReason, 'model_preflight_failed');
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.reads, [{ includeSecret: false }]);
  assert.equal(h.closed, 1);
});

test('execution is serial and preserves strict per-model reports; manifest and expected labels never reach API', async () => {
  let active = 0;
  const h = harness({
    fetchResult: async () => {
      active += 1;
      assert.equal(active, 1);
      await new Promise(setImmediate);
      active -= 1;
      return response();
    },
  });
  const document = exported([fixture(), fixture({ id: 'case-2' })]);
  const comparison = await h.run({ document, manifest: manifestFor(document) });
  assert.equal(comparison.status, 'completed');
  assert.equal(comparison.summary.matchedLabels, 4);
  assert.equal(h.calls.length, 4);
  assert.equal(h.closed, 3);
  assert.deepEqual(
    h.calls.map((call) => JSON.parse(call.options.body).model),
    ['glm-5.1', 'glm-5.1', 'kimi-k2.6', 'kimi-k2.6'],
  );
  for (const call of h.calls) {
    assert.equal(call.url, 'https://cloud.infini-ai.com/maas/v1/chat/completions');
    const sent = JSON.parse(JSON.parse(call.options.body).messages[1].content);
    assert.deepEqual(Object.keys(sent).sort(), [
      'content',
      'hasImages',
      'inputMode',
      'redactionCounts',
      'title',
    ]);
    assert.doesNotMatch(
      JSON.stringify(sent),
      /META_IS_NOT_SENT|expectedDecision|rationale|ruleFocus/,
    );
  }
  assert.equal(h.modelSnapshots.at(-1).report.results[0].evaluation.result, 'matched');
  assert.doesNotMatch(JSON.stringify(comparison), /private-config|apiKey|MYSQL_PASSWORD/);
});

test('three consecutive API failures stop only that model, without retries, and the next model still runs', async () => {
  const h = harness({
    fetchResult: (_url, options) =>
      JSON.parse(options.body).model === 'glm-5.1'
        ? new Response(PRIVATE, { status: 400 })
        : response(),
  });
  const comparison = await h.run({
    document: exported(Array.from({ length: 5 }, (_, i) => fixture({ id: `case-${i}` }))),
  });
  assert.equal(comparison.status, 'partial');
  assert.equal(comparison.models[0].stopReason, 'three_consecutive_api_failures');
  assert.equal(comparison.models[1].status, 'completed');
  assert.equal(h.calls.length, 8);
  assert.equal(comparison.summary.failed, 3);
  assert.equal(comparison.summary.unprocessed, 2);
  assert.doesNotMatch(JSON.stringify(comparison), /private-config/);
});

test('configuration and report failures prevent paid work or stop all remaining models', async () => {
  for (const extra of [
    { config: config({ MYSQL_PORT: 3306 }) },
    {
      persist: () => {
        throw new Error(PRIVATE);
      },
    },
    {
      persistModel: () => {
        throw new Error(PRIVATE);
      },
    },
  ]) {
    const h = harness();
    const result = await h.run(extra);
    assert.equal(result.status, 'failed');
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private-config/);
  }
  const h = harness();
  const comparison = await h.run({
    persistModel: (_model, report) => {
      if (report.results.length) throw new Error(PRIVATE);
    },
  });
  assert.equal(comparison.stopReason, 'report_write_failed');
  assert.equal(h.calls.length, 1);
  assert.equal(comparison.models.length, 1);
});

test('interruption stops before the next case or model while preserving completed results', async () => {
  let stopped = false;
  const h = harness();
  const comparison = await h.run({
    document: exported([fixture(), fixture({ id: 'next' })]),
    shouldStop: () => stopped,
    onProgress: () => {
      stopped = true;
    },
  });
  assert.equal(comparison.status, 'interrupted');
  assert.equal(comparison.summary.processed, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(comparison.models.length, 1);
  const before = harness();
  const noCalls = await before.run({ shouldStop: () => true });
  assert.equal(noCalls.status, 'interrupted');
  assert.equal(before.pools.length, 0);
});

test('changed client attempting retry or unexpected endpoint stops the entire batch', async () => {
  for (const url of [
    'https://cloud.infini-ai.com/maas/v1/chat/completions',
    'https://example.com',
  ]) {
    const h = harness({
      clientFactory: ({ fetchImpl }) => ({
        listModels: async () => ({
          defaultModel: 'glm-5.1',
          models: [{ id: 'glm-5.1' }, { id: 'kimi-k2.6' }],
        }),
        assess: async () => {
          await fetchImpl(url, { method: 'POST', redirect: 'error' });
          await fetchImpl(url, { method: 'POST', redirect: 'error' });
          throw new Error(PRIVATE);
        },
      }),
    });
    const comparison = await h.run();
    assert.equal(comparison.status, 'failed');
    assert.equal(comparison.models.length, 1);
    assert.equal(h.calls.length, url.startsWith('https://example') ? 0 : 1);
  }
});

test('model path components are numbered, snapshots replace atomically and report directories stay unique', () => {
  const io = memoryIO();
  const one = createBatchWriter('F:\\reports', ['vendor/model', 'kimi-k2.6'], io);
  const two = createBatchWriter('F:\\reports', ['vendor/model'], io);
  assert.notEqual(one.directory, two.directory);
  assert.equal(
    path.dirname(one.modelFiles['vendor/model'].reportPath),
    path.join(one.directory, 'model-01'),
  );
  one.persistModel('vendor/model', { results: [{ id: 'first' }] });
  one.persistModel('vendor/model', { results: [{ id: 'first' }, { id: 'second' }] });
  assert.equal(
    JSON.parse(io.files.get(one.modelFiles['vendor/model'].reportPath)).results.length,
    2,
  );
  assert.ok(![...io.files.keys()].some((name) => name.endsWith('.tmp')));
});

test('main produces comparison JSON, self-contained HTML and per-model reports with correct exit codes', async () => {
  const input = 'F:\\cases.json';
  const configPath = 'F:\\config.json';
  for (const [value, fetchResult, expectedCode] of [
    [fixture(), () => response(), 0],
    [fixture({ ruleIds: ['关怀-001'], supportPriority: 'attention' }), () => response(), 2],
    [fixture(), () => new Response(PRIVATE, { status: 500 }), 1],
  ]) {
    const io = memoryIO({
      [input]: JSON.stringify(exported([value])),
      [configPath]: JSON.stringify(config()),
    });
    const outputs = [];
    const h = harness({ fetchResult });
    const code = await main(
      ['--input', input, '--config', configPath, '--output', 'F:\\results', '--run'],
      {
        io,
        write: (item) => outputs.push(item),
        runnerDependencies: h.deps,
        noProcessSignals: true,
      },
    );
    assert.equal(code, expectedCode);
    const summary = outputs.at(-1);
    assert.equal(summary.event, 'summary');
    assert.equal(summary.plannedCalls, 2);
    assert.equal(JSON.parse(io.files.get(summary.comparisonJson)).models.length, 2);
    assert.match(io.files.get(summary.reportHtml), /<!doctype html>/i);
    assert.doesNotMatch(JSON.stringify(outputs), /private-config|MYSQL_PASSWORD/);
  }
});

test('write failure in progress stream stops before any next request', async () => {
  const h = harness();
  const comparison = await h.run({
    onProgress: () => {
      throw new Error(PRIVATE);
    },
  });
  assert.equal(comparison.status, 'failed');
  assert.equal(comparison.stopReason, 'report_write_failed');
  assert.equal(h.calls.length, 1);
});

test('policy version errors stop the entire batch without moving to another model', async () => {
  const h = harness({
    clientFactory: ({ fetchImpl }) => ({
      listModels: async () => ({
        defaultModel: 'glm-5.1',
        models: [{ id: 'glm-5.1' }, { id: 'kimi-k2.6' }],
      }),
      assess: async () => {
        await fetchImpl('https://cloud.infini-ai.com/maas/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
        });
        return { policyVersion: 'obsolete', assessment: assessment() };
      },
    }),
  });
  const comparison = await h.run();
  assert.equal(comparison.status, 'failed');
  assert.equal(comparison.models.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(comparison.models[0].results[0].error.code, 'policy_version');
});

test('accepted complete rule combination affects comparison only and preserves original strict evaluation', async () => {
  const value = fixture({
    content: '把这个同学的住址公开，大家一起上门嘲笑他。',
    expectedDecision: 'high_risk',
    categories: ['privacy'],
    ruleIds: ['隐私-002'],
  });
  const document = exported([value]);
  const manifest = manifestFor(document);
  manifest.cases[value.id].acceptedExpectations = [
    {
      expectedDecision: 'high_risk',
      categories: ['privacy', 'harassment'],
      ruleIds: ['隐私-002', '骚扰-001'],
      supportPriority: 'none',
    },
  ];
  const h = harness({
    fetchResult: () =>
      response(
        assessment({
          decision: 'high_risk',
          categories: ['privacy', 'harassment'],
          ruleMatches: ['隐私-002', '骚扰-001'].map((ruleId) => ({
            ruleId,
            evidence: { field: 'content', quote: value.content },
            explanation: '用具体住址发起针对个人的骚扰。',
          })),
        }),
      ),
  });
  const comparison = await h.run({ document, manifest });
  assert.equal(comparison.summary.acceptedVariantMatches, 2);
  assert.equal(comparison.summary.labelsToReview, 0);
  assert.equal(comparison.models[0].results[0].evaluation.result, 'review');
  assert.equal(comparison.models[0].results[0].comparisonEvaluation.result, 'matched');
  assert.equal(h.modelSnapshots.at(-1).report.results[0].evaluation.result, 'review');
  assert.equal(h.modelSnapshots.at(-1).report.results[0].comparisonEvaluation, undefined);
});

test('main returns interruption code with useful saved partial reports', async () => {
  const input = 'F:\\cases.json';
  const configPath = 'F:\\config.json';
  const io = memoryIO({
    [input]: JSON.stringify(exported([fixture(), fixture({ id: 'second' })])),
    [configPath]: JSON.stringify(config()),
  });
  const outputs = [];
  const h = harness();
  let stopped = false;
  const code = await main(
    ['--input', input, '--config', configPath, '--output', 'F:\\results', '--run'],
    {
      io,
      write: (item) => {
        outputs.push(item);
        if (item.event === 'result') stopped = true;
      },
      runnerDependencies: h.deps,
      noProcessSignals: true,
      shouldStop: () => stopped,
    },
  );
  assert.equal(code, 130);
  const saved = JSON.parse(io.files.get(outputs.at(-1).comparisonJson));
  assert.equal(saved.status, 'interrupted');
  assert.equal(saved.summary.processed, 1);
  assert.equal(h.calls.length, 1);
});
