const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { mountModerationSettingsRoutes } = require('./moderation-settings-router');

async function fixture(t) {
  const calls = [];
  const settings = {
    baseUrl: 'https://cloud.infini-ai.com/maas/v1',
    textModel: 'qwen3.6-27b',
    imageModel: 'kimi-k2.6',
    configured: true,
    lastFour: '1234',
    revision: 3,
    apiKey: 'never-return-this-secret',
  };
  const app = express();
  app.use(express.json());
  mountModerationSettingsRoutes(app, {
    requireAdmin: async (request, response) => {
      if (request.headers['x-test-role'] === 'admin') return { id: 7 };
      response.status(403).json({ message: '管理员权限不足' });
      return null;
    },
    store: {
      readSettings: async () => {
        calls.push('read');
        return settings;
      },
      updateSettings: async (update) => {
        calls.push(update);
        return settings;
      },
      deleteApiKey: async () => {
        calls.push('delete');
        return { ...settings, configured: false, lastFour: '' };
      },
    },
    sendError: (response, error) =>
      response.status(error.status || 500).json({ message: error.message }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.on('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/api/admin/system-settings/moderation`;
  const request = (method, body, suffix = '', admin = true) =>
    fetch(`${url}${suffix}`, {
      method,
      headers: { 'content-type': 'application/json', ...(admin ? { 'x-test-role': 'admin' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { request, calls };
}

test('every moderation settings operation requires an administrator', async (t) => {
  const { request, calls } = await fixture(t);
  for (const [method, suffix] of [
    ['GET', ''],
    ['PATCH', ''],
    ['DELETE', '/api-key'],
  ]) {
    const response = await request(
      method,
      method === 'PATCH' ? { apiKey: 'new-key' } : undefined,
      suffix,
      false,
    );
    assert.equal(response.status, 403);
  }
  assert.deepEqual(calls, []);
});

test('read, replace, and delete return only non-secret metadata', async (t) => {
  const { request, calls } = await fixture(t);
  for (const [method, body, suffix] of [
    ['GET', undefined, ''],
    ['PATCH', { apiKey: 'new-key', textModel: 'new-model' }, ''],
    ['DELETE', undefined, '/api-key'],
  ]) {
    const response = await request(method, body, suffix);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.ok(!text.includes('never-return-this-secret'));
    assert.ok(!Object.hasOwn(JSON.parse(text), 'apiKey'));
  }
  assert.deepEqual(calls, [
    'read',
    { apiKey: 'new-key', textModel: 'new-model', actorId: 7 },
    'delete',
  ]);
});

test('does not accept actor spoofing, enable switches, or unknown settings', async (t) => {
  const { request, calls } = await fixture(t);
  for (const body of [{ actorId: 99, apiKey: 'key' }, { enabled: true }, { model: 'MAX' }, {}, []])
    assert.equal((await request('PATCH', body)).status, 400);
  assert.deepEqual(calls, []);
});
