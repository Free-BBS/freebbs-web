/* Normal-entry workflow QA: current controls and isolated loopback fixtures only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const policy = require('../public/learning-policy');
const { TOKEN } = require('./preview-economy');

const repo = path.resolve(__dirname, '..');
const argument = (name) =>
  process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
const origin = new URL(argument('--origin') || 'http://127.0.0.1:48305').origin;
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Never target a real deployment');
const only = argument('--only') || '';
const output = path.resolve(
  repo,
  'output/learning-normal-policy',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const sourceFiles = [
  'public/learning-start.js',
  'public/learning-start.css',
  'public/learning-strategies.js',
  'public/learning-policy.js',
  'public/learning-workflow.js',
  'public/learning-workflow-panel.js',
  'public/learning-workflow-panel.css',
  'public/learning-next-steps.js',
  'public/knowledge.js',
  'public/knowledge.html',
  'public/knowledge-workspace.js',
  'public/knowledge-workspace.css',
  'backend/learning-companion.js',
  'backend/server.js',
  'scripts/preview-learning-workspace.js',
  'scripts/preview-learning-complete.js',
  'scripts/preview-onboarding.js',
  'scripts/check-learning-normal-policy-browser.js',
];
const fingerprint = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, file)))
        .digest('hex'),
    ]),
  );
const report = {
  startedAt: new Date().toISOString(),
  origin,
  boundary:
    'Real Chrome and normal knowledge URLs, current controls, local public snapshots, synthetic private stores and simulated Max only. No production, real accounts, external models, teaching-effect claims, automatic chat or formal assessment.',
  sourceBefore: fingerprint(),
  cases: [],
  pageErrors: [],
  offOriginRequests: [],
  requests: [],
  failures: [],
};
fs.mkdirSync(output, { recursive: true });
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const chatRequests = () => report.requests.filter((item) => item.path === '/api/ai/knowledge/chat');
const goals = { concepts: 'learn', practice: 'practice', review: 'review', explore: 'explore' };
const point = 'SS-02-01';
const normalUrl = `${origin}/knowledge?course=signals&point=${point}&view=reading`;
let browser;
let currentContext;
let currentCase = '';
let selectedCases = 0;

async function record(name, action) {
  if (only && !name.includes(only)) return;
  selectedCases += 1;
  currentCase = name;
  const started = Date.now();
  try {
    const evidence = await action();
    report.cases.push({ name, passed: true, milliseconds: Date.now() - started, ...evidence });
  } catch (error) {
    for (const [index, page] of (currentContext?.pages() || []).entries()) {
      try {
        await page.screenshot({
          path: path.join(output, `failure-${report.cases.length}-${index}.png`),
        });
      } catch {
        /* The failed page may already be closed. */
      }
    }
    report.cases.push({ name, passed: false, error: error.stack });
    throw error;
  } finally {
    await currentContext?.close();
    currentContext = null;
    save();
  }
}
async function closeMax(page) {
  const close = page.locator('#knowledge-chat-close');
  if (await close.isVisible()) await close.click();
}
async function openMax(page) {
  if (!(await page.locator('#knowledge-chat-panel').isVisible()))
    await page.locator('#knowledge-chat-toggle').click();
  await page.locator('#knowledge-chat-input').waitFor({ state: 'visible' });
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.id === 'SS-02-01' &&
      window.freeBbsApp?.userState?.uid &&
      window.FreeBbsLearningStart &&
      document.querySelector('.learning-start-editor, .learning-start-summary') &&
      window.FreeBbsLearningAssessment?.getSnapshot()?.loaded,
  );
  const later = page.locator('.max-tour[open] .max-tour-controls > .max-tour-later');
  if (await later.isVisible()) await later.click();
  if (await page.locator('.learning-guide-dialog[open]').isVisible())
    await page.keyboard.press('Escape');
  await closeMax(page);
}
async function session(width = 1440) {
  currentContext = await browser.newContext({
    viewport: { width, height: width === 1440 ? 1000 : 844 },
    reducedMotion: 'reduce',
  });
  await currentContext.addInitScript(
    ({ token, allowedOrigin }) => {
      if (window.location.origin === allowedOrigin)
        localStorage.setItem('free_bbs_auth_token', token);
    },
    { token: TOKEN, allowedOrigin: origin },
  );
  await currentContext.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.offOriginRequests.push({ url: url.href, method: route.request().method() });
    return route.abort('blockedbyclient');
  });
  currentContext.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || ['GET', 'HEAD'].includes(request.method())) return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    report.requests.push({
      case: currentCase,
      path: url.pathname,
      method: request.method(),
      ...(url.pathname === '/api/ai/knowledge/chat'
        ? {
            question: body?.question,
            learningStartPreference: body?.context?.learningStartPreference,
            learningPolicyContext: body?.context?.learningPolicyContext,
            learningStepContext: body?.context?.learningStepContext,
            learningTask: body?.context?.learningTask,
          }
        : {}),
    });
  });
  const page = await currentContext.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) =>
    report.pageErrors.push({ case: currentCase, error: error.message }),
  );
  await page.goto(normalUrl, { waitUntil: 'domcontentloaded' });
  await ready(page);
  const url = new URL(page.url());
  for (const key of ['policy', 'purpose', 'level', 'module'])
    assert.equal(url.searchParams.has(key), false);
  return page;
}
const preference = (page) => page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
const activeTool = (page) =>
  page.locator('[data-knowledge-page]').getAttribute('data-learning-tool');
async function choose(page, level, goal) {
  if (!(await page.locator('.learning-start-editor').isVisible()))
    await page.getByRole('button', { name: '调整学习方式', exact: true }).click();
  const option = page.locator(`input[name="learning-start-goal"][value="${goal}"]`);
  await option.locator('..').click();
  assert.equal(await option.isChecked(), true);
  await page.locator('.learning-start-editor select[name="level"]').selectOption(level);
  await page.getByRole('button', { name: '按这个方式学习', exact: true }).click();
  await page.locator('.learning-start-editor').waitFor({ state: 'detached' });
  assert.deepEqual(await preference(page), { level, goal });
}
async function plan(page) {
  await closeMax(page);
  await page.locator('[data-knowledge-tool="continue"]').click();
  await page
    .locator('#learning-plan-summary > :is(.learning-plan-primary, #learning-workflow-card)')
    .waitFor({ state: 'visible' });
  return page.evaluate(() => ({
    presentation: document.getElementById('learning-workflow-card') ? 'workflow' : 'path',
    workflow: document.getElementById('learning-workflow-card')
      ? {
          goal: document.getElementById('learning-workflow-card').dataset.workflowGoal,
          phase: document.getElementById('learning-workflow-card').dataset.workflowPhase,
          heading: document.querySelector('#learning-workflow-card h3').textContent,
        }
      : null,
    title: document.getElementById('learning-plan-title').textContent,
    reason: document.getElementById('learning-plan-reason').textContent,
    chain: document.getElementById('learning-plan-chain').textContent,
    steps: [...document.querySelectorAll('#learning-plan-steps > li')].map((item) => ({
      id: item.dataset.stepId,
      skipped: item.classList.contains('is-skipped'),
      completed: item.classList.contains('is-complete'),
      title: item.querySelector('.learning-plan-copy strong').textContent,
    })),
  }));
}
async function send(page, text) {
  await openMax(page);
  const before = chatRequests().length;
  await page.locator('#knowledge-chat-input').fill(text);
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/knowledge/chat',
  );
  await page.locator('#knowledge-chat-form button[type="submit"]').click();
  const response = await pending;
  assert.equal(response.status(), 200);
  await page.waitForFunction(
    () => !document.querySelector('#knowledge-chat-form button[type="submit"]')?.disabled,
  );
  const body = await page.locator('#knowledge-chat-thread .is-assistant').last().innerText();
  assert.match(body, /本地模拟/);
  assert.equal(chatRequests().length, before + 1);
  return { request: chatRequests().at(-1), response: body };
}

async function main() {
  // eslint-disable-next-line import/no-dynamic-require
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE ||
      'C:/Users/yc-z2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  report.browser = browser.version();
  for (const [goal, purpose] of Object.entries(goals))
    for (const level of Object.keys(policy.LEVELS))
      await record(`normal matrix ${goal}:${level}`, async () => {
        const page = await session();
        assert.ok(await page.locator('.learning-start-editor').isVisible());
        assert.equal(await page.locator('dialog.learning-start-dialog').count(), 0);
        assert.equal(await page.locator('.learning-start-editor input[type="radio"]').count(), 4);
        assert.equal(await page.locator('.learning-start-editor select').count(), 1);
        assert.equal(await preference(page), null);
        const before = chatRequests().length;
        const tool = await activeTool(page);
        await choose(page, level, goal);
        assert.equal(await activeTool(page), tool, 'Applying never changes the reading tool');
        assert.equal(chatRequests().length, before, 'Applying never sends a Max question');
        const recommendation = await plan(page);
        if (['review', 'explore'].includes(goal)) {
          assert.equal(recommendation.presentation, 'workflow');
          assert.equal(recommendation.workflow.goal, goal);
          assert.equal(recommendation.workflow.phase, goal === 'review' ? 'recall' : 'question');
          assert.equal(await page.locator('.learning-plan-primary').count(), 0);
        } else {
          assert.equal(recommendation.presentation, 'path');
          assert.equal(recommendation.workflow, null);
        }
        assert.ok(recommendation.steps.length > 0);
        assert.ok(
          recommendation.steps.every((step) => step.id.startsWith(`${level}:${goal}:`)),
          'Actual continue panel uses this selected modular chain',
        );
        assert.ok(recommendation.title.includes(policy.PURPOSES[purpose]));
        await openMax(page);
        const label = await page.locator('#knowledge-learning-policy-context').innerText();
        assert.ok(label.includes(policy.PURPOSES[purpose]));
        assert.ok(label.includes(policy.LEVELS[level]));
        assert.doesNotMatch(label, /实验|16 类|待验证/);
        assert.equal(await page.locator('#knowledge-chat-input').inputValue(), '');
        assert.equal(chatRequests().length, before);
        const exchange = await send(page, `仅本地验证自然学习入口：${goal} ${level}`);
        assert.deepEqual(exchange.request.learningStartPreference, { level, goal });
        assert.deepEqual(exchange.request.learningPolicyContext, {
          policyVersion: policy.POLICY_VERSION,
          purpose,
          level,
        });
        assert.equal(exchange.request.learningStepContext.goal, goal);
        assert.equal(exchange.request.learningStepContext.level, level);
        assert.equal(exchange.request.learningStepContext.status, 'active');
        assert.equal(exchange.request.learningStepContext.outcome, 'unknown');
        if (goal === 'review') {
          assert.equal(exchange.request.learningStepContext.moduleId, 'retrieve');
          assert.equal(exchange.request.learningStepContext.phase, 'recall');
        } else if (goal === 'explore') {
          assert.equal(exchange.request.learningStepContext.moduleId, 'explore');
          assert.equal(exchange.request.learningStepContext.phase, 'question');
        }
        assert.ok(exchange.response.includes(policy.PURPOSES[purpose]));
        assert.ok(exchange.response.includes(policy.LEVELS[level]));
        if (
          (goal === 'concepts' && level === 'new') ||
          (goal === 'review' && level === 'familiar') ||
          (goal === 'explore' && level === 'advanced')
        ) {
          await closeMax(page);
          await page.screenshot({ path: path.join(output, `${goal}-${level}-continue.png`) });
        }
        return {
          goal,
          level,
          recommendation,
          requestContext: exchange.request.learningPolicyContext,
        };
      });

  await record('ordinary return restores course settings and does not ask again', async () => {
    const page = await session();
    await choose(page, 'familiar', 'review');
    const before = chatRequests().length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    assert.equal(await page.locator('.learning-start-editor').count(), 0);
    assert.deepEqual(await preference(page), { level: 'familiar', goal: 'review' });
    assert.match(await page.locator('.learning-start-summary').innerText(), /复习知识.*不甚熟悉/);
    assert.equal(chatRequests().length, before);
    return { restored: await preference(page) };
  });

  await record(
    'continue directly keeps normal reading and never invents a preference',
    async () => {
      const page = await session();
      const before = chatRequests().length;
      const tool = await activeTool(page);
      await page.getByRole('button', { name: '先直接学习', exact: true }).click();
      assert.equal(await page.locator('.learning-start-editor').count(), 0);
      assert.equal(await preference(page), null);
      assert.equal(await activeTool(page), tool);
      const saved = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith('free_bbs_learning_start_v1:'))
          .map((key) => localStorage.getItem(key)),
      );
      assert.deepEqual(saved, []);
      assert.equal(chatRequests().length, before);
      await page.getByRole('button', { name: '调整学习方式', exact: true }).click();
      assert.equal(await page.locator('input[name="learning-start-goal"]:checked').count(), 0);
      assert.equal(
        await page.locator('.learning-start-editor select[name="level"]').inputValue(),
        '',
      );
      return { saving: 'None; merely folds the page-local unset entry' };
    },
  );

  await record(
    'cancelled preference drafts retain current guidance and an unsent Max draft',
    async () => {
      const page = await session();
      await choose(page, 'basic', 'practice');
      await openMax(page);
      const draft = '本地本人草稿：我想核对这个条件，暂时不发送。';
      await page.locator('#knowledge-chat-input').fill(draft);
      await closeMax(page);
      const tool = await activeTool(page);
      const before = chatRequests().length;
      await page.getByRole('button', { name: '调整学习方式', exact: true }).click();
      await page
        .locator('input[name="learning-start-goal"][value="explore"]')
        .locator('..')
        .click();
      await page.locator('.learning-start-editor select[name="level"]').selectOption('advanced');
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert.deepEqual(await preference(page), { level: 'basic', goal: 'practice' });
      assert.equal(await activeTool(page), tool);
      await openMax(page);
      assert.equal(await page.locator('#knowledge-chat-input').inputValue(), draft);
      assert.equal(chatRequests().length, before);
      assert.match(
        await page.locator('#knowledge-learning-policy-context').innerText(),
        /练习解题.*能独立做题/,
      );
      return { retainedDraft: true, currentPreference: await preference(page) };
    },
  );

  await record(
    '390 px native radio keyboard selection and normal Max remain readable',
    async () => {
      const page = await session(390);
      const before = chatRequests().length;
      const first = page.locator('input[name="learning-start-goal"][value="concepts"]');
      await first.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page.locator('input[name="learning-start-goal"]:checked').inputValue(),
        'practice',
      );
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.name), 'level');
      await page.locator('.learning-start-editor select[name="level"]').selectOption('new');
      const apply = page.getByRole('button', { name: '按这个方式学习', exact: true });
      await apply.focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await preference(page), { level: 'new', goal: 'practice' });
      assert.equal(chatRequests().length, before);
      const recommendation = await plan(page);
      assert.ok(recommendation.steps.every((step) => step.id.startsWith('new:practice:')));
      await page.screenshot({ path: path.join(output, 'normal-mobile-390-continue.png') });
      await openMax(page);
      const row = page.locator('#knowledge-learning-policy-context');
      await row.scrollIntoViewIfNeeded();
      assert.match(await row.innerText(), /练习解题.*第一次学/);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        false,
      );
      assert.equal(chatRequests().length, before);
      await page.screenshot({ path: path.join(output, 'normal-mobile-390-max.png') });
      return { width: 390, nativeRadioKeyboard: true, recommendation };
    },
  );

  // Run after the fresh no-path matrix because the isolated preview's server store persists
  // saved student paths intentionally. This creates only one synthetic path, never production data.
  await record(
    'edited and saved personal path survives new advice preferences and reload',
    async () => {
      const page = await session();
      await choose(page, 'basic', 'practice');
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
      const before = chatRequests().length;
      await choose(page, 'familiar', 'review');
      assert.deepEqual((await plan(page)).steps, edited, 'Unsaved customized path is not replaced');
      await page.locator('#learning-plan-save').click();
      await page.waitForFunction(
        () => document.getElementById('learning-plan-status').textContent === '已保存',
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      assert.equal(await page.locator('.learning-start-editor').count(), 0);
      assert.deepEqual(await preference(page), { level: 'familiar', goal: 'review' });
      assert.deepEqual(
        (await plan(page)).steps,
        edited,
        'Saved custom path remains after normal return',
      );
      assert.equal(chatRequests().length, before);
      return { retainedPath: edited, restoredPreference: await preference(page) };
    },
  );
  assert.ok(selectedCases > 0, 'The --only filter must select at least one real case');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.offOriginRequests, []);
  const unexpectedAssessmentWrites = report.requests.filter(
    (request) =>
      /assessment|attempt|star/.test(request.path) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method),
  );
  assert.deepEqual(
    unexpectedAssessmentWrites,
    [],
    'Choices and navigation never create grading or stars',
  );
}

main()
  .catch((error) => {
    report.failures.push(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await currentContext?.close();
    await browser?.close();
    report.sourceAfter = fingerprint();
    report.sourcesStable =
      JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    if (!report.sourcesStable) {
      report.failures.push('Frozen source changed during QA');
      process.exitCode = 1;
    }
    report.completedAt = new Date().toISOString();
    report.requestCounts = {
      chat: chatRequests().length,
      otherLocalMutations: report.requests.filter(
        (request) => request.path !== '/api/ai/knowledge/chat',
      ).length,
      offOrigin: report.offOriginRequests.length,
    };
    save();
    console.log(
      JSON.stringify({
        output,
        passed: report.cases.filter((item) => item.passed).length,
        failures: report.failures,
        sourcesStable: report.sourcesStable,
      }),
    );
  });
