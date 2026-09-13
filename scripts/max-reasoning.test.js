const assert = require('node:assert/strict');
const test = require('node:test');
const reasoning = require('../public/max-reasoning');

const encoder = new TextEncoder();
const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
function response(text) {
  const bytes = encoder.encode(text);
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(index, (index += 1)));
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
const request = (text, onReasoning) =>
  reasoning.request({
    url: 'https://example.test/api/ai/chat',
    token: 'test',
    payload: { question: '测试' },
    onReasoning,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).reasoning_stream, true);
      return response(text);
    },
  });
test('Max receives reasoning incrementally and preserves navigation and RAG result metadata', async () => {
  const progress = [];
  const result = {
    answer: '正文',
    routes: [{ url: '/world' }],
    subagent: { agent: 'rag' },
    navigation_answer: '课程入口',
  };
  assert.deepEqual(
    await request(
      `${event({ reasoning_delta: '思考中', reasoning_id: '1' })}: ping\r\n\r\n${event({
        reasoning_delta: '另一个思路',
        reasoning_id: '2',
      })}${event({ result, done: true })}`,
      (item) => progress.push(item),
    ),
    result,
  );
  assert.deepEqual(progress, [
    { id: '1', delta: '思考中' },
    { id: '2', delta: '另一个思路' },
  ]);
});
test('partial or failed streams never appear as a completed answer', async () => {
  await assert.rejects(request(event({ reasoning_delta: '思考' })), /连接中断/);
  await assert.rejects(request(event({ done: true })), /完整/);
  await assert.rejects(request(event({ error: { message: '模型不可用' } })), /模型不可用/);
});
