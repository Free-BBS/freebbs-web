// Interaction evidence only: isolated memory routes and simulated AI are not learning-outcome data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const preview = createLearningPreview();
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'human-reader-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary: 'Local UI, memory records and simulated AI only.',
    scenes: [],
    errors: [],
  };
  let browser;
  let page;
  let scene = 'initial';
  const checked = (name, details = {}) => report.scenes.push({ name, ...details });
  const visit = async (identity = 'student', extra = {}) => {
    const query = new URLSearchParams({
      course: 'signals',
      point: 'SS-02-01',
      as: identity,
      ...extra,
    });
    await page.goto(`${base}/knowledge?${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningReader?.getScrollHost && document.querySelector('#knowledge-body p'),
    );
    await page.waitForSelector('.learning-start-adjust');
    await page.evaluate(() => document.fonts.ready);
  };
  const closeMax = async () => {
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await page.click('#knowledge-chat-close');
  };
  const clickVisible = async (selector) => {
    const position = await page.$eval(selector, (item) => {
      const rect = item.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        usable:
          x >= 0 &&
          x < window.innerWidth &&
          y >= 0 &&
          y < window.innerHeight &&
          (hit === item || item.contains(hit)),
      };
    });
    assert.ok(position.usable, `A real pointer can reach ${selector}: ${JSON.stringify(position)}`);
    await page.mouse.click(position.x, position.y);
  };
  const bookmark = () =>
    page.evaluate(() => {
      const app = window.freeBbsApp;
      const key = window.FreeBbsLearningProgress.scopedKey(
        window.FreeBbsLearningReader.BASE,
        app.userState,
      );
      return (
        JSON.parse(localStorage.getItem(key) || '{}')[JSON.stringify(['signals', 'SS-02-01'])] ||
        null
      );
    });
  const readingPosition = (value) =>
    page.evaluate((mark) => {
      const api = window.FreeBbsLearningReader;
      const body = document.getElementById('knowledge-body');
      const blocks = api.readableBlocks(body);
      const version = window.freeBbsKnowledge.getLearningContext().node.documentVersion;
      const target = api.resolve(mark, blocks, version);
      const host = api.getScrollHost();
      const inset = ['knowledge-history', 'learning-annotation-toolbar'].reduce((sum, id) => {
        const item = document.getElementById(id);
        return (
          sum +
          (item && !item.hidden && !item.classList.contains('hidden')
            ? item.getBoundingClientRect().height
            : 0)
        );
      }, 16);
      const boundary = (host === window ? 0 : host.getBoundingClientRect().top) + inset;
      return {
        index: mark?.index,
        offset: target ? target.block.getBoundingClientRect().top - boundary : null,
        scrollTop: host === window ? window.scrollY : host.scrollTop,
        resolved: Boolean(target),
      };
    }, value);
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
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.setViewport({ width: 1440, height: 960 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({ status: 403, body: 'External services disabled' });
      // This preview does not mount the upload router; an empty public response is an explicit fixture.
      if (url.pathname.includes('/course-upload/public/'))
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: '{"files":[]}',
        });
      return request.continue();
    });

    scene = 'novice-can-read-without-setting';
    await visit();
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    assert.equal(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), null);
    assert.equal(
      await page.$eval(
        '#knowledge-reading',
        (item) => item.hidden || item.classList.contains('hidden'),
      ),
      false,
    );
    await closeMax();
    checked(scene);

    scene = 'optional-preference-cancel-and-return';
    await page.click('.learning-start-adjust');
    await page.select('.learning-start-dialog [name="level"]', 'new');
    await page.select('.learning-start-dialog [name="goal"]', 'concepts');
    await page.click('.learning-start-apply');
    const preference = await page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
    await page.click('.learning-start-adjust');
    await page.select('.learning-start-dialog [name="level"]', 'advanced');
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
      preference,
    );
    await visit();
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    assert.deepEqual(
      await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
      preference,
    );
    await closeMax();
    checked(scene);

    scene = 'interrupted-long-reading-resumes-after-reload';
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#knowledge-body p')];
      items[Math.floor(items.length * 0.55)].scrollIntoView({
        block: 'center',
        behavior: 'instant',
      });
    });
    await page.mouse.move(700, 600);
    await page.mouse.wheel({ deltaY: 150 });
    await page.waitForFunction(() => {
      const app = window.freeBbsApp;
      const key = window.FreeBbsLearningProgress.scopedKey(
        window.FreeBbsLearningReader.BASE,
        app.userState,
      );
      const value = JSON.parse(localStorage.getItem(key) || '{}')[
        JSON.stringify(['signals', 'SS-02-01'])
      ];
      return value?.index > 5;
    });
    const saved = await bookmark();
    const before = await readingPosition(saved);
    assert.ok(before.scrollTop > 300, 'Use the actual deep reader, not a short relations fixture');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.FreeBbsLearningReader?.getScrollHost);
    const after = await readingPosition(saved);
    assert.ok(after.resolved);
    assert.ok(
      Math.abs(after.offset - saved.offset) <= 3,
      `${JSON.stringify({ saved, before, after })}`,
    );
    checked(scene, { before, after });

    scene = 'return-to-last-reading-position-survives-going-back-to-the-header';
    await page.mouse.move(700, 600);
    await page.mouse.wheel({ deltaY: -10000 });
    await page.waitForFunction(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      return (host === window ? window.scrollY : host.scrollTop) < 200;
    });
    // Let the ordinary scroll bookmark capture finish: the entry-position shortcut must
    // not quietly become a shortcut to the header that the learner is already viewing.
    await page.waitForFunction(() => {
      const app = window.freeBbsApp;
      const key = window.FreeBbsLearningProgress.scopedKey(
        window.FreeBbsLearningReader.BASE,
        app.userState,
      );
      return (
        JSON.parse(localStorage.getItem(key) || '{}')[JSON.stringify(['signals', 'SS-02-01'])]
          ?.index < 5
      );
    });
    await clickVisible('#learning-reader-resume');
    const resumedFromHeader = await readingPosition(saved);
    assert.ok(
      Math.abs(resumedFromHeader.offset - saved.offset) <= 3,
      `Entry bookmark should survive header navigation: ${JSON.stringify({ saved, resumedFromHeader })}`,
    );
    checked(scene, { resumedFromHeader });

    scene = 'same-paragraph-survives-Max-width-and-tool-switches';
    await page.evaluate(() => {
      window.readerTrace = [];
      const api = window.FreeBbsLearningReader;
      const trace = (action) => {
        const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
        const host = api.getScrollHost();
        window.readerTrace.push({
          action,
          tool: document.querySelector('[data-knowledge-page]').dataset.learningTool,
          y: host === window ? window.scrollY : host.scrollTop,
          host: host === window ? 'window' : host.className,
          bookmark: JSON.parse(localStorage.getItem(key) || '{}')[
            JSON.stringify(['signals', 'SS-02-01'])
          ],
        });
      };
      const original = api.restore;
      api.restore = (...args) => {
        trace('before restore');
        const result = original(...args);
        trace('after restore');
        return result;
      };
      for (const name of [
        'knowledge:before-tool-change',
        'knowledge:tool-select',
        'knowledge:view-change',
      ])
        document.querySelector('[data-knowledge-page]').addEventListener(name, () => trace(name));
    });
    const initial = await readingPosition(saved);
    await clickVisible('#knowledge-chat-toggle');
    await page.waitForSelector('#knowledge-chat-close', { visible: true });
    await clickVisible('#knowledge-chat-close');
    await page.waitForFunction(
      () =>
        !document.querySelector('.knowledge-workbench').classList.contains('is-interaction-open'),
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const toggled = await readingPosition(saved);
    assert.ok(Math.abs(toggled.offset - initial.offset) <= 3, JSON.stringify({ initial, toggled }));
    await clickVisible('[data-knowledge-tool="feedback"]');
    await clickVisible('[data-knowledge-tool="content"]');
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const returned = await readingPosition(saved);
    assert.ok(
      Math.abs(returned.offset - initial.offset) <= 3,
      JSON.stringify({ initial, returned }),
    );
    checked(scene, { initial, toggled, returned });

    scene = 'shared-large-type-keeps-meaning-and-position';
    const sizeBefore = await page.$eval('#knowledge-body', (item) =>
      Number.parseFloat(getComputedStyle(item).fontSize),
    );
    await page.select('.learning-reading-size select', 'large');
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const resized = await readingPosition(saved);
    const sizeAfter = await page.$eval('#knowledge-body', (item) =>
      Number.parseFloat(getComputedStyle(item).fontSize),
    );
    assert.ok(sizeAfter > sizeBefore);
    assert.ok(Math.abs(resized.offset - initial.offset) <= 4, JSON.stringify({ resized, initial }));
    assert.deepEqual(
      await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()),
      preference,
    );
    assert.equal(preview.starsStore.rows.length, 0);
    checked(scene, { sizeBefore, sizeAfter, resized });
    await page.screenshot({ path: path.join(output, 'reader-large-deep.png') });

    scene = 'explicit-question-route-wins-over-bookmark';
    await visit('student', { tool: 'feedback', quiz: 'quick', question: 'SS-02-01-Q04' });
    assert.equal(
      await page.$eval('[data-knowledge-page]', (item) => item.dataset.learningTool),
      'feedback',
    );
    assert.equal(
      await page.$eval(
        '#knowledge-reading',
        (item) => item.hidden || item.classList.contains('hidden'),
      ),
      true,
    );
    await page.waitForSelector('[data-question-id="SS-02-01-Q04"]');
    checked(scene);

    scene = 'other-user-has-neither-preference-nor-original-bookmark';
    await visit('other', { tool: 'content' });
    await closeMax();
    assert.equal(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), null);
    const other = await bookmark();
    assert.ok(
      !other || other.index < 5,
      "Another reader starts near the beginning, not the first user's deep position",
    );
    checked(scene, { otherBookmark: other });

    scene = 'reader-private-content-and-AI-boundaries';
    assert.equal(
      preview.requests.length,
      0,
      'Navigation, font choice, preferences and notes tools never auto-call Max',
    );
    assert.equal(preview.assessmentStore.rows.length, 0, 'UI convenience does not submit answers');
    assert.equal(preview.starsStore.rows.length, 0, 'UI convenience is not star evidence');
    assert.deepEqual(report.errors, []);
    checked(scene);
    report.ok = true;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.ok = false;
    report.failedScene = scene;
    report.failure = error.message;
    if (page) {
      report.dom = await page
        .evaluate(() => ({
          tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
          body: document.querySelector('#knowledge-body')?.getBoundingClientRect().height,
          open: document
            .querySelector('.knowledge-workbench')
            ?.classList.contains('is-interaction-open'),
          trace: window.readerTrace,
        }))
        .catch(() => null);
      await page.screenshot({ path: path.join(output, 'reader-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(output, 'reader-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify({ output, ...report }));
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections?.();
    });
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
