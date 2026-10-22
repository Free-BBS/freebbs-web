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

async function fixture(kind, callApi, state = {}, location = {}) {
  const root = new Element();
  const fold = new Element();
  fold.className = 'personal-fold';
  fold.open = false;
  fold.append(root);
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
          'add',
          'cancel',
          'editor-title',
        ]
      : ['pending', 'filter', 'refresh', 'status', 'list', 'prev', 'next', 'page'];
  const inputs = new Set(['institution', 'year', 'class', 'company']);
  const buttons = new Set(['refresh', 'submit', 'add', 'cancel', 'prev', 'next']);
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
    for (const kindName of ['undergraduate', 'master', 'doctor', 'teacher', 'company']) {
      const option = new Element('option');
      option.value = kindName;
      el.kind.append(option);
    }
    el.form.append(el.kind, el['education-fields'], el['company-fields'], el.submit, el.cancel);
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
              'cancel',
            ].includes(id),
        )
        .map((id) => el[id]),
    );
  } else {
    el.filter.value = 'pending';
    for (const value of ['pending', 'approved', 'rejected', 'all']) {
      const option = new Element('option');
      option.value = value;
      option.textContent = value === 'pending' ? '待审核' : value;
      el.filter.append(option);
    }
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
    location,
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
  return { root, fold, el, events, dispatched, userState, host };
}

function openEditor(f, kind = 'undergraduate') {
  const { el } = f;
  el.add.listeners.click();
  el.kind.value = kind;
  el.kind.listeners.change();
}

test('teacher deep link selects the teacher form without submitting or accepting other query kinds', async () => {
  const routes = [];
  const payload = { approved: [], requests: [], suggestion: education(), fullName: '教师本人' };
  const f = await fixture(
    'user',
    async (route, options) => {
      routes.push({ route, options });
      return payload;
    },
    {},
    { search: '?certification=teacher', hash: '#certifications' },
  );
  assert.equal(f.el.kind.value, 'teacher');
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.year.required, false);
  assert.equal(f.fold.open, true);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].options, undefined);
  const other = await fixture(
    'user',
    async () => payload,
    {},
    { search: '?certification=company' },
  );
  assert.equal(other.el.kind.value, 'master');
  assert.equal(other.el.form.hidden, true);
  assert.equal(other.fold.open, false);
});

test('certification hash opens a containing fold without changing the selected identity', async () => {
  const f = await fixture(
    'user',
    async () => ({ approved: [], requests: [] }),
    {},
    { hash: '#certifications' },
  );
  assert.equal(f.fold.open, true);
  assert.equal(f.el.kind.value, 'undergraduate');
});

test('bound education is displayed automatically without prefilled repeat application', async () => {
  const f = await fixture('user', async () => ({
    approved: [education(), education({ status: 'pending', education: 'doctor' })],
    requests: [
      education({ status: 'pending', education: 'master' }),
      education({ status: 'rejected', education: 'doctor', reviewNote: '<script>bad()</script>' }),
    ],
    suggestion: education({ year: 2025, className: '' }),
  }));
  assert.equal(f.el.form.hidden, true);
  assert.equal(f.el.year.value, 2021);
  assert.equal(f.el.approved.children.length, 1);
  assert.match(f.el.approved.textContent, /学号已识别/);
  assert.match(f.el.approved.textContent, /2025 年入学/);
  assert.equal(f.el.approved.querySelectorAll('button').length, 0);
  assert.equal(f.el.requests.children.length, 2);
  assert.match(f.el.requests.textContent, /等待审核/);
  assert.match(f.el.requests.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(f.el.requests.querySelectorAll('script').length, 0);
  openEditor(f, 'master');
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
  f.el.approved.querySelector('button').listeners.click();
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
  openEditor(f, 'teacher');
  f.el.institution.value = '清华大学电子系';
  f.el.year.value = '';
  assert.equal(f.el.year.required, false);
  assert.match(f.el['slot-status'].textContent, /公开账号姓名“张亦驰”/);
  assert.match(f.el['slot-status'].textContent, /更正姓名.*联系管理员/);
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(posts[0], { type: 'teacher', institution: '清华大学电子系', className: '' });
  openEditor(f, 'company');
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
  openEditor(f);
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
  assert.equal(f.el.submit.disabled, true);
  assert.equal(f.el.form.hidden, true);
});

test('completed student-id binding updates the automatic identity without another application', async () => {
  let bound = false;
  const f = await fixture('user', async () => ({
    approved: [],
    requests: [],
    suggestion: bound ? education({ education: 'master', year: 2026 }) : null,
  }));
  assert.equal(f.el.approved.children.length, 0);
  bound = true;
  f.events['freebbs:identity-updated']();
  await settle();
  assert.equal(f.el.approved.children.length, 1);
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  assert.match(f.el.approved.textContent, /2026 年入学/);
  assert.equal(f.el.form.hidden, true);
});

test('binding the same account while its initial certification read is pending supersedes the old snapshot', async () => {
  const initial = defer();
  const latest = defer();
  let reads = 0;
  const f = await fixture('user', () => {
    reads += 1;
    return reads === 1 ? initial.promise : latest.promise;
  });
  const originalOwner = `${f.userState.uid}:${f.userState.token}`;
  const user = { uid: f.userState.uid, studentId: '2026210001' };
  f.userState.studentId = user.studentId;
  f.host.dispatchEvent({ type: 'freebbs:session-change', detail: { user } });
  f.host.dispatchEvent({ type: 'freebbs:identity-updated', detail: { user, status: 'bound' } });
  assert.equal(`${f.userState.uid}:${f.userState.token}`, originalOwner);
  assert.equal(reads, 2, 'the unchanged session must still fetch the newly bound identity');
  initial.resolve({ approved: [education({ institution: '绑定前的旧快照' })], requests: [] });
  await settle();
  assert.equal(f.el.approved.children.length, 0);
  assert.equal(f.el.refresh.disabled, true);
  latest.resolve({ approved: [], requests: [], suggestion: education({ education: 'master' }) });
  await settle();
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  assert.doesNotMatch(f.el.approved.textContent, /旧快照/);
  assert.equal(f.el.refresh.disabled, false);
});

test('a binding refresh preserves an unsent education draft and ignores a later stale manual read', async () => {
  const stale = defer();
  let reads = 0;
  const f = await fixture('user', () => {
    reads += 1;
    if (reads === 2) return stale.promise;
    return Promise.resolve({
      approved: [],
      requests: [],
      suggestion: reads > 2 ? education({ education: 'master' }) : null,
    });
  });
  openEditor(f, 'doctor');
  f.el.institution.value = '尚未提交的博士院系';
  f.el.year.value = '2024';
  f.el.class.value = '草稿班级';
  const refreshing = f.el.refresh.listeners.click();
  f.host.dispatchEvent({
    type: 'freebbs:identity-updated',
    detail: { user: { uid: f.userState.uid, studentId: '2026210001' }, status: 'bound' },
  });
  await settle();
  assert.equal(reads, 3);
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  stale.resolve({ approved: [], requests: [], automatic: [] });
  await refreshing;
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.kind.value, 'doctor');
  assert.equal(f.el.institution.value, '尚未提交的博士院系');
  assert.equal(f.el.year.value, '2024');
  assert.equal(f.el.class.value, '草稿班级');
  assert.equal(f.el.submit.disabled, false);
});

test('binding events during a failed certification submission coalesce into a fresh read without losing its draft', async () => {
  const post = defer();
  let reads = 0;
  const f = await fixture('user', async (_route, options) => {
    if (options) {
      await post.promise;
      throw new Error('暂时无法提交');
    }
    reads += 1;
    return {
      approved: [],
      requests: [],
      suggestion: reads > 1 ? education({ education: 'master' }) : null,
    };
  });
  openEditor(f, 'doctor');
  f.el.institution.value = '需要保留的博士院系';
  f.el.year.value = '2025';
  const submit = f.el.form.listeners.submit({ preventDefault() {} });
  const binding = {
    type: 'freebbs:identity-updated',
    detail: { user: { uid: f.userState.uid, studentId: '2026210001' }, status: 'bound' },
  };
  f.host.dispatchEvent(binding);
  f.host.dispatchEvent(binding);
  assert.equal(reads, 1, 'a submission defers certification refreshes until it settles');
  post.resolve();
  await submit;
  await settle();
  assert.equal(reads, 2, 'queued identity changes need one current read');
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  assert.match(f.el.message.textContent, /暂时无法提交/);
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.kind.value, 'doctor');
  assert.equal(f.el.institution.value, '需要保留的博士院系');
  assert.equal(f.el.year.value, '2025');
  assert.equal(f.el.submit.disabled, false);
});

test('binding during the read after submission invalidates that snapshot and drains the queued identity refresh', async () => {
  const stale = defer();
  const latest = defer();
  let reads = 0;
  const f = await fixture('user', async (_route, options) => {
    if (options) return { message: '经历申请已提交' };
    reads += 1;
    if (reads === 2) return stale.promise;
    if (reads === 3) return latest.promise;
    return { approved: [], requests: [] };
  });
  openEditor(f, 'doctor');
  f.el.institution.value = '已提交的博士院系';
  f.el.year.value = '2025';
  const submit = f.el.form.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(reads, 2);
  f.host.dispatchEvent({
    type: 'freebbs:identity-updated',
    detail: { user: { uid: f.userState.uid, studentId: '2026210001' }, status: 'bound' },
  });
  stale.resolve({ approved: [education({ institution: '绑定前的旧快照' })], requests: [] });
  await submit;
  assert.equal(reads, 3);
  assert.equal(f.el.approved.children.length, 0);
  latest.resolve({ approved: [], requests: [], suggestion: education({ education: 'master' }) });
  await settle();
  assert.match(f.el.approved.textContent, /硕士身份.*学号已识别/);
  assert.doesNotMatch(f.el.approved.textContent, /旧快照/);
  assert.equal(f.el.message.textContent, '经历申请已提交');
  assert.equal(f.el.refresh.disabled, false);
});

const adminPayload = (requests) => ({ requests, total: requests.length, page: 1, pageSize: 30 });

test('verified teacher deep link shows one compact identity and no repeated update form', async () => {
  const teacher = {
    type: 'teacher',
    institution: '已核实学校',
    year: 2020,
    verifiedName: '旧称呼',
  };
  const f = await fixture(
    'user',
    async () => ({
      approved: [teacher],
      requests: [],
      automatic: [
        {
          type: 'teacher',
          automatic: true,
          source: 'account_role',
          verifiedName: '数据库教师姓名',
          institution: '',
          year: null,
        },
      ],
      managedSlots: ['teacher'],
    }),
    { role: 'teacher' },
    { search: '?certification=teacher', hash: '#certifications' },
  );
  assert.equal(f.el.form.hidden, true);
  assert.equal(f.el.approved.children.length, 1);
  assert.match(f.el.approved.textContent, /教师.*已核实/);
  assert.match(f.el.approved.textContent, /数据库教师姓名.*已核实学校/);
  assert.doesNotMatch(f.el.approved.textContent, /旧称呼/);
  assert.equal(f.el.approved.querySelectorAll('button').length, 0);
});

test('automatic current identity cannot be re-applied and historical education starts blank', async () => {
  let posts = 0;
  const f = await fixture('user', async (_route, options) => {
    if (options) posts += 1;
    return {
      approved: [education({ education: 'master' })],
      automatic: [
        {
          ...education({ education: 'master', year: 2026 }),
          automatic: true,
          source: 'bound_student_id',
        },
      ],
      managedSlots: ['master'],
      requests: [education({ education: 'master', status: 'pending', requiresReview: false })],
    };
  });
  assert.equal(f.el.form.hidden, true);
  assert.equal(f.el.requests.children.length, 0);
  assert.doesNotMatch(f.el.status.textContent, /待审核/);
  f.el.add.listeners.click();
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.kind.value, 'undergraduate');
  assert.equal(f.el.institution.value, '');
  assert.equal(f.el.year.value, '');
  const managed = f.el.kind.querySelectorAll('option').find((option) => option.value === 'master');
  assert.equal(managed.disabled, true);
  f.el.kind.value = 'master';
  f.el.kind.listeners.change();
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.equal(posts, 0);
});

test('closing and reopening keeps the unsent experience draft without posting', async () => {
  let posts = 0;
  const f = await fixture('user', async (_route, options) => {
    if (options) posts += 1;
    return { approved: [], requests: [], automatic: [], managedSlots: [] };
  });
  assert.equal(f.el.form.hidden, true);
  openEditor(f);
  f.el.institution.value = '曾经就读的学校';
  f.el.year.value = '2018';
  f.el.cancel.listeners.click();
  assert.equal(f.el.form.hidden, true);
  f.el.add.listeners.click();
  assert.equal(f.el.institution.value, '曾经就读的学校');
  assert.equal(f.el.year.value, '2018');
  assert.equal(posts, 0);
});

test('temporary read errors and failed submissions keep the compact editor and draft recoverable', async () => {
  let fail = false;
  const f = await fixture('user', async (_route, options) => {
    if (options || fail) throw new Error('暂时连接失败');
    return { approved: [], requests: [] };
  });
  openEditor(f);
  f.el.institution.value = '尚未提交的学校';
  f.el.year.value = '2019';
  await f.el.form.listeners.submit({ preventDefault() {} });
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.institution.value, '尚未提交的学校');
  assert.match(f.el.message.textContent, /暂时连接失败/);
  fail = true;
  await f.el.refresh.listeners.click();
  assert.equal(f.el.institution.value, '尚未提交的学校');
  assert.match(f.el.status.textContent, /暂时连接失败/);
});

test('BFCache never revives a frozen certification identity after token loss, replacement or unreadable storage', async () => {
  for (const token of [null, 'other_token', 'unreadable']) {
    let reads = 0;
    const f = await fixture('user', async () => {
      reads += 1;
      return { approved: [education({ institution: '不应恢复的旧身份' })], requests: [] };
    });
    f.events.pagehide();
    f.host.localStorage = {
      getItem() {
        if (token === 'unreadable') throw new Error('storage unavailable');
        return token;
      },
    };
    f.events.pageshow({ persisted: true });
    await settle();
    assert.equal(reads, 1);
    assert.equal(f.el.approved.children.length, 0);
    assert.equal(f.el.form.hidden, true);
    assert.doesNotMatch(f.root.textContent, /不应恢复的旧身份/);
  }
});

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

test('recognized pending identities offer only an explicit close action and never imply another approval', async () => {
  const posts = [];
  let closed = false;
  const f = await fixture(
    'admin',
    async (route, options) => {
      if (!options)
        return adminPayload(
          closed
            ? []
            : [
                education({
                  id: 8,
                  userUid: 'recognized_student',
                  status: 'pending',
                  requiresReview: false,
                  currentApproved: education({ institution: '此前人工核实学校' }),
                }),
              ],
        );
      posts.push({ route, body: JSON.parse(options.body) });
      closed = true;
      return { message: '旧申请已关闭' };
    },
    { uid: 'admin_uid', role: 'teacher', isAdmin: true },
  );
  const card = f.el.list.children[0];
  assert.match(card.textContent, /已由账号识别/);
  assert.match(card.textContent, /无需重复认证/);
  assert.match(card.textContent, /不会删除申请记录/);
  assert.match(card.textContent, /此前人工核实学校/);
  assert.doesNotMatch(card.textContent, /批准认证|新申请通过后更新|等待审核/);
  assert.equal(card.querySelector('[data-identity-confirmed]'), null);
  assert.equal(card.querySelectorAll('button').length, 1);
  const close = card.querySelector('button');
  assert.equal(close.dataset.reviewAction, 'reject');
  assert.equal(close.textContent, '关闭旧申请');
  assert.equal(close.disabled, false);
  assert.equal(f.el.pending.textContent, '未关闭 1 条');
  assert.equal(f.el.filter.children[0].textContent, '未关闭');
  assert.equal(posts.length, 0, 'reading a recognized identity never mutates its old request');
  await close.listeners.click();
  assert.deepEqual(posts, [
    {
      route: '/admin/certifications/8/review',
      body: {
        action: 'reject',
        reviewNote: '已由账号身份识别，无需重复认证。',
        identityConfirmed: false,
      },
    },
  ]);
  assert.equal(f.el.list.children.length, 0);
  assert.equal(f.el.pending.textContent, '未关闭 0 条');
});

test('admin unclosed counts stay honest across pagination and all-status views', async () => {
  const f = await fixture(
    'admin',
    async (route) => {
      if (route.includes('status=all'))
        return { ...adminPayload([education({ id: 5, status: 'approved' })]), total: 90 };
      return {
        ...adminPayload([education({ id: 8, status: 'pending', requiresReview: false })]),
        total: 33,
      };
    },
    { role: 'teacher', isAdmin: true },
  );
  assert.equal(f.el.pending.textContent, '未关闭 33 条');
  assert.equal(f.el.status.textContent, '共 33 条未关闭申请');
  assert.equal(f.el.next.disabled, false);
  f.el.filter.value = 'all';
  f.el.filter.listeners.change();
  await settle();
  assert.equal(f.el.pending.textContent, '未关闭 33 条');
  assert.equal(f.el.status.textContent, '共 90 条申请');
  assert.doesNotMatch(f.el.status.textContent, /undefined|待审核/);
});

test('closing recognized requests preserves self-review and stale-account action guards', async () => {
  const posts = [];
  const requests = [
    education({ id: 8, userUid: 'other_uid', status: 'pending', requiresReview: false }),
    education({ id: 9, userUid: 'admin_uid', status: 'pending', requiresReview: false }),
  ];
  const f = await fixture(
    'admin',
    async (_route, options) => {
      if (!options) return adminPayload(requests);
      posts.push(JSON.parse(options.body));
      return {};
    },
    { uid: 'admin_uid', role: 'teacher', isAdmin: true },
  );
  const [other, self] = f.el.list.children;
  assert.equal(self.querySelector('button').disabled, true);
  await self.querySelector('button').listeners.click();
  assert.equal(posts.length, 0);
  const oldClose = other.querySelector('button');
  f.userState.uid = 'second_admin';
  f.userState.token = 'second_token';
  f.events['freebbs:session-change']();
  await settle();
  await oldClose.listeners.click();
  assert.equal(posts.length, 0, 'detached old-account actions never act as the new administrator');
  const currentClose = f.el.list.children[0].querySelector('button');
  f.userState.isAdmin = false;
  f.events['freebbs:session-change']();
  await currentClose.listeners.click();
  assert.equal(posts.length, 0);
  assert.equal(f.root.hidden, true);
  assert.equal(f.el.list.children.length, 0);
});

test('a late close result cannot restore applicants or feedback after logout', async () => {
  const result = defer();
  const f = await fixture(
    'admin',
    async (_route, options) =>
      options
        ? result.promise
        : adminPayload([
            education({
              id: 8,
              userUid: 'private_applicant',
              status: 'pending',
              requiresReview: false,
            }),
          ]),
    { uid: 'admin_uid', role: 'teacher', isAdmin: true },
  );
  const saving = f.el.list.children[0].querySelector('button').listeners.click();
  f.userState.isLoggedIn = false;
  f.userState.token = '';
  f.events['freebbs:session-change']();
  result.resolve({ message: '不应恢复的旧审核结果' });
  await saving;
  await settle();
  assert.equal(f.root.hidden, true);
  assert.equal(f.el.list.children.length, 0);
  assert.equal(f.el.pending.textContent, '未关闭 0 条');
  assert.doesNotMatch(f.root.textContent, /private_applicant|不应恢复/);
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
  openEditor(user, 'doctor');
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
