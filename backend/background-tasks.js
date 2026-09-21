const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const SCHEMA = fs
  .readFileSync(path.join(__dirname, '../database/migrations/044_ai_background_tasks.sql'), 'utf8')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);
const schemaPromises = new WeakMap();
const ALLOWED_KINDS = new Set(['max', 'circuit_suggest', 'circuit_agent']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function ensureBackgroundTaskTables(pool) {
  if (!schemaPromises.has(pool)) {
    const pending = (async () => {
      for (const statement of SCHEMA) await pool.execute(statement);
    })().catch((error) => {
      schemaPromises.delete(pool);
      throw error;
    });
    schemaPromises.set(pool, pending);
  }
  return schemaPromises.get(pool);
}

function taskError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function parseJson(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicTask(row) {
  return {
    id: row.id,
    kind: row.kind,
    scopeId: row.scope_id || '',
    status: row.status,
    progress: parseJson(row.progress_json, null),
    result: parseJson(row.result_json, null),
    error: row.error_message || '',
    watching: Boolean(row.watching),
    acknowledged: Boolean(row.acknowledged_at),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStart(body = {}) {
  const kind = String(body.kind || '').trim();
  const scopeId = String(body.scopeId || '')
    .trim()
    .slice(0, 190);
  if (!ALLOWED_KINDS.has(kind)) throw taskError('不支持的后台任务类型。');
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload))
    throw taskError('后台任务内容无效。');
  const payloadJson = JSON.stringify(body.payload);
  if (Buffer.byteLength(payloadJson, 'utf8') > 24 * 1024 * 1024)
    throw taskError('后台任务内容超过 24 MiB。', 413);
  return { kind, scopeId, payloadJson };
}

function createBackgroundTaskService({ pool, getUser, notifyCompletion, logger = console }) {
  const runners = new Map();
  const running = new Map();
  const controllers = new Map();
  let timer = null;
  let scanning = false;

  async function notifyIfUnseen(id, expectedStatus) {
    const task = await rowFor(id);
    if (!task || task.status !== expectedStatus) return;
    if (TERMINAL.has(task.status) && task.acknowledged_at) return;
    await Promise.resolve(
      notifyCompletion?.({ userId: task.user_id, task: publicTask(task) }),
    ).catch((error) => logger.error('Background task notification failed', error));
  }

  function scheduleNotification(row) {
    if (!row || row.acknowledged_at) return;
    if (!row.watching) {
      setImmediate(() => notifyIfUnseen(row.id, row.status));
      return;
    }
    const timeout = setTimeout(() => notifyIfUnseen(row.id, row.status), 20000);
    timeout.unref?.();
  }

  async function rowFor(id, userId = null) {
    const [rows] = await pool.execute(
      `SELECT * FROM ai_background_tasks WHERE id = ?${userId ? ' AND user_id = ?' : ''} LIMIT 1`,
      userId ? [id, userId] : [id],
    );
    return rows[0] || null;
  }

  async function updateProgress(id, progress) {
    const json = JSON.stringify(progress || null).slice(0, 64000);
    await pool.execute(
      "UPDATE ai_background_tasks SET progress_json = ? WHERE id = ? AND status = 'running'",
      [json, id],
    );
  }

  async function execute(id) {
    if (running.has(id)) return running.get(id);
    const pending = (async () => {
      const [claim] = await pool.execute(
        `UPDATE ai_background_tasks SET status = 'running', started_at = COALESCE(started_at, NOW()),
           error_message = NULL
         WHERE id = ? AND status = 'queued'`,
        [id],
      );
      if (!claim.affectedRows) return;
      const row = await rowFor(id);
      try {
        const runner = runners.get(row.kind);
        if (!runner) throw new Error(`No background runner registered for ${row.kind}`);
        const user = await getUser(row.user_id);
        if (!user) throw new Error('任务用户不存在。');
        const controller = new AbortController();
        controllers.set(id, controller);
        const outcome = await runner({
          id,
          user,
          payload: parseJson(row.payload_json, {}),
          progress: (value) => updateProgress(id, value),
          signal: controller.signal,
        });
        const status = outcome?.status === 'waiting' ? 'waiting' : 'completed';
        const resultJson = JSON.stringify(outcome?.result ?? outcome ?? null);
        if (Buffer.byteLength(resultJson, 'utf8') > 24 * 1024 * 1024)
          throw new Error('后台任务结果超过 24 MiB。');
        const [updated] = await pool.execute(
          `UPDATE ai_background_tasks SET status = ?, result_json = ?, progress_json = NULL,
             completed_at = ${status === 'completed' ? 'NOW()' : 'NULL'}
           WHERE id = ? AND status = 'running'`,
          [status, resultJson, id],
        );
        if (updated.affectedRows && status === 'completed') {
          const finished = await rowFor(id);
          scheduleNotification(finished);
        } else if (updated.affectedRows && status === 'waiting') {
          const waiting = await rowFor(id);
          scheduleNotification(waiting);
        }
      } catch (error) {
        const current = await rowFor(id);
        if (current?.status === 'cancelled') return;
        const message = String(error?.message || '后台任务执行失败。').slice(0, 1000);
        await pool.execute(
          `UPDATE ai_background_tasks SET status = 'failed', error_message = ?, progress_json = NULL,
             completed_at = NOW() WHERE id = ? AND status = 'running'`,
          [message, id],
        );
        const failed = await rowFor(id);
        scheduleNotification(failed);
      }
    })()
      .catch((error) => logger.error('Background AI task failed', error))
      .finally(() => {
        controllers.delete(id);
        running.delete(id);
      });
    running.set(id, pending);
    return pending;
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const [rows] = await pool.execute(
        "SELECT id FROM ai_background_tasks WHERE status = 'queued' ORDER BY created_at LIMIT 8",
      );
      rows.forEach((row) => setImmediate(() => execute(row.id)));
    } finally {
      scanning = false;
    }
  }

  async function start() {
    await ensureBackgroundTaskTables(pool);
    await pool.execute(
      "UPDATE ai_background_tasks SET status = 'queued', watching = 0 WHERE status = 'running'",
    );
    await pool.execute(
      "UPDATE ai_background_tasks SET watching = 0 WHERE status IN ('queued','waiting')",
    );
    const [unseen] = await pool.execute(
      `SELECT * FROM ai_background_tasks
       WHERE status IN ('waiting','completed','failed') AND acknowledged_at IS NULL
       ORDER BY completed_at DESC LIMIT 100`,
    );
    unseen.forEach(scheduleNotification);
    if (!timer) {
      timer = setInterval(() => scan().catch(() => {}), 2000);
      timer.unref?.();
    }
    await scan();
  }

  async function create(user, body) {
    await ensureBackgroundTaskTables(pool);
    const input = normalizeStart(body);
    const [active] = await pool.execute(
      `SELECT * FROM ai_background_tasks
       WHERE user_id = ? AND kind = ? AND scope_id = ?
         AND status IN ('queued','running','waiting')
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, input.kind, input.scopeId],
    );
    if (active[0]) return publicTask(active[0]);
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO ai_background_tasks
       (id, user_id, kind, scope_id, payload_json, status, watching)
       VALUES (?, ?, ?, ?, ?, 'queued', 1)`,
      [id, user.id, input.kind, input.scopeId, input.payloadJson],
    );
    setImmediate(() => execute(id));
    return publicTask(await rowFor(id, user.id));
  }

  async function get(id, userId, { watching = false } = {}) {
    await ensureBackgroundTaskTables(pool);
    if (watching)
      await pool.execute(
        `UPDATE ai_background_tasks SET watching = 1
         WHERE id = ? AND user_id = ? AND status IN ('queued','running','waiting')`,
        [id, userId],
      );
    const row = await rowFor(id, userId);
    if (!row) throw taskError('后台任务不存在。', 404);
    return publicTask(row);
  }

  async function latest(userId, kind, scopeId = '') {
    await ensureBackgroundTaskTables(pool);
    if (!ALLOWED_KINDS.has(kind)) throw taskError('不支持的后台任务类型。');
    const [rows] = await pool.execute(
      `SELECT * FROM ai_background_tasks
       WHERE user_id = ? AND kind = ? AND scope_id = ? AND acknowledged_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId, kind, String(scopeId || '').slice(0, 190)],
    );
    return rows[0] ? publicTask(rows[0]) : null;
  }

  async function setPresence(id, userId, watching) {
    const [result] = await pool.execute(
      `UPDATE ai_background_tasks SET watching = ? WHERE id = ? AND user_id = ?
       AND status IN ('queued','running','waiting')`,
      [watching ? 1 : 0, id, userId],
    );
    if (!result.affectedRows && !(await rowFor(id, userId)))
      throw taskError('后台任务不存在。', 404);
  }

  async function acknowledge(id, userId) {
    const [result] = await pool.execute(
      `UPDATE ai_background_tasks SET acknowledged_at = COALESCE(acknowledged_at, NOW()), watching = 0
       WHERE id = ? AND user_id = ? AND status IN ('completed','failed','cancelled')`,
      [id, userId],
    );
    if (!result.affectedRows) throw taskError('任务尚未结束或不存在。', 409);
  }

  async function resume(id, userId, payload) {
    const row = await rowFor(id, userId);
    if (!row) throw taskError('后台任务不存在。', 404);
    if (row.status !== 'waiting') throw taskError('任务当前不需要继续。', 409);
    const payloadJson = JSON.stringify(payload || {});
    if (Buffer.byteLength(payloadJson, 'utf8') > 24 * 1024 * 1024)
      throw taskError('后台任务内容超过 24 MiB。', 413);
    await pool.execute(
      `UPDATE ai_background_tasks SET status = 'queued', payload_json = ?, result_json = NULL,
         watching = 1, completed_at = NULL WHERE id = ? AND user_id = ? AND status = 'waiting'`,
      [payloadJson, id, userId],
    );
    setImmediate(() => execute(id));
    return get(id, userId);
  }

  async function cancel(id, userId) {
    const [result] = await pool.execute(
      `UPDATE ai_background_tasks SET status = 'cancelled', watching = 0, completed_at = NOW()
       WHERE id = ? AND user_id = ? AND status IN ('queued','running','waiting')`,
      [id, userId],
    );
    if (!result.affectedRows) throw taskError('后台任务已经结束或不存在。', 409);
    controllers.get(id)?.abort();
  }

  return {
    register(kind, runner) {
      if (!ALLOWED_KINDS.has(kind) || typeof runner !== 'function')
        throw new Error('Invalid background task runner');
      runners.set(kind, runner);
    },
    start,
    stop() {
      clearInterval(timer);
      timer = null;
    },
    create,
    get,
    latest,
    setPresence,
    acknowledge,
    resume,
    cancel,
    execute,
  };
}

function createBackgroundTaskRouter({ requireAuth, service }) {
  const router = express.Router();
  const route = (handler) => async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      await handler(request, response, user);
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status ? error.message : '后台任务服务暂时不可用。',
      });
    }
  };
  router.post(
    '/tasks',
    route(async (request, response, user) => {
      response.status(202).json({ task: await service.create(user, request.body) });
    }),
  );
  router.get(
    '/tasks/latest',
    route(async (request, response, user) => {
      response.json({
        task: await service.latest(
          user.id,
          String(request.query.kind || ''),
          request.query.scopeId,
        ),
      });
    }),
  );
  router.get(
    '/tasks/:id',
    route(async (request, response, user) => {
      response.json({
        task: await service.get(request.params.id, user.id, {
          watching: request.query.watching === '1',
        }),
      });
    }),
  );
  router.post(
    '/tasks/:id/presence',
    route(async (request, response, user) => {
      await service.setPresence(request.params.id, user.id, request.body?.watching === true);
      response.json({ ok: true });
    }),
  );
  router.post(
    '/tasks/:id/acknowledge',
    route(async (request, response, user) => {
      await service.acknowledge(request.params.id, user.id);
      response.json({ ok: true });
    }),
  );
  router.post(
    '/tasks/:id/resume',
    route(async (request, response, user) => {
      response
        .status(202)
        .json({ task: await service.resume(request.params.id, user.id, request.body?.payload) });
    }),
  );
  router.post(
    '/tasks/:id/cancel',
    route(async (request, response, user) => {
      await service.cancel(request.params.id, user.id);
      response.json({ ok: true });
    }),
  );
  return router;
}

module.exports = {
  ALLOWED_KINDS,
  TERMINAL,
  ensureBackgroundTaskTables,
  normalizeStart,
  publicTask,
  createBackgroundTaskService,
  createBackgroundTaskRouter,
};
