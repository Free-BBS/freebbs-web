/* Real Chrome UI + isolated loopback fixtures. Not a teaching-effectiveness study. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const policy = require('../public/learning-policy');
const { TOKEN } = require('./preview-economy');

const repo = path.resolve(__dirname, '..');
const source = process.argv.find((arg) => arg.startsWith('--origin='))?.slice(9);
const origin = new URL(source || 'http://127.0.0.1:48305').origin;
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Never target production or another host');
const output = path.resolve(
  repo,
  'output/learning-policy-delivery',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const publicServer = path.resolve(
  repo,
  '../../98 临时文件/learning-world-ui-20261014/serve-real-public-learning.cjs',
);
const sourceFiles = [
  'public/knowledge.js',
  'public/knowledge.html',
  'public/learning-policy.js',
  'public/learning-policy-lab.js',
  'public/learning-policy-lab.html',
  'backend/learning-companion.js',
  'scripts/preview-learning-workspace.js',
  'scripts/preview-learning-complete.js',
  'scripts/preview-onboarding.js',
  'scripts/preview-learning-policy.js',
  'scripts/check-learning-policy-delivery-browser.js',
];
const fingerprint = () =>
  Object.fromEntries(
    [...sourceFiles, publicServer].map((file) => [
      path.isAbsolute(file) ? file : file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.isAbsolute(file) ? file : path.join(repo, file)))
        .digest('hex'),
    ]),
  );
const report = {
  startedAt: new Date().toISOString(),
  origin,
  boundary:
    'Real Chrome, actual current controls, public course snapshots, isolated synthetic identity and explicitly simulated local Max. No production, real account, external model, grading, or teaching-effectiveness claims.',
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
const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
let chromium;
let browser;
let context;

async function record(name, action) {
  const started = Date.now();
  try {
    const evidence = await action();
    report.cases.push({ name, passed: true, milliseconds: Date.now() - started, ...evidence });
  } catch (error) {
    report.failurePages = await Promise.all(
      (context?.pages() || []).map(async (page, index) => {
        const url = page.url();
        try {
          await page.screenshot({ path: path.join(output, `failure-${index}.png`) });
          return { url, title: await page.title() };
        } catch {
          return { url };
        }
      }),
    );
    report.cases.push({ name, passed: false, error: error.stack });
    throw error;
  } finally {
    save();
  }
}
async function dismissOptionalOverlays(page) {
  const later = page.locator('.max-tour[open] .max-tour-controls > .max-tour-later');
  if (await later.isVisible()) await later.click();
  const guide = page.locator('.learning-guide-dialog[open]');
  if (await guide.isVisible()) await page.keyboard.press('Escape');
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.id === 'SS-02-01' &&
      window.freeBbsApp?.userState?.uid,
    null,
    { timeout: 25000 },
  );
  await dismissOptionalOverlays(page);
}
async function openMax(page) {
  if (!(await page.locator('#knowledge-chat-panel').isVisible()))
    await page.locator('#knowledge-chat-toggle').click();
  await page.locator('#knowledge-chat-input').waitFor({ state: 'visible' });
}
async function send(page, prompt) {
  const start = chatRequests().length;
  await page.locator('#knowledge-chat-input').fill(prompt);
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/api/ai/knowledge/chat',
  );
  await page.locator('#knowledge-chat-form button[type="submit"]').click();
  const received = await response;
  assert.equal(received.status(), 200);
  const body = await received.text();
  assert.match(body, /本地.*模拟/);
  await page.waitForFunction(
    () => !document.querySelector('#knowledge-chat-form button[type="submit"]')?.disabled,
  );
  assert.equal(chatRequests().length, start + 1);
  return { request: chatRequests().at(-1), response: body };
}
async function newPage() {
  const page = await context.newPage();
  page.on('pageerror', (error) =>
    report.pageErrors.push({ url: page.url(), error: error.message }),
  );
  return page;
}

async function main() {
  // eslint-disable-next-line import/no-dynamic-require
  ({ chromium } = require(
    process.env.PLAYWRIGHT_MODULE ||
      'C:/Users/yc-z2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  ));
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(
    ({ token, allowedOrigin }) => {
      // A new popup initially has an opaque about:blank document. Only seed
      // the explicit local preview document, never its initial empty frame.
      if (window.location.origin === allowedOrigin)
        localStorage.setItem('free_bbs_auth_token', token);
    },
    { token: TOKEN, allowedOrigin: origin },
  );
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.offOriginRequests.push({ url: url.href, method: route.request().method() });
    return route.abort('blockedbyclient');
  });
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || ['GET', 'HEAD'].includes(request.method())) return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    report.requests.push({
      method: request.method(),
      path: url.pathname,
      ...(url.pathname === '/api/ai/knowledge/chat'
        ? { question: body?.question, learningPolicyContext: body?.context?.learningPolicyContext }
        : {}),
    });
  });
  const lab = await newPage();
  for (const purpose of Object.keys(policy.PURPOSES))
    for (const level of Object.keys(policy.LEVELS))
      await record(`real lab → reader → explicit simulated Max: ${purpose}:${level}`, async () => {
        await lab.goto(
          `${origin}/learning-policy-lab?course=signals&point=SS-02-01&purpose=${purpose}&level=${level}`,
          { waitUntil: 'domcontentloaded' },
        );
        await lab.waitForFunction(() => !document.querySelector('#policy-apply')?.disabled);
        const beforeApply = chatRequests().length;
        await lab.locator('#policy-apply').click();
        const firstStep = lab.locator('.policy-step:visible').first();
        await firstStep.getByRole('button', { name: '准备问 Max', exact: true }).click();
        const realLink = lab.locator('#max-open-reader');
        const href = await realLink.getAttribute('href');
        const url = new URL(href, origin);
        const moduleId = url.searchParams.get('module');
        assert.equal(url.origin, origin);
        assert.equal(url.searchParams.get('policy'), policy.POLICY_VERSION);
        const popup = lab.waitForEvent('popup');
        await realLink.click();
        const reader = await popup;
        await lab.keyboard.press('Escape');
        reader.on('pageerror', (error) =>
          report.pageErrors.push({ url: reader.url(), error: error.message }),
        );
        await ready(reader);
        await openMax(reader);
        const sourceRow = reader.locator('#knowledge-learning-policy-context');
        await sourceRow.waitFor({ state: 'visible' });
        const label = await sourceRow.innerText();
        assert.ok(label.includes(policy.PURPOSES[purpose]));
        assert.ok(label.includes(policy.LEVELS[level]));
        const returnHref = await sourceRow
          .getByRole('link', { name: '返回学习链' })
          .getAttribute('href');
        const returnUrl = new URL(returnHref, origin);
        for (const [key, value] of Object.entries({
          purpose,
          level,
          point: 'SS-02-01',
          course: 'signals',
        }))
          assert.equal(returnUrl.searchParams.get(key), value);
        assert.equal(await reader.locator('#knowledge-chat-input').inputValue(), '');
        assert.equal(chatRequests().length, beforeApply, 'Opening/appplying never sends');
        await sourceRow.getByRole('button', { name: '准备这一步的问题' }).click();
        assert.equal(
          await reader.locator('#knowledge-chat-input').inputValue(),
          policy.MODULES[moduleId].question,
        );
        await reader
          .locator('#knowledge-chat-input')
          .fill(`保留本人未发送的草稿 ${purpose} ${level}`);
        await sourceRow.getByRole('button', { name: '准备这一步的问题' }).click();
        assert.equal(
          await reader.locator('#knowledge-chat-input').inputValue(),
          `保留本人未发送的草稿 ${purpose} ${level}`,
        );
        assert.equal(chatRequests().length, beforeApply, 'Draft preparation never sends');
        const exchange = await send(reader, `本地链路检查：${purpose} ${level} ${moduleId}`);
        assert.deepEqual(exchange.request.learningPolicyContext, {
          policyVersion: policy.POLICY_VERSION,
          purpose,
          level,
          module: moduleId,
        });
        assert.match(exchange.response, /本地策略模拟/);
        assert.ok(exchange.response.includes(policy.PURPOSES[purpose]));
        assert.ok(exchange.response.includes(policy.LEVELS[level]));
        assert.doesNotMatch(exchange.response, /尚未提供确认后的起点/);
        await reader.screenshot({ path: path.join(output, `${purpose}-${level}-desktop.png`) });
        await reader.close();
        return {
          purpose,
          level,
          moduleId,
          href,
          returnHref,
          requestContext: exchange.request.learningPolicyContext,
        };
      });

  await record(
    'exploration material link still opens the actual course relation view',
    async () => {
      await lab.goto(
        `${origin}/learning-policy-lab?course=signals&point=SS-02-01&purpose=explore&level=basic`,
      );
      await lab.waitForFunction(() => !document.querySelector('#policy-apply')?.disabled);
      await lab.locator('#policy-apply').click();
      const material = lab.locator('[data-module="explore"] a').first();
      const href = await material.getAttribute('href');
      assert.equal(new URL(href, origin).searchParams.get('focus'), 'relations');
      const before = chatRequests().length;
      const popup = lab.waitForEvent('popup');
      await material.click();
      const page = await popup;
      await page.waitForURL(/\/course\?/);
      await page.locator('.course-structure-toolbar').waitFor({ state: 'visible' });
      const destination = new URL(page.url());
      assert.equal(destination.searchParams.get('course'), 'signals');
      assert.equal(destination.searchParams.get('focus'), 'SS-02-01');
      assert.equal(chatRequests().length, before);
      await page.screenshot({ path: path.join(output, 'real-relations-material.png') });
      await page.close();
      return {
        href,
        destination: destination.href,
        note: 'Material path is not the separate explicit Max path',
      };
    },
  );

  await record('old and ambiguous/illegal URL modes do not leak experiment context', async () => {
    const cases = [
      '',
      '&policy=purpose-level-v1&purpose=review&level=wrong&module=retrieve',
      '&policy=purpose-level-v1&purpose=review&purpose=learn&level=familiar&module=retrieve',
      '&policy=old-version&purpose=review&level=familiar&module=retrieve',
      '&policy=purpose-level-v1&purpose=review&level=familiar&module=not-a-module',
    ];
    for (const query of cases) {
      const page = await newPage();
      await page.goto(`${origin}/knowledge?course=signals&point=SS-02-01&view=reading${query}`);
      await ready(page);
      await openMax(page);
      assert.equal(await page.locator('#knowledge-learning-policy-context').count(), 0);
      const result = await send(page, '仅本地验证旧入口，不启用新实验策略');
      assert.equal(result.request.learningPolicyContext, undefined);
      assert.doesNotMatch(result.response, /本地策略模拟/);
      await page.close();
    }
    return { cases: cases.length };
  });

  await record(
    '390 px reader keeps source controls visible and does not overflow horizontally',
    async () => {
      const page = await newPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `${origin}/knowledge?course=signals&point=SS-02-01&view=reading&policy=${policy.POLICY_VERSION}&purpose=review&level=familiar&module=retrieve`,
      );
      await ready(page);
      await openMax(page);
      const row = page.locator('#knowledge-learning-policy-context');
      await row.waitFor({ state: 'visible' });
      const button = row.getByRole('button', { name: '准备这一步的问题' });
      const returnLink = row.getByRole('link', { name: '返回学习链' });
      await button.scrollIntoViewIfNeeded();
      assert.ok(await button.isVisible());
      assert.ok(await returnLink.isVisible());
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        false,
      );
      const before = chatRequests().length;
      await button.click();
      assert.equal(chatRequests().length, before);
      assert.equal(
        await page.locator('#knowledge-chat-input').inputValue(),
        policy.MODULES.retrieve.question,
      );
      await page.screenshot({ path: path.join(output, 'mobile-390-source.png') });
      const href = await returnLink.getAttribute('href');
      page.once('dialog', (dialog) => dialog.accept());
      await returnLink.click();
      await page.waitForURL(/learning-policy-lab/);
      await page.waitForFunction(() => !document.querySelector('#policy-apply')?.disabled);
      assert.equal(await page.locator('#policy-level').inputValue(), 'familiar');
      assert.equal(await page.locator('input[name="purpose"]:checked').inputValue(), 'review');
      await page.close();
      return { returnHref: href, width: 390 };
    },
  );

  await record(
    'actual other-tab logout clears source and draft without automatic chat',
    async () => {
      const page = await newPage();
      await page.goto(
        `${origin}/knowledge?course=signals&point=SS-02-01&view=reading&policy=${policy.POLICY_VERSION}&purpose=review&level=advanced&module=retrieve`,
      );
      await ready(page);
      await openMax(page);
      await page.locator('#knowledge-chat-input').fill('账号切换前不可转交的本人草稿');
      const before = chatRequests().length;
      const other = await newPage();
      await other.goto(`${origin}/learning-policy-lab?course=signals&point=SS-02-01`);
      await other.evaluate(() => localStorage.removeItem('free_bbs_auth_token'));
      await page.waitForFunction(
        () => !document.getElementById('knowledge-learning-policy-context'),
      );
      await page.waitForFunction(() => !document.getElementById('knowledge-chat-input')?.value);
      await wait(250);
      assert.equal(chatRequests().length, before);
      await page.screenshot({ path: path.join(output, 'source-cleared-after-logout.png') });
      await other.close();
      await page.close();
      return {
        transition: 'Real browser storage event from another same-origin tab, no synthetic event',
      };
    },
  );
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.offOriginRequests, []);
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
      report.failures.push('Frozen source changed during QA');
      process.exitCode = 1;
    }
    report.completedAt = new Date().toISOString();
    report.requestCounts = {
      chat: chatRequests().length,
      otherLocalMutations: report.requests.filter((item) => item.path !== '/api/ai/knowledge/chat')
        .length,
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
