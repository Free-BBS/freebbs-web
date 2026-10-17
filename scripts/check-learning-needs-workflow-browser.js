/* Real DOM acceptance on an isolated loopback preview, never production or live AI. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TOKEN } = require('./preview-economy');

const repo = path.resolve(__dirname, '..');
const arg = (key) => process.argv.find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1);
const origin = new URL(arg('--origin') || 'http://127.0.0.1:26719').origin;
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Only synthetic local previews may be tested');
const output = path.join(
  repo,
  'output/learning-needs-workflow',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const sources = [
  'public/knowledge.js',
  'public/knowledge.html',
  'public/knowledge-workspace.js',
  'public/knowledge-workspace.css',
  'public/learning-policy.js',
  'public/learning-strategies.js',
  'public/learning-start.js',
  'public/learning-workflow.js',
  'public/learning-workflow-panel.js',
  'public/learning-workflow-panel.css',
  'backend/learning-companion.js',
  'scripts/preview-learning-workspace.js',
  'scripts/preview-learning-policy.js',
  'scripts/check-learning-needs-workflow-browser.js',
];
const fingerprint = () =>
  Object.fromEntries(
    sources.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, file)))
        .digest('hex'),
    ]),
  );
const report = {
  origin,
  startedAt: new Date().toISOString(),
  boundary:
    'Real Chrome + DOM controls; public snapshots, synthetic identity/stores and explicitly simulated Max. No live AI, production writes or claims about pedagogical efficacy.',
  sourceBefore: fingerprint(),
  cases: [],
  requests: [],
  pageErrors: [],
  offOriginRequests: [],
  failures: [],
};
fs.mkdirSync(output, { recursive: true });
let browser;
let context;
let caseName = '';
const url = `${origin}/knowledge?course=signals&point=SS-02-01&view=reading`;
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const chats = () => report.requests.filter((item) => item.path === '/api/ai/knowledge/chat');
const tool = (page) => page.locator('[data-knowledge-page]').getAttribute('data-learning-tool');
const step = (page) => page.evaluate(() => window.FreeBbsLearningWorkspace.currentStep());
async function closeMax(page) {
  if (await page.locator('#knowledge-chat-close').isVisible())
    await page.locator('#knowledge-chat-close').click();
}
async function openMax(page) {
  if (!(await page.locator('#knowledge-chat-panel').isVisible()))
    await page.locator('#knowledge-chat-toggle').click();
  await page.locator('#knowledge-chat-input').waitFor({ state: 'visible' });
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.id &&
      window.freeBbsApp?.userState?.uid &&
      window.FreeBbsLearningWorkspace?.currentStep &&
      document.querySelector('.learning-start-editor, .learning-start-summary') &&
      window.FreeBbsLearningAssessment?.getSnapshot()?.loaded,
  );
  const later = page.locator('.max-tour[open] .max-tour-controls > .max-tour-later');
  if (await later.isVisible()) await later.click();
  if (await page.locator('.learning-guide-dialog[open]').isVisible())
    await page.keyboard.press('Escape');
  await closeMax(page);
}
async function session({ width = 1440, dark = false } = {}) {
  context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
    reducedMotion: 'reduce',
    colorScheme: dark ? 'dark' : 'light',
  });
  await context.addInitScript(
    ({ token, allowed, useDark }) => {
      if (window.location.origin !== allowed) return;
      localStorage.setItem('free_bbs_auth_token', token);
      localStorage.setItem('free_bbs_theme_mode', useDark ? 'dark' : 'light');
    },
    { token: TOKEN, allowed: origin, useDark: dark },
  );
  await context.route('**/*', (route) => {
    const target = new URL(route.request().url());
    if (target.origin === origin || ['blob:', 'data:'].includes(target.protocol))
      return route.continue();
    report.offOriginRequests.push(target.href);
    return route.abort('blockedbyclient');
  });
  context.on('request', (request) => {
    const target = new URL(request.url());
    if (target.origin !== origin || ['GET', 'HEAD'].includes(request.method())) return;
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      /* Non-JSON fixture mutation. */
    }
    report.requests.push({
      case: caseName,
      path: target.pathname,
      method: request.method(),
      ...(target.pathname === '/api/ai/knowledge/chat'
        ? { question: body?.question, context: body?.context }
        : {}),
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) =>
    report.pageErrors.push({ case: caseName, message: error.message }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return page;
}
async function choose(page, level, goal) {
  await closeMax(page);
  if (!(await page.locator('.learning-start-editor').isVisible()))
    await page.getByRole('button', { name: '调整学习方式', exact: true }).click();
  await page.locator(`input[name="learning-start-goal"][value="${goal}"]`).locator('..').click();
  await page.locator('.learning-start-editor select[name="level"]').selectOption(level);
  await page.getByRole('button', { name: '按这个方式学习', exact: true }).click();
  await page.locator('.learning-start-editor').waitFor({ state: 'detached' });
}
async function plan(page) {
  await closeMax(page);
  await page.locator('[data-knowledge-tool="continue"]').click();
  await page
    .locator('#learning-plan-summary > :is(.learning-plan-primary, #learning-workflow-card)')
    .waitFor({ state: 'visible' });
}
async function send(page, text) {
  await openMax(page);
  await page.locator('#knowledge-chat-input').fill(text);
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/ai/knowledge/chat' &&
      response.request().method() === 'POST',
  );
  await page.locator('#knowledge-chat-form button[type="submit"]').click();
  const response = await pending;
  assert.equal(response.status(), 200);
  await page.waitForFunction(
    () => !document.querySelector('#knowledge-chat-form button[type="submit"]')?.disabled,
  );
  const answer = await page.locator('#knowledge-chat-thread .is-assistant').last().innerText();
  assert.match(answer, /本地模拟/);
  return { request: chats().at(-1), answer };
}
async function record(name, action) {
  caseName = name;
  const started = Date.now();
  try {
    const evidence = await action();
    report.cases.push({ name, passed: true, milliseconds: Date.now() - started, ...evidence });
  } catch (error) {
    for (const [index, page] of (context?.pages() || []).entries()) {
      try {
        await page.screenshot({
          path: path.join(output, `failure-${report.cases.length}-${index}.png`),
        });
      } catch {
        /* Closed failed fixture. */
      }
    }
    report.cases.push({ name, passed: false, error: error.stack });
    throw error;
  } finally {
    await context?.close();
    context = null;
    save();
  }
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
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    await record(`review ${level}: recall can end without reading or questions`, async () => {
      const page = await session();
      await choose(page, level, 'review');
      await plan(page);
      const before = chats().length;
      assert.equal((await step(page)).phase, 'recall');
      await page.locator('[data-workflow-action="review-clear"]').click();
      assert.equal(await tool(page), 'continue');
      assert.equal(chats().length, before);
      const current = await step(page);
      assert.equal(current.phase, 'finished');
      assert.equal(current.outcome, 'clear');
      assert.equal(current.status, 'finished');
      const exchange = await send(page, '仅本地验证：这次已经回忆清楚，可以结束吗？');
      assert.equal(exchange.request.context.learningStepContext.outcome, 'clear');
      assert.match(exchange.answer, /可以就此结束/);
      await closeMax(page);
      if (level === 'familiar')
        await page.screenshot({ path: path.join(output, 'review-clear-finished.png') });
      return { current, answer: exchange.answer };
    });
    await record(
      `explore ${level}: own question reaches Max with no reading prerequisite`,
      async () => {
        const page = await session();
        await choose(page, level, 'explore');
        await plan(page);
        const question = `本地探索 ${level}：如果系统不再时不变，卷积表示的边界是什么？`;
        await page.locator('[data-workflow-question]').fill(question);
        const before = chats().length;
        await page.locator('[data-workflow-action="set-question"]').click();
        assert.equal(await tool(page), 'continue');
        assert.equal((await step(page)).question, question);
        await page.locator('[data-workflow-action="ask-max"]').click();
        assert.equal(chats().length, before, 'Opening Max only prepares the draft');
        assert.equal(await tool(page), 'continue');
        const exchange = await send(page, '请围绕我本次保存的探索问题给一个下一小步。');
        assert.equal(exchange.request.context.learningStepContext.question, question);
        assert.equal(exchange.request.context.learningStepContext.moduleId, 'explore');
        assert.equal(exchange.request.context.learningStepContext.phase, 'investigate');
        assert.match(exchange.answer, /围绕你本次写的问题/);
        assert.match(exchange.answer, /不先要求读正文或做题/);
        return { current: exchange.request.context.learningStepContext, answer: exchange.answer };
      },
    );
  }
  for (const goal of ['concepts', 'practice'])
    for (const level of ['new', 'familiar', 'basic', 'advanced']) {
      await record(`${goal} ${level}: a real chosen path step reaches Max`, async () => {
        const page = await session();
        await choose(page, level, goal);
        await plan(page);
        await page.locator('#learning-plan-editor-heading').click();
        await page
          .locator('#learning-plan-steps > li:first-child .learning-plan-step-actions')
          .getByRole('button', { name: '开始', exact: true })
          .click();
        const current = await step(page);
        assert.equal(current.goal, goal);
        assert.equal(current.level, level);
        const exchange = await send(page, '仅本地验证：请参考我主动打开的这个步骤。');
        assert.equal(exchange.request.context.learningStepContext.moduleId, current.moduleId);
        assert.equal(exchange.request.context.learningStepContext.phase, 'path');
        return { current };
      });
    }
  await record(
    'review gap lookup keeps a small exit strip and clear reaches the server',
    async () => {
      const page = await session();
      await choose(page, 'familiar', 'review');
      await plan(page);
      await page.locator('[data-workflow-action="review-gap"]').click();
      assert.equal((await step(page)).outcome, 'gap');
      const gap = await send(page, '我这一步有点卡住，请参考当前具体步骤。');
      assert.equal(gap.request.context.learningStepContext.moduleId, 'repair');
      assert.equal(gap.request.context.learningStepContext.outcome, 'gap');
      await closeMax(page);
      await page.locator('[data-workflow-module="read"]').click();
      assert.equal(await tool(page), 'content');
      const strip = page.locator('#learning-workflow-strip');
      assert.equal(await strip.isVisible(), true);
      assert.equal((await step(page)).moduleId, 'read');
      await page.screenshot({ path: path.join(output, 'review-gap-lookup-strip.png') });
      await strip.getByRole('button', { name: '已理顺，结束本次', exact: true }).click();
      assert.equal(await tool(page), 'continue');
      assert.equal((await step(page)).outcome, 'clear');
      const done = await send(page, '查阅这一处后我已经理顺，现在可以停止吗？');
      assert.equal(done.request.context.learningStepContext.moduleId, 'read');
      assert.equal(done.request.context.learningStepContext.status, 'finished');
      assert.match(done.answer, /可以就此结束/);
      return {
        gap: gap.request.context.learningStepContext,
        done: done.request.context.learningStepContext,
      };
    },
  );
  await record(
    'pause/resume and manual tools never resurrect a stale step or replace a Max draft',
    async () => {
      const page = await session();
      await choose(page, 'basic', 'review');
      await plan(page);
      await openMax(page);
      const draft = '我自己写到一半的问题，暂时不发送。';
      await page.locator('#knowledge-chat-input').fill(draft);
      await closeMax(page);
      const before = chats().length;
      await page.locator('[data-workflow-action="ask-max"]').click();
      assert.equal(await page.locator('#knowledge-chat-input').inputValue(), draft);
      assert.equal(chats().length, before);
      await closeMax(page);
      await page.locator('#learning-plan-pause').click();
      assert.equal((await step(page)).status, 'paused');
      await page.locator('[data-workflow-action="resume"]').click();
      assert.equal((await step(page)).status, 'active');
      await page.locator('[data-knowledge-tool="resources"]').click();
      assert.equal(await step(page), null);
      const exchange = await send(page, '仅本地核查手动换工具后的上下文。');
      assert.equal(Object.hasOwn(exchange.request.context, 'learningStepContext'), false);
      return { preservedDraft: true, manualStepCleared: true };
    },
  );
  await record(
    '390 px dark large-text exploration stays readable and keyboard actions retain focus',
    async () => {
      const page = await session({ width: 390, dark: true });
      await choose(page, 'new', 'explore');
      await plan(page);
      await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
      const input = page.locator('[data-workflow-question]');
      await input.fill('我能否先从一个简单的可观察现象开始？');
      await input.focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.workflowAction),
        'set-question',
      );
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H3');
      assert.equal((await step(page)).phase, 'investigate');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        false,
      );
      await page.locator('#learning-workflow-card').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'mobile390-dark-large-explore.png') });
      await page.locator('[data-workflow-action="ask-max"]').click();
      assert.equal(await page.locator('#knowledge-chat-input').isVisible(), true);
      await page.waitForFunction(
        () =>
          Number(getComputedStyle(document.getElementById('knowledge-chat-panel')).opacity) >= 0.99,
      );
      await page.screenshot({
        path: path.join(output, 'mobile390-dark-large-max.png'),
        animations: 'disabled',
      });
      return { width: 390, keyboardFocusReturnedToHeading: true, current: await step(page) };
    },
  );
  await record(
    'a mismatched public document revision clears the old page step and is rejected by the server',
    async () => {
      const page = await session();
      await choose(page, 'familiar', 'explore');
      await plan(page);
      await page
        .locator('[data-workflow-question]')
        .fill('旧正文中的本次问题，不应自动继承到新版本。');
      await page.locator('[data-workflow-action="set-question"]').click();
      await page.route(`${origin}/api/courses/signals/map/nodes/SS-02-01`, async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.node.documentVersion = 'd'.repeat(64);
        await route.fulfill({ response, json: payload });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      assert.equal(await step(page), null);
      await plan(page);
      assert.equal((await step(page)).question, undefined);
      const exchange = await send(page, '仅本地验证错误公开版本的步骤不能被服务器采信。');
      assert.equal(exchange.request.context.learningStepContext.documentVersion, 'd'.repeat(64));
      assert.doesNotMatch(exchange.answer, /已接收本次具体步骤/);
      return {
        boundary:
          'Local route deliberately supplies a mismatched public revision; server must reject it without weakening scope checks.',
        oldQuestionDiscarded: true,
        serverRejectedMismatchedStep: true,
      };
    },
  );
  await record(
    'a second-tab logout discards the previous owner step and course navigation cannot reuse it',
    async () => {
      const page = await session();
      await choose(page, 'familiar', 'explore');
      await plan(page);
      await page.locator('[data-workflow-question]').fill('仅属于本次的局部探索问题');
      await page.locator('[data-workflow-action="set-question"]').click();
      const other = await context.newPage();
      await other.goto(url, { waitUntil: 'domcontentloaded' });
      await ready(other);
      await other.evaluate(() => localStorage.removeItem('free_bbs_auth_token'));
      await page.waitForFunction(() => window.FreeBbsLearningWorkspace.currentStep() === null);
      assert.equal(await step(page), null);
      return { crossTabLogoutClearedStep: true };
    },
  );
  // Last: this is the only intentionally saved synthetic path; keep it out of the fresh matrix.
  await record(
    'an existing customized saved path survives natural review and a new point',
    async () => {
      const page = await session();
      await choose(page, 'basic', 'practice');
      await plan(page);
      await page.locator('#learning-plan-editor-heading').click();
      await page
        .locator('#learning-plan-steps > li:nth-child(2) button[aria-label^="上移"]')
        .click();
      const pathIds = await page
        .locator('#learning-plan-steps > li')
        .evaluateAll((items) => items.map((item) => item.dataset.stepId));
      await page.locator('#learning-plan-save').click();
      await page.waitForFunction(
        () => document.getElementById('learning-plan-status').textContent === '已保存',
      );
      await choose(page, 'familiar', 'review');
      await plan(page);
      await page.locator('[data-workflow-action="review-clear"]').click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      await plan(page);
      assert.deepEqual(
        await page
          .locator('#learning-plan-steps > li')
          .evaluateAll((items) => items.map((item) => item.dataset.stepId)),
        pathIds,
      );
      await closeMax(page);
      await page.locator('[data-knowledge-tool="content"]').click();
      const next = page.locator('#knowledge-next-link');
      if (await next.getAttribute('href')) {
        await next.click();
        await ready(page);
        assert.equal(
          await step(page),
          null,
          'Point navigation starts without an inherited live step',
        );
      }
      return { savedPathIds: pathIds, newPoint: page.url() };
    },
  );
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.offOriginRequests, []);
  assert.deepEqual(
    report.requests.filter((item) => /assessment|attempt|star/.test(item.path)),
    [],
    'No workflow action grades an answer or grants a star',
  );
}
main()
  .catch((error) => {
    report.failures.push(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await context?.close();
    await browser?.close();
    report.sourceAfter = fingerprint();
    report.sourcesStable =
      JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    if (!report.sourcesStable) {
      report.failures.push('Sources changed during browser QA');
      process.exitCode = 1;
    }
    report.completedAt = new Date().toISOString();
    report.chatRequests = chats().length;
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
