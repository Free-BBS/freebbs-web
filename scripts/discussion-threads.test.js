const test = require('node:test');
const assert = require('node:assert/strict');
const { pathsForBranch } = require('../public/discussion-threads');

const parent = { x: 19, bottom: 56, toggleY: 118 };
test('one continuous parent stem spans all direct children and ends at the last avatar', () => {
  assert.deepEqual(
    pathsForBranch(parent, [
      { left: 32, top: 170, y: 189 },
      { left: 32, top: 900, y: 919 },
    ]),
    ['M 19 59 V 909 Q 19 919 29 919 H 32', 'M 19 179 Q 19 189 29 189 H 32'],
  );
});
test('a folded branch ends at its own toggle without a leftover tail', () => {
  assert.deepEqual(pathsForBranch(parent, []), ['M 19 59 V 118']);
});
test('after folding a nested branch the ancestor line follows the new sibling coordinates', () => {
  assert.deepEqual(pathsForBranch(parent, [{ left: 32, top: 250, y: 269 }]), [
    'M 19 59 V 259 Q 19 269 29 269 H 32',
  ]);
});
test('narrow indent uses a small elbow and never points backwards', () => {
  assert.deepEqual(pathsForBranch(parent, [{ left: 24, top: 100, y: 115 }]), [
    'M 19 59 V 110 Q 19 115 24 115 H 24',
  ]);
});
test('capped indentation stops before the next avatar instead of drawing through it', () => {
  assert.deepEqual(pathsForBranch(parent, [{ left: 0, top: 150, y: 169 }]), ['M 19 59 V 147']);
});
