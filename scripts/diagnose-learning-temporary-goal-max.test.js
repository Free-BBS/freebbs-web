// Independent bounded contracts: actual extracted request/session functions and
// the companion loader with a read-only memory stub. Not Chrome, HTTP or MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  loadCompanionContext,
  companionPreference,
  companionHint,
} = require('../backend/learning-companion');
const { promptHintFromPreference } = require('../public/learning-start');

const workspaceSource = fs.readFileSync(
  path.join(__dirname, '../public/knowledge-workspace.js'),
  'utf8',
);
const knowledgeSource = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
const extract = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Actual function boundaries present: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => JSON.parse(JSON.stringify(value));

function requestHarness() {
  const saved = Object.freeze({ level: 'familiar', goal: 'concepts' });
  const app = { userState: { uid: 'A', token: 'token-A', isLoggedIn: true } };
  const workspaceState = { ready: true, uid: 'A', token: 'token-A', planGoal: 'explore' };
  const window = {};
  vm.runInNewContext(
    extract(workspaceSource, '  function currentPlanGoal() {', '  function sessionMessage('),
    { state: workspaceState, app, window },
  );
  let hasSelfReport = true;
  window.FreeBbsLearningStart = {
    currentPreference: () =>
      hasSelfReport &&
      !workspaceState.stale &&
      workspaceState.uid === app.userState.uid &&
      workspaceState.token === app.userState.token
        ? { ...saved }
        : null,
  };
  const state = {
    course: { name: '只读契约夹具课程' },
    node: { id: 'SS-02-01', title: '实际请求目标', markdown: '只读正文。' },
    learningTask: { tool: 'feedback', quizView: 'practice', questionId: 'current-question' },
    chatMessages: [],
    chatSending: false,
  };
  const sandbox = { state, window, app, courseSlug: 'signals', nodeId: 'SS-02-01' };
  vm.createContext(sandbox);
  vm.runInContext(
    extract(knowledgeSource, '  function buildKnowledgeChatRequest(', '  function setChatSending('),
    sandbox,
  );
  return {
    sandbox,
    state,
    window,
    app,
    saved,
    workspaceState,
    setSelfReport(value) {
      hasSelfReport = value;
    },
    build: (prompt = '本地契约问题') => sandbox.buildKnowledgeChatRequest(prompt),
  };
}

test('each request composes the live page goal with current task without mutating saved preference or prior payload', async () => {
  const harness = requestHarness();
  const first = copy(harness.build());
  harness.workspaceState.planGoal = 'practice';
  harness.state.learningTask = { tool: 'content', view: 'origin' };
  const second = copy(harness.build());
  assert.equal(first.context.learningTask.goal, 'explore');
  assert.equal(first.context.learningTask.questionId, 'current-question');
  assert.deepEqual(second.context.learningTask, {
    tool: 'content',
    view: 'origin',
    goal: 'practice',
  });
  assert.deepEqual(second.context.learningStartPreference, harness.saved);
  const reads = [];
  const trusted = await loadCompanionContext({
    user: { id: 17 },
    rawContext: second.context,
    store: {
      context: async () => ({
        course_id: 1,
        node_id: 'SS-02-01',
        title: '只读公开夹具',
        document_markdown: '公开正文。',
      }),
      list: async (user, _context, cursor, review) => {
        reads.push([user.id, cursor, review]);
        return [];
      },
    },
  });
  assert.deepEqual(reads, [[17, '', false]]);
  const before = copy(trusted);
  assert.deepEqual(companionPreference(trusted), { level: 'familiar', goal: 'practice' });
  assert.match(companionHint(trusted), /本次目的：练习解题/);
  assert.doesNotMatch(companionHint(trusted), /本页临时目标：/);
  assert.deepEqual(trusted, before);
  assert.deepEqual(trusted.learningEvidence, {
    officialTotal: 0,
    observed: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    source: 'authenticated_current_version_recent_records',
    limited: false,
  });
  harness.workspaceState.planGoal = '';
  const cleared = copy(harness.build());
  assert.deepEqual(cleared.context.learningTask, { tool: 'content', view: 'origin' });
  assert.deepEqual(harness.saved, { level: 'familiar', goal: 'concepts' });
  assert.equal(
    first.context.learningTask.goal,
    'explore',
    'old request is a snapshot, not a live goal reference',
  );
});

test('a same-page exploration intent without self-report still reaches the bounded hint but invents no familiarity strategy', async () => {
  const harness = requestHarness();
  harness.setSelfReport(false);
  harness.state.learningTask = { tool: 'content' };
  const context = copy(harness.build().context);
  const trusted = await loadCompanionContext({
    user: { id: 17 },
    rawContext: context,
    store: {
      context: async () => ({ course_id: 1, node_id: 'SS-02-01', document_markdown: '公开正文。' }),
      list: async () => [],
    },
  });
  assert.equal(trusted.learningStartPreference, null);
  assert.equal(companionPreference(trusted), null);
  assert.equal(promptHintFromPreference(companionPreference(trusted), trusted.resources), '');
  assert.match(companionHint(trusted), /本页临时目标：探索研究.*不代表能力或正式结果/);
  harness.workspaceState.stale = true;
  assert.equal(Object.hasOwn(copy(harness.build().context.learningTask), 'goal'), false);
  harness.workspaceState.stale = false;
  harness.app.userState.uid = 'B';
  assert.equal(Object.hasOwn(copy(harness.build().context.learningTask), 'goal'), false);
});

for (const outcome of ['late-success', 'late-failure'])
  test(`ABA session tokens cannot let ${outcome} of the old goal unlock or append to a newer chat`, async () => {
    const harness = requestHarness();
    const streams = [];
    const updates = [];
    const events = [];
    const fields = new Map();
    const get = (id) => {
      if (!fields.has(id))
        fields.set(id, { disabled: false, textContent: '', value: '', replaceChildren() {} });
      return fields.get(id);
    };
    Object.assign(harness.sandbox, {
      document: {
        getElementById: get,
        querySelector: () => get('send'),
        querySelectorAll: () => [get('quick')],
      },
      page: { dispatchEvent: (event) => events.push(event.type) },
      setChatOpen() {},
      persistChatDraft: () => true,
      setChatDraftNotice() {},
      chatDraftStore: null,
      chatDraftIdentity: '',
      chatDraftVersionBlocked: false,
      appendChatMessage: (role, text) => ({ role, text }),
      updateChatMessage: (element, value) => updates.push([element.role, value]),
      CustomEvent: function Event(type) {
        this.type = type;
      },
    });
    harness.app.streamKnowledgeRagResponse = (request, delta) =>
      new Promise((resolve, reject) => {
        streams.push({ request: copy(request), delta, resolve, reject });
      });
    vm.runInContext(
      'let chatGeneration = 0; let pendingQuestionNavigation = null;',
      harness.sandbox,
    );
    vm.runInContext(
      extract(
        knowledgeSource,
        '  function setChatSending(',
        '  // Share only this knowledge point',
      ),
      harness.sandbox,
    );
    vm.runInContext(
      extract(
        knowledgeSource,
        '  function clearChatForSession()',
        "  window.addEventListener('freebbs:session-change'",
      ),
      harness.sandbox,
    );
    const old = harness.sandbox.submitChatPrompt('旧的探索任务');
    assert.equal(streams[0].request.context.learningTask.goal, 'explore');
    harness.app.userState = { uid: 'B', token: 'token-B', isLoggedIn: true };
    harness.sandbox.clearChatForSession();
    harness.app.userState = { uid: 'A', token: 'token-A', isLoggedIn: true };
    harness.sandbox.clearChatForSession();
    harness.workspaceState.planGoal = 'practice';
    harness.state.chatSending = false;
    harness.state.learningTask = { tool: 'feedback', quizView: 'quick' };
    const current = harness.sandbox.submitChatPrompt('新的练习方向');
    assert.equal(streams[1].request.context.learningTask.goal, 'practice');
    streams[0].delta('旧任务迟到内容');
    if (outcome === 'late-success') streams[0].resolve();
    else streams[0].reject(new Error('旧任务迟到错误'));
    await old;
    assert.deepEqual(updates, []);
    assert.deepEqual(copy(harness.state.chatMessages), []);
    assert.equal(harness.state.chatSending, true);
    assert.equal(get('send').disabled, true);
    assert.equal(get('quick').disabled, true);
    streams[1].delta('新任务当前回答');
    streams[1].resolve();
    await current;
    assert.deepEqual(updates, [['assistant', '新任务当前回答']]);
    assert.deepEqual(events, ['knowledge:chat-start', 'knowledge:chat-start', 'knowledge:answer']);
    assert.equal(harness.state.chatSending, false);
    assert.equal(get('send').disabled, false);
    assert.deepEqual(copy(harness.state.chatMessages), [
      { role: 'user', content: '新的练习方向' },
      { role: 'assistant', content: '新任务当前回答' },
    ]);
    assert.deepEqual(harness.saved, { level: 'familiar', goal: 'concepts' });
  });
