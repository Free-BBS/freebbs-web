// Real computed colors, keyboard scrolling and large text on a public course snapshot.
// Fresh loopback guest contexts only; no production, business writes or real account data.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  assert.ok(
    ['--snapshot', '--output', '--playwright', '--chrome', '--forced-colors'].includes(
      process.argv[index],
    ) && process.argv[index + 1],
    'Use --snapshot, --output, --playwright, --chrome and --forced-colors option/value pairs',
  );
  options.set(process.argv[index], process.argv[index + 1]);
}
assert.ok(options.has('--snapshot'), 'Supply the saved public signals map-response.json');
const forcedColors = options.get('--forced-colors') || 'none';
assert.ok(['none', 'active'].includes(forcedColors), '--forced-colors must be none or active');
const snapshot = JSON.parse(fs.readFileSync(path.resolve(options.get('--snapshot')), 'utf8'));
assert.equal(snapshot.course?.slug, 'signals', 'This isolated preview serves the signals route');
assert.ok(Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges));
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  options.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '..');
const output = path.resolve(options.get('--output') || 'output/route-persona-visual-20261016');
fs.mkdirSync(output, { recursive: true });
const sourceFiles = [
  'public/course-learning-route.js',
  'public/course-learning-route.css',
  'public/course-structure.css',
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  );
const report = {
  boundary:
    'Saved public signals nodes/edges; fresh loopback guest contexts with synthetic guest resume. GET only, no production, private browser profile, business writes or claims of learning effectiveness.',
  startedAt: new Date().toISOString(),
  startHashes: hashes(),
  cases: [],
};
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

async function colorSamples(page) {
  return page.evaluate(() => {
    const rgba = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((n, i) => (i === 3 ? n / 255 : n));
    };
    const over = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2]
        .map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha)
        .concat(alpha);
    };
    const luminance = (color) =>
      color
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index], 0);
    const sample = (key, selector) => {
      const element = document.querySelector(selector);
      if (!element) return { key, missing: true };
      const style = getComputedStyle(element);
      const parents = [];
      for (let parent = element; parent; parent = parent.parentElement) parents.unshift(parent);
      let background = [255, 255, 255, 1];
      for (const parent of parents)
        background = over(rgba(getComputedStyle(parent).backgroundColor), background);
      const foreground = rgba(style.color);
      foreground[3] *= Number(style.opacity);
      const composite = over(foreground, background);
      const first = luminance(composite);
      const second = luminance(background);
      return {
        key,
        text: element.textContent.trim().slice(0, 80),
        color: style.color,
        opacity: style.opacity,
        background,
        ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
        size: parseFloat(style.fontSize),
        weight: style.fontWeight,
      };
    };
    return [
      ['caption', '.course-route-unit .course-route-kicker'],
      ['select', '.course-route-chapter'],
      ['primary', '.course-route-primary'],
      ['normal', '.course-route-stop:not(.is-current):not(.is-resume) .course-route-medallion'],
      ['current', '.is-current .course-route-medallion'],
      ['resume', '.is-resume .course-route-medallion'],
      ['title', '.course-route-node-copy strong'],
      ['id', '.course-route-node-copy small'],
      ['status', '.course-route-status'],
      ['description', '.course-route-description'],
    ].map(([key, selector]) => sample(key, selector));
  });
}

async function geometry(page) {
  return page.evaluate(() => {
    const route = document.querySelector('.course-learning-route');
    const viewport = route.querySelector('.course-route-viewport');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      routeClient: route.clientWidth,
      routeScroll: route.scrollWidth,
      clipWidth: viewport.clientWidth,
      canvasWidth: viewport.scrollWidth,
      clipHeight: viewport.clientHeight,
      fullHeight: viewport.scrollHeight,
      titles: [...route.querySelectorAll('.course-route-node-copy')].map((element) => ({
        text: element.textContent,
        width: element.clientWidth,
        scroll: element.scrollWidth,
        textOverflow: getComputedStyle(element).textOverflow,
      })),
    };
  });
}

async function focusBounds(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const viewport = document.querySelector('.course-route-viewport');
    const box = element.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    const style = getComputedStyle(element);
    // A negative outline-offset deliberately keeps the indicator inside the
    // native button, so the browser need not scroll extra invisible margins.
    const outside = Math.max(
      0,
      (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
    );
    const left = frame.left + viewport.clientLeft;
    const top = frame.top + viewport.clientTop;
    const right = left + viewport.clientWidth;
    const bottom = top + viewport.clientHeight;
    return {
      id: element.dataset.courseRouteNodeId || '',
      height: box.height,
      viewportHeight: viewport.clientHeight,
      visibleHeight: Math.max(0, Math.min(box.bottom, bottom) - Math.max(box.top, top)),
      oversized: box.height + outside * 2 > viewport.clientHeight + 1,
      horizontal: box.left - outside >= left - 1 && box.right + outside <= right + 1,
      fullOutlineVisible:
        box.top - outside >= top - 1 &&
        box.bottom + outside <= bottom + 1 &&
        box.left - outside >= left - 1 &&
        box.right + outside <= right + 1,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineOffset: parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      scrollTop: viewport.scrollTop,
    };
  });
}

async function run() {
  const preview = createLearningPreview({
    mapNodes: snapshot.nodes,
    mapEdges: snapshot.edges,
    contextRows: [],
  });
  const { port } = await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: options.get('--chrome'),
    headless: true,
  });
  try {
    for (const theme of ['light', 'dark']) {
      for (const palette of [0, 1, 2]) {
        for (const mobile of [false, true]) {
          const width = mobile ? 320 : 1440;
          const height = mobile ? 760 : 1000;
          const font = mobile ? 32 : 16;
          const chapter = `SS-0${palette + 1}`;
          const candidates = snapshot.nodes
            .filter((node) => node.id.startsWith(`${chapter}-`))
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
          assert.ok(
            candidates.length >= 6,
            'Three real chapters need at least six ordinary points',
          );
          const resume = candidates[0].id;
          const focused = candidates[1].id;
          const context = await browser.newContext({
            viewport: { width, height },
            reducedMotion: 'reduce',
            forcedColors,
          });
          await context.addInitScript((id) => {
            localStorage.setItem(
              'free_bbs_current_learning_node_v1:guest',
              JSON.stringify({ signals: id }),
            );
          }, resume);
          await context.route('**/*', (request) =>
            new URL(request.request().url()).origin !== origin ||
            request.request().method() !== 'GET'
              ? request.abort()
              : request.continue(),
          );
          const page = await context.newPage();
          const result = {
            theme,
            palette,
            mobile,
            width,
            height,
            font,
            resume,
            focused,
            forcedColors,
            errors: [],
          };
          report.cases.push(result);
          page.on('pageerror', (error) => result.errors.push(error.message));
          const key = `${theme}-p${palette}-${width}-${font}`;
          try {
            await page.goto(
              `${origin}/course?course=signals&as=guest&theme=${theme}&focus=${focused}`,
              { waitUntil: 'networkidle' },
            );
            await page.addStyleTag({
              content: `:root{--type-scale-rem:${font === 32 ? '200%' : '100%'};font-size:${font}px!important}`,
            });
            await page.waitForSelector('.course-route-stop.is-current');
            await page.waitForSelector('.course-route-stop.is-resume');
            await page.evaluate(() => document.fonts.ready);
            await page.locator('.course-learning-route').scrollIntoViewIfNeeded();
            result.colors = await colorSamples(page);
            result.geometry = await geometry(page);
            for (const sample of result.colors) {
              assert.equal(sample.missing, undefined, sample.key);
              assert.ok(sample.ratio >= 4.5, `${sample.key}: actual contrast ${sample.ratio}`);
            }
            const bounds = result.geometry;
            assert.ok(bounds.pageWidth <= width + 1, 'No page horizontal scroll');
            assert.ok(bounds.routeScroll <= bounds.routeClient + 1, 'No hidden route columns');
            assert.ok(bounds.canvasWidth <= bounds.clipWidth + 1, 'No horizontal route scroll');
            assert.ok(bounds.titles.every((title) => title.scroll <= title.width + 1));
            await page.locator('.course-learning-route').screenshot({
              path: path.join(output, `${key}.png`),
            });
            await page.locator('.course-route-viewport').focus();
            result.keyboard = [];
            for (let index = 0; index < 6; index += 1) {
              await page.keyboard.press('Tab');
              const measured = await focusBounds(page);
              result.keyboard.push(measured);
              assert.ok(measured.id, 'Native Tab must reach the next real knowledge point');
              assert.ok(measured.horizontal, 'Focus indicator stays inside the horizontal clip');
              assert.ok(measured.outlineWidth >= 2 && measured.outlineStyle === 'solid');
              if (measured.oversized) {
                // Do not shrink enlarged text or truncate the official title to
                // make a long card fit. It remains vertically scrollable/readable.
                assert.ok(measured.visibleHeight >= measured.viewportHeight - 1);
                await page.screenshot({ path: path.join(output, `${key}-long-card.png`) });
              } else assert.ok(measured.fullOutlineVisible, JSON.stringify(measured));
            }
            await page.screenshot({ path: path.join(output, `${key}-last-tab.png`) });
            assert.deepEqual(result.errors, []);
            result.status = 'passed';
            console.log(`${key}: passed`);
          } catch (error) {
            result.status = 'failed';
            result.error = error.stack;
            await page.screenshot({ path: path.join(output, `${key}-failure.png`) });
            console.error(`${key}: ${error.message}`);
          } finally {
            await context.close();
            save();
          }
        }
      }
    }
  } finally {
    report.endHashes = hashes();
    report.sourceStable = JSON.stringify(report.startHashes) === JSON.stringify(report.endHashes);
    save();
    await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
  assert.equal(report.sourceStable, true, 'Do not mix screenshots from changed layout sources');
  assert.equal(report.cases.filter((item) => item.status !== 'passed').length, 0);
  console.log(path.join(output, 'report.json'));
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
