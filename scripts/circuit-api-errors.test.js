const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const start = source.indexOf('async function callApi(');
const end = source.indexOf('\n}', start) + 2;
function api(response) {
  const context = {
    API_BASE_URL: 'https://example.test/api',
    userState: { token: 'test-token' },
    fetch: async () => response,
  };
  vm.runInNewContext(source.slice(start, end), context);
  return context.callApi;
}

test('a proxy HTML 504 produces a readable timeout with its HTTP status', async () => {
  const call = api({
    ok: false,
    status: 504,
    json: async () => {
      throw Error('HTML');
    },
  });
  await assert.rejects(
    call('/ai/circuit/chat'),
    (error) => error.status === 504 && /超时/.test(error.message),
  );
});

test('circuit keepalive responses propagate late JSON errors despite committed HTTP 200', async () => {
  const call = api({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      status: 504,
      message: '电路助手等待超时',
      detail: '请重试',
      code: 'circuit_assistant_timeout',
    }),
  });
  await assert.rejects(
    call('/ai/circuit/chat'),
    (error) =>
      error.status === 504 &&
      error.code === 'circuit_assistant_timeout' &&
      error.message === '电路助手等待超时：请重试',
  );
});

test('successful circuit responses and unrelated payloads remain compatible', async () => {
  const data = { answer: '已完成', actions: [], done: true };
  assert.deepEqual(
    await api({ ok: true, status: 200, json: async () => data })('/ai/circuit/chat'),
    data,
  );
  const other = { ok: false };
  assert.deepEqual(await api({ ok: true, status: 200, json: async () => other })('/other'), other);
});

test('backend validation messages remain actionable and no HTML body is echoed', async () => {
  const call = api({
    ok: false,
    status: 400,
    json: async () => ({ message: '所选元件已不存在', code: 'invalid_circuit_assistant_input' }),
  });
  await assert.rejects(
    call('/ai/circuit/chat'),
    (error) =>
      error.message === '所选元件已不存在' && error.code === 'invalid_circuit_assistant_input',
  );
});
