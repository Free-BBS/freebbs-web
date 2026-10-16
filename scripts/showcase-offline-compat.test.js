const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { resolve, join, relative, dirname, isAbsolute } = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { Script, runInNewContext } = require('node:vm');
const { createRequire } = require('node:module');

const repo = resolve(__dirname, '..');
const requireDevelopment = createRequire(join(repo, 'development/package.json'));
const { JSDOM, VirtualConsole } = requireDevelopment('jsdom');
const acorn = requireDevelopment('acorn');
const postcss = requireDevelopment('postcss');
const ts = requireDevelopment('typescript');
const root = resolve(
  process.env.SHOWCASE_REVIEW_DIR || join(repo, 'development/apps/web/dist-review'),
);
const sites = join(root, 'organization-showcase/sites');
const text = (file) => readFileSync(file, 'utf8');
const manifest = JSON.parse(text(join(root, '审核目录.json')));
const submittedSlugs = [
  'organization',
  'research',
  'creative',
  'audiovisual',
  'sail',
  'humanities',
  'hardware',
  'software',
  'liaison',
];
const jsTypes = new Set(['', 'text/javascript', 'application/javascript']);

function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(join(folder, item.name)) : [join(folder, item.name)],
  );
}

function visit(node, callback, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback, node));
    else if (value && typeof value === 'object') visit(value, callback, node);
  }
}

function packageFile(documentFile, raw) {
  const url = new URL(raw, pathToFileURL(documentFile));
  assert.equal(
    url.protocol,
    'file:',
    `${relative(root, documentFile)} requires network resource ${raw}`,
  );
  url.hash = '';
  url.search = '';
  const file = fileURLToPath(url);
  const inside = relative(root, file);
  assert.ok(
    !inside.startsWith('..') && !isAbsolute(inside),
    `Resource escapes the package: ${raw}`,
  );
  assert.ok(existsSync(file), `${relative(root, documentFile)} references missing ${raw}`);
  assert.ok(statSync(file).isFile(), `Resource is not a file: ${raw}`);
  return file;
}

function classicScripts(documentFile, document) {
  return [...document.scripts]
    .filter((script) => jsTypes.has((script.getAttribute('type') || '').toLowerCase()))
    .map((script) => {
      const src = script.getAttribute('src');
      const file = src ? packageFile(documentFile, src) : documentFile;
      return { file, documentFile, source: src ? text(file) : script.textContent };
    });
}

function assertNoFileNetworkLoader(source, label) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  visit(ast, (node) => {
    assert.notEqual(node.type, 'ImportExpression', `${label} dynamically imports a module`);
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return;
    const callee = node.callee;
    const method =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && !callee.computed
          ? callee.property.name
          : callee.type === 'MemberExpression' && callee.property.type === 'Literal'
            ? callee.property.value
            : undefined;
    assert.ok(
      !['fetch', 'XMLHttpRequest', 'Worker', 'SharedWorker', 'importScripts'].includes(method),
      `${label} requires a file-incompatible ${method} loader`,
    );
  });
  return ast;
}

// These are DOM execution tests under file URLs, not browser rendering tests.
// No browser is launched, and jsdom does not enforce Chromium's iframe sandbox/CORS rules.
function offlineDOM(file) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(text(file), {
    url: pathToFileURL(file).href,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  const { window } = dom;
  // We test DOM bootstrapping, not painting. Window-owned timers also prevent
  // jsdom's RAF interval from firing after its document is closed.
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const requests = [];
  window.fetch = (...args) => {
    requests.push(args);
    throw new Error('Offline entry must not fetch local or remote resources');
  };
  window.XMLHttpRequest = class {
    constructor() {
      requests.push('XMLHttpRequest');
      throw new Error('Offline entry must not require XMLHttpRequest');
    }
  };
  return { dom, errors, requests };
}

async function settle() {
  await new Promise((done) => setTimeout(done, 100));
}

test('twenty department entries execute the classic viewer under file URLs without local JSON fetches', async (t) => {
  const bundle = text(join(root, 'review.js'));
  assert.doesNotThrow(() => new Script(bundle));
  assertNoFileNetworkLoader(bundle, 'review.js');
  assert.equal(manifest.length, 20);
  for (const department of manifest) {
    await t.test(department.name, async () => {
      const file = join(root, department.file);
      const { dom, errors, requests } = offlineDOM(file);
      try {
        const { window } = dom;
        const scripts = [...window.document.scripts];
        assert.equal(scripts.length, 1);
        assert.ok(jsTypes.has((scripts[0].getAttribute('type') || '').toLowerCase()));
        assert.equal(packageFile(file, scripts[0].getAttribute('src')), join(root, 'review.js'));
        window.eval(bundle);
        await settle();
        assert.equal(window.location.hash, `#${department.route}`);
        assert.ok(window.document.title.includes(department.name));
        assert.ok(window.document.querySelector('.organization-department-viewport'));
        assert.ok(window.document.querySelector('.organization-breadcrumb--compact'));
        assert.equal(
          [...window.document.querySelectorAll('a,button')].filter((element) =>
            /^←?\s*返回上一级$/.test(element.textContent.trim()),
          ).length,
          0,
        );
        for (const frame of window.document.querySelectorAll('iframe')) {
          const file = packageFile(join(root, department.file), frame.getAttribute('src'));
          assert.ok(submittedSlugs.some((slug) => file === join(sites, slug, 'index.html')));
          assert.ok(frame.getAttribute('sandbox').split(/\s+/).includes('allow-same-origin'));
        }
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
      } finally {
        dom.window.close();
      }
    });
  }
});

test('all nine submitted sites and nested HTML pages use classic local scripts and include the platform bridge first', () => {
  let nestedPages = 0;
  const checkedScripts = new Set();
  for (const slug of submittedSlugs) {
    const home = join(sites, slug, 'index.html');
    assert.ok(existsSync(home));
    for (const file of walk(join(sites, slug)).filter((candidate) => /\.html?$/i.test(candidate))) {
      const dom = new JSDOM(text(file), { url: pathToFileURL(file).href });
      try {
        const { document } = dom.window;
        assert.equal(
          document.querySelectorAll('base').length,
          0,
          'A base URL must not redirect local assets',
        );
        const first = document.scripts[0];
        assert.ok(first, `${relative(root, file)} has no compatibility bridge`);
        assert.equal(
          packageFile(file, first.getAttribute('src')),
          join(sites, 'platform-bridge.js'),
        );
        assert.equal(first.dataset.site, slug);
        assert.equal(packageFile(file, first.dataset.home || 'index.html'), home);
        for (const script of document.scripts) {
          const type = (script.getAttribute('type') || '').toLowerCase();
          assert.ok(
            jsTypes.has(type) || /^(?:application\/json|application\/ld\+json)$/.test(type),
          );
          if (!jsTypes.has(type)) assert.doesNotThrow(() => JSON.parse(script.textContent));
        }
        for (const script of classicScripts(file, document)) {
          const key = `${script.file}:${script.source}`;
          if (checkedScripts.has(key)) continue;
          checkedScripts.add(key);
          assertNoFileNetworkLoader(script.source, relative(root, script.file));
        }
        for (const element of document.querySelectorAll(
          'script[src],link[rel="stylesheet"][href],img[src],video[src],source[src],iframe[src]',
        )) {
          const raw = element.getAttribute(element.tagName === 'LINK' ? 'href' : 'src');
          if (raw.startsWith('data:') || raw.startsWith('blob:')) continue;
          packageFile(file, raw);
        }
        for (const element of document.querySelectorAll('[poster],object[data],embed[src]')) {
          const raw =
            element.getAttribute('poster') ||
            element.getAttribute('data') ||
            element.getAttribute('src');
          if (!raw.startsWith('data:') && !raw.startsWith('blob:')) packageFile(file, raw);
        }
        for (const element of document.querySelectorAll('[srcset]')) {
          const raw = element.getAttribute('srcset');
          if (raw.startsWith('data:')) continue;
          for (const candidate of raw.split(','))
            packageFile(file, candidate.trim().split(/\s+/, 1)[0]);
        }
        for (const anchor of document.querySelectorAll('a[href]')) {
          const raw = anchor.getAttribute('href');
          if (/\.html?(?:[?#]|$)/i.test(raw) && !/^[a-z]+:|^\/\//i.test(raw))
            packageFile(file, raw);
        }
        if (file !== home) nestedPages++;
      } finally {
        dom.window.close();
      }
    }
  }
  assert.ok(nestedPages >= 20, 'Nested creative/research pages must also be audited');
  assert.ok(checkedScripts.size >= 10);
});

test('JavaScript-generated submitted-site media paths and all seven sail activity images exist', () => {
  let checked = 0;
  for (const slug of submittedSlugs) {
    for (const file of walk(join(sites, slug)).filter((candidate) => /\.html?$/i.test(candidate))) {
      const dom = new JSDOM(text(file), { url: pathToFileURL(file).href });
      try {
        for (const script of classicScripts(file, dom.window.document)) {
          if (script.file === join(sites, 'platform-bridge.js')) continue;
          const ast = acorn.parse(script.source, { ecmaVersion: 'latest', sourceType: 'script' });
          visit(ast, (node, parent) => {
            if (node.type !== 'Literal' || typeof node.value !== 'string') return;
            // Optimization maps retain old filenames as keys; only their values are requested.
            if (parent?.type === 'Property' && parent.key === node && !parent.computed) return;
            if (
              !/^(?:\.{1,2}\/)?assets\/.+\.(?:png|jpe?g|webp|gif|svg|mp4|css|js|html?|woff2?)(?:[?#].*)?$/i.test(
                node.value,
              )
            )
              return;
            packageFile(file, node.value);
            checked++;
          });
        }
        if (slug === 'sail') {
          const activities = [...dom.window.document.querySelectorAll('[data-image]')];
          assert.equal(activities.length, 7);
          for (const activity of activities)
            packageFile(file, `assets/${activity.dataset.image}.webp`);
        }
      } finally {
        dom.window.close();
      }
    }
  }
  assert.ok(checked >= 25, 'Runtime content images must be checked, not only static HTML images');
});

test('all four submitted local fonts are embedded byte-for-byte and no CSS relies on remote or file font requests', () => {
  const fonts = walk(sites).filter((file) => /\.(?:woff2?|otf|ttf)$/i.test(file));
  assert.equal(fonts.length, 4);
  const embedded = [];
  for (const file of walk(root).filter((candidate) => /\.css$/i.test(candidate))) {
    const css = postcss.parse(text(file), { from: file });
    css.walkAtRules('import', (rule) => {
      const raw = rule.params.match(/^(?:url\(\s*)?["']?([^"')\s;]+)/)?.[1];
      assert.ok(raw, `Unreadable CSS import in ${relative(root, file)}`);
      packageFile(file, raw);
    });
    css.walkDecls((declaration) => {
      for (const match of declaration.value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (!/^(?:data:|blob:|#)/.test(match[1])) packageFile(file, match[1]);
      }
    });
    css.walkAtRules('font-face', (rule) => {
      const sources = [];
      rule.walkDecls('src', (declaration) => sources.push(declaration.value));
      assert.ok(sources.length > 0);
      for (const source of sources) {
        const urls = [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(
          (match) => match[1],
        );
        assert.ok(urls.length > 0);
        for (const url of urls) {
          assert.match(url, /^data:font\/(?:woff2?|otf|ttf);base64,/);
          const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
          assert.ok(bytes.length > 1000, 'Font data must not be an empty placeholder');
          assert.ok(
            fonts.some((font) => readFileSync(font).equals(bytes)),
            `${relative(root, file)} embeds unknown font bytes`,
          );
          embedded.push(bytes);
        }
      }
    });
  }
  assert.equal(embedded.length, 4);
  for (const font of fonts) assert.ok(embedded.some((bytes) => bytes.equals(readFileSync(font))));
});

test('file-origin permission remains limited to the exact nine shipped entry files', () => {
  const source = text(
    join(repo, 'development/apps/web/src/modules/organizations/showcase/submitted-frame.ts'),
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports });
  const { submittedFrameSandbox } = exports;
  const retainsOrigin = (offline, protocol, entry) =>
    submittedFrameSandbox(offline, protocol, entry).split(/\s+/).includes('allow-same-origin');
  for (const slug of submittedSlugs) {
    for (const prefix of ['./', '/development/']) {
      const entry = `${prefix}organization-showcase/sites/${slug}/index.html`;
      assert.equal(retainsOrigin(true, 'file:', entry), true);
      assert.equal(retainsOrigin(false, 'file:', entry), false);
      assert.equal(retainsOrigin(true, 'https:', entry), false);
      assert.equal(retainsOrigin(true, 'http:', entry), false);
    }
  }
  for (const entry of [
    './organization-showcase/sites/creative/about.html',
    './organization-showcase/sites/unreviewed/index.html',
    './organization-showcase/sites/creative/../research/index.html',
    './organization-showcase/sites/creative/index.html?x=1',
    './organization-showcase/sites/creative/index.html#x',
    'https://example.com/organization-showcase/sites/creative/index.html',
    'file:///tmp/organization-showcase/sites/creative/index.html',
    '/organization-showcase/sites/creative/index.html',
    'data:text/html,test',
    'blob:test',
  ])
    assert.equal(retainsOrigin(true, 'file:', entry), false, entry);
});

test('the compatibility bridge derives its local stylesheet from the script URL and tolerates denied file storage', async () => {
  const file = join(sites, 'humanities/index.html');
  const { dom, errors, requests } = offlineDOM(file);
  try {
    const { window } = dom;
    const measurements = [];
    window.postMessage = (message) => measurements.push(message);
    const script = window.document.scripts[0];
    Object.defineProperty(window.document, 'currentScript', { configurable: true, value: script });
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new window.DOMException('Denied local storage', 'SecurityError');
        },
      });
    }
    window.eval(text(join(sites, 'platform-bridge.js')));
    await settle();
    const sheet = window.document.querySelector('link[href$="platform-theme.css"]');
    assert.ok(sheet);
    assert.equal(fileURLToPath(sheet.href), join(sites, 'platform-theme.css'));
    window.localStorage.setItem('draft-test', 'saved in this DOM');
    assert.equal(window.localStorage.getItem('draft-test'), 'saved in this DOM');
    assert.ok(window.document.querySelector('.showcase-storage-note'));
    assert.ok(
      measurements.some((message) => message.type === 'showcase-size' && message.height >= 320),
    );
    window.dispatchEvent(
      new window.MessageEvent('message', {
        source: window.parent,
        data: { type: 'showcase-theme', mode: 'dark' },
      }),
    );
    assert.equal(window.document.documentElement.dataset.platformTheme, 'dark');
    window.dispatchEvent(
      new window.MessageEvent('message', {
        source: null,
        data: { type: 'showcase-theme', mode: 'light' },
      }),
    );
    assert.equal(window.document.documentElement.dataset.platformTheme, 'dark');
    await settle();
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});
