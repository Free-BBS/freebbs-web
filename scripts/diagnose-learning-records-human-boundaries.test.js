// Read-only human-factors diagnostics. Synthetic rows and local test DOM only.
// These assert observed behavior, not that V1.0 is fully implemented or learning is effective.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createMemoryAnalyticsStore,
  createLearningAnalyticsRouter,
  journeyEvidence,
} = require('../backend/learning-analytics');

function browserHarness() {
  const source = fs.readFileSync(path.join(__dirname, 'learning-analytics-page.test.js'), 'utf8');
  const from = source.indexOf('function analyticsBrowser(');
  const to = source.indexOf('\ntest(', from);
  assert.ok(from > 0 && to > from);
  const scope = { fs, path, vm, __dirname, URLSearchParams, setImmediate };
  vm.runInNewContext(`${source.slice(from, to)}\nglobalThis.harness = analyticsBrowser;`, scope);
  return scope.harness(undefined, { consent: false });
}

async function overview(store) {
  const router = createLearningAnalyticsRouter({
    store,
    requireAuth: async () => ({ id: '1' }),
    requireAdmin: async () => ({ id: '9', is_admin: true }),
  });
  const layer = router.stack.find((item) => item.route?.path === '/admin/overview');
  assert.ok(layer);
  let result;
  let status = 200;
  const response = {
    set() {
      return this;
    },
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      result = value;
      return this;
    },
  };
  // Invoke the actual registered route without listening on any HTTP port.
  await layer.route.stack[0].handle({ query: { window: 'all' } }, response);
  assert.equal(status, 200);
  return result;
}

function find(node, predicate) {
  if (predicate(node)) return node;
  return node.children?.map((child) => find(child, predicate)).find(Boolean);
}

test('diagnostic: actual admin router and dynamic user table distinguish 200 practices from zero formal attempts', async () => {
  const attempts = Array.from({ length: 200 }, (_, index) => ({
    id: String(index + 1),
    user_id: '1',
    course_id: '10',
    node_id: 'SS-01-01',
    question_id: 'QA-practice',
    document_version: 'a'.repeat(64),
    question_version: '1',
    is_official: 0,
    status: 'graded',
    verdict: 'practice_only',
    created_at: '2026-10-10T00:00:00.000Z',
  }));
  const data = await overview(
    createMemoryAnalyticsStore({
      contexts: [{ course_id: '10', slug: 'signals', node_id: 'SS-01-01' }],
      users: [{ id: '1', nickname: 'QA-only-practice' }],
      businessAttempts: attempts,
    }),
  );
  assert.equal(data.selftest.officialAttempts, 0);
  assert.equal(data.selftest.practiceAttempts, 200);
  assert.equal(data.users[0].selftest.attempts, 200);
  const browser = browserHarness();
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview') ? Promise.resolve(data) : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  const details = find(browser.admin, (node) => node.children?.[0]?.textContent === '各用户记录');
  assert.ok(details);
  const grid = details.children.find((node) => node.className === 'learning-data-table-scroll')
    .children[0];
  const headings = Array.from(grid.children[0].children[0].children, (node) => node.textContent);
  const values = Array.from(grid.children[1].children[0].children, (node) => node.textContent);
  assert.equal(headings[3], '全部作答（次数）');
  assert.equal(values[3], '200');
  assert.equal(headings[4], '正式自测（次数）');
  assert.equal(values[4], '0');
  assert.equal(headings[5], '练习（次数）');
  assert.equal(values[5], '200');
  assert.match(browser.text(details), /不代表当前题库通过或掌握程度/);
  assert.match(browser.text(browser.admin), /正式自测作答 0/);
  console.log(
    JSON.stringify({
      diagnostic: 'practice-formal-label',
      headings,
      values,
      officialAttempts: 0,
      practiceAttempts: 200,
    }),
  );
});

test('diagnostic: records preserve self-report, historical-version and non-mastery boundaries', async () => {
  const browser = browserHarness();
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/summary')
      ? Promise.resolve({
          preferences: { enabled: false },
          process: { visits: 10, activeSeconds: 7200, courses: [] },
          selftest: {
            officialAttempts: 3,
            practiceAttempts: 2,
            passed: 1,
            failed: 1,
            pendingReview: 1,
          },
          journey: {
            units: [
              {
                courseSlug: 'signals',
                nodeId: 'SS-01-01',
                currentChoice: { level: 'advanced', goal: 'explore' },
                officialAttempts: 3,
                practiceAttempts: 2,
                repeatedQuestions: 1,
                correctedQuestions: 1,
                pendingReview: 1,
                explorationAttempts: 1,
              },
            ],
          },
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const text = browser.text(browser.personal);
  assert.match(text, /活跃时长估计 120 分钟/);
  assert.match(text, /浏览与参与记录不代表掌握程度/);
  assert.match(text, /自测按作答次数统计，含历史版本/);
  assert.match(text, /起点是自报选择，不是能力评定/);
  assert.match(text, /练习 2 正式自测 3/);
  assert.match(text, /延迟保持 \/ 新情境迁移：尚未采集/);
  assert.match(text, /同题订正不等于长期掌握或迁移/);
  assert.doesNotMatch(text, /掌握率|已经掌握|能力排名|有效学习时长/);
  const base = {
    user_id: '1',
    course_id: '10',
    course_slug: 'signals',
    node_id: 'SS-01-01',
    question_id: 'QA-version',
    is_official: 1,
    status: 'graded',
    question_version: '1',
  };
  const evidence = journeyEvidence(
    [],
    [
      {
        ...base,
        id: '1',
        document_version: 'a'.repeat(64),
        verdict: 'fail',
        created_at: '2026-10-01T01:00:00Z',
      },
      {
        ...base,
        id: '2',
        document_version: 'b'.repeat(64),
        verdict: 'pass',
        created_at: '2026-10-01T02:00:00Z',
      },
      {
        ...base,
        id: '3',
        document_version: 'a'.repeat(64),
        is_official: 0,
        verdict: 'practice_only',
        created_at: '2026-10-01T03:00:00Z',
      },
    ],
    { personal: true },
  );
  assert.equal(
    evidence.units[0].correctedQuestions,
    0,
    'Cannot join an old failure to another-version pass or practice',
  );
  assert.equal(evidence.units[0].repeatedQuestions, 0);
});

function knowledgeChatProbe() {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
  };
  const state = { chatMessages: [], chatSending: false, course: {}, node: {} };
  const requests = [];
  const events = [];
  const scope = {
    state,
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    chatGeneration: 0,
    window: {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    app: {
      userState: { token: 'QA-only-token' },
      streamKnowledgeRagResponse: async (payload, delta) => {
        requests.push(payload);
        delta('SYNTHETIC AI ANSWER');
      },
    },
    page: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: function CustomEvent(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
    setChatOpen() {},
    persistChatDraft: () => true,
    setChatDraftNotice() {},
    appendChatMessage: () => ({}),
    updateChatMessage() {},
  };
  const code = `${extract('function buildKnowledgeChatRequest(', 'function setChatSending(')}
${extract('function setChatSending(', 'async function submitChatPrompt(')}
${extract('async function submitChatPrompt(', '// Share only this knowledge point')}
globalThis.submit = submitChatPrompt; globalThis.request = buildKnowledgeChatRequest;`;
  vm.runInNewContext(code, scope);
  return { state, requests, events, submit: scope.submit, request: scope.request };
}

test('diagnostic: knowledge AI conversation is current-page state, not a restored personal record', async () => {
  const first = knowledgeChatProbe();
  await first.submit('SYNTHETIC STUDENT QUESTION');
  assert.equal(first.requests.length, 1);
  assert.equal(first.state.chatMessages.length, 2);
  assert.equal(first.request('next').history.length, 2);
  assert.deepEqual(
    first.events.map((event) => event.type),
    ['knowledge:chat-start', 'knowledge:answer'],
  );
  assert.equal(
    JSON.stringify(first.events[0].detail),
    '{}',
    'source refresh signal contains no private text',
  );
  const reopened = knowledgeChatProbe();
  assert.equal(
    reopened.request('next').history.length,
    0,
    'Fresh production controller has no retrieval of prior course conversation',
  );
  const knowledge = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const analytics = fs.readFileSync(
    path.join(__dirname, '../public/learning-analytics.js'),
    'utf8',
  );
  assert.doesNotMatch(knowledge, /\/ai\/dialogs|saveAiDialog/);
  assert.doesNotMatch(analytics, /\/ai\/dialogs|chatMessages|knowledge:answer/);
  // Upstream AI storage, real HTTP and real Chrome reload are not probed here.
  // The diagnostic establishes the local UI/request contract only, not upstream erasure.
});
