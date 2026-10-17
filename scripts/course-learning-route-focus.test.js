const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { focusVisibilityDelta } = require('../public/course-learning-route');

test('keyboard nearest scrolling clears fixed bars without changing already visible cards', () => {
  assert.equal(focusVisibilityDelta({ top: 277.25, bottom: 479.25 }, 120, 689), 0);
  assert.equal(focusVisibilityDelta({ top: 509.25, bottom: 715.25 }, 120, 689), 26.25);
  assert.equal(focusVisibilityDelta({ top: 509.21875, bottom: 763.21875 }, 120, 689), 74.21875);
  assert.equal(focusVisibilityDelta({ top: 80, bottom: 300 }, 120, 689), -40);
});

test('a card taller than the safe region keeps its readable intersection instead of oscillating', () => {
  assert.equal(focusVisibilityDelta({ top: 80, bottom: 900 }, 120, 689), 0);
  assert.equal(focusVisibilityDelta({ top: 200, bottom: 1000 }, 120, 689), 80);
  assert.equal(focusVisibilityDelta({ top: -600, bottom: 100 }, 120, 689), -589);
});

test('invalid geometry is a no-op and the caller rectangle is never mutated', () => {
  const rect = Object.freeze({ top: 600, bottom: 800 });
  assert.equal(focusVisibilityDelta(rect, 120, 689), 111);
  assert.deepEqual(rect, { top: 600, bottom: 800 });
  for (const value of [
    null,
    {},
    { top: NaN, bottom: 500 },
    { top: 500, bottom: Infinity },
    { top: 500, bottom: 200 },
  ])
    assert.equal(focusVisibilityDelta(value, 120, 689), 0);
  for (const [top, bottom] of [
    [120, 120],
    [700, 120],
    [NaN, 689],
    [120, Infinity],
  ])
    assert.equal(focusVisibilityDelta(rect, top, bottom), 0);
});

test('focus adjustment is scoped to keyboard-visible phone nodes, after native focus, and cleans up', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/course-learning-route.js'),
    'utf8',
  );
  assert.match(source, /entry\.matches\?\.\('\.course-route-node:focus-visible'\)/);
  assert.match(source, /max-width: 900px/);
  assert.match(source, /root\.requestAnimationFrame\?\.\(/);
  assert.match(source, /document\.activeElement !== entry/);
  assert.match(source, /root\.scrollBy\?\.\(\{ top: delta, behavior: 'instant' \}\)/);
  assert.match(source, /container\.removeEventListener\?\.\('focusin', keepKeyboardFocusVisible\)/);
  assert.doesNotMatch(source, /addEventListener\([^\n]*pointerdown/);
});
