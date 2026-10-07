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
function harness({ mine = false, search, customFetch, reviewer = true, isAdmin = false } = {}) {
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
    author: { username: '<b>A</b>' },
    attachments: [],
    createdAt: '2026-10-07T00:00:00Z',
  };
  let decisionAttempts = 0;
  const defaults = async (url) => {
    if (url.endsWith('/session'))
      return response({ enabled: true, reviewer, isAdmin, mode: 'manual' });
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
  assert.equal(h.get('detail').querySelectorAll('button').length, 2);
});

test('administrator sees a warning when no reviewer is configured', async () => {
  const h = harness({ isAdmin: true });
  await h.app.ready;
  await flush();
  assert.ok(h.get('reviewer-list').textContent.includes('当前没有审核负责人'));
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
