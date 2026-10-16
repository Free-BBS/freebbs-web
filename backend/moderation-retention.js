const fs = require('node:fs/promises');
const path = require('node:path');

const MODERATION_RETENTION_DAYS = 90;
const upgrades = new WeakMap();

function ensureModerationRetention(pool) {
  if (!upgrades.has(pool)) {
    const pending = (async () => {
      const sql = await fs.readFile(
        path.join(__dirname, '../database/migrations/071_moderation_retention_90_days.sql'),
        'utf8',
      );
      const db = await pool.getConnection();
      try {
        // Keep the cutoff and every parent/child update on the same connection.
        // The migration also runs as a standalone SQL file and is idempotent.
        for (const statement of sql
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean))
          await db.query(statement);
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    })().catch((error) => {
      upgrades.delete(pool);
      throw error;
    });
    upgrades.set(pool, pending);
  }
  return upgrades.get(pool);
}

module.exports = { MODERATION_RETENTION_DAYS, ensureModerationRetention };
