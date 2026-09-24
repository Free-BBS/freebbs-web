// Production CSS and real preview APIs, isolated Chrome, local memory accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}

async function surface(page, selector) {
  return page.$eval(selector, (node) => {
    const style = getComputedStyle(node);
    const animation = node.getAnimations().find((item) => item.animationName === 'laser-halo-flow');
    let flow = null;
    if (animation) {
      animation.pause();
      animation.currentTime = 0;
      const first = getComputedStyle(node).boxShadow;
      animation.currentTime = 3000;
      flow = [first, getComputedStyle(node).boxShadow];
      animation.play();
    }
    return {
      active: node.classList.contains('has-laser-glow'),
      author: node.dataset.laserAuthor || null,
      expires: node.dataset.laserExpires || null,
      image: style.backgroundImage,
      color: style.backgroundColor,
      shadow: style.boxShadow,
      animation: style.animationName,
      mode: style.getPropertyValue('--discussion-surface-mode').trim(),
      flow,
      rect: node.getBoundingClientRect().toJSON(),
    };
  });
}

async function main() {
  const output = process.env.COSMETIC_SCREENSHOT_DIR
    ? path.resolve(process.env.COSMETIC_SCREENSHOT_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-laser-qa-'));
  fs.mkdirSync(output, { recursive: true });
  const { server, store } = createEconomyPreview({
    showcase: true,
    transformHtml(html) {
      // The production server appends these layers; omitting them hides cascade regressions.
      return html
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"></head>',
        )
        .replace(
          '</body>',
          '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script></body>',
        );
    },
  });
  store.account().assets.laser = 1;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  const rejected = [];
  const failures = [];
  const snapshots = [];
  const identities = [];
  let browser;
  let page;
  let stage = 'initialization';
  const check = (label, assertion) => {
    try {
      assertion();
    } catch (error) {
      failures.push({ stage, label, message: error.message });
    }
  };
  console.log(`Laser QA artifacts: ${output}`);
  try {
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        ['data:', 'blob:'].includes(url.protocol) ||
        (url.origin === base && ['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      )
        return request.continue();
      rejected.push(`${request.method()} ${url.origin}${url.pathname}`);
      return request.respond({ status: 403, contentType: 'application/json', body: '{}' });
    });
    const media = await page.createCDPSession();
    const emulate = (motion = 'no-preference', colors = 'none') =>
      media.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: motion },
          { name: 'forced-colors', value: colors },
        ],
      });
    const inspect = async (selector, active, mode, { staticGlow = false, forced = false } = {}) => {
      const result = await surface(page, selector);
      snapshots.push({ stage, selector, ...result });
      check(`${selector}: lease/class`, () => assert.equal(result.active, active));
      if (active && !forced) {
        check(`${selector}: starlight background`, () =>
          assert.match(result.image, /laser-starlight/),
        );
        check(`${selector}: color wash`, () => assert.match(result.image, /linear-gradient/));
        check(`${selector}: visible halo`, () => assert.match(result.shadow, /inset/));
        check(`${selector}: palette`, () => assert.equal(result.mode, `laser-${mode}`));
        check(`${selector}: motion`, () => {
          if (staticGlow) assert.equal(result.animation, 'none');
          else {
            assert.equal(result.animation, 'laser-halo-flow');
            assert.ok(result.flow && result.flow[0] !== result.flow[1], 'halo must actually move');
          }
        });
      } else {
        check(`${selector}: no starlight`, () =>
          assert.doesNotMatch(result.image, /laser-starlight/),
        );
        check(`${selector}: no laser animation`, () =>
          assert.notEqual(result.animation, 'laser-halo-flow'),
        );
        if (forced)
          check(`${selector}: contrast fallback`, () => assert.equal(result.shadow, 'none'));
        if (!active)
          check(`${selector}: ordinary palette`, () => assert.equal(result.mode, `normal-${mode}`));
      }
    };
    const openList = async (theme) => {
      await page.goto(`${base}/discussion`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.discussion-post-card[data-post-id="1"]');
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, theme);
      await settle(page);
    };
    const openPost = async (id) => {
      await page
        .locator(`.discussion-post-card[data-post-id="${id}"] [data-action="open-post"]`)
        .click();
      await page.waitForSelector('#comment-1003');
      if (await page.$eval('#comment-1003', (node) => node.hidden))
        await page
          .locator('[data-action="toggle-comment-thread"][data-thread-root="1001"]')
          .click();
      await settle(page);
    };
    const closePost = async () => {
      await page.locator('#discussion-detail [data-action="close-detail"]').click();
      await page.waitForFunction(() => !document.body.classList.contains('post-reading'));
      await settle(page);
    };
    const capture = async (name) => {
      // Locator clicks can scroll; anchor fixed shell controls at the top of full-page captures.
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await settle(page);
      await page.screenshot({ path: path.join(output, name), fullPage: true });
    };
    const inspectIdentity = async () => {
      const result = await page.$eval(
        '.discussion-detail-meta > .discussion-author-link',
        (node) => {
          const plate = node.querySelector('.cosmetic-nameplate');
          const label = plate.querySelector('.nameplate-label');
          const labelStyle = getComputedStyle(label);
          const range = document.createRange();
          range.selectNodeContents(label);
          return {
            text: label.textContent,
            lines: range.getClientRects().length,
            fontSize: labelStyle.fontSize,
            lineHeight: labelStyle.lineHeight,
            label: label.getBoundingClientRect().toJSON(),
            plate: plate.getBoundingClientRect().toJSON(),
            author: node.getBoundingClientRect().toJSON(),
            meta: node.parentElement.getBoundingClientRect().toJSON(),
            columns: getComputedStyle(node.parentElement).gridTemplateColumns,
            wrap: getComputedStyle(node).flexWrap,
          };
        },
      );
      identities.push({ stage, ...result });
      check('nameplate stays readable within two lines', () =>
        assert.ok(result.lines <= 2, `${result.lines} lines: ${result.text}`),
      );
    };
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        const prefix = `${theme}-${width}`;
        stage = `${prefix}: active list`;
        store.account().expiresAtMs = Date.now() + 3600000;
        await emulate();
        await openList(theme);
        await inspect('.discussion-post-card[data-post-id="1"]', true, theme);
        await inspect('.discussion-post-card[data-post-id="2"]', false, theme);
        await inspect('.discussion-post-card[data-post-id="3"]', false, theme);
        const anonymousLease = await page.$eval('.discussion-post-card[data-post-id="3"]', (node) =>
          node.getAttribute('data-laser-expires'),
        );
        check('anonymous post has no lease', () => assert.equal(anonymousLease, null));
        await capture(`${prefix}-list.png`);

        stage = `${prefix}: active post and replies`;
        await openPost(1);
        await inspect('.discussion-post-surface', true, theme);
        await inspect('#comment-1001', true, theme);
        await inspect('#comment-1002', false, theme);
        await inspect('#comment-1003', true, theme);
        await inspectIdentity();
        const isolation = await page.$eval('#discussion-detail', (node) => ({
          wrapperGlows: node.classList.contains('has-laser-glow'),
          commentsInsidePost: Boolean(
            node.querySelector('.discussion-post-surface .discussion-comments'),
          ),
        }));
        check('post/reply isolation', () =>
          assert.deepEqual(isolation, { wrapperGlows: false, commentsInsidePost: false }),
        );
        await capture(`${prefix}-detail.png`);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        check('no horizontal overflow', () =>
          assert.ok(scrollWidth <= width + 2, `${scrollWidth} > ${width}`),
        );

        stage = `${prefix}: reduced motion`;
        await emulate('reduce');
        await settle(page);
        await inspect('.discussion-post-surface', true, theme, { staticGlow: true });
        await inspect('#comment-1001', true, theme, { staticGlow: true });
        stage = `${prefix}: forced colors`;
        await emulate('reduce', 'active');
        await settle(page);
        await inspect('.discussion-post-surface', true, theme, { forced: true });
        await inspect('#comment-1001', true, theme, { forced: true });
        await emulate();

        stage = `${prefix}: ordinary post with active replies`;
        await closePost();
        await openPost(2);
        await inspect('.discussion-post-surface', false, theme);
        await inspect('#comment-1001', true, theme);
        await inspect('#comment-1002', false, theme);
        await inspect('#comment-1003', true, theme);

        stage = `${prefix}: author expiry updates visible replies`;
        await page.evaluate(() => {
          window.FreeBbsPostLaser.sync({
            comments: [
              {
                author: { id: 1 },
                laser: { active: false, expiresAtMs: 1, serverNowMs: Date.now() },
              },
            ],
          });
        });
        await inspect('#comment-1001', false, theme);
        await inspect('#comment-1003', false, theme);
        store.account().expiresAtMs = Date.now() - 1000;
        stage = `${prefix}: expired post fetched from API`;
        await openList(theme);
        await inspect('.discussion-post-card[data-post-id="1"]', false, theme);
        await inspect('.discussion-post-card[data-post-id="2"]', false, theme);
        stage = `${prefix}: expired post and replies fetched from API`;
        await openPost(1);
        await inspect('.discussion-post-surface', false, theme);
        await inspect('#comment-1001', false, theme);
        await inspect('#comment-1002', false, theme);
        await inspect('#comment-1003', false, theme);
        console.log(`${prefix}: active/ordinary/expired post+reply styles and fallbacks inspected`);
      }
    }
    check('browser errors', () => assert.deepEqual(errors, []));
    check('external requests or business writes', () => assert.deepEqual(rejected, []));
    console.log(`${snapshots.length} surface snapshots; ${failures.length} failures.`);
    failures.forEach(({ stage: current, label }) => console.error(`${current}: ${label}`));
    assert.equal(failures.length, 0, `See ${path.join(output, 'report.json')}`);
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {});
    if (!failures.length) failures.push({ stage, label: 'runner', message: error.message });
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ snapshots, identities, failures, errors, rejected }, null, 2),
    );
    if (browser) await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
