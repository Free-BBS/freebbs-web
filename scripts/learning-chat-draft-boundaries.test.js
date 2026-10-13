// Independent pure-store negative boundary tests, not production or browser evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createDraftStore,
  contextKey,
  safeDraft,
  MAX_AGE,
  MAX_ENTRIES,
} = require('../public/learning-chat-drafts');

const BASE = 'free_bbs_learning_chat_drafts_v1';
const digest = async (value) => crypto.createHash('sha256').update(value).digest('hex');
const context = (patch = {}) => ({
  courseSlug: 'signals',
  nodeId: 'SS-01-01',
  documentVersion: 'a'.repeat(64),
  originDocumentVersion: 'b'.repeat(64),
  ...patch,
});
function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('a same-session fresh store restores exact own text without serializing UID/token', async () => {
  const memory = storage();
  const first = createDraftStore({ storage: memory, digest });
  assert.equal(await first.bind('u_personA', 'private-session-tokenA'), true);
  assert.equal(first.save(context(), { text: '  我写了一半的问题。\n' }), true);
  const next = createDraftStore({ storage: memory, digest });
  assert.equal(await next.bind('u_personA', 'private-session-tokenA'), true);
  assert.deepEqual(next.read(context()), { text: '  我写了一半的问题。\n' });
  const serialized = JSON.stringify([...memory.values]);
  assert.doesNotMatch(serialized, /u_personA|private-session-tokenA/);
});

test('course, point, body version and origin version each isolate a draft', async () => {
  const store = createDraftStore({ storage: storage(), digest });
  await store.bind('u_A', 'tokenA');
  store.save(context(), { text: '只属于当前上下文。' });
  for (const patch of [
    { courseSlug: 'circuits' },
    { nodeId: 'SS-01-02' },
    { documentVersion: 'c'.repeat(64) },
    { originDocumentVersion: 'd'.repeat(64) },
  ])
    assert.equal(store.read(context(patch)), null);
  assert.deepEqual(store.read(context()), { text: '只属于当前上下文。' });
});

test('switching a user removes the old owner namespace and cannot read their text', async () => {
  const memory = storage();
  const store = createDraftStore({ storage: memory, digest });
  await store.bind('u_A', 'tokenA');
  store.save(context(), { text: 'A 的私人问题。' });
  const oldOwner = memory.getItem(`${BASE}:owner`);
  await store.bind('u_B', 'tokenB');
  assert.equal(memory.getItem(`${BASE}:${oldOwner}`), null);
  assert.equal(store.read(context()), null);
  store.save(context(), { text: 'B 的私人问题。' });
  await store.bind('u_A', 'tokenA');
  assert.equal(store.read(context()), null);
});

test('a different token for the same UID is a new private session', async () => {
  const memory = storage();
  const store = createDraftStore({ storage: memory, digest });
  await store.bind('u_A', 'oldToken');
  store.save(context(), { text: '旧登录的私人问题。' });
  const oldOwner = memory.getItem(`${BASE}:owner`);
  await store.bind('u_A', 'newToken');
  assert.equal(store.read(context()), null);
  assert.equal(memory.getItem(`${BASE}:${oldOwner}`), null);
});

test('a late owner digest never rebinds a newer session', async () => {
  const waits = [];
  const memory = storage();
  const store = createDraftStore({
    storage: memory,
    digest: (value) =>
      new Promise((resolve) => {
        waits.push({ value, resolve });
      }),
  });
  const old = store.bind('u_A', 'tokenA');
  const newer = store.bind('u_B', 'tokenB');
  waits[1].resolve(await digest(waits[1].value));
  assert.equal(await newer, true);
  assert.equal(store.save(context(), { text: 'B 的新稿。' }), true);
  waits[0].resolve(await digest(waits[0].value));
  assert.equal(await old, false);
  assert.deepEqual(store.read(context()), { text: 'B 的新稿。' });
  assert.equal(memory.getItem(`${BASE}:owner`), await digest(JSON.stringify(['u_B', 'tokenB'])));
});

test('clearing while the owner digest is pending prevents restoration', async () => {
  let finish;
  const memory = storage();
  const store = createDraftStore({
    storage: memory,
    digest: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = store.bind('u_A', 'tokenA');
  store.clear();
  finish('e'.repeat(64));
  assert.equal(await pending, false);
  assert.equal(store.read(context()), null);
  assert.equal(memory.values.size, 0);
});

test('TTL expires at 24 hours and future timestamps are never restored', async () => {
  let now = 100;
  const memory = storage();
  const store = createDraftStore({ storage: memory, digest, now: () => now });
  await store.bind('u_A', 'tokenA');
  store.save(context(), { text: '一天内暂存。' });
  now = 100 + MAX_AGE - 1;
  assert.ok(store.read(context()));
  now += 1;
  assert.equal(store.read(context()), null);
  const owner = memory.getItem(`${BASE}:owner`);
  memory.setItem(
    `${BASE}:${owner}`,
    JSON.stringify({
      schemaVersion: 1,
      entries: { [contextKey(context())]: { text: '来自未来的非法时钟稿。', savedAt: now + 1 } },
    }),
  );
  assert.equal(store.read(context()), null);
});

test('saving more than 32 points evicts oldest drafts and keeps newest', async () => {
  let now = 0;
  const memory = storage();
  const store = createDraftStore({ storage: memory, digest, now: () => now });
  await store.bind('u_A', 'tokenA');
  for (let index = 1; index <= MAX_ENTRIES + 3; index += 1) {
    now = index;
    assert.equal(
      store.save(context({ nodeId: `SS-01-${String(index).padStart(2, '0')}` }), {
        text: `第 ${index} 个点。`,
      }),
      true,
    );
  }
  assert.equal(store.read(context({ nodeId: 'SS-01-01' })), null);
  assert.equal(store.read(context({ nodeId: 'SS-01-03' })), null);
  assert.deepEqual(store.read(context({ nodeId: 'SS-01-35' })), { text: '第 35 个点。' });
  const owner = memory.getItem(`${BASE}:owner`);
  assert.equal(Object.keys(JSON.parse(memory.getItem(`${BASE}:${owner}`)).entries).length, 32);
});

test('empty questions delete a saved draft; invalid or oversized text is never restored', async () => {
  const store = createDraftStore({ storage: storage(), digest });
  await store.bind('u_A', 'tokenA');
  assert.equal(safeDraft({ text: '字'.repeat(4000) }).text.length, 4000);
  assert.equal(safeDraft({ text: '字'.repeat(4001) }), null);
  assert.equal(safeDraft({ text: '   ' }), null);
  assert.equal(safeDraft({ text: 123 }), null);
  store.save(context(), { text: '已有草稿。' });
  store.save(context(), { text: '' });
  assert.equal(store.read(context()), null);
});

test('invalid contexts never save or read even with an authenticated owner', async () => {
  const store = createDraftStore({ storage: storage(), digest });
  await store.bind('u_A', 'tokenA');
  for (const patch of [
    { courseSlug: '../other' },
    { nodeId: 'bad' },
    { documentVersion: 'current' },
    { originDocumentVersion: 'bad' },
  ]) {
    assert.equal(contextKey(context(patch)), null);
    assert.equal(store.save(context(patch), { text: '不可写入。' }), false);
    assert.equal(store.read(context(patch)), null);
  }
});

test('read-only/quota failures return false instead of throwing or exposing saved content', async () => {
  const memory = storage();
  const originalWrite = memory.setItem;
  const store = createDraftStore({ storage: memory, digest });
  await store.bind('u_A', 'tokenA');
  store.save(context(), { text: '故障前已暂存。' });
  memory.setItem = () => {
    throw new Error('explicit quota fixture');
  };
  assert.equal(store.save(context(), { text: '故障时新稿。' }), false);
  assert.equal(store.read(context()), null);
  memory.setItem = originalWrite;
  // Availability is deliberately not silently revived in the same failed store.
  assert.equal(await store.bind('u_A', 'tokenA'), false);
});

test('clear removes the bound namespace and invalidates later reads', async () => {
  const memory = storage();
  const store = createDraftStore({ storage: memory, digest });
  await store.bind('u_A', 'tokenA');
  store.save(context(), { text: '退出前稿。' });
  store.clear();
  assert.equal(store.read(context()), null);
  assert.equal(memory.values.size, 0);
});
