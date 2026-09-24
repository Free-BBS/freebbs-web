// Loopback-only simulated APIs; no production database or account is used.
// PUPPETEER_MODULE and CHROMIUM_EXECUTABLE may point to an existing browser runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

const NOW = Date.parse('2026-09-24T06:00:00Z');
const ORIGINAL_MESSAGE =
  '我今天晚上9点要开书记会，罗姆楼5103；10点要开支书例会，罗姆楼10-206，两个会都是1小时';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-workbench-batch-browser-'));
  const preview = createWorkbenchPreviewApi({ now: () => NOW });
  preview.events.splice(0, preview.events.length);
  const calls = [];
  const errors = [];
  const report = { now: new Date(NOW).toISOString(), checks: [], styles: [], screenshots: [] };
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html' },
    previewApiHandler: async (request) => {
      const result = await preview.handle(request);
      if (request.route.startsWith('/api/workbench/schedule-planner/')) {
        calls.push({
          route: request.route,
          method: request.method,
          body: structuredClone(request.body),
          status: result?.status || 200,
        });
      }
      return result;
    },
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  let stage = 'launch isolated Chrome';
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(directory, 'chrome-profile'),
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateTimezone('Asia/Shanghai');
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
    }, NOW);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === base) request.continue();
      else request.respond({ status: 204 });
    });
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (element, next) => {
          Object.assign(element, { value: next });
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        },
        value,
      );
    const cards = () =>
      page.$$eval('.workbench-agent-proposal', (elements) =>
        elements.map((element) => ({
          title: element.querySelector('.workbench-proposal-title').value,
          description: element.querySelector('.workbench-proposal-description').value,
          start: element.querySelector('.workbench-proposal-start')?.value,
          end: element.querySelector('.workbench-proposal-end').value,
        })),
      );
    const waitStatus = (text) =>
      page.waitForFunction(
        (expected) =>
          document.querySelector('#workbench-agent-status')?.textContent.includes(expected),
        {},
        text,
      );
    const requestByClick = async (action, selector) => {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url() === `${base}/api/workbench/schedule-planner/${action}` &&
          response.request().method() === 'POST',
      );
      await page.click(selector);
      const response = await responsePromise;
      const body = await response.json();
      await page.waitForFunction(
        (target) => !document.querySelector(target).disabled,
        {},
        selector,
      );
      return { status: response.status(), body };
    };
    const generate = async (message, expectedStatus, count = 0) => {
      await fill('#workbench-agent-message', message);
      const result = await requestByClick('preview', '#workbench-agent-generate');
      assert.equal(result.status, expectedStatus, JSON.stringify(result.body));
      assert.equal((await cards()).length, count);
      return result;
    };
    const confirm = (expectedStatus) =>
      requestByClick('confirm', '#workbench-agent-confirm').then((result) => {
        assert.equal(result.status, expectedStatus, JSON.stringify(result.body));
        return result;
      });
    const snapshot = () => structuredClone(preview.events);
    const checkUnchanged = (before) => assert.deepEqual(preview.events, before);
    const screenshot = async (name) => {
      const target = path.join(directory, `${name}.png`);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: target, fullPage: true });
      report.screenshots.push(target);
    };

    stage = 'open deterministic workbench';
    await page.goto(`${base}/workbench`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.workbench-week-hour');
    await page.waitForFunction(() => window.freeBbsApp?.userState?.isLoggedIn);

    stage = 'original two-event message produces separate previews without writes';
    await generate(ORIGINAL_MESSAGE, 200, 2);
    assert.deepEqual(await cards(), [
      {
        title: '书记会',
        description: '罗姆楼5103',
        start: '2026-09-24T21:00',
        end: '2026-09-24T22:00',
      },
      {
        title: '支书例会',
        description: '罗姆楼10-206',
        start: '2026-09-24T22:00',
        end: '2026-09-24T23:00',
      },
    ]);
    assert.equal(preview.events.length, 0, 'Generating a preview must not persist any item');
    assert.equal(calls.filter((call) => call.route.endsWith('/confirm')).length, 0);
    report.originalPreview = await cards();
    report.checks.push(
      'Original message: two distinct events, inherited evening and duration, per-event rooms, no preview writes',
    );

    stage = 'transparent neutral hour labels at desktop/mobile in both themes';
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.body.classList.toggle('theme-light', value === 'light');
        document.body.classList.toggle('theme-dark', value === 'dark');
      }, theme);
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: 1000 });
        const collapsedPlanner = await page.$(
          'details.personal-fold:has(.workbench-agent-card):not([open]) > summary',
        );
        if (collapsedPlanner) await collapsedPlanner.click();
        await page.waitForFunction(
          () =>
            !document
              .getAnimations()
              .some(
                (animation) =>
                  animation.playState === 'running' &&
                  Number.isFinite(animation.effect.getComputedTiming().iterations),
              ),
        );
        const style = await page.$$eval('.workbench-week-hour', (elements) => ({
          labelCount: elements.length,
          labels: [
            ...new Set(
              elements.map((element) => {
                const computed = getComputedStyle(element);
                return JSON.stringify({
                  background: computed.backgroundColor,
                  backgroundImage: computed.backgroundImage,
                  color: computed.color,
                  fontSize: computed.fontSize,
                  boxShadow: computed.boxShadow,
                });
              }),
            ),
          ].map((value) => JSON.parse(value)),
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          hoursFormFits: (() => {
            const form = document.querySelector('#workbench-hours-form');
            return form.scrollWidth <= form.clientWidth;
          })(),
          proposalsFit: [...document.querySelectorAll('.workbench-agent-proposal')].every(
            (card) => card.scrollWidth <= card.clientWidth,
          ),
        }));
        report.styles.push({ theme, width, ...style });
        if (!style.pageFits) {
          report.overflowElements = await page.$$eval('body *', (elements) =>
            elements
              .filter((element) => !element.closest('.workbench-week-grid'))
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  tag: element.tagName,
                  id: element.id,
                  className: element.className,
                  left: rect.left,
                  right: rect.right,
                  width: rect.width,
                };
              })
              .filter((element) => element.width > 0 && element.right > window.innerWidth)
              .slice(0, 40),
          );
        }
        assert.ok(style.labelCount > 0);
        assert.ok(style.pageFits, `${theme}/${width}: page must not overflow horizontally`);
        assert.ok(style.hoursFormFits, `${theme}/${width}: hour controls must fit`);
        assert.ok(style.proposalsFit, `${theme}/${width}: editable proposal cards must fit`);
        for (const label of style.labels) {
          assert.match(label.background, /^(?:transparent|rgba\(0, 0, 0, 0\))$/);
          assert.equal(label.backgroundImage, 'none');
          assert.equal(label.boxShadow, 'none');
          const channels = label.color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
          assert.ok(
            Math.max(...channels) - Math.min(...channels) <= 8,
            `Hour text must be neutral grey (${theme}/${width}: ${label.color})`,
          );
          assert.ok(
            Math.min(...channels) >= 60 && Math.max(...channels) <= 220,
            'Hour text must be visible grey, not black or white',
          );
        }
        await screenshot(`two-event-preview-${theme}-${width}`);
      }
    }
    report.checks.push(
      '1440px/390px, light/dark: transparent hour labels, neutral grey text, no page/control overflow',
    );

    stage = 'edit each note and confirm both events with one request';
    await page.setViewport({ width: 1440, height: 1000 });
    const editedNotes = ['罗姆楼5103；带会议记录本', '罗姆楼10-206；提前五分钟到场'];
    for (let index = 0; index < editedNotes.length; index += 1) {
      await fill(
        `.workbench-agent-proposal:nth-child(${index + 1}) .workbench-proposal-description`,
        editedNotes[index],
      );
    }
    const saved = await confirm(201);
    assert.equal(saved.body.created, 2);
    await waitStatus('已加入 2');
    assert.equal(calls.filter((call) => call.route.endsWith('/confirm')).length, 1);
    assert.equal(preview.events.length, 2);
    assert.deepEqual(
      preview.events.map((item) => item.description),
      editedNotes,
    );
    assert.deepEqual(
      preview.events.map((item) => [item.title, item.startAt, item.endAt]),
      [
        ['书记会', '2026-09-24T13:00:00.000Z', '2026-09-24T14:00:00.000Z'],
        ['支书例会', '2026-09-24T14:00:00.000Z', '2026-09-24T15:00:00.000Z'],
      ],
    );
    assert.equal((await cards()).length, 0);
    report.checks.push('Per-card edited notes survive one atomic confirmation of two events');
    await screenshot('two-events-confirmed-desktop');

    stage = 'three-event batch succeeds';
    const beforeThree = snapshot();
    await generate(
      '明天上午9点开课程部会，六教101；10点开技术部会，六教102；11点开战略部会，六教103，三个会都是1小时',
      200,
      3,
    );
    checkUnchanged(beforeThree);
    assert.deepEqual(
      (await cards()).map((item) => [item.start, item.end]),
      [
        ['2026-09-25T09:00', '2026-09-25T10:00'],
        ['2026-09-25T10:00', '2026-09-25T11:00'],
        ['2026-09-25T11:00', '2026-09-25T12:00'],
      ],
    );
    assert.equal((await confirm(201)).body.created, 3);
    await waitStatus('已加入 3');
    assert.equal(preview.events.length, beforeThree.length + 3);
    report.checks.push('Three-event batch previews and saves all three');

    stage = 'four-event batch is rejected without partial writes';
    const beforeFour = snapshot();
    await generate('后天上午8点开一会；9点开二会；10点开三会；11点开四会，四个会都是1小时', 422);
    checkUnchanged(beforeFour);
    report.checks.push('Four-event batch: HTTP 422, no partial preview or persistence');

    stage = 'overlap within a preview batch is rejected';
    const beforeOverlap = snapshot();
    await generate('后天上午9点开设计会；9点半开评审会，两个会都是1小时', 409);
    checkUnchanged(beforeOverlap);
    report.checks.push('Overlapping events in a preview batch: HTTP 409, no writes');

    stage = 'existing schedule conflict rejects the entire preview';
    await generate(ORIGINAL_MESSAGE, 409);
    checkUnchanged(beforeOverlap);
    report.checks.push('Existing schedule conflict: HTTP 409, no partial preview or writes');

    stage = 'edited preview overlap rejects the entire confirmation';
    const conflictMessage = '后天上午9点开设计会；10点开评审会，两个会都是1小时';
    await generate(conflictMessage, 200, 2);
    await fill(
      '.workbench-agent-proposal:nth-child(2) .workbench-proposal-start',
      '2026-09-26T09:30',
    );
    await fill(
      '.workbench-agent-proposal:nth-child(2) .workbench-proposal-end',
      '2026-09-26T10:30',
    );
    await confirm(409);
    await waitStatus('未写入');
    checkUnchanged(beforeOverlap);
    assert.equal((await cards()).length, 2, 'Rejected edits should remain reviewable');
    report.checks.push(
      'User-edited intra-batch overlap: one rejected confirmation, zero inserted rows',
    );

    stage = 'a schedule added after preview prevents all confirmation writes';
    await generate(conflictMessage, 200, 2);
    preview.events.push({
      publicId: 'ws_arrived_after_preview',
      title: '预览后新增的已有安排',
      description: '本地冲突夹具',
      startAt: '2026-09-26T02:15:00.000Z',
      endAt: '2026-09-26T02:45:00.000Z',
      allDay: false,
      status: 'confirmed',
      sourceType: 'manual',
      kind: 'event',
      version: 1,
    });
    const beforeRace = snapshot();
    await confirm(409);
    await waitStatus('未写入');
    checkUnchanged(beforeRace);
    report.checks.push(
      'Existing schedule changed after preview: HTTP 409, whole batch remains unwritten',
    );
    assert.deepEqual(errors, []);
    report.passed = true;
    report.finalEventCount = preview.events.length;
    console.log(`Workbench batch browser checks passed. Report and screenshots: ${directory}`);
  } catch (error) {
    report.passed = false;
    report.failedStage = stage;
    report.failure = error.stack || error.message;
    if (page) {
      await page
        .screenshot({ path: path.join(directory, 'failure.png'), fullPage: true })
        .catch(() => {});
    }
    console.error(`Workbench batch browser failed during ${stage}. Artifacts: ${directory}`);
    throw error;
  } finally {
    report.pageErrors = errors;
    report.calls = calls;
    fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (browser) await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
