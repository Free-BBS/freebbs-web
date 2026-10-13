// Read-only controlled counterexample: real installed analytics listeners and real routers.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createLearningWorkspaceRouter } = require('../backend/learning-workspace');
const {
  createLearningAnalyticsRouter,
  createMemoryAnalyticsStore,
} = require('../backend/learning-analytics');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');

const SOURCE = fs.readFileSync(require.resolve('../public/knowledge-workspace'), 'utf8');
function extract(start, end) {
  const first = SOURCE.indexOf(start);
  const last = SOURCE.indexOf(end, first);
  assert.ok(first > 0 && last > first);
  return SOURCE.slice(first, last);
}
const SAVE = extract('  async function saveForm(', '  function draftAnswer(');
const LOAD = extract('  async function loadEntries(', '  function reviewScope(');
const SESSION = extract(
  "  window.addEventListener('freebbs:session-change', () => {",
  "  window.addEventListener('storage',",
);
const GUARD = '      await loadEntries();\n      if (generation !== state.generation) return;';
assert.ok(
  SAVE.includes(GUARD),
  'Production must contain the explicit post-read guard for this control',
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function target() {
  const listeners = new Map();
  return {
    dataset: { learningTool: 'contribute' },
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
    },
  };
}
async function callRegistered(router, routePath, method, request) {
  const registered = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method.toLowerCase()],
  );
  assert.ok(registered, `Missing registered ${method} ${routePath}`);
  const response = {
    statusCode: 200,
    set() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await registered.route.stack[0].handle(request, response);
  if (response.statusCode >= 400)
    throw Object.assign(new Error(response.payload.message), { status: response.statusCode });
  return response;
}

async function runCase(negativeControl) {
  const current = {
    slug: 'signals',
    course_id: 1,
    course_name: 'Explicit local event-scope fixture',
    node_id: 'SS-01-01',
    document_markdown: '# Explicit memory fixture\n',
    is_active: 1,
  };
  const actorA = { id: 1, uid: 'fixture-a', token: 'fixture-session-a', isLoggedIn: true };
  const actorB = { id: 2, uid: 'fixture-b', token: 'fixture-session-b', isLoggedIn: true };
  const store = createMemoryLearningStore();
  store.context = async () => current;
  const analytics = createMemoryAnalyticsStore({ contexts: [current], users: [actorA, actorB] });
  // Both synthetic accounts explicitly opted in; disabled consent would mask the old event.
  await analytics.setPreferences(1, true);
  await analytics.setPreferences(2, true);
  const workspaceRouter = createLearningWorkspaceRouter({
    store,
    requireAuth: async (request) => request.actor,
  });
  const analyticsRouter = createLearningAnalyticsRouter({
    store: analytics,
    requireAuth: async (request) => request.actor,
  });
  const page = target();
  const window = target();
  const readStarted = deferred();
  const releaseRead = deferred();
  const calls = [];
  const events = [];
  const app = {
    userState: { ...actorA },
    async callApi(url, options = {}) {
      const parsed = new URL(url, 'http://fixture.invalid');
      const actor = { ...this.userState };
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      const learning = parsed.pathname.startsWith('/learning/');
      const response = await callRegistered(
        learning ? workspaceRouter : analyticsRouter,
        learning ? '/:slug/:point/entries' : parsed.pathname.replace('/learning-analytics', ''),
        method,
        {
          actor,
          params: { slug: current.slug, point: current.node_id },
          query: Object.fromEntries(parsed.searchParams),
          body,
        },
      );
      calls.push({ method, path: parsed.pathname, actorId: actor.id, status: response.statusCode });
      if (learning && method === 'GET' && !parsed.search && actor.id === 1) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return response.payload;
    },
  };
  window.freeBbsApp = app;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/learning-analytics'), 'utf8'), {
    window,
    document: {
      querySelector: () => page,
      getElementById: () => null,
      addEventListener() {},
    },
    crypto,
    URLSearchParams,
    performance: { now: () => 1000 },
    setInterval() {},
  });
  page.addEventListener('knowledge:contribution-saved', (event) => {
    events.push({ actorId: app.userState.id, detail: event.detail });
  });
  page.dispatchEvent({
    type: 'knowledge:loaded',
    detail: { course: { slug: current.slug }, node: { id: current.node_id } },
  });
  const flush = () =>
    new Promise((resolve) => {
      setImmediate(resolve);
    });
  await flush();
  await flush();
  const state = {
    generation: 1,
    uid: actorA.uid,
    token: actorA.token,
    ready: true,
    busy: false,
    loadRequest: 0,
  };
  const form = {
    dataset: {},
    querySelectorAll: () => [{ disabled: false }],
    reset() {},
  };
  const scope = {
    state,
    app,
    page,
    window,
    CustomEvent: function ScopeEvent(type, value) {
      this.type = type;
      this.detail = value.detail;
    },
    FormData: class {
      constructor() {
        this.entries = Object.entries({
          title: 'Explicit synthetic contribution A',
          content: 'Synthetic saved suggestion by A',
          category: 'improvement',
        });
      }

      *[Symbol.iterator]() {
        yield* this.entries;
      }
    },
    loggedIn: () => Boolean(app.userState.isLoggedIn),
    endpoint: () => `/learning/${current.slug}/${current.node_id}`,
    el: () => ({ disabled: false }),
    status() {},
    resetNote() {},
    syncContributionForm() {},
    renderEntries() {},
    sessionMessage() {},
    loadAnnotationRecords: async () => {},
    // Only the DOM teardown adapter is substituted, not the actual session listener
    // or save/read guards. No claim about native browser focus, IME or UI is made.
    resetSession: () => {
      state.generation += 1;
      state.uid = app.userState.uid;
      state.token = app.userState.token;
      state.entries = [];
    },
  };
  window.crypto = crypto;
  const saveSource = negativeControl ? SAVE.replace(GUARD, '      await loadEntries();') : SAVE;
  vm.runInNewContext(`${LOAD}\n${saveSource}\n${SESSION}\nthis.saveForm = saveForm;`, scope);
  const pending = scope.saveForm(form, 'contribution');
  await readStarted.promise;
  app.userState = { ...actorB };
  window.dispatchEvent({ type: 'freebbs:session-change' });
  await flush();
  await flush();
  releaseRead.resolve();
  await pending;
  await flush();
  await flush();
  const submissions = analytics.rows.filter(
    (row) => row.metadata_json.action === 'contribution_submit',
  );
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].user, 1);
  assert.deepEqual(state.entries, []);
  assert.equal(events.length, negativeControl ? 1 : 0);
  assert.equal(submissions.length, negativeControl ? 1 : 0);
  if (negativeControl) assert.equal(submissions[0].user_id, 2);
  return {
    mode: negativeControl ? 'explicit-single-guard-removal-negative-control' : 'production',
    savedOwnerId: store.rows[0].user,
    currentOwnerId: app.userState.id,
    staleListNotDisplayed: state.entries.length === 0,
    emittedSuccessEvents: events,
    recordedContributions: submissions.map(({ user_id: userId, node_id: nodeId }) => ({
      userId,
      nodeId,
    })),
    calls,
    passed: true,
  };
}

async function main() {
  const output =
    process.env.LEARNING_FORM_EVENT_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-form-event-scope-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Synthetic form/DOM adapter plus unchanged extracted production saveForm/loadEntries/session listener, full installed analytics controller/listeners and actual registered workspace/analytics handlers against isolated memory stores. No browser/native input claim, network listeners, real accounts/API/AI/MySQL or grade/star writes. The negative control explicitly removes only the new post-read generation guard; it is not claimed as a current-production browser reproduction.',
    sourceHash: crypto.createHash('sha256').update(SAVE).digest('hex'),
    cases: [],
  };
  try {
    report.cases.push(await runCase(true));
    report.cases.push(await runCase(false));
    report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    process.exitCode = 1;
  }
  fs.writeFileSync(path.join(output, 'production-saveForm.js.txt'), SAVE);
  const file = path.join(output, 'form-event-scope-report.json');
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ file, passed: report.passed, error: report.error }, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
