const assert = require('node:assert/strict');
const test = require('node:test');
const { zoomAt } = require('../public/circuit-viewport');

test('zoom preserves the point under the cursor and round trips without moving the diagram', () => {
  const view = [80, 40, 1000, 640];
  const point = { x: 300, y: 220 };
  const next = zoomAt(view, 2, point);
  assert.equal((point.x - next[0]) / next[2], (point.x - view[0]) / view[2]);
  assert.equal((point.y - next[1]) / next[3], (point.y - view[1]) / view[3]);
  assert.deepEqual(zoomAt(next, 0.5, point), view);
});

test('zoom clamps to 25–400% and retains the canvas aspect ratio', () => {
  for (const [factor, width] of [
    [0.001, 4000],
    [1000, 250],
  ]) {
    const next = zoomAt([0, 0, 1000, 640], factor, { x: 500, y: 320 });
    assert.equal(next[2], width);
    assert.equal(next[3] / next[2], 0.64);
    assert.deepEqual(zoomAt(next, factor, { x: 500, y: 320 }), next);
  }
});
