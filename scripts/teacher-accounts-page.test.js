const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function field(value = '') {
  return {
    value,
    disabled: false,
    listeners: {},
    reportValidity: () => true,
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
}

async function fixture(callApi) {
  const email = {
    elements: { email: field(), currentPassword: field(), emailCode: field() },
    listeners: {},
    reset() {
      Object.values(this.elements).forEach((input) => {
        input.value = '';
      });
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  };
  const student = {
    elements: { studentId: field(), currentPassword: field() },
    listeners: {},
    reset() {
      Object.values(this.elements).forEach((input) => {
        input.value = '';
      });
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  };
  const status = { textContent: '' };
  const emailMessage = { textContent: '' };
  const studentMessage = { textContent: '' };
  const send = field();
  const root = {
    querySelector: (selector) =>
      ({
        '#settings-email-form': email,
        '#settings-student-form': student,
        '#settings-identity-status': status,
        '#settings-email-message': emailMessage,
        '#settings-student-message': studentMessage,
        '#settings-email-code': send,
      })[selector],
    querySelectorAll: () => [
      ...Object.values(email.elements),
      ...Object.values(student.elements),
      send,
    ],
  };
  const events = {};
  const dispatched = [];
  const userState = { uid: 'u_teacher', token: 'token_one', isLoggedIn: true };
  const stored = new Map([['free_bbs_auth_token', userState.token]]);
  const window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    },
    freeBbsApp: { userState, callApi, sessionReady: Promise.resolve() },
    addEventListener(name, callback) {
      events[name] = callback;
    },
    dispatchEvent(event) {
      dispatched.push(event);
      events[event.type]?.(event);
    },
    clearInterval() {},
    setInterval() {
      return 1;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/account-identity.js'), 'utf8'),
    {
      window,
      document: { getElementById: () => root },
      Date,
      Promise,
      CustomEvent: function FixtureEvent(type, options) {
        this.type = type;
        this.detail = options.detail;
      },
      FormData: class {
        constructor(form) {
          this.entries = Object.entries(form.elements)
            .filter(([, input]) => !input.disabled)
            .map(([name, input]) => [name, input.value]);
        }

        [Symbol.iterator]() {
          return this.entries[Symbol.iterator]();
        }
      },
    },
  );
  await settle();
  return {
    email,
    student,
    send,
    status,
    emailMessage,
    studentMessage,
    events,
    dispatched,
    userState,
    window,
  };
}

test('email and student submissions capture the real form values before busy state disables inputs', async () => {
  const requests = [];
  const f = await fixture(async (route, options) => {
    if (!options) return { email: '', emailVerified: false, studentId: '', studentRequest: null };
    requests.push({ route, body: JSON.parse(options.body) });
    return { message: '已提交', user: { uid: 'u_teacher', email: 'teacher@example.test' } };
  });
  f.email.elements.email.value = 'teacher@example.test';
  f.email.elements.currentPassword.value = 'actual-current-password';
  f.email.elements.emailCode.value = '246810';
  f.email.listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(requests[0], {
    route: '/profile/email',
    body: {
      email: 'teacher@example.test',
      currentPassword: 'actual-current-password',
      emailCode: '246810',
    },
  });
  assert.equal(f.email.elements.currentPassword.value, '');
  assert.equal(f.email.elements.emailCode.value, '');
  assert.equal(f.dispatched[0].type, 'freebbs:identity-updated');
  f.student.elements.studentId.value = '2026000001';
  f.student.elements.currentPassword.value = 'actual-current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(requests[1], {
    route: '/profile/student-id',
    body: { studentId: '2026000001', currentPassword: 'actual-current-password' },
  });
  assert.equal(f.student.elements.currentPassword.value, '');
  assert.equal(
    f.dispatched.length,
    1,
    'legacy/pending student responses must not replace the session',
  );
});

test('logout clears passwords and ignores a late email binding response from the previous account', async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = await fixture(async (_route, options) =>
    options ? pending : { email: '', studentId: '' },
  );
  f.email.elements.email.value = 'teacher@example.test';
  f.email.elements.currentPassword.value = 'sensitive-password';
  f.email.elements.emailCode.value = '246810';
  f.email.listeners.submit({ preventDefault() {} });
  f.userState.isLoggedIn = false;
  f.userState.token = '';
  f.events['freebbs:session-change']();
  complete({ message: '已绑定', user: { uid: 'u_teacher' } });
  await settle();
  assert.equal(f.email.elements.currentPassword.value, '');
  assert.equal(f.email.elements.emailCode.value, '');
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.emailMessage.textContent, '');
  assert.match(f.status.textContent, /请登录/);
  assert.equal(f.send.disabled, true);
});

test('pending student identities remain labelled as awaiting verification rather than bound', async () => {
  const f = await fixture(async () => ({
    email: '',
    studentId: '',
    studentRequest: { studentId: '2026000001', status: 'pending' },
  }));
  assert.match(f.status.textContent, /学号：未绑定/);
  assert.match(f.status.textContent, /等待管理员核验/);
});

test('a cross-tab auth change clears credentials and blocks stale responses until this page refreshes its session', async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = await fixture(async (_route, options) =>
    options ? pending : { email: '', studentId: '' },
  );
  f.email.elements.email.value = 'teacher@example.test';
  f.email.elements.currentPassword.value = 'sensitive-password';
  f.email.elements.emailCode.value = '246810';
  f.email.listeners.submit({ preventDefault() {} });
  f.events.storage({ key: 'free_bbs_auth_token' });
  complete({ message: '已绑定', user: { uid: 'u_teacher' } });
  await settle();
  assert.equal(f.email.elements.currentPassword.value, '');
  assert.equal(f.email.elements.emailCode.value, '');
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.send.disabled, true);
  f.events['freebbs:session-change']();
  await settle();
  assert.equal(f.send.disabled, false);
});

test('a matched whitelist student request updates the current identity once and reloads the bound status', async () => {
  let bound = false;
  const f = await fixture(async (_route, options) => {
    if (!options)
      return {
        email: 'student@tsinghua.edu.cn',
        emailVerified: true,
        studentId: bound ? '2026010001' : '',
      };
    bound = true;
    return {
      status: 'bound',
      message: '学号已绑定',
      user: { uid: 'u_teacher', studentId: '2026010001' },
    };
  });
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].type, 'freebbs:identity-updated');
  assert.equal(f.dispatched[0].detail.status, 'bound');
  assert.equal(f.student.elements.currentPassword.value, '');
  assert.match(f.status.textContent, /学号：2026010001/);
  assert.doesNotMatch(f.status.textContent, /等待管理员核验/);
  assert.equal(f.studentMessage.textContent, '学号已绑定');
});

test('a pending student request never dispatches an identity update even if an unexpected user is present', async () => {
  let requested = false;
  const f = await fixture(async (_route, options) => {
    if (!options)
      return {
        email: '',
        studentId: '',
        studentRequest: requested ? { status: 'pending', studentId: '2026010001' } : null,
      };
    requested = true;
    return {
      status: 'pending',
      message: '等待管理员核验',
      user: { uid: 'u_teacher', studentId: '2026010001' },
    };
  });
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(f.dispatched.length, 0);
  assert.match(f.status.textContent, /学号：未绑定/);
  assert.match(f.status.textContent, /等待管理员核验/);
  assert.equal(f.student.elements.currentPassword.value, '');
});

test('verifying the matching email completes a prior pending student request with one fresh identity event', async () => {
  let requested = false;
  let bound = false;
  const requests = [];
  const freshUser = { uid: 'u_teacher', email: 'student@tsinghua.edu.cn', studentId: '2026010001' };
  const f = await fixture(async (route, options) => {
    if (!options)
      return {
        email: bound ? freshUser.email : '',
        emailVerified: bound,
        studentId: bound ? freshUser.studentId : '',
        studentRequest:
          requested && !bound ? { status: 'pending', studentId: freshUser.studentId } : null,
      };
    requests.push({ route, body: JSON.parse(options.body) });
    if (route === '/profile/student-id') {
      requested = true;
      return { status: 'pending', message: '等待管理员核验' };
    }
    if (route === '/profile/email-code') return { message: '验证码已发送' };
    bound = true;
    return { message: '邮箱与学号已绑定', user: freshUser, studentBinding: { status: 'bound' } };
  });
  f.student.elements.studentId.value = freshUser.studentId;
  f.student.elements.currentPassword.value = 'current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(f.dispatched.length, 0);
  f.email.elements.email.value = freshUser.email;
  f.email.elements.currentPassword.value = 'current-password';
  f.send.listeners.click();
  await settle();
  assert.equal(f.send.disabled, true);
  assert.match(f.send.textContent, /秒后重发/);
  f.email.elements.emailCode.value = '246810';
  f.email.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(requests[1].route, '/profile/email-code');
  assert.equal(requests[1].body.currentPassword, 'current-password');
  assert.equal(requests[2].body.emailCode, '246810');
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].detail.user.studentId, freshUser.studentId);
  assert.equal(f.dispatched[0].detail.studentBinding.status, 'bound');
  assert.equal(f.email.elements.currentPassword.value, '');
  assert.equal(f.email.elements.emailCode.value, '');
  assert.match(f.status.textContent, /学号：2026010001/);
  assert.doesNotMatch(f.status.textContent, /等待管理员核验/);
});

test('a student binding result cannot update a different or missing user session', async () => {
  for (const user of [undefined, { uid: 'another-account', studentId: '2026010001' }]) {
    const f = await fixture(async (_route, options) =>
      options ? { status: 'bound', message: '已绑定', user } : { email: '', studentId: '' },
    );
    f.student.elements.studentId.value = '2026010001';
    f.student.elements.currentPassword.value = 'current-password';
    f.student.listeners.submit({ preventDefault() {} });
    await settle();
    assert.equal(f.dispatched.length, 0);
    assert.equal(f.student.elements.currentPassword.value, '');
  }
});

test('a late student binding response after changing accounts cannot clear the new account draft', async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = await fixture(async (_route, options) =>
    options ? pending : { email: '', studentId: '' },
  );
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'old-password';
  f.student.listeners.submit({ preventDefault() {} });
  Object.assign(f.userState, { uid: 'new-account', token: 'new-token' });
  f.window.localStorage.setItem('free_bbs_auth_token', 'new-token');
  f.events['freebbs:session-change']();
  await settle();
  f.student.elements.studentId.value = '2026210002';
  f.student.elements.currentPassword.value = 'new-password';
  complete({
    status: 'bound',
    message: '已绑定',
    user: { uid: 'u_teacher', studentId: '2026010001' },
  });
  await settle();
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.student.elements.studentId.value, '2026210002');
  assert.equal(f.student.elements.currentPassword.value, 'new-password');
  assert.equal(f.studentMessage.textContent, '');
  assert.equal(f.send.disabled, false);
});

test('a failed student request preserves the draft and permits an explicit retry', async () => {
  let attempts = 0;
  const f = await fixture(async (_route, options) => {
    if (!options) return { email: '', studentId: '' };
    attempts += 1;
    if (attempts === 1) throw new Error('暂时无法提交，请重试');
    return { status: 'pending', message: '等待管理员核验' };
  });
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.match(f.studentMessage.textContent, /请重试/);
  assert.equal(f.student.elements.studentId.value, '2026010001');
  assert.equal(f.student.elements.currentPassword.value, 'current-password');
  assert.equal(f.student.elements.studentId.disabled, false);
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(attempts, 2);
  assert.equal(f.student.elements.currentPassword.value, '');
  assert.equal(f.dispatched.length, 0);
});

test('BFCache restoration of the same session invalidates old writes and reloads only current identity', async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = await fixture(async (_route, options) =>
    options ? pending : { email: '', studentId: '' },
  );
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'old-password';
  f.student.listeners.submit({ preventDefault() {} });
  f.events.pagehide();
  assert.equal(f.student.elements.currentPassword.value, '');
  assert.equal(f.send.disabled, true);
  f.events.pageshow({ persisted: true });
  await settle();
  assert.equal(f.send.disabled, false);
  f.student.elements.currentPassword.value = 'new-draft-password';
  complete({
    status: 'bound',
    message: '已绑定',
    user: { uid: 'u_teacher', studentId: '2026010001' },
  });
  await settle();
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.student.elements.currentPassword.value, 'new-draft-password');
  assert.equal(f.studentMessage.textContent, '');
});

test('BFCache cannot restore an account whose stored token changed, disappeared, or is unreadable', async () => {
  for (const tokenState of ['changed', 'removed', 'unreadable']) {
    let reads = 0;
    const f = await fixture(async () => {
      reads += 1;
      return { email: '', studentId: '' };
    });
    f.events.pagehide();
    if (tokenState === 'changed')
      f.window.localStorage.setItem('free_bbs_auth_token', 'another-token');
    if (tokenState === 'removed') f.window.localStorage.removeItem('free_bbs_auth_token');
    if (tokenState === 'unreadable')
      f.window.localStorage.getItem = () => {
        throw new Error('storage disabled');
      };
    f.events.pageshow({ persisted: true });
    await settle();
    assert.equal(reads, 1);
    assert.equal(f.send.disabled, true);
    assert.match(f.status.textContent, /请登录/);
    assert.equal(f.dispatched.length, 0);
  }
});

test('an older identity read cannot overwrite the read following a successful binding', async () => {
  let finishInitialRead;
  let reads = 0;
  const firstRead = new Promise((resolve) => {
    finishInitialRead = resolve;
  });
  const f = await fixture(async (_route, options) => {
    if (!options) {
      reads += 1;
      return reads === 1 ? firstRead : { email: '', studentId: '2026010001' };
    }
    return {
      status: 'bound',
      message: '已绑定',
      user: { uid: 'u_teacher', studentId: '2026010001' },
    };
  });
  f.student.elements.studentId.value = '2026010001';
  f.student.elements.currentPassword.value = 'current-password';
  f.student.listeners.submit({ preventDefault() {} });
  await settle();
  assert.match(f.status.textContent, /学号：2026010001/);
  finishInitialRead({ email: 'stale@tsinghua.edu.cn', studentId: '' });
  await settle();
  assert.match(f.status.textContent, /学号：2026010001/);
  assert.doesNotMatch(f.status.textContent, /stale/);
  assert.equal(f.email.elements.email.value, '');
});
