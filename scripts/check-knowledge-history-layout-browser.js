// Real knowledge renderer, local long-form fixture, isolated browser, no account writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview, courseFixture } = require('./preview-onboarding');
const { emptyProgress } = require('../backend/onboarding');

async function measure(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const history = document.getElementById('knowledge-history');
    const body = document.getElementById('knowledge-body');
    return {
      count: document.querySelectorAll('#knowledge-history').length,
      beforeBody: history.nextElementSibling === body,
      outsideBody: !body.contains(history),
      position: getComputedStyle(history).position,
      background: getComputedStyle(history).backgroundColor,
      history: history.getBoundingClientRect().toJSON(),
      body: body.getBoundingClientRect().toJSON(),
      title: document.getElementById('knowledge-title').getBoundingClientRect().toJSON(),
      scrollY: window.scrollY,
      viewport: window.innerWidth,
      sections: body.querySelectorAll('h3').length,
      formulae: body.querySelectorAll('.katex').length,
      expanded: document.getElementById('knowledge-history-toggle').getAttribute('aria-expanded'),
    };
  });
}

async function main() {
  const preview = createOnboardingPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-knowledge-history-qa-'));
  const fixture = courseFixture('math');
  const node = fixture.nodes[0];
  node.markdown = [
    '## 长正文与公式布局回归',
    ...Array.from(
      { length: 12 },
      (_, index) =>
        `### 第 ${index + 1} 节：开集与变化率\n\n这里的 $\\delta_x$ 可以随点 $x$ 改变，并不要求所有点共用同一个 $\\delta$。闭区间的端点并非内点。\n\n$$h = \\Delta x$$\n\n继续阅读这一小节，不应被知识起源说明遮挡。`,
    ),
  ].join('\n\n');
  node.sections.knowledgeMarkdown = node.markdown;
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  const rejected = [];
  const snapshots = [];
  console.log(`Knowledge history QA artifacts: ${output}`);
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin === base && url.pathname === '/api/onboarding') {
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...emptyProgress(url.searchParams.get('version') || undefined),
            status: 'skipped',
            seenAt: '2026-09-24T00:00:00.000Z',
          }),
        });
      }
      if (url.origin !== base || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        rejected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return request.respond({ status: 403, contentType: 'application/json', body: '{}' });
      }
      if (url.pathname === `/api/courses/math/map/nodes/${node.id}`) {
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ course: fixture.course, node }),
        });
      }
      return request.continue();
    });
    for (const width of [1440, 768, 390, 320]) {
      for (const dark of [false, true]) {
        const label = `${width}-${dark ? 'dark' : 'light'}`;
        await page.setViewport({ width, height: 960 });
        await page.goto(`${base}/knowledge?course=math&point=${node.id}`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForFunction(
          () => document.querySelectorAll('#knowledge-body h3').length === 12,
        );
        await page.evaluate((isDark) => {
          document.body.classList.toggle('theme-dark', isDark);
          document.body.classList.toggle('theme-light', !isDark);
          if (
            document.getElementById('knowledge-chat-toggle').getAttribute('aria-expanded') ===
            'true'
          )
            document.getElementById('knowledge-chat-close').click();
          document.getElementById('knowledge-start-reading').click();
          if (
            document.getElementById('knowledge-history-toggle').getAttribute('aria-expanded') ===
            'false'
          )
            document.getElementById('knowledge-history-toggle').click();
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, 0);
        }, dark);
        const start = await measure(page);
        assert.equal(start.count, 1, label);
        assert.equal(start.beforeBody, true, label);
        assert.equal(start.outsideBody, true, label);
        assert.equal(start.position, 'sticky', label);
        assert.ok(start.title.bottom <= start.history.top, `${label}: after title`);
        assert.ok(start.history.bottom <= start.body.top, `${label}: before formal body`);
        assert.ok(
          start.history.left >= 0 && start.history.right <= width + 1,
          `${label}: in viewport`,
        );
        assert.equal(start.sections, 12, label);
        assert.ok(start.formulae >= 12, `${label}: mathematical content rendered`);

        await page.evaluate(() => {
          const heading = document.getElementById('knowledge-history');
          window.scrollTo(0, heading.getBoundingClientRect().top + window.scrollY - 32);
        });
        await page.screenshot({ path: path.join(output, `knowledge-top-${label}.png`) });
        await page.evaluate(() => {
          const heading = document.getElementById('knowledge-history');
          window.scrollTo(0, heading.getBoundingClientRect().bottom + window.scrollY + 250);
        });
        const scrolled = await measure(page);
        assert.ok(
          Math.abs(scrolled.history.top) < 1,
          `${label}: introduction sticks flush to viewport top`,
        );
        await page.screenshot({ path: path.join(output, `knowledge-reading-${label}.png`) });

        await page.evaluate(() =>
          document.getElementById('knowledge-history-toggle').scrollIntoView(),
        );
        await page.click('#knowledge-history-toggle');
        assert.equal((await measure(page)).expanded, 'false', `${label}: collapses`);
        await page.click('#knowledge-history-toggle');
        assert.equal((await measure(page)).expanded, 'true', `${label}: expands`);
        await page.evaluate(() => document.getElementById('knowledge-return-overview').click());
        assert.equal(await page.$eval('#knowledge-history', (element) => element.hidden), true);
        await page.evaluate(() => document.getElementById('knowledge-start-reading').click());
        assert.equal(await page.$eval('#knowledge-history', (element) => element.hidden), false);
        assert.equal((await measure(page)).count, 1, `${label}: no duplicate after view changes`);
        await page.evaluate(() => {
          document.getElementById('knowledge-chat-toggle').click();
          document.getElementById('knowledge-chat-tab-discussion').click();
          document.getElementById('knowledge-chat-close').click();
        });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          page.click('#knowledge-next-link'),
        ]);
        await page.waitForFunction(
          () => document.getElementById('knowledge-node-id').textContent === 'MA-01-2',
        );
        assert.equal(
          await page.$eval('#knowledge-chat-toggle', (element) =>
            element.getAttribute('aria-expanded'),
          ),
          'false',
          `${label}: next point stays closed`,
        );
        assert.equal(
          await page.$eval('#knowledge-chat-tab-discussion', (element) =>
            element.getAttribute('aria-selected'),
          ),
          'true',
          `${label}: discussion tab is remembered`,
        );
        await page.click('#knowledge-chat-toggle');
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForFunction(
          () => document.getElementById('knowledge-node-id').textContent === 'MA-01-2',
        );
        assert.equal(
          await page.$eval('#knowledge-chat-toggle', (element) =>
            element.getAttribute('aria-expanded'),
          ),
          'true',
          `${label}: reload stays open`,
        );
        assert.equal(
          await page.$eval('#knowledge-chat-tab-discussion', (element) =>
            element.getAttribute('aria-selected'),
          ),
          'true',
          `${label}: reload stays in discussion`,
        );
        await page.evaluate(() => {
          document.getElementById('knowledge-chat-tab-max').click();
          document.getElementById('knowledge-chat-close').click();
        });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          page.click('#knowledge-previous-link'),
        ]);
        await page.waitForFunction(
          () => document.getElementById('knowledge-node-id').textContent === 'MA-01-1',
        );
        assert.equal(
          await page.$eval('#knowledge-chat-toggle', (element) =>
            element.getAttribute('aria-expanded'),
          ),
          'false',
          `${label}: previous point stays closed`,
        );
        assert.equal(
          await page.$eval('#knowledge-chat-tab-max', (element) =>
            element.getAttribute('aria-selected'),
          ),
          'true',
          `${label}: Max tab is remembered`,
        );
        snapshots.push({ label, start, scrolled });
      }
    }
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(rejected, [], 'No external requests or business writes');
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ snapshots, errors, rejected }, null, 2),
    );
    console.log(
      `PASS: ${snapshots.length} knowledge origin layout, scroll and interaction scenarios`,
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify({ message: error.message, snapshots, errors, rejected }, null, 2),
    );
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
