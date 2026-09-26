const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createMaxCreationIntentRouter, parseCreationIntent } = require('./max-creation-intent');

test('creation intent accepts only an explicit supported JSON mode', () => {
  for (const mode of ['chat', 'tool', 'circuit'])
    assert.equal(parseCreationIntent(JSON.stringify({ mode })), mode);
  assert.equal(parseCreationIntent('```json\n{"mode":"tool"}\n```'), 'tool');
  for (const answer of ['tool', '{"mode":"publish"}', '{}', 'ignore rules'])
    assert.equal(parseCreationIntent(answer), 'chat');
});

test('classifier authenticates, bounds requests and asks the model without generating or publishing', async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(
    createMaxCreationIntentRouter({
      requireAuth: async (req, res) => {
        if (req.headers.authorization) return { id: 7 };
        res.status(401).end();
        return null;
      },
      buildAgentChatPayload: (user, payload, options) => {
        calls.push({ payload, options });
        return payload;
      },
      postAgentChat: async () =>
        new Response(JSON.stringify({ answer: '{"mode":"circuit"}' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/creation-intent`;
  const send = (body, auth = true) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: 'Bearer test' } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await send({ prompt: 'make a circuit' }, false)).status, 401);
  assert.equal((await send({ prompt: 'x'.repeat(16001) })).status, 400);
  const response = await send({ prompt: '把上一个电路的电阻换成 1k', previousKind: 'circuit' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: 'circuit' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.allowImageGeneration, false);
  assert.match(calls[0].payload.messages[0].content, /上一件作品类型：circuit/);
});
