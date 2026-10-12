const assert = require('node:assert/strict');
const test = require('node:test');
const { createEconomyPreview, TOKEN } = require('./preview-economy');

test('raw economy preview entries load the shared request runtime before authenticated consumers', async (t) => {
  const { server } = createEconomyPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/electromagnetic', '/inventory', '/ranch', '/settings']) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const runtime = html.indexOf('src="/request-runtime.js"');
    assert.equal(html.split('src="/request-runtime.js"').length - 1, 1);
    assert.ok(html.indexOf('src="/typography.js"') < runtime);
    assert.ok(runtime < html.indexOf('src="/app.js"'));
    assert.ok(runtime < html.indexOf('src="/notifications.js"'));
  }
  const runtime = await fetch(`${origin}/request-runtime.js`);
  assert.equal(runtime.status, 200);
  assert.match(await runtime.text(), /function requestRuntime/);
  const headers = { Authorization: `Bearer ${TOKEN}` };
  assert.equal(
    (await (await fetch(`${origin}/api/auth/me`, { headers })).json()).user.uid,
    'u_preview01',
  );
  assert.ok(
    (await (await fetch(`${origin}/api/electromagnetic`, { headers })).json()).shopItems.length > 0,
  );
});
