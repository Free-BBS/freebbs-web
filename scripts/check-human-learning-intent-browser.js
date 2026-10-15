// These are local interaction checks, not evidence of learning gains.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function pointer(page, selector) {
  const item = await page.waitForSelector(selector, { visible: true });
  await item.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.waitForFunction(
    (element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.width > 0 && !element.disabled && (hit === element || element.contains(hit));
    },
    {},
    item,
  );
  await item.click();
  await item.dispose();
}

async function buttonText(page, selector, label) {
  const items = await page.$$(selector);
  try {
    for (const item of items) {
      if ((await item.evaluate((element) => element.textContent.trim())) !== label) continue;
      await item.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      const reachable = await item.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return !element.disabled && (hit === element || element.contains(hit));
      });
      assert.ok(reachable, `Real pointer can reach ${label}`);
      await item.click();
      return;
    }
    throw new Error(`No visible task button: ${label}`);
  } finally {
    await Promise.all(items.map((item) => item.dispose()));
  }
}

async function main() {
  const preview = createLearningPreview();
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'human-intent-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Loopback memory backend, authoring example questions; empty public-resource fixture; no production grades or AI.',
    scenes: [],
    errors: [],
    dialogs: [],
  };
  let browser;
  let page;
  let scene = 'launch';
  const checked = (details = {}) => report.scenes.push({ name: scene, ...details });
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('dialog', async (dialog) => {
      report.dialogs.push(dialog.type());
      // Leaving an unsent answer is a real, expected native confirmation, not a navigation failure.
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else {
        report.errors.push(`Unexpected ${dialog.type()} dialog`);
        await dialog.dismiss();
      }
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/course-upload/public/') && url.origin === base)
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: '{"files":[]}',
        });
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({ status: 403, body: 'External services disabled' });
      return request.continue();
    });
    await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&as=student`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(() => window.FreeBbsLearningAssessment?.getSnapshot().loaded);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await pointer(page, '#knowledge-chat-close');

    scene = 'practice-goal-does-not-authorize-formal-selftest';
    await pointer(page, '.learning-start-adjust');
    await page.select('.learning-start-dialog [name="level"]', 'basic');
    await page.select('.learning-start-dialog [name="goal"]', 'practice');
    await pointer(page, '.learning-start-dialog .learning-start-apply');
    await pointer(page, '[data-knowledge-tool="continue"]');
    await page.waitForSelector('.learning-plan-primary button', { visible: true });
    assert.match(
      await page.$eval('.learning-plan-primary h3', (item) => item.textContent),
      /独立尝试/,
    );
    await pointer(page, '.learning-plan-primary .learning-primary');
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().view === 'practice',
    );
    await page.waitForSelector('[data-question-id="SS-02-01-Q03"] form');
    const snapshot = await page.evaluate(() => window.FreeBbsLearningAssessment.getSnapshot());
    assert.equal(snapshot.questions.find((item) => item.id === 'SS-02-01-Q03').official, true);
    assert.equal(preview.assessmentStore.rows.length, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    checked({
      suggestedQuestion: 'SS-02-01-Q03',
      mode: snapshot.view,
      formalBankCount: snapshot.questions.length,
    });

    scene = 'same-published-item-can-be-practised-without-formal-evidence';
    await page.type('[data-question-id="SS-02-01-Q03"] input[type="text"]', '0');
    const practiceRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname.endsWith('/attempts') && request.method() === 'POST',
    );
    await pointer(page, '[data-question-id="SS-02-01-Q03"] button[type="submit"]');
    const practiceBody = JSON.parse((await practiceRequest).postData());
    assert.equal(practiceBody.mode, 'practice');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q03' && item.official === false,
      ),
    );
    assert.equal(preview.assessmentStore.rows.length, 1);
    assert.equal(preview.assessmentStore.rows[0].is_official, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    checked({ requestMode: practiceBody.mode, official: false });

    scene = 'Max-help-is-an-editable-draft-with-current-thinking-and-course-preference';
    await page.type('[data-question-id="SS-02-01-Q03"] input[type="text"]', '我想先核对边界');
    await pointer(page, '[data-question-id="SS-02-01-Q03"] .learning-quiz-ask-max');
    await page.waitForSelector('#knowledge-chat-input', { visible: true });
    const draft = await page.$eval('#knowledge-chat-input', (item) => item.value);
    assert.match(draft, /SS-02-01-Q03/);
    assert.match(draft, /我想先核对边界/);
    assert.match(draft, /先不要直接给完整答案/);
    const maxRequest = await page.evaluate(() =>
      window.freeBbsKnowledge.buildRequest(document.getElementById('knowledge-chat-input').value),
    );
    assert.deepEqual(maxRequest.context.learningStartPreference, {
      level: 'basic',
      goal: 'practice',
    });
    assert.deepEqual(maxRequest.context.learningTask, {
      tool: 'feedback',
      quizView: 'practice',
      questionId: 'SS-02-01-Q03',
    });
    assert.equal(preview.requests.length, 0, 'Draft preparation is not an AI call');
    assert.equal(preview.assessmentStore.rows.length, 1, 'Help does not submit another answer');
    await pointer(page, '#knowledge-chat-close');
    checked({ currentQuestionIncluded: true, selfReportIncluded: true, automaticallySent: false });

    scene = 'explicit-formal-selftest-keeps-all-four-required-items';
    await pointer(page, '[data-knowledge-tool="continue"]');
    await buttonText(page, '.learning-plan-alternatives button', '直接自测');
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().view === 'quick',
    );
    const ids = await page.$$eval('#learning-quiz-list [data-question-id]', (items) =>
      items.map((item) => item.dataset.questionId).sort(),
    );
    assert.deepEqual(ids, ['SS-02-01-Q02', 'SS-02-01-Q03', 'SS-02-01-Q04', 'SS-02-01-Q05']);
    assert.equal(
      await page.$eval(
        '[data-question-id="SS-02-01-Q03"] input[type="text"]',
        (item) => item.value,
      ),
      '',
      'Practice input is not imported into a formal answer',
    );
    await page.type('[data-question-id="SS-02-01-Q03"] input[type="text"]', '0');
    const formalRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname.endsWith('/attempts') && request.method() === 'POST',
    );
    await pointer(page, '[data-question-id="SS-02-01-Q03"] button[type="submit"]');
    const formalBody = JSON.parse((await formalRequest).postData());
    assert.equal(formalBody.mode, 'selftest');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q03' && item.official === true,
      ),
    );
    assert.equal(preview.assessmentStore.rows.length, 2);
    assert.equal(preview.assessmentStore.rows[1].is_official, 1);
    assert.equal(
      preview.starsStore.rows.length,
      0,
      'Passing one of four formal items is not full-node completion',
    );
    await page.screenshot({ path: path.join(output, 'explicit-formal-selftest.png') });
    checked({ formalBank: ids, requestMode: formalBody.mode });

    scene = 'many-practice-records-do-not-hide-an-older-formal-mistake';
    await page.type('[data-question-id="SS-02-01-Q03"] input[type="text"]', '1');
    await pointer(page, '[data-question-id="SS-02-01-Q03"] button[type="submit"]');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) =>
          item.questionId === 'SS-02-01-Q03' && item.official === true && item.verdict === 'fail',
      ),
    );
    // Explicit stress fixture: manufacture repeated private practice records in memory only.
    // The two formal submissions above were made through real UI and the actual local API.
    const practiceRow = preview.assessmentStore.rows.find((item) => item.is_official === 0);
    for (let index = 0; index < 201; index += 1)
      preview.assessmentStore.rows.push({ ...practiceRow, id: String(1000 + index) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.FreeBbsLearningAssessment.getSnapshot().loaded);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await pointer(page, '#knowledge-chat-close');
    const afterHistory = await page.evaluate(() => window.FreeBbsLearningAssessment.getSnapshot());
    assert.equal(afterHistory.attempts.length, 50, 'History remains one bounded page');
    assert.ok(afterHistory.attempts.every((item) => item.official === false));
    assert.equal(afterHistory.currentAttemptsComplete, true);
    assert.equal(
      afterHistory.currentAttempts.length,
      2,
      'Latest formal and practice channels are independent',
    );
    assert.ok(
      afterHistory.currentAttempts.some(
        (item) => item.official === true && item.verdict === 'fail',
      ),
    );
    await pointer(page, '#learning-quiz-tabs [data-quiz-view="mistakes"]');
    const mistakeIds = await page.$$eval('#learning-quiz-list [data-question-id]', (items) =>
      items.map((item) => item.dataset.questionId),
    );
    assert.deepEqual(
      mistakeIds,
      ['SS-02-01-Q03'],
      'An earlier formal mistake is visible without paging through 201 practice records',
    );
    checked({ syntheticRepeatedPractice: 201, loadedHistory: 50, currentChannels: 2, mistakeIds });
    assert.deepEqual(report.errors, []);
    assert.equal(preview.requests.length, 0);
    report.ok = true;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.ok = false;
    report.failedScene = scene;
    report.failure = error.message;
    if (page)
      await page.screenshot({ path: path.join(output, 'intent-failure.png') }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(output, 'intent-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify({ output, ...report }));
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections?.();
    });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
