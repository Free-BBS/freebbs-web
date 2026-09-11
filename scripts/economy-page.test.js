const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const publicDir = path.join(__dirname, '..', 'public');
const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const item = {
  key: 'differential_converter',
  assetKey: 'differential_converter',
  name: '微分器',
  description: '一次性转换资产。',
  desc: '第一行\n第二行',
  cost: { electric: 1, magnetic: 1 },
};

function makeElement() {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    textContent: '',
    dataset: {},
    disabled: false,
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    focus() {
      this.focused = true;
    },
  };
}

function setup(overrides = {}) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeElement());
    return nodes.get(id);
  };
  const context = vm.createContext({
    console,
    Map,
    window: {},
    userState: { isLoggedIn: true, token: 'mock', electrons: 2, manetrons: 0 },
    economyShopItems: [],
    document: { getElementById: node, activeElement: null },
    escapeHtml: (text) =>
      String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    renderEconomyBalances() {},
    saveSession() {},
    isElectromagneticPage: () => true,
    isInventoryPage: () => true,
    callApi: async () => ({ assets: [], shopItems: [item] }),
    fetch: async () => ({ ok: true, json: async () => ({ items: [item] }) }),
    ...overrides,
  });
  vm.runInContext(
    source.slice(
      source.indexOf('function renderShopCost('),
      source.indexOf('function renderHeatLeaderboard('),
    ),
    context,
  );
  return { context, node };
}

test('alternative currency prices are explicit, and unavailable pricing is not zero', () => {
  const { context } = setup();
  assert.equal(context.renderShopCost(item.cost), '1 电元 或 1 磁元');
  assert.equal(context.renderShopCost({ electric: 5 }), '5 电元');
  assert.equal(context.renderShopCost({}), '未定价');
});

test('activation buttons expose cost and balance and disable insufficient currency', () => {
  const { context } = setup();
  const available = context.renderActivationButton(item, 'electric');
  const unavailable = context.renderActivationButton(item, 'magnetic');
  assert.match(available, /电激发 · 1 电元/);
  assert.match(available, /持有 2/);
  assert.doesNotMatch(available, /disabled/);
  assert.match(unavailable, /disabled/);
  assert.match(unavailable, /持有 0 · 余额不足/);
  assert.equal(context.renderActivationButton({ ...item, cost: {} }, 'electric'), '');
});

test('shop cards render description, price, labelled owned count and escaped titles', async () => {
  const { context, node } = setup({
    fetch: async () => ({ ok: true, json: async () => ({ items: [{ ...item, name: '<物品>' }] }) }),
    callApi: async () => ({ assets: [{ key: item.key, quantity: 3 }] }),
  });
  await context.loadElectromagneticPage();
  const html = node('shop-grid').innerHTML;
  assert.match(html, /已拥有 3/);
  assert.match(html, /一次性转换资产/);
  assert.match(html, /1 电元 或 1 磁元/);
  assert.match(html, /&lt;物品>/);
  assert.doesNotMatch(html, /<物品>/);
});

test('empty shop and inventory remain readable instead of leaving blank grids', async () => {
  const { context, node } = setup({
    fetch: async () => ({ ok: true, json: async () => ({ items: [] }) }),
    callApi: async () => ({ assets: [], shopItems: [] }),
  });
  await context.loadElectromagneticPage();
  await context.loadInventoryPage();
  assert.match(node('shop-grid').innerHTML, /暂无商品/);
  assert.match(node('inventory-list').innerHTML, /仓库里还没有物品/);
});

test('inventory cards retain quantity and detail action with a readable description', async () => {
  const { context, node } = setup({
    callApi: async () => ({ assets: [{ key: item.key, quantity: 2 }] }),
  });
  await context.loadInventoryPage();
  assert.match(node('inventory-list').innerHTML, /已拥有 2/);
  assert.match(node('inventory-list').innerHTML, /一次性转换资产/);
  assert.match(node('inventory-list').innerHTML, /inspect-inventory-item/);
});

test('catalog fetch failure uses backend catalog; API failure shows a message', async () => {
  const { context, node } = setup({
    fetch: async () => {
      throw new Error('offline');
    },
  });
  await context.loadElectromagneticPage();
  assert.match(node('shop-grid').innerHTML, /微分器/);
  context.callApi = async () => {
    throw new Error('暂时无法连接');
  };
  await context.loadElectromagneticPage();
  assert.equal(node('economy-message').textContent, '暂时无法连接');
});

test('viewing details focuses the close button and closing restores the invoking button', () => {
  const { context, node } = setup();
  const modal = node('shop-inspect-modal');
  const trigger = {
    isConnected: true,
    focus() {
      this.focused = true;
    },
  };
  const close = makeElement();
  modal.querySelector = () => close;
  context.document.activeElement = trigger;
  context.showShopInspectModal(modal);
  assert.equal(close.focused, true);
  assert.equal(modal.classList.contains('hidden'), false);
  context.closeShopInspectModal();
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(trigger.focused, true);
});

test('purchase feedback stays in the open detail and parallel activation is prevented', async () => {
  const { context, node } = setup();
  const modal = node('shop-inspect-modal');
  const button = {
    disabled: false,
    dataset: { action: 'purchase-item', itemKey: item.key, currency: 'electric' },
  };
  modal.dataset.itemKey = item.key;
  modal.querySelector = node;
  modal.querySelectorAll = () => [button];
  context.ensureShopInspectModal = () => modal;
  let release;
  let calls = 0;
  context.callApi = () => {
    calls += 1;
    return new Promise((resolve, reject) => {
      release = reject;
    });
  };
  const event = {
    target: { closest: (selector) => (selector === '[data-action]' ? button : null) },
  };
  const pending = context.handleElectromagneticPageClick(event);
  await context.handleElectromagneticPageClick(event);
  assert.equal(calls, 1);
  release(new Error('模拟请求失败'));
  await pending;
  assert.equal(node('#shop-inspect-message').textContent, '模拟请求失败');
  assert.equal(modal.dataset.purchasing, undefined);
});

test('scoped CSS removes ratio stretch, bounds dialogs and follows theme variables', () => {
  const css = fs.readFileSync(path.join(publicDir, 'economy.css'), 'utf8');
  assert.match(css, /repeat\(auto-fill/);
  assert.match(css, /aspect-ratio: auto/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /white-space: pre-line/);
  assert.match(css, /var\(--ui-accent\)/);
  for (const file of ['electromagnetic.html', 'inventory.html']) {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.ok(html.indexOf('/economy.css') > html.indexOf('/ui-polish.css'));
    assert.ok(html.indexOf('/economy.css') > html.indexOf('/layout-fixes.css'));
    for (const sharedAsset of [
      'username-guard.css',
      'notifications.css',
      'username-guard.js',
      'notifications.js',
    ]) {
      assert.ok(html.includes(`/${sharedAsset}`), `${file} keeps ${sharedAsset}`);
    }
  }
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="shop-inspect-title"/);
  assert.match(source, /id="shop-inspect-message" role="status"/);
});
