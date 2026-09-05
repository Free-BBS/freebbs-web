const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const storageKey = 'free_bbs_typography_preferences';
const defaults = { fontPreset: 'transistor-lab', typeScale: 'comfortable' };

function readPublic(file) {
  return fs.readFileSync(path.join(publicDir, file), 'utf8');
}

test('book-style knowledge prose has two bundled real font weights', () => {
  const css = readPublic('knowledge-typography.css');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  assert.equal(faces.length, 2);
  for (const [index, [name, weight]] of [
    ['Regular', 400],
    ['Bold', 700],
  ].entries()) {
    const file = `assets/fonts/source-han-serif-sc/SourceHanSerifCN-${name}.otf`;
    assert.ok(faces[index][1].includes(`url('/${file}')`));
    assert.match(faces[index][1], /font-family:\s*'FREEBBS Knowledge Serif'/);
    assert.match(faces[index][1], new RegExp(`font-weight:\\s*${weight}`));
    assert.match(faces[index][1], /font-display:\s*swap/);
    assert.doesNotMatch(faces[index][1], /local\s*\(/);

    // Validate the font itself, not just its filename or CSS declaration.
    const font = fs.readFileSync(path.join(publicDir, file));
    assert.equal(font.toString('ascii', 0, 4), 'OTTO');
    const tables = new Map();
    for (let i = 0; i < font.readUInt16BE(4); i += 1) {
      const record = 12 + i * 16;
      tables.set(font.toString('ascii', record, record + 4), font.readUInt32BE(record + 8));
    }
    assert.ok(tables.has('OS/2'));
    assert.equal(font.readUInt16BE(tables.get('OS/2') + 4), weight);
    assert.ok(!tables.has('fvar'), 'the requested faces must be static, not variable');
    assert.ok(font.readUInt16BE(tables.get('maxp') + 4) > 20000, 'retain full SC coverage');
  }
  assert.match(readPublic('assets/fonts/source-han-serif-sc/LICENSE.txt'), /SIL OPEN FONT LICENSE/);
});

test('knowledge font override is limited to book-style prose and preserves semantic roles', () => {
  const css = readPublic('knowledge-typography.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const scoped = css.replace(/@font-face\s*\{[^}]+\}/g, '').trim();
  assert.match(
    scoped,
    /^html\[data-font-preset='zhongsong-study'\] body\.knowledge-page #knowledge-body\s*\{[^{}]+\}$/,
  );
  assert.match(scoped, /--font-zh-body:\s*'FREEBBS Knowledge Serif'/);
  assert.match(scoped, /--font-zh-body-weight:\s*400/);
  assert.doesNotMatch(scoped, /--font-(?:zh-title|zh-ui|math|code|latin)\s*:/);
  assert.doesNotMatch(scoped, /!important/);
  assert.match(
    readPublic('course.css'),
    /\.course-material-body :where\(strong, b\)\s*\{[^}]*font-family:\s*inherit;[^}]*font-weight:\s*700;/,
  );
});

test('only the knowledge entry loads the prose font stylesheet after the theme layer', () => {
  const html = readPublic('knowledge.html');
  assert.equal((html.match(/href="\/knowledge-typography\.css"/g) || []).length, 1);
  assert.ok(html.indexOf('/knowledge-typography.css') > html.indexOf('/ui-polish.css'));
  for (const file of fs.readdirSync(publicDir).filter((entry) => entry.endsWith('.html'))) {
    if (file !== 'knowledge.html')
      assert.ok(!readPublic(file).includes('/knowledge-typography.css'));
  }
});

function createElement() {
  const listeners = new Map();
  return {
    value: '',
    dataset: {},
    textContent: '',
    disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async dispatch(type, event = {}) {
      assert.ok(listeners.has(type), `missing ${type} listener`);
      return listeners.get(type)({ preventDefault() {}, ...event });
    },
  };
}

function createHarness({ raw, storage = new Map(), failReads = false, failWrites = false } = {}) {
  if (raw !== undefined) storage.set(storageKey, raw);
  const writes = [];
  const properties = new Map();
  const elements = new Map();
  const requests = [];
  const document = {
    documentElement: {
      dataset: {},
      style: {
        setProperty(name, value) {
          properties.set(name, value);
        },
      },
    },
    body: createElement(),
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement,
  };
  const localStorage = {
    getItem(key) {
      if (failReads) throw new Error('SecurityError');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push({ key, value });
      if (failWrites) throw new Error('QuotaExceededError');
      storage.set(key, value);
    },
  };
  const window = {
    document,
    localStorage,
    location: {
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '3100',
      origin: 'http://127.0.0.1:3100',
    },
    alert() {},
    clearInterval() {},
    setInterval() {},
  };
  const context = vm.createContext({
    document,
    window,
    localStorage,
    async fetch(url, options) {
      requests.push({ url, options });
      return {
        ok: false,
        status: 400,
        async json() {
          return { message: 'fixture response' };
        },
      };
    },
  });
  return { context, window, document, properties, elements, storage, writes, requests };
}

function runShared(harness) {
  vm.runInContext(readPublic('typography.js'), harness.context, { filename: 'typography.js' });
  return harness.window.freeBbsTypography;
}

function preferences(api) {
  return { ...api.getCurrentPreferences() };
}

function runAppControls(harness) {
  const appSource = readPublic('app.js');
  const start = appSource.indexOf('function getStoredTypographyPreferences(');
  const end = appSource.indexOf('function createThemeToggleButton(', start);
  assert.ok(start >= 0 && end > start, 'app typography controller block is missing');
  const fontControl = createElement();
  const scaleControl = createElement();
  const preview = createElement();
  Object.assign(harness.context, {
    settingsFontPreset: fontControl,
    settingsTypeScale: scaleControl,
    settingsTypographyPreview: preview,
    TYPOGRAPHY_PRESETS: harness.window.freeBbsTypography.presets,
    TYPE_SCALE_PRESETS: harness.window.freeBbsTypography.typeScalePresets,
  });
  vm.runInContext(appSource.slice(start, end), harness.context, {
    filename: 'app.js typography controls',
  });
  harness.context.initializeTypographyPreferences();
  return { fontControl, scaleControl, preview };
}

test('startup applies saved reading settings without writing to storage', () => {
  const expected = { fontPreset: 'zhongsong-study', typeScale: 'large' };
  const harness = createHarness({ raw: JSON.stringify(expected), failWrites: true });
  const api = runShared(harness);
  assert.deepEqual(preferences(api), expected);
  assert.deepEqual(harness.document.documentElement.dataset, expected);
  assert.equal(harness.properties.get('--type-scale-rem'), '118%');
  assert.equal(harness.properties.get('--font-zh-body-weight'), '300');
  assert.equal(harness.writes.length, 0);
});

test('unavailable storage reads fall back to usable defaults without writing', () => {
  const harness = createHarness({ failReads: true, failWrites: true });
  const api = runShared(harness);
  assert.deepEqual(preferences(api), defaults);
  assert.equal(harness.properties.get('--type-scale-rem'), '108%');
  assert.equal(harness.writes.length, 0);
});

test('app settings preserve both changes when saving exceeds storage quota', async () => {
  const harness = createHarness({ failWrites: true });
  const api = runShared(harness);
  const { fontControl, scaleControl, preview } = runAppControls(harness);
  assert.equal(harness.writes.length, 0, 'initializing settings must not persist them');

  fontControl.value = 'zhongsong-study';
  await fontControl.dispatch('change');
  scaleControl.value = 'large';
  await scaleControl.dispatch('change');
  assert.deepEqual(preferences(api), { fontPreset: 'zhongsong-study', typeScale: 'large' });
  assert.equal(fontControl.value, 'zhongsong-study');
  assert.equal(harness.properties.get('--font-zh-body-weight'), '300');
  assert.equal(harness.properties.get('--type-scale-rem'), '118%');
  assert.ok(preview.textContent.includes(api.presets['zhongsong-study'].name));

  fontControl.value = 'quantum-board';
  await fontControl.dispatch('change');
  assert.deepEqual(preferences(api), { fontPreset: 'quantum-board', typeScale: 'large' });
  assert.equal(scaleControl.value, 'large');
  assert.equal(harness.properties.get('--font-zh-body-weight'), '400');
  assert.equal(harness.writes.length, 3);
  assert.equal(harness.storage.has(storageKey), false);
});

test('app settings save changes that a fresh page restores', async () => {
  const harness = createHarness();
  runShared(harness);
  const { fontControl, scaleControl } = runAppControls(harness);
  fontControl.value = 'night-oscilloscope';
  await fontControl.dispatch('change');
  scaleControl.value = 'standard';
  await scaleControl.dispatch('change');
  const expected = { fontPreset: 'night-oscilloscope', typeScale: 'standard' };
  assert.deepEqual(JSON.parse(harness.storage.get(storageKey)), expected);
  const refreshed = createHarness({ storage: harness.storage });
  assert.deepEqual(preferences(runShared(refreshed)), expected);
  assert.equal(refreshed.writes.length, 0);
  assert.equal(refreshed.properties.get('--type-scale-rem'), '100%');
});

test('applying preferences is independent of persistence and getters do not expose current state', () => {
  const harness = createHarness({ failWrites: true });
  const api = runShared(harness);
  const expected = { fontPreset: 'quantum-board', typeScale: 'standard' };
  assert.deepEqual({ ...api.applyPreferences(expected) }, expected);
  assert.equal(harness.writes.length, 0);
  assert.equal(api.savePreferences(expected), false);
  assert.deepEqual(preferences(api), expected);
  const copy = api.getCurrentPreferences();
  copy.fontPreset = 'zhongsong-study';
  assert.deepEqual(preferences(api), expected);
});

test('savePreferences reports success and persists only normalized preference fields', () => {
  const harness = createHarness();
  const api = runShared(harness);
  assert.equal(
    api.savePreferences({ fontPreset: 'invalid', typeScale: 'large', extra: true }),
    true,
  );
  assert.deepEqual(JSON.parse(harness.storage.get(storageKey)), {
    fontPreset: defaults.fontPreset,
    typeScale: 'large',
  });
});

for (const raw of ['{broken', 'null', '[]', '"text"', '42', '{}']) {
  test(`malformed or incomplete stored preferences use defaults: ${raw}`, () => {
    const harness = createHarness({ raw });
    assert.deepEqual(preferences(runShared(harness)), defaults);
    assert.equal(harness.writes.length, 0);
  });
}

for (const key of ['unknown', '__proto__', 'constructor', 'toString']) {
  test(`preset names must be own supported keys: ${key}`, () => {
    const harness = createHarness({ raw: JSON.stringify({ fontPreset: key, typeScale: key }) });
    const api = runShared(harness);
    assert.deepEqual(preferences(api), defaults);
    assert.deepEqual({ ...api.applyPreferences({ fontPreset: key, typeScale: key }) }, defaults);
    assert.equal(harness.properties.get('--font-zh-body-weight'), '400');
  });
}

test('switching every preset applies all six roles and resets the lighter body weight', () => {
  const harness = createHarness();
  const api = runShared(harness);
  for (const fontPreset of Object.keys(api.presets)) {
    api.applyPreferences({ fontPreset: 'zhongsong-study', typeScale: 'comfortable' });
    api.applyPreferences({ fontPreset, typeScale: 'comfortable' });
    const preset = api.presets[fontPreset];
    for (const [role, cssRole] of [
      ['zhBody', 'zh-body'],
      ['zhTitle', 'zh-title'],
      ['zhUi', 'zh-ui'],
      ['latin', 'latin'],
      ['math', 'math'],
      ['code', 'code'],
    ]) {
      assert.equal(harness.properties.get(`--font-${cssRole}`), preset.fonts[role]);
    }
    assert.equal(
      harness.properties.get('--font-zh-body-weight'),
      fontPreset === 'zhongsong-study' ? '300' : '400',
    );
  }
  assert.equal(harness.writes.length, 0);
});

function pageScripts(page) {
  return Array.from(page.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g), ([tag, src]) => ({
    tag,
    src: src.replace(/[?#].*$/, '').replace(/^\//, ''),
  }));
}

test('every app and authentication entry loads shared typography once before its controller', () => {
  const pages = fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'));
  let checked = 0;
  for (const file of pages) {
    const scripts = pageScripts(readPublic(file));
    const controllerIndex = scripts.findIndex(({ src }) => src === 'app.js' || src === 'auth.js');
    if (controllerIndex === -1) continue;
    checked += 1;
    const shared = scripts.filter(({ src }) => src === 'typography.js');
    assert.equal(shared.length, 1, `${file}: load typography.js exactly once`);
    assert.ok(
      scripts.findIndex(({ src }) => src === 'typography.js') < controllerIndex,
      `${file}: typography must run before its consumer`,
    );
    assert.doesNotMatch(
      shared[0].tag,
      /\basync\b/,
      `${file}: typography cannot load asynchronously`,
    );
    if (/\bdefer\b/.test(shared[0].tag)) {
      assert.match(
        scripts[controllerIndex].tag,
        /\bdefer\b/,
        `${file}: deferred typography cannot precede a blocking controller`,
      );
    }
  }
  assert.ok(checked >= 3, 'expected app and authentication entry pages');
});

for (const [file, mode, endpoint] of [
  ['login.html', 'login', '/auth/login'],
  ['register.html', 'register', '/auth/register'],
  ['remake.html', 'remake', '/auth/reset-password'],
]) {
  test(`${file} applies saved typography without settings DOM and keeps authentication working`, async () => {
    const page = readPublic(file);
    const expected = { fontPreset: 'zhongsong-study', typeScale: 'large' };
    const harness = createHarness({ raw: JSON.stringify(expected), failWrites: true });
    for (const [, id] of page.matchAll(/\bid="([^"]+)"/g)) {
      harness.elements.set(id, createElement());
    }
    assert.equal(harness.elements.has('settings-font-preset'), false);
    harness.elements.get('auth-page-form').dataset.authMode = mode;
    for (const [id, value] of Object.entries({
      'auth-identifier': 'reader',
      'auth-password': 'test password',
      'auth-password-confirm': 'test password',
      'auth-student-id': '2026012345',
      'auth-email': 'reader@example.test',
      'auth-email-code': '123456',
      'auth-username': 'reader',
      'auth-full-name': 'Reader',
    })) {
      if (harness.elements.has(id)) harness.elements.get(id).value = value;
    }
    for (const { src } of pageScripts(page)) {
      if (src === 'typography.js' || src === 'auth.js') {
        vm.runInContext(readPublic(src), harness.context, { filename: src });
      }
    }
    assert.ok(harness.window.freeBbsTypography, `${file}: shared typography was not loaded`);
    assert.deepEqual(preferences(harness.window.freeBbsTypography), expected);
    assert.equal(harness.properties.get('--type-scale-rem'), '118%');
    assert.equal(harness.writes.length, 0);
    await harness.elements.get('auth-page-form').dispatch('submit');
    assert.equal(harness.requests.length, 1);
    assert.ok(harness.requests[0].url.endsWith(endpoint));
    assert.equal(harness.requests[0].options.method, 'POST');
    assert.equal(harness.elements.get('auth-message').textContent, 'fixture response');
    assert.equal(harness.elements.get('auth-submit').disabled, false);
  });
}
