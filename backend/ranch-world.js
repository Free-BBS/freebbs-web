const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { fields, join, adopted, serialize } = require('./ranch-designs');
const world = require('../public/ranch-world-data');

async function ensureRanchWorldTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/055_ranch_shared_world.sql'),
    'utf8',
  );
  // Production intentionally disables multipleStatements on its application pool.
  for (const statement of sql
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean))
    await pool.query(statement);
}
function readState(row) {
  const data = typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json;
  return {
    scene: data.scene || 'meadow',
    events: Array.isArray(data.events) ? data.events : [],
    cooldowns: data.cooldowns || {},
  };
}
function createRanchWorldRouter({ pool, requireAuth, now = Date.now }) {
  const router = express.Router();
  let cached = null;
  let cachedAt = 0;
  async function flock(connection = pool) {
    const [rows] = await connection.execute(
      `SELECT ${fields} FROM users u ${join} WHERE u.uid IS NOT NULL AND ${adopted} ORDER BY u.uid ASC`,
    );
    return rows.map(serialize);
  }
  async function snapshot() {
    const time = now();
    if (!cached || time - cachedAt > 5000) {
      cached = await flock();
      cachedAt = time;
    }
    const [rows] = await pool.execute(
      'SELECT revision, state_json FROM ranch_world_state WHERE id = 1',
    );
    const state = readState(rows[0]);
    return {
      revision: Number(rows[0].revision),
      scene: state.scene,
      events: state.events
        .filter((event) => event.start + event.duration > time)
        .map(({ by, ...event }) => event),
      sheep: cached,
      serverNowMs: now(),
    };
  }
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', async (_req, res) => {
    try {
      res.json(await snapshot());
    } catch {
      res.status(503).json({ message: '牧场同步暂不可用，请稍后重试' });
    }
  });
  router.get('/stream', (_req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let stopped = false;
    let timer;
    async function send() {
      try {
        const data = await snapshot();
        if (!stopped) res.write(`event: world\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        if (!stopped) res.write('event: unavailable\ndata: {}\n\n');
      }
      if (!stopped) timer = setTimeout(send, 1500);
    }
    res.on('close', () => {
      stopped = true;
      clearTimeout(timer);
    });
    send();
  });
  router.post('/actions', async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const { kind, actor: uid, scene } = req.body || {};
    if (
      !['greet', 'pet', 'stroll', 'backflip', 'bicycle', 'scene'].includes(kind) ||
      (kind === 'scene' && !['meadow', 'lake', 'courtyard', 'wall'].includes(scene))
    )
      return res.status(400).json({ message: '牧场操作无效' });
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT revision, state_json FROM ranch_world_state WHERE id = 1 FOR UPDATE',
      );
      const state = readState(rows[0]);
      const time = now();
      state.events = state.events.filter((event) => event.start + event.duration > time);
      if (time - (state.cooldowns[String(user.id)] || 0) < 3000) {
        await connection.rollback();
        return res.status(429).json({ message: '让 Max 喘口气，3 秒后再试' });
      }
      const sheep = await flock(connection);
      const actor = sheep.find((item) => item.uid === uid);
      if (kind !== 'scene' && !actor) {
        await connection.rollback();
        return res.status(404).json({ message: '这只羊暂时不在牧场里' });
      }
      if (
        ['backflip', 'bicycle'].includes(kind) &&
        (actor.uid !== user.uid || !actor.assets?.[`ranch_${kind}`])
      ) {
        await connection.rollback();
        return res.status(403).json({ message: '只能让自己的羊使用已经购买的动作或载具' });
      }
      const revision = Number(rows[0].revision) + 1;
      state.cooldowns = Object.fromEntries(
        Object.entries(state.cooldowns).filter(([, last]) => time - last < 3000),
      );
      state.cooldowns[String(user.id)] = time;
      const event = {
        id: revision,
        by: String(user.id),
        actor: uid || '',
        kind,
        start: time,
        duration: kind === 'stroll' ? 12000 : kind === 'bicycle' ? 10000 : 3000,
      };
      if (kind === 'scene') state.scene = scene;
      else if (['greet', 'stroll'].includes(kind)) {
        const position = world.positionFor(actor, sheep.indexOf(actor), sheep, time, state.events);
        event.partner = sheep
          .filter((item) => item !== actor)
          .sort((a, b) => {
            const distance = (item) => {
              const point = world.positionFor(item, sheep.indexOf(item), sheep, time, state.events);
              return Math.hypot(point.x - position.x, (point.top - position.top) * 2);
            };
            return distance(a) - distance(b);
          })[0]?.uid;
      }
      state.events = state.events.filter(
        (item) =>
          ![event.actor, event.partner]
            .filter(Boolean)
            .some((id) => item.actor === id || item.partner === id),
      );
      state.events.push(event);
      state.events = state.events.slice(-64);
      await connection.execute(
        'UPDATE ranch_world_state SET state_json = ?, revision = ? WHERE id = 1',
        [JSON.stringify(state), revision],
      );
      await connection.commit();
      cached = null;
      res.json({
        revision,
        scene: state.scene,
        events: state.events.map(({ by, ...item }) => item),
        sheep,
        serverNowMs: now(),
      });
    } catch {
      if (connection) await connection.rollback().catch(() => {});
      res.status(503).json({ message: '牧场操作未完成，请稍后重试' });
    } finally {
      connection?.release();
    }
  });
  return router;
}
module.exports = { createRanchWorldRouter, ensureRanchWorldTables, readState };
