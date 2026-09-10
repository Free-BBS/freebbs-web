const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { createPreviewServer, patchAppForPreview, prepareHtml } = require('./preview-shop-settings');

test('preview rewrites only the in-memory API initializer and fails closed after contract changes', () => {
  const file = path.join(__dirname, '../public/app.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchAppForPreview(source);
  assert.ok(patched.startsWith("const API_BASE_URL = '/api';"));
  assert.equal(
    patched.slice(patched.indexOf('const API_ROOT')),
    source.slice(source.indexOf('const API_ROOT')),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.throws(() => patchAppForPreview('const API_BASE_URL = unknown;'));
});

test('preview HTML removes external font links and confines the mock bootstrap to port 3106', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
  const html = prepareHtml(source);
  assert.doesNotMatch(html, /<link\b[^>]*href=["']https?:\/\//i);
  assert.match(html, /window.location.port !== '3106'/);
  assert.match(html, /qa-only-3106-not-a-real-token/);
  assert.match(html, /src="\/__qa\/panel.js"/);
});

test('isolated preview serves mock APIs and processes avatars only in memory', async (t) => {
  const server = createPreviewServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (route, page = '/settings') =>
    fetch(`${origin}${route}`, {
      headers: { Referer: `http://127.0.0.1:3106${page}` },
    });

  await t.test(
    'actual settings and controller are local with a self-only connection policy',
    async () => {
      const response = await get('/settings');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.match(await response.text(), /id="settings-avatar-input"/);
      assert.ok((await (await get('/app.js')).text()).startsWith("const API_BASE_URL = '/api';"));
      assert.equal((await (await get('/api/auth/me')).json()).user.uid, 'QA-LOCAL-ONLY');
    },
  );

  await t.test(
    'world uses its actual page and controller with the same isolated API boundary',
    async () => {
      const response = await get('/world', '/world');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
      const html = await response.text();
      assert.match(html, /<script src="\/world.js"><\/script>/);
      assert.match(html, /qa-only-3106-not-a-real-token/);
      assert.doesNotMatch(html, /<link\b[^>]*href=["']https?:\/\//i);
      assert.ok(
        (await (await get('/app.js', '/world')).text()).startsWith("const API_BASE_URL = '/api';"),
      );
      assert.equal((await (await get('/api/auth/me', '/world')).json()).user.uid, 'QA-LOCAL-ONLY');
      assert.equal((await get('/world.js', '/world')).status, 200);
    },
  );

  await t.test(
    'empty inventory and long product data are deterministic mock variants',
    async () => {
      assert.deepEqual(
        (await (await get('/api/electromagnetic', '/inventory?case=empty')).json()).assets,
        [],
      );
      const catalog = await (
        await get('/data/shop-items.json', '/electromagnetic?case=long')
      ).json();
      const longItem = catalog.items.find((item) => item.key === 'qa_long_item');
      assert.ok(longItem.name.length > 20);
      assert.ok(longItem.desc.length > 200);
    },
  );

  await t.test('unmocked writes and protected paths are refused', async () => {
    const denied = await fetch(`${origin}/api/electromagnetic/convert`, { method: 'POST' });
    assert.equal(denied.status, 405);
    assert.equal((await get('/api/admin/users')).status, 404);
    assert.equal((await get('/backend/.env')).status >= 400, true);
    assert.equal((await get('/assets/%2e%2e%2f%2e%2e%2fpackage.json')).status >= 400, true);
  });

  await t.test(
    'one simulated failure can be retried through real pure image normalization',
    async () => {
      const input = await sharp({
        create: { width: 640, height: 480, channels: 3, background: '#073642' },
      })
        .png()
        .toBuffer();
      const sendAvatar = () =>
        fetch(`${origin}/api/profile/avatar`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer qa-only-3106-not-a-real-token',
            'Content-Type': 'application/json',
            Referer: 'http://127.0.0.1:3106/settings?upload=fail-once&run=automated-test',
          },
          body: JSON.stringify({
            imageDataUrl: `data:image/png;base64,${input.toString('base64')}`,
          }),
        });
      assert.equal((await sendAvatar()).status, 503);
      const success = await sendAvatar();
      assert.equal(success.status, 200);
      const payload = await success.json();
      assert.match(payload.user.avatarPath, /^data:image\/webp;base64,/);
      const output = Buffer.from(payload.user.avatarPath.split(',')[1], 'base64');
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, 'webp');
      assert.ok(metadata.width <= 512 && metadata.height <= 512);
      const state = await (await get('/__qa/state')).json();
      assert.equal(state.avatarRequests, 2);
      assert.equal(state.avatarSuccesses, 1);
      assert.equal(state.deniedWrites, 1);
    },
  );
});
