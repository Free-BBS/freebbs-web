const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLanguageLabRouter, validateRun } = require('./language-lab');

const input = {
  language: 'python',
  source: 'x = 2\nprint(x)',
  interval: 0,
  optimization: '0',
  stdin: '',
};
async function fixture(t, upstream) {
  const rows = new Map();
  const pool = {
    async execute(sql, args) {
      if (sql.startsWith('INSERT'))
        rows.set(args[0], { eid: args[0], title: args[2], document_json: args[3] });
      if (sql.startsWith('SELECT')) return [[rows.get(args[0])].filter(Boolean)];
      return [[]];
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/labs',
    createLanguageLabRouter({
      pool,
      fetchImpl:
        upstream ||
        (async (url) =>
          url.endsWith('/run')
            ? new Response(
                `${[
                  {
                    type: 'trace',
                    line: 2,
                    event: 'line',
                    variables: [{ name: 'x', type: 'int', value: '2' }],
                  },
                  { type: 'output', stream: 'stdout', text: '2\n' },
                  { type: 'result', exitCode: 0 },
                ]
                  .map((event) => JSON.stringify(event))
                  .join('\n')}\n`,
              )
            : Response.json({ ok: true })),
      requireAuth: async (req, res) => {
        if (!req.headers.authorization) {
          res.status(401).json({ message: '请登录' });
          return null;
        }
        return { id: req.headers.authorization };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const request = (route, body, user = '1') =>
    fetch(`http://127.0.0.1:${server.address().port}/api/labs${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { request, rows };
}

test('validates language, executable flags, byte limits and real time interval', () => {
  assert.deepEqual(validateRun(input), { ...input, paused: false });
  for (const patch of [
    { language: 'sh' },
    { source: '' },
    { source: '你'.repeat(20000) },
    { interval: -1 },
    { interval: 6 },
    { interval: '1' },
    { optimization: '2;sh' },
    { stdin: 'a'.repeat(8001) },
  ])
    assert.throws(() => validateRun({ ...input, ...patch }));
});
test('execution requires login; errors do not expose service details', async (t) => {
  const { request } = await fixture(t, async () => {
    throw new Error('private credentials');
  });
  assert.equal((await request('/run', input, null)).status, 401);
  const response = await request('/run', input);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private credentials/);
});
test('streams live variables, persists immutable server results and rejects stale or foreign receipts', async (t) => {
  const { request } = await fixture(t);
  const response = await request('/run', input);
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].type, 'started');
  assert.equal(events[1].type, 'trace');
  assert.equal(events.at(-1).type, 'done');
  const runId = events.find((event) => event.type === 'saved-run').id;
  assert.equal(
    (await request('/experiments', { ...input, title: '实验', runId }, '2')).status,
    409,
  );
  assert.equal(
    (await request('/experiments', { ...input, title: '实验', runId, source: 'changed' })).status,
    409,
  );
  const shared = await request('/experiments', {
    ...input,
    title: '实验',
    runId,
    result: { stdout: 'FORGED' },
  });
  assert.equal(shared.status, 201);
  const { experiment } = await shared.json();
  assert.equal(experiment.result.stdout, '2\n');
  assert.equal(experiment.result.lastTrace.variables[0].value, '2');
  const reopened = await (await request(`/experiments/${experiment.id}`, null, null)).json();
  assert.deepEqual(reopened.experiment.result, experiment.result);
  assert.equal((await request('/experiments/../../secrets')).status, 404);
  assert.equal((await request(`/runs/${runId}/control`, { action: 'stop' })).status, 404);
});
test('code-only snapshots have no forged result and preserve unicode source', async (t) => {
  const { request } = await fixture(t);
  const response = await request('/experiments', {
    ...input,
    title: '正弦实验',
    source: 'print("你好")',
    result: { exitCode: 0 },
  });
  assert.equal(response.status, 201);
  const { experiment } = await response.json();
  assert.equal(experiment.result, null);
  assert.equal(experiment.source, 'print("你好")');
});
test('active sessions are owned and limited per user; disconnect cancels runtime', async (t) => {
  let controller;
  const calls = [];
  const { request } = await fixture(t, async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/run'))
      return new Response(
        new ReadableStream({
          start(value) {
            controller = value;
          },
          cancel() {},
        }),
      );
    return Response.json({ ok: true });
  });
  const response = await request('/run', input);
  const reader = response.body.getReader();
  const start = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal((await request('/run', input)).status, 409);
  assert.equal((await request(`/runs/${start.id}/control`, { action: 'pause' }, '2')).status, 404);
  assert.equal(
    (await request(`/runs/${start.id}/control`, { action: 'speed', interval: 10 })).status,
    400,
  );
  assert.equal((await request(`/runs/${start.id}/control`, { action: 'step' })).status, 200);
  controller.enqueue(new TextEncoder().encode('{"type":"result","exitCode":0}\n'));
  controller.close();
  while (!(await reader.read()).done) {
    /* Drain completed stream. */
  }
  assert.ok(calls.some(([url]) => url.endsWith(`/control/${start.id}`)));
});
