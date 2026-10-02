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
  const window = {
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
