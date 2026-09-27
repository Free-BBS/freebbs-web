const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { once } = require('node:events');
const data = require('../public/ranch-design-data');
const { createRanchDesignRouter, serialize } = require('../backend/ranch-designs');

const splat = {
  mode: 'splat',
  blend: 'multiply',
  color: '#E78199',
  x: 0.5,
  y: 0.5,
  radius: 0.3,
  opacity: 0.8,
  angle: 0,
};
test('dye data canonicalizes colors, separates face/wool and strips arbitrary markup', () => {
  const design = data.blank();
  design.wool.layers.push({ ...splat, url: 'https://example.com', html: '<script>' });
  design.face.base = '#123456';
  const clean = data.validate({ ...design, userId: 100 });
  assert.equal(clean.wool.layers[0].color, '#e78199');
  assert.equal(clean.face.base, '#123456');
  assert.equal(clean.wool.layers[0].url, undefined);
  assert.equal(clean.userId, undefined);
  assert.deepEqual(data.read(JSON.stringify(clean)), clean);
});
test('all modes/blends validate and malicious or unbounded dye data is rejected', () => {
  for (const mode of data.modes)
    for (const blend of data.blends) {
      const design = data.blank();
      design.wool.layers = [{ ...splat, mode, blend }];
      assert.equal(data.validate(design).wool.layers[0].mode, mode);
    }
  for (const override of [
    { color: 'url(http://x)' },
    { color: '#fff' },
    { mode: '<svg>' },
    { blend: 'url(x)' },
    { x: -1 },
    { y: 1.1 },
    { radius: Infinity },
    { opacity: 0 },
    { angle: 361 },
    { x: '0.5' },
    { y: NaN },
  ]) {
    const design = data.blank();
    design.face.layers = [{ ...splat, ...override }];
    assert.throws(() => data.validate(design));
  }
  const full = data.blank();
  full.wool.layers = Array.from({ length: 64 }, () => ({ ...splat }));
  assert.equal(data.validate(full).wool.layers.length, 64);
  full.wool.layers.push(splat);
  assert.throws(() => data.validate(full));
  for (const bad of [null, undefined, 'bad json', {}, { version: 2 }])
    assert.deepEqual(data.read(bad), data.blank());
});
test('public sheep serialization never exposes internal ids or private account fields', () => {
  assert.deepEqual(
    serialize({
      id: 1,
      uid: 'u_owner01',
      username: 'A',
      full_name: 'secret',
      student_id: 'secret',
      design_json: '{bad',
      revision: 2,
    }),
    { uid: 'u_owner01', username: 'A', design: data.blank(), revision: 2 },
  );
});

test('ranch API authenticates saves, enforces adoption/revisions and paginates public sheep', async (t) => {
  let adopted = true;
  let stored = null;
  let owner = null;
  let commits = 0;
  let rollbacks = 0;
  const pool = {
    async execute(sql, values) {
      if (sql.includes('LIMIT 25'))
        return [
          Array.from({ length: 25 }, (_, i) => ({
            id: 100 - i,
            uid: `u_owner${i.toString().padStart(2, '0')}`,
            username: `Owner ${i}`,
            design_json: null,
          })),
        ];
      if (sql.startsWith('SELECT id FROM users')) {
        owner = values[0];
        return [[{ id: owner }]];
      }
      if (sql.startsWith('SELECT revision FROM'))
        return [stored ? [{ revision: stored.revision }] : []];
      if (sql.startsWith('INSERT INTO')) {
        assert.equal(values[0], 7);
        stored = { design: JSON.parse(values[1]), revision: values[2] };
        return [{}];
      }
      if (sql.includes('AS adopted FROM users u WHERE')) return [[{ adopted: adopted ? 1 : 0 }]];
      return [
        [
          {
            uid: 'u_owner07',
            username: 'Owner',
            adopted: adopted ? 1 : 0,
            design_json: stored?.design,
            revision: stored?.revision,
          },
        ],
      ];
    },
    async getConnection() {
      return {
        execute: pool.execute,
        beginTransaction: async () => {},
        commit: async () => {
          commits += 1;
        },
        rollback: async () => {
          rollbacks += 1;
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/ranch-designs',
    createRanchDesignRouter({
      pool,
      requireAuth: async (req, res) => {
        if (req.headers.authorization === 'Bearer test-only') return { id: 7 };
        res.status(401).json({ message: '登录' });
        return null;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/ranch-designs`;
  const put = (body, auth = true) =>
    fetch(`${base}/mine`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: 'Bearer test-only' } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await put({ design: data.blank(), revision: 0 }, false)).status, 401);
  assert.equal((await fetch(`${base}/mine`)).status, 401);
  assert.equal((await put({ design: null, revision: 0 })).status, 400);
  assert.equal((await put({ design: data.blank(), revision: -1 })).status, 400);
  adopted = false;
  assert.equal((await put({ design: data.blank(), revision: 0 })).status, 403);
  adopted = true;
  const created = await put({ design: data.blank(), revision: 0, userId: 999 });
  assert.equal(created.status, 200);
  assert.equal(owner, 7);
  assert.equal((await created.json()).revision, 1);
  assert.equal((await put({ design: data.blank(), revision: 0 })).status, 409);
  assert.equal((await put({ design: data.blank(), revision: 1 })).status, 200);
  assert.equal(commits, 2);
  assert.equal(rollbacks, 2);
  const mine = await (
    await fetch(`${base}/mine`, { headers: { Authorization: 'Bearer test-only' } })
  ).json();
  assert.equal(mine.revision, 2);
  assert.equal(mine.adopted, true);
  const gallery = await (await fetch(base)).json();
  assert.equal(gallery.sheep.length, 24);
  assert.equal(gallery.next, '77');
  assert.equal((await fetch(`${base}?before=bad`)).status, 400);
  assert.equal((await fetch(`${base}/invalid`)).status, 400);
});
