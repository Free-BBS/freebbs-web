const fs = require('node:fs');
const path = require('node:path');
const { readExtras, readPublicCosmetics, mysqlProfileMethods } = require('./profile-extras');
const { unlockFishboneMaster } = require('./economy-achievements');
const { walletLedgerCheckpoint, annotateWalletLedger } = require('./wallet-ledger');

const FRAGMENT_PRICES = Object.freeze([5, 10, 20, 30, 50, 75, 100, 150, 200, 777]);
const DAY_MS = 86400000;
const LASER_POLICY = Object.freeze({
  purchasePrice: 25,
  dailyPrice: 1,
  dailyMagnetic: 1,
  currency: 'combined',
});
const GOLDEN_NAME_DURATION_MS = 7 * DAY_MS;
const GOLDEN_NAME_ASSET_KEY = 'golden_name_card';

class ShopPurchaseError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function purchaseOffer(item, count = 0) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid purchase count');
  const steps = item.key === 'mysterious_fragment' ? FRAGMENT_PRICES : null;
  const limit = steps?.length || (item.key === 'fishbone' ? 10 : item.purchaseLimit || null);
  const soldOut = limit !== null && count >= limit;
  return {
    purchasedCount: count,
    purchaseLimit: limit,
    soldOut,
    nextPrice: soldOut ? null : (steps?.[count] ?? null),
    ...(steps ? { priceSteps: [...steps] } : {}),
  };
}
function fragmentOffer(count = 0) {
  return purchaseOffer({ key: 'mysterious_fragment' }, count);
}
function publicLaser(expiresAtMs, nowMs) {
  return { expiresAtMs, serverNowMs: nowMs, active: expiresAtMs > nowMs };
}
function publicGoldenName(expiresAtMs, nowMs) {
  return { expiresAtMs, serverNowMs: nowMs, active: expiresAtMs > nowMs };
}
function createEconomyShop(store, { now = Date.now } = {}) {
  return {
    async decorate(items, userId) {
      const counts = await store.readCounts(userId);
      const laser = await store.readLaser(userId);
      const goldenName = (await store.readGoldenName?.(userId)) || { expiresAtMs: 0 };
      return items
        .filter((item) => item.enabled !== false)
        .map((item) => {
          const offer = purchaseOffer(item, counts[item.key] || 0);
          if (item.key === 'laser' && laser.owned) offer.soldOut = true;
          return {
            ...item,
            purchasePolicy: offer,
            cost: offer.soldOut
              ? {}
              : item.key === 'mysterious_fragment'
                ? { electric: offer.nextPrice }
                : item.cost,
            ...(item.key === 'laser'
              ? {
                  laser: {
                    ...publicLaser(laser.expiresAtMs, now()),
                    owned: laser.owned,
                    dailyPrice: LASER_POLICY.dailyPrice,
                    dailyMagnetic: LASER_POLICY.dailyMagnetic,
                    currency: 'combined',
                  },
                }
              : {}),
            ...(item.key === GOLDEN_NAME_ASSET_KEY
              ? { goldenName: publicGoldenName(goldenName.expiresAtMs || 0, now()) }
              : {}),
          };
        });
    },
    async purchase({
      userId,
      currency,
      requestKey,
      expectedPurchaseCount,
      item,
      action = 'purchase',
      days = 1,
      quotedDailyPrice,
      quotedDailyMagnetic,
      quotedCost,
      legacyConverter = false,
    }) {
      const charging = action === 'charge';
      if (
        !item ||
        item.enabled === false ||
        !['purchase', 'charge'].includes(action) ||
        (charging && item.key !== 'laser') ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestKey || '')
      )
        throw new ShopPurchaseError('请刷新物品后重试', 'INVALID_PURCHASE');
      const combined = charging || item.priceMode === 'combined';
      if (
        (combined && currency !== 'combined') ||
        (!combined && !['electric', 'magnetic'].includes(currency)) ||
        (!charging &&
          ['laser', 'mysterious_fragment', 'fishbone'].includes(item.key) &&
          currency !== 'electric')
      )
        throw new ShopPurchaseError('请选择商品支持的付款方式', 'INVALID_CURRENCY');
      if (
        charging &&
        (!Number.isInteger(days) ||
          days < 1 ||
          days > 30 ||
          !Number.isSafeInteger(quotedDailyPrice) ||
          quotedDailyPrice < 1)
      )
        throw new ShopPurchaseError('充值天数为 1～30 天，请确认日费', 'INVALID_PURCHASE');
      if (legacyConverter && (charging || item.key !== 'differential_converter'))
        throw new ShopPurchaseError('无效购买入口', 'INVALID_PURCHASE');
      if (
        !charging &&
        !legacyConverter &&
        (!Number.isSafeInteger(expectedPurchaseCount) || expectedPurchaseCount < 0)
      )
        throw new ShopPurchaseError('请刷新商品，确认购买次数后再试', 'INVALID_PURCHASE');
      const quote = !charging
        ? { electric: quotedCost?.electric, magnetic: quotedCost?.magnetic }
        : null;
      const fingerprint = JSON.stringify({
        item: item.key,
        action,
        currency,
        ...(charging
          ? { days, quotedDailyPrice, quotedDailyMagnetic }
          : legacyConverter
            ? { legacyConverter: true }
            : { expectedPurchaseCount, quote }),
      });
      return store.transaction(async (tx) => {
        // Serialize the whole account: both currencies, inventory, lease and receipt commit together.
        await tx.lockUser(userId);
        const previous = await tx.findPurchase(userId, requestKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ShopPurchaseError(
              '请求编号已用于另一笔操作，请重新确认',
              'REQUEST_CONFLICT',
              409,
            );
          return { ...previous.result, replayed: true };
        }
        const counterKey = charging ? 'laser_charge' : item.key;
        const count = await tx.purchaseCount(userId, counterKey);
        const laser = item.key === 'laser' ? await tx.readLaser(userId) : null;
        let cost;
        if (charging) {
          if (!laser.owned) throw new ShopPurchaseError('请先购买激光器', 'LASER_REQUIRED');
          if (
            quotedDailyPrice !== LASER_POLICY.dailyPrice ||
            quotedDailyMagnetic !== LASER_POLICY.dailyMagnetic
          )
            throw new ShopPurchaseError('日费已变化，请刷新确认后再充值', 'PRICE_CHANGED', 409);
          cost = {
            electric: LASER_POLICY.dailyPrice * days,
            magnetic: LASER_POLICY.dailyMagnetic * days,
          };
        } else {
          const offer = purchaseOffer(item, count);
          if (offer.soldOut || laser?.owned)
            throw new ShopPurchaseError('已达到该物品的购买上限', 'PURCHASE_LIMIT', 409);
          if (!legacyConverter && count !== expectedPurchaseCount)
            throw new ShopPurchaseError('购买次数已变化，请刷新确认后再购买', 'PRICE_CHANGED', 409);
          cost = combined
            ? { electric: item.cost?.electric, magnetic: item.cost?.magnetic }
            : {
                [currency]:
                  item.key === 'mysterious_fragment'
                    ? offer.nextPrice
                    : item.key === 'laser'
                      ? LASER_POLICY.purchasePrice
                      : item.cost?.[currency],
              };
        }
        if (Object.values(cost).some((amount) => !Number.isSafeInteger(amount) || amount <= 0))
          throw new ShopPurchaseError('商品价格暂不可用', 'INVALID_PRICE');
        if (
          !charging &&
          !legacyConverter &&
          Object.entries(cost).some(([unit, amount]) => quote[unit] !== amount)
        )
          throw new ShopPurchaseError('价格已变化，请刷新确认后再购买', 'PRICE_CHANGED', 409);
        for (const [unit, amount] of Object.entries(cost)) {
          const unitName = unit === 'electric' ? '电元' : '磁元';
          const details = {
            sourceKey: `shop:${requestKey}:${unit}`,
            title: charging ? '激光器充值' : '商城购买',
            reason: charging
              ? `为激光器充值 ${days} 天，支付 ${amount} ${unitName}（日费 ${LASER_POLICY.dailyPrice} 电元 + ${LASER_POLICY.dailyMagnetic} 磁元）`
              : `购买「${item.name || item.key}」× 1，支付 ${amount} ${unitName}`,
          };
          if (!(await tx.debit(userId, amount, unit, true, details)))
            throw new ShopPurchaseError('余额不足，未扣款', 'INSUFFICIENT_BALANCE');
        }
        const receipt = {
          itemKey: item.key,
          action,
          currency,
          cost,
          amount: combined ? null : Object.values(cost)[0],
          purchaseNumber: count + 1,
          replayed: false,
        };
        if (charging) {
          const expiresAtMs = Math.max(now(), laser.expiresAtMs) + days * DAY_MS;
          if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > 8640000000000000)
            throw new ShopPurchaseError('累计充值时长超出范围', 'INVALID_PURCHASE');
          await tx.setLaser(userId, expiresAtMs);
          receipt.expiresAtMs = expiresAtMs;
          receipt.days = days;
        } else {
          await tx.deliver(userId, item);
        }
        await tx.advance(userId, counterKey, count + 1);
        if (item.key === 'fishbone') receipt.unlocked = await unlockFishboneMaster(tx, userId);
        await tx.record(userId, requestKey, counterKey, fingerprint, receipt);
        return receipt;
      });
    },
    async useGoldenName({ userId, requestKey }) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestKey || ''))
        throw new ShopPurchaseError('请刷新仓库后重试', 'INVALID_USE');
      const fingerprint = JSON.stringify({ item: GOLDEN_NAME_ASSET_KEY, action: 'use' });
      return store.transaction(async (tx) => {
        await tx.lockUser(userId);
        const previous = await tx.findGoldenNameUse(userId, requestKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ShopPurchaseError(
              '请求编号已用于另一项操作，请重新确认',
              'REQUEST_CONFLICT',
              409,
            );
          return { ...previous.result, replayed: true };
        }
        if (!(await tx.consumeAsset(userId, GOLDEN_NAME_ASSET_KEY)))
          throw new ShopPurchaseError('仓库里没有可使用的黄金名片', 'ASSET_REQUIRED', 409);
        const current = await tx.readGoldenName(userId);
        const expiresAtMs = Math.max(now(), current.expiresAtMs || 0) + GOLDEN_NAME_DURATION_MS;
        if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > 8640000000000000)
          throw new ShopPurchaseError('累计使用时长超出范围', 'INVALID_USE');
        await tx.setGoldenName(userId, expiresAtMs);
        const receipt = {
          itemKey: GOLDEN_NAME_ASSET_KEY,
          action: 'use',
          expiresAtMs,
          days: 7,
          replayed: false,
        };
        await tx.recordGoldenNameUse(userId, requestKey, fingerprint, receipt);
        return receipt;
      });
    },
    async decoratePosts(rows) {
      const ids = [
        ...new Set(
          rows.filter((row) => !row.is_anonymous && !row.is_deleted).map((row) => row.user_id),
        ),
      ];
      const expiry = await store.readPublicLasers(ids);
      const goldenExpiry = (await store.readPublicGoldenNames?.(ids)) || {};
      const cosmetics = (await store.readPublicCosmetics?.(ids)) || {};
      const current = now();
      return rows.map((row) => ({
        ...row,
        cosmetics: !row.is_anonymous && !row.is_deleted ? cosmetics[row.user_id] || {} : {},
        laser:
          !row.is_anonymous && !row.is_deleted
            ? publicLaser(expiry[row.user_id] || 0, current)
            : null,
        goldenName:
          !row.is_anonymous && !row.is_deleted
            ? publicGoldenName(goldenExpiry[row.user_id] || 0, current)
            : null,
      }));
    },
    async publicCollectibles(items, userId) {
      const relics = items.filter((item) => item.class === 'scholar_relic');
      const owned = new Set(
        await store.readCollectibles(
          userId,
          relics.map((item) => item.assetKey),
        ),
      );
      return relics
        .filter((item) => owned.has(item.assetKey))
        .map((item) => ({
          key: item.key,
          name: item.name,
          image: item.image,
          description: item.description,
        }));
    },
  };
}
async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
async function ensureShopPurchaseTables(pool) {
  for (const migration of [
    '037_shop_purchase_progress.sql',
    '053_golden_names_and_frontend_tools.sql',
  ]) {
    const sql = fs.readFileSync(path.join(__dirname, '../database/migrations', migration), 'utf8');
    for (const statement of sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(statement);
  }
}
async function readLaser(connection, id) {
  const [rows] = await connection.execute(
    `SELECT
    COALESCE((SELECT quantity FROM user_assets WHERE user_id = ? AND asset_key = 'laser'), 0) AS quantity,
    COALESCE((SELECT expires_at_ms FROM user_lasers WHERE user_id = ?), 0) AS expires_at_ms`,
    [id, id],
  );
  return {
    owned: Number(rows[0]?.quantity || 0) > 0,
    expiresAtMs: Number(rows[0]?.expires_at_ms || 0),
  };
}
function createMysqlEconomyStore(pool) {
  return {
    readExtras: (id) => readExtras(pool, id),
    readPublicCosmetics: (ids) => readPublicCosmetics(pool, ids),
    async readCounts(id) {
      const [rows] = await pool.execute(
        'SELECT item_key, purchase_count FROM shop_purchase_progress WHERE user_id = ?',
        [id],
      );
      return Object.fromEntries(rows.map((row) => [row.item_key, Number(row.purchase_count)]));
    },
    readLaser: (id) => readLaser(pool, id),
    async readGoldenName(id) {
      const [rows] = await pool.execute(
        'SELECT expires_at_ms FROM user_golden_names WHERE user_id = ? LIMIT 1',
        [id],
      );
      return { expiresAtMs: Number(rows[0]?.expires_at_ms || 0) };
    },
    async readCollectibles(id, keys) {
      if (!keys.length) return [];
      const [rows] = await pool.execute(
        `SELECT asset_key FROM user_assets WHERE user_id = ?
        AND quantity > 0 AND asset_key IN (${keys.map(() => '?').join(',')})`,
        [id, ...keys],
      );
      return rows.map((row) => row.asset_key);
    },
    async readPublicLasers(ids) {
      if (!ids.length) return {};
      const [rows] = await pool.execute(
        `SELECT l.user_id, l.expires_at_ms FROM user_lasers l
        INNER JOIN user_assets a ON a.user_id = l.user_id AND a.asset_key = 'laser' AND a.quantity > 0
        WHERE l.user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      return Object.fromEntries(rows.map((row) => [row.user_id, Number(row.expires_at_ms)]));
    },
    async readPublicGoldenNames(ids) {
      if (!ids.length) return {};
      const [rows] = await pool.execute(
        `SELECT user_id, expires_at_ms FROM user_golden_names
        WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      return Object.fromEntries(rows.map((row) => [row.user_id, Number(row.expires_at_ms)]));
    },
    transaction(work) {
      return withTransaction(pool, (connection) =>
        work({
          ...mysqlProfileMethods(connection),
          async lockUser(id) {
            const [rows] = await connection.execute(
              'SELECT id FROM users WHERE id = ? FOR UPDATE',
              [id],
            );
            if (!rows[0]) throw new ShopPurchaseError('用户不存在', 'USER_NOT_FOUND', 401);
          },
          async findPurchase(id, key) {
            const [rows] = await connection.execute(
              'SELECT fingerprint, result_json FROM shop_purchases WHERE user_id = ? AND request_key = ?',
              [id, key],
            );
            return rows[0]
              ? {
                  fingerprint: rows[0].fingerprint,
                  result:
                    typeof rows[0].result_json === 'string'
                      ? JSON.parse(rows[0].result_json)
                      : rows[0].result_json,
                }
              : null;
          },
          async findGoldenNameUse(id, key) {
            const [rows] = await connection.execute(
              'SELECT fingerprint, result_json FROM golden_name_uses WHERE user_id = ? AND request_key = ?',
              [id, key],
            );
            return rows[0]
              ? {
                  fingerprint: rows[0].fingerprint,
                  result:
                    typeof rows[0].result_json === 'string'
                      ? JSON.parse(rows[0].result_json)
                      : rows[0].result_json,
                }
              : null;
          },
          async purchaseCount(id, key) {
            await connection.execute(
              'INSERT IGNORE INTO shop_purchase_progress (user_id, item_key) VALUES (?, ?)',
              [id, key],
            );
            const [rows] = await connection.execute(
              'SELECT purchase_count FROM shop_purchase_progress WHERE user_id = ? AND item_key = ? FOR UPDATE',
              [id, key],
            );
            return Number(rows[0].purchase_count);
          },
          readLaser: (id) => readLaser(connection, id),
          async readGoldenName(id) {
            const [rows] = await connection.execute(
              'SELECT expires_at_ms FROM user_golden_names WHERE user_id = ? LIMIT 1',
              [id],
            );
            return { expiresAtMs: Number(rows[0]?.expires_at_ms || 0) };
          },
          async setLaser(id, expiresAtMs) {
            await connection.execute(
              `INSERT INTO user_lasers (user_id, expires_at_ms) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE expires_at_ms = VALUES(expires_at_ms)`,
              [id, expiresAtMs],
            );
          },
          async setGoldenName(id, expiresAtMs) {
            await connection.execute(
              `INSERT INTO user_golden_names (user_id, expires_at_ms) VALUES (?, ?)
              ON DUPLICATE KEY UPDATE expires_at_ms = VALUES(expires_at_ms)`,
              [id, expiresAtMs],
            );
          },
          async consumeAsset(id, key) {
            const [result] = await connection.execute(
              `UPDATE user_assets SET quantity = quantity - ?
               WHERE user_id = ? AND asset_key = ? AND quantity >= ?`,
              [1, id, key, 1],
            );
            return result.affectedRows === 1;
          },
          async debit(id, amount, currency, spending = true, details = {}) {
            const checkpoint = await walletLedgerCheckpoint(connection, id);
            const column = currency === 'electric' ? 'electrons' : 'manetrons';
            const [result] = await connection.execute(
              `UPDATE users SET ${column} = ${column} - ?,
            heat = heat + ? WHERE id = ? AND ${column} >= ?`,
              [amount, spending ? amount : 0, id, amount],
            );
            if (result.affectedRows !== 1) return false;
            await annotateWalletLedger(connection, id, checkpoint, details);
            return true;
          },
          async consumeSaleAssets(id, key, quantity) {
            const [result] = await connection.execute(
              `UPDATE user_assets SET quantity = quantity - ?
               WHERE user_id = ? AND asset_key = ? AND quantity >= ?`,
              [quantity, id, key, quantity],
            );
            return result.affectedRows === 1;
          },
          async saleAssetQuantity(id, key) {
            const [rows] = await connection.execute(
              'SELECT CAST(quantity AS CHAR) AS quantity FROM user_assets WHERE user_id = ? AND asset_key = ?',
              [id, key],
            );
            return String(rows[0]?.quantity || '0');
          },
          async creditBoneSale(id, amount, { sourceKey, title, reason }) {
            const checkpoint = await walletLedgerCheckpoint(connection, id);
            // Credit is income: heat and electric balance remain unchanged.
            const [result] = await connection.execute(
              `UPDATE users SET manetrons = manetrons + ?
               WHERE id = ? AND manetrons >= 0 AND manetrons <= ?`,
              [amount, id, Number.MAX_SAFE_INTEGER - amount],
            );
            if (result.affectedRows !== 1) {
              throw new ShopPurchaseError('账户余额超出安全范围，本次未出售', 'BALANCE_LIMIT', 409);
            }
            // The trigger and annotation are in this transaction under the user's row lock.
            await annotateWalletLedger(connection, id, checkpoint, { sourceKey, title, reason });
            const [rows] = await connection.execute(
              `SELECT CAST(electrons AS CHAR) AS electric, CAST(manetrons AS CHAR) AS magnetic,
               CAST(heat AS CHAR) AS heat FROM users WHERE id = ?`,
              [id],
            );
            return rows[0];
          },
          async deliver(id, item) {
            await connection.execute(
              `INSERT INTO user_assets (user_id, asset_key, quantity, metadata_json)
            VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE quantity = quantity + 1,
            metadata_json = VALUES(metadata_json)`,
              [
                id,
                item.assetKey,
                JSON.stringify({
                  name: item.name,
                  description: item.description,
                  desc: item.desc,
                  image: item.image,
                  class: item.class,
                  source: item.source,
                  isgift: item.isGift !== false,
                }),
              ],
            );
          },
          async record(id, requestKey, counterKey, fingerprint, receipt) {
            await connection.execute(
              `INSERT INTO shop_purchases
            (user_id, request_key, item_key, purchase_number, currency, amount, fingerprint, result_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                requestKey,
                counterKey,
                receipt.purchaseNumber,
                receipt.currency,
                receipt.amount,
                fingerprint,
                JSON.stringify(receipt),
              ],
            );
          },
          async recordGoldenNameUse(id, requestKey, fingerprint, receipt) {
            await connection.execute(
              `INSERT INTO golden_name_uses (user_id, request_key, fingerprint, result_json)
               VALUES (?, ?, ?, ?)`,
              [id, requestKey, fingerprint, JSON.stringify(receipt)],
            );
          },
          async advance(id, key, count) {
            await connection.execute(
              'UPDATE shop_purchase_progress SET purchase_count = ? WHERE user_id = ? AND item_key = ?',
              [count, id, key],
            );
          },
        }),
      );
    },
  };
}
module.exports = {
  FRAGMENT_PRICES,
  DAY_MS,
  LASER_POLICY,
  GOLDEN_NAME_DURATION_MS,
  GOLDEN_NAME_ASSET_KEY,
  ShopPurchaseError,
  fragmentOffer,
  purchaseOffer,
  publicLaser,
  publicGoldenName,
  createEconomyShop,
  createMysqlEconomyStore,
  ensureShopPurchaseTables,
};
