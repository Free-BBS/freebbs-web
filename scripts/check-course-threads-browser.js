// Real frontend, local memory fixtures, isolated browser; no user profile or network services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCourseThreadsPreview } = require('./preview-course-threads');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-course-threads-'));
  const preview = createCourseThreadsPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const report = { checks: [], layouts: [], screenshots: [], errors: [] };
  let browser;
  let page;
  let stage = 'launch';
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(output, 'isolated-profile'),
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) request.continue();
      else request.respond({ status: 204 });
    });
    await page.setViewport({ width: 1600, height: 1000 });
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    const capture = async (label, selector) => {
      if (selector)
        await page.$eval(selector, (el) =>
          el.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
      const file = path.join(output, `${label}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
    };
    const save = async (weeks) => {
      await page.$eval('#workbench-course-calendar-monday', (el) => {
        el.value = '2026-09-14';
      });
      await page.$eval(
        '#workbench-course-calendar-weeks',
        (el, value) => {
          el.value = value;
        },
        weeks,
      );
      const pending = page.waitForResponse(
        (res) =>
          res.url().endsWith('/api/workbench/campus/course-calendar') &&
          res.request().method() === 'PUT',
      );
      await page.click('#workbench-course-calendar-save');
      const response = await pending;
      const body = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(body));
      await page.waitForFunction(
        () => !document.querySelector('#workbench-course-calendar-save').disabled,
      );
      return body;
    };

    stage = 'calendar full/half/odd/even weeks';
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    const later = await page.$('.max-tour-later');
    if (later) await later.click();
    await page.waitForFunction(() =>
      document.querySelector('#workbench-course-calendar-status')?.textContent.includes('请先填写'),
    );
    assert.equal(await page.$eval('#workbench-course-calendar-weeks', (el) => el.value), '');
    const blank = await save('');
    assert.equal(blank.scheduledLessons, 18); // fixed 8 + 8 + explicit 2; full/odd/even need confirmation
    const confirmed = await save('16');
    assert.equal(confirmed.parsedCourses, 7);
    assert.equal(confirmed.totalCourses, 8);
    assert.equal(confirmed.scheduledLessons, 114);
    assert.match(confirmed.issues[0].message, /星期/);
    const ids = preview.workbench
      .courseProjection()
      .events.map((event) => event.publicId)
      .sort();
    await save('16');
    assert.deepEqual(
      preview.workbench
        .courseProjection()
        .events.map((event) => event.publicId)
        .sort(),
      ids,
    );
    assert.equal(new Set(ids).size, 114);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#workbench-course-calendar-weeks').value === '16',
    );
    const extended = await save('18');
    assert.equal(extended.scheduledLessons, 126);
    const latter = preview.workbench
      .courseProjection()
      .events.filter((event) => event.title.includes('后八周'));
    assert.equal(latter.length, 8);
    assert.ok(latter.every((event) => /第 (?:9|1[0-6]) 教学周/.test(event.description)));
    await save('16');
    report.checks.push(
      'Full/odd/even require confirmed calendar; half-semesters stay 1–8/9–16; repeat/reload stable; missing weekday rejected',
    );

    stage = 'ordinary events and courses share repeat controls';
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (el, next) => {
          Object.assign(el, { value: next });
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    const fillRepeat = async (kind, mode, until) => {
      await page.click('#workbench-add-schedule');
      await page.select('#workbench-schedule-kind', kind);
      await fill('#workbench-schedule-title', `模拟重复${kind}`);
      await fill('#workbench-schedule-start', '2026-10-04T18:00');
      await fill('#workbench-schedule-end', '2026-10-04T19:00');
      await page.select('#workbench-course-interval', mode);
      await fill('#workbench-repeat-until', until);
    };
    const submitRepeat = async () => {
      const pending = page.waitForResponse((res) =>
        res.url().endsWith('/api/workbench/recurring-events'),
      );
      await page.click('#workbench-schedule-submit');
      const res = await pending;
      return { status: res.status(), body: await res.json() };
    };
    const before = preview.workbench.events.length;
    await fillRepeat('event', '2', '2026-11-01');
    assert.match(await page.$eval('#workbench-repeat-summary', (el) => el.textContent), /3 次/);
    assert.equal((await submitRepeat()).status, 201);
    assert.equal(preview.workbench.events.length, before + 3);
    assert.ok(preview.workbench.events.slice(-3).every((event) => event.kind === 'event'));
    await fillRepeat('event', '2', '2026-11-01');
    assert.equal((await submitRepeat()).status, 409);
    assert.equal(preview.workbench.events.length, before + 3);
    await page.click('#workbench-schedule-dialog [data-workbench-dialog-close]');
    await fillRepeat('course', 'custom', '2026-10-13');
    await fill('#workbench-repeat-interval', '3');
    assert.match(await page.$eval('#workbench-repeat-summary', (el) => el.textContent), /4 次/);
    assert.equal((await submitRepeat()).body.code, 'course_conflict');
    assert.equal(preview.workbench.events.length, before + 3);
    assert.equal((await submitRepeat()).status, 201);
    assert.equal(preview.workbench.events.length, before + 7);
    assert.ok(preview.workbench.events.slice(-4).every((event) => event.kind === 'course'));
    report.checks.push(
      'Biweekly events + custom courses: exact preview, duplicate rejection, conflicts block until separately confirmed, complete series saved',
    );

    stage = 'workbench responsive typography';
    const preferences = [];
    for (const width of [1600, 1024, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        for (const fontPreset of [
          'transistor-lab',
          'zhongsong-study',
          'quantum-board',
          'night-oscilloscope',
        ]) {
          for (const typeScale of ['standard', 'large'])
            preferences.push({ width, theme, fontPreset, typeScale });
        }
      }
    }
    for (const pref of preferences) {
      await page.setViewport({ width: pref.width, height: 1000 });
      await page.evaluate((value) => {
        document.body.classList.toggle('theme-light', value.theme === 'light');
        document.body.classList.toggle('theme-dark', value.theme === 'dark');
        window.freeBbsTypography.applyPreferences(value);
        document.querySelectorAll('details.personal-fold').forEach((el) => {
          el.open = true;
        });
      }, pref);
      await settle();
      const layout = await page.evaluate(() => {
        const title = document.querySelector('.desktop-header-title');
        const fontProbe = document.createElement('span');
        fontProbe.style.fontFamily = 'var(--font-display)';
        document.body.append(fontProbe);
        const expectedFont = getComputedStyle(fontProbe).fontFamily;
        fontProbe.remove();
        const fields = [
          '#workbench-course-calendar-monday',
          '#workbench-course-calendar-weeks',
          '#workbench-course-calendar-save',
        ];
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          calendarFits: fields.every((selector) => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return box.left >= 0 && box.right <= window.innerWidth + 1;
          }),
          titleFont: title ? getComputedStyle(title).fontFamily : null,
          expectedFont,
          sectionSize: parseFloat(
            getComputedStyle(document.querySelector('.workbench-section-links')).fontSize,
          ),
          rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      });
      report.layouts.push({ page: 'workbench', ...pref, ...layout });
      assert.equal(layout.overflow, false, JSON.stringify({ ...pref, ...layout }));
      assert.equal(layout.calendarFits, true, JSON.stringify({ ...pref, ...layout }));
      if (pref.width > 900) {
        assert.equal(layout.titleFont, layout.expectedFont);
        assert.ok(layout.sectionSize >= layout.rootSize * 0.95);
      }
      if (
        ['1600', '390'].includes(String(pref.width)) &&
        pref.fontPreset === 'zhongsong-study' &&
        pref.typeScale === 'large'
      ) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await capture(`workbench-${pref.width}-${pref.theme}`);
        await capture(`calendar-${pref.width}-${pref.theme}`, '#workbench-course-calendar');
      }
    }
    report.checks.push(
      '64 workbench viewport/theme/font/size cases; header follows shared font; readable desktop text; calendar controls fit',
    );

    stage = 'repeat dialog on desktop and mobile';
    for (const width of [1600, 1024, 390, 320]) {
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
        await fillRepeat('event', 'custom', '2026-11-01');
        await fill('#workbench-repeat-interval', '3');
        assert.equal(
          await page.$eval(
            '#workbench-schedule-start',
            (el) => el.closest('label').querySelector('span').textContent,
          ),
          '首次开始时间',
        );
        const geometry = await page.$eval('#workbench-schedule-dialog', (el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          overflow: el.scrollWidth > el.clientWidth + 2,
        }));
        assert.ok(
          geometry.left >= 0 && geometry.right <= width + 1 && !geometry.overflow,
          JSON.stringify({ width, theme, ...geometry }),
        );
        if ([1600, 390].includes(width)) await capture(`repeat-${width}-${theme}`);
        await page.select('#workbench-schedule-kind', 'deadline');
        assert.equal(await page.$eval('#workbench-repeat-until', (el) => el.disabled), true);
        assert.equal(await page.$eval('#workbench-course-count', (el) => el.disabled), true);
        assert.equal(
          await page.$eval('#workbench-schedule-form', (el) => el.checkValidity()),
          true,
        );
        await page.click('#workbench-schedule-dialog [data-workbench-dialog-close]');
      }
    }
    report.checks.push(
      'Custom recurrence dialog fits 8 desktop/mobile theme cases; DDL disables hidden required fields',
    );

    stage = 'discussion categories, filtering and composer';
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${base}/discussion`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-board-slug="computer"]');
    const categoryNames = ['日常', '数学', '物理', '电路', '信号', '计算机', '实验', '更新日志'];
    assert.deepEqual(
      await page.$$eval('#discussion-compose-board option', (nodes) =>
        nodes.filter((el) => el.value).map((el) => el.textContent.trim()),
      ),
      categoryNames.filter((name) => name !== '更新日志'), // existing admin-only publishing restriction
    );
    await page.click('[data-board-slug="computer"]');
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('.discussion-post-card')];
      return cards.length === 3 && cards.every((el) => el.textContent.includes('计算机'));
    });
    await page.click('[data-board-slug="all"]');
    await page.waitForSelector('.discussion-post-card');
    for (const width of [1600, 1024, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewport({ width, height: 1000 });
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-light', mode === 'light');
          document.body.classList.toggle('theme-dark', mode === 'dark');
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
          window.scrollTo({ top: 0, behavior: 'instant' });
        }, theme);
        await settle();
        if (width > 900) {
          const sizes = await page.evaluate(() => ({
            root: parseFloat(getComputedStyle(document.documentElement).fontSize),
            title: parseFloat(
              getComputedStyle(document.querySelector('.discussion-post-title')).fontSize,
            ),
            excerpt: parseFloat(
              getComputedStyle(document.querySelector('.discussion-post-excerpt')).fontSize,
            ),
          }));
          assert.ok(
            sizes.title >= sizes.root * 1.3 && sizes.excerpt >= sizes.root,
            JSON.stringify(sizes),
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false,
        );
        if ([1600, 390].includes(width)) await capture(`discussion-list-${width}-${theme}`);
      }
    }
    report.checks.push(
      'Eight boards remain visible; changelog publishing stays admin-only; computer filter isolates 3 posts; list fits 8 theme/viewport cases',
    );

    stage = 'discussion live expand/collapse';
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${base}/discussion?post=101`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#comment-1011');
    const toggle = 'button[data-action="toggle-comment-thread"][data-thread-root="1010"]';
    const guide = '[data-thread-owner="1010"] .discussion-thread-path';
    const height = () => page.$eval(guide, (el) => el.getBoundingClientRect().height);
    const closedHeight = await height();
    await page.click(toggle);
    await settle();
    assert.ok((await height()) > closedHeight + 5, 'guides must expand without a full rerender');
    assert.equal(await page.$eval('#comment-1021', (el) => el.hidden), false);
    await page.click(toggle);
    await settle();
    assert.ok(
      Math.abs((await height()) - closedHeight) < 0.1,
      'collapsed stem returns to its original endpoint',
    );
    await page.click(toggle);
    await settle();
    assert.ok((await height()) > closedHeight + 5);
    assert.equal(await page.$eval('#comment-1016', (el) => el.dataset.commentDepth), '4');
    assert.equal(
      await page.$eval('#comment-1020 .discussion-comment-parent', (el) => el.getAttribute('href')),
      '#comment-1019',
    );
    report.checks.push(
      'Thread rails expand/collapse without rerender, deep indent capped, deleted parent anchor preserved',
    );
    stage = 'discussion responsive guides';
    for (const pref of preferences.filter((item) =>
      ['transistor-lab', 'zhongsong-study'].includes(item.fontPreset),
    )) {
      await page.setViewport({ width: pref.width, height: 1000 });
      await page.evaluate((value) => {
        document.body.classList.toggle('theme-light', value.theme === 'light');
        document.body.classList.toggle('theme-dark', value.theme === 'dark');
        window.freeBbsTypography.applyPreferences(value);
      }, pref);
      await settle();
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        rails: [...document.querySelectorAll('.discussion-thread-guides')].map((el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          interactive: getComputedStyle(el).pointerEvents,
          hidden: el.getAttribute('aria-hidden'),
        })),
      }));
      report.layouts.push({ page: 'discussion', ...pref, ...layout });
      assert.equal(layout.overflow, false, JSON.stringify(pref));
      assert.ok(
        layout.rails.every(
          (rail) =>
            rail.left >= 0 &&
            rail.right <= pref.width &&
            rail.interactive === 'none' &&
            rail.hidden === 'true',
        ),
      );
      if (
        [1600, 390].includes(pref.width) &&
        pref.fontPreset === 'zhongsong-study' &&
        pref.typeScale === 'large'
      )
        await capture(`threads-${pref.width}-${pref.theme}`, '#comment-1013');
    }
    report.checks.push(
      '32 discussion theme/font/size/viewport cases; rails decorative and inside viewport',
    );

    stage = 'homepage eight boards and bounded feeds with three sort modes';
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#home-discussion-list .home-feed-item');
    await page.waitForSelector('#home-board-activity .home-board-item');
    assert.equal(
      await page.$$eval('#home-discussion-list .home-feed-item', (rows) => rows.length),
      24,
    );
    assert.deepEqual(
      await page.$$eval('.home-board-name', (rows) => rows.map((row) => row.textContent.trim())),
      ['# 日常', '# 数学', '# 物理', '# 电路', '# 信号', '# 计算机', '# 实验', '# 更新日志'],
    );
    const orders = [];
    for (const mode of ['balanced', 'latest', 'hot', 'balanced']) {
      await page.select('#home-feed-toggle', mode);
      await page.waitForFunction(
        (sort) =>
          document.querySelector('#home-discussion-list').dataset.sort === sort &&
          !document.querySelector('#home-feed-toggle').disabled,
        {},
        mode,
      );
      orders.push(
        await page.$$eval('.home-feed-item', (rows) => rows.map((row) => row.getAttribute('href'))),
      );
    }
    assert.notDeepEqual(orders[0], orders[1]);
    assert.notDeepEqual(orders[1], orders[2]);
    assert.deepEqual(orders[0], orders[3]);
    for (const width of [1600, 1024, 390, 320]) {
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
        const layout = await page.evaluate(() => {
          const panels = [...document.querySelectorAll('.home-feed-panel, .home-board-panel')].map(
            (el) => el.getBoundingClientRect().height,
          );
          const lists = ['#home-discussion-list', '#home-board-activity'].map((selector) => {
            const el = document.querySelector(selector);
            el.scrollTop = 100;
            return {
              height: el.clientHeight,
              scrollHeight: el.scrollHeight,
              scrolled: el.scrollTop,
              overflow: getComputedStyle(el).overflowY,
            };
          });
          return {
            panels,
            lists,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        report.layouts.push({ page: 'home', width, theme, ...layout });
        assert.equal(layout.overflow, false);
        assert.ok(layout.lists[0].scrolled > 0);
        if (width > 900) {
          assert.ok(Math.abs(layout.panels[0] - layout.panels[1]) < 1);
          assert.ok(layout.lists.every((list) => list.scrolled > 0 && list.overflow === 'auto'));
        }
        await capture(`home-${width}-${theme}`, '.home-dashboard');
      }
    }
    report.checks.push(
      'Homepage 24 posts/8 boards, all 3 sorts, desktop equal-height scrolling and mobile no overflow',
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(`Course/thread browser checks passed: ${output}`);
  } catch (error) {
    report.failedStage = stage;
    report.error = error.stack;
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(`Failed during ${stage}. Artifacts: ${output}`);
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (browser) await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
