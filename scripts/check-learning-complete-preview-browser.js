// One origin, real navigation and controls, isolated records, explicitly simulated AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

async function click(page, selector) {
  await page.locator(selector).setTimeout(15000).click();
}

async function selectProse(page) {
  const box = await page.evaluate(() => {
    const body = document.getElementById('knowledge-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.parentElement.closest('p,li') || text.parentElement.closest('.katex')) continue;
      const offset = text.textContent.search(/\S/);
      if (offset < 0 || text.textContent.trim().length < 14) continue;
      text.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 12);
      const rect = [...range.getClientRects()].find((item) => item.width > 50);
      if (!rect) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!body.contains(hit)) continue;
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
    }
    return null;
  });
  assert.ok(box, 'An actual prose fragment is visible and hit-testable');
  // Range above measures geometry only. Native pointer dragging creates the selection.
  await page.mouse.move(box.left + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.right - 1, box.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForSelector('#learning-annotation-toolbar:not([hidden])', { visible: true });
}

async function ready(page) {
  await page.waitForFunction(() => {
    const snapshot = window.FreeBbsLearningAssessment?.getSnapshot();
    return snapshot?.questions.length === 4 && snapshot.practiceQuestions.length === 2;
  });
}

async function run(browser, directory, scenario) {
  const preview = createCompleteLearningPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  const writes = [];
  const visited = [];
  let stage = 'welcome';
  try {
    await page.setViewport({ width: scenario.width, height: scenario.height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
      scenario.theme,
    );
    page.on('pageerror', (error) => errors.push({ url: page.url(), message: error.message }));
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().startsWith(`${base}/api/`))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().startsWith(base)) visited.push(frame.url());
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base) request.continue();
      else {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
        request.abort('blockedbyclient');
      }
    });
    await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.max-tour[open] .guide-primary', { visible: true });
    assert.match(await page.$eval('#max-tour-title', (item) => item.textContent), /Max/);
    await click(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
    await page.waitForFunction(() => !document.querySelector('.max-tour[open]'));
    assert.equal(preview.learning.assessmentStore.rows.length, 0);
    assert.equal(preview.learning.starsStore.rows.length, 0);

    stage = 'world-to-authored-course';
    await click(page, '.island-orbit-item[data-world-id="signals"]');
    await click(page, '#world-enter-island');
    await click(page, 'a.island-course-planet[data-course-slug="signals"]');
    await page.waitForSelector('.course-structure-toolbar input[type="search"]');
    assert.equal(new URL(page.url()).searchParams.get('course'), 'signals');
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), 'u_preview01');
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    await page.type('.course-structure-toolbar input[type="search"]', 'SS-02-01');
    await click(page, '.course-structure-search-results button');
    await click(page, '.course-structure-details .course-structure-primary');
    await click(page, '#course-knowledge-overview[open] .knowledge-overview-study');
    await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('point'), 'SS-02-01');
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), 'u_preview01');
    assert.equal(await page.$('.learning-start-dialog[open]'), null);

    stage = 'optional-preference-and-learning-guide';
    assert.equal(
      await page.$eval('#knowledge-chat-panel', (panel) => panel.hidden),
      scenario.width <= 920,
      'The initial narrow-screen reader is unobstructed; desktop retains the companion',
    );
    await click(page, '.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]', { visible: true });
    await page.select(
      '.learning-start-dialog[open] [data-learning-start-choice="level"]',
      'familiar',
    );
    await page.select(
      '.learning-start-dialog[open] [data-learning-start-choice="goal"]',
      'practice',
    );
    await click(page, '.learning-start-dialog[open] .learning-start-apply');
    await click(page, '#learning-guide-open');
    for (let index = 0; index < 4; index += 1)
      await click(page, '.learning-guide-dialog[open] footer button:last-child');
    await click(page, '.learning-guide-dialog[open] > .learning-primary');
    await page.waitForSelector('#knowledge-chat-input', { visible: true });
    assert.equal(preview.requests.length, 0, 'Opening the guide or Max cannot send a question');
    const response = page.waitForResponse(
      (item) =>
        new URL(item.url()).pathname === '/api/ai/knowledge/chat' &&
        item.request().method() === 'POST',
    );
    await page.type('#knowledge-chat-input', '请结合我的学习起点给一个练习提示。');
    await click(page, '#knowledge-chat-form button[type="submit"]');
    assert.equal((await response).status(), 200);
    await page.waitForFunction(() =>
      document.getElementById('knowledge-chat-thread')?.textContent.includes('本地模拟回答'),
    );
    assert.deepEqual(preview.requests[0].trustedCompanionContext.learningStartPreference, {
      level: 'familiar',
      goal: 'practice',
    });
    const writesBeforeNoteDraft = writes.length;
    await click(page, '.learning-save-answer');
    await page.waitForSelector('#learning-note-dialog[open]', { visible: true });
    assert.ok(
      await page.$eval('#learning-note-form textarea', (item) =>
        item.value.includes('本地模拟回答'),
      ),
    );
    assert.equal(
      writes.length,
      writesBeforeNoteDraft,
      'Copying an answer opens only a floating draft',
    );
    await click(page, '#learning-note-cancel');
    await page.waitForFunction(() => !document.querySelector('#learning-note-dialog[open]'));
    await click(page, '#knowledge-chat-close');

    stage = 'one-body-private-annotation';
    await click(page, '[data-knowledge-tool="content"]');
    if (!(await page.$eval('#knowledge-start-reading', (item) => Boolean(item.closest('.hidden')))))
      await click(page, '#knowledge-start-reading');
    await page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
      visible: true,
    });
    assert.equal(await page.$eval('#learning-annotation-toolbar', (item) => item.hidden), true);
    await click(page, '#knowledge-reading [data-learning-go="notes"]');
    await selectProse(page);
    await click(page, '[data-annotation-action="highlight"]');
    await page.waitForSelector('#knowledge-body [data-private-annotation]');
    assert.equal(preview.learning.store.rows.filter((item) => item.kind === 'note').length, 1);
    assert.equal(await page.$$eval('#knowledge-body', (items) => items.length), 1);

    stage = 'practice-and-pending-formal-selftest';
    await click(page, '[data-knowledge-tool="feedback"]');
    await click(page, '#learning-quiz-tabs [data-quiz-view="practice"]');
    await page.select('.learning-quiz-filters select[aria-label="练习难度"]', 'basic');
    await click(page, '[data-question-id="SS-02-01-Q01"] input[value="A"]');
    await click(page, '[data-question-id="SS-02-01-Q01"] button[type="submit"]');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q01' && !item.official,
      ),
    );
    await click(page, '#learning-quiz-tabs [data-quiz-view="quick"]');
    assert.equal(
      await page.$$eval('#learning-quiz-list [data-question-id]', (items) => items.length),
      4,
    );
    await page.type(
      '[data-question-id="SS-02-01-Q05"] textarea',
      '本地演示作答：需要课程组依据推导过程复核。',
    );
    await click(page, '[data-question-id="SS-02-01-Q05"] button[type="submit"]');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q05' && item.status === 'pending_review',
      ),
    );
    assert.equal(preview.learning.assessmentStore.rows.length, 2);
    assert.equal(
      preview.learning.starsStore.rows.length,
      0,
      'Practice and pending review cannot award a formal star',
    );

    stage = 'reload-keeps-one-user-and-owned-records';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
      level: 'familiar',
      goal: 'practice',
    });
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), 'u_preview01');
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().attempts.length === 2,
    );
    await click(page, '[data-knowledge-tool="content"]');
    if (!(await page.$eval('#knowledge-start-reading', (item) => Boolean(item.closest('.hidden')))))
      await click(page, '#knowledge-start-reading');
    await page.waitForSelector('#knowledge-body [data-private-annotation]');
    await page.screenshot({ path: path.join(directory, `${scenario.name}.png`) });
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    assert.ok(visited.length >= 3 && visited.every((url) => new URL(url).origin === base));
    return { scenario, passed: true, visited, writes, errors, blocked, stage };
  } catch (error) {
    await page
      .screenshot({ path: path.join(directory, `${scenario.name}-failure.png`) })
      .catch(() => {});
    return {
      scenario,
      passed: false,
      stage,
      message: error.message,
      visited,
      writes,
      errors,
      blocked,
      state: await page
        .evaluate(() => ({
          url: window.location.href,
          dialogs: [...document.querySelectorAll('dialog[open]')].map(
            (item) => item.id || item.className,
          ),
        }))
        .catch(() => ({})),
    };
  } finally {
    await context.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections();
    });
  }
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-complete-preview-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const results = [];
  try {
    for (const scenario of [
      { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
      { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
    ]) {
      const result = await run(browser, directory, scenario);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ results }, null, 2));
    console.log(`Complete learning preview QA: ${directory}`);
  }
  if (results.some((item) => !item.passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
