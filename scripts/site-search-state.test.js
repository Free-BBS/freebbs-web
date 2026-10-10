const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const runtime = require('../public/request-runtime');
const ui = require('../public/ui-state');

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.events = {};
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener(key, callback) {
    this.events[key] = callback;
  }
}

function harness(fetcher, { native = false, degradedUI = false, timeoutMs = 1000 } = {}) {
  const doc = { createElement: (tag) => new Element(tag, doc) };
  const list = doc.createElement('ol');
  const status = doc.createElement('div');
  const source = fs.readFileSync('public/site-search.js', 'utf8');
  const context = {
    window: {
      freeBbsApp: { userState: { uid: 'u_a', token: 'a' } },
      freeBbsUiState: native ? undefined : ui,
      freeBbsRequests: {
        request: (url, options, consume) =>
          runtime.request(url, { ...options, timeoutMs }, consume, fetcher),
      },
    },
    document: doc,
    list,
    status,
    more: { hidden: false },
    input: { value: '卷积' },
    footerLink: {},
    fullPage: false,
    type: 'all',
    offset: 0,
    generation: 0,
    sessionStale: false,
    resultCount: 0,
    controller: undefined,
    timer: undefined,
    updateFilters() {},
    appendResult(result) {
      list.append(result);
    },
    URLSearchParams,
    AbortController,
    clearTimeout,
  };
  if (degradedUI) context.window.freeBbsUiState = { degraded: true, render() {} };
  vm.createContext(context);
  vm.runInContext(
    source.slice(source.indexOf('  const ownerKey'), source.indexOf('  const open =')),
    context,
  );
  return context;
}

// Execute the entire entry point, including its final listener registrations.
// A function slice alone cannot catch duplicated session listeners elsewhere.
function moduleHarness(fetcher, { native = false } = {}) {
  const listeners = new Map();
  const requests = [];
  let storedToken = 'a';
  const doc = {};
  doc.createElement = (tag) => {
    const node = new Element(tag, doc);
    const classes = new Set();
    node.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
    node.style = { setProperty() {}, removeProperty() {} };
    node.focus = () => {};
    node.select = () => {};
    let text = '';
    Object.defineProperty(node, 'textContent', {
      get: () => text || node.children.map((child) => child.textContent || '').join(''),
      set: (value) => {
        text = value;
        node.children = [];
      },
    });
    return node;
  };
  const host = doc.createElement('section');
  const input = doc.createElement('input');
  const form = doc.createElement('form');
  const list = doc.createElement('ol');
  const status = doc.createElement('div');
  const more = doc.createElement('button');
  const nav = doc.createElement('nav');
  const nodes = {
    input,
    form,
    ol: list,
    '.site-search-status': status,
    '.site-search-more': more,
    '[data-close]': doc.createElement('button'),
    '.site-search-footer a': doc.createElement('a'),
    nav,
  };
  host.querySelector = (selector) => nodes[selector];
  host.querySelectorAll = () => nav.children;
  doc.body = doc.createElement('body');
  doc.documentElement = doc.createElement('html');
  doc.getElementById = (id) => (id === 'site-search-page' ? host : null);
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.addEventListener = () => {};
  const storage = { getItem: () => storedToken };
  const window = {
    location: { search: '?q=private', origin: 'http://localhost' },
    history: { replaceState() {} },
    innerHeight: 900,
    localStorage: storage,
    freeBbsApp: { userState: { uid: 'u_a', token: 'a' } },
    freeBbsUiState: native ? undefined : ui,
    freeBbsRequests: {
      request: (url, options, consume) => {
        requests.push({ url, options });
        return runtime.request(url, options, consume, fetcher);
      },
    },
    addEventListener: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
    },
  };
  window.self = window;
  window.top = window;
  function MockMutationObserver() {
    this.observe = () => {};
  }
  const context = {
    window,
    document: doc,
    localStorage: storage,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    MutationObserver: MockMutationObserver,
  };
  vm.runInNewContext(fs.readFileSync('public/site-search.js', 'utf8'), context);
  return {
    window,
    list,
    status,
    more,
    form,
    requests,
    setStoredToken(value) {
      storedToken = value;
    },
    dispatch(event, detail = {}) {
      for (const listener of listeners.get(event) || []) listener(detail);
    },
  };
}

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const response = (results, extra = {}) => ({
  ok: true,
  json: async () => ({ results, hasMore: false, nextOffset: null, ...extra }),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('successful search distinguishes actual results from an empty match', async () => {
  let rows = [{ title: '卷积' }];
  const state = harness(async () => response(rows));
  await state.search();
  assert.equal(state.list.dataset.uiState, 'ready');
  assert.equal(state.status.dataset.uiState, 'ready');
  assert.equal(state.list.children.length, 1);
  rows = [];
  await state.search();
  assert.equal(state.list.dataset.uiState, 'empty');
  assert.equal(state.list.attributes['aria-busy'], 'false');
});

test('initial failure is an alert with an explicit retry rather than an empty result', async () => {
  let failing = true;
  let calls = 0;
  const state = harness(async () => {
    calls += 1;
    if (failing) throw new Error('搜索暂时不可用');
    return response([{ title: '卷积' }]);
  });
  await state.search();
  assert.equal(state.list.dataset.uiState, 'error');
  assert.equal(state.status.children[0].attributes.role, 'alert');
  assert.equal(calls, 1);
  failing = false;
  await state.status.children[0].children[1].events.click();
  assert.equal(calls, 2);
  assert.equal(state.list.dataset.uiState, 'ready');
});

test('failed pagination preserves the visible page and retries exactly the same offset', async () => {
  const offsets = [];
  let failing = true;
  const state = harness(async (url) => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    offsets.push(offset);
    if (offset === 0) return response([{ title: 'A' }], { hasMore: true, nextOffset: 20 });
    if (failing) throw new Error('下一页失败');
    return response([{ title: 'B' }]);
  });
  await state.search();
  await state.search(true);
  assert.equal(state.list.children.length, 1);
  assert.equal(state.offset, 20);
  assert.equal(state.resultCount, 1);
  failing = false;
  await state.status.children[0].children[1].events.click();
  assert.deepEqual(offsets, [0, 20, 20]);
  assert.equal(state.list.children.length, 2);
});

test('a later search wins even when an older fetch ignores cancellation', async () => {
  const old = deferred();
  let calls = 0;
  const state = harness(async () => {
    calls += 1;
    return calls === 1 ? old.promise : response([{ title: 'new' }]);
  });
  const previous = state.search();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await state.search();
  old.resolve(response([{ title: 'old' }]));
  await previous;
  assert.deepEqual(state.list.children, [{ title: 'new' }]);
  assert.equal(state.list.dataset.uiState, 'ready');
});

for (const field of ['uid', 'token']) {
  test(`a late response cannot reveal results after ${field} changes`, async () => {
    const pending = deferred();
    const state = harness(() => pending.promise);
    const loading = state.search();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    state.window.freeBbsApp.userState[field] = 'different';
    pending.resolve(response([{ title: 'private' }]));
    await loading;
    assert.equal(state.list.children.length, 0);
  });
}

test('the shared deadline also ends a stalled response-body read', async () => {
  const state = harness(async () => ({ ok: true, json: () => new Promise(() => {}) }), {
    timeoutMs: 15,
  });
  await state.search();
  assert.equal(state.list.dataset.uiState, 'error');
  assert.equal(state.list.attributes['aria-busy'], 'false');
  assert.match(state.status.children[0].children[0].textContent, /超时/);
});

test('missing presentation assets keep native error and retry feedback usable', async () => {
  const state = harness(async () => response([]), { native: true });
  await state.search();
  assert.equal(state.list.dataset.uiState, 'empty');
  assert.equal(state.status.attributes.role, 'status');
});

test('a degraded presentation asset still installs a native retry with a working click handler', async () => {
  let failing = true;
  let calls = 0;
  const state = harness(
    async () => {
      calls += 1;
      if (failing) throw new Error('搜索暂时不可用');
      return response([{ title: 'recovered' }]);
    },
    { degradedUI: true },
  );
  await state.search();
  assert.equal(state.status.attributes.role, 'alert');
  assert.equal(state.status.children[0].tagName, 'BUTTON');
  failing = false;
  await state.status.children[0].events.click();
  assert.equal(calls, 2);
  assert.equal(state.list.dataset.uiState, 'ready');
});

test('session-change invalidates private results and hidden controls retain native semantics', () => {
  const source = fs.readFileSync('public/site-search.js', 'utf8');
  assert.match(
    source,
    /addEventListener\('freebbs:session-change', \(\) => \{\s*generation \+= 1;\s*controller\?\.abort\(\);/,
  );
  assert.match(source, /if \(fullPage \|\| host\.open\) search\(\);/);
  assert.match(source, /class="site-search-more bbs-action"[^>]*hidden/);
});

test('the complete search entry point refreshes exactly once for one session-change event', async () => {
  const state = moduleHarness(async () => response([]));
  await flush();
  assert.equal(state.requests.length, 1);
  state.dispatch('freebbs:session-change');
  await flush();
  assert.equal(state.requests.length, 2);
  assert.equal(state.list.dataset.uiState, 'empty');
});

for (const native of [false, true]) {
  for (const key of ['free_bbs_auth_token', null]) {
    test(`cross-tab ${key ?? 'clear-all'} synchronously clears private search and blocks stale requests (${native ? 'native' : 'shared'} feedback)`, async () => {
      const pending = deferred();
      const state = moduleHarness(() => pending.promise, { native });
      await flush();
      state.list.append({ textContent: 'private cached result' });
      assert.equal(state.list.attributes['aria-busy'], 'true');
      state.setStoredToken(null);
      state.dispatch('storage', { key });
      assert.equal(state.list.children.length, 0);
      assert.equal(state.list.attributes['aria-busy'], 'false');
      assert.equal(state.more.hidden, true);
      assert.equal(state.list.dataset.uiState, 'error');
      assert.match(state.status.textContent, /登录状态已变化/);
      state.form.events.submit({ preventDefault() {} });
      await flush();
      assert.equal(state.requests.length, 1);
      pending.resolve(
        response([{ type: 'post', title: 'late private', url: '/discussion?post=old' }]),
      );
      await flush();
      assert.equal(state.list.children.length, 0);
      assert.equal(state.list.dataset.uiState, 'error');
    });
  }
}

test('search waits for the fresh session after a cross-tab token switch, then uses only that token', async () => {
  const state = moduleHarness(async () => response([]));
  await flush();
  state.setStoredToken('b');
  state.dispatch('storage', { key: 'free_bbs_auth_token' });
  state.form.events.submit({ preventDefault() {} });
  await flush();
  assert.equal(state.requests.length, 1);
  state.window.freeBbsApp.userState = { uid: 'u_b', token: 'b' };
  state.dispatch('freebbs:session-change');
  await flush();
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[1].options.headers.Authorization, 'Bearer b');
  assert.equal(state.list.dataset.uiState, 'empty');
});

test('unrelated storage writes do not discard search results or initiate another request', async () => {
  const state = moduleHarness(async () =>
    response([{ type: 'post', title: 'public result', url: '/discussion?post=public' }]),
  );
  await flush();
  assert.equal(state.list.children.length, 1);
  state.dispatch('storage', { key: 'free_bbs_theme' });
  assert.equal(state.list.children.length, 1);
  assert.equal(state.requests.length, 1);
  assert.equal(state.list.dataset.uiState, 'ready');
});
