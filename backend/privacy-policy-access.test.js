const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPrivacyPolicyAccess } = require('./privacy-policy-access');

test('unaccepted and stale sessions cannot reach uploads, optional auth writes or model routes', async (t) => {
  let accepted = false;
  let unavailable = false;
  let processing = 0;
  const app = express();
  app.use(
    createPrivacyPolicyAccess({
      verifyToken: (token) => (token === 'session' ? { sub: 7 } : null),
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
  for (const url of ['/api/privacy-policy/status', '/api/auth/me'])
    assert.equal((await fetch(`${base}${url}`, { headers })).status, 200);
  accepted = true;
  assert.equal((await fetch(`${base}/api/ai/chat`, { method: 'POST', headers })).status, 200);
  assert.equal(processing, 1);
  unavailable = true;
  const response = await fetch(`${base}/api/ai/files/parse`, { method: 'POST', headers });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database failure/);
  assert.equal(processing, 1);
});
