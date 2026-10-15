const test = require('node:test');
const assert = require('node:assert/strict');
const { createContrastMath } = require('./fixtures/learning-contrast');

const math = createContrastMath();

test('WCAG sRGB contrast is unrounded and uses the ordinary versus large-text thresholds', () => {
  assert.equal(math.ratio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(math.ratio([255, 255, 255], [255, 255, 255]), 1);
  assert.equal(math.threshold(23.99, 400), 4.5);
  assert.equal(math.threshold(24, 400), 3);
  assert.equal(math.threshold(18.67, 600), 4.5);
  assert.equal(math.threshold((14 * 96) / 72, 700), 3);
});

test('RGB, transparent and explicit sRGB alpha parsing never guesses unsupported gradient colors', () => {
  assert.deepEqual(math.parseColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
  assert.deepEqual(math.parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepEqual(math.parseColor('color(srgb 0 0.5 1 / 0.2)'), [0, 127.5, 255, 0.2]);
  assert.deepEqual(math.parseColor('transparent'), [0, 0, 0, 0]);
  assert.equal(math.parseColor('linear-gradient(white, black)'), null);
  assert.equal(math.parseColor('oklab(1 0 0)'), null);
});

test('alpha text and transparent backgrounds composite before luminance, not by ignoring alpha', () => {
  const white = [255, 255, 255, 1];
  const foreground = math.over([0, 0, 0, 0.5], white);
  assert.deepEqual(foreground, [127.5, 127.5, 127.5, 1]);
  assert.ok(math.ratio(foreground, white) < 4.5);
  const blue = math.over([0, 0, 255, 0.25], white);
  assert.deepEqual(blue, [191.25, 191.25, 255, 1]);
});

test('ancestor group opacity applies to its background as well as the text', () => {
  const outer = [255, 255, 255, 1];
  const groupBackground = math.opacity([0, 0, 0, 1], 0.5);
  const groupText = math.opacity([255, 255, 255, 1], 0.5);
  const resolvedBackground = math.over(groupBackground, outer);
  const resolvedForeground = math.over(groupText, outer);
  assert.deepEqual(resolvedBackground, [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(resolvedForeground, outer);
  assert.ok(math.ratio(resolvedForeground, resolvedBackground) < 4.5);
});
