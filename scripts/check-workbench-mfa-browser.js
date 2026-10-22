// Real Chrome + production controller, using only fictional loopback fixtures.
// This validates honest MFA recovery, NOT the school's protected MFA protocol.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createEditableCalendarPreview } = require('./preview-editable-calendar');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');
const policy = require('../public/privacy-policy.json');

const official = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login';
const learn = 'https://learn.tsinghua.edu.cn/f/login';
const help =
  'https://its.tsinghua.edu.cn/1wzcycejdh_content.jsp?urltype=news.NewsContentUrl&wbnewsid=4000&wbtreeid=1771';
const connector = {
  configuration: { state: 'direct_cas', authorizationAvailable: true },
  connection: { status: 'active_verified', lastSuccessfulSyncAt: '2026-09-29T00:00:00.000Z' },
  sync: { available: false, latestRun: null },
  safeguards: {
    acceptsPasswordFromBrowser: true,
    acceptsCookieFromBrowser: false,
    storesPassword: false,
    sessionCookiesEncryptedAtRest: true,
  },
};

async function main() {
  const preview = await createEditableCalendarPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.WORKBENCH_MFA_QA_DIR ||
    path.resolve(
      __dirname,
      '../output/workbench-mfa',
      new Date().toISOString().replace(/[:.]/g, '-'),
    );
  fs.mkdirSync(output, { recursive: true });
  const originalEvents = JSON.stringify(preview.workbench.events);
  const report = {
    checks: [],
    layouts: [],
    screenshots: [],
    pageErrors: [],
    offOrigin: [],
    posts: 0,
    statusGets: 0,
  };
  let browser;
  let page;
  let stage = 'start';
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      const response = await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
      assert.equal(response.ok, true, 'local guide progress fixture must initialize');
    }
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((timestamp) => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [timestamp]));
        }

        static now() {
          return timestamp;
        }
      };
    }, Date.parse('2026-09-29T02:00:00Z'));
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
      if (url.origin !== origin) {
        report.offOrigin.push(request.url());
        return route.abort();
      }
      const json = (body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/privacy-policy') return json(policy);
      if (url.pathname === '/api/privacy-policy/status')
        return json({
          version: policy.version,
          contentHash: policy.contentHash,
          accepted: true,
          requiresFullPolicy: false,
          acceptedAt: '2026-09-29T01:00:00Z',
        });
      if (
        request.method() === 'GET' &&
        url.pathname === '/api/workbench/connectors/tsinghua/status'
      ) {
        report.statusGets += 1;
        return json({ connector });
      }
      if (
        request.method() === 'POST' &&
        url.pathname === '/api/workbench/connectors/tsinghua/direct-login'
      ) {
        const body = request.postDataJSON();
        assert.equal(body.username, 'preview_mfa_only');
        assert.equal(body.password, 'LocalPreviewOnly42!');
        assert.equal(body.consent, true);
        assert.equal(body.fingerprint, '0123456789abcdef0123456789abcdef');
        report.posts += 1;
        return json(
          {
            message: 'Fictional verification challenge',
            code: 'cas_interactive_verification_required',
            stage: 'credential_submit',
            recovery: {
              action: 'official_verification',
              officialUrl: official,
              helpUrl: help,
              canResumeHere: false,
              retryable: false,
              browserSessionShared: false,
            },
          },
          409,
        );
      }
      return route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    stage = 'load real workbench';
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.freeBbsApp?.sessionReady);
    await page.waitForFunction(() => Boolean(window.freeBbsMaxGuide));
    await page.evaluate(() => {
      window.freeBbsMaxGuide.pause();
      // Do not collect even a real preview-browser fingerprint during this recovery test.
      window.TsinghuaCasFingerprint = { generate: async () => '0123456789abcdef0123456789abcdef' };
    });
    assert.equal(await page.locator('.privacy-restore-notice').count(), 0);
    const oldEvent = page.locator('.workbench-week-event[data-public-id="ws_hour_location"]');
    await oldEvent.waitFor({ state: 'attached' });
    const oldEventText = await oldEvent.innerText();
    const id = (suffix) => page.locator(`#workbench-campus-login-${suffix}`);
    const dialog = id('dialog');
    const recovery = id('recovery');

    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        stage = `MFA recovery ${theme}/${width}`;
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
        }, theme);
        const fold = page.locator('details.personal-fold').filter({
          has: page.locator('.workbench-campus-card'),
        });
        if ((await fold.count()) && !(await fold.evaluate((element) => element.open)))
          await fold.locator('summary').click();
        await page.locator('#workbench-campus-connect').click();
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await recovery.isVisible(), false, 'opening starts clean');
        await id('username').fill('preview_mfa_only');
        await id('password').fill('LocalPreviewOnly42!');
        await id('consent').check();
        const before = report.posts;
        await id('submit').click();
        await recovery.waitFor({ state: 'visible' });
        assert.equal(report.posts, before + 1);
        assert.equal(await id('password').inputValue(), '');
        assert.equal(await id('consent').isChecked(), false);
        assert.equal(await id('submit').isDisabled(), true);
        assert.equal(await id('cancel').isEnabled(), true);
        assert.equal(await id('close').isEnabled(), true);
        assert.match(await recovery.innerText(), /当前直连暂不能接续/);
        assert.match(await recovery.innerText(), /不代表本站会自动获得该登录状态/);
        assert.doesNotMatch(await id('status').innerText(), /cas_interactive|credential_submit/);
        assert.ok(await recovery.locator('details').count(), 'diagnosis is optional disclosure');
        assert.match(
          await recovery.locator('code').textContent(),
          /cas_interactive_verification_required/,
        );
        assert.match(await recovery.locator('code').textContent(), /credential_submit/);
        for (const url of [official, learn, help]) {
          const link = recovery.locator(`a[href="${url}"]`);
          assert.equal(await link.count(), 1, `fixed official link: ${url}`);
          assert.equal(await link.getAttribute('target'), '_blank');
          assert.match(await link.getAttribute('rel'), /noopener/);
        }
        await page.waitForTimeout(350);
        await id('form').evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        await page.waitForTimeout(350);
        assert.equal(report.posts, before + 1, 'MFA cannot auto-repeat or be resubmitted');
        assert.equal(await oldEvent.innerText(), oldEventText, 'cached schedule remains unchanged');
        assert.equal(JSON.stringify(preview.workbench.events), originalEvents);
        const layout = await dialog.evaluate((element) => ({
          internalOverflow: element.scrollWidth > element.clientWidth + 1,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          passwordFocused: document.activeElement?.id === 'workbench-campus-login-password',
        }));
        assert.equal(layout.internalOverflow, false, stage);
        assert.equal(layout.pageOverflow, false, stage);
        assert.equal(layout.passwordFocused, false, stage);
        await recovery.scrollIntoViewIfNeeded();
        const name = `recovery-${theme}-${width}.png`;
        await page.screenshot({ path: path.join(output, name) });
        const detail = `recovery-region-${theme}-${width}.png`;
        await recovery.screenshot({ path: path.join(output, detail) });
        report.screenshots.push(name, detail);
        report.layouts.push({ theme, width, ...layout });
        const gets = report.statusGets;
        await id('recheck').click();
        await page.waitForFunction(() =>
          document
            .querySelector('#workbench-campus-login-status')
            .textContent.includes('本站已有连接记录'),
        );
        assert.equal(report.statusGets, gets + 1, 'manual recheck reads only the local connection');
        assert.equal(report.posts, before + 1, 'manual recheck never resubmits credentials');
        assert.equal(await id('submit').isDisabled(), true);
        assert.equal(await recovery.isVisible(), true);
        await id('cancel').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await recovery.isVisible(), false);
        assert.equal(await id('status').innerText(), '');
        assert.equal(await id('password').inputValue(), '');
      }
    }
    report.checks.push(
      'Four layouts: actual 409 recovery, fixed official/help links, optional diagnosis, clear secrets, no retry, usable close',
      'Existing in-memory calendar and rendered event survive failed reconnection and dialog exit',
      'Manual return check only GETs the local connection; reports an existing grant without claiming a new shared school session',
    );
    stage = 'logout isolation';
    await page.locator('#workbench-campus-connect').click();
    await dialog.waitFor({ state: 'visible' });
    await id('password').fill('NewFictionalDraft');
    page.once('dialog', (prompt) => prompt.accept());
    await page.locator('#user-logout-button').evaluate((button) => button.click());
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await id('password').inputValue(), '');
    assert.equal(await recovery.isVisible(), false);
    report.checks.push(
      'Logout closes the credential dialog and clears any fictional password draft',
    );
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.offOrigin, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  } catch (error) {
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify({ stage, message: error.message, ...report }, null, 2),
    );
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    preview.server.closeAllConnections?.();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
