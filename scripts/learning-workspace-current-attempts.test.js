const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
test('workspace preserves an authoritative empty current summary and undefined for old events', () => {
  const handlers = new Map();
  const sandbox = {
    state: { ready: true, node: { documentVersion: 'current' } },
    page: { addEventListener: (name, handler) => handlers.set(name, handler) },
    refreshPlan() {},
  };
  const from = source.indexOf("  page.addEventListener('knowledge:assessment-updated'");
  vm.runInNewContext(
    source.slice(
      from,
      source.indexOf("  page.addEventListener('knowledge:resources-updated'", from),
    ),
    sandbox,
  );
  const apply = handlers.get('knowledge:assessment-updated');
  const recent = [{ id: 'history-51', questionId: 'practice-only' }];
  const current = [{ id: 'formal-current', questionId: 'required', official: true }];
  apply({ detail: { attempts: recent, currentAttempts: current } });
  assert.equal(sandbox.state.attempts, recent);
  assert.equal(sandbox.state.currentAttempts, current);
  const empty = [];
  apply({ detail: { attempts: recent, currentAttempts: empty } });
  assert.equal(sandbox.state.currentAttempts, empty);
  apply({ detail: { attempts: recent } });
  assert.equal(sandbox.state.currentAttempts, undefined);
  apply({ detail: { currentAttempts: { unsafe: true } } });
  assert.equal(sandbox.state.currentAttempts, undefined);
});

test('refreshPlan forwards current evidence independently from the bounded history list', () => {
  const captured = [];
  const sandbox = {
    state: {
      ready: true,
      node: { id: 'SS-01-01', documentVersion: 'current' },
      attempts: [{ id: 'newer-practice-only' }],
      currentAttempts: [{ id: 'older-required-latest' }],
      entries: [],
      questions: [],
      practiceQuestions: [],
      resources: [],
      planGoal: '',
    },
    window: {
      FreeBbsLearningNextSteps: {
        recommend: (input) => {
          captured.push(input);
          return {};
        },
      },
    },
    renderPlan() {},
  };
  const from = source.indexOf('  function refreshPlan(');
  vm.runInNewContext(source.slice(from, source.indexOf('  function changePlan(', from)), sandbox);
  sandbox.refreshPlan();
  assert.equal(captured[0].currentAttempts, sandbox.state.currentAttempts);
  assert.equal(captured[0].recentAttempts, sandbox.state.attempts);
  sandbox.state.currentAttempts = undefined;
  sandbox.refreshPlan();
  assert.equal(captured[1].currentAttempts, undefined);
});
