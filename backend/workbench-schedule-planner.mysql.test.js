const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { createSchedulePlannerRouter } = require('./workbench-schedule-planner');

test(
  'isolated MySQL: planner preview and confirmation use executable limits and preserve schedule isolation',
  { skip: process.env.RUN_WORKBENCH_MYSQL !== '1', timeout: 30000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
    const config = isolatedMysqlConfig('WORKBENCH_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    const database = `workbench_planner_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^workbench_planner_test_[a-f0-9]{32}$/);
    let createdDatabase = false;
    let pool;
    let server;
    t.after(async () => {
      try {
        if (server)
          await new Promise((resolve) => {
            server.close(resolve);
          });
        if (pool) await pool.end();
        if (createdDatabase) await admin.query(`DROP DATABASE ${database}`);
      } finally {
        await admin.end();
      }
    });
    await assertIsolatedMysql(admin);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    createdDatabase = true;
    pool = mysql.createPool({ ...config, database, connectionLimit: 4, timezone: 'Z' });
    await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users VALUES (1), (2)');
    const schema = fs.readFileSync(
      path.join(__dirname, '../database/migrations/019_create_workbench_core.sql'),
      'utf8',
    );
    for (const statement of schema
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)) {
      await pool.query(statement);
    }

    const app = express();
    app.use(express.json());
    app.use(
      '/planner',
      createSchedulePlannerRouter({
        pool,
        requireAuth: async (request, response) => {
          if (request.headers.authorization === 'Bearer planner-qa') return { id: 1 };
          response.status(401).json({ message: '请先登录' });
          return null;
        },
        buildAgentChatPayload() {
          assert.fail('known sentences must not call an external Agent');
        },
        postAgentChat() {
          assert.fail('known sentences must not call an external Agent');
        },
      }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => {
      server.once('listening', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}/planner`;
    const post = (route, body, authenticated = true) =>
      fetch(`${base}/${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authenticated ? { Authorization: 'Bearer planner-qa' } : {}),
        },
        body: JSON.stringify(body),
      });
    const message = '明天下午5点开会，持续时间2小时';
    assert.equal((await post('preview', { message }, false)).status, 401);
    const preview = await post('preview', { message });
    assert.equal(preview.status, 200, await preview.clone().text());
    const { suggestions } = await preview.json();
    assert.equal(suggestions.length, 1);
    const [[empty]] = await pool.query('SELECT COUNT(*) AS count FROM schedule_items');
    assert.equal(Number(empty.count), 0, 'preview must not write a schedule');

    await pool.execute(
      `INSERT INTO schedule_items
      (public_id, user_id, created_by_user_id, title, start_at, end_at, status)
      VALUES ('other-account', 2, 2, '其他账号日程', ?, ?, 'confirmed')`,
      [new Date(suggestions[0].startAt), new Date(suggestions[0].endAt)],
    );
    const ownPreview = await post('preview', { message, userId: 2, limit: 0 });
    assert.equal(ownPreview.status, 200, 'another account must not create a conflict');
    const confirmed = await post('confirm', { suggestions, userId: 2, limit: 0 });
    assert.equal(confirmed.status, 201, await confirmed.clone().text());
    assert.deepEqual(await confirmed.json(), { created: 1 });
    const [saved] =
      await pool.query(`SELECT user_id, created_by_user_id, source_type, title, status,
      start_at, end_at FROM schedule_items WHERE user_id = 1`);
    assert.equal(saved.length, 1);
    assert.equal(Number(saved[0].user_id), 1);
    assert.equal(Number(saved[0].created_by_user_id), 1);
    assert.equal(saved[0].source_type, 'agent');
    assert.equal(saved[0].title, '开会');
    assert.equal(saved[0].status, 'confirmed');
    assert.equal(saved[0].start_at.toISOString(), suggestions[0].startAt);
    assert.equal(saved[0].end_at.toISOString(), suggestions[0].endAt);
    assert.equal((await post('confirm', { suggestions })).status, 409);
    const [[afterConflict]] = await pool.query(
      'SELECT COUNT(*) AS count FROM schedule_items WHERE user_id = 1',
    );
    assert.equal(Number(afterConflict.count), 1, 'conflicting confirmation must roll back');

    const crowdedStart = new Date(Math.floor((Date.now() + 35 * 86400000) / 1000) * 1000);
    const crowdedEnd = new Date(crowdedStart.getTime() + 3600000);
    const crowded = Array.from({ length: 501 }, (_, index) => [
      `crowded-${index}`,
      1,
      1,
      '已有日程',
      crowdedStart,
      crowdedEnd,
      'confirmed',
    ]);
    await pool.query(
      `INSERT INTO schedule_items
      (public_id, user_id, created_by_user_id, title, start_at, end_at, status) VALUES ?`,
      [crowded],
    );
    assert.equal(
      (await post('preview', { message: '后天下午5点开会，持续时间2小时' })).status,
      422,
    );
    const crowdedConfirm = await post('confirm', {
      suggestions: [
        {
          kind: 'deadline',
          title: '截止标记',
          startAt: new Date(crowdedStart.getTime() + 60000).toISOString(),
          endAt: new Date(crowdedStart.getTime() + 120000).toISOString(),
        },
      ],
    });
    assert.equal(crowdedConfirm.status, 409, 'deadline bypasses overlaps, never the 500-event cap');
    const [[unchanged]] = await pool.query(
      'SELECT COUNT(*) AS count FROM schedule_items WHERE user_id = 1',
    );
    assert.equal(Number(unchanged.count), 502);
  },
);
