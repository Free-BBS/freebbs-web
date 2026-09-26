const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createFrontendToolsRouter } = require('./frontend-tools');
const { createFrontendToolGenerator } = require('./frontend-tool-generation');
const { request: requestGeneration } = require('../public/max-reasoning');

const html = '<!doctype html><html><head><title>计数器</title></head><body>0</body></html>';
const tick = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const sse = (...events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

async function fixture(t, generateHtml, options = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/tools',
    createFrontendToolsRouter({
      requireAuth: async (req, res) => {
        if (req.headers.authorization === 'Bearer test') return { id: 1 };
        res.status(401).json({ message: '请登录' });
        return null;
      },
      generateHtml,
      ...options,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/tools/generate/html`;
  return {
    url,
    post: (payload, headers = {}) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test', ...headers },
        body: JSON.stringify(payload),
      }),
  };
}

test('tool generator requests genuine reasoning and separates it from executable HTML', async () => {
  const reasoning = [];
  const counts = [];
  const code = [];
  let sent;
  const generate = createFrontendToolGenerator({
    buildAgentChatPayload: (user, payload, defaults) => ({ ...defaults, ...payload }),
    postAgentChat: async (payload) => {
      sent = payload;
      const body = sse(
        { reasoning_delta: '<script>not executable</script>', reasoning_id: 'r1' },
        { delta: html.slice(0, 30) },
        { delta: html.slice(30) },
        { done: true, result: { answer: html } },
      );
      // Byte-wise chunks also split UTF-8 characters and SSE frames.
      const bytes = new TextEncoder().encode(body);
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  assert.equal(
    await generate({
      prompt: '计数器',
      currentHtml: '',
      signal: new AbortController().signal,
      onReasoning: (part) => reasoning.push(part),
      onProgress: (count) => counts.push(count),
      onHtml: (delta) => code.push(delta),
    }),
    html,
  );
  assert.equal(sent.stream, true);
  assert.equal(sent.reasoning_stream, true);
  assert.equal(sent.agent, 'general_chat');
  assert.match(sent.messages[0].content, /localStorage/);
  assert.deepEqual(reasoning, [{ id: 'r1', delta: '<script>not executable</script>' }]);
  assert.equal(counts.at(-1), html.length);
  assert.deepEqual(code, [html.slice(0, 30), html.slice(30)]);
});

test('tool generator accepts JSON fallback and final-only SSE, but rejects interrupted and error streams', async () => {
  for (const response of [
    Response.json({ answer: html }),
    new Response(sse({ done: true, result: { answer: html } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  ]) {
    const generate = createFrontendToolGenerator({
      buildAgentChatPayload: (_, payload) => payload,
      postAgentChat: async () => response,
    });
    assert.equal(await generate({ prompt: 'x', signal: new AbortController().signal }), html);
  }
  for (const response of [
    new Response(sse({ delta: html }), { headers: { 'Content-Type': 'text/event-stream' } }),
    new Response(sse({ error: { message: 'provider failed' } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    new Response('failed', { status: 503 }),
  ]) {
    const generate = createFrontendToolGenerator({
      buildAgentChatPayload: (_, payload) => payload,
      postAgentChat: async () => response,
    });
    await assert.rejects(generate({ prompt: 'x', signal: new AbortController().signal }));
  }
});

test('tool route streams HTML and reasoning before completion and interoperates with the browser client', async (t) => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  let providerCompleted = false;
  const { url } = await fixture(
    t,
    async ({ onReasoning, onProgress, onHtml }) => {
      onReasoning({ id: '1', delta: '先安排按钮和计数。' });
      onProgress(32);
      for (const character of html.slice(0, 30)) onHtml(character);
      await ready;
      onHtml(html.slice(30));
      providerCompleted = true;
      return html;
    },
    { heartbeatMs: 5 },
  );
  const statuses = [];
  const code = [];
  const result = await requestGeneration({
    url,
    token: 'test',
    payload: { prompt: '计数器' },
    onStatus: (status) => statuses.push(status.status),
    onReasoning: (part) => {
      assert.equal(providerCompleted, false);
      assert.equal(part.delta, '先安排按钮和计数。');
    },
    onHtml: (delta) => {
      code.push(delta);
      if (code.length === 1) assert.equal(providerCompleted, false);
      release();
    },
  });
  assert.equal(result.html, html);
  assert.deepEqual(code, [html.slice(0, 30), html.slice(30)]);
  assert.deepEqual(statuses, ['preparing', 'generating', 'validating']);
});

test('tool route bounds partial HTML streams before completion', async (t) => {
  const { url } = await fixture(t, async ({ onHtml }) => {
    onHtml('a'.repeat(184001));
    return html;
  });
  await assert.rejects(
    requestGeneration({ url, token: 'test', payload: { prompt: 'x' } }),
    /HTML 过长/,
  );
});

test('tool route keeps legacy JSON and rejects unauthenticated or invalid input before calling AI', async (t) => {
  let calls = 0;
  const { post } = await fixture(t, async () => {
    calls += 1;
    return html;
  });
  const json = await post({ prompt: '计数器' });
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { html });
  for (const payload of [
    { prompt: '' },
    { prompt: 'a'.repeat(2001) },
    { prompt: 'a', currentHtml: 'a'.repeat(180001) },
  ]) {
    const result = await post(payload);
    assert.equal(result.status, 400);
  }
  assert.equal((await post({ prompt: 'x' }, { Authorization: '' })).status, 401);
  assert.equal(calls, 1);
});

test('invalid HTML and upstream failure are error events, never completion events', async (t) => {
  for (const generate of [
    async () => '<html>incomplete',
    async () => {
      throw new Error('secret provider error');
    },
  ]) {
    const { url } = await fixture(t, generate);
    await assert.rejects(
      requestGeneration({ url, token: 'test', payload: { prompt: 'x' } }),
      /完整的单文件 HTML|没有生成可用/,
    );
  }
});

test('deadline and browser cancellation abort generation, including an uncooperative provider', async (t) => {
  let timeoutSignal;
  const deadline = await fixture(
    t,
    ({ signal }) => {
      timeoutSignal = signal;
      return new Promise(() => {});
    },
    { generationTimeoutMs: 30, heartbeatMs: 5 },
  );
  await assert.rejects(
    requestGeneration({ url: deadline.url, token: 'test', payload: { prompt: 'x' } }),
    /生成超时/,
  );
  assert.equal(timeoutSignal.aborted, true);
  let cancelSignal;
  const cancel = await fixture(t, async ({ signal, onReasoning }) => {
    cancelSignal = signal;
    onReasoning({ delta: '开始', id: '1' });
    return new Promise(() => {});
  });
  const controller = new AbortController();
  await assert.rejects(
    requestGeneration({
      url: cancel.url,
      token: 'test',
      payload: { prompt: 'x' },
      signal: controller.signal,
      onReasoning: () => controller.abort(),
    }),
  );
  for (let attempt = 0; attempt < 20 && !cancelSignal.aborted; attempt += 1) await tick(10);
  assert.equal(cancelSignal.aborted, true);
});
