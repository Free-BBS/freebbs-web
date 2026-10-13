// Native production login form and learning UI; synthetic local credentials only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const {
  createLearningPreview,
  createLearningFixture,
  users,
} = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const ROOT = path.resolve(__dirname, '..');
const INPUT = '#knowledge-chat-input';
const SEND = '#knowledge-chat-form button[type="submit"]';
const ROUTE = '/knowledge?course=signals&point=SS-01-01&view=reading';

function createIdentityPreview() {
  const fixture = createLearningFixture();
  const preview = createLearningPreview({
    mapNodes: fixture.nodes,
    mapEdges: fixture.edges,
    contextRows: fixture.contextRows,
  });
  const handlers = preview.server.listeners('request');
  assert.equal(handlers.length, 1);
  preview.server.removeAllListeners('request');
  const loginRequests = [];
  preview.server.on('request', async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    const send = (status, body, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      if (url.pathname === '/__learning-bootstrap.js') {
        // Unlike the ordinary preview as= bootstrap, preserve the real auth.js token.
        send(200, "window.FREEBBS_API_BASE='/api';", 'text/javascript; charset=utf-8');
        return;
      }
      if (url.pathname === '/__identity-seed') {
        send(
          200,
          `<!doctype html><html><head><meta charset="UTF-8"></head><body>
            <p>Isolated fixture only. Not production login.</p>
            <button id="seed-student">Seed cached local credential</button>
            <a id="reader" href="${ROUTE}">Open actual reader</a>
            <script>document.getElementById('seed-student').onclick=()=>localStorage.setItem('free_bbs_auth_token','learning-preview-student');</script>
          </body></html>`,
        );
        return;
      }
      if (url.pathname === '/login' && req.method === 'GET') {
        const html = fs
          .readFileSync(path.join(ROOT, 'public/login.html'), 'utf8')
          .replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, '');
        send(200, html);
        return;
      }
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          assert.ok(body.length <= 16384, 'Only a tiny local login fixture body is allowed');
        }
        const payload = JSON.parse(body);
        const identity = payload.identifier === 'qa-student' ? 'student' : 'other';
        assert.ok(['qa-student', 'qa-other'].includes(payload.identifier));
        assert.equal(payload.password, 'only-local-qa');
        loginRequests.push({ identity, productionForm: true });
        send(
          200,
          JSON.stringify({ user: users[identity], token: `learning-preview-${identity}` }),
          'application/json; charset=utf-8',
        );
        return;
      }
      if (['/', '/discussion'].includes(url.pathname) && req.method === 'GET') {
        res.writeHead(302, { Location: ROUTE });
        res.end();
        return;
      }
      handlers[0](req, res);
    } catch (error) {
      send(500, JSON.stringify({ message: error.message }), 'application/json; charset=utf-8');
    }
  });
  return { ...preview, loginRequests };
}

async function loaded(page, uid) {
  await page.evaluate(async () => {
    await window.freeBbsApp.sessionReady;
  });
  await page.waitForFunction(
    (expected) =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion &&
      window.freeBbsApp.userState.uid === expected,
    { timeout: 8000 },
    uid,
  );
}

async function question(page, text) {
  const open = await page.$eval(
    '#knowledge-chat-panel',
    (panel) => !panel.hidden && !panel.classList.contains('hidden'),
  );
  if (!open) await page.locator('#knowledge-chat-toggle').click();
  const max = '[data-knowledge-chat-tab="max"]';
  if ((await page.$eval(max, (tab) => tab.getAttribute('aria-selected'))) !== 'true')
    await page.locator(max).click();
  await page.locator(INPUT).click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

async function login(page, base, identity) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.locator('#auth-identifier').click();
  await page.keyboard.type(`qa-${identity}`);
  await page.locator('#auth-password').click();
  await page.keyboard.type('only-local-qa');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.locator('#auth-submit').click(),
  ]);
  // Mobile auth.js legitimately opens /discussion; this fixture routes that landing
  // to the reader, without modifying the production login script or its choice.
  if (!page.url().includes('/knowledge'))
    await page.goto(`${base}${ROUTE}`, { waitUntil: 'networkidle0' });
  await loaded(page, users[identity].uid);
}

async function run(browser, output, spec) {
  const preview = createIdentityPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const result = {
    name: spec.name,
    viewport: { width: spec.width, height: spec.height },
    checks: [],
    errors: [],
    blocked: [],
    dialogs: [],
    requestFailures: [],
    authPaused: 0,
    authReleased: 0,
    realAIRequests: 0,
  };
  const check = (name, pass, details = {}) =>
    result.checks.push({ name, pass: Boolean(pass), ...details });
  const heldAuth = [];
  let releaseAuth = false;
  let heldAI;
  const guard = async (target, intercept = false) => {
    target.setDefaultTimeout(8000);
    target.setDefaultNavigationTimeout(8000);
    await target.setViewport(result.viewport);
    await target.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    target.on('pageerror', (error) => result.errors.push(error.message));
    target.on('dialog', async (dialog) => {
      result.dialogs.push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else await dialog.dismiss();
    });
    target.on('requestfailed', (request) =>
      result.requestFailures.push({
        path: new URL(request.url()).pathname,
        message: request.failure()?.errorText,
      }),
    );
    await target.setRequestInterception(true);
    target.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        result.blocked.push(request.url());
        request.abort();
        return;
      }
      if (
        intercept &&
        spec.type.startsWith('auth-') &&
        !releaseAuth &&
        url.pathname === '/api/auth/me'
      ) {
        heldAuth.push(request);
        result.authPaused += 1;
        return;
      }
      if (intercept && spec.type === 'ai-switch' && url.pathname === '/api/ai/knowledge/chat') {
        heldAI = request;
        return;
      }
      request.continue();
    });
  };
  try {
    await guard(page, true);
    if (spec.type.startsWith('auth-')) {
      await page.goto(`${base}/__identity-seed`, { waitUntil: 'networkidle0' });
      await page.locator('#seed-student').click();
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.locator('#reader').click(),
      ]);
      await page.waitForSelector(INPUT);
    } else if (spec.type === 'ai-switch') await login(page, base, 'student');
    else {
      await page.goto(`${base}${ROUTE}`, { waitUntil: 'networkidle0' });
      await loaded(page, '');
      check(
        'Anonymous reader has neither a confirmed UID nor a saved token',
        await page.evaluate(
          () => !window.freeBbsApp.userState.uid && !localStorage.getItem('free_bbs_auth_token'),
        ),
      );
    }
    const original = `本地 ${spec.name}：旧页面未发送的问题。`;
    await question(page, original);
    check(
      'A real native question was entered before the identity transition',
      await page.$eval(INPUT, (input, expected) => input.value === expected, original),
    );
    if (spec.type === 'anonymous-route') {
      const before = result.dialogs.length;
      // The immersive reader hides the global account chrome. Use its real course
      // discussion login link, not a hidden #user-name or an injected DOM control.
      await page.locator('[data-knowledge-chat-tab="discussion"]').click();
      await page.locator('#knowledge-discussion-compose-toggle').click();
      await page.locator('#knowledge-discussion-compose-login').click();
      await page.waitForSelector('#auth-identifier', { visible: true });
      check(
        'Leaving an unscoped anonymous question presents a real browser leave warning',
        result.dialogs.slice(before).some((dialog) => dialog.type === 'beforeunload'),
      );
      await page.locator('#auth-identifier').click();
      await page.keyboard.type('qa-student');
      await page.locator('#auth-password').click();
      await page.keyboard.type('only-local-qa');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.locator('#auth-submit').click(),
      ]);
      if (!page.url().includes('/knowledge'))
        await page.goto(`${base}${ROUTE}`, { waitUntil: 'networkidle0' });
      await loaded(page, users.student.uid);
    } else {
      if (spec.type === 'ai-switch') {
        await page.locator(SEND).click();
        await page.waitForFunction(
          () => document.querySelector('#knowledge-chat-form button[type="submit"]').disabled,
        );
        assert.ok(heldAI, 'A real native old-owner send is held');
        await question(page, `${original} 发送期间又写下的后稿。`);
      }
      const other = await context.newPage();
      await guard(other);
      await login(other, base, spec.type === 'anonymous-tab' ? 'student' : 'other');
      await page.waitForFunction(() =>
        document
          .getElementById('knowledge-chat-status')
          .textContent.includes('账号已在其他页面变更'),
      );
      check(
        'Real cross-tab localStorage change clears the old private question',
        await page.$eval(INPUT, (input) => input.value === ''),
      );
      check(
        'The stale page blocks sending until refreshed instead of silently switching identity',
        await page.$eval(SEND, (send) => send.disabled),
      );
      if (spec.type.startsWith('auth-')) {
        check(
          'Both initial auth callers really remain paused, without replacing one handle',
          heldAuth.length >= 2 && (await page.evaluate(() => !window.freeBbsApp.userState.uid)),
        );
        releaseAuth = true;
        result.authReleased = heldAuth.length;
        await Promise.all(
          heldAuth.splice(0).map((request) =>
            spec.type === 'auth-401-switch'
              ? request.respond({
                  status: 401,
                  contentType: 'application/json',
                  body: JSON.stringify({ message: 'Explicit old-session local 401 fixture' }),
                })
              : request.continue(),
          ),
        );
        await page.evaluate(async () => {
          await window.freeBbsApp.sessionReady;
        });
        check(
          'The old auth receipt does not apply its UID or delete the new stored credential',
          await page.evaluate(
            () =>
              !window.freeBbsApp.userState.uid &&
              localStorage.getItem('free_bbs_auth_token') === 'learning-preview-other',
          ),
        );
      } else if (spec.type === 'ai-switch') {
        await heldAI.continue();
        heldAI = null;
        await page.waitForNetworkIdle({ idleTime: 250, timeout: 8000 });
        check(
          'The old owner delayed answer never reappears in the new private conversation',
          (await page.$eval(
            '#knowledge-chat-thread',
            (thread) => !thread.textContent.includes('本地模拟回答'),
          )) &&
            (await page.evaluate(
              () =>
                window.freeBbsKnowledge.buildRequest('local read-only probe').history.length === 0,
            )),
        );
        check(
          'The old send completion never re-enables the blocked stale page',
          await page.$eval(SEND, (send) => send.disabled),
        );
      }
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page, spec.type === 'anonymous-tab' ? users.student.uid : users.other.uid);
      await other.close();
    }
    check(
      'Only the new confirmed account can continue, with no inherited private question',
      (await page.$eval(INPUT, (input) => !input.value)) &&
        (await page.evaluate(() => window.freeBbsApp.userState.isLoggedIn)),
    );
    check(
      'Exactly one public welcome mount survives the transition',
      (await page.$$('#knowledge-chat-welcome')).length === 1,
    );
    const current = `新身份 ${spec.name}：只属于本人当前点的草稿。`;
    await question(page, current);
    await page.reload({ waitUntil: 'networkidle0' });
    await loaded(page, spec.type.startsWith('anonymous') ? users.student.uid : users.other.uid);
    check(
      'Positive control: the new owner typed draft restores in the same session',
      await page.$eval(INPUT, (input, expected) => input.value === expected, current),
    );
    check(
      'Restoration and identity changes never auto-send an AI question',
      preview.requests.length === (spec.type === 'ai-switch' ? 1 : 0),
    );
    check(
      'No auth request is stranded or aborted by this fixture',
      !result.requestFailures.some((request) => request.path === '/api/auth/me'),
    );
    result.loginRequests = preview.loginRequests;
    result.simulatedAIRequests = preview.requests.length;
    result.screenshot = path.join(output, `${spec.name}.png`);
    await page.screenshot({ path: result.screenshot });
  } catch (error) {
    result.error = error.stack || error.message;
    result.snapshot = await page
      .evaluate(() => ({
        uid: window.freeBbsApp?.userState?.uid,
        input: document.getElementById('knowledge-chat-input')?.value,
        status: document.getElementById('knowledge-chat-status')?.textContent,
        url: window.location.href,
      }))
      .catch(() => null);
  } finally {
    await Promise.all(heldAuth.map((request) => request.abort().catch(() => {})));
    if (heldAI) await heldAI.abort().catch(() => {});
    await context.close();
    preview.server.closeAllConnections?.();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    result.passed =
      !result.error &&
      result.checks.every((item) => item.pass) &&
      !result.errors.length &&
      !result.blocked.length;
  }
  return result;
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-identity-transitions-'));
  const report = {
    boundary:
      'Fresh isolated loopback preview per scenario; unchanged production auth.js login form, app.js and knowledge.js, native clicks/typing/reloads and real cross-tab storage events. Backend login uses only synthetic fixture credentials; no real account, external model, formal evidence, physical touch, screen reader or student study claim.',
    scenarios: [],
  };
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const requested = process.env.LEARNING_IDENTITY_SCENARIOS?.split(',').filter(Boolean);
  let expectedScenarios = 0;
  try {
    for (const width of [1440, 390]) {
      for (const type of [
        'anonymous-route',
        'anonymous-tab',
        'auth-success-switch',
        'auth-401-switch',
        'ai-switch',
      ]) {
        const name = `${width === 1440 ? 'desktop' : 'narrow'}-${type}`;
        if (requested && !requested.includes(name)) continue;
        expectedScenarios += 1;
        const scenario = await run(browser, output, {
          name,
          type,
          width,
          height: width === 1440 ? 960 : 844,
        });
        report.scenarios.push(scenario);
        console.log(
          JSON.stringify({
            scenario: name,
            passed: scenario.passed,
            checks: scenario.checks.length,
          }),
        );
      }
    }
  } finally {
    await browser.close();
  }
  assert.ok(expectedScenarios && (!requested || requested.length === expectedScenarios));
  report.expectedScenarios = expectedScenarios;
  report.passed =
    report.scenarios.length === expectedScenarios &&
    report.scenarios.every((scenario) => scenario.passed);
  const filename = path.join(output, 'identity-transitions-report.json');
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        filename,
        passed: report.passed,
        scenarios: report.scenarios.map((scenario) => ({
          name: scenario.name,
          checks: scenario.checks.length,
          passed: scenario.passed,
          failed: scenario.checks.filter((check) => !check.pass),
          error: scenario.error,
          snapshot: scenario.snapshot,
          errors: scenario.errors,
          blocked: scenario.blocked,
        })),
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
