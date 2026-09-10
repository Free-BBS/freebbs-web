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
  function button(label) {
    const search = (node) =>
      node.tag === 'button' && node.textContent === label
        ? node
        : node.children.map(search).find(Boolean);
    return search(get('survey-list'));
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
