const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { installTeacherParticipation, feedbackHref } = require('../public/teacher-participation');
const { installAdminTeachingCourses } = require('../public/admin-teaching-courses');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.className = '';
    this.text = '';
  }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map((item) => item.textContent).join(' ');
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  scrollIntoView() {
    this.scrolled = true;
  }

  matches(selector) {
    if (selector === '.admin-user-row[data-user-id]')
      return this.className === 'admin-user-row' && Boolean(this.dataset.userId);
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('[data-')) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, key);
    }
    return this.tagName === selector;
  }

  querySelectorAll(selector) {
    return this.children.flatMap((node) => [
      ...(node.matches(selector) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    return this.matches(selector) ? this : this.parent?.closest(selector) || null;
  }
}
async function settle() {
  for (let i = 0; i < 5; i += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(kind, callApi, user = {}) {
  const names =
    kind === 'teacher'
      ? [
          'status',
          'signin',
          'certify',
          'refresh',
          'courses-section',
          'courses-status',
          'courses',
          'feedback-section',
          'feedback-status',
          'feedback',
        ]
      : ['name', 'status', 'form', 'options', 'confirmed', 'save', 'refresh'];
  const el = Object.fromEntries(names.map((name) => [name, new Element()]));
  const root = new Element();
  const users = new Element();
  const card = new Element();
  card.className = 'admin-user-row';
  card.dataset.userId = '42';
  const heading = new Element();
  heading.className = 'admin-user-summary';
  const accountName = new Element();
  accountName.dataset.adminSummaryName = '';
  accountName.textContent = '测试教师';
  heading.append(accountName);
  card.append(heading);
  users.append(card);
  root.hidden = true;
  const events = {};
  const userState = {
    uid: 'u_teacher',
    token: 'token_1',
    role: kind === 'admin' ? 'admin' : 'teacher',
    isLoggedIn: true,
    ...user,
  };
  const host = {
    addEventListener: (name, callback) => {
      events[name] = callback;
    },
  };
  const doc = {
    createElement: (tag) => new Element(tag),
    querySelector: () => root,
    getElementById: (id) => {
      if (id === 'admin-teaching-courses') return root;
      if (id === 'admin-users') return users;
      return el[id.replace(kind === 'teacher' ? 'teacher-' : 'teaching-', '')];
    },
  };
  const app = { userState, callApi, sessionReady: Promise.resolve() };
  (kind === 'teacher' ? installTeacherParticipation : installAdminTeachingCourses)({
    document: doc,
    window: host,
    app,
  });
  await settle();
  return {
    el,
    root,
    users,
    card,
    userState,
    host,
    events,
    open: async () => {
      const button = card.querySelector('[data-teaching-user]');
      users.listeners.click({ target: button });
      await settle();
    },
  };
}
const workspace = (extra = {}) => ({
  eligible: true,
  identity: { certified: true, fullName: '测试教师' },
  courses: [],
  feedback: [],
  ...extra,
});
test('guest sees an honest login entry and no personal API is called', async () => {
  let calls = 0;
  const f = await fixture(
    'teacher',
    async () => {
      calls += 1;
    },
    { isLoggedIn: false, token: '' },
  );
  assert.equal(calls, 0);
  assert.equal(f.el.signin.hidden, false);
  assert.equal(f.el.certify.hidden, true);
  assert.equal(f.el['courses-section'].hidden, true);
});
test('unverified teacher gets no private course or feedback cards', async () => {
  const f = await fixture('teacher', async () =>
    workspace({
      eligible: false,
      courses: [{ slug: 'math', name: '不得展示' }],
      feedback: [{ title: '不得展示' }],
    }),
  );
  assert.match(f.el.status.textContent, /尚未核实/);
  assert.equal(f.el.courses.children.length, 0);
  assert.equal(f.el.feedback.children.length, 0);
  assert.equal(f.el['courses-section'].hidden, true);
});
test('verified empty state links to existing materials without inventing courses', async () => {
  const f = await fixture('teacher', async () => workspace());
  assert.match(f.el['courses-status'].textContent, /暂未关联/);
  assert.match(f.el['feedback-status'].textContent, /还没有意见/);
  assert.equal(f.el.courses.children.length, 0);
  assert.equal(f.el['courses-section'].hidden, false);
});
test('own courses and feedback use safe local links and literal text, not HTML or editor grants', async () => {
  const f = await fixture('teacher', async () =>
    workspace({
      courses: [
        { slug: 'signals', name: '<img src=x>', canEditMaterials: true },
        { slug: 'https://wrong', name: 'discard' },
      ],
      feedback: [
        {
          title: '<script>bad</script>',
          courseSlug: 'signals',
          pointId: 'SS-01',
          status: 'handled',
          response: '<b>回复</b>',
        },
      ],
    }),
  );
  assert.equal(f.el.courses.children.length, 1);
  assert.match(f.el.courses.textContent, /<img src=x>/);
  assert.equal(f.el.courses.querySelector('a').href, '/course?course=signals');
  assert.match(f.el.feedback.textContent, /已处理/);
  assert.match(f.el.feedback.textContent, /<b>回复<\/b>/);
  assert.match(f.el.feedback.querySelector('a').href, /tool=contribute/);
  assert.doesNotMatch(f.el.courses.textContent, /编辑/);
  assert.equal(feedbackHref({ courseSlug: 'https://bad', pointId: 'x' }), '/world');
});
test('failed read is visible and explicit refresh retries', async () => {
  let calls = 0;
  const f = await fixture('teacher', async () => {
    calls += 1;
    if (calls === 1) throw new Error('网络中断');
    return workspace();
  });
  assert.match(f.el.status.textContent, /网络中断/);
  assert.equal(f.el.refresh.disabled, false);
  f.el.refresh.listeners.click();
  await settle();
  assert.equal(calls, 2);
  assert.match(f.el.status.textContent, /测试教师/);
});
test('logout and cross-tab switch clear private cards and ignore late old-account data', async () => {
  const delayed = deferred();
  const f = await fixture('teacher', async () => delayed.promise);
  f.userState.isLoggedIn = false;
  f.userState.token = '';
  f.events['freebbs:session-change']();
  delayed.resolve(workspace({ courses: [{ slug: 'signals', name: '旧账号课程' }] }));
  await settle();
  assert.equal(f.el.courses.children.length, 0);
  assert.equal(f.el['courses-section'].hidden, true);
  assert.equal(f.el.signin.hidden, false);
  assert.doesNotMatch(f.el.status.textContent, /旧账号/);
  f.userState.isLoggedIn = true;
  f.userState.token = 'new_token';
  f.events['freebbs:session-change']();
  await settle();
  f.events.storage({ key: 'free_bbs_auth_token' });
  assert.equal(f.el.courses.children.length, 0);
  assert.equal(f.el.certify.hidden, true);
});
test('admin uses a real account row and isolated GET/PUT with explicit confirmation', async () => {
  const calls = [];
  const f = await fixture('admin', async (route, options) => {
    calls.push({ route, options });
    return options
      ? { courseSlugs: ['signals'] }
      : { eligible: true, courses: [{ slug: 'signals', name: '信号与系统' }], courseSlugs: [] };
  });
  await f.open();
  assert.equal(calls[0].route, '/admin/users/42/teaching-courses');
  assert.equal(f.el.save.disabled, true);
  f.el.options.querySelector('input').checked = true;
  f.el.form.listeners.submit({ preventDefault() {} });
  await settle();
  assert.equal(calls.length, 1);
  f.el.confirmed.checked = true;
  f.el.confirmed.listeners.change();
  f.el.form.listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    courseSlugs: ['signals'],
    identityConfirmed: true,
  });
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(f.el.confirmed.checked, false);
  assert.match(f.el.status.textContent, /角色、余额与资料编辑权限未改动/);
});
test('admin read failures can retry, unverified identity cannot save, and logout clears selected user', async () => {
  let calls = 0;
  const f = await fixture('admin', async () => {
    calls += 1;
    if (calls === 1) throw new Error('稍后再试');
    return { eligible: false, courses: [], courseSlugs: [] };
  });
  await f.open();
  assert.match(f.el.status.textContent, /稍后再试/);
  assert.equal(f.el.refresh.disabled, false);
  f.el.refresh.listeners.click();
  await settle();
  assert.match(f.el.status.textContent, /尚无已核实/);
  assert.equal(f.el.form.hidden, true);
  f.userState.isLoggedIn = false;
  f.events['freebbs:session-change']();
  assert.equal(f.root.hidden, true);
  assert.equal(f.el.name.textContent, '关联任教课程');
  assert.equal(f.el.options.children.length, 0);
});
test('admin ignores an old account response after a session change', async () => {
  const delayed = deferred();
  const f = await fixture('admin', async () => delayed.promise);
  const opening = f.open();
  f.userState.isLoggedIn = false;
  f.events['freebbs:session-change']();
  delayed.resolve({
    eligible: true,
    courses: [{ slug: 'math', name: '旧教师课程' }],
    courseSlugs: ['math'],
  });
  await opening;
  await settle();
  assert.equal(f.root.hidden, true);
  assert.equal(f.el.options.children.length, 0);
});

test('revoked teachers keep a confirmed clear-only action, never a new assignment', async () => {
  const calls = [];
  const f = await fixture('admin', async (route, options) => {
    calls.push({ route, options });
    return options
      ? { courseSlugs: [] }
      : {
          eligible: false,
          courses: [
            { slug: 'signals', name: '旧课程' },
            { slug: 'math', name: '不可新增' },
          ],
          courseSlugs: ['signals'],
        };
  });
  await f.open();
  assert.equal(f.el.form.hidden, false);
  assert.equal(f.el.options.children.length, 1);
  assert.equal(f.el.options.querySelector('input').disabled, true);
  assert.equal(f.el.save.textContent, '清除旧关联');
  f.el.confirmed.checked = true;
  f.el.form.listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(JSON.parse(calls[1].options.body), { courseSlugs: [], identityConfirmed: true });
  assert.match(f.el.status.textContent, /旧任教关联已清除/);
});

for (const kind of ['teacher', 'admin']) {
  for (const tokenAfterFreeze of [null, 'another_account_token', 'unreadable']) {
    test(`${kind} BFCache restore rejects ${tokenAfterFreeze || 'removed token'} without trusting frozen identity`, async () => {
      let calls = 0;
      const f = await fixture(kind, async () => {
        calls += 1;
        return kind === 'teacher'
          ? workspace({ courses: [{ slug: 'signals', name: '旧账号课程' }] })
          : {
              eligible: true,
              courses: [{ slug: 'signals', name: '旧账号课程' }],
              courseSlugs: ['signals'],
            };
      });
      if (kind === 'admin') await f.open();
      let storedToken = 'token_1';
      f.host.localStorage = {
        getItem: () => {
          if (storedToken === 'unreadable') throw new Error('Storage unavailable');
          return storedToken;
        },
      };
      f.events.pagehide();
      const callsBeforeRestore = calls;
      storedToken = tokenAfterFreeze;
      f.events.pageshow({ persisted: true });
      // An unrelated stale in-memory identity event cannot unlock the old owner either.
      f.events['freebbs:session-change']();
      await settle();
      assert.equal(calls, callsBeforeRestore);
      if (kind === 'teacher') {
        assert.equal(f.el.courses.children.length, 0);
        assert.equal(f.el.feedback.children.length, 0);
        assert.equal(f.el.signin.hidden, false);
      } else {
        assert.equal(f.root.hidden, true);
        assert.equal(f.el.options.children.length, 0);
        assert.equal(f.el.save.disabled, true);
        f.el.confirmed.checked = true;
        f.el.form.listeners.submit({ preventDefault() {} });
        await settle();
        assert.equal(calls, callsBeforeRestore);
      }
      storedToken = 'fresh_token';
      f.userState.token = storedToken;
      f.events['freebbs:session-change']();
      await settle();
      if (kind === 'teacher') assert.equal(f.el.courses.children.length, 1);
      else assert.equal(f.root.hidden, false);
    });
  }
}
test('teacher routes and styles use the shared shell and no automatic AI or publishing', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/teachers.html'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../public/adminusers.html'), 'utf8');
  assert.match(html, /href="\/login\?next=%2Fteachers"/);
  assert.match(html, /\/settings\?certification=teacher#certifications/);
  assert.match(html, /teacher-participation\.css/);
  assert.doesNotMatch(html, /src="\/[^" ]*(?:aichat|learning-companion)/);
  assert.match(admin, /admin-teaching-courses\.js/);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css|webp|png|svg))"/g))
    assert.ok(fs.existsSync(path.join(__dirname, '../public', match[1])), match[1]);
});
test('login return accepts teachers only on the same origin and keeps hostile URLs blocked', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
  const functionSource = source.slice(
    source.indexOf('function activityReturnPath()'),
    source.indexOf('function initializeAuthReturnLinks()'),
  );
  const run = (next) =>
    vm.runInNewContext(`${functionSource};activityReturnPath()`, {
      URL,
      URLSearchParams,
      window: {
        location: { origin: 'https://example.test', search: `?next=${encodeURIComponent(next)}` },
      },
    });
  assert.equal(run('/teachers'), '/teachers');
  assert.equal(run('https://attacker.test/teachers'), '');
  assert.equal(run('//attacker.test/teachers'), '');
  assert.equal(run('/adminusers'), '');
});
