// Human-task diagnostics, not a usability experiment or evidence of learning gains.
// Real pointer/keyboard controls; one fresh loopback origin per persona; simulated AI only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { createLearningFixture, studentNode } = require('./preview-learning-workspace');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const POINT = 'SS-02-01';
const NOTES = '#knowledge-reading [data-learning-go="notes"]';
const PROFILES = [
  { name: 'novice-concepts', level: 'new', goal: 'concepts', task: 'novice' },
  { name: 'uncertain-concepts', level: 'familiar', goal: 'concepts', task: 'reflect' },
  { name: 'independent-practice', level: 'basic', goal: 'practice', task: 'practice' },
  { name: 'researcher-explore', level: 'advanced', goal: 'explore', task: 'explore' },
  { name: 'direct-lookup-unset', task: 'lookup' },
  {
    name: 'uncertain-origin-only',
    level: 'familiar',
    goal: 'concepts',
    task: 'origin-only',
    materials: 'origin',
  },
  {
    name: 'missing-material-optional-help',
    level: 'familiar',
    goal: 'concepts',
    task: 'missing',
    materials: 'none',
  },
];

async function click(page, selector) {
  await page.locator(selector).setTimeout(12000).click();
}
async function visible(page, selector) {
  return page.$eval(selector, (element) => {
    const box = element.getBoundingClientRect();
    return (
      !element.hidden && !element.closest('[hidden],.hidden') && box.width > 0 && box.height > 0
    );
  });
}
async function choose(page, selector, value) {
  const index = await page.$eval(
    selector,
    (element, wanted) => [...element.options].findIndex((option) => option.value === wanted),
    value,
  );
  assert.ok(index >= 0, `A visible native option exists: ${value}`);
  await page.focus(selector);
  await page.keyboard.press('Home');
  for (let count = 0; count < index; count += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  assert.equal(await page.$eval(selector, (element) => element.value), value);
}
async function ready(page, expectedQuestions = 4) {
  await page.waitForFunction(
    (expected) => {
      const snapshot = window.FreeBbsLearningAssessment?.getSnapshot();
      return snapshot?.loaded && snapshot.questions.length === expected;
    },
    {},
    expectedQuestions,
  );
}
async function closeMax(page) {
  if (await visible(page, '#knowledge-chat-panel')) await click(page, '#knowledge-chat-close');
}
async function reading(page) {
  await click(page, '[data-knowledge-tool="content"]');
  if (await visible(page, '#knowledge-start-reading'))
    await click(page, '#knowledge-start-reading');
  await page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
    visible: true,
  });
}
async function selectFragment(page, selector, nativeWheel = false) {
  if (nativeWheel) {
    const point = await page.$eval(selector, (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: window.innerHeight - 20 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel({ deltaY: 260 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  }
  const fragment = await page.evaluate(
    async ({ container, nativeScrolling }) => {
      const body = document.querySelector(container);
      for (const paragraph of body.querySelectorAll('p')) {
        if (!nativeScrolling) paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
        // Measure after two real layout frames: sticky origin/toolbar offsets
        // settle after scrolling. This does not create or replace a selection.
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (text.parentElement.closest('[data-private-annotation],.katex,a')) continue;
          const start = text.data.search(/\S/);
          if (start < 0 || text.data.length - start < 20) continue;
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + 12);
          const rectangles = [...range.getClientRects()].filter((box) => box.width > 0);
          const box = rectangles.find((item) => item.width > 40);
          if (
            !box ||
            !paragraph.contains(
              document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
            )
          )
            continue;
          return {
            left: box.left,
            right: rectangles.at(-1).right,
            y: box.top + box.height / 2,
            endY: rectangles.at(-1).top + rectangles.at(-1).height / 2,
            quote: text.data.slice(start, start + 12),
          };
        }
      }
      return null;
    },
    { container: selector, nativeScrolling: nativeWheel },
  );
  assert.ok(fragment, `A pointer-selectable text fragment exists in ${selector}`);
  await page.mouse.move(fragment.left + 0.2, fragment.y);
  await page.mouse.down();
  await page.mouse.move(fragment.right - 0.2, fragment.endY, { steps: 12 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), fragment.quote);
  await page.waitForFunction(
    () => document.querySelector('#learning-annotation-toolbar').dataset.hasSelection === 'true',
  );
  return fragment.quote;
}
async function readPlan(page) {
  await click(page, '[data-knowledge-tool="continue"]');
  await page.waitForSelector('#learning-plan-primary, .learning-plan-primary', { visible: true });
  return page.evaluate(() => ({
    reason: document.getElementById('learning-plan-reason').textContent,
    label: document.getElementById('learning-plan-title').textContent,
    primary: document.querySelector('.learning-plan-primary h3').textContent,
    description: document.querySelector('.learning-plan-primary p').textContent,
    chain: document.getElementById('learning-plan-chain').textContent,
    collapsed: !document.getElementById('learning-plan-editor').open,
  }));
}
async function shortcut(page, title) {
  await click(page, '.learning-task-shortcuts summary');
  const index = await page.$$eval(
    '.learning-task-options button',
    (items, wanted) => items.findIndex((item) => item.textContent === wanted),
    title,
  );
  assert.ok(index >= 0, `Optional direct task remains available: ${title}`);
  await click(page, `.learning-task-options button:nth-child(${index + 1})`);
}

async function run(browser, output, viewport, profile) {
  const materialFixture = profile.materials ? createLearningFixture() : null;
  if (materialFixture) {
    const missing = materialFixture.nodes.find((entry) => entry.id === POINT);
    missing.markdown = '';
    missing.sections.knowledgeMarkdown = '';
    missing.documentVersion = getAssessmentDocumentVersion('');
    if (profile.materials === 'none') {
      missing.sections.basicInfoMarkdown = '';
      missing.sections.applicationsMarkdown = '';
    }
    materialFixture.edges = [];
  }
  const preview = createCompleteLearningPreview({
    ...(materialFixture
      ? {
          extraApi({ route, method }) {
            if (method !== 'GET') return null;
            if (route === '/api/courses/signals/map')
              return {
                status: 200,
                body: {
                  course: materialFixture.course,
                  nodes: materialFixture.nodes.map((entry) => studentNode(entry)),
                  edges: [],
                },
              };
            if (route === `/api/courses/signals/map/nodes/${POINT}`)
              return {
                status: 200,
                body: {
                  course: materialFixture.course,
                  node: studentNode(materialFixture.nodes.find((entry) => entry.id === POINT)),
                },
              };
            return null;
          },
        }
      : {}),
  });
  // Only this preview's memory records are changed; no authoring file or live
  // course is altered. Use the same empty body on both HTTP and API sides.
  if (materialFixture) {
    const contextRow = await preview.learning.store.context('signals', POINT);
    contextRow.knowledge_markdown = '';
    contextRow.document_markdown = '';
    contextRow.has_relations = false;
    if (profile.materials === 'none') {
      contextRow.basic_info_markdown = '';
      contextRow.applications_markdown = '';
    }
  }
  const expectedQuestions = materialFixture ? 0 : 4;
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const name = `${viewport.name}-${profile.name}`;
  const errors = [];
  const external = [];
  const observations = [];
  const checkpoints = [];
  let expectedPreference = profile.level ? { level: profile.level, goal: profile.goal } : null;
  let savedSteps = null;
  let expectedDraft = null;
  let stage = 'setup';
  try {
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
      viewport.theme,
    );
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) =>
      dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss(),
    );
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === base || ['blob:', 'data:'].includes(url.protocol)) request.continue();
      else {
        external.push(`${request.method()} ${url.origin}${url.pathname}`);
        request.abort('blockedbyclient');
      }
    });
    await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await click(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
    await page.goto(`${base}/knowledge?course=signals&point=${POINT}&view=reading`, {
      waitUntil: 'domcontentloaded',
    });
    await ready(page, expectedQuestions);
    assert.equal(
      await page.$('.learning-start-dialog[open]'),
      null,
      'Learning is never blocked by repeated preference questionnaire',
    );
    const maxInitiallyVisible = await visible(page, '#knowledge-chat-panel');
    if (viewport.width < 900)
      assert.equal(
        maxInitiallyVisible,
        false,
        'A narrow reader begins unobstructed until the user explicitly opens Max',
      );
    await closeMax(page);
    checkpoints.push(
      'Learning accessible without selecting preferences or completing earlier knowledge points',
    );
    if (profile.level) {
      stage = 'optional-preference';
      await click(page, '.learning-start-adjust');
      await choose(
        page,
        '.learning-start-dialog[open] [data-learning-start-choice="level"]',
        profile.level,
      );
      await choose(
        page,
        '.learning-start-dialog[open] [data-learning-start-choice="goal"]',
        profile.goal,
      );
      await click(page, '.learning-start-dialog[open] .learning-start-apply');
      assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
        level: profile.level,
        goal: profile.goal,
      });
    }
    stage = 'recommendation-task-alignment';
    const plan = await readPlan(page);
    assert.equal(plan.collapsed, true, 'Full multi-step path stays opt-in');
    checkpoints.push({ recommendation: plan });

    if (profile.task === 'novice') {
      stage = 'origin-read-and-private-comment';
      await shortcut(page, '理解为什么');
      await page.waitForSelector('#knowledge-history-prose > p', { visible: true });
      await click(page, NOTES);
      if (
        await page.$eval(
          '#knowledge-history-toggle',
          (element) => element.getAttribute('aria-expanded') === 'false',
        )
      )
        await click(page, '#knowledge-history-toggle');
      const quote = await selectFragment(page, '#knowledge-history-prose');
      await click(page, '[data-annotation-action="comment"]');
      await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
        visible: true,
      });
      await page.type('#learning-annotation-comment', '我的疑问：为何这个条件不可省略？');
      await click(page, '[data-annotation-action="comment-save"]');
      await page.waitForSelector('#knowledge-history-prose [data-private-annotation]');
      const row = preview.learning.store.rows.find((entry) => entry.annotation);
      assert.equal(row.annotation.anchor.section, 'origin');
      assert.equal(row.kind, 'note');
      checkpoints.push(
        'Origin is annotated privately without adding a second text or publishing a discussion',
      );
      stage = 'ask-max-with-source-and-explicit-consent';
      await selectFragment(page, '#knowledge-body', process.env.HUMAN_PERSONA_WHEEL === '1');
      await click(page, '[data-annotation-action="ask"]');
      await page.waitForSelector('#knowledge-selection-guidance', { visible: true });
      assert.equal(preview.requests.length, 0);
      await click(page, '[data-selection-help="explain"]');
      assert.equal(preview.requests.length, 0, 'Interpretation hint prepares a draft only');
      await click(page, '#knowledge-chat-form button[type="submit"]');
      await page.waitForFunction(() =>
        document.querySelector('#knowledge-chat-thread').textContent.includes('本地模拟回答'),
      );
      assert.equal(preview.requests.length, 1);
      assert.deepEqual(preview.requests[0].trustedCompanionContext.learningStartPreference, {
        level: profile.level,
        goal: profile.goal,
      });
      assert.ok(quote);
      await closeMax(page);
      checkpoints.push(
        'Max receives the explicit course preference only after user sends; answer is simulated',
      );
      stage = 'practice-error-and-correction';
      await click(page, '[data-knowledge-tool="feedback"]');
      await click(page, '#learning-quiz-tabs [data-quiz-view="practice"]');
      await choose(page, '.learning-quiz-filters select', 'basic');
      await click(page, '[data-question-id="SS-02-01-Q01"] input[value="B"]');
      await click(page, '[data-question-id="SS-02-01-Q01"] button[type="submit"]');
      await page.waitForFunction(() =>
        window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
          (attempt) => attempt.questionId === 'SS-02-01-Q01',
        ),
      );
      assert.equal(
        preview.learning.starsStore.rows.length,
        0,
        'Wrong practice does not award formal stars',
      );
      await click(page, '#learning-quiz-tabs [data-quiz-view="mistakes"]');
      await page.waitForSelector('[data-question-id="SS-02-01-Q01"]', { visible: true });
      checkpoints.push(
        'A wrong basic practice attempt is available for correction and does not change formal stars',
      );
    } else if (profile.task === 'reflect') {
      stage = 'reflection-recommendation';
      assert.match(plan.description, /选中/);
      assert.match(plan.description, /高亮|批注/);
      await click(page, '.learning-plan-primary .learning-primary');
      await page.waitForSelector('#learning-annotation-toolbar:not([hidden])', { visible: true });
      const active = await page.evaluate(() => ({
        tool: document.querySelector('[data-learning-tool]').dataset.learningTool,
        instructions: document.querySelector('#learning-annotation-toolbar').textContent,
        openedEditor: !document.getElementById('learning-annotation-popover').hidden,
        supplementalDialogOpen: Boolean(document.querySelector('#learning-note-dialog[open]')),
        noteComposerOpen: Boolean(document.querySelector('#learning-note-composer[open]')),
      }));
      assert.equal(active.tool, 'notes');
      assert.equal(active.openedEditor, false);
      assert.equal(active.supplementalDialogOpen, false);
      assert.equal(active.noteComposerOpen, false);
      const quote = await selectFragment(page, '#knowledge-body');
      await click(page, '[data-annotation-action="comment"]');
      await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
        visible: true,
      });
      await page.type('#learning-annotation-comment', '这里的条件我想再核对一下。');
      await click(page, '[data-annotation-action="comment-save"]');
      await page.waitForSelector('#knowledge-body [data-private-annotation]');
      const row = preview.learning.store.rows.find((entry) => entry.annotation);
      assert.equal(row.kind, 'note');
      assert.equal(row.annotation.anchor.section || 'body', 'body');
      assert.equal(row.annotation.anchor.quote, quote);
      assert.equal(preview.requests.length, 0);
      checkpoints.push(
        'The uncertain learner follows the explicit select-passage/comment task and privately saves one source-anchored doubt, without a second note space or automatic AI request',
      );
    } else if (profile.task === 'origin-only') {
      stage = 'origin-only-selected-annotation';
      assert.match(plan.description, /知识起源.*选中/);
      await click(page, '.learning-plan-primary .learning-primary');
      await page.waitForSelector('#learning-annotation-toolbar:not([hidden])', { visible: true });
      const quote = await selectFragment(page, '#knowledge-history-prose');
      await click(page, '[data-annotation-action="comment"]');
      await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
        visible: true,
      });
      await page.type('#learning-annotation-comment', '先记一个想核对的问题。');
      await click(page, '[data-annotation-action="comment-save"]');
      await page.waitForSelector('#knowledge-history-prose [data-private-annotation]');
      const row = preview.learning.store.rows.find((entry) => entry.annotation);
      assert.equal(row.annotation.anchor.section, 'origin');
      assert.equal(row.annotation.anchor.quote, quote);
      assert.equal(preview.requests.length, 0);
      checkpoints.push(
        'Missing body routes the annotation task to real origin text, opens the icon layer, and saves the exact private quote without inventing practice material',
      );
    } else if (profile.task === 'missing') {
      stage = 'missing-material-does-not-open-an-empty-notebook';
      assert.match(plan.reason, /材料尚未补齐/);
      await click(page, '.learning-plan-primary .learning-primary');
      await page.waitForSelector('#knowledge-chat-input', { visible: true });
      assert.equal(preview.requests.length, 0);
      assert.equal(await page.$eval('#knowledge-chat-input', (element) => element.value), '');
      const manualDraft = '我想查清这个知识点从什么问题出发。';
      await page.type('#knowledge-chat-input', manualDraft);
      await closeMax(page);
      await readPlan(page);
      await click(page, '#learning-plan-pause');
      assert.equal(
        await page.$eval('#knowledge-chat-input', (element) => element.value),
        manualDraft,
      );
      assert.equal(preview.requests.length, 0);
      assert.equal(preview.learning.starsStore.rows.length, 0);
      assert.equal(preview.learning.store.rows.length, 0);
      checkpoints.push(
        'Without body, origin, relations or questions, the user gets optional help or pause, keeps the unsent draft and is never sent into a blank note/quiz or marked complete',
      );
    } else if (profile.task === 'practice') {
      stage = 'independent-practice-direct';
      await click(page, '.learning-plan-primary .learning-primary');
      await page.waitForSelector(
        '#learning-quiz-tabs [data-quiz-view="practice"][aria-selected="true"], #learning-quiz-tabs [data-quiz-view="practice"].is-active',
        { visible: true },
      );
      checkpoints.push({
        exerciseCards: await page.$$eval('#learning-quiz-list [data-question-id]', (elements) =>
          elements.map((element) => element.dataset.questionId),
        ),
      });
      assert.equal(await page.$('.learning-start-dialog[open]'), null);
      assert.equal(preview.learning.starsStore.rows.length, 0);
      checkpoints.push(
        'Independent learner goes directly to practice without compulsory rereading or star prerequisite',
      );
      stage = 'custom-path-and-personal-goal-preservation';
      await readPlan(page);
      await click(page, '#learning-plan-editor-heading');
      await click(page, '#learning-plan-steps > li:nth-child(2) button[aria-label^="上移"]');
      const skipIndex = await page.$$eval(
        '#learning-plan-steps > li:first-child .learning-plan-step-actions button',
        (elements) => elements.findIndex((element) => element.textContent === '跳过'),
      );
      await click(
        page,
        `#learning-plan-steps > li:first-child .learning-plan-step-actions button:nth-child(${skipIndex + 1})`,
      );
      savedSteps = await page.$$eval('#learning-plan-steps > li', (elements) =>
        elements.map((element) => ({
          id: element.dataset.stepId,
          skipped: element.classList.contains('is-skipped'),
        })),
      );
      await click(page, '#learning-plan-save');
      await page.waitForFunction(
        () => document.getElementById('learning-plan-status').textContent === '已保存',
      );
      stage = 'pause-keeps-personal-path-and-unsent-draft';
      await click(page, '#learning-open-max');
      await page.waitForSelector('#knowledge-chat-input', { visible: true });
      const manualDraft = '我想先休息一会儿，回来再看看这个疑问。';
      expectedDraft = manualDraft;
      await page.type('#knowledge-chat-input', manualDraft);
      await closeMax(page);
      const savedPath = JSON.stringify(
        preview.learning.store.rows.filter((entry) => entry.kind === 'path'),
      );
      const previousStars = JSON.stringify(preview.learning.starsStore.rows);
      await page.focus('#learning-plan-pause');
      await page.keyboard.press('Space');
      assert.equal(
        await page.$eval('#learning-plan-pause', (element) => element.getAttribute('aria-pressed')),
        'true',
      );
      assert.equal(
        await page.$eval('#learning-plan-total', (element) => element.textContent),
        '暂停中',
      );
      assert.match(
        await page.$eval('#learning-plan-reason', (element) => element.textContent),
        /已暂停/,
      );
      assert.equal(
        await page.$eval('#knowledge-chat-input', (element) => element.value),
        manualDraft,
      );
      assert.equal(preview.requests.length, 0);
      assert.equal(JSON.stringify(preview.learning.starsStore.rows), previousStars);
      assert.equal(
        JSON.stringify(preview.learning.store.rows.filter((entry) => entry.kind === 'path')),
        savedPath,
      );
      await click(page, '.learning-start-adjust');
      await choose(
        page,
        '.learning-start-dialog[open] [data-learning-start-choice="goal"]',
        'explore',
      );
      await click(page, '.learning-start-dialog[open] .learning-start-apply');
      expectedPreference = { level: profile.level, goal: 'explore' };
      await readPlan(page);
      assert.deepEqual(
        await page.$$eval('#learning-plan-steps > li', (elements) =>
          elements.map((element) => ({
            id: element.dataset.stepId,
            skipped: element.classList.contains('is-skipped'),
          })),
        ),
        savedSteps,
      );
      assert.equal(
        await page.$eval('#learning-plan-pause', (element) => element.getAttribute('aria-pressed')),
        'true',
        'Explicit preference change does not restart a paused personal path',
      );
      await click(page, '#learning-plan-pause');
      assert.equal(
        await page.$eval('#learning-plan-pause', (element) => element.getAttribute('aria-pressed')),
        'false',
      );
      assert.equal(
        await page.$eval('#knowledge-chat-input', (element) => element.value),
        manualDraft,
      );
      assert.equal(preview.requests.length, 0);
      assert.equal(JSON.stringify(preview.learning.starsStore.rows), previousStars);
      assert.equal(
        JSON.stringify(preview.learning.store.rows.filter((entry) => entry.kind === 'path')),
        savedPath,
      );
      checkpoints.push(
        'Pause/resume preserves the unsent Max draft, path order and skipped status, does not save completion or award stars, and the course preference change does not replace the personal path',
      );
    } else if (profile.task === 'explore') {
      stage = 'researcher-relations-then-exploration';
      await click(page, '.learning-plan-primary .learning-primary');
      await page.waitForSelector('.course-structure-details .course-structure-primary', {
        visible: true,
      });
      assert.equal(new URL(page.url()).pathname, '/course');
      assert.equal(new URL(page.url()).searchParams.get('focus'), POINT);
      await click(page, '.course-structure-details .course-structure-primary');
      await click(page, '#course-knowledge-overview[open] .knowledge-overview-study');
      await ready(page);
      await closeMax(page);
      await readPlan(page);
      await shortcut(page, '探索与检验');
      await page.waitForSelector('[data-question-id="SS-02-01-Q06"]', { visible: true });
      const cards = await page.$$eval('#learning-quiz-list [data-question-id]', (elements) =>
        elements.map((element) => element.dataset.questionId),
      );
      observations.push({ kind: 'inspect', code: 'exploration-shortcut-cards', cards });
      assert.equal(preview.learning.starsStore.rows.length, 0);
      assert.equal(preview.requests.length, 0);
      checkpoints.push(
        'Researcher can open relationships and exploration without reading the full body, sending AI, or collecting stars',
      );
    } else {
      stage = 'unconfigured-direct-lookup';
      await shortcut(page, '练习解题');
      await page.waitForSelector('.learning-quiz-filters', { visible: true });
      assert.equal(
        await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
        null,
      );
      await reading(page);
      assert.equal(await page.$$eval('#knowledge-body', (elements) => elements.length), 1);
      checkpoints.push(
        'Direct lookup and practice remain open with no self-assessment or learning-goal questionnaire',
      );
    }

    stage = 'returning-student-persistence';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page, expectedQuestions);
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    assert.deepEqual(
      await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
      expectedPreference,
    );
    if (expectedDraft)
      assert.equal(
        await page.$eval('#knowledge-chat-input', (element) => element.value),
        expectedDraft,
        'Reload returns the student’s exact unsent question without generating a new prompt',
      );
    assert.equal(preview.learning.starsStore.rows.length, 0);
    assert.equal(errors.length, 0);
    assert.deepEqual(external, []);
    checkpoints.push(
      'Return/reload restores chosen preference without reopening questionnaire; no formal star awarded just by following links',
    );
    if (savedSteps) {
      await closeMax(page);
      await readPlan(page);
      assert.deepEqual(
        await page.$$eval('#learning-plan-steps > li', (elements) =>
          elements.map((element) => ({
            id: element.dataset.stepId,
            skipped: element.classList.contains('is-skipped'),
          })),
        ),
        savedSteps,
      );
      checkpoints.push(
        'Reload restores the user-chosen path order and skipped status, not a replacement default',
      );
    }
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    stage = 'clear-exit-without-completion';
    await closeMax(page);
    await click(page, '#knowledge-course-link');
    await page.waitForSelector('.course-structure-toolbar input[type="search"]', { visible: true });
    assert.equal(new URL(page.url()).pathname, '/course');
    assert.equal(preview.learning.starsStore.rows.length, 0);
    checkpoints.push(
      'The visible course-directory exit works even with no formal selftest or stars completed',
    );
    return {
      name,
      passed: true,
      viewport,
      profile,
      stage,
      checkpoints,
      observations,
      errors,
      external,
      simulatedModelCalls: preview.requests.length,
    };
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {});
    return {
      name,
      passed: false,
      stage,
      message: error.message,
      checkpoints,
      observations,
      errors,
      external,
      url: page.url(),
      state: await page
        .evaluate(() => ({
          tool: document.querySelector('[data-learning-tool]')?.dataset.learningTool,
          dialogs: [...document.querySelectorAll('dialog[open]')].map(
            (element) => element.id || element.className,
          ),
          quizTab: document.querySelector('#learning-quiz-tabs').innerHTML,
        }))
        .catch(() => null),
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
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-human-personas-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const results = [];
  try {
    for (const viewport of [
      { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
      { name: 'narrow-dark', width: 390, height: 844, theme: 'dark' },
    ])
      for (const profile of PROFILES.filter(
        (item) =>
          !process.env.HUMAN_PERSONA_PROFILE || item.name === process.env.HUMAN_PERSONA_PROFILE,
      )) {
        const result = await run(browser, output, viewport, profile);
        results.push(result);
        fs.writeFileSync(
          path.join(output, 'report.json'),
          JSON.stringify(
            {
              scope:
                'Fresh complete-preview memory records, simulated Max, native controls; workflow diagnostics only, not a user study',
              results,
            },
            null,
            2,
          ),
        );
        console.log(
          JSON.stringify({
            name: result.name,
            passed: result.passed,
            stage: result.stage,
            message: result.message,
            observations: result.observations,
          }),
        );
      }
  } finally {
    // This is a headless browser launched exclusively for this diagnostic.
    // A stuck DevTools shutdown must not leave the QA report unavailable.
    const termination = setTimeout(() => browser.process()?.kill(), 10000);
    try {
      await browser.close();
    } finally {
      clearTimeout(termination);
    }
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          scope:
            'Fresh complete-preview memory records, simulated Max, native controls; workflow diagnostics only, not a user study',
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Human persona workflow QA: ${output}`);
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
