const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const requests = require('../public/request-runtime');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const start = source.indexOf('async function callApi(');
const end = source.indexOf('\n}', start) + 2;
function api(response, globals = {}) {
  const context = {
    API_BASE_URL: 'https://example.test/api',
    userState: { token: 'test-token' },
    fetch: async () => response,
    ...globals,
    window: { ...globals.window, freeBbsRequests: requests },
  };
  context.window.freeBbsRequests = {
    request: (url, options, consume) => requests.request(url, options, consume, context.fetch),
  };
  vm.runInNewContext(source.slice(start, end), context);
  return context.callApi;
}

test('optional browser laser integration preserves successful responses with or without the component', async () => {
  const data = { answer: 'done' };
  const response = { ok: true, status: 200, json: async () => data };
  assert.deepEqual(await api(response, { window: {} })('/other'), data);
  const seen = [];
  assert.deepEqual(
    await api(response, {
      window: { FreeBbsPostLaser: { sync: (payload) => seen.push(payload) } },
    })('/other'),
    data,
  );
  assert.deepEqual(seen, [data]);
});

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

test('image recognition propagates an error after JSON heartbeat headers', async () => {
  const call = api({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      status: 422,
      message: '未在图片中识别到电路',
      code: 'circuit_not_recognized',
    }),
  });
  await assert.rejects(
    call('/ai/circuit/recognize'),
    (error) =>
      error.status === 422 &&
      error.code === 'circuit_not_recognized' &&
      error.message === '未在图片中识别到电路',
  );
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

test('campus verification errors retain only the declared kind and fixed diagnostic indicators', async () => {
  const indicators = [
    'visible_image_captcha_container',
    'visible_image_captcha_input',
    'visible_interactive_prompt',
    'visible_otp_input',
    'visible_verification_prompt',
  ];
  for (const kind of ['image_captcha', 'interactive', 'unclassified']) {
    const call = api({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'cas_interactive_verification_required',
        stage: 'credential_submit',
        verification: {
          kind,
          indicators: [
            'https://untrusted.example/?otp=123456',
            ...indicators,
            indicators[0],
            '<input value="secret">',
            { value: 'secret-password' },
            null,
          ],
          inputValue: 'secret-password',
          html: '<input value="123456">',
          url: 'https://untrusted.example/',
        },
      }),
    });
    await assert.rejects(call('/workbench/connectors/tsinghua/direct-login'), (error) => {
      assert.equal(error.code, 'cas_interactive_verification_required');
      assert.equal(error.stage, 'credential_submit');
      assert.deepEqual(JSON.parse(JSON.stringify(error.verification)), { kind, indicators });
      assert.doesNotMatch(JSON.stringify(error.verification), /secret|123456|https:|<input/);
      return true;
    });
  }
});

test('missing or unknown verification kinds remain unclassified without inferring MFA or captcha', async () => {
  for (const verification of [
    undefined,
    null,
    'image_captcha',
    { kind: 'sms_otp', indicators: 'visible_otp_input' },
    { kind: '<input value="secret">', indicators: ['visible_otp_input'] },
  ]) {
    const call = api({
      ok: false,
      status: 409,
      json: async () => ({ code: 'interactive_verification_required', verification }),
    });
    await assert.rejects(call('/workbench/connectors/tsinghua/direct-login'), (error) => {
      assert.equal(error.verification.kind, 'unclassified');
      const expected = Array.isArray(verification?.indicators) ? ['visible_otp_input'] : [];
      assert.deepEqual([...error.verification.indicators], expected);
      return true;
    });
  }
});

test('unrelated API failures do not acquire a verification classification from arbitrary payload fields', async () => {
  const call = api({
    ok: false,
    status: 503,
    json: async () => ({
      code: 'cas_network_error',
      verification: { kind: 'interactive', indicators: ['visible_otp_input'] },
    }),
  });
  await assert.rejects(call('/workbench/connectors/tsinghua/direct-login'), (error) => {
    assert.equal(error.verification, undefined);
    assert.equal(error.code, 'cas_network_error');
    return true;
  });
});
