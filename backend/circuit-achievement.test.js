const assert = require('node:assert/strict');
const test = require('node:test');
const { isCircuitMasterProgress, unlockCircuitMaster } = require('./circuit-achievement');
const { CIRCUIT_MASTER } = require('./economy-achievements');

test('circuit award requires every current active level, not an empty or partial catalog', async () => {
  for (const progress of [
    null,
    {},
    { total: 0, cleared: 0, completedCount: 0 },
    { total: 3, cleared: 2, completedCount: 2 },
    { total: 3, cleared: 1, completedCount: 3 },
    { total: '3', cleared: 3, completedCount: 3 },
  ]) {
    assert.equal(isCircuitMasterProgress(progress), false);
    assert.deepEqual(
      await unlockCircuitMaster(
        {
          execute() {
            assert.fail('ineligible accounts must not write or lock assets');
          },
        },
        1,
        progress,
      ),
      [],
    );
  }
  assert.equal(isCircuitMasterProgress({ total: 29, cleared: 29, completedCount: 29 }), true);
});

test('circuit award writes one permanent non-gift asset and notification on caller transaction', async () => {
  const calls = [];
  let owned = false;
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 7 }]];
      if (sql.startsWith('SELECT quantity')) return [owned ? [{ quantity: 1 }] : []];
      if (sql.startsWith('INSERT INTO user_assets')) owned = true;
      return [{ affectedRows: 1 }];
    },
  };
  const progress = { total: 3, cleared: 3, completedCount: 3 };
  assert.deepEqual(await unlockCircuitMaster(connection, 7, progress), [CIRCUIT_MASTER.key]);
  assert.match(calls[0].sql, /FOR UPDATE/);
  const asset = calls.find((call) => call.sql.startsWith('INSERT INTO user_assets'));
  assert.equal(asset.values[0], 7);
  assert.deepEqual(JSON.parse(asset.values[2]), {
    name: '电路达人',
    description: CIRCUIT_MASTER.description,
    desc: CIRCUIT_MASTER.desc,
    image: CIRCUIT_MASTER.image,
    class: 'nameplate',
    source: 'achievement',
    isgift: false,
  });
  const notice = calls.find((call) => call.sql.includes('INSERT INTO community_notifications'));
  assert.equal(notice.values.at(-1), 7);
  assert.equal(notice.values.at(-2), 'achievement:plate_circuit_master');
  assert.deepEqual(await unlockCircuitMaster(connection, 7, progress), []);
  assert.equal(calls.filter((call) => call.sql.startsWith('INSERT')).length, 2);
  assert.ok(calls.every((call) => !/equipped|email_outbox|UPDATE users/.test(call.sql)));
});
