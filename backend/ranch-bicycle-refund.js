const { walletLedgerCheckpoint, annotateWalletLedger } = require('./wallet-ledger');

const CAMPAIGN = 'ranch-bicycle-30-to-20-v1';
const REFUND = 10;

// Called after purchase tables and wallet triggers are ready. Only paid receipts
// qualify: ownership alone can also come from gifts or administrator grants.
async function refundRanchBicyclePurchases(pool) {
  let refunded = 0;
  for (;;) {
    const [pending] = await pool.execute(
      `SELECT CAST(p.id AS CHAR) AS purchase_id, CAST(p.user_id AS CHAR) AS user_id
       FROM shop_purchases p
       LEFT JOIN shop_price_refunds r ON r.purchase_id = p.id AND r.campaign_key = ?
       WHERE p.item_key = 'ranch_bicycle' AND p.currency = 'magnetic'
         AND p.amount = 30 AND r.purchase_id IS NULL
       ORDER BY p.id LIMIT 200`,
      [CAMPAIGN],
    );
    if (!pending.length) return { refunded, magnetic: refunded * REFUND };
    for (const purchase of pending) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Use the same user-first lock order as purchases and other wallet writes.
        const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [
          purchase.user_id,
        ]);
        const [receipts] = await connection.execute(
          `SELECT id FROM shop_purchases WHERE id = ? AND user_id = ?
           AND item_key = 'ranch_bicycle' AND currency = 'magnetic' AND amount = 30 FOR UPDATE`,
          [purchase.purchase_id, purchase.user_id],
        );
        const [previous] = await connection.execute(
          'SELECT purchase_id FROM shop_price_refunds WHERE campaign_key = ? AND purchase_id = ?',
          [CAMPAIGN, purchase.purchase_id],
        );
        if (!users.length || !receipts.length || previous.length) {
          await connection.commit();
          continue;
        }
        const checkpoint = await walletLedgerCheckpoint(connection, purchase.user_id);
        const [credit] = await connection.execute(
          `UPDATE users SET manetrons = manetrons + ?
           WHERE id = ? AND manetrons >= 0 AND manetrons <= ?`,
          [REFUND, purchase.user_id, Number.MAX_SAFE_INTEGER - REFUND],
        );
        if (credit.affectedRows !== 1)
          throw new Error('Bicycle refund exceeds safe wallet balance');
        await annotateWalletLedger(connection, purchase.user_id, checkpoint, {
          sourceKey: `shop-price-refund:${CAMPAIGN}:${purchase.purchase_id}`,
          title: '牧场自行车降价补差',
          reason: '牧场自行车由 30 磁元调整为 20 磁元，退还原购买差价 10 磁元。',
        });
        await connection.execute(
          `INSERT INTO shop_price_refunds (campaign_key, purchase_id, user_id, magnetic_amount)
           VALUES (?, ?, ?, ?)`,
          [CAMPAIGN, purchase.purchase_id, purchase.user_id, REFUND],
        );
        await connection.commit();
        refunded += 1;
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    }
  }
}

module.exports = { CAMPAIGN, REFUND, refundRanchBicyclePurchases };
