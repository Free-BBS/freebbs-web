// Isolated loopback fixtures only: no real accounts, database, or external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');
const { createPersonalPreview } = require('./preview-personal');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });

async function skipGuides(origin) {
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
}

async function localPage(browser, hold = () => false) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (hold(request)) return;
    if (/^http:\/\/127\.0\.0\.1:/.test(request.url()) || /^(data|blob):/.test(request.url()))
      request.continue();
    else request.abort();
  });
  return page;
}

function contrast(foreground, background) {
  const luminance = (color) => {
    const [r, g, b] = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  const servers = [];
  const results = [];
  const errors = [];
  let browser;
  try {
    const dashboard = await createDashboardUsabilityPreview();
    servers.push(dashboard.server);
    await listen(dashboard.server);
    const dashboardOrigin = originOf(dashboard.server);
    await skipGuides(dashboardOrigin);
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    browser.on('targetcreated', async (target) => {
      const page = await target.page();
      page?.on('pageerror', (error) => errors.push(error.message));
    });

    // A stuck notification endpoint must not hold back the real important/schedule renderers.
    const workbench = await localPage(browser, (request) =>
      request.url().includes('/api/workbench/notifications'),
    );
    await workbench.goto(`${dashboardOrigin}/workbench`, { waitUntil: 'domcontentloaded' });
    await workbench.waitForFunction(() =>
      document.getElementById('workbench-priority-list').innerText.includes('查看本周计划'),
    );
    await workbench.waitForFunction(() =>
      document.getElementById('workbench-schedule-list').querySelector('[data-workbench-action]'),
    );
    const beforeDeadline = await workbench.evaluate(() => ({
      importantBusy: document.getElementById('workbench-priority-list').getAttribute('aria-busy'),
      scheduleBusy: document.getElementById('workbench-schedule-list').getAttribute('aria-busy'),
      notificationBusy: document
        .getElementById('workbench-notification-list')
        .getAttribute('aria-busy'),
    }));
    assert.equal(beforeDeadline.importantBusy, 'false');
    assert.equal(beforeDeadline.scheduleBusy, 'false');
    assert.equal(beforeDeadline.notificationBusy, 'true');
    await workbench.waitForFunction(
      () => document.getElementById('workbench-notice-hint').innerText.includes('暂时无法加载'),
      { timeout: 20000 },
    );
    assert.equal(
      await workbench.$eval('#workbench-notification-list', (node) =>
        node.getAttribute('aria-busy'),
      ),
      'false',
    );
    assert.equal(
      await workbench.evaluate(() => Boolean(localStorage.getItem('free_bbs_auth_token'))),
      true,
    );
    results.push({
      check: 'independent sections and bounded notification failure',
      ...beforeDeadline,
    });
    await workbench.close();

    // Pending identity lookup ends at its own deadline without deleting the saved token.
    const personal = createPersonalPreview();
    servers.push(personal.server);
    await listen(personal.server);
    const personalOrigin = originOf(personal.server);
    await skipGuides(personalOrigin);
    const session = await localPage(browser, (request) => request.url().includes('/api/auth/me'));
    await session.goto(`${personalOrigin}/settings`, { waitUntil: 'domcontentloaded' });
    await session.waitForFunction(() => Boolean(window.freeBbsApp?.sessionReady));
    const ready = await session.evaluate(() =>
      Promise.race([
        window.freeBbsApp.sessionReady.then(() => 'settled'),
        new Promise((resolve) => {
          setTimeout(() => resolve('still pending'), 10000);
        }),
      ]),
    );
    assert.equal(ready, 'settled');
    assert.equal(
      await session.evaluate(() => Boolean(localStorage.getItem('free_bbs_auth_token'))),
      true,
    );
    results.push({ check: 'pending identity request settles and preserves credential', ready });
    await session.close();

    // Use a parent equivalent to a React theme toggle with the actual main-site child.
    // This preview normally denies frames; allow only same-origin framing in this fixture.
    const proxy = http.createServer((request, response) => {
      if (request.url === '/audit-parent') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<body class="theme-light"><iframe src="/settings?embed=development" style="width:1200px;height:700px"></iframe></body>',
        );
        return;
      }
      const headers = { ...request.headers, host: new URL(personalOrigin).host };
      if (headers.origin) headers.origin = personalOrigin;
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port: personal.server.address().port,
          path: request.url,
          method: request.method,
          headers,
        },
        (result) => {
          const outputHeaders = { ...result.headers };
          outputHeaders['content-security-policy'] = String(
            outputHeaders['content-security-policy'] || '',
          ).replace("frame-ancestors 'none'", "frame-ancestors 'self'");
          response.writeHead(result.statusCode, outputHeaders);
          result.pipe(response);
        },
      );
      request.pipe(upstream);
      upstream.on('error', () => {
        response.statusCode = 502;
        response.end();
      });
    });
    servers.push(proxy);
    await listen(proxy);
    const proxyOrigin = originOf(proxy);
    const parent = await localPage(browser);
    await parent.evaluateOnNewDocument(() => localStorage.setItem('free_bbs_theme_mode', 'light'));
    await parent.goto(`${proxyOrigin}/audit-parent`, { waitUntil: 'networkidle0' });
    const child = parent.frames().find((frame) => frame !== parent.mainFrame());
    assert.equal(await child.evaluate(() => document.body.classList.contains('theme-light')), true);
    await parent.evaluate(() => {
      localStorage.setItem('free_bbs_theme_mode', 'dark');
      document.body.className = 'theme-dark';
    });
    await child.waitForFunction(() => document.body.classList.contains('theme-dark'));
    const second = await localPage(browser);
    await second.goto(`${proxyOrigin}/settings`, { waitUntil: 'networkidle0' });
    await child.evaluate(() => window.freeBbsApp.toggleThemeMode());
    await second.waitForFunction(() => document.body.classList.contains('theme-light'));
    // Message synchronization must also work when writing the theme preference is blocked.
    await child.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'free_bbs_theme_mode') throw new Error('Preference store blocked');
        return original.call(this, key, value);
      };
    });
    await parent.evaluate(() => {
      document
        .querySelector('iframe')
        .contentWindow.postMessage(
          { type: 'freebbs:theme-sync', mode: 'dark' },
          window.location.origin,
        );
    });
    await child.waitForFunction(() => document.body.classList.contains('theme-dark'));
    results.push({ check: 'iframe, cross-tab, and blocked-preference theme synchronization' });
    await parent.close();
    await second.close();

    // Verify the real CSS import order with actual component structures, not token arithmetic alone.
    const imports = [
      ...fs
        .readFileSync('development/apps/web/src/main.tsx', 'utf8')
        .matchAll(/import '\.\/(styles\/[^']+)'/g),
    ];
    const css = imports
      .map((match) => fs.readFileSync(path.join('development/apps/web/src', match[1]), 'utf8'))
      .join('\n');
    const colors = await browser.newPage();
    await colors.setContent(
      `<style>${css}</style><body class="theme-dark"><div class="auth-state"><a id="login" href="#">登录主站</a><button id="retry">重试</button></div><section class="module-page admin-governance-page"><button id="danger" class="danger-button">移除</button><div class="audience-switcher"><button id="audience" aria-pressed="true">本科生</button></div></section></body>`,
    );
    const pairs = [];
    for (const mode of ['dark', 'light']) {
      await colors.evaluate((value) => {
        document.body.className = `theme-${value}`;
      }, mode);
      for (const id of ['login', 'retry', 'danger', 'audience']) {
        await colors.hover(`#${id}`);
        await wait(250);
        const pair = await colors.$eval(`#${id}`, (node) => {
          const style = getComputedStyle(node);
          return { foreground: style.color, background: style.backgroundColor };
        });
        const ratio = contrast(pair.foreground, pair.background);
        assert.ok(ratio >= 4.5, `${mode} ${id} contrast ${ratio}`);
        pairs.push({ mode, id, contrast: Number(ratio.toFixed(2)) });
      }
    }
    results.push({ check: 'light/dark interactive color pairs', pairs });
    await colors.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ results, pageErrors: errors }, null, 2));
  } finally {
    await browser?.close();
    for (const server of servers.reverse()) await close(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
