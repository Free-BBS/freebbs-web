const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { parseReference, sandboxDocument } = require('../public/tool-embeds');

const origin = 'https://www.free-bbs.cn';
const tid = 't_0123456789abcdef';
const source = fs.readFileSync(path.join(__dirname, '../public/tool-embeds.js'), 'utf8');

test('only same-origin saved tool references are embedded', () => {
  for (const url of [
    `/tool-workshop?tool=${tid}`,
    `${origin}/tool-workshop?tool=${tid}`,
    `/tool-workshop.html?tool=${tid}`,
  ]) {
    assert.deepEqual(parseReference(url, origin), { tid });
  }
  for (const url of [
    `https://evil.test/tool-workshop?tool=${tid}`,
    `//evil.test/tool-workshop?tool=${tid}`,
    `https://user:password@www.free-bbs.cn/tool-workshop?tool=${tid}`,
    `/tool-workshop?tool=${tid}&tool=${tid}`,
    '/tool-workshop?tool=../../private',
    '/tool-workshop',
    `/circuit?tool=${tid}`,
    `javascript:alert('${tid}')`,
    '',
    null,
  ])
    assert.equal(parseReference(url, origin), null, String(url));
});

test('sandbox policy precedes all untrusted markup and static previews cannot execute scripts', () => {
  const payload =
    '<script>fetch("https://evil.test")</script><html><head></head><body>工具</body></html>';
  const interactive = sandboxDocument(payload);
  assert.ok(interactive.indexOf('Content-Security-Policy') < interactive.indexOf('<script>'));
  assert.match(interactive, /connect-src 'none'/);
  assert.match(interactive, /form-action 'none'; base-uri 'none'/);
  assert.match(interactive, /script-src 'unsafe-inline'/);
  assert.match(sandboxDocument(payload, false), /script-src 'none'/);
  assert.ok(interactive.includes(payload));
});

function environment(fetchImpl, count = 1) {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.isConnected = true;
      this.classList = { toggle: () => true };
    }

    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }

    before(node) {
      node.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this), 0, node);
    }

    setAttribute(key, value) {
      this.attributes[key] = value;
    }

    getAttribute(key) {
      return this.attributes[key];
    }

    addEventListener(key, callback) {
      this.listeners[key] = callback;
    }

    closest() {
      return this.parent || null;
    }

    replaceWith(node) {
      this.replacement = node;
    }
  }
  const links = Array.from({ length: count }, () => {
    const link = new Element('a');
    link.setAttribute('href', `/tool-workshop?tool=${tid}`);
    return link;
  });
  const root = {
    querySelectorAll: (selector) =>
      selector === 'a[href]'
        ? links.filter((link) => !link.replacement)
        : links.filter((link) => link.replacement).map((link) => link.replacement),
  };
  const document = { createElement: (tag) => new Element(tag), head: new Element('head') };
  const window = { location: { origin } };
  vm.runInNewContext(source, {
    window,
    document,
    URL,
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  return { window, root, links, document };
}
const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test('public tool embeds run in opaque sandboxes without authentication and enhancement is bounded/idempotent', async () => {
  let calls = 0;
  const env = environment(async (url, options) => {
    calls += 1;
    assert.equal(url, `/api/tools/${tid}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return {
      ok: true,
      json: async () => ({
        tool: {
          id: tid,
          isPublished: true,
          title: '<script>标题</script>',
          html: '<html><body>工具</body></html>',
        },
      }),
    };
  }, 8);
  env.window.FreeBbsToolEmbeds.enhance(env.root);
  await settle();
  env.window.FreeBbsToolEmbeds.enhance(env.root);
  assert.equal(calls, 6);
  assert.equal(env.document.head.children.length, 1);
  const container = env.links[0].replacement;
  const frame = container.children.find((node) => node.tagName === 'iframe');
  assert.equal(frame.attributes.sandbox, 'allow-scripts');
  assert.match(frame.srcdoc, /Content-Security-Policy/);
  assert.equal(container.children[0].children[0].textContent, '<script>标题</script>');
  assert.equal(container.children[0].children[1].hidden, false);
  assert.equal(container.children[1].hidden, true);
});

test('private, mismatched, oversized and failed tool responses never create an iframe; errors can retry', async () => {
  for (const tool of [
    { id: tid, isPublished: false, html: '<html></html>' },
    { id: 't_other', isPublished: true, html: '<html></html>' },
    { id: tid, isPublished: true, html: 'a'.repeat(180001) },
    null,
  ]) {
    const env = environment(async () => ({ ok: true, json: async () => ({ tool }) }));
    env.window.FreeBbsToolEmbeds.enhance(env.root);
    await settle();
    const container = env.links[0].replacement;
    assert.equal(
      container.children.some((node) => node.tagName === 'iframe'),
      false,
    );
    assert.equal(container.children.at(-1).children[1].hidden, false);
  }
  let failed = true;
  const env = environment(async () => {
    if (failed) throw new Error('network');
    return {
      ok: true,
      json: async () => ({ tool: { id: tid, isPublished: true, html: '<html></html>' } }),
    };
  });
  env.window.FreeBbsToolEmbeds.enhance(env.root);
  await settle();
  failed = false;
  await env.links[0].replacement.children.at(-1).children[1].listeners.click();
  assert.equal(
    env.links[0].replacement.children.filter((node) => node.tagName === 'iframe').length,
    1,
  );
});

test('discussion Markdown and workshop previews use the shared embed integration', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(app, /enhanceToolReferences\(root\);/);
  assert.match(app, /script.src = '\/tool-embeds.js'/);
  assert.match(app, /FreeBbsToolEmbeds.enhance\(root, \{ apiBase: API_BASE_URL \}\)/);
  const workshop = fs.readFileSync(path.join(__dirname, '../public/tool-workshop.js'), 'utf8');
  assert.match(workshop, /const \{ sandboxDocument \} = window.FreeBbsToolEmbeds/);
});
