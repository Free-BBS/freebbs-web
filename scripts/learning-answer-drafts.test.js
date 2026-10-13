const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDraftStore, contextKey, MAX_AGE } = require('../public/learning-answer-drafts');

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const context = (overrides = {}) => ({
  courseSlug: 'signals',
  nodeId: 'SS-01-01',
  documentVersion: 'd'.repeat(64),
  questionVersion: '1',
  questionId: 'Q1',
  mode: 'selftest',
  ...overrides,
});

test('browser Web Crypto hashes the owner without storing raw authentication secrets', async () => {
  const saved = storage();
  const store = createDraftStore({ storage: saved, crypto: crypto.webcrypto });
  assert.equal(await store.bind('student-uid', 'private-session-token'), true);
  assert.equal(store.save(context(), { answer: 'THOUGHTS' }), true);
  const reopened = createDraftStore({ storage: saved, crypto: crypto.webcrypto });
  assert.equal(await reopened.bind('student-uid', 'private-session-token'), true);
  assert.equal(reopened.read(context()).answer, 'THOUGHTS');
  assert.doesNotMatch(
    JSON.stringify([...saved.values.entries()]),
    /student-uid|private-session-token/,
  );
});

test('same authenticated session restores only unsubmitted answers and frozen retry identity', async () => {
  const saved = storage();
  const first = createDraftStore({ storage: saved, digest });
  await first.bind('student-uid', 'private-session-token');
  const value = {
    answer: ['A', 'C'],
    requestKey: crypto.randomUUID(),
    supersedesAttemptId: '42',
    score: 100,
    verdict: 'pass',
    referenceMarkdown: 'ANSWER KEY',
  };
  assert.equal(first.save(context(), value), true);
  const reopened = createDraftStore({ storage: saved, digest });
  await reopened.bind('student-uid', 'private-session-token');
  assert.deepEqual(reopened.read(context()), {
    answer: ['A', 'C'],
    requestKey: value.requestKey,
    supersedesAttemptId: '42',
  });
  const serialized = JSON.stringify([...saved.values.entries()]);
  assert.doesNotMatch(serialized, /private-session-token|student-uid|score|verdict|ANSWER KEY/);
  const received = reopened.read(context());
  received.answer.push('B');
  assert.deepEqual(reopened.read(context()).answer, ['A', 'C']);
  reopened.remove(context());
  assert.equal(first.read(context()), null);
});

test('course, point, document, question version, identity and mode all isolate restoration', async () => {
  const saved = storage();
  const first = createDraftStore({ storage: saved, digest });
  await first.bind('student', 'session-one');
  first.save(context(), { answer: 'PRIVATE THOUGHTS' });
  for (const changed of [
    { courseSlug: 'math' },
    { nodeId: 'SS-01-02' },
    { documentVersion: 'e'.repeat(64) },
    { questionVersion: '2' },
    { questionId: 'Q2' },
    { mode: 'practice' },
  ])
    assert.equal(first.read(context(changed)), null);
  const anotherSession = createDraftStore({ storage: saved, digest });
  await anotherSession.bind('student', 'session-two');
  assert.equal(anotherSession.read(context()), null);
  assert.doesNotMatch(JSON.stringify([...saved.values.values()]), /PRIVATE THOUGHTS/);
  anotherSession.save(context(), { answer: 'SECOND PRIVATE THOUGHTS' });
  const anotherUser = createDraftStore({ storage: saved, digest });
  await anotherUser.bind('other-student', 'session-two');
  assert.equal(anotherUser.read(context()), null);
  assert.doesNotMatch(JSON.stringify([...saved.values.values()]), /SECOND PRIVATE THOUGHTS/);
});

test('drafts expire at 24 hours and expired or future-dated values are removed', async () => {
  const saved = storage();
  let clock = 100000;
  const store = createDraftStore({ storage: saved, digest, now: () => clock });
  await store.bind('student', 'session');
  store.save(context(), { answer: 'THOUGHTS' });
  clock += MAX_AGE - 1;
  assert.equal(store.read(context()).answer, 'THOUGHTS');
  clock += 1;
  assert.equal(store.read(context()), null);
  assert.doesNotMatch(JSON.stringify([...saved.values.values()]), /THOUGHTS/);
  store.save(context(), { answer: 'FUTURE' });
  clock -= 1;
  assert.equal(store.read(context()), null);
});

test('clearing a session invalidates a pending owner hash before it can restore or write', async () => {
  const saved = storage();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const store = createDraftStore({ storage: saved, digest: () => pending });
  const binding = store.bind('old-user', 'old-token');
  store.clear();
  finish('a'.repeat(64));
  assert.equal(await binding, false);
  assert.equal(store.save(context(), { answer: 'OLD PRIVATE ANSWER' }), false);
  assert.equal(saved.values.size, 0);
});

test('restricted storage, missing crypto, failed hashing and malformed data safely fall back', async () => {
  const unavailable = createDraftStore({ storage: storage() });
  assert.equal(await unavailable.bind('student', 'session'), false);
  assert.equal(unavailable.read(context()), null);
  const failedHash = createDraftStore({
    storage: storage(),
    digest: async () => {
      throw new Error('crypto unavailable');
    },
  });
  assert.equal(await failedHash.bind('student', 'session'), false);
  const blocked = createDraftStore({
    storage: {
      getItem() {
        throw new Error('storage blocked');
      },
    },
    digest,
  });
  assert.equal(await blocked.bind('student', 'session'), false);
  assert.equal(blocked.save(context(), { answer: 'answer' }), false);
  const saved = storage();
  const store = createDraftStore({ storage: saved, digest });
  await store.bind('student', 'session');
  store.save(context(), { answer: 'answer' });
  const key = [...saved.values.keys()].find((value) => !value.endsWith(':owner'));
  saved.setItem(key, 'not json');
  assert.equal(store.read(context()), null);
});

test('untrusted values cannot store grades, malformed answers or unsupported version contexts', async () => {
  const saved = storage();
  const store = createDraftStore({ storage: saved, digest });
  await store.bind('student', 'session');
  for (const value of [
    { answer: '', score: 1 },
    { answer: 'x'.repeat(8001) },
    { answer: { A: true } },
    { answer: [] },
    { answer: ['A'], requestKey: 'forged' },
    { answer: 'x', requestKey: crypto.randomUUID(), supersedesAttemptId: 'someone-else' },
  ]) {
    store.save(context(), value);
    assert.equal(store.read(context()), null);
  }
  assert.equal(contextKey(context({ documentVersion: 'unloaded' })), null);
  assert.equal(store.save(context({ mode: 'exam' }), { answer: 'x' }), false);
});

test('session storage remains bounded and retains the most recently edited question', async () => {
  const saved = storage();
  const store = createDraftStore({ storage: saved, digest, now: () => 1000 });
  await store.bind('student', 'session');
  for (let index = 0; index < 140; index += 1)
    store.save(context({ questionId: `Q${index}` }), { answer: `answer ${index}` });
  assert.equal(store.read(context({ questionId: 'Q139' })).answer, 'answer 139');
  const key = [...saved.values.keys()].find((value) => !value.endsWith(':owner'));
  assert.equal(Object.keys(JSON.parse(saved.getItem(key)).entries).length, 128);
});
