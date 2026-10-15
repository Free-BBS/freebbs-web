// Independent, local-only review continuity probe. Never submits real course grades.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');

const ROOT = path.resolve(__dirname, '..');
const POINT = 'SS-01-01';
const QUESTION = 'SS-01-01-Q-explain';
const COMPOSITION_TEXT = '中文组合输入';
const COMMIT_TEXT = '中文组合输入完成';
const MODES = [
  'keyboard-selection',
  'native-composition',
  'prewrite-failure',
  'lost-acknowledgement',
  'permission-late-finally',
  'version-late-finally',
];
const textareaFor = (id) => `.learning-quiz-result[data-attempt-id="${id}"] textarea`;
const scoreFor = (id) => `.learning-quiz-result[data-attempt-id="${id}"] input[type="number"]`;
const submitFor = (id) =>
  `.learning-quiz-result[data-attempt-id="${id}"] form button[type="submit"]`;
const formFor = (id) => `.learning-quiz-result[data-attempt-id="${id}"] .learning-quiz-review-form`;
const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function productionHash() {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, 'public/learning-assessment.js')))
    .digest('hex');
}

function seedPair(preview, label) {
  const context = preview.assessmentStore.contexts.find((row) => row.node_id === POINT);
  const documentVersion = getAssessmentDocumentVersion(context.document_markdown);
  const ids = {};
  // Increasing ids mean A is the first pending record and B the next one.
  for (const name of ['B', 'A']) {
    const id = String(preview.assessmentStore.rows.length + 1);
    ids[name] = id;
    const snapshot = {
      id: QUESTION,
      type: 'short_answer',
      prompt: `${label} ${name}：历史夹具，请解释输入拆分、移位响应与线性叠加。`,
      questionVersion: `review-focus-fixture-${label}-${name}`,
      scoring: {
        method: 'manual',
        rubric: '本地夹具评分依据：解释输入拆分、移位与线性叠加。',
        maxScore: 3,
        passScore: 2,
      },
      explanation: '仅用于本机浏览器连续编辑验收，非正式课程判分。',
    };
    preview.assessmentStore.rows.push({
      id,
      user_id: name === 'A' ? 1 : 2,
      course_id: 1,
      node_id: POINT,
      question_id: QUESTION,
      question_version: snapshot.questionVersion,
      document_version: documentVersion,
      question_snapshot: JSON.stringify(snapshot),
      answer_json: JSON.stringify(`学生 ${name} 的人工构造夹具作答。`),
      status: 'pending_review',
      verdict: 'pending',
      is_official: 1,
      score: null,
      max_score: 3,
      pass_score: 2,
      feedback: '',
      grading_basis: snapshot.scoring.rubric,
      reference_markdown: snapshot.explanation,
      request_key: crypto.randomUUID(),
      reviewed_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return ids;
}

async function click(page, selector) {
  await page.bringToFront();
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const canClick = await page.$eval(selector, (item) => {
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = item.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    });
    if (canClick) {
      await page.click(selector);
      return;
    }
    await delay(50);
  }
  throw new Error(`Actual click target remained obscured: ${selector}`);
}

async function fill(page, selector, text) {
  await click(page, selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.keyboard.type(text);
}

async function probe(page, id) {
  return page.evaluate((attemptId) => {
    const old = window.qaReviewB;
    const current = document.querySelector(
      `.learning-quiz-result[data-attempt-id="${attemptId}"] textarea`,
    );
    const score = document.querySelector(
      `.learning-quiz-result[data-attempt-id="${attemptId}"] input[type="number"]`,
    );
    const active = document.activeElement;
    return {
      at: performance.now(),
      sameNode: current === old,
      oldConnected: Boolean(old?.isConnected),
      currentConnected: Boolean(current?.isConnected),
      activeIsOld: active === old,
      activeIsCurrent: active === current,
      active: {
        tag: active?.tagName || null,
        id: active?.id || null,
        className: active?.className || null,
        attemptId: active?.closest('[data-attempt-id]')?.dataset.attemptId || null,
      },
      oldValue: old?.value ?? null,
      value: current?.value ?? null,
      score: score?.value ?? null,
      selection: current
        ? {
            start: current.selectionStart,
            end: current.selectionEnd,
            direction: current.selectionDirection,
          }
        : null,
      oldSelection: old
        ? { start: old.selectionStart, end: old.selectionEnd, direction: old.selectionDirection }
        : null,
      events: window.qaReviewEvents || [],
    };
  }, id);
}

async function probeOriginalA(page) {
  return page.evaluate(() => {
    const form = window.qaReviewA;
    const score = form.querySelector('input[type="number"]');
    const feedback = form.querySelector('textarea');
    const button = form.querySelector('button[type="submit"]');
    return {
      connected: form.isConnected,
      score: score.value,
      feedback: feedback.value,
      scoreDisabled: score.disabled,
      feedbackDisabled: feedback.disabled,
      submitDisabled: button.disabled,
    };
  });
}

async function runCase({ browser, preview, base, output, report, mode }) {
  const ids = seedPair(preview, mode);
  const result = { name: mode, ids, sourceHash: productionHash(), checks: {}, failures: [] };
  report.cases.push(result);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const session = await page.createCDPSession();
  let heldResponse;
  let heldPrewriteRequest;
  let failureDelivered = false;
  let armed = false;
  const originalPermission = preview.assessmentStore.canReview;
  const courseContext = preview.assessmentStore.contexts.find((row) => row.node_id === POINT);
  const originalDocument = courseContext.document_markdown;
  const interceptionErrors = [];
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.endsWith('/learning-assessment.js')) return;
    try {
      result.loadedSourceHash = crypto
        .createHash('sha256')
        .update(await response.buffer())
        .digest('hex');
    } catch (error) {
      result.sourceCaptureError = error.message;
    }
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.setViewport({ width: 1440, height: 960 });
  await page.evaluateOnNewDocument(() => {
    window.qaReviewEvents = [];
    const eventTypes = [
      'focusin',
      'focusout',
      'input',
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ];
    for (const type of eventTypes) {
      document.addEventListener(type, (event) => {
        if (!event.target.matches?.('.learning-quiz-review-form textarea')) return;
        window.qaReviewEvents.push({
          type,
          trusted: event.isTrusted,
          at: performance.now(),
          attemptId: event.target.closest('[data-attempt-id]')?.dataset.attemptId || null,
          data: event.data ?? null,
          inputType: event.inputType ?? null,
          isComposing: event.isComposing ?? null,
        });
      });
    }
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    });
  });
  session.on('Fetch.requestPaused', async (event) => {
    try {
      const url = new URL(event.request.url);
      if (event.responseStatusCode !== undefined) {
        if (
          armed &&
          event.request.method === 'PATCH' &&
          url.pathname.endsWith(`/attempts/${ids.A}/review`)
        ) {
          const body = await session.send('Fetch.getResponseBody', { requestId: event.requestId });
          const payload = JSON.parse(
            body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body,
          );
          result.heldResponse = {
            status: event.responseStatusCode,
            method: event.request.method,
            route: url.pathname,
            serverRowStatus: preview.assessmentStore.rows.find((row) => row.id === ids.A)?.status,
            replayed: payload.replayed === true,
          };
          heldResponse = event.requestId;
          return;
        }
        await session.send('Fetch.continueResponse', { requestId: event.requestId });
      } else if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== base) {
        report.blockedExternal.push(`${url.origin}${url.pathname}`);
        await session.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 403,
          body: Buffer.from('External network disabled in local QA').toString('base64'),
        });
      } else {
        if (
          armed &&
          !failureDelivered &&
          ['prewrite-failure', 'permission-late-finally', 'version-late-finally'].includes(mode) &&
          event.request.method === 'PATCH' &&
          url.pathname.endsWith(`/attempts/${ids.A}/review`)
        ) {
          heldPrewriteRequest = event.requestId;
          result.firstPause = {
            stage: 'Request',
            serverRowStatus: preview.assessmentStore.rows.find((row) => row.id === ids.A)?.status,
          };
          return;
        }
        await session.send('Fetch.continueRequest', { requestId: event.requestId });
      }
    } catch (error) {
      interceptionErrors.push(error.message);
    }
  });
  await session.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*', requestStage: 'Request' },
      { urlPattern: '*/attempts/*/review', requestStage: 'Response' },
    ],
  });
  const screenshot = async (name) => {
    const filename = path.join(output, `${mode}-${name}.png`);
    await page.screenshot({ path: filename, fullPage: false });
    report.screenshots.push(filename);
  };
  try {
    await page.goto(`${base}/knowledge?course=signals&point=${POINT}&tool=feedback&as=manager`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    if (await page.$('.learning-start-dialog[open]')) {
      await page.select('[data-learning-start-choice="level"]', 'familiar');
      await click(page, '.learning-start-dialog[open] .learning-start-apply');
      await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    }
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment?.getSnapshot()?.loaded === true,
    );
    await click(page, '[data-learning-tool="feedback"]');
    await click(page, '#learning-quiz-results > button:not(.learning-quiz-review-more)');
    await page.waitForSelector(formFor(ids.B));
    await fill(page, scoreFor(ids.B), '0');
    await fill(page, textareaFor(ids.B), 'B：已说明拆分，但还需要整理移位响应。');
    if (mode === 'native-composition') {
      // Same protocol, no A response/render: calibrate Chrome's compositionend
      // trust flag rather than assuming CDP is identical to an OS Chinese IME.
      await session.send('Input.imeSetComposition', {
        text: COMPOSITION_TEXT,
        selectionStart: COMPOSITION_TEXT.length,
        selectionEnd: COMPOSITION_TEXT.length,
      });
      await session.send('Input.insertText', { text: COMMIT_TEXT });
      result.compositionControl = await page.evaluate((bId) => {
        const field = document.querySelector(
          `.learning-quiz-result[data-attempt-id="${bId}"] textarea`,
        );
        return {
          value: field.value,
          events: window.qaReviewEvents.filter(
            (event) => event.attemptId === bId && event.type.startsWith('composition'),
          ),
        };
      }, ids.B);
      await fill(page, textareaFor(ids.B), 'B：已说明拆分，但还需要整理移位响应。');
    }
    await fill(page, scoreFor(ids.A), mode === 'lost-acknowledgement' ? '0' : '3');
    await fill(page, textareaFor(ids.A), 'A：仅本地夹具复核，已说明拆分、移位与叠加。');
    await page.$eval(formFor(ids.A), (form) => {
      window.qaReviewA = form;
    });
    result.submittedA = await probeOriginalA(page);
    armed = true;
    await click(page, submitFor(ids.A));
    const deadline = Date.now() + 10000;
    while (
      !heldResponse &&
      !heldPrewriteRequest &&
      !interceptionErrors.length &&
      Date.now() < deadline
    )
      await delay(25);
    assert.ok(
      heldResponse || heldPrewriteRequest,
      `A real PATCH response was not intercepted: ${interceptionErrors.join('; ')}`,
    );
    const rejectLockedAInput = async (name) => {
      const before = await probeOriginalA(page);
      assert.equal(before.scoreDisabled, true);
      assert.equal(before.feedbackDisabled, true);
      assert.equal(before.submitDisabled, true);
      await click(page, scoreFor(ids.A));
      await page.keyboard.type('9');
      await click(page, textareaFor(ids.A));
      await page.keyboard.type('【不应写入A】');
      const after = await probeOriginalA(page);
      assert.equal(after.score, before.score);
      assert.equal(after.feedback, before.feedback);
      result[name] = {
        before,
        after,
        bScoreDisabled: await page.$eval(scoreFor(ids.B), (field) => field.disabled),
        bFeedbackDisabled: await page.$eval(textareaFor(ids.B), (field) => field.disabled),
      };
      assert.equal(result[name].bScoreDisabled, false);
      assert.equal(result[name].bFeedbackDisabled, false);
      await screenshot(name);
    };
    await rejectLockedAInput('a-locked-rejects-real-keyboard');
    if (['permission-late-finally', 'version-late-finally'].includes(mode)) {
      if (mode === 'permission-late-finally') {
        // Process-only permission fixture, followed by a real queue-refresh click.
        preview.assessmentStore.canReview = async () => false;
        await click(page, '#learning-quiz-results > button:not(.learning-quiz-review-more)');
        await page.waitForFunction(() => !document.querySelector('.learning-quiz-review-form'));
      } else {
        // Version mutation + the production public refresh API is a diagnostic
        // control, not a claim that a human used an authoring/publishing workflow.
        courseContext.document_markdown = `${originalDocument}\n\n本地夹具：正文版本已变化。`;
        await page.evaluate(() => window.FreeBbsLearningAssessment.refresh());
        await page.waitForFunction(() => !document.querySelector('.learning-quiz-review-form'));
      }
      result.invalidatedBeforeLateReply = await probeOriginalA(page);
      failureDelivered = true;
      await session.send('Fetch.fulfillRequest', {
        requestId: heldPrewriteRequest,
        responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ message: '本地夹具：失效范围的迟到提交失败' })).toString(
          'base64',
        ),
      });
      heldPrewriteRequest = null;
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 });
      result.afterLateFinally = await probeOriginalA(page);
      assert.equal(result.afterLateFinally.connected, false);
      assert.equal(result.afterLateFinally.scoreDisabled, true);
      assert.equal(result.afterLateFinally.feedbackDisabled, true);
      assert.equal(result.afterLateFinally.submitDisabled, true);
      assert.equal(
        preview.assessmentStore.rows.find((row) => row.id === ids.A).status,
        'pending_review',
      );
      await screenshot('invalidated-a-stays-locked-after-late-finally');
      result.checks['invalidated-controls-never-reenabled'] = true;
      result.passed = true;
      return;
    }
    if (['prewrite-failure', 'lost-acknowledgement'].includes(mode)) {
      if (mode === 'lost-acknowledgement') {
        assert.equal(result.heldResponse.status, 200);
        assert.equal(result.heldResponse.serverRowStatus, 'graded');
      } else assert.equal(result.firstPause.serverRowStatus, 'pending_review');
      // Keep B actively editing while the first attempt returns an explicit 503.
      await click(page, textareaFor(ids.B));
      await page.keyboard.type(' B在失败回执期间继续编辑。');
      await page.$eval(textareaFor(ids.B), (field) => {
        window.qaReviewB = field;
      });
      const beforeFailure = await probe(page, ids.B);
      failureDelivered = true;
      await session.send('Fetch.fulfillRequest', {
        requestId: heldPrewriteRequest || heldResponse,
        responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({
            message:
              mode === 'lost-acknowledgement'
                ? '本地夹具：已落库的成功回执丢失，请原样重试'
                : '本地夹具：写入前503，可重试',
          }),
        ).toString('base64'),
      });
      heldPrewriteRequest = null;
      heldResponse = null;
      await page.waitForFunction(
        (aId) => {
          const form = document.querySelector(
            `.learning-quiz-result[data-attempt-id="${aId}"] .learning-quiz-review-form`,
          );
          return (
            form &&
            !form.querySelector('textarea').disabled &&
            !form.querySelector('input').disabled &&
            !form.querySelector('button').disabled
          );
        },
        {},
        ids.A,
      );
      const afterFailure = await probe(page, ids.B);
      result.firstFailure = {
        beforeFailure,
        afterFailure,
        a: await probeOriginalA(page),
        committed: preview.assessmentStore.rows.find((row) => row.id === ids.A).status === 'graded',
      };
      assert.equal(result.firstFailure.a.score, result.submittedA.score);
      assert.equal(result.firstFailure.a.feedback, result.submittedA.feedback);
      assert.equal(afterFailure.sameNode, true);
      assert.equal(afterFailure.activeIsCurrent, true);
      assert.equal(afterFailure.value, beforeFailure.value);
      await screenshot('failure-unlocks-a-and-keeps-b-editing');
      await click(page, submitFor(ids.A));
      const retryDeadline = Date.now() + 10000;
      while (!heldResponse && !interceptionErrors.length && Date.now() < retryDeadline)
        await delay(25);
      assert.ok(heldResponse, 'The real retry receipt did not arrive');
      assert.equal(result.heldResponse.replayed, mode === 'lost-acknowledgement');
      result.retryResponse = { ...result.heldResponse };
      await rejectLockedAInput('retry-a-still-locked');
    }
    assert.equal(result.heldResponse.status, 200);
    assert.equal(result.heldResponse.serverRowStatus, 'graded');
    // All focus and selection changes below are trusted click/keyboard inputs.
    await click(page, textareaFor(ids.B));
    await page.keyboard.press('End');
    await page.keyboard.type(' 继续补充中文反馈。');
    if (mode === 'native-composition') {
      await session.send('Input.imeSetComposition', {
        text: COMPOSITION_TEXT,
        selectionStart: COMPOSITION_TEXT.length,
        selectionEnd: COMPOSITION_TEXT.length,
      });
    } else {
      await page.keyboard.down('Control');
      await page.keyboard.press('Home');
      await page.keyboard.up('Control');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');
    }
    // A retained JS reference is observation only; it does not focus or mutate the field.
    await page.$eval(textareaFor(ids.B), (field) => {
      window.qaReviewB = field;
    });
    result.before = await probe(page, ids.B);
    assert.equal(result.before.activeIsCurrent, true);
    assert.equal(result.before.score, '0');
    await screenshot('before-a-response');
    result.responseReleasedAt = await page.evaluate(() => performance.now());
    await session.send('Fetch.continueResponse', { requestId: heldResponse });
    heldResponse = null;
    await page.waitForFunction(
      (aId) =>
        !document.querySelector(
          `.learning-quiz-result[data-attempt-id="${aId}"] .learning-quiz-review-form`,
        ),
      { timeout: 10000 },
      ids.A,
    );
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 });
    result.after = await probe(page, ids.B);
    result.completedA = await probeOriginalA(page);
    assert.equal(result.completedA.connected, false);
    assert.equal(result.completedA.scoreDisabled, true);
    assert.equal(result.completedA.feedbackDisabled, true);
    const storedA = preview.assessmentStore.rows.find((row) => row.id === ids.A);
    result.savedA = {
      score: storedA.score,
      feedback: storedA.feedback,
      reviewedBy: String(storedA.reviewed_by),
    };
    assert.equal(result.savedA.score, Number(result.submittedA.score));
    assert.equal(result.savedA.feedback, result.submittedA.feedback);
    await screenshot('after-a-completed');
    if (mode === 'native-composition') {
      // Native Chrome composition is an explicit fixture, not a Windows IME claim.
      // A different final commit distinguishes live composition from copied preedit text.
      await session.send('Input.insertText', { text: COMMIT_TEXT });
    } else {
      // Continue typing WITHOUT another click. A focus-loss bug must remain visible.
      await page.keyboard.type('【继续键盘输入】');
    }
    result.afterContinuation = await probe(page, ids.B);
    await screenshot('after-continuation-without-refocus');
    const check = (name, pass) => {
      result.checks[name] = Boolean(pass);
      if (!pass) result.failures.push(name);
    };
    check('same-b-textarea-node', result.after.sameNode);
    check('original-b-textarea-connected', result.after.oldConnected);
    check('b-still-active', result.after.activeIsCurrent);
    check('zero-score-preserved', result.after.score === '0');
    check('b-text-preserved', result.after.value === result.before.value);
    check(
      'b-selection-preserved',
      JSON.stringify(result.after.selection) === JSON.stringify(result.before.selection),
    );
    if (mode === 'native-composition') {
      check(
        'native-composition-was-active',
        result.before.events.some(
          (event) =>
            event.type === 'compositionstart' && event.trusted && event.attemptId === ids.B,
        ),
      );
      const expected = `${result.before.value.slice(0, -COMPOSITION_TEXT.length)}${COMMIT_TEXT}`;
      result.expectedContinuation = expected;
      result.postResponseCompositionEvents = result.afterContinuation.events.filter(
        (event) =>
          event.type.startsWith('composition') &&
          event.attemptId === ids.B &&
          event.at >= result.responseReleasedAt,
      );
      check('native-composition-commit-reaches-b', result.afterContinuation.value === expected);
      const controlEnd = result.compositionControl.events.find(
        (event) => event.type === 'compositionend' && event.data === COMMIT_TEXT,
      );
      check(
        'native-composition-no-refresh-control-commits',
        result.compositionControl.value.endsWith(COMMIT_TEXT) && Boolean(controlEnd),
      );
      check(
        'native-composition-trusted-input-reaches-b',
        result.afterContinuation.events.some(
          (event) =>
            event.at >= result.responseReleasedAt &&
            event.attemptId === ids.B &&
            event.type === 'input' &&
            event.trusted &&
            event.isComposing &&
            event.data === COMMIT_TEXT,
        ),
      );
      check(
        'native-composition-end-matches-no-refresh-control',
        result.postResponseCompositionEvents.some(
          (event) =>
            event.type === 'compositionend' &&
            event.data === COMMIT_TEXT &&
            event.trusted === controlEnd?.trusted,
        ),
      );
    } else {
      const { start, end } = result.before.selection;
      const expected = `${result.before.value.slice(0, start)}【继续键盘输入】${result.before.value.slice(end)}`;
      result.expectedContinuation = expected;
      check('continued-keyboard-input-reaches-b', result.afterContinuation.value === expected);
    }
    result.passed = result.failures.length === 0;
  } catch (error) {
    result.error = error.stack || error.message;
    result.passed = false;
    try {
      result.failureSnapshot = await probe(page, ids.B);
      await screenshot('unexpected-failure');
    } catch (snapshotError) {
      result.snapshotError = snapshotError.message;
    }
  } finally {
    if (heldResponse) {
      try {
        await session.send('Fetch.continueResponse', { requestId: heldResponse });
      } catch {
        // Closing the isolated browser below also aborts a paused request.
      }
    }
    if (heldPrewriteRequest) {
      try {
        await session.send('Fetch.failRequest', {
          requestId: heldPrewriteRequest,
          errorReason: 'Aborted',
        });
      } catch {
        /* Isolated context close also aborts this request. */
      }
    }
    preview.assessmentStore.canReview = originalPermission;
    courseContext.document_markdown = originalDocument;
    result.interceptionErrors = interceptionErrors;
    result.sourceHashAtEnd = productionHash();
    await context.close();
  }
}

async function main() {
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-review-focus-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    fixture:
      'Isolated loopback createLearningPreview, real assessment router and Chrome DOM. Synthetic historical manual-review pairs per case; no formal course grades, no external network, no real AI.',
    boundaries: [
      'Success and acknowledgement-loss cases pause a real PATCH/200 after the memory-store update; prewrite-failure/late-finally cases pause before router delivery and explicitly return a fixture503.',
      'B focus/selection use native clicks and keyboard input. No DOM focus(), event dispatch or mock rendering is used.',
      'Native-composition uses Chrome Input.imeSetComposition/insertText, not the Windows Chinese IME or candidate UI.',
      'A no-refresh control records Chrome CDP compositionend.isTrusted; compositionupdate/input must be trusted, and the final commit must replace preedit in the same B field.',
      'Permission revocation mutates only this preview store; server-version invalidation uses a process-only document mutation + production refresh API, not a human publishing claim.',
      'No production or existing QA module is edited; both Chrome contexts and the ephemeral server are closed.',
    ],
    cases: [],
    screenshots: [],
    blockedExternal: [],
    pageErrors: [],
  };
  const preview = createLearningPreview();
  let browser;
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    const base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    // Existing, explicitly supplied local runtime; never install a dependency in this probe.
    // eslint-disable-next-line import/no-dynamic-require
    const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE,
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    });
    report.chrome = await browser.version();
    for (const mode of MODES) {
      await runCase({ browser, preview, base, output, report, mode });
    }
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.error = error.stack || error.message;
  } finally {
    report.aiRequests = preview.requests.length;
    if (browser) await browser.close();
    preview.server.closeAllConnections?.();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    report.closed = true;
    report.finishedAt = new Date().toISOString();
    report.passed =
      !report.error &&
      report.cases.length === MODES.length &&
      report.cases.every((item) => item.passed) &&
      report.pageErrors.length === 0 &&
      report.aiRequests === 0;
    const filename = path.join(output, 'review-focus-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: filename,
          passed: report.passed,
          cases: report.cases.map((item) => ({
            name: item.name,
            passed: item.passed,
            failures: item.failures,
            error: item.error,
          })),
          aiRequests: report.aiRequests,
          closed: report.closed,
        },
        null,
        2,
      ),
    );
    if (!report.passed) process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main };
