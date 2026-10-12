// Loopback CSS fixtures only: no accounts, APIs, external pages, or saved preferences.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

const repo = path.join(__dirname, '..');
const resources = new Map(
  [
    'public/styles.css',
    'public/ui-polish.css',
    'public/theme-tokens.css',
    'public/actions.css',
    'public/ui-state.css',
    'public/desktop-elegant.css',
    'public/post-reader.css',
    'development/apps/web/src/styles/tokens.css',
    'development/apps/web/src/styles/theme.css',
    'development/apps/web/src/styles/components.css',
  ].map((file) => [`/${file}`, path.join(repo, file)]),
);
for (const [url, file] of [...resources]) {
  if (url.startsWith('/public/')) resources.set(url.slice('/public'.length), file);
}

function fixture(development) {
  const css = development
    ? [
        '/development/apps/web/src/styles/tokens.css',
        '/development/apps/web/src/styles/theme.css',
        '/development/apps/web/src/styles/components.css',
      ]
    : ['/styles.css', '/ui-polish.css', '/desktop-elegant.css', '/post-reader.css'];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    ${css.map((url) => `<link rel="stylesheet" href="${url}">`).join('\n')}
    </head><body class="theme-light ${development ? '' : 'discussion-page'}">
    <main class="main-content" style="position:relative">
    <section id="roles" style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <a id="primary" class="bbs-action" data-action-tone="primary" href="#roles"><strong>主要操作</strong></a>
      <button id="secondary" class="bbs-action" data-action-tone="secondary">次要操作</button>
      <button id="quiet" class="bbs-action" data-action-tone="quiet">轻量操作</button>
      <button id="danger" class="bbs-action" data-action-tone="danger">危险操作</button>
      <button id="disabled" class="bbs-action" data-action-tone="primary" disabled>不可操作</button>
      <button id="aria-disabled" class="bbs-action" data-action-tone="primary" aria-disabled="true">不可操作</button>
    </section>
    ${development ? '<div class="module-page"><button id="generic">发展端普通操作</button></div>' : ''}
    <div class="discussion-comment" style="position:relative;height:100px;margin-top:60px">
      <button id="thread" class="discussion-comment-thread-toggle" type="button" aria-expanded="true" style="left:30px;top:50px">−</button>
    </div></main></body></html>`;
}

function contrast(foreground, background) {
  const luminance = (color) => {
    const [red, green, blue] = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function effectiveFill(fill, surface) {
  const channels = fill.match(/[\d.]+/g).map(Number);
  const alpha = channels[3] ?? 1;
  if (alpha === 1) return fill;
  const base = surface
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
  return `rgb(${channels
    .slice(0, 3)
    .map((channel, index) => Math.round(channel * alpha + base[index] * (1 - alpha)))
    .join(', ')})`;
}

function paintedBackground(state) {
  return state.parentFills.reduceRight((paint, fill) => effectiveFill(fill, paint), state.surface);
}

const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

async function actionState(page, id) {
  return page.$eval(`#${id}`, (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const body = getComputedStyle(document.body);
    const parentFills = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      parentFills.push(getComputedStyle(parent).backgroundColor);
    return {
      color: style.color,
      fill: style.backgroundColor,
      surface: body.backgroundColor,
      parentFills,
      page: body.getPropertyValue('--surface-page').trim(),
      danger: body.getPropertyValue('--action-danger').trim(),
      opacity: style.opacity,
      cursor: style.cursor,
      outline: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      transform: style.transform,
      childColor: element.firstElementChild
        ? getComputedStyle(element.firstElementChild).color
        : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

async function checkActualWorkbench(browser, results, errors) {
  const { server } = await createDashboardUsabilityPreview();
  try {
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
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
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith(origin)) request.continue();
      else request.abort();
    });
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() =>
      document.getElementById('workbench-priority-list').querySelector('.bbs-action'),
    );
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
    for (const mode of ['light', 'dark']) {
      await page.evaluate((theme) => window.freeBbsTheme.applyMode(theme), mode);
      const controls = await page.$$eval('.bbs-action', (buttons) =>
        buttons
          .filter((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0
            );
          })
          .map((button, index) => {
            // Identifiers are scoped to this disposable preview page only.
            button.setAttribute('id', `action-contract-${index}`);
            return { id: button.id, tone: button.dataset.actionTone };
          }),
      );
      assert.ok(controls.length >= 2, 'actual workbench should show important-item actions');
      for (const control of controls) {
        await page.mouse.move(0, 0);
        const idle = await actionState(page, control.id);
        await page.hover(`#${control.id}`);
        const hover = await actionState(page, control.id);
        const background = effectiveFill(hover.fill, paintedBackground(hover));
        const idleBackground = effectiveFill(idle.fill, paintedBackground(idle));
        assert.ok(
          contrast(idle.color, idleBackground) >= 4.5,
          `workbench ${mode} ${control.tone} idle`,
        );
        assert.ok(
          contrast(hover.color, background) >= 4.5,
          `workbench ${mode} ${control.tone} hover`,
        );
        await page.mouse.down();
        const active = await actionState(page, control.id);
        assert.deepEqual(active.rect, hover.rect, 'actual workbench press must not move');
        // Cancel the click; this test measures presentation, not data mutations.
        await page.mouse.move(0, 0);
        await page.mouse.up();
        results.push({
          application: 'actual workbench',
          mode,
          role: control.tone,
          hoverContrast: Number(contrast(hover.color, background).toFixed(2)),
        });
      }
    }
    // The real list-view entry exposes schedule deletion controls, including
    // workbench.css and workbench-elegant.css in their normal loaded order.
    await page.click('#workbench-view-toggle');
    const dangerSelector =
      '#workbench-schedule-list [data-workbench-action="delete-schedule"].bbs-action.is-danger';
    await page.waitForSelector(dangerSelector, { visible: true });
    await page.$eval(dangerSelector, (button) => {
      button.setAttribute('id', 'action-contract-real-danger');
    });
    for (const mode of ['light', 'dark']) {
      await page.evaluate((theme) => window.freeBbsTheme.applyMode(theme), mode);
      await page.mouse.move(0, 0);
      const idle = await actionState(page, 'action-contract-real-danger');
      const idleFill = effectiveFill(idle.fill, paintedBackground(idle));
      assert.ok(
        contrast(idle.color, idleFill) >= 4.5,
        `workbench ${mode} actual danger idle ${JSON.stringify(idle)}`,
      );
      await page.hover('#action-contract-real-danger');
      const hover = await actionState(page, 'action-contract-real-danger');
      const hoverFill = effectiveFill(hover.fill, paintedBackground(hover));
      assert.ok(
        contrast(hover.color, hoverFill) >= 4.5,
        `workbench ${mode} actual danger hover ${JSON.stringify(hover)}`,
      );
      await page.mouse.down();
      const active = await actionState(page, 'action-contract-real-danger');
      assert.deepEqual(active.rect, hover.rect, 'actual danger press must not move');
      // No deletion occurs: release outside the control to cancel the click.
      await page.mouse.move(0, 0);
      await page.mouse.up();
      results.push({
        application: 'actual workbench list',
        mode,
        role: 'danger',
        idleContrast: Number(contrast(idle.color, idleFill).toFixed(2)),
        hoverContrast: Number(contrast(hover.color, hoverFill).toFixed(2)),
      });
    }
    await page.close();
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

async function main() {
  const errors = [];
  const results = [];
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    if (pathname === '/public' || pathname === '/development') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixture(pathname === '/development'));
      return;
    }
    const file = resources.get(pathname);
    if (file && fs.existsSync(file)) {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
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
    for (const application of ['public', 'development']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith(origin)) request.continue();
        else request.abort();
      });
      await page.goto(`${origin}/${application}`, { waitUntil: 'networkidle0' });
      // Suppress transitions only for deterministic measurements; test their contract separately.
      const measurementStyle = await page.addStyleTag({
        content: '*,*::before,*::after{transition:none!important}',
      });
      for (const mode of ['light', 'dark']) {
        await page.evaluate((theme) => {
          document.body.classList.remove('theme-light', 'theme-dark');
          document.body.classList.add(`theme-${theme}`);
        }, mode);
        for (const id of ['primary', 'secondary', 'quiet', 'danger']) {
          await page.mouse.move(0, 0);
          const idle = await actionState(page, id);
          assert.ok(
            contrast(idle.color, effectiveFill(idle.fill, paintedBackground(idle))) >= 4.5,
            `${application} ${mode} ${id} idle ${JSON.stringify(idle)}`,
          );
          if (idle.childColor) assert.equal(idle.childColor, idle.color);
          await page.hover(`#${id}`);
          const hover = await actionState(page, id);
          const hoverFill = effectiveFill(hover.fill, paintedBackground(hover));
          assert.ok(contrast(hover.color, hoverFill) >= 4.5, `${application} ${mode} ${id} hover`);
          await page.mouse.down();
          const active = await actionState(page, id);
          assert.deepEqual(
            active.rect,
            hover.rect,
            `${application} ${mode} ${id} press must not move`,
          );
          await page.mouse.up();
          results.push({
            application,
            mode,
            role: id,
            hoverContrast: Number(contrast(hover.color, hoverFill).toFixed(2)),
          });
        }
        for (const id of ['disabled', 'aria-disabled']) {
          await page.mouse.move(0, 0);
          const idle = await actionState(page, id);
          await page.hover(`#${id}`);
          const hover = await actionState(page, id);
          assert.equal(
            hover.fill,
            idle.fill,
            `${application} ${id} should not gain hover feedback`,
          );
          assert.equal(hover.opacity, '0.55');
          assert.equal(hover.cursor, 'not-allowed');
        }
        if (application === 'public') {
          const themed = await actionState(page, 'danger');
          assert.equal(themed.page, mode === 'dark' ? '#0d181d' : '#f4f6f8');
          assert.equal(themed.danger, mode === 'dark' ? '#ff9b8f' : '#9b3429');
          const before = await page.$('#thread');
          const rect = await before.boundingBox();
          await page.mouse.move(rect.x + 2, rect.y + 2);
          const threadIdle = await actionState(page, 'thread');
          await page.mouse.down();
          const threadActive = await actionState(page, 'thread');
          assert.deepEqual(
            threadActive.rect,
            threadIdle.rect,
            'thread hit target must stay centered',
          );
          assert.equal(threadActive.transform, threadIdle.transform);
          await page.mouse.up();
        } else {
          await page.hover('#generic');
          const generic = await actionState(page, 'generic');
          assert.ok(
            contrast(generic.color, generic.fill) >= 4.5,
            'generic development hover must pair readable text',
          );
        }
      }
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Tab');
      await page.focus('#primary');
      const focus = await actionState(page, 'primary');
      assert.equal(focus.outline, 'solid');
      assert.equal(focus.outlineWidth, '3px');
      await measurementStyle.evaluate((element) => element.remove());
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await wait(20);
      const transition = await page.$eval(
        '#primary',
        (element) => getComputedStyle(element).transitionDuration,
      );
      assert.ok(transition.split(',').every((duration) => Number.parseFloat(duration) <= 0.01));
      await page.close();
    }
    await checkActualWorkbench(browser, results, errors);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', results, pageErrors: errors }, null, 2));
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
