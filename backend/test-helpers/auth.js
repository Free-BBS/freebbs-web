const assert = require('node:assert/strict');

function solveBandChallenge({ challengeId, carrier, objective, band }) {
  assert.ok(challengeId);
  assert.ok(['electron', 'hole'].includes(carrier));
  assert.ok(['maximum', 'minimum'].includes(objective));
  assert.ok(band.points.length >= 3);
  assert.ok(band.candidates.length >= 2);

  let selected;
  for (const candidate of band.candidates) {
    assert.ok(Number.isFinite(candidate.k));
    assert.ok(candidate.k > band.kMin && candidate.k < band.kMax);
    let index = 1;
    for (let sample = 2; sample < band.points.length - 1; sample += 1) {
      if (
        Math.abs(band.points[sample].k - candidate.k) < Math.abs(band.points[index].k - candidate.k)
      ) {
        index = sample;
      }
    }
    const previous = band.points[index - 1];
    const current = band.points[index];
    const next = band.points[index + 1];
    const leftSlope = (current.energy - previous.energy) / (current.k - previous.k);
    const rightSlope = (next.energy - current.energy) / (next.k - current.k);
    const secondDerivative = (2 * (rightSlope - leftSlope)) / (next.k - previous.k);
    const curvature = (carrier === 'electron' ? 1 : -1) * secondDerivative;
    assert.ok(Number.isFinite(curvature) && curvature > 0);

    // Compare only the marked positive-mass candidates, never band inflections.
    if (
      !selected ||
      (objective === 'maximum' && curvature < selected.curvature) ||
      (objective === 'minimum' && curvature > selected.curvature)
    ) {
      selected = { k: candidate.k, curvature };
    }
  }

  return { challengeId, k: selected.k };
}

module.exports = { solveBandChallenge };
