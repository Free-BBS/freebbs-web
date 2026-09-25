// Isolated storefront QA: local fixture APIs, fresh Chrome profile, no purchases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { beijingDay } = require('../backend/economy-policy');

async function loadStorefrontArtwork(page) {
  await page.$$eval('.shop-item-image img', async (images) => {
    for (const image of images) {
      image.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      await image.decode();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.$$eval('.shop-hero-art img, .shop-category-nav img', (images) =>
    Promise.all(images.map((image) => image.decode())),
  );
}

async function measure(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const rect = (node) => node.getBoundingClientRect().toJSON();
    return {
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      count: document.querySelectorAll('.shop-item-card').length,
      missingArt: [...document.querySelectorAll('.shop-item-image img, .shop-hero-art img')].filter(
        (img) => !img.complete || !img.naturalWidth,
      ).length,
      hero: rect(document.querySelector('.shop-hero')),
      categorySigns: [...document.querySelectorAll('.shop-category-nav a')].map((node) => ({
        label: node.querySelector(':scope > span:not(.shop-category-sample)').textContent,
        rect: rect(node),
        overflow: node.scrollWidth - node.clientWidth,
      })),
      cards: [...document.querySelectorAll('.shop-item-card')].map((card) => {
        const image = card.querySelector('.shop-item-image img');
        const preview = card.querySelector('.shop-cosmetic-preview, .shop-ranch-preview');
        return {
          item: card.dataset.itemKey,
          rect: rect(card),
          price: rect(card.querySelector('.shop-item-price')),
          action: rect(card.querySelector('.shop-item-actions')),
          image: rect(card.querySelector('.shop-item-image')),
          art: rect(preview || image),
          actualPreview: Boolean(preview),
          previewOverflow: preview ? Math.max(0, preview.scrollHeight - preview.clientHeight) : 0,
          artSource: image?.currentSrc || '',
          artWidth: image?.naturalWidth || 0,
          artHeight: image?.naturalHeight || 0,
          artFit: image ? getComputedStyle(image).objectFit : '',
          radius: getComputedStyle(card).borderRadius,
          overflow: card.scrollWidth - card.clientWidth,
        };
      }),
    };
  });
}

async function main() {
  const now = Date.now();
  const { server, store } = createOnboardingPreview({ now: () => now });
  // The preview lazily initializes this deterministic fixture on a fortune GET.
  // Seed it before taking the strict account snapshot so reads are stable too.
  store.account().fortunes[beijingDay(now)] = 90;
  const before = JSON.stringify(store.account());
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-shop-presentation-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage();
  const snapshots = [];
  const errors = [];
  const rejected = [];
  let stage = 'initialization';
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      rejected.push(`${request.method()} ${url.origin}${url.pathname}`);
      return request.respond({ status: 403, contentType: 'application/json', body: '{}' });
    }
    return request.continue();
  });
  console.log(`Shop QA artifacts: ${output}`);
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${origin}/electromagnetic`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.shop-item-card');
    await page.evaluate(() => {
      window.freeBbsMaxGuide?.pause();
      document.querySelector('[data-preview-notice]')?.remove();
    });
    await loadStorefrontArtwork(page);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        for (const typeScale of ['standard', 'large']) {
          stage = `${width}-${theme}-${typeScale}`;
          if (
            process.env.SHOP_BROWSER_SCENARIO &&
            !process.env.SHOP_BROWSER_SCENARIO.split(',').includes(stage)
          )
            continue;
          await page.evaluate(
            (mode, scale) => {
              document.body.classList.toggle('theme-light', mode === 'light');
              document.body.classList.toggle('theme-dark', mode === 'dark');
              window.freeBbsTypography.applyPreferences({
                fontPreset: scale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                typeScale: scale,
              });
              window.scrollTo({ top: 0, behavior: 'instant' });
            },
            theme,
            typeScale,
          );
          const result = await measure(page);
          assert.equal(result.overflow, 0, `${stage}: page overflow`);
          assert.equal(result.count, 17, `${stage}: catalog changed`);
          assert.equal(result.missingArt, 0, `${stage}: broken art`);
          for (const sign of result.categorySigns) {
            assert.equal(sign.overflow, 0, `${stage}: category overflow ${sign.label}`);
            assert.ok(sign.rect.height >= 44, `${stage}: small category control ${sign.label}`);
          }
          for (const card of result.cards) {
            if (card.actualPreview) {
              assert.ok(
                [
                  'frame_orbit',
                  'frame_aurora',
                  'plate_observer',
                  'card_blueprint',
                  'card_twilight',
                  'max_pet',
                ].includes(card.item),
                `${stage}: unexpected preview ${card.item}`,
              );
              assert.equal(
                card.previewOverflow,
                0,
                `${stage}: clipped actual preview ${card.item}`,
              );
            } else {
              assert.ok(
                card.artSource.includes('/assets/shop/max-cartoon-v1/'),
                `${stage}: legacy artwork ${card.item}`,
              );
              assert.equal(card.artWidth, 512, `${stage}: artwork width ${card.item}`);
              assert.equal(card.artHeight, 512, `${stage}: artwork height ${card.item}`);
              assert.equal(card.artFit, 'contain', `${stage}: artwork stretching ${card.item}`);
            }
            assert.ok(card.action.bottom <= card.rect.bottom, `${stage}: clipped ${card.item}`);
            assert.ok(card.rect.right <= width, `${stage}: card exceeds viewport ${card.item}`);
            assert.equal(card.overflow, 0, `${stage}: card overflow ${card.item}`);
            assert.ok(card.action.height >= 44, `${stage}: small action ${card.item}`);
            assert.ok(
              Math.abs(card.image.width - card.image.height) < 1,
              `${stage}: non-square artwork ${card.item}`,
            );
            assert.ok(
              card.art.width >= card.image.width - 1 && card.art.height >= card.image.height - 1,
              `${stage}: undersized artwork ${card.item}`,
            );
          }
          await page.screenshot({ path: path.join(output, `${stage}.png`), fullPage: true });
          if (
            typeScale === 'standard' &&
            ((width === 1440 && theme === 'light') || (width === 390 && theme === 'dark'))
          )
            await page.screenshot({
              path: path.join(output, `shop-${width}-${theme}-viewport.png`),
            });
          for (const category of ['appearance', 'collection', 'consumables', 'companions']) {
            await page.evaluate(async () => {
              window.scrollTo({ top: 0, behavior: 'instant' });
              await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              });
            });
            await page.locator(`.shop-category-nav a[href="#shop-section-${category}"]`).click();
            await page.waitForFunction(
              (id) => {
                const { top } = document.getElementById(id).getBoundingClientRect();
                return window.location.hash === `#${id}` && top >= 90 && top < 900;
              },
              { timeout: 5000 },
              `shop-section-${category}`,
            );
          }
          await page.locator('[data-item-key="max_pet"] [data-action="inspect-item"]').click();
          await page.waitForSelector('#shop-inspect-modal:not(.hidden)');
          await page.$eval('.shop-inspect-panel', async (node) => {
            await Promise.all(
              node.getAnimations().map((animation) => animation.finished.catch(() => {})),
            );
          });
          const panel = await page.$eval('.shop-inspect-panel', (node) => {
            const bounds = node.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              scrollable: node.scrollHeight > node.clientHeight,
            };
          });
          assert.ok(panel.left >= 0 && panel.right <= width, `${stage}: modal width`);
          assert.ok(
            panel.top >= 0 && panel.bottom <= 1000,
            `${stage}: modal height ${JSON.stringify(panel)}`,
          );
          await page.screenshot({ path: path.join(output, `${stage}-detail.png`) });
          await page.$eval('.shop-inspect-panel', (node) => {
            node.scrollTo({ top: node.scrollHeight, behavior: 'instant' });
          });
          await page.locator('#shop-inspect-modal .fortune-close').click();
          await page.waitForSelector('#shop-inspect-modal.hidden');
          assert.equal(
            await page.evaluate(() => document.activeElement?.dataset.itemKey),
            'max_pet',
            `${stage}: detail focus restore`,
          );
          snapshots.push({ theme, typeScale, ...result, modal: panel });
        }
      }
    }
    assert.deepEqual(errors, []);
    // Pausing the guide or viewing a product may queue onboarding receipts. They
    // are deliberately blocked here along with all other writes.
    assert.deepEqual(
      rejected.filter((request) => request !== `PATCH ${origin}/api/onboarding`),
      [],
    );
    assert.equal(JSON.stringify(store.account()), before, 'viewing the shop changed the account');
    fs.writeFileSync(path.join(output, 'layout.json'), JSON.stringify(snapshots, null, 2));
    console.log(
      JSON.stringify({ scenarios: snapshots.length, errors, rejected, screenshots: output }),
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    await page.screenshot({ path: path.join(output, 'failure-viewport.png') });
    throw new Error(`${stage}: ${error.message}`, { cause: error });
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
