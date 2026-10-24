// Isolated course-authoring examples, rendered with current production graph code and CSS.
// No application server, personal profile, external service, or production write is involved.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const root = path.join(__dirname, '..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (
    !['--output', '--playwright', '--chrome'].includes(process.argv[index]) ||
    !process.argv[index + 1]
  )
    throw new Error('Use --output, --playwright and --chrome option/value pairs');
  options.set(process.argv[index], process.argv[index + 1]);
}
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  options.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const output = path.resolve(
  options.get('--output') || path.join(root, 'output/knowledge-graph-20261015'),
);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(output, `${run}-chapter-report.json`);
const files = ['learning-graph-layout.js', 'learning-content.js', 'knowledge-workspace.css'];
const sourceHashes = () =>
  Object.fromEntries(
    files.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'public', file)))
        .digest('hex'),
    ]),
  );
// Wide Latin glyphs catch overflow that a repeated narrow identifier would miss.
const longId = `SS-01-${'W'.repeat(58)}`;
const point = (id, title, position) => ({ id, title, ...(position ? { position } : {}) });
const chapter = point('SS-01-00', '信号表示与系统分析');
const edge = (source, target, type = 'ordered') => ({ source, target, type });
const fixtures = {
  duplicate: {
    label: '重复坐标：顺序、跨越与回环',
    nodes: [
      point('SS-01-01', '从实际信号到数学表示', { x: 0, y: 0 }),
      point('SS-01-02', '连续时间与离散时间信号', { x: 0, y: 0 }),
      point('SS-01-03', '系统的输入、输出与响应', { x: 0, y: 0 }),
    ],
    edges: [
      edge('SS-01-01', 'SS-01-02'),
      edge('SS-01-02', 'SS-01-03'),
      edge('SS-01-01', 'SS-01-03', 'related'),
      edge('SS-01-03', 'SS-01-01'),
    ],
  },
  mixed: {
    label: '八个知识点：多分支、反向、关联与循环',
    nodes: [
      point('SS-01-01', '信号的直观理解与数学描述'),
      point('SS-01-02', '基本信号与时域变换'),
      point('SS-01-03', '系统性质与线性时不变系统'),
      point('SS-01-04', '冲激响应与卷积的物理意义'),
      point('SS-01-05', '利用微分方程分析系统响应'),
      point('SS-01-06', 'Wideband Waveform Reconstruction 与时域分析'),
      point('SS-01-07', '采样、重建与混叠现象'),
      point(
        longId,
        '用于验证超长标题的知识点：连续时间线性时不变系统的时域与频域表示，以及不同分析方法的适用边界',
      ),
    ],
    edges: [
      edge('SS-01-01', 'SS-01-02'),
      edge('SS-01-02', 'SS-01-03'),
      edge('SS-01-03', 'SS-01-01'),
      edge('SS-01-02', 'SS-01-01'),
      edge('SS-01-01', 'SS-01-04'),
      edge('SS-01-04', 'SS-01-05'),
      edge('SS-01-05', 'SS-01-06'),
      edge('SS-01-06', 'SS-01-07'),
      edge('SS-01-07', longId),
      edge('SS-01-01', 'SS-01-03', 'related'),
      edge('SS-01-05', 'SS-01-02', 'related'),
      edge(longId, 'SS-01-04', 'related'),
    ],
  },
  empty: { label: '空章：尚未发布知识点', nodes: [], edges: [] },
};
const report = {
  boundary:
    '课程组章图示例（非生产数据）。仅使用当前公共渲染代码和样式的独立本地页面；所有非本地请求及非 GET 请求均阻止，不接入生产账号、记录、课程或题目。',
  startedAt: new Date().toISOString(),
  sourceBefore: sourceHashes(),
  cases: [],
  errors: [],
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

function html(scene, theme) {
  const fixture = fixtures[scene];
  const map = {
    nodes: [
      chapter,
      ...fixture.nodes,
      point('SS-02-00', '其他章节'),
      point('SS-02-01', '其他章节的知识点'),
    ],
    edges: [...fixture.edges, edge('SS-01-01', 'SS-02-01')],
  };
  const payload = JSON.stringify({ map, chapter, course: { slug: 'signals' } }).replace(
    /</g,
    '\\u003c',
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>课程组章图示例（非生产数据）</title>
<link rel="stylesheet" href="/knowledge-workspace.css">
<style>
:root{--font-ui:"Segoe UI","Microsoft YaHei",sans-serif;--ui-text:#173e46;--ui-surface:#fff;--ui-surface-soft:#edf5f5;--ui-line:#c9dcdf;color-scheme:light}
*{box-sizing:border-box}body{margin:0;padding:24px;color:var(--learning-ink);background:#f4f7f8;font:18px/1.55 var(--font-ui)}
body.theme-dark{background:#0a1c22;color-scheme:dark}main{max-width:1240px;margin:auto;min-width:0}h1{font-size:clamp(22px,3vw,32px);line-height:1.35;margin:0 0 8px}
.example-label{margin:0 0 8px;font-size:14px;letter-spacing:.02em;opacity:.7}.example-scenario{margin:0;font-size:17px}
.chapter-network h3{margin:0 0 16px;font-size:22px}.learning-caption{font-size:14px;margin:12px 0 0}
.test-after{display:inline-block;margin-top:10px;color:inherit}@media(max-width:520px){body{padding:12px}.chapter-network{padding:12px;margin-block:18px}}
</style><script defer src="/learning-graph-layout.js"></script><script defer src="/learning-content.js"></script>
</head><body class="knowledge-page${theme === 'dark' ? ' theme-dark' : ''}"><main>
<p class="example-label">课程组章图示例（非生产数据）</p><h1>信号表示与系统分析</h1><p class="example-scenario">${fixture.label}</p>
<section id="network" class="chapter-network" aria-label="课程组章图示例"></section>
<a class="test-after" href="#top">返回示例顶部</a></main>
<script>document.addEventListener('DOMContentLoaded',()=>{const data=${payload};window.fixtureSource=JSON.stringify(data.map);window.fixture=data;FreeBbsLearningContent.renderNetwork(document.getElementById('network'),data.map,data.chapter,data.course);window.fixtureReady=true;});</script>
</body></html>`;
}

function createPreview() {
  return http.createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end('Read-only local fixture');
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const scene = url.searchParams.get('case') || 'mixed';
      if (!Object.hasOwn(fixtures, scene)) {
        response.writeHead(404).end('Unknown isolated fixture');
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(html(scene, url.searchParams.get('theme')));
      return;
    }
    const file = url.pathname.slice(1);
    if (files.includes(file)) {
      response.writeHead(200, {
        'Content-Type': file.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(fs.readFileSync(path.join(root, 'public', file)));
    } else if (url.pathname === '/knowledge') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><title>本地链接验证</title><p>本地学习概览链接已到达；未请求正式内容。</p>',
      );
    } else response.writeHead(404).end('Only isolated fixture resources are available');
  });
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        x: value.x,
        y: value.y,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const intersects = (a, b, margin = 0) =>
      a.x < b.right - margin &&
      a.right > b.x + margin &&
      a.y < b.bottom - margin &&
      a.bottom > b.y + margin;
    const svg = document.querySelector('#network svg');
    const viewport = document.querySelector('.chapter-network-viewport');
    const boxes = [...document.querySelectorAll('#network a[data-node-id]')].map((element) => ({
      id: element.dataset.nodeId,
      ...rect(element.querySelector('rect')),
      aria: element.getAttribute('aria-label'),
      tooltip: element.querySelector('title').textContent,
      href: element.getAttribute('href'),
      text: [...element.querySelectorAll('text')].map((text) => ({
        ...rect(text),
        text: text.textContent,
        size: getComputedStyle(text).fontSize,
      })),
    }));
    const overlaps = [];
    const textOverflows = [];
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1))
        if (intersects(box, other, 0.5)) overlaps.push([box.id, other.id]);
      for (const text of box.text)
        if (
          text.x < box.x + 6 ||
          text.right > box.right - 6 ||
          text.y < box.y + 4 ||
          text.bottom > box.bottom - 4
        )
          textOverflows.push({ id: box.id, text });
    }
    const crossings = [];
    const arrowOverlaps = [];
    const outside = [];
    const svgRect = svg ? rect(svg) : null;
    const links = [...document.querySelectorAll('.chapter-network-edge')].map((element) => {
      const line = element.querySelector('path.chapter-network-connector');
      const arrow = element.querySelector('path.chapter-network-arrow');
      const total = line.getTotalLength();
      const matrix = line.getScreenCTM();
      const link = {
        source: element.dataset.source,
        target: element.dataset.target,
        ordered: element.classList.contains('is-ordered'),
        arrow: Boolean(arrow),
        length: total,
        path: line.getAttribute('d'),
      };
      const crossed = new Set();
      const margin = 0.75;
      for (let distance = 0; distance <= total + margin; distance += margin) {
        const local = line.getPointAtLength(Math.min(distance, total));
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        for (const box of boxes)
          if (
            screen.x > box.x + 0.75 &&
            screen.x < box.right - 0.75 &&
            screen.y > box.y + 0.75 &&
            screen.y < box.bottom - 0.75
          )
            crossed.add(box.id);
      }
      for (const id of crossed)
        crossings.push({ source: link.source, target: link.target, node: id });
      if (arrow) {
        const arrowRect = rect(arrow);
        for (const box of boxes)
          if (intersects(arrowRect, box, 0.5))
            arrowOverlaps.push({
              source: link.source,
              target: link.target,
              node: box.id,
              arrowRect,
            });
      }
      for (const part of [line, arrow].filter(Boolean)) {
        const partRect = rect(part);
        if (
          partRect.x < svgRect.x - 0.5 ||
          partRect.right > svgRect.right + 0.5 ||
          partRect.y < svgRect.y - 0.5 ||
          partRect.bottom > svgRect.bottom + 0.5
        )
          outside.push({
            source: link.source,
            target: link.target,
            part: part.classList.value,
            rect: partRect,
          });
      }
      return link;
    });
    return {
      boxes,
      overlaps,
      textOverflows,
      links,
      crossings,
      arrowOverlaps,
      outside,
      viewport: viewport
        ? {
            ...rect(viewport),
            visibleBounds: {
              x: viewport.getBoundingClientRect().x + viewport.clientLeft,
              y: viewport.getBoundingClientRect().y + viewport.clientTop,
              right:
                viewport.getBoundingClientRect().x + viewport.clientLeft + viewport.clientWidth,
              bottom:
                viewport.getBoundingClientRect().y + viewport.clientTop + viewport.clientHeight,
            },
            scrollWidth: viewport.scrollWidth,
            scrollHeight: viewport.scrollHeight,
            clientWidth: viewport.clientWidth,
            clientHeight: viewport.clientHeight,
          }
        : null,
      containerWidth: document.getElementById('network').clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      sourceUnchanged: JSON.stringify(window.fixture.map) === window.fixtureSource,
      emptyMessage: document.getElementById('network').textContent,
    };
  });
}

async function keyboard(page, scene) {
  if (!scene.nodes.length) return { empty: true };
  const viewport = page.locator('.chapter-network-viewport');
  await viewport.focus();
  const scroll = await viewport.evaluate((element) => ({
    x: element.scrollLeft,
    y: element.scrollTop,
    vertical: element.scrollHeight > element.clientHeight + 2,
    horizontal: element.scrollWidth > element.clientWidth + 2,
  }));
  if (scroll.vertical || scroll.horizontal) {
    await page.keyboard.press(scroll.vertical ? 'ArrowDown' : 'ArrowRight');
    await page.waitForFunction(({ x, y }) => {
      const element = document.querySelector('.chapter-network-viewport');
      return element.scrollTop > y || element.scrollLeft > x;
    }, scroll);
    // Native arrow-key scrolling may animate. Let it finish before Tab checks,
    // otherwise its remaining motion can hide a newly focused card artificially.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const viewportElement = document.querySelector('.chapter-network-viewport');
          let previous = [viewportElement.scrollLeft, viewportElement.scrollTop];
          let quiet = 0;
          const deadline = performance.now() + 1500;
          const tick = () => {
            const next = [viewportElement.scrollLeft, viewportElement.scrollTop];
            quiet = next.every((value, index) => value === previous[index]) ? quiet + 1 : 0;
            previous = next;
            if (quiet >= 4 || performance.now() >= deadline) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
  }
  const ids = [];
  const hiddenFocused = [];
  for (let index = 0; index < scene.nodes.length; index += 1) {
    await page.keyboard.press('Tab');
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      const viewportElement = document.querySelector('.chapter-network-viewport');
      const box = element?.getBoundingClientRect();
      const outer = viewportElement.getBoundingClientRect();
      const boundary = {
        x: outer.x + viewportElement.clientLeft,
        y: outer.y + viewportElement.clientTop,
        right: outer.x + viewportElement.clientLeft + viewportElement.clientWidth,
        bottom: outer.y + viewportElement.clientTop + viewportElement.clientHeight,
      };
      return {
        id: element?.dataset.nodeId || '',
        box: box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom } : null,
        boundary: {
          x: boundary.x,
          y: boundary.y,
          right: boundary.right,
          bottom: boundary.bottom,
        },
        scroll: { x: viewportElement.scrollLeft, y: viewportElement.scrollTop },
        visible: Boolean(
          box &&
          box.left >= boundary.x + 0.5 &&
          box.right <= boundary.right - 0.5 &&
          box.top >= boundary.y + 0.5 &&
          box.bottom <= boundary.bottom - 0.5,
        ),
      };
    });
    ids.push(focused.id);
    if (!focused.visible) hiddenFocused.push(focused);
  }
  assert.deepEqual(
    ids,
    scene.nodes.map((node) => node.id),
    'Tab visits all ordinary points in the chapter',
  );
  assert.deepEqual(
    hiddenFocused,
    [],
    'Native keyboard focus scrolls its node into the graph viewport',
  );
  const last = scene.nodes.at(-1);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/knowledge'),
    page.keyboard.press('Enter'),
  ]);
  const destination = new URL(page.url());
  assert.equal(destination.searchParams.get('course'), 'signals');
  assert.equal(
    destination.searchParams.get('point'),
    last.id,
    'Full long ID survives link navigation',
  );
  return {
    scroll: scroll.vertical || scroll.horizontal,
    tabIds: ids,
    focusedNodesVisible: true,
    enterDestination: destination.pathname + destination.search,
  };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = createPreview();
  report.portSelection = await listenAllowedLoopback(server);
  const base = `http://127.0.0.1:${report.portSelection.port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(options.get('--chrome') || process.env.CHROME_BIN
        ? { executablePath: options.get('--chrome') || process.env.CHROME_BIN }
        : {}),
      args: ['--disable-background-networking'],
    });
    for (const [name, fixture] of Object.entries(fixtures))
      for (const width of [1440, 390, 320])
        for (const theme of ['light', 'dark']) {
          const result = {
            key: `${name}-${theme}-${width}`,
            theme,
            width,
            label: fixture.label,
            status: 'pending',
            checks: [],
            pageErrors: [],
            blockedRequests: [],
          };
          report.cases.push(result);
          const context = await browser.newContext({
            viewport: { width, height: width === 1440 ? 1000 : width === 390 ? 844 : 700 },
            deviceScaleFactor: 1,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(7000);
          page.on('pageerror', (error) => result.pageErrors.push(error.message));
          await context.route('**/*', (route) => {
            const request = route.request();
            if (new URL(request.url()).origin === base && request.method() === 'GET')
              return route.continue();
            result.blockedRequests.push({ url: request.url(), method: request.method() });
            return route.abort('blockedbyclient');
          });
          const check = async (label, action) => {
            try {
              const value = await action();
              result.checks.push({
                label,
                status: 'passed',
                ...(value === undefined ? {} : { value }),
              });
            } catch (error) {
              result.checks.push({ label, status: 'failed', error: error.stack });
              report.errors.push({ scene: result.key, label, error: error.message });
            }
          };
          try {
            await page.goto(`${base}/?${new URLSearchParams({ case: name, theme })}`, {
              waitUntil: 'domcontentloaded',
            });
            await page.waitForFunction(() => window.fixtureReady);
            await page.evaluate(() => document.fonts.ready);
            const resultGeometry = await geometry(page);
            result.geometry = resultGeometry;
            await check('Chapter filtering preserves only real in-chapter nodes and edges', () => {
              assert.deepEqual(
                resultGeometry.boxes.map((box) => box.id).sort(),
                fixture.nodes.map((node) => node.id).sort(),
              );
              assert.deepEqual(
                resultGeometry.links
                  .map(
                    (link) =>
                      `${link.source}|${link.target}|${link.ordered ? 'ordered' : 'related'}`,
                  )
                  .sort(),
                fixture.edges.map((link) => `${link.source}|${link.target}|${link.type}`).sort(),
              );
            });
            await check(
              'Cards and all rendered text remain separate and inside their cards',
              () => {
                assert.deepEqual(resultGeometry.overlaps, []);
                assert.deepEqual(resultGeometry.textOverflows, []);
              },
            );
            await check('Actual connector curves and arrow bounds stay outside every card', () => {
              assert.deepEqual(resultGeometry.crossings, []);
              assert.deepEqual(resultGeometry.arrowOverlaps, []);
              assert.deepEqual(resultGeometry.outside, []);
              assert.ok(resultGeometry.links.every((link) => link.ordered === link.arrow));
            });
            await check(
              'Page fits the screen, source data stays untouched and empty state is honest',
              () => {
                assert.ok(resultGeometry.containerWidth > 0);
                assert.ok(resultGeometry.pageWidth <= resultGeometry.viewportWidth + 1);
                assert.equal(resultGeometry.sourceUnchanged, true);
                if (!fixture.nodes.length)
                  assert.match(resultGeometry.emptyMessage, /本章尚未发布知识点/);
                else if (width < 520) {
                  const first = resultGeometry.boxes[0];
                  const boundary = resultGeometry.viewport.visibleBounds;
                  assert.ok(
                    first.x >= boundary.x + 0.5 && first.right <= boundary.right - 0.5,
                    'The initial mobile view shows a complete first card without horizontal adjustment',
                  );
                }
              },
            );
            if (name === 'mixed')
              await check(
                'Full long identifiers survive accessible labels, tooltips and links',
                () => {
                  const box = resultGeometry.boxes.find((node) => node.id === longId);
                  assert.ok(box);
                  assert.ok(box.tooltip.includes(longId));
                  assert.ok(box.aria.includes(fixture.nodes.at(-1).title));
                  assert.equal(new URL(box.href, base).searchParams.get('point'), longId);
                },
              );
            result.screenshot = path.join(output, `${run}-chapter-${result.key}.png`);
            await page.screenshot({ path: result.screenshot, fullPage: true });
            await check(
              'Native keyboard scrolling, Tab traversal and Enter link navigation',
              async () => keyboard(page, fixture),
            );
            await check('No browser script errors or unexpected network requests', () => {
              assert.deepEqual(result.pageErrors, []);
              assert.deepEqual(result.blockedRequests, []);
            });
            result.status = result.checks.some((item) => item.status === 'failed')
              ? 'failed'
              : 'passed';
          } catch (error) {
            result.status = 'failed';
            result.error = error.stack;
            report.errors.push({ scene: result.key, error: error.message });
            await page
              .screenshot({
                path: path.join(output, `${run}-chapter-${result.key}-failure.png`),
                fullPage: true,
              })
              .catch(() => {});
          } finally {
            await context.close();
            save();
            console.log(`${result.key}: ${result.status}`);
          }
        }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
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
  report.errors.push({ error: error.message });
  fs.mkdirSync(output, { recursive: true });
  save();
  console.error(error.stack);
  process.exitCode = 1;
});
