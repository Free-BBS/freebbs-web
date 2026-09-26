const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { normalize } = require('../public/max-artifact-data');

test('saved artifacts retain full HTML and validate circuit documents without executing code', () => {
  const html = `<html><script>throw new Error('never execute')</script>${'x'.repeat(90000)}</html>`;
  assert.equal(normalize({ kind: 'tool', html }).html, html);
  assert.throws(() => normalize({ kind: 'tool', html: 'x'.repeat(180001) }));
  assert.throws(() => normalize({ kind: 'tool', html: '' }));
  assert.throws(() => normalize({ kind: 'remote', url: 'https://example.com' }));
  assert.throws(() => normalize({ kind: 'circuit', document: { components: [{}], wires: [] } }));
  const document = { version: 1, components: [], wires: [], analysis: { type: 'dc' } };
  assert.deepEqual(normalize({ kind: 'circuit', document }).document, document);
});

function harness() {
  class Element {
    constructor() {
      this.children = [];
      this.handlers = {};
      this.value = 'tool';
    }

    append(...items) {
      this.children.push(...items);
    }

    remove() {
      this.removed = true;
    }

    setAttribute(key, value) {
      this[key] = value;
    }

    addEventListener(name, handler) {
      this.handlers[name] = handler;
    }

    querySelector(selector) {
      return selector === '.aichat-bubble' ? this.bubble : null;
    }
  }
  const selector = new Element();
  const article = new Element();
  article.bubble = new Element();
  const stored = new Map();
  const id = '12345678-1234-1234-1234-123456789012';
  const calls = [];
  const window = {
    FreeBbsMaxArtifactData: { normalize },
    freeBbsApp: {
      apiBaseUrl: '/api',
      userState: { token: 'test', uid: 'u_test', isLoggedIn: true },
    },
    crypto: { randomUUID: () => id },
    location: { search: `?maxDraft=${id}`, assign: (url) => calls.push(url) },
    FreeBbsReasoning: {
      request: async (options) => {
        calls.push(options);
        options.onHtml('<html>ready</html>');
        return { html: '<html>ready</html>' };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/max-artifacts'), 'utf8'), {
    window,
    document: { getElementById: () => selector, createElement: () => new Element() },
    sessionStorage: {
      getItem: (key) => stored.get(key),
      setItem: (key, value) => stored.set(key, value),
    },
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  return { api: window.FreeBbsMaxArtifacts, window, calls, article, selector, stored, id };
}

test('HTML generation streams source, preserves prior draft, and produces a handoff without publishing', async () => {
  const h = harness();
  const result = await h.api.generate({
    kind: 'tool',
    prompt: 'calculator',
    previous: { kind: 'tool', html: 'old' },
    article: h.article,
    onStatus() {},
    onReasoning() {},
  });
  assert.equal(h.calls[0].url, '/api/tools/generate/html');
  assert.equal(h.calls[0].payload.currentHtml, 'old');
  assert.equal(result.artifact.html, '<html>ready</html>');
  assert.equal(h.selector.disabled, false);
  assert.equal(h.article.children[0].removed, true);
  h.api.mount(h.article, result.artifact);
  h.article.bubble.children[0].children[0].handlers.click();
  assert.equal(h.calls[1], `/tool-workshop?maxDraft=${h.id}`);
  assert.equal(h.api.read('tool', 'u_test').html, result.artifact.html);
  assert.throws(() => h.api.read('tool', 'another'), /其他账号/);
  assert.throws(() => h.api.read('circuit', 'u_test'), /类型不匹配/);
  const key = `free_bbs_max_artifact_v1:${h.id}`;
  const saved = JSON.parse(h.stored.get(key));
  saved.createdAt = 0;
  h.stored.set(key, JSON.stringify(saved));
  assert.throws(() => h.api.read('tool', 'u_test'), /过期/);
});

test('failed or cancelled generation never returns a partial artifact and restores controls', async () => {
  const h = harness();
  h.window.FreeBbsReasoning.request = (options) =>
    new Promise((resolve, reject) => {
      options.onHtml('<html>partial');
      options.signal.addEventListener('abort', () => reject(new Error('stopped')));
    });
  const running = h.api.generate({
    kind: 'tool',
    prompt: 'x',
    article: h.article,
    onStatus() {},
    onReasoning() {},
  });
  h.article.children[0].handlers.click();
  await assert.rejects(running, /stopped/);
  assert.equal(h.selector.disabled, false);
  assert.equal(h.stored.size, 0);
});

test('chat save, history, and destination pages retain artifacts with independent circuit drafts', () => {
  const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const server = fs.readFileSync(require.resolve('../backend/server'), 'utf8');
  assert.match(server, /normalizedMessage.artifact = normalizeMaxArtifact/);
  assert.match(app, /mount\(article, message.artifact\)/);
  assert.match(app, /result.artifact \? \{ artifact: result.artifact \}/);
  assert.match(
    fs.readFileSync(require.resolve('../public/circuit'), 'utf8'),
    /cid \|\| params.get\('maxDraft'\) \|\| 'new'/,
  );
});
