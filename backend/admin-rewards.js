const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { ensureNotificationTables } = require('./notifications');
const { ensureWalletLedger } = require('./wallet-ledger');

const MAX_RECIPIENTS = 100;
const MAX_AMOUNT = 1000000;
const schemas = new WeakMap();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function ensureAdminRewardTables(pool) {
  if (!schemas.has(pool)) {
    schemas.set(
      pool,
      (async () => {
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/040_admin_rewards.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean))
          await pool.query(statement);
      })().catch((error) => {
        schemas.delete(pool);
        throw error;
      }),
    );
  }
  return schemas.get(pool);
}
function validateReward(body = {}) {
  if (!body || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(body.requestId))
    throw fail('奖励请求标识无效，请重新确认');
  if (!Array.isArray(body.userIds) || !body.userIds.length || body.userIds.length > MAX_RECIPIENTS)
    throw fail('每批请选择 1–100 位同学');
  const userIds = [
    ...new Set(
      body.userIds.map((id) => {
        if (
          !['string', 'number'].includes(typeof id) ||
          !/^[1-9]\d*$/.test(String(id)) ||
          !Number.isSafeInteger(Number(id))
        )
          throw fail('奖励对象无效');
        return Number(id);
      }),
    ),
  ].sort((a, b) => a - b);
  const { electric, magnetic } = body;
  for (const amount of [electric, magnetic]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT)
      throw fail('每种货币请输入 0–1000000 的整数');
  }
  if (!electric && !magnetic) throw fail('至少填写一种货币的奖励数量');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!title || title.length > 80) throw fail('请填写 1–80 字的奖励方案名称');
  if (!reason || reason.length > 1000) throw fail('请填写 1–1000 字的奖励原因');
  const value = { userIds, electric, magnetic, title, reason };
  return {
    ...value,
    requestId: body.requestId,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

function createAdminRewardsService({ pool, notifications }) {
  async function grant(actor, body) {
    const reward = validateReward(body);
    await ensureAdminRewardTables(pool);
    await ensureNotificationTables(pool);
    await ensureWalletLedger(pool);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Unique request + locking read works even when two retries arrive together.
      await connection.execute(
        `INSERT INTO admin_reward_batches
         (actor_id, request_id, fingerprint, title, reason, electric, magnetic, recipient_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [
          actor.id,
          reward.requestId,
          reward.fingerprint,
          reward.title,
          reward.reason,
          reward.electric,
          reward.magnetic,
          reward.userIds.length,
        ],
      );
      const [[batch]] = await connection.execute(
        'SELECT id, fingerprint, result_json FROM admin_reward_batches WHERE actor_id = ? AND request_id = ? FOR UPDATE',
        [actor.id, reward.requestId],
      );
      if (batch.fingerprint !== reward.fingerprint)
        throw fail('该请求已对应另一份奖励，请核对发放记录', 409);
      if (batch.result_json) {
        const result =
          typeof batch.result_json === 'string' ? JSON.parse(batch.result_json) : batch.result_json;
        await connection.commit();
        return { ...result, replayed: true };
      }
      const [users] = await connection.execute(
        `SELECT id, username, full_name, student_id, electrons, manetrons FROM users
         WHERE id IN (${reward.userIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
        reward.userIds,
      );
      if (users.length !== reward.userIds.length)
        throw fail('部分同学已不存在，本批未发放，请重新选择');
      for (const user of users) {
        const electricBefore = Number(user.electrons);
        const magneticBefore = Number(user.manetrons);
        if (
          ![
            electricBefore,
            magneticBefore,
            electricBefore + reward.electric,
            magneticBefore + reward.magnetic,
          ].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
        )
          throw fail('部分账户余额超出安全范围，本批未发放，请先核对账户');
        await connection.execute(
          'UPDATE users SET electrons = electrons + ?, manetrons = manetrons + ? WHERE id = ?',
          [reward.electric, reward.magnetic, user.id],
        );
        // The user's FOR UPDATE lock is still held: their latest ledger row is this credit.
        const [annotated] = await connection.execute(
          'UPDATE wallet_ledger SET source_key = ?, title = ?, reason = ? WHERE user_id = ? ORDER BY id DESC LIMIT 1',
          [`admin-reward:${batch.id}`, reward.title, reward.reason, user.id],
        );
        if (annotated.affectedRows !== 1) throw new Error('Reward ledger entry missing');
        await connection.execute(
          `INSERT INTO admin_reward_entries
           (batch_id, user_id, username, full_name, student_id, electric_before, electric_after, magnetic_before, magnetic_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            batch.id,
            user.id,
            user.username,
            user.full_name || '',
            user.student_id || '',
            electricBefore,
            electricBefore + reward.electric,
            magneticBefore,
            magneticBefore + reward.magnetic,
          ],
        );
      }
      await notifications.notifyReward(
        {
          actor,
          batchId: batch.id,
          recipients: reward.userIds,
          title: reward.title,
          reason: reward.reason,
          electric: reward.electric,
          magnetic: reward.magnetic,
        },
        connection,
      );
      const result = {
        batchId: String(batch.id),
        recipientCount: users.length,
        electric: reward.electric,
        magnetic: reward.magnetic,
        totalElectric: reward.electric * users.length,
        totalMagnetic: reward.magnetic * users.length,
      };
      await connection.execute('UPDATE admin_reward_batches SET result_json = ? WHERE id = ?', [
        JSON.stringify(result),
        batch.id,
      ]);
      await connection.commit();
      return { ...result, replayed: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return { grant };
}

function createAdminRewardsRouter({ pool, requireAdmin, requireAuth, notifications }) {
  const router = express.Router();
  const service = createAdminRewardsService({ pool, notifications });
  const route = (admin, handler) => async (request, response) => {
    try {
      const user = await (admin ? requireAdmin : requireAuth)(request, response);
      if (!user) return;
      response.set('Cache-Control', 'private, no-store');
      await ensureAdminRewardTables(pool);
      await handler(request, response, user);
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status
          ? error.message
          : '奖励服务暂时不可用，请使用同一请求重试并核对发放记录',
      });
    }
  };
  const cursor = (value) => {
    if (value === undefined) return null;
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
      throw fail('分页位置无效');
    return Number(value);
  };
  router.post(
    '/admin/rewards',
    route(true, async (request, response, user) => {
      const result = await service.grant(user, request.body);
      response.status(result.replayed ? 200 : 201).json(result);
    }),
  );
  router.get(
    '/admin/rewards',
    route(true, async (request, response) => {
      const before = cursor(request.query.before);
      const [rows] = await pool.execute(
        `SELECT b.id, b.title, b.reason, b.electric, b.magnetic, b.recipient_count, b.created_at,
       COALESCE(u.username, '已注销管理员') AS actor FROM admin_reward_batches b
       LEFT JOIN users u ON u.id = b.actor_id WHERE b.result_json IS NOT NULL
       ${before ? 'AND b.id < ?' : ''} ORDER BY b.id DESC LIMIT 21`,
        before ? [before] : [],
      );
      response.json({
        batches: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? String(rows[19].id) : null,
      });
    }),
  );
  router.get(
    '/admin/rewards/:id',
    route(true, async (request, response) => {
      const id = cursor(request.params.id);
      const [entries] = await pool.execute(
        'SELECT * FROM admin_reward_entries WHERE batch_id = ? ORDER BY user_id',
        [id],
      );
      response.json({ entries });
    }),
  );
  router.get(
    '/rewards',
    route(false, async (request, response, user) => {
      const before = cursor(request.query.before);
      const [rows] = await pool.execute(
        `SELECT b.id, b.title, b.reason, b.electric, b.magnetic, b.created_at,
       e.electric_before, e.electric_after, e.magnetic_before, e.magnetic_after
       FROM admin_reward_entries e JOIN admin_reward_batches b ON b.id = e.batch_id
       WHERE e.user_id = ? ${before ? 'AND b.id < ?' : ''} ORDER BY b.id DESC LIMIT 21`,
        before ? [user.id, before] : [user.id],
      );
      response.json({
        rewards: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? String(rows[19].id) : null,
      });
    }),
  );
  return router;
}
module.exports = {
  validateReward,
  ensureAdminRewardTables,
  createAdminRewardsService,
  createAdminRewardsRouter,
};
