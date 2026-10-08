// Real UI requests against isolated preview records; external services are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, users } = require('./preview-learning-workspace');

const POINT = 'SS-02-01';
const LEVELS = ['new', 'familiar', 'basic', 'advanced'];
const GOALS = ['concepts', 'practice', 'explore'];
const FORMAL_IDS = ['Q02', 'Q03', 'Q04', 'Q05'].map((suffix) => `${POINT}-${suffix}`);
const START = '.learning-start-dialog[open]';
const QUESTIONS = '#learning-quiz-list [data-question-id]';

async function pointerClick(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  const element = await page.$(selector);
  assert.ok(element, `Missing real pointer target: ${selector}`);
  try {
    await pointerClickHandle(page, element, selector);
  } finally {
    await element.dispose();
  }
}

async function pointerClickHandle(page, element, label) {
  await element.evaluate((item) => item.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(
    (item) => {
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height || item.disabled) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    },
    { timeout: 10000 },
    element,
  );
  assert.equal(
    await element.evaluate((item) => Boolean(item.disabled)),
    false,
    `Disabled real pointer target: ${label}`,
  );
  await element.click();
}

async function pointerText(page, selector, text) {
  const handles = await page.$$(selector);
  try {
    for (const handle of handles) {
      if ((await handle.evaluate((item) => item.textContent.trim())) !== text) continue;
      await pointerClickHandle(page, handle, text);
      return;
    }
    throw new Error(`Missing real pointer target: ${selector} (${text})`);
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function confirmStart(page, level = 'familiar', goal = 'concepts') {
  await page.waitForSelector(START, { visible: true });
  await page.select(`${START} [data-learning-start-choice="level"]`, level);
  await page.select(`${START} [data-learning-start-choice="goal"]`, goal);
  await pointerClick(page, `${START} .learning-start-apply`);
  await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
  assert.deepEqual(
    await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
    { level, goal },
    'Only the explicitly confirmed course starting point becomes active',
  );
}

async function readyQuestions(page) {
  await page.waitForFunction(() => {
    const snapshot = window.FreeBbsLearningAssessment?.getSnapshot();
    return (
      snapshot?.questions.length === 4 &&
      snapshot.practiceQuestions.length === 2 &&
      /^[a-f0-9]{64}$/.test(snapshot.documentVersion)
    );
  });
}

async function selectTool(page, tool) {
  await pointerClick(page, `[data-knowledge-tool="${tool}"]`);
  await page.waitForFunction(
    (value) => document.querySelector('[data-knowledge-page]')?.dataset.learningTool === value,
    {},
    tool,
  );
}

async function questionIds(page) {
  return page.$$eval(QUESTIONS, (items) => items.map((item) => item.dataset.questionId).sort());
}

async function waitQuestionIds(page, ids) {
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...document.querySelectorAll('#learning-quiz-list [data-question-id]')]
          .map((item) => item.dataset.questionId)
          .sort(),
      ) === JSON.stringify(expected),
    {},
    [...ids].sort(),
  );
  assert.deepEqual(await questionIds(page), [...ids].sort());
}

async function openMax(page) {
  if (await page.$eval('#knowledge-chat-panel', (item) => item.classList.contains('hidden')))
    await pointerClick(page, '#knowledge-chat-toggle');
  await page.waitForSelector('#knowledge-chat-input', { visible: true });
}

async function closeMax(page) {
  if (!(await page.$eval('#knowledge-chat-panel', (item) => item.classList.contains('hidden'))))
    await pointerClick(page, '#knowledge-chat-close');
}

async function selectOriginalTextWithPointer(page) {
  const candidate = await page.evaluate(() => {
    const body = document.getElementById('knowledge-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.textContent.trim().length < 14 || text.parentElement.closest('.katex,script,style'))
        continue;
      if (!text.parentElement.closest('p,li,blockquote')) continue;
      text.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      const offset = text.textContent.search(/\S/);
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 12);
      const rect = [...range.getClientRects()].find((item) => item.width > 40 && item.height > 0);
      if (!rect) continue;
      // Geometry only: the actual selection is made by real pointer dragging below.
      return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
    }
    return null;
  });
  assert.ok(candidate, 'An actual visible prose fragment exists in the original body');
  await page.mouse.move(candidate.left + 1, candidate.top + candidate.height / 2);
  await page.mouse.down();
  await page.mouse.move(candidate.right - 1, candidate.top + candidate.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const selection = window.getSelection();
    return (
      selection?.toString().trim().length > 0 &&
      selection.anchorNode?.parentElement.closest('#knowledge-body')
    );
  });
  await page.waitForSelector('#learning-annotation-toolbar:not([hidden])', { visible: true });
}

async function main() {
  const preview = createLearningPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-learning-chain-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    status: 'running',
    notice:
      'Isolated local preview; fixture publishing and AI replies are simulations, not live course results.',
    scenes: [],
    screenshots: [],
    pageErrors: [],
  };
  let browser;
  let activePage;
  let scene = 'launch';
  const requestedScenes = String(process.env.LEARNING_QA_SCENES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const enabled = (name) =>
    !requestedScenes.length || requestedScenes.some((prefix) => name.startsWith(prefix));
  const save = async (page, name) => {
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(output, file), fullPage: false });
    report.screenshots.push(file);
  };
  const pass = (name, details = {}) => report.scenes.push({ name, status: 'passed', ...details });
  const createPage = async (width = 1440, theme = 'light') => {
    const page = await browser.newPage();
    activePage = page;
    page.setDefaultTimeout(15000);
    await page.setViewport({ width, height: width < 600 ? 844 : 1000 });
    page.on('pageerror', (error) => report.pageErrors.push({ scene, message: error.message }));
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      });
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
        return request.continue();
      return request.respond({ status: 403, body: 'External services disabled for learning QA' });
    });
    page.qaTheme = theme;
    return page;
  };
  const visit = async (page, query = '') => {
    await page.goto(
      `${base}/knowledge?course=signals&point=${POINT}&as=student&theme=${page.qaTheme}&${query}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () => document.getElementById('knowledge-title')?.textContent === '卷积与拉普拉斯变换',
    );
  };
  try {
    browser = await puppeteer.launch({
      headless: true,
      timeout: Number(process.env.LEARNING_CHROME_TIMEOUT_MS || 10000),
      ...(process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH }
        : {}),
    });

    for (const level of LEVELS) {
      for (const goal of GOALS) {
        scene = `matrix-${level}-${goal}`;
        if (!enabled(scene)) continue;
        const page = await createPage();
        const previousRequests = preview.requests.length;
        await visit(page, 'tool=continue');
        await page.waitForSelector(START, { visible: true });
        if (level === 'new' && goal === 'concepts') {
          await page.keyboard.press('Escape');
          assert.ok(await page.$(START), 'Escape does not bypass mandatory course confirmation');
          assert.equal(
            await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
            null,
          );
        }
        await confirmStart(page, level, goal);
        await readyQuestions(page);
        await closeMax(page);
        await selectTool(page, 'continue');
        await page.waitForFunction(
          (prefix) => {
            const steps = [...document.querySelectorAll('#learning-plan-steps > li')];
            return (
              steps.length === 3 && steps.every((step) => step.dataset.stepId?.startsWith(prefix))
            );
          },
          {},
          `${level}:${goal}:`,
        );
        assert.equal(
          await page.$$eval(
            '#learning-plan-summary .learning-plan-primary',
            (items) => items.length,
          ),
          1,
        );
        assert.ok(
          await page.$$eval(
            '#learning-plan-summary .learning-plan-alternatives button',
            (items) => items.length <= 2,
          ),
        );
        assert.equal(
          await page.$eval('#learning-plan-editor', (item) => item.open),
          false,
          'Full chain stays available without expanding every step by default',
        );
        assert.equal(
          preview.requests.length,
          previousRequests,
          'Choice/recommendation display does not automatically ask Max',
        );
        await save(page, scene);
        await openMax(page);
        await page.type('#knowledge-chat-input', '请只给我一个下一步提示。');
        const received = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/ai/knowledge/chat' &&
            response.request().method() === 'POST',
        );
        await pointerClick(page, '#knowledge-chat-form button[type="submit"]');
        assert.equal((await received).status(), 200);
        const request = preview.requests[previousRequests];
        assert.deepEqual(request.context.learningStartPreference, { level, goal });
        assert.deepEqual(
          request.trustedCompanionContext.learningStartPreference,
          { level, goal },
          'Server reconstructs the same controlled starting-point strategy',
        );
        assert.ok(
          typeof request.trustedCompanionHint === 'string' &&
            request.trustedCompanionHint.length > 0,
        );
        assert.equal(
          preview.starsStore.rows.length,
          0,
          'Self-report and AI requests grant no stars',
        );
        pass(scene, { level, goal, actualAiRequest: true, strategySteps: 3 });
        await page.close();
      }
    }

    scene = 'course-confirmation-and-in-course-navigation';
    if (enabled(scene)) {
      const page = await createPage();
      await page.goto(`${base}/course?course=signals&as=student`, {
        waitUntil: 'domcontentloaded',
      });
      await confirmStart(page, 'basic', 'practice');
      await visit(page);
      await readyQuestions(page);
      assert.equal(
        await page.$(START),
        null,
        'Confirmed same-account course entry is reused within the same tab',
      );
      await page.goto(`${base}/course?course=signals&as=student`, {
        waitUntil: 'domcontentloaded',
      });
      await confirmStart(page, 'basic', 'practice');
      pass(scene, { eachCourseEntryRequiresConfirmation: true, nodeSwitchDoesNotRepeat: true });
      await page.close();
    }

    scene = 'practice-layers-and-complete-formal-scope';
    if (enabled(scene)) {
      const page = await createPage();
      await visit(page, 'tool=feedback');
      await confirmStart(page, 'advanced', 'practice');
      await readyQuestions(page);
      await closeMax(page);
      await selectTool(page, 'feedback');
      await pointerClick(page, '#learning-quiz-tabs [data-quiz-view="practice"]');
      await page.select('.learning-quiz-filters select[aria-label="练习难度"]', 'basic');
      await waitQuestionIds(page, [`${POINT}-Q01`, `${POINT}-Q02`]);
      await pointerClick(page, `[data-question-id="${POINT}-Q01"] input[value="A"]`);
      const practiceRequest = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname.startsWith('/api/learning-assessments/') &&
          request.method() === 'POST',
      );
      await pointerClick(page, `[data-question-id="${POINT}-Q01"] button[type="submit"]`);
      assert.equal(JSON.parse((await practiceRequest).postData()).mode, 'practice');
      await page.waitForFunction(
        (id) =>
          window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
            (item) => item.questionId === id && item.official === false,
          ),
        {},
        `${POINT}-Q01`,
      );
      const practice = preview.assessmentStore.rows.find(
        (item) => item.question_id === `${POINT}-Q01`,
      );
      assert.equal(practice.is_official, 0, 'Practice completion is not formal mastery evidence');
      await page.select('.learning-quiz-filters select[aria-label="练习难度"]', 'challenge');
      await waitQuestionIds(page, [`${POINT}-Q05`]);
      await pointerText(page, '.learning-quiz-filters button', '探索题');
      await waitQuestionIds(page, [`${POINT}-Q06`]);
      await save(page, 'practice-challenge-exploration');
      await pointerClick(page, '#learning-quiz-tabs [data-quiz-view="quick"]');
      await waitQuestionIds(page, FORMAL_IDS);
      assert.equal(
        await page.$eval('#learning-quiz-tabs [data-quiz-view="quick"]', (item) =>
          item.getAttribute('aria-pressed'),
        ),
        'true',
      );
      await save(page, 'selftest-four-formal-questions');
      await page.type(
        `[data-question-id="${POINT}-Q05"] textarea`,
        '需要人工复核的本地模拟回答，仅用于验证待复核状态。',
      );
      await pointerClick(page, `[data-question-id="${POINT}-Q05"] button[type="submit"]`);
      await page.waitForFunction(
        (id) =>
          window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
            (item) => item.questionId === id && item.status === 'pending_review',
          ),
        {},
        `${POINT}-Q05`,
      );
      const pending = preview.assessmentStore.rows.find(
        (item) => item.question_id === `${POINT}-Q05`,
      );
      assert.equal(pending.is_official, 1);
      assert.equal(pending.status, 'pending_review');
      assert.notEqual(pending.verdict, 'pass');
      assert.equal(
        preview.starsStore.rows.length,
        0,
        'Practice and pending review neither lower formal requirements nor award a star',
      );
      await selectTool(page, 'continue');
      await page.waitForFunction(() =>
        document.querySelector('.learning-plan-primary')?.textContent.includes('待复核'),
      );
      await pointerText(page, '.learning-plan-alternatives button', '探索研究');
      assert.equal(
        preview.assessmentStore.rows.find((item) => item.question_id === `${POINT}-Q05`).status,
        'pending_review',
        'Choosing exploration does not clear pending evidence',
      );
      pass(scene, {
        practiceBasic: 2,
        practiceChallenge: 1,
        exploration: 1,
        formalScope: 4,
        pendingIsNotPass: true,
      });
      await page.close();
    }

    scene = 'exploration-question-url';
    if (enabled(scene)) {
      const page = await createPage();
      await visit(page, `tool=feedback&quiz=practice&question=${POINT}-Q06`);
      await confirmStart(page, 'familiar', 'explore');
      await readyQuestions(page);
      await closeMax(page);
      await waitQuestionIds(page, [`${POINT}-Q06`]);
      assert.equal(
        await page.$eval('#learning-quiz-tabs [data-quiz-view="practice"]', (item) =>
          item.getAttribute('aria-pressed'),
        ),
        'true',
      );
      assert.equal(
        await page.$eval('[data-knowledge-page]', (item) => item.dataset.learningTool),
        'feedback',
      );
      assert.equal(
        await page.$eval(`[data-question-id="${POINT}-Q06"]`, (item) => {
          const rect = item.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        }),
        true,
        'Question anchor is actually visible after delayed quiz loading',
      );
      await save(page, scene);
      pass(scene, { resolvedQuestion: `${POINT}-Q06`, official: false });
      await page.close();
    }

    scene = 'single-body-private-annotations';
    if (enabled(scene)) {
      const page = await createPage();
      await visit(page, 'view=reading&tool=notes');
      await confirmStart(page);
      await readyQuestions(page);
      await closeMax(page);
      await selectTool(page, 'notes');
      assert.equal(await page.$$eval('#knowledge-body', (items) => items.length), 1);
      assert.equal(
        await page.$('#learning-annotated-document'),
        null,
        'Private annotations do not create a second course body',
      );
      await selectOriginalTextWithPointer(page);
      await pointerClick(
        page,
        '[data-annotation-action="highlight"][data-annotation-color="yellow"]',
      );
      await page.waitForSelector('#knowledge-body [data-private-annotation]');
      const annotations = await page.$$eval(
        '#knowledge-body [data-private-annotation]',
        (items) => items.length,
      );
      await save(page, scene);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await readyQuestions(page);
      await page.waitForSelector('#knowledge-body [data-private-annotation]');
      assert.equal(
        await page.$$eval('#knowledge-body [data-private-annotation]', (items) => items.length),
        annotations,
        'Own private annotation restores on refresh',
      );
      await page.goto(
        `${base}/knowledge?course=signals&point=${POINT}&as=other&view=reading&tool=notes`,
        { waitUntil: 'domcontentloaded' },
      );
      await confirmStart(page);
      await readyQuestions(page);
      await page.waitForFunction(
        () => document.getElementById('learning-annotation-status')?.textContent !== '正在加载',
      );
      assert.equal(
        await page.$$eval('#knowledge-body [data-private-annotation]', (items) => items.length),
        0,
      );
      assert.equal(
        await page.$$eval(
          '#learning-annotation-list .learning-annotation-record',
          (items) => items.length,
        ),
        0,
        'Switching accounts clears the private directory as well as marks',
      );
      const ownRecords = await page.evaluate(async () => {
        const response = await fetch(
          '/api/learning/signals/SS-02-01/entries?kind=note&annotations=1',
          {
            headers: { Authorization: `Bearer ${window.freeBbsApp.userState.token}` },
          },
        );
        return { status: response.status, body: await response.json() };
      });
      assert.equal(ownRecords.status, 200);
      assert.equal(
        ownRecords.body.entries.length,
        0,
        'The actual private-record API also returns no other-account annotations',
      );
      await visit(page, 'view=reading&tool=notes');
      await readyQuestions(page);
      await page.waitForFunction(() => window.FreeBbsLearningStart.currentPreference() !== null);
      assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), users.student.uid);
      assert.deepEqual(
        await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
        {
          level: 'familiar',
          goal: 'concepts',
        },
        'Returning to the previously confirmed student reuses only that account’s course ticket',
      );
      await page.waitForSelector('#knowledge-body [data-private-annotation]');
      pass(scene, {
        originalBodies: 1,
        refreshRestores: true,
        secondAccountSeesNoAnnotation: true,
      });
      await page.close();
    }

    for (const width of [1440, 390]) {
      for (const theme of ['light', 'dark']) {
        scene = `guide-${width}-${theme}`;
        if (!enabled(scene)) continue;
        const page = await createPage(width, theme);
        await visit(page, 'view=reading');
        await confirmStart(page, 'basic', '');
        await readyQuestions(page);
        await closeMax(page);
        const preference = await page.evaluate(() =>
          window.FreeBbsLearningStart.currentPreference(),
        );
        const requestCount = preview.requests.length;
        if (theme === 'dark')
          assert.equal(
            await page.evaluate(
              () =>
                document.documentElement.dataset.theme === 'dark' ||
                document.body.dataset.theme === 'dark' ||
                document.body.classList.contains('theme-dark'),
            ),
            true,
          );
        await pointerClick(page, '#learning-guide-open');
        await page.waitForSelector('.learning-guide-dialog[open]', { visible: true });
        assert.equal(
          await page.$eval('.learning-guide-dialog', (item) => {
            const rect = item.getBoundingClientRect();
            return (
              rect.left >= -1 &&
              rect.right <= window.innerWidth + 1 &&
              rect.top >= -1 &&
              rect.bottom <= window.innerHeight + 1
            );
          }),
          true,
          'Guide modal fits the actual screen',
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          true,
          'Guide causes no horizontal page overflow',
        );
        await save(page, scene);
        for (let index = 0; index < 3; index += 1)
          await pointerClick(page, '.learning-guide-dialog footer button:last-child');
        assert.equal(
          await page.$eval('#learning-guide-title', (item) => item.textContent),
          '让下一步符合这次需要',
        );
        await pointerClick(page, '.learning-guide-dialog > .learning-primary');
        await page.waitForFunction(
          () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'continue',
        );
        await pointerClick(page, '#learning-guide-open');
        for (let index = 0; index < 4; index += 1)
          await pointerClick(page, '.learning-guide-dialog footer button:last-child');
        await pointerClick(page, '.learning-guide-dialog > .learning-primary');
        await page.waitForSelector('#knowledge-chat-input', { visible: true });
        assert.equal(
          preview.requests.length,
          requestCount,
          'Guide/Max opening does not automatically submit a question',
        );
        assert.deepEqual(
          await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
          preference,
          'Guide does not replace the student starting choice',
        );
        await closeMax(page);
        await pointerClick(page, '#learning-guide-open');
        await pointerClick(page, '.learning-guide-dialog [aria-label="关闭学习指南"]');
        assert.equal(
          await page.$('.learning-guide-dialog[open]'),
          null,
          'Real close button is reachable at this viewport and theme',
        );
        pass(scene, {
          width,
          theme,
          pointerHitTested: true,
          continueReachable: true,
          maxDoesNotAutoSend: true,
        });
        await page.close();
      }
    }
    assert.deepEqual(
      report.pageErrors,
      [],
      'All independent page scenes have no browser script errors',
    );
    report.status = 'passed';
    report.selectedScenes = requestedScenes;
    report.sceneCount = report.scenes.length;
    report.actualAiRequestCount = preview.requests.length;
    report.localStudent = users.student.uid;
    fs.writeFileSync(
      path.join(output, 'learning-chain-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ status: report.status, scenes: report.sceneCount, output, actualAiRequestCount: report.actualAiRequestCount })}\n`,
    );
  } catch (error) {
    report.status = 'failed';
    report.failure = { scene, message: error.message };
    if (activePage && !activePage.isClosed()) {
      await save(activePage, 'failure').catch(() => {});
      report.failure.ui = await activePage
        .evaluate(() => ({
          title: document.getElementById('knowledge-title')?.textContent,
          tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
          startOpen: Boolean(document.querySelector('.learning-start-dialog[open]')),
          startStatus: document.querySelector('.learning-start-dialog [role="status"]')
            ?.textContent,
          planStatus: document.getElementById('learning-plan-status')?.textContent,
          quizIds: [...document.querySelectorAll('#learning-quiz-list [data-question-id]')].map(
            (item) => item.dataset.questionId,
          ),
        }))
        .catch(() => null);
    }
    fs.writeFileSync(
      path.join(output, 'learning-chain-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stderr.write(
      `${JSON.stringify({ status: 'failed', scene, message: error.message, output })}\n`,
    );
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
