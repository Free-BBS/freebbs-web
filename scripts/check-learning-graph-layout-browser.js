// Read-only real-browser graph checks against an explicitly supplied isolated loopback preview.
// Example: node scripts/check-learning-graph-layout-browser.js --base http://127.0.0.1:25251
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith('--') || !process.argv[index + 1])
    throw new Error('Use explicit --base, --output, --playwright and --chrome option/value pairs');
  args.set(process.argv[index], process.argv[index + 1]);
}
const origin = new URL(args.get('--base') || 'http://127.0.0.1:25251');
if (
  origin.protocol !== 'http:' ||
  origin.hostname !== '127.0.0.1' ||
  !origin.port ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error('Only an explicit http://127.0.0.1:PORT isolated preview is allowed');
const base = origin.origin;
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  args.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const output = path.resolve(
  args.get('--output') || path.join(root, 'output/knowledge-graph-20261015'),
);
fs.mkdirSync(output, { recursive: true });
const run = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(output, `${run}-report.json`);
const sourceFiles = [
  'public/course.html',
  'public/course-map.js',
  'public/course-structure.js',
  'public/course-structure.css',
  'public/learning-graph-layout.js',
];
const sourceHashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  );
const examples = [
  { name: 'sparse', slug: 'math', id: 'CAL-04-006' },
  { name: 'medium', slug: 'math', id: 'CAL-02-002' },
  { name: 'dense-local', slug: 'signals', id: 'SS-03-08' },
  { name: 'cross-chapter-local', slug: 'signals', id: 'SS-02-01' },
];
const report = {
  boundary:
    'Current real UI and published course fixtures on an isolated loopback origin. Synthetic identity and memory only. No production requests or real personal data. Dense screenshots are a readable local view, not a claim that every node fits the viewport.',
  base,
  startedAt: new Date().toISOString(),
  sourceBefore: sourceHashes(),
  cases: [],
  errors: [],
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
async function getJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `Local fixture GET ${new URL(url).pathname}`);
  return response.json();
}
async function renderedGeometry(page) {
  return page.evaluate(() => {
    const viewer = document.querySelector('.course-structure-viewer');
    const viewerRect = viewer.getBoundingClientRect();
    const overflowLabels = [];
    const boxes = [...viewer.querySelectorAll('.course-structure-node[data-node-id]')].map(
      (element) => {
        const box = element.querySelector('rect').getBoundingClientRect();
        for (const label of element.querySelectorAll('text')) {
          if (getComputedStyle(label).opacity === '0') continue;
          const bounds = label.getBoundingClientRect();
          if (
            bounds.left < box.left - 1 ||
            bounds.right > box.right + 1 ||
            bounds.top < box.top - 1 ||
            bounds.bottom > box.bottom + 1
          )
            overflowLabels.push({ id: element.dataset.nodeId, text: label.textContent });
        }
        return {
          id: element.dataset.nodeId,
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          visible:
            box.right > viewerRect.left &&
            box.left < viewerRect.right &&
            box.bottom > viewerRect.top &&
            box.top < viewerRect.bottom,
          fullyVisible:
            box.left >= viewerRect.left - 1 &&
            box.right <= viewerRect.right + 1 &&
            box.top >= viewerRect.top - 1 &&
            box.bottom <= viewerRect.bottom + 1,
        };
      },
    );
    const labels = [...viewer.querySelectorAll('.course-structure-group-label')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: element.textContent,
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
      };
    });
    const crossings = [];
    const captionCrossings = [];
    const links = [...viewer.querySelectorAll('.course-structure-link')].map((element) => {
      const line = element.querySelector('path.course-structure-connector');
      const arrow = element.querySelector('path.course-structure-arrow');
      const length = line.getTotalLength();
      const matrix = line.getScreenCTM();
      const unrelated = boxes.filter(
        (box) => ![element.dataset.source, element.dataset.target].includes(box.id),
      );
      for (let position = 0; position <= length; position += 1.5) {
        const local = line.getPointAtLength(position);
        const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        for (const box of unrelated)
          if (
            point.x > box.x + 1 &&
            point.x < box.right - 1 &&
            point.y > box.y + 1 &&
            point.y < box.bottom - 1
          ) {
            crossings.push({
              source: element.dataset.source,
              target: element.dataset.target,
              unrelated: box.id,
              point: { x: point.x, y: point.y },
            });
            break;
          }
        for (const box of labels)
          if (
            point.x > box.x + 1 &&
            point.x < box.right - 1 &&
            point.y > box.y + 1 &&
            point.y < box.bottom - 1
          ) {
            captionCrossings.push({
              source: element.dataset.source,
              target: element.dataset.target,
              label: box.label,
              point: { x: point.x, y: point.y },
            });
            break;
          }
      }
      const last = line.getPointAtLength(length);
      const lastScreen = new DOMPoint(last.x, last.y).matrixTransform(matrix);
      let arrowTipDistance = null;
      if (arrow) {
        // Arrow markup may start at a wing rather than its tip. Check the actual
        // drawn outline against the connector endpoint instead of assuming M=tip.
        const arrowMatrix = arrow.getScreenCTM();
        const arrowLength = arrow.getTotalLength();
        arrowTipDistance = Infinity;
        for (let position = 0; position <= arrowLength; position += 0.25) {
          const point = arrow.getPointAtLength(position);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(arrowMatrix);
          for (const box of unrelated)
            if (
              screen.x > box.x + 1 &&
              screen.x < box.right - 1 &&
              screen.y > box.y + 1 &&
              screen.y < box.bottom - 1
            ) {
              crossings.push({
                source: element.dataset.source,
                target: element.dataset.target,
                unrelated: box.id,
                kind: 'arrow',
                point: { x: screen.x, y: screen.y },
              });
              break;
            }
          arrowTipDistance = Math.min(
            arrowTipDistance,
            Math.hypot(screen.x - lastScreen.x, screen.y - lastScreen.y),
          );
        }
      }
      return {
        source: element.dataset.source,
        target: element.dataset.target,
        ordered: element.classList.contains('is-ordered'),
        arrow: Boolean(arrow),
        arrowTipDistance,
        d: line.getAttribute('d'),
      };
    });
    const transform = viewer.querySelector('svg > g')?.getAttribute('transform');
    const titleSizes = [...viewer.querySelectorAll('.course-structure-node-title')].map(
      (element) => {
        const matrix = element.getScreenCTM();
        return (
          Number.parseFloat(getComputedStyle(element).fontSize) * Math.hypot(matrix.a, matrix.b)
        );
      },
    );
    return {
      boxes,
      overflowLabels,
      labels,
      links,
      crossings,
      captionCrossings,
      minimumScreenTitleSize: Math.min(...titleSizes),
      transform,
      viewer: {
        x: viewerRect.x,
        y: viewerRect.y,
        width: viewerRect.width,
        height: viewerRect.height,
      },
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}
async function main() {
  const maps = new Map();
  for (const slug of ['math', 'signals'])
    maps.set(slug, await getJson(`${base}/api/courses/${slug}/map`));
  const browser = await chromium.launch({
    headless: true,
    ...(args.get('--chrome') || process.env.CHROME_BIN
      ? { executablePath: args.get('--chrome') || process.env.CHROME_BIN }
      : {}),
    args: ['--disable-background-networking'],
  });
  try {
    const desktop = examples.flatMap((example) =>
      ['light', 'dark'].map((theme) => ({
        ...example,
        theme,
        viewport: { width: 1440, height: 1000 },
      })),
    );
    const mobile = [390, 320].flatMap((width) =>
      ['light', 'dark'].map((theme) => ({
        ...examples[3],
        theme,
        viewport: { width, height: width === 390 ? 844 : 640 },
      })),
    );
    const extra = [{ ...examples[1], theme: 'light', viewport: { width: 1400, height: 1000 } }];
    const scenes =
      args.get('--showcase') === 'true'
        ? ['light', 'dark'].map((theme) => ({
            name: 'cross-chapter-complete',
            slug: 'signals',
            id: 'SS-11-01',
            theme,
            viewport: { width: 1440, height: 1000 },
          }))
        : [...desktop, ...mobile, ...extra];
    for (const scene of scenes) {
      const result = {
        key: `${scene.name}-${scene.theme}-${scene.viewport.width}`,
        ...scene,
        sourceBefore: sourceHashes(),
        pageErrors: [],
        externalRequests: [],
        status: 'pending',
      };
      report.cases.push(result);
      const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on('pageerror', (error) => result.pageErrors.push(error.message));
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base || ['data:', 'blob:'].includes(url.protocol))
          return route.continue();
        result.externalRequests.push({ origin: url.origin, method: request.method() });
        return route.abort('blockedbyclient');
      });
      try {
        const map = maps.get(scene.slug);
        const byId = new Map(map.nodes.map((node) => [node.id, node]));
        const expected = map.edges.filter(
          (edge) =>
            ['ordered', 'related'].includes(edge.type) &&
            edge.source !== edge.target &&
            byId.has(edge.source) &&
            byId.has(edge.target) &&
            [edge.source, edge.target].includes(scene.id),
        );
        const expectedIds = [
          ...new Set([scene.id, ...expected.flatMap((edge) => [edge.source, edge.target])]),
        ].sort();
        result.pointTitle = byId.get(scene.id).title;
        result.expectedNodeCount = expectedIds.length;
        await page.goto(
          `${base}/course?${new URLSearchParams({ course: scene.slug, focus: scene.id, as: 'student', theme: scene.theme })}`,
          { waitUntil: 'domcontentloaded' },
        );
        await page.waitForFunction(
          (id) =>
            document.getElementById('course-map-canvas')?.courseStructureController?.getState()
              ?.focusedNodeId === id,
          scene.id,
        );
        await page.evaluate(() => document.fonts.ready);
        assert.ok(
          (await page.locator('body').getAttribute('class')).includes(`theme-${scene.theme}`),
        );
        const summary = page.locator('.course-structure-graph-area > summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('.course-structure-graph-area')?.open,
        );
        await page.locator('.course-structure-graph-area').scrollIntoViewIfNeeded();
        await page.waitForTimeout(160);
        const geometry = await renderedGeometry(page);
        result.geometry = geometry;
        assert.deepEqual(
          geometry.boxes.map((box) => box.id).sort(),
          expectedIds,
          'No published neighbor is omitted',
        );
        assert.deepEqual(
          geometry.links
            .map((edge) => `${edge.source}|${edge.target}|${edge.ordered ? 'ordered' : 'related'}`)
            .sort(),
          expected.map((edge) => `${edge.source}|${edge.target}|${edge.type}`).sort(),
        );
        assert.deepEqual(
          geometry.crossings,
          [],
          'Rendered connector must not pass through an unrelated node',
        );
        assert.deepEqual(
          geometry.overflowLabels,
          [],
          'Real graph titles and identifiers remain inside their cards',
        );
        assert.ok(
          geometry.links.every((edge) => edge.arrow === edge.ordered),
          'Only ordered relationships have arrow heads',
        );
        assert.ok(
          geometry.links.every((edge) => !edge.arrow || edge.arrowTipDistance <= 2),
          'Arrow head must terminate at its connector endpoint',
        );
        assert.ok(
          geometry.pageWidth <= geometry.viewportWidth + 1,
          'Graph must not expand the page horizontally',
        );
        assert.ok(
          geometry.minimumScreenTitleSize >= 15,
          'Do not fit dense graphs by shrinking titles below readable size',
        );
        result.visibleNodeCount = geometry.boxes.filter((box) => box.visible).length;
        result.fullyVisibleNodeCount = geometry.boxes.filter((box) => box.fullyVisible).length;
        result.screenshotScope =
          result.fullyVisibleNodeCount < geometry.boxes.length
            ? 'Readable local view; additional nodes remain accessible by panning'
            : 'All graph nodes visible';
        const screenshot = path.join(output, `${run}-${result.key}.png`);
        await page.locator('.course-structure-graph-area').screenshot({ path: screenshot });
        result.screenshot = screenshot;
        const viewer = page.locator('.course-structure-viewer');
        await viewer.focus();
        await page.keyboard.press('ArrowRight');
        assert.notEqual(
          (await renderedGeometry(page)).transform,
          geometry.transform,
          'Arrow key pans the graph',
        );
        await page.keyboard.press('Home');
        const firstId = geometry.boxes.find((box) => box.id !== scene.id).id;
        const node = page.locator(`.course-structure-node[data-node-id="${firstId}"]`);
        await node.focus();
        const focused = await renderedGeometry(page);
        assert.ok(
          focused.boxes.find((box) => box.id === firstId).fullyVisible,
          'Keyboard focus reveals an offscreen node',
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          (id) =>
            document.getElementById('course-map-canvas').courseStructureController.getState()
              .focusedNodeId === id,
          firstId,
        );
        assert.equal(
          await page.locator('.course-structure-graph-area').getAttribute('open'),
          '',
          'Following a node from the optional graph preserves the exploration view',
        );
        await page.locator('.course-structure-back').click();
        assert.equal(
          await page.evaluate(
            () =>
              document.getElementById('course-map-canvas').courseStructureController.getState()
                .focusedNodeId,
          ),
          scene.id,
        );
        assert.deepEqual(result.pageErrors, []);
        result.keyboard = {
          panning: true,
          focusRevealsNode: true,
          enterFollowsRelation: true,
          historyReturns: true,
        };
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.error = error.stack;
        report.errors.push({ scene: result.key, message: error.message });
        await page
          .screenshot({ path: path.join(output, `${run}-${result.key}-failure.png`) })
          .catch(() => {});
      } finally {
        result.sourceAfter = sourceHashes();
        result.sourceChangedDuringRun =
          JSON.stringify(result.sourceBefore) !== JSON.stringify(result.sourceAfter);
        await context.close();
        save();
        console.log(`${result.key}: ${result.status}`);
      }
    }
  } finally {
    await browser.close();
    report.sourceAfter = sourceHashes();
    report.sourceChangedDuringRun =
      JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
    report.finishedAt = new Date().toISOString();
    save();
    console.log(`Report: ${reportPath}`);
    if (report.errors.length || report.sourceChangedDuringRun) process.exitCode = 1;
  }
}
main().catch((error) => {
  report.errors.push({ message: error.message });
  save();
  console.error(error.stack);
  process.exitCode = 1;
});
