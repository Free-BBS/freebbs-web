const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const {
  createUndoHistory,
  createAnchor,
  stableBlocks,
} = require('../public/knowledge-annotations');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { documentVersion } = require('../backend/learning-workspace');

const version = 'a'.repeat(64);
const scopeFor = (state) =>
  JSON.stringify([
    state.uid,
    state.token,
    state.course?.slug,
    state.node?.id,
    state.node?.documentVersion,
    ...(state.node?.originDocumentVersion ? [state.node.originDocumentVersion] : []),
  ]);
const defaultScope = JSON.stringify([
  users.student.uid,
  'learning-preview-student',
  'signals',
  'SS-01-01',
  version,
]);
function annotationEntry(id = '1', revision = 1, content = '原文高亮') {
  const [block] = stableBlocks([{ text: '学习预览正文' }]);
  return {
    id,
    revision,
    kind: 'note',
    status: 'private',
    title: '原文高亮',
    content,
    annotation: {
      style: 'highlight',
      color: 'yellow',
      anchor: createAnchor({
        nodeId: 'SS-01-01',
        documentVersion: version,
        block,
        start: 0,
        end: 1,
      }),
    },
  };
}
function confirmed(before, after) {
  return {
    requestKey: randomUUID(),
    undoRequestKey: randomUUID(),
    scope: defaultScope,
    before,
    after,
  };
}

test('undo history records only acknowledged operation-shaped receipts and deduplicates replay', () => {
  const history = createUndoHistory();
  assert.equal(history.peek(), null);
  assert.equal(history.push(null), false);
  assert.equal(history.push({ requestKey: randomUUID() }), false);
  assert.equal(history.push({ after: annotationEntry() }), false);
  const create = confirmed(null, annotationEntry());
  assert.equal(history.push(create), true);
  assert.equal(history.push(create), false);
  assert.equal(history.peek().requestKey, create.requestKey);
  assert.equal(history.complete('not-the-latest-operation', null), false);
  assert.equal(history.complete(create.requestKey, null), true);
  assert.equal(history.push(create), false, 'a late duplicate receipt cannot reappear after undo');
  assert.equal(history.peek(), null);
});

test('undo snapshots cannot be changed by the live editor or by reading the stack', () => {
  const history = createUndoHistory();
  const before = annotationEntry();
  const after = annotationEntry('1', 2, '已保存的修改');
  const update = confirmed(before, after);
  history.push(update);
  before.content = '编辑器后来改变的旧文本';
  after.annotation.color = 'purple';
  update.requestKey = randomUUID();
  const snapshot = history.peek();
  assert.equal(snapshot.before.content, '原文高亮');
  assert.equal(snapshot.after.annotation.color, 'yellow');
  snapshot.before.content = '修改返回的快照';
  assert.equal(history.peek().before.content, '原文高亮');
});

test('a confirmed receipt receives one stable UUID for uncertain restoration retries', () => {
  let generated = 0;
  const key = randomUUID();
  const history = createUndoHistory(20, () => {
    generated += 1;
    return key;
  });
  const receipt = { requestKey: randomUUID(), before: annotationEntry(), after: null };
  assert.equal(history.push(receipt), true);
  assert.equal(history.push(receipt), false);
  assert.equal(generated, 1);
  assert.equal(history.peek().undoRequestKey, key);
  assert.equal(history.peek().undoRequestKey, key);
  assert.match(key, /^[a-f0-9-]{36}$/i);
});

test('create update delete undo chain remaps restored IDs and only advances confirmed own revisions', () => {
  const history = createUndoHistory(20, randomUUID);
  const first = annotationEntry('1', 1);
  const second = annotationEntry('1', 2, '第二次保存');
  const create = confirmed(null, first);
  const update = confirmed(first, second);
  const remove = confirmed(second, null);
  history.push(create);
  history.push(update);
  history.push(remove);

  const restored = annotationEntry('9', 1, '第二次保存');
  assert.equal(history.complete(remove.requestKey, restored), true);
  let next = history.peek();
  assert.equal(next.requestKey, update.requestKey);
  assert.equal(next.after.id, '9');
  assert.equal(next.after.revision, 1);
  assert.equal(next.before.id, '9');
  assert.equal(next.before.content, '原文高亮');

  assert.equal(history.complete(update.requestKey, annotationEntry('9', 2)), true);
  next = history.peek();
  assert.equal(next.requestKey, create.requestKey);
  assert.equal(next.after.id, '9');
  assert.equal(next.after.revision, 2);
  assert.equal(history.complete(create.requestKey, null), true);
  assert.equal(history.peek(), null);
});

test('undo remapping does not adopt a separate annotation revision and history stays bounded', () => {
  const history = createUndoHistory(3);
  const independent = confirmed(null, annotationEntry('8', 4));
  const first = confirmed(null, annotationEntry('1', 1));
  const update = confirmed(annotationEntry('1', 1), annotationEntry('1', 2));
  history.push(independent);
  history.push(first);
  history.push(update);
  history.complete(update.requestKey, annotationEntry('1', 3));
  history.complete(first.requestKey, null);
  assert.equal(history.peek().after.id, '8');
  assert.equal(history.peek().after.revision, 4);
  history.clear();
  assert.equal(history.peek(), null);
  const receipts = Array.from({ length: 5 }, (_, index) =>
    confirmed(null, annotationEntry(String(index + 1))),
  );
  receipts.forEach((receipt) => history.push(receipt));
  assert.equal(history.complete(receipts[4].requestKey, null), true);
  assert.equal(history.complete(receipts[3].requestKey, null), true);
  assert.equal(history.complete(receipts[2].requestKey, null), true);
  assert.equal(history.peek(), null, 'older than the configured history limit is not actionable');
});

function workspaceHarness({ callApi, loadEntries, state: overrides = {} } = {}) {
  const source = fs
    .readFileSync(require.resolve('../public/knowledge-workspace'), 'utf8')
    .replace(/\r\n/g, '\n');
  const saveStart = source.indexOf('  async function saveAnnotation(detail) {');
  const saveEnd = source.indexOf('  function resetSession(', saveStart);
  const handlerStart = source.indexOf("  page.addEventListener('knowledge:annotation-remove',");
  const handlerBoundary = source
    .slice(handlerStart)
    .search(/ {2}page\s*\.querySelectorAll\('\[data-learning-go\]'\)/);
  const handlerEnd = handlerBoundary < 0 ? -1 : handlerStart + handlerBoundary;
  assert.ok(
    saveStart >= 0 && saveEnd > saveStart && handlerStart >= 0 && handlerEnd > handlerStart,
  );
  const state = {
    generation: 1,
    busy: false,
    uid: users.student.uid,
    token: 'learning-preview-student',
    ready: true,
    course: { slug: 'signals' },
    node: { id: 'SS-01-01', documentVersion: version },
    ...overrides,
  };
  const events = [];
  const handlers = new Map();
  const requests = [];
  const status = { textContent: '' };
  let loads = 0;
  const app = {
    userState: { uid: state.uid, token: state.token, isLoggedIn: true },
    callApi: async (url, options) => {
      requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
      return callApi ? callApi(url, options) : { ok: true };
    },
  };
  const context = {
    app,
    state,
    loggedIn: () => Boolean(app.userState.token && app.userState.isLoggedIn && !state.stale),
    endpoint: () => `/learning/${state.course.slug}/${state.node.id}`,
    el: () => status,
    page: {
      addEventListener: (name, callback) => handlers.set(name, callback),
      dispatchEvent: (event) => events.push(event),
    },
    CustomEvent: function WorkspaceEvent(type, { detail }) {
      this.type = type;
      this.detail = detail;
    },
    window: { crypto: { randomUUID }, confirm: () => true },
    loadEntries: async () => {
      loads += 1;
      await loadEntries?.();
    },
  };
  vm.runInNewContext(
    `${source.slice(saveStart, saveEnd)}\n${source.slice(handlerStart, handlerEnd)}\nthis.saveAnnotation = saveAnnotation;`,
    context,
  );
  return {
    state,
    app,
    events,
    requests,
    status,
    handlers,
    save: (detail) => context.saveAnnotation({ scope: scopeFor(state), ...detail }),
    remove: (detail) =>
      handlers.get('knowledge:annotation-remove')({
        detail: { scope: scopeFor(state), ...detail },
      }),
    undo: (operation) => handlers.get('knowledge:annotation-undo')({ detail: { operation } }),
    scope: () => scopeFor(state),
    loads: () => loads,
  };
}

test('actual save and delete handlers emit confirmed before/after snapshots and revision-guarded removal', async () => {
  const created = annotationEntry('7', 1);
  const h = workspaceHarness({
    callApi: async (url, options) =>
      options.method === 'POST' ? { entry: created } : { ok: true },
  });
  const createKey = randomUUID();
  await h.save({
    requestKey: createKey,
    signature: 'new-note',
    title: created.title,
    content: created.content,
    annotation: created.annotation,
  });
  const createAck = h.events.find((event) => event.type === 'knowledge:annotation-saved').detail;
  assert.equal(createAck.before, null);
  assert.equal(createAck.after.id, '7');
  assert.equal(createAck.after.revision, 1);
  assert.equal(createAck.requestKey, createKey);

  const updateKey = randomUUID();
  await h.save({
    requestKey: updateKey,
    signature: 'updated-note',
    entry: created,
    title: created.title,
    content: '保存后的理解',
    annotation: created.annotation,
  });
  const updateAck = h.events
    .filter((event) => event.type === 'knowledge:annotation-saved')
    .at(-1).detail;
  assert.equal(updateAck.before.content, '原文高亮');
  assert.equal(updateAck.after.content, '保存后的理解');
  assert.equal(updateAck.after.revision, 2);
  const removeKey = randomUUID();
  await h.remove({ entry: updateAck.after, requestKey: removeKey });
  const removal = h.requests.find((request) => request.method === 'DELETE');
  assert.equal(removal.body.revision, 2);
  const removeAck = h.events.find((event) => event.type === 'knowledge:annotation-removed').detail;
  assert.equal(removeAck.before.content, '保存后的理解');
  assert.equal(removeAck.requestKey, removeKey);
  assert.equal(h.loads(), 3);
});

test('failed save delete and stale undo never emit a confirmed receipt or accept a newer arbitrary revision', async () => {
  const failure = Object.assign(new Error('并行编辑'), { status: 409 });
  const h = workspaceHarness({
    callApi: async () => {
      throw failure;
    },
  });
  const entry = annotationEntry();
  await h.save({
    requestKey: randomUUID(),
    signature: 'failed-note',
    entry,
    title: entry.title,
    content: '未保存',
    annotation: entry.annotation,
  });
  await h.remove({ entry, requestKey: randomUUID() });
  const operation = confirmed(annotationEntry('1', 1), annotationEntry('1', 2));
  await h.undo(operation);
  assert.equal(
    h.events.filter((event) =>
      [
        'knowledge:annotation-saved',
        'knowledge:annotation-removed',
        'knowledge:annotation-undo-completed',
      ].includes(event.type),
    ).length,
    0,
  );
  assert.equal(h.events.filter((event) => event.type === 'knowledge:annotation-error').length, 3);
  assert.equal(h.loads(), 0);
  assert.equal(h.requests.at(-1).body.revision, 2);
  assert.equal(h.state.busy, false);
});

test('an account or page generation change prevents late mutation receipts in the new context', async () => {
  for (const action of ['save', 'remove', 'undo']) {
    let finish;
    const h = workspaceHarness({
      callApi: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const entry = annotationEntry();
    let running;
    if (action === 'save')
      running = h.save({
        requestKey: randomUUID(),
        signature: 'in-flight',
        entry,
        title: entry.title,
        content: 'A',
        annotation: entry.annotation,
      });
    else if (action === 'remove') running = h.remove({ entry, requestKey: randomUUID() });
    else running = h.undo(confirmed(null, entry));
    h.state.generation += 1;
    h.state.uid = 'other-person';
    h.app.userState.uid = 'other-person';
    finish({ ok: true, entry });
    await running;
    assert.equal(h.events.length, 0);
    assert.equal(h.loads(), 0);
  }
});

test('undo ignores non-private or different-knowledge-point operations without API writes', async () => {
  for (const invalid of [
    { ...annotationEntry(), kind: 'contribution' },
    { ...annotationEntry(), status: 'pending' },
    {
      ...annotationEntry(),
      annotation: {
        ...annotationEntry().annotation,
        anchor: { ...annotationEntry().annotation.anchor, nodeId: 'SS-01-02' },
      },
    },
  ]) {
    const h = workspaceHarness();
    await h.undo(confirmed(null, invalid));
    assert.equal(h.requests.length, 0);
    assert.equal(
      h.events.filter((event) => event.type === 'knowledge:annotation-undo-completed').length,
      0,
    );
  }
});

test('undo rejects a missing or different account course point or document scope without API writes', async () => {
  for (const scope of [
    undefined,
    JSON.stringify(['other-account', 'learning-preview-student', 'signals', 'SS-01-01', version]),
    JSON.stringify([users.student.uid, 'expired-token', 'signals', 'SS-01-01', version]),
    JSON.stringify([
      users.student.uid,
      'learning-preview-student',
      'circuits',
      'SS-01-01',
      version,
    ]),
    JSON.stringify([users.student.uid, 'learning-preview-student', 'signals', 'SS-01-02', version]),
    JSON.stringify([
      users.student.uid,
      'learning-preview-student',
      'signals',
      'SS-01-01',
      'b'.repeat(64),
    ]),
  ]) {
    const h = workspaceHarness();
    await h.undo({ ...confirmed(null, annotationEntry()), scope });
    assert.equal(h.requests.length, 0);
    assert.equal(
      h.events.filter((event) => event.type === 'knowledge:annotation-undo-completed').length,
      0,
    );
    assert.ok(h.events.some((event) => event.type === 'knowledge:annotation-error'));
  }
});

test('logged-out or busy requests release the caller through error receipts without API writes', async () => {
  for (const reason of ['logged-out', 'busy']) {
    for (const action of ['save', 'remove', 'undo']) {
      const h = workspaceHarness();
      if (reason === 'logged-out') h.app.userState.isLoggedIn = false;
      else h.state.busy = true;
      const entry = annotationEntry();
      const requestKey = randomUUID();
      if (action === 'save')
        await h.save({
          requestKey,
          title: entry.title,
          content: entry.content,
          annotation: entry.annotation,
        });
      else if (action === 'remove') await h.remove({ requestKey, entry });
      else await h.undo({ ...confirmed(null, entry), requestKey });
      assert.equal(h.requests.length, 0);
      assert.equal(h.events.length, 1);
      assert.equal(h.events[0].type, 'knowledge:annotation-error');
      assert.equal(h.events[0].detail.requestKey, requestKey);
    }
  }
});

test('an empty undo operation or missing remove target releases the caller without a false completion', async () => {
  const h = workspaceHarness();
  const operation = { ...confirmed(null, null), scope: h.scope() };
  await h.undo(operation);
  await h.remove({ requestKey: randomUUID() });
  assert.equal(h.requests.length, 0);
  assert.equal(h.events.length, 2);
  assert.ok(h.events.every((event) => event.type === 'knowledge:annotation-error'));
});

function annotationReceiptHarness() {
  const source = fs
    .readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf("    page.addEventListener('knowledge:annotation-saved',");
  const end = source.indexOf("    page.addEventListener('knowledge:tool-select'", start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const comment = { value: '当前未保存的文字' };
  const messages = [];
  const state = {
    undo: createUndoHistory(20, randomUUID),
    pending: null,
    selectedEntry: null,
    selection: null,
    saveDraft: null,
    popoverEntry: null,
    callback: {},
    node: { documentVersion: version },
  };
  const context = {
    state,
    page: { addEventListener: (name, handler) => handlers.set(name, handler) },
    annotationScope: () => defaultScope,
    byId: () => comment,
    editorSnapshot: () => 'unchanged-editor',
    preserveReadingPosition: (callback) => callback(),
    closePopover: () => {},
    showToolbar: () => {},
    showPopover: () => {},
    commentField: { hidden: true },
    popover: { hidden: true },
    message: (value) => messages.push(value),
  };
  vm.runInNewContext(source.slice(start, end), context);
  return {
    state,
    comment,
    messages,
    receive: (name, detail) => handlers.get(name)({ detail }),
  };
}

test('actual annotation listeners reject old-scope saved and removed receipts without changing the live draft', () => {
  for (const kind of ['saved', 'removed']) {
    const h = annotationReceiptHarness();
    const entry = annotationEntry();
    const requestKey = randomUUID();
    h.state.pending = { type: kind === 'saved' ? 'save' : 'remove', requestKey };
    const { pending } = h.state;
    const receipt = {
      requestKey,
      scope: JSON.stringify([
        users.student.uid,
        'learning-preview-student',
        'signals',
        'SS-01-01',
        'b'.repeat(64),
      ]),
      entryId: entry.id,
      before: kind === 'removed' ? entry : null,
      after: kind === 'saved' ? entry : null,
    };
    h.receive(`knowledge:annotation-${kind}`, receipt);
    assert.equal(h.state.undo.peek(), null);
    assert.equal(
      h.state.pending,
      pending,
      'an unrelated old-scope receipt does not release a current request',
    );
    assert.equal(h.comment.value, '当前未保存的文字');
    assert.equal(h.messages.length, 0);
  }
});

test('actual current-scope receipts enter history once and never erase later typing', () => {
  const h = annotationReceiptHarness();
  const entry = annotationEntry();
  const receipt = { ...confirmed(null, entry), entryId: entry.id };
  h.state.pending = { type: 'save', requestKey: receipt.requestKey };
  h.receive('knowledge:annotation-saved', receipt);
  assert.equal(h.state.pending, null);
  assert.equal(h.state.undo.peek().requestKey, receipt.requestKey);
  assert.equal(h.comment.value, '当前未保存的文字');
  h.receive('knowledge:annotation-saved', receipt);
  h.state.pending = { type: 'undo', requestKey: receipt.requestKey };
  h.receive('knowledge:annotation-undo-completed', { requestKey: receipt.requestKey, after: null });
  assert.equal(
    h.state.undo.peek(),
    null,
    'duplicate confirmed receipts do not duplicate undo history',
  );
  assert.equal(h.state.pending, null);
});

test('unrelated undo receipts cannot clear a current draft while genuine conflict clears only actionable history', () => {
  const h = annotationReceiptHarness();
  const receipt = confirmed(null, annotationEntry());
  h.state.undo.push(receipt);
  h.state.pending = { type: 'undo', requestKey: receipt.requestKey };
  const { pending } = h.state;
  h.receive('knowledge:annotation-undo-completed', { requestKey: 'unrelated', after: null });
  h.receive('knowledge:annotation-error', { requestKey: 'unrelated', status: 409, undo: true });
  assert.equal(h.state.pending, pending);
  assert.equal(h.state.undo.peek().requestKey, receipt.requestKey);
  assert.equal(h.comment.value, '当前未保存的文字');
  h.receive('knowledge:annotation-error', {
    requestKey: receipt.requestKey,
    status: 409,
    undo: true,
    message: '记录已被其他设备修改',
  });
  assert.equal(h.state.pending, null);
  assert.equal(h.state.undo.peek(), null);
  assert.equal(h.comment.value, '当前未保存的文字');
});

test('actual undo handlers reverse create update delete through the real API with stable valid restore keys', async (t) => {
  const preview = createLearningPreview();
  preview.store.context = createMemoryLearningStore().context;
  const { port } = await listenAllowedLoopback(preview.server);
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const context = await preview.store.context('signals', 'SS-01-01');
  let loseNextRestoreReply = false;
  const h = workspaceHarness({
    state: { node: { id: context.node_id, documentVersion: documentVersion(context) } },
    callApi: async (url, options) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer learning-preview-student',
        },
      });
      const payload = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(payload.message), { status: response.status });
      if (loseNextRestoreReply && options.method === 'POST') {
        loseNextRestoreReply = false;
        throw new Error('恢复写入成功，但模拟响应在网络中丢失');
      }
      return payload;
    },
  });
  const history = createUndoHistory(20, randomUUID);
  const initial = annotationEntry();
  initial.annotation.anchor.documentVersion = documentVersion(context);
  await h.save({
    requestKey: randomUUID(),
    signature: 'create',
    title: initial.title,
    content: initial.content,
    annotation: initial.annotation,
  });
  const created = h.events.at(-1).detail;
  assert.ok(created.after);
  history.push(created);
  await h.save({
    requestKey: randomUUID(),
    signature: 'update',
    entry: created.after,
    title: '原文纠错',
    content: '个人纠错内容',
    annotation: created.after.annotation,
  });
  const updated = h.events.at(-1).detail;
  history.push(updated);
  await h.remove({ entry: updated.after, requestKey: randomUUID() });
  history.push({ ...h.events.at(-1).detail, after: null });
  assert.equal(preview.store.rows.length, 0);

  loseNextRestoreReply = true;
  const unconfirmed = history.peek();
  const beforeLostReply = h.events.length;
  await h.undo(unconfirmed);
  assert.equal(preview.store.rows.length, 1, 'the server may have written before a reply is lost');
  assert.equal(
    history.peek().requestKey,
    unconfirmed.requestKey,
    'an unconfirmed mutation cannot pop the undo stack',
  );
  assert.ok(
    h.events.slice(beforeLostReply).some((event) => event.type === 'knowledge:annotation-error'),
  );
  assert.ok(
    !h.events
      .slice(beforeLostReply)
      .some((event) => event.type === 'knowledge:annotation-undo-completed'),
  );
  const unconfirmedRestoreKey = h.requests.findLast((request) => request.method === 'POST').body
    .requestKey;

  const reverse = async () => {
    const operation = history.peek();
    const beforeEvents = h.events.length;
    await h.undo(operation);
    const receipt = h.events
      .slice(beforeEvents)
      .find((event) => event.type === 'knowledge:annotation-undo-completed');
    assert.ok(receipt, JSON.stringify(h.events.slice(beforeEvents)));
    assert.equal(history.complete(receipt.detail.requestKey, receipt.detail.after), true);
    return receipt.detail;
  };
  const restored = await reverse();
  assert.notEqual(restored.after.id, created.after.id);
  assert.equal(restored.after.revision, 1);
  assert.equal(preview.store.rows[0].content, '个人纠错内容');
  const restoredRequest = h.requests.findLast((request) => request.method === 'POST');
  assert.match(restoredRequest.body.requestKey, /^[a-f0-9-]{36}$/i);
  assert.equal(
    restoredRequest.body.requestKey,
    unconfirmedRestoreKey,
    'retrying uncertain restoration uses the identical server-idempotency key',
  );
  assert.equal(preview.store.rows.length, 1, 'a retry cannot create a second restored annotation');
  const earlier = await reverse();
  assert.equal(earlier.after.id, restored.after.id);
  assert.equal(earlier.after.revision, 2);
  assert.equal(preview.store.rows[0].content, initial.content);
  await reverse();
  assert.equal(preview.store.rows.length, 0);
  assert.equal(history.peek(), null);
});

test('current-scope undo cannot forge a fresh historical anchor after the document changes', async (t) => {
  const preview = createLearningPreview();
  const baseContext = createMemoryLearningStore().context;
  let markdown = '学习预览正文';
  preview.store.context = async (slug, point) => {
    const context = await baseContext(slug, point);
    return context ? { ...context, document_markdown: markdown } : null;
  };
  const { port } = await listenAllowedLoopback(preview.server);
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const oldContext = await preview.store.context('signals', 'SS-01-01');
  const h = workspaceHarness({
    state: { node: { id: oldContext.node_id, documentVersion: documentVersion(oldContext) } },
    callApi: async (url, options) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer learning-preview-student',
        },
      });
      const payload = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(payload.message), { status: response.status });
      return payload;
    },
  });
  const initial = annotationEntry();
  initial.annotation.anchor.documentVersion = documentVersion(oldContext);
  await h.save({
    requestKey: randomUUID(),
    signature: 'historical-note',
    title: initial.title,
    content: '旧正文留下的私密批注',
    annotation: initial.annotation,
  });
  const historical = h.events.at(-1).detail.after;
  assert.ok(historical);
  markdown = '学习预览正文增加了一段新的说明';
  const currentContext = await preview.store.context('signals', 'SS-01-01');
  h.state.node.documentVersion = documentVersion(currentContext);
  assert.notEqual(historical.annotation.anchor.documentVersion, h.state.node.documentVersion);
  await h.remove({ entry: historical, requestKey: randomUUID() });
  assert.equal(preview.store.rows.length, 0);

  // Even a current-scope caller cannot relax the server's historical-anchor rule.
  const operation = { ...confirmed(historical, null), scope: h.scope() };
  const beforeUndo = h.events.length;
  await h.undo(operation);
  const receipts = h.events.slice(beforeUndo);
  assert.equal(h.requests.at(-1).method, 'POST');
  assert.match(h.requests.at(-1).body.requestKey, /^[a-f0-9-]{36}$/i);
  assert.equal(
    h.requests.at(-1).body.annotation.anchor.documentVersion,
    historical.annotation.anchor.documentVersion,
  );
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].type, 'knowledge:annotation-error');
  assert.equal(receipts[0].detail.status, 409);
  assert.equal(receipts[0].detail.undo, true);
  assert.ok(!receipts.some((event) => event.type === 'knowledge:annotation-undo-completed'));
  assert.equal(
    preview.store.rows.length,
    0,
    'no new historical or re-versioned annotation is forged',
  );
});
