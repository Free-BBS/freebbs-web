const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { feedbackValues, percentage, visibleOwnProfile } = require('../public/learning-research');

const source = fs.readFileSync(path.join(__dirname, '../public/learning-research.js'), 'utf8');
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const descend = (host) => [host, ...host.children.flatMap(descend)];
function browser({
  admin = false,
  search = '',
  hash = '',
  personalId = 'personal-platform-research',
  adminId = 'admin-platform-research',
  route,
} = {}) {
  const listeners = new Map();
  function node(tag) {
    let text = '';
    const item = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      attributes: {},
      listeners: new Map(),
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      isConnected: true,
      scrolls: [],
      focusCount: 0,
      classList: { add() {} },
      scrollIntoView(options) {
        this.scrolls.push(options);
      },
      focus() {
        this.focusCount += 1;
      },
      append(...children) {
        children.forEach((child) => {
          child.parentNode = this;
        });
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children.forEach((child) => {
          child.parentNode = null;
        });
        this.children = [];
        this.append(...children);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
      reset() {
        descend(this).forEach((child) => {
          if (['INPUT', 'TEXTAREA', 'SELECT'].includes(child.tagName)) {
            child.value = '';
            child.checked = false;
          }
        });
      },
      async emit(name) {
        const handler = this.listeners.get(name);
        if (handler) await handler({ preventDefault() {} });
      },
    };
    Object.defineProperty(item, 'textContent', {
      get: () => text + item.children.map((child) => child.textContent).join(''),
      set: (value) => {
        text = value;
        item.children = [];
      },
    });
    return item;
  }
  const personal = node('section');
  const adminHost = node('section');
  personal.id = personalId;
  adminHost.id = adminId;
  const calls = [];
  let interceptor = route;
  let serial = 0;
  const app = {
    userState: { uid: '1', token: 'token1', isLoggedIn: true, isAdmin: admin },
    callApi(url, options = {}) {
      const call = {
        url,
        method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : null,
        uid: this.userState.uid,
      };
      calls.push(call);
      const intercepted = interceptor?.(call);
      if (intercepted !== undefined) return intercepted;
      if (url.endsWith('/me'))
        return Promise.resolve({
          feedback: [
            {
              id: 'feedback1',
              module: 'learning',
              purpose: 'understand',
              helpfulness: 3,
              barriers: ['navigation'],
              comment: `private-${call.uid}`,
              createdAt: '2026-10-11T01:00:00Z',
            },
          ],
          enrollments: [],
        });
      if (url.endsWith('/studies') && call.method === 'GET')
        return Promise.resolve({ studies: [] });
      if (url.includes('/admin'))
        return Promise.resolve({
          feedback: {
            respondentCount: 1,
            responseCount: 2,
            registeredUserCount: 100,
            responseCoverage: 0.01,
            helpfulness: { suppressed: true, mean: null },
            modules: [],
            purposes: [],
            barriers: [],
          },
          studies: [],
          limitations: ['自愿样本不能代表全体用户。'],
        });
      return Promise.resolve({});
    },
  };
  const window = {
    freeBbsApp: app,
    location: { search, hash },
    confirm: () => true,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  const document = {
    createElement: node,
    querySelector(query) {
      return query.includes('research-personal')
        ? personal
        : query.includes('research-admin')
          ? adminHost
          : null;
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    URLSearchParams,
    Date,
    Promise,
    console,
    crypto: {
      randomUUID: () => {
        serial += 1;
        return `request-${serial}`;
      },
    },
  });
  return {
    app,
    window,
    personal,
    admin: adminHost,
    calls,
    setRoute(callback) {
      interceptor = callback;
    },
    emit(name, detail = {}) {
      listeners.get(name)?.(detail);
    },
    async flush() {
      for (let i = 0; i < 16; i += 1) await Promise.resolve();
    },
    find(host, predicate) {
      return descend(host).find(predicate);
    },
  };
}
function validFeedback() {
  return {
    module: 'learning',
    purpose: 'understand',
    helpfulness: 3,
    barriers: ['feedback'],
    comment: '希望知道为什么错了',
    consent: true,
  };
}
test('feedback accepts controlled experience data and rejects absent choice or incompatible barrier choices', () => {
  assert.deepEqual(feedbackValues(validFeedback()), validFeedback());
  for (const change of [
    { module: 'private-chat' },
    { purpose: 'grade' },
    { helpfulness: null },
    { helpfulness: 1.5 },
    { helpfulness: 5 },
    { barriers: [] },
    { barriers: ['content', 'technical', 'time', 'navigation'] },
    { barriers: ['none', 'content'] },
    { barriers: ['feedback', 'feedback'] },
    { barriers: ['userId'] },
    { comment: 'x'.repeat(1001) },
    { consent: false },
  ])
    assert.equal(feedbackValues({ ...validFeedback(), ...change }), null);
  assert.deepEqual(
    feedbackValues({ ...validFeedback(), score: 100, role: 'admin' }),
    validFeedback(),
  );
});
test('unknown and suppressed measurement are never rendered as zero mastery', () => {
  assert.equal(percentage(null), '尚未测量');
  assert.equal(percentage(undefined), '尚未测量');
  assert.equal(percentage(NaN), '尚未测量');
  assert.equal(percentage(0), '0.0%');
  assert.equal(percentage(80, true), '样本不足');
  assert.equal(visibleOwnProfile('?uid=other', { uid: '1', isLoggedIn: true }), false);
  assert.equal(
    visibleOwnProfile('?course=signals&point=SS-01-01&tool=continue', {
      uid: '1',
      isLoggedIn: true,
    }),
    true,
  );
  assert.ok(feedbackValues({ ...validFeedback(), module: 'creative' }));
});
test('optional development outcomes distinguish unknown from explicit no change and reject mixed or excessive choices', () => {
  assert.equal(feedbackValues(validFeedback()).outcomes, undefined);
  assert.equal(feedbackValues({ ...validFeedback(), outcomes: [] }).outcomes, undefined);
  assert.deepEqual(feedbackValues({ ...validFeedback(), outcomes: ['none'] }).outcomes, ['none']);
  assert.deepEqual(
    feedbackValues({ ...validFeedback(), outcomes: ['clarity', 'direction'] }).outcomes,
    ['clarity', 'direction'],
  );
  for (const outcomes of [
    null,
    'clarity',
    ['ability'],
    ['none', 'clarity'],
    ['clarity', 'clarity'],
    ['clarity', 'direction', 'exploration', 'collaboration'],
  ])
    assert.equal(feedbackValues({ ...validFeedback(), outcomes }), null);
});
test('current owner can see their feedback while another profile cannot request owner data', async () => {
  const own = browser();
  await own.flush();
  assert.match(own.personal.textContent, /private-1/);
  assert.equal(own.admin.hidden, true);
  assert.ok(own.calls.some((call) => call.url.endsWith('/me')));
  const other = browser({ search: '?uid=other' });
  await other.flush();
  assert.equal(other.personal.hidden, true);
  assert.equal(other.calls.length, 0);
});

test('the requested personal research anchor scrolls only once after successful loading without taking focus', async () => {
  const lab = browser({ hash: '#personal-platform-research' });
  await lab.flush();
  assert.equal(lab.personal.scrolls.length, 1);
  assert.equal(lab.personal.scrolls[0].block, 'start');
  assert.equal(lab.personal.focusCount, 0);
  assert.equal(lab.admin.scrolls.length, 0);
  await lab.find(lab.personal, (item) => item.dataset.researchAction === 'refresh').emit('click');
  await lab.flush();
  lab.window.FreeBbsLearningResearch.refresh();
  await lab.flush();
  lab.emit('pageshow', { persisted: true });
  await lab.flush();
  assert.equal(lab.personal.scrolls.length, 1);
  assert.equal(lab.personal.focusCount, 0);
});

test('only the matching administrator research anchor scrolls', async () => {
  const lab = browser({ admin: true, hash: '#admin-platform-research' });
  await lab.flush();
  assert.equal(lab.admin.scrolls.length, 1);
  assert.equal(lab.admin.scrolls[0].block, 'start');
  assert.equal(lab.personal.scrolls.length, 0);
  assert.equal(lab.admin.focusCount, 0);
});

test('unmatched fragments and knowledge research hosts without an id do not scroll', async () => {
  for (const options of [
    { hash: '' },
    { hash: '#another-section' },
    {
      hash: '#personal-platform-research',
      personalId: '',
      search: '?course=signals&point=SS-02-01',
    },
  ]) {
    const lab = browser(options);
    await lab.flush();
    assert.equal(lab.personal.scrolls.length, 0);
    assert.equal(lab.admin.scrolls.length, 0);
  }
});

test('an unsuccessful initial load waits for the first successful result before revealing its anchor', async () => {
  const lab = browser({
    hash: '#personal-platform-research',
    route: (call) =>
      call.url.endsWith('/me') ? Promise.reject(new Error('暂时不可用')) : undefined,
  });
  await lab.flush();
  assert.equal(lab.personal.scrolls.length, 0);
  lab.setRoute(undefined);
  await lab.find(lab.personal, (item) => item.dataset.researchAction === 'refresh').emit('click');
  await lab.flush();
  assert.equal(lab.personal.scrolls.length, 1);
});
test('a late owner response cannot reappear after switching accounts', async () => {
  const wait = deferred();
  const lab = browser({
    route: (call) => (call.uid === '1' && call.url.endsWith('/me') ? wait.promise : undefined),
  });
  await lab.flush();
  lab.app.userState = { uid: '2', token: 'token2', isLoggedIn: true, isAdmin: false };
  lab.emit('freebbs:session-change');
  await lab.flush();
  wait.resolve({
    feedback: [{ id: 'old', comment: 'OLD_PRIVATE', barriers: [] }],
    enrollments: [],
  });
  await lab.flush();
  assert.doesNotMatch(lab.personal.textContent, /OLD_PRIVATE/);
  assert.match(lab.personal.textContent, /private-2/);
});
test('storage invalidation hides records, prevents writes and resumes only after an app session event', async () => {
  const lab = browser();
  await lab.flush();
  const remove = lab.find(
    lab.personal,
    (item) => item.dataset.researchAction === 'feedback-delete',
  );
  lab.emit('storage', { key: 'free_bbs_auth_token' });
  assert.equal(lab.personal.hidden, true);
  assert.equal(lab.personal.children.length, 0);
  await remove.emit('click');
  assert.equal(lab.calls.filter((call) => call.method === 'DELETE').length, 0);
  lab.window.FreeBbsLearningResearch.refresh();
  lab.emit('pageshow', { persisted: true });
  await lab.flush();
  assert.equal(lab.personal.hidden, true);
  lab.emit('freebbs:session-change');
  await lab.flush();
  assert.equal(lab.personal.hidden, false);
  assert.match(lab.personal.textContent, /private-1/);
});
test('revoking and later restoring admin cannot revive a stale privileged response', async () => {
  const wait = deferred();
  let adminCount = 0;
  const lab = browser({
    admin: true,
    route: (call) => {
      if (!call.url.includes('/admin')) return undefined;
      adminCount += 1;
      return adminCount === 1 ? wait.promise : undefined;
    },
  });
  await lab.flush();
  lab.app.userState.isAdmin = false;
  lab.emit('freebbs:session-change');
  assert.equal(lab.admin.hidden, true);
  lab.app.userState.isAdmin = true;
  lab.emit('freebbs:session-change');
  await lab.flush();
  wait.resolve({ feedback: {}, limitations: ['OLD_PRIVILEGED_REPORT'] });
  await lab.flush();
  assert.doesNotMatch(lab.admin.textContent, /OLD_PRIVILEGED_REPORT/);
  assert.match(lab.admin.textContent, /自愿样本/);
});
test('only the latest admin time-window response renders', async () => {
  const wait = deferred();
  const lab = browser({
    admin: true,
    route: (call) => (call.url.endsWith('window=30') ? wait.promise : undefined),
  });
  await lab.flush();
  const filter = lab.find(lab.admin, (item) => item.dataset.researchWindow !== undefined);
  filter.value = '7';
  await filter.emit('change');
  await lab.flush();
  wait.resolve({ feedback: {}, limitations: ['OLD_30_DAY_REPORT'] });
  await lab.flush();
  assert.doesNotMatch(lab.admin.textContent, /OLD_30_DAY_REPORT/);
  assert.match(lab.admin.textContent, /自愿样本/);
});
test('failed new-window loading cannot keep the previous-window report beneath the new selection', async () => {
  const lab = browser({ admin: true });
  await lab.flush();
  assert.match(lab.admin.textContent, /自愿样本/);
  lab.setRoute((call) =>
    call.url.endsWith('window=7') ? Promise.reject(new Error('LOAD_FAILED')) : undefined,
  );
  const filter = lab.find(lab.admin, (item) => item.dataset.researchWindow !== undefined);
  filter.value = '7';
  await filter.emit('change');
  await lab.flush();
  assert.match(lab.admin.textContent, /LOAD_FAILED/);
  assert.doesNotMatch(lab.admin.textContent, /自愿样本/);
});
test('feedback retry preserves the draft and request key, then a successful submit refreshes owner data', async () => {
  const lab = browser();
  await lab.flush();
  const form = lab.find(lab.personal, (item) => item.tagName === 'FORM');
  const find = (name) => lab.find(form, (item) => item.name === name);
  find('module').value = 'learning';
  find('purpose').value = 'understand';
  find('helpfulness').value = '3';
  find('comment').value = 'my feedback';
  find('consent').checked = true;
  lab.find(form, (item) => item.name === 'barrier' && item.value === 'feedback').checked = true;
  let count = 0;
  lab.setRoute((call) => {
    if (call.method !== 'POST' || !call.url.endsWith('/feedback')) return undefined;
    count += 1;
    return count === 1 ? Promise.reject(new Error('TEMPORARY')) : undefined;
  });
  await form.emit('submit');
  assert.match(form.textContent, /TEMPORARY/);
  assert.equal(find('comment').value, 'my feedback');
  await form.emit('submit');
  await lab.flush();
  const writes = lab.calls.filter((call) => call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.requestKey, writes[1].body.requestKey);
  assert.equal(writes[0].body.consent, true);
  assert.equal(find('comment').value, '');
});
test('administrator report ignores individual text, ids and usernames even if an unexpected response includes them', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            feedback: {
              responseCount: 3,
              respondentCount: 2,
              registeredUserCount: 100,
              responseCoverage: 0.02,
              helpfulness: { suppressed: true },
              comments: ['PRIVATE_COMMENT'],
            },
            users: [{ username: 'PRIVATE_USER', answer: 'PRIVATE_ANSWER' }],
            limitations: ['仅描述观察结果。'],
            studies: [
              {
                title: '研究',
                participantCount: 2,
                questionVersion: 'v1',
                stages: [
                  {
                    phase: 'baseline',
                    submittedCount: 1,
                    missingCount: 1,
                    independentCount: 1,
                    assistedCount: 0,
                    meanPercent: 100,
                    suppressed: true,
                  },
                ],
                paired: { pairCount: 0, meanChange: null, suppressed: true },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  assert.doesNotMatch(lab.admin.textContent, /PRIVATE_COMMENT|PRIVATE_USER|PRIVATE_ANSWER/);
  assert.match(lab.admin.textContent, /样本不足/);
  assert.match(lab.admin.textContent, /2.0%/);
  assert.match(lab.admin.textContent, /不是平台造成提升的因果证明/);
});
test('study attempt sends answers and declared assistance, never a client score or star operation', async () => {
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/studies')
        ? Promise.resolve({
            studies: [
              {
                id: 'study1',
                title: '知识保持',
                enrolled: true,
                nextPhase: 'baseline',
                questions: [
                  {
                    id: 'B1',
                    prompt: '题干',
                    options: [
                      { id: 'a', label: 'A' },
                      { id: 'b', label: 'B' },
                    ],
                  },
                ],
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const form = lab.find(lab.personal, (item) => item.dataset.researchPhase === 'baseline');
  lab.find(form, (item) => item.type === 'radio' && item.value === 'b').checked = true;
  lab.find(form, (item) => item.tagName === 'SELECT').value = 'max';
  await form.emit('submit');
  const call = lab.calls.find((item) => item.url.endsWith('/attempts'));
  assert.equal(call.body.phase, 'baseline');
  assert.deepEqual(call.body.answers, { B1: 'b' });
  assert.equal(call.body.assistance, 'max');
  assert.equal(call.body.score, undefined);
  assert.equal(
    lab.calls.some((item) => /stars|assessment/.test(item.url)),
    false,
  );
});

test('joining research requires an active voluntary choice and a changed goal gets a new retry key', async () => {
  const lab = browser({
    route: (call) => {
      if (call.url.endsWith('/studies'))
        return Promise.resolve({
          studies: [{ id: 'join-study', title: '可选择参加', enrolled: false, questions: [] }],
        });
      if (call.url.endsWith('/join')) return Promise.reject(new Error('暂时不可用'));
      return undefined;
    },
  });
  await lab.flush();
  const submit = lab.find(lab.personal, (item) => item.dataset.researchAction === 'study-join');
  const form = submit.parentNode;
  const goal = lab.find(form, (item) => item.tagName === 'SELECT');
  const agreement = lab.find(form, (item) => item.type === 'checkbox');
  assert.match(lab.personal.textContent, /自愿参与，不计入课程成绩或星标/);
  assert.equal(
    lab.calls.some((call) => call.method === 'POST'),
    false,
  );
  goal.value = 'explore';
  await form.emit('submit');
  assert.equal(
    lab.calls.some((call) => call.method === 'POST'),
    false,
  );
  agreement.checked = true;
  await form.emit('submit');
  assert.match(form.textContent, /暂时不可用/);
  assert.equal(goal.value, 'explore');
  assert.equal(submit.disabled, false);
  await form.emit('submit');
  goal.value = 'practice';
  await form.emit('submit');
  const writes = lab.calls.filter((call) => call.url.endsWith('/join'));
  assert.equal(writes.length, 3);
  assert.equal(writes[0].body.requestKey, writes[1].body.requestKey);
  assert.notEqual(writes[1].body.requestKey, writes[2].body.requestKey);
  assert.equal(writes[2].body.goal, 'practice');
  assert.equal(writes[2].body.consent, true);
  assert.equal(writes[2].body.score, undefined);
});

test('a student can pause unanswered research and must declare assistance before a complete submission', async () => {
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/studies')
        ? Promise.resolve({
            studies: [
              {
                id: 'pause-study',
                title: '阶段任务',
                enrolled: true,
                nextPhase: 'post',
                questions: [
                  {
                    id: 'P1',
                    prompt: '问题',
                    options: [
                      { id: 'a', label: 'A' },
                      { id: 'b', label: 'B' },
                    ],
                  },
                ],
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const form = lab.find(lab.personal, (item) => item.dataset.researchPhase === 'post');
  await form.emit('submit');
  assert.match(form.textContent, /也可以稍后回来/);
  assert.equal(
    lab.calls.some((call) => call.url.endsWith('/attempts')),
    false,
  );
  lab.find(form, (item) => item.type === 'radio' && item.value === 'a').checked = true;
  await form.emit('submit');
  assert.match(form.textContent, /请选择这次作答是否借助帮助/);
  assert.equal(
    lab.calls.some((call) => call.url.endsWith('/attempts')),
    false,
  );
});

test('declining a research withdrawal preserves records and a failed withdrawal can be retried', async () => {
  const lab = browser({
    route: (call) => {
      if (call.url.endsWith('/studies'))
        return Promise.resolve({
          studies: [
            {
              id: 'keep-study',
              title: '已参加研究',
              enrolled: true,
              nextPhase: null,
              questions: [],
            },
          ],
        });
      if (call.method === 'DELETE') return Promise.reject(new Error('删除未完成'));
      return undefined;
    },
  });
  await lab.flush();
  const withdraw = lab.find(
    lab.personal,
    (item) => item.dataset.researchAction === 'study-withdraw',
  );
  lab.window.confirm = () => false;
  await withdraw.emit('click');
  assert.equal(
    lab.calls.some((call) => call.method === 'DELETE'),
    false,
  );
  lab.window.confirm = () => true;
  await withdraw.emit('click');
  assert.equal(withdraw.disabled, false);
  assert.match(lab.personal.textContent, /删除未完成/);
  assert.match(lab.personal.textContent, /已参加研究/);
  await withdraw.emit('click');
  assert.equal(lab.calls.filter((call) => call.method === 'DELETE').length, 2);
});
test('future stages remain unavailable without server-provided current questions', async () => {
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/studies')
        ? Promise.resolve({
            studies: [
              {
                id: 'study2',
                title: '间隔复查',
                enrolled: true,
                nextPhase: 'delayed',
                availableAt: '2026-10-12T01:00:00Z',
                questions: [],
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  assert.match(lab.personal.textContent, /后开放/);
  assert.equal(
    lab.find(lab.personal, (item) => item.dataset.researchAction === 'study-attempt'),
    undefined,
  );
});
test('valid question identifiers matching object prototype names remain ordinary answer keys', async () => {
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/studies')
        ? Promise.resolve({
            studies: [
              {
                id: 'study-proto',
                title: '编号兼容',
                enrolled: true,
                nextPhase: 'baseline',
                questions: [
                  {
                    id: '__proto__',
                    prompt: 'Question',
                    options: [
                      { id: 'a', label: 'A' },
                      { id: 'b', label: 'B' },
                    ],
                  },
                ],
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const form = lab.find(lab.personal, (item) => item.dataset.researchPhase === 'baseline');
  lab.find(form, (item) => item.type === 'radio' && item.value === 'a').checked = true;
  lab.find(form, (item) => item.tagName === 'SELECT').value = 'none';
  await form.emit('submit');
  const write = lab.calls.find((call) => call.url.endsWith('/attempts'));
  assert.equal(Object.hasOwn(write.body.answers, '__proto__'), true);
  assert.equal(Object.getOwnPropertyDescriptor(write.body.answers, '__proto__').value, 'a');
});
test('owner may withdraw research and its stage records without changing formal learning records', async () => {
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/studies')
        ? Promise.resolve({
            studies: [
              {
                id: 'study3',
                title: '学习发展',
                enrolled: true,
                nextPhase: null,
                questions: [],
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const withdraw = lab.find(
    lab.personal,
    (item) => item.dataset.researchAction === 'study-withdraw',
  );
  await withdraw.emit('click');
  const write = lab.calls.find((call) => call.method === 'DELETE');
  assert.equal(write.url, '/learning/research/studies/study3/participation');
  assert.equal(
    lab.calls.some((call) => /assessment|stars|workspace/.test(call.url)),
    false,
  );
});
test('research publication sends the versioned four-phase definition without inventing client results', async () => {
  const lab = browser({ admin: true });
  await lab.flush();
  const submit = lab.find(lab.admin, (item) => item.dataset.researchAction === 'study-create');
  const form = submit.parentNode;
  const fields = ['title', 'description', 'knowledgeTarget', 'comparability', 'selectionNote'];
  fields.forEach((name) => {
    lab.find(form, (item) => item.name === name).value = `${name} value`;
  });
  lab.find(form, (item) => item.name === 'questionVersion').value = 'v1';
  lab.find(form, (item) => item.name === 'minDelayedHours').value = '48';
  lab.find(form, (item) => item.name === 'module' && item.value === 'learning').checked = true;
  for (const phase of ['baseline', 'post', 'delayed', 'transfer']) {
    lab.find(form, (item) => item.name === phase).value = JSON.stringify([
      {
        id: 'Q1',
        prompt: 'A research question',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        correctOption: 'a',
      },
    ]);
  }
  await form.emit('submit');
  const write = lab.calls.find((call) => call.method === 'POST' && call.url.endsWith('/studies'));
  assert.equal(write.body.questionVersion, 'v1');
  assert.equal(write.body.minDelayedHours, 48);
  assert.deepEqual(write.body.modules, ['learning']);
  assert.equal(write.body.phases.transfer[0].correctOption, 'a');
  assert.equal(write.body.participantCount, undefined);
  assert.equal(write.body.score, undefined);
  assert.ok(lab.calls.filter((call) => call.url.includes('/admin')).length >= 2);
});
test('malformed task JSON is explained beside the publication form without a write', async () => {
  const lab = browser({ admin: true });
  await lab.flush();
  const submit = lab.find(lab.admin, (item) => item.dataset.researchAction === 'study-create');
  const form = submit.parentNode;
  lab.find(form, (item) => item.name === 'baseline').value = 'not json';
  await form.emit('submit');
  assert.match(form.textContent, /请检查题目 JSON/);
  assert.equal(
    lab.calls.some((call) => call.method === 'POST'),
    false,
  );
});
test('large feedback lists render in batches without changing totals or requesting private text from admins', async () => {
  const records = Array.from({ length: 65 }, (_, index) => ({
    id: String(index + 1),
    module: 'learning',
    purpose: 'practice',
    helpfulness: 2,
    barriers: ['technical'],
    comment: `NOTE-${index}`,
  }));
  const lab = browser({
    route: (call) =>
      call.url.endsWith('/me')
        ? Promise.resolve({ feedback: records, enrollments: [] })
        : undefined,
  });
  await lab.flush();
  assert.match(lab.personal.textContent, /65 条/);
  assert.equal(
    descend(lab.personal).filter((item) => item.dataset.researchAction === 'feedback-delete')
      .length,
    30,
  );
  const more = lab.find(lab.personal, (item) => item.dataset.researchAction === 'feedback-more');
  await more.emit('click');
  assert.equal(
    descend(lab.personal).filter((item) => item.dataset.researchAction === 'feedback-delete')
      .length,
    60,
  );
  await more.emit('click');
  assert.equal(
    descend(lab.personal).filter((item) => item.dataset.researchAction === 'feedback-delete')
      .length,
    65,
  );
  assert.equal(more.hidden, true);
});
test('development feedback is optional and explicit no-change unchecks other outcomes', async () => {
  const lab = browser();
  await lab.flush();
  const form = lab.find(lab.personal, (item) => item.tagName === 'FORM');
  const choice = (value) =>
    lab.find(form, (item) => item.name === 'outcome' && item.value === value);
  choice('clarity').checked = true;
  choice('direction').checked = true;
  choice('none').checked = true;
  await choice('none').emit('change');
  assert.equal(choice('clarity').checked, false);
  assert.equal(choice('direction').checked, false);
  choice('clarity').checked = true;
  await choice('clarity').emit('change');
  assert.equal(choice('none').checked, false);
  assert.equal(choice('clarity').required, false);
});
test('strategy view names self-reported change and exposes retained cohort separately from recent activity selection', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            feedback: {
              byOutcome: [{ outcome: 'independence', respondentCount: 1, responseCount: 2 }],
              outcomeRespondentCount: 1,
              outcomeResponseCount: 2,
              outcomesUnknownResponseCount: 3,
            },
            studies: [
              {
                id: 'S',
                title: '研究',
                questionVersion: 'v1',
                participantCount: 2,
                stages: [],
                paired: { pairCount: 0 },
                retainedCohort: {
                  participantCount: 6,
                  stages: [{ phase: 'post', submittedCount: 2, missingCount: 4 }],
                },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  assert.match(lab.admin.textContent, /能独立推进/);
  assert.match(lab.admin.textContent, /3 条未填写，不能视为/);
  assert.match(lab.admin.textContent, /不是独立作答认证/);
  assert.match(lab.admin.textContent, /保留期内完整参加队列：6 人/);
  assert.match(lab.admin.textContent, /不是完整招募队列的流失率/);
});

test('strategy report keeps help ratings, stage percentages and paired percentage-point changes in distinct units', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            minGroupSize: 5,
            feedback: {
              responseCount: 12,
              respondentCount: 6,
              registeredUserCount: 600,
              responseCoverage: 0.01,
              helpfulness: { mean: 3.75, suppressed: false },
              modules: [
                {
                  module: 'max',
                  respondentCount: 6,
                  responseCount: 12,
                  meanHelpfulness: 3.75,
                  suppressed: false,
                },
              ],
            },
            studies: [
              {
                id: 'unit-study',
                title: '量纲测试',
                questionVersion: 'v2',
                participantCount: 8,
                stages: [
                  {
                    phase: 'post',
                    submittedCount: 7,
                    missingCount: 1,
                    independentCount: 5,
                    assistedCount: 2,
                    meanPercent: 62.5,
                    independentMeanPercent: 70,
                    assistedMeanPercent: null,
                    suppressed: false,
                  },
                ],
                paired: {
                  pairCount: 5,
                  independentPairCount: 5,
                  assistedPairCount: 0,
                  meanChange: -20.5,
                  independentMeanChange: -20.5,
                  assistedMeanChange: null,
                  suppressed: false,
                },
                retention: { pairCount: 0, meanChange: null },
                byGoal: [
                  {
                    goal: 'explore',
                    participantCount: 8,
                    paired: { pairCount: 5, meanChange: -20.5 },
                    retention: { pairCount: 0, meanChange: null },
                  },
                ],
              },
            ],
            dataCoverage: { complete: false, limit: 10000 },
          })
        : undefined,
  });
  await lab.flush();
  const text = lab.admin.textContent;
  assert.match(text, /反馈人数 \/ 注册人数；不是满意度/);
  assert.match(text, /1\.0%/);
  assert.match(text, /3\.75 \/ 4/);
  assert.match(text, /62\.5%/);
  assert.match(text, /-20\.5 个百分点/);
  assert.match(text, /两阶段均自报独立完成/);
  assert.match(text, /样本不足/);
  assert.match(text, /学习后至间隔复查：配对 0 人，平均变化 尚未测量/);
  assert.match(text, /不能用这里的差异判断 Max 的因果效果/);
  assert.match(text, /最多 10000 条记录，汇总不完整/);
  assert.doesNotMatch(text, /93\.75%|-2050/);
});

test('zero help and zero task performance stay zero while missing development responses stay unknown', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            feedback: {
              respondentCount: 5,
              responseCount: 5,
              helpfulness: { mean: 0, suppressed: false },
              outcomeResponseCount: 0,
              outcomeRespondentCount: 0,
              outcomesUnknownResponseCount: 5,
              byOutcome: [],
            },
            studies: [
              {
                title: '真实零分',
                questionVersion: 'v1',
                participantCount: 5,
                stages: [
                  {
                    phase: 'baseline',
                    submittedCount: 5,
                    missingCount: 0,
                    independentCount: 5,
                    assistedCount: 0,
                    meanPercent: 0,
                    suppressed: false,
                  },
                ],
                paired: { pairCount: 0, meanChange: null },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  assert.match(lab.admin.textContent, /0\.00 \/ 4/);
  assert.match(lab.admin.textContent, /0\.0%/);
  assert.match(lab.admin.textContent, /5 条未填写，不能视为“没有变化”/);
  assert.match(lab.admin.textContent, /有前后测配对的 0 人/);
  assert.match(lab.admin.textContent, /配对平均变化：尚未测量/);
});

test('course publication controls remain restricted to actual administrators, not voluntary participants', async () => {
  const lab = browser({ admin: false });
  await lab.flush();
  assert.equal(lab.admin.hidden, true);
  assert.equal(
    lab.find(lab.admin, (item) => item.dataset.researchAction === 'study-create'),
    undefined,
  );
  assert.equal(
    lab.calls.some((call) => call.url.includes('/admin')),
    false,
  );
  assert.match(lab.personal.textContent, /不要求参加/);
});

test('strategy views preserve server-provided readiness categories separately for recent participants and the retained cohort', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            studies: [
              {
                title: '间隔任务开放状态',
                questionVersion: 'v1',
                participantCount: 5,
                stages: [
                  {
                    phase: 'delayed',
                    submittedCount: 2,
                    missingCount: 3,
                    independentCount: 2,
                    assistedCount: 0,
                    meanPercent: null,
                    suppressed: true,
                    eligibility: {
                      eligibleCount: 2,
                      awaitingSubmissionCount: 0,
                      notYetDueCount: 2,
                      missingPrerequisiteCount: 1,
                    },
                  },
                ],
                paired: { pairCount: 0 },
                retainedCohort: {
                  participantCount: 8,
                  stages: [
                    {
                      phase: 'delayed',
                      submittedCount: 4,
                      missingCount: 4,
                      eligibility: {
                        eligibleCount: 6,
                        awaitingSubmissionCount: 2,
                        notYetDueCount: 1,
                        missingPrerequisiteCount: 1,
                      },
                    },
                  ],
                },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const section = lab.find(
    lab.admin,
    (item) => item.tagName === 'SUMMARY' && item.textContent === '本期参与者的未提交情况',
  ).parentNode;
  const selectedRows = descend(section).filter((item) => item.tagName === 'TR');
  assert.deepEqual(
    selectedRows[1].children.map((item) => item.textContent),
    ['间隔复查', '0', '2', '1', '2'],
  );
  const full = lab.find(
    lab.admin,
    (item) => item.tagName === 'H5' && item.textContent === '完整参加队列的未提交情况',
  ).parentNode;
  const fullRows = descend(full).filter((item) => item.tagName === 'TR');
  assert.deepEqual(
    fullRows[1].children.map((item) => item.textContent),
    ['间隔复查', '2', '1', '1', '6'],
  );
  assert.match(section.textContent, /开放状态由服务端判定/);
  assert.match(section.textContent, /不能据此判定流失/);
  assert.match(lab.admin.textContent, /尚未交叉分析/);
  assert.match(lab.admin.textContent, /不能据此比较同一模块对不同需求人群的帮助差异/);
});

test('legacy research responses without readiness fields retain total non-submission without inventing due or attrition counts', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            studies: [
              {
                title: '旧统计响应',
                questionVersion: 'v1',
                participantCount: 4,
                stages: [
                  {
                    phase: 'delayed',
                    submittedCount: 0,
                    missingCount: 4,
                    independentCount: 0,
                    assistedCount: 0,
                    meanPercent: null,
                  },
                ],
                paired: { pairCount: 0 },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  assert.match(lab.admin.textContent, /尚未提交/);
  assert.equal(
    lab.find(
      lab.admin,
      (item) => item.tagName === 'SUMMARY' && item.textContent === '本期参与者的未提交情况',
    ),
    undefined,
  );
  assert.doesNotMatch(lab.admin.textContent, /已可提交但未交|未到开放时间|流失率：/);
});

test('incomplete readiness metadata renders unknown fields instead of silently filling zero', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            studies: [
              {
                title: '缺失字段',
                questionVersion: 'v1',
                participantCount: 1,
                stages: [
                  {
                    phase: 'post',
                    submittedCount: 0,
                    missingCount: 1,
                    independentCount: 0,
                    assistedCount: 0,
                    eligibility: { awaitingSubmissionCount: 1 },
                  },
                ],
                paired: { pairCount: 0 },
              },
            ],
          })
        : undefined,
  });
  await lab.flush();
  const section = lab.find(
    lab.admin,
    (item) => item.tagName === 'SUMMARY' && item.textContent === '本期参与者的未提交情况',
  ).parentNode;
  const rows = descend(section).filter((item) => item.tagName === 'TR');
  assert.deepEqual(
    rows[1].children.map((item) => item.textContent),
    ['学习后', '1', '未提供', '未提供', '未提供'],
  );
});
test('truncated sources mark readiness classification unavailable and never infer missing prerequisites or no-shows', async () => {
  const lab = browser({
    admin: true,
    route: (call) =>
      call.url.includes('/admin')
        ? Promise.resolve({
            studies: [
              {
                title: '研究源已截断',
                questionVersion: 'v1',
                participantCount: 100,
                stages: [
                  {
                    phase: 'delayed',
                    submittedCount: 20,
                    missingCount: 80,
                    independentCount: 20,
                    assistedCount: 0,
                    eligibility: {
                      available: false,
                      eligibleCount: null,
                      awaitingSubmissionCount: null,
                      notYetDueCount: null,
                      missingPrerequisiteCount: null,
                    },
                  },
                ],
                paired: { pairCount: 0 },
              },
            ],
            dataCoverage: { complete: false, limit: 10000 },
          })
        : undefined,
  });
  await lab.flush();
  const section = lab.find(
    lab.admin,
    (item) => item.tagName === 'SUMMARY' && item.textContent === '本期参与者的未提交情况',
  ).parentNode;
  const rows = descend(section).filter((item) => item.tagName === 'TR');
  assert.match(section.textContent, /数据不完整，暂不分类/);
  assert.deepEqual(
    rows[1].children.map((item) => item.textContent),
    ['间隔复查', '未提供', '未提供', '未提供', '未提供'],
  );
  assert.match(lab.admin.textContent, /汇总不完整/);
});

test('UI creates DOM text safely and does not collect unrelated drafts, send AI messages or repeat onboarding', () => {
  assert.doesNotMatch(source, /innerHTML|sendBeacon|localStorage|\/ai\/chat|prompt\(/);
  assert.match(source, /generation === state\.generation/);
  assert.match(source, /mount === host\.dataset\.researchMount/);
  assert.match(source, /request !== revision/);
  assert.match(source, /body: JSON\.stringify\(\{ \.\.\.body, requestKey/);
});
