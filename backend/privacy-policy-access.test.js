const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPrivacyPolicyAccess } = require('./privacy-policy-access');

test('unaccepted and stale sessions cannot reach uploads, optional auth writes or model routes', async (t) => {
  let accepted = false;
  let unavailable = false;
  let processing = 0;
  let accountLookups = 0;
  const app = express();
  app.use(
    createPrivacyPolicyAccess({
      verifyToken: (token) => (token === 'session' ? { sub: 7 } : null),
      getUserById: async (id) => {
        accountLookups += 1;
        return { id };
      },
      requireAccepted: async () => {
        if (unavailable) throw new Error('private database failure');
        if (!accepted)
          throw Object.assign(new Error('请确认隐私政策'), {
            status: 428,
            code: 'privacy_policy_required',
          });
        return { accepted: true, version: 'test-policy' };
      },
    }),
  );
  const processed = (_request, response) => {
    processing += 1;
    response.json({ ok: true });
  };
  for (const url of [
    '/api/ai/chat',
    '/api/ai/files/parse',
    '/api/surveys/1/entries',
    '/api/development/v1/uploads',
  ])
    app.post(url, processed);
  app.get('/api/privacy-policy/status', (_request, response) => response.json({ accepted }));
  app.get('/api/auth/me', (_request, response) => response.json({ id: 7 }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer session' };
  for (const url of [
    '/api/ai/chat',
    '/api/ai/files/parse',
    '/api/surveys/1/entries',
    '/API/surveys/1/entries',
    '/api/development/v1/uploads',
  ]) {
    const response = await fetch(base + url, { method: 'POST', headers });
    assert.equal(response.status, 428);
    assert.equal((await response.json()).code, 'privacy_policy_required');
  }
  assert.equal(processing, 0);
  assert.equal(accountLookups, 5);
  for (const url of ['/api/privacy-policy/status', '/api/auth/me'])
    assert.equal((await fetch(`${base}${url}`, { headers })).status, 200);
  accepted = true;
  assert.equal((await fetch(`${base}/api/ai/chat`, { method: 'POST', headers })).status, 200);
  assert.equal(processing, 1);
  assert.equal(accountLookups, 5, 'accepted requests do not add an account query');
  unavailable = true;
  const response = await fetch(`${base}/api/ai/files/parse`, { method: 'POST', headers });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database failure/);
  assert.equal(processing, 1);
  assert.equal(accountLookups, 5, 'privacy storage failure does not query the account');
});

test('a valid token for a deleted user returns 401 without prompting for policy consent', async () => {
  let processed = false;
  let lookedUp;
  const response = {
    set(name, value) {
      this.headers = { [name]: value };
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  const middleware = createPrivacyPolicyAccess({
    verifyToken: () => ({ sub: 999 }),
    requireAccepted: async () => {
      throw Object.assign(new Error('请确认隐私政策'), {
        status: 428,
        code: 'privacy_policy_required',
      });
    },
    getUserById: async (id) => {
      lookedUp = id;
      return null;
    },
  });
  await middleware(
    { path: '/api/circuits', headers: { authorization: 'Bearer deleted-user' } },
    response,
    () => {
      processed = true;
    },
  );
  assert.equal(lookedUp, 999);
  assert.equal(processed, false);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: '用户不存在' });
  assert.deepEqual(response.headers, { 'Cache-Control': 'no-store' });
});

test('account lookup errors remain unavailable without exposing database details', async () => {
  let processed = false;
  const response = {
    set() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  const middleware = createPrivacyPolicyAccess({
    verifyToken: () => ({ sub: 7 }),
    requireAccepted: async () => {
      throw Object.assign(new Error('请确认隐私政策'), {
        status: 428,
        code: 'privacy_policy_required',
      });
    },
    getUserById: async () => {
      throw new Error('database-secret-user-password');
    },
  });
  await middleware(
    { path: '/api/ai/chat', headers: { authorization: 'Bearer session' } },
    response,
    () => {
      processed = true;
    },
  );
  assert.equal(processed, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'privacy_policy_unavailable');
  assert.doesNotMatch(JSON.stringify(response.body), /database-secret/);
});
