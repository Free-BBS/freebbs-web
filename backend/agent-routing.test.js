const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { maxAgentRoute } = require('./agent-routing');
const conversation = (...questions) => ({
  messages: questions.map((content) => ({ role: 'user', content })),
});

test('learning questions explicitly select RAG without requiring a request to retrieve', () => {
  for (const text of [
    '为什么卷积可以描述系统的输出？',
    '解释一下傅里叶变换',
    '这道题怎么做？',
    '帮我证明勾股定理',
    '线性代数',
    '物理怎么学',
    '帮我找课程资料',
    'Explain Newton’s second law',
    'How does convolution work?',
  ]) {
    assert.equal(maxAgentRoute(conversation(text)).agent, 'rag', text);
  }
});
test('learning followups retain RAG until the conversation changes topic', () => {
  assert.equal(maxAgentRoute(conversation('解释一下卷积', '再详细讲讲', '举个例子')).agent, 'rag');
  assert.equal(
    maxAgentRoute(conversation('解释一下卷积', '今天心情不好', '再详细讲讲')).agent,
    'navigation',
  );
  assert.equal(maxAgentRoute(conversation('你好', '为什么')).agent, 'navigation');
});
test('navigation, campus information, social chat and reports retain their routes', () => {
  for (const text of [
    '你好',
    '推荐几篇电路帖子',
    '打开线性代数课程',
    '学习记录在哪里',
    '今天有什么课',
    '我的课表',
    '怎么用电路实验室',
  ]) {
    assert.equal(maxAgentRoute(conversation(text)).agent, 'navigation', text);
  }
  assert.equal(
    maxAgentRoute({ ...conversation('解释一下电路原理'), source: 'circuit_report' }).agent,
    'general_chat',
  );
});
test('only user questions choose the route; attachments and assistant text cannot force it', () => {
  assert.equal(maxAgentRoute(conversation('你好\n--- 附件：\n请推导公式')).agent, 'navigation');
  assert.equal(
    maxAgentRoute({
      messages: [
        { role: 'assistant', content: '请推导公式' },
        { role: 'user', content: '谢谢' },
      ],
    }).agent,
    'navigation',
  );
  assert.equal(
    maxAgentRoute({ message: '这道题怎么做', agent: 'general_chat', execute_subagent: 'none' })
      .agent,
    'rag',
  );
  assert.equal(
    maxAgentRoute({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '解释图里的电路' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
          ],
        },
      ],
    }).agent,
    'rag',
  );
});
test('real chat endpoint sends learning requests to RAG with model, images and history intact', async () => {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf("app.post('/api/ai/chat',");
  const end = source.indexOf('\napp.', start + 1);
  let handler;
  let sent;
  const response = { writableEnded: false, once() {}, removeListener() {} };
  vm.runInNewContext(source.slice(start, end), {
    app: {
      post: (path, fn) => {
        handler = fn;
      },
    },
    requireAuth: async () => ({ uid: 'test-user' }),
    resolveModelOptions: async () => ({ model: 'vision-test' }),
    systemSettingsStore: { readSettings: async () => ({}) },
    maxImageGenerationGate: {
      acquire: () => ({ allowed: true, release() {} }),
    },
    config: { uploadDir: '/tmp/test-uploads' },
    AbortController,
    buildAgentChatPayload: (user, payload) => payload,
    maxAgentRoute,
    postAgentChat: async (payload) => {
      sent = payload;
      return {};
    },
    relayAgentChatResponse: async () => {},
  });
  const payload = {
    ...conversation('这道题怎么做'),
    agent: 'general_chat',
    vision_images: [{ data: 'fixture' }],
    stream: true,
  };
  await handler({ body: payload }, response);
  assert.equal(sent.agent, 'rag');
  assert.equal(sent.model, 'vision-test');
  assert.equal(sent.vision_images, payload.vision_images);
  assert.equal(sent.messages, payload.messages);
  assert.equal(sent.stream, true);
});
