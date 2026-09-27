const crypto = require('node:crypto');
const express = require('express');
const initializeOnce = require('./initialize-once');

const LANGUAGES = new Set(['c', 'cpp', 'python', 'matlab', 'verilog']);
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function validateRun(body) {
  if (!body || !LANGUAGES.has(body.language)) throw error('请选择支持的语言');
  if (typeof body.source !== 'string' || !body.source.trim()) throw error('代码不能为空');
  if (Buffer.byteLength(body.source) > 48000) throw error('代码不能超过 48 KB');
  const stdin = body.stdin ?? '';
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > 8000)
    throw error('标准输入不能超过 8 KB');
  const interval = body.interval ?? 1;
  if (!Number.isFinite(interval) || interval < 0 || interval > 5)
    throw error('每行时间须在 0 到 5 秒之间');
  const optimization = body.optimization ?? '0';
  if (!['0', '1', '2', '3', 's'].includes(optimization)) throw error('优化级别无效');
  return {
    language: body.language,
    source: body.source,
    stdin,
    interval,
    optimization,
    paused: body.paused === true,
  };
}

async function ensureLabTables(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS code_experiments (
    eid CHAR(34) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_code_experiments_user (user_id, created_at)
  )`);
}

function createLanguageLabRouter({
  pool,
  requireAuth,
  runtimeUrl = process.env.LANGUAGE_LAB_URL || 'http://127.0.0.1:8010',
  fetchImpl = fetch,
}) {
  const router = express.Router();
  const active = new Map();
  const completed = new Map();
  const ensureTables = initializeOnce(() => ensureLabTables(pool));
  const sendError = (response, failure) =>
    response
      .status(failure.status || 502)
      .json({ message: failure.status ? failure.message : '实验服务暂不可用，请稍后重试' });
  const cleanup = () => {
    for (const [id, run] of completed) if (Date.now() - run.created > 1800000) completed.delete(id);
    while (completed.size > 40) completed.delete(completed.keys().next().value);
  };

  router.get('/capabilities', async (_request, response) => {
    try {
      const upstream = await fetchImpl(`${runtimeUrl}/health`, {
        signal: AbortSignal.timeout(12000),
      });
      const health = await upstream.json();
      response.set('Cache-Control', 'no-store').json({
        ready: upstream.ok && health.ready === true,
        languages: [...LANGUAGES],
        matlabRuntime: 'GNU Octave',
        maxSeconds: 180,
      });
    } catch {
      response.json({
        ready: false,
        languages: [...LANGUAGES],
        message: '运行服务连接失败；代码草稿仍可保存',
      });
    }
  });

  router.post('/run', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    let id;
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    let timer;
    let heartbeat;
    try {
      const input = validateRun(request.body);
      if ([...active.values()].some((run) => String(run.user) === String(user.id)))
        throw error('请先停止当前实验，再运行新代码', 409);
      if (active.size >= 4) throw error('实验环境繁忙，请稍后重试', 429);
      id = `lab-${crypto.randomBytes(16).toString('hex')}`;
      active.set(id, { user: user.id, input });
      response.once('close', disconnect);
      timer = setTimeout(() => controller.abort(), 190000);
      const upstream = await fetchImpl(`${runtimeUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, id }),
        signal: controller.signal,
      });
      if (!upstream.ok)
        throw error('运行环境暂忙或未准备好，请稍后重试', upstream.status === 429 ? 429 : 503);
      response.set({
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      const send = (event) => {
        if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
      };
      send({ type: 'started', id });
      heartbeat = setInterval(() => send({ type: 'ping' }), 10000);
      heartbeat.unref?.();
      let buffer = '';
      let bytes = 0;
      let result;
      let lastTrace;
      let stdout = '';
      let stderr = '';
      const decoder = new TextDecoder();
      for await (const chunk of upstream.body) {
        bytes += chunk.length;
        if (bytes > 12 * 1024 * 1024) throw error('运行输出超过上限', 413);
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while (buffer.includes('\n')) {
          end = buffer.indexOf('\n');
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'output') {
            if (event.stream === 'stderr') stderr = (stderr + event.text).slice(-64000);
            else stdout = (stdout + event.text).slice(-64000);
          }
          if (event.type === 'trace') lastTrace = event;
          if (event.type === 'result')
            result = {
              ...event,
              stdout: event.stdout ?? stdout,
              stderr: event.stderr ?? stderr,
              ...(lastTrace ? { lastTrace } : {}),
            };
          // The worker is isolated but its stdout is untrusted. UI only renders text,
          // finite waveform numbers and PNG images, never authored HTML or script.
          if (['trace', 'output', 'status', 'result', 'error'].includes(event.type)) send(event);
        }
        if (buffer.length > 2 * 1024 * 1024) throw error('运行结果过大', 413);
      }
      if (result) {
        completed.set(id, { user: user.id, input, result, created: Date.now() });
        cleanup();
        send({ type: 'saved-run', id });
      }
      send({ type: 'done' });
      response.end();
    } catch (failure) {
      if (!response.destroyed) {
        if (response.headersSent)
          response.end(
            `${JSON.stringify({ type: 'error', message: failure.status ? failure.message : '运行中断或超时，请重试' })}\n`,
          );
        else sendError(response, failure);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      response.removeListener('close', disconnect);
      controller.abort();
      if (id) {
        active.delete(id);
        // Also cancels sleeping Python sessions after browser navigation/disconnect.
        fetchImpl(`${runtimeUrl}/control/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
          signal: AbortSignal.timeout(12000),
        }).catch(() => {});
      }
    }
  });

  router.post('/runs/:id/control', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    try {
      const run = active.get(request.params.id);
      if (!run || String(run.user) !== String(user.id)) throw error('运行不存在或已结束', 404);
      const { action, interval } = request.body || {};
      if (!['pause', 'resume', 'step', 'speed', 'stop'].includes(action)) throw error('操作无效');
      if (action === 'speed' && (!Number.isFinite(interval) || interval < 0 || interval > 5))
        throw error('每行时间须在 0 到 5 秒之间');
      const upstream = await fetchImpl(`${runtimeUrl}/control/${request.params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, interval }),
        signal: AbortSignal.timeout(12000),
      });
      if (upstream.ok && action === 'speed') run.input.interval = interval;
      response.status(upstream.status).json(await upstream.json());
    } catch (failure) {
      sendError(response, failure);
    }
  });

  router.post('/experiments', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    try {
      cleanup();
      const title = request.body?.title;
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 120)
        throw error('实验标题须为 1–120 个字符');
      const input = validateRun(request.body);
      let result = null;
      if (request.body.runId) {
        const run = completed.get(request.body.runId);
        if (!run || String(run.user) !== String(user.id))
          throw error('运行结果已过期，请重新运行后再分享', 409);
        if (
          ['language', 'source', 'stdin', 'optimization', 'interval'].some(
            (key) => run.input[key] !== input[key],
          )
        )
          throw error('代码或参数已变化，请重新运行后再分享', 409);
        result = run.result;
      }
      const document = { ...input, result };
      if (Buffer.byteLength(JSON.stringify(document)) > 2 * 1024 * 1024)
        throw error('实验结果过大，请缩小实验后重试', 413);
      await ensureTables();
      const id = `e_${crypto.randomBytes(16).toString('hex')}`;
      await pool.execute(
        'INSERT INTO code_experiments (eid, user_id, title, document_json) VALUES (?, ?, ?, ?)',
        [id, user.id, title.trim(), JSON.stringify(document)],
      );
      response.status(201).json({ experiment: { id, title: title.trim(), ...document } });
    } catch (failure) {
      sendError(response, failure);
    }
  });

  router.get('/experiments/:id', async (request, response) => {
    try {
      if (!/^e_[a-f0-9]{32}$/.test(request.params.id)) throw error('实验编号无效', 400);
      await ensureTables();
      const [rows] = await pool.execute(
        'SELECT eid, title, document_json, created_at FROM code_experiments WHERE eid = ? LIMIT 1',
        [request.params.id],
      );
      if (!rows[0]) throw error('实验不存在', 404);
      const row = rows[0];
      response.set('Cache-Control', 'public, max-age=3600').json({
        experiment: {
          id: row.eid,
          title: row.title,
          createdAt: row.created_at,
          ...JSON.parse(row.document_json),
        },
      });
    } catch (failure) {
      sendError(response, failure);
    }
  });
  return router;
}
module.exports = { validateRun, createLanguageLabRouter, ensureLabTables };
