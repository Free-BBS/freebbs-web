// Read-only loopback fixtures: compare the real profile to every shop surface.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { beijingDay } = require('../backend/economy-policy');

const keys = [
  'frame_orbit',
  'frame_aurora',
  'plate_observer',
  'card_blueprint',
  'card_twilight',
  'max_pet',
];
async function main() {
  const now = Date.now();
  const { server, store } = createOnboardingPreview({ now: () => now });
  store.account().fortunes[beijingDay(now)] = 90;
  for (const key of keys) store.account().assets[key] = 1;
  const target = store.account(2);
  target.adopted = true;
  target.fedUntilMs = now + 86400000;
  target.equipped = { frame: 'frame_orbit', nameplate: 'plate_observer', card: 'card_blueprint' };
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-shop-cosmetics-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  const rejected = [];
  const checks = [];
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
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const open = async (route, theme) => {
    await page.goto(`${origin}${route}`, { waitUntil: 'networkidle0' });
    await page.evaluate((mode) => {
      document.body.classList.toggle('theme-light', mode === 'light');
      document.body.classList.toggle('theme-dark', mode === 'dark');
      window.freeBbsMaxGuide?.pause();
      document.querySelector('[data-preview-notice]')?.remove();
    }, theme);
  };
  const appearance = async (scope, key) =>
    page.evaluate(
      (selector, item) => {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`missing sample ${selector}`);
        const values = (node, properties, pseudo) => {
          const style = getComputedStyle(node, pseudo);
          return Object.fromEntries(properties.map((name) => [name, style[name]]));
        };
        if (item.startsWith('frame_')) {
          return {
            frame: values(root.querySelector('[data-avatar-frame]'), [
              'borderColor',
              'borderStyle',
              'borderWidth',
              'outlineColor',
              'boxShadow',
            ]),
            glow: values(
              root.querySelector('[data-frame]'),
              ['backgroundImage', 'opacity'],
              '::before',
            ),
          };
        }
        if (item.startsWith('plate_')) {
          const badge = root.querySelector('.cosmetic-nameplate');
          return {
            plate: values(badge, ['backgroundColor', 'backgroundImage', 'borderColor']),
            label: badge.querySelector('.nameplate-label').textContent,
            ink: values(badge.querySelector('.nameplate-label'), ['color']),
            crest: badge.querySelector('.nameplate-crest').innerHTML,
          };
        }
        if (item.startsWith('card_')) {
          const shell = root.matches('.public-profile-shell')
            ? root
            : root.querySelector('.public-profile-shell');
          return values(shell, ['backgroundColor', 'backgroundImage', 'borderColor', 'color']);
        }
        return {
          limbs: root.querySelectorAll('[data-leg]').length,
          hooves: root.querySelectorAll('[data-hoof][d]').length,
          glasses: Boolean(root.querySelector('[data-max-glasses]')),
          mouth: root.querySelector('[data-max-mouth]')?.getAttribute('d'),
        };
      },
      scope,
      key,
    );
  let stage = '';
  try {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        stage = `${width}-${theme}`;
        const actual = {};
        for (const [frame, card] of [
          ['frame_orbit', 'card_blueprint'],
          ['frame_aurora', 'card_twilight'],
        ]) {
          target.equipped.frame = frame;
          target.equipped.card = card;
          await open('/profile?uid=u_preview02', theme);
          await page.waitForSelector(
            `.public-profile-shell[data-profile-card="${card}"] [data-frame="${frame}"]`,
          );
          actual[frame] = await appearance('.public-profile-shell', frame);
          actual[card] = await appearance('.public-profile-shell', card);
          actual.plate_observer = await appearance('.public-profile-shell', 'plate_observer');
          actual.max_pet = await appearance('.public-profile-shell', 'max_pet');
        }
        for (const route of ['/electromagnetic', '/inventory']) {
          const before = JSON.stringify(store.account());
          await open(route, theme);
          const isShop = route === '/electromagnetic';
          await page.waitForSelector(isShop ? '.shop-item-card' : '.inventory-item-row');
          for (const key of keys) {
            const selector = isShop
              ? `.shop-item-card[data-item-key="${key}"]`
              : `.inventory-item-row[data-asset-key="${key}"]`;
            assert.deepEqual(
              await appearance(selector, key),
              actual[key],
              `${stage}/${route}/${key}: differs from actual profile`,
            );
            const selectorAction = isShop
              ? '[data-action="inspect-item"]'
              : '[data-action="inspect-inventory-item"]';
            await page.$eval(`${selector} ${selectorAction}`, (node) =>
              node.scrollIntoView({ block: 'center', behavior: 'instant' }),
            );
            const centerIsClear = await page.$eval(
              `${selector} ${selectorAction}`,
              async (node) => {
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                const box = node.getBoundingClientRect();
                return node.contains(
                  document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
                );
              },
            );
            assert.ok(centerIsClear, `${stage}/${route}/${key}: detail button center obscured`);
            await page.locator(`${selector} ${selectorAction}`).click();
            await page.waitForSelector('#shop-inspect-modal:not(.hidden)');
            await page.$eval('.shop-inspect-panel', async (node) => {
              await Promise.all(
                node.getAnimations().map((animation) => animation.finished.catch(() => {})),
              );
            });
            assert.deepEqual(
              await appearance('.shop-inspect-image', key),
              actual[key],
              `${stage}/${route}/${key}: detail differs from actual profile`,
            );
            const detail = await page.$eval('.shop-inspect-image', (node) => ({
              overflow: Math.max(0, node.scrollWidth - node.clientWidth),
              clippedHooves: [...node.querySelectorAll('[data-hoof]')].filter((hoof) => {
                const bounds = node.getBoundingClientRect();
                const leg = hoof.getBoundingClientRect();
                return (
                  leg.bottom > bounds.bottom || leg.left < bounds.left || leg.right > bounds.right
                );
              }).length,
              mutationControls: node.querySelectorAll(
                '[data-extra-action], [data-max-actor], button',
              ).length,
            }));
            assert.equal(detail.overflow, 0);
            assert.equal(detail.clippedHooves, 0, `${stage}/${route}/${key}: clipped sheep hooves`);
            assert.equal(detail.mutationControls, 0);
            if (
              isShop &&
              ['frame_aurora', 'plate_observer', 'card_twilight', 'max_pet'].includes(key)
            )
              await page.screenshot({ path: path.join(output, `${stage}-${key}-detail.png`) });
            await page.locator('#shop-inspect-modal .fortune-close').click();
            await page.waitForSelector('#shop-inspect-modal.hidden');
          }
          assert.equal(
            JSON.stringify(store.account()),
            before,
            'viewing samples changed account state',
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
            0,
          );
          if (width < 1100)
            assert.ok(
              await page.$eval(
                '.main-content',
                (node) => parseFloat(getComputedStyle(node).paddingBottom) >= 190,
              ),
              'mobile footer spacing must survive global padding rules',
            );
          if (isShop) {
            await page.$eval('.shop-section[data-shop-section="appearance"]', (node) =>
              node.scrollIntoView({ block: 'start', behavior: 'instant' }),
            );
            await page.screenshot({ path: path.join(output, `${stage}-appearance.png`) });
          }
          checks.push(`${stage}/${route}: 6 samples + 6 details match actual profile`);
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(
      rejected.filter((entry) => entry !== `PATCH ${origin}/api/onboarding`),
      [],
    );
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ checks, errors, rejected }, null, 2),
    );
    console.log(JSON.stringify({ checks, screenshots: output }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw new Error(`${stage}: ${error.message}; artifacts ${output}`, { cause: error });
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
