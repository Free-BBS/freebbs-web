/* eslint-disable max-classes-per-file -- Native DOM and observer adapters are isolated to this fixture. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createController,
  STEPS,
  VERSION,
  emptyProgress,
  stepsFor,
} = require('../public/max-guide');
const { LATEST_RELEASE } = require('../public/max-guide-releases');
const { mergeProgress } = require('../backend/onboarding');

const fixed = Date.parse('2026-09-21T10:00:00Z');
const stamp = new Date(fixed).toISOString();
const indexOf = (id, version = VERSION) => stepsFor(version).findIndex((step) => step.id === id);
const tick = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
async function settle() {
  // The client serializes saves and the controller schedules several continuations.
  for (let i = 0; i < 8; i += 1) await tick();
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// A deliberately small, dependency-free DOM adapter. It models native dialog,
// event dispatch, focus, visibility and selector-controlled app views; it does
// not emulate rendering (the real-browser and geometry suites cover layout).
function fixture({
  href = '/guide',
  member = true,
  states = {},
  beforeRequest,
  setup,
  sessionReady = Promise.resolve(),
} = {}) {
  const events = [];
  const nodes = [];
  const selectors = new Map();
  const memory = new Map();
  const listeners = new Map();
  const frames = new Map();
  let frameId = 0;
  let doc;
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.listeners = new Map();
      this.attributes = new Map();
      this.style = {};
      this.dataset = {};
      this.className = '';
      this.hidden = false;
      this.disabled = false;
      this.open = false;
      this.isConnected = true;
      this.classList = {
        contains: (name) => this.className.split(' ').includes(name),
        add: (...names) => {
          this.className = [...new Set([...this.className.split(' '), ...names])]
            .filter(Boolean)
            .join(' ');
        },
        remove: (...names) => {
          this.className = this.className
            .split(' ')
            .filter((name) => !names.includes(name))
            .join(' ');
        },
        toggle: (name, force) => {
          const enabled = force ?? !this.classList.contains(name);
          this.classList[enabled ? 'add' : 'remove'](name);
          return enabled;
        },
      };
      nodes.push(this);
    }

    append(...children) {
      children.forEach((child) => {
        Object.assign(child, { parent: this });
        this.children.push(child);
      });
    }

    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }

    before(node) {
      this.parent?.append(node);
    }

    after(node) {
      this.parent?.append(node);
    }

    setAttribute(key, value) {
      this.attributes.set(key, value);
    }

    getAttribute(key) {
      return this.attributes.get(key) ?? this[key] ?? null;
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    fire(type, extra = {}) {
      const event = {
        target: this,
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...extra,
      };
      for (const handler of this.listeners.get(type) || []) handler(event);
      return event;
    }

    click() {
      if (this.disabled) return;
      events.push({ type: 'click', node: this.id || this.className });
      this.onClick?.();
      this.fire('click');
    }

    contains(other) {
      return this === other || this.children.some((child) => child.contains(other));
    }

    closest(selector) {
      if (selector.includes('[hidden]') || selector.includes('.hidden')) {
        if (
          this.hidden ||
          this.classList.contains('hidden') ||
          this.getAttribute('aria-hidden') === 'true'
        )
          return this;
        return this.parent?.closest(selector) || null;
      }
      return this.matches(selector) ? this : this.parent?.closest(selector) || null;
    }

    matches(selector) {
      if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
      if (selector === 'details.personal-fold')
        return this.tagName === 'DETAILS' && this.classList.contains('personal-fold');
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (/^\.[\w-]+$/.test(selector)) return this.classList.contains(selector.slice(1));
      const data = selector.match(/^\[data-([\w-]+)\]$/);
      if (data)
        return Object.hasOwn(
          this.dataset,
          data[1].replace(/-([a-z])/g, (unused, char) => char.toUpperCase()),
        );
      return this.tagName.toLowerCase() === selector;
    }

    getBoundingClientRect() {
      const fold = this.closest('details.personal-fold');
      if (
        this.hidden ||
        (this.tagName === 'DIALOG' && !this.open) ||
        (fold && fold !== this && !fold.open && this.tagName !== 'SUMMARY')
      )
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      return this.rect || { left: 40, top: 80, right: 400, bottom: 240, width: 360, height: 160 };
    }

    focus() {
      doc.activeElement = this;
    }

    scrollIntoView() {
      events.push({ type: 'scroll-target', node: this.id || this.className });
    }

    showModal() {
      this.open = true;
      events.push({ type: 'show-modal', node: this.id || this.className });
    }

    close() {
      this.open = false;
      events.push({ type: 'close-modal', node: this.id || this.className });
    }
  }
  const body = new Node('body');
  body.style.overflow = 'auto';
  doc = {
    body,
    head: new Node('head'),
    activeElement: new Node('button'),
    visibilityState: 'visible',
    createElement: (tag) => new Node(tag),
    getElementById: (id) => nodes.find((node) => node.id === id) || null,
    querySelectorAll(selector) {
      if (selectors.has(selector)) {
        const value = selectors.get(selector);
        return typeof value === 'function' ? value() : [value];
      }
      if (selector.includes('dialog[open],'))
        return nodes.filter((node) => node.tagName === 'DIALOG' && node.open);
      return nodes.filter((node) => node.matches(selector));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, fn) {
      listeners.set(`document:${type}`, fn);
    },
  };
  const location = new URL(href, 'https://www.free-bbs.cn');
  location.assign = (url) => {
    events.push({ type: 'navigate', url });
  };
  location.reload = () => {
    events.push({ type: 'reload' });
  };
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
    }

    observe() {
      this.active = true;
    }

    disconnect() {
      this.active = false;
    }
  }
  const win = {
    location,
    innerWidth: 1440,
    innerHeight: 900,
    sessionStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    },
    history: {
      state: null,
      replaceState(state, unused, url) {
        location.href = new URL(url, location.origin).href;
      },
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    requestAnimationFrame(fn) {
      frameId += 1;
      frames.set(frameId, fn);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    scrollBy() {},
    setTimeout,
    MutationObserver: Observer,
    ResizeObserver: Observer,
  };
  const server = new Map(
    [VERSION, LATEST_RELEASE.id].map((version) => [
      version,
      { ...emptyProgress(version), seenAt: stamp, ...states[version] },
    ]),
  );
  for (const [version, value] of Object.entries(states)) {
    if (!server.has(version)) server.set(version, { ...emptyProgress(version), ...value });
  }
  const rewardReceipts = new Map();
  const app = {
    userState: member ? { isLoggedIn: true, uid: 'member', token: 'member-token' } : {},
    sessionReady,
    async callApi(route, options = {}) {
      const version = new URL(route, location.origin).searchParams.get('version');
      const method = options.method || 'GET';
      const patch = options.body ? JSON.parse(options.body) : null;
      events.push({ type: 'request', route, method, version, patch });
      await beforeRequest?.({ route, method, version, patch, options });
      const token = options.headers?.Authorization?.replace(/^Bearer /, '');
      if (route === '/onboarding/reward') {
        const eligible = [VERSION, 'max-v1'].some((id) => Boolean(server.get(id)?.completedAt));
        const awarded = method === 'POST' && !rewardReceipts.has(token);
        if (method === 'POST') {
          assert.deepEqual(patch, {}, 'the server alone chooses the owner and reward amounts');
          if (!eligible) throw Object.assign(new Error('完整导览尚未完成'), { status: 409 });
          if (awarded) rewardReceipts.set(token, stamp);
        }
        return {
          eligible,
          claimed: rewardReceipts.has(token),
          claimedAt: rewardReceipts.get(token) || null,
          amounts: { electric: 10, magnetic: 10 },
          ...(method === 'POST' ? { awarded } : {}),
        };
      }
      if (route === '/auth/me')
        return {
          user: {
            uid: token.replace(/-token$/, ''),
            electrons: rewardReceipts.has(token) ? 10 : 0,
            manetrons: rewardReceipts.has(token) ? 10 : 0,
          },
        };
      if (!server.has(version)) server.set(version, emptyProgress(version));
      if (method === 'PATCH') server.set(version, mergeProgress(server.get(version), patch, fixed));
      return structuredClone(server.get(version));
    },
    syncWallet(user, token) {
      if (app.userState.uid !== user.uid || app.userState.token !== token) return false;
      events.push({ type: 'sync-wallet', user, token });
      Object.assign(app.userState, user);
      return true;
    },
  };
  const value = {
    win,
    doc,
    app,
    events,
    nodes,
    selectors,
    server,
    rewardReceipts,
    memory,
    listeners,
    node(selector, { tag = 'div', click, rect } = {}) {
      const node = new Node(tag);
      if (selector.startsWith('#') && /^#[\w-]+$/.test(selector)) node.id = selector.slice(1);
      node.onClick = click;
      node.rect = rect;
      selectors.set(selector, node);
      body.append(node);
      return node;
    },
    get dialog() {
      return nodes.find((node) => node.classList.contains('max-tour'));
    },
    get next() {
      return nodes.find((node) => node.classList.contains('guide-primary'));
    },
    get retry() {
      return nodes.find((node) => node.textContent === '重试');
    },
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn());
    },
  };
  setup?.(value);
  value.controller = createController(win, doc, app);
  return value;
}

function rewardCard(view) {
  view.node('#guide-reward-status');
  const button = view.node('#guide-reward-claim', { tag: 'button' });
  button.dataset.guideRewardClaim = '';
}
function claimReward(view) {
  view.listeners.get('document:click')({
    target: view.doc.getElementById('guide-reward-claim'),
    preventDefault() {},
  });
}
function finalStepFixture(options = {}) {
  const step = STEPS.length - 1;
  return fixture({
    href: `${STEPS[step].route}?guideTour=1`,
    states: { [VERSION]: { status: 'in_progress', step } },
    ...options,
    setup(value) {
      value.node(STEPS[step].target);
      options.setup?.(value);
    },
  });
}
const rewardWrites = (view) =>
  view.events.filter(
    (event) =>
      event.type === 'request' && event.route === '/onboarding/reward' && event.method === 'POST',
  );

test('full guide completion saves first, claims once and refreshes the top bar from fresh account data', async () => {
  const view = finalStepFixture();
  await settle();
  view.next.click();
  view.next.click();
  await settle();
  assert.equal(view.server.get(VERSION).status, 'completed');
  assert.equal(rewardWrites(view).length, 1);
  const saved = view.events.findIndex(
    (event) => event.version === VERSION && event.patch?.status === 'completed',
  );
  const claimed = view.events.indexOf(rewardWrites(view)[0]);
  const refreshed = view.events.findIndex((event) => event.route === '/auth/me');
  assert.ok(saved < claimed && claimed < refreshed);
  assert.deepEqual(rewardWrites(view)[0].patch, {});
  assert.equal(view.app.userState.electrons, 10);
  assert.equal(view.app.userState.manetrons, 10);
  assert.equal(view.events.filter((event) => event.type === 'sync-wallet').length, 1);
  assert.equal(view.dialog.open, false);
});

test('failed completion saves never claim and retry waits for the acknowledged full record', async () => {
  let fail = true;
  const view = finalStepFixture({
    beforeRequest({ version, patch }) {
      if (version === VERSION && patch?.status === 'completed' && fail)
        throw new Error('save offline');
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(view.server.get(VERSION).completedAt, null);
  assert.equal(rewardWrites(view).length, 0);
  assert.equal(view.retry.hidden, false);
  fail = false;
  view.retry.click();
  await settle();
  assert.equal(rewardWrites(view).length, 1);
  assert.equal(view.dialog.open, false);
});

test('failed reward claims keep completed progress and expose an explicit retry without optimistic balances', async () => {
  let fail = true;
  const view = finalStepFixture({
    beforeRequest({ route, method }) {
      if (route === '/onboarding/reward' && method === 'POST' && fail)
        throw new Error('reward offline');
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(view.server.get(VERSION).status, 'completed');
  assert.equal(view.rewardReceipts.size, 0);
  assert.equal(view.app.userState.electrons, undefined);
  assert.equal(view.dialog.open, true);
  assert.equal(view.retry.hidden, false);
  assert.match(
    view.nodes.find((node) => node.classList.contains('max-tour-status')).textContent,
    /尚未确认/,
  );
  fail = false;
  view.retry.click();
  await settle();
  assert.equal(view.rewardReceipts.size, 1);
  assert.equal(view.app.userState.electrons, 10);
  assert.equal(view.dialog.open, false);
});

test('a lost award response can be retried idempotently and replays keep a single receipt', async () => {
  let value;
  let loseResponse = true;
  const view = finalStepFixture({
    setup(next) {
      value = next;
    },
    beforeRequest({ route, method }) {
      if (route === '/onboarding/reward' && method === 'POST' && loseResponse) {
        value.rewardReceipts.set('member-token', stamp);
        loseResponse = false;
        throw new Error('response lost after commit');
      }
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(view.app.userState.electrons, undefined);
  assert.equal(view.retry.hidden, false);
  view.retry.click();
  await settle();
  assert.equal(rewardWrites(view).length, 2);
  assert.equal(view.rewardReceipts.size, 1);
  assert.equal(view.app.userState.electrons, 10);
  assert.equal(view.dialog.open, false);
  const replay = finalStepFixture({
    states: { [VERSION]: { status: 'in_progress', step: STEPS.length - 1, completedAt: stamp } },
    setup(next) {
      next.rewardReceipts.set('member-token', stamp);
    },
  });
  await settle();
  replay.next.click();
  await settle();
  assert.equal(replay.rewardReceipts.size, 1);
  assert.equal(replay.app.userState.electrons, 10);
  assert.equal(replay.dialog.open, false);
});

test('legacy completed members can claim from the guide card while GET remains read-only', async () => {
  const view = fixture({
    states: { 'max-v1': { status: 'completed', completedAt: stamp, seenAt: stamp } },
    setup: rewardCard,
  });
  await settle();
  const status = view.doc.getElementById('guide-reward-status');
  const button = view.doc.getElementById('guide-reward-claim');
  assert.match(status.textContent, /老用户同样可领取/);
  assert.equal(button.disabled, false);
  assert.equal(view.rewardReceipts.size, 0);
  assert.equal(rewardWrites(view).length, 0);
  claimReward(view);
  claimReward(view);
  await settle();
  assert.equal(rewardWrites(view).length, 1);
  assert.equal(view.rewardReceipts.size, 1);
  assert.match(status.textContent, /已领取 10 电元 \+ 10 磁元/);
  assert.equal(button.disabled, true);
  await view.controller.refresh();
  assert.equal(rewardWrites(view).length, 1, 'refresh only reads the existing receipt');
});

test('all five visit ticks alone do not enable the reward', async () => {
  const view = fixture({
    states: {
      [VERSION]: {
        completedTasks: [
          'explore_world',
          'visit_discussion',
          'meet_max',
          'open_workbench',
          'visit_inventory',
        ],
      },
    },
    setup: rewardCard,
  });
  await settle();
  assert.equal(view.doc.getElementById('guide-reward-claim').disabled, true);
  assert.match(view.doc.getElementById('guide-reward-status').textContent, /完成完整新手导览后/);
  assert.equal(view.rewardReceipts.size, 0);
});

test('reward query and wallet failures have distinct retries and never repeat a confirmed grant', async () => {
  let failQuery = true;
  let failWallet = true;
  const view = fixture({
    states: { [VERSION]: { status: 'completed', completedAt: stamp } },
    setup: rewardCard,
    beforeRequest({ route, method }) {
      if (route === '/onboarding/reward' && method === 'GET' && failQuery)
        throw new Error('query offline');
      if (route === '/auth/me' && failWallet) throw new Error('wallet offline');
    },
  });
  await settle();
  const button = view.doc.getElementById('guide-reward-claim');
  assert.equal(button.textContent, '重试查询');
  failQuery = false;
  claimReward(view);
  await settle();
  assert.equal(rewardWrites(view).length, 0);
  claimReward(view);
  await settle();
  assert.equal(view.rewardReceipts.size, 1);
  assert.equal(button.textContent, '刷新余额');
  assert.match(view.doc.getElementById('guide-reward-status').textContent, /奖励已领取.*尚未刷新/);
  assert.equal(view.app.userState.electrons, undefined);
  failWallet = false;
  claimReward(view);
  await settle();
  assert.equal(rewardWrites(view).length, 1);
  assert.equal(view.app.userState.electrons, 10);
});

test('a stalled post-award balance read times out and its retry never posts another reward', async (t) => {
  let holdWallet = true;
  let signal;
  const view = finalStepFixture({
    beforeRequest({ route, options }) {
      if (route === '/auth/me' && holdWallet) {
        signal = options.signal;
        return new Promise(() => {});
      }
      return undefined;
    },
  });
  await settle();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  view.next.click();
  await settle();
  assert.equal(view.rewardReceipts.size, 1);
  assert.equal(view.next.disabled, true);
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(view.next.disabled, false);
  assert.equal(view.retry.hidden, false);
  assert.match(
    view.nodes.find((node) => node.classList.contains('max-tour-status')).textContent,
    /已领取.*尚未刷新/,
  );
  holdWallet = false;
  view.retry.click();
  await settle();
  assert.equal(rewardWrites(view).length, 1);
  assert.equal(view.app.userState.electrons, 10);
  assert.equal(view.dialog.open, false);
});

test('guests completing the full guide and members completing a short release never claim', async () => {
  const step = STEPS.length - 1;
  const guest = finalStepFixture({
    member: false,
    setup(value) {
      value.memory.set(
        `freebbs_guide_guest_${VERSION}`,
        JSON.stringify({ ...emptyProgress(), status: 'in_progress', step, seenAt: stamp }),
      );
    },
  });
  await settle();
  guest.next.click();
  await settle();
  assert.equal(JSON.parse(guest.memory.get(`freebbs_guide_guest_${VERSION}`)).status, 'completed');
  assert.equal(
    guest.events.some((event) => event.type === 'request'),
    false,
  );
  const releaseSteps = stepsFor(LATEST_RELEASE.id);
  const last = releaseSteps.length - 1;
  const member = fixture({
    href: `${releaseSteps[last].route}?guideTour=1&guideVersion=${LATEST_RELEASE.id}`,
    states: { [LATEST_RELEASE.id]: { status: 'in_progress', step: last } },
    setup: (value) => value.node(releaseSteps[last].target),
  });
  await settle();
  member.next.click();
  await settle();
  assert.equal(member.server.get(LATEST_RELEASE.id).status, 'completed');
  assert.equal(member.server.get(VERSION).completedAt, null);
  assert.equal(rewardWrites(member).length, 0);
});

test('skipping the final station pauses without fabricating full completion or reward eligibility', async () => {
  const view = finalStepFixture();
  await settle();
  view.nodes.find((node) => node.textContent === '跳过此站').click();
  await settle();
  assert.equal(view.server.get(VERSION).status, 'skipped');
  assert.equal(view.server.get(VERSION).completedAt, null);
  assert.equal(rewardWrites(view).length, 0);
  assert.equal(view.dialog.open, false);
});

test('an account switch while a reward POST is pending isolates the old receipt and UI', async () => {
  const post = deferred();
  const view = fixture({
    states: { [VERSION]: { status: 'completed', completedAt: stamp } },
    setup: rewardCard,
    beforeRequest({ route, method }) {
      if (route === '/onboarding/reward' && method === 'POST') return post.promise;
      return undefined;
    },
  });
  await settle();
  claimReward(view);
  await settle();
  view.app.userState = { isLoggedIn: true, uid: 'next', token: 'next-token' };
  view.listeners.get('freebbs:session-change')();
  await settle();
  post.resolve();
  await settle();
  assert.equal(view.rewardReceipts.has('member-token'), true);
  assert.equal(view.rewardReceipts.has('next-token'), false);
  assert.match(view.doc.getElementById('guide-reward-status').textContent, /可以领取/);
  assert.equal(
    view.events.some((event) => event.type === 'sync-wallet'),
    false,
  );
  assert.equal(
    view.events.some((event) => event.route === '/auth/me'),
    false,
  );
});

test('cross-tab credential changes discard pending reward queries and balance replies', async () => {
  for (const heldRoute of ['/onboarding/reward', '/auth/me']) {
    const pending = deferred();
    let hold = heldRoute === '/onboarding/reward';
    const view = fixture({
      states: { [VERSION]: { status: 'completed', completedAt: stamp } },
      setup: rewardCard,
      beforeRequest({ route }) {
        if (route === heldRoute && hold) return pending.promise;
        return undefined;
      },
    });
    await settle();
    if (heldRoute === '/auth/me') {
      hold = true;
      claimReward(view);
      await settle();
    }
    view.listeners.get('storage')({ key: 'free_bbs_auth_token', newValue: 'other-token' });
    pending.resolve();
    await settle();
    assert.equal(view.doc.getElementById('guide-reward-claim').hidden, true);
    assert.match(view.doc.getElementById('guide-reward-status').textContent, /账号已变化/);
    assert.equal(
      view.events.some((event) => event.type === 'sync-wallet'),
      false,
    );
  }
});

test('a dynamically rendered station button keeps its station when its nested title is clicked', async () => {
  const view = fixture({ setup: (value) => value.node('#guide-station-list') });
  await settle();
  const button = view.doc
    .querySelectorAll('[data-guide-station]')
    .find((node) => node.dataset.guideStation === 'world');
  assert.ok(button);
  view.listeners.get('document:click')({ target: button.children[0], preventDefault() {} });
  await settle();
  const navigation = view.events.find((event) => event.type === 'navigate');
  assert.equal(new URL(navigation.url, view.win.location.origin).pathname, '/world');
  assert.equal(view.server.get(VERSION).step, indexOf('world-atlas'));
});

test('a station chosen while the login session restores waits and saves to the restored member', async () => {
  const ready = deferred();
  const view = fixture({
    member: false,
    sessionReady: ready.promise,
    states: { [VERSION]: { seenAt: null }, [LATEST_RELEASE.id]: { seenAt: null } },
    setup: (value) => value.node('#guide-station-list'),
  });
  const button = view.doc
    .querySelectorAll('[data-guide-station]')
    .find((node) => node.dataset.guideStation === 'world');
  view.listeners.get('document:click')({ target: button.children[0], preventDefault() {} });
  await settle();
  assert.equal(
    view.events.some((event) => event.type === 'navigate'),
    false,
    'do not navigate with guest progress while a member session is still restoring',
  );
  view.app.userState = { isLoggedIn: true, uid: 'member', token: 'member-token' };
  view.listeners.get('freebbs:session-change')();
  ready.resolve();
  await settle();
  const navigation = view.events.find((event) => event.type === 'navigate');
  assert.equal(new URL(navigation.url, view.win.location.origin).pathname, '/world');
  assert.equal(view.server.get(VERSION).step, indexOf('world-atlas'));
  assert.equal(view.server.get(VERSION).status, 'in_progress');
  assert.equal(view.memory.has(`freebbs_guide_guest_${VERSION}`), false);
});

test('native tour advances an actual course link only after its progress is acknowledged', async () => {
  const id = 'world-course-orbit';
  const index = indexOf(id);
  const step = STEPS[index];
  const saveGate = deferred();
  const view = fixture({
    href: '/world?guideTour=1',
    states: {
      [VERSION]: { status: 'in_progress', step: index, completedTasks: ['explore_world'] },
    },
    beforeRequest: ({ method, patch }) =>
      method === 'PATCH' && patch.step === index + 1 ? saveGate.promise : undefined,
    setup(value) {
      value.node(step.target);
      for (const prepare of step.prepare || []) value.node(prepare.whenMissing);
      const link = value.node(step.action.selector, { tag: 'a' });
      link.setAttribute(
        'href',
        '/course?course=math&query=a%2Bb&guideTour=0&guideVersion=stale#chapter-1',
      );
    },
  });
  await settle();
  assert.equal(view.dialog.tagName, 'DIALOG');
  assert.equal(view.dialog.open, true);
  assert.equal(view.controller.activeStep, index);
  view.next.click();
  await settle();
  assert.equal(view.events.filter((event) => event.type === 'navigate').length, 0);
  const requested = view.events.find(
    (event) => event.type === 'request' && event.method === 'PATCH',
  );
  assert.equal(requested.patch.step, index + 1);
  assert.equal(requested.patch.version, VERSION);
  saveGate.resolve();
  await settle();
  const navigation = view.events.find((event) => event.type === 'navigate');
  assert.ok(navigation);
  const url = new URL(navigation.url, view.win.location.origin);
  assert.equal(url.pathname, '/course');
  assert.equal(url.searchParams.get('course'), 'math');
  assert.equal(url.searchParams.get('query'), 'a+b');
  assert.equal(url.searchParams.get('guideTour'), '1');
  assert.equal(url.searchParams.get('guideVersion'), null);
  assert.equal(url.hash, '#chapter-1');
  assert.equal(view.server.get(VERSION).step, index + 1);
  assert.equal(
    view.events.filter((event) => event.type === 'click').length,
    1,
    'the engine navigates the validated link, not the underlying arbitrary click handler',
  );
});

test('math spotlight preserves the entire island and restores its overlapping hub after leaving', async () => {
  const index = indexOf('world-mathematics');
  const step = STEPS[index];
  const rect = { left: 400, top: 200, right: 700, bottom: 600, width: 300, height: 400 };
  for (const leave of ['pause', 'next']) {
    let mathClicks = 0;
    const view = fixture({
      href: '/world?guideTour=1',
      states: { [VERSION]: { status: 'in_progress', step: index } },
      setup(value) {
        value.node(step.target, {
          tag: 'button',
          rect,
          click: () => {
            mathClicks += 1;
          },
        });
        const core = value.node('#world-core');
        core.className = 'world-core';
        for (const prepare of step.prepare) value.node(prepare.whenMissing);
        const next = STEPS[index + 1];
        value.node(next.target);
        for (const prepare of next.prepare) value.node(prepare.whenMissing);
      },
    });
    await settle();
    view.flushFrames();
    const core = view.doc.querySelector('#world-core');
    const island = view.doc.querySelector(step.target);
    const spotlight = view.doc.querySelector('.max-tour-spotlight');
    assert.equal(core.classList.contains('max-tour-focus-hidden'), true);
    assert.deepEqual(island.getBoundingClientRect(), rect, 'orbit geometry must remain unchanged');
    assert.equal(spotlight.style.top, '192px');
    assert.equal(spotlight.style.height, '416px', 'the full island and label remain illuminated');
    assert.equal(mathClicks, 0, 'framing the island cannot activate it');
    if (leave === 'pause') await view.controller.pause();
    else view.next.click();
    await settle();
    assert.equal(core.className, 'world-core', `${leave} must restore the hub`);
    assert.equal(mathClicks, leave === 'next' ? 1 : 0);
  }
});

test('knowledge companions explains its small toggle before opening and closing the real panel', async () => {
  const index = indexOf('knowledge-companions');
  const step = STEPS[index];
  let panel;
  let toggle;
  const clicks = [];
  const view = fixture({
    href: '/knowledge?course=math&node=MA-01-1&guideTour=1',
    states: { [VERSION]: { status: 'in_progress', step: index } },
    setup(value) {
      panel = value.node('#knowledge-chat-panel', {
        rect: { left: 700, top: 100, right: 1200, bottom: 800, width: 500, height: 700 },
      });
      toggle = value.node('#knowledge-chat-toggle', {
        tag: 'button',
        rect: { left: 1300, top: 500, right: 1350, bottom: 550, width: 50, height: 50 },
        click: () => {
          clicks.push('toggle');
          panel.hidden = !panel.hidden;
          toggle.setAttribute('aria-expanded', String(!panel.hidden));
        },
      });
      const close = value.node('#knowledge-chat-close', {
        tag: 'button',
        click: () => {
          clicks.push('close');
          panel.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        },
      });
      panel.append(close);
      value.selectors.set('#knowledge-chat-toggle[aria-expanded="false"]', () =>
        panel.hidden ? [toggle] : [],
      );
    },
  });
  await settle();
  view.flushFrames();
  assert.equal(panel.hidden, true, 'the entry button is introduced with the panel collapsed');
  assert.equal(view.doc.querySelector('.max-tour-spotlight').style.width, '66px');
  assert.equal(view.next.textContent, '打开学习面板');
  const writes = view.events.filter((event) => event.method === 'PATCH').length;
  view.next.click();
  await settle();
  view.flushFrames();
  assert.equal(panel.hidden, false);
  assert.equal(view.controller.activeStep, index, 'opening stays within the published step');
  assert.equal(view.server.get(VERSION).step, index);
  assert.equal(view.events.filter((event) => event.method === 'PATCH').length, writes);
  assert.equal(
    view.events.some((event) => event.type === 'navigate'),
    false,
  );
  assert.equal(view.doc.querySelector('.max-tour-spotlight').style.width, '516px');
  assert.equal(view.next.textContent, '收起面板，继续导览');
  assert.deepEqual(clicks, ['close', 'toggle']);
  for (const selector of ['.is-alternate', '.max-tour-target-action']) {
    const closeControl = view.doc.querySelector(selector);
    assert.equal(closeControl.hidden, false);
    closeControl.click();
    await settle();
    view.flushFrames();
    assert.equal(panel.hidden, true, 'both visible close controls must close the real panel');
    assert.equal(
      view.controller.activeStep,
      index,
      'closing the panel does not force a new station',
    );
    assert.equal(view.doc.querySelector('.max-tour-spotlight').style.width, '66px');
    assert.equal(view.next.textContent, '打开学习面板');
    assert.equal(
      view.events.some((event) => event.type === 'navigate'),
      false,
    );
    view.next.click();
    await settle();
    view.flushFrames();
    assert.equal(panel.hidden, false, 'the same entry remains usable after closing');
  }
  assert.equal(view.events.filter((event) => event.method === 'PATCH').length, writes);
  view.next.click();
  await settle();
  assert.equal(panel.hidden, true);
  assert.deepEqual(clicks, ['close', 'toggle', 'toggle', 'toggle', 'close', 'toggle', 'close']);
  assert.equal(view.server.get(VERSION).step, index + 1);
  const navigation = view.events.find((event) => event.type === 'navigate');
  assert.equal(new URL(navigation.url, view.win.location.origin).pathname, '/discussion');
  assert.equal(step.reveal.target, '#knowledge-chat-panel');
});

test('discussion composer introduces its entry without triggering unmarked navigation to publish', async () => {
  const index = indexOf('discussion-composer');
  const step = STEPS[index];
  const view = fixture({
    href: '/discussion?guideTour=1',
    states: { [VERSION]: { status: 'in_progress', step: index } },
    setup(value) {
      value.node('#discussion-create-toggle', {
        tag: 'button',
        click: () => assert.fail('the introduction must not navigate or create a publish draft'),
      });
    },
  });
  await settle();
  assert.equal(step.target, '#discussion-create-toggle');
  assert.equal(step.prepare, undefined);
  assert.equal(step.action, undefined);
  assert.equal(view.controller.activeStep, index);
  assert.equal(view.dialog.open, true);
  assert.equal(view.next.textContent, '下一步 →');
  assert.equal(
    view.events.some((event) => event.type === 'navigate'),
    false,
  );
  view.next.click();
  await settle();
  const navigation = view.events.find((event) => event.type === 'navigate');
  const url = new URL(navigation.url, view.win.location.origin);
  assert.equal(url.pathname, '/aichat');
  assert.equal(url.searchParams.get('guideTour'), '1');
});

test('a late list scroll restoration is reframed once below the fixed header unless the tour was paused', async () => {
  const index = indexOf('discussion-reply-max');
  const step = STEPS[index];
  for (const paused of [false, true]) {
    let scrollY = 0;
    let framingCalls = 0;
    let composer;
    const view = fixture({
      href: '/discussion?guideTour=1',
      states: { [VERSION]: { status: 'in_progress', step: index } },
      setup(value) {
        value.node('.main-content');
        const { win } = value;
        win.getComputedStyle = (node, pseudo) =>
          pseudo === '::before'
            ? { position: 'fixed', display: 'block', height: '72px', borderBottomWidth: '0px' }
            : { display: 'block', visibility: 'visible' };
        win.scrollBy = ({ top }) => {
          scrollY += top;
        };
        value.node(step.target);
        for (const prepare of step.prepare) value.node(prepare.whenMissing);
        value.node(step.action.selector, {
          tag: 'button',
          click: () => {
            win.requestAnimationFrame(() => {
              scrollY = 575;
            });
          },
        });
        composer = value.node('#discussion-create-toggle', { tag: 'button' });
        composer.getBoundingClientRect = () => ({
          left: 1134,
          right: 1228,
          top: 597 - scrollY,
          bottom: 641 - scrollY,
          width: 94,
          height: 44,
        });
        composer.scrollIntoView = () => {
          framingCalls += 1;
          scrollY = 169;
        };
      },
    });
    await settle();
    view.flushFrames();
    view.next.click();
    await settle();
    assert.equal(view.controller.activeStep, index + 1);
    assert.equal(framingCalls, 1);
    if (paused) await view.controller.pause();
    view.flushFrames();
    if (paused) {
      assert.equal(scrollY, 575, 'a paused tour must not fight the page scroll restoration');
      assert.equal(framingCalls, 1);
    } else {
      const rect = composer.getBoundingClientRect();
      assert.ok(rect.top >= 90, 'the real entry must remain below the fixed 72px header');
      assert.equal(framingCalls, 2, 'frame again after the page restores its list position');
      assert.equal(view.doc.querySelector('.max-tour-spotlight').style.top, `${rect.top - 8}px`);
      view.listeners.get('scroll')();
      view.flushFrames();
      assert.equal(framingCalls, 2, 'ordinary scroll updates must not repeatedly force framing');
    }
  }
});

test('mobile personal folds open only for the current target and preserve their original state when leaving', async () => {
  const index = indexOf('settings-reading');
  for (const originallyOpen of [false, true]) {
    for (const leave of ['next', 'pause']) {
      let readingFold;
      let passwordFold;
      let unrelatedFold;
      let fontChoice;
      const view = fixture({
        href: '/settings?guideTour=1',
        states: { [VERSION]: { status: 'in_progress', step: index } },
        setup(value) {
          readingFold = value.node('#reading-fold', { tag: 'details' });
          readingFold.className = 'personal-fold';
          readingFold.open = originallyOpen;
          const reading = value.node(STEPS[index].target, {
            tag: 'form',
            click: () => assert.fail('a tour must not click or submit the reading form'),
          });
          fontChoice = value.node('#font-choice', { tag: 'select' });
          fontChoice.value = 'existing-font';
          reading.append(fontChoice);
          readingFold.append(reading);
          passwordFold = value.node('#password-fold', { tag: 'details' });
          passwordFold.className = 'personal-fold';
          passwordFold.append(
            value.node(STEPS[index + 1].target, {
              tag: 'form',
              click: () => assert.fail('a tour must not click or submit the password form'),
            }),
          );
          unrelatedFold = value.node('#unrelated-fold', { tag: 'details' });
          unrelatedFold.className = 'personal-fold';
        },
      });
      await settle();
      view.flushFrames();
      assert.equal(readingFold.open, true, 'a closed target fold must reveal its real content');
      assert.equal(passwordFold.open, false, 'future targets must stay in their existing state');
      assert.equal(unrelatedFold.open, false);
      assert.equal(view.doc.querySelector('.max-tour-spotlight').hidden, false);
      view.listeners.get('resize')();
      view.flushFrames();
      assert.equal(readingFold.open, true, 'geometry remeasurement must not undo the reveal');
      if (leave === 'next') {
        view.next.click();
        await settle();
        view.flushFrames();
        assert.equal(view.controller.activeStep, index + 1);
        assert.equal(passwordFold.open, true, 'only the newly selected target fold opens');
        assert.equal(readingFold.open, originallyOpen);
      }
      await view.controller.pause();
      assert.equal(
        readingFold.open,
        originallyOpen,
        `${leave} must preserve the original fold state`,
      );
      assert.equal(passwordFold.open, false);
      assert.equal(unrelatedFold.open, false);
      assert.equal(fontChoice.value, 'existing-font');
      assert.equal(
        view.events.filter((event) => event.type === 'click' && event.node !== 'guide-primary')
          .length,
        0,
        'fold preparation must not click form controls',
      );
    }
  }
});

test('unsafe target hrefs neither advance saved progress nor navigate', async () => {
  const index = indexOf('course-enter-knowledge');
  const step = STEPS[index];
  const view = fixture({
    href: '/course?course=math&guideTour=1',
    states: { [VERSION]: { status: 'in_progress', step: index } },
    setup(value) {
      const link = value.node(step.target, { tag: 'a' });
      value.selectors.set(step.action.selector, link);
      for (const prepare of step.prepare || []) value.selectors.set(prepare.whenMissing, link);
      link.setAttribute('href', 'https://evil.test/knowledge?course=math&point=MA-01-1');
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(view.controller.activeStep, index);
  assert.equal(view.server.get(VERSION).step, index);
  assert.equal(
    view.events.some((event) => event.type === 'navigate'),
    false,
  );
  assert.equal(
    view.events.some((event) => event.type === 'request' && event.method === 'PATCH'),
    false,
  );
  assert.equal(view.retry.hidden, false);
  assert.match(
    view.nodes.find((node) => node.classList.contains('max-tour-status')).textContent,
    /入口已变化/,
  );
  await view.controller.pause();
  assert.equal(view.dialog.open, false, 'an invalid link must never trap the user in the overlay');
});

test('resuming the ledger step prepares its real native dialog before showing Max and does not toggle it twice', async () => {
  const index = indexOf('inventory-ledger');
  const step = STEPS[index];
  let ledger;
  let openCount = 0;
  const view = fixture({
    href: '/inventory?guideTour=1',
    states: {
      [VERSION]: { status: 'in_progress', step: index, completedTasks: ['visit_inventory'] },
    },
    setup(value) {
      ledger = value.node('#wallet-ledger', { tag: 'dialog' });
      const contents = value.node(step.target);
      ledger.append(contents);
      value.selectors.set(step.target, () => (ledger.open ? [contents] : []));
      value.selectors.set('#wallet-ledger[open]', () => (ledger.open ? [ledger] : []));
      value.node('#wallet-ledger-open', {
        tag: 'button',
        click: () => {
          openCount += 1;
          ledger.showModal();
        },
      });
    },
  });
  await settle();
  assert.equal(openCount, 1);
  assert.equal(ledger.open, true);
  assert.equal(view.dialog.open, true);
  const opens = view.events.filter((event) => event.type === 'show-modal');
  assert.deepEqual(
    opens.map((event) => event.node),
    ['wallet-ledger', 'max-tour'],
  );
  assert.equal(view.controller.activeStep, index);
  view.flushFrames();
  assert.equal(
    view.nodes.find((node) => node.classList.contains('max-tour-spotlight')).hidden,
    false,
  );
  await view.controller.pause();
  assert.equal(view.dialog.open, false);
  assert.equal(view.doc.body.style.overflow, 'auto');
});

test('Escape remains available during a held save, restores focus and prevents delayed navigation', async () => {
  const index = indexOf('home-handbook');
  const gate = deferred();
  const view = fixture({
    href: '/?guideTour=1',
    states: { [VERSION]: { status: 'in_progress', step: index } },
    beforeRequest: ({ method, patch }) =>
      method === 'PATCH' && patch.step === index + 1 ? gate.promise : undefined,
    setup(value) {
      value.node(STEPS[index].target);
    },
  });
  const previousFocus = view.doc.activeElement;
  await settle();
  assert.equal(view.doc.body.style.overflow, 'hidden');
  view.next.click();
  await settle();
  assert.equal(view.next.disabled, true);
  const event = view.dialog.fire('keydown', { key: 'Escape' });
  assert.equal(event.prevented, true);
  assert.equal(view.dialog.open, false);
  assert.equal(view.doc.activeElement, previousFocus);
  assert.equal(view.doc.body.style.overflow, 'auto');
  gate.resolve();
  await settle();
  assert.equal(
    view.events.some((entry) => entry.type === 'navigate'),
    false,
  );
  assert.equal(view.server.get(VERSION).status, 'skipped');
});

test('a failed progress save leaves the highlighted step and lets Retry finish the same transition', async () => {
  const index = indexOf('home-handbook');
  let fail = true;
  const view = fixture({
    href: '/?guideTour=1',
    states: { [VERSION]: { status: 'in_progress', step: index } },
    beforeRequest({ method, patch }) {
      if (method === 'PATCH' && patch.step === index + 1 && fail)
        throw new Error('preview offline');
    },
    setup(value) {
      value.node(STEPS[index].target);
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(view.controller.activeStep, index);
  assert.equal(view.server.get(VERSION).step, index);
  assert.equal(
    view.events.some((entry) => entry.type === 'navigate'),
    false,
  );
  assert.equal(view.retry.hidden, false);
  fail = false;
  view.retry.click();
  await settle();
  assert.equal(view.server.get(VERSION).step, index + 1);
  assert.equal(view.events.filter((entry) => entry.type === 'navigate').length, 1);
});

test('manual welcome load errors can be retried while its native dialog remains open', async () => {
  let fail = true;
  const view = fixture({
    beforeRequest({ method, version }) {
      if (method === 'GET' && version === LATEST_RELEASE.id && fail)
        throw new Error('release offline');
    },
  });
  await settle();
  // initialize attempted the latest release once; its failure did not open a dialog.
  await view.controller.start(LATEST_RELEASE.id);
  assert.equal(view.dialog.open, true);
  assert.equal(view.retry.hidden, false);
  fail = false;
  const before = view.events.filter(
    (event) => event.type === 'request' && event.version === LATEST_RELEASE.id,
  ).length;
  view.retry.click();
  await settle();
  assert.equal(
    view.events.filter((event) => event.type === 'request' && event.version === LATEST_RELEASE.id)
      .length,
    before + 1,
  );
  assert.equal(view.retry.hidden, true);
  assert.equal(view.controller.snapshot().version, LATEST_RELEASE.id);
});

test('a manually selected release wins over a delayed first-account automatic welcome', async () => {
  const initialRead = deferred();
  const view = fixture({
    states: {
      [VERSION]: { seenAt: null },
      [LATEST_RELEASE.id]: { seenAt: null },
    },
    async beforeRequest({ method, version }) {
      if (method === 'GET' && version === VERSION) await initialRead.promise;
    },
  });
  await settle();
  await view.controller.start(LATEST_RELEASE.id);
  assert.equal(view.doc.getElementById('max-tour-title').textContent, LATEST_RELEASE.title);
  initialRead.resolve();
  await settle();
  assert.equal(view.controller.snapshot().version, LATEST_RELEASE.id);
  assert.equal(view.doc.getElementById('max-tour-title').textContent, LATEST_RELEASE.title);
  view.next.click();
  await settle();
  const navigation = view.events.find((event) => event.type === 'navigate');
  const destination = new URL(navigation.url, view.win.location.origin);
  assert.equal(destination.pathname, '/development');
  assert.equal(destination.searchParams.get('guideVersion'), LATEST_RELEASE.id);
  assert.equal(view.server.get(VERSION).status, 'not_started');
  assert.equal(view.server.get(VERSION).seenAt, null);
});

test('release replay uses its own step indexes and never changes the acknowledged full-tour position', async () => {
  const release = 'guide-depth-2026-09';
  const releaseIndex = indexOf('inventory-ledger-entry', release);
  const fullIndex = indexOf('course-relations');
  const step = stepsFor(release)[releaseIndex];
  let ledger;
  const view = fixture({
    href: `/inventory?guideTour=1&guideVersion=${release}`,
    states: {
      [VERSION]: { status: 'in_progress', step: fullIndex, completedTasks: ['visit_inventory'] },
      [release]: { status: 'in_progress', step: releaseIndex },
    },
    setup(value) {
      ledger = value.node('#wallet-ledger', { tag: 'dialog' });
      const next = stepsFor(release)[releaseIndex + 1];
      const contents = value.node(next.target);
      ledger.append(contents);
      value.selectors.set(next.target, () => (ledger.open ? [contents] : []));
      value.selectors.set('#wallet-ledger[open]', () => (ledger.open ? [ledger] : []));
      value.node(step.target, {
        tag: 'button',
        click: () => {
          ledger.showModal();
        },
      });
    },
  });
  await settle();
  assert.equal(view.controller.snapshot().version, release);
  view.next.click();
  await settle();
  assert.equal(view.controller.activeStep, releaseIndex + 1);
  assert.equal(ledger.open, true);
  assert.equal(view.server.get(release).step, releaseIndex + 1);
  assert.equal(view.server.get(VERSION).step, fullIndex);
  assert.deepEqual(view.server.get(release).completedTasks, []);
  assert.equal(
    view.events.filter((event) => event.type === 'click' && event.node === 'wallet-ledger-open')
      .length,
    1,
  );
  await view.controller.pause();
});

test('the short release keeps its prepared ledger open while the first row loads late', async () => {
  const release = 'guide-depth-2026-09';
  const index = indexOf('inventory-ledger-entry', release);
  const entry = stepsFor(release)[index];
  const details = stepsFor(release)[index + 1];
  const pendingTimers = [];
  let ledger;
  let loaded = false;
  const view = fixture({
    href: `/inventory?guideTour=1&guideVersion=${release}`,
    states: {
      [VERSION]: { completedTasks: ['visit_inventory'] },
      [release]: { status: 'in_progress', step: index },
    },
    setup(value) {
      Object.assign(value.win, { setTimeout: (callback) => pendingTimers.push(callback) });
      ledger = value.node('#wallet-ledger', { tag: 'dialog' });
      const row = value.node(details.target);
      ledger.append(row);
      value.selectors.set(details.target, () => (ledger.open && loaded ? [row] : []));
      value.selectors.set('#wallet-ledger[open]', () => (ledger.open ? [ledger] : []));
      value.node(entry.target, { tag: 'button', click: () => ledger.showModal() });
    },
  });
  await settle();
  view.next.click();
  await settle();
  assert.equal(details.id, 'inventory-ledger', 'the release skips the ready filter-toolbar step');
  assert.equal(view.controller.activeStep, index + 1);
  assert.equal(ledger.open, true);
  assert.equal(pendingTimers.length, 1, 'Max waits for the still-pending first row');
  assert.equal(
    view.events.filter((event) => event.type === 'close-modal' && event.node === 'wallet-ledger')
      .length,
    0,
    'closing a loading ledger can invalidate its in-flight read even if it is immediately reopened',
  );
  assert.equal(
    view.events.filter((event) => event.type === 'show-modal' && event.node === 'wallet-ledger')
      .length,
    1,
  );
  loaded = true;
  pendingTimers.shift()();
  await settle();
  assert.equal(view.dialog.open, true);
  assert.equal(view.retry.hidden, true, 'late data is highlighted, not reported as unavailable');
  view.flushFrames();
  assert.equal(
    view.nodes.find((node) => node.classList.contains('max-tour-spotlight')).hidden,
    false,
  );
  await view.controller.pause();
});

test('leaving the ledger closes its tour-opened dialog but preserves unrelated user dialogs', async () => {
  const index = indexOf('inventory-ledger');
  const firstInventoryIndex = indexOf('inventory-assets');
  let ledger;
  let userDialog;
  const view = fixture({
    href: '/inventory?guideTour=1',
    states: {
      [VERSION]: { status: 'in_progress', step: index, completedTasks: ['visit_inventory'] },
    },
    setup(value) {
      userDialog = value.node('#user-owned-dialog', { tag: 'dialog' });
      ledger = value.node('#wallet-ledger', { tag: 'dialog' });
      const row = value.node(STEPS[index].target);
      ledger.append(row);
      value.selectors.set(STEPS[index].target, () => (ledger.open ? [row] : []));
      value.selectors.set('#wallet-ledger[open]', () => (ledger.open ? [ledger] : []));
      value.node('#wallet-ledger-open', { tag: 'button', click: () => ledger.showModal() });
      value.node(STEPS[firstInventoryIndex].target);
    },
  });
  await settle();
  assert.equal(ledger.open, true);
  userDialog.showModal();
  const stations = view.nodes.find((node) => node.classList.contains('max-tour-stations'));
  stations.value = String(firstInventoryIndex);
  stations.fire('change');
  await settle();
  assert.equal(view.controller.activeStep, firstInventoryIndex);
  assert.equal(
    ledger.open,
    false,
    'the next target and its preparations no longer need the ledger',
  );
  assert.equal(userDialog.open, true, 'only dialogs opened by this tour are owned by its cleanup');
  assert.equal(
    view.events.filter((event) => event.type === 'close-modal' && event.node === 'wallet-ledger')
      .length,
    1,
  );
  const settingsIndex = indexOf('settings-reading');
  stations.value = String(settingsIndex);
  stations.fire('change');
  await settle();
  assert.equal(view.server.get(VERSION).step, settingsIndex);
  const navigation = view.events.find((event) => event.type === 'navigate');
  assert.equal(new URL(navigation.url, view.win.location.origin).pathname, '/settings');
  await view.controller.pause();
});

test('an unseen release invites an existing member once, then remains manually resumable after dismissal', async () => {
  const base = { status: 'in_progress', step: indexOf('course-relations'), seenAt: stamp };
  const previousRelease = { status: 'completed', step: 8, seenAt: stamp, completedAt: stamp };
  const first = fixture({
    states: {
      [VERSION]: base,
      'guide-depth-2026-09': previousRelease,
      [LATEST_RELEASE.id]: { seenAt: null },
    },
  });
  await settle();
  assert.equal(first.dialog.open, true);
  assert.equal(first.controller.snapshot().version, LATEST_RELEASE.id);
  assert.equal(first.doc.getElementById('max-tour-title').textContent, LATEST_RELEASE.title);
  assert.equal(first.server.get(LATEST_RELEASE.id).seenAt, stamp);
  assert.equal(first.server.get(VERSION).step, base.step);
  assert.equal(first.server.get('guide-depth-2026-09').status, 'completed');
  assert.equal(first.server.get('guide-depth-2026-09').step, previousRelease.step);
  await first.controller.pause();
  assert.equal(first.server.get(LATEST_RELEASE.id).status, 'skipped');
  const second = fixture({ states: Object.fromEntries(first.server) });
  await settle();
  assert.equal(second.dialog, undefined, 'seen updates must not auto-open on the next page');
  await second.controller.start(LATEST_RELEASE.id);
  assert.equal(second.dialog.open, true, 'the permanent entry can still replay the release');
  assert.equal(second.controller.snapshot().version, LATEST_RELEASE.id);
  await second.controller.pause();
  const completed = fixture({
    states: { [VERSION]: base, [LATEST_RELEASE.id]: { status: 'completed', completedAt: stamp } },
  });
  await settle();
  assert.equal(completed.dialog, undefined);
  assert.equal(
    completed.events.some((event) => event.type === 'request' && event.method === 'PATCH'),
    false,
  );
});

test('the community release crosses into activities and completes without changing prior receipts or signing up', async () => {
  const release = LATEST_RELEASE.id;
  const previous = {
    [VERSION]: { status: 'completed', step: 42, completedAt: stamp },
    'guide-depth-2026-09': { status: 'completed', step: 8, completedAt: stamp },
    [release]: { status: 'in_progress', step: 1 },
  };
  const development = fixture({
    href: `/development?guideTour=1&guideVersion=${release}`,
    states: previous,
    setup(value) {
      value.node(stepsFor(release)[1].target);
    },
  });
  await settle();
  development.next.click();
  await settle();
  const navigation = development.events.find((event) => event.type === 'navigate');
  const destination = new URL(navigation.url, development.win.location.origin);
  assert.equal(destination.pathname, '/surveys');
  assert.equal(destination.searchParams.get('guideVersion'), release);
  assert.equal(destination.searchParams.has('id'), false);
  const activities = fixture({
    href: navigation.url,
    states: Object.fromEntries(development.server),
    setup(value) {
      stepsFor(release)
        .filter((step) => step.station === 'activities')
        .forEach((step) => value.node(step.target));
      value.node('#content form button', {
        tag: 'button',
        click: () => assert.fail('the guide must never submit an activity registration'),
      });
    },
  });
  await settle();
  for (let step = 2; step < stepsFor(release).length; step += 1) {
    assert.equal(activities.controller.activeStep, step);
    activities.next.click();
    await settle();
  }
  assert.equal(activities.server.get(release).status, 'completed');
  assert.equal(activities.server.get(VERSION).status, 'completed');
  assert.equal(activities.server.get(VERSION).step, 42);
  assert.equal(activities.server.get('guide-depth-2026-09').step, 8);
  assert.equal(activities.dialog.open, false);
  const writes = [...development.events, ...activities.events].filter(
    (event) => event.type === 'request' && event.method !== 'GET',
  );
  assert.ok(writes.length > 0);
  assert.ok(writes.every((event) => event.version === release));
});

test('a returning legacy member is invited to the new release rather than repeating the full welcome', async () => {
  const view = fixture({
    states: {
      [VERSION]: { seenAt: null },
      'max-v1': { status: 'completed', seenAt: stamp, completedAt: stamp },
      [LATEST_RELEASE.id]: { seenAt: null },
    },
  });
  await settle();
  assert.equal(view.dialog.open, true);
  assert.equal(view.controller.snapshot().version, LATEST_RELEASE.id);
  assert.equal(view.server.get(VERSION).seenAt, null);
  assert.equal(view.server.get('max-v1').status, 'completed');
  assert.equal(view.server.get(LATEST_RELEASE.id).seenAt, stamp);
  await view.controller.pause();
});

test('automatic loading waits for session readiness and cross-tab account changes discard pending replies', async () => {
  const ready = deferred();
  const read = deferred();
  const view = fixture({
    sessionReady: ready.promise,
    beforeRequest: ({ method, version }) =>
      method === 'GET' && version === VERSION ? read.promise : undefined,
    states: { [VERSION]: { seenAt: null } },
  });
  await settle();
  assert.equal(
    view.events.some((event) => event.type === 'request'),
    false,
  );
  ready.resolve();
  await settle();
  assert.equal(view.events.filter((event) => event.type === 'request').length, 1);
  view.listeners.get('storage')({ key: 'free_bbs_auth_token', newValue: 'another-account-token' });
  read.resolve();
  await settle();
  assert.equal(view.dialog, undefined);
  assert.equal(view.controller.snapshot().seenAt, null);
  assert.equal(
    view.events.some((event) => event.type === 'request' && event.method === 'PATCH'),
    false,
  );
  assert.equal(
    view.events.some((event) => event.type === 'navigate'),
    false,
  );
});

test('guests get no automatic invitation and manual exploration stays inside tab storage', async () => {
  const view = fixture({ member: false });
  await settle();
  assert.equal(view.dialog, undefined);
  assert.equal(
    view.events.some((event) => event.type === 'request'),
    false,
  );
  await view.controller.start(LATEST_RELEASE.id);
  assert.equal(view.dialog.open, true);
  assert.match(
    view.nodes.find((node) => node.classList.contains('max-tour-caption')).textContent,
    /游客体验.*当前标签页/,
  );
  view.next.click();
  await settle();
  assert.equal(
    view.events.some((event) => event.type === 'request'),
    false,
  );
  const saved = JSON.parse(view.memory.get(`freebbs_guide_guest_${LATEST_RELEASE.id}`));
  assert.equal(saved.version, LATEST_RELEASE.id);
  assert.equal(saved.status, 'in_progress');
  assert.equal(view.memory.has(`freebbs_guide_guest_${VERSION}`), false);
  assert.equal(view.events.filter((event) => event.type === 'navigate').length, 1);
});
