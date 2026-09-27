const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createRanchWorldRouter, ensureRanchWorldTables } = require('./ranch-world');
const { blank } = require('../public/ranch-design-data');

test('startup creates and seeds the world without enabling multi-statement SQL', async () => {
  const queries = [];
  await ensureRanchWorldTables({
    query: async (sql) => {
      assert.ok(!sql.includes(';'));
      queries.push(sql);
    },
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS ranch_world_state/);
  assert.match(queries[1], /INSERT IGNORE/);
});
test('fast cycling persists its travel across workers, dismounting and repeated rides', async (t) => {
  const h = await harness(t);
  assert.equal((await h.action({ kind: 'bicycle', actor: 'u_owner01' })).status, 200);
  const a = await h.snapshot('a');
  assert.deepEqual(a, await h.snapshot('b'));
  assert.deepEqual(a.sheep[0].motion, { offset: 0, start: 100000, duration: 10000 });
  h.advance(11000);
  assert.equal((await h.snapshot()).events.length, 0);
  assert.deepEqual((await h.snapshot()).sheep[0].motion, a.sheep[0].motion);
  assert.equal((await h.action({ kind: 'bicycle', actor: 'u_owner01' })).status, 200);
  assert.equal((await h.snapshot('b')).sheep[0].motion.offset, 30000);
  h.advance(11000);
  const flip = await h.action({ kind: 'backflip', actor: 'u_owner01' });
  assert.equal((await flip.json()).events[0].duration, 1500);
});

async function harness(t) {
  let time = 100000;
  let state = { revision: 0, state_json: JSON.stringify({ scene: 'meadow', events: [] }) };
  const rows = [
    {
      id: 1,
      uid: 'u_owner01',
      username: 'Alice',
      revision: 1,
      design_json: JSON.stringify(blank()),
      ranch_assets: 'ranch_backflip:1,ranch_bicycle:1',
      fed_until_ms: 200000,
    },
    {
      id: 2,
      uid: 'u_owner02',
      username: 'Bob',
      revision: 0,
      design_json: null,
      ranch_assets: '',
      fed_until_ms: 200000,
    },
    {
      id: 3,
      uid: 'u_owner03',
      username: 'Carol',
      revision: 0,
      design_json: null,
      ranch_assets: '',
      fed_until_ms: 200000,
    },
    {
      id: 4,
      uid: 'u_owner04',
      username: 'Hungry',
      revision: 0,
      design_json: null,
      ranch_assets: '',
      fed_until_ms: 0,
    },
  ];
  let lock = Promise.resolve();
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM users u')) return [rows];
      if (sql.includes('ranch_world_state')) return [[structuredClone(state)]];
      throw new Error(sql);
    },
    async getConnection() {
      let pending;
      let release;
      return {
        async beginTransaction() {
          const prior = lock;
          lock = new Promise((resolve) => {
            release = resolve;
          });
          await prior;
        },
        async execute(sql, values) {
          if (sql.startsWith('UPDATE ranch_world_state')) {
            pending = { revision: values[1], state_json: values[0] };
            return [{}];
          }
          return pool.execute(sql);
        },
        async commit() {
          if (pending) state = pending;
          release();
        },
        async rollback() {
          release();
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  const requireAuth = async (req, res) => {
    const id = Number(req.headers['x-user']);
    if (!id) {
      res.status(401).json({ message: '登录' });
      return null;
    }
    return { id, uid: rows.find((row) => row.id === id)?.uid };
  };
  // Two independent routers emulate different backend workers sharing only the database.
  app.use('/a', createRanchWorldRouter({ pool, requireAuth, now: () => time }));
  app.use('/b', createRanchWorldRouter({ pool, requireAuth, now: () => time }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const action = (body, id = 1, worker = 'a') =>
    fetch(`${url}/${worker}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user': String(id) },
      body: JSON.stringify(body),
    });
  const snapshot = (worker = 'a') => fetch(`${url}/${worker}`).then((res) => res.json());
  return {
    url,
    action,
    snapshot,
    advance: (ms) => {
      time += ms;
    },
  };
}
test('a persisted stroll sends the signed-in sheep to the selected target across workers and late viewers', async (t) => {
  const h = await harness(t);
  const res = await h.action({
    kind: 'stroll',
    actor: 'u_owner02',
    target: 'u_owner03',
    partner: 'u_fake',
    x: -100,
  });
  assert.equal(res.status, 200);
  const a = await h.snapshot('a');
  const b = await h.snapshot('b');
  assert.deepEqual(a, b);
  assert.equal(a.events[0].actor, 'u_owner01');
  assert.equal(a.events[0].partner, 'u_owner03');
  assert.ok(a.events[0].origin.x >= 4);
  assert.ok(a.events[0].meeting.x >= 4);
  assert.equal(a.events[0].by, undefined);
  assert.equal(a.sheep[0].id, undefined);
  h.advance(2000);
  assert.equal((await h.snapshot('b')).events[0].id, a.events[0].id);
  assert.equal((await h.action({ kind: 'pet', actor: 'u_owner01' })).status, 429);
  h.advance(17000);
  assert.equal((await h.snapshot()).events.length, 0);
});
test('stroll rejects self, missing, and hungry targets; hungry owners cannot walk or perform tricks', async (t) => {
  const h = await harness(t);
  for (const target of ['u_owner01', 'u_missing', undefined])
    assert.equal((await h.action({ kind: 'stroll', target })).status, 400);
  assert.equal((await h.action({ kind: 'stroll', target: 'u_owner04' })).status, 409);
  assert.equal((await h.action({ kind: 'stroll', target: 'u_owner02' }, 4)).status, 409);
  assert.equal((await h.action({ kind: 'backflip', actor: 'u_owner04' }, 4)).status, 409);
  assert.equal((await h.action({ kind: 'bicycle', actor: 'u_owner04' }, 4)).status, 409);
  assert.equal((await h.snapshot()).sheep[3].fedUntilMs, 0);
  assert.equal((await h.snapshot()).revision, 0);
});
test('authenticated unlock/ownership checks and persisted shared scene changes', async (t) => {
  const h = await harness(t);
  assert.equal((await h.action({ kind: 'pet', actor: 'u_owner01' }, 0)).status, 401);
  assert.equal((await h.action({ kind: 'backflip', actor: 'u_owner01' }, 2)).status, 403);
  assert.equal((await h.action({ kind: 'bicycle', actor: 'u_owner02' }, 2)).status, 403);
  assert.equal((await h.action({ kind: 'pet', actor: 'u_missing' })).status, 404);
  assert.equal((await h.action({ kind: 'scene', scene: '<script>' })).status, 400);
  assert.equal((await h.action({ kind: 'scene', scene: 'lake' })).status, 200);
  assert.equal((await h.snapshot('b')).scene, 'lake');
  h.advance(4000);
  assert.equal((await h.action({ kind: 'bicycle', actor: 'u_owner01' })).status, 200);
  assert.equal((await h.snapshot('b')).events[0].kind, 'bicycle');
});
test('SSE sends the durable snapshot and closes when the viewer disconnects', async (t) => {
  const h = await harness(t);
  const abort = new AbortController();
  const response = await fetch(`${h.url}/a/stream`, { signal: abort.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /event: world/);
  assert.match(text, /"serverNowMs":100000/);
  assert.doesNotMatch(text, /"by"/);
  abort.abort();
});
test('another visitor replacing an interaction cannot erase the first user cooldown', async (t) => {
  const h = await harness(t);
  const results = await Promise.all([
    h.action({ kind: 'pet', actor: 'u_owner01' }, 1, 'a'),
    h.action({ kind: 'pet', actor: 'u_owner01' }, 2, 'b'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  assert.equal((await h.snapshot()).revision, 2);
  assert.equal((await h.action({ kind: 'pet', actor: 'u_owner02' }, 1)).status, 429);
});
