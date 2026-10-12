// Real markup and production CSS order, loopback-only synthetic API data.
// The static sweep reveals closed sections solely to measure their CSS roles;
// it verifies native hidden controls first and never submits a real operation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { preparePageShell } = require('../page-shell');

const root = path.join(__dirname, '..');
const pages = [
  'login',
  'register',
  'remake',
  'settings',
  'adminusers',
  'aichat',
  'discussion',
  'guide',
  'inventory',
  'knowledge',
  'markdown-editor',
  'publish',
  'staff',
  'surveys',
  'system-settings-course-materials',
  'system-settings-model',
  'system-settings-rewards',
  'system-settings-surveys',
  'tool-workshop',
  'workbench',
];
const shellStyles = [
  'site-search',
  'mobile-shell',
  'desktop-elegant',
  'page-transitions',
  'desktop-shell',
  'personal-polish',
];
const keepScripts = new Set(['typography.js', 'typography-preferences.js']);
const survey = {
  id: 'demo',
  title: '本地活动',
  status: 'published',
  opensAt: '2020-01-01',
  closesAt: '2099-01-01',
  winnerCount: 5,
  entryCount: 0,
  drawMode: 'manual',
  repeatDays: 7,
  requiresLogin: false,
  questions: [{ id: 'q1', label: '建议', type: 'single', options: ['甲', '乙'], required: false }],
};

function htmlFixture(name, dynamic) {
  const source = fs.readFileSync(path.join(root, 'public', `${name}.html`), 'utf8');
  const allowed = new Set(keepScripts);
  if (dynamic && ['surveys', 'system-settings-surveys'].includes(name))
    ['surveys-common.js', 'request-runtime.js', 'survey-receipts.js', `${name}.js`].forEach(
      (script) => allowed.add(script),
    );
  const dynamicControllers = {
    settings: 'course-upload.js',
    adminusers: 'admin-account-credentials.js',
    'system-settings-rewards': 'admin-rewards.js',
  };
  if (dynamic && dynamicControllers[name]) allowed.add(dynamicControllers[name]);
  let html = preparePageShell(source).replace(
    /<script\b([^>]*)>[\s\S]*?<\/script>/g,
    (tag, attrs) => {
      const filename = /src=["']\/([^"'?]+)/.exec(attrs)?.[1];
      return allowed.has(filename) ? tag : '';
    },
  );
  html = html.replace(
    '</head>',
    `${shellStyles.map((sheet) => `<link rel="stylesheet" href="/${sheet}.css">`).join('')}</head>`,
  );
  if (dynamic && dynamicControllers[name])
    html = html.replace(
      '</head>',
      `<script>
      window.callApi = async (route, options) => (await fetch('/api' + route, options)).json();
      window.API_BASE_URL = '/api'; window.API_ROOT = '';
      window.freeBbsApp = { userState: { uid: 'synthetic-admin', token: 'synthetic-probe', isLoggedIn: true, isAdmin: true }, callApi: window.callApi, sessionReady: Promise.resolve() };
      </script></head>`,
    );
  return html;
}

function composite(fill, surface) {
  const values = fill.match(/[\d.]+/g).map(Number);
  if (fill.startsWith('color(srgb')) {
    for (let index = 0; index < 3; index += 1) values[index] *= 255;
  }
  const alpha = values[3] ?? 1;
  const base = surface
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
  return `rgb(${values
    .slice(0, 3)
    .map((value, index) => Math.round(value * alpha + base[index] * (1 - alpha)))
    .join(', ')})`;
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
async function state(page, selector) {
  return page.$eval(selector, (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const fills = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      fills.push(getComputedStyle(parent).backgroundColor);
    return {
      color: style.color,
      fill: style.backgroundColor,
      gradient: style.backgroundImage,
      fills,
      opacity: style.opacity,
      transform: style.transform,
      disabled: element.disabled || element.getAttribute('aria-disabled') === 'true',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}
function ratio(sample) {
  const surface = sample.fills.reduceRight(
    (paint, fill) => composite(fill, paint),
    'rgb(255, 255, 255)',
  );
  const stops = sample.gradient.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) || [sample.fill];
  return Number(
    Math.min(...stops.map((fill) => contrast(sample.color, composite(fill, surface)))).toFixed(2),
  );
}

async function measure(page, name, issues, measurements, dynamic) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}',
  });
  const controls = await page.$$eval('.bbs-action', (elements) =>
    elements.map((node, index) => {
      const element = node;
      element.dataset.migrationProbe = String(index);
      return {
        index,
        label: element.textContent.trim().replace(/\s+/g, ' '),
        id: element.id,
        tone: element.dataset.actionTone,
        classes: element.className,
        hidden: element.hidden,
      };
    }),
  );
  assert.ok(controls.length, `${name} needs ordinary controls`);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((mode) => window.freeBbsTheme.applyMode(mode), theme);
    for (const control of controls) {
      const selector = `[data-migration-probe="${control.index}"]`;
      // Native hidden cannot accidentally be overridden by inline-flex.
      if (control.hidden && !dynamic) {
        const display = await page.$eval(selector, (element) => getComputedStyle(element).display);
        if (theme === 'light' && display !== 'none')
          issues.push({ name, theme, ...control, problem: 'hidden control displayed' });
      }
      await page.$eval(selector, (element) => {
        document
          .querySelectorAll('dialog[open]')
          .forEach((dialog) => dialog.removeAttribute('open'));
        for (let parent = element; parent; parent = parent.parentElement) {
          parent.hidden = false;
          parent.classList.remove('hidden');
          if (parent.tagName === 'DIALOG') parent.setAttribute('open', '');
          if (getComputedStyle(parent).display === 'none') parent.style.display = 'block';
        }
        element.scrollIntoView({ block: 'center', inline: 'center' });
      });
      await page.mouse.move(0, 0);
      const idle = await state(page, selector);
      if (!idle.rect.width || !idle.rect.height) {
        issues.push({
          name,
          theme,
          ...control,
          problem: 'not measurable in its original container',
        });
        continue;
      }
      const box = await page.$(selector).then((node) => node.boundingBox());
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const hover = await state(page, selector);
      await page.mouse.down();
      const active = await state(page, selector);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      const result = {
        name,
        theme,
        ...control,
        idle: ratio(idle),
        hover: ratio(hover),
        active: ratio(active),
        disabled: Boolean(idle.disabled),
      };
      measurements.push(result);
      if (!idle.disabled && Math.min(result.idle, result.hover, result.active) < 4.5)
        issues.push({
          ...result,
          problem: 'contrast',
          colors: {
            idle: [idle.color, idle.fill],
            hover: [hover.color, hover.fill],
            active: [active.color, active.fill],
          },
        });
      if (JSON.stringify(active.rect) !== JSON.stringify(hover.rect))
        issues.push({
          ...result,
          problem: 'pressed target moved',
          hoverRect: hover.rect,
          activeRect: active.rect,
        });
      if (idle.disabled && (idle.fill !== hover.fill || idle.color !== hover.color))
        issues.push({ ...result, problem: 'disabled hover changes colors' });
      // Restore the original native hidden state for the next theme check.
      if (control.hidden)
        await page.$eval(selector, (node) => {
          const element = node;
          element.hidden = true;
        });
    }
  }
  if (dynamic && name === 'system-settings-surveys') {
    for (const text of ['取消本期', '停止后续重复']) {
      const tone = await page.$$eval(
        '#survey-list button',
        (buttons, label) =>
          buttons.find((button) => button.textContent === label)?.dataset.actionTone,
        text,
      );
      assert.equal(tone, 'danger', text);
    }
  }
}

async function main() {
  const pageErrors = [];
  const issues = [];
  const measurements = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const name = url.pathname.slice(1);
    if (pages.includes(name)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(htmlFixture(name, url.searchParams.has('dynamic')));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.pathname === '/api/course-upload/tokens') {
        response.end(
          JSON.stringify({
            tokens: [{ id: 'probe', name: '测试 Token', prefix: 'demo', expiresAt: '2099-01-01' }],
          }),
        );
        return;
      }
      if (url.pathname === '/api/admin/student-id-requests') {
        response.end(
          JSON.stringify({
            requests: [
              { userId: 'demo', fullName: '测试同学', username: 'demo', studentId: '0000000000' },
            ],
          }),
        );
        return;
      }
      if (url.pathname === '/api/admin/rewards') {
        response.end(
          JSON.stringify({
            batches: [
              {
                id: 'demo',
                title: '测试记录',
                recipient_count: 1,
                electric: 1,
                magnetic: 0,
                reason: '本地测试',
                actor: '测试管理员',
                created_at: '2026-10-09',
              },
            ],
            nextCursor: null,
          }),
        );
        return;
      }
      if (url.pathname === '/api/admin/notifications/audience') {
        response.end(JSON.stringify({ users: [] }));
        return;
      }
      response.end(
        JSON.stringify(
          url.pathname === '/api/surveys/demo'
            ? { survey }
            : {
                surveys: [survey, { ...survey, id: 'draft', status: 'draft', title: '草稿' }],
                nextPage: null,
                page: 0,
              },
        ),
      );
      return;
    }
    const file = path.resolve(root, 'public', `.${url.pathname}`);
    if (
      file.startsWith(path.resolve(root, 'public') + path.sep) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile()
    ) {
      const ext = path.extname(file);
      response.writeHead(200, {
        'Content-Type':
          { '.css': 'text/css', '.js': 'text/javascript' }[ext] || 'application/octet-stream',
      });
      response.end(fs.readFileSync(file));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  let browser;
  try {
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const scenarios = [
      ...pages.map((name) => ({ name, suffix: '', dynamic: false })),
      { name: 'surveys', suffix: '?dynamic=1', dynamic: true },
      { name: 'surveys', suffix: '?dynamic=1&id=demo', dynamic: true },
      { name: 'system-settings-surveys', suffix: '?dynamic=1', dynamic: true },
      { name: 'settings', suffix: '?dynamic=1', dynamic: true },
      { name: 'adminusers', suffix: '?dynamic=1', dynamic: true },
      { name: 'system-settings-rewards', suffix: '?dynamic=1', dynamic: true },
    ];
    for (const scenario of scenarios) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      page.on('pageerror', (error) =>
        pageErrors.push({ name: scenario.name, error: error.message }),
      );
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem('free_bbs_auth_token', 'synthetic-probe');
        } catch {
          /* Sandboxed tool frames cannot access storage. */
        }
      });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith(origin)) request.continue();
        else request.abort();
      });
      await page.goto(`${origin}/${scenario.name}${scenario.suffix}`, {
        waitUntil: 'networkidle0',
      });
      if (scenario.dynamic && ['surveys', 'system-settings-surveys'].includes(scenario.name))
        await page.waitForFunction(() =>
          document.querySelector('#content .bbs-action, #survey-list .bbs-action'),
        );
      if (scenario.dynamic && scenario.name === 'settings')
        await page.waitForSelector('#course-token-list .bbs-action');
      if (scenario.dynamic && scenario.name === 'adminusers') {
        await page.waitForSelector('#admin-student-request-list .bbs-action');
        await page.evaluate(() =>
          window.FreeBbsAdminAccounts.openReset({ id: 'demo', username: '测试教师' }),
        );
      }
      if (scenario.dynamic && scenario.name === 'system-settings-rewards')
        await page.waitForSelector('#reward-batches .bbs-action');
      await measure(page, scenario.name, issues, measurements, scenario.dynamic);
      await page.close();
    }
    const output = {
      status: issues.length || pageErrors.length ? 'failed' : 'passed',
      pages: pages.length,
      samples: measurements.length,
      issues: issues.map(({ name, theme, id, label, tone, problem, idle, hover, active }) => ({
        name,
        theme,
        id,
        label,
        tone,
        problem,
        idle,
        hover,
        active,
      })),
      pageErrors,
    };
    console.log(JSON.stringify(output, null, 2));
    assert.deepEqual(pageErrors, [], 'dynamic fixtures must not throw');
    assert.equal(
      issues.length,
      0,
      'ordinary roles must be readable, stationary, and respect hidden/disabled',
    );
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
