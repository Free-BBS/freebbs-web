const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PortalBoundaryProbeError,
  classifyPortalResponse,
  probePortalBoundary,
} = require('./portal-boundary-probe');

test('classifies authentication walls without treating them as scraped content', () => {
  assert.equal(classifyPortalResponse({ status: 403 }), 'auth_required');
  assert.equal(
    classifyPortalResponse({ status: 302, location: 'https://id.tsinghua.edu.cn/cas/login' }),
    'auth_required',
  );
  assert.equal(
    classifyPortalResponse({ status: 200, bodyText: '统一身份认证 登录' }),
    'auth_required',
  );
});

test('portal probe records live evidence and discards response cookies', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('authentication required', {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'set-cookie': 'JSESSIONID=secret; HttpOnly',
      },
    });
  };

  const result = await probePortalBoundary('learn', {
    fetchImpl,
    now: () => new Date('2026-08-01T09:00:00.000Z'),
    useCache: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(result.status, 403);
  assert.equal(result.classification, 'auth_required');
  assert.equal(result.safeguards.cookiesSent, false);
  assert.equal(result.safeguards.responseCookieDiscarded, true);
  assert.doesNotMatch(JSON.stringify(result), /JSESSIONID|secret/);
});

test('portal probe never exposes an arbitrary target URL', async () => {
  await assert.rejects(
    probePortalBoundary('http://127.0.0.1', { fetchImpl: async () => new Response('ok') }),
    (error) => error instanceof PortalBoundaryProbeError && error.code === 'unknown_target',
  );
});
