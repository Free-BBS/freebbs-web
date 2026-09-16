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

test('reasoning starts collapsed, remembers the preference, and preserves manual toggles on completion', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../public/max-reasoning'), 'utf8');
  const panels = [];
  const storage = new Map();
  const checkbox = {
    addEventListener(name, fn) {
      this[name] = fn;
    },
  };
  const element = () => ({
    open: false,
    children: [],
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 100,
    append(...children) {
      this.children.push(...children);
    },
    setAttribute() {},
  });
  const document = {
    readyState: 'complete',
    createElement: element,
    createTextNode: (text) => text,
    querySelectorAll: (selector) => (selector === '.max-reasoning' ? panels : [checkbox]),
  };
  const window = {
    document,
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  };
  vm.runInNewContext(source, { window, document });
  const api = window.FreeBbsReasoning;
  const article = () => ({ querySelector: () => null, append: (panel) => panels.push(panel) });
  const first = article();
  api.update(first, { delta: '测试思考' });
  assert.equal(panels[0].open, false);
  checkbox.checked = true;
  checkbox.change();
  assert.equal(panels[0].open, true);
  assert.equal(storage.get('free_bbs_max_reasoning_expanded'), 'true');
  const second = article();
  api.update(second, { delta: '新回复' });
  assert.equal(panels[1].open, true);
  panels[1].open = false;
  api.update(second, { delta: '继续' });
  api.finish(second);
  assert.equal(panels[1].open, false);
  api.finish(first);
  assert.equal(panels[0].open, true);
  vm.runInNewContext(source, { window, document });
  assert.equal(checkbox.checked, true);
});
