const test = require('node:test');
const assert = require('node:assert/strict');
const { walkPose, standPose, GROUND, SPEED, legPath } = require('../public/max-ranch');

test('Max has four articulated legs; stance hooves stay on the ground throughout the gait', () => {
  const heights = [new Set(), new Set(), new Set(), new Set()];
  for (let n = 0; n < 240; n += 1) {
    const pose = walkPose(n / 100);
    assert.equal(pose.legs.length, 4);
    pose.legs.forEach((leg, i) => {
      assert.ok(leg.foot.y <= GROUND && leg.foot.y >= GROUND - 13);
      if (leg.planted) assert.equal(leg.foot.y, GROUND);
      heights[i].add(leg.foot.y.toFixed(1));
      assert.doesNotMatch(legPath(leg, i), /NaN|Infinity/);
    });
  }
  heights.forEach((samples) => assert.ok(samples.size > 10, 'each leg swings independently'));
});
test('planted hooves do not slide while the body advances', () => {
  for (let t = 0; t < 1.1; t += 0.01) {
    const a = walkPose(t);
    const b = walkPose(t + 0.005);
    a.legs.forEach((leg, i) => {
      if (leg.planted && b.legs[i].planted) {
        const worldA = SPEED * t + leg.foot.x;
        const worldB = SPEED * (t + 0.005) + b.legs[i].foot.x;
        assert.ok(Math.abs(worldA - worldB) < 0.00001);
      }
    });
  }
});
test('rearing and waving keep both hind hooves grounded, with forelegs becoming arms', () => {
  for (let n = 0; n <= 100; n += 1) {
    const pose = standPose(n / 100, n / 30);
    for (const i of [0, 2]) {
      assert.equal(pose.legs[i].foot.y, GROUND);
      assert.equal(pose.legs[i].planted, true);
    }
    pose.legs.forEach((leg, i) => assert.doesNotMatch(legPath(leg, i), /NaN|Infinity/));
  }
  const standing = standPose();
  assert.ok(standing.angle < -60);
  assert.ok(standing.legs[3].foot.y < 70);
  assert.notEqual(standPose(1, 0).legs[3].foot.x, standPose(1, 0.2).legs[3].foot.x);
});
