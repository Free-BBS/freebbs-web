const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const {
  normalizeExportScope,
  createScopedExport,
  mountAiDialogExportRoutes,
} = require('./ai-dialog-export-router');

const selection = () => ({
  userIds: [2],
  dialogIds: [11],
  from: '2026-10-01T00:00:00.000Z',
  until: '2026-10-08T00:00:00.000Z',
  reason: '核查用户举报的违规事项',
});
const admin = { id: 1, uid: 'admin-uid', username: 'test-admin' };
function fixture(options = {}) {
  const calls = [];
  const user = {
    id: 2,
    uid: 'student-uid',
    username: 'student',
    full_name: '虚构同学',
    role: 'student',
  };
  const row = {
    id: 11,
    user_id: 2,
    did: 'dialog-test',
    title: '虚构会话',
    messages_json: '[{"role":"user","content":"SECRET_BODY_TEST"}]',
    created_at: '2026-09-01',
    updated_at: '2026-10-03',
  };
  const connection = {
    async execute(sql, params) {
      calls.push({ side: 'connection', sql, params });
      if (sql.startsWith('SET TRANSACTION')) return [];
      if (sql.includes('FROM users')) return [[user]];
      if (sql.includes('OCTET_LENGTH'))
        return [options.missing ? [] : [{ id: 11, content_bytes: options.bytes || 60 }]];
      if (sql.includes('FROM ai_dialogs')) return [[row]];
      if (sql.startsWith('UPDATE ai_dialog_export_audit')) {
        if (options.finishAuditFails) throw new Error('secret database failure');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query ${sql}`);
    },
    async beginTransaction() {
      calls.push({ action: 'begin' });
    },
    async commit() {
      calls.push({ action: 'commit' });
      if (options.commitFails) throw new Error('commit secret');
    },
    async rollback() {
      calls.push({ action: 'rollback' });
    },
    release() {
      calls.push({ action: 'release' });
    },
  };
  const pool = {
    async execute(sql, params) {
      calls.push({ side: 'pool', sql, params });
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.startsWith('INSERT INTO ai_dialog_export_audit')) {
        if (options.beginAuditFails) throw new Error('database credentials secret');
        return [{ insertId: 88 }];
      }
      if (sql.startsWith('UPDATE ai_dialog_export_audit')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM ai_dialogs'))
        return [[{ id: 11, user_id: 2, title: row.title, updated_at: row.updated_at }]];
      if (sql.includes('FROM ai_dialog_export_audit')) return [[]];
      throw new Error(`unexpected pool query ${sql}`);
    },
    async getConnection() {
      calls.push({ action: 'connection' });
      return connection;
    },
  };
  return { pool, calls };
}

test('requires explicit user, conversation, bounded time and meaningful investigation reason', () => {
  for (const patch of [
    { userIds: [] },
    { userIds: ['2'] },
    { userIds: [2, 2] },
    { userIds: [0] },
    { userIds: Array.from({ length: 11 }, (_, i) => i + 1) },
    { dialogIds: [] },
    { dialogIds: Array.from({ length: 101 }, (_, i) => i + 1) },
    { from: '' },
    { from: '2026-10-08T00:00:00.000Z' },
    { from: '2026-09-01T00:00:00.000Z' },
    { from: '2026-02-31T00:00:00.000Z' },
    { reason: '  ' },
    { reason: '1234' },
    { reason: 'a'.repeat(1001) },
  ])
    assert.throws(() => normalizeExportScope({ ...selection(), ...patch }), { status: 400 });
  assert.throws(() => normalizeExportScope(null), { status: 400 });
  const normalized = normalizeExportScope(selection());
  assert.equal(normalized.from.toISOString(), selection().from);
});

test('catalog still requires user and time, but never requires arbitrary conversation ids', () => {
  const input = selection();
  delete input.dialogIds;
  delete input.reason;
  assert.deepEqual(normalizeExportScope(input, { requireDialogs: false }).userIds, [2]);
  assert.throws(
    () => normalizeExportScope({ from: input.from, until: input.until }, { requireDialogs: false }),
    { status: 400 },
  );
});

test('export selects only explicit IDs in time range and commits metadata audit before returning file', async () => {
  const { pool, calls } = fixture();
  const result = await createScopedExport(pool, admin, normalizeExportScope(selection()));
  const data = JSON.parse(result.json);
  assert.equal(data.scope.auditId, 88);
  assert.equal(data.scope.timeBasis, 'dialog_updated_at');
  assert.equal(data.scope.wholeSelectedConversations, true);
  assert.equal(data.users.length, 1);
  assert.equal(data.users[0].dialogs[0].messages[0].content, 'SECRET_BODY_TEST');
  const reads = calls.filter((item) => item.sql?.includes('FROM ai_dialogs'));
  for (const read of reads) {
    assert.match(
      read.sql,
      /user_id IN \(\?\) AND updated_at >= \? AND updated_at < \? AND id IN \(\?\)/,
    );
    assert.deepEqual(read.params, [2, new Date(selection().from), new Date(selection().until), 11]);
  }
  assert.ok(
    calls.findIndex((x) => x.sql?.startsWith('INSERT INTO ai_dialog_export_audit')) <
      calls.findIndex((x) => x.action === 'connection'),
  );
  assert.ok(
    calls.findIndex((x) => x.sql?.includes("status = 'generated'")) <
      calls.findIndex((x) => x.action === 'commit'),
  );
  const audits = calls.filter((item) => item.sql?.includes('ai_dialog_export_audit'));
  assert.doesNotMatch(JSON.stringify(audits), /SECRET_BODY_TEST|Bearer|messages_json/);
  assert.equal(calls.at(-1).action, 'release');
});

test('rejects other-user or stale/out-of-range conversation instead of partially exporting', async () => {
  const { pool, calls } = fixture({ missing: true });
  await assert.rejects(createScopedExport(pool, admin, normalizeExportScope(selection())), {
    code: 'selection_changed',
    status: 409,
  });
  assert.equal(calls.filter((x) => x.sql?.includes('messages_json, created_at')).length, 0);
  assert.ok(calls.some((x) => x.action === 'rollback'));
  assert.ok(calls.some((x) => x.params?.[0] === 'selection_changed'));
  assert.ok(
    calls.findIndex((x) => x.action === 'release') <
      calls.findIndex((x) => x.params?.[0] === 'selection_changed'),
    'release before obtaining another pool slot for failure audit',
  );
});

test('size preflight prevents loading excessively large message bodies', async () => {
  const { pool, calls } = fixture({ bytes: 26 * 1024 * 1024 });
  await assert.rejects(createScopedExport(pool, admin, normalizeExportScope(selection())), {
    status: 413,
  });
  assert.equal(calls.filter((x) => x.sql?.includes('messages_json, created_at')).length, 0);
});

for (const option of ['beginAuditFails', 'finishAuditFails', 'commitFails']) {
  test(`no file is returned when durable audit fails: ${option}`, async () => {
    const { pool, calls } = fixture({ [option]: true });
    await assert.rejects(createScopedExport(pool, admin, normalizeExportScope(selection())));
    if (option === 'beginAuditFails')
      assert.equal(
        calls.some((x) => x.action === 'connection'),
        false,
      );
    else assert.ok(calls.some((x) => x.action === 'rollback'));
  });
}

async function server(t, options = {}) {
  const { pool, calls } = fixture(options);
  const app = express();
  app.use(express.json());
  mountAiDialogExportRoutes(app, {
    pool,
    ensureAiDialogTables: async () => {},
    requireAdmin: async (request, response) => {
      if (request.headers.authorization !== 'Bearer admin') {
        response.status(403).json({ message: '管理员权限不足' });
        return null;
      }
      return admin;
    },
  });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    listener.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        listener.close(resolve);
        listener.closeAllConnections();
      }),
  );
  return { calls, url: `http://127.0.0.1:${listener.address().port}/api/admin/ai-dialogs` };
}

test('all export, catalog and audit endpoints enforce admin authorization before database reads', async (t) => {
  const { url, calls } = await server(t);
  for (const [route, method] of [
    ['export', 'GET'],
    ['export', 'POST'],
    ['export-catalog', 'POST'],
    ['export-audit', 'GET'],
  ]) {
    const response = await fetch(`${url}/${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(selection()) } : {}),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(calls.length, 0);
});

test('legacy full export is disabled and catalog cannot be requested without a selected user', async (t) => {
  const { url, calls } = await server(t);
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url}/export`, { headers })).status, 405);
  const response = await fetch(`${url}/export-catalog`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('POST returns noncacheable attachment with matching audit id', async (t) => {
  const { url } = await server(t);
  const response = await fetch(`${url}/export`, {
    method: 'POST',
    headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    body: JSON.stringify(selection()),
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('Content-Disposition'),
    /^attachment; filename="free-bbs-ai-chats-/,
  );
  assert.equal(response.headers.get('X-Export-Audit-Id'), '88');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).scope.auditId, 88);
});

test('provider/database exception text is not exposed in API error responses', async (t) => {
  const { url } = await server(t, { beginAuditFails: true });
  const response = await fetch(`${url}/export`, {
    method: 'POST',
    headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    body: JSON.stringify(selection()),
  });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /credentials|secret/);
});
