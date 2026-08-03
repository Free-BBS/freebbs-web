const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ADAPTER_ID,
  createAuthorizedFetch,
  createTsinghuaCasAdapter,
  parseOpaqueGrant,
} = require('./cas-adapter');

const LEARN_ORIGIN = 'https://learn.tsinghua.edu.cn';
const SEMESTER_URL = `${LEARN_ORIGIN}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;

function cookie(overrides = {}) {
  return {
    name: 'SESSION',
    value: 'secret',
    domain: 'learn.tsinghua.edu.cn',
    path: '/',
    hostOnly: true,
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expiresAt: null,
    ...overrides,
  };
}

function grant(cookies, overrides = {}) {
  return JSON.stringify({
    version: 1,
    origin: LEARN_ORIGIN,
    cookies,
    ...overrides,
  });
}

function rejectsWith(code) {
  return (error) => error?.code === code;
}

test('direct CAS adapter exposes the fixed broker identity', () => {
  const adapter = createTsinghuaCasAdapter({
    fetchImpl: async () => {
      throw new Error('not called');
    },
  });
  assert.equal(ADAPTER_ID, 'tsinghua_direct_cas');
  assert.equal(adapter.id, ADAPTER_ID);
  assert.equal(adapter.version, 'direct-cas-v1');
  assert.equal(adapter.authorizationStrategy, 'credentials');
  assert.equal(typeof adapter.authenticateDirect, 'function');
  assert.equal(typeof adapter.createAuthorizedFetch, 'function');
});

test('opaque grants require an exact bounded envelope and cookie schema', () => {
  assert.equal(parseOpaqueGrant(grant([cookie()])).version, 1);

  const malformedCookies = [
    cookie({ domain: 'id.tsinghua.edu.cn' }),
    cookie({ domain: '.learn.tsinghua.edu.cn' }),
    cookie({ path: 'not-absolute' }),
    cookie({ value: 'header;injection' }),
    cookie({ value: 'header\r\ninjection' }),
    cookie({ hostOnly: 'true' }),
    cookie({ expiresAt: 'never' }),
    cookie({ sameSite: 'invalid' }),
    { ...cookie(), unexpected: true },
  ];
  for (const malformedCookie of malformedCookies) {
    assert.throws(
      () => parseOpaqueGrant(grant([malformedCookie])),
      rejectsWith('connector_grant_invalid'),
    );
  }

  const duplicate = cookie();
  const invalidGrants = [
    '{}',
    JSON.stringify({ version: 1, origin: LEARN_ORIGIN, cookies: [] }),
    grant([cookie()], { origin: 'https://evil.example' }),
    grant([duplicate, { ...duplicate, value: 'other' }]),
    JSON.stringify({ version: 1, origin: LEARN_ORIGIN, cookies: [cookie()], extra: true }),
    'not-json',
  ];
  for (const invalidGrant of invalidGrants) {
    assert.throws(() => parseOpaqueGrant(invalidGrant), rejectsWith('connector_grant_invalid'));
  }
});

test('authorized fetch sends only matching Learn and root-domain cookies', async () => {
  let observed = null;
  const authorizedFetch = createAuthorizedFetch(
    grant([
      cookie({ value: 'learn-secret' }),
      cookie({
        name: 'ROOT_SESSION',
        value: 'root-secret',
        domain: 'tsinghua.edu.cn',
        hostOnly: false,
      }),
      cookie({
        name: 'XSRF-TOKEN',
        value: 'token%2Bvalue',
        path: '/b',
        httpOnly: false,
      }),
      cookie({ name: 'OTHER_PATH', value: 'must-not-send', path: '/f' }),
    ]),
    {
      now: () => 1_000,
      async fetchImpl(url, options) {
        observed = { url: String(url), options };
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  );

  await authorizedFetch(SEMESTER_URL, {
    method: 'GET',
    headers: {
      Authorization: 'must-be-removed',
      Cookie: 'must-be-replaced',
      'Proxy-Authorization': 'must-also-be-removed',
      'X-XSRF-TOKEN': 'must-be-replaced',
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'follow',
  });

  assert.equal(observed.url, SEMESTER_URL);
  assert.match(observed.options.headers.get('cookie'), /SESSION=learn-secret/u);
  assert.match(observed.options.headers.get('cookie'), /ROOT_SESSION=root-secret/u);
  assert.match(observed.options.headers.get('cookie'), /XSRF-TOKEN=token%2Bvalue/u);
  assert.doesNotMatch(observed.options.headers.get('cookie'), /must-not-send/u);
  assert.equal(observed.options.headers.get('authorization'), null);
  assert.equal(observed.options.headers.get('proxy-authorization'), null);
  assert.equal(observed.options.headers.get('x-xsrf-token'), 'token+value');
  assert.equal(observed.options.redirect, 'manual');
  assert.equal(observed.options.credentials, 'omit');
});

test('authorized fetch permits only the connector exact read API allowlist', async () => {
  let calls = 0;
  const authorizedFetch = createAuthorizedFetch(grant([cookie()]), {
    now: () => 1_000,
    async fetchImpl() {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  const blockedRequests = [
    ['https://evil.example/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester', 'GET'],
    ['https://id.tsinghua.edu.cn/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester', 'GET'],
    [`${SEMESTER_URL}?unexpected=1`, 'GET'],
    [`${LEARN_ORIGIN}/b/private`, 'GET'],
    [`${LEARN_ORIGIN}/b/wlxt/kcgg/wlkc_ggb/student/pageListXs`, 'GET'],
    [SEMESTER_URL, 'POST'],
  ];
  for (const [url, method] of blockedRequests) {
    await assert.rejects(authorizedFetch(url, { method }), rejectsWith('connector_target_blocked'));
  }
  await assert.rejects(
    authorizedFetch(SEMESTER_URL, { method: 'DELETE' }),
    rejectsWith('connector_method_blocked'),
  );
  assert.equal(calls, 0);
});

test('expired cookies require reauthorization and never reach the network', async () => {
  const authorizedFetch = createAuthorizedFetch(grant([cookie({ expiresAt: 10 })]), {
    now: () => 20,
    async fetchImpl() {
      throw new Error('must not run');
    },
  });

  await assert.rejects(
    authorizedFetch(SEMESTER_URL, { method: 'GET' }),
    rejectsWith('connector_authorization_required'),
  );
});

test('malformed percent-encoded XSRF cookies fail closed', async () => {
  for (const value of ['%E0%A4%A', 'token%0D%0Ainjection']) {
    const authorizedFetch = createAuthorizedFetch(
      grant([cookie(), cookie({ name: 'XSRF-TOKEN', value, path: '/b' })]),
      {
        now: () => 1_000,
        async fetchImpl() {
          throw new Error('must not run');
        },
      },
    );

    await assert.rejects(
      authorizedFetch(SEMESTER_URL, { method: 'GET' }),
      rejectsWith('connector_grant_invalid'),
    );
  }
});
