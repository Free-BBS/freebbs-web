// Read-only finding probe: production listeners/PUT router with explicit memory DOM fixtures.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');
const {
  createLearningWorkspaceRouter,
  documentVersion,
  validateEntry,
} = require('../backend/learning-workspace');
const { stableBlocks, createAnchor } = require('../public/knowledge-annotations');

async function runCase(mode, expectedFixed) {
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Explicit synthetic DOM/events, the actual installed production annotation listeners, extracted unchanged production saveAnnotation function and registered PUT/GET workspace handlers plus an isolated memory store. Not Chrome, native focus/IME evidence, real accounts, HTTP listener, real API/AI/MySQL or durable storage. A passing finding assertion means the defect is reproduced, not that the behavior is healthy.',
    requests: [],
    loadedRecords: [],
    mode,
  };
  try {
    // Reuse only the existing diagnostic DOM adapter; do not execute its main or assertions.
    const helperFile = require.resolve('./diagnose-learning-interruption-boundaries');
    const helperSource = fs.readFileSync(helperFile, 'utf8');
    const helperEnd = helperSource.indexOf('\nasync function runCase(mode) {');
    assert.ok(helperEnd > 0);
    const helperContext = { require: createRequire(helperFile), setImmediate };
    vm.runInNewContext(
      `${helperSource.slice(0, helperEnd)}\nthis.auditHelpers = { annotationUi, deferred, tick };`,
      helperContext,
    );
    const { annotationUi, deferred, tick } = helperContext.auditHelpers;
    const actor = { id: 1, uid: 'fixture-student', token: 'fixture-session', isLoggedIn: true };
    const context = {
      slug: 'signals',
      course_id: 1,
      node_id: 'SS-01-01',
      document_markdown: '# Explicit local fixture\n\nPUBLIC QUOTE\n',
    };
    const store = createMemoryLearningStore();
    store.context = async () => context;
    const router = createLearningWorkspaceRouter({
      store,
      requireAuth: async (request) => request.actor,
    });
    const call = async (method, id, body) => {
      const routePath = id ? '/:slug/:point/entries/:id' : '/:slug/:point/entries';
      const registered = router.stack.find(
        (entry) => entry.route?.path === routePath && entry.route.methods[method.toLowerCase()],
      );
      assert.ok(registered);
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
      await registered.route.stack[0].handle(
        {
          actor,
          params: { slug: 'signals', point: context.node_id, ...(id ? { id } : {}) },
          query: { kind: 'note', annotations: '1' },
          body,
        },
        response,
      );
      return response;
    };
    const [block] = stableBlocks([{ text: 'PUBLIC QUOTE' }]);
    const anchor = createAnchor({
      nodeId: context.node_id,
      documentVersion: documentVersion(context),
      block,
      start: 0,
      end: block.text.length,
    });
    const seed = await store.create(
      actor,
      context,
      validateEntry({
        kind: 'note',
        title: 'Explicit saved annotation fixture',
        content: 'original saved thought',
        annotation: { style: 'comment', color: 'yellow', anchor },
      }),
      crypto.randomUUID(),
    );
    const secondEntry =
      mode === 'another-entry'
        ? await store.create(
            actor,
            context,
            validateEntry({
              kind: 'note',
              title: 'Explicit second annotation fixture',
              content: 'second original thought',
              annotation: { style: 'comment', color: 'yellow', anchor },
            }),
            crypto.randomUUID(),
          )
        : null;
    const app = { userState: actor };
    const ui = annotationUi(app);
    const state = { generation: 1, busy: false };
    const receipt = deferred();
    const firstWritten = deferred();
    const saves = [];
    app.callApi = async (url, options) => {
      const body = JSON.parse(options.body);
      const id = decodeURIComponent(url.split('/').at(-1));
      const response = await call('PUT', id, body);
      report.requests.push({ url, id, method: options.method, body, status: response.statusCode });
      if (report.requests.length === 1) {
        firstWritten.resolve();
        await receipt.promise;
      }
      if (response.statusCode !== 200)
        throw Object.assign(new Error(response.payload.message), { status: response.statusCode });
      return response.payload;
    };
    const source = fs.readFileSync(require.resolve('../public/knowledge-workspace'), 'utf8');
    const start = source.indexOf('  async function saveAnnotation(detail) {');
    const end = source.indexOf('  function resetSession(', start);
    assert.ok(start > 0 && end > start);
    const scope = {
      state,
      app,
      page: ui.page,
      window: ui.browser,
      CustomEvent: ui.browser.CustomEvent,
      loggedIn: () => true,
      endpoint: () => '/learning/signals/SS-01-01',
      el: () => ui.elements.get('learning-annotation-status'),
      loadEntries: async () => {
        const response = await call('GET');
        assert.equal(response.statusCode, 200);
        report.loadedRecords.push(
          response.payload.entries.map(({ id, revision }) => ({ id, revision })),
        );
        await ui.emit('knowledge:annotation-records-loaded', response.payload);
      },
    };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.saveAnnotation = saveAnnotation;`, scope);
    ui.page.addEventListener('knowledge:annotation-save', (event) => {
      const saving = scope.saveAnnotation(event.detail);
      saves.push(saving);
      return saving;
    });
    await ui.emit('knowledge:loaded', {
      course: { slug: 'signals' },
      node: { id: context.node_id, documentVersion: documentVersion(context) },
    });
    await ui.emit('knowledge:annotation-records-loaded', {
      entries: [seed, secondEntry].filter(Boolean),
    });
    const editId = async (id) => {
      const card = ui.elements
        .get('learning-annotation-list')
        .children.find((item) => String(item.dataset.annotationId) === String(id));
      assert.ok(card);
      await card.children.at(-1).dispatchEvent({ type: 'click' });
    };
    await editId(seed.id);
    const comment = ui.elements.get('learning-annotation-comment');
    comment.value = 'A: first updated thought';
    await ui.clickSave();
    await firstWritten.promise;
    assert.equal(store.rows[0].revision, 2);
    assert.equal(store.rows[0].content, 'A: first updated thought');
    const b = 'B: continued thought while A receipt was pending';
    if (secondEntry) await editId(secondEntry.id);
    if (mode !== 'unchanged') comment.value = b;
    if (mode === 'concurrent-client') {
      // An independent same-owner client uses the real route to advance revision 2 to 3.
      // This is an explicit concurrency fixture, not a real multi-device/login claim.
      const response = await call('PUT', seed.id, {
        ...report.requests[0].body,
        revision: 2,
        content: 'C: independently committed revision 3',
      });
      assert.equal(response.statusCode, 200);
      assert.equal(store.rows[0].revision, 3);
      report.concurrentClient = { status: response.statusCode, revision: 3 };
    }
    receipt.resolve();
    await Promise.all(saves);
    await tick();
    report.afterFirstReceipt = {
      value: comment.value,
      status: ui.elements.get('learning-annotation-status').textContent,
      busy: state.busy,
    };
    assert.equal(state.busy, false);
    if (mode === 'unchanged') {
      assert.equal(comment.value, '');
      const before = saves.length;
      await ui.clickSave();
      assert.equal(saves.length, before, 'Unchanged successful A cleared the active selection');
      assert.equal(report.requests.length, 1);
      assert.equal(store.rows[0].revision, 2);
      report.passed = true;
      report.finishedAt = new Date().toISOString();
      return report;
    }
    assert.equal(comment.value, b);
    await ui.clickSave();
    await Promise.all(saves);
    await tick();
    report.afterSecondSave = {
      value: comment.value,
      status: ui.elements.get('learning-annotation-status').textContent,
      stored: store.rows.map(({ id, content, revision }) => ({ id, content, revision })),
    };
    if (!expectedFixed) {
      assert.deepEqual(
        report.requests.map(({ status }) => status),
        [200, 409],
      );
      assert.deepEqual(
        report.requests.map(({ body }) => body.revision),
        [1, 1],
      );
      assert.deepEqual(report.loadedRecords, [[{ id: seed.id, revision: 2 }]]);
      assert.equal(comment.value, b);
      assert.match(report.afterSecondSave.status, /保存失败.*笔记已变更/);
      assert.equal(store.rows[0].revision, 2);
      assert.equal(store.rows[0].content, 'A: first updated thought');
      report.confirmed = true;
      report.finding =
        'A PUT commits revision 2, records-loaded contains revision 2, and its delayed ACK preserves newer B. The active editor nevertheless submits revision 1 again, receives 409 and leaves B unsaved.';
    } else if (mode === 'concurrent-client') {
      assert.deepEqual(
        report.requests.map(({ status }) => status),
        [200, 409],
      );
      assert.deepEqual(
        report.requests.map(({ body }) => body.revision),
        [1, 2],
      );
      assert.equal(report.loadedRecords[0][0].revision, 3);
      assert.equal(comment.value, b);
      assert.match(report.afterSecondSave.status, /保存失败.*笔记已变更/);
      assert.equal(store.rows[0].revision, 3);
      assert.equal(store.rows[0].content, 'C: independently committed revision 3');
    } else {
      assert.deepEqual(
        report.requests.map(({ status }) => status),
        [200, 200],
      );
      assert.deepEqual(
        report.requests.map(({ body }) => body.revision),
        mode === 'another-entry' ? [1, 1] : [1, 2],
      );
      if (secondEntry) {
        assert.deepEqual(
          report.requests.map(({ id }) => id),
          [seed.id, secondEntry.id],
        );
        assert.equal(store.rows[0].content, 'A: first updated thought');
        assert.equal(store.rows[0].revision, 2);
        assert.equal(store.rows[1].content, b);
        assert.equal(store.rows[1].revision, 2);
      } else {
        assert.equal(store.rows[0].content, b);
        assert.equal(store.rows[0].revision, 3);
      }
      assert.equal(comment.value, '');
      assert.notEqual(report.requests[0].body.requestKey, report.requests[1].body.requestKey);
    }
    report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main() {
  const expectedFixed = process.argv.includes('--expected-fixed');
  const output =
    process.env.LEARNING_ANNOTATION_REVISION_DIAGNOSTIC_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-annotation-revision-audit-'));
  fs.mkdirSync(output, { recursive: true });
  const modes = expectedFixed
    ? ['continued-input', 'unchanged', 'concurrent-client', 'another-entry']
    : ['continued-input'];
  const report = {
    expectedFixed,
    expectation: expectedFixed
      ? 'Strict fixed-mode controls; unchanged A clears, continuing B advances only its acknowledged base, real concurrent revision 3 conflicts, and another entry never receives the old entry revision.'
      : 'Retained finding assertions; a fixed product must fail this baseline diagnostic, never quietly turn green.',
    cases: [],
  };
  for (const mode of modes) report.cases.push(await runCase(mode, expectedFixed));
  report.passed = report.cases.every((entry) => entry.passed);
  const file = path.join(
    output,
    expectedFixed ? 'annotation-revision-fixed.json' : 'annotation-revision-continuation.json',
  );
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        report: file,
        passed: report.passed,
        cases: report.cases.map(({ mode, passed, confirmed, error }) => ({
          mode,
          passed,
          confirmed,
          error,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
