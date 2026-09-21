const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { ensureWalletLedger, createWalletLedgerRouter } = require('./wallet-ledger');

test('wallet ledger authenticates, scopes to caller, validates filters and paginates', async (t) => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [Array.from({ length: 31 }, (_, i) => ({ id: 100 - i }))];
    },
  };
  const app = express();
  app.use(
    '/api',
    createWalletLedgerRouter({
      pool,
      requireAuth: async (req, res) => {
        if (req.headers.authorization !== 'Bearer test') {
          res.status(401).end();
          return null;
        }
        return { id: 7 };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${  server.address().port  }/api/wallet/ledger`;
  assert.equal((await fetch(base)).status, 401);
  assert.equal(calls.length, 0);
  const headers = { Authorization: 'Bearer test' };
  for (const query of ['?before=no', '?before=-1', '?currency=wrong']) {
    assert.equal((await fetch(base + query, { headers })).status, 400);
  }
  const response = await fetch(`${base  }?userId=99&before=101&currency=magnetic`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.entries.length, 30);
  assert.equal(body.nextCursor, '71');
  assert.deepEqual(calls[0].params, [7, 101]);
  assert.match(calls[0].sql, /magnetic_before <> magnetic_after/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test(
  'MySQL ledger captures all balance paths atomically, skips heat-only and never invents history',
  {
    skip: process.env.RUN_ADMIN_REWARDS_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const socketPath = process.env.ADMIN_REWARDS_MYSQL_SOCKET;
    assert.equal(
      socketPath,
      [`${String.fromCharCode(92).repeat(2)  }.`, 'pipe', 'freebbs-admin-rewards-qa'].join(
        String.fromCharCode(92),
      ),
    );
    const mysql = require('mysql2/promise');
    const config = { socketPath, user: 'root', password: '' };
    const conn = await mysql.createConnection(config);
    t.after(() => conn.end());
    const [[server]] = await conn.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    const database = `wallet_ledger_test_${  randomUUID().replaceAll('-', '')}`;
    await conn.query(`CREATE DATABASE ${  database}`);
    const pool = mysql.createPool({ ...config, database });
    t.after(() => pool.end());
    await pool.query(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, electrons BIGINT NOT NULL, manetrons BIGINT NOT NULL, heat BIGINT DEFAULT 0) ENGINE=InnoDB',
    );
    await pool.query('INSERT INTO users VALUES (1, 100, 100, 0)');
    await ensureWalletLedger(pool);
    await ensureWalletLedger(pool);
    const read = async () => (await pool.query('SELECT * FROM wallet_ledger ORDER BY id'))[0];
    assert.equal((await read()).length, 0);
    await pool.query('UPDATE users SET heat = 8 WHERE id = 1');
    assert.equal((await read()).length, 0);
    await pool.query('UPDATE users SET electrons = electrons - 25 WHERE id = 1');
    await pool.query(
      'UPDATE users SET electrons = electrons - 1, manetrons = manetrons - 1 WHERE id = 1',
    );
    await pool.query(
      'UPDATE users SET electrons = electrons - 10, manetrons = manetrons + 10 WHERE id = 1',
    );
    const tx = await pool.getConnection();
    await tx.beginTransaction();
    await tx.query('UPDATE users SET manetrons = manetrons + 50 WHERE id = 1');
    await tx.rollback();
    tx.release();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        pool.query('UPDATE users SET manetrons = manetrons + 1 WHERE id = 1'),
      ),
    );
    const rows = await read();
    assert.equal(rows.length, 8);
    assert.deepEqual([rows[0].electric_before, rows[0].electric_after], [100, 75]);
    assert.deepEqual([rows[2].electric_after, rows[2].magnetic_after], [64, 109]);
    assert.equal(rows.at(-1).magnetic_after, 114);
    for (let i = 1; i < rows.length; i += 1) {
      assert.equal(rows[i].electric_before, rows[i - 1].electric_after);
      assert.equal(rows[i].magnetic_before, rows[i - 1].magnetic_after);
    }
    await pool.query('INSERT INTO users VALUES (2, 5, 0, 0)');
    assert.equal((await read()).at(-1).electric_after, 5);
    const again = mysql.createPool({ ...config, database });
    t.after(() => again.end());
    await ensureWalletLedger(again);
    assert.equal((await read()).length, 9);
  },
);
