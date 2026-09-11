const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

class Element {
  constructor(tag = 'div', text = '') {
    this.tag = tag;
    this.children = [];
    this.text = text;
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.querySelectorAll = () => [];
    this.reset = () => {};
    this.scrollIntoView = () => {};
    const classes = new Set();
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    };
  }

  get textContent() {
    return String(this.text) + this.children.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    this.text = value;
    this.children = [];
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.text = '';
    this.children = nodes;
  }
}
const activity = {
  id: 'one',
  title: '测试活动',
  status: 'drawn',
  opensAt: '2026-01-01',
  closesAt: '2026-01-02',
  drawnAt: '2026-01-02',
  drawnBy: '1',
  entryCount: 1,
  winnerCount: 1,
  drawMode: 'manual',
  questions: [{ id: 'q1', label: '姓名' }],
};
const privateEntries = {
  entries: [
    {
      contact: 'private@example.test',
      answers: { q1: 'PRIVATE_ANSWER' },
      winner: 1,
      created_at: '2026-01-01',
    },
  ],
};
const source = fs.readFileSync('public/system-settings-surveys.js', 'utf8');
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
function harness() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const listeners = new Map();
  const downloads = [];
  const requests = [];
  let token = 'admin';
  let reject = false;
  let deferred = null;
  const pendingResponses = new Map();
  const window = {
    location: { origin: 'https://site.test' },
    addEventListener: (event, handler) => listeners.set(event, handler),
    SurveyUI: {
      api: async (path) => {
        requests.push(path);
        if (reject || token !== 'admin') {
          const error = new Error('需要管理员权限');
          error.status = 403;
          throw error;
        }
        const pending = pendingResponses.get(path)?.shift();
        if (pending) return pending;
        if (path.endsWith('/entries')) return deferred || privateEntries;
        const page = Number(new URL(path, 'https://site.test').searchParams.get('page') || 0);
        return {
          surveys: [page ? { ...activity, id: 'old', title: '旧活动' } : activity],
          page,
          nextPage: page === 0 ? 1 : null,
        };
      },
      el: (tag, text = '') => new Element(tag, text),
      message: (text) => {
        get('message').textContent = text;
      },
      date: (value) => value,
      status: () => '已抽签',
      download: (...args) => downloads.push(args),
    },
  };
  vm.runInNewContext(source, {
    window,
    document: { getElementById: get },
    localStorage: { getItem: () => token },
    Date,
    URL,
    navigator: {},
  });
  function button(label, index = 0) {
    const search = (node) =>
      node.tag === 'button' && node.textContent === label ? [node] : node.children.flatMap(search);
    return search(get('survey-list'))[index];
  }
  const change = (value) => {
    token = value;
    listeners.get('freebbs:session-change')({
      detail: { user: value === 'admin' ? { isAdmin: true } : null },
    });
  };
  function assertCleared() {
    assert.equal(get('admin-content').hidden, true);
    assert.equal(get('entries-table').textContent, '');
    assert.equal(get('draw-audit').textContent, '');
    assert.equal(get('entries-panel').hidden, true);
    assert.equal(get('survey-list').textContent, '');
    assert.equal(get('export').onclick, null);
    assert.equal(get('export').disabled, true);
  }
  return {
    get,
    button,
    change,
    downloads,
    requests,
    assertCleared,
    listeners,
    defer(path) {
      let resolve;
      let rejectResponse;
      const promise = new Promise((done, fail) => {
        resolve = done;
        rejectResponse = fail;
      });
      const queue = pendingResponses.get(path) || [];
      queue.push(promise);
      pendingResponses.set(path, queue);
      return { resolve, reject: rejectResponse };
    },
    deny: () => {
      reject = true;
    },
    deferEntries: (promise) => {
      deferred = promise;
    },
  };
}

test('logout clears private answers and export callback; retained callbacks cannot export', async () => {
  const h = harness();
  await flush();
  await h.button('查看中签名单 / 导出').onclick();
  assert.match(h.get('entries-table').textContent, /PRIVATE_ANSWER/);
  const oldExport = h.get('export').onclick;
  h.change('');
  h.assertCleared();
  await oldExport();
  assert.equal(h.downloads.length, 0);
});
test('403 on refresh clears previously visible data', async () => {
  const h = harness();
  await flush();
  await h.button('查看中签名单 / 导出').onclick();
  h.deny();
  await h.get('refresh').onclick();
  h.assertCleared();
});
test('export rechecks server permission and clears the page on revocation', async () => {
  const h = harness();
  await flush();
  await h.button('查看中签名单 / 导出').onclick();
  await h.get('export').onclick();
  assert.equal(h.downloads.length, 1);
  h.deny();
  await h.get('export').onclick();
  h.assertCleared();
  assert.equal(h.downloads.length, 1);
});
test('a late entries response cannot restore data after logout', async () => {
  const h = harness();
  await flush();
  let resolve;
  h.deferEntries(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = h.button('查看中签名单 / 导出').onclick();
  h.change('');
  resolve(privateEntries);
  await pending;
  h.assertCleared();
});
test('cross-tab changes and back-forward caching clear private details', async () => {
  for (const event of ['storage', 'pagehide']) {
    const h = harness();
    await flush();
    await h.button('查看中签名单 / 导出').onclick();
    h.listeners.get(event)({ key: 'free_bbs_auth_token' });
    assert.equal(h.get('entries-table').textContent, '');
    assert.equal(h.get('export').onclick, null);
  }
});
test('management pagination exposes older activities and can return to the first page', async () => {
  const h = harness();
  await flush();
  await h.get('next-page').onclick();
  await flush();
  assert.match(h.get('survey-list').textContent, /旧活动/);
  assert.equal(h.get('page-status').textContent, '第 2 页');
  assert.equal(h.get('next-page').disabled, true);
  await h.get('previous-page').onclick();
  await flush();
  assert.equal(h.get('page-status').textContent, '第 1 页');
});
test('management content participates in the shared permission container', () => {
  assert.match(
    fs.readFileSync('public/system-settings-surveys.html', 'utf8'),
    /id="admin-content"[^>]*data-admin-content/,
  );
});

function pageData(page, surveys = [{ ...activity, id: `page-${page}`, title: `活动页 ${page}` }]) {
  return { surveys, page, nextPage: page < 2 ? page + 1 : null };
}

test('the last navigation wins when next and previous page responses arrive out of order', async () => {
  const h = harness();
  await flush();
  const second = h.defer('/admin/surveys?page=1');
  h.get('next-page').onclick();
  second.resolve(pageData(1));
  await flush();
  const older = h.defer('/admin/surveys?page=2');
  h.get('next-page').onclick();
  const latest = h.defer('/admin/surveys?page=0');
  h.get('previous-page').onclick();
  latest.resolve(pageData(0));
  await flush();
  older.resolve(pageData(2));
  await flush();
  assert.equal(h.get('page-status').textContent, '第 1 页');
  assert.match(h.get('survey-list').textContent, /活动页 0/);
  assert.equal(h.get('previous-page').disabled, true);
  assert.equal(h.get('next-page').disabled, false);
});

test('a failed latest navigation does not allow an older response to take over', async () => {
  const h = harness();
  await flush();
  const older = h.defer('/admin/surveys?page=1');
  h.get('next-page').onclick();
  const latest = h.defer('/admin/surveys?page=0');
  const refresh = h.get('refresh').onclick();
  latest.reject(new Error('刷新失败，请重试'));
  await refresh;
  older.resolve(pageData(1));
  await flush();
  assert.equal(h.get('page-status').textContent, '第 1 页');
  assert.match(h.get('message').textContent, /刷新失败/);
  await h.get('refresh').onclick();
  assert.match(h.get('survey-list').textContent, /测试活动/);
});

test('obsolete ordinary errors are quiet but an obsolete 403 still clears private data', async () => {
  for (const status of [500, 403]) {
    const h = harness();
    await flush();
    await h.button('查看中签名单 / 导出').onclick();
    const older = h.defer('/admin/surveys?page=0');
    const first = h.get('refresh').onclick();
    await h.get('refresh').onclick();
    older.reject(Object.assign(new Error('OLD_RESPONSE_ERROR'), { status }));
    await first;
    if (status === 403) h.assertCleared();
    else {
      assert.equal(h.get('admin-content').hidden, false);
      assert.doesNotMatch(h.get('message').textContent, /OLD_RESPONSE_ERROR/);
    }
  }
});

for (const action of ['close-entries', 'next-page', 'refresh']) {
  test(`${action} invalidates late details and their errors`, async () => {
    for (const fail of [false, true]) {
      const h = harness();
      await flush();
      const response = h.defer('/admin/surveys/one/entries');
      const pending = h.button('查看中签名单 / 导出').onclick();
      await h.get(action).onclick();
      await flush();
      if (fail) response.reject(new Error('OLD_DETAILS_ERROR'));
      else response.resolve(privateEntries);
      await pending;
      assert.equal(h.get('entries-panel').hidden, true);
      assert.equal(h.get('entries-table').textContent, '');
      assert.equal(h.get('export').onclick, null);
      assert.doesNotMatch(h.get('message').textContent, /OLD_DETAILS_ERROR/);
    }
  });
}

test('selecting a second activity prevents the first details from overwriting it', async () => {
  const h = harness();
  await flush();
  const list = h.defer('/admin/surveys?page=0');
  const refresh = h.get('refresh').onclick();
  list.resolve(pageData(0, [activity, { ...activity, id: 'two', title: '第二个活动' }]));
  await refresh;
  const first = h.defer('/admin/surveys/one/entries');
  const second = h.defer('/admin/surveys/two/entries');
  const oldDetails = h.button('查看中签名单 / 导出', 0).onclick();
  const newDetails = h.button('查看中签名单 / 导出', 1).onclick();
  const newEntries = {
    entries: [{ ...privateEntries.entries[0], answers: { q1: 'SECOND_ANSWER' } }],
  };
  second.resolve(newEntries);
  await newDetails;
  first.resolve(privateEntries);
  await oldDetails;
  assert.match(h.get('entries-table').textContent, /SECOND_ANSWER/);
  assert.doesNotMatch(h.get('entries-table').textContent, /PRIVATE_ANSWER/);
  const exportResponse = h.defer('/admin/surveys/two/entries');
  const exporting = h.get('export').onclick();
  exportResponse.resolve(newEntries);
  await exporting;
  assert.equal(h.downloads[0][0], '活动-two.csv');
  assert.match(h.downloads[0][1], /SECOND_ANSWER/);
});

test('details opened from the old list while paging cannot reappear after the new list arrives', async () => {
  const h = harness();
  await flush();
  const page = h.defer('/admin/surveys?page=1');
  h.get('next-page').onclick();
  const details = h.defer('/admin/surveys/one/entries');
  const pending = h.button('查看中签名单 / 导出').onclick();
  page.resolve(pageData(1));
  await flush();
  details.resolve(privateEntries);
  await pending;
  assert.equal(h.get('page-status').textContent, '第 2 页');
  assert.equal(h.get('entries-panel').hidden, true);
  assert.equal(h.get('entries-table').textContent, '');
});

for (const action of ['close-entries', 'next-page', 'refresh']) {
  test(`${action} invalidates pending exports and retained callbacks`, async () => {
    const h = harness();
    await flush();
    await h.button('查看中签名单 / 导出').onclick();
    const oldExport = h.get('export').onclick;
    const response = h.defer('/admin/surveys/one/entries');
    const pending = oldExport();
    await h.get(action).onclick();
    await flush();
    response.resolve(privateEntries);
    await pending;
    const requestCount = h.requests.length;
    assert.equal(h.get('export').disabled, true);
    await oldExport();
    assert.equal(h.requests.length, requestCount);
    assert.equal(h.downloads.length, 0);
  });
}
