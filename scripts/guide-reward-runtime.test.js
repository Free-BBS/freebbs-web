const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, emptyProgress } = require('../public/max-guide');

async function settle() {
  for (let i = 0; i < 8; i += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
}

// Model DOM mutation delivery as well as RAF: textContent replaces text nodes even
// when the text is unchanged, and real MutationObservers see those childList writes.
function fixture({ blocked = false, hold = () => false } = {}) {
  const observers = new Set();
  const frames = new Map();
  const listeners = new Map();
  const pending = [];
  const requests = [];
  let frameId = 0;
  let blockerOpen = blocked;
  function mutate(kind = 'childList', attributeName = null) {
    for (const observer of observers) {
      if (!observer.active || observer.queued) continue;
      if (kind === 'attributes' && !observer.options.attributeFilter?.includes(attributeName))
        continue;
      observer.queued = true;
      queueMicrotask(() => {
        observer.queued = false;
        if (observer.active) observer.callback([{ type: kind, attributeName }]);
      });
    }
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.queued = false;
      observers.add(this);
    }

    observe(target, options) {
      this.active = true;
      this.options = options;
    }

    disconnect() {
      this.active = false;
    }
  }
  function node() {
    let text = '';
    return {
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = value;
        mutate();
      },
      setAttribute(name) {
        mutate('attributes', name);
      },
    };
  }
  const status = node();
  const button = node();
  const modal = {
    matches: () => false,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 400, height: 300 }),
  };
  const doc = {
    body: { style: {} },
    head: {},
    visibilityState: 'visible',
    getElementById(id) {
      if (id === 'guide-reward-status') return status;
      if (id === 'guide-reward-claim') return button;
      return null;
    },
    querySelector: (selector) => (selector === 'link[href="/max-guide.css"]' ? {} : null),
    querySelectorAll: () => (blockerOpen ? [modal] : []),
    createElement() {
      throw new Error('A returning member with seen releases must not receive another welcome');
    },
    addEventListener(name, callback) {
      listeners.set(`document:${name}`, callback);
    },
  };
  const location = new URL('https://www.free-bbs.cn/guide');
  const win = {
    location,
    sessionStorage: { getItem: () => null, setItem() {} },
    history: { state: null, replaceState() {} },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    requestAnimationFrame(callback) {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    MutationObserver,
  };
  const app = {
    userState: { isLoggedIn: true, uid: 'member', token: 'member-token' },
    sessionReady: Promise.resolve(),
    async callApi(route, options = {}) {
      requests.push({ route, options });
      if (hold(route))
        await new Promise((resolve, reject) => {
          pending.push(resolve);
          options.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('request aborted'), { name: 'AbortError' })),
            { once: true },
          );
        });
      if (route === '/onboarding/reward')
        return {
          eligible: true,
          claimed: false,
          claimedAt: null,
          amounts: { electric: 10, magnetic: 10 },
        };
      const version = new URL(route, location.origin).searchParams.get('version');
      return {
        ...emptyProgress(version),
        status: 'completed',
        seenAt: '2026-09-21T10:00:00Z',
        completedAt: '2026-09-21T10:00:00Z',
      };
    },
  };
  createController(win, doc, app);
  return {
    status,
    button,
    requests,
    frames,
    sessionChange(user = app.userState) {
      app.userState = user;
      listeners.get('freebbs:session-change')({ detail: { user: app.userState } });
    },
    closeBlocker() {
      blockerOpen = false;
      mutate('attributes', 'class');
    },
    async frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
      await settle();
    },
    release() {
      pending.splice(0).forEach((resolve) => resolve());
    },
    async cleanup() {
      listeners.get('storage')({ key: 'free_bbs_auth_token' });
      pending.splice(0).forEach((resolve) => resolve());
      await settle();
    },
  };
}

test('closing check-in does not let reward DOM updates repeatedly restart deferred initialization', async (t) => {
  let delayed = false;
  const view = fixture({ blocked: true, hold: () => delayed });
  t.after(() => view.cleanup());
  await settle();
  // Closing a check-in modal starts recovery; network responses need more than
  // one animation frame, as they normally do on the deployed website.
  delayed = true;
  view.closeBlocker();
  await settle();
  for (let i = 0; i < 4; i += 1) await view.frame();
  assert.equal(
    view.frames.size,
    0,
    'the deferred observer must not observe its own recovery writes',
  );
  delayed = false;
  view.release();
  await settle();
  await view.frame();
  assert.doesNotMatch(view.status.textContent, /正在确认|正在查询/);
  assert.equal(view.button.disabled, false);
  assert.ok(view.requests.filter((request) => request.route === '/onboarding/reward').length <= 2);
});

test('a same-account balance refresh does not cancel and restart a pending reward read', async (t) => {
  let delayed = true;
  const view = fixture({ hold: (route) => delayed && route === '/onboarding/reward' });
  t.after(() => view.cleanup());
  await settle();
  const original = view.requests.find((request) => request.route === '/onboarding/reward');
  view.sessionChange();
  await settle();
  assert.equal(original.options.signal.aborted, false, 'the uid and token did not change');
  assert.equal(view.requests.filter((request) => request.route === '/onboarding/reward').length, 1);
  delayed = false;
  view.release();
  await settle();
  assert.match(view.status.textContent, /可以领取/);
  assert.equal(view.button.disabled, false);
});

test('an ordinary stalled reward read times out and exposes retry instead of remaining busy', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = fixture({ hold: (route) => route === '/onboarding/reward' });
  t.after(() => view.cleanup());
  await settle();
  const request = view.requests.find((entry) => entry.route === '/onboarding/reward');
  assert.equal(view.button.disabled, true);
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(request.options.signal.aborted, true);
  assert.match(view.status.textContent, /重试查询/);
  assert.equal(view.button.disabled, false);
});

test('a real account change still aborts the old read and uses only the new account credentials', async (t) => {
  let delayed = true;
  const view = fixture({ hold: (route) => delayed && route === '/onboarding/reward' });
  t.after(() => view.cleanup());
  await settle();
  const original = view.requests.find((request) => request.route === '/onboarding/reward');
  delayed = false;
  view.sessionChange({ isLoggedIn: true, uid: 'other', token: 'other-token' });
  await settle();
  const rewards = view.requests.filter((request) => request.route === '/onboarding/reward');
  assert.equal(original.options.signal.aborted, true);
  assert.equal(rewards.length, 2);
  assert.equal(rewards[1].options.headers.Authorization, 'Bearer other-token');
  view.release();
  await settle();
  assert.match(view.status.textContent, /可以领取/);
  assert.equal(view.button.disabled, false);
});
