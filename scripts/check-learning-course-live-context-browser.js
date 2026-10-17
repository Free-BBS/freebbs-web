// Real cross-tab reader behaviour on an isolated local service. Public snapshot
// course content and synthetic members only; no production or external AI.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1]);
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(options.get('--playwright') || 'playwright');
const snapshot = path.resolve(options.get('--snapshot'));
const map = JSON.parse(fs.readFileSync(path.join(snapshot, 'signals/map-response.json'), 'utf8'));
const nodes = map.nodes.map((item) => {
  const { node } = JSON.parse(
    fs.readFileSync(path.join(snapshot, 'signals/nodes', item.id, 'public-response.json'), 'utf8'),
  );
  return { ...item, ...node, markdown: node.sections?.knowledgeMarkdown || '' };
});
const output = path.resolve(
  options.get('--output') || 'output/learning-course-live-context-20261016',
);
fs.mkdirSync(output, { recursive: true });
const sources = [
  'public/course-map.js',
  'public/course-structure.js',
  'public/course-learning-route.js',
];
const hashes = () =>
  Object.fromEntries(
    sources.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(__dirname, '..', file)))
        .digest('hex'),
    ]),
  );
const report = {
  boundary:
    'Public signals snapshot, real current UI, fresh local memory service, synthetic identity and isolated two-tab browser context. No production, external model, answer submission or rewards.',
  startHashes: hashes(),
  cases: [],
};
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const preview = createLearningPreview({
  mapNodes: nodes,
  mapEdges: map.edges,
  contextRows: nodes.map((node) => ({
    slug: 'signals',
    course_id: 1,
    course_name: '信号与系统',
    node_id: node.id,
    title: node.title,
    knowledge_markdown: node.markdown,
    document_markdown: node.markdown,
    basic_info_markdown: node.sections?.basicInfoMarkdown || '',
    is_active: 1,
  })),
});
async function ready(page) {
  await page.waitForFunction(() =>
    document.getElementById('course-map-canvas')?.courseStructureController?.getRouteState(),
  );
}
async function readPoint(page, origin, point) {
  await page.goto(`${origin}/knowledge?course=signals&point=${point}&view=reading&as=student`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction((id) => {
    const app = window.freeBbsApp;
    if (!app?.userState?.isLoggedIn) return false;
    return (
      window.FreeBbsLearningProgress.read(
        localStorage,
        'free_bbs_current_learning_node_v1',
        app.userState,
      ).signals === id
    );
  }, point);
}
async function state(page) {
  return page.evaluate(() => {
    const controller = document.getElementById('course-map-canvas').courseStructureController;
    return {
      navigation: controller.getNavigationState(),
      routePage: controller.getRouteState().page,
      recent: document.querySelector('.course-structure-resume').dataset.courseResumeId || '',
      resumeHidden: document.querySelector('.course-structure-resume').hidden,
      href: document.querySelector('.course-structure-resume a').getAttribute('href'),
      focus: document.activeElement?.className,
      query: document.querySelector('.course-catalog-search')?.value,
      catalogOpen: document.querySelector('.course-catalog-dialog')?.open,
      controllerStable: window.liveController === controller,
      routeStable: window.liveRoute === document.querySelector('.course-route-node'),
      searchStable: window.liveSearch === document.querySelector('.course-catalog-search'),
      routeBadge: [
        ...document.querySelectorAll('.course-route-stop.is-resume [data-course-route-node-id]'),
      ].map((item) => item.dataset.courseRouteNodeId),
    };
  });
}
async function run() {
  const { port } = await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: options.get('--chrome'),
    headless: true,
  });
  try {
    for (const width of [1440, 390]) {
      for (const initialRecent of [false, true]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 760 : 900 },
        });
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        );
        const page = await context.newPage();
        const reader = await context.newPage();
        const key = `${width}-${initialRecent ? 'existing' : 'late'}-recent`;
        const result = { key, errors: [], checks: [] };
        report.cases.push(result);
        page.on('pageerror', (error) => result.errors.push(error.message));
        reader.on('pageerror', (error) => result.errors.push(error.message));
        try {
          if (initialRecent) await readPoint(reader, origin, 'SS-01-01');
          await page.goto(`${origin}/course?course=signals&as=student&focus=SS-01-03`, {
            waitUntil: 'networkidle',
          });
          await ready(page);
          await page.locator('.course-route-next').click();
          await page.locator('.course-catalog-open').click();
          await page.locator('.course-catalog-search').fill('SS-04-09');
          await page.locator('.course-catalog-search').focus();
          await page.evaluate(() => {
            window.liveController =
              document.getElementById('course-map-canvas').courseStructureController;
            window.liveRoute = document.querySelector('.course-route-node');
            window.liveSearch = document.querySelector('.course-catalog-search');
          });
          result.before = await state(page);
          assert.equal(result.before.recent, initialRecent ? 'SS-01-01' : '');
          assert.equal(result.before.resumeHidden, !initialRecent);
          await readPoint(reader, origin, 'SS-02-01');
          await page.bringToFront();
          await page.waitForFunction(
            () =>
              document.querySelector('.course-structure-resume').dataset.courseResumeId ===
              'SS-02-01',
          );
          result.after = await state(page);
          assert.deepEqual(result.after.navigation, result.before.navigation);
          assert.equal(result.after.routePage, result.before.routePage);
          assert.equal(result.after.focus, 'course-catalog-search');
          assert.equal(result.after.query, 'SS-04-09');
          assert.equal(result.after.catalogOpen, true);
          assert.equal(result.after.controllerStable, true);
          assert.equal(result.after.routeStable, true);
          assert.equal(result.after.searchStable, true);
          assert.equal(new URL(result.after.href, origin).searchParams.get('point'), 'SS-02-01');
          result.checks.push(
            'A real second reader updates the existing course recent entry, including initially absent resume, without replacing controller, route cards or open catalog/search focus, selected point/chapter/query/page.',
          );
          await page.screenshot({ path: path.join(output, `${key}-catalog-preserved.png`) });
          await page.locator('.course-catalog-close').click();
          await page.waitForFunction(() => !document.querySelector('.course-catalog-dialog').open);
          await page.locator('.course-structure-resume').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `${key}-updated-recent.png`) });

          await reader.evaluate(() => {
            const own = window.FreeBbsLearningProgress.scopedKey(
              'free_bbs_current_learning_node_v1',
              window.freeBbsApp.userState,
            );
            const current = JSON.parse(localStorage.getItem(own));
            localStorage.setItem(own, JSON.stringify({ ...current, math: 'MA-01-01' }));
            localStorage.setItem(
              'free_bbs_current_learning_node_v1:user:unrelated-owner',
              JSON.stringify({ signals: 'SS-01-01' }),
            );
          });
          await page.bringToFront();
          assert.equal((await state(page)).recent, 'SS-02-01');
          result.checks.push(
            'Another course and unrelated owner storage writes do not replace this course recent.',
          );

          await reader.evaluate(() =>
            localStorage.setItem('free_bbs_auth_token', 'expired-or-replaced-synthetic-token'),
          );
          await page.waitForFunction(
            () => document.querySelector('.course-structure-resume').hidden,
          );
          await reader.evaluate(() => {
            const ownerKey = window.FreeBbsLearningProgress.scopedKey(
              'free_bbs_current_learning_node_v1',
              window.freeBbsApp.userState,
            );
            localStorage.setItem(ownerKey, JSON.stringify({ signals: 'SS-01-01' }));
          });
          await reader.bringToFront();
          await page.bringToFront();
          await page.waitForTimeout(150);
          assert.equal((await state(page)).recent, '');
          assert.equal((await state(page)).resumeHidden, true);
          result.checks.push(
            'A replaced token immediately clears private decorations; old-owner storage and subsequent native focus cannot resurrect them.',
          );
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
  } finally {
    report.endHashes = hashes();
    report.sourceStable = JSON.stringify(report.startHashes) === JSON.stringify(report.endHashes);
    save();
    await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
  assert.equal(report.sourceStable, true);
  assert.equal(report.cases.filter((item) => item.status !== 'passed').length, 0);
  console.log(path.join(output, 'report.json'));
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
