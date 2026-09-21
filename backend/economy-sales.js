const express = require('express');
const { createMysqlEconomyStore, ShopPurchaseError } = require('./economy-shop');
const { unlockFishboneMaster } = require('./economy-achievements');
const { ensureWalletLedger } = require('./wallet-ledger');

const BONE_SALE_PRICES = Object.freeze({ ordinary_fishbone: 1, golden_fishbone: 10 });
const BONE_NAMES = Object.freeze({ ordinary_fishbone: '普通鱼骨', golden_fishbone: '黄金鱼骨' });

function createBoneSales(store) {
  return {
    async sell({ userId, itemKey, quantity, requestKey }) {
      if (
        typeof itemKey !== 'string' ||
        !Object.hasOwn(BONE_SALE_PRICES, itemKey) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        !Number.isSafeInteger(quantity * BONE_SALE_PRICES[itemKey]) ||
        typeof requestKey !== 'string' ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestKey)
      ) {
        throw new ShopPurchaseError('请选择鱼骨并输入有效的出售数量', 'INVALID_SALE');
      }
      const unitPrice = BONE_SALE_PRICES[itemKey];
      const amount = quantity * unitPrice;
      const fingerprint = JSON.stringify({ action: 'sell', itemKey, quantity });
      return store.transaction(async (tx) => {
        // Purchases, feeding and sales use the same account lock and receipt namespace.
        await tx.lockUser(userId);
        const previous = await tx.findPurchase(userId, requestKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw new ShopPurchaseError(
              '请求编号已用于另一笔操作，请重新确认',
              'REQUEST_CONFLICT',
              409,
            );
          }
          return { ...previous.result, replayed: true };
        }
        const counterKey = `sell:${itemKey}`;
        const count = await tx.purchaseCount(userId, counterKey);
        if (count >= 2147483647) {
          throw new ShopPurchaseError('出售次数已达上限，请联系管理员', 'SALE_LIMIT', 409);
        }
        // A previously earned achievement survives selling the bones that earned it.
        const unlocked = await unlockFishboneMaster(tx, userId);
        if (!(await tx.consumeSaleAssets(userId, itemKey, quantity))) {
          throw new ShopPurchaseError('鱼骨数量不足，请刷新仓库后重试', 'INSUFFICIENT_ASSETS', 409);
        }
        const balance = await tx.creditBoneSale(userId, amount, {
          sourceKey: `bone-sale:${requestKey}`,
          title: '鱼骨出售',
          reason: `出售${BONE_NAMES[itemKey]} × ${quantity}，每个 ${unitPrice} 磁元，共收入 ${amount} 磁元`,
        });
        const receipt = {
          action: 'sell',
          itemKey,
          quantity,
          unitPrice,
          currency: 'magnetic',
          amount,
          purchaseNumber: count + 1,
          remainingQuantity: await tx.saleAssetQuantity(userId, itemKey),
          balance,
          unlocked,
          replayed: false,
        };
        await tx.advance(userId, counterKey, count + 1);
        await tx.record(userId, requestKey, counterKey, fingerprint, receipt);
        return receipt;
      });
    },
  };
}

function createBoneSalesRouter({
  pool,
  requireAuth,
  sales = createBoneSales(createMysqlEconomyStore(pool)),
}) {
  const router = express.Router();
  router.post('/shop/sell', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (pool) await ensureWalletLedger(pool);
      const { itemKey, quantity, requestKey } = req.body || {};
      const receipt = await sales.sell({ userId: user.id, itemKey, quantity, requestKey });
      res.set('Cache-Control', 'private, no-store');
      res.json({
        receipt,
        message: `已出售${BONE_NAMES[itemKey]} × ${receipt.quantity}，收入 ${receipt.amount} 磁元`,
      });
    } catch (error) {
      if (error instanceof ShopPurchaseError) {
        res.status(error.status).json({ code: error.code, message: error.message });
        return;
      }
      res.status(500).json({ code: 'SALE_FAILED', message: '出售暂时无法完成，请稍后重试' });
    }
  });
  return router;
}

module.exports = { BONE_SALE_PRICES, createBoneSales, createBoneSalesRouter };
