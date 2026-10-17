const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const controller = fs.readFileSync(path.join(root, 'public/circuit-discussion.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/discussion.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const submitSource = appSource.slice(
  appSource.indexOf('async function handleDiscussionComposeSubmit(event)'),
  appSource.indexOf('\nfunction insertTextAtTextarea'),
);
const submissionFeedbackSource = appSource.slice(
  appSource.indexOf('function setDiscussionMessage(message)'),
  appSource.indexOf('\nasync function observeModerationSubmission'),
);
const noticeVersion = 'synthetic-policy-v1';
const requestId = '00000000-0000-4000-8000-000000000001';
const cid = 'c_0123456789abcdef01234567';
const handoffUrl = `https://example.test/discussion?board=circuit&compose=circuit&cid=${cid}&revision=3`;
const reference = `[电路动态图](/circuit?cid=${cid}&revision=3&view=live)`;
const storageKey = `free_bbs_circuit_discussion_draft_v1:${cid}:3`;
const pointerKey = 'free_bbs_circuit_discussion_intent_v1';
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function makeElement() {
  const listeners = new Map();
  const classes = new Set();
  const children = [];
  let text = '';
  return {
    value: '',
    children,
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = value;
      children.length = 0;
    },
    append(...nodes) {
      children.push(...nodes);
    },
    hidden: false,
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
    scrollIntoView() {},
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    async emit(type, event = {}) {
      for (const handler of listeners.get(type) || []) await handler(event);
    },
  };
}

function harness({
  url = handoffUrl,
  uid = 'owner-one',
  storage = new Map(),
  fallback = false,
  existing = {},
  waitForCircuit = null,
  circuitError = null,
  circuitRevision = 3,
  ready = null,
} = {}) {
  const elements = new Map(
    [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, makeElement()]),
  );
  const form = elements.get('discussion-compose-form');
  const title = elements.get('discussion-compose-title');
  const content = elements.get('discussion-compose-content');
  const board = elements.get('discussion-compose-board');
  title.value = existing.title || '';
  content.value = existing.content || '';
  board.value = existing.board || 'circuit';
  form.classList.add('hidden');
  const window = makeElement();
  let location = new URL(url);
  Object.defineProperty(window, 'location', { get: () => location });
  const historyUpdates = [];
  window.history = {
    replaceState(_state, _title, nextUrl) {
      historyUpdates.push(String(nextUrl));
      location = new URL(String(nextUrl), location);
    },
  };
  const calls = [];
  const app = {
    userState: {
      uid,
      token: uid ? `synthetic-${uid}` : '',
      isLoggedIn: Boolean(uid),
      isAdmin: false,
    },
    sessionReady: Promise.resolve(),
    discussionReady:
      ready ||
      Promise.resolve({
        boards: [{ slug: 'circuit' }, { slug: 'daily' }, { slug: 'math' }],
        isFallback: fallback,
      }),
    async callApi(route, options) {
      calls.push({ route, options });
      if (waitForCircuit) await waitForCircuit;
      if (circuitError) throw circuitError;
      return { circuit: { cid, revision: circuitRevision } };
    },
  };
  window.freeBbsApp = app;
  const context = vm.createContext({
    window,
    document: { getElementById: (id) => elements.get(id), querySelector: () => null },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    URL,
    URLSearchParams,
  });
  vm.runInContext(controller, context, { filename: 'circuit-discussion.js' });
  return {
    app,
    window,
    calls,
    storage,
    form,
    elements,
    historyUpdates,
    title,
    content,
    board,
    status: elements.get('circuit-discussion-status'),
    append: elements.get('circuit-discussion-append'),
    login: elements.get('circuit-discussion-login'),
    ready: flush,
  };
}

function connectSubmission(fixture, callApi) {
  const { title: titleField, content: contentField } = fixture;
  const button = { disabled: false };
  let resetCount = 0;
  const message = fixture.elements.get('discussion-compose-message');
  const events = [];
  const postLoads = [];
  const renderedPosts = [];
  const queryUpdates = [];
  const observations = [];
  let previewRefreshes = 0;
  Object.assign(fixture.form, {
    querySelector: () => button,
    setAttribute() {},
    removeAttribute() {},
    dispatchEvent: (event) => {
      events.push(event.type);
      return fixture.form.emit(event.type, event);
    },
    reset() {
      resetCount += 1;
      titleField.value = '';
      contentField.value = '';
    },
  });
  const context = vm.createContext({
    document: {
      getElementById: (id) => fixture.elements.get(id),
      createElement: makeElement,
      createTextNode: (textContent) => ({ textContent }),
    },
    window: {
      location: fixture.window.location,
      FreeBbsModerationNotice: { confirm: async () => noticeVersion },
    },
    crypto: { randomUUID: () => requestId },
    moderationSubmissionIntents: new Map(),
    discussionComposeForm: fixture.form,
    discussionComposeMessage: message,
    discussionComposeBoard: fixture.board,
    discussionComposeTitle: fixture.title,
    discussionComposeContent: fixture.content,
    discussionState: { isFallback: false },
    userState: fixture.app.userState,
    callApi,
    loadDiscussionPosts: async (options) => postLoads.push(options),
    renderDiscussionDetail: (post) => renderedPosts.push(post),
    observeModerationSubmission: (id, target) => observations.push({ id, target }),
    renderDiscussionUploadPreviews: () => {
      previewRefreshes += 1;
    },
    syncDiscussionAnonymousOption() {},
    updateDiscussionQuery: (query) => queryUpdates.push(query),
    isCurrentPath: (current) => fixture.window.location.pathname === current,
    openModal() {},
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
  });
  vm.runInContext(`${submissionFeedbackSource}\n${submitSource}`, context);
  return {
    submit: () => context.handleDiscussionComposeSubmit({ preventDefault() {} }),
    button,
    message,
    events,
    postLoads,
    renderedPosts,
    queryUpdates,
    observations,
    context,
    get previewRefreshes() {
      return previewRefreshes;
    },
    get resetCount() {
      return resetCount;
    },
  };
}

test('waits for session and real boards, verifies the fixed revision, and only prepares editable fields', async () => {
  let resolveReady;
  const fixture = harness({
    ready: new Promise((resolve) => {
      resolveReady = resolve;
    }),
  });
  await fixture.ready();
  assert.equal(fixture.calls.length, 0);
  resolveReady({ boards: [{ slug: 'circuit' }], isFallback: false });
  await fixture.ready();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { route: `/circuits/${cid}?revision=3`, options: { method: 'GET' } },
  ]);
  assert.equal(fixture.title.value, '看看我的神秘电路！');
  assert.equal(fixture.content.value, reference);
  assert.equal(fixture.board.value, 'circuit');
  assert.equal(fixture.form.classList.contains('hidden'), false);
  assert.match(fixture.status.textContent, /确认后点击“发布”/);
  assert.equal(
    fixture.calls.some((call) => call.options.method === 'POST'),
    false,
  );
});

for (const [label, url] of [
  ['bad CID', handoffUrl.replace(cid, 'c_invalid')],
  ['zero revision', handoffUrl.replace('revision=3', 'revision=0')],
  ['exponent revision', handoffUrl.replace('revision=3', 'revision=1e2')],
  ['unsafe integer', handoffUrl.replace('revision=3', 'revision=9007199254740992')],
  ['duplicate revision', `${handoffUrl}&revision=4`],
  ['unexpected board', handoffUrl.replace('board=circuit', 'board=math')],
]) {
  test(`rejects ${label} without requesting or inserting a circuit`, async () => {
    const fixture = harness({ url });
    await fixture.ready();
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.content.value, '');
    assert.match(fixture.status.textContent, /无效/);
    assert.equal(fixture.form.classList.contains('hidden'), true);
  });
}

test('404 and mismatched revisions never create a fabricated reference', async () => {
  for (const options of [
    { circuitError: Object.assign(new Error('Not found'), { status: 404 }) },
    { circuitRevision: 4 },
  ]) {
    const fixture = harness(options);
    await fixture.ready();
    assert.equal(fixture.content.value, '');
    assert.equal(fixture.form.classList.contains('hidden'), true);
    assert.match(fixture.status.textContent, /未生成引用/);
    assert.equal(fixture.append.hidden, true);
  }
});

test('fallback boards do not authorize a handoff', async () => {
  const fixture = harness({ fallback: true });
  await fixture.ready();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.content.value, '');
  assert.match(fixture.status.textContent, /版块暂不可用/);
});

test('existing drafts and board selections are preserved until explicit append', async () => {
  const fixture = harness({
    existing: { title: 'My own title', content: 'Original body', board: 'math' },
  });
  await fixture.ready();
  assert.equal(fixture.title.value, 'My own title');
  assert.equal(fixture.content.value, 'Original body');
  assert.equal(fixture.board.value, 'math');
  assert.equal(fixture.append.hidden, false);
  await fixture.append.emit('click');
  assert.equal(fixture.title.value, 'My own title');
  assert.equal(fixture.content.value, `Original body\n\n${reference}`);
  assert.equal(fixture.board.value, 'math');
  await fixture.append.emit('click');
  assert.equal(fixture.content.value, `Original body\n\n${reference}`);
});

test('typing during verification is never overwritten by the asynchronous response', async () => {
  let resolveCircuit;
  const fixture = harness({
    waitForCircuit: new Promise((resolve) => {
      resolveCircuit = resolve;
    }),
  });
  await fixture.ready();
  fixture.title.value = 'Typed while loading';
  await fixture.form.emit('input');
  resolveCircuit();
  await fixture.ready();
  assert.equal(fixture.title.value, 'Typed while loading');
  assert.equal(fixture.content.value, '');
  assert.equal(fixture.append.hidden, false);
});

test('refresh restores title, body and the edited board without refilling the defaults', async () => {
  const storage = new Map();
  const original = harness({ storage });
  await original.ready();
  original.title.value = 'Revised title';
  original.content.value = `${reference}\n\nMy experiment notes`;
  original.board.value = 'daily';
  await original.form.emit('input');
  await original.form.emit('change');
  const restored = harness({ storage });
  await restored.ready();
  assert.equal(restored.title.value, 'Revised title');
  assert.equal(restored.content.value, `${reference}\n\nMy experiment notes`);
  assert.equal(restored.board.value, 'daily');
  await restored.window.emit('freebbs:session-change');
  assert.equal(restored.title.value, 'Revised title');
});

test('anonymous drafts survive login and a return to the discussion page', async () => {
  const storage = new Map();
  const guest = harness({ uid: '', storage });
  await guest.ready();
  assert.equal(guest.login.hidden, false);
  guest.content.value = `${reference}\n\nGuest notes`;
  await guest.form.emit('input');
  const loggedIn = harness({ uid: 'new-owner', url: 'https://example.test/discussion', storage });
  await loggedIn.ready();
  assert.equal(loggedIn.content.value, `${reference}\n\nGuest notes`);
  assert.equal(loggedIn.login.hidden, true);
  assert.equal(JSON.parse(storage.get(storageKey)).uid, 'new-owner');
  assert.equal(loggedIn.window.location.search.includes('compose=circuit'), true);
});

test('signing into the same page claims an anonymous draft without overwriting edits', async () => {
  const fixture = harness({ uid: '' });
  await fixture.ready();
  fixture.title.value = 'Before signing in';
  await fixture.form.emit('input');
  Object.assign(fixture.app.userState, { uid: 'new-owner', isLoggedIn: true });
  await fixture.window.emit('freebbs:session-change');
  assert.equal(fixture.title.value, 'Before signing in');
  assert.equal(fixture.calls.length, 1, 'a completed handoff is not fetched and applied again');
  assert.equal(fixture.login.hidden, true);
});

test('logout and account switching remove private drafts and invalidate pending handoffs', async () => {
  const fixture = harness();
  await fixture.ready();
  fixture.content.value = 'Private draft';
  await fixture.form.emit('input');
  Object.assign(fixture.app.userState, { uid: 'other-user', isLoggedIn: true });
  await fixture.window.emit('freebbs:session-change');
  assert.equal(fixture.title.value, '');
  assert.equal(fixture.content.value, '');
  assert.equal(fixture.storage.has(storageKey), false);
  assert.equal(fixture.storage.has(pointerKey), false);
  assert.equal(fixture.window.location.search.includes('compose='), false);

  let finish;
  const pending = harness({
    waitForCircuit: new Promise((resolve) => {
      finish = resolve;
    }),
  });
  await pending.ready();
  Object.assign(pending.app.userState, { uid: '', isLoggedIn: false });
  await pending.window.emit('freebbs:session-change');
  finish();
  await pending.ready();
  assert.equal(pending.content.value, '');
  assert.equal(pending.form.dataset.circuitHandoff, undefined);
});

test('a different account cannot restore the previous owner’s stored draft', async () => {
  const storage = new Map();
  const original = harness({ storage });
  await original.ready();
  original.content.value = 'Private owner notes';
  await original.form.emit('input');
  const other = harness({ uid: 'other-user', storage });
  await other.ready();
  assert.equal(other.content.value, reference);
  assert.doesNotMatch(other.content.value, /Private owner/);
});

test('repeated refresh retains a changed destination after the discussion router updates its URL', async () => {
  const storage = new Map();
  const original = harness({ storage });
  await original.ready();
  original.title.value = 'A title I edited';
  original.content.value = `An experiment\n\n${reference}`;
  original.board.value = 'math';
  await original.form.emit('input');
  const changedBoardUrl = handoffUrl.replace('board=circuit', 'board=math');
  for (let count = 0; count < 2; count += 1) {
    const refreshed = harness({ url: changedBoardUrl, storage });
    await refreshed.ready();
    assert.equal(refreshed.title.value, original.title.value);
    assert.equal(refreshed.content.value, original.content.value);
    assert.equal(refreshed.board.value, 'math');
    assert.match(refreshed.status.textContent, /已恢复/);
  }
  const differentUser = harness({ url: changedBoardUrl, storage, uid: 'another-user' });
  await differentUser.ready();
  assert.equal(differentUser.calls.length, 0);
  assert.equal(differentUser.content.value, '');
});

test('switching the board during verification does not reset the user’s choice', async () => {
  let complete;
  const fixture = harness({
    waitForCircuit: new Promise((resolve) => {
      complete = resolve;
    }),
  });
  await fixture.ready();
  fixture.window.history.replaceState({}, '', handoffUrl.replace('board=circuit', 'board=math'));
  fixture.board.value = 'math';
  complete();
  await fixture.ready();
  assert.equal(fixture.content.value, '');
  assert.equal(fixture.board.value, 'math');
  assert.equal(fixture.append.hidden, false);
});

test('publication clears the handoff so refresh cannot reopen a published draft', async () => {
  const fixture = harness();
  await fixture.ready();
  await fixture.form.emit('discussion:published', { detail: { post: { id: 'POST01' } } });
  assert.equal(fixture.storage.has(storageKey), false);
  assert.equal(fixture.storage.has(pointerKey), false);
  assert.equal(fixture.form.dataset.circuitHandoff, undefined);
  assert.equal(fixture.window.location.search.includes('compose='), false);
  const fresh = harness({ url: fixture.window.location.href, storage: fixture.storage });
  await fresh.ready();
  assert.equal(fresh.calls.length, 0);
});

test('manual publish sends the edited fields once, then clears the persisted handoff', async () => {
  const fixture = harness();
  await fixture.ready();
  fixture.title.value = 'My edited title';
  fixture.content.value = `My own explanation\n\n${reference}`;
  fixture.board.value = 'math';
  await fixture.form.emit('input');
  const calls = [];
  let complete;
  const submission = connectSubmission(fixture, (route, options) => {
    calls.push({ route, body: JSON.parse(options.body), method: options.method });
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const pending = submission.submit();
  await submission.submit();
  assert.equal(submission.button.disabled, true);
  assert.deepEqual(calls, [
    {
      route: '/discussion/posts',
      method: 'POST',
      body: {
        title: fixture.title.value,
        contentMarkdown: fixture.content.value,
        boardSlug: 'math',
        loginRequired: true,
        isAnonymous: false,
        requestId,
        moderationNoticeVersion: noticeVersion,
      },
    },
  ]);
  complete({ post: { id: 'POST01', board: { slug: 'math' } } });
  await pending;
  assert.equal(submission.resetCount, 1);
  assert.equal(submission.button.disabled, false);
  assert.equal(fixture.storage.has(storageKey), false);
  assert.equal(fixture.storage.has(pointerKey), false);
  assert.deepEqual(submission.events, ['discussion:published']);
  assert.equal(submission.renderedPosts[0].id, 'POST01');
  assert.equal(submission.postLoads.length, 1);
  assert.equal(submission.context.moderationSubmissionIntents.size, 0);
  assert.equal(submission.observations.length, 0);
});

test('a failed manual publish leaves the editable draft and storage available to retry', async () => {
  const fixture = harness();
  await fixture.ready();
  fixture.content.value = `My explanation\n\n${reference}`;
  await fixture.form.emit('input');
  const submission = connectSubmission(fixture, async () => {
    throw new Error('Temporary failure');
  });
  await submission.submit();
  assert.match(fixture.content.value, /My explanation/);
  assert.match(JSON.parse(fixture.storage.get(storageKey)).content, /My explanation/);
  assert.equal(submission.resetCount, 0);
  assert.equal(submission.button.disabled, false);
  assert.equal(submission.message.textContent, 'Temporary failure');
  assert.deepEqual(submission.events, []);
  assert.equal(submission.postLoads.length, 0);
  assert.equal(submission.context.moderationSubmissionIntents.size, 1);
  assert.equal(fixture.form.classList.contains('hidden'), false);
});

test('a pending submission clears its handoff once without treating it as a published post', async () => {
  const fixture = harness();
  await fixture.ready();
  fixture.title.value = 'Submitted circuit notes';
  fixture.content.value = `My explanation\n\n${reference}`;
  await fixture.form.emit('input');
  const calls = [];
  const submission = connectSubmission(fixture, async (route, options) => {
    calls.push({ route, body: JSON.parse(options.body), method: options.method });
    return { moderation: { status: 'pending', id: 'circuit-submission-1' } };
  });
  await submission.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/discussion/posts');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].body.contentMarkdown, /My explanation/);
  assert.equal(calls[0].body.requestId, requestId);
  assert.equal(calls[0].body.moderationNoticeVersion, noticeVersion);
  assert.deepEqual(submission.events, ['discussion:submitted']);
  assert.equal(submission.resetCount, 1);
  assert.equal(submission.previewRefreshes, 1);
  assert.equal(submission.button.disabled, false);
  assert.equal(submission.context.moderationSubmissionIntents.size, 0);
  assert.equal(submission.message.dataset.moderationSubmissionId, 'circuit-submission-1');
  assert.equal(
    submission.message.children.at(-1).href,
    '/moderation?mine=1&id=circuit-submission-1',
  );
  assert.equal(submission.observations[0].target, submission.message);
  assert.equal(submission.observations[0].id, 'circuit-submission-1');
  assert.equal(submission.postLoads.length, 0);
  assert.equal(submission.renderedPosts.length, 0);
  assert.equal(submission.queryUpdates.length, 0);
  assert.equal(fixture.form.classList.contains('hidden'), false);
  assert.equal(fixture.storage.has(storageKey), false);
  assert.equal(fixture.storage.has(pointerKey), false);
  assert.equal(fixture.form.dataset.circuitHandoff, undefined);
  assert.equal(fixture.window.location.search.includes('compose='), false);
  const finishedUpdates = fixture.historyUpdates.length;
  await fixture.form.emit('discussion:submitted');
  await fixture.form.emit('discussion:published');
  await fixture.window.emit('pagehide');
  assert.equal(
    fixture.historyUpdates.length,
    finishedUpdates,
    'duplicate completion does not rerun cleanup',
  );
  assert.equal(fixture.storage.has(storageKey), false, 'pagehide cannot restore a submitted draft');
  const fresh = harness({ url: fixture.window.location.href, storage: fixture.storage });
  await fresh.ready();
  assert.equal(fresh.calls.length, 0);
  assert.equal(fresh.content.value, '');
});
