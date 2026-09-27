const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const designs = require('../public/ranch-design-data');

const adopted = `(EXISTS (SELECT 1 FROM user_profile_extras p WHERE p.user_id = u.id AND p.adopted = 1)
 OR EXISTS (SELECT 1 FROM user_assets a WHERE a.user_id = u.id AND a.asset_key = 'max_pet' AND a.quantity > 0))`;
const fields = `u.id, u.uid, u.username, d.design_json, d.revision`;
const join = 'LEFT JOIN user_ranch_designs d ON d.user_id = u.id';
const serialize = (row) => ({
  uid: row.uid,
  username: row.username,
  design: designs.read(row.design_json),
  revision: Number(row.revision) || 0,
});

async function ensureRanchDesignTables(pool) {
  await pool.query(
    fs.readFileSync(path.join(__dirname, '../database/migrations/054_ranch_designs.sql'), 'utf8'),
  );
}

function createRanchDesignRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  const fail = (response) => response.status(503).json({ message: '羊群暂时走远了，请稍后重试' });
  router.get('/', async (request, response) => {
    // Keyset pagination stays stable when other owners save a new design.
    const cursor = String(request.query.before || '');
    if (cursor && !/^[1-9][0-9]{0,18}$/.test(cursor))
      return response.status(400).json({ message: '分页参数无效' });
    try {
      const [rows] = await pool.execute(
        `SELECT ${fields} FROM users u ${join}
        WHERE u.uid IS NOT NULL AND ${adopted} ${cursor ? 'AND u.id < ?' : ''}
        ORDER BY u.id DESC LIMIT 25`,
        cursor ? [cursor] : [],
      );
      response.json({
        sheep: rows.slice(0, 24).map(serialize),
        next: rows.length > 24 ? String(rows[23].id) : null,
      });
    } catch {
      fail(response);
    }
  });
  router.get('/mine', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    try {
      const [rows] = await pool.execute(
        `SELECT ${fields}, ${adopted} AS adopted FROM users u ${join} WHERE u.id = ?`,
        [user.id],
      );
      if (!rows[0]) return response.status(404).json({ message: '用户不存在' });
      response.json({ ...serialize(rows[0]), adopted: Boolean(rows[0].adopted) });
    } catch {
      fail(response);
    }
  });
  router.get('/:uid', async (request, response) => {
    if (!/^u_?[a-z0-9]{6,32}$/i.test(request.params.uid))
      return response.status(400).json({ message: '用户标识无效' });
    try {
      const [rows] = await pool.execute(
        `SELECT ${fields} FROM users u ${join} WHERE u.uid = ? AND ${adopted}`,
        [request.params.uid],
      );
      if (!rows[0]) return response.status(404).json({ message: '这位用户还没有领养羊' });
      response.json(serialize(rows[0]));
    } catch {
      fail(response);
    }
  });
  router.put('/mine', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    let design;
    try {
      design = designs.validate(request.body?.design);
    } catch (error) {
      return response.status(400).json({ message: error.message });
    }
    const revision = request.body?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= 4294967295)
      return response.status(400).json({ message: '花纹版本无效，请刷新后重试' });
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      // Serialize initial inserts and concurrent tabs on the owner's row.
      const [owners] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [
        user.id,
      ]);
      if (!owners.length) throw new Error('Missing owner');
      const [rows] = await connection.execute(
        `SELECT ${adopted} AS adopted FROM users u WHERE u.id = ?`,
        [user.id],
      );
      if (!rows[0]?.adopted) {
        await connection.rollback();
        return response.status(403).json({ message: '先在牧场领养一只羊，再来为它染色吧' });
      }
      const [current] = await connection.execute(
        'SELECT revision FROM user_ranch_designs WHERE user_id = ? FOR UPDATE',
        [user.id],
      );
      if ((Number(current[0]?.revision) || 0) !== revision) {
        await connection.rollback();
        return response.status(409).json({ message: '另一页已更新花纹，请重新载入后再编辑' });
      }
      await connection.execute(
        `INSERT INTO user_ranch_designs (user_id, design_json, revision) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE design_json = VALUES(design_json), revision = VALUES(revision)`,
        [user.id, JSON.stringify(design), revision + 1],
      );
      await connection.commit();
      response.json({ design, revision: revision + 1 });
    } catch {
      if (connection) await connection.rollback().catch(() => {});
      fail(response);
    } finally {
      connection?.release();
    }
  });
  return router;
}
module.exports = { createRanchDesignRouter, ensureRanchDesignTables, serialize };
