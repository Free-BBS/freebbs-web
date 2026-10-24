const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const learningPolicy = require('../public/learning-policy');

const root = path.join(__dirname, '..');
const knowledgeSource = fs.readFileSync(path.join(root, 'public', 'knowledge.js'), 'utf8');

function knowledgeSlice(start, end) {
  const first = knowledgeSource.indexOf(start);
  const last = knowledgeSource.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Production function boundaries exist: ${start}`);
  return knowledgeSource.slice(first, last);
}

// Run the production request and send controllers with a deterministic stream, not a real AI.
function knowledgeChatHarness(stream, { goal = 'practice' } = {}) {
  const input = { value: '请解释卷积' };
  const state = {
    course: { name: '信号与系统' },
    node: { id: 'SS-01-01', title: '卷积', summary: '系统响应', markdown: '# 卷积正文' },
    learningTask: { tool: 'feedback', quizView: 'practice' },
    chatSending: false,
    chatMessages: [{ role: 'user', content: '之前的问题' }],
    chatSelectionDraft: input.value,
  };
  const requests = [];
  const messages = [];
  const events = [];
  const statuses = [];
  const context = vm.createContext({
    state,
    courseSlug: 'signals',
    nodeId: state.node.id,
    chatGeneration: 0,
    URLSearchParams,
    window: {
      location: { search: '' },
      FreeBbsLearningPolicy: learningPolicy,
      FreeBbsLearningWorkspace: { currentGoal: () => goal },
      FreeBbsLearningStart: { currentPreference: () => ({ level: 'new', goal: 'concepts' }) },
    },
    app: {
      userState: { token: 'test-session' },
      async streamKnowledgeRagResponse(request, onDelta) {
        requests.push(JSON.parse(JSON.stringify(request)));
        await stream(onDelta);
      },
    },
    document: { getElementById: (id) => (id === 'knowledge-chat-input' ? input : null) },
    page: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    setChatOpen() {},
    persistChatDraft() {},
    setChatDraftNotice() {},
    setChatSending(busy, status = '') {
      state.chatSending = busy;
      statuses.push(status);
    },
    appendChatMessage(role, content, options = {}) {
      const message = { role, content, loading: Boolean(options.loading) };
      messages.push(message);
      return message;
    },
    updateChatMessage(message, content) {
      Object.assign(message, { content, loading: false });
    },
  });
  vm.runInContext(
    `${knowledgeSlice('  function buildKnowledgeChatRequest(', '  function setChatSending(')}\n${knowledgeSlice('  async function submitChatPrompt(', '  // Share only this knowledge')}`,
    context,
  );
  return {
    input,
    state,
    requests,
    messages,
    events,
    statuses,
    send: (prompt) => context.submitChatPrompt(prompt),
  };
}

test('Info 内置消息页面并代理异步任务', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');

  assert.match(appSource, /function renderMaxSubagentResult/);
  assert.match(appSource, /function pollInfoJob/);
  assert.match(appSource, /function addMentionedCourseMapRoute/);
  assert.match(appSource, /\/course\?course=\$\{encodeURIComponent\(course\.slug\)\}/);
  assert.match(appSource, /\/ai\/info\/jobs\/get/);
  assert.match(backendSource, /app\.post\('\/api\/ai\/info\/jobs\/get'/);
  assert.match(backendSource, /\/api\/v1\/info\/jobs\/get/);
});

test('课程知识页调用真正的 RAG Agent', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
  assert.match(appSource, /function streamKnowledgeRagResponse/);
  assert.match(appSource, /'\/ai\/knowledge\/chat'/);
  assert.match(knowledgeSource, /function buildKnowledgeChatRequest/);
  assert.match(knowledgeSource, /app\.streamKnowledgeRagResponse/);
  assert.match(knowledgeSource, /knowledge-chat-message-body/);
  assert.match(knowledgeSource, /knowledge-chat-loading-dots/);
  assert.match(knowledgeSource, /plainText: role === 'user'/);
  assert.doesNotMatch(knowledgeSource, /agent: 'rag'/);
  assert.doesNotMatch(knowledgeSource, /temperature:/);
  assert.doesNotMatch(knowledgeSource, /model:/);
  // Guidance may use ordinary paragraphs. Actual answer provenance is checked below.
  assert.doesNotMatch(knowledgeSource, /createMockReply/);
  assert.doesNotMatch(knowledgeSource, /agent: 'general_chat'/);
  assert.match(backendSource, /app\.post\('\/api\/ai\/knowledge\/chat'/);
  assert.match(backendSource, /function buildKnowledgeRagChatPayload/);
  assert.match(backendSource, /agent: 'rag'/);
  assert.match(backendSource, /temperature: KNOWLEDGE_RAG_TEMPERATURE/);
});

test('课程回复使用 RAG 流式内容，并携带当前知识点和学习起点', async () => {
  const fixture = knowledgeChatHarness(async (onDelta) => {
    onDelta('服务端检索结果：');
    onDelta('卷积描述系统响应。');
  });
  await fixture.send(`  ${fixture.input.value}  `);

  assert.equal(fixture.requests.length, 1);
  assert.deepEqual(fixture.requests[0], {
    question: '请解释卷积',
    history: [{ role: 'user', content: '之前的问题' }],
    context: {
      courseSlug: 'signals',
      courseName: '信号与系统',
      knowledgePointId: 'SS-01-01',
      knowledgePointTitle: '卷积',
      knowledgePointSummary: '系统响应',
      knowledgePointMarkdown: '# 卷积正文',
      learningStartPreference: { level: 'new', goal: 'concepts' },
      learningTask: { tool: 'feedback', quizView: 'practice', goal: 'practice' },
      learningPolicyContext: {
        policyVersion: learningPolicy.POLICY_VERSION,
        purpose: 'practice',
        level: 'new',
      },
    },
  });
  const answer = '服务端检索结果：卷积描述系统响应。';
  assert.equal(fixture.messages.at(-1).content, answer);
  assert.equal(fixture.messages.at(-1).loading, false);
  assert.equal(fixture.state.chatMessages.at(-1).content, answer);
  assert.deepEqual(
    fixture.events.map((event) => event.type),
    ['knowledge:chat-start', 'knowledge:answer'],
  );
  assert.equal(fixture.events.at(-1).detail.answer, answer);
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.state.chatSending, false);
});

test('RAG 不把任意文案或非法值当作正规学习目的，保留合法课程起点', async () => {
  for (const goal of ['夯实基础', '__proto__', ['practice'], { purpose: 'review' }]) {
    const fixture = knowledgeChatHarness(async (onDelta) => onDelta('真实流式响应'), { goal });
    await fixture.send(fixture.input.value);
    const context = fixture.requests[0].context;
    assert.equal(Object.hasOwn(context.learningTask, 'goal'), false);
    assert.deepEqual(context.learningStartPreference, { level: 'new', goal: 'concepts' });
    assert.deepEqual(context.learningPolicyContext, {
      policyVersion: learningPolicy.POLICY_VERSION,
      purpose: 'learn',
      level: 'new',
    });
    assert.equal(fixture.messages.at(-1).content, '真实流式响应');
  }
});

for (const scenario of [
  {
    name: 'RAG 中途失败',
    stream: async (onDelta) => {
      onDelta('未完成的回答');
      throw new Error('检索服务不可用');
    },
    failure: '请求失败：检索服务不可用',
  },
  {
    name: 'RAG 没有返回内容',
    stream: async () => {},
    failure: '请求失败：Agent 未返回回答内容',
  },
]) {
  test(`${scenario.name}时保留草稿，不伪造回答或记入成功记录`, async () => {
    const fixture = knowledgeChatHarness(scenario.stream);
    await fixture.send(fixture.input.value);

    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.messages.at(-1).content, scenario.failure);
    assert.equal(fixture.messages.at(-1).loading, false);
    assert.equal(fixture.state.chatMessages.length, 1);
    assert.equal(
      fixture.events.some((event) => event.type === 'knowledge:answer'),
      false,
    );
    assert.equal(fixture.input.value, '请解释卷积');
    assert.equal(fixture.state.chatSelectionDraft, '请解释卷积');
    assert.match(fixture.statuses.at(-1), /问题草稿已保留/);
    assert.equal(fixture.state.chatSending, false);
  });
}

test('工作台在已授权且数据过期时自动同步通知', () => {
  const connectorSource = fs.readFileSync(
    path.join(root, 'public', 'workbench-connectors.js'),
    'utf8',
  );
  const brokerSource = fs.readFileSync(
    path.join(root, 'backend', 'tsinghua-connectors', 'broker.js'),
    'utf8',
  );
  assert.match(connectorSource, /function maybeAutoSync/);
  assert.match(connectorSource, /await syncNow\(\{ automatic: true \}\)/);
  assert.match(connectorSource, /autoSyncRequested/);
  assert.match(brokerSource, /minimumIntervalSeconds: runtimeConfig\.syncIntervalSeconds/);
});
