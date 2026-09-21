const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { tourGeometry } = require('../public/max-guide-geometry');

const rect = (x, y, width, height) => ({
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  width,
  height,
});
const intersection = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
function invariant(geometry, viewport, target) {
  const { card, hole, curtains } = geometry;
  for (const box of [card, hole, ...curtains].filter(Boolean)) {
    assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite));
    assert.ok(box.x >= 0 && box.y >= 0 && box.width >= 0 && box.height >= 0);
    assert.ok(box.x + box.width <= viewport.width + 1e-8, JSON.stringify(box));
    assert.ok(box.y + box.height <= viewport.height + 1e-8, JSON.stringify(box));
  }
  const area =
    curtains.reduce((sum, box) => sum + box.width * box.height, 0) +
    (hole ? hole.width * hole.height : 0);
  assert.ok(Math.abs(area - viewport.width * viewport.height) < 1e-5);
  for (let index = 0; index < curtains.length; index += 1) {
    if (hole) assert.equal(intersection(curtains[index], hole), 0);
    for (const other of curtains.slice(index + 1))
      assert.equal(intersection(curtains[index], other), 0);
  }
  if (hole && target) {
    assert.ok(hole.x <= Math.max(0, target.left));
    assert.ok(hole.y <= Math.max(0, target.top));
    assert.ok(hole.x + hole.width >= Math.min(viewport.width, target.right));
    assert.ok(hole.y + hole.height >= Math.min(viewport.height, target.bottom));
    assert.equal(geometry.overlap, intersection(card, hole) > 0);
    if (geometry.layout !== 'overview') {
      assert.equal(geometry.overlap, false);
      const separation = Math.max(
        hole.x - card.x - card.width,
        card.x - hole.x - hole.width,
        hole.y - card.y - card.height,
        card.y - hole.y - hole.height,
      );
      assert.ok(separation >= 18 - 1e-8);
    }
  }
}

test('geometry UMD is usable through CommonJS and the browser global without a DOM', () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/max-guide-geometry.js'), 'utf8'),
    context,
  );
  assert.equal(typeof context.FreeBbsGuideGeometry.tourGeometry, 'function');
  assert.equal(typeof tourGeometry, 'function');
});

test('all four requested placements honor target-center alignment, 18px gap and 16px viewport margin', () => {
  const viewport = { width: 1440, height: 1100 };
  const target = rect(580, 470, 220, 120);
  for (const placement of ['left', 'right', 'top', 'bottom']) {
    const geometry = tourGeometry(target, viewport, { width: 300, height: 240 }, { placement });
    assert.equal(geometry.placement, placement);
    assert.equal(geometry.layout, 'side');
    invariant(geometry, viewport, target);
    assert.ok(geometry.card.x >= 16 && geometry.card.y >= 16);
    const vertical = ['top', 'bottom'].includes(placement);
    assert.equal(
      vertical
        ? geometry.card.x + geometry.card.width / 2
        : geometry.card.y + geometry.card.height / 2,
      vertical ? 690 : 530,
    );
  }
});

test('candidate scoring prefers center alignment and breathing room over the first side near an edge', () => {
  const target = rect(450, 100, 180, 100);
  const viewport = { width: 1000, height: 800 };
  const geometry = tourGeometry(target, viewport, { width: 300, height: 260 });
  assert.equal(geometry.placement, 'bottom');
  assert.equal(geometry.card.x + geometry.card.width / 2, 540);
  assert.ok(geometry.card.x > 16);
  invariant(geometry, viewport, target);
});

test('an unavailable preferred side falls back without overlapping or cropping the target', () => {
  const target = rect(1150, 250, 230, 300);
  const viewport = { width: 1440, height: 900 };
  const geometry = tourGeometry(
    target,
    viewport,
    { width: 430, height: 420 },
    { placement: 'right' },
  );
  assert.equal(geometry.placement, 'left');
  assert.equal(geometry.needsCompact, false);
  invariant(geometry, viewport, target);
});

test('large targets retain their complete visible bounds and request a compact retry', () => {
  const viewport = { width: 390, height: 844 };
  const target = rect(-20, 60, 430, 610);
  const initial = tourGeometry(target, viewport, { width: 470, height: 430 });
  assert.equal(initial.needsCompact, true);
  assert.equal(initial.hole.y, 52);
  assert.equal(initial.hole.height, 626);
  invariant(initial, viewport, target);
  const compact = tourGeometry(target, viewport, { width: 358, height: 100 }, { compact: true });
  assert.equal(compact.layout, 'dock');
  assert.equal(compact.placement, 'bottom');
  assert.equal(compact.needsCompact, false);
  assert.deepEqual(compact.hole, initial.hole);
  invariant(compact, viewport, target);
});

test('even full-viewport targets remain fully illuminated in an explicitly overlapping overview', () => {
  const viewport = { width: 390, height: 844 };
  const target = rect(-50, -40, 550, 1000);
  const geometry = tourGeometry(target, viewport, { width: 358, height: 100 }, { compact: true });
  assert.equal(geometry.layout, 'overview');
  assert.equal(geometry.overlap, true);
  assert.equal(geometry.needsCompact, false);
  assert.equal(geometry.card.y, 728);
  assert.deepEqual(geometry.hole, { x: 0, y: 0, width: 390, height: 844, radius: 16 });
  invariant(geometry, viewport, target);
});

test('compact cards higher than 120px do not trigger a repeated compact request', () => {
  const geometry = tourGeometry(
    rect(0, 0, 390, 844),
    { width: 390, height: 844 },
    { width: 358, height: 155 },
    { compact: true },
  );
  assert.equal(geometry.needsCompact, false);
  assert.equal(geometry.layout, 'overview');
});

test('narrow and landscape resize keeps spotlight content, scroll clipping and curtain coverage intact', () => {
  const viewports = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 480 },
    { width: 812, height: 375 },
    { width: 1, height: 1 },
  ];
  for (const viewport of viewports) {
    const targets = [
      rect(0, 0, viewport.width, viewport.height),
      rect(-30, 70, 1630, 1030),
      rect(14.666, viewport.height - 276.333, viewport.width - 29.332, 174.373),
      rect(viewport.width / 3, viewport.height / 4, 82, 45),
    ];
    for (const target of targets) {
      for (const card of [
        { width: 470, height: 430 },
        { width: 800, height: 100 },
      ])
        invariant(tourGeometry(target, viewport, card), viewport, target);
    }
  }
});

test('offscreen, empty and absent targets produce a centered card and complete curtains', () => {
  const viewport = { width: 390, height: 844 };
  for (const target of [
    null,
    {},
    rect(0, 0, 0, 0),
    rect(400, 50, 20, 20),
    rect(10, -120, 30, 50),
  ]) {
    const geometry = tourGeometry(target, viewport, { width: 350, height: 430 });
    assert.equal(geometry.hole, null);
    assert.equal(geometry.placement, 'center');
    assert.equal(geometry.overlap, false);
    assert.equal(geometry.needsCompact, false);
    invariant(geometry, viewport);
  }
});

test('padding and border radius are configurable and calls never mutate their inputs', () => {
  const target = Object.freeze(rect(200, 200, 50, 40));
  const viewport = Object.freeze({ width: 1200, height: 800 });
  const card = Object.freeze({ width: 400, height: 300 });
  const options = Object.freeze({ padding: 0, radius: 100, placement: 'auto' });
  const geometry = tourGeometry(target, viewport, card, options);
  assert.deepEqual(geometry.hole, { x: 200, y: 200, width: 50, height: 40, radius: 20 });
  invariant(geometry, viewport, target);
});
