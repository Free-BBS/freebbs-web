const fs = require('node:fs');
const path = require('node:path');
const { beijingDay } = require('./economy-policy');
const { walletLedgerCheckpoint, annotateWalletLedger } = require('./wallet-ledger');

function magneticRewardDetails(sourceKey, amount, category) {
  const [kind, subject, , reaction] = sourceKey.split(':');
  const reactions = { smile: '令人高兴', light: '有启发性', fireworks: '恭喜' };
  const descriptions = {
    checkin: ['每日签到', `${subject} 完成每日签到`],
    luck: ['签到运势奖励', `${subject} 已签到且今日运势达到 70 分`],
    post: ['发帖奖励', `发布帖子（编号 ${subject}）`],
    'post-like': [
      '帖子互动奖励',
      `帖子（编号 ${subject}）收到${reactions[reaction] ? `“${reactions[reaction]}”` : ''}互动`,
    ],
    'comment-like': ['评论获赞奖励', `评论（编号 ${subject}）收到点赞`],
    'featured-post': ['精华帖子奖励', `帖子（编号 ${subject}）被设为精华`],
    'featured-comment': ['精华评论奖励', `评论（编号 ${subject}）被设为精华`],
  };
  let fallback = ['磁元奖励', '获得平台磁元奖励'];
  if (category === 'community') fallback = ['社区互动奖励', '参与社区互动'];
  if (category === 'checkin') fallback = ['每日签到', '完成每日签到'];
  const [title, event] = descriptions[kind] || fallback;
  return { sourceKey: `reward:${sourceKey}`, title, reason: `${event}，获得 ${amount} 磁元` };
}

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
    'SELECT amount FROM economy_rewards WHERE user_id = ? AND source_key = ? FOR UPDATE',
    [userId, sourceKey],
  );
  if (existing.length) return 0;
  let amount = requested;
  if (category === 'community') {
    // A caller may already have a REPEATABLE READ snapshot before taking the account lock.
    // Locking reads see committed rewards from preceding lock holders, not that old snapshot.
    const [rows] = await connection.execute(
      "SELECT amount FROM economy_rewards WHERE user_id = ? AND reward_day = ? AND category = 'community' FOR UPDATE",
      [userId, day],
    );
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    amount = Math.max(0, Math.min(requested, 3 - total));
  }
  // Record zero too: deleting/re-adding an interaction on a later day cannot farm it.
  await connection.execute(
    'INSERT INTO economy_rewards (user_id, source_key, reward_day, amount, category) VALUES (?, ?, ?, ?, ?)',
    [userId, sourceKey, day, amount, category],
  );
  if (amount) {
    const ledgerBefore = await walletLedgerCheckpoint(connection, userId);
    await connection.execute('UPDATE users SET manetrons = manetrons + ? WHERE id = ?', [
      amount,
      userId,
    ]);
    await annotateWalletLedger(
      connection,
      userId,
      ledgerBefore,
      magneticRewardDetails(sourceKey, amount, category),
    );
  }
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
