// Local-only Max draft recovery/privacy probe. No production login, publishing or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const { createLearningPreview, createLearningFixture } = require('./preview-learning-workspace');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const INPUT = '#knowledge-chat-input';
const PANEL = '#knowledge-chat-panel';
const POINT = 'SS-01-01';

async function opened(page) {
  return page.$eval(PANEL, (panel) => !panel.hidden && !panel.classList.contains('hidden'));
}

async function typeQuestion(page, question) {
  if (!(await opened(page))) await page.locator('#knowledge-chat-toggle').click();
  await page.locator(INPUT).click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (question) await page.keyboard.type(question);
}

async function scope(page) {
  return page.evaluate(() => {
    const context = window.freeBbsKnowledge.getLearningContext();
    return {
      uid: window.freeBbsApp.userState.uid,
      course: context.course.slug,
      point: context.node.id,
      version: context.node.documentVersion,
      originVersion: context.node.originDocumentVersion,
    };
  });
}

async function loaded(page) {
  await page.evaluate(async () => {
    await window.freeBbsApp.sessionReady;
  });
  await page.waitForFunction(
    () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
  );
}

async function run(browser, output, spec) {
  const fixture = createLearningFixture();
  const preview = createLearningPreview({
    mapNodes: fixture.nodes,
    mapEdges: fixture.edges,
    contextRows: fixture.contextRows,
  });
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const result = {
    name: spec.name,
    viewport: { width: spec.width, height: spec.height },
    checks: [],
    fixtures: [],
    dialogs: [],
    blocked: [],
    errors: [],
    consoleErrors: [],
    requestFailures: [],
    writes: [],
    screenshots: [],
  };
  const check = (name, pass, details = {}) =>
    result.checks.push({ name, pass: Boolean(pass), ...details });
  let pausedRequest;
  const pausedAuthRequests = [];
  let authReleased = false;
  let authPausedAt;
  try {
    await page.setViewport(result.viewport);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (spec.storageDenied) {
      result.fixtures.push(
        'Only tab sessionStorage methods throw an explicit QuotaExceededError fixture; not a real browser quota measurement.',
      );
      await page.evaluateOnNewDocument(() => {
        const target = window.sessionStorage;
        window.qaMaxDraftDeniedStorageCalls = 0;
        for (const name of ['getItem', 'setItem', 'removeItem', 'key']) {
          const original = Storage.prototype[name];
          Storage.prototype[name] = function deniedSessionMethod(...args) {
            if (this === target) {
              window.qaMaxDraftDeniedStorageCalls += 1;
              throw new DOMException(
                'Explicit local QA sessionStorage denial',
                'QuotaExceededError',
              );
            }
            return original.apply(this, args);
          };
        }
      });
    }
    page.on('pageerror', (error) => result.errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warn')
        result.consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) =>
      result.requestFailures.push({
        path: new URL(request.url()).pathname,
        message: request.failure()?.errorText,
      }),
    );
    page.on('response', (response) => {
      if (spec.delayedAuth && new URL(response.url()).pathname === '/api/auth/me')
        response
          .json()
          .then((payload) => {
            result.authResponses ||= [];
            result.authResponses.push({ status: response.status(), uid: payload.user?.uid || '' });
          })
          .catch(() => {});
    });
    page.on('dialog', async (dialog) => {
      result.dialogs.push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        result.blocked.push(request.url());
        request.abort();
        return;
      }
      if (url.pathname.startsWith('/api/') && request.method() !== 'GET')
        result.writes.push({ method: request.method(), path: url.pathname });
      if (spec.delayedAuth && url.pathname === '/api/auth/me') {
        if (authReleased) {
          request.continue();
          return;
        }
        // app.restoreSession and notifications.syncSession both call auth/me. Hold
        // every request; replacing one handle would strand the real app request.
        pausedAuthRequests.push(request);
        authPausedAt ||= Date.now();
        result.authRequestMethod = request.method();
        return;
      }
      if (
        spec.pending &&
        url.pathname === '/api/ai/knowledge/chat' &&
        request.method() === 'POST'
      ) {
        pausedRequest = request;
        result.submittedQuestion = JSON.parse(request.postData()).question;
        return;
      }
      request.continue();
    });
    await page.goto(`${base}/knowledge?course=signals&point=${POINT}&as=student&view=reading`, {
      waitUntil: spec.delayedAuth ? 'domcontentloaded' : 'networkidle0',
    });
    if (spec.delayedAuth) {
      await page.waitForSelector(INPUT);
    } else await loaded(page);
    const initiallyOpen = await opened(page);
    const initialGeometry = await page.$eval(PANEL, (panel) => ({
      panelPosition: getComputedStyle(panel).position,
      containerPosition: getComputedStyle(panel.parentElement).position,
      viewportWidth: window.innerWidth,
    }));
    check(
      'A fresh drawer breakpoint begins with unobstructed reading; desktop keeps its companion',
      initiallyOpen === spec.width > 920,
      { initiallyOpen, initialGeometry },
    );
    const originalScope = spec.delayedAuth ? null : await scope(page);
    const original = spec.delayedAuth
      ? '身份确认时的草稿。'
      : `本地${spec.name}：这段未发送的问题属于当前本人、课程和知识点。`;
    if (spec.delayedAuth) {
      // The static Max input is already usable while initialize awaits sessionReady.
      // Do not wait for a node or networkidle, which would release this exact race.
      if (!(await opened(page))) await page.locator('#knowledge-chat-toggle').click();
      await page.waitForSelector(INPUT, { visible: true });
      const point = await page.$eval(INPUT, (input) => {
        const rect = input.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type(original);
    } else await typeQuestion(page, original);
    if (spec.account || spec.version) {
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      await page
        .waitForFunction(
          (question) => document.getElementById('knowledge-chat-input').value === question,
          { timeout: 8000 },
          original,
        )
        .catch(() => {});
      check(
        'Control: own same-version question really restores before the negative scope change',
        (await page.$eval(INPUT, (input) => input.value)) === original,
      );
      await typeQuestion(page, original);
    }
    if (spec.delayedAuth) {
      result.fixtures.push(
        'Only local auth/me GET is briefly held. Native typing precedes the initial same-token UID confirmation; no production identity, retry or account switching claim.',
      );
      const uidBefore = await page.evaluate(() => window.freeBbsApp.userState.uid);
      check(
        'The question really precedes initial identity confirmation',
        !uidBefore && pausedAuthRequests.length > 0,
      );
      result.authTypedQuestion = await page.$eval(INPUT, (input) => input.value);
      result.authPauseBeforeReleaseMs = Date.now() - authPausedAt;
      check(
        'The auth fixture is released before the real 8000 ms restoration timeout',
        result.authPauseBeforeReleaseMs < 8000,
        { authPauseBeforeReleaseMs: result.authPauseBeforeReleaseMs },
      );
      assert.ok(pausedAuthRequests.length, 'Local initial auth requests are paused');
      result.authPausedRequestCount = pausedAuthRequests.length;
      authReleased = true;
      await Promise.all(pausedAuthRequests.splice(0).map((request) => request.continue()));
      await page.waitForFunction(() => window.freeBbsApp?.userState?.uid === 'u_learning01', {
        timeout: 8000,
      });
      await loaded(page);
      check(
        'Initial same-token identity confirmation does not discard the hand-written question',
        (await page.$eval(INPUT, (input) => input.value)) === original,
      );
      check(
        'The public welcome mount survives initial identity confirmation and node loading',
        (await page.$$('#knowledge-chat-welcome')).length === 1,
      );
      result.authConfirmedScope = await scope(page);
      check(
        'The actual app identity is confirmed, not just a parallel notification lookup',
        result.authConfirmedScope.uid === 'u_learning01' &&
          (await page.evaluate(() => window.freeBbsApp.userState.isLoggedIn)),
      );
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      check(
        'The natively typed provisional question becomes an own scoped draft and survives reload',
        (await page.$eval(INPUT, (input) => input.value)) === original,
      );
      check(
        'No auth request is stranded or aborted by the delayed-auth fixture',
        !result.requestFailures.some((request) => request.path === '/api/auth/me'),
        { authPausedRequestCount: result.authPausedRequestCount },
      );
    } else if (spec.storageDenied) {
      const deniedCalls = await page.evaluate(() => window.qaMaxDraftDeniedStorageCalls);
      check('Storage-denied fixture was actually encountered', deniedCalls > 0, { deniedCalls });
      await page.locator('#knowledge-chat-close').click();
      await page.locator('#knowledge-chat-toggle').click();
      check(
        'Storage failure retains editable in-page question without an AI call',
        (await page.$eval(INPUT, (input) => input.value)) === original &&
          preview.requests.length === 0,
      );
      check(
        'Storage failure clearly says the question is only in this page',
        await page.$eval(
          '#knowledge-chat-draft-status',
          (notice) => !notice.hidden && notice.textContent.includes('暂存在本页'),
        ),
      );
      const before = result.dialogs.length;
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      const after = await page.$eval(INPUT, (input) => input.value);
      const warning = result.dialogs.slice(before).some((dialog) => dialog.type === 'beforeunload');
      check('Storage failure protects departure with an explicit browser leave warning', warning, {
        after,
        warning,
        warningAcceptedByProbe: warning,
        restored: after === original,
      });
    } else if (spec.recoverClosed) {
      await page.locator('#knowledge-chat-close').click();
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      await page
        .waitForFunction(
          (question) => document.getElementById('knowledge-chat-input').value === question,
          { timeout: 8000 },
          original,
        )
        .catch(() => {});
      check(
        'A closed companion still restores its own unsubmitted question',
        (await page.$eval(INPUT, (input) => input.value)) === original,
      );
      check('Restoration never overrides an explicit closed companion', !(await opened(page)));
    } else if (spec.account) {
      result.fixtures.push(
        'Account changes use the preview-only as=student/other bootstrap and its actual HTTP identity, not a production login claim.',
      );
      await page.locator('#knowledge-chat-close').click();
      await page.locator('[data-learning-preview] summary').click();
      await page.locator('[data-learning-preview] a[href*="as=other"]').click();
      await page.waitForFunction(() => window.freeBbsApp?.userState?.uid === 'u_learning02');
      await loaded(page);
      const otherScope = await scope(page);
      const other = await page.$eval(INPUT, (input) => input.value);
      check(
        'Another preview account receives none of the original private question',
        otherScope.uid !== originalScope.uid && !other.includes(original),
        { originalScope, otherScope, other },
      );
      await typeQuestion(page, '另一位模拟同学自己的问题。');
      await page.locator('#knowledge-chat-close').click();
      await page.locator('[data-learning-preview] summary').click();
      await page.locator('[data-learning-preview] a[href*="as=student"]').click();
      await page.waitForFunction(() => window.freeBbsApp?.userState?.uid === 'u_learning01');
      await loaded(page);
      const returned = await page.$eval(INPUT, (input) => input.value);
      check(
        'Switching back cannot insert the other account question',
        !returned.includes('另一位模拟同学自己的问题'),
        { returned, returnedScope: await scope(page) },
      );
    } else if (spec.version) {
      result.fixtures.push(
        'Only this process-owned public document node/context is changed; native reload receives a genuinely different document hash. Not a teacher publishing or real document migration claim.',
      );
      const node = fixture.nodes.find((item) => item.id === POINT);
      const row = fixture.contextRows.find((item) => item.node_id === POINT);
      if (spec.version === 'origin') {
        node.sections.applicationsMarkdown =
          '## 知识起源\n\n本地起源版本变化夹具：改变当前公开学习动机条件。\n';
        row.applications_markdown = node.sections.applicationsMarkdown;
      } else {
        node.markdown += '\n\n本地版本变化夹具：改变当前公开正文条件。\n';
        node.sections.knowledgeMarkdown = node.markdown;
        node.documentVersion = getAssessmentDocumentVersion(node.markdown);
        row.document_markdown = node.markdown;
        row.knowledge_markdown = node.markdown;
      }
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      const newer = await scope(page);
      const restored = await page.$eval(INPUT, (input) => input.value);
      check(
        'Public document version fixture changed the loaded hash',
        spec.version === 'origin'
          ? newer.originVersion !== originalScope.originVersion &&
              newer.version === originalScope.version
          : newer.version !== originalScope.version,
        { originalScope, newer },
      );
      check(
        'An old-version question is not silently inserted into the new document',
        restored !== original,
        { restored },
      );
    } else if (spec.pending) {
      result.fixtures.push(
        'One native explicit Send action is paused before the local memory-only simulated AI route. Success continues that local route; failure is an explicit HTTP503 fixture. No real model/provider/network.',
      );
      await page.locator('#knowledge-chat-form button[type="submit"]').click();
      await page.waitForFunction(
        () => document.querySelector('#knowledge-chat-form button[type="submit"]').disabled,
      );
      const deadline = Date.now() + 10000;
      while (!pausedRequest && Date.now() < deadline)
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      assert.ok(pausedRequest, 'Native Send created the paused local request');
      check(
        'Only the explicit original snapshot was submitted',
        result.submittedQuestion === original,
      );
      const editableDuringSend = await page.$eval(INPUT, (input) => !input.disabled);
      result.editableDuringSend = editableDuringSend;
      check(
        'Waiting permits native next-question writing while repeated Send remains disabled',
        editableDuringSend &&
          (await page.$eval(
            '#knowledge-chat-form button[type="submit"]',
            (button) => button.disabled,
          )),
      );
      let later = '';
      if (editableDuringSend && spec.editDuringSend !== false) {
        later = '我在等待时写下的下一问，不能被刚才的回执删除。';
        await typeQuestion(page, later);
      }
      if (spec.liveVersion) {
        result.fixtures.push(
          'Process-owned public node/context changes, a read-only HTTP GET fetches its updated node, then an explicit document-saved event fixture exercises the live controller. This is not a real teacher publishing action.',
        );
        const node = fixture.nodes.find((item) => item.id === POINT);
        const row = fixture.contextRows.find((item) => item.node_id === POINT);
        if (spec.liveVersion === 'origin') {
          node.sections.applicationsMarkdown =
            '## 知识起源\n\n本地 live 起源版本变化：核对新的学习动机条件。\n';
          row.applications_markdown = node.sections.applicationsMarkdown;
        } else {
          node.markdown += '\n\n本地 live 正文版本变化：核对新的公开条件。\n';
          node.sections.knowledgeMarkdown = node.markdown;
          node.documentVersion = getAssessmentDocumentVersion(node.markdown);
          row.document_markdown = node.markdown;
          row.knowledge_markdown = node.markdown;
        }
        await page.evaluate(async (pointId) => {
          const response = await fetch(`/api/courses/signals/map/nodes/${pointId}`, {
            headers: { Authorization: `Bearer ${window.freeBbsApp.userState.token}` },
          });
          const detail = await response.json();
          document
            .querySelector('[data-knowledge-page]')
            .dispatchEvent(
              new CustomEvent('knowledge:document-saved', { detail: { node: detail.node } }),
            );
        }, POINT);
        const currentScope = await scope(page);
        check(
          'Live public update really changes the relevant document hash',
          spec.liveVersion === 'origin'
            ? currentScope.originVersion !== originalScope.originVersion
            : currentScope.version !== originalScope.version,
          { originalScope, currentScope },
        );
        check(
          'A live update retains the visible question but asks the learner to check its quotation',
          (await page.$eval(INPUT, (input) => input.value)) === later &&
            (await page.$eval('#knowledge-chat-draft-status', (notice) =>
              notice.textContent.includes('核对问题中的引用'),
            )),
        );
        await typeQuestion(page, later);
      }
      if (spec.pending === 'failure')
        await pausedRequest.respond({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"本地明确模拟 AI 暂不可用"}',
        });
      else await pausedRequest.continue();
      pausedRequest = null;
      if (spec.liveVersion) await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 });
      await page.waitForFunction(
        () => !document.querySelector('#knowledge-chat-form button[type="submit"]').disabled,
      );
      const after = await page.$eval(INPUT, (input) => input.value);
      if (spec.liveVersion)
        check(
          'The pre-update late response is not appended or added to the current conversation history',
          (await page.$eval(
            '#knowledge-chat-thread',
            (thread) => !thread.textContent.includes('本地模拟回答'),
          )) &&
            (await page.evaluate(
              () => window.freeBbsKnowledge.buildRequest('history probe').history.length,
            )) === 0,
        );
      if (later)
        check('A later native question survives the preceding send receipt', after === later, {
          after,
          later,
        });
      else if (!editableDuringSend)
        check(
          'The busy-input constraint is explicit and input becomes usable again',
          await page.$eval(INPUT, (input) => !input.disabled),
          { after, limitation: 'Input was disabled; no native later-draft edit race is claimed.' },
        );
      if (spec.pending === 'failure')
        check(
          'Failed send retains a recoverable question unless a later draft takes priority',
          later ? after === later : after === original,
          { after, original, later },
        );
      else
        check(
          'Successful send does not leave the already-sent original as an unsent draft',
          after !== original,
          { after },
        );
      if (spec.pending === 'failure' && later)
        check(
          'The failed original remains visible while the new editable question takes priority',
          await page.$eval(
            '#knowledge-chat-thread',
            (thread, question) => thread.textContent.includes(question),
            original,
          ),
        );
      const beforeReload = after;
      await page.reload({ waitUntil: 'networkidle0' });
      await loaded(page);
      const afterReload = await page.$eval(INPUT, (input) => input.value);
      check('Send-result draft state remains correct after reload', afterReload === beforeReload, {
        beforeReload,
        afterReload,
      });
    }
    check(
      'Restoration, reload and scope changes never send a question automatically',
      preview.requests.length === (spec.pending === 'success' ? 1 : 0),
      { localSimulatedAIRequests: preview.requests.length },
    );
    const screenshot = path.join(output, `${spec.name}.png`);
    await page.screenshot({ path: screenshot });
    result.screenshots.push(screenshot);
  } catch (error) {
    result.error = error.stack || error.message;
    if (spec.delayedAuth)
      result.authFailureSnapshot = await page
        .evaluate(() => ({
          uid: window.freeBbsApp?.userState?.uid,
          tokenPresent: Boolean(window.freeBbsApp?.userState?.token),
          storedTokenMatches:
            localStorage.getItem('free_bbs_auth_token') === window.freeBbsApp?.userState?.token,
          input: document.getElementById('knowledge-chat-input')?.value,
          authNotice: document.getElementById('user-name')?.title,
          sessionReadyType: typeof window.freeBbsApp?.sessionReady?.then,
          url: window.location.href,
        }))
        .catch(() => null);
  } finally {
    if (pausedRequest) await pausedRequest.abort().catch(() => {});
    await Promise.all(pausedAuthRequests.map((request) => request.abort().catch(() => {})));
    result.simulatedAIRequests = preview.requests.length;
    result.realAIRequests = 0;
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
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-max-draft-boundaries-'));
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Fresh isolated preview/server/browser context per scenario. Native question input, click, reload and preview account links; explicit storage/version/paused-request fixtures named separately. Not real student, production account, formal grading, true IME, physical touch, screen reader or measured learning effect.',
    scenarios: [],
  };
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    headless: true,
  });
  try {
    const specs = [
      { name: 'desktop-storage-denied', width: 1440, height: 960, storageDenied: true },
      { name: 'narrow-storage-denied', width: 390, height: 844, storageDenied: true },
      { name: 'tablet-drawer-default', width: 910, height: 960, recoverClosed: true },
      { name: 'desktop-account-privacy', width: 1440, height: 960, account: true },
      { name: 'narrow-document-version', width: 390, height: 844, version: 'body' },
      { name: 'desktop-origin-version', width: 1440, height: 960, version: 'origin' },
      { name: 'desktop-paused-success', width: 1440, height: 960, pending: 'success' },
      { name: 'narrow-paused-failure', width: 390, height: 844, pending: 'failure' },
      {
        name: 'desktop-paused-success-unchanged',
        width: 1440,
        height: 960,
        pending: 'success',
        editDuringSend: false,
      },
      {
        name: 'narrow-paused-failure-unchanged',
        width: 390,
        height: 844,
        pending: 'failure',
        editDuringSend: false,
      },
      { name: 'desktop-delayed-auth', width: 1440, height: 960, delayedAuth: true },
      { name: 'narrow-delayed-auth', width: 390, height: 844, delayedAuth: true },
      {
        name: 'desktop-live-body-delayed-receipt',
        width: 1440,
        height: 960,
        pending: 'success',
        liveVersion: 'body',
      },
      {
        name: 'narrow-live-origin-delayed-receipt',
        width: 390,
        height: 844,
        pending: 'success',
        liveVersion: 'origin',
      },
    ];
    const requested = process.env.LEARNING_DRAFT_SCENARIOS?.split(',').filter(Boolean);
    const selected = requested ? specs.filter((spec) => requested.includes(spec.name)) : specs;
    assert.ok(selected.length && (!requested || selected.length === requested.length));
    report.expectedScenarios = selected.length;
    for (const spec of selected) report.scenarios.push(await run(browser, output, spec));
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  report.passed =
    report.scenarios.length === report.expectedScenarios &&
    report.scenarios.every((scenario) => scenario.passed);
  const filename = path.join(output, 'max-draft-boundaries-report.json');
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        filename,
        passed: report.passed,
        scenarios: report.scenarios.map((scenario) => ({
          name: scenario.name,
          passed: scenario.passed,
          checks: scenario.checks.length,
          failed: scenario.checks.filter((item) => !item.pass),
          error: scenario.error,
          simulatedAIRequests: scenario.simulatedAIRequests,
          errors: scenario.errors,
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
