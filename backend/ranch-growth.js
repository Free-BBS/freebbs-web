const { randomBytes } = require('node:crypto');

// Feed count is operational time: disjoint successful feeds have independent
// Poisson(0.2) increments, so n feeds produce Poisson(0.2n) wool in total.
// No wall-clock timer, client randomness or new currency is involved.
const WOOL_RATE = 0.2;
const secureUniform = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
function sampleWoolGrowth(random = secureUniform) {
  const uniform = random();
  if (!Number.isFinite(uniform) || uniform < 0 || uniform >= 1)
    throw new Error('Invalid ranch random source');
  let count = 0;
  let probability = Math.exp(-WOOL_RATE);
  let cumulative = probability;
  // Inverse CDF: one server-side draw per successful, non-replayed feed.
  while (uniform >= cumulative) {
    count += 1;
    probability *= WOOL_RATE / count;
    const next = cumulative + probability;
    if (next === cumulative) break;
    cumulative = next;
  }
  return count;
}
module.exports = { WOOL_RATE, sampleWoolGrowth };
