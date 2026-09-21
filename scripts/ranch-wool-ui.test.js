const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function fixture(
  callApi = async () => ({ result: { action: 'rub_wool' }, user: { uid: 'u_test' } }),
) {
  const listeners = {};
  const windowListeners = {};
  const status = { textContent: '' };
  const elements = new Map([['profile-extras-message', status]]);
  const calls = [];
  const sync = [];
  const app = {
    userState: { isLoggedIn: true, uid: 'u_test', token: 'token-one' },
    sessionReady: Promise.resolve(),
    async callApi(url, options) {
      calls.push({ url, options, body: options.body && JSON.parse(options.body) });
      return callApi(url, options);
    },
    syncWallet: (...args) => sync.push(args),
  };
  const window = {
    freeBbsApp: app,
    addEventListener(event, handler) {
      windowListeners[event] = handler;
    },
  };
  const document = {
    addEventListener: (event, handler) => {
      listeners[event] = handler;
    },
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/profile-extras.js'), 'utf8'), {
    window,
    document,
    crypto: { randomUUID },
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const click = (action) => {
    const button = { dataset: { extraAction: action }, disabled: false };
    listeners.click({
      target: { closest: (selector) => (selector === '[data-extra-action]' ? button : null) },
      preventDefault() {},
    });
    return button;
  };
  return {
    api: window.FreeBbsProfileExtras,
    app,
    calls,
    sync,
    status,
    click,
    windowListeners,
    elements,
  };
}
const settle = async () => {
  for (let i = 0; i < 4; i += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
};

test('wool lives in the ranch, safe counts render and visitors get no mutation controls', () => {
  const { api } = fixture();
  assert.equal(api.woolPanel({}, true), '');
  const state = {
    ranch: { adopted: true, feedProgress: 3, woolReady: 2, woolStored: 1 },
    rubberRod: true,
  };
  const owner = api.woolPanel(state, true);
  assert.match(owner, /3 \/ 5 条小鱼/);
  assert.match(owner, /data-extra-action="shear" >剪下一份羊毛/);
  assert.match(owner, /data-extra-action="rub_wool" >摩擦起电/);
  assert.match(owner, /橡胶棒已就位，可以反复使用/);
  assert.match(owner, /羊毛留在牧场/);
  assert.doesNotMatch(api.woolPanel(state, false), /data-extra-action|去商城/);
  assert.doesNotMatch(
    api.woolPanel({ ranch: { adopted: true, woolReady: '<img onerror=1>' } }, true),
    /onerror/,
  );
});
test('shearing requires wool, rubbing requires sheared wool AND a reusable rod', () => {
  const { api } = fixture();
  const missing = api.woolPanel({ ranch: { adopted: true } }, true);
  assert.match(missing, /data-extra-action="shear" disabled/);
  assert.match(missing, /data-extra-action="rub_wool" disabled/);
  assert.match(missing, /7 磁元/);
  assert.match(
    api.woolPanel({ ranch: { adopted: true, woolStored: 1 } }, true),
    /data-extra-action="rub_wool" disabled/,
  );
});
test('rod inventory links safely to the current account ranch rather than consumes the tool', () => {
  const { api, app } = fixture();
  assert.match(api.inventoryActions('rubber_rod'), /\/profile\?uid=u_test#public-profile-ranch/);
  app.userState.uid = 'unsafe"<x>';
  assert.doesNotMatch(api.inventoryActions('rubber_rod'), /<x>/);
  app.userState.uid = '';
  assert.equal(api.inventoryActions('rubber_rod'), '');
});
test('a shorn Max rests until tomorrow even with more wool ready, rubbing remains available', () => {
  const { api } = fixture();
  const html = api.woolPanel(
    { ranch: { adopted: true, woolReady: 2, woolStored: 1, shearedToday: true }, rubberRod: true },
    true,
  );
  assert.match(html, /data-extra-action="shear" disabled>今天已剪毛/);
  assert.match(html, /Max 被薅秃了，明天再来吧/);
  assert.match(html, /data-extra-action="rub_wool" >摩擦起电/);
  assert.match(html, /北京时间每天最多剪一份/);
});
test('double clicks issue one action, uncertain retry retains request key, success uses fresh user', async () => {
  let release;
  let attempts = 0;
  const view = fixture(async () => {
    attempts += 1;
    if (attempts === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (attempts === 1) throw new Error('network lost');
    return {
      result: { action: 'rub_wool', replayed: true, balance: { electric: 'old' } },
      user: { uid: 'u_test', electrons: 122 },
    };
  });
  const button = view.click('rub_wool');
  view.click('rub_wool');
  assert.equal(view.calls.length, 1);
  assert.equal(button.disabled, true);
  release();
  await settle();
  assert.match(view.status.textContent, /可重试原操作/);
  view.click('rub_wool');
  await settle();
  assert.equal(view.calls[0].body.requestKey, view.calls[1].body.requestKey);
  assert.equal(view.sync[0][0].electrons, 122);
  assert.equal(view.sync[0][1], 'token-one');
  assert.match(view.status.textContent, /获得 2 电元/);
});
test('late account/token responses cannot refresh another session wallet or show a reward', async () => {
  let release;
  const view = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  view.click('rub_wool');
  view.app.userState.token = 'another-session';
  release({ result: { action: 'rub_wool' }, user: { uid: 'u_test', electrons: 122 } });
  await settle();
  assert.equal(view.sync.length, 0);
  assert.doesNotMatch(view.status.textContent, /获得 2 电元/);
});
test('confirmed success followed by UI failure never invites another charge or payout retry', async () => {
  const view = fixture();
  view.app.syncWallet = () => {
    throw new Error('UI failure');
  };
  const button = view.click('rub_wool');
  await settle();
  assert.match(view.status.textContent, /操作已完成/);
  assert.doesNotMatch(view.status.textContent, /可重试/);
  assert.equal(button.disabled, true);
  view.click('rub_wool');
  view.click('shear');
  await settle();
  assert.equal(
    view.calls.length,
    1,
    'stale controls must not create a new transaction after confirmed success',
  );
});

test('cross-tab credentials invalidate pending rewards even before the app updates its in-memory token', async () => {
  let resolve;
  const view = fixture(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  view.click('rub_wool');
  const pending = view.calls[0];
  view.windowListeners.storage({ key: 'free_bbs_auth_token', newValue: 'other-token' });
  assert.equal(view.app.userState.token, 'token-one');
  assert.equal(pending.options.signal.aborted, true);
  resolve({ result: { action: 'rub_wool' }, user: { uid: 'u_test', electrons: 122 } });
  await settle();
  assert.equal(view.sync.length, 0);
  assert.match(view.status.textContent, /登录状态已变化.*刷新/);
  view.click('rub_wool');
  assert.equal(view.calls.length, 1);
  assert.doesNotMatch(view.status.textContent, /获得 2 电元/);
});

test('same UID with a new token invalidates old actions without letting old finally clear the new busy state', async () => {
  const resolvers = [];
  const view = fixture(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  view.click('rub_wool');
  const old = view.calls[0];
  view.app.userState.token = 'token-two';
  view.windowListeners['freebbs:session-change']();
  assert.equal(old.options.signal.aborted, true);
  view.click('rub_wool');
  assert.equal(view.calls.length, 2);
  assert.notEqual(view.calls[0].body.requestKey, view.calls[1].body.requestKey);
  resolvers[0]({ result: { action: 'rub_wool' }, user: { uid: 'u_test', electrons: 122 } });
  await settle();
  view.click('rub_wool');
  assert.equal(view.calls.length, 2, 'old request cleanup cannot unlock a newer action');
  assert.equal(view.sync.length, 0);
  resolvers[1]({ result: { action: 'rub_wool' }, user: { uid: 'u_test', electrons: 124 } });
  await settle();
  assert.equal(view.sync.length, 1);
  assert.equal(view.sync[0][0].electrons, 124);
  assert.equal(view.sync[0][1], 'token-two');
});

test('ordinary same-account session notifications do not cancel a valid in-flight action', async () => {
  let resolve;
  const view = fixture(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  view.click('rub_wool');
  view.windowListeners['freebbs:session-change']();
  assert.equal(view.calls[0].options.signal.aborted, false);
  view.click('rub_wool');
  assert.equal(view.calls.length, 1);
  resolve({ result: { action: 'rub_wool' }, user: { uid: 'u_test', electrons: 122 } });
  await settle();
  assert.equal(view.sync.length, 1);
});

test('private profile reads abort on storage clear and stale read errors cannot replace the session warning', async () => {
  let reject;
  let reads = 0;
  const view = fixture(async () => {
    reads += 1;
    if (reads === 1)
      await new Promise((unused, no) => {
        reject = no;
      });
    return { ranch: { adopted: true }, cosmetics: {}, owned: [], fish: 1, rubberRod: true };
  });
  const pending = view.api.renderProfile({ uid: 'u_test', username: 'A', ranch: {} });
  await settle();
  assert.equal(view.calls[0].options.method, 'GET');
  view.windowListeners.storage({ key: null });
  assert.equal(view.calls[0].options.signal.aborted, true);
  reject(new Error('stale account private failure'));
  await pending;
  assert.match(view.status.textContent, /登录状态已变化/);
  assert.doesNotMatch(view.status.textContent, /stale account/);
  view.app.userState.token = 'token-two';
  view.windowListeners['freebbs:session-change']();
  await settle();
  assert.equal(reads, 2, 'a genuine new session may reload the owner view');
});

test('a late successful private profile read cannot restore owner controls after cross-tab logout', async () => {
  let resolve;
  const view = fixture(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const wardrobe = { hidden: false, innerHTML: '' };
  view.elements.set('public-profile-wardrobe', wardrobe);
  const pending = view.api.renderProfile({ uid: 'u_test', ranch: {} });
  await settle();
  assert.equal(wardrobe.hidden, true);
  view.windowListeners.storage({ key: 'free_bbs_auth_token', newValue: null });
  resolve({ cosmetics: {}, owned: ['plate_maxwell'], ranch: { adopted: true }, fish: 9 });
  await pending;
  assert.equal(wardrobe.hidden, true);
  assert.equal(wardrobe.innerHTML, '');
  assert.match(view.status.textContent, /登录状态已变化/);
});

test('unrelated storage preferences neither abort requests nor block actions', async () => {
  const view = fixture();
  view.windowListeners.storage({ key: 'theme', newValue: 'dark' });
  view.click('rub_wool');
  await settle();
  assert.equal(view.sync.length, 1);
});

test('app wallet synchronization rejects stale cross-tab responses and resumes only with an established session', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('  syncWallet: (() => {');
  const end = source.indexOf('  toggleThemeMode,', start);
  assert.ok(start > 0 && end > start);
  const events = {};
  let renders = 0;
  const userState = {
    isLoggedIn: true,
    uid: 'u_test',
    token: 'token-one',
    electrons: 120,
    manetrons: 86,
    heat: 24,
  };
  const api = vm.runInNewContext(`({${source.slice(start, end)}})`, {
    window: {
      addEventListener: (name, listener) => {
        events[name] = listener;
      },
    },
    userState,
    STORAGE_KEY: 'free_bbs_auth_token',
    renderUser: () => {
      renders += 1;
    },
  });
  const user = { uid: 'u_test', electrons: 122, manetrons: 86, heat: 24 };
  assert.equal(api.syncWallet(user, 'token-one'), true);
  assert.equal(userState.electrons, 122);
  events.storage({ key: 'free_bbs_auth_token' });
  assert.equal(api.syncWallet({ ...user, electrons: 124 }, 'token-one'), false);
  assert.equal(userState.electrons, 122);
  assert.equal(renders, 1);
  userState.token = 'token-two';
  events['freebbs:session-change']();
  assert.equal(api.syncWallet(user, 'token-one'), false);
  assert.equal(api.syncWallet({ ...user, uid: 'another' }, 'token-two'), false);
  assert.equal(api.syncWallet({ ...user, electrons: 124 }, 'token-two'), true);
  assert.equal(userState.electrons, 124);
});

test('the ranch timer restores the daily shear view at server Beijing midnight even when Max is hungry', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/profile-extras.js'), 'utf8');
  const start = source.indexOf('    const untilNextShear =');
  const end = source.indexOf('  function woolPanel', start);
  assert.ok(start > 0 && end > start);
  let clock = Date.parse('2026-09-21T15:59:59Z');
  const midnight = Date.parse('2026-09-21T16:00:00Z');
  let callback;
  let delay;
  let rendered;
  const state = {
    ranch: {
      adopted: true,
      hungry: true,
      fedUntilMs: clock - 1000,
      serverNowMs: clock,
      nextShearAtMs: midnight,
      shearedToday: true,
      woolReady: 2,
      woolStored: 3,
      feedProgress: 4,
    },
  };
  const context = {
    state,
    own: state,
    ranch: state.ranch,
    root: { isConnected: true },
    remaining: 0,
    Date: { now: () => clock },
    renderRanch: (value) => {
      rendered = value;
    },
    setTimeout(fn, ms) {
      callback = fn;
      delay = ms;
    },
  };
  vm.createContext(context);
  // Reuse the actual scheduled callback rather than duplicating its date arithmetic.
  vm.runInContext(`(function(){\n${source.slice(start, end)}\n)()`, context);
  assert.equal(delay, 1000);
  clock = midnight;
  callback();
  assert.equal(rendered.ranch.shearedToday, false);
  assert.equal(rendered.ranch.hungry, true);
  assert.equal(rendered.ranch.woolReady, 2);
  assert.equal(rendered.ranch.woolStored, 3);
  assert.equal(rendered.ranch.feedProgress, 4);
  assert.equal(context.own, rendered);
});
