const assert = require('node:assert/strict');
const test = require('node:test');

const { checkDevelopmentAccess } = require('../public/development-entry');

test('development construction page redirects only after the server accepts the bearer token', async () => {
  const navigations = [];
  const statuses = [];
  let request;
  assert.equal(
    await checkDevelopmentAccess({
      token: ' token ',
      fetchImplementation: async (url, options) => {
        request = { url, options };
        return { ok: true };
      },
      navigate: (url) => navigations.push(url),
      reportStatus: (status) => statuses.push(status),
    }),
    true,
  );
  assert.equal(request.url, '/api/development/v1/me');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
  assert.deepEqual(navigations, ['/development/']);
  assert.deepEqual(statuses, ['checking']);
});

test('denied development access stays silently on the construction page', async () => {
  const statuses = [];
  const result = await checkDevelopmentAccess({
    token: 'token',
    fetchImplementation: async () => ({ ok: false, status: 403 }),
    navigate: () => assert.fail('must not navigate'),
    reportStatus: (status) => statuses.push(status),
  });

  assert.equal(result, false);
  assert.deepEqual(statuses, ['checking', 'denied']);
});

test('service and network failures report an unavailable state without navigating', async () => {
  for (const response of [{ ok: false, status: 503 }, new Error('offline')]) {
    const navigations = [];
    const statuses = [];
    const result = await checkDevelopmentAccess({
      token: 'token',
      fetchImplementation: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
      navigate: (url) => navigations.push(url),
      reportStatus: (status) => statuses.push(status),
    });
    assert.equal(result, false);
    assert.deepEqual(navigations, []);
    assert.deepEqual(statuses, ['checking', 'unavailable']);
  }
});
