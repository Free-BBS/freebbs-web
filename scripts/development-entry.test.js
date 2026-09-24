const assert = require('node:assert/strict');
const test = require('node:test');

const { checkDevelopmentAccess } = require('../public/development-entry');

test('development construction page redirects only after the server accepts the bearer token', async () => {
  const navigations = [];
  let request;
  assert.equal(
    await checkDevelopmentAccess({
      token: ' token ',
      fetchImplementation: async (url, options) => {
        request = { url, options };
        return { ok: true };
      },
      navigate: (url) => navigations.push(url),
    }),
    true,
  );
  assert.equal(request.url, '/api/development/v1/me');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
  assert.deepEqual(navigations, ['/development/']);
});

test('missing, denied and unavailable development access stay on the construction page', async () => {
  for (const response of [{ ok: false }, new Error('offline')]) {
    const navigations = [];
    const result = await checkDevelopmentAccess({
      token: 'token',
      fetchImplementation: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
      navigate: (url) => navigations.push(url),
    });
    assert.equal(result, false);
    assert.deepEqual(navigations, []);
  }
});
