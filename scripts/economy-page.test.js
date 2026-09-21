const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const crypto = require('node:crypto');
const { fragmentOffer } = require('../backend/economy-shop');

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
    window: { crypto, dispatchEvent() {} },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
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

test('shop groups all enabled products into four ordered sections without changing the catalog', async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/shop-items.json'))).items;
  const before = JSON.stringify(catalog);
  const { context, node } = setup({ callApi: async () => ({ assets: [], shopItems: catalog }) });
  const groups = JSON.parse(JSON.stringify(context.groupShopItems(catalog)));
  assert.deepEqual(
    groups.map((group) => group.title),
    ['装扮', '收藏', '消耗品', '伙伴'],
  );
  assert.deepEqual(
    groups.map((group) => group.items.map((entry) => entry.key)),
    [
      ['frame_orbit', 'frame_aurora', 'card_blueprint', 'card_twilight', 'plate_observer', 'laser'],
      [
        'mysterious_fragment',
        'maxwell_spectacles',
        'faraday_ring',
        'shannon_coin',
        'hertz_resonator',
      ],
      ['differential_converter', 'fortune_bag'],
      ['max_pet', 'fish', 'fishbone', 'rubber_rod'],
    ],
  );
  assert.equal(JSON.stringify(catalog), before);
  await context.loadElectromagneticPage();
  const html = node('shop-grid').innerHTML;
  assert.equal((html.match(/data-shop-section=/g) || []).length, 4);
  assert.equal((html.match(/class="shop-item-card"/g) || []).length, 17);
  assert.doesNotMatch(html, /data-item-key="plate_maxwell"/);
});

test('activation buttons expose cost and balance and disable insufficient currency', () => {
  const { context } = setup();
  const available = context.renderActivationButton(item, 'electric');
  const unavailable = context.renderActivationButton(item, 'magnetic');
  assert.match(available, /电元购买 · 1 电元/);
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

test('earned bones use the recycling section without dropping ranch/achievement assets', async () => {
  const assets = [
    { key: 'ordinary_fishbone', quantity: 10 },
    { key: 'golden_fishbone', quantity: 3 },
    { key: 'fishbone', quantity: 10 },
  ];
  const { context, node } = setup({ callApi: async () => ({ assets, shopItems: [] }) });
  await context.loadInventoryPage();
  assert.doesNotMatch(node('inventory-list').innerHTML, /data-asset-key="ordinary_fishbone"/);
  assert.doesNotMatch(node('inventory-list').innerHTML, /data-asset-key="golden_fishbone"/);
  assert.match(node('inventory-list').innerHTML, /data-asset-key="fishbone"/);
  assert.equal(context.window.freeBbsInventoryAssets.length, 3);
  assert.equal(assets[0].quantity, 10);
  const only = setup({ callApi: async () => ({ assets: assets.slice(0, 1), shopItems: [] }) });
  await only.context.loadInventoryPage();
  assert.match(only.node('inventory-list').innerHTML, /仓库里还没有物品/);
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

function giftSetup() {
  const h = setup();
  const input = { value: 'receiver' };
  const modal = h.node('shop-inspect-modal');
  modal.querySelector = (selector) =>
    selector === '.inventory-gift-input' ? input : h.node('shop-inspect-message');
  h.context.loadInventoryPage = async () => {};
  const button = { disabled: false, dataset: { action: 'gift-inventory-item', assetKey: 'fish' } };
  const click = (targetButton = button) =>
    h.context.handleInventoryPageClick({
      target: { closest: (selector) => (selector === '[data-action]' ? targetButton : null) },
    });
  return { ...h, input, button, click };
}

test('gift UI reuses its ID after network failure; a confirmed success allows a new gift', async () => {
  const h = giftSetup();
  const bodies = [];
  h.context.callApi = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw new Error('Failed to fetch');
    return { recipient: { username: 'receiver' } };
  };
  await h.click();
  await h.click({ ...h.button, disabled: false }); // A reopened modal has a new button.
  await h.click();
  assert.equal(bodies[0].requestKey, bodies[1].requestKey);
  assert.notEqual(bodies[1].requestKey, bodies[2].requestKey);
});

test('gift UI blocks concurrent activation and isolates IDs by recipient and session', async () => {
  const h = giftSetup();
  let reject;
  const bodies = [];
  h.context.callApi = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  };
  const first = h.click();
  await h.click({ ...h.button, disabled: false });
  assert.equal(bodies.length, 1);
  reject(new Error('timeout'));
  await first;
  h.context.callApi = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    throw new Error('timeout');
  };
  h.input.value = 'third';
  await h.click();
  h.input.value = 'receiver';
  await h.click();
  assert.equal(bodies[0].requestKey, bodies[2].requestKey);
  assert.notEqual(bodies[0].requestKey, bodies[1].requestKey);
  h.context.userState.token = 'another-login';
  await h.click();
  assert.notEqual(bodies[0].requestKey, bodies[3].requestKey);
});

test('gift UI ignores a late response from a previous login', async () => {
  const h = giftSetup();
  let resolve;
  let reloads = 0;
  h.context.loadInventoryPage = async () => {
    reloads += 1;
  };
  h.context.callApi = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = h.click();
  h.context.userState.token = 'another-login';
  resolve({ recipient: { username: 'receiver' } });
  await pending;
  assert.equal(reloads, 0);
  assert.doesNotMatch(h.node('inventory-message').textContent, /已赠与/);
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

function fragment(count) {
  const purchasePolicy = fragmentOffer(count);
  return {
    key: 'mysterious_fragment',
    requiresPersonalPrice: true,
    assetKey: 'mysterious_fragment',
    name: '神秘的碎片',
    cost: purchasePolicy.soldOut ? {} : { electric: purchasePolicy.nextPrice },
    purchasePolicy,
  };
}

test('personalized price twenty wins over stale static price five and shows purchase count', async () => {
  const { context, node } = setup({
    callApi: async () => ({
      shopItems: [fragment(2)],
      assets: [{ key: 'mysterious_fragment', requiresPersonalPrice: true, quantity: 2 }],
    }),
    fetch: async () => {
      throw new Error('static JSON must not override account prices');
    },
  });
  await context.loadElectromagneticPage();
  const html = node('shop-grid').innerHTML;
  assert.match(html, /20 电元/);
  assert.match(html, /累计计数 2 \/ 10/);
  assert.match(html, /下次购买第 3 个/);
  assert.doesNotMatch(html, /5 电元/);
});

test('the tenth tier costs 777 and fully purchased fragments remain viewable without a buy button', async () => {
  const { context, node } = setup({ callApi: async () => ({ shopItems: [fragment(10)] }) });
  assert.equal(context.renderShopItemPrice(fragment(9)), '777 电元');
  await context.loadElectromagneticPage();
  assert.match(node('shop-grid').innerHTML, /已达购买上限/);
  assert.equal(context.renderActivationButton(fragment(10), 'electric'), '');
  assert.match(context.renderShopPurchaseActions(fragment(10)), /已有物品仍保留/);
});

test('missing private pricing never enables buying fragments at the static starting price', async () => {
  const { context } = setup({
    callApi: async () => ({ assets: [] }),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        items: [{ key: 'mysterious_fragment', requiresPersonalPrice: true, cost: { electric: 5 } }],
      }),
    }),
  });
  await context.loadElectromagneticPage();
  const personalItem = context.economyShopItems[0];
  assert.equal(context.renderActivationButton(personalItem, 'electric'), '');
  assert.equal(context.renderShopItemPrice(personalItem), '请刷新以获取账号价格');
});

test('inventory distinguishes current holdings from the initialized purchase counter', async () => {
  const { context, node } = setup({
    callApi: async () => ({
      shopItems: [fragment(2)],
      assets: [{ key: 'mysterious_fragment', requiresPersonalPrice: true, quantity: 7 }],
    }),
  });
  await context.loadInventoryPage();
  assert.match(node('inventory-list').innerHTML, /已拥有 7/);
  assert.match(node('inventory-list').innerHTML, /累计计数 2 \/ 10/);
});

function purchaseSetup(overrides = {}) {
  const result = setup({ economyShopItems: [fragment(2)], ...overrides });
  const { context, node } = result;
  const button = {
    disabled: false,
    dataset: { action: 'purchase-item', itemKey: 'mysterious_fragment', currency: 'electric' },
  };
  const modal = node('shop-inspect-modal');
  modal.dataset.itemKey = 'mysterious_fragment';
  modal.querySelector = node;
  modal.querySelectorAll = () => [button];
  context.ensureShopInspectModal = () => modal;
  const click = () =>
    context.handleElectromagneticPageClick({
      target: { closest: (selector) => (selector === '[data-action]' ? button : null) },
    });
  return { ...result, button, modal, click };
}

test('ambiguous request failure retries the same purchase id without trusting a client price', async () => {
  const bodies = [];
  const { click, button, node } = purchaseSetup({
    callApi: async (route, options) => {
      if (options.method === 'POST') {
        bodies.push(JSON.parse(options.body));
        if (bodies.length === 1) throw new Error('模拟响应丢失');
        return {
          shopItems: [fragment(3)],
          purchase: { purchaseNumber: 3, amount: 20, replayed: true },
        };
      }
      return { shopItems: [fragment(3)], assets: [] };
    },
  });
  await click();
  button.disabled = false;
  await click();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].requestKey, bodies[1].requestKey);
  assert.equal(bodies[0].expectedPurchaseCount, 2);
  assert.equal(bodies[0].currency, 'electric');
  assert.equal(bodies[0].amount, undefined);
  assert.match(node('#shop-inspect-message').textContent, /未重复扣款/);
});

test('stale quote refreshes without automatically buying at a higher price', async () => {
  let purchases = 0;
  const { click, context, node, modal } = purchaseSetup({
    callApi: async (route, options) => {
      if (options.method === 'POST') {
        purchases += 1;
        throw Object.assign(new Error('购买次数已变化，请确认后再购买'), { status: 409 });
      }
      return { shopItems: [fragment(3)] };
    },
  });
  modal.classList.remove('hidden');
  await click();
  assert.equal(purchases, 1);
  assert.equal(context.economyShopItems[0].cost.electric, 30);
  assert.equal(node('#shop-inspect-price').textContent, '30 电元');
  assert.match(node('#shop-inspect-message').textContent, /请确认后再购买/);
});

test('an account change invalidates an in-flight personalized catalog response', async () => {
  let release;
  const { context, node } = setup({
    callApi: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = context.loadElectromagneticPage();
  context.userState.token = 'another-account';
  release({ shopItems: [fragment(9)] });
  await pending;
  assert.equal(node('shop-grid').innerHTML, '');
  assert.equal(context.economyShopItems.length, 0);
});

test('relic price uses plus and has exactly one combined buy button', () => {
  const { context } = setup({ userState: { electrons: 120, manetrons: 600 } });
  const relic = {
    key: 'maxwell_spectacles',
    priceMode: 'combined',
    cost: { electric: 120, magnetic: 600 },
  };
  assert.equal(context.renderShopCost(relic.cost, relic.priceMode), '120 电元 ＋ 600 磁元');
  const actions = context.renderShopPurchaseActions(relic);
  assert.equal((actions.match(/data-action="purchase-item"/g) || []).length, 1);
  assert.match(actions, /data-currency="combined"/);
  assert.doesNotMatch(actions, /disabled/);
  context.userState.manetrons = 599;
  assert.match(context.renderShopPurchaseActions(relic), /disabled/);
});
test('laser controls clearly show dual-currency daily price, expiry and extension', () => {
  const { context } = setup();
  const html = context.renderLaserControls({
    key: 'laser',
    laser: { owned: true, expiresAtMs: 100000, serverNowMs: 0, dailyPrice: 1, dailyMagnetic: 1 },
  });
  assert.match(html, /柔光已开启/);
  assert.match(html, /电元＋1 磁元激发 24 小时/);
  assert.match(html, /可累加时长/);
  assert.doesNotMatch(html, /不自动扣款/);
  assert.match(html, /磁元/);
});

test('catalog rules use positive user-facing copy and concise cosmetic instructions', () => {
  const { items } = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/shop-items.json')));
  for (const entry of items) {
    assert.doesNotMatch(entry.rules, /不|不能|禁止/);
    if (['avatar_frame', 'profile_card', 'nameplate'].includes(entry.class))
      assert.equal(entry.rules, `${entry.cost.magnetic} 磁元，限购1件，可在个人主页装扮。`);
  }
  const laser = items.find((entry) => entry.key === 'laser');
  assert.equal(
    laser.desc,
    '一只总想闪亮登场的小家伙。\n外壳上贴着一张微微卷边的便笺：「请给我一点电，我有一个光明的想法。」',
  );
  assert.match(laser.rules, /每1 电元＋1 磁元激发24小时/);
  assert.doesNotMatch(source, /学者收藏 · 后续提供实物/);
});
test('flavor text is distinct from transaction rules and relic prices are not alternatives', () => {
  const { context } = setup();
  const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/shop-items.json')));
  for (const entry of catalog.items.filter((i) => i.rules)) {
    assert.doesNotMatch(entry.desc, /购买|充值|限购|电元|磁元|累计/);
    assert.match(context.renderShopRules(entry), /购买与使用说明/);
  }
});
