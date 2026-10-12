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
const aiCatalog = () => ({
  defaultModel: 'synthetic-test-model',
  models: [
    { id: 'synthetic-test-model', label: 'GLM 5.1' },
    { id: 'kimi-k2.6', label: 'Kimi 2.6' },
  ],
  settingsRevision: 7,
});
function harness({
  mine = false,
  search,
  customFetch,
  reviewer = true,
  isAdmin = false,
  aiTestEnabled = false,
  automation,
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
      return response({
        enabled: true,
        reviewer,
        isAdmin,
        aiTestEnabled,
        automation,
        mode: automation?.enabled ? 'automatic_test' : 'manual',
      });
    if (url.endsWith('/reviewers')) return response({ reviewers: [] });
    if (url.endsWith('/ai-models')) return response(aiCatalog());
    if (url.endsWith('/policies'))
      return response({
        library: {
          version: 'policy-v2',
          checkedAt: '2026-10-08',
          rules: [
            {
              id: '骚扰-001',
              title: '禁止针对性骚扰',
              kind: 'prohibition',
              category: 'harassment',
              conditions: ['针对具体对象'],
              sourceIds: [],
            },
          ],
          sources: [],
          principles: ['保护正常表达。'],
        },
      });
    if (url.endsWith('/ai-history')) return response({ runs: [] });
    if (url.endsWith('/automation')) return response({ job: null });
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
const manualReviewResult = (extra = {}) => ({
  ...aiResponse().result,
  policyVersion: 'policy-v2',
  assessment: null,
  policyEvidence: [],
  policyDecision: {
    recommendedAction: 'hold',
    supportPriority: 'none',
    reasons: ['invalid_assessment'],
    reasonLabels: ['模型输出未通过校验'],
    canAutomaticallyPublish: false,
    imagesReviewed: false,
  },
  manualReview: {
    required: true,
    validation: 'failed',
    diagnostics: {
      version: 1,
      contractVersion: 'freebbs-moderation-contract-2026-10-11-v2',
      failureCode: 'high_risk_without_block',
      httpStatus: 200,
      reviewSignal: {
        version: 1,
        reportedDecision: 'high_risk',
        reportedCategories: ['harassment'],
        reportedRuleIds: ['骚扰-001'],
        reportedSupportPriority: 'none',
      },
    },
  },
  ...extra,
});

test('an administrator viewing mine sees only personal submissions without reviewer management', async () => {
  const h = harness({ mine: true, reviewer: false, isAdmin: true });
  await h.app.ready;
  await flush();
  await h.app.openSubmission('s1');
  assert.equal(h.get('review-link').hidden, true);
  assert.equal(h.get('reviewers').hidden, true);
  assert.equal(h.get('detail').querySelectorAll('button').length, 0);
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/moderation/reviewers')));
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

const policyRun = () => ({
  id: 'run-1',
  createdAt: '2026-10-08T00:00:00Z',
  model: 'kimi-k2.6',
  policyVersion: 'policy-v2',
  inputMode: 'redacted',
  assessment: {
    decision: 'needs_review',
    categories: ['harassment'],
    reason: '需要结合上下文判断。',
    ruleMatches: [
      {
        ruleId: '骚扰-001',
        evidence: { field: 'content', quote: '<script>evidence()</script>' },
        explanation: '文字是举报还是骚扰有待核查。',
      },
    ],
    uncertainties: ['发言语境不足'],
    supportPriority: 'none',
    supportReason: '',
  },
  policyDecision: {
    recommendedAction: 'hold',
    supportPriority: 'none',
    reasons: ['human_review'],
    canAutomaticallyPublish: false,
    imagesReviewed: false,
  },
  policyEvidence: [
    {
      rule: {
        id: '骚扰-001',
        kind: 'prohibition',
        title: '针对性骚扰',
        category: 'harassment',
        conditions: ['针对具体对象'],
        exceptions: ['求助与正常投诉'],
        sourceIds: ['law1'],
      },
      sources: [
        {
          id: 'law1',
          title: '<b>官方规定</b>',
          url: 'https://www.cac.gov.cn/example',
          article: '第六条',
        },
      ],
    },
  ],
});
function control(h, tag, suffix) {
  return h
    .get('detail')
    .querySelectorAll(tag)
    .find((item) => item.id?.endsWith(suffix));
}
function policyHarness(options = {}) {
  return harness({
    aiTestEnabled: true,
    ...options,
    customFetch: async (url, request, fallback) => {
      if (url.endsWith('/ai-history')) return response({ runs: [options.run || policyRun()] });
      return options.customFetch
        ? options.customFetch(url, request, fallback)
        : fallback(url, request);
    },
  });
}

test('failed historical run requires an independent active judgment and never offers agreement', async () => {
  const run = { ...manualReviewResult(), id: 'run-1', createdAt: '2026-10-11T00:00:00Z' };
  const h = policyHarness({
    run,
    customFetch: (url, options, fallback) =>
      url.endsWith('/feedback') ? response({ ok: true }) : fallback(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const detail = h.get('detail');
  const form = detail
    .querySelectorAll('form')
    .find((item) =>
      item.querySelectorAll('button').some((button) => button.textContent === '保存人工复核记录'),
    );
  assert.match(detail.textContent, /模型提示待人工复核/);
  assert.match(detail.textContent, /高风险迹象（尚未核实）/);
  assert.equal(control(h, 'select', '-decision').value, '');
  assert.equal(control(h, 'input', '-rules').value, '');
  assert.equal(
    form.querySelectorAll('input').filter((input) => input.type === 'checkbox' && input.checked)
      .length,
    0,
  );
  assert.deepEqual(
    control(h, 'select', '-verdict').children.map((option) => option.value),
    ['correct', 'escalate'],
  );
  control(h, 'textarea', '-note').value = '已核查完整上下文，记录人工判断。';
  await form.events.submit({ preventDefault() {} });
  assert.match(form.textContent, /请主动选择人工风险判断/);
  assert.equal(h.requests.filter(({ url }) => url.endsWith('/feedback')).length, 0);
  control(h, 'select', '-decision').value = 'needs_review';
  control(h, 'select', '-verdict').value = 'agree';
  await form.events.submit({ preventDefault() {} });
  assert.match(form.textContent, /此结果不能直接同意/);
  assert.equal(h.requests.filter(({ url }) => url.endsWith('/feedback')).length, 0);
  control(h, 'select', '-verdict').value = 'escalate';
  await form.events.submit({ preventDefault() {} });
  const writes = h.requests.filter(({ url }) => url.endsWith('/feedback'));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).decision, 'needs_review');
  assert.equal(JSON.parse(writes[0].options.body).verdict, 'escalate');
  assert.equal(h.decisionAttempts(), 0);
  assert.equal(h.requests.filter(({ url }) => url.endsWith('/ai-test')).length, 0);
});

test('failed history hides injected fields and retained human feedback does not permit machine agreement', async () => {
  const run = { ...manualReviewResult(), id: 'run-1' };
  run.manualReview.diagnostics.reviewSignal.reportedDecision = '<script>decision()</script>';
  run.manualReview.diagnostics.reviewSignal.reportedCategories = ['<script>category()</script>'];
  run.manualReview.diagnostics.reviewSignal.reportedRuleIds = ['<script>rule()</script>'];
  run.manualReview.diagnostics.reviewSignal.reportedSupportPriority = '<script>support()</script>';
  run.manualReview.diagnostics.reason = '<script>reason()</script>';
  run.feedback = {
    policyVersion: 'policy-v2',
    verdict: 'correct',
    decision: 'needs_review',
    categories: ['harassment'],
    ruleIds: ['骚扰-001'],
    supportPriority: 'none',
    note: '<script>literalHumanNote()</script>',
  };
  const h = policyHarness({ run, isAdmin: true });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /未取得可用判断/);
  assert.doesNotMatch(
    h.get('detail').textContent,
    /decision\(\)|category\(\)|rule\(\)|support\(\)|reason\(\)/,
  );
  assert.match(h.get('detail').textContent, /<script>literalHumanNote\(\)<\/script>/);
  assert.equal(h.get('detail').querySelectorAll('script').length, 0);
  assert.equal(control(h, 'select', '-decision').value, 'needs_review');
  assert.equal(control(h, 'input', '-rules').value, '骚扰-001');
  assert.deepEqual(
    control(h, 'select', '-verdict').children.map((option) => option.value),
    ['correct', 'escalate'],
  );
});

test('API client cannot retain failed review results after the login changes while parsing the error', async () => {
  const parsed = deferred();
  let token = 'old-token';
  const client = createClient({
    apiBase: '/api',
    getToken: () => token,
    fetch: async () => ({ ok: false, status: 502, json: () => parsed.promise }),
  });
  const request = client.request('/moderation/submissions/s1/ai-test');
  await flush();
  token = 'new-token';
  parsed.resolve({ message: '未通过', reviewResult: manualReviewResult() });
  await assert.rejects(
    request,
    (error) => error.message.includes('登录状态已变化') && error.reviewResult === undefined,
  );
});

test('rule library and persisted AI history are reviewer-only, including admin outside reviewer registry', async () => {
  for (const options of [
    { mine: true },
    { reviewer: false, isAdmin: true },
    { mine: true, reviewer: false, isAdmin: true },
  ]) {
    const h = harness(options);
    await h.app.ready;
    if (options.mine) await h.app.openSubmission('s1');
    assert.equal(h.get('policy-library').hidden, true);
    assert.ok(
      h.requests.every(({ url }) => !url.endsWith('/policies') && !url.endsWith('/ai-history')),
    );
  }
  const h = harness();
  await h.app.ready;
  await h.app.openSubmission('s1');
  assert.equal(h.get('policy-library').hidden, false);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/policies')));
  assert.ok(h.requests.some(({ url }) => url.endsWith('/ai-history')));
});

test('policy library searches locally, protects literal content and rejects active source URLs', async () => {
  const h = harness({
    customFetch: async (url, options, fallback) =>
      url.endsWith('/policies')
        ? response({
            library: {
              version: 'p1',
              checkedAt: '2026-10-08',
              rules: [
                {
                  id: '骚扰-001',
                  kind: 'prohibition',
                  title: '<script>bad()</script>',
                  category: 'harassment',
                  conditions: ['骚扰'],
                  sourceIds: ['a', 'b'],
                },
                {
                  id: '隐私-001',
                  title: '禁止公开他人隐私',
                  kind: 'prohibition',
                  category: 'privacy',
                  sourceIds: [],
                },
                {
                  id: '关怀-001',
                  title: '需要心理支持',
                  kind: 'support',
                  supportOnly: true,
                  category: 'self_harm',
                  sourceIds: [],
                },
              ],
              sources: [
                { id: 'a', title: '官方', url: 'https://www.cac.gov.cn/example' },
                { id: 'b', title: '恶意链接', url: ['javascript', ':bad()'].join('') },
              ],
            },
          })
        : fallback(url, options),
  });
  await h.app.ready;
  await flush();
  assert.match(h.get('policy-list').textContent, /<script>bad\(\)<\/script>/);
  assert.equal(h.get('policy-list').querySelectorAll('script').length, 0);
  assert.deepEqual(
    h
      .get('policy-list')
      .querySelectorAll('a')
      .map((item) => item.href),
    ['https://www.cac.gov.cn/example'],
  );
  const before = h.requests.length;
  h.get('policy-query').value = '隐私-001';
  h.get('policy-query').events.input();
  assert.match(h.get('policy-list').textContent, /禁止公开他人隐私/);
  assert.doesNotMatch(h.get('policy-list').textContent, /骚扰-001|心理支持/);
  assert.match(h.get('policy-support-list').textContent, /需要心理支持/);
  assert.equal(h.requests.length, before);
});

test('late rules and history cannot restore reviewer content after logout', async () => {
  const library = deferred();
  const history = deferred();
  const h = harness({
    customFetch: async (url, options, fallback) => {
      if (url.endsWith('/policies')) return library.promise;
      if (url.endsWith('/ai-history')) return history.promise;
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  h.setToken('');
  await h.app.initialize();
  library.resolve(
    response({
      library: { version: 'x', rules: [{ id: 'PRIVATE', title: 'private rule' }], sources: [] },
    }),
  );
  history.resolve(response({ runs: [policyRun()] }));
  await flush();
  assert.equal(h.get('policy-list').textContent, '');
  assert.doesNotMatch(h.get('detail').textContent, /run-1|人工复核与回归样例/);
  assert.equal(h.get('policy-library').hidden, true);
});

test('historical assessments remain available after a human decision and render evidence literally', async () => {
  const h = policyHarness();
  h.submission.status = 'approved';
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /建议暂缓发布/);
  assert.match(h.get('detail').textContent, /<script>evidence\(\)<\/script>/);
  assert.equal(h.get('detail').querySelectorAll('script').length, 0);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('button')
      .some((item) => item.dataset.decision),
  );
  assert.ok(
    h
      .get('detail')
      .querySelectorAll('button')
      .some((item) => item.textContent === '保存人工复核记录'),
  );
});

test('feedback requires explicit correction and a note, retains request ID across retry, and never publishes', async () => {
  let attempts = 0;
  const h = policyHarness({
    customFetch: async (url, options, fallback) => {
      if (url.endsWith('/feedback')) {
        attempts += 1;
        return attempts === 1 ? response({ message: '稍后重试' }, 503) : response({ ok: true });
      }
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) =>
      item.querySelectorAll('button').some((button) => button.textContent === '保存人工复核记录'),
    );
  control(h, 'select', '-decision').value = 'high_risk';
  await form.events.submit({ preventDefault() {} });
  assert.equal(attempts, 0);
  assert.match(form.textContent, /已修改判断/);
  control(h, 'select', '-verdict').value = 'correct';
  await form.events.submit({ preventDefault() {} });
  assert.equal(attempts, 0);
  assert.match(form.textContent, /填写复核说明/);
  control(h, 'textarea', '-note').value = '上下文显示存在针对性骚扰。';
  await form.events.submit({ preventDefault() {} });
  await form.events.submit({ preventDefault() {} });
  const bodies = h.requests
    .filter(({ url }) => url.endsWith('/feedback'))
    .map(({ options }) => JSON.parse(options.body));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
  assert.equal(bodies[0].decision, 'high_risk');
  assert.equal(h.decisionAttempts(), 0);
  assert.equal(h.requests.filter(({ url }) => url.endsWith('/ai-test')).length, 0);
});

test('regression sample begins blank and only sends manually rewritten content after explicit confirmation', async () => {
  const run = policyRun();
  run.feedback = {
    verdict: 'agree',
    decision: run.assessment.decision,
    categories: run.assessment.categories,
    ruleIds: ['骚扰-001'],
    policyVersion: 'policy-v2',
    supportPriority: 'none',
    note: '',
    createdAt: '2026-10-08T01:00:00Z',
  };
  const h = policyHarness({
    run,
    customFetch: async (url, options, fallback) =>
      url.endsWith('/regression') ? response({ ok: true }) : fallback(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const content = control(h, 'textarea', '-synthetic-content');
  const title = control(h, 'input', '-synthetic-title');
  assert.equal(content.value, '');
  assert.equal(title.value, '');
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) =>
      item.querySelectorAll('button').some((button) => button.textContent === '保存虚构回归样例'),
    );
  content.value = '虚构学生甲对设施提出正常建议。';
  control(h, 'textarea', '-synthetic-reason').value = '用于保护正常建议。';
  await form.events.submit({ preventDefault() {} });
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/regression')));
  form.querySelectorAll('input').find((item) => item.type === 'checkbox').checked = true;
  await form.events.submit({ preventDefault() {} });
  const body = JSON.parse(h.requests.find(({ url }) => url.endsWith('/regression')).options.body);
  assert.equal(body.content, content.value);
  assert.equal(body.syntheticConfirmed, true);
  assert.ok(body.requestId);
  assert.ok(!JSON.stringify(body).includes(h.submission.contentMarkdown));
  assert.equal(h.decisionAttempts(), 0);
});

test('saved corrected labels survive history refresh and regression uses those saved labels', async () => {
  const run = policyRun();
  const h = policyHarness({
    run,
    customFetch: async (url, options, fallback) => {
      if (url.endsWith('/feedback')) {
        run.feedback = {
          ...JSON.parse(options.body),
          policyVersion: 'policy-v2',
          createdAt: '2026-10-08T01:00:00Z',
        };
        return response({ ok: true });
      }
      if (url.endsWith('/regression')) return response({ ok: true });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const findForm = (caption) =>
    h
      .get('detail')
      .querySelectorAll('form')
      .find((item) =>
        item.querySelectorAll('button').some((button) => button.textContent === caption),
      );
  const feedbackForm = findForm('保存人工复核记录');
  control(h, 'select', '-verdict').value = 'correct';
  control(h, 'select', '-decision').value = 'no_risk_detected';
  feedbackForm
    .querySelectorAll('input')
    .filter((item) => item.type === 'checkbox')
    .forEach((item) => {
      item.checked = false;
    });
  control(h, 'input', '-rules').value = '';
  control(h, 'textarea', '-note').value = '本例是被骚扰者的举报，不应认定作者违规。';
  await feedbackForm.events.submit({ preventDefault() {} });
  assert.equal(control(h, 'select', '-decision').value, 'no_risk_detected');
  assert.equal(control(h, 'select', '-verdict').value, 'correct');
  assert.equal(control(h, 'input', '-rules').value, '');
  assert.equal(
    findForm('保存人工复核记录')
      .querySelectorAll('input')
      .filter((item) => item.type === 'checkbox' && item.checked).length,
    0,
  );
  const regressionForm = findForm('保存虚构回归样例');
  control(h, 'textarea', '-synthetic-content').value = '虚构同学甲在举报自己遭受的骚扰。';
  control(h, 'textarea', '-synthetic-reason').value = '保护举报求助语境。';
  regressionForm.querySelectorAll('input').find((item) => item.type === 'checkbox').checked = true;
  control(h, 'select', '-decision').value = 'high_risk';
  await regressionForm.events.submit({ preventDefault() {} });
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/regression')));
  assert.match(regressionForm.textContent, /未保存的修改/);
  control(h, 'select', '-decision').value = 'no_risk_detected';
  await regressionForm.events.submit({ preventDefault() {} });
  const saved = JSON.parse(h.requests.find(({ url }) => url.endsWith('/regression')).options.body);
  assert.equal(saved.expectedDecision, 'no_risk_detected');
  assert.deepEqual(saved.categories, []);
  assert.deepEqual(saved.ruleIds, []);
  assert.match(regressionForm.textContent, /不会自动匿名化/);
});

test('non-trial environment keeps read-only library and history but prevents feedback, regression and export writes', async () => {
  const h = policyHarness({ aiTestEnabled: false });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.equal(h.get('policy-library').hidden, false);
  assert.match(h.get('detail').textContent, /需要结合上下文判断/);
  assert.match(h.get('detail').textContent, /历史仅供查看/);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('button')
      .some(
        (item) =>
          item.textContent === '保存人工复核记录' || item.textContent === '保存虚构回归样例',
      ),
  );
  assert.equal(h.get('regression-export').disabled, true);
  await h.get('regression-export').events.click();
  assert.ok(
    !h.requests.some(({ url }) => /\/(feedback|regression|regressions\/export)$/.test(url)),
  );
});

test('regression creation remains disabled until this run has a saved human review', async () => {
  const h = policyHarness();
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const save = h
    .get('detail')
    .querySelectorAll('button')
    .find((item) => item.textContent === '保存虚构回归样例');
  assert.equal(save.disabled, true);
  assert.match(h.get('detail').textContent, /请先保存上方人工复核记录/);
});

test('current library separates the prohibition checklist from support and global principles', async () => {
  const library = JSON.parse(
    fs.readFileSync(require.resolve('../backend/moderation-policy-library.json'), 'utf8'),
  );
  const h = harness({
    customFetch: async (url, options, fallback) =>
      url.endsWith('/policies') ? response({ library }) : fallback(url, options),
  });
  await h.app.ready;
  await flush();
  assert.equal(h.get('policy-list').querySelectorAll('details').length, 28);
  assert.equal(h.get('policy-support-list').querySelectorAll('article').length, 2);
  assert.doesNotMatch(
    h.get('policy-list').textContent,
    /关怀-00[12]|EXP-001|MEN-001|SYS-001|GEN-001|未成年保护-001/,
  );
  assert.match(h.get('policy-list').textContent, /禁止发布的内容/);
  assert.match(h.get('policy-list').textContent, /不应据此禁止的情况/);
  assert.match(h.get('policy-list').textContent, /禁止情形示例/);
  assert.match(h.get('policy-support-list').textContent, /心理支持（不属于违规）/);
  assert.doesNotMatch(h.get('policy-support-list').textContent, /禁止情形示例|自伤风险/);
  assert.match(h.get('policy-principles').textContent, /正常|求助/);
  assert.ok(
    !h
      .get('policy-category')
      .querySelectorAll('option')
      .some((item) => ['other', 'sexual_minors'].includes(item.value)),
  );
  assert.match(h.get('policy-list').textContent, /性剥削-001/);
  assert.match(h.get('policy-list').textContent, /性招揽-001/);
  assert.match(h.get('policy-list').textContent, /性暗示-001/);
});

test('retired sexual rules retain their original historical meaning and cannot be selected for current feedback', async () => {
  for (const oldId of ['SEX-001', '未成年保护-001']) {
    const run = policyRun();
    run.policyVersion = oldId === 'SEX-001' ? 'policy-v1' : 'policy-v2';
    run.assessment.categories = ['sexual_minors'];
    run.assessment.ruleMatches = [
      {
        ruleId: oldId,
        evidence: { field: 'content', quote: '历史测试证据' },
        explanation: '按旧规则保存的审核记录。',
      },
    ];
    run.policyEvidence[0].rule = {
      id: oldId,
      title: '禁止未成年人性剥削',
      category: 'sexual_minors',
      recommendedAction: 'block',
      conditions: ['原版本对未成年人的保护条件'],
      sourceIds: [],
    };
    const h = policyHarness({
      run,
      isAdmin: true,
      customFetch: async (url, options, fallback) =>
        url.endsWith('/policies')
          ? response({
              library: {
                version: 'policy-v3',
                categories: ['sexual_content', 'harassment'],
                rules: [
                  { id: '性剥削-001', kind: 'prohibition', category: 'sexual_content' },
                  { id: '骚扰-001', kind: 'prohibition', category: 'harassment' },
                ],
                sources: [],
              },
            })
          : fallback(url, options),
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    const detail = h.get('detail');
    assert.match(detail.textContent, /未成年保护-001（历史版本）/);
    assert.match(detail.textContent, /旧版未成年人性风险/);
    assert.match(detail.textContent, /原版本对未成年人的保护条件/);
    assert.doesNotMatch(detail.textContent, /性剥削-001/);
    assert.ok(
      detail
        .querySelectorAll('pre')
        .some((item) => item.textContent.includes(`"ruleId": "${oldId}"`)),
    );
    const categoryOptions = h
      .get('policy-category')
      .querySelectorAll('option')
      .map((item) => item.value);
    assert.deepEqual(categoryOptions, ['', 'sexual_content', 'harassment']);
    const form = detail
      .querySelectorAll('form')
      .find((item) =>
        item.querySelectorAll('button').some((button) => button.textContent === '保存人工复核记录'),
      );
    assert.deepEqual(
      form
        .querySelectorAll('input')
        .filter((item) => item.type === 'checkbox')
        .map((item) => item.value),
      ['sexual_content', 'harassment'],
    );
    assert.equal(control(h, 'input', '-rules').value, '');
    control(h, 'input', '-rules').value = oldId;
    control(h, 'textarea', '-note').value = '尝试把旧编号用作当前依据';
    await form.events.submit({ preventDefault() {} });
    assert.match(form.textContent, /历史编号不能用于新的复核/);
    assert.ok(!h.requests.some(({ url }) => url.endsWith('/feedback')));
  }
});

test('legacy evidence keeps original JSON but shows Chinese historical labels and requires current reassessment', async () => {
  const run = policyRun();
  run.policyVersion = 'policy-v1';
  run.assessment.categories = ['other'];
  run.assessment.ruleMatches = [
    {
      ruleId: 'EXP-001',
      evidence: { field: 'content', quote: '正常建议' },
      explanation: '历史表达保护',
    },
  ];
  run.policyEvidence[0].rule = {
    id: 'EXP-001',
    title: '保护正常表达',
    recommendedAction: 'allow',
    conditions: ['正常建议'],
    sourceIds: [],
  };
  run.feedback = {
    policyVersion: 'policy-v1',
    verdict: 'agree',
    decision: 'no_risk_detected',
    categories: ['other'],
    ruleIds: ['EXP-001'],
    supportPriority: 'none',
    note: '历史说明',
    createdAt: '2026-10-08T01:00:00Z',
  };
  const h = policyHarness({ run, isAdmin: true });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const rules = control(h, 'input', '-rules');
  const verdict = control(h, 'select', '-verdict');
  assert.match(h.get('detail').textContent, /旧版表达保护-001（历史版本）/);
  assert.match(h.get('detail').textContent, /不作为当前禁止清单中的条目/);
  assert.match(h.get('detail').textContent, /复核规则版本：policy-v1/);
  assert.ok(
    h
      .get('detail')
      .querySelectorAll('pre')
      .some((item) => item.textContent.includes('"ruleId": "EXP-001"')),
  );
  assert.equal(rules.value, '');
  assert.equal(verdict.value, 'correct');
  assert.ok(!verdict.querySelectorAll('option').some((item) => item.value === 'agree'));
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) =>
      item.querySelectorAll('button').some((button) => button.textContent === '保存人工复核记录'),
    );
  assert.equal(
    form.querySelectorAll('input').filter((item) => item.type === 'checkbox' && item.checked)
      .length,
    0,
  );
  assert.ok(!form.querySelectorAll('input').some((item) => item.value === 'other'));
  rules.value = 'HAR-001';
  control(h, 'textarea', '-note').value = '重新核查';
  await form.events.submit({ preventDefault() {} });
  assert.match(form.textContent, /当前清单中的中文编号/);
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/feedback')));
});

test('a current-version correction on an old run remains editable without enabling old-result agreement', async () => {
  const run = policyRun();
  run.policyVersion = 'policy-v1';
  run.assessment.ruleMatches[0].ruleId = 'HAR-001';
  run.feedback = {
    policyVersion: 'policy-v2',
    verdict: 'correct',
    decision: 'needs_review',
    categories: ['harassment'],
    ruleIds: ['骚扰-001'],
    supportPriority: 'none',
    note: '按新清单重评',
    createdAt: '2026-10-08T01:00:00Z',
  };
  const h = policyHarness({ run, isAdmin: true });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.equal(control(h, 'input', '-rules').value, '骚扰-001');
  assert.equal(control(h, 'select', '-verdict').value, 'correct');
  assert.match(h.get('detail').textContent, /复核规则版本：policy-v2/);
  assert.ok(
    !control(h, 'select', '-verdict')
      .querySelectorAll('option')
      .some((item) => item.value === 'agree'),
  );
});

test('old backend rule shape cannot become an empty current checklist or enable feedback', async () => {
  const h = policyHarness({
    customFetch: async (url, options, fallback) =>
      url.endsWith('/policies')
        ? response({
            library: {
              version: 'policy-v1',
              sources: [],
              rules: [{ id: 'EXP-001', title: '保护正常表达' }],
            },
          })
        : fallback(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.equal(h.app.state.library, null);
  assert.match(
    h.get('policy-status').textContent,
    /后端尚未加载中文禁止清单，请重启测试后端并刷新/,
  );
  assert.equal(h.get('policy-list').textContent, '');
  assert.equal(h.get('regression-export').disabled, true);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('button')
      .some((item) => item.textContent === '保存人工复核记录'),
  );
});

const automaticSettings = () => ({
  enabled: true,
  paused: true,
  model: 'qwen3.6-27b',
  backupModel: 'glm-5.1',
});
const automaticJob = (state = 'published') => ({
  state,
  model: 'qwen3.6-27b',
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:04Z',
  reasonCode: state === 'published' ? 'no_text_risk' : 'policy_review',
  result: null,
  canWithdraw: state === 'published',
});

test('automation control is admin-only while reviewers can read status and authors see neither', async () => {
  for (const role of ['admin', 'reviewer', 'author', 'admin-mine']) {
    const h = harness({
      isAdmin: role === 'admin' || role === 'admin-mine',
      reviewer: role !== 'author',
      mine: role === 'author' || role === 'admin-mine',
      automation: automaticSettings(),
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    const reviewing = role === 'admin' || role === 'reviewer';
    assert.equal(h.get('automation').hidden, !reviewing, role);
    assert.equal(h.get('automation-toggle').hidden, role !== 'admin', role);
    assert.equal(
      h.requests.some(({ url }) => url.endsWith('/automation')),
      reviewing,
      role,
    );
    if (reviewing) {
      assert.match(h.get('automation-models').textContent, /qwen3.6-27b.*glm-5.1/);
      assert.match(h.get('automation-summary').textContent, /已暂停/);
    }
    if (role !== 'admin') {
      await h.get('automation-toggle').events.click();
      assert.ok(!h.requests.some(({ url }) => url.endsWith('/automation/control')));
    }
  }
});

test('automation resume is guarded against double clicks and failed pause preserves confirmed state', async () => {
  const pending = deferred();
  let controls = 0;
  const h = harness({
    isAdmin: true,
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation/control')) {
        controls += 1;
        return controls === 1 ? pending.promise : response({ message: '权限已变化' }, 403);
      }
      return fallback(url, options);
    },
  });
  await h.app.ready;
  const button = h.get('automation-toggle');
  assert.equal(button.textContent, '开启自动审核');
  const first = button.events.click();
  await button.events.click();
  assert.equal(controls, 1);
  assert.equal(button.disabled, true);
  pending.resolve(response({ automation: { ...automaticSettings(), paused: false } }));
  await first;
  assert.equal(button.textContent, '暂停自动审核');
  assert.match(h.get('automation-summary').textContent, /运行中/);
  await button.events.click();
  assert.match(h.get('automation-message').textContent, /权限已变化/);
  assert.equal(h.app.state.session.automation.paused, false);
  assert.equal(button.disabled, false);
  const calls = h.requests.filter(({ url }) => url.endsWith('/automation/control'));
  assert.deepEqual(
    calls.map(({ options }) => JSON.parse(options.body)),
    [{ paused: false }, { paused: true }],
  );
});

test('disabled automation still shows historical jobs but never allows enabling from the browser', async () => {
  const h = harness({
    isAdmin: true,
    automation: { ...automaticSettings(), enabled: false },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('automation-summary').textContent, /未开启/);
  assert.equal(h.get('automation-toggle').hidden, true);
  await h.get('automation-toggle').events.click();
  assert.ok(h.requests.some(({ url }) => url.endsWith('/automation')));
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/automation/control')));
});

test('automatic publication has a required-reason idempotent withdrawal with no approval or trial claim', async () => {
  const wait = deferred();
  let attempts = 0;
  const run = policyRun();
  run.assessment = {
    ...run.assessment,
    decision: 'no_risk_detected',
    categories: [],
    ruleMatches: [],
    uncertainties: [],
  };
  run.policyDecision = { ...run.policyDecision, recommendedAction: 'allow' };
  const h = harness({
    automation: automaticSettings(),
    aiTestEnabled: true,
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation')) return response({ job: { ...automaticJob(), result: run } });
      if (url.endsWith('/withdraw')) {
        attempts += 1;
        if (attempts === 1) return wait.promise;
        h.submission.status = 'rejected';
        h.submission.version = 3;
        return response({ submission: { ...h.submission } });
      }
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  h.submission.version = 2;
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /已自动发布/);
  assert.doesNotMatch(h.get('detail').textContent, /不会自动发布/);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('button')
      .some(
        (button) =>
          button.textContent === '通过并发布' || button.textContent === '调用无问芯穹试审',
      ),
  );
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) => item.className === 'moderation-withdrawal');
  const reason = form.querySelectorAll('textarea')[0];
  await form.events.submit({ preventDefault() {} });
  assert.equal(attempts, 0);
  assert.match(form.textContent, /请填写 1～1000 字/);
  reason.value = '<img src=x> 经核查应撤回';
  const first = form.events.submit({ preventDefault() {} });
  await form.events.submit({ preventDefault() {} });
  assert.equal(attempts, 1);
  wait.resolve(response({ message: '连接暂时失败' }, 503));
  await first;
  assert.match(form.textContent, /可重试同一撤回操作/);
  await form.events.submit({ preventDefault() {} });
  const calls = h.requests
    .filter(({ url }) => url.endsWith('/withdraw'))
    .map(({ options }) => JSON.parse(options.body));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].expectedVersion, 2);
  assert.equal(calls[0].reason, '<img src=x> 经核查应撤回');
  assert.match(h.get('message').textContent, /已撤回自动发布/);
});

test('withdrawal conflict reloads the authoritative submission and removes stale withdrawal', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({
          job: automaticJob(h.submission.status === 'approved' ? 'published' : 'withdrawn'),
        });
      if (url.endsWith('/withdraw')) {
        h.submission.status = 'rejected';
        return response({ message: '提交已变化' }, 409);
      }
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) => item.className === 'moderation-withdrawal');
  form.querySelectorAll('textarea')[0].value = '负责人核查后撤回';
  await form.events.submit({ preventDefault() {} });
  await flush();
  assert.match(h.get('message').textContent, /状态已变化或审核数据已到期/);
  assert.match(h.get('detail').textContent, /负责人已撤回/);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('form')
      .some((item) => item.className === 'moderation-withdrawal'),
  );
});

test('temporary machine block keeps manual decisions without exposing manual trial controls', async () => {
  const h = harness({
    automation: automaticSettings(),
    aiTestEnabled: true,
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation')) return response({ job: automaticJob('blocked') });
      if (url.endsWith('/ai-models'))
        return response({
          defaultModel: 'qwen3.6-27b',
          models: [
            { id: 'qwen3.6-27b', label: 'Qwen3.6 27B' },
            { id: 'glm-5.1', label: 'GLM-5.1' },
          ],
        });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /尚不是最终不予发布/);
  assert.equal(control(h, 'select', '-ai-model'), undefined);
  assert.doesNotMatch(h.get('detail').textContent, /本地脱敏预览|调用无问芯穹试审/);
  assert.ok(!h.requests.some(({ url }) => /ai-models|privacy-preview|ai-test/.test(url)));
  const approve = h
    .get('detail')
    .querySelectorAll('button')
    .find((button) => button.textContent === '通过并发布');
  assert.equal(approve.disabled, false);
  assert.ok(
    h
      .get('detail')
      .querySelectorAll('button')
      .some((button) => button.textContent === '不予发布'),
  );
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/ai-test')));
  await approve.events.click();
  assert.equal(h.decisionAttempts(), 1);
});

test('late automatic job and control responses cannot restore data after navigation or logout', async () => {
  const job = deferred();
  const controlWait = deferred();
  const h = harness({
    automation: automaticSettings(),
    isAdmin: true,
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/s1/automation')) return job.promise;
      if (url.endsWith('/s2'))
        return response({ submission: { ...h.submission, id: 's2', title: '第二条稿件' } });
      if (url.endsWith('/s2/automation')) return response({ job: automaticJob('queued') });
      if (url.endsWith('/automation/control')) return controlWait.promise;
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await h.app.openSubmission('s2');
  job.resolve(response({ job: { ...automaticJob('blocked'), reason: '第一条过期响应' } }));
  await flush();
  assert.match(h.get('detail').textContent, /第二条稿件/);
  assert.doesNotMatch(h.get('detail').textContent, /第一条过期响应/);
  const changing = h.get('automation-toggle').events.click();
  h.setToken('');
  await h.app.initialize();
  controlWait.resolve(response({ automation: { ...automaticSettings(), paused: false } }));
  await changing;
  assert.equal(h.get('automation').hidden, true);
  assert.equal(h.app.state.session, null);
  assert.equal(h.get('automation-message').textContent, '');
});

test('automatic review errors and unverified risk hints stay in the job panel without enabling publication', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob('review'), result: manualReviewResult() } });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /转人工复核/);
  assert.match(h.get('detail').textContent, /未能给出可靠结论/);
  assert.match(h.get('detail').textContent, /关怀需求不等于违规/);
  assert.equal(h.submission.status, 'pending');
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/decision')));
});

test('an unattempted image job explains that no model was called and preserves the actual store reason', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({
          job: {
            ...automaticJob('review'),
            reasonCode: 'images_not_reviewed',
            result: {
              ...manualReviewResult(),
              automationReason: 'image_requires_review',
              manualReview: { required: true, validation: 'not_attempted' },
            },
          },
        });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /图片尚未完成机器审核，整份稿件交人工检查/);
  assert.match(h.get('detail').textContent, /未调用模型 · 保留人工审核/);
  assert.doesNotMatch(h.get('detail').textContent, /未能给出可靠结论/);
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/ai-test')));
});

test('a local keyword handoff explains no model call without presenting an API or validation failure', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({
          job: {
            ...automaticJob('review'),
            reasonCode: 'focus_requires_review',
            result: {
              ...manualReviewResult(),
              automationReason: 'focus_requires_review',
              manualReview: { required: true, validation: 'not_attempted' },
              reviewFocus: {
                political: true,
                psychological: false,
                keywordMatches: { political: ['习近平'], psychological: [] },
              },
            },
          },
        });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const visible = visibleText(h.get('detail'));
  assert.match(visible, /本地政治或心理关键词触发人工审核，本次未调用模型/);
  assert.match(visible, /预设模型（本次未调用）/);
  assert.match(visible, /以下为本地转人工记录/);
  assert.match(visible, /未调用模型 · 保留人工审核/);
  assert.match(visible, /触发关键词：习近平/);
  assert.doesNotMatch(visible, /输出未通过校验|以下为机器自动审核结果|模型未返回可用结果/);
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/ai-test') || url.endsWith('/decision')));
  assert.equal(h.submission.status, 'pending');
});

test('expired withdrawal HTTP410 refreshes and removes the action while explaining discussion management', async () => {
  let expired = false;
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob(), canWithdraw: !expired, expired } });
      if (url.endsWith('/withdraw')) {
        expired = true;
        return response({ message: '审核材料已到期' }, 410);
      }
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const form = h
    .get('detail')
    .querySelectorAll('form')
    .find((item) => item.className === 'moderation-withdrawal');
  form.querySelectorAll('textarea')[0].value = '负责人核查撤回';
  await form.events.submit({ preventDefault() {} });
  await flush();
  assert.match(h.get('message').textContent, /状态已变化或审核数据已到期/);
  assert.match(h.get('detail').textContent, /请使用讨论区管理功能/);
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('form')
      .some((item) => item.className === 'moderation-withdrawal'),
  );
});

const pendingImageReview = () => ({
  required: true,
  state: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  canConfirm: true,
});
const visibleText = (element) =>
  element.tagName === 'DETAILS'
    ? ''
    : (element.text || '') + element.children.map(visibleText).join('');

test('image review queue is a distinct reviewer queue and remains available when automation is paused', async () => {
  const h = harness({
    automation: { ...automaticSettings(), imagesEnabled: true, imageModel: 'kimi-k2.6' },
    customFetch: (url, options, fallback) => {
      if (url.includes('/automation/image-reviews'))
        return response({
          items: [{ id: 's1', title: '待看图片', kind: 'post', imageReview: pendingImageReview() }],
        });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.get('image-queue').events.click();
  await flush();
  assert.equal(h.get('status').value, 'image_review');
  assert.match(h.get('list').textContent, /图片待复核.*已自动发布/);
  assert.equal(h.get('more').hidden, true);
  assert.match(h.get('automation-summary').textContent, /已暂停/);
  assert.match(h.get('automation-models').textContent, /qwen3.6-27b.*kimi-k2.6/);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/automation/image-reviews?')));
  for (const options of [{ mine: true }, { reviewer: false }]) {
    const denied = harness({ ...options, automation: automaticSettings() });
    await denied.app.ready;
    await denied.get('image-queue').events.click();
    assert.equal(denied.get('image-queue').hidden, true);
    assert.ok(!denied.requests.some(({ url }) => url.includes('/image-reviews')));
  }
});

test('published image confirmation waits for all original images and uses idempotent retries without changing version', async () => {
  const imageWait = deferred();
  const confirmWait = deferred();
  let confirmations = 0;
  let review = pendingImageReview();
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.includes('/attachments/')) return imageWait.promise;
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob(), imageReview: review } });
      if (url.endsWith('/image-review')) {
        confirmations += 1;
        if (confirmations === 1) return confirmWait.promise;
        review = {
          ...review,
          state: 'confirmed',
          canConfirm: false,
          reviewedAt: '2026-10-11T12:00:00Z',
        };
        return response({ id: 's1', submissionId: 's1', version: 2, imageReview: review });
      }
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  h.submission.version = 2;
  h.submission.attachments = [{ id: imageId }];
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const button = h
    .get('detail')
    .querySelectorAll('button')
    .find((node) => node.className === 'moderation-image-confirm');
  assert.equal(button.disabled, true);
  await button.events.click();
  assert.equal(confirmations, 0);
  imageWait.resolve(response({ type: 'image/webp', size: 100 }));
  await flush();
  assert.equal(button.disabled, false);
  const pending = button.events.click();
  await button.events.click();
  assert.equal(confirmations, 1);
  confirmWait.resolve(response({ message: '暂时失败' }, 503));
  await pending;
  assert.equal(button.disabled, false);
  await button.events.click();
  await flush();
  const calls = h.requests
    .filter(({ url }) => url.endsWith('/image-review'))
    .map(({ options }) => JSON.parse(options.body));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].expectedVersion, 2);
  assert.equal(h.submission.version, 2);
  assert.match(h.get('detail').textContent, /图片已复核/);
  assert.ok(
    h
      .get('detail')
      .querySelectorAll('form')
      .some((form) => form.className === 'moderation-withdrawal'),
  );
  assert.ok(
    !h
      .get('detail')
      .querySelectorAll('button')
      .some((node) => node.className === 'moderation-image-confirm'),
  );
});

test('failed image loading prevents post-publication confirmation while withdrawal stays available', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.includes('/attachments/')) return response({ message: '图片无法加载' }, 503);
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob(), imageReview: pendingImageReview() } });
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  h.submission.version = 2;
  h.submission.attachments = [{ id: imageId }];
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const button = h
    .get('detail')
    .querySelectorAll('button')
    .find((node) => node.className === 'moderation-image-confirm');
  assert.equal(button.disabled, true);
  await button.events.click();
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/image-review')));
  assert.ok(
    h
      .get('detail')
      .querySelectorAll('form')
      .some((form) => form.className === 'moderation-withdrawal'),
  );
});

test('image result prose uses display copies and raw OCR remains in a closed disclosure with distinct review focus', async () => {
  const run = policyRun();
  run.reviewFocus = { political: true, psychological: true };
  run.imagesReviewed = true;
  run.policyDecision = {
    ...run.policyDecision,
    imagesReviewed: true,
    reasonLabels: ['图片已完成机器检查，需负责人复核。'],
  };
  run.imageResults = [
    {
      attachmentIds: [imageId],
      response: {
        model: 'kimi-k2.6',
        assessment: {
          reason: 'PRIVATE_RAW_REASON',
          ruleMatches: [
            {
              ruleId: '隐私-003',
              evidence: { field: 'image_1', quote: 'PRIVATE_QUOTE' },
              explanation: 'PRIVATE_EXPLANATION',
            },
          ],
        },
        imageObservations: [
          { imageIndex: 1, text: 'PRIVATE_OCR', description: 'PRIVATE_DESCRIPTION' },
        ],
        displayAssessment: {
          reason: '安全展示的隐私信息类型',
          ruleMatches: [{ ruleId: '隐私-003', explanation: '本人信息需安全复核。' }],
          uncertainties: [],
          supportReason: '',
        },
        displayObservations: [{ imageIndex: 1, text: 'PRIVATE_OCR', description: '安全图片说明' }],
      },
    },
  ];
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob('review'), result: run } });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const visible = visibleText(h.get('detail'));
  assert.match(visible, /安全展示的隐私信息类型.*安全图片说明/);
  assert.doesNotMatch(visible, /PRIVATE_/);
  const originals = h
    .get('detail')
    .querySelectorAll('details')
    .find((detail) => detail.textContent.includes('受限原始 OCR'));
  assert.equal(Boolean(originals.open), false);
  assert.match(originals.textContent, /PRIVATE_OCR/);
  assert.match(originals.textContent, /PRIVATE_QUOTE/);
  assert.doesNotMatch(
    h.get('detail').textContent,
    /PRIVATE_RAW_REASON|PRIVATE_EXPLANATION|PRIVATE_DESCRIPTION/,
  );
  assert.match(visible, /政治敏感相关内容 · 须负责人审核/);
  assert.match(visible, /心理问题与求助 · 负责人关怀复核/);
  assert.match(visible, /心理关怀不等于违规/);
  assert.match(visible, /负责人通过前不发布；模型建议通过也不能自动放行/);
  assert.doesNotMatch(visible, /触发关键词：/);
  assert.doesNotMatch(visible, /图片尚未机器审核/);
});

test('strict keyword review shows both focus panels for a text-only result without turning keywords into violations', async () => {
  const run = policyRun();
  run.reviewFocus = {
    political: true,
    psychological: true,
    keywordVersion: 'focus-test-v1',
    keywordMatches: {
      political: ['习近平', '政治制度'],
      psychological: ['心理咨询', '抑郁'],
    },
  };
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob('review'), result: run } });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const sections = h.get('detail').querySelectorAll('section');
  const political = sections.find((item) => item.className === 'moderation-focus-political');
  const psychological = sections.find(
    (item) => item.className === 'moderation-focus-psychological',
  );
  assert.ok(political);
  assert.ok(psychological);
  assert.match(political.textContent, /触发关键词：习近平、政治制度/);
  assert.match(psychological.textContent, /触发关键词：心理咨询、抑郁/);
  assert.doesNotMatch(political.textContent, /触发关键词：心理/);
  assert.doesNotMatch(psychological.textContent, /触发关键词：习近平/);
  for (const section of [political, psychological]) {
    assert.match(section.textContent, /负责人通过前不发布/);
    assert.match(section.textContent, /模型建议通过也不能自动放行/);
    assert.match(section.textContent, /否定表达也不自动豁免/);
  }
  assert.match(political.textContent, /不等于已经违规/);
  assert.match(psychological.textContent, /不作疾病诊断/);
  assert.match(psychological.textContent, /不因此处罚求助者/);
});

test('semantic focus evidence is reviewer-only literal text in a closed disclosure', async () => {
  const run = policyRun();
  run.reviewFocus = {
    psychological: true,
    political: false,
    keywordMatches: { political: [], psychological: [] },
  };
  run.assessment.reviewTopics = {
    political: [],
    psychological: [
      {
        field: 'content',
        quote: '<img src=x onerror=attack()>最近一直很难受',
        reason: '持续困扰，需要支持复核。',
      },
    ],
  };
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) =>
      url.endsWith('/automation')
        ? response({ job: { ...automaticJob('review'), result: run } })
        : fallback(url, options),
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const section = h
    .get('detail')
    .querySelectorAll('section')
    .find((item) => item.className === 'moderation-focus-psychological');
  assert.match(section.textContent, /整句语义判断补充/);
  assert.doesNotMatch(section.textContent, /触发关键词/);
  assert.equal(section.querySelectorAll('img').length, 0);
  const details = section.querySelectorAll('details')[0];
  assert.ok(details);
  assert.notEqual(details.open, true);
  assert.match(details.textContent, /持续困扰，需要支持复核/);
});

test('review focus keyword metadata stays plain text and ignores empty or malformed keyword lists', async () => {
  const run = policyRun();
  run.reviewFocus = {
    political: true,
    psychological: true,
    keywordMatches: {
      political: ['<img src=x onerror=attack()>', null, '政治制度', '政治制度', {}, ''],
      psychological: 'PRIVATE_CONTEXT',
    },
  };
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob('review'), result: run } });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const sections = h.get('detail').querySelectorAll('section');
  const political = sections.find((item) => item.className === 'moderation-focus-political');
  const psychological = sections.find(
    (item) => item.className === 'moderation-focus-psychological',
  );
  assert.match(political.textContent, /触发关键词：<img src=x onerror=attack\(\)>、政治制度$/);
  assert.equal(political.querySelectorAll('img').length, 0);
  assert.doesNotMatch(political.textContent, /\[object Object\]|null|政治制度、政治制度/);
  assert.doesNotMatch(psychological.textContent, /触发关键词：|PRIVATE_CONTEXT/);
});

test('late image confirmation cannot restore content after logout', async () => {
  const wait = deferred();
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({ job: { ...automaticJob(), imageReview: pendingImageReview() } });
      if (url.endsWith('/image-review')) return wait.promise;
      return fallback(url, options);
    },
  });
  h.submission.status = 'approved';
  h.submission.version = 2;
  h.submission.attachments = [{ id: imageId }];
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  const button = h
    .get('detail')
    .querySelectorAll('button')
    .find((node) => node.className === 'moderation-image-confirm');
  const pending = button.events.click();
  h.setToken('');
  await h.app.initialize();
  wait.resolve(
    response({
      id: 's1',
      version: 2,
      imageReview: { ...pendingImageReview(), state: 'confirmed', canConfirm: false },
    }),
  );
  await pending;
  assert.doesNotMatch(h.get('detail').textContent, /图片已复核|PRIVATE_/);
  assert.equal(h.get('image-queue').hidden, true);
});

test('failed image parsing shows only allowlisted diagnostic descriptions and never claims a valid image result', async () => {
  const h = harness({
    automation: automaticSettings(),
    customFetch: (url, options, fallback) => {
      if (url.endsWith('/automation'))
        return response({
          job: {
            ...automaticJob('review'),
            result: {
              assessment: null,
              imagesReviewed: false,
              policyEvidence: [],
              manualReview: {
                required: true,
                validation: 'failed',
                imageDiagnostics: {
                  failureCode: 'image_observations_invalid',
                  validation: {
                    issue: 'index',
                    path: 'PRIVATE_PROVIDER_PATH',
                    actualType: 'PRIVATE_PROVIDER_VALUE',
                  },
                  raw: 'PRIVATE_PROVIDER_BODY',
                },
              },
            },
          },
        });
      return fallback(url, options);
    },
  });
  await h.app.ready;
  await h.app.openSubmission('s1');
  await flush();
  assert.match(h.get('detail').textContent, /图片需要人工检查/);
  assert.match(h.get('detail').textContent, /图片序号不符合要求/);
  assert.match(h.get('detail').textContent, /不将无效结果视为安全/);
  assert.doesNotMatch(h.get('detail').textContent, /PRIVATE_PROVIDER|图片尚未机器审核/);
});

test('personal view stays free of reviewer sections for authors, reviewers and administrators', async () => {
  for (const roles of [
    { reviewer: false, isAdmin: false },
    { reviewer: true, isAdmin: false },
    { reviewer: true, isAdmin: true },
  ]) {
    const h = harness({
      mine: true,
      ...roles,
      automation: automaticSettings(),
      aiTestEnabled: true,
    });
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    assert.equal(h.get('intro').hidden, true);
    assert.equal(h.get('mine-title').hidden, false);
    for (const id of ['reviewers', 'automation', 'policy-library', 'queue-note', 'queue-eyebrow'])
      assert.equal(h.get(id).hidden, true, id);
    assert.ok(
      !h.requests.some(({ url }) =>
        /reviewers|policies|ai-history|ai-models|privacy-preview|ai-test|\/automation/.test(url),
      ),
    );
    assert.match(h.get('detail').textContent, /提交者/);
  }
});

test('author notification URL adopts the personal layout after session resolution', async () => {
  const h = harness({ search: '?id=s1', reviewer: false, isAdmin: true });
  await h.app.ready;
  assert.equal(h.get('intro').hidden, true);
  assert.equal(h.get('mine-title').hidden, false);
  assert.equal(h.get('reviewers').hidden, true);
  assert.ok(!h.requests.some(({ url }) => url.endsWith('/reviewers')));
});

test('administrator management remains available in the workbench only', async () => {
  const h = harness({ isAdmin: true });
  await h.app.ready;
  await flush();
  assert.equal(h.get('intro').hidden, false);
  assert.equal(h.get('mine-title').hidden, true);
  assert.equal(h.get('reviewers').hidden, false);
  assert.ok(h.requests.some(({ url }) => url.endsWith('/reviewers')));
});

test('post and comment original content immediately precedes automatic results and preserves manual review', async () => {
  for (const kind of ['post', 'comment']) {
    const h = harness({ automation: automaticSettings(), aiTestEnabled: true });
    h.submission.kind = kind;
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    const grid = h.get('detail').children[0];
    assert.equal(grid.children[0].children[0].className, 'moderation-original');
    assert.equal(grid.children[0].children[1].className, 'moderation-automation-result');
    assert.match(grid.children[1].textContent, /负责人最终决定/);
    assert.doesNotMatch(h.get('detail').textContent, /本地脱敏预览|调用无问芯穹试审/);
    assert.ok(!h.requests.some(({ url }) => /ai-models|privacy-preview|ai-test/.test(url)));
  }
});

test('reviewers get actionable status while administrator diagnostics stay out of the main reading flow', async () => {
  for (const isAdmin of [false, true]) {
    const h = policyHarness({ isAdmin, automation: automaticSettings() });
    await h.app.ready;
    await h.app.openSubmission('s1');
    await flush();
    assert.match(h.get('automation-summary').textContent, /已暂停.*等待审核/);
    assert.doesNotMatch(h.get('automation-summary').textContent, /qwen|glm|kimi|模型/);
    const technical = h
      .get('detail')
      .querySelectorAll('details')
      .find((item) => item.children[0]?.textContent === '技术排查信息');
    assert.equal(Boolean(technical), isAdmin);
    if (technical) assert.notEqual(technical.open, true);
    assert.match(h.get('detail').textContent, /负责人最终决定/);
  }
});
