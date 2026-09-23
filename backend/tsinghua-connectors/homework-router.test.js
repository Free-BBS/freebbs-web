const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHomeworkRouter } = require('./homework-router');

async function serverFor(t, overrides = {}) {
  const app = express();
  const calls = [];
  const service = {
    list: async (...args) => {
      calls.push(args);
      return { items: [] };
    },
    getDetail: async () => ({ title: 'fixture' }),
    download: async () => ({
      attachment: { name: '题目.pdf' },
      response: new Response('PDF fixture', { headers: { 'Content-Type': 'application/pdf' } }),
    }),
    ...overrides,
  };
  app.use(
    '/homework',
    createHomeworkRouter({
      service,
      frontendBaseUrl: 'https://free-bbs.example',
      requireAuth: async (request, response) => {
        if (request.headers.authorization === 'Bearer fixture') return { id: 7 };
        response.status(401).json({ message: 'login required' });
        return null;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return {
    base: `http://127.0.0.1:${server.address().port}/homework/semesters/2026-2027-1`,
    calls,
  };
}
const headers = { Authorization: 'Bearer fixture', Origin: 'https://free-bbs.example' };

test('requires auth and rejects untrusted browser origins before processing a multipart upload', async (t) => {
  const f = await serverFor(t);
  assert.equal((await fetch(f.base)).status, 401);
  assert.equal(
    (await fetch(f.base, { headers: { ...headers, Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${f.base}/items/ref/submissions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture' },
        body: 'bad',
      })
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  const response = await fetch(f.base, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.calls[0], [7, '2026-2027-1']);
});

test('rejects every old submission route even with a valid session and origin', async (t) => {
  const f = await serverFor(t);
  for (const suffix of ['/submissions', '/submissions/old/reviewed']) {
    const response = await fetch(`${f.base}/items/ref${suffix}`, {
      method: 'POST',
      headers,
      body: 'answer',
    });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).code, 'homework_read_only');
  }
  assert.equal(f.calls.length, 0);
});

test('attachment downloads are forced to files and login HTML is rejected', async (t) => {
  const f = await serverFor(t);
  const response = await fetch(`${f.base}/items/ref/attachments/file`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition'), /attachment;/);
  assert.equal(await response.text(), 'PDF fixture');
  const bad = await serverFor(t, {
    download: async () => ({
      attachment: { name: 'file.pdf' },
      response: new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
    }),
  });
  assert.equal((await fetch(`${bad.base}/items/ref/attachments/file`, { headers })).status, 502);
});
