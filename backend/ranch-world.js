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
    motions: data.motions || {},
    gear: data.gear || {},
  };
}
function equipped(item, state) {
  const choice = state.gear[item.uid];
  if (choice === 'wing' && item.assets?.ranch_flying_wings) return 'wing';
  if (choice === 'bicycle' && item.assets?.ranch_bicycle) return 'bicycle';
  if (choice === 'walk') return 'walk';
  // Existing bicycle owners keep their previous behaviour until they choose a mode.
  return item.assets?.ranch_bicycle ? 'bicycle' : 'walk';
}
function present(item, state) {
  return { ...item, motion: state.motions[item.uid] || null, gear: equipped(item, state) };
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
      sheep: cached.map((item) => present(item, state)),
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
    const { kind, actor: requestedUid, target, scene, mode } = req.body || {};
    const uid = ['stroll', 'equip'].includes(kind) ? user.uid : requestedUid;
    if (
      !['greet', 'pet', 'stroll', 'backflip', 'bicycle', 'fly', 'equip', 'scene'].includes(kind) ||
      (kind === 'scene' && !['meadow', 'lake', 'courtyard', 'wall'].includes(scene)) ||
      (kind === 'equip' && !['walk', 'bicycle', 'wing'].includes(mode))
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
      if (kind !== 'equip' && time - (state.cooldowns[String(user.id)] || 0) < 3000) {
        await connection.rollback();
        return res.status(429).json({ message: '让 Max 喘口气，3 秒后再试' });
      }
      const sheep = (await flock(connection)).map((item) => present(item, state));
      const actor = sheep.find((item) => item.uid === uid);
      if (kind !== 'scene' && !actor) {
        await connection.rollback();
        return res.status(404).json({ message: '这只羊暂时不在牧场里' });
      }
      const partner = kind === 'stroll' ? sheep.find((item) => item.uid === target) : null;
      if (kind === 'stroll' && (!partner || partner === actor)) {
        await connection.rollback();
        return res.status(400).json({ message: '请点选另一位牧场主的羊，再邀请一起散步' });
      }
      if (
        (['stroll', 'backflip', 'bicycle', 'fly'].includes(kind) && actor.fedUntilMs <= time) ||
        (kind === 'stroll' && partner.fedUntilMs <= time)
      ) {
        await connection.rollback();
        return res.status(409).json({ message: '饿肚子的 Max 正在趴着休息，吃饱后再一起玩吧' });
      }
      if (
        ['backflip', 'bicycle', 'fly'].includes(kind) &&
        (actor.uid !== user.uid ||
          (kind === 'backflip' && !actor.assets?.ranch_backflip) ||
          (kind === 'bicycle' && actor.gear !== 'bicycle') ||
          (kind === 'fly' && actor.gear !== 'wing'))
      ) {
        await connection.rollback();
        return res.status(403).json({ message: '只能让自己的羊使用已经购买的动作或载具' });
      }
      if (
        kind === 'equip' &&
        ((mode === 'bicycle' && !actor.assets?.ranch_bicycle) ||
          (mode === 'wing' && !actor.assets?.ranch_flying_wings))
      ) {
        await connection.rollback();
        return res.status(403).json({ message: '请先购买这件出行装备' });
      }
      const revision = Number(rows[0].revision) + 1;
      if (kind === 'equip') {
        const previous = state.motions[uid];
        state.motions[uid] = {
          offset:
            (previous
              ? previous.offset +
                Math.max(0, Math.min(previous.duration, time - previous.start)) *
                  (previous.bonus ?? 3)
              : 0) +
            world.travelBoost(uid, time, actor.assets, actor.gear) -
            world.travelBoost(uid, time, actor.assets, mode),
          start: time,
          duration: 0,
          bonus: 0,
        };
        actor.motion = state.motions[uid];
        state.gear[uid] = mode;
        actor.gear = mode;
        state.events = state.events.filter(
          (event) => event.actor !== uid || !['bicycle', 'fly'].includes(event.kind),
        );
        await connection.execute(
          'UPDATE ranch_world_state SET state_json = ?, revision = ? WHERE id = 1',
          [JSON.stringify(state), revision],
        );
        await connection.commit();
        cached = null;
        return res.json({
          revision,
          scene: state.scene,
          events: state.events.map(({ by, ...event }) => event),
          sheep,
          serverNowMs: now(),
        });
      }
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
        duration:
          kind === 'stroll'
            ? 18000
            : kind === 'bicycle'
              ? 10000
              : kind === 'fly'
                ? 12000
                : kind === 'backflip'
                  ? 1500
                  : 3000,
      };
      if (kind === 'bicycle' || kind === 'fly') {
        const previous = state.motions[uid];
        const offset = previous
          ? previous.offset +
            Math.max(0, Math.min(previous.duration, time - previous.start)) * (previous.bonus ?? 3)
          : 0;
        state.motions[uid] = {
          offset,
          start: time,
          duration: event.duration,
          bonus: kind === 'fly' ? 2 : 3,
        };
        actor.motion = state.motions[uid];
      }
      if (kind === 'scene') state.scene = scene;
      else if (kind === 'stroll') {
        const origin = world.positionFor(actor, sheep.indexOf(actor), sheep, time, state.events);
        const meeting = world.positionFor(
          partner,
          sheep.indexOf(partner),
          sheep,
          time,
          state.events,
        );
        const point = ({ x, top, scale, direction }) => ({ x, top, scale, direction });
        event.partner = partner.uid;
        event.origin = point(origin);
        event.meeting = point(meeting);
      } else if (kind === 'greet') {
        const position = world.positionFor(actor, sheep.indexOf(actor), sheep, time, state.events);
        event.partner = sheep
          .filter((item) => item !== actor && item.fedUntilMs > time)
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
