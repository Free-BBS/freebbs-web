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

test('HTML SSE survives split UTF-8 frames and remains separate from reasoning', async () => {
  const code = [];
  const thoughts = [];
  const html = '<html><body>计数器</body></html>';
  const result = await reasoning.request({
    url: 'https://example.test/tools/generate/html',
    token: 'test',
    payload: { prompt: '计数器' },
    onHtml: (delta) => code.push(delta),
    onReasoning: (part) => thoughts.push(part.delta),
    fetchImpl: async () =>
      response(
        event({ reasoning_delta: '先安排按钮' }) +
          event({ html_delta: '<html><body>计数器' }) +
          event({ html_delta: '</body></html>' }) +
          event({ done: true, result: { answer: html, html } }),
      ),
  });
  assert.equal(code.join(''), html);
  assert.deepEqual(thoughts, ['先安排按钮']);
  assert.equal(result.html, html);
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

test('site references survive streaming and become compact, persistent Markdown links', async () => {
  const answer = await request(
    event({
      site_sources: [
        { title: '滤波实验', url: '/discussion?post=p_one' },
        { title: '知识点', url: '/knowledge?course=signals&point=SS-1' },
      ],
    }) + event({ done: true, result: { answer: '这个实验说明了滤波过程。', model: 'test' } }),
  );
  assert.match(answer.answer, /\[【1】\]\(\/discussion\?post=p_one/);
  assert.match(answer.answer, /\[【2】\]\(\/knowledge/);
  assert.equal(answer.model, 'test');
});

test('site references reject external or unsafe URLs and do not duplicate inline citations', async () => {
  const original = '参考 [【1】](/discussion?post=one)。';
  const answer = await request(
    event({
      site_sources: [
        { url: '/discussion?post=one' },
        { url: '//evil.test' },
        { url: '/\\evil.test' },
        // eslint-disable-next-line no-script-url -- malicious fixture must be rejected, never executed
        { url: 'javascript:alert(1)' },
        { url: '/x) injected' },
      ],
    }) + event({ done: true, result: { answer: original } }),
  );
  assert.equal(answer.answer, original);
});

test('direct RAG learning replies preserve sources for rendering and conversation history', async () => {
  const result = {
    agent: 'rag',
    answer: '卷积解释',
    sources: [{ doc_id: 'signals', source: '课程讲义' }],
    course: { name: '信号与系统' },
  };
  const received = await request(event({ done: true, result }));
  assert.deepEqual(received.subagent, result);
  assert.equal(received.response_mode, 'rag');
  assert.equal(received.answer, result.answer);
});
