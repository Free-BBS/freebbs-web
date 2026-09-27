// Isolated layout + entry regression. No production account, AI or campus connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');
const { STEPS } = require('../public/max-guide-stations');

async function main() {
  const now = Date.parse('2026-09-28T00:00:00Z');
  const { server, workbench } = createOnboardingPreview({ now: () => now });
  workbench.events[0].description = '罗姆楼 5103\n带电脑与实验记录';
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-workbench-elegant-'));
  let browser;
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
    }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    const errors = [];
    const profiles = [];
    let authMode = 'ok';
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) return request.abort('blockedbyclient');
      if (url.pathname === '/api/auth/me') {
        await new Promise((resolve) => {
          setTimeout(resolve, 400);
        });
        if (authMode !== 'ok')
          return request.respond({
            status: authMode === 'guest' ? 401 : 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: '模拟登录校验不可用' }),
          });
      }
      if (url.pathname.endsWith('/public-profile')) profiles.push(url.pathname);
      return request.continue();
    });
    await page.evaluateOnNewDocument((timestamp) => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [timestamp]));
        }

        static now() {
          return timestamp;
        }
      };
    }, now);
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => Boolean(window.freeBbsMaxGuide));
    await page.evaluate(() => window.freeBbsMaxGuide.pause());
    for (const width of [1600, 1024, 901, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      await page.evaluate((desktop) => {
        const toggle = document.querySelector('#workbench-view-toggle');
        if (toggle.getAttribute('aria-pressed') === String(desktop)) toggle.click();
      }, width > 900);
      await page.waitForSelector(
        width > 900 ? '.workbench-week-grid' : '#workbench-schedule-list',
        { visible: true },
      );
      for (const theme of ['light', 'dark']) {
        for (const typeScale of ['standard', 'large']) {
          await page.evaluate(
            async (preferences) => {
              if (
                document.body.classList.contains('theme-light') !==
                (preferences.theme === 'light')
              )
                window.freeBbsApp.toggleThemeMode();
              window.freeBbsTypography.applyPreferences({
                fontPreset:
                  preferences.typeScale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                typeScale: preferences.typeScale,
              });
              await document.fonts.ready;
            },
            { theme, typeScale },
          );
          await new Promise((resolve) => {
            setTimeout(resolve, 180);
          });
          const label = `${width}-${theme}-${typeScale}`;
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            true,
            `${label}: overflow`,
          );
          assert.equal(await page.$eval('#workbench-plan-panel', (node) => node.hidden), false);
          if (width > 900) {
            assert.equal(
              await page.$eval(
                '.workbench-week-scroll',
                (node) => getComputedStyle(node).overflowY,
              ),
              'auto',
            );
            for (const href of await page.$$eval('.workbench-section-links a', (nodes) =>
              nodes.map((node) => node.hash),
            )) {
              assert.equal(
                await page.$eval(href, (node) => node.getBoundingClientRect().width > 0),
                true,
              );
            }
          }
          await page.click('#workbench-notifications-tab');
          assert.equal(
            await page.$eval('#workbench-notifications-panel', (node) => node.hidden),
            false,
          );
          await page.click('#workbench-plan-tab');
          await page.evaluate(() => window.scrollTo(0, 0));
          if (typeScale === 'standard' && [1600, 390].includes(width))
            await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
          console.log('layout', label);
        }
      }
    }
    for (const width of [1600, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.evaluate(
        (version) => window.freeBbsMaxGuide.start(version, 'workbench'),
        GUIDE_VERSION,
      );
      const workbenchSteps = STEPS.filter((step) => step.station === 'workbench');
      for (const [index, step] of workbenchSteps.entries()) {
        await page.waitForFunction(
          (title) =>
            document.querySelector('#max-tour-title')?.textContent === title &&
            !document.querySelector('.max-tour .guide-primary')?.disabled,
          {},
          step.title,
        );
        assert.equal(
          await page.$eval('.max-tour-card', (node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= window.innerWidth + 1 &&
              box.top >= 0 &&
              box.bottom <= window.innerHeight + 1
            );
          }),
          true,
          `guide ${width} ${step.id}`,
        );
        assert.equal(
          await page.$$eval(step.target, (nodes) =>
            nodes.some(
              (node) =>
                node.getBoundingClientRect().width > 0 && !node.closest('[hidden], .hidden'),
            ),
          ),
          true,
          `guide target ${step.id}`,
        );
        if (index < workbenchSteps.length - 1) await page.click('.max-tour .guide-primary');
      }
      await page.evaluate(() => window.freeBbsMaxGuide.pause());
      await page.click('#workbench-plan-tab');
      console.log('guide', width, 'four workbench steps');
    }
    // Restore desktop, then exercise actual forms, not just their existence.
    await page.setViewport({ width: 1600, height: 1000 });
    await page.$eval('#workbench-plan-tab', (node) =>
      node.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.click('#workbench-plan-tab');
    await page.waitForSelector('#workbench-add-schedule', { visible: true });
    await page.evaluate(() =>
      window.freeBbsTypography.applyPreferences({
        fontPreset: 'transistor-lab',
        typeScale: 'standard',
      }),
    );
    await page.click('#workbench-add-schedule');
    await page.waitForSelector('#workbench-schedule-dialog[open]');
    await page.type('#workbench-schedule-title', '版式回归日程');
    await page.type('#workbench-schedule-description', '六教 6A201；带电脑');
    await page.evaluate(() => {
      document.querySelector('#workbench-schedule-start').value = '2026-09-28T14:00';
      document.querySelector('#workbench-schedule-end').value = '2026-09-28T15:00';
    });
    await page.click('#workbench-schedule-submit');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    assert.ok(
      workbench.events.some(
        (event) => event.title === '版式回归日程' && event.description.includes('六教'),
      ),
    );
    const before = workbench.events.length;
    await page.type(
      '#workbench-agent-message',
      '明天下午3点组会，六教6A201；4点讨论，罗姆楼5103，两个都是1小时',
    );
    await page.click('#workbench-agent-generate');
    await page.waitForSelector('.workbench-agent-proposal');
    assert.equal(await page.$$eval('.workbench-agent-proposal', (nodes) => nodes.length), 2);
    assert.equal(workbench.events.length, before, 'preview must not write without confirmation');
    await page.click('#workbench-agent-confirm');
    await page.waitForFunction(() =>
      document.querySelector('#workbench-agent-status').textContent.includes('加入'),
    );
    assert.equal(workbench.events.length, before + 2);
    // Both actual bare /ranch links must survive slow identity restoration.
    for (const selector of [
      '.community-corner-links a[href="/ranch"]',
      '.community-heading a[href="/ranch"]',
    ]) {
      await page.goto(`${origin}/ranch-gallery`, { waitUntil: 'networkidle0' });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click(selector),
      ]);
      await page.waitForSelector('.ranch-scene');
      assert.equal(new URL(page.url()).searchParams.get('uid'), 'u_preview01');
      assert.equal(await page.$eval('#public-profile-message', (node) => node.textContent), '');
    }
    for (const mode of ['guest', 'error']) {
      authMode = mode;
      const count = profiles.length;
      await page.goto(`${origin}/ranch`, { waitUntil: 'networkidle0' });
      const message = await page.$eval('#public-profile-message', (node) => node.textContent);
      assert.match(message, mode === 'guest' ? /登录后即可/ : /暂时无法确认/);
      assert.equal(profiles.length, count, 'unverified identity must not fetch a profile');
    }
    authMode = 'ok';
    await page.goto(`${origin}/ranch?uid=u_other01`, { waitUntil: 'networkidle0' });
    assert.equal(new URL(page.url()).searchParams.get('uid'), 'u_other01');
    assert.equal(profiles.at(-1), '/api/users/u_other01/public-profile');
    await page.goto(`${origin}/ranch?uid=bad`, { waitUntil: 'networkidle0' });
    assert.match(
      await page.$eval('#public-profile-message', (node) => node.textContent),
      /无效用户 UID/,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: forms, batch preview/confirm, both own-ranch links, slow/guest/error/explicit identity',
    );
    console.log('screenshots', output);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
