const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { CampusConnectorError } = require('./errors');
const {
  AUTHORIZATION_CALLBACK_PATH,
  AUTHORIZATION_CORRELATION_COOKIE,
  createCampusConnectorRouter,
  createDirectLoginRateLimiter,
  parseDirectLoginBody,
} = require('./router');

const FINGERPRINT = '0123456789abcdef0123456789abcdef';

test('direct login body requires a strict 32-hex browser fingerprint', () => {
  const valid = {
    username: '2026000000',
    password: 'secret',
    fingerprint: FINGERPRINT,
    consent: true,
  };
  assert.deepEqual(parseDirectLoginBody(valid), {
    username: valid.username,
    password: valid.password,
    fingerprint: valid.fingerprint,
  });
  for (const fingerprint of [undefined, '', 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32)]) {
    assert.equal(parseDirectLoginBody({ ...valid, fingerprint }), null);
  }
});

async function startServer(
  t,
  broker,
  {
    user = { id: 7 },
    frontendBaseUrl = 'https://free-bbs.example',
    correlationCookieSecure,
    directLoginLimiter,
    allowLoopbackHttp = true,
    trustProxy = false,
    observeRequest,
  } = {},
) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  if (observeRequest) {
    app.use((request, response, next) => {
      observeRequest(request);
      next();
    });
  }
  app.use(
    '/api/workbench/connectors/tsinghua',
    createCampusConnectorRouter({
      broker,
      allowLoopbackHttp,
      frontendBaseUrl,
      correlationCookieSecure,
      directLoginLimiter,
      requireAuth: async (request, response) => {
        if (!user || request.get('authorization') !== 'Bearer test-token') {
          response.status(401).json({ message: '未登录或登录已失效' });
          return null;
        }
        return user;
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/workbench/connectors/tsinghua`;
}

function createBroker(overrides = {}) {
  return {
    async getStatus() {
      return { id: 'tsinghua', configuration: { state: 'not_configured' } };
    },
    async beginAuthorization() {
      throw new CampusConnectorError(
        'tsinghua_authorization_not_configured',
        '校方授权接入尚未配置。',
        { status: 503 },
      );
    },
    async completeAuthorization() {
      return { result: 'connected', returnPath: '/workbench' };
    },
    async connectDirect() {
      return { result: 'connected', connectionStatus: 'active_verified' };
    },
    async disconnect() {
      return undefined;
    },
    async requestSync() {
      return { publicId: 'csr_aaaaaaaaaaaaaaaaaaaaaaaa', status: 'queued' };
    },
    async getSyncRun() {
      return { publicId: 'csr_aaaaaaaaaaaaaaaaaaaaaaaa', status: 'queued' };
    },
    ...overrides,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    redirect: options.redirect,
    method: options.method || 'GET',
    headers: {
      ...(options.auth === false ? {} : { Authorization: 'Bearer test-token' }),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

test('status and authorization start require FREE BBS authentication', async (t) => {
  let statusCalls = 0;
  let startCalls = 0;
  const baseUrl = await startServer(
    t,
    createBroker({
      async getStatus() {
        statusCalls += 1;
        return {};
      },
      async beginAuthorization() {
        startCalls += 1;
        return {};
      },
    }),
  );

  assert.equal((await requestJson(`${baseUrl}/status`, { auth: false })).response.status, 401);
  assert.equal(
    (
      await requestJson(`${baseUrl}/authorization-attempts`, {
        auth: false,
        method: 'POST',
      })
    ).response.status,
    401,
  );
  assert.equal(statusCalls, 0);
  assert.equal(startCalls, 0);
});

test('direct login defaults to HTTPS and authenticates before the transport check', async (t) => {
  let calls = 0;
  const baseUrl = await startServer(
    t,
    createBroker({
      async connectDirect() {
        calls += 1;
      },
    }),
    { allowLoopbackHttp: false },
  );

  const unauthenticated = await fetch(`${baseUrl}/direct-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not-json',
  });
  assert.equal(unauthenticated.status, 401);

  const response = await fetch(`${baseUrl}/direct-login`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'text/plain',
    },
    body: 'not-json',
  });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.code, 'direct_authorization_https_required');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 0);
});

test('explicit local HTTP works and a trusted loopback proxy supplies HTTPS client IP', async (t) => {
  const localBaseUrl = await startServer(t, createBroker(), { allowLoopbackHttp: true });
  const body = {
    username: '2026000000',
    password: 'secret',
    fingerprint: FINGERPRINT,
    consent: true,
  };
  assert.equal(
    (await requestJson(`${localBaseUrl}/direct-login`, { method: 'POST', body })).response.status,
    201,
  );

  let capturedIp = '';
  const proxiedBaseUrl = await startServer(t, createBroker(), {
    allowLoopbackHttp: false,
    trustProxy: 'loopback',
    directLoginLimiter: {
      consume(request) {
        capturedIp = request.ip;
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
  });
  const proxied = await requestJson(`${proxiedBaseUrl}/direct-login`, {
    method: 'POST',
    headers: {
      'X-Forwarded-For': '203.0.113.42',
      'X-Forwarded-Proto': 'https',
    },
    body,
  });
  assert.equal(proxied.response.status, 201);
  assert.equal(capturedIp, '203.0.113.42');
});

test('direct login requires authentication, explicit consent, and a narrow JSON body', async (t) => {
  let received = null;
  const broker = createBroker({
    async connectDirect(input) {
      received = { ...input };
      return { result: 'connected' };
    },
  });
  const baseUrl = await startServer(t, broker);

  const unauthenticated = await requestJson(`${baseUrl}/direct-login`, {
    auth: false,
    method: 'POST',
    body: { username: '2026000000', password: 'secret', fingerprint: FINGERPRINT, consent: true },
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(received, null);

  const noConsent = await requestJson(`${baseUrl}/direct-login`, {
    method: 'POST',
    body: { username: '2026000000', password: 'secret', fingerprint: FINGERPRINT, consent: false },
  });
  assert.equal(noConsent.response.status, 400);
  assert.equal(received, null);

  const extraCredentialField = await requestJson(`${baseUrl}/direct-login`, {
    method: 'POST',
    body: {
      username: '2026000000',
      password: 'secret',
      fingerprint: FINGERPRINT,
      consent: true,
      cookie: 'must-not-be-accepted',
    },
  });
  assert.equal(extraCredentialField.response.status, 400);
  assert.equal(received, null);

  const accepted = await requestJson(`${baseUrl}/direct-login`, {
    method: 'POST',
    body: {
      username: '2026000000',
      password: 'one-time-secret',
      fingerprint: FINGERPRINT,
      consent: true,
    },
  });
  assert.equal(accepted.response.status, 201);
  assert.deepEqual(received, {
    userId: 7,
    username: '2026000000',
    password: 'one-time-secret',
    fingerprint: FINGERPRINT,
  });
  assert.doesNotMatch(JSON.stringify(accepted.payload), /one-time-secret|2026000000/u);
  assert.doesNotMatch(JSON.stringify(accepted.payload), new RegExp(FINGERPRINT, 'iu'));
  assert.equal(accepted.response.headers.get('cache-control'), 'no-store');
});

test('direct login removes every parsed field from a rejected request body', async (t) => {
  let observedRequest = null;
  const baseUrl = await startServer(t, createBroker(), {
    observeRequest(request) {
      observedRequest = request;
    },
  });
  const { response } = await requestJson(`${baseUrl}/direct-login`, {
    method: 'POST',
    body: {
      username: '2026000000',
      password: 'secret',
      fingerprint: FINGERPRINT,
      consent: true,
      cookie: 'must-not-remain',
    },
  });

  assert.equal(response.status, 400);
  assert.ok(observedRequest);
  assert.deepEqual(observedRequest.body, {});
});

test('direct login rejects non-JSON and oversized bodies before broker invocation', async (t) => {
  let calls = 0;
  const baseUrl = await startServer(
    t,
    createBroker({
      async connectDirect() {
        calls += 1;
      },
    }),
  );

  const plain = await fetch(`${baseUrl}/direct-login`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'text/plain',
    },
    body: 'username=2026000000&password=secret',
  });
  assert.equal(plain.status, 415);

  const oversized = await fetch(`${baseUrl}/direct-login`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: '2026000000',
      password: 'x'.repeat(5_000),
      consent: true,
      fingerprint: FINGERPRINT,
    }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test('direct login rate limits by authenticated user and remote address', async (t) => {
  let currentTime = 0;
  const limiter = createDirectLoginRateLimiter({
    now: () => currentTime,
    windowMs: 60_000,
    maxAttempts: 2,
  });
  const baseUrl = await startServer(t, createBroker(), { directLoginLimiter: limiter });
  const options = {
    method: 'POST',
    body: { username: '2026000000', password: 'secret', fingerprint: FINGERPRINT, consent: true },
  };

  assert.equal((await requestJson(`${baseUrl}/direct-login`, options)).response.status, 201);
  assert.equal((await requestJson(`${baseUrl}/direct-login`, options)).response.status, 201);
  const blocked = await requestJson(`${baseUrl}/direct-login`, options);
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.response.headers.get('retry-after'), '60');

  currentTime = 60_001;
  assert.equal((await requestJson(`${baseUrl}/direct-login`, options)).response.status, 201);
});

test('direct login keeps user and shared IP budgets separate', () => {
  const limiter = createDirectLoginRateLimiter({
    now: () => 0,
    windowMs: 60_000,
    maxAttempts: 2,
    maxIpAttempts: 5,
  });
  const request = { ip: '203.0.113.8', socket: { remoteAddress: '127.0.0.1' } };

  assert.equal(limiter.consume(request, 1).allowed, true);
  assert.equal(limiter.consume(request, 1).allowed, true);
  assert.equal(limiter.consume(request, 1).allowed, false);
  assert.equal(limiter.consume(request, 2).allowed, true);
  assert.equal(limiter.consume(request, 2).allowed, true);
  assert.equal(limiter.consume(request, 3).allowed, true);
  assert.equal(limiter.consume(request, 4).allowed, false);
});

test('direct login rate limiter prefers request.ip and falls back to the socket address', () => {
  const requestIpLimiter = createDirectLoginRateLimiter({
    maxAttempts: 1,
    maxIpAttempts: 1,
  });
  assert.equal(
    requestIpLimiter.consume({ ip: '203.0.113.1', socket: { remoteAddress: '127.0.0.1' } }, 1)
      .allowed,
    true,
  );
  assert.equal(
    requestIpLimiter.consume({ ip: '203.0.113.2', socket: { remoteAddress: '127.0.0.1' } }, 2)
      .allowed,
    true,
  );
  assert.equal(
    requestIpLimiter.consume({ ip: '203.0.113.1', socket: { remoteAddress: '127.0.0.2' } }, 3)
      .allowed,
    false,
  );

  const socketLimiter = createDirectLoginRateLimiter({ maxAttempts: 1, maxIpAttempts: 1 });
  assert.equal(socketLimiter.consume({ socket: { remoteAddress: '127.0.0.1' } }, 4).allowed, true);
  assert.equal(socketLimiter.consume({ socket: { remoteAddress: '127.0.0.2' } }, 5).allowed, true);
  assert.equal(socketLimiter.consume({ socket: { remoteAddress: '127.0.0.1' } }, 6).allowed, false);
});

test('unconfigured authorization fails closed without a redirect URL', async (t) => {
  const baseUrl = await startServer(t, createBroker());
  const { response, payload } = await requestJson(`${baseUrl}/authorization-attempts`, {
    method: 'POST',
  });

  assert.equal(response.status, 503);
  assert.equal(payload.code, 'tsinghua_authorization_not_configured');
  assert.equal(response.headers.get('location'), null);
  assert.equal(Object.hasOwn(payload, 'authorizationUrl'), false);
  assert.doesNotMatch(JSON.stringify(payload), /https?:\/\//);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('credential-like request bodies are rejected before broker invocation', async (t) => {
  let calls = 0;
  const baseUrl = await startServer(
    t,
    createBroker({
      async beginAuthorization() {
        calls += 1;
        return {};
      },
    }),
  );
  const { response, payload } = await requestJson(`${baseUrl}/authorization-attempts`, {
    method: 'POST',
    body: { password: 'must-not-be-accepted', cookie: 'session=value' },
  });

  assert.equal(response.status, 400);
  assert.equal(payload.code, 'connector_request_body_not_allowed');
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(payload), /must-not-be-accepted|session=value/);

  const rawResponse = await fetch(`${baseUrl}/authorization-attempts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'text/plain',
    },
    body: 'password=must-not-be-accepted',
  });
  const rawPayload = await rawResponse.json();
  assert.equal(rawResponse.status, 400);
  assert.equal(rawPayload.code, 'connector_request_body_not_allowed');
  assert.equal(calls, 0);
});

test('authorization start stores browser correlation only in an HttpOnly cookie', async (t) => {
  const browserBinding = 'B'.repeat(43);
  const baseUrl = await startServer(
    t,
    createBroker({
      async beginAuthorization() {
        return {
          authorizationUrl: 'https://id.example.test/authorize?state=opaque-state',
          browserBinding,
          expiresAt: '2026-08-02T08:10:00.000Z',
        };
      },
    }),
  );
  const { response, payload } = await requestJson(`${baseUrl}/authorization-attempts`, {
    method: 'POST',
  });
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 201);
  assert.deepEqual(payload, {
    authorizationUrl: 'https://id.example.test/authorize?state=opaque-state',
    expiresAt: '2026-08-02T08:10:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(browserBinding));
  assert.match(setCookie, new RegExp(`^${AUTHORIZATION_CORRELATION_COOKIE}=${browserBinding}`));
  assert.match(setCookie, /; HttpOnly/i);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; SameSite=Lax/i);
  assert.match(setCookie, new RegExp(`; Path=${AUTHORIZATION_CALLBACK_PATH}`));
  assert.doesNotMatch(setCookie, /; Domain=/i);
});

test('local HTTP authorization correlation cookie omits Secure', async (t) => {
  const baseUrl = await startServer(
    t,
    createBroker({
      async beginAuthorization() {
        return {
          authorizationUrl: 'https://id.example.test/authorize?state=opaque-state',
          browserBinding: 'L'.repeat(43),
          expiresAt: '2026-08-02T08:10:00.000Z',
        };
      },
    }),
    { frontendBaseUrl: 'http://127.0.0.1:3000' },
  );
  const { response } = await requestJson(`${baseUrl}/authorization-attempts`, {
    method: 'POST',
  });

  assert.equal(response.status, 201);
  assert.doesNotMatch(response.headers.get('set-cookie'), /; Secure/i);
});

test('public callback passes only approved parameters and redirects to a fixed frontend path', async (t) => {
  let received;
  const baseUrl = await startServer(
    t,
    createBroker({
      async completeAuthorization(input) {
        received = input;
        return { result: 'connected', returnPath: 'https://evil.example/steal' };
      },
    }),
    { user: null },
  );
  const response = await fetch(
    `${baseUrl}/callback?state=state-value&ticket=one-time&password=secret&userId=99`,
    {
      redirect: 'manual',
      headers: { Cookie: `${AUTHORIZATION_CORRELATION_COOKIE}=${'C'.repeat(43)}` },
    },
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'https://free-bbs.example/workbench?connector=tsinghua&result=connected',
  );
  assert.deepEqual(received, {
    state: 'state-value',
    browserBinding: 'C'.repeat(43),
    callbackParams: { ticket: 'one-time' },
  });
  const clearedCookie = response.headers.get('set-cookie');
  assert.match(clearedCookie, new RegExp(`^${AUTHORIZATION_CORRELATION_COOKIE}=`));
  assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
  assert.match(clearedCookie, /; HttpOnly/i);
  assert.match(clearedCookie, /; Secure/i);
  assert.match(clearedCookie, /; SameSite=Lax/i);
});

test('callback errors are reduced to safe result codes and never echoed', async (t) => {
  const baseUrl = await startServer(
    t,
    createBroker({
      async completeAuthorization() {
        throw new Error('upstream ticket and secret detail');
      },
    }),
    { user: null },
  );
  const response = await fetch(`${baseUrl}/callback?state=bad&ticket=top-secret`, {
    redirect: 'manual',
  });
  const location = response.headers.get('location');

  assert.equal(response.status, 303);
  assert.equal(
    location,
    'https://free-bbs.example/workbench?connector=tsinghua&result=authorization_failed',
  );
  assert.doesNotMatch(location, /top-secret|ticket|upstream/);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
});

test('sync runs are user scoped and reject arbitrary target input', async (t) => {
  let syncCalls = 0;
  const baseUrl = await startServer(
    t,
    createBroker({
      async requestSync(userId) {
        syncCalls += 1;
        assert.equal(userId, 7);
        return { publicId: 'csr_aaaaaaaaaaaaaaaaaaaaaaaa', status: 'queued' };
      },
    }),
  );
  const rejected = await requestJson(`${baseUrl}/sync-runs`, {
    method: 'POST',
    body: { targetUrl: 'https://evil.example', authorization: 'Bearer secret' },
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(syncCalls, 0);

  const accepted = await requestJson(`${baseUrl}/sync-runs`, { method: 'POST' });
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.payload.run.status, 'queued');
  assert.equal(syncCalls, 1);
});
