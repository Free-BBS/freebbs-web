const fs = require('node:fs');
const path = require('node:path');
const { GUIDE_VERSION, LEGACY_GUIDE_VERSIONS, ensureOnboardingTable } = require('./onboarding');
const {
  ensureWalletLedger,
  walletLedgerCheckpoint,
  annotateWalletLedger,
} = require('./wallet-ledger');

const ONBOARDING_REWARD_AMOUNTS = Object.freeze({ electric: 10, magnetic: 10 });
const REWARD_TITLE = '新手导引完成奖励';
const REWARD_REASON = '完成整套新手导引，一次性获得 10 电元和 10 磁元。';
// Release tours are deliberately excluded. Eligibility follows persisted base-guide receipts.
const REWARD_GUIDE_VERSIONS = Object.freeze([GUIDE_VERSION, ...LEGACY_GUIDE_VERSIONS]);
const versionPlaceholders = REWARD_GUIDE_VERSIONS.map(() => '?').join(',');
const initialization = new WeakMap();

class OnboardingRewardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function ensureOnboardingRewardTable(pool) {
  if (!initialization.has(pool)) {
    initialization.set(
      pool,
      (async () => {
        await ensureOnboardingTable(pool);
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/047_onboarding_rewards.sql'),
          'utf8',
        );
        await pool.query(sql);
      })().catch((error) => {
        initialization.delete(pool);
        throw error;
      }),
    );
  }
  return initialization.get(pool);
}

function validateClaimBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)
    throw new OnboardingRewardError('领取奖励只接受空对象，奖励金额与领取账号由服务器确定');
}

function rewardState(eligible, claimedAtMs) {
  const claimed = claimedAtMs != null;
  return {
    eligible: claimed || Boolean(eligible),
    claimed,
    claimedAt: claimed ? new Date(Number(claimedAtMs)).toISOString() : null,
    amounts: { ...ONBOARDING_REWARD_AMOUNTS },
  };
}

// Injectable stores implement read(userId) and claim(userId). Claim must atomically
// persist the permanent account receipt, both balance changes and wallet explanation.
function createMysqlOnboardingRewardStore(pool, { now = Date.now } = {}) {
  return {
    async read(userId) {
      await ensureOnboardingRewardTable(pool);
      const [rows] = await pool.execute(
        `SELECT u.id, r.claimed_at_ms,
         EXISTS(SELECT 1 FROM user_onboarding o WHERE o.user_id = u.id
           AND o.guide_version IN (${versionPlaceholders}) AND o.completed_at_ms IS NOT NULL) AS eligible
         FROM users u LEFT JOIN onboarding_rewards r ON r.user_id = u.id WHERE u.id = ?`,
        [...REWARD_GUIDE_VERSIONS, userId],
      );
      if (!rows.length) throw new OnboardingRewardError('账号不存在，请重新登录', 404);
      return rewardState(Number(rows[0].eligible) === 1, rows[0].claimed_at_ms);
    },
    async claim(userId) {
      await ensureOnboardingRewardTable(pool);
      await ensureWalletLedger(pool);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Every caller first locks the account, including the first-ever claim.
        // The reward primary key is user_id alone, independent of guide version.
        const [users] = await connection.execute(
          'SELECT id, electrons, manetrons FROM users WHERE id = ? FOR UPDATE',
          [userId],
        );
        if (!users.length) throw new OnboardingRewardError('账号不存在，请重新登录', 404);
        const [claims] = await connection.execute(
          'SELECT claimed_at_ms FROM onboarding_rewards WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (claims.length) {
          await connection.commit();
          return { ...rewardState(true, claims[0].claimed_at_ms), awarded: false };
        }
        const [completed] = await connection.execute(
          `SELECT guide_version FROM user_onboarding WHERE user_id = ?
           AND guide_version IN (${versionPlaceholders}) AND completed_at_ms IS NOT NULL
           ORDER BY completed_at_ms, guide_version LIMIT 1 FOR UPDATE`,
          [userId, ...REWARD_GUIDE_VERSIONS],
        );
        if (!completed.length)
          throw new OnboardingRewardError('完成整套新手导引后，即可领取奖励', 403);
        const user = users[0];
        const electricBefore = Number(user.electrons);
        const magneticBefore = Number(user.manetrons);
        if (
          user.electrons == null ||
          user.manetrons == null ||
          ![
            electricBefore,
            magneticBefore,
            electricBefore + ONBOARDING_REWARD_AMOUNTS.electric,
            magneticBefore + ONBOARDING_REWARD_AMOUNTS.magnetic,
          ].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
        )
          throw new OnboardingRewardError('账户余额暂时无法核对，请稍后重试', 503);
        const claimedAtMs = now();
        const checkpoint = await walletLedgerCheckpoint(connection, userId);
        const [updated] = await connection.execute(
          'UPDATE users SET electrons = electrons + ?, manetrons = manetrons + ? WHERE id = ?',
          [ONBOARDING_REWARD_AMOUNTS.electric, ONBOARDING_REWARD_AMOUNTS.magnetic, userId],
        );
        if (updated.affectedRows !== 1) throw new Error('Onboarding reward account update missing');
        await annotateWalletLedger(connection, userId, checkpoint, {
          sourceKey: 'onboarding-reward',
          title: REWARD_TITLE,
          reason: REWARD_REASON,
        });
        await connection.execute(
          `INSERT INTO onboarding_rewards (user_id, guide_version, electric, magnetic, claimed_at_ms)
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            completed[0].guide_version,
            ONBOARDING_REWARD_AMOUNTS.electric,
            ONBOARDING_REWARD_AMOUNTS.magnetic,
            claimedAtMs,
          ],
        );
        await connection.commit();
        return { ...rewardState(true, claimedAtMs), awarded: true };
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Retain the original failure if an interrupted connection also fails rollback.
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

function registerOnboardingReward(app, { pool, requireAuth, store, logger = console }) {
  const rewards = store || createMysqlOnboardingRewardStore(pool);
  async function handle(request, response, writing) {
    response.set('Cache-Control', 'private, no-store');
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      if (writing) validateClaimBody(request.body);
      const result = await (writing ? rewards.claim(user.id) : rewards.read(user.id));
      response.json(result);
    } catch (error) {
      if (!(error instanceof OnboardingRewardError))
        logger.error('Onboarding reward unavailable', error.code || error.name);
      response.status(error instanceof OnboardingRewardError ? error.status : 503).json({
        message:
          error instanceof OnboardingRewardError
            ? error.message
            : '暂时无法领取导引奖励，请稍后重试',
      });
    }
  }
  app.get('/api/onboarding/reward', (request, response) => handle(request, response, false));
  app.post('/api/onboarding/reward', (request, response) => handle(request, response, true));
  return rewards;
}

module.exports = {
  ONBOARDING_REWARD_AMOUNTS,
  REWARD_GUIDE_VERSIONS,
  OnboardingRewardError,
  ensureOnboardingRewardTable,
  validateClaimBody,
  createMysqlOnboardingRewardStore,
  registerOnboardingReward,
};
