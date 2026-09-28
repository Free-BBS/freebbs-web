const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCalendarThreadsPreview } = require('./preview-calendar-threads');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-calendar-threads-'));
  const { server, workbench } = createCalendarThreadsPreview();
  const originals = structuredClone(workbench.events);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  let stage = 'setup';
  const errors = [];
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
      assert.equal(response.ok, true);
    }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      return url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
        ? request.continue()
        : request.respond({ status: 204 });
    });
    await page.evaluateOnNewDocument(() => {
      const Original = Date;
      window.Date = class extends Original {
        constructor(...args) {
          super(...(args.length ? args : ['2026-09-28T10:00:00+08:00']));
        }

        static now() {
          return new Original('2026-09-28T10:00:00+08:00').getTime();
        }
      };
    });
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    await page.setViewport({ width: 1600, height: 1000 });
    stage = 'calendar';
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.workbench-week-event.has-time-conflict');
    assert.equal(await page.$('.workbench-time-band, .workbench-deadline-legend'), null);
    assert.doesNotMatch(
      await page.$eval('#workbench-calendar', (e) => e.textContent),
      /色带按实际|斜纹标出|文字卡片显示|仅核对本周/,
    );
    assert.match(
      await page.$eval('#workbench-time-conflicts-summary', (e) => e.textContent),
      /1 组/,
    );
    await page.click('#workbench-time-conflicts-summary');
    assert.match(
      await page.$eval('#workbench-time-conflicts-list', (e) => e.textContent),
      /13:30.*14:00/,
    );
    const card = (id) => `.workbench-week-event[data-public-id="ws_${id}"]`;
    for (const [id, expected] of [
      ['urgent', 'critical'],
      ['soon', 'soon'],
      ['safe', 'safe'],
      ['overdue', 'overdue'],
    ])
      assert.equal(await page.$eval(card(id), (e) => e.dataset.deadlineState), expected);
    const importantTime = () =>
      page.$eval('#workbench-priority-list .workbench-important-time', (e) => e.textContent);
    assert.match(await importantTime(), /截止：9月28日.*20:00\n剩余：10 小时/);
    assert.equal(await page.$('#workbench-priority-list .workbench-deadline-status'), null);
    assert.doesNotMatch(
      await page.$eval('#workbench-priority-list', (e) => e.textContent),
      /24 小时内|72 小时内|DDL ·/,
    );
    await page.evaluate(() => {
      window.Date.now = () => new Date('2026-09-30T11:00:00+08:00').getTime();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.$eval(card('safe'), (e) => e.dataset.deadlineState), 'soon');
    assert.equal(await page.$eval(card('soon'), (e) => e.dataset.deadlineState), 'critical');
    assert.equal(await page.$eval(card('urgent'), (e) => e.dataset.deadlineState), 'overdue');
    assert.match(await importantTime(), /已逾期：1 天 15 小时/);
    await page.evaluate(() => {
      window.Date.now = () => new Date('2026-09-28T10:00:00+08:00').getTime();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const colours = await page.$$eval('.workbench-week-timeline .workbench-week-event', (nodes) =>
      nodes.map((node) => ({
        id: node.dataset.publicId,
        color: node.dataset.eventColor,
        rect: node.getBoundingClientRect().toJSON(),
      })),
    );
    const a = colours.find((entry) => entry.id === 'ws_meeting');
    const b = colours.find((entry) => entry.id === 'ws_course');
    assert.notEqual(a.color, b.color);
    const cards = await page.$$eval('.workbench-week-timeline .workbench-week-event', (nodes) =>
      nodes.map((node) => ({
        id: node.dataset.publicId,
        rect: node.getBoundingClientRect().toJSON(),
      })),
    );
    const meeting = cards.find((entry) => entry.id === 'ws_meeting').rect;
    const course = cards.find((entry) => entry.id === 'ws_course').rect;
    assert.ok(
      Math.min(meeting.right, course.right) > Math.max(meeting.left, course.left),
      'coloured card surfaces overlap',
    );
    assert.ok(
      Math.min(meeting.bottom, course.bottom) > Math.max(meeting.top, course.top),
      'conflicting cards retain overlapping start coordinates',
    );
    const assertFixedColumns = async () => {
      const geometry = await page.evaluate(() => ({
        expected: Math.max(
          196,
          Math.floor(document.querySelector('.workbench-week-scroll').clientWidth / 7),
        ),
        widths: [...document.querySelectorAll('.workbench-week-day')].map(
          (e) => e.getBoundingClientRect().width,
        ),
      }));
      assert.equal(geometry.widths.length, 7);
      assert.ok(
        geometry.widths.every((width) => Math.abs(width - geometry.expected) < 1),
        'conflicts never widen day columns',
      );
    };
    await assertFixedColumns();
    await page.click('#workbench-week-next');
    await page.waitForSelector(card('repeat'));
    assert.equal(await page.$eval(card('repeat'), (e) => e.dataset.eventColor), a.color);
    await page.click('#workbench-week-today');
    await page.waitForSelector(card('meeting'));
    let cases = 0;
    for (const width of [1600, 1024, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        for (const fontPreset of ['zhongsong-study', 'transistor-lab']) {
          for (const typeScale of ['standard', 'large']) {
            await page.setViewport({ width, height: 1000 });
            await page.evaluate(
              (prefs) => {
                document.body.classList.toggle('theme-light', prefs.theme === 'light');
                document.body.classList.toggle('theme-dark', prefs.theme === 'dark');
                window.freeBbsTypography.applyPreferences(prefs);
              },
              { theme, fontPreset, typeScale },
            );
            await settle();
            await assertFixedColumns();
            const adjacent = await page.$$eval(
              '.workbench-week-timeline .workbench-week-event',
              (nodes) => {
                const bounds = (id) =>
                  nodes.find((e) => e.dataset.publicId === id).getBoundingClientRect();
                return { courseEnd: bounds('ws_course').bottom, nextStart: bounds('ws_next').top };
              },
            );
            assert.ok(
              adjacent.courseEnd <= adjacent.nextStart + 0.1,
              'course and following task do not visually conflict',
            );
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > window.innerWidth + 1,
              ),
              false,
            );
            assert.ok(
              await page.$$eval('.workbench-week-event', (nodes) =>
                nodes.every(
                  (node) =>
                    node.scrollWidth <= node.clientWidth + 1 &&
                    (getComputedStyle(node).overflowY === 'hidden' ||
                      node.scrollHeight <= node.clientHeight + 1),
                ),
              ),
            );
            cases += 1;
          }
        }
        if ([1600, 390].includes(width)) {
          await page.$eval('.workbench-week-event[data-public-id="ws_meeting"]', (e) =>
            e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
          );
          await page.screenshot({ path: path.join(output, `calendar-${width}-${theme}.png`) });
        }
      }
    }
    assert.deepEqual(workbench.events, originals, 'viewing conflicts never changes schedules');
    stage = 'thread controls';
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${origin}/discussion?post=101`, { waitUntil: 'networkidle0' });
    const toggle = (id) => `#comment-${id} .discussion-comment-thread-toggle`;
    const click = (selector) => page.$eval(selector, (e) => e.click());
    const hidden = (id) => page.$eval(`#comment-${id}`, (e) => e.hidden);
    const assertTreeGeometry = async () => {
      await settle();
      const branches = await page.evaluate(() => {
        const rect = (id) =>
          document
            .querySelector(`#comment-${id} .discussion-comment-author-link .discussion-post-avatar`)
            .getBoundingClientRect();
        return [...document.querySelectorAll('.discussion-thread-guides g')].map((g) => {
          const id = g.dataset.threadOwner;
          const parent = rect(id);
          const svg = g.closest('svg').getBoundingClientRect();
          const paths = [...g.querySelectorAll('.discussion-thread-path')];
          const children = [
            ...document.querySelectorAll(
              `.discussion-comment[data-parent-comment-id="${id}"]:not([hidden])`,
            ),
          ].map((e) => rect(e.dataset.commentId));
          const first = paths[0].getPointAtLength(0);
          const end = paths[0].getPointAtLength(paths[0].getTotalLength());
          const controlRect = document
            .querySelector(`#comment-${id} .discussion-comment-thread-toggle`)
            .getBoundingClientRect();
          const normal = children.length && children[0].left > parent.left + parent.width / 2;
          return {
            id,
            startError:
              Math.abs(first.x + svg.left - parent.left - parent.width / 2) +
              Math.abs(first.y + svg.top - parent.bottom - 3),
            endError: Math.abs(
              end.y +
                svg.top -
                (normal
                  ? children.at(-1).top + children.at(-1).height / 2
                  : children.length
                    ? children[0].top - 3
                    : controlRect.top + controlRect.height / 2),
            ),
            count: paths.length,
            expectedCount: normal ? children.length : 1,
            toggleError: Math.abs(
              controlRect.left + controlRect.width / 2 - parent.left - parent.width / 2,
            ),
          };
        });
      });
      assert.ok(branches.length);
      branches.forEach((branch) => {
        assert.ok(branch.startError < 1, JSON.stringify(branch));
        assert.ok(branch.endError < 1, JSON.stringify(branch));
        assert.ok(branch.toggleError < 1, JSON.stringify(branch));
        assert.equal(branch.count, branch.expectedCount, JSON.stringify(branch));
      });
    };
    assert.equal(await hidden(1011), true);
    await assertTreeGeometry();
    await click(toggle(1010));
    assert.equal(await hidden(1016), false);
    await assertTreeGeometry();
    // A delayed image/composer changes one reply's height. Ancestor stems must
    // remeasure automatically, even though no expand/collapse action occurred.
    const trunkHeight = () =>
      page.$eval(
        '[data-thread-owner="1010"] .discussion-thread-path',
        (e) => e.getBoundingClientRect().height,
      );
    const initialTrunk = await trunkHeight();
    await page.$eval('#comment-1011 .discussion-comment-content', (e) => {
      e.style.paddingBottom = '120px';
    });
    await settle();
    await assertTreeGeometry();
    assert.ok((await trunkHeight()) > initialTrunk + 119);
    await page.$eval('#comment-1011 .discussion-comment-content', (e) => {
      e.style.paddingBottom = '';
    });
    await assertTreeGeometry();
    await page.$eval('#comment-1011', (e) =>
      e.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await settle();
    const hitPoint = await page.evaluate(() => {
      const p = document.querySelector('[data-thread-owner="1010"] .discussion-thread-hit');
      const avatar = document
        .querySelector('#comment-1011 .discussion-post-avatar')
        .getBoundingClientRect();
      const svg = p.closest('svg').getBoundingClientRect();
      const x = p.getPointAtLength(0).x + svg.left;
      const y = avatar.top - 12;
      return { x, y, hit: document.elementFromPoint(x, y)?.dataset.threadRoot };
    });
    assert.equal(hitPoint.hit, '1010', 'the ancestor rail itself is clickable');
    await page.mouse.click(hitPoint.x, hitPoint.y);
    assert.equal(await hidden(1011), true);
    await click(toggle(1010));
    await click(toggle(1012));
    assert.equal(await hidden(1013), true);
    assert.equal(await hidden(1018), false, 'siblings stay open');
    await assertTreeGeometry();
    await click(toggle(1010));
    await click(toggle(1010));
    assert.equal(await hidden(1013), true, 'nested state survives parent close/reopen');
    await click(toggle(1012));
    await click('#comment-1014 [data-action="reply-comment"]');
    const input = '#comment-1014 textarea';
    await page.waitForSelector(input);
    await page.type(input, '尚未发送的草稿');
    await settle();
    await page.$eval('[data-thread-owner="1012"] .discussion-thread-hit', (e) =>
      e.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    assert.equal(await hidden(1014), true);
    await click(toggle(1012));
    assert.equal(await page.$eval(input, (e) => e.value), '尚未发送的草稿');
    await click('#comment-1014 .discussion-comment-content');
    assert.equal(await hidden(1015), false, 'body does not fold');
    await click(toggle(1013));
    await page.evaluate(() => window.renderDiscussionComments());
    assert.equal(await hidden(1014), true, 'fold state survives rerender');
    await click(toggle(1013));
    assert.equal(await page.$eval(input, (e) => e.value), '尚未发送的草稿');
    for (const width of [1600, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewport({ width, height: 1000 });
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-light', mode === 'light');
          document.body.classList.toggle('theme-dark', mode === 'dark');
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        await settle();
        await assertTreeGeometry();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
        );
        await page.$eval('#comment-1012', (e) => e.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: path.join(output, `threads-${width}-${theme}.png`) });
        await page.focus(toggle(1012));
        await page.keyboard.press('Enter');
        assert.equal(await hidden(1013), true);
        await page.keyboard.press('Enter');
        assert.equal(await hidden(1013), false);
      }
    }
    stage = 'touch controls';
    await page.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true });
    await page.waitForSelector(toggle(1010));
    if (await hidden(1011)) await click(toggle(1010));
    await settle();
    assert.equal(
      await page.$eval('.discussion-thread-hit', (e) => getComputedStyle(e).pointerEvents),
      'none',
    );
    await page.$eval(toggle(1012), (e) =>
      e.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.tap(toggle(1012));
    assert.equal(await hidden(1013), true);
    await page.tap(toggle(1012));
    assert.equal(await hidden(1013), false);
    await assertTreeGeometry();
    await page.setViewport({ width: 1600, height: 1000, isMobile: false, hasTouch: false });
    stage = 'title focus';
    await page.goto(`${origin}/discussion`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.discussion-post-title');
    await page.focus('.discussion-post-title');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'discussion-detail-title');
    assert.deepEqual(
      await page.$eval('#discussion-detail-title', (e) => ({
        outline: getComputedStyle(e).outlineStyle,
        keyboard: e.matches(':focus-visible'),
        decoration: getComputedStyle(e).textDecorationLine,
      })),
      { outline: 'none', keyboard: true, decoration: 'underline' },
    );
    await page.goto(`${origin}/discussion?post=101#comment-1016`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.querySelector('#comment-1016')?.hidden);
    assert.equal(await hidden(1016), false, 'deep links reveal all ancestors');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await hidden(1016), false, 'direct deep-link loading also reveals ancestors');
    assert.deepEqual(errors, []);
    console.log(
      `Calendar/threads OK: ${cases} calendar + 6 thread layouts, real overlap, DDL boundaries, weekly colours, draft-preserving branch folding, keyboard title. ${output}`,
    );
  } catch (error) {
    console.error('Stage:', stage, 'Artifacts:', output);
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
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
