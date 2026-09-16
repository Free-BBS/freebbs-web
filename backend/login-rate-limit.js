const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WINDOW_SECONDS = 15 * 60;
const ACCOUNT_ATTEMPTS = 5;
// A higher IP budget accommodates students sharing a campus network.
const IP_ATTEMPTS = 300;
const schemaReady = new WeakMap();

async function ensureLoginRateTable(pool) {
  if (!schemaReady.has(pool)) {
    const promise = (async () => {
      const sql = fs
        .readFileSync(
          path.join(__dirname, '../database/migrations/042_auth_login_attempts.sql'),
          'utf8',
        )
        .trim()
        .replace(/;$/, '');
      await pool.query(sql);
    })();
    schemaReady.set(pool, promise);
    promise.catch(() => schemaReady.delete(pool));
  }
  await schemaReady.get(pool);
}

function scopeHash(scope, value) {
  return crypto.createHash('sha256').update(`login:${scope}:${value}`).digest('hex');
}

function accountScope(user, identifier) {
  // The database resolves username, email and case variants to the same user.
  return scopeHash(
    'account',
    user?.id == null ? `missing:${String(identifier).trim().toLowerCase()}` : `id:${user.id}`,
  );
}

function createLoginRateLimiter({
  pool,
  accountAttempts = ACCOUNT_ATTEMPTS,
  ipAttempts = IP_ATTEMPTS,
  now = () => Date.now(),
} = {}) {
  if (!pool || typeof pool.execute !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('A database pool is required for login rate limiting');
  }
  let cleanupPromise;
  let nextCleanupAt = 0;

  async function cleanupExpiredRows() {
    if (now() < nextCleanupAt) return;
    if (!cleanupPromise) {
      cleanupPromise = pool
        .execute(
          'DELETE FROM auth_login_attempts WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)',
        )
        .then(() => {
          nextCleanupAt = now() + 60 * 60 * 1000;
        })
        .finally(() => {
          cleanupPromise = null;
        });
    }
    await cleanupPromise;
  }

  async function consume(key, limit) {
    await ensureLoginRateTable(pool);
    await cleanupExpiredRows();
    await pool.execute(
      'INSERT IGNORE INTO auth_login_attempts (scope_hash, attempts, expires_at) VALUES (?, 0, UTC_TIMESTAMP(3))',
      [key],
    );
    // The conditional UPDATE is atomic across backend processes. The first five
    // attempts reserve a slot before password verification; later ones do no hash.
    const [update] = await pool.execute(
      `UPDATE auth_login_attempts
       SET attempts = CASE WHEN expires_at <= UTC_TIMESTAMP(3) THEN 1 ELSE attempts + 1 END,
           expires_at = CASE WHEN expires_at <= UTC_TIMESTAMP(3)
             THEN DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) ELSE expires_at END
       WHERE scope_hash = ? AND (expires_at <= UTC_TIMESTAMP(3) OR attempts < ?)`,
      [WINDOW_SECONDS, key, limit],
    );
    if (update.affectedRows === 1) return { allowed: true, retryAfterSeconds: 0 };
    const [[row]] = await pool.execute(
      `SELECT GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), expires_at) / 1000000))
         AS retry_after_seconds
       FROM auth_login_attempts WHERE scope_hash = ?`,
      [key],
    );
    return { allowed: false, retryAfterSeconds: Number(row?.retry_after_seconds || 1) };
  }

  return {
    consumeIp(request) {
      const address = String(request.ip || request.socket?.remoteAddress || 'unknown');
      return consume(scopeHash('ip', address), ipAttempts);
    },
    consumeAccount(user, identifier) {
      return consume(accountScope(user, identifier), accountAttempts);
    },
    async resetAccount(user) {
      if (user?.id == null) return;
      await pool.execute('DELETE FROM auth_login_attempts WHERE scope_hash = ?', [
        accountScope(user),
      ]);
    },
  };
}

module.exports = { createLoginRateLimiter, ensureLoginRateTable };
