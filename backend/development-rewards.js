const { createHash } = require('node:crypto');
const { createAdminRewardsService, validateReward } = require('./admin-rewards');

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/** Only the authenticated development runtime can call this server-side adapter.
 * Account balances and the wallet ledger are shared. Its notifications are
 * delivered by the separate development inbox after a successful grant.
 */
function createDevelopmentRewardProvider({
  pool,
  createRewardService = createAdminRewardsService,
}) {
  const service = createRewardService({ pool, notifications: { async notifyReward() {} } });
  return {
    async grant(actorUid, input) {
      if (
        typeof actorUid !== 'string' ||
        !actorUid.trim() ||
        actorUid.length > 128 ||
        !input ||
        typeof input.requestId !== 'string' ||
        !input.requestId.trim() ||
        input.requestId.length > 128 ||
        !Array.isArray(input.recipientUids) ||
        !input.recipientUids.length ||
        input.recipientUids.length > 100 ||
        input.recipientUids.some(
          (uid) => typeof uid !== 'string' || !uid.trim() || uid.length > 128,
        ) ||
        new Set(input.recipientUids).size !== input.recipientUids.length
      )
        throw invalid('奖励用户或请求标识无效');
      const requestId =
        'development_' +
        createHash('sha256')
          .update(JSON.stringify([actorUid, input.requestId]))
          .digest('hex')
          .slice(0, 40);
      // Reuse the main service's currency, title and reason validation before
      // accessing account data. Temporary numeric IDs carry no authorization.
      validateReward({
        requestId,
        userIds: input.recipientUids.map((_, index) => index + 1),
        electric: input.electric,
        magnetic: input.magnetic,
        title: input.title,
        reason: input.reason,
      });
      const uids = [...new Set([actorUid, ...input.recipientUids])];
      const [rows] = await pool.execute(
        `SELECT id, uid, username FROM users WHERE uid IN (${uids.map(() => '?').join(',')})`,
        uids,
      );
      const byUid = new Map(rows.map((row) => [row.uid, row]));
      if (
        byUid.size !== uids.length ||
        rows.length !== uids.length ||
        uids.some((uid) => !byUid.has(uid))
      )
        throw invalid('部分主站账号不存在，请重新核对用户');
      const actor = byUid.get(actorUid);
      const userIds = input.recipientUids
        .map((uid) => Number(byUid.get(uid).id))
        .sort((a, b) => a - b);
      if (!Number.isSafeInteger(Number(actor.id)) || Number(actor.id) < 1)
        throw invalid('主站账号标识无效');
      // The existing service enforces all-or-nothing balance changes, locking,
      // wallet ledger attribution, and replay conflict checks in one transaction.
      return service.grant(
        { ...actor, id: Number(actor.id) },
        {
          requestId,
          userIds,
          electric: input.electric,
          magnetic: input.magnetic,
          title: input.title,
          reason: input.reason,
        },
      );
    },
  };
}

module.exports = { createDevelopmentRewardProvider };
