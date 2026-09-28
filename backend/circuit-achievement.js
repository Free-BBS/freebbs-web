const { CIRCUIT_MASTER } = require('./economy-achievements');
const { mysqlProfileMethods } = require('./profile-extras');

function isCircuitMasterProgress(progress) {
  return (
    Number.isSafeInteger(progress?.total) &&
    progress.total > 0 &&
    progress.cleared === progress.total &&
    progress.completedCount === progress.total
  );
}

// Caller owns a transaction and has locked the active catalog before computing
// current-revision progress. Account lock follows catalog lock on every path.
async function unlockCircuitMaster(connection, userId, progress) {
  if (!isCircuitMasterProgress(progress)) return [];
  const [[user]] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [
    userId,
  ]);
  if (!user) throw new Error('Achievement recipient no longer exists');
  const [[owned]] = await connection.execute(
    'SELECT quantity FROM user_assets WHERE user_id = ? AND asset_key = ? FOR UPDATE',
    [userId, CIRCUIT_MASTER.key],
  );
  if (owned) return []; // Permanent collectible; never increment or reissue an existing row.
  await connection.execute(
    'INSERT INTO user_assets (user_id, asset_key, quantity, metadata_json) VALUES (?, ?, 1, ?)',
    [
      userId,
      CIRCUIT_MASTER.key,
      JSON.stringify({
        name: CIRCUIT_MASTER.name,
        description: CIRCUIT_MASTER.description,
        desc: CIRCUIT_MASTER.desc,
        image: CIRCUIT_MASTER.image,
        class: 'nameplate',
        source: 'achievement',
        isgift: false,
      }),
    ],
  );
  await mysqlProfileMethods(connection).notifyAchievement(userId, CIRCUIT_MASTER);
  return [CIRCUIT_MASTER.key];
}

module.exports = { isCircuitMasterProgress, unlockCircuitMaster };
