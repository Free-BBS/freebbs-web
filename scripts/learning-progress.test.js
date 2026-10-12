const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scopedKey, read, write } = require('../public/learning-progress');

const PROGRESS = 'free_bbs_course_progress_v1';
const CURRENT = 'free_bbs_current_learning_node_v1';
const studentA = { isLoggedIn: true, uid: '101', token: 'token-a' };
const studentB = { isLoggedIn: true, uid: '102', token: 'token-b' };
const guest = { isLoggedIn: false, uid: '', token: '' };
function storage(initial = []) {
  const values = new Map(initial);
  const reads = [];
  const writes = [];
  return {
    values,
    reads,
    writes,
    getItem(key) {
      reads.push(key);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push(key);
      values.set(key, value);
    },
    removeItem() {
      throw new Error('This module must never delete data.');
    },
  };
}

test('student A, student B and the guest have independent namespaces for each learning key', () => {
  const local = storage();
  for (const base of [PROGRESS, CURRENT]) {
    const a = { signals: base === PROGRESS ? { 'SS-01-01': { learned: true } } : 'SS-01-01' };
    const b = { signals: base === PROGRESS ? { 'SS-01-02': { important: true } } : 'SS-01-02' };
    const anonymous = {
      signals: base === PROGRESS ? { 'SS-01-03': { consolidated: true } } : 'SS-01-03',
    };
    write(local, base, studentA, a);
    assert.deepEqual(read(local, base, studentB), {});
    assert.deepEqual(read(local, base, guest), {});
    write(local, base, studentB, b);
    write(local, base, guest, anonymous);
    assert.deepEqual(read(local, base, studentA), a);
    assert.deepEqual(read(local, base, studentB), b);
    assert.deepEqual(read(local, base, guest), anonymous);
  }
  assert.equal(local.values.size, 6);
});

test('a teacher without student identity and an ordinary student keep separate learning records', () => {
  const local = storage();
  const teacher = {
    isLoggedIn: true,
    uid: 'u_0123456789abcdef',
    role: 'teacher',
    isAdmin: false,
    studentId: null,
    email: null,
  };
  const student = {
    isLoggedIn: true,
    uid: 'u_fedcba9876543210',
    role: 'student',
    isAdmin: false,
    studentId: '2020123456',
    email: 'student@example.test',
  };
  for (const base of [PROGRESS, CURRENT]) {
    const teacherData = { signals: { 'SS-01-01': { learned: true } } };
    const studentData = { signals: { 'SS-01-02': { important: true } } };
    assert.equal(scopedKey(base, teacher), `${base}:user:${teacher.uid}`);
    assert.notEqual(scopedKey(base, teacher), scopedKey(base, student));
    write(local, base, teacher, teacherData);
    assert.deepEqual(read(local, base, student), {});
    assert.deepEqual(read(local, base, guest), {});
    write(local, base, student, studentData);
    assert.deepEqual(read(local, base, teacher), teacherData);
    assert.deepEqual(read(local, base, student), studentData);
  }
  assert.equal(local.values.size, 4);
});

test('binding a teacher student ID or verified email and rotating tokens retain the UID namespace', () => {
  const local = storage();
  const teacher = {
    isLoggedIn: true,
    uid: 'u_0123456789abcdef',
    role: 'teacher',
    isAdmin: false,
    studentId: null,
    email: null,
    token: 'initial-teacher-session',
  };
  const states = [
    { ...teacher, studentId: '2020123456' },
    {
      ...teacher,
      email: 'teacher@example.test',
      emailVerifiedAt: '2026-10-02T00:00:00.000Z',
    },
    {
      ...teacher,
      studentId: '2020123456',
      email: 'teacher@example.test',
      emailVerifiedAt: '2026-10-02T00:00:00.000Z',
      token: 'refreshed-teacher-session',
    },
  ];
  for (const base of [PROGRESS, CURRENT]) {
    const data = { signals: 'SS-01-01' };
    write(local, base, teacher, data);
    for (const state of states) {
      assert.equal(scopedKey(base, state), scopedKey(base, teacher));
      assert.deepEqual(read(local, base, state), data);
      write(local, base, state, data);
    }
  }
  assert.equal(local.values.size, 2);
});

test('token rotation cannot change a namespace and token contents are never accessed', () => {
  const local = storage();
  const data = { signals: { 'SS-01-01': { learned: true } } };
  write(local, PROGRESS, studentA, data);
  const refreshed = { ...studentA, token: 'new-token' };
  assert.equal(scopedKey(PROGRESS, refreshed), scopedKey(PROGRESS, studentA));
  assert.deepEqual(read(local, PROGRESS, refreshed), data);
  const tokenGetter = { isLoggedIn: true, uid: '101' };
  Object.defineProperty(tokenGetter, 'token', {
    get() {
      throw new Error('Token must not be read');
    },
  });
  assert.equal(scopedKey(PROGRESS, tokenGetter), scopedKey(PROGRESS, studentA));
  assert.deepEqual(read(local, PROGRESS, tokenGetter), data);
  write(local, CURRENT, tokenGetter, { signals: 'SS-01-01' });
  assert.equal(
    local.writes.some((key) => key.includes('token')),
    false,
  );
});

test('logged-in sessions without a stable valid UID fail closed and cannot fall back to guest', () => {
  const local = storage([[`${PROGRESS}:guest`, JSON.stringify({ signals: 'guest' })]]);
  for (const uid of [
    undefined,
    null,
    '',
    '   ',
    false,
    true,
    {},
    [],
    NaN,
    Infinity,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    'x'.repeat(161),
    '\uD800',
  ]) {
    const session = { isLoggedIn: true, uid, token: 'valid-looking-token' };
    assert.equal(scopedKey(PROGRESS, session), null);
    assert.deepEqual(read(local, PROGRESS, session), {});
    assert.throws(() => write(local, PROGRESS, session, { signals: 'private' }), TypeError);
  }
  assert.deepEqual(local.reads, []);
  assert.deepEqual(local.writes, []);
  assert.equal(local.values.size, 1);
});

test('guest data is separate from stale logged-out UIDs and unknown session states stay closed', () => {
  const local = storage();
  write(local, PROGRESS, guest, { signals: 'guest' });
  assert.equal(
    scopedKey(PROGRESS, { isLoggedIn: false, uid: '101', token: 'stale' }),
    `${PROGRESS}:guest`,
  );
  assert.deepEqual(read(local, PROGRESS, null), { signals: 'guest' });
  assert.deepEqual(read(local, PROGRESS), { signals: 'guest' });
  for (const session of [
    {},
    { uid: '101' },
    { isLoggedIn: 'true', uid: '101' },
    { isLoggedIn: 1, uid: '101' },
    [],
    'guest',
  ]) {
    assert.equal(scopedKey(PROGRESS, session), null);
    assert.deepEqual(read(local, PROGRESS, session), {});
    assert.throws(() => write(local, PROGRESS, session, {}), TypeError);
  }
  assert.deepEqual(read(local, PROGRESS, studentA), {});
});

test('legacy unowned global records are preserved byte-for-byte and never read or assigned', () => {
  const progress = '{ "signals": { "SS-01-01": { "learned": true } } }';
  const current = '{"signals":"SS-01-01"}';
  const local = storage([
    [PROGRESS, progress],
    [CURRENT, current],
  ]);
  for (const session of [studentA, studentB, guest, null])
    for (const base of [PROGRESS, CURRENT]) assert.deepEqual(read(local, base, session), {});
  for (const session of [studentA, studentB, guest])
    for (const base of [PROGRESS, CURRENT]) write(local, base, session, { signals: 'new' });
  assert.equal(local.values.get(PROGRESS), progress);
  assert.equal(local.values.get(CURRENT), current);
  assert.equal(local.reads.includes(PROGRESS) || local.reads.includes(CURRENT), false);
  assert.equal(local.writes.includes(PROGRESS) || local.writes.includes(CURRENT), false);
});

test('namespace encoding prevents collisions between guest and arbitrary stable user IDs', () => {
  assert.equal(scopedKey(PROGRESS, { isLoggedIn: true, uid: 101 }), scopedKey(PROGRESS, studentA));
  assert.equal(
    scopedKey(PROGRESS, { isLoggedIn: true, uid: ' 101 ' }),
    scopedKey(PROGRESS, studentA),
  );
  assert.equal(
    scopedKey(PROGRESS, { isLoggedIn: true, uid: 'u_local_admin' }),
    `${PROGRESS}:user:u_local_admin`,
  );
  assert.notEqual(
    scopedKey(PROGRESS, { isLoggedIn: true, uid: 'guest' }),
    scopedKey(PROGRESS, guest),
  );
  assert.notEqual(
    scopedKey(PROGRESS, { isLoggedIn: true, uid: 'a:b' }),
    scopedKey(PROGRESS, { isLoggedIn: true, uid: 'a%3Ab' }),
  );
  assert.equal(scopedKey(PROGRESS, { isLoggedIn: true, uid: 'a:b' }), `${PROGRESS}:user:a%3Ab`);
  for (const base of [null, undefined, '', ' ', 4, {}, 'x'.repeat(201)])
    assert.equal(scopedKey(base, studentA), null);
});

test('malformed JSON, nonobject values and unavailable storage safely read as fresh empty objects', () => {
  for (const raw of [null, '', '{bad', 'null', '[]', '[1]', 'false', 'true', '4', '"text"']) {
    const local = storage([[scopedKey(PROGRESS, studentA), raw]]);
    assert.deepEqual(read(local, PROGRESS, studentA), {});
  }
  for (const local of [
    null,
    undefined,
    {},
    { getItem: 4 },
    {
      getItem() {
        throw new Error('blocked storage');
      },
    },
  ])
    assert.deepEqual(read(local, PROGRESS, studentA), {});
  const first = read(storage(), PROGRESS, studentA);
  first.signals = 'local mutation';
  assert.deepEqual(read(storage(), PROGRESS, studentA), {});
});

test('storage and serialization failures are reported to the caller without mutating old records', () => {
  const failure = new Error('quota exceeded');
  const local = storage([[PROGRESS, 'legacy']]);
  local.setItem = () => {
    throw failure;
  };
  assert.throws(
    () => write(local, PROGRESS, studentA, { signals: 'new' }),
    (error) => error === failure,
  );
  assert.equal(local.values.get(PROGRESS), 'legacy');
  const circle = {};
  circle.self = circle;
  for (const data of [
    null,
    undefined,
    [],
    'string',
    1,
    new Date(),
    new Map(),
    circle,
    { number: 1n },
    {
      toJSON() {
        return [];
      },
    },
  ])
    assert.throws(() => write(local, PROGRESS, studentA, data), TypeError);
  for (const missing of [null, {}, { setItem: true }])
    assert.throws(() => write(missing, PROGRESS, studentA, {}), TypeError);
});

test('read/write preserves the JSON dictionary and caller objects are not modified', () => {
  const local = storage();
  const data = {
    signals: { 'SS-01-01': { learned: true, important: false, consolidated: false } },
    other: {},
  };
  const snapshot = JSON.stringify(data);
  assert.equal(write(local, PROGRESS, studentA, data), data);
  assert.equal(JSON.stringify(data), snapshot);
  const loaded = read(local, PROGRESS, studentA);
  assert.deepEqual(loaded, data);
  loaded.signals['SS-01-01'].learned = false;
  assert.equal(read(local, PROGRESS, studentA).signals['SS-01-01'].learned, true);
});

test('standalone browser export needs no DOM, authentication API or global storage access', () => {
  const context = {};
  for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch'])
    Object.defineProperty(context, key, {
      get() {
        throw new Error(`Global ${key} must not be read`);
      },
    });
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-progress.js'), 'utf8'),
    context,
  );
  const api = context.FreeBbsLearningProgress;
  assert.equal(typeof api.write, 'function');
  const local = storage();
  api.write(local, PROGRESS, studentA, { signals: 'SS-01-01' });
  assert.equal(api.read(local, PROGRESS, studentA).signals, 'SS-01-01');
  assert.equal(Object.keys(api.read(local, PROGRESS, studentB)).length, 0);
  assert.equal(Object.keys(api.read(local, PROGRESS, guest)).length, 0);
});
