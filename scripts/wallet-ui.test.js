const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
function setup(file, callApi = async () => ({ entries: [], nextCursor: null })) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, element(id));
    return nodes.get(id);
  };
  function element(id = '') {
    const events = new Map();
    const classes = new Set();
    return {
      id,
      dataset: {},
      children: [],
      textContent: '',
      value: '',
      open: false,
      disabled: false,
      isConnected: true,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      addEventListener(name, listener) {
        if (!events.has(name)) events.set(name, []);
        events.get(name).push(listener);
      },
      emit(name, event = {}) {
        return Promise.all((events.get(name) || []).map((listener) => listener(event)));
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      querySelector: get,
      querySelectorAll() {
        return [...nodes.values()].filter((node) => node.id.startsWith('bone-sale-'));
      },
      focus() {
        this.focused = true;
      },
      select() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
        this.emit('close');
      },
      reportValidity() {
        return true;
      },
    };
  }
  const window = element();
  const timers = new Map();
  let timerSequence = 0;
  const app = {
    userState: { uid: 'test', token: 'first', isLoggedIn: true, electrons: '100', manetrons: '12' },
    sessionReady: new Promise(() => {}),
    callApi,
    refreshEconomy: async () =>
      window.emit('freebbs:inventory-change', {
        detail: {
          assets: [
            { key: 'ordinary_fishbone', quantity: 8 },
            { key: 'golden_fishbone', quantity: 2 },
          ],
        },
      }),
  };
  Object.assign(window, {
    freeBbsApp: app,
    crypto,
    location: { hash: '' },
    dispatchEvent: (event) => window.emit(event.type, event),
    setTimeout(callback, delay) {
      timerSequence += 1;
      timers.set(timerSequence, { callback, delay });
      return timerSequence;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const document = {
    getElementById: get,
    createElement: element,
    body: element(),
    activeElement: get('wallet-ledger-open'),
  };
  get('wallet-ledger-currency').value = 'all';
  const context = vm.createContext({
    window,
    document,
    URLSearchParams,
    AbortController,
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context);
  return { get, app, window, timers };
}
const text = (node) => node.textContent + node.children.map(text).join(' ');
const entry = (id, fields = {}) => ({
  id,
  electric_before: '100',
  electric_after: '100',
  magnetic_before: '10',
  magnetic_after: '12',
  title: '鱼骨出售',
  reason: '出售普通鱼骨 × 2',
  created_at: '2026-09-20T05:00:00Z',
  ...fields,
});

test('wallet fetches only when opened and renders precise deltas, reasons and after-balances', async () => {
  let calls = 0;
  const h = setup('wallet-ledger.js', async () => {
    calls += 1;
    return {
      entries: [
        entry(1, {
          magnetic_before: '90071992547409930',
          magnetic_after: '90071992547409932',
          reason: '<img src=x onerror=alert(1)>',
        }),
      ],
      nextCursor: null,
    };
  });
  assert.equal(calls, 0);
  await h.get('wallet-ledger-open').emit('click');
  await flush();
  const contents = text(h.get('wallet-ledger-list'));
  assert.match(contents, /\+2 磁元/);
  assert.match(contents, /90,071,992,547,409,932 磁元/);
  assert.match(contents, /此笔后资产/);
  assert.match(contents, /<img src=x onerror=alert\(1\)>/);
  assert.equal(
    h.get('wallet-ledger-list').children[0].children[1].children[1].innerHTML,
    undefined,
  );
  await h.get('wallet-ledger-close').emit('click');
  assert.equal(h.get('wallet-ledger').open, false);
  assert.equal(h.get('wallet-ledger-open').focused, true);
});

test('wallet pagination retains loaded rows on error and retries the same cursor', async () => {
  const urls = [];
  const h = setup('wallet-ledger.js', async (url) => {
    urls.push(url);
    if (urls.length === 2) throw new Error('模拟离线');
    return { entries: [entry(urls.length)], nextCursor: urls.length === 1 ? '45' : null };
  });
  await h.get('wallet-ledger-open').emit('click');
  await flush();
  await h.get('wallet-ledger-more').emit('click');
  await flush();
  assert.equal(h.get('wallet-ledger-list').children.length, 1);
  assert.match(h.get('wallet-ledger-status').textContent, /已加载记录仍保留/);
  await h.get('wallet-ledger-more').emit('click');
  await flush();
  assert.equal(urls[1], '/wallet/ledger?currency=all&before=45');
  assert.equal(urls[1], urls[2]);
  assert.equal(h.get('wallet-ledger-list').children.length, 2);
  assert.equal(h.get('wallet-ledger-more').hidden, true);
});

test('wallet discards a late response after a filter or session change', async () => {
  const releases = [];
  const h = setup(
    'wallet-ledger.js',
    () =>
      new Promise((resolve) => {
        releases.push(resolve);
      }),
  );
  await h.get('wallet-ledger-open').emit('click');
  h.get('wallet-ledger-currency').value = 'electric';
  await h.get('wallet-ledger-currency').emit('change');
  releases[1]({ entries: [entry(2, { title: '新筛选' })], nextCursor: null });
  await flush();
  releases[0]({ entries: [entry(1, { title: '过时筛选' })], nextCursor: null });
  await flush();
  assert.match(text(h.get('wallet-ledger-list')), /新筛选/);
  assert.doesNotMatch(text(h.get('wallet-ledger-list')), /过时筛选/);
  const pending = h.get('wallet-ledger-refresh').emit('click');
  h.app.userState.token = 'second';
  await h.window.emit('freebbs:session-change');
  releases[2]({ entries: [entry(3)], nextCursor: null });
  await pending;
  await flush();
  assert.equal(h.get('wallet-ledger-list').children.length, 0);
  assert.equal(h.get('wallet-ledger').open, false);
});

test('empty and failed wallet views expose an actionable status', async () => {
  const h = setup('wallet-ledger.js');
  await h.get('wallet-ledger-open').emit('click');
  await flush();
  assert.match(h.get('wallet-ledger-status').textContent, /白纸/);
  h.app.callApi = async () => {
    throw new Error('暂时不可用');
  };
  await h.get('wallet-ledger-refresh').emit('click');
  await flush();
  assert.match(h.get('wallet-ledger-status').textContent, /刷新.*重试/);
  assert.equal(h.get('wallet-ledger-refresh').disabled, false);
});

async function saleSetup(callApi) {
  const h = setup('inventory-sales.js', callApi);
  await h.app.refreshEconomy();
  h.open = async (key = 'ordinary_fishbone') =>
    h.get('bone-recycling').emit('click', {
      target: { closest: () => ({ dataset: { sellBone: key }, disabled: false }) },
    });
  h.sell = () => h.get('bone-sale-form').emit('submit', { preventDefault() {} });
  return h;
}

test('sale quotes reject fractional, negative and excessive quantities', async () => {
  const h = await saleSetup();
  await h.open('golden_fishbone');
  h.get('bone-sale-quantity').value = '2';
  await h.get('bone-sale-quantity').emit('input');
  assert.equal(h.get('bone-sale-total').textContent, '20 磁元');
  for (const value of ['-1', '0', '1.5', '3', '']) {
    h.get('bone-sale-quantity').value = value;
    await h.get('bone-sale-quantity').emit('input');
    assert.equal(h.get('bone-sale-submit').disabled, true, value);
  }
});

test('sale blocks duplicate submits and retains request key after a lost response or reopened dialog', async () => {
  let release;
  const bodies = [];
  const h = await saleSetup((_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Promise((_resolve, reject) => {
      release = reject;
    });
  });
  await h.open();
  const pending = h.sell();
  await h.sell();
  assert.equal(bodies.length, 1);
  release(new Error('响应丢失'));
  await pending;
  await h.get('bone-sale-cancel').emit('click');
  await h.open();
  const retry = h.sell();
  release(new Error('仍然离线'));
  await retry;
  assert.equal(bodies[0].requestKey, bodies[1].requestKey);
  assert.equal(bodies[0].quantity, 1);
  assert.equal(bodies[0].itemKey, 'ordinary_fishbone');
});

test('a replayed successful sale refreshes server state rather than applying stale receipt balances', async () => {
  const h = await saleSetup(async () => ({
    receipt: { quantity: 2, amount: 2, replayed: true, balance: { magnetic: '999' } },
  }));
  let refreshed = 0;
  const refresh = h.app.refreshEconomy;
  h.app.refreshEconomy = async () => {
    refreshed += 1;
    await refresh();
  };
  await h.open();
  h.get('bone-sale-quantity').value = '2';
  await h.sell();
  assert.equal(refreshed, 1);
  assert.equal(h.app.userState.manetrons, '12');
  assert.match(h.get('bone-recycling-status').textContent, /未重复出售/);
  assert.equal(h.get('bone-sale-dialog').open, false);
});

test('a completed sale with refresh failure does not invite a duplicate sale', async () => {
  const h = await saleSetup(async () => ({ receipt: { quantity: 1, amount: 1, replayed: false } }));
  h.app.refreshEconomy = async () => {};
  await h.open();
  await h.sell();
  assert.match(h.get('bone-recycling-status').textContent, /已出售.*刷新库存.*重试/);
  assert.equal(h.get('[data-sell-bone="ordinary_fishbone"]').disabled, true);
  assert.equal(h.get('bone-sale-dialog').open, false);
});

test('sale ignores previous-session results and closes its private dialog after logout', async () => {
  let release;
  const h = await saleSetup(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await h.open();
  const pending = h.sell();
  h.app.userState.isLoggedIn = false;
  h.app.userState.token = '';
  await h.window.emit('freebbs:session-change');
  release({ receipt: { quantity: 1, amount: 1 } });
  await pending;
  assert.equal(h.get('bone-sale-dialog').open, false);
  assert.doesNotMatch(h.get('bone-recycling-status').textContent, /已出售/);
});

test('cross-tab credential changes invalidate pending sales before app state catches up', async () => {
  let release;
  const h = await saleSetup(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await h.open();
  const pending = h.sell();
  await h.window.emit('storage', { key: 'free_bbs_auth_token' });
  release({ receipt: { quantity: 1, amount: 1 } });
  await pending;
  assert.equal(h.get('bone-sale-dialog').open, false);
  assert.doesNotMatch(h.get('bone-recycling-status').textContent, /已出售/);
  assert.equal(h.get('[data-sell-bone="ordinary_fishbone"]').disabled, true);
});

test('sale timeout aborts the request, releases the dialog, and retries the original transaction key', async () => {
  const calls = [];
  const h = await saleSetup((_url, options) => {
    calls.push(options);
    if (calls.length === 1) return new Promise(() => {});
    return Promise.resolve({ receipt: { quantity: 1, amount: 1, replayed: true } });
  });
  await h.open();
  const pending = h.sell();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await pending;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(h.get('bone-sale-submit').disabled, false);
  assert.equal(h.get('bone-sale-cancel').disabled, false);
  assert.match(h.get('bone-sale-status').textContent, /超时.*尚未确认.*不会重复出售/);
  await h.get('bone-sale-cancel').emit('click');
  assert.equal(h.get('bone-sale-dialog').open, false);
  await h.open();
  await h.sell();
  assert.equal(JSON.parse(calls[0].body).requestKey, JSON.parse(calls[1].body).requestKey);
  assert.match(h.get('bone-recycling-status').textContent, /未重复出售/);
  assert.equal(h.timers.size, 0);
});

test('a confirmed sale closes before an inventory refresh stalls and the refresh also times out', async () => {
  const h = await saleSetup(async () => ({ receipt: { quantity: 1, amount: 1 } }));
  h.app.refreshEconomy = () => new Promise(() => {});
  await h.open();
  const pending = h.sell();
  await flush();
  assert.equal(h.get('bone-sale-dialog').open, false);
  assert.match(h.get('bone-recycling-status').textContent, /已出售.*正在刷新库存/);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await pending;
  assert.match(h.get('bone-recycling-status').textContent, /已出售.*刷新超时.*重试/);
  assert.equal(h.get('bone-recycling-refresh').disabled, false);
  assert.equal(h.get('[data-sell-bone="ordinary_fishbone"]').disabled, true);
  assert.equal(h.timers.size, 0);
});

function walletStyleRule(selector, mobile = false) {
  const css = fs.readFileSync(path.join(__dirname, '../public/wallet-ledger.css'), 'utf8');
  const boundary = css.indexOf('@media (max-width: 560px)');
  const scope = mobile ? css.slice(boundary) : css.slice(0, boundary);
  const start = scope.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing style rule: ${selector}`);
  return scope.slice(start, scope.indexOf('}', start) + 1);
}

test('wallet reading sizes are enlarged without enlarging its warehouse entry button', () => {
  for (const selector of [
    '.wallet-dialog',
    '.wallet-dialog-header > p',
    '.wallet-state',
    '.wallet-entry-heading h3',
    '.wallet-entry-reason',
    '.wallet-entry-balances strong',
    '.wallet-more',
  ]) {
    assert.match(walletStyleRule(selector), /font-size: 16px;/, selector);
  }
  for (const selector of [
    '.wallet-dialog .wallet-eyebrow',
    '.wallet-current-balances span',
    '.wallet-toolbar',
    '.wallet-entry-balances',
    '.wallet-entry-content time',
    '.wallet-dialog-footer',
  ]) {
    assert.match(walletStyleRule(selector), /font-size: 14px;/, selector);
  }
  assert.match(walletStyleRule('.wallet-dialog h2'), /font-size: 26px;/);
  assert.match(walletStyleRule('.wallet-ledger-deltas'), /font-size: 18px;/);
  assert.match(walletStyleRule('.wallet-dialog'), /line-height: 1\.5;/);
  assert.match(walletStyleRule('.wallet-entry-reason'), /line-height: 1\.5;/);
  assert.match(walletStyleRule('.wallet-launch-copy strong'), /font-size: 19px;/);
  assert.match(walletStyleRule('.wallet-launch-copy > span'), /font-size: 13px;/);
});

test('larger wallet type retains narrow-screen wrapping, scroll bounds and light/dark colors', () => {
  assert.match(walletStyleRule('.wallet-ledger-deltas', true), /font-size: 16px;/);
  assert.match(walletStyleRule('.wallet-entry-heading', true), /flex-wrap: wrap;/);
  assert.match(walletStyleRule('.wallet-entry-balances'), /flex-wrap: wrap;/);
  assert.match(walletStyleRule('.wallet-entry-reason'), /overflow-wrap: anywhere;/);
  assert.match(walletStyleRule('.wallet-dialog', true), /width: calc\(100vw - 18px\);/);
  assert.match(walletStyleRule('.wallet-scroll'), /overflow-y: auto;/);
  assert.match(walletStyleRule('.wallet-dialog'), /background: var\(--ui-surface\);/);
  assert.match(walletStyleRule('.wallet-dialog'), /color: var\(--ui-text\);/);
  assert.match(walletStyleRule('body.inventory-page'), /--wallet-positive: #176342;/);
  assert.match(walletStyleRule('body.inventory-page.theme-dark'), /--wallet-positive: #88e2b8;/);
  assert.match(
    walletStyleRule('body.inventory-page.theme-dark .wallet-current-balances .currency-icon'),
    /invert\(0\.93\)/,
  );
});
