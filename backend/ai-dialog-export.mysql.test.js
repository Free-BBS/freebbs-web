const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const {
  ensureAiDialogExportAudit,
  normalizeExportScope,
  createScopedExport,
} = require('./ai-dialog-export-router');

test(
  'isolated MySQL: scoped AI chat exports persist audits and exclude unselected conversations',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    await assertIsolatedMysql(connection);
    const database = `ai_export_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^ai_export_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    // One connection exercises the error path: the read transaction must be
    // released before the pool is asked to persist the failure audit.
    const pool = mysql.createPool({ ...config, database, connectionLimit: 1 });
    t.after(() => pool.end());
    await pool.execute(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, uid VARCHAR(64), username VARCHAR(64), full_name VARCHAR(64), student_id VARCHAR(16), role VARCHAR(16)) ENGINE=InnoDB',
    );
    await pool.execute(
      "INSERT INTO users VALUES (1,'admin-id','admin','管理员','','admin'),(2,'student-id','student','虚构同学','','student'),(3,'other-id','other','另一同学','','student')",
    );
    await pool.execute(
      'CREATE TABLE ai_dialogs (id BIGINT PRIMARY KEY, did VARCHAR(64), user_id BIGINT, title VARCHAR(120), messages_json LONGTEXT, created_at DATETIME(3), updated_at DATETIME(3)) ENGINE=InnoDB',
    );
    const inside = new Date('2026-10-03T08:00:00.000Z');
    const outside = new Date('2026-09-03T08:00:00.000Z');
    for (const [id, user, when] of [
      [11, 2, inside],
      [12, 2, inside],
      [13, 2, outside],
      [14, 3, inside],
    ]) {
      await pool.execute('INSERT INTO ai_dialogs VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id,
        `did-${id}`,
        user,
        `虚构会话-${id}`,
        JSON.stringify([{ role: 'user', content: `SECRET_BODY_${id}` }]),
        outside,
        when,
      ]);
    }
    await ensureAiDialogExportAudit(pool);
    const request = {
      userIds: [2],
      dialogIds: [11],
      from: '2026-10-01T00:00:00.000Z',
      until: '2026-10-08T00:00:00.000Z',
      reason: '核查虚构用户举报事项',
    };
    const admin = { id: 1, uid: 'admin-id', username: 'admin' };
    const output = await createScopedExport(pool, admin, normalizeExportScope(request));
    const payload = JSON.parse(output.json);
    assert.equal(payload.users.length, 1);
    assert.deepEqual(
      payload.users[0].dialogs.map((row) => row.id),
      [11],
    );
    assert.doesNotMatch(output.json, /SECRET_BODY_12|SECRET_BODY_13|SECRET_BODY_14/);
    let [[audit]] = await pool.execute('SELECT * FROM ai_dialog_export_audit WHERE id = ?', [
      output.auditId,
    ]);
    assert.equal(audit.status, 'generated');
    assert.equal(audit.actor_user_id, 1);
    assert.equal(audit.reason, request.reason);
    assert.deepEqual(audit.user_ids_json, [2]);
    assert.deepEqual(audit.dialog_ids_json, [11]);
    assert.equal(audit.range_start.toISOString(), request.from);
    assert.equal(audit.range_end.toISOString(), request.until);
    assert.equal(audit.dialog_count, 1);
    assert.equal(audit.message_count, 1);
    assert.equal(audit.byte_count, Buffer.byteLength(output.json));
    assert.ok(audit.finished_at);
    assert.doesNotMatch(JSON.stringify(audit), /SECRET_BODY/);
    for (const ids of [[11, 14], [13], [999]]) {
      await assert.rejects(
        createScopedExport(pool, admin, normalizeExportScope({ ...request, dialogIds: ids })),
        { code: 'selection_changed' },
      );
    }
    const [failures] = await pool.execute(
      "SELECT * FROM ai_dialog_export_audit WHERE status = 'failed'",
    );
    assert.equal(failures.length, 3);
    assert.ok(
      failures.every((row) => row.failure_code === 'selection_changed' && row.dialog_count === 0),
    );
    await pool.execute('DELETE FROM users WHERE id = 1');
    [[audit]] = await pool.execute(
      'SELECT actor_username FROM ai_dialog_export_audit WHERE id = ?',
      [output.auditId],
    );
    assert.equal(audit.actor_username, 'admin', 'actor metadata survives account deletion');
  },
);
