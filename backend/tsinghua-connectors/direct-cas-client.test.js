const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthorizedFetch } = require('./cas-adapter');
const { CampusConnectorError } = require('./errors');
const { DIRECT_CAS_STAGES } = require('./direct-cas-diagnostics');
const {
  CAS_CHECK_PATH,
  DIRECT_GRANT_MAX_AGE_MS,
  LEARN_LOGIN_URL,
  LEARN_SEMESTER_URL,
  TsinghuaCookieJar,
  createDirectCasClient,
  extractCasForm,
  extractCasUrl,
  extractLearnCsrfToken,
  extractLearnRoamingUrl,
  parseSetCookie,
  validateAllowedUrl,
} = require('./direct-cas-client');

const CAS_URL =
  'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0';
const ROAMING_URL =
  'https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket';
const ROAMING_ALIAS_URL =
  'https://learn.tsinghua.edu.cn/f/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket';
const SUCCESSFUL_LEARN_CALLBACK =
  'https://learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket';
const CAS_SUCCESS_MARKER = '登录成功。正在重定向到';
const CSRF_TOKEN = 'fixture-csrf-token';
const XSRF_TOKEN = 'fixture-xsrf-token';
const XSRF_COOKIE_VALUE = '%66ixture-xsrf-token';
const SEMESTER_VERIFICATION_URL = `${LEARN_SEMESTER_URL}?_csrf=${CSRF_TOKEN}`;
const PUBLIC_KEY =
  '04d0c9e1ae89279fe05b435d63e3eba437bf510e09da5f71558974a19dc596724227f08dc2fc6e74bbb9d8b468d4dd5205e9b6793a3bbc48df3fdf219b3ea140e3';
const USERNAME = 'Student01';
const PASSWORD = 'local-test-password-never-returned';
const FINGERPRINT = '0123456789abcdef0123456789abcdef';
const LOGIN_CREDENTIALS = Object.freeze({
  username: USERNAME,
  password: PASSWORD,
  fingerprint: FINGERPRINT,
});
const FIXED_NOW = Date.parse('2026-08-02T12:00:00.000Z');

function response(body, { status = 200, location = '', cookies = [], headers = {} } = {}) {
  const responseHeaders = new Headers(headers);
  if (location) responseHeaders.set('location', location);
  cookies.forEach((cookie) => responseHeaders.append('set-cookie', cookie));
  return new Response(body, { status, headers: responseHeaders });
}

function htmlResponse(body, options = {}) {
  return response(body, {
    ...options,
    headers: { 'content-type': 'text/html; charset=UTF-8', ...(options.headers || {}) },
  });
}

function jsonResponse(payload, options = {}) {
  return response(JSON.stringify(payload), {
    ...options,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...(options.headers || {}) },
  });
}

function learnLoginHtml(casUrl = CAS_URL) {
  return `<!doctype html><button onclick="window.location.href='${casUrl}'">登录</button>`;
}

function casFormHtml({ action = CAS_CHECK_PATH, captchaVisible = false } = {}) {
  return `<!doctype html>
    <form id="theform" method="post" action="${action}">
      <input type="text" name="i_user">
      <input type="hidden" name="i_pass">
      <input type="hidden" name="fingerPrint">
      <input type="hidden" name="fingerGenPrint">
      <input type="hidden" name="fingerGenPrint3">
      <input type="hidden" name="deviceName">
      <input type="hidden" name="csrf_fixture" value="preserved-value">
      <div id="c_code" class="form-group ${captchaVisible ? '' : 'hidden'}">
        <input name="i_captcha">
      </div>
    </form>
    <div style="display:none" id="sm2publicKey">${PUBLIC_KEY}</div>`;
}

function createFetchSequence(steps) {
  const pending = [...steps];
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const step = pending.shift();
    assert.ok(step, `unexpected request: ${options.method || 'GET'} ${input}`);
    const call = {
      url: String(input),
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) },
      body: options.body,
      redirect: options.redirect,
    };
    calls.push(call);
    if (step.url) assert.equal(call.url, step.url);
    if (step.method) assert.equal(call.method, step.method);
    if (step.assert) step.assert(call);
    if (step.error) throw step.error;
    return typeof step.response === 'function' ? step.response(call) : step.response;
  };
  fetchImpl.calls = calls;
  fetchImpl.assertDone = () =>
    assert.equal(pending.length, 0, `${pending.length} fixture requests unused`);
  return fetchImpl;
}

function successfulSteps({
  learnEntryCookie = 'LEARN_ENTRY=entry-cookie; Path=/; Secure; HttpOnly; Expires=Sun, 02 Aug 2026 13:00:00 GMT',
  verifyResponse = jsonResponse({ message: 'success', result: { xnxq: '2026-2027-1' } }),
} = {}) {
  return [
    {
      method: 'GET',
      url: LEARN_LOGIN_URL,
      assert(call) {
        assert.equal(call.redirect, 'manual');
        assert.equal(Object.hasOwn(call.headers, 'Cookie'), false);
      },
      response: htmlResponse(learnLoginHtml(), {
        cookies: [
          learnEntryCookie,
          `XSRF-TOKEN=${XSRF_COOKIE_VALUE}; Path=/; Secure; SameSite=Lax`,
        ],
      }),
    },
    {
      method: 'GET',
      url: CAS_URL,
      assert(call) {
        assert.equal(Object.hasOwn(call.headers, 'Cookie'), false);
      },
      response: htmlResponse(casFormHtml(), {
        cookies: [
          'ID_SESSION=identity-cookie; Path=/do/off; Secure; HttpOnly',
          'GLOBAL_SSO=identity-wide; Domain=tsinghua.edu.cn; Path=/; Secure; HttpOnly',
        ],
      }),
    },
    {
      method: 'POST',
      url: `https://id.tsinghua.edu.cn${CAS_CHECK_PATH}`,
      assert(call) {
        assert.match(call.headers.Cookie, /ID_SESSION=identity-cookie/);
        assert.doesNotMatch(call.headers.Cookie, /LEARN_ENTRY/);
        assert.equal(call.headers.Origin, 'https://id.tsinghua.edu.cn');
        const form = new URLSearchParams(call.body);
        assert.equal(form.get('i_user'), USERNAME);
        assert.equal(form.get('fingerPrint'), FINGERPRINT);
        assert.equal(form.get('fingerGenPrint'), '');
        assert.equal(form.get('fingerGenPrint3'), '');
        assert.equal(form.get('deviceName'), 'windows,Chrome/131');
        assert.equal(form.get('i_captcha'), '');
        assert.equal(form.get('csrf_fixture'), 'preserved-value');
        assert.match(form.get('i_pass'), /^04[0-9a-f]+$/i);
        assert.notEqual(form.get('i_pass'), PASSWORD);
        assert.doesNotMatch(call.body, new RegExp(PASSWORD));
      },
      response: response(null, {
        status: 302,
        location: 'https://learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket',
      }),
    },
    {
      method: 'GET',
      url: 'https://learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket',
      assert(call) {
        assert.match(call.headers.Cookie, /LEARN_ENTRY=entry-cookie/);
        assert.match(call.headers.Cookie, /GLOBAL_SSO=identity-wide/);
        assert.doesNotMatch(call.headers.Cookie, /ID_SESSION/);
        assert.equal(Object.hasOwn(call.headers, 'Origin'), false);
        assert.equal(Object.hasOwn(call.headers, 'Referer'), false);
      },
      response: response(null, {
        status: 302,
        location: '/f/wlxt/index/course/student/',
        cookies: [
          'JSESSIONID=learn-private-session; Path=/; Secure; HttpOnly',
          'PRIVATE_PATH=course-only; Path=/b; Secure; SameSite=Lax',
          'EXPIRED=delete-me; Path=/; Max-Age=0',
        ],
      }),
    },
    {
      method: 'GET',
      url: 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
      assert(call) {
        assert.match(call.headers.Cookie, /JSESSIONID=learn-private-session/);
        assert.doesNotMatch(call.headers.Cookie, /PRIVATE_PATH/);
        assert.doesNotMatch(call.headers.Cookie, /EXPIRED/);
      },
      response: htmlResponse(
        `<!doctype html><title>网络学堂</title><a href="/f/wlxt/index/course/student/?_csrf=${CSRF_TOKEN}">课程</a>`,
      ),
    },
    {
      method: 'GET',
      url: SEMESTER_VERIFICATION_URL,
      assert(call) {
        assert.match(call.headers.Cookie, /JSESSIONID=learn-private-session/);
        assert.match(call.headers.Cookie, /PRIVATE_PATH=course-only/);
        assert.doesNotMatch(call.headers.Cookie, /ID_SESSION/);
        assert.equal(call.headers['X-Requested-With'], 'XMLHttpRequest');
        assert.equal(call.headers.Origin, 'https://learn.tsinghua.edu.cn');
        assert.equal(
          call.headers.Referer,
          'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
        );
        assert.equal(call.headers['X-XSRF-TOKEN'], XSRF_TOKEN);
      },
      response: verifyResponse,
    },
  ];
}

function successfulRoamingSteps() {
  const steps = successfulSteps();
  steps[2] = {
    ...steps[2],
    response: htmlResponse(
      `<!doctype html><title>Authenticated</title><a href="${ROAMING_URL}">Continue</a>`,
    ),
  };
  steps[3] = { ...steps[3], url: ROAMING_URL };
  return steps;
}

function successfulCallbackSteps({ relative = false } = {}) {
  const steps = successfulSteps();
  const callback = relative ? '/f/login?ticket=fixture-service-ticket' : SUCCESSFUL_LEARN_CALLBACK;
  steps[2] = {
    ...steps[2],
    response: htmlResponse(
      `<!doctype html><title>Authenticated</title><p>${CAS_SUCCESS_MARKER}</p><a href="${callback}">Continue</a>`,
    ),
  };
  steps[3] = { ...steps[3], url: SUCCESSFUL_LEARN_CALLBACK };
  return steps;
}

function expectSafeError(expectedCode, secret = PASSWORD, expectedStage = null) {
  return (error) => {
    assert.ok(error instanceof CampusConnectorError);
    assert.equal(error.code, expectedCode);
    assert.ok(Number.isInteger(error.status));
    assert.ok(DIRECT_CAS_STAGES.includes(error.stage));
    if (expectedStage) assert.equal(error.stage, expectedStage);
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.doesNotMatch(String(error), new RegExp(secret));
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(Object.prototype.propertyIsEnumerable.call(error, 'stage'), false);
    return true;
  };
}

test('parses the current Learn CAS link and the current SM2 form shape', () => {
  const casUrl = extractCasUrl(learnLoginHtml());
  assert.equal(casUrl.toString(), CAS_URL);
  const form = extractCasForm(casFormHtml(), casUrl);
  assert.equal(form.actionUrl.toString(), `https://id.tsinghua.edu.cn${CAS_CHECK_PATH}`);
  assert.equal(form.publicKey, PUBLIC_KEY);
  assert.deepEqual(
    { ...form.inputs },
    {
      fingerPrint: '',
      fingerGenPrint: '',
      fingerGenPrint3: '',
      deviceName: '',
      csrf_fixture: 'preserved-value',
    },
  );
});

test('extracts only one bounded Learn CSRF token from current page shapes', () => {
  assert.equal(
    extractLearnCsrfToken(
      `<a href="/f/wlxt/index/course/student/?foo=1&amp;_csrf=${CSRF_TOKEN}">课程</a><input type="hidden" name="_csrf" value="${CSRF_TOKEN}">`,
    ),
    CSRF_TOKEN,
  );
  assert.equal(extractLearnCsrfToken('<title>no token</title>'), null);
  assert.equal(
    extractLearnCsrfToken(
      `<a href="/one?_csrf=${CSRF_TOKEN}">one</a><a href="/two?_csrf=different-csrf-token">two</a>`,
    ),
    null,
  );
  assert.equal(extractLearnCsrfToken('<input name="_csrf" value="short">'), null);
});

test('accepts only one normalized fixed Learn roaming ticket target', () => {
  assert.equal(extractLearnRoamingUrl(`<a href="${ROAMING_URL}">continue</a>`), ROAMING_URL);
  assert.equal(
    extractLearnRoamingUrl(`<a href="${ROAMING_URL}">one</a><a href="${ROAMING_URL}">two</a>`),
    ROAMING_URL,
  );
  assert.equal(
    extractLearnRoamingUrl(`<a href="${ROAMING_ALIAS_URL}">continue</a>`),
    ROAMING_ALIAS_URL,
  );

  for (const html of [
    '<a href="https://evil.example/steal?ticket=fixture-service-ticket">continue</a>',
    '<a href="https://learn.tsinghua.edu.cn.evil.example/b/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket">continue</a>',
    '<a href="http://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket">continue</a>',
    '<a href="https://learn.tsinghua.edu.cn:443/b/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket">continue</a>',
    '<a href="https://user@learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=fixture-service-ticket">continue</a>',
    '<a href="https://learn.tsinghua.edu.cn/b/other?ticket=fixture-service-ticket">continue</a>',
    `<a href="${ROAMING_URL}&next=evil">continue</a>`,
    `<a href="${ROAMING_URL}&ticket=second">continue</a>`,
    '<a href="https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=">continue</a>',
    '<a href="https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=bad%2Fticket">continue</a>',
    `<a href="${ROAMING_URL}#fragment">continue</a>`,
    `<a href="https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=${'a'.repeat(2_049)}">continue</a>`,
  ]) {
    assert.equal(extractLearnRoamingUrl(html), null);
  }

  const differentTicketUrl = ROAMING_URL.replace(
    'fixture-service-ticket',
    'different-service-ticket',
  );
  assert.throws(
    () =>
      extractLearnRoamingUrl(
        `<a href="${ROAMING_URL}">one</a><a href="${differentTicketUrl}">two</a>`,
      ),
    expectSafeError(
      'cas_identity_response_unrecognized',
      'different-service-ticket',
      'credential_submit',
    ),
  );
});

test('preserves the current successful Learn service callback', () => {
  for (const callback of [SUCCESSFUL_LEARN_CALLBACK, '/f/login?ticket=fixture-service-ticket']) {
    assert.equal(
      extractLearnRoamingUrl(`<p>${CAS_SUCCESS_MARKER}</p><a href="${callback}">continue</a>`),
      SUCCESSFUL_LEARN_CALLBACK,
    );
  }

  assert.equal(extractLearnRoamingUrl(`<a href="${SUCCESSFUL_LEARN_CALLBACK}">continue</a>`), null);

  for (const callback of [
    'https://evil.example/f/login?ticket=fixture-service-ticket',
    'https://learn.tsinghua.edu.cn.evil.example/f/login?ticket=fixture-service-ticket',
    'http://learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket',
    'https://learn.tsinghua.edu.cn:443/f/login?ticket=fixture-service-ticket',
    'https://user@learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket',
    'https://learn.tsinghua.edu.cn/f/login?ticket=fixture-service-ticket&next=evil',
    'https://learn.tsinghua.edu.cn/f/login?ticket=one&ticket=two',
    '//evil.example/f/login?ticket=fixture-service-ticket',
  ]) {
    assert.equal(
      extractLearnRoamingUrl(`<p>${CAS_SUCCESS_MARKER}</p><a href="${callback}">continue</a>`),
      null,
    );
  }
});

test('permits only the two fixed HTTPS origins and blocks unsafe form actions', () => {
  assert.equal(validateAllowedUrl(LEARN_LOGIN_URL).hostname, 'learn.tsinghua.edu.cn');
  assert.equal(validateAllowedUrl(CAS_URL).hostname, 'id.tsinghua.edu.cn');
  for (const candidate of [
    'http://learn.tsinghua.edu.cn/f/login',
    'https://info.tsinghua.edu.cn/',
    'https://id.sigs.tsinghua.edu.cn/',
    'https://user:pass@id.tsinghua.edu.cn/',
    'https://id.tsinghua.edu.cn:444/',
    'https://id.tsinghua.edu.cn/#fragment',
  ]) {
    assert.throws(() => validateAllowedUrl(candidate), expectSafeError('cas_target_blocked'));
  }
  assert.throws(
    () => extractCasForm(casFormHtml({ action: 'https://evil.example/login' }), CAS_URL),
    expectSafeError('cas_target_blocked'),
  );
  assert.throws(
    () => extractCasForm(casFormHtml({ captchaVisible: true }), CAS_URL),
    expectSafeError('cas_interactive_verification_required'),
  );
});

test('isolates cookies by host, domain, path, Secure and expiry', () => {
  let now = FIXED_NOW;
  const jar = new TsinghuaCookieJar({ now: () => now });
  jar.setCookies(LEARN_LOGIN_URL, [
    'ROOT=root; Path=/; Secure; HttpOnly',
    'PRIVATE=private; Path=/b; Secure',
    'PLAIN=plain; Path=/',
    'SHORT=short; Path=/; Max-Age=2',
    'BAD_DOMAIN=blocked; Domain=evil.example; Path=/',
  ]);
  jar.setCookies(CAS_URL, ['IDENTITY=id-only; Path=/do; Secure']);

  assert.match(jar.getCookieHeader(LEARN_SEMESTER_URL), /PRIVATE=private/);
  assert.match(jar.getCookieHeader(LEARN_SEMESTER_URL), /ROOT=root/);
  assert.doesNotMatch(jar.getCookieHeader(`${LEARN_LOGIN_URL}/other`), /PRIVATE=private/);
  assert.doesNotMatch(jar.getCookieHeader(CAS_URL), /ROOT=root|PRIVATE=private|PLAIN=plain/);
  assert.match(jar.getCookieHeader(CAS_URL), /IDENTITY=id-only/);
  assert.doesNotMatch(
    jar.getCookieHeader('http://learn.tsinghua.edu.cn/b/private'),
    /ROOT=root|PRIVATE=private/,
  );
  assert.match(jar.getCookieHeader('http://learn.tsinghua.edu.cn/b/private'), /PLAIN=plain/);
  assert.equal(parseSetCookie('BROKEN=x; Domain=evil.example', LEARN_LOGIN_URL, now), null);

  now += 2_001;
  assert.doesNotMatch(jar.getCookieHeader(LEARN_SEMESTER_URL), /SHORT=short/);
  jar.setCookies(LEARN_LOGIN_URL, ['ROOT=gone; Path=/; Max-Age=0']);
  assert.doesNotMatch(jar.getCookieHeader(LEARN_SEMESTER_URL), /ROOT=/);
});

test('performs SM2 CAS login and returns only a verified, least-privilege Learn grant', async () => {
  const fetchImpl = createFetchSequence(successfulSteps());
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  const result = await client.login(LOGIN_CREDENTIALS);
  fetchImpl.assertDone();

  assert.equal(result.subject, USERNAME.toLowerCase());
  assert.deepEqual(result.scopes, ['semesters', 'courses', 'course_notices', 'homework']);
  assert.equal(result.expiresAt, '2026-08-02T13:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(PASSWORD));
  const grant = JSON.parse(result.opaqueGrant);
  assert.deepEqual(Object.keys(grant).sort(), ['cookies', 'origin', 'version']);
  assert.equal(grant.origin, 'https://learn.tsinghua.edu.cn');
  assert.ok(grant.cookies.some((cookie) => cookie.name === 'JSESSIONID'));
  assert.ok(grant.cookies.some((cookie) => cookie.name === 'PRIVATE_PATH'));
  assert.equal(
    grant.cookies.some((cookie) => cookie.name === 'ID_SESSION'),
    false,
  );
  assert.equal(
    grant.cookies.some((cookie) => cookie.name === 'GLOBAL_SSO'),
    false,
  );
  assert.equal(
    grant.cookies.some((cookie) => cookie.name === 'EXPIRED'),
    false,
  );
  const persistedCookieFields = [
    'domain',
    'expiresAt',
    'hostOnly',
    'httpOnly',
    'name',
    'path',
    'sameSite',
    'secure',
    'value',
  ];
  for (const persistedCookie of grant.cookies) {
    assert.deepEqual(Object.keys(persistedCookie).sort(), persistedCookieFields);
  }

  let syncRequest;
  const authorizedFetch = createAuthorizedFetch(result.opaqueGrant, {
    now: () => FIXED_NOW,
    async fetchImpl(url, options) {
      syncRequest = { url: String(url), options };
      return jsonResponse({ result: { xnxq: '2026-2027-1' } });
    },
  });
  await authorizedFetch(LEARN_SEMESTER_URL, { method: 'GET' });
  assert.equal(syncRequest.url, LEARN_SEMESTER_URL);
  assert.match(syncRequest.options.headers.get('cookie'), /JSESSIONID=learn-private-session/);
  assert.match(syncRequest.options.headers.get('cookie'), /PRIVATE_PATH=course-only/);
  assert.doesNotMatch(syncRequest.options.headers.get('cookie'), /GLOBAL_SSO|ID_SESSION/);
  assert.equal(syncRequest.options.redirect, 'manual');
});

test('continues a current ID HTML success page through the fixed Learn roaming endpoint', async () => {
  const fetchImpl = createFetchSequence(successfulRoamingSteps());
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  const result = await client.login(LOGIN_CREDENTIALS);
  fetchImpl.assertDone();
  assert.equal(result.subject, USERNAME.toLowerCase());
  assert.deepEqual(result.scopes, ['semesters', 'courses', 'course_notices', 'homework']);
});

test('continues current absolute and relative Learn success callbacks through roaming', async () => {
  for (const relative of [false, true]) {
    const fetchImpl = createFetchSequence(successfulCallbackSteps({ relative }));
    const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
    const result = await client.login(LOGIN_CREDENTIALS);
    fetchImpl.assertDone();
    assert.equal(result.subject, USERNAME.toLowerCase());
    assert.deepEqual(result.scopes, ['semesters', 'courses', 'course_notices', 'homework']);
  }
});

test('gives session-only grants a server-side hard expiry', async () => {
  const fetchImpl = createFetchSequence(
    successfulSteps({
      learnEntryCookie: 'LEARN_ENTRY=entry-cookie; Path=/; Secure; HttpOnly',
    }),
  );
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  const result = await client.login(LOGIN_CREDENTIALS);
  fetchImpl.assertDone();

  assert.equal(Date.parse(result.expiresAt), FIXED_NOW + DIRECT_GRANT_MAX_AGE_MS);
});

test('does not issue a grant when the private semester endpoint does not validate the session', async () => {
  const fetchImpl = createFetchSequence(
    successfulSteps({
      verifyResponse: htmlResponse('<title>清华大学统一身份认证</title>'),
    }),
  );
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_login_unverified'));
  fetchImpl.assertDone();
});

test('does not verify a Learn session without a unique course-page CSRF token', async () => {
  const steps = successfulSteps().slice(0, -1);
  steps[4] = {
    ...steps[4],
    response: htmlResponse('<!doctype html><title>网络学堂</title>'),
  };
  const fetchImpl = createFetchSequence(steps);
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  await assert.rejects(
    client.login(LOGIN_CREDENTIALS),
    expectSafeError('cas_login_unverified', PASSWORD, 'session_verify'),
  );
  fetchImpl.assertDone();
});

test('rejects a non-2xx Learn ticket continuation before session verification', async () => {
  const steps = successfulRoamingSteps().slice(0, 4);
  steps[3] = {
    ...steps[3],
    response: htmlResponse('<!doctype html><title>Denied</title>', {
      status: 403,
    }),
  };
  const fetchImpl = createFetchSequence(steps);
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  await assert.rejects(
    client.login(LOGIN_CREDENTIALS),
    expectSafeError('cas_login_unverified', PASSWORD, 'credential_submit'),
  );
  fetchImpl.assertDone();
});

test('classifies a visible credential rejection without exposing credentials or upstream HTML', async () => {
  const steps = successfulSteps().slice(0, 2);
  steps.push({
    method: 'POST',
    url: `https://id.tsinghua.edu.cn${CAS_CHECK_PATH}`,
    response: htmlResponse(
      '<p id="c_note"><span id="msg_note">您的用户名或密码不正确，请重试！</span></p>',
    ),
  });
  const fetchImpl = createFetchSequence(steps);
  const client = createDirectCasClient({
    fetchImpl,
    now: () => FIXED_NOW,
    sm2Impl: { doEncrypt: () => 'ab'.repeat(100) },
  });
  await assert.rejects(
    client.login(LOGIN_CREDENTIALS),
    expectSafeError('cas_credentials_rejected'),
  );
  fetchImpl.assertDone();
});

test('ignores hidden default notices but recognizes the fixed credential failure token', async () => {
  const fixtures = [
    {
      body: '<p id="c_note" style="display:none"><span id="msg_note">用户名或密码不正确</span></p>',
      code: 'cas_identity_response_unrecognized',
    },
    {
      body: '<p id="c_note" style="display:none"><span id="msg_note">用户名或密码不正确</span></p><script>window.loginError = "BAD_CREDENTIALS";</script>',
      code: 'cas_credentials_rejected',
    },
  ];

  for (const fixture of fixtures) {
    const steps = successfulSteps().slice(0, 2);
    steps.push({
      method: 'POST',
      url: `https://id.tsinghua.edu.cn${CAS_CHECK_PATH}`,
      response: htmlResponse(fixture.body),
    });
    const fetchImpl = createFetchSequence(steps);
    const client = createDirectCasClient({
      fetchImpl,
      now: () => FIXED_NOW,
      sm2Impl: { doEncrypt: () => 'ab'.repeat(100) },
    });
    await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError(fixture.code));
    fetchImpl.assertDone();
  }
});

test('blocks redirects outside the fixed hosts before making the destination request', async () => {
  const fetchImpl = createFetchSequence([
    {
      method: 'GET',
      url: LEARN_LOGIN_URL,
      response: response(null, {
        status: 302,
        location: 'https://info.tsinghua.edu.cn/private?ticket=must-not-leak',
      }),
    },
  ]);
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_redirect_blocked'));
  fetchImpl.assertDone();
  assert.equal(fetchImpl.calls.length, 1);
});

test('enforces redirect, response-size and timeout limits with safe classifications', async (t) => {
  await t.test('redirect limit', async () => {
    const fetchImpl = createFetchSequence([
      { response: response(null, { status: 302, location: '/f/one' }) },
      { response: response(null, { status: 302, location: '/f/two' }) },
      { response: response(null, { status: 302, location: '/f/three' }) },
    ]);
    const client = createDirectCasClient({ fetchImpl, maxRedirects: 2, now: () => FIXED_NOW });
    await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_redirect_limit'));
    fetchImpl.assertDone();
  });

  await t.test('bounded response', async () => {
    const fetchImpl = createFetchSequence([
      {
        response: htmlResponse('small', { headers: { 'content-length': '4096' } }),
      },
    ]);
    const client = createDirectCasClient({
      fetchImpl,
      maxResponseBytes: 64,
      now: () => FIXED_NOW,
    });
    await assert.rejects(
      client.login(LOGIN_CREDENTIALS),
      expectSafeError('cas_response_too_large'),
    );
    fetchImpl.assertDone();
  });

  await t.test('timeout even when fetch ignores AbortSignal', async () => {
    const client = createDirectCasClient({
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 15,
      totalTimeoutMs: 50,
    });
    await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_timeout'));
  });

  await t.test('timeout while an upstream response body stalls', async () => {
    let cancelled = false;
    const client = createDirectCasClient({
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: {
          getReader() {
            return {
              read: async () => new Promise(() => {}),
              cancel: async () => {
                cancelled = true;
              },
              releaseLock() {},
            };
          },
        },
      }),
      timeoutMs: 15,
      totalTimeoutMs: 50,
    });
    await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_timeout'));
    assert.equal(cancelled, true);
  });
});

test('wraps arbitrary transport failures into a fixed safe error', async () => {
  const fetchImpl = createFetchSequence([{ error: new Error(`socket failed with ${PASSWORD}`) }]);
  const client = createDirectCasClient({ fetchImpl, now: () => FIXED_NOW });
  await assert.rejects(client.login(LOGIN_CREDENTIALS), expectSafeError('cas_network_error'));
  fetchImpl.assertDone();
});
