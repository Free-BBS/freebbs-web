const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { aiTestEnvironmentEnabled, createModerationAiTest } = require('./moderation-ai-test');
const { createModerationRouter } = require('./moderation-router');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const calls = [];
  const snapshot = {
    submissionId: 'case-1',
    version: 1,
    contentHash: 'a'.repeat(64),
    title: '合成标题',
    content: '合成原文',
    imageCount: 1,
  };
  let authorized = true;
  let pending = true;
  let provider;
  function check(input) {
    if (!authorized || input.reviewerId === 3)
      throw Object.assign(new Error('需要审核负责人权限。'), { status: 403 });
    if (!pending || input.expectedVersion !== 1)
      throw Object.assign(new Error('稿件状态变化。'), { status: 409 });
  }
  const service = {
    async aiTestSnapshot(input) {
      calls.push(['snapshot', input]);
      check(input);
      return { ...snapshot };
    },
    async previewPrivacy(input) {
      calls.push(['preview', input]);
      check(input);
      return {
        ...snapshot,
        content: '【姓名_1】建议改善环境',
        counts: { name: 1 },
        redactorVersion: 'local-preview-v2',
        externalReady: false,
      };
    },
    async isReviewer(id) {
      return id !== 3;
    },
  };
  const client = {
    async assess(input) {
      calls.push(['provider', input]);
      if (provider) await provider(input);
      return {
        assessment: { decision: 'no_risk_detected', categories: [], reason: '文字未见明显风险' },
        model: 'fixture-model',
        settingsRevision: 2,
        policyVersion: 'fixture-policy',
        elapsedMs: 1,
        apiKey: 'MUST_NOT_RETURN',
        untrustedExtra: 'MUST_NOT_RETURN',
      };
    },
  };
  const aiTest = createModerationAiTest({ service, client, enabled: true });
  const request = {
    id: 'case-1',
    reviewerId: 1,
    expectedVersion: 1,
    inputMode: 'redacted',
    extraTerms: ['合成姓名'],
  };
  return {
    aiTest,
    service,
    request,
    calls,
    snapshot,
    client,
    setAuthorized(value) {
      authorized = value;
    },
    setPending(value) {
      pending = value;
    },
    setProvider(callback) {
      provider = callback;
    },
  };
}

test('AI test requires both explicit flags and local server and public origins', () => {
  const config = {
    discussionModerationEnabled: true,
    discussionModerationAiTestEnabled: true,
    apiHost: '127.0.0.1',
    publicWebUrl: 'http://127.0.0.1:3000',
  };
  assert.equal(aiTestEnvironmentEnabled(config), true);
  for (const change of [
    { discussionModerationEnabled: false },
    { discussionModerationAiTestEnabled: false },
    { apiHost: '0.0.0.0' },
    { publicWebUrl: 'https://freebbs.example' },
    { publicWebUrl: 'http://localhost.evil.test' },
    { publicWebUrl: 'http://user:pass@localhost' },
    { publicWebUrl: 'file:///tmp/test' },
    { publicWebUrl: 'invalid' },
  ])
    assert.equal(aiTestEnvironmentEnabled({ ...config, ...change }), false);
});

test('redacted AI test sends only derived text and returns a scoped non-publishing result', async () => {
  const h = harness();
  const result = await h.aiTest.run(h.request);
  assert.deepEqual(
    h.calls.map(([kind]) => kind),
    ['preview', 'provider', 'snapshot'],
  );
  assert.deepEqual(h.calls[1][1], {
    title: '合成标题',
    content: '【姓名_1】建议改善环境',
    inputMode: 'redacted',
    redactionCounts: { name: 1 },
    hasImages: true,
  });
  assert.equal(result.automaticPublication, false);
  assert.equal(result.imagesReviewed, false);
  assert.equal(result.imageCount, 1);
  assert.equal(result.contentHash, h.snapshot.contentHash);
  assert.equal(result.redactorVersion, 'local-preview-v2');
  assert.ok(result.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_RETURN|合成原文|合成姓名/);
});

test('synthetic original mode is explicit and does not append extra terms or identity directory data', async () => {
  const h = harness();
  const result = await h.aiTest.run({ ...h.request, inputMode: 'synthetic_original' });
  assert.deepEqual(
    h.calls.map(([kind]) => kind),
    ['snapshot', 'provider', 'snapshot'],
  );
  assert.deepEqual(h.calls[1][1], {
    title: '合成标题',
    content: '合成原文',
    inputMode: 'synthetic_original',
    redactionCounts: {},
    hasImages: true,
  });
  assert.equal(result.redactorVersion, null);
});

test('disabled, unauthorized and invalid requests never start a paid model call', async () => {
  const h = harness();
  await assert.rejects(
    createModerationAiTest({ service: h.service, client: h.client }).run(h.request),
    { status: 503 },
  );
  for (const inputMode of [undefined, 'automatic', 'original'])
    await assert.rejects(h.aiTest.run({ ...h.request, inputMode }), { status: 400 });
  await assert.rejects(h.aiTest.run({ ...h.request, extraTerms: ['x'.repeat(129)] }), {
    status: 400,
  });
  h.setAuthorized(false);
  await assert.rejects(h.aiTest.run(h.request), { status: 403 });
  assert.equal(
    h.calls.some(([kind]) => kind === 'provider'),
    false,
  );
});

test('human decisions, expired or changed evidence, and revoked authority discard late AI results', async () => {
  for (const mutate of [
    (h) => h.setPending(false),
    (h) => h.setAuthorized(false),
    (h) => {
      h.snapshot.contentHash = 'b'.repeat(64);
    },
  ]) {
    const h = harness();
    h.setProvider(() => mutate(h));
    await assert.rejects(h.aiTest.run(h.request), (error) => [403, 409].includes(error.status));
    assert.equal(h.calls.filter(([kind]) => kind === 'provider').length, 1);
  }
});

test('per-reviewer and global inflight limits release on success and provider failure without retry', async () => {
  const h = harness();
  const wait = deferred();
  h.setProvider(() => wait.promise);
  const first = h.aiTest.run(h.request);
  await assert.rejects(h.aiTest.run(h.request), { status: 429 });
  const second = h.aiTest.run({ ...h.request, reviewerId: 2 });
  await assert.rejects(h.aiTest.run({ ...h.request, reviewerId: 4 }), { status: 429 });
  wait.resolve();
  await Promise.all([first, second]);
  h.setProvider(() => {
    throw Object.assign(new Error('固定上游错误'), { status: 502 });
  });
  await assert.rejects(h.aiTest.run(h.request), { status: 502 });
  h.setProvider(null);
  await h.aiTest.run(h.request);
  assert.equal(h.calls.filter(([kind]) => kind === 'provider').length, 4);
});

test('real HTTP test route derives identity from auth and rejects body overrides', async (t) => {
  const h = harness();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/moderation',
    createModerationRouter({
      service: h.service,
      aiTest: h.aiTest,
      enabled: true,
      requireAuth: async (request, response) => {
        const roles = { reviewer: { id: 1 }, admin: { id: 3, is_admin: true } };
        const user = roles[request.headers.authorization];
        if (!user) response.status(401).json({ message: '登录' });
        return user;
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (auth, extra = {}) =>
    fetch(`${origin}/api/moderation/submissions/case-1/ai-test`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, inputMode: 'redacted', ...extra }),
    });
  assert.equal((await call('anonymous')).status, 401);
  assert.equal((await call('admin')).status, 403);
  for (const key of ['title', 'content', 'reviewerId', 'model', 'baseUrl', 'apiKey', 'images'])
    assert.equal((await call('reviewer', { [key]: 'client override' })).status, 400);
  const response = await call('reviewer');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).result.automaticPublication, false);
  const session = await fetch(`${origin}/api/moderation/session`, {
    headers: { Authorization: 'reviewer' },
  });
  assert.equal((await session.json()).aiTestEnabled, true);
  assert.equal(h.calls.filter(([kind]) => kind === 'provider').length, 1);
});
