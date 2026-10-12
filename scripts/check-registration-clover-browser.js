// Isolated loopback QA. Email delivery and accounts are simulated; no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createRanchPreview } = require('./preview-ranch-world');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-registration-clover-'));
  const preview = createRanchPreview();
  const fallback = preview.server.listeners('request')[0];
  const app = express();
  app.use(express.json());
  let deliveries = 0;
  app.post(['/api/auth/send-email-code', '/api/auth/send-reset-code'], (req, res) => {
    if (req.body.email === 'taken@example.invalid') {
      res.status(409).json({ message: '该邮箱已被注册' });
      return;
    }
    deliveries += 1;
    res.json({ message: '本地模拟：未发送真实邮件' });
  });
  app.get(['/register', '/remake'], (req, res) => {
    res
      .type('html')
      .send(
        fs
          .readFileSync(path.join(__dirname, '../public', `${req.path.slice(1)}.html`), 'utf8')
          .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, ''),
      );
  });
  app.use((req, res) => fallback(req, res));
  preview.server.removeAllListeners('request');
  preview.server.on('request', app);
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const report = { checks: [], layouts: [], screenshots: [], errors: [] };
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH,
      userDataDir: path.join(output, 'profile'),
    });
    const makePage = async () => {
      const page = await browser.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (new URL(request.url()).origin === base) request.continue();
        else request.respond({ status: 204 });
      });
      return page;
    };
    const auth = await makePage();
    await auth.evaluateOnNewDocument((timestamp) => {
      // Simulate a suspended tab: no interval callbacks run, but wall-clock time advances.
      Date.now = () => Number(sessionStorage.getItem('qa-clock')) || timestamp;
      window.setInterval = () => 1;
      window.qaAdvance = (ms) => sessionStorage.setItem('qa-clock', String(Date.now() + ms));
    }, Date.now());
    for (const route of ['/register', '/remake']) {
      await auth.goto(base + route, { waitUntil: 'domcontentloaded' });
      await auth.type('#auth-email', 'preview@example.invalid');
      await auth.type('#auth-student-id', '2026012345');
      if (route === '/register') await auth.type('#auth-full-name', '本地模拟');
      if (route === '/remake') {
        const method = await auth.$eval('#auth-reset-method', (input) => input.value);
        if (method === 'username') await auth.type('#auth-reset-identifier', 'preview_reader');
      }
      await auth.click('#send-email-code');
      await auth.waitForFunction(
        () => document.querySelector('#send-email-code').textContent === '60 s 后重发',
      );
      await auth.evaluate(() => {
        window.qaAdvance(25400);
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(
        await auth.$eval('#send-email-code', (button) => button.textContent),
        '35 s 后重发',
      );
      await auth.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(
        await auth.$eval('#send-email-code', (button) => button.textContent),
        '35 s 后重发',
      );
      await auth.evaluate(() => {
        window.qaAdvance(34600);
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      assert.equal(await auth.$eval('#send-email-code', (button) => button.disabled), false);
    }
    assert.equal(deliveries, 2, 'returning to the page never automatically resends an email');
    report.checks.push(
      'Registration/reset: suspended timers, visibility resume, reload, BFCache pageshow, exact 60-second expiry; no automatic resend',
    );
    await auth.close();

    const registration = await makePage();
    for (const width of [1440, 390]) {
      await registration.setViewport({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        await registration.goto(`${base}/register`, { waitUntil: 'domcontentloaded' });
        await registration.evaluate((mode) => {
          document.body.classList.toggle('theme-dark', mode === 'dark');
          document.body.classList.toggle('theme-light', mode === 'light');
        }, theme);
        await registration.click('#auth-submit');
        const layout = await registration.evaluate(() => {
          const fields = [
            'auth-username',
            'auth-full-name',
            'auth-student-id',
            'auth-email',
            'auth-email-code',
            'auth-password',
            'auth-password-confirm',
            'auth-community-agreement',
          ].map((id) => {
            const input = document.getElementById(id);
            const error = document.getElementById(`${id}-error`);
            return {
              id,
              invalid: input.getAttribute('aria-invalid'),
              description: input.getAttribute('aria-describedby'),
              error: error.textContent,
              visible: error.getBoundingClientRect().height > 0,
              color: getComputedStyle(error).color,
              fieldSibling:
                id === 'auth-community-agreement' || error.closest('.auth-field')?.contains(input),
            };
          });
          return {
            fields,
            bottomMessage: document.getElementById('auth-message').textContent,
            active: document.activeElement.id,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        for (const field of layout.fields) {
          assert.equal(field.invalid, 'true', field.id);
          assert.ok(field.description.includes(`${field.id}-error`), field.id);
          assert.ok(field.visible && field.error && field.fieldSibling, field.id);
          assert.equal(field.color, theme === 'dark' ? 'rgb(255, 157, 170)' : 'rgb(179, 38, 59)');
        }
        assert.equal(layout.bottomMessage, '');
        assert.equal(layout.active, 'auth-username');
        assert.ok(layout.overflow <= 2);
        report.layouts.push({ screen: 'registration-errors', width, theme, ...layout });
        const screenshot = path.join(output, `registration-errors-${width}-${theme}.png`);
        await registration.screenshot({ path: screenshot, fullPage: true });
        report.screenshots.push(screenshot);
        await registration.type('#auth-username', 'reader');
        assert.equal(
          await registration.$eval('#auth-username-error', (message) => message.hidden),
          true,
        );
      }
    }
    await registration.type('#auth-full-name', '本地模拟');
    await registration.type('#auth-student-id', '2026012345');
    await registration.type('#auth-email', 'taken@example.invalid');
    await registration.click('#send-email-code');
    await registration.waitForFunction(
      () => document.getElementById('auth-email-error').textContent === '该邮箱已被注册',
    );
    assert.equal(await registration.$eval('#auth-message', (message) => message.textContent), '');
    assert.equal(deliveries, 2, 'invalid identity never sends an email');
    report.checks.push(
      'Registration: eight red adjacent accessible field errors on desktop/mobile and light/dark themes; focus, editing reset, rejected email mapping; no bottom field errors or automatic delivery',
    );
    await registration.close();

    preview.store.account(1).assets.ranch_clover = 0;
    const ranch = await makePage();
    await ranch.goto(`${base}/ranch-gallery`, { waitUntil: 'domcontentloaded' });
    await ranch.waitForSelector('#community-clover:not([hidden])');
    for (const width of [1440, 390]) {
      await ranch.setViewport({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        await ranch.evaluate((mode) => {
          document.body.classList.toggle('theme-dark', mode === 'dark');
          document.body.classList.toggle('theme-light', mode === 'light');
        }, theme);
        const layout = await ranch.evaluate(() => {
          const button = document.querySelector('#community-clover');
          const label = button.querySelector('span');
          const select = document.querySelector('#community-scene');
          return {
            label: label.textContent,
            title: button.title,
            color: getComputedStyle(label).color,
            adjacentColor: getComputedStyle(select).color,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        assert.match(layout.label, /1 磁元/);
        assert.match(layout.title, /1 磁元/);
        assert.equal(layout.color, layout.adjacentColor);
        assert.ok(layout.overflow <= 2);
        report.layouts.push({ width, theme, ...layout });
        const screenshot = path.join(output, `clover-${width}-${theme}.png`);
        await ranch.screenshot({ path: screenshot });
        report.screenshots.push(screenshot);
      }
    }
    report.checks.push(
      'Clover: one magnetic price in the shared-ranch entry; text colour matches adjacent scene picker on desktop/mobile and light/dark themes',
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(`Registration/clover browser passed: ${output}`);
  } catch (error) {
    report.passed = false;
    report.failure = error.stack;
    report.deliveries = deliveries;
    if (browser) {
      report.authStates = await Promise.all(
        (await browser.pages()).map((page) =>
          page.evaluate(() => ({
            path: window.location.pathname,
            codeButton: document.getElementById('send-email-code')?.textContent,
            message: document.getElementById('auth-message')?.textContent,
            codeStatus: document.getElementById('auth-email-code-status')?.textContent,
            fieldErrors: [...document.querySelectorAll('.auth-field-error:not([hidden])')].map(
              (element) => ({ id: element.id, message: element.textContent }),
            ),
          })),
        ),
      );
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
