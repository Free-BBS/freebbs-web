const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/tool-workshop'), 'utf8');
const page = fs.readFileSync(require.resolve('../public/tool-workshop.html'), 'utf8');

function fixture() {
  const nodes = new Map();
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const node = {
      id,
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      attributes: {},
      handlers: {},
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 300,
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      getAttribute(key) {
        return this.attributes[key];
      },
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
      focus() {},
      querySelectorAll() {
        return [];
      },
      cloneNode() {
        return this;
      },
      replaceWith() {},
      querySelector() {
        return {};
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    nodes.set(id, node);
    return node;
  }
  [...page.matchAll(/id="([^"]+)"/g)].forEach((match) => element(match[1]));
  element('tool-studio').hidden = true;
  const panels = ['preview', 'code', 'publish'].map((name) => {
    const button = element(`tab-${name}`);
    button.dataset.toolPanel = name;
    button.setAttribute('aria-controls', `tool-panel-${name}`);
    return button;
  });
  const scopes = ['all', 'mine'].map((name) => {
    const button = element(`scope-${name}`);
    button.dataset.toolScope = name;
    return button;
  });
  element('tool-studio').querySelectorAll = () => [
    ...panels,
    ...['generate', 'cancel', 'preview', 'publish', 'edit-code'].map((id) => element(`tool-${id}`)),
  ];
  const timers = new Map();
  let nextTimer = 0;
  let generation;
  let resolve;
  let reject;
  const requests = [];
  const window = {
    freeBbsApp: {
      sessionReady: Promise.resolve(),
      userState: { isLoggedIn: true, token: 'fixture' },
      apiBaseUrl: '/api',
      callApi: async (url, options) => {
        requests.push({ url, options });
        return { tools: [] };
      },
    },
    FreeBbsToolEmbeds: { sandboxDocument: (html) => `sandbox:${html}` },
    FreeBbsReasoning: {
      request: (options) => {
        generation = options;
        return new Promise((res, rej) => {
          resolve = res;
          reject = rej;
          options.signal.addEventListener('abort', () => rej(new Error('stopped')));
        });
      },
      update() {},
      finish() {},
    },
    hljs: {
      highlight: (html) => ({ value: html.replaceAll('&', '&amp;').replaceAll('<', '&lt;') }),
    },
    location: { href: 'https://example.test/tool-workshop', search: '' },
    addEventListener() {},
  };
  const document = {
    getElementById: element,
    querySelectorAll: (selector) =>
      selector === '[data-tool-panel]' ? panels : selector === '[data-tool-scope]' ? scopes : [],
  };
  vm.runInNewContext(source, {
    window,
    document,
    AbortController,
    URL,
    URLSearchParams,
    setTimeout: (fn) => {
      nextTimer += 1;
      timers.set(nextTimer, fn);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    element,
    requests,
    click: (id) => element(id).handlers.click(),
    get generation() {
      return generation;
    },
    resolve: (html) => resolve({ html }),
    reject: (message) => reject(new Error(message)),
    flush: () => {
      for (const [id, fn] of timers) {
        timers.delete(id);
        fn();
      }
    },
  };
}

test('workshop switches between square and studio, then displays only the selected output panel', () => {
  const ui = fixture();
  ui.click('tool-create-toggle');
  assert.equal(ui.element('tool-studio').hidden, false);
  assert.equal(ui.element('tool-gallery-view').hidden, true);
  for (const selected of ['code', 'publish', 'preview']) {
    ui.click(`tab-${selected}`);
    for (const name of ['preview', 'code', 'publish'])
      assert.equal(ui.element(`tool-panel-${name}`).hidden, name !== selected);
  }
  ui.click('tool-create-toggle');
  assert.equal(ui.element('tool-studio').hidden, true);
  assert.equal(ui.element('tool-gallery-view').hidden, false);
});

test('manual HTML editing keeps the highlighted view and sandboxed preview synchronized', () => {
  const ui = fixture();
  ui.click('tool-edit-code');
  assert.equal(ui.element('tool-html').hidden, false);
  ui.element('tool-html').value = '<html><body>我的工具</body></html>';
  ui.click('tool-edit-code');
  assert.equal(ui.element('tool-html').hidden, true);
  assert.match(ui.element('tool-code-highlight').innerHTML, /&lt;html>/);
  ui.click('tab-preview');
  assert.equal(ui.element('tool-preview-frame').hidden, false);
  assert.equal(ui.element('tool-preview-empty').hidden, true);
  assert.equal(ui.element('tool-preview-frame').srcdoc, `sandbox:${ui.element('tool-html').value}`);
});

test('SSE source is highlighted before completion but never replaces the draft or runs in preview', async () => {
  const ui = fixture();
  const original = '<html><body>原稿</body></html>';
  ui.element('tool-html').value = original;
  ui.element('tool-prompt').value = '添加计时器';
  ui.click('tool-preview');
  const done = ui.click('tool-generate');
  assert.equal(ui.element('tool-panel-code').hidden, false);
  assert.equal(ui.element('tool-generate').disabled, true);
  assert.equal(ui.element('tab-preview').disabled, false);
  ui.generation.onHtml('<html><script>alert(1)</script>');
  ui.flush();
  assert.match(ui.element('tool-code-highlight').innerHTML, /&lt;script>/);
  assert.equal(ui.element('tool-html').value, original);
  assert.equal(ui.element('tool-preview-frame').srcdoc, `sandbox:${original}`);
  const final = '<html><body>计时器</body></html>';
  ui.resolve(final);
  await done;
  assert.equal(ui.element('tool-html').value, final);
  assert.equal(ui.element('tool-preview-frame').srcdoc, `sandbox:${final}`);
  assert.equal(ui.element('tool-generate').disabled, false);
  assert.equal(ui.element('tool-cancel').hidden, true);
});

for (const failure of ['cancel', 'error']) {
  test(`${failure} restores highlighted draft and preserves the existing preview`, async () => {
    const ui = fixture();
    const original = '<html><body>保留原稿</body></html>';
    ui.element('tool-html').value = original;
    ui.element('tool-prompt').value = '修改';
    ui.click('tool-preview');
    const done = ui.click('tool-generate');
    ui.generation.onHtml('<html>未完成');
    if (failure === 'cancel') ui.click('tool-cancel');
    else ui.reject('连接中断');
    await done;
    ui.flush();
    assert.equal(ui.element('tool-html').value, original);
    assert.match(ui.element('tool-code-highlight').innerHTML, /保留原稿/);
    assert.equal(ui.element('tool-preview-frame').srcdoc, `sandbox:${original}`);
    assert.equal(ui.element('tool-generate').disabled, false);
    assert.match(
      ui.element('tool-studio-status').textContent,
      failure === 'cancel' ? /已停止/ : /连接中断/,
    );
  });
}
