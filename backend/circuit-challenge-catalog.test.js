const assert = require('node:assert/strict');
const test = require('node:test');
const { circuitChallengeCatalog } = require('./circuit-challenge-catalog');
const {
  ensureCircuitChallengeCatalog,
  outputFrom,
  validateChallengeDocument,
} = require('./circuit-challenges');

function harmonicAmplitude(target, frequency) {
  const start = Math.floor(target.x.length / 2);
  const values = target.values.slice(start);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let real = 0;
  let imaginary = 0;
  for (let index = start; index < target.x.length; index += 1) {
    const value = target.values[index] - mean;
    const phase = 2 * Math.PI * frequency * target.x[index];
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return (2 * Math.hypot(real, imaginary)) / values.length;
}

test('catalog provides twenty-three distinct, valid and simulatable waveform challenges', () => {
  const catalog = circuitChallengeCatalog();
  assert.equal(catalog.length, 23);
  assert.equal(new Set(catalog.map((item) => item.key)).size, catalog.length);
  assert.equal(new Set(catalog.map((item) => item.title)).size, catalog.length);
  assert.deepEqual(
    catalog.map((item) => item.title),
    [
      '第七关',
      '第八关',
      '第九关',
      '第十关',
      '第十一关',
      '第十二关',
      '第十三关',
      '第十四关',
      '第十五关',
      '第十六关',
      '第十七关',
      '第十八关',
      '第十九关',
      '第二十关',
      '第二十一关',
      '第二十二关',
      '第二十三关',
      '第二十四关',
      '第二十五关',
      '第二十六关',
      '第二十七关',
      '第二十八关',
      '第二十九关',
    ],
  );
  for (const item of catalog) {
    const document = validateChallengeDocument(item.document);
    const target = outputFrom(document);
    assert.ok(target.values.length >= 1000, item.key);
    assert.ok(target.values.every(Number.isFinite), item.key);
    assert.ok(item.rewardElectric > 0, item.key);
    assert.ok(item.rewardElectric <= 6, item.key);
  }
});

test('frequency challenges are dominated by the requested second and third harmonics', () => {
  const catalog = circuitChallengeCatalog();
  const doubler = outputFrom(catalog.find((item) => item.key === 'frequency-doubler-v1').document);
  assert.ok(harmonicAmplitude(doubler, 2000) > harmonicAmplitude(doubler, 1000) * 100);
  const tripler = outputFrom(catalog.find((item) => item.key === 'frequency-tripler-v1').document);
  assert.ok(harmonicAmplitude(tripler, 3000) > harmonicAmplitude(tripler, 1000) * 5);
});

test('catalog seeding is transactional and idempotent', async () => {
  const seeds = new Map();
  const challenges = [];
  let commits = 0;
  let transactions = 0;
  let rollbacks = 0;
  const connection = {
    async beginTransaction() {
      transactions += 1;
    },
    async execute(sql, params) {
      if (sql.startsWith('SELECT challenge_id')) {
        const seed = seeds.get(params[0]);
        return [[seed ? { challenge_id: seed.challengeId, seed_revision: seed.revision } : undefined]];
      }
      if (sql.includes('SELECT id FROM circuit_challenges')) return [[undefined]];
      if (sql.includes('INSERT INTO circuit_challenges')) {
        const insertId = challenges.length + 1;
        challenges.push({ insertId, params });
        return [{ insertId }];
      }
      if (sql.startsWith('INSERT INTO circuit_challenge_catalog_seeds')) {
        seeds.set(params[0], { challengeId: params[1], revision: params[2] });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async commit() {
      commits += 1;
    },
    async rollback() {
      rollbacks += 1;
    },
    release() {},
  };
  const pool = {
    async getConnection() {
      return connection;
    },
  };
  assert.equal(await ensureCircuitChallengeCatalog(pool), 23);
  assert.equal(await ensureCircuitChallengeCatalog(pool), 0);
  assert.equal(challenges.length, 23);
  assert.equal(seeds.size, 23);
  assert.equal(commits, 2);
  assert.equal(transactions, 2);
  assert.equal(rollbacks, 0);
});
