/* eslint-disable max-classes-per-file, class-methods-use-this -- Minimal DOM and browser doubles. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { attachmentId, publishedLink, createClient, mount } = require('../public/moderation');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.events = {};
    this.attributes = {};
    this.dataset = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
  }

  set innerHTML(_value) {
    throw new Error('Review content must never use innerHTML');
  }

  set textContent(value) {
    this.text = value;
    this.children = [];
  }

  get textContent() {
    return (this.text || '') + this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.text = '';
    this.children = children;
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  addEventListener(name, callback) {
    this.events[name] = callback;
  }

  querySelectorAll(tag) {
    return this.children.flatMap((child) => [
      ...(child.tagName === tag.toUpperCase() ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }

  focus() {}

  remove() {}

  decode() {
    return Promise.resolve();
  }

  click() {
    return this.disabled ? undefined : this.events.click?.();
  }
}

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, blob: async () => payload };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const imageId = '11111111-2222-4333-8444-555555555555';
function harness({
  mine = false,
  search,
  customFetch,
  reviewer = true,
  isAdmin = false,
  aiTestEnabled = false,
} = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  get('moderation-status').value = 'pending';
  let token = 'reviewer-token';
  const requests = [];
  const events = {};
  const revoked = [];
  const submission = {
    id: 's1',
    kind: 'post',
    title: '<img src=x onerror=attack()>',
    contentMarkdown: '<script>attack()</script> ![remote](https://evil.invalid/a.png)',
    status: 'pending',
    version: 1,
    contentHash: 'a'.repeat(64),
    author: { username: '<b>A</b>' },
    attachments: [],
    createdAt: '2026-10-07T00:00:00Z',
  };
  let decisionAttempts = 0;
  const defaults = async (url) => {
    if (url.endsWith('/session'))
      return response({ enabled: true, reviewer, isAdmin, aiTestEnabled, mode: 'manual' });
    if (url.endsWith('/reviewers')) return response({ reviewers: [] });
    if (/\/(mine|submissions)\?/.test(url)) return response({ submissions: [submission] });
    if (url.endsWith('/s1')) return response({ submission: { ...submission } });
    if (url.includes('/attachments/')) return response({ type: 'image/webp', size: 100 });
    if (url.endsWith('/decision')) {
      decisionAttempts += 1;
      submission.status = 'approved';
      return response({ ok: true });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const app = mount({
    document: { getElementById: get, createElement: (tag) => new Element(tag) },
    window: {
      location: { origin: 'http://localhost:3000', search: search ?? (mine ? '?mine=1' : '') },
      addEventListener: (name, callback) => {
        events[name] = callback;
      },
    },
    storage: { getItem: () => token },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return customFetch ? customFetch(url, options, defaults) : defaults(url, options);
    },
    urlApi: {
      createObjectURL: () => `blob:preview-${requests.length}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    cryptoApi: crypto,
  });
  return {
    app,
    get: (id) => get(`moderation-${id}`),
    submission,
    requests,
    events,
    revoked,
    setToken: (value) => {
      token = value;
    },
    decisionAttempts: () => decisionAttempts,
  };
}

test('attachment and published links never forward bearer credentials to external URLs', () => {
  assert.equal(
    attachmentId(
      { url: `https://evil.invalid/api/moderation/attachments/${imageId}` },
      '/api',
      'http://localhost:3000',
    ),
    '',
  );
  assert.equal(
    attachmentId(
      { url: `/api/moderation/attachments/${imageId}` },
      '/api',
      'http://localhost:3000',
    ),
    imageId,
  );
  assert.equal(
    attachmentId(
      { url: '/api/moderation/attachments/../../users' },
      '/api',
      'http://localhost:3000',
    ),
    '',
  );
  assert.equal(publishedLink('//evil.invalid/discussion', 'http://localhost:3000'), '');
  assert.equal(
    publishedLink('/discussion?post=P1', 'http://localhost:3000'),
    '/discussion?post=P1',
  );
});

test('review raw title, body and author stay literal text; Markdown URLs do not load', async () => {
  const h = harness();
  await h.app.ready;
  await h.app.openSubmission('s1');
  assert.ok(h.get('detail').textContent.includes('<script>attack()</script>'));
  assert.ok(h.get('detail').textContent.includes('<img src=x onerror=attack()>'));
  assert.ok(h.get('detail').textContent.includes('<b>A</b>'));
  assert.equal(h.get('detail').querySelectorAll('img').length, 0);
  assert.ok(h.requests.every(({ url }) => url.startsWith('http://localhost:3000/api/')));
});

test('private images use authorization then blob URLs and are revoked when leaving a submission', async () => {
  const h = harness();
  h.submission.attachments = [{ id: imageId }];
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const request = h.requests.find(({ url }) => url.includes('/attachments/'));
  assert.equal(request.options.headers.Authorization, 'Bearer reviewer-token');
  assert.equal(request.options.cache, 'no-store');
  assert.match(h.get('detail').querySelectorAll('img')[0].src, /^blob:/);
  await h.app.loadList();
  assert.equal(h.revoked.length, 1);
});

test('failed or foreign attachment blocks approval while keeping a reasoned rejection possible', async () => {
  const h = harness();
  h.submission.attachments = [{ url: 'https://evil.invalid/photo.png' }];
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const buttons = h.get('detail').querySelectorAll('button');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].disabled, false);
  await buttons[1].click();
  assert.equal(h.decisionAttempts(), 0);
  assert.ok(h.get('detail').textContent.includes('请填写未通过原因'));
});

test('mine shows all states and provides no review decision controls', async () => {
  const h = harness({ mine: true });
  await h.app.ready;
  await h.app.openSubmission('s1');
  assert.equal(h.get('detail').querySelectorAll('button').length, 0);
  assert.equal(h.get('status').hidden, true);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/moderation/mine?')));
});

test('notification detail URL opens the author view without granting review controls', async () => {
  const h = harness({ search: '?id=s1', reviewer: false });
  await h.app.ready;
  assert.equal(h.app.state.selected.id, 's1');
  assert.equal(h.get('title').textContent, '我的提交');
  assert.equal(h.get('workspace').hidden, false);
  assert.equal(h.get('detail').querySelectorAll('button').length, 0);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/moderation/mine?')));
});

test('notification detail URL opens the review workspace for an active reviewer', async () => {
  const h = harness({ search: '?id=s1', reviewer: true });
  await h.app.ready;
  assert.equal(h.app.state.selected.id, 's1');
  assert.equal(h.get('title').textContent, '审核工作台');
  assert.equal(
    h
      .get('detail')
      .querySelectorAll('button')
      .filter((button) => button.dataset.decision).length,
    2,
  );
});

test('administrator sees a warning when no reviewer is configured', async () => {
  const h = harness({ isAdmin: true });
  await h.app.ready;
  await flush();
  assert.ok(h.get('reviewer-list').textContent.includes('当前没有审核负责人'));
});

const privacyResponse = (extra = {}) => ({
  preview: {
    submissionId: 's1',
    version: 1,
    mode: 'local_preview',
    externalReady: false,
    title: '[姓名1]的建议',
    content: '<script>literal()</script> [电话1]',
    counts: { name: 1, phone: 1, address: 2 },
    imageCount: 1,
    ...extra,
  },
});
const privacyButton = (h) =>
  h
    .get('detail')
    .querySelectorAll('button')
    .find((button) => button.textContent === '生成本地脱敏预览');
const privacyTerms = (h) =>
  h
    .get('detail')
    .querySelectorAll('textarea')
    .find((input) => input.id === 'moderation-privacy-terms');

test('privacy preview sends only the version and added terms locally and renders output literally', async () => {
  const h = harness({
    customFetch: (url, options, defaults) =>
      url.endsWith('/privacy-preview') ? response(privacyResponse()) : defaults(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  privacyTerms(h).value = '  王小明\n\n 一号楼  ';
  await privacyButton(h).click();
  const request = h.requests.find(({ url }) => url.endsWith('/privacy-preview'));
  assert.deepEqual(JSON.parse(request.options.body), {
    expectedVersion: 1,
    extraTerms: ['王小明', '一号楼'],
  });
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.cache, 'no-store');
  assert.ok(h.requests.every(({ url }) => url.startsWith('http://localhost:3000/api/')));
  assert.ok(h.get('detail').textContent.includes('<script>literal()</script> [电话1]'));
  assert.ok(h.get('detail').textContent.includes('图片内信息尚未处理'));
  assert.ok(h.get('detail').textContent.includes('未发送给 AI'));
  assert.ok(h.get('detail').textContent.includes('地址 2 处'));
  assert.equal(h.decisionAttempts(), 0);
  assert.equal(h.submission.status, 'pending');
});

test('privacy preview rejects excessive terms and stale or mislabeled responses', async () => {
  const h = harness({
    customFetch: (url, options, defaults) =>
      url.endsWith('/privacy-preview')
        ? response(privacyResponse({ version: 2 }))
        : defaults(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  privacyTerms(h).value = Array(51).fill('敏感词').join('\n');
  await privacyButton(h).click();
  assert.equal(
    h.requests.some(({ url }) => url.endsWith('/privacy-preview')),
    false,
  );
  privacyTerms(h).value = '';
  await privacyButton(h).click();
  assert.ok(h.get('detail').textContent.includes('预览结果无效'));
  assert.equal(h.get('detail').textContent.includes('[电话1]'), false);
});

test('editing privacy terms invalidates an in-flight preview and clears the displayed copy', async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness({
    customFetch: (url, options, defaults) => {
      if (!url.endsWith('/privacy-preview')) return defaults(url, options);
      calls += 1;
      return calls === 1 ? pending.promise : response(privacyResponse());
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  const loading = privacyButton(h).click();
  privacyTerms(h).value = '新姓名';
  privacyTerms(h).events.input();
  pending.resolve(response(privacyResponse()));
  await loading;
  assert.equal(h.get('detail').textContent.includes('[电话1]'), false);
  assert.ok(h.get('detail').textContent.includes('请重新生成预览'));
  await privacyButton(h).click();
  assert.ok(h.get('detail').textContent.includes('[电话1]'));
  privacyTerms(h).events.input();
  assert.equal(h.get('detail').textContent.includes('[电话1]'), false);
});

test('logout discards a late privacy preview and approved submissions do not expose its action', async () => {
  const pending = deferred();
  const h = harness({
    customFetch: (url, options, defaults) =>
      url.endsWith('/privacy-preview') ? pending.promise : defaults(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  const loading = privacyButton(h).click();
  h.setToken('');
  await h.app.initialize();
  pending.resolve(response(privacyResponse()));
  await loading;
  assert.equal(h.get('detail').textContent.includes('[电话1]'), false);
  assert.equal(privacyButton(h), undefined);
  h.setToken('reviewer-token');
  h.submission.status = 'approved';
  await h.app.initialize();
  await h.app.openSubmission('s1');
  assert.equal(privacyButton(h), undefined);
});

const aiResponse = (extra = {}) => ({
  result: {
    submissionId: 's1',
    version: 1,
    contentHash: 'a'.repeat(64),
    inputMode: 'redacted',
    model: 'synthetic-test-model',
    settingsRevision: 7,
    policyVersion: 'test-policy-v1',
    redactorVersion: 'test-redactor-v1',
    elapsedMs: 1250,
    assessment: {
      decision: 'no_risk_detected',
      categories: ['privacy'],
      reason: '<script>aiReason()</script> **literal** ![external](https://evil.invalid/ai.png)',
    },
    imageCount: 1,
    imagesReviewed: false,
    automaticPublication: false,
    ...extra,
  },
});
const aiButton = (h) =>
  h
    .get('detail')
    .querySelectorAll('button')
    .find((item) => item.textContent === '调用无问芯穹试审');
const aiMode = (h) =>
  h
    .get('detail')
    .querySelectorAll('select')
    .find((item) => item.id === 'moderation-ai-input-mode');
const aiRequests = (h) => h.requests.filter(({ url }) => url.endsWith('/ai-test'));

test('AI trial is available only to an enabled reviewer viewing pending work outside mine', async () => {
  for (const options of [
    {},
    { aiTestEnabled: true, reviewer: false, search: '?id=s1' },
    { aiTestEnabled: true, mine: true },
    { aiTestEnabled: true, reviewer: false, isAdmin: true, mine: true },
  ]) {
    const h = harness(options);
    await h.app.ready;
    await h.app.openSubmission('s1');
    assert.equal(aiButton(h), undefined);
    assert.equal(aiRequests(h).length, 0);
  }
  for (const status of ['approved', 'rejected', 'expired']) {
    const h = harness({ aiTestEnabled: true });
    h.submission.status = status;
    await h.app.ready;
    await h.app.openSubmission('s1');
    assert.equal(aiButton(h), undefined);
  }
  const h = harness({ aiTestEnabled: true });
  await h.app.ready;
  await h.app.openSubmission('s1');
  assert.ok(aiButton(h));
  assert.equal(aiMode(h).value, 'redacted');
  assert.deepEqual(
    aiMode(h).children.map((item) => item.value),
    ['redacted', 'synthetic_original'],
  );
});

test('AI trial sends only the server-owned snapshot version, mode and terms and leaves decisions unchanged', async () => {
  const h = harness({
    aiTestEnabled: true,
    customFetch: (url, options, defaults) =>
      url.endsWith('/ai-test') ? response(aiResponse()) : defaults(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const before = JSON.stringify(h.app.state.selected);
  const decisions = h
    .get('detail')
    .querySelectorAll('button')
    .filter((item) => item.dataset.decision);
  const disabled = decisions.map((item) => item.disabled);
  privacyTerms(h).value = '  测试姓名\n\n 测试地址  ';
  await aiButton(h).click();
  const [{ options }] = aiRequests(h);
  assert.deepEqual(JSON.parse(options.body), {
    expectedVersion: 1,
    inputMode: 'redacted',
    extraTerms: ['测试姓名', '测试地址'],
  });
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer reviewer-token');
  assert.equal(options.cache, 'no-store');
  assert.ok(h.requests.every(({ url }) => url.startsWith('http://localhost:3000/api/')));
  const text = h.get('detail').textContent;
  for (const expected of [
    '未发现明显风险，仍需人工决定',
    'synthetic-test-model',
    '1.3 秒',
    '隐私信息',
    '<script>aiReason()</script> **literal**',
    '图片尚未机器审核',
    '本次发送：本地脱敏后的文字副本',
    '不会自动发布',
  ])
    assert.ok(text.includes(expected), expected);
  assert.equal(h.get('detail').querySelectorAll('script').length, 0);
  assert.equal(h.get('detail').querySelectorAll('img').length, 0);
  assert.equal(JSON.stringify(h.app.state.selected), before);
  assert.deepEqual(
    decisions.map((item) => item.disabled),
    disabled,
  );
  assert.equal(h.decisionAttempts(), 0);
  privacyTerms(h).value = '另一条信息';
  privacyTerms(h).events.input();
  assert.equal(h.get('detail').textContent.includes('aiReason'), false);
  assert.equal(aiRequests(h).length, 1);
});

test('synthetic-original mode is explicit and input edits never call the provider automatically', async () => {
  const h = harness({
    aiTestEnabled: true,
    customFetch: (url, options, defaults) =>
      url.endsWith('/ai-test')
        ? response(
            aiResponse({
              inputMode: 'synthetic_original',
              imageCount: 0,
              assessment: {
                decision: 'high_risk',
                categories: ['threat', 'harassment'],
                reason: '需要人工核查的合成样例',
              },
            }),
          )
        : defaults(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  aiMode(h).value = 'synthetic_original';
  aiMode(h).events.change();
  privacyTerms(h).value = '测试词';
  privacyTerms(h).events.input();
  assert.equal(aiRequests(h).length, 0);
  await aiButton(h).click();
  assert.equal(JSON.parse(aiRequests(h)[0].options.body).inputMode, 'synthetic_original');
  assert.ok(h.get('detail').textContent.includes('本次发送：虚构原文（仅测试）'));
  assert.ok(h.get('detail').textContent.includes('发现高风险迹象，请人工核查'));
  assert.ok(h.get('detail').textContent.includes('威胁、骚扰侮辱'));
  aiMode(h).value = 'redacted';
  aiMode(h).events.change();
  assert.equal(h.get('detail').textContent.includes('合成样例'), false);
  assert.equal(aiRequests(h).length, 1);
});

test('AI trial prevents duplicate calls and discards responses after terms or mode change', async () => {
  for (const changed of ['terms', 'mode']) {
    const pending = deferred();
    const h = harness({
      aiTestEnabled: true,
      customFetch: (url, options, defaults) =>
        url.endsWith('/ai-test') ? pending.promise : defaults(url, options),
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    const button = aiButton(h);
    const loading = button.click();
    assert.equal(button.disabled, true);
    await button.events.click();
    if (changed === 'terms') {
      privacyTerms(h).value = '新测试信息';
      privacyTerms(h).events.input();
    } else {
      aiMode(h).value = 'synthetic_original';
      aiMode(h).events.change();
    }
    assert.equal(aiRequests(h).length, 1);
    pending.resolve(response(aiResponse()));
    await loading;
    assert.equal(h.get('detail').textContent.includes('aiReason'), false);
    assert.equal(button.disabled, false);
    assert.ok(h.get('detail').textContent.includes('请手动重新调用'));
  }
});

test('late AI responses cannot restore results after logout, detail replacement or capability loss', async () => {
  for (const change of ['logout', 'detail', 'reviewer', 'capability', 'version']) {
    const pending = deferred();
    const h = harness({
      aiTestEnabled: true,
      customFetch: (url, options, defaults) =>
        url.endsWith('/ai-test') ? pending.promise : defaults(url, options),
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    const loading = aiButton(h).click();
    if (change === 'logout') {
      h.setToken('');
      await h.app.initialize();
    } else if (change === 'detail') await h.app.openSubmission('s1');
    else if (change === 'reviewer') h.app.state.session.reviewer = false;
    else if (change === 'capability') h.app.state.session.aiTestEnabled = false;
    else h.app.state.selected.version = 2;
    pending.resolve(response(aiResponse()));
    await loading;
    assert.equal(h.get('detail').textContent.includes('aiReason'), false, change);
    assert.equal(h.decisionAttempts(), 0);
  }
});

test('AI trial errors preserve manual decisions and require an explicit click for a retry', async () => {
  for (const code of [503, 403, 409]) {
    let calls = 0;
    const h = harness({
      aiTestEnabled: true,
      customFetch: (url, options, defaults) => {
        if (!url.endsWith('/ai-test')) return defaults(url, options);
        calls += 1;
        return calls === 1
          ? response({ message: '试审模型设置尚未配置' }, code)
          : response(aiResponse());
      },
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    await aiButton(h).click();
    assert.equal(aiButton(h).disabled, false);
    assert.ok(
      h
        .get('detail')
        .textContent.includes(code === 409 ? '提交状态或版本已变化' : '试审模型设置尚未配置'),
    );
    assert.equal(calls, 1);
    assert.equal(h.app.state.selected.status, 'pending');
    assert.equal(
      h
        .get('detail')
        .querySelectorAll('button')
        .find((item) => item.dataset.decision === 'approved').disabled,
      false,
    );
    await aiButton(h).click();
    assert.equal(calls, 2);
    assert.ok(h.get('detail').textContent.includes('文字试审已完成'));
    assert.equal(h.decisionAttempts(), 0);
  }
});

test('AI trial rejects excessive terms and mismatched or unsafe response envelopes', async () => {
  const invalid = [
    { submissionId: 'other' },
    { version: 2 },
    { contentHash: 'b'.repeat(64) },
    { inputMode: 'synthetic_original' },
    { imagesReviewed: true },
    { automaticPublication: true },
    { assessment: { decision: 'approved', categories: [], reason: 'invalid' } },
    { assessment: { decision: 'needs_review', categories: ['invented'], reason: 'invalid' } },
    { assessment: { decision: 'needs_review', categories: [], reason: 'x'.repeat(1001) } },
  ];
  for (const payload of invalid) {
    const h = harness({
      aiTestEnabled: true,
      customFetch: (url, options, defaults) =>
        url.endsWith('/ai-test') ? response(aiResponse(payload)) : defaults(url, options),
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    privacyTerms(h).value = Array(51).fill('词').join('\n');
    await aiButton(h).click();
    assert.equal(aiRequests(h).length, 0);
    privacyTerms(h).value = '';
    await aiButton(h).click();
    assert.ok(h.get('detail').textContent.includes('试审结果无效'));
    assert.equal(h.get('detail').textContent.includes('文字试审已完成'), false);
    assert.equal(h.decisionAttempts(), 0);
  }
});

test('an administrator outside the reviewer registry can manage reviewers from mine without review controls', async () => {
  const h = harness({ mine: true, reviewer: false, isAdmin: true });
  await h.app.ready;
  await flush();
  await h.app.openSubmission('s1');
  assert.equal(h.get('review-link').hidden, true);
  assert.equal(h.get('reviewers').hidden, false);
  assert.equal(h.get('detail').querySelectorAll('button').length, 0);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/moderation/reviewers')));
  assert.ok(!h.requests.some(({ url }) => url.includes('/moderation/submissions?')));
});

test('same decision retries reuse requestId and include the inspected version', async () => {
  let attempts = 0;
  const h = harness({
    customFetch: (url, options, defaults) => {
      if (url.endsWith('/decision')) {
        attempts += 1;
        if (attempts === 1) throw new Error('network unavailable');
      }
      return defaults(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const approve = h.get('detail').querySelectorAll('button')[0];
  await approve.click();
  assert.equal(approve.disabled, false);
  await approve.click();
  const bodies = h.requests
    .filter(({ url }) => url.endsWith('/decision'))
    .map(({ options }) => JSON.parse(options.body));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].expectedVersion, 1);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
  assert.equal(h.app.state.selected.status, 'approved');
});

test('stale version conflicts reload current content instead of automatically approving it', async () => {
  const h = harness({
    customFetch: (url, options, defaults) => {
      if (url.endsWith('/decision')) {
        h.submission.version = 2;
        return response({ message: 'stale' }, 409);
      }
      return defaults(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  await h.get('detail').querySelectorAll('button')[0].click();
  assert.equal(h.app.state.selected.version, 2);
  assert.equal(h.requests.filter(({ url }) => url.endsWith('/decision')).length, 1);
  assert.ok(h.get('message').textContent.includes('状态已变化'));
});

test('logout invalidates a pending private detail response and removes existing content', async () => {
  const wait = deferred();
  const h = harness({
    customFetch: (url, options, defaults) =>
      url.endsWith('/s1') ? wait.promise : defaults(url, options),
  });
  await h.app.ready;
  const opening = h.app.openSubmission('s1');
  h.setToken('');
  await h.events.storage({ key: 'free_bbs_auth_token' });
  wait.resolve(response({ submission: h.submission }));
  await opening;
  assert.equal(h.app.state.selected, null);
  assert.ok(!h.get('detail').textContent.includes('attack'));
  assert.equal(h.get('workspace').hidden, true);
});

test('pagination passes the opaque before cursor and appends results', async () => {
  const h = harness({
    customFetch: (url, options, defaults) => {
      if (url.endsWith('/submissions?status=pending'))
        return response({ submissions: [{ id: 'a', title: 'First' }], nextCursor: 'opaque:a/b' });
      if (url.includes('before=')) return response({ submissions: [{ id: 'b', title: 'Second' }] });
      return defaults(url, options);
    },
  });
  await h.app.ready;
  await h.get('more').click();
  assert.ok(h.requests.some(({ url }) => url.includes('before=opaque%3Aa%2Fb')));
  assert.equal(h.get('list').children.length, 2);
  assert.equal(h.get('more').hidden, true);
});

test('API client rejects images containing active document formats', async () => {
  const client = createClient({
    apiBase: '/api',
    getToken: () => 'token',
    fetch: async () => response({ type: 'image/svg+xml', size: 200 }),
  });
  await assert.rejects(client.request('/moderation/attachments/id', {}, true), /图片格式/);
});

const appSource = fs.readFileSync(require.resolve('../public/app'), 'utf8');
function extract(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  assert.ok(from > 0 && to > from, start);
  return appSource.slice(from, to);
}

function entryHarness(session, customApi) {
  const host = new Element('nav');
  host.hidden = true;
  const user = { isLoggedIn: true, token: 'current-account' };
  let calls = 0;
  const context = {
    userState: user,
    moderationEntryToken: null,
    document: {
      getElementById: (id) => (id === 'discussion-moderation-links' ? host : null),
      querySelectorAll: () => [...host.children],
      createElement: (tag) => {
        const item = new Element(tag);
        item.remove = () => {
          host.children = host.children.filter((child) => child !== item);
        };
        return item;
      },
    },
    callApi: async (url) => {
      assert.equal(url, '/moderation/session');
      calls += 1;
      return customApi ? customApi(calls) : session;
    },
  };
  vm.runInNewContext(
    extract('async function syncModerationEntry(', 'function moderationAttachmentId('),
    context,
  );
  return { host, user, sync: context.syncModerationEntry };
}

test('discussion navigation exposes author and reviewer destinations according to the current session', async () => {
  for (const role of ['author', 'reviewer', 'admin', 'disabled', 'guest']) {
    const h = entryHarness({
      enabled: role !== 'disabled',
      reviewer: role === 'reviewer',
      isAdmin: role === 'admin',
    });
    if (role === 'guest') Object.assign(h.user, { isLoggedIn: false, token: '' });
    await h.sync();
    if (role === 'disabled' || role === 'guest') {
      assert.equal(h.host.hidden, true, role);
      assert.equal(h.host.children.length, 0, role);
    } else {
      assert.equal(h.host.hidden, false, role);
      assert.equal(h.host.children[0].textContent, '我的提交');
      assert.equal(h.host.children[0].href, '/moderation?mine=1');
      assert.equal(h.host.children.length, role === 'reviewer' ? 2 : 1);
      if (role === 'reviewer') {
        assert.equal(h.host.children[1].textContent, '审核工作台');
        assert.equal(h.host.children[1].href, '/moderation');
      }
      await h.sync();
      assert.equal(h.host.children.length, role === 'reviewer' ? 2 : 1, 'no duplicate links');
    }
  }
});

test('a late reviewer lookup cannot restore navigation after logout', async () => {
  const wait = deferred();
  const h = entryHarness(null, () => wait.promise);
  const pending = h.sync();
  Object.assign(h.user, { isLoggedIn: false, token: '' });
  await h.sync();
  wait.resolve({ enabled: true, reviewer: true });
  await pending;
  assert.equal(h.host.hidden, true);
  assert.equal(h.host.children.length, 0);
});

test('a temporary session lookup failure can recover on the next navigation sync', async () => {
  const h = entryHarness(null, (calls) => {
    if (calls === 1) throw new Error('temporary connection failure');
    return { enabled: true, reviewer: true };
  });
  await h.sync();
  assert.equal(h.host.hidden, true);
  await h.sync();
  assert.equal(h.host.hidden, false);
  assert.equal(h.host.children.length, 2);
});

function submissionHarness() {
  const message = new Element('p');
  const input = new Element('textarea');
  input.value = '@Max hello';
  const submit = new Element('button');
  const form = new Element('form');
  const events = [];
  let clears = 0;
  form.dataset.postId = 'post1';
  form.querySelector = (selector) =>
    ({
      '.discussion-comment-input': input,
      '.discussion-comment-message': message,
      '[type="submit"]': submit,
      'button[type="submit"]': submit,
    })[selector];
  form.removeAttribute = (key) => {
    delete form.attributes[key];
  };
  form.dispatchEvent = (event) => events.push(event.type);
  form.reset = () => {
    input.value = '';
  };
  form.classList = { add() {}, remove() {} };
  const requests = [];
  let fail = false;
  const context = {
    crypto,
    Map,
    URL,
    userState: { isLoggedIn: true, uid: 'user1', token: 'token1' },
    discussionState: {
      activePostId: 'post1',
      comments: [],
      posts: [{ id: 'post1', commentCount: 2 }],
      activePost: { commentCount: 2 },
    },
    discussionComposeForm: form,
    discussionComposeMessage: message,
    discussionComposeBoard: { value: 'daily' },
    discussionComposeTitle: { value: 'Title' },
    discussionComposeContent: input,
    moderationSubmissionIntents: new Map(),
    document: {
      createElement: (tag) => new Element(tag),
      createTextNode: (text) => {
        const item = new Element();
        item.textContent = text;
        return item;
      },
      getElementById: () => ({ checked: false }),
    },
    callApi: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (fail) throw new Error('network unavailable');
      return { message: '已提交审核', moderation: { id: 's1', status: 'pending', version: 1 } };
    },
    rememberDiscussionCommentDraft() {},
    clearDiscussionCommentComposer() {
      clears += 1;
    },
    renderDiscussionUploadPreviews() {},
    setDiscussionMessage: (text) => {
      message.textContent = text;
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    window: { location: { href: '/publish' } },
  };
  vm.runInNewContext(
    [
      extract('function moderationSubmissionRequestId(', 'async function syncModerationEntry('),
      extract(
        'async function handleDiscussionCommentSubmit(',
        'async function handleDiscussionCreateToggle(',
      ),
      extract('async function handleDiscussionComposeSubmit(', 'function insertTextAtTextarea('),
    ].join('\n'),
    context,
  );
  return {
    context,
    message,
    form,
    input,
    requests,
    events,
    clears: () => clears,
    fail: (value) => {
      fail = value;
    },
    event: { preventDefault() {}, target: { closest: () => form } },
  };
}

test('pending comment does not append, count, broadcast publication or start Max', async () => {
  const h = submissionHarness();
  await h.context.handleDiscussionCommentSubmit(h.event);
  assert.equal(h.context.discussionState.comments.length, 0);
  assert.equal(h.context.discussionState.activePost.commentCount, 2);
  assert.equal(h.context.discussionState.posts[0].commentCount, 2);
  assert.equal(h.clears(), 1);
  assert.deepEqual(h.events, []);
  assert.equal(h.message.children.at(-1).href, '/moderation?mine=1&id=s1');
  assert.match(h.requests[0].body.requestId, /^[0-9a-f-]{36}$/);
});

test('pending post stays on composer and emits submitted rather than published', async () => {
  const h = submissionHarness();
  await h.context.handleDiscussionComposeSubmit(h.event);
  assert.equal(h.context.window.location.href, '/publish');
  assert.deepEqual(h.events, ['discussion:submitted']);
  assert.equal(h.message.children.at(-1).href, '/moderation?mine=1&id=s1');
});

test('submission retries reuse id for identical draft, rotate on edit and clear on success', async () => {
  const h = submissionHarness();
  h.fail(true);
  await h.context.handleDiscussionCommentSubmit(h.event);
  await h.context.handleDiscussionCommentSubmit(h.event);
  assert.equal(h.requests[0].body.requestId, h.requests[1].body.requestId);
  h.input.value = 'changed';
  await h.context.handleDiscussionCommentSubmit(h.event);
  assert.notEqual(h.requests[2].body.requestId, h.requests[1].body.requestId);
  h.fail(false);
  await h.context.handleDiscussionCommentSubmit(h.event);
  assert.equal(h.requests[3].body.requestId, h.requests[2].body.requestId);
  assert.equal(h.context.moderationSubmissionIntents.size, 0);
});

function imageHarness() {
  const requests = [];
  const wait = deferred();
  const revoked = [];
  const images = [];
  const context = {
    URL: class extends URL {
      static createObjectURL() {
        return 'blob:private-preview';
      }

      static revokeObjectURL(url) {
        revoked.push(url);
      }
    },
    API_BASE_URL: 'http://localhost:3000/api',
    window: { location: { origin: 'http://localhost:3000' } },
    userState: { token: 'reader-token' },
    moderationImagePreviews: new Map(),
    moderationImageRequests: new Map(),
    moderationPreviewGeneration: 0,
    document: { querySelectorAll: () => images, getElementById: () => null },
    fetch: (url, options) => {
      requests.push({ url, options });
      return wait.promise;
    },
  };
  vm.runInNewContext(
    extract('function moderationAttachmentId(', 'function renderDiscussionUploadPreviews('),
    context,
  );
  function image(url) {
    const item = new Element('img');
    item.src = url;
    item.isConnected = true;
    item.getAttribute = () => item.src;
    item.removeAttribute = () => {
      item.src = '';
    };
    item.matches = () => true;
    item.querySelectorAll = () => [];
    images.push(item);
    return item;
  }
  return { context, image, requests, revoked, wait };
}

test('published protected images fetch for current reader, deduplicate, and clear at session change', async () => {
  const h = imageHarness();
  const image1 = h.image(`/api/moderation/attachments/${imageId}`);
  const image2 = h.image(`/api/moderation/attachments/${imageId}`);
  h.context.hydrateModerationImages(image1);
  h.context.hydrateModerationImages(image2);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer reader-token');
  h.wait.resolve(response({ type: 'image/webp', size: 100 }));
  await flush();
  assert.equal(image1.src, 'blob:private-preview');
  assert.equal(image2.src, 'blob:private-preview');
  h.context.clearModerationImagePreviews();
  assert.equal(image1.src, '');
  assert.deepEqual(h.revoked, ['blob:private-preview']);
});

test('hydration ignores external image URLs and late bytes cannot restore a cleared private preview', async () => {
  const h = imageHarness();
  h.context.hydrateModerationImages(
    h.image(`https://evil.invalid/api/moderation/attachments/${imageId}`),
  );
  assert.equal(h.requests.length, 0);
  const image = h.image(`/api/moderation/attachments/${imageId}`);
  h.context.hydrateModerationImages(image);
  h.context.clearModerationImagePreviews();
  h.wait.resolve(response({ type: 'image/webp', size: 100 }));
  await flush();
  assert.equal(image.src, '');
  assert.equal(h.context.moderationImagePreviews.size, 0);
});
