const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const publicDir = path.join(__dirname, '../public');
const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/shop-items.json')));

test('every enabled item has its own bounded transparent cartoon asset', async () => {
  const items = catalog.items.filter((item) => item.enabled !== false);
  const files = new Set();
  let totalBytes = 0;
  for (const item of items) {
    assert.equal(item.image, `/assets/shop/max-cartoon-v1/${item.key}.webp`);
    assert.ok(!files.has(item.image), `${item.key}: must have its own illustration`);
    files.add(item.image);
    const file = path.join(publicDir, item.image);
    const bytes = fs.statSync(file).size;
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.hasAlpha, true);
    const stats = await sharp(file).stats();
    assert.equal(stats.channels[3].min, 0, `${item.key}: preserve transparent edges`);
    assert.ok(bytes < 160 * 1024, `${item.key}: oversized thumbnail`);
    totalBytes += bytes;
  }
  assert.ok(totalBytes < 2 * 1024 * 1024, 'entire illustrated catalog must stay below 2 MiB');
});

test('old vector assets remain available; new images load lazily without changing item actions', () => {
  for (const name of ['max-sheep', 'fish', 'rubber-rod', 'battery', 'frame_orbit', 'laser']) {
    assert.ok(fs.existsSync(path.join(publicDir, `assets/icons/${name}.svg`)));
  }
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const image = app.slice(
    app.indexOf('function renderShopItemMedia('),
    app.indexOf('function ensureShopInspectModal('),
  );
  assert.match(image, /loading="lazy"/);
  assert.match(image, /decoding="async"/);
  assert.match(image, /width="512" height="512"/);
  assert.match(app, /data-action="inspect-item"/);
  assert.match(app, /<div class="shop-item-image">\s*\$\{renderShopItemMedia\(item\)\}/);
});
