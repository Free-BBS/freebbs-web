const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const readPublic = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');
const tokenKey = 'free_bbs_auth_token';
const now = Date.parse('2026-09-09T12:00:00Z');
const agreementVersion = '2026-09-09';
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createElement() {
  const listeners = new Map();
  const classes = new Set();
  const childrenBySelector = new Map();
  return {
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    dataset: {},
    attributes: {},
    children: [],
    textContent: '',
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    querySelector(selector) {
      if (!childrenBySelector.has(selector)) childrenBySelector.set(selector, createElement());
      return childrenBySelector.get(selector);
    },
    focus() {},
    getScreenCTM: () => ({ inverse: () => ({}) }),
    setPointerCapture() {},
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      return this.dispatch('close');
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      return Promise.all(
        (listeners.get(type) || []).map((listener) =>
          listener({ preventDefault() {}, currentTarget: this, ...event }),
        ),
      );
    },
  };
}

function challenge(overrides = {}) {
  const energySign = overrides.carrier === 'hole' ? -1 : 1;
  return {
    challengeId: 'challenge-1',
    communityAgreementVersion: agreementVersion,
    expiresAt: new Date(now + 120000).toISOString(),
    carrier: 'electron',
    objective: 'maximum',
    band: {
      kMin: -1,
      kMax: 1,
      points: Array.from({ length: 41 }, (_, index) => {
        const k = -1 + index / 20;
        return { k, energy: energySign * Math.cos(2 * Math.PI * k) };
      }),
      candidates: [-0.7, -0.55, 0.3, 0.45, 0.6].map((k) => ({ k })),
    },
    ...overrides,
  };
}

function wienChallenge(overrides = {}) {
  return {
    challengeId: 'wien-challenge-1',
    communityAgreementVersion: agreementVersion,
    expiresAt: new Date(now + 120000).toISOString(),
    type: 'wien',
    oscillator: {
      rgOhms: 10000,
      rOhms: 22000,
      cFarads: 1e-8,
      rfMinOhms: 15000,
      rfMaxOhms: 25000,
      rfInitialOhms: 18000,
      qMin: 5,
    },
    ...overrides,
  };
}

function harness(mode = 'register') {
  const page = readPublic(mode === 'register' ? 'register.html' : `${mode}.html`);
  const elements = new Map();
  for (const [, id] of page.matchAll(/\bid="([^"]+)"/g)) elements.set(id, createElement());
  const element = (id) => elements.get(id);
  element('auth-page-form').dataset.authMode = mode;
  for (const [id, value] of Object.entries({
    'auth-identifier': ' reader ',
    'auth-username': ' reader ',
    'auth-full-name': ' Reader ',
    'auth-student-id': '2026012345',
    'auth-email': ' reader@example.test ',
    'auth-email-code': '123456',
    'auth-password': 'password for tests',
    'auth-password-confirm': 'password for tests',
  })) {
    if (element(id)) element(id).value = value;
  }
  if (element('auth-community-agreement')) {
    element('auth-community-agreement').dataset.version = agreementVersion;
  }
  const storage = new Map([[tokenKey, 'existing-token']]);
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const document = {
    body: createElement(),
    getElementById: (id) => element(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement,
    createElementNS(namespace, tagName) {
      assert.equal(namespace, 'http://www.w3.org/2000/svg');
      return { ...createElement(), tagName };
    },
  };
  document.body.insertAdjacentHTML = (position, markup) => {
    assert.equal(position, 'beforeend');
    for (const [, id] of markup.matchAll(/\bid="([^"]+)"/g)) {
      assert.equal(elements.has(id), false, `duplicate element ${id}`);
      elements.set(id, createElement());
    }
  };
  const intervals = new Set();
  let clock = now;
  const requests = [];
  const responses = [];
  const window = {
    document,
    localStorage,
    location: {
      protocol: 'https:',
      hostname: 'free-bbs.test',
      port: '',
      origin: 'https://free-bbs.test',
      href: `/${mode}`,
    },
    setInterval(callback) {
      intervals.add(callback);
      return callback;
    },
    clearInterval: (callback) => intervals.delete(callback),
  };
  const context = vm.createContext({
    document,
    window,
    localStorage,
    Date: { now: () => clock, parse: Date.parse },
    DOMPoint: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }

      matrixTransform() {
        return this;
      }
    },
    async fetch(url, options) {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      assert.ok(responses.length, `unexpected request to ${url}`);
      const response = await responses.shift();
      if (response instanceof Error) throw response;
      return {
        ok: !response.status || response.status < 400,
        status: response.status || 200,
        json: async () => response.body,
      };
    },
  });
  for (const file of ['wien-oscillator-model.js', 'auth-challenge.js', 'auth.js']) {
    vm.runInContext(readPublic(file), context, { filename: file });
  }
  return {
    element,
    window,
    storage,
    requests,
    responses,
    intervals,
    submit: () => element('auth-page-form').dispatch('submit'),
    tick(milliseconds) {
      clock += milliseconds;
      intervals.forEach((callback) => callback());
    },
  };
}

async function openChallenge(h, data = challenge()) {
  const agreement = h.element('auth-community-agreement');
  if (agreement) agreement.checked = true;
  h.responses.push({ body: data });
  const submission = h.submit();
  await flush();
  assert.equal(h.element('band-challenge').open, true);
  const plot = data.type === 'wien' ? 'wien-challenge-plot' : 'band-challenge-plot';
  assert.equal(h.element(plot).hidden, false);
  return { submission };
}

test('registration without agreement stops before opening a challenge or making a request', async () => {
  const h = harness();
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.equal(h.element('band-challenge').open, false);
  assert.match(h.element('auth-message').textContent, /阅读并同意社区公约/);
  assert.equal(h.element('auth-submit').disabled, false);
  assert.equal(h.storage.get(tokenKey), 'existing-token');
});

test('registration requires a selected position and submits the captured fields with its challenge', async () => {
  const h = harness();
  const { submission } = await openChallenge(h);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.endsWith('/auth/registration-challenge'));
  assert.deepEqual(h.requests[0].body, { email: 'reader@example.test' });
  assert.equal(h.element('auth-submit').disabled, true);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  assert.match(h.element('band-challenge-title').textContent, /电子.*最大/);
  assert.match(h.element('band-challenge-formula').textContent, /mₑ\*/);
  await h.element('band-challenge-confirm').dispatch('click');
  await h.submit();
  assert.equal(h.requests.length, 1, 'unmoved and repeated submissions must not send requests');
  h.element('auth-email').value = 'edited@example.test';
  h.element('auth-password').value = 'edited while modal open';
  h.element('band-challenge-position').value = '0.413';
  await h.element('band-challenge-position').dispatch('input');
  h.responses.push({ body: { token: 'created-token', user: {} } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.ok(h.requests[1].url.endsWith('/auth/register'));
  assert.deepEqual(h.requests[1].body, {
    username: 'reader',
    fullName: 'Reader',
    studentId: '2026012345',
    email: 'reader@example.test',
    emailCode: '123456',
    password: 'password for tests',
    communityAgreementAccepted: true,
    communityAgreementVersion: agreementVersion,
    captcha: { challengeId: 'challenge-1', k: 0.413 },
  });
  assert.equal(h.storage.get(tokenKey), 'created-token');
  assert.equal(h.window.location.href, '/');
  assert.equal(h.element('band-challenge').open, false);
  assert.equal(h.element('auth-submit').disabled, false);
  assert.equal(h.intervals.size, 0);
});

for (const cancelEvent of ['click', 'cancel']) {
  test(`${cancelEvent} cancellation preserves input and token and enables registration again`, async () => {
    const h = harness();
    const { submission } = await openChallenge(h);
    const target = cancelEvent === 'click' ? 'band-challenge-close' : 'band-challenge';
    await h.element(target).dispatch(cancelEvent);
    await submission;
    assert.equal(h.element('auth-email').value, ' reader@example.test ');
    assert.equal(h.element('auth-password').value, 'password for tests');
    assert.equal(h.element('auth-email-code').value, '123456');
    assert.equal(h.element('auth-community-agreement').checked, true);
    assert.equal(h.storage.get(tokenKey), 'existing-token');
    assert.equal(h.window.location.href, '/register');
    assert.match(h.element('auth-message').textContent, /已取消验证/);
    assert.equal(h.element('auth-submit').disabled, false);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.requests.length, 1);
  });
}

test('login requires a challenge and submits captured credentials without registration consent', async () => {
  const h = harness('login');
  const { submission } = await openChallenge(h);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.endsWith('/auth/login-challenge'));
  assert.deepEqual(h.requests[0].body, { identifier: 'reader' });
  assert.match(h.element('band-challenge-confirm').textContent, /登录/);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  assert.equal(h.element('auth-submit').disabled, true);
  h.element('auth-identifier').value = 'edited';
  h.element('auth-password').value = 'edited password';
  h.element('band-challenge-position').value = '-0.673';
  await h.element('band-challenge-position').dispatch('input');
  h.responses.push({ body: { token: 'login-token', user: {} } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.ok(h.requests[1].url.endsWith('/auth/login'));
  assert.deepEqual(h.requests[1].body, {
    identifier: 'reader',
    password: 'password for tests',
    captcha: { challengeId: 'challenge-1', k: -0.673 },
  });
  assert.equal(h.storage.get(tokenKey), 'login-token');
  assert.equal(h.window.location.href, '/');
  assert.equal(h.element('auth-submit').disabled, false);
});

test('canceling login preserves existing credentials and authentication token', async () => {
  const h = harness('login');
  const { submission } = await openChallenge(h);
  await h.element('band-challenge').dispatch('cancel');
  await submission;
  assert.equal(h.requests.length, 1);
  assert.equal(h.element('auth-identifier').value, ' reader ');
  assert.equal(h.element('auth-password').value, 'password for tests');
  assert.equal(h.storage.get(tokenKey), 'existing-token');
  assert.equal(h.window.location.href, '/login');
  assert.equal(h.element('auth-submit').disabled, false);
});

test('password reset still submits directly without registration consent or captcha', async () => {
  const h = harness('remake');
  h.responses.push({ body: { token: 'reset-token', user: {} } });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.endsWith('/auth/reset-password'));
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(Object.hasOwn(h.requests[0].body, 'captcha'), false);
  assert.equal(Object.hasOwn(h.requests[0].body, 'communityAgreementAccepted'), false);
  assert.equal(h.storage.get(tokenKey), 'reset-token');
  assert.equal(h.window.location.href, '/');
  assert.equal(h.element('auth-submit').disabled, false);
});

test('a failed challenge request can be retried inside the open dialog', async () => {
  const h = harness();
  h.element('auth-community-agreement').checked = true;
  h.responses.push(new Error('network unavailable'));
  const submission = h.submit();
  await flush();
  assert.equal(h.element('band-challenge').open, true);
  assert.equal(h.element('band-challenge-plot').hidden, true);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  assert.equal(h.element('band-challenge-refresh').disabled, false);
  assert.match(h.element('band-challenge-status').textContent, /network unavailable/);
  h.responses.push({ body: challenge() });
  await h.element('band-challenge-refresh').dispatch('click');
  assert.equal(h.element('band-challenge-plot').hidden, false);
  assert.equal(h.element('band-challenge-position').disabled, false);
  assert.equal(h.requests.length, 2);
  await h.element('band-challenge-close').dispatch('click');
  await submission;
});

for (const mode of ['register', 'login']) {
  test(`${mode}: a rejected answer loads a fresh challenge and requires another selection`, async () => {
    const h = harness(mode);
    const { submission } = await openChallenge(h);
    h.element('band-challenge-position').value = '1';
    await h.element('band-challenge-position').dispatch('input');
    const purpose = mode === 'login' ? 'login' : 'registration';
    h.responses.push(
      { status: 400, body: { message: '位置不正确', code: `${purpose}_captcha_incorrect` } },
      { body: challenge({ challengeId: 'challenge-2', carrier: 'hole', objective: 'minimum' }) },
    );
    await h.element('band-challenge-confirm').dispatch('click');
    assert.equal(h.requests.length, 3);
    assert.ok(h.requests[2].url.endsWith(`/auth/${purpose}-challenge`));
    assert.equal(h.element('band-challenge-confirm').disabled, true);
    assert.match(h.element('band-challenge-title').textContent, /空穴.*最小/);
    assert.match(h.element('band-challenge-formula').textContent, /−ℏ²/);
    assert.equal(h.element('band-challenge-particle').classList.contains('is-hole'), true);
    assert.match(h.element('band-challenge-status').textContent, /位置不正确/);
    h.element('band-challenge-position').value = '0.617';
    await h.element('band-challenge-position').dispatch('input');
    h.responses.push({ body: { token: 'retry-token', user: {} } });
    await h.element('band-challenge-confirm').dispatch('click');
    await submission;
    assert.deepEqual(h.requests[3].body.captcha, { challengeId: 'challenge-2', k: 0.617 });
    assert.equal(h.storage.get(tokenKey), 'retry-token');
  });
}

test('an ordinary registration error closes the modal and restores the form for correction', async () => {
  const h = harness();
  const { submission } = await openChallenge(h);
  h.element('band-challenge-position').value = '1';
  await h.element('band-challenge-position').dispatch('input');
  h.responses.push({ status: 400, body: { message: '邮箱验证码错误' } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.equal(h.requests.length, 2);
  assert.equal(h.element('band-challenge').open, false);
  assert.equal(h.element('auth-submit').disabled, false);
  assert.equal(h.element('auth-message').textContent, '邮箱验证码错误');
  assert.equal(h.storage.get(tokenKey), 'existing-token');
});

test('a closed session ignores its late challenge response without replacing a new session', async () => {
  const h = harness();
  h.element('auth-community-agreement').checked = true;
  const pending = deferred();
  h.responses.push(pending.promise);
  const firstSubmission = h.submit();
  await flush();
  await h.element('band-challenge-close').dispatch('click');
  await firstSubmission;
  const { submission } = await openChallenge(h, challenge({ carrier: 'hole' }));
  assert.match(h.element('band-challenge-title').textContent, /空穴/);
  pending.resolve({ body: challenge({ carrier: 'electron', objective: 'minimum' }) });
  await flush();
  assert.equal(h.element('band-challenge').open, true);
  assert.match(h.element('band-challenge-title').textContent, /空穴.*最大/);
  assert.equal(h.intervals.size, 1);
  await h.element('band-challenge-close').dispatch('click');
  await submission;
});

test('expiry disables movement and confirmation until a fresh question is loaded', async () => {
  const h = harness();
  const { submission } = await openChallenge(h);
  h.element('band-challenge-position').value = '1';
  await h.element('band-challenge-position').dispatch('input');
  assert.equal(h.element('band-challenge-confirm').disabled, false);
  h.tick(120000);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  assert.equal(h.element('band-challenge-position').disabled, true);
  assert.equal(h.element('band-challenge-refresh').disabled, false);
  assert.match(h.element('band-challenge-expiry').textContent, /已过期/);
  await h.element('band-challenge-confirm').dispatch('click');
  assert.equal(h.requests.length, 1);
  h.responses.push({ body: challenge({ expiresAt: new Date(now + 240000).toISOString() }) });
  await h.element('band-challenge-refresh').dispatch('click');
  assert.equal(h.element('band-challenge-position').disabled, false);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  await h.element('band-challenge-close').dispatch('click');
  await submission;
});

test('dragging and range input move continuously along the band without snapping to reference marks', async () => {
  const h = harness();
  const { submission } = await openChallenge(h);
  const graph = h.element('band-challenge-graph');
  const slider = h.element('band-challenge-position');
  assert.equal(slider.min, '-1');
  assert.equal(slider.max, '1');
  assert.equal(slider.step, '0.001');
  assert.equal(slider.value, '0');
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  const marks = h.element('band-challenge-candidates').children;
  assert.equal(marks.filter((mark) => mark.tagName === 'circle').length, 5);
  assert.deepEqual(
    marks.filter((mark) => mark.tagName === 'text').map((mark) => mark.textContent),
    ['A', 'B', 'C', 'D', 'E'],
  );
  await graph.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: -100, clientY: 100 });
  assert.equal(slider.value, '-1');
  assert.match(slider.attributes['aria-valuetext'], /-1\.000/);
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 900, clientY: 100 });
  assert.equal(slider.value, '1');
  assert.match(slider.attributes['aria-valuetext'], /1\.000/);
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 410.2, clientY: 100 });
  assert.ok(Math.abs(Number(slider.value) - 0.4) < 1e-12, 'k = 0.4 must remain between marks');
  await graph.dispatch('pointerup', { pointerId: 1, clientX: 413.489, clientY: 100 });
  const released = Number(slider.value);
  assert.ok(Math.abs(released - 0.413) < 1e-12, 'release must preserve the actual drop position');
  const { points } = challenge().band;
  const right = points.findIndex((point) => point.k >= released);
  const leftPoint = points[right - 1];
  const rightPoint = points[right];
  const fraction = (released - leftPoint.k) / (rightPoint.k - leftPoint.k);
  const energy = leftPoint.energy + fraction * (rightPoint.energy - leftPoint.energy);
  const energies = points.map((point) => point.energy);
  const y =
    244 -
    ((energy - Math.min(...energies)) / (Math.max(...energies) - Math.min(...energies))) * 190;
  const { transform } = h.element('band-challenge-particle').attributes;
  const position = transform
    .match(/translate\(([^,]+), ([^)]+)\)/)
    .slice(1)
    .map(Number);
  assert.ok(Math.abs(position[0] - 413.489) < 1e-12);
  assert.ok(
    Math.abs(position[1] - y) < 1e-12,
    'the particle must stay on the curve between samples',
  );
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 900, clientY: 100 });
  assert.equal(
    Number(slider.value),
    released,
    'pointer movement after release must not change the position',
  );
  for (const k of [-0.673, -0.2, 0.413, 0.617]) {
    slider.value = String(k);
    await slider.dispatch('input');
    assert.equal(slider.value, String(k));
    assert.ok(slider.attributes['aria-valuetext'].includes(k.toFixed(3)));
  }
  slider.value = '-99';
  await slider.dispatch('input');
  assert.equal(slider.value, '-1');
  slider.value = '99';
  await slider.dispatch('input');
  assert.equal(slider.value, '1');
  assert.match(slider.attributes['aria-valuetext'], /1\.000/);
  assert.equal(h.element('band-challenge-confirm').disabled, false);
  await h.element('band-challenge-close').dispatch('click');
  await submission;
});

function assertResistanceLabel(h, id, expectedOhms) {
  const label = h.element(`wien-challenge-${id}`).textContent;
  const match = label.match(/(\d+(?:\.\d+)?)\s*(k?Ω)/);
  assert.ok(match, `${id} must display a resistance: ${label}`);
  const actualOhms = Number(match[1]) * (match[2] === 'kΩ' ? 1000 : 1);
  assert.ok(Math.abs(actualOhms - expectedOhms) < 0.001, `${id}: ${label}`);
}

test('Wien resistor values are labelled in the circuit without live gain, Q, or pass indicators', () => {
  const source = readPublic('auth-challenge.js');
  const graph = source.match(/<svg\s+id="wien-challenge-graph"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(graph, 'the Wien circuit must be present');
  for (const resistor of ['r1', 'r2', 'rg', 'r0', 'rv', 'rf']) {
    assert.ok(graph.includes(`id="wien-challenge-${resistor}-value"`));
  }
  assert.doesNotMatch(
    source,
    /id="wien-challenge-(gain|q|state|frequency|components)"|wien-challenge-readings|is-satisfied/,
  );
  assert.match(source, /小信号瞬态 · 幅值归一化/);
});

for (const mode of ['login', 'register']) {
  test(`${mode}: Wien movement updates resistance labels without numeric metrics or pass hints`, async () => {
    const h = harness(mode);
    const { submission } = await openChallenge(h, wienChallenge());
    assert.equal(h.element('band-challenge-plot').hidden, true);
    assert.equal(h.element('wien-challenge-plot').hidden, false);
    assert.equal(h.element('band-challenge-title').textContent, '证明你是真人');
    assert.equal(
      h.element('band-challenge-task').textContent,
      '拖动反馈电阻的滑片，使电路起振，且起振等效 |Q| > 5。',
    );
    assert.equal(h.element('band-challenge-confirm').disabled, true);
    const slider = h.element('wien-challenge-position');
    assert.equal(slider.min, '15000');
    assert.equal(slider.max, '25000');
    assert.equal(slider.value, '18000');
    assertResistanceLabel(h, 'rv-value', 3000);
    assertResistanceLabel(h, 'rf-value', 18000);
    for (const name of ['gain', 'q', 'state', 'frequency', 'components']) {
      assert.equal(h.element(`wien-challenge-${name}`), undefined);
    }
    let selectionStatus;
    const waveforms = new Set();
    for (const resistanceOhms of [19000, 20000, 23000, 21043]) {
      slider.value = String(resistanceOhms);
      await slider.dispatch('input');
      assertResistanceLabel(h, 'rv-value', resistanceOhms - 15000);
      assertResistanceLabel(h, 'rf-value', resistanceOhms);
      assertResistanceLabel(h, 'position-value', resistanceOhms);
      assertResistanceLabel(h, 'r1-value', 22000);
      assertResistanceLabel(h, 'r2-value', 22000);
      assertResistanceLabel(h, 'rg-value', 10000);
      assertResistanceLabel(h, 'r0-value', 15000);
      const waveform = h.element('wien-challenge-waveform-curve').attributes.d;
      assert.match(waveform, /^M/);
      assert.doesNotMatch(waveform, /NaN|Infinity|undefined/);
      assert.ok(waveform.length > 100, 'the transient waveform must contain a sampled trace');
      waveforms.add(waveform);
      const status = h.element('band-challenge-status').textContent;
      selectionStatus ??= status;
      assert.equal(status, selectionStatus, 'selection feedback must not reveal the answer');
      assert.doesNotMatch(status, /起振|满足|正确|增大|减小|增益|\|?Q\|?|∞/);
      assert.equal(
        h.element('band-challenge-confirm').disabled,
        false,
        'a moved resistance can be submitted regardless of whether it passes',
      );
    }
    assert.equal(waveforms.size, 4, 'resistance changes must update the transient waveform');
    h.responses.push({ body: { token: `${mode}-wien-token`, user: {} } });
    await h.element('band-challenge-confirm').dispatch('click');
    await submission;
    assert.ok(h.requests[1].url.endsWith(`/auth/${mode}`));
    assert.deepEqual(h.requests[1].body.captcha, {
      challengeId: 'wien-challenge-1',
      resistanceOhms: 21043,
    });
    assert.equal(h.storage.get(tokenKey), `${mode}-wien-token`);
    if (mode === 'register') assert.equal(h.requests[1].body.communityAgreementAccepted, true);
  });
}

test('refresh can switch question types and cannot reuse a previous answer', async () => {
  const h = harness('login');
  const { submission } = await openChallenge(h, wienChallenge());
  h.element('wien-challenge-position').value = '21000';
  await h.element('wien-challenge-position').dispatch('input');
  h.responses.push({ body: challenge({ type: 'band' }) });
  await h.element('band-challenge-refresh').dispatch('click');
  assert.equal(h.element('wien-challenge-plot').hidden, true);
  assert.equal(h.element('wien-challenge-hint').hidden, true);
  assert.equal(h.element('wien-challenge-position').disabled, true);
  assert.equal(h.element('band-challenge-plot').hidden, false);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  await h.element('wien-challenge-position').dispatch('input');
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  h.element('band-challenge-position').value = '0.413';
  await h.element('band-challenge-position').dispatch('input');
  h.responses.push({ body: wienChallenge({ challengeId: 'wien-challenge-2' }) });
  await h.element('band-challenge-refresh').dispatch('click');
  assert.equal(h.element('band-challenge-plot').hidden, true);
  assert.equal(h.element('band-challenge-position').disabled, true);
  assert.equal(h.element('wien-challenge-hint').hidden, false);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  await h.element('band-challenge-position').dispatch('input');
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  h.element('wien-challenge-position').value = '21200';
  await h.element('wien-challenge-position').dispatch('input');
  h.responses.push({ body: { token: 'switched-token', user: {} } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.deepEqual(h.requests.at(-1).body.captcha, {
    challengeId: 'wien-challenge-2',
    resistanceOhms: 21200,
  });
});

test('a rejected Wien answer loads new circuit values and requires a fresh resistance selection', async () => {
  const h = harness('login');
  const { submission } = await openChallenge(h, wienChallenge());
  const slider = h.element('wien-challenge-position');
  slider.value = '23000';
  await slider.dispatch('input');
  h.responses.push(
    {
      status: 400,
      body: { message: '阻值不符合要求', code: 'login_captcha_incorrect' },
    },
    {
      body: wienChallenge({
        challengeId: 'wien-retry',
        oscillator: {
          ...wienChallenge().oscillator,
          rOhms: 33000,
          rgOhms: 20000,
          rfMinOhms: 30000,
          rfMaxOhms: 50000,
          rfInitialOhms: 36000,
          qMin: 7,
        },
      }),
    },
  );
  await h.element('band-challenge-confirm').dispatch('click');
  assert.equal(h.requests.length, 3);
  assert.equal(h.element('band-challenge').open, true);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  assert.match(h.element('band-challenge-status').textContent, /阻值不符合要求/);
  assert.match(h.element('band-challenge-task').textContent, /7/);
  assert.equal(slider.value, '36000');
  assertResistanceLabel(h, 'r1-value', 33000);
  assertResistanceLabel(h, 'r2-value', 33000);
  assertResistanceLabel(h, 'rg-value', 20000);
  assertResistanceLabel(h, 'r0-value', 30000);
  assertResistanceLabel(h, 'rv-value', 6000);
  assertResistanceLabel(h, 'rf-value', 36000);
  slider.value = '42000';
  await slider.dispatch('input');
  h.responses.push({ body: { token: 'wien-retry-token', user: {} } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.deepEqual(h.requests.at(-1).body.captcha, {
    challengeId: 'wien-retry',
    resistanceOhms: 42000,
  });
  assert.equal(h.storage.get(tokenKey), 'wien-retry-token');
});

test('Wien expiry and cancellation preserve the authentication form', async () => {
  const h = harness();
  const { submission } = await openChallenge(h, wienChallenge());
  h.element('wien-challenge-position').value = '21000';
  await h.element('wien-challenge-position').dispatch('input');
  h.tick(120000);
  assert.equal(h.element('wien-challenge-position').disabled, true);
  assert.equal(h.element('band-challenge-confirm').disabled, true);
  await h.element('band-challenge-confirm').dispatch('click');
  assert.equal(h.requests.length, 1);
  await h.element('band-challenge').dispatch('cancel');
  await submission;
  assert.equal(h.storage.get(tokenKey), 'existing-token');
  assert.equal(h.element('auth-community-agreement').checked, true);
  assert.equal(h.element('auth-password').value, 'password for tests');
  assert.equal(h.intervals.size, 0);
});

test('Wien wiper drags continuously over its full range and retains the released resistance', async () => {
  const h = harness('login');
  const { submission } = await openChallenge(h, wienChallenge());
  const graph = h.element('wien-challenge-graph');
  const slider = h.element('wien-challenge-position');
  await graph.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 100 });
  assert.equal(slider.value, '18000', 'unrelated circuit parts must not move the wiper');
  await graph.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 360, clientY: 285 });
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 800, clientY: 280 });
  assert.equal(slider.value, '25000');
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 280 });
  assert.equal(slider.value, '15000');
  await graph.dispatch('pointerup', { pointerId: 1, clientX: 421.14, clientY: 280 });
  assert.ok(Math.abs(Number(slider.value) - 21057) < 1e-8);
  await graph.dispatch('pointermove', { pointerId: 1, clientX: 480, clientY: 280 });
  assert.ok(Math.abs(Number(slider.value) - 21057) < 1e-8, 'release must stop the drag');
  h.responses.push({ body: { token: 'pointer-token', user: {} } });
  await h.element('band-challenge-confirm').dispatch('click');
  await submission;
  assert.ok(Math.abs(h.requests[1].body.captcha.resistanceOhms - 21057) < 1e-8);
  assert.equal(Object.hasOwn(h.requests[1].body.captcha, 'k'), false);
});

test('malformed or unknown challenge types fail closed and can be refreshed', async () => {
  for (const data of [wienChallenge({ oscillator: {} }), challenge({ type: 'unknown' })]) {
    const h = harness('login');
    h.responses.push({ body: data });
    const submission = h.submit();
    await flush();
    assert.equal(h.element('band-challenge-confirm').disabled, true);
    assert.equal(h.element('wien-challenge-plot').hidden, true);
    assert.equal(h.element('band-challenge-plot').hidden, true);
    assert.equal(h.element('band-challenge-refresh').disabled, false);
    h.responses.push({ body: wienChallenge() });
    await h.element('band-challenge-refresh').dispatch('click');
    assert.equal(h.element('wien-challenge-plot').hidden, false);
    await h.element('band-challenge-close').dispatch('click');
    await submission;
  }
});
