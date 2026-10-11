// Read-only loopback QA: use actual staff assets, no real account, production API or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const roster = require('../public/data/staff.json');
const { createHomePreviewServer } = require('./preview-home');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const root = path.resolve(__dirname, '../public');
const originals = new Set(roster.members.map((member) => member.photo));

function createStaffPhotoLab() {
  const core = createHomePreviewServer();
  const state = { requests: [], pending: [], hold: false, fail: new Set(), legacy: false };
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (
      pathname !== '/data/staff.json' &&
      !/^\/assets\/staff\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(pathname)
    ) {
      core.emit('request', req, res);
      return;
    }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') || req.method !== 'GET') {
      res.writeHead(403);
      res.end();
      return;
    }
    state.requests.push(pathname);
    const send = async () => {
      if (res.writableEnded || res.destroyed) return;
      try {
        if (state.fail.has(pathname)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const mime = {
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
        };
        const data =
          state.legacy && pathname === '/data/staff.json'
            ? JSON.stringify({
                ...roster,
                members: roster.members.map(({ photoThumbnail, ...member }) => member),
              })
            : await fs.readFile(path.join(root, pathname));
        res.writeHead(200, {
          'Content-Type': mime[path.extname(pathname)],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(data);
      } catch {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      }
    };
    if (state.hold && originals.has(pathname)) state.pending.push({ pathname, send });
    else await send();
  });
  return { server, state };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Staff photo fixture did not reach its expected state');
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

async function openPhoto(page, name) {
  await page.evaluate((memberName) => {
    const card = [...document.querySelectorAll('.staff-person')].find(
      (node) => node.querySelector('.staff-person-name')?.textContent === memberName,
    );
    card.querySelector('.staff-avatar').scrollIntoView({ block: 'center' });
  }, name);
  await page
    .locator(`.staff-avatar[aria-label=${JSON.stringify(`放大查看${name}的照片`)}]`)
    .click();
  await page.waitForFunction(() => document.querySelector('#staff-photo-dialog').open);
}

async function photoLoaded(page, member) {
  await page.waitForFunction(
    (original) => {
      const image = document.querySelector('#staff-photo-image');
      return (
        !image.hidden &&
        image.complete &&
        image.naturalWidth > 0 &&
        new URL(image.src).pathname === original
      );
    },
    {},
    member.photo,
  );
  const state = await page.evaluate(() => {
    const dialog = document.querySelector('#staff-photo-dialog');
    const image = document.querySelector('#staff-photo-image');
    const rect = image.getBoundingClientRect();
    return {
      name: document.querySelector('#staff-photo-name').textContent,
      src: new URL(image.src).pathname,
      busy: dialog.getAttribute('aria-busy'),
      statusHidden: document.querySelector('#staff-photo-status').hidden,
      width: image.naturalWidth,
      height: image.naturalHeight,
      visible:
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1,
      objectFit: getComputedStyle(image).objectFit,
    };
  });
  assert.equal(state.name, member.name);
  assert.equal(state.src, member.photo);
  assert.equal(state.busy, 'false');
  assert.equal(state.statusHidden, true);
  assert.equal(state.visible, true, 'full photograph must fit both viewport axes');
  assert.equal(state.objectFit, 'contain');
  return state;
}

async function closeAndCheckFocus(page, name) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#staff-photo-dialog').open);
  await page.waitForFunction(
    (memberName) =>
      document.activeElement?.closest('.staff-person')?.querySelector('.staff-person-name')
        ?.textContent === memberName,
    {},
    name,
  );
  // Native focus restoration can precede the queued close callback and its source cleanup.
  await page.waitForFunction(
    () =>
      !document.querySelector('#staff-photo-image').hasAttribute('src') &&
      document.querySelector('#staff-photo-image').hidden &&
      document.querySelector('#staff-photo-dialog').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await page.$eval('#staff-photo-image', (image) => image.hasAttribute('src')), false);
}

async function verifyScenario(browser, output, spec) {
  const lab = createStaffPhotoLab();
  lab.state.legacy = spec.legacy || false;
  const { port } = await listenAllowedLoopback(lab.server);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: spec.width, height: spec.height });
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const action = url.hostname === '127.0.0.1' ? request.continue() : request.abort();
    action.catch(() => {});
  });
  const report = { spec, checks: [] };
  try {
    await page.goto(`http://127.0.0.1:${port}/staff?theme=${spec.theme}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#staff-grid')?.getAttribute('aria-busy') === 'false' &&
        document.querySelectorAll('.staff-person').length > 0,
    );
    assert.equal(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      spec.theme === 'light',
    );
    const groups = ['产品设计·总负责人', '课程部', '技术部', '战略部'];
    for (const group of groups) {
      await page.evaluate(
        (value) => document.querySelector(`[data-staff-group="${value}"]`).click(),
        group,
      );
      const subgroups = group === '课程部' ? ['数学组', '电路组', '信号组', '待确认'] : [''];
      for (const subgroup of subgroups) {
        if (subgroup) {
          await page.evaluate((value) => {
            const button = document.querySelector(`[data-staff-course-group="${value}"]`);
            if (!button.hidden) button.click();
          }, subgroup);
        }
        const count = await page.$$eval('.staff-avatar img', (images) => images.length);
        for (let index = 0; index < count; index += 1) {
          await page.evaluate(
            (position) =>
              document
                .querySelectorAll('.staff-avatar img')
                [position].scrollIntoView({ block: 'center' }),
            index,
          );
          await page.waitForFunction(
            (position) => document.querySelectorAll('.staff-avatar img')[position].complete,
            {},
            index,
          );
        }
      }
    }
    const originalsBeforeFirstOpen = lab.state.requests.filter((url) => originals.has(url));
    assert.deepEqual(originalsBeforeFirstOpen, []);
    const thumbnails = new Set(lab.state.requests.filter((url) => /-thumb\.webp$/.test(url)));
    assert.equal(thumbnails.size, 34, 'all groups together must request all 34 small thumbnails');
    report.checks.push('all four groups and course subgroups request zero original photos');
    await page.evaluate(() =>
      document.querySelector('[data-staff-group="产品设计·总负责人"]').click(),
    );
    const first = roster.members[0];
    await openPhoto(page, first.name);
    report.firstOriginal = await photoLoaded(page, first);
    assert.deepEqual(
      lab.state.requests.filter((url) => originals.has(url)),
      [first.photo],
    );
    await closeAndCheckFocus(page, first.name);
    report.checks.push(
      'first explicit open requests only its own original; Escape restores avatar focus',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
    );
    await page.screenshot({ path: path.join(output, `${spec.name}-list.png`), fullPage: true });

    if (spec.boundaries) {
      lab.state.hold = true;
      await openPhoto(page, first.name);
      await waitFor(() => lab.state.pending.length === 1);
      assert.equal(await page.$eval('#staff-photo-image', (image) => image.hidden), true);
      assert.equal(
        await page.$eval('#staff-photo-status', (status) => status.textContent),
        '正在加载完整照片…',
      );
      const second = roster.members[1];
      // Execute in one task to reproduce a queued native close event after the next opening.
      await page.evaluate((name) => {
        document.querySelector('#staff-photo-dialog').close();
        const card = [...document.querySelectorAll('.staff-person')].find(
          (node) => node.querySelector('.staff-person-name').textContent === name,
        );
        card.querySelector('.staff-avatar').click();
      }, second.name);
      await waitFor(() => lab.state.pending.length === 2);
      await lab.state.pending[0].send();
      assert.equal(await page.$eval('#staff-photo-name', (name) => name.textContent), second.name);
      await lab.state.pending[1].send();
      report.secondOriginal = await photoLoaded(page, second);
      await closeAndCheckFocus(page, second.name);
      lab.state.hold = false;
      report.checks.push(
        'slow original, immediate close/reopen, and late old response cannot replace the new member',
      );

      lab.state.fail.add(first.photo);
      await openPhoto(page, first.name);
      await page.waitForFunction(() =>
        document.querySelector('#staff-photo-status').textContent.includes('暂时无法显示'),
      );
      assert.equal(await page.$eval('#staff-photo-image', (image) => image.hidden), true);
      await closeAndCheckFocus(page, first.name);
      lab.state.fail.delete(first.photo);
      await openPhoto(page, first.name);
      await photoLoaded(page, first);
      await closeAndCheckFocus(page, first.name);
      report.checks.push('failed original remains recoverable through close and explicit retry');

      lab.state.fail.add(first.photoThumbnail);
      const beforeReload = lab.state.requests.filter((url) => originals.has(url)).length;
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.querySelectorAll('.staff-person').length > 0);
      await page.waitForFunction(() => document.querySelector('.staff-avatar img').complete);
      assert.equal(lab.state.requests.filter((url) => originals.has(url)).length, beforeReload);
      assert.equal(await page.$eval('.staff-avatar img', (image) => image.hidden), true);
      assert.equal(await page.$eval('.staff-avatar span', (fallback) => fallback.hidden), false);
      await openPhoto(page, first.name);
      await photoLoaded(page, first);
      await closeAndCheckFocus(page, first.name);
      report.checks.push(
        'failed thumbnail shows the name without automatically downloading the original',
      );
      lab.state.fail.delete(first.photoThumbnail);

      const candidates = await Promise.all(
        roster.members.map(async (member) => {
          const metadata = await sharp(path.join(root, member.photo)).metadata();
          const rotated = [5, 6, 7, 8].includes(metadata.orientation);
          return {
            ...member,
            ratio: rotated ? metadata.height / metadata.width : metadata.width / metadata.height,
          };
        }),
      );
      const sorted = candidates.sort((a, b) => a.ratio - b.ratio);
      for (const member of [sorted[0], sorted[sorted.length - 1]]) {
        const group = member.groups.includes('产品设计·总负责人')
          ? '产品设计·总负责人'
          : member.groups[0];
        await page.evaluate(
          (value) => document.querySelector(`[data-staff-group="${value}"]`).click(),
          group,
        );
        if (group === '课程部') {
          const subgroup = member.courseGroups?.[0] || '待确认';
          await page.evaluate(
            (value) => document.querySelector(`[data-staff-course-group="${value}"]`).click(),
            subgroup,
          );
        }
        await openPhoto(page, member.name);
        await photoLoaded(page, member);
        await page.screenshot({
          path: path.join(
            output,
            `${spec.name}-${member.ratio < 1 ? 'portrait' : 'landscape'}.png`,
          ),
        });
        await closeAndCheckFocus(page, member.name);
      }
      report.checks.push('widest and tallest original photos fit the viewport without cropping');
    }
    assert.deepEqual(errors, []);
    const originalRequests = lab.state.requests.filter((url) => originals.has(url));
    report.requestCounts = {
      originalsBeforeFirstOpen: originalsBeforeFirstOpen.length,
      uniqueThumbnails: new Set(lab.state.requests.filter((url) => /-thumb\.webp$/.test(url))).size,
      originalRequests: originalRequests.length,
      originalPaths: originalRequests,
    };
    return report;
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, `${spec.name}-failure.png`), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
    for (const pending of lab.state.pending) await pending.send();
    lab.server.closeAllConnections();
    await new Promise((resolve) => {
      lab.server.close(resolve);
    });
  }
}

async function main() {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'staff-photo-loading-'));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || process.env.CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const reports = [];
    for (const spec of [
      { name: 'desktop-light', width: 1440, height: 900, theme: 'light', boundaries: true },
      { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
      { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
      { name: 'mobile-dark-legacy', width: 390, height: 844, theme: 'dark', legacy: true },
    ])
      reports.push(await verifyScenario(browser, output, spec));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ reports }, null, 2));
    console.log(JSON.stringify({ output, reports }, null, 2));
  } finally {
    await browser.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { createStaffPhotoLab, verifyScenario };
