const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const ready = new WeakMap();
function ensureWalletLedger(pool) {
  if (!ready.has(pool))
    ready.set(
      pool,
      (async () => {
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/041_wallet_ledger.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean))
          await pool.query(statement);
        // Database triggers participate in the balance transaction, including legacy/admin paths.
        // Startup intentionally fails if TRIGGER privilege is missing; never silently lose entries.
        for (const event of ['UPDATE', 'INSERT']) {
          const name = `freebbs_wallet_after_${event.toLowerCase()}`;
          const [rows] = await pool.execute(
            'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?',
            [name],
          );
          if (rows.length) continue;
          const beforeE = event === 'UPDATE' ? 'COALESCE(OLD.electrons, 0)' : '0';
          const beforeM = event === 'UPDATE' ? 'COALESCE(OLD.manetrons, 0)' : '0';
          try {
            await pool.query(`CREATE TRIGGER ${name} AFTER ${event} ON users FOR EACH ROW
          INSERT INTO wallet_ledger (user_id, electric_before, electric_after, magnetic_before, magnetic_after)
          SELECT NEW.id, ${beforeE}, COALESCE(NEW.electrons, 0), ${beforeM}, COALESCE(NEW.manetrons, 0)
          WHERE ${beforeE} <> COALESCE(NEW.electrons, 0) OR ${beforeM} <> COALESCE(NEW.manetrons, 0)`);
          } catch (error) {
            if (error.code !== 'ER_TRG_ALREADY_EXISTS') throw error;
          }
        }
      })().catch((error) => {
        ready.delete(pool);
        throw error;
      }),
    );
  return ready.get(pool);
}
// Call inside the balance transaction, after locking the account. A current read is
// essential: the caller may already have an older REPEATABLE READ snapshot.
async function walletLedgerCheckpoint(connection, userId) {
  const [rows] = await connection.execute(
    'SELECT CAST(id AS CHAR) AS id FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
    [userId],
  );
  return String(rows[0]?.id || '0');
}

// One balance UPDATE/INSERT produces one trigger row. Never label an older row
// when the trigger is missing, or when an operation made no balance change.
async function annotateWalletLedger(connection, userId, afterId, { sourceKey, title, reason }) {
  for (const [value, limit] of [
    [sourceKey, 160],
    [title, 100],
    [reason, 1000],
  ]) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit)
      throw new Error('Invalid wallet ledger details');
  }
  const [result] = await connection.execute(
    `UPDATE wallet_ledger SET source_key = ?, title = ?, reason = ?
     WHERE user_id = ? AND id > ? AND source_key IS NULL ORDER BY id DESC LIMIT 1`,
    [sourceKey, title, reason, userId, afterId],
  );
  if (result.affectedRows !== 1) throw new Error('Wallet ledger entry missing');
}

function createWalletLedgerRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.get('/wallet/ledger', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const before = req.query.before;
      const currency = req.query.currency || 'all';
      if (
        (before !== undefined &&
          (!/^[1-9][0-9]*$/.test(String(before)) || !Number.isSafeInteger(Number(before)))) ||
        !['all', 'electric', 'magnetic'].includes(currency)
      ) {
        res.status(400).json({ message: '账本筛选或分页参数无效' });
        return;
      }
      res.set('Cache-Control', 'private, no-store');
      const conditions = ['user_id = ?'];
      const params = [user.id];
      if (before) {
        conditions.push('id < ?');
        params.push(Number(before));
      }
      if (currency === 'electric') conditions.push('electric_before <> electric_after');
      if (currency === 'magnetic') conditions.push('magnetic_before <> magnetic_after');
      const [rows] = await pool.execute(
        `SELECT id, CAST(electric_before AS CHAR) AS electric_before, CAST(electric_after AS CHAR) AS electric_after,
         CAST(magnetic_before AS CHAR) AS magnetic_before, CAST(magnetic_after AS CHAR) AS magnetic_after, title, reason, created_at
         FROM wallet_ledger WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 31`,
        params,
      );
      res.json({
        entries: rows.slice(0, 30),
        nextCursor: rows.length > 30 ? String(rows[29].id) : null,
      });
    } catch {
      res.status(500).json({ message: '账本暂时无法读取，请稍后刷新' });
    }
  });
  return router;
}
module.exports = {
  ensureWalletLedger,
  createWalletLedgerRouter,
  walletLedgerCheckpoint,
  annotateWalletLedger,
};
