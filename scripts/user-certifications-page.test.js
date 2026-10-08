const assert = require('node:assert/strict');
const test = require('node:test');
const { installUserCertifications } = require('../public/user-certifications');
const { installAdminCertifications } = require('../public/admin-certifications');

// A small DOM fixture for controller behavior; full browser layout is checked separately.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.text = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.valid = true;
    this.classList = { contains: (name) => this.className.split(' ').includes(name) };
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join(' ');
  }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parent = this;
      this.children.push(node);
    });
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[data-')) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, key);
    }
    return this.tagName === selector;
  }

  querySelectorAll(selector) {
    const choices = selector.split(',');
    return this.children.flatMap((node) => [
      ...(choices.some((choice) => node.matches(choice)) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    return this.matches(selector) ? this : this.parent?.closest(selector) || null;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = value;
    } else this[name] = value;
  }

  reportValidity() {
    return this.valid;
  }

  reset() {
    this.querySelectorAll('input,select').forEach((node) => {
      node.value = node.defaultValue || '';
    });
  }
}

const defer = () => {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
async function settle() {
  for (let i = 0; i < 4; i += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
}
const education = (extra = {}) => ({
  type: 'education',
  education: 'undergraduate',
  year: 2021,
  institution: '清华大学电子系',
  className: '无11',
  ...extra,
});

async function fixture(kind, callApi, state = {}) {
  const root = new Element();
  root.className = `${kind}-certifications`;
  root.hidden = kind === 'admin';
  const ids =
    kind === 'user'
      ? [
          'status',
          'refresh',
          'signin',
          'approved',
          'form',
          'kind',
          'education-fields',
          'institution',
          'year',
          'year-label',
          'class',
          'company-fields',
          'company',
          'slot-status',
          'message',
          'submit',
          'requests',
          'suggestion',
          'suggestion-copy',
          'use-suggestion',
        ]
      : ['pending', 'filter', 'refresh', 'status', 'list', 'prev', 'next', 'page'];
  const inputs = new Set(['institution', 'year', 'class', 'company']);
  const buttons = new Set(['refresh', 'submit', 'use-suggestion', 'prev', 'next']);
  const el = Object.fromEntries(
    ids.map((id) => [
      id,
      new Element(
        inputs.has(id)
          ? 'input'
          : buttons.has(id)
            ? 'button'
            : ['kind', 'filter'].includes(id)
              ? 'select'
              : id === 'form'
                ? 'form'
                : 'div',
      ),
    ]),
  );
  if (kind === 'user') {
    el.kind.value = 'undergraduate';
    el.kind.defaultValue = 'undergraduate';
    el.form.append(el.kind, el['education-fields'], el['company-fields'], el.submit);
    el['education-fields'].append(el.institution, el.year, el.class);
    el['company-fields'].append(el.company);
    root.append(
      ...ids
        .filter(
          (id) =>
            ![
              'kind',
              'education-fields',
              'institution',
              'year',
              'class',
              'company-fields',
              'company',
              'submit',
            ].includes(id),
        )
        .map((id) => el[id]),
    );
  } else {
    el.filter.value = 'pending';
    root.append(...Object.values(el));
  }
  const events = {};
  const dispatched = [];
  const userState = {
    uid: 'student_uid',
    token: 'student_token',
    isLoggedIn: true,
    role: 'student',
    ...state,
  };
  const app = { userState, callApi, sessionReady: Promise.resolve() };
  const host = {
    CustomEvent: function FixtureEvent(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
    addEventListener(type, callback) {
      events[type] = callback;
    },
    dispatchEvent(event) {
      dispatched.push(event);
      events[event.type]?.(event);
    },
  };
  const doc = {
    createElement: (tag) => new Element(tag),
    querySelector: () => null,
    getElementById: (id) =>
      id === 'certifications'
        ? root
        : el[id.replace(kind === 'user' ? 'certification-' : 'admin-certification-', '')],
  };
  (kind === 'user' ? installUserCertifications : installAdminCertifications)({
    document: doc,
    window: host,
    app,
  });
  await settle();
  return { root, el, events, dispatched, userState };
}

test('bound student suggestion prefills editable fields; only approved identities appear verified', async () => {
  const f = await fixture('user', async () => ({
    approved: [education(), education({ status: 'pending', education: 'doctor' })],
    requests: [
      education({ status: 'pending', education: 'master' }),
      education({ status: 'rejected', education: 'doctor', reviewNote: '<script>bad()</script>' }),
    ],
    suggestion: education({ year: 2025, className: '' }),
  }));
  assert.equal(f.el.year.value, 2025);
  assert.equal(f.el.institution.disabled, false);
  assert.equal(f.el.approved.children.length, 1);
  assert.equal(f.el.requests.children.length, 2);
  assert.match(f.el.requests.textContent, /等待审核/);
  assert.match(f.el.requests.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(f.el.requests.querySelectorAll('script').length, 0);
  f.el.kind.value = 'master';
  f.el.kind.listeners.change();
  assert.equal(f.el.submit.disabled, true);
  assert.equal(f.el.kind.disabled, false);
  assert.equal(f.el.year.disabled, true);
});

test('education edits submit exact values and keep the previous approved identity while pending', async () => {
  const posts = [];
  const approved = education();
  let requests = [];
  const f = await fixture('user', async (_route, options) => {
    if (!options) return { approved: [approved], requests };
    posts.push(JSON.parse(options.body));
    requests = [education({ ...posts[0], status: 'pending' })];
    return { message: '已提交' };
  });
  f.el.institution.value = '另一所大学电子工程学院';
  f.el.year.value = '2022';
  f.el.class.value = '甲班';
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(posts[0], {
    type: 'education',
    education: 'undergraduate',
    institution: '另一所大学电子工程学院',
    year: 2022,
    className: '甲班',
  });
  assert.match(f.el.approved.textContent, /2021 年/);
  assert.match(f.el.requests.textContent, /2022 年/);
  assert.equal(f.el.submit.disabled, true);
  assert.match(f.el['slot-status'].textContent, /现有认证继续有效/);
});

test('teacher can omit year and company submits no hidden education fields', async () => {
  const posts = [];
  const f = await fixture('user', async (_route, options) => {
    if (options) posts.push(JSON.parse(options.body));
    return options ? {} : { approved: [], requests: [], fullName: '张亦驰' };
  });
  f.el.kind.value = 'teacher';
  f.el.kind.listeners.change();
  f.el.year.value = '';
  assert.equal(f.el.year.required, false);
  assert.match(f.el['slot-status'].textContent, /公开账号姓名“张亦驰”/);
  assert.match(f.el['slot-status'].textContent, /更正姓名.*联系管理员/);
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(posts[0], { type: 'teacher', institution: '清华大学电子系', className: '' });
  f.el.kind.value = 'company';
  f.el.kind.listeners.change();
  f.el.company.value = '例示电子有限公司';
  assert.equal(f.el.institution.disabled, true);
  assert.equal(f.el.company.disabled, false);
  assert.doesNotMatch(f.el['slot-status'].textContent, /张亦驰|公开账号姓名/);
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(posts[1], { type: 'company', companyName: '例示电子有限公司' });
});

test('switching accounts ignores an earlier certification read and clears identity details immediately', async () => {
  const first = defer();
  let read = 0;
  const f = await fixture('user', () => {
    read += 1;
    return read === 1
      ? first.promise
      : Promise.resolve({
          approved: [{ type: 'company', companyName: '新账号的企业' }],
          requests: [],
          fullName: '新账号姓名',
        });
  });
  f.userState.uid = 'new_uid';
  f.userState.token = 'new_token';
  f.events['freebbs:session-change']();
  await settle();
  first.resolve({
    approved: [education({ institution: '上一账号的私密院系' })],
    requests: [],
    fullName: '上一账号姓名',
  });
  await settle();
  assert.match(f.el.approved.textContent, /新账号的企业/);
  assert.doesNotMatch(f.root.textContent, /上一账号/);
  f.el.kind.value = 'teacher';
  f.el.kind.listeners.change();
  assert.match(f.el['slot-status'].textContent, /新账号姓名/);
  assert.doesNotMatch(f.root.textContent, /上一账号/);
  assert.equal(f.dispatched.length, 1);
});

test('cross-tab logout blocks a late submit and BFCache restore loads the current owner afresh', async () => {
  const post = defer();
  let read = 0;
  const f = await fixture('user', (_route, options) => {
    if (options) return post.promise;
    read += 1;
    return Promise.resolve({ approved: [education()], requests: [] });
  });
  const submit = f.el.form.listeners.submit({ preventDefault() {} });
  f.events.storage({ key: 'free_bbs_auth_token' });
  assert.equal(f.el.approved.children.length, 0);
  assert.equal(f.el.submit.disabled, true);
  post.resolve({ message: '不应回写的旧响应' });
  await submit;
  assert.equal(f.el.message.textContent, '');
  assert.equal(read, 1);
  f.events.pageshow({ persisted: true });
  await settle();
  assert.equal(read, 2);
  assert.equal(f.el.submit.disabled, false);
});

test('a completed student-id binding refreshes the backend suggestion on the same settings page', async () => {
  let bound = false;
  const f = await fixture('user', async () => ({
    approved: [],
    requests: [],
    suggestion: bound ? education({ education: 'master', year: 2026 }) : null,
  }));
  assert.equal(f.el.suggestion.hidden, true);
  bound = true;
  f.events['freebbs:identity-updated']();
  await settle();
  assert.equal(f.el.suggestion.hidden, false);
  f.el['use-suggestion'].listeners.click();
  assert.equal(f.el.kind.value, 'master');
  assert.equal(f.el.year.value, 2026);
});

const adminPayload = (requests) => ({ requests, total: requests.length, page: 1, pageSize: 30 });

test('teacher approval names the account identity that will become public', async () => {
  const f = await fixture(
    'admin',
    async () =>
      adminPayload([
        {
          id: 4,
          userUid: 'other_uid',
          type: 'teacher',
          status: 'pending',
          fullName: '张亦驰',
          username: 'Teacher_Zhang',
          institution: '清华大学电子系',
        },
      ]),
    { role: 'teacher', isAdmin: true },
  );
  const card = f.el.list.children[0];
  assert.match(card.textContent, /核实申请人姓名“张亦驰”、教师身份及学校院系/);
  assert.match(card.textContent, /该姓名将公开显示在教师认证牌/);
  assert.equal(card.querySelector('[data-review-action]').disabled, true);
});

test('a teacher with isAdmin can review; self-review uses uid and approval requires explicit confirmation', async () => {
  const posts = [];
  const requests = [
    education({ id: 1, userId: 10, userUid: 'other_uid', status: 'pending' }),
    education({ id: 2, userId: 20, userUid: 'admin_uid', status: 'pending' }),
  ];
  const f = await fixture(
    'admin',
    async (route, options) => {
      if (!options) return adminPayload(requests);
      posts.push({ route, body: JSON.parse(options.body) });
      return { message: '已批准' };
    },
    { uid: 'admin_uid', role: 'teacher', isAdmin: true },
  );
  assert.equal(f.root.hidden, false);
  const [other, self] = f.el.list.children;
  const otherApprove = other.querySelectorAll('button')[0];
  assert.equal(otherApprove.disabled, true);
  await otherApprove.listeners.click();
  assert.equal(posts.length, 0);
  assert.ok(self.querySelectorAll('input,textarea,button').every((node) => node.disabled));
  const check = other.querySelector('input');
  check.checked = true;
  check.listeners.change();
  assert.equal(otherApprove.disabled, false);
  await otherApprove.listeners.click();
  assert.deepEqual(posts[0], {
    route: '/admin/certifications/1/review',
    body: { action: 'approve', reviewNote: '', identityConfirmed: true },
  });
  assert.equal(f.dispatched[0].type, 'freebbs:certifications-reviewed');
});

test('admin permission revocation clears applicants and ignores outstanding reads', async () => {
  const pending = defer();
  const f = await fixture('admin', () => pending.promise, {
    uid: 'admin_uid',
    role: 'teacher',
    isAdmin: true,
  });
  f.userState.isAdmin = false;
  f.events['freebbs:session-change']();
  pending.resolve(
    adminPayload([education({ id: 1, userUid: 'private_applicant', status: 'pending' })]),
  );
  await settle();
  assert.equal(f.root.hidden, true);
  assert.equal(f.el.list.children.length, 0);
  assert.doesNotMatch(f.root.textContent, /private_applicant/);
});

test('rejection does not require the approval checkbox and sends its explanation', async () => {
  const posts = [];
  const f = await fixture(
    'admin',
    async (_route, options) => {
      if (!options)
        return adminPayload([education({ id: 3, userUid: 'other_uid', status: 'pending' })]);
      posts.push(JSON.parse(options.body));
      return {};
    },
    { role: 'teacher', isAdmin: true },
  );
  const card = f.el.list.children[0];
  card.querySelector('textarea').value = '请补充入学信息';
  assert.equal(card.querySelectorAll('button')[1].disabled, false);
  await card.querySelectorAll('button')[1].listeners.click();
  assert.deepEqual(posts[0], {
    action: 'reject',
    reviewNote: '请补充入学信息',
    identityConfirmed: false,
  });
});

test('repeated same-page certification notifications refresh each controller without hash changes or lost application drafts', async () => {
  let userReads = 0;
  const user = await fixture('user', async () => {
    userReads += 1;
    return { approved: userReads > 1 ? [education()] : [], requests: [] };
  });
  user.el.kind.value = 'doctor';
  user.el.kind.listeners.change();
  user.el.institution.value = '尚未提交的学校院系';
  user.el.year.value = '2024';
  user.el.class.value = '草稿班级';
  const userNotice = { detail: { kind: 'certification', link: '/settings#certifications' } };
  user.events['freebbs:notification-open'](userNotice);
  await settle();
  assert.equal(user.el.approved.children.length, 1);
  user.events['freebbs:notification-open'](userNotice);
  await settle();
  assert.equal(userReads, 3);
  assert.equal(user.el.kind.value, 'doctor');
  assert.equal(user.el.institution.value, '尚未提交的学校院系');
  assert.equal(user.el.year.value, '2024');
  assert.equal(user.el.class.value, '草稿班级');

  const routes = [];
  const admin = await fixture(
    'admin',
    async (route) => {
      routes.push(route);
      return adminPayload(
        routes.length > 1 ? [education({ id: 7, userUid: 'other_uid', status: 'pending' })] : [],
      );
    },
    { role: 'teacher', isAdmin: true },
  );
  assert.equal(admin.el.list.children.length, 0);
  admin.el.filter.value = 'approved';
  const adminNotice = { detail: { kind: 'certification', link: '/adminusers#certifications' } };
  admin.events['freebbs:notification-open'](adminNotice);
  await settle();
  assert.equal(admin.el.filter.value, 'pending');
  assert.equal(admin.el.list.children.length, 1);
  admin.events['freebbs:notification-open'](adminNotice);
  await settle();
  assert.deepEqual(routes, Array(3).fill('/admin/certifications?status=pending&page=1'));
});
