// Real Chrome DOM with an isolated loopback memory backend. These 121 suggestions
// are QA fixtures, not formal course materials, real student records or outcomes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const cards = '#learning-review-records .learning-record';
const card = (id) => `${cards}[data-record-id="${id}"]`;
const reply = (id) => `${card(id)} textarea`;
const more = '.learning-review-more';
async function click(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (item) =>
    item.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.waitForFunction(
    (value) => {
      const item = document.querySelector(value);
      const rect = item?.getBoundingClientRect();
      if (!rect) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return item === hit || item.contains(hit);
    },
    {},
    selector,
  );
  await page.click(selector);
}
async function fill(page, selector, value) {
  await click(page, selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
}
async function main() {
  const preview = createLearningPreview();
  const context = await preview.store.context('signals', 'SS-01-01');
  for (let index = 1; index <= 121; index += 1)
    await preview.store.create(
      users.student,
      context,
      {
        kind: 'contribution',
        category: 'suggestion',
        title: `本地复核夹具 ${index}`,
        content: '仅用于本地交互回归，不是正式课程意见。',
      },
      `local-browser-fixture-${index}`,
    );
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-human-contribution-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    fixture: '121 synthetic memory suggestions, real local routers; no real accounts or AI.',
    base,
    output,
    passed: [],
    screenshots: [],
    pageErrors: [],
    reviewRequests: [],
    blockedExternal: [],
    dialogs: [],
    browserClosed: false,
    serverClosed: false,
  };
  let browser;
  let page;
  let failMore = false;
  let holdMore = false;
  let heldPage = null;
  let holdSave = false;
  let heldSave = null;
  const pass = (name) => {
    report.passed.push(name);
    console.log(`PASS ${name}`);
  };
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      report.dialogs.push(dialog.type());
      await dialog.accept();
    });
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      });
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== base) {
        report.blockedExternal.push(`${url.origin}${url.pathname}`);
        return request.respond({ status: 403, body: 'External services disabled in local QA' });
      }
      if (url.pathname.includes('/entries') && url.searchParams.get('review') === 'pending') {
        report.reviewRequests.push({ before: url.searchParams.get('before') });
        if (url.searchParams.has('before') && holdMore) {
          holdMore = false;
          heldPage = request;
          return undefined;
        }
        if (url.searchParams.has('before') && failMore) {
          failMore = false;
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: '本地夹具模拟加载失败' }),
          });
        }
      }
      if (url.pathname.endsWith('/review') && request.method() === 'PATCH' && holdSave) {
        holdSave = false;
        heldSave = request;
        return undefined;
      }
      return request.continue();
    });
    const visit = async (identity = 'manager') => {
      await page.goto(
        `${base}/knowledge?course=signals&point=SS-01-01&tool=contribute&as=${identity}`,
        { waitUntil: 'networkidle0' },
      );
      if (await page.$('.learning-start-dialog[open]')) {
        await page.select('[data-learning-start-choice="level"]', 'familiar');
        await click(page, '.learning-start-dialog[open] .learning-start-apply');
      }
      await click(page, '[data-knowledge-tool="contribute"]');
    };
    const screenshot = async (name) => {
      const filename = path.join(output, `${name}.png`);
      await page.screenshot({ path: filename });
      report.screenshots.push(filename);
    };
    const count = (amount) =>
      page.waitForFunction(
        (selector, value) => document.querySelectorAll(selector).length === value,
        {},
        cards,
        amount,
      );
    await visit();
    await count(50);
    assert.match(await page.$eval('.learning-review-count', (item) => item.textContent), /50 条/);
    await fill(page, reply(100), 'B 回复仍在输入中');
    failMore = true;
    await click(page, more);
    await page.waitForFunction(() =>
      document.querySelector('#learning-review-records').textContent.includes('模拟加载失败'),
    );
    assert.equal(await page.$eval(reply(100), (item) => item.value), 'B 回复仍在输入中');
    const failedCursor = report.reviewRequests.at(-1).before;
    await click(page, more);
    await count(100);
    assert.equal(report.reviewRequests.at(-1).before, failedCursor);
    await click(page, more);
    await count(121);
    assert.equal(await page.$(more), null);
    pass('121 pending suggestions browsable by real before pages, failed page retries same cursor');
    await screenshot('01-older-suggestions');

    await fill(page, reply(121), 'A 处理说明');
    holdSave = true;
    await click(page, `${card(121)} button`);
    await page.waitForFunction(
      (selector) => document.querySelector(selector).disabled,
      {},
      reply(121),
    );
    await fill(page, reply(100), '0');
    await page.keyboard.press('ArrowLeft');
    const selection = await page.$eval(reply(100), (item) => {
      window.qaContributionReply = item;
      return item.selectionStart;
    });
    report.focusBeforeSave = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      key: document.activeElement?.dataset.reviewKey,
    }));
    assert.ok(heldSave, 'actual PATCH was held while B continued editing');
    await heldSave.continue();
    await count(120);
    assert.equal(preview.store.rows.find((row) => String(row.id) === '121').status, 'handled');
    assert.equal(await page.$eval(reply(100), (item) => item.value), '0');
    report.focusAfterSave = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      key: document.activeElement?.dataset.reviewKey,
    }));
    assert.equal(await page.$eval(reply(100), (item) => item === document.activeElement), true);
    assert.equal(await page.$eval(reply(100), (item) => item === window.qaContributionReply), true);
    assert.equal(await page.$eval(reply(100), (item) => item.selectionStart), selection);
    pass('processing A preserves all browsed pages, B zero reply, keyboard focus and caret');
    await screenshot('02-A-complete-B-preserved');

    await click(page, '#learning-review-refresh');
    await count(50);
    assert.equal(await page.$eval(reply(100), (item) => item.value), '0');
    await click(page, '[data-knowledge-tool="resources"]');
    await click(page, '[data-knowledge-tool="contribute"]');
    assert.equal(await page.$eval(reply(100), (item) => item.value), '0');
    pass('explicit head refresh and tool switches preserve matching review reply');

    holdMore = true;
    await click(page, more);
    assert.ok(heldPage, 'actual pending page request was held');
    await page.evaluate(() => {
      const app = window.freeBbsApp;
      app.userState.uid = 'u_learning02';
      app.userState.token = 'learning-preview-other';
      app.userState.isLoggedIn = true;
      window.dispatchEvent(new CustomEvent('freebbs:session-change'));
    });
    await heldPage.continue();
    await page.waitForFunction(
      () =>
        document.querySelector('#learning-review-section').hidden &&
        document.querySelectorAll('#learning-review-records textarea').length === 0,
    );
    pass('account switch clears private replies and refuses a late old-manager page');
    assert.equal(preview.requests.length, 0);
    assert.deepEqual(report.pageErrors, []);
    pass('no automatic Max requests or browser JavaScript errors');
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.error = error.stack || String(error);
    if (page) {
      const filename = path.join(output, 'failure.png');
      await page.screenshot({ path: filename });
      report.screenshots.push(filename);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
      report.browserClosed = true;
    }
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections?.();
    });
    report.serverClosed = true;
    fs.writeFileSync(
      path.join(output, 'contribution-browser-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        report: path.join(output, 'contribution-browser-report.json'),
        passed: report.passed.length,
        error: report.error || null,
      }),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
