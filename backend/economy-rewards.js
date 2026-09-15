const fs = require('node:fs');
const path = require('node:path');
const { beijingDay } = require('./economy-policy');

// Caller supplies an open transaction. Locking the account serializes all reward sources.
async function awardMagnetic(
  connection,
  userId,
  sourceKey,
  requested,
  day = beijingDay(),
  category = 'bonus',
) {
  if (!userId || !Number.isSafeInteger(requested) || requested <= 0) return 0;
  await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  const [existing] = await connection.execute(
    'SELECT amount FROM economy_rewards WHERE user_id = ? AND source_key = ?',
    [userId, sourceKey],
  );
  if (existing.length) return 0;
  let amount = requested;
  if (category === 'community') {
    const [[row]] = await connection.execute(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM economy_rewards WHERE user_id = ? AND reward_day = ? AND category = 'community'",
      [userId, day],
    );
    amount = Math.max(0, Math.min(requested, 3 - Number(row.total)));
  }
  // Record zero too: deleting/re-adding an interaction on a later day cannot farm it.
  await connection.execute(
    'INSERT INTO economy_rewards (user_id, source_key, reward_day, amount, category) VALUES (?, ?, ?, ?, ?)',
    [userId, sourceKey, day, amount, category],
  );
  if (amount)
    await connection.execute('UPDATE users SET manetrons = manetrons + ? WHERE id = ?', [
      amount,
      userId,
    ]);
  return amount;
}

async function ensureEconomyPolicy(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/039_economy_policy.sql'),
    'utf8',
  );
  for (const statement of sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await pool.query(statement);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Existing fishbone keys deliberately retain identity; all legacy bones become hard bones.
    const [mark] = await connection.execute(
      "INSERT IGNORE INTO economy_migrations (version_key) VALUES ('hard-fishbone-v1')",
    );
    if (mark.affectedRows) {
      await connection.execute(
        "INSERT INTO shop_purchase_progress (user_id, item_key, purchase_count) SELECT user_id, 'fishbone', LEAST(10, GREATEST(0, quantity)) FROM user_assets WHERE asset_key = 'fishbone' ON DUPLICATE KEY UPDATE purchase_count = GREATEST(purchase_count, VALUES(purchase_count))",
      );
      await connection.execute(
        "UPDATE user_assets SET metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.name', '坚硬的鱼骨头') WHERE asset_key = 'fishbone'",
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
module.exports = { awardMagnetic, ensureEconomyPolicy };
