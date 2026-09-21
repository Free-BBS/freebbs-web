const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeStart, publicTask } = require('./background-tasks');

test('background AI tasks accept only bounded supported work', () => {
  assert.deepEqual(
    normalizeStart({ kind: 'max', scopeId: 'dialog-1', payload: { messages: [] } }),
    {
      kind: 'max',
      scopeId: 'dialog-1',
      payloadJson: '{"messages":[]}',
    },
  );
  assert.equal(
    normalizeStart({ kind: 'circuit_agent', payload: { request: {} } }).kind,
    'circuit_agent',
  );
  assert.throws(() => normalizeStart({ kind: 'shell', payload: {} }), /不支持/);
  assert.throws(() => normalizeStart({ kind: 'max', payload: [] }), /内容无效/);
  assert.throws(
    () => normalizeStart({ kind: 'max', payload: { content: 'x'.repeat(25 * 1024 * 1024) } }),
    /24 MiB/,
  );
});

test('background task responses expose results without leaking stored request payloads', () => {
  const task = publicTask({
    id: 'job-1',
    kind: 'circuit_agent',
    scope_id: 'c_1',
    status: 'waiting',
    progress_json: '{"message":"等待返回"}',
    result_json: '{"actions":[{"type":"run_simulation"}]}',
    payload_json: '{"secret":"never expose"}',
    error_message: null,
    watching: 0,
    acknowledged_at: null,
    created_at: '2026-09-21T00:00:00Z',
    started_at: null,
    completed_at: null,
    updated_at: '2026-09-21T00:00:00Z',
  });
  assert.equal(task.status, 'waiting');
  assert.equal(task.watching, false);
  assert.deepEqual(task.result.actions, [{ type: 'run_simulation' }]);
  assert.equal(Object.hasOwn(task, 'payload'), false);
  assert.equal(JSON.stringify(task).includes('never expose'), false);
});

test('background task schema is durable, user-bound and indexed for recovery', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/044_ai_background_tasks.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_background_tasks/);
  assert.match(sql, /FOREIGN KEY \(user_id\) REFERENCES users/);
  assert.match(sql, /idx_ai_background_tasks_queue \(status, created_at\)/);
  assert.match(sql, /acknowledged_at DATETIME NULL/);
});

test('browser integrations leave tasks running and guard stale circuit actions', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const circuit = fs.readFileSync(path.join(__dirname, '../public/circuit-assistant.js'), 'utf8');
  assert.match(app, /startAiBackgroundTask\('max'/);
  assert.match(app, /leaveAiBackgroundTask\(aiChatState\.backgroundTaskId\)/);
  assert.match(circuit, /startAiBackgroundTask\('circuit_agent'/);
  assert.match(circuit, /画布在任务等待期间已经变化，未执行后台生成的修改/);
  assert.doesNotMatch(circuit, /页面已离开，本轮执行已停止/);
});
