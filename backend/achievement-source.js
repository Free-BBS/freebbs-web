const { readProgress } = require('./circuit-challenges');

// Read-only adapter: never calls achievement reconciliation or account reward methods.
function createLearningAchievementProvider(pool) {
  return async (uid) => {
    const [[user]] = await pool.execute('SELECT id FROM users WHERE uid = ? LIMIT 1', [
      String(uid),
    ]);
    if (!user) throw new Error('Learning account not found');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [checkins, assets, circuit] = await Promise.all([
      pool.execute(
        'SELECT COUNT(DISTINCT checkin_date) AS days FROM user_checkins WHERE user_id = ? AND checkin_date <= ?',
        [user.id, today],
      ),
      pool.execute(
        'SELECT asset_key FROM user_assets WHERE user_id = ? AND quantity > 0 AND asset_key IN (?, ?)',
        [user.id, 'plate_circuit_master', 'plate_fishbone_master'],
      ),
      readProgress(pool, user.id),
    ]);
    return {
      checkinDays: Number(checkins[0][0]?.days || 0),
      circuitCleared: circuit.progress.cleared,
      circuitTotal: circuit.progress.total,
      ownedAchievementIds: assets[0].map((row) => row.asset_key),
    };
  };
}

module.exports = { createLearningAchievementProvider };
