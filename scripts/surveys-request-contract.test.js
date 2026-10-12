const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const runtime = require('../public/request-runtime');

function harness(fetcher, { blocked = false, storedToken = 'saved-token', timeoutMs = 1000 } = {}) {
  const requests = [];
  const context = {
    window: {
      freeBbsApp: { userState: { token: 'active-token' } },
      freeBbsRequests: {
        request: (url, options, consume) => {
          requests.push({ url, options });
          return runtime.request(url, { ...options, timeoutMs }, consume, fetcher);
        },
      },
    },
    localStorage: {
      getItem() {
        if (blocked) throw new Error('Storage blocked');
        return storedToken;
      },
    },
    setTimeout,
  };
  vm.runInNewContext(fs.readFileSync('public/surveys-common.js', 'utf8'), context);
  return { api: context.window.SurveyUI.api, requests };
}

test('survey reads and writes use the common finite deadline, with no automatic write retry', async () => {
  let calls = 0;
  const { api, requests } = harness(async () => {
    calls += 1;
    return { ok: true, json: async () => ({ saved: true }) };
  });
  assert.deepEqual(await api('/surveys'), { saved: true });
  await api('/surveys/a/register', 'POST', { choice: 'one' });
  assert.equal(calls, 2);
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer saved-token');
  assert.equal(requests[1].options.body, '{"choice":"one"}');
});

test('blocked storage does not prevent an active in-memory survey session', async () => {
  const { api, requests } = harness(
    async () => ({ ok: true, json: async () => ({ surveys: [] }) }),
    { blocked: true },
  );
  await api('/surveys');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer active-token');
});

test('a cleared readable token remains anonymous even when the old in-memory session is present', async () => {
  const { api, requests } = harness(
    async () => ({ ok: true, json: async () => ({ saved: true }) }),
    { storedToken: null },
  );
  await api('/surveys');
  await api('/surveys/a/entries', 'POST', { contact: 'synthetic' });
  assert.equal(requests.length, 2);
  for (const { options } of requests) assert.equal(options.headers.Authorization, undefined);
  assert.equal(requests[1].options.method, 'POST');
});

test('stalled response consumption ends with a visible timeout instead of a permanent wait', async () => {
  let calls = 0;
  const { api } = harness(
    async () => {
      calls += 1;
      return { ok: true, json: () => new Promise(() => {}) };
    },
    { timeoutMs: 15 },
  );
  await assert.rejects(api('/surveys/a/register', 'POST', {}), { name: 'TimeoutError' });
  assert.equal(calls, 1);
});

test('HTTP failures retain their status and never become a successful empty collection', async () => {
  const { api } = harness(async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: '无权限' }),
  }));
  await assert.rejects(
    api('/surveys'),
    (error) => error.status === 403 && error.message === '无权限',
  );
});
