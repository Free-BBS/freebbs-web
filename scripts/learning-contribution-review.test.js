const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createLearningWorkspaceRouter } = require('../backend/learning-workspace');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
const entry = (id, revision = 1) => ({
  id: String(id),
  revision,
  kind: 'contribution',
  status: 'pending',
  title: `本地夹具建议 ${id}`,
  content: '本地测试内容，不是正式课程建议。',
  response: '',
  updatedAt: '2026-10-10T00:00:00Z',
});
function runtime() {
  function element(tag = 'div', copy = '', className = '') {
    return {
      tag,
      textContent: copy,
      className,
      dataset: {},
      value: '',
      hidden: false,
      disabled: false,
      children: [],
      listeners: new Map(),
      classList: { toggle() {} },
      append(...items) {
        this.children.push(...items);
        items.forEach((item) => Object.assign(item, { parent: this }));
      },
      replaceChildren(...items) {
        this.children = items;
        items.forEach((item) => Object.assign(item, { parent: this }));
      },
      setAttribute() {},
      remove() {
        if (this.parent)
          this.parent.children = this.parent.children.filter((child) => child !== this);
      },
      focus() {
        sandbox.document.activeElement = this;
      },
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
      contains(item) {
        return this.children.some((child) => child === item || child.contains(item));
      },
      querySelectorAll(selector) {
        return this.children.flatMap((child) => [
          ...(child.tag === selector ||
          (selector.startsWith('.') && child.className.split(' ').includes(selector.slice(1)))
            ? [child]
            : []),
          ...child.querySelectorAll(selector),
        ]);
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
    };
  }
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const calls = [];
  let personalLoads = 0;
  const sandbox = {
    app: {
      userState: { uid: 'teacher', token: 'teacher-session', isLoggedIn: true },
      callApi(url, options) {
        let resolve;
        let reject;
        const promise = new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        });
        calls.push({ url, options, resolve, reject });
        return promise;
      },
    },
    el,
    text: element,
    document: { createElement: element },
    show: (item, visible) => {
      Object.assign(item, { hidden: !visible });
    },
    endpoint: () => `/learning/${sandbox.state.course.slug}/${sandbox.state.node.id}`,
    loggedIn: () => sandbox.app.userState.isLoggedIn && !sandbox.state.stale,
    loadEntries: async () => {
      personalLoads += 1;
    },
    page: { querySelectorAll: () => [] },
    resetNote() {},
    syncContributionForm() {},
    renderEntries() {},
    sessionMessage() {},
    URL,
  };
  const stateSource = source.slice(
    source.indexOf('  const state ='),
    source.indexOf('  const show ='),
  );
  const recordSource = source.slice(
    source.indexOf('  function recordCard('),
    source.indexOf('  function renderEntries('),
  );
  const from = source.includes('  function reviewScope(')
    ? source.indexOf('  function reviewScope(')
    : source.indexOf('  async function loadReview(');
  const reviewSource = source.slice(
    from,
    source.indexOf('  async function loadAnnotationRecords('),
  );
  const resetFrom = source.indexOf('  function resetSession(');
  const resetSource = source.slice(
    resetFrom,
    source.indexOf("  document.querySelectorAll('[data-knowledge-tool]')", resetFrom),
  );
  vm.runInNewContext(
    `${stateSource}\nthis.state = state;\n${recordSource}\n${reviewSource}\n${resetSource}`,
    sandbox,
  );
  sandbox.window = {
    addEventListener: (name, callback) => {
      sandbox[name] = callback;
    },
  };
  sandbox.scrollPosition = () => 0;
  sandbox.keepPreference = () => {};
  sandbox.refreshPlan = () => {};
  sandbox.page.addEventListener = (name, callback) => {
    sandbox[name] = callback;
  };
  const documentFrom = source.indexOf("  page.addEventListener('knowledge:document-saved'");
  vm.runInNewContext(
    source.slice(
      documentFrom,
      source.indexOf("  page.addEventListener('knowledge:assessment-updated'", documentFrom),
    ),
    sandbox,
  );
  const unloadFrom = source.indexOf("  window.addEventListener('beforeunload'");
  vm.runInNewContext(source.slice(unloadFrom, source.lastIndexOf('})();')), sandbox);
  Object.assign(sandbox.state, {
    ready: true,
    course: { slug: 'signals', canEditMap: true },
    node: { id: 'SS-01-01', documentVersion: 'a'.repeat(64) },
    uid: 'teacher',
    token: 'teacher-session',
    stale: false,
  });
  const findCard = (id) =>
    el('review-records').children.find((item) => item.dataset.recordId === String(id));
  const reply = (id) => findCard(id)?.querySelectorAll('textarea')[0];
  const button = (id, decision = 'handled') =>
    findCard(id)
      .querySelectorAll('button')
      .find((item) => item.textContent === (decision === 'handled' ? '标记已处理' : '暂不采纳'));
  const typeReply = (id, copy) => {
    reply(id).value = copy;
    reply(id).listeners.get('input')?.();
  };
  return {
    sandbox,
    state: sandbox.state,
    app: sandbox.app,
    calls,
    el,
    findCard,
    reply,
    button,
    typeReply,
    personalLoads: () => personalLoads,
  };
}

async function seededBackend(count = 121) {
  const store = createMemoryLearningStore();
  const context = await store.context('signals', 'SS-01-01');
  for (let index = 1; index <= count; index += 1)
    await store.create(
      { id: 1 },
      context,
      {
        kind: 'contribution',
        category: 'suggestion',
        title: `夹具 ${index}`,
        content: '本地测试建议，不是正式记录。',
      },
      `fixture-${index}`,
    );
  const router = createLearningWorkspaceRouter({ store, requireAuth: async () => ({ id: 3 }) });
  const get = router.stack.find((item) => item.route?.path === '/:slug/:point/entries').route
    .stack[0].handle;
  const pending = async (before = '') => {
    let payload;
    await get(
      {
        params: { slug: 'signals', point: 'SS-01-01' },
        query: { review: 'pending', ...(before ? { before } : {}) },
      },
      {
        json: (data) => {
          payload = data;
        },
        status() {
          return this;
        },
        set() {
          return this;
        },
      },
    );
    return payload;
  };
  return { store, pending };
}
const moreButton = (view) =>
  view
    .el('review-records')
    .children.find((item) => item.className.includes('learning-review-more'));
const countText = (view) =>
  view
    .el('review-records')
    .children.find((item) => item.className.includes('learning-review-count'))?.textContent;
async function load(view, payload, more = false) {
  const pending = view.sandbox.loadReview(more);
  view.calls.at(-1).resolve(payload);
  await pending;
}

test('processing A preserves B unsubmitted response rather than recreating it empty', async () => {
  const view = runtime();
  const initial = view.sandbox.loadReview();
  view.calls[0].resolve({ entries: [entry(2), entry(1)], nextCursor: null });
  await initial;
  view.typeReply(1, 'B 的未提交处理说明');
  view.typeReply(2, 'A 的处理说明');
  const processA = view.button(2).listeners.get('click')();
  view.calls[1].resolve({ ok: true });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  if (view.calls[2]) view.calls[2].resolve({ entries: [entry(1)], nextCursor: null });
  await processA;
  assert.equal(view.reply(1).value, 'B 的未提交处理说明');
});

test('real pending contract returns DESC pages of 50 with before cursor, not a total', async () => {
  const backend = await seededBackend();
  const first = await backend.pending();
  assert.equal(first.entries.length, 50);
  assert.equal(first.entries[0].id, '121');
  assert.equal(first.nextCursor, '72');
  assert.equal(first.total, undefined);
  const second = await backend.pending(first.nextCursor);
  const third = await backend.pending(second.nextCursor);
  assert.equal(second.entries[0].id, '71');
  assert.equal(third.entries.length, 21);
  assert.equal(third.nextCursor, null);
});

test('121 pending entries are explicitly browsable with isolated cursor and overlap deduplication', async () => {
  const backend = await seededBackend();
  const view = runtime();
  view.state.cursor = '900';
  const first = await backend.pending();
  await load(view, first);
  assert.equal(view.state.reviewEntries.length, 50);
  assert.match(countText(view), /已加载待处理 50 条/);
  assert.doesNotMatch(countText(view), /共.*121/);
  view.typeReply('80', '先查旧建议，当前输入不丢。');
  const next = moreButton(view).listeners.get('click')();
  const second = await backend.pending(first.nextCursor);
  view.calls.at(-1).resolve({ ...second, entries: [first.entries.at(-1), ...second.entries] });
  await next;
  assert.equal(view.state.reviewEntries.length, 100);
  assert.equal(view.reply('80').value, '先查旧建议，当前输入不丢。');
  const last = moreButton(view).listeners.get('click')();
  view.calls.at(-1).resolve(await backend.pending(second.nextCursor));
  await last;
  assert.equal(view.state.reviewEntries.length, 121);
  assert.equal(new Set(view.state.reviewEntries.map((item) => item.id)).size, 121);
  assert.equal(moreButton(view), undefined);
  assert.equal(view.state.cursor, '900');
  assert.match(view.calls[1].url, /review=pending&before=72$/);
});

test('pagination failure retains cursor, prior replies including zero, and prevents duplicate clicks', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2), entry(1)], nextCursor: '1' });
  view.typeReply(1, '0');
  const next = moreButton(view).listeners.get('click')();
  const beforeCount = view.calls.length;
  await view.sandbox.loadReview(true);
  assert.equal(view.calls.length, beforeCount);
  assert.equal(view.el('review-refresh').disabled, true);
  view.calls.at(-1).reject(new Error('fixture network down'));
  await next;
  assert.equal(view.state.reviewCursor, '1');
  assert.equal(view.reply(1).value, '0');
  assert.equal(moreButton(view).disabled, false);
  assert.equal(view.el('review-refresh').disabled, false);
  const retry = moreButton(view).listeners.get('click')();
  assert.equal(view.calls.at(-1).url, view.calls.at(-2).url);
  view.calls.at(-1).resolve({ entries: [], nextCursor: null });
  await retry;
  assert.equal(view.reply(1).value, '0');
});

test('head refresh preserves same revision replies but never applies them to revised records', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2), entry(1)], nextCursor: null });
  view.typeReply(1, 'B reply');
  view.typeReply(2, 'A reply');
  const oldA = view.button(2);
  await load(view, { entries: [entry(2, 2), entry(1)], nextCursor: null });
  assert.equal(view.reply(1).value, 'B reply');
  assert.equal(view.reply(2).value, '');
  const calls = view.calls.length;
  await oldA.listeners.get('click')();
  assert.equal(view.calls.length, calls);
});

test('save failures retain one reply and re-enable retry; zero is a valid response string', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2), entry(1)], nextCursor: null });
  view.typeReply(2, '0');
  view.typeReply(1, 'B still editing');
  const first = view.button(2, 'declined').listeners.get('click')();
  const initialCount = view.calls.length;
  assert.equal(view.reply(2).disabled, true);
  await view.button(2).listeners.get('click')();
  assert.equal(view.calls.length, initialCount);
  assert.deepEqual(JSON.parse(view.calls.at(-1).options.body), {
    status: 'declined',
    response: '0',
  });
  view.calls.at(-1).reject(new Error('fixture failed save'));
  await first;
  assert.equal(view.reply(2).value, '0');
  assert.equal(view.reply(2).disabled, false);
  assert.equal(view.button(2).disabled, false);
  const retry = view.button(2, 'declined').listeners.get('click')();
  view.calls.at(-1).resolve({ ok: true });
  await retry;
  assert.equal(view.findCard(2), undefined);
  assert.equal(view.reply(1).value, 'B still editing');
  assert.equal(view.personalLoads(), 1);
});

test('late pending pages cannot revive a just-processed entry', async () => {
  const view = runtime();
  await load(view, { entries: [entry(3), entry(2)], nextCursor: '2' });
  view.typeReply(3, 'A done');
  const more = view.sandbox.loadReview(true);
  const pageRequest = view.calls.at(-1);
  const finish = view.button(3).listeners.get('click')();
  view.calls.at(-1).resolve({ ok: true });
  await finish;
  pageRequest.resolve({ entries: [entry(3), entry(1)], nextCursor: null });
  await more;
  assert.equal(view.findCard(3), undefined);
  assert.deepEqual(
    Array.from(view.state.reviewEntries, (item) => item.id),
    ['2', '1'],
  );
});

test('pending saves remain disabled and retain reply across a concurrent list rerender', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2)], nextCursor: null });
  view.typeReply(2, 'Frozen while saving');
  const save = view.button(2).listeners.get('click')();
  const request = view.calls.at(-1);
  await load(view, { entries: [entry(2), entry(1)], nextCursor: null });
  assert.equal(view.reply(2).value, 'Frozen while saving');
  assert.equal(view.reply(2).disabled, true);
  assert.equal(view.button(2).disabled, true);
  request.resolve({ ok: true });
  await save;
  assert.equal(view.findCard(2), undefined);
});

test('account, token, course, node, and body scope reject late list responses', async () => {
  for (const transition of [
    (view) => {
      Object.assign(view.app.userState, { uid: 'other' });
    },
    (view) => {
      Object.assign(view.app.userState, { token: 'rotated' });
    },
    (view) => {
      Object.assign(view.state.course, { slug: 'other-course' });
    },
    (view) => {
      Object.assign(view.state.node, { id: 'SS-02-01' });
    },
    (view) => {
      Object.assign(view.state.node, { documentVersion: 'b'.repeat(64) });
    },
  ]) {
    const view = runtime();
    const pending = view.sandbox.loadReview();
    transition(view);
    view.calls[0].resolve({ entries: [entry(2)], nextCursor: null });
    await pending;
    assert.equal(view.state.reviewEntries.length, 0);
    assert.equal(view.state.reviewLoaded, false);
  }
});

test('real session reset clears replies and late saves cannot touch another inbox', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2), entry(1)], nextCursor: null });
  view.typeReply(1, 'private reply draft');
  view.typeReply(2, 'saving A');
  const save = view.button(2).listeners.get('click')();
  const request = view.calls.at(-1);
  view.app.userState = { uid: 'other', token: 'other-token', isLoggedIn: true };
  view.state.currentAttempts = [{ id: 'previous-session-current' }];
  view.sandbox.resetSession(true);
  request.resolve({ ok: true });
  await save;
  assert.equal(view.state.reviewDrafts.size, 0);
  assert.equal(view.state.currentAttempts, undefined);
  assert.equal(view.state.reviewEntries.length, 0);
  assert.equal(view.el('review-section').hidden, true);
  assert.equal(view.personalLoads(), 0);
});

test('401/403 clears pending data and replies, while network failure is not an empty inbox', async () => {
  for (const status of [401, 403]) {
    const view = runtime();
    await load(view, { entries: [entry(2)], nextCursor: null });
    view.typeReply(2, 'private response');
    const refresh = view.sandbox.loadReview();
    view.calls.at(-1).reject(Object.assign(new Error('unauthorized'), { status }));
    await refresh;
    assert.equal(view.state.reviewDrafts.size, 0);
    assert.equal(view.el('review-records').children.length, 0);
    assert.equal(view.el('review-section').hidden, true);
  }
  const view = runtime();
  const failure = view.sandbox.loadReview();
  view.calls.at(-1).reject(new Error('offline'));
  await failure;
  assert.equal(view.state.reviewLoaded, false);
  assert.equal(countText(view), undefined);
  await load(view, { entries: [], nextCursor: null });
  assert.match(countText(view), /0 条/);
});

test('processing A keeps focus and selection in B when the teacher continues typing during save', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2), entry(1)], nextCursor: null });
  view.typeReply(2, 'A response');
  const save = view.button(2).listeners.get('click')();
  view.typeReply(1, 'B still has the keyboard');
  const originalReply = view.reply(1);
  view.reply(1).focus();
  view.reply(1).setSelectionRange(2, 7);
  view.calls.at(-1).resolve({ ok: true });
  await save;
  assert.equal(view.sandbox.document.activeElement, view.reply(1));
  assert.equal(view.reply(1), originalReply, 'B stays connected instead of being recreated');
  assert.equal(view.reply(1).selectionStart, 2);
  assert.equal(view.reply(1).selectionEnd, 7);
});

test('a document version change invalidates the pending page but preserves matching entry revision replies', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2)], nextCursor: '2' });
  view.typeReply(2, 'Same suggestion, independent of new body version');
  const old = view.sandbox.loadReview(true);
  const oldRequest = view.calls.at(-1);
  view.sandbox['knowledge:document-saved']({
    detail: { node: { id: 'SS-01-01', documentVersion: 'b'.repeat(64) } },
  });
  const freshRequest = view.calls.at(-1);
  oldRequest.resolve({ entries: [entry(1)], nextCursor: null });
  await old;
  assert.equal(view.state.reviewEntries.length, 0);
  assert.equal(view.state.reviewLoading, true);
  freshRequest.resolve({ entries: [entry(2)], nextCursor: null });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(view.state.reviewLoading, false);
  assert.equal(view.reply(2).value, 'Same suggestion, independent of new body version');
});

test('node changes reset all reply drafts even if the next node reuses an entry id', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2)], nextCursor: null });
  view.typeReply(2, 'Private draft from previous point');
  view.sandbox['knowledge:document-saved']({
    detail: { node: { id: 'SS-01-02', documentVersion: 'b'.repeat(64) } },
  });
  view.calls.at(-1).resolve({ entries: [entry(2)], nextCursor: null });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(view.reply(2).value, '');
  assert.equal(view.state.reviewDrafts.size, 0);
});

test('invalid pages keep old queue and cursor instead of presenting a false empty result', async () => {
  for (const payload of [{ entries: null }, { entries: [], nextCursor: '2' }]) {
    const view = runtime();
    await load(view, { entries: [entry(2)], nextCursor: '2' });
    view.typeReply(2, 'Keep this reply');
    await load(view, payload, true);
    assert.equal(view.state.reviewCursor, '2');
    assert.equal(view.reply(2).value, 'Keep this reply');
    assert.match(view.state.reviewMessage, /返回格式无效/);
    assert.equal(moreButton(view).disabled, false);
  }
});

test('permission failure on review save removes private replies and stale save failure cannot affect another session', async () => {
  for (const status of [401, 403]) {
    const view = runtime();
    await load(view, { entries: [entry(2)], nextCursor: null });
    view.typeReply(2, 'Private review reply');
    const save = view.button(2).listeners.get('click')();
    view.calls.at(-1).reject(Object.assign(new Error('Unauthorized fixture'), { status }));
    await save;
    assert.equal(view.state.reviewDrafts.size, 0);
    assert.equal(view.el('review-section').hidden, true);
    assert.equal(view.state.reviewSaving.size, 0);
  }
  const view = runtime();
  await load(view, { entries: [entry(2)], nextCursor: null });
  view.typeReply(2, 'Old session reply');
  const save = view.button(2).listeners.get('click')();
  const request = view.calls.at(-1);
  view.app.userState = { uid: 'other', token: 'other-token', isLoggedIn: true };
  view.sandbox.resetSession(true);
  request.reject(new Error('Late failure from old session'));
  await save;
  assert.equal(view.state.reviewErrors.size, 0);
  assert.equal(view.state.reviewEntries.length, 0);
});

test('leaving warns about unsubmitted review input including zero, not a completed or empty reply', async () => {
  const view = runtime();
  await load(view, { entries: [entry(2)], nextCursor: null });
  let prompts = 0;
  const leave = () =>
    view.sandbox.beforeunload({
      preventDefault: () => {
        prompts += 1;
      },
    });
  leave();
  assert.equal(prompts, 0);
  view.typeReply(2, '0');
  leave();
  assert.equal(prompts, 1);
  const save = view.button(2).listeners.get('click')();
  leave();
  assert.equal(prompts, 2);
  view.calls.at(-1).resolve({ ok: true });
  await save;
  leave();
  assert.equal(prompts, 2);
});
