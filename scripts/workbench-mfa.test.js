const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controller = fs.readFileSync(
  path.join(__dirname, '../public/workbench-connectors.js'),
  'utf8',
);
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const fingerprint = '0123456789abcdef0123456789abcdef';

test('recovery uses fixed official links, explains isolated sessions and never reads browser credentials', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/workbench.html'), 'utf8');
  assert.match(html, /id="workbench-campus-login-recovery"[^>]*\bhidden/);
  assert.match(
    html,
    /id="workbench-campus-login-official"[^>]*href="https:\/\/id\.tsinghua\.edu\.cn\/do\/off\/ui\/auth\/login"/,
  );
  assert.match(html, /另开页面完成验证，不代表本站会自动获得该登录状态/);
  assert.match(html, /id="workbench-campus-login-recovery-title">需要额外验证<\/h3>/);
  assert.doesNotMatch(controller, /document\.cookie|localStorage|sessionStorage/);
});

async function fixture(generate = async () => fingerprint) {
  const nodes = new Map();
  const listeners = new Map();
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const node = (name) => {
    const id = `workbench-campus-${name}`;
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        value: '',
        checked: false,
        disabled: false,
        hidden: true,
        open: false,
        dataset: {},
        textContent: '',
        focuses: 0,
        addEventListener(type, fn) {
          listeners.set(`${id}:${type}`, [...(listeners.get(`${id}:${type}`) || []), fn]);
        },
        focus() {
          this.focuses += 1;
        },
        setAttribute(key, value) {
          this[key] = key === 'open' ? true : value;
        },
        removeAttribute(key) {
          if (key === 'open') this.open = false;
          else delete this[key];
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
          (listeners.get(`${id}:close`) || []).forEach((fn) => fn({}));
        },
        reportValidity: () => true,
      });
    return nodes.get(id);
  };
  const fire = (name, type = 'click') =>
    Promise.all(
      (listeners.get(`workbench-campus-${name}:${type}`) || []).map((fn) =>
        fn({ preventDefault() {}, target: node(name) }),
      ),
    );
  const connector = {
    configuration: { state: 'direct_cas', authorizationAvailable: true },
    connection: { status: 'not_connected' },
    sync: { available: false, latestRun: null },
    safeguards: {
      acceptsPasswordFromBrowser: true,
      acceptsCookieFromBrowser: false,
      storesPassword: false,
      sessionCookiesEncryptedAtRest: true,
    },
  };
  const app = {
    userState: { isLoggedIn: true, uid: 'user-a', username: 'student_a', token: 'token-a' },
    sessionReady: Promise.resolve(),
    callApi(endpoint, options) {
      const request = { endpoint, options };
      calls.push(request);
      if (endpoint.endsWith('/status')) return Promise.resolve({ connector });
      if (endpoint.endsWith('/direct-login')) {
        const pending = deferred();
        Object.assign(request, pending);
        return pending.promise;
      }
      throw new Error(`Unexpected mock request: ${endpoint}`);
    },
  };
  const host = {
    freeBbsApp: app,
    isSecureContext: true,
    location: { href: 'https://free-bbs.example/workbench', hostname: 'free-bbs.example' },
    history: { replaceState() {} },
    TsinghuaCasFingerprint: { generate },
    setTimeout(fn) {
      timerId += 1;
      timers.set(timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((fn) => fn(event));
      return true;
    },
  };
  node('login-form').reset = () => {
    node('login-username').value = '';
    node('login-password').value = '';
    node('login-consent').checked = false;
  };
  const document = {
    body: {},
    hidden: false,
    getElementById: (id) => node(id.replace('workbench-campus-', '')),
    addEventListener() {},
  };
  vm.runInNewContext(controller, {
    window: host,
    document,
    URL,
    URLSearchParams,
    AbortController,
    Intl,
    Date,
    CustomEvent: function Event(type) {
      this.type = type;
    },
    MutationObserver: class {
      observe() {
        return this;
      }
    },
  });
  await flush();
  const drain = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((fn) => fn());
  };
  const open = async () => {
    await fire('connect');
    drain();
  };
  const fill = (password = 'local-password') => {
    node('login-username').value = 'local_account';
    node('login-password').value = password;
    node('login-consent').checked = true;
  };
  const switchUser = async (tokenOnly = false) => {
    app.userState = { ...app.userState, uid: tokenOnly ? 'user-a' : 'user-b', token: 'token-b' };
    host.dispatchEvent({ type: 'freebbs:session-change' });
    await flush();
  };
  return {
    node,
    fire,
    app,
    calls,
    open,
    fill,
    drain,
    switchUser,
    direct: () => calls.filter((call) => call.endpoint.endsWith('/direct-login')),
  };
}

for (const code of ['cas_interactive_verification_required', 'interactive_verification_required']) {
  test(`${code}: clears credentials, stops resubmission, keeps close usable and resets recovery`, async () => {
    const f = await fixture();
    await f.open();
    f.fill();
    const submission = f.fire('login-form', 'submit');
    await flush();
    assert.equal(f.direct().length, 1);
    assert.equal(f.node('login-password').value, '');
    f.direct()[0].reject(
      Object.assign(new Error('upstream HTML must not be shown'), {
        code,
        stage: 'credential_submit',
        recovery: { officialUrl: 'https://evil.example/', canResumeHere: true },
      }),
    );
    await submission;
    f.drain();
    assert.match(f.node('login-status').textContent, /未能判别具体类型/);
    assert.doesNotMatch(f.node('login-status').textContent, /二次验证/);
    assert.match(f.node('login-diagnostic').textContent, /验证类型未判别/);
    assert.equal(f.node('login-recovery').hidden, false);
    assert.equal(f.node('login-password').value, '');
    assert.equal(f.node('login-consent').checked, false);
    assert.equal(f.node('login-submit').disabled, true);
    assert.equal(f.node('login-close').disabled, false);
    assert.equal(f.node('login-password').focuses, 0);
    await f.fire('login-recheck');
    assert.match(f.node('login-status').textContent, /尚未获得新的授权/);
    assert.equal(f.direct().length, 1, 'checking status never resubmits the password');
    assert.doesNotMatch(f.node('login-status').textContent, /upstream HTML|evil\.example/);
    f.fill('second-password');
    await f.fire('login-form', 'submit');
    assert.equal(f.direct().length, 1, 'Enter/programmatic submission must also remain blocked');
    await f.fire('login-close');
    assert.equal(f.node('login-dialog').open, false);
    assert.equal(f.node('login-recovery').hidden, true);
    await f.open();
    assert.equal(f.node('login-submit').disabled, false);
  });
}

for (const scenario of [
  {
    kind: 'image_captcha',
    label: '图形验证码',
    message: /出现图形验证码/,
    indicators: ['visible_image_captcha_container', 'visible_image_captcha_input'],
  },
  {
    kind: 'interactive',
    label: '交互验证',
    message: /额外的交互验证/,
    indicators: ['visible_interactive_prompt', 'visible_otp_input'],
  },
  {
    kind: 'unclassified',
    label: '验证类型未判别',
    message: /未能判别具体类型/,
    indicators: ['visible_verification_prompt'],
  },
  {
    kind: 'unknown_type_with_secret',
    label: '验证类型未判别',
    message: /未能判别具体类型/,
    indicators: ['visible_otp_input'],
  },
]) {
  test(`verification ${scenario.kind}: honest typed message and fixed diagnostics without upstream details`, async () => {
    const f = await fixture();
    await f.open();
    f.fill();
    const submission = f.fire('login-form', 'submit');
    await flush();
    f.direct()[0].reject(
      Object.assign(new Error('secret-password 123456 upstream HTML'), {
        code: 'cas_interactive_verification_required',
        stage: 'https://untrusted.example/?secret=123456',
        verification: {
          kind: scenario.kind,
          indicators: [
            ...scenario.indicators,
            ...scenario.indicators,
            '<input value="secret-password">',
            'https://untrusted.example/',
            null,
            { value: '123456' },
          ],
          inputValue: 'secret-password',
          html: 'upstream HTML',
        },
      }),
    );
    await submission;
    f.drain();
    assert.match(f.node('login-status').textContent, scenario.message);
    assert.doesNotMatch(f.node('login-status').textContent, /二次验证/);
    assert.equal(
      f.node('login-diagnostic').textContent,
      [scenario.label, 'cas_interactive_verification_required', ...scenario.indicators].join(' · '),
    );
    assert.doesNotMatch(
      f.node('login-status').textContent + f.node('login-diagnostic').textContent,
      /secret|123456|upstream|https:|unknown_type|<input/,
    );
    assert.equal(f.node('login-recovery').hidden, false);
    assert.equal(f.node('login-password').value, '');
    assert.equal(f.node('login-consent').checked, false);
    assert.equal(f.node('login-submit').disabled, true);
    assert.equal(f.node('login-close').disabled, false);
    f.fill('do-not-resubmit');
    await f.fire('login-form', 'submit');
    assert.equal(f.direct().length, 1);
  });
}

test('an ordinary network error stays manually retryable without automatically resending credentials', async () => {
  const f = await fixture();
  await f.open();
  f.fill();
  const first = f.fire('login-form', 'submit');
  await flush();
  f.direct()[0].reject(
    Object.assign(new Error('untrusted transport detail'), { code: 'cas_network_error' }),
  );
  await first;
  f.drain();
  assert.equal(f.node('login-submit').disabled, false);
  assert.equal(f.node('login-recovery').hidden, true);
  assert.equal(f.direct().length, 1);
  f.fill('new-password');
  const retry = f.fire('login-form', 'submit');
  await flush();
  assert.equal(f.direct().length, 2);
  f.direct()[1].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  await retry;
});

for (const tokenOnly of [false, true]) {
  test(`identity/token changes during fingerprint generation never submit the old password (${tokenOnly})`, async () => {
    const generation = deferred();
    const f = await fixture(() => generation.promise);
    await f.open();
    f.fill();
    const submission = f.fire('login-form', 'submit');
    await flush();
    await f.switchUser(tokenOnly);
    await f.open();
    f.fill('new-owner-draft');
    generation.resolve(fingerprint);
    await submission;
    assert.equal(f.direct().length, 0);
    assert.equal(f.node('login-password').value, 'new-owner-draft');
    assert.equal(f.node('login-dialog').open, true);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`late old-owner ${outcome} cannot change a new login while its fingerprint is pending`, async () => {
    const generation = deferred();
    let count = 0;
    const f = await fixture(() => {
      count += 1;
      return count === 1 ? Promise.resolve(fingerprint) : generation.promise;
    });
    await f.open();
    f.fill();
    const first = f.fire('login-form', 'submit');
    await flush();
    await f.switchUser();
    await f.open();
    f.fill('new-owner-draft');
    const second = f.fire('login-form', 'submit');
    await flush();
    const status = f.node('login-status').textContent;
    if (outcome === 'success') f.direct()[0].resolve({});
    else
      f.direct()[0].reject(
        Object.assign(new Error('old MFA'), { code: 'cas_interactive_verification_required' }),
      );
    await first;
    f.drain();
    assert.equal(f.node('login-password').value, 'new-owner-draft');
    assert.equal(f.node('login-status').textContent, status);
    assert.equal(f.node('login-submit').disabled, true);
    assert.equal(f.node('login-recovery').hidden, true);
    assert.equal(f.node('login-dialog').open, true);
    generation.resolve(fingerprint);
    await flush();
    f.direct()[1].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await second;
  });
}
