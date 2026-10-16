const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Script } = require('node:vm');

const source = readFileSync(
  resolve(
    __dirname,
    '../development/apps/web/public/organization-showcase/sites/creative/gallery-layout.js',
  ),
  'utf8',
);
const sandbox = { module: { exports: undefined } };
new Script(source).runInNewContext(sandbox);
const arrange = sandbox.module.exports;

function checkLayout(ratios, width) {
  const result = arrange(ratios, width);
  assert.equal(result.items.length, ratios.length);
  let previous;
  for (const [index, item] of result.items.entries()) {
    const ratio = Number.isFinite(ratios[index]) && ratios[index] > 0 ? ratios[index] : 1;
    assert.ok(Object.values(item).every(Number.isFinite));
    assert.ok(item.width > 0 && item.height > 0);
    assert.ok(item.x >= -1e-7 && item.y >= 0);
    assert.ok(item.x + item.width <= width + 1e-7);
    assert.ok(item.y + item.height <= result.height + 1e-7);
    assert.ok(item.height <= (width <= 520 ? 320 : 360));
    assert.ok(Math.abs(item.width / item.height - ratio) < 1e-7);
    assert.equal(item.angle, 0);
    if (previous) {
      assert.ok(item.y >= previous.y);
      if (Math.abs(item.y - previous.y) < 1e-7) {
        assert.equal(item.height, previous.height);
        assert.ok(item.x >= previous.x + previous.width - 1e-7);
      } else assert.ok(item.y >= previous.y + previous.height - 1e-7);
    }
    previous = item;
  }
  return result;
}

test('mixed portrait, landscape and banner artwork stays complete and aligned in original order', () => {
  for (const width of [120, 278, 390, 520, 521, 768, 1200]) {
    checkLayout([0.65, 16 / 9, 1, 4.2, 0.7, 1.5, 0.7], width);
  }
});

test('a final portrait is centered without being stretched into an oversized image', () => {
  for (const width of [320, 768, 1200]) {
    const { items } = checkLayout([0.65], width);
    assert.ok(Math.abs(items[0].x - (width - items[0].width) / 2) < 1e-7);
  }
  assert.equal(arrange([], 390).items.length, 0);
  checkLayout([0, NaN, Infinity, -1], 390);
});

test('varied artwork sets never overlap or escape narrow and wide galleries', () => {
  let seed = 0x74ecba2;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let count = 0; count < 500; count++) {
    const ratios = Array.from({ length: Math.floor(random() * 60) }, () =>
      Math.exp(-2 + random() * 4),
    );
    checkLayout(ratios, 120 + random() * 1500);
  }
});
