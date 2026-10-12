const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  let pendingQuestionNavigation'),
    source.indexOf('  let chatSessionToken'),
  );
  let snapshot = {
    loaded: false,
    questions: [],
    practiceQuestions: [{ id: 'Q06', assessmentRole: 'practice' }],
  };
  const selected = [];
  const events = [];
  const handlers = {};
  const state = { node: { id: 'SS-02-01' } };
  const sandbox = {
    state,
    courseSlug: 'signals',
    nodeId: 'SS-02-01',
    URLSearchParams,
    page: {
      dispatchEvent: (event) => events.push(event),
      addEventListener: (type, callback) => {
        handlers[type] = callback;
      },
    },
    document: { querySelectorAll: () => [], getElementById: () => null },
    window: {
      FreeBbsLearningAssessment: {
        getSnapshot: () => snapshot,
        selectView: (view, filter) => selected.push({ view, filter }),
      },
      requestAnimationFrame: (callback) => callback(),
      location: { assign() {} },
    },
    CustomEvent: function Event(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
    setKnowledgeView() {},
  };
  vm.runInNewContext(code, sandbox);
  return {
    sandbox,
    selected,
    events,
    handlers,
    state,
    setSnapshot: (value) => {
      snapshot = value;
    },
  };
}

test('an identically numbered heading-only fallback cannot resolve an exploration deep link prematurely', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'practice', questionId: 'Q06' });
  assert.equal(qa.selected.at(-1).filter.assessmentRole, '');
  qa.handlers['knowledge:assessment-updated']({
    detail: { loaded: false, practiceQuestions: [{ id: 'Q06' }] },
  });
  assert.equal(qa.selected.length, 1);
  const real = {
    loaded: true,
    questions: [],
    practiceQuestions: [{ id: 'Q06', assessmentRole: 'exploration' }],
  };
  qa.setSnapshot(real);
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  assert.equal(qa.selected.at(-1).filter.assessmentRole, 'exploration');
  assert.equal(qa.state.learningTask.questionId, 'Q06');
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  assert.equal(
    qa.selected.length,
    2,
    'resolved anchors are consumed once, not on every later attempt',
  );
});

test('guide navigation keeps every real tool, and formal selftest never inherits a practice difficulty filter', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'continue' });
  assert.equal(qa.events.at(-1).detail.tool, 'continue');
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'quick', difficulty: 'basic' });
  assert.equal(qa.selected.at(-1).view, 'quick');
  assert.equal(qa.selected.at(-1).filter, undefined);
});

test('an absent server-loaded question does not reopen a stale destination on future updates', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'practice', questionId: 'ABSENT' });
  const real = { loaded: true, questions: [], practiceQuestions: [] };
  qa.setSnapshot(real);
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  const future = {
    loaded: true,
    questions: [],
    practiceQuestions: [{ id: 'ABSENT', assessmentRole: 'exploration' }],
  };
  qa.setSnapshot(future);
  qa.handlers['knowledge:assessment-updated']({ detail: future });
  assert.equal(qa.selected.length, 1);
});
