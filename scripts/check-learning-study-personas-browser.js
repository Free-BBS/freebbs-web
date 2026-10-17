// Workflow probes, not a user study or evidence that the simulated tutor teaches well.
// Author-demo content and synthetic users live only in fresh loopback memory previews.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { createLearningPreview, createLearningFixture } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  assert.ok(
    ['--output', '--playwright', '--chrome', '--only'].includes(process.argv[index]) &&
      process.argv[index + 1],
  );
  options.set(process.argv[index], process.argv[index + 1]);
}
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(options.get('--playwright') || 'playwright');
const output = path.resolve(options.get('--output') || 'output/learning-study-personas-20261016');
fs.mkdirSync(output, { recursive: true });
const repo = path.resolve(__dirname, '..');
const sourceFiles = [
  'public/knowledge.js',
  'public/knowledge.html',
  'public/knowledge-workspace.js',
  'public/knowledge-workspace.css',
  'public/knowledge-annotations.js',
  'public/learning-companion-memory.js',
  'public/learning-companion-memory.css',
  'public/learning-chat-drafts.js',
  'public/learning-start.js',
  'public/learning-strategies.js',
  'public/learning-next-steps.js',
  'public/learning-assessment.js',
  'backend/learning-assessment.js',
  'backend/learning-companion.js',
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, file)))
        .digest('hex'),
    ]),
  );
const point = 'SS-02-01';
const report = {
  boundary:
    'Real current UI, isolated author complete previews and an explicit two-user memory fixture. No production, personal browser profile or external model. Simulated Max validates trusted context transfer, not answer quality or learning gains.',
  startedAt: new Date().toISOString(),
  sourceBefore: hashes(),
  cases: [],
};
const save = () =>
  fs.writeFileSync(path.join(output, 'study-report.json'), JSON.stringify(report, null, 2));
const preference = (page) => page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion &&
      window.FreeBbsLearningAssessment?.getSnapshot()?.loaded,
  );
}
async function chooseStart(page, level, goal) {
  await page.locator('.learning-start-adjust').click();
  const dialog = page.locator('.learning-start-dialog[open]');
  await dialog.locator('[data-learning-start-choice="level"]').selectOption(level);
  await dialog.locator('[data-learning-start-choice="goal"]').selectOption(goal);
  await dialog.locator('.learning-start-apply').click();
  assert.deepEqual(await preference(page), { level, goal });
}
async function closeMax(page) {
  if (await page.locator('#knowledge-chat-panel').isVisible())
    await page.locator('#knowledge-chat-close').click();
}
async function reading(page) {
  await closeMax(page);
  await page.locator('[data-knowledge-tool="content"]').click();
  if (await page.locator('#knowledge-start-reading').isVisible())
    await page.locator('#knowledge-start-reading').click();
  await page.locator('#knowledge-body > p').first().waitFor({ state: 'visible' });
}
async function plan(page) {
  await page.locator('[data-knowledge-tool="continue"]').click();
  await page.locator('.learning-plan-primary').waitFor({ state: 'visible' });
  return page.evaluate(() => ({
    primary: document.querySelector('.learning-plan-primary h3').textContent,
    reason: document.getElementById('learning-plan-reason').textContent,
    steps: [...document.querySelectorAll('#learning-plan-steps > li')].map((item) => ({
      id: item.dataset.stepId,
      skipped: item.classList.contains('is-skipped'),
    })),
  }));
}
async function selectText(page, selector) {
  const fragment = await page.evaluate(async (container) => {
    for (const paragraph of document.querySelector(container).querySelectorAll('p')) {
      paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
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
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        const first = rects[0];
        const last = rects.at(-1);
        if (
          first?.width > 40 &&
          paragraph.contains(
            document.elementFromPoint(first.x + first.width / 2, first.y + first.height / 2),
          )
        )
          return {
            x: first.left + 0.2,
            y: first.top + first.height / 2,
            endX: last.right - 0.2,
            endY: last.top + last.height / 2,
          };
      }
    }
    return null;
  }, selector);
  assert.ok(fragment, `Real pointer-selectable prose in ${selector}`);
  await page.mouse.move(fragment.x, fragment.y);
  await page.mouse.down();
  await page.mouse.move(fragment.endX, fragment.endY, { steps: 12 });
  await page.mouse.up();
  const quote = await page.evaluate(() => window.getSelection().toString());
  assert.ok(quote.length >= 6);
  await page.waitForFunction(
    () => document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'true',
  );
  return quote;
}
async function send(page, text) {
  if (!(await page.locator('#knowledge-chat-panel').isVisible()))
    await page.locator('#knowledge-chat-toggle').click();
  if (text !== undefined) await page.locator('#knowledge-chat-input').fill(text);
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === '/api/ai/knowledge/chat' &&
      item.request().method() === 'POST',
  );
  await page.locator('#knowledge-chat-form button[type="submit"]').click();
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() =>
    document.getElementById('knowledge-chat-thread').textContent.includes('本地模拟回答'),
  );
}

async function run(browser, persona, width) {
  const preview = createCompleteLearningPreview();
  const { port } = await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${port}`;
  for (const version of [GUIDE_VERSION, LATEST_RELEASE?.id].filter(Boolean))
    await fetch(`${origin}/api/onboarding`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, status: 'skipped', step: 0 }),
    });
  const context = await browser.newContext({
    viewport: { width, height: width === 1440 ? 1000 : 844 },
    reducedMotion: 'reduce',
  });
  await context.route('**/*', (request) =>
    new URL(request.request().url()).origin === origin ? request.continue() : request.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const result = { persona, width, checks: [], errors: [], stage: 'entry' };
  report.cases.push(result);
  page.on('pageerror', (error) => result.errors.push(error.message));
  try {
    await page.goto(`${origin}/knowledge?course=signals&point=${point}&view=reading`, {
      waitUntil: 'networkidle',
    });
    await ready(page);
    assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
    assert.equal(await preference(page), null);
    await closeMax(page);
    await chooseStart(page, persona.level, persona.goal);
    result.recommendation = await plan(page);
    if (persona.kind === 'novice') {
      result.stage = 'origin-comment';
      await reading(page);
      await page.locator('#knowledge-reading [data-learning-go="notes"]').click();
      if (
        (await page.locator('#knowledge-history-toggle').getAttribute('aria-expanded')) === 'false'
      )
        await page.locator('#knowledge-history-toggle').click();
      const originQuote = await selectText(page, '#knowledge-history-prose');
      await page.locator('[data-annotation-action="comment"]').click();
      await page
        .locator('#learning-annotation-comment')
        .fill('本地 QA：我还想核对这个条件为何必要。');
      await page.locator('[data-annotation-action="comment-save"]').click();
      await page.locator('#knowledge-history-prose [data-private-annotation]').first().waitFor();
      const own = preview.learning.store.rows.find((row) => row.annotation);
      assert.equal(own.annotation.anchor.section, 'origin');
      assert.equal(own.annotation.anchor.quote, originQuote);
      result.stage = 'source-selection-max-draft';
      const quote = await selectText(page, '#knowledge-body');
      const position = await page.evaluate(() => {
        const host = window.FreeBbsLearningReader.getScrollHost();
        return host === window ? window.scrollY : host.scrollTop;
      });
      await page.locator('[data-annotation-action="ask"]').click();
      await page.locator('[data-selection-help="explain"]').click();
      assert.equal(
        preview.requests.length,
        0,
        'Selection assistance prepares an editable draft only',
      );
      assert.ok((await page.locator('#knowledge-chat-input').inputValue()).includes(quote));
      await send(page);
      const request = preview.requests[0];
      assert.equal(request.trustedCompanionContext.courseSlug, 'signals');
      assert.equal(request.trustedCompanionContext.knowledgePointId, point);
      assert.deepEqual(request.trustedCompanionContext.learningStartPreference, {
        level: persona.level,
        goal: persona.goal,
      });
      assert.ok(request.question.includes(quote));
      assert.ok(
        JSON.stringify(request.trustedCompanionContext.personalLearningContent).includes('本地 QA'),
      );
      await closeMax(page);
      const returned = await page.evaluate(() => {
        const host = window.FreeBbsLearningReader.getScrollHost();
        return host === window ? window.scrollY : host.scrollTop;
      });
      result.annotation = {
        originQuote,
        selectedQuote: quote,
        beforeScroll: position,
        afterScroll: returned,
        sourceFields: Object.keys(request.trustedCompanionContext),
      };
      assert.ok(
        Math.abs(returned - position) < 3,
        'Closing Max does not reset the current reading position',
      );
      result.checks.push(
        'Origin comment is private, selection stays in an unsent draft until explicit Send, trusted Max context uses this person/point/preference and reading position survives.',
      );
      result.stage = 'course-scope';
      await page.goto(`${origin}/knowledge?course=math&point=MA-01-1&view=reading`, {
        waitUntil: 'networkidle',
      });
      await ready(page);
      assert.equal(
        await preference(page),
        null,
        'A different course never inherits this course preference',
      );
      await chooseStart(page, 'advanced', 'explore');
      await page.goto(`${origin}/knowledge?course=signals&point=${point}&view=reading`, {
        waitUntil: 'networkidle',
      });
      await ready(page);
      assert.deepEqual(await preference(page), { level: 'new', goal: 'concepts' });
      result.checks.push(
        'A separately selected math preference does not overwrite the saved signals preference.',
      );
    } else if (persona.kind === 'practice') {
      result.stage = 'wrong-practice-feedback';
      await page.locator('.learning-plan-primary .learning-primary').click();
      // A less familiar learner is first offered a worked example, not a
      // forced test. The visible task menu still permits direct practice.
      await page.locator('[data-knowledge-tool="feedback"]').click();
      await page.locator('#learning-quiz-tabs [data-quiz-view="practice"]').click();
      await page.locator('.learning-quiz-filters select').selectOption('basic');
      const card = page.locator('[data-question-id="SS-02-01-Q01"]');
      await card.locator('input[value="B"]').check();
      await card.locator('button[type="submit"]').click();
      await page.waitForFunction(() =>
        window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
          (item) => item.questionId === 'SS-02-01-Q01',
        ),
      );
      await page.locator('#learning-quiz-tabs [data-quiz-view="mistakes"]').click();
      await page.locator('[data-question-id="SS-02-01-Q01"]').waitFor({ state: 'visible' });
      const resultCard = page
        .locator('#learning-quiz-results details.learning-quiz-result')
        .first();
      if (!(await resultCard.evaluate((element) => element.open)))
        await resultCard.locator(':scope > summary').click();
      result.feedback = await resultCard.textContent();
      assert.match(result.feedback, /作答|反馈|判定依据/);
      result.stage = 'edited-path-remains-owned';
      await plan(page);
      await page.locator('#learning-plan-editor-heading').click();
      await page
        .locator('#learning-plan-steps > li:nth-child(2) button[aria-label^="上移"]')
        .click();
      await page
        .locator('#learning-plan-steps > li:first-child .learning-plan-step-actions')
        .getByRole('button', { name: '跳过', exact: true })
        .click();
      const edited = (await plan(page)).steps;
      await page.locator('#learning-plan-save').click();
      await page.waitForFunction(
        () => document.getElementById('learning-plan-status').textContent === '已保存',
      );
      await chooseStart(page, persona.level, 'explore');
      assert.deepEqual(
        (await plan(page)).steps,
        edited,
        'Preference refresh does not replace an explicitly edited path',
      );
      await page.reload({ waitUntil: 'networkidle' });
      await ready(page);
      assert.deepEqual(
        (await plan(page)).steps,
        edited,
        'Reload preserves the confirmed personalized path',
      );
      result.checks.push(
        'A wrong practice appears in correction, feedback is readable, and saved reordered/skipped steps survive changed advice preferences and reload.',
      );
    } else {
      result.stage = 'expert-relations-without-gates';
      await page.locator('.learning-plan-primary .learning-primary').click();
      await page.waitForURL((url) => url.pathname === '/course');
      assert.equal(new URL(page.url()).searchParams.get('focus'), point);
      await page.locator('.course-structure-details .course-structure-primary').click();
      await page.locator('#course-knowledge-overview[open] .knowledge-overview-study').click();
      await ready(page);
      await closeMax(page);
      await page.locator('[data-knowledge-tool="resources"]').click();
      result.resources = await page.locator('[data-learning-panel="resources"]').textContent();
      await plan(page);
      await page.locator('.learning-task-shortcuts summary').click();
      await page
        .locator('.learning-task-options')
        .getByRole('button', { name: '探索与检验', exact: true })
        .click();
      await page.locator('[data-question-id="SS-02-01-Q06"]').waitFor({ state: 'visible' });
      assert.equal(preview.requests.length, 0);
      result.checks.push(
        'An expert can go straight to relationships, available resources and exploration without a read-all, AI-message or star gate.',
      );
    }
    assert.equal(
      preview.learning.starsStore.rows.length,
      0,
      'Navigation, self-report, notes and practice never award formal stars',
    );
    assert.deepEqual(result.errors, []);
    await page.screenshot({ path: path.join(output, `${persona.name}-${width}.png`) });
    result.status = 'passed';
    console.log(`${persona.name}-${width}: passed`);
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack;
    await page.screenshot({ path: path.join(output, `${persona.name}-${width}-failure.png`) });
    console.error(`${persona.name}-${width} ${result.stage}: ${error.message}`);
  } finally {
    result.simulatedModelCalls = preview.requests.length;
    await context.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    save();
  }
}

async function identity(browser) {
  const fixture = createLearningFixture();
  const preview = createLearningPreview({
    mapNodes: fixture.nodes,
    mapEdges: fixture.edges,
    contextRows: fixture.contextRows,
  });
  const { port } = await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${port}`;
  const markers = {
    first: '本地隔离夹具：甲同学只属于当前点的私人笔记。',
    second: '本地隔离夹具：乙同学只属于当前点的私人笔记。',
    anotherPoint: '本地隔离夹具：乙同学另一个知识点的私人笔记。',
  };
  for (const [owner, nodeId, content] of [
    ['student', point, markers.first],
    ['other', point, markers.second],
    ['other', 'SS-01-01', markers.anotherPoint],
  ]) {
    const node = fixture.nodes.find((item) => item.id === nodeId);
    const response = await fetch(`${origin}/api/learning/signals/${nodeId}/entries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer learning-preview-${owner}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'note',
        title: '本地隔离控制样本',
        content,
        documentVersion: getAssessmentDocumentVersion(node.markdown),
        requestKey: crypto.randomUUID(),
      }),
    });
    assert.ok(response.ok, `Isolated memory-only private fixture: ${response.status}`);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (request) =>
    new URL(request.request().url()).origin === origin ? request.continue() : request.abort(),
  );
  const page = await context.newPage();
  const result = { name: 'two-real-preview-identities', checks: [] };
  report.cases.push(result);
  try {
    const url = `${origin}/knowledge?course=signals&point=${point}&view=reading`;
    await page.goto(`${url}&as=student`, { waitUntil: 'networkidle' });
    await ready(page);
    await chooseStart(page, 'new', 'concepts');
    await page.goto(`${url}&as=other`, { waitUntil: 'networkidle' });
    await ready(page);
    assert.equal(await preference(page), null);
    await chooseStart(page, 'advanced', 'explore');
    await send(page, '本地 QA：请核对当前课程和我的起点。');
    assert.deepEqual(preview.requests[0].trustedCompanionContext.learningStartPreference, {
      level: 'advanced',
      goal: 'explore',
    });
    const secondContent = JSON.stringify(
      preview.requests[0].trustedCompanionContext.personalLearningContent,
    );
    assert.ok(
      secondContent.includes(markers.second),
      'Positive control: this user/current-point note reaches the simulated tutor',
    );
    assert.ok(!secondContent.includes(markers.first), 'A different user note is not sent');
    assert.ok(
      !secondContent.includes(markers.anotherPoint),
      'The same user different-point note is not sent',
    );
    await page.goto(`${url}&as=student`, { waitUntil: 'networkidle' });
    await ready(page);
    assert.deepEqual(await preference(page), { level: 'new', goal: 'concepts' });
    await send(page, '本地 QA：请使用我自己的当前知识点资料。');
    const firstContent = JSON.stringify(
      preview.requests[1].trustedCompanionContext.personalLearningContent,
    );
    assert.ok(firstContent.includes(markers.first));
    assert.ok(!firstContent.includes(markers.second));
    assert.ok(!firstContent.includes(markers.anotherPoint));
    result.checks.push(
      'Two server-recognized synthetic members have separate preferences; each explicit simulated Max send includes its own current-point positive-control note, excludes the other member and another point, and returning to the first restores its own start.',
    );
    result.status = 'passed';
    console.log('two-real-preview-identities: passed');
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack;
    await page.screenshot({ path: path.join(output, 'two-identities-failure.png') });
    console.error(error.message);
  } finally {
    await context.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    save();
  }
}
async function main() {
  const browser = await chromium.launch({
    executablePath: options.get('--chrome'),
    headless: true,
  });
  const personas = [
    { name: 'first-learning', kind: 'novice', level: 'new', goal: 'concepts' },
    { name: 'uncertain-practice', kind: 'practice', level: 'familiar', goal: 'practice' },
    { name: 'independent-practice', kind: 'practice', level: 'basic', goal: 'practice' },
    { name: 'research-exploration', kind: 'expert', level: 'advanced', goal: 'explore' },
  ];
  try {
    for (const width of [1440, 390])
      for (const persona of personas.filter(
        (item) => !options.has('--only') || item.name.includes(options.get('--only')),
      ))
        await run(browser, persona, width);
    if (!options.has('--only')) await identity(browser);
  } finally {
    await browser.close();
    report.sourceAfter = hashes();
    report.sourceChangedDuringRun = sourceFiles.filter(
      (file) => report.sourceBefore[file] !== report.sourceAfter[file],
    );
    report.finishedAt = new Date().toISOString();
    save();
  }
  assert.ok(report.cases.length > 0, 'No persona matched; this is not a passing QA run');
  assert.deepEqual(report.sourceChangedDuringRun, [], 'Do not mix results from edited sources');
  assert.ok(
    report.cases.every((item) => item.status === 'passed'),
    'Inspect the saved scene and screenshot for failures',
  );
  console.log(path.join(output, 'study-report.json'));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
