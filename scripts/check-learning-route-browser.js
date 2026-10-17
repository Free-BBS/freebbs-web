// Real Chrome navigation checks. Only explicit loopback fixtures and memory records are allowed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startCompleteLearningPreview } = require('./preview-learning-complete');

const root = path.join(__dirname, '..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith('--') || !process.argv[index + 1])
    throw new Error('Use explicit option/value pairs');
  options.set(process.argv[index], process.argv[index + 1]);
}
const supplied = new URL(options.get('--base') || 'http://127.0.0.1:25251');
if (
  supplied.protocol !== 'http:' ||
  supplied.hostname !== '127.0.0.1' ||
  !supplied.port ||
  supplied.pathname !== '/' ||
  supplied.username ||
  supplied.password ||
  supplied.search ||
  supplied.hash
)
  throw new Error('Use only an explicit isolated http://127.0.0.1:PORT preview');
const base = supplied.origin;
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  options.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const output = path.resolve(
  options.get('--output') || path.join(root, 'output/learning-route-20261016'),
);
fs.mkdirSync(output, { recursive: true });
const run = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(output, `${run}-report.json`);
const sources = [
  'public/course.html',
  'public/knowledge.html',
  'public/course-map.js',
  'public/course-navigation.js',
  'public/knowledge.js',
  'public/knowledge-workspace.js',
  'public/learning-analytics.js',
  'public/learning-reader.js',
  'public/learning-outline.js',
  'public/learning-outline.css',
  'public/learning-next-steps.js',
  'public/learning-progress.js',
  'public/learning-start.js',
  'public/learning-stars.js',
  'public/learning-graph-layout.js',
  'public/knowledge-overview.js',
  'public/learning-content.js',
  'public/course-structure.js',
  'public/course-structure.css',
  'public/learning-route.js',
  'public/course-learning-route.js',
  'public/course-learning-route.css',
  'public/course-catalog.js',
  'public/course-catalog.css',
  'public/learning-guide.js',
  'public/knowledge-workspace.css',
  'public/max-guide-stations.js',
  'public/world.js',
  'public/world.css',
  'public/world.html',
  'public/world-refinements.css',
  'public/world-course-directory.css',
  'public/course-orbit.css',
];
const hashes = () =>
  Object.fromEntries(
    sources
      .filter(
        (file) =>
          options.get('--scope') !== 'core' ||
          ![
            'public/world.js',
            'public/world.css',
            'public/world.html',
            'public/world-refinements.css',
            'public/world-course-directory.css',
            'public/course-orbit.css',
          ].includes(file),
      )
      .map((file) => [
        file,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(root, file)))
          .digest('hex'),
      ]),
  );
const report = {
  boundary:
    'Real current UI on isolated loopback origins. Real public course snapshots for navigation; author demo for full world/onboarding/private records. Synthetic identities, memory-only records, simulated Max. No live course writes, production requests or real private learner data. A cycle fixture changes only an intercepted local GET response.',
  base,
  startedAt: new Date().toISOString(),
  smokeOnly: options.get('--smoke') === 'true',
  scope: options.get('--scope') || 'all',
  sourceBefore: hashes(),
  cases: [],
  errors: [],
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const state = (page) =>
  page.evaluate(() =>
    document.getElementById('course-map-canvas')?.courseStructureController?.getState(),
  );
async function courseReady(page) {
  await page.waitForFunction(() =>
    Boolean(
      document.getElementById('course-map-canvas')?.courseStructureController &&
      document.querySelector('.course-learning-route .course-route-chapter'),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
}
async function focused(page, id) {
  await page.waitForFunction(
    (value) =>
      document.getElementById('course-map-canvas')?.courseStructureController?.getState()
        ?.focusedNodeId === value,
    id,
  );
}
async function readingReady(page, id) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false' &&
      Boolean(window.freeBbsKnowledge?.getLearningContext()?.node?.id),
  );
  assert.equal(new URL(page.url()).searchParams.get('point'), id);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'reading');
  assert.equal(
    await page.locator('.learning-start-dialog[open]').count(),
    0,
    'A repeated mandatory learning-goal prompt must not obstruct reading',
  );
  await page
    .locator('#knowledge-reading:not(.hidden) #knowledge-body')
    .waitFor({ state: 'visible' });
}
async function assertFits(page) {
  const geometry = await page.evaluate(() => {
    const selectors = [
      '.course-learning-entry-links',
      '.course-route-chapter',
      '.course-route-primary',
      '.course-direct-find .course-structure-toolbar input[type="search"]',
    ];
    const overflow = [];
    for (const selector of selectors)
      for (const element of document.querySelectorAll(selector)) {
        if (!element.getClientRects().length || element.closest('[hidden]')) continue;
        const box = element.getBoundingClientRect();
        if (box.left < -1 || box.right > window.innerWidth + 1)
          overflow.push({ selector, left: box.left, right: box.right });
      }
    return { page: document.documentElement.scrollWidth, width: window.innerWidth, overflow };
  });
  assert.ok(
    geometry.page <= geometry.width + 1,
    `The route page overflows horizontally (${geometry.page}/${geometry.width})`,
  );
  assert.deepEqual(geometry.overflow, [], 'Primary controls fit their viewport');
  return geometry;
}
async function contrast(page) {
  const colors = await page.locator('.course-route-primary').evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(colors.foreground);
  const b = luminance(colors.background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(ratio >= 4.5, `Primary route action contrast is ${ratio.toFixed(2)}`);
  return { ...colors, ratio };
}
async function pointerWorks(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true });
  const hit = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const found = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(found && (element === found || element.contains(found)));
  });
  assert.ok(hit, `The real pointer can reach the control center: ${locator}`);
  await locator.click();
}
async function screenshot(page, result, suffix = '') {
  const file = path.join(output, `${run}-${result.key}${suffix}.png`);
  await page.screenshot({ path: file });
  if (!result.screenshots) Object.assign(result, { screenshots: [] });
  result.screenshots.push(file);
}
async function closeOverview(page) {
  if (await page.locator('#course-knowledge-overview[open]').count()) {
    await page.keyboard.press('Escape');
    await page.locator('#course-knowledge-overview[open]').waitFor({ state: 'hidden' });
  }
}
async function openRouteNode(page, id, keyboard = false) {
  const entry = page.locator(`.course-route-node[data-course-route-node-id="${id}"]`);
  if (keyboard) {
    await entry.focus();
    await page.keyboard.press('Enter');
  } else await pointerWorks(page, entry);
  await focused(page, id);
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.knowledge-overview-drawer-body [aria-busy]')
        ?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(await page.locator('.knowledge-overview-status[data-state="error"]').count(), 0);
}
async function routeConnections(page, originalEdges) {
  const data = await page.evaluate(() => ({
    kind: document.querySelector('.course-learning-route')?.dataset.routeKind,
    edges: [...document.querySelectorAll('.course-route-lines [data-route-source]')].map(
      (element) => [element.dataset.routeSource, element.dataset.routeTarget],
    ),
    locked: [...document.querySelectorAll('.course-route-node')].filter(
      (element) => element.disabled || element.getAttribute('aria-disabled') === 'true',
    ).length,
    hiddenAccessibleCues: [...document.querySelectorAll('.course-route-node')].flatMap(
      (element) => {
        const referenced = (attribute) =>
          (element.getAttribute(attribute) || '')
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
            .trim();
        const accessibleText = `${referenced('aria-labelledby') || element.getAttribute('aria-label') || element.textContent} ${referenced('aria-describedby')}`;
        return [...element.querySelectorAll('.course-route-status, .course-route-branch')]
          .map((cue) => cue.textContent.trim())
          .filter((cue) => cue && !accessibleText.includes(cue))
          .map((cue) => ({ id: element.dataset.courseRouteNodeId, cue }));
      },
    ),
  }));
  const published = new Set(
    originalEdges
      .filter((edge) => edge.type === 'ordered')
      .map((edge) => `${edge.source}|${edge.target}`),
  );
  assert.equal(data.locked, 0, 'Route steps are not a mastery or prerequisite lock');
  assert.deepEqual(
    data.hiddenAccessibleCues,
    [],
    'Visible reading/branch cues remain present in the route button accessible name or description',
  );
  assert.ok(
    data.edges.every(([source, target]) => published.has(`${source}|${target}`)),
    'Every route connector represents a supplied ordered edge',
  );
  return data;
}
async function searchPoint(page, query, id, keyboard = false) {
  const search = page.locator('.course-structure-toolbar input[type="search"]');
  await search.fill(query);
  const result = page
    .locator('.course-structure-search-results button')
    .filter({ hasText: id })
    .first();
  await result.waitFor();
  if (keyboard) {
    await result.focus();
    await page.keyboard.press('Enter');
  } else await pointerWorks(page, result);
  await focused(page, id);
  await page.locator('#course-knowledge-overview[open]').waitFor();
}
async function readAndReturn(page, id, { catalogOpen = false } = {}) {
  const expectedNavigation = await page.evaluate(() =>
    document.getElementById('course-map-canvas').courseStructureController.getNavigationState(),
  );
  // The originating catalog closes while its overview is open. A return to an
  // explicitly catalog-chosen point should reopen it, not preserve that
  // temporary closed state of the underlying document.
  if (catalogOpen) expectedNavigation.catalogOpen = 1;
  await pointerWorks(
    page,
    page.locator('#course-knowledge-overview[open] .knowledge-overview-study'),
  );
  await readingReady(page, id);
  await page.waitForFunction((value) => {
    const progress = window.FreeBbsLearningProgress;
    const data = progress?.read(
      localStorage,
      'free_bbs_current_learning_node_v1',
      window.freeBbsApp?.userState,
    );
    return Object.values(data || {}).includes(value);
  }, id);
  const link = page.locator('#knowledge-course-link');
  const href = await link.getAttribute('href');
  assert.equal(
    new URL(href, page.url()).searchParams.get('focus'),
    id,
    'The return link carries the actual current node',
  );
  await pointerWorks(page, link);
  await courseReady(page);
  await focused(page, id);
  assert.equal(
    await page.locator('#course-knowledge-overview[open]').count(),
    0,
    'URL focus restore must locate, not reopen a modal',
  );
  assert.equal(
    await page.locator('.course-route-chapter').inputValue(),
    id.split('-').slice(0, 2).join('-'),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      document.getElementById('course-map-canvas').courseStructureController.getNavigationState(),
    ),
    expectedNavigation,
    'Return retains chapter, global query, fine-filter scope and route/picker pages, not only the point ID',
  );
}
async function catalogScenario(page, result, map) {
  const trigger = page.locator('.course-catalog-open');
  const before = await state(page);
  await pointerWorks(page, trigger);
  const dialog = page.locator('.course-catalog-dialog[open]');
  await dialog.waitFor();
  assert.equal(await dialog.locator('input[type="search"]:visible').count(), 1);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await trigger.evaluate((element) => element === document.activeElement),
    true,
    'Esc returns focus to the full-directory trigger',
  );
  assert.deepEqual(
    await state(page),
    before,
    'Opening and dismissing the directory does not change the selected chapter or point',
  );
  await pointerWorks(page, trigger);
  const first = dialog.locator('[data-catalog-chapter-id]').first();
  const chapter = await first.getAttribute('data-catalog-chapter-id');
  if (!(await first.isVisible()))
    await pointerWorks(page, dialog.locator('.course-catalog-chapter-picker > summary'));
  await pointerWorks(page, first);
  const expected = map.nodes.filter(
    (node) => node.id.split('-').slice(0, 2).join('-') === chapter && !/-0+$/.test(node.id),
  );
  const count = await dialog.locator('.course-catalog-result').count();
  assert.equal(count, Math.min(40, expected.length));
  for (const item of await dialog.locator('.course-catalog-result').evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.dataset.catalogNodeId,
      title: element.querySelector('strong').textContent,
    })),
  ))
    assert.equal(
      item.title,
      map.nodes.find((node) => node.id === item.id).title,
      'Complete directory shows each actual full point name',
    );
  await screenshot(page, result, '-complete-directory');
  const other =
    map.nodes.find(
      (node) => !/-0+$/.test(node.id) && node.id.split('-').slice(0, 2).join('-') !== chapter,
    ) || expected[0];
  const search = dialog.locator('.course-catalog-search');
  await search.fill(other.id);
  assert.match(await dialog.locator('.course-catalog-status').innerText(), /全课程搜索/);
  await dialog.locator(`[data-catalog-node-id="${other.id}"]`).waitFor();
  await pointerWorks(page, dialog.locator('.course-catalog-clear'));
  assert.equal(await search.inputValue(), '');
  assert.equal(
    await dialog.locator(`[data-catalog-chapter-id="${chapter}"]`).getAttribute('aria-pressed'),
    'true',
    'Clearing global search restores the independently selected browsing chapter',
  );
  await search.fill(other.title);
  assert.equal(
    await search.evaluate((element) => element === document.activeElement),
    true,
    'Search results do not steal typing focus',
  );
  const entry = dialog.locator(`[data-catalog-node-id="${other.id}"]`);
  await entry.waitFor();
  const labelFits = await entry
    .locator('strong')
    .evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
    );
  assert.ok(
    labelFits,
    'Knowledge-point names are not visually truncated inside the full-directory entry',
  );
  await entry.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await focused(page, other.id);
  assert.equal(
    await page.locator('.course-route-chapter').inputValue(),
    other.id.split('-').slice(0, 2).join('-'),
  );
  await readAndReturn(page, other.id, { catalogOpen: true });
  await page.locator('.course-catalog-dialog[open]').waitFor();
  assert.equal(
    await page.locator('.course-catalog-dialog[open] .course-catalog-search').inputValue(),
    other.title,
    'Returning from a catalog-selected point restores the actual catalog query',
  );
  await page.keyboard.press('Escape');
  Object.assign(result, {
    completeDirectory: {
      escapedAndRestoredFocus: true,
      chapter,
      crossChapterNameAndId: other.id,
      fullPointNames: true,
    },
  });
}
async function publicScenario(page, result, scene, map) {
  await page.goto(
    `${base}/course?${new URLSearchParams({ course: scene.slug, as: 'student', theme: scene.theme })}`,
    { waitUntil: 'domcontentloaded' },
  );
  await courseReady(page);
  Object.assign(result, { geometry: await assertFits(page) });
  assert.equal(
    await page.locator('.course-direct-find input[type="search"]:visible').count(),
    1,
    'One global search is initially visible; fine filtering is opt-in',
  );
  const chapter =
    scene.chapter ||
    (await page.locator('.course-route-chapter option').first().getAttribute('value'));
  await page.locator('.course-route-chapter').selectOption(chapter);
  await page.waitForFunction(
    (value) =>
      document.getElementById('course-map-canvas').courseStructureController.getState()
        .selectedChapterId === value,
    chapter,
  );
  const id = await page
    .locator('.course-route-node')
    .first()
    .getAttribute('data-course-route-node-id');
  assert.ok(id, 'A genuine published route point exists');
  Object.assign(result, { firstPoint: id, connectors: await routeConnections(page, map.edges) });
  Object.assign(result, { primaryContrast: await contrast(page) });
  if (scene.noOrder) {
    assert.equal(result.connectors.kind, 'directory');
    assert.equal(result.connectors.edges.length, 0);
    assert.match(await page.locator('.course-route-description').innerText(), /目录顺序/);
  }
  if (scene.width <= 390) {
    await page.locator('.course-learning-entry-links button').filter({ hasText: '直接找' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page
        .locator('.course-structure-toolbar input[type="search"]')
        .evaluate((element) => element === document.activeElement),
      true,
      'Direct-find shortcut moves keyboard focus to search',
    );
    await page.locator('.course-learning-entry-links button').filter({ hasText: '顺着学' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page
        .locator('.course-learning-route')
        .evaluate((element) => element === document.activeElement),
      true,
    );
  }
  await page.locator('.course-learning-route').scrollIntoViewIfNeeded();
  await screenshot(page, result, '-route');
  if (options.get('--smoke') === 'true') return;
  const next = page.locator('.course-route-next');
  if ((await next.isVisible()) && (await next.isEnabled())) {
    const firstIds = await page
      .locator('.course-route-node')
      .evaluateAll((elements) => elements.map((element) => element.dataset.courseRouteNodeId));
    await next.focus();
    await page.keyboard.press('Enter');
    const secondIds = await page
      .locator('.course-route-node')
      .evaluateAll((elements) => elements.map((element) => element.dataset.courseRouteNodeId));
    assert.ok(
      secondIds.length && secondIds.every((value) => !firstIds.includes(value)),
      'Next segment presents additional genuine points',
    );
    await page.locator('.course-route-previous').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(
      await page
        .locator('.course-route-node')
        .evaluateAll((elements) => elements.map((element) => element.dataset.courseRouteNodeId)),
      firstIds,
      'Previous segment restores the same route points',
    );
    Object.assign(result, { routePaginationKeyboard: true });
  }
  const crossPageExit = page.locator('[data-course-route-exit-id]:visible').first();
  if (await crossPageExit.count()) {
    const exitId = await crossPageExit.getAttribute('data-course-route-exit-id');
    await crossPageExit.focus();
    await page.keyboard.press('Enter');
    await focused(page, exitId);
    await page.locator('#course-knowledge-overview[open]').waitFor();
    assert.equal(
      await page.locator(`.course-route-node[data-course-route-node-id="${exitId}"]`).count(),
      1,
      'A cross-segment connection reveals the actual destination segment',
    );
    await closeOverview(page);
    while (await page.locator('.course-route-previous').isEnabled()) {
      await page.locator('.course-route-previous').focus();
      await page.keyboard.press('Enter');
    }
    Object.assign(result, { crossSegmentConnection: exitId });
  }
  await openRouteNode(page, id, true);
  const { title } = map.nodes.find((node) => node.id === id);
  assert.ok((await page.locator('.knowledge-overview-drawer-body').innerText()).includes(title));
  await pointerWorks(page, page.locator('.knowledge-overview-drawer-footer > button'));
  await page.locator('#course-knowledge-overview[open]').waitFor({ state: 'hidden' });
  assert.equal(
    (await state(page)).focusedNodeId,
    id,
    'Viewing relationships retains the requested point',
  );
  const relationGeometry = await page.locator('.course-structure-current').evaluate((element) => {
    const heading = element.querySelector('h2');
    const box = heading?.getBoundingClientRect();
    const hit =
      box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      focused: element === document.activeElement,
      heading: heading?.textContent,
      top: box?.top,
      bottom: box?.bottom,
      height: window.innerHeight,
      titleUncovered: Boolean(hit && (hit === heading || heading?.contains(hit))),
    };
  });
  assert.equal(
    relationGeometry.focused,
    true,
    'Viewing relations transfers keyboard focus to the visible relation content',
  );
  assert.equal(relationGeometry.heading, title);
  assert.ok(relationGeometry.top >= 0 && relationGeometry.bottom <= relationGeometry.height);
  assert.equal(
    relationGeometry.titleUncovered,
    true,
    'The requested relationship title is actually visible, not behind a fixed bar',
  );
  Object.assign(result, { relationActionVisibleAndFocused: relationGeometry });
  await openRouteNode(page, id);
  await readAndReturn(page, id);
  await routeConnections(page, map.edges || []);
  Object.assign(result, { routeOverviewReadReturn: true });
  let resumeId = id;
  let recent = page.locator(`.course-structure-resume[data-course-resume-id="${resumeId}"]`);
  await recent.waitFor();
  const other = map.nodes.find(
    (node) => !/-0+$/.test(node.id) && node.id.split('-').slice(0, 2).join('-') !== chapter,
  );
  if (other) {
    await searchPoint(page, other.id, other.id, true);
    await closeOverview(page);
    assert.equal(
      await page.locator('.course-route-chapter').inputValue(),
      other.id.split('-').slice(0, 2).join('-'),
      'Global ID search crosses chapter boundaries',
    );
    await searchPoint(page, other.title, other.id);
    await readAndReturn(page, other.id);
    resumeId = other.id;
    recent = page.locator(`.course-structure-resume[data-course-resume-id="${resumeId}"]`);
    Object.assign(result, { crossChapterNameAndId: other.id });
  }
  await pointerWorks(page, recent.locator('button'));
  await focused(page, resumeId);
  assert.equal(
    await page.locator('#course-knowledge-overview[open]').count(),
    0,
    'Resume locate does not force another overview',
  );
  await pointerWorks(page, recent.locator('a'));
  await readingReady(page, resumeId);
  assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
  Object.assign(result, { realReadCreatedResume: true });
  await pointerWorks(page, page.locator('#knowledge-course-link'));
  await courseReady(page);
  await focused(page, resumeId);
  await screenshot(page, result, '-return');
  await catalogScenario(page, result, map);
}
async function accessibleCatalogScenario(page, result, scene, map) {
  await page.goto(`${base}/course?course=math&as=student`, { waitUntil: 'domcontentloaded' });
  await courseReady(page);
  // This is an isolated browser stress setting, not an advertised app preset.
  // No author content, IDs, evidence or fingerprints are changed.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const trigger = page.locator('.course-catalog-open');
  await pointerWorks(page, trigger);
  const dialog = page.locator('.course-catalog-dialog[open]');
  const summary = dialog.locator('.course-catalog-chapter-picker > summary');
  if (await summary.isVisible()) {
    await pointerWorks(page, summary);
    await pointerWorks(page, dialog.locator('[data-catalog-chapter-id]').first());
  }
  const search = dialog.locator('.course-catalog-search');
  await pointerWorks(page, search);
  const longest = map.nodes
    .filter((node) => !/-0+$/.test(node.id))
    .reduce((previous, node) => (node.title.length > previous.title.length ? node : previous));
  await search.fill(longest.id);
  const entry = dialog.locator(`[data-catalog-node-id="${longest.id}"]`);
  await entry.waitFor();
  assert.equal(await entry.locator('strong').textContent(), longest.title);
  const titleGeometry = await entry.locator('strong').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.ok(titleGeometry.scrollWidth <= titleGeometry.clientWidth + 1);
  assert.ok(titleGeometry.scrollHeight <= titleGeometry.clientHeight + 1);
  assert.ok(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    'The complete catalog does not acquire horizontal scrolling at 200% root text',
  );
  await screenshot(page, result, '-long-title');
  await pointerWorks(page, entry);
  await focused(page, longest.id);
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await closeOverview(page);
  // Dismissing a catalog-origin overview deliberately restores that catalog.
  await dialog.waitFor();
  await pointerWorks(page, dialog.locator('.course-catalog-clear'));
  assert.equal(await search.inputValue(), '');
  if (await summary.isVisible()) {
    if (!(await dialog.locator('.course-catalog-chapter').first().isVisible()))
      await pointerWorks(page, summary);
    await pointerWorks(page, dialog.locator('.course-catalog-chapter').first());
  }
  const next = dialog.locator('.course-catalog-next');
  assert.equal(await next.isEnabled(), true);
  await pointerWorks(page, next);
  const previous = dialog.locator('.course-catalog-previous');
  assert.equal(await previous.isEnabled(), true);
  await pointerWorks(page, previous);
  await pointerWorks(page, dialog.locator('.course-catalog-close'));
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  Object.assign(result, {
    stressSetting: '200% document root text, isolated rendering only',
    actualLongestPublishedTitle: { id: longest.id, title: longest.title, titleGeometry },
    searchChapterClearPagingClosePointerReachable: true,
    width: scene.width,
    height: scene.height,
  });
}
async function nativeComposition(page, search) {
  await search.fill('');
  await pointerWorks(page, search);
  await page.evaluate(() => {
    window.freeBbsQaImeEvents = [];
    if (window.freeBbsQaImeListenerReady) return;
    window.freeBbsQaImeListenerReady = true;
    for (const name of ['compositionstart', 'compositionupdate', 'compositionend', 'input'])
      document.addEventListener(
        name,
        (event) => {
          if (event.target?.type === 'search')
            window.freeBbsQaImeEvents.push({
              type: event.type,
              trusted: event.isTrusted,
              composing: Boolean(event.isComposing),
              value: event.target.value,
            });
        },
        { capture: true, once: false },
      );
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', {
      text: '连',
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send('Input.imeSetComposition', {
      text: '连续',
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send('Input.insertText', { text: '连续' });
  } finally {
    await cdp.detach();
  }
  assert.equal(await search.inputValue(), '连续');
  assert.equal(await search.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await search.evaluate((element) => element.selectionStart), 1);
  await page.keyboard.insertText('x');
  assert.equal(await search.inputValue(), '连x续');
  assert.equal(await search.evaluate((element) => element.selectionStart), 2);
  await page.keyboard.press('Backspace');
  assert.equal(await search.inputValue(), '连续');
  assert.equal(await search.evaluate((element) => element.selectionStart), 1);
  assert.equal(await search.evaluate((element) => element === document.activeElement), true);
  const events = await page.evaluate(() => window.freeBbsQaImeEvents);
  assert.ok(
    events.some((event) => event.type === 'compositionend'),
    `Native composition must commit on the same input: ${JSON.stringify(events)}`,
  );
  assert.ok(events.some((event) => event.type === 'compositionstart' && event.trusted));
  assert.ok(events.some((event) => event.type === 'input' && event.composing && event.trusted));
  assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
  return events;
}
async function typingScenario(page, result) {
  await page.goto(`${base}/course?course=math&as=student`, { waitUntil: 'domcontentloaded' });
  await courseReady(page);
  const direct = page.locator('.course-structure-toolbar input[type="search"]');
  const directEvents = await nativeComposition(page, direct);
  assert.ok(await page.locator('.course-structure-search-results button').count());
  await pointerWorks(page, page.locator('.course-catalog-open'));
  const dialog = page.locator('.course-catalog-dialog[open]');
  const catalogEvents = await nativeComposition(page, dialog.locator('.course-catalog-search'));
  assert.ok(await dialog.locator('.course-catalog-result').count());
  await screenshot(page, result, '-committed-search');
  await page.keyboard.press('Escape');
  Object.assign(result, {
    inputBoundary:
      'Chrome CDP composition/input dispatch; composing input/start are trusted, Chrome reports commit-end as untrusted. Not a hardware OS candidate-window test',
    directEvents,
    catalogEvents,
    compositionRetainsInputFocusAndDoesNotOpenOverview: true,
  });
}
async function stableLearningState(page) {
  return page.evaluate(() => {
    const keys = [
      'free_bbs_course_progress_v1',
      'free_bbs_learning_start_v1',
      'free_bbs_reading_bookmark_v1',
    ];
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => keys.some((prefix) => key.startsWith(prefix)))
        .map((key) => {
          let value = localStorage.getItem(key);
          if (key.startsWith('free_bbs_reading_bookmark_v1')) {
            // Opening a visible header control/Max may legitimately change pixel
            // offset on a narrow screen. Keep the same owned point/block/version;
            // this assertion is about clearing records, not fixed scroll geometry.
            const bookmarks = JSON.parse(value);
            value = JSON.stringify(
              Object.fromEntries(
                Object.entries(bookmarks).map(([point, mark]) => [
                  point,
                  { index: mark.index, fingerprint: mark.fingerprint, version: mark.version },
                ]),
              ),
            );
          }
          return [key, value];
        }),
    );
  });
}
async function guideDialog(page) {
  await pointerWorks(page, page.locator('#learning-guide-open'));
  await page.locator('.learning-guide-dialog[open]').waitFor();
}
async function authorScenario(page, result, preview, localBase, scene) {
  await page.goto(`${localBase}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.max-tour[open] .guide-primary').waitFor();
  await pointerWorks(page, page.locator('.max-tour[open] .max-tour-controls > .max-tour-later'));
  await page.locator('.max-tour[open]').waitFor({ state: 'hidden' });
  if (scene.width <= 390) {
    const direct = page.locator('#world-course-directory a[data-course-slug="signals"]');
    await direct.waitFor({ state: 'visible' });
    await direct.focus();
    await page.keyboard.press('Enter');
    Object.assign(result, {
      worldEntry: 'Visible direct-course link; no 3D-rotation knowledge required',
    });
  } else {
    const island = page.locator('.island-orbit-item[data-world-id="signals"]');
    await page.locator('#world-orbit').focus();
    for (
      let index = 0;
      index < 6 && (await island.getAttribute('data-orbit-slot')) !== '0';
      index += 1
    )
      await page.keyboard.press('ArrowRight');
    assert.equal(
      await island.getAttribute('data-orbit-slot'),
      '0',
      'A real keyboard turn brings the requested island to the front instead of clicking through the 3D core',
    );
    await page.waitForFunction(() => !document.querySelector('#world-orbit.is-orbit-moving'));
    await pointerWorks(page, page.locator('.island-orbit-item[data-world-id="signals"]'));
    await pointerWorks(page, page.locator('#world-enter-island'));
    if (scene.width <= 320) {
      // scrollIntoView knows the viewport, not the fixed mobile navigation strip.
      // A real wheel scroll brings the low course planet above that strip.
      await page
        .locator('a.island-course-planet[data-course-slug="signals"]')
        .scrollIntoViewIfNeeded();
      await page.mouse.move(scene.width / 2, scene.height / 2);
      await page.mouse.wheel(0, 180);
    }
    await pointerWorks(page, page.locator('a.island-course-planet[data-course-slug="signals"]'));
    Object.assign(result, {
      worldEntry: 'Existing 3D orbit with real keyboard rotation and pointer entry',
    });
  }
  await courseReady(page);
  Object.assign(result, { geometry: await assertFits(page) });
  const beforeCourseGuide = await stableLearningState(page);
  await guideDialog(page);
  assert.equal(
    await page.locator('.learning-guide-dialog').getAttribute('data-learning-guide-page'),
    'course',
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .locator('#learning-guide-open')
      .evaluate((element) => element === document.activeElement),
    true,
    'Esc restores the guide trigger',
  );
  await guideDialog(page);
  for (let index = 0; index < 3; index += 1)
    await page.locator('.learning-guide-dialog[open] footer button:last-child').click();
  await page.locator('.learning-guide-dialog[open] > .learning-primary').click();
  assert.equal(await page.locator('.learning-guide-dialog[open]').count(), 0);
  assert.equal(
    await page.locator('#course-knowledge-overview[open]').count(),
    0,
    'Optional course guide only locates a point entry; it does not enter learning',
  );
  assert.deepEqual(await stableLearningState(page), beforeCourseGuide);
  await searchPoint(page, 'SS-02-01', 'SS-02-01', true);
  await pointerWorks(
    page,
    page.locator('#course-knowledge-overview[open] .knowledge-overview-study'),
  );
  await readingReady(page, 'SS-02-01');
  await page.waitForFunction(
    () => window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 4,
  );
  // A first visit already exposes the inline editor; only a saved/deferred
  // preference has an Adjust control. No mandatory learning-start dialog exists.
  await page.waitForFunction(() =>
    Boolean(document.querySelector('.learning-start-editor, .learning-start-summary')),
  );
  if (!(await page.locator('.learning-start-editor').isVisible()))
    await pointerWorks(page, page.getByRole('button', { name: '调整学习方式', exact: true }));
  const learningStart = page.locator('.learning-start-editor');
  await learningStart.waitFor({ state: 'visible' });
  const goal = learningStart.locator('input[name="learning-start-goal"][value="practice"]');
  await pointerWorks(page, goal.locator('..'));
  assert.equal(await goal.isChecked(), true);
  await learningStart.locator('select[name="level"]').selectOption('familiar');
  await pointerWorks(
    page,
    learningStart.getByRole('button', { name: '按这个方式学习', exact: true }),
  );
  await learningStart.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
  await pointerWorks(page, page.locator('[data-knowledge-tag="important"]'));
  await page.waitForTimeout(100);
  const beforeGuide = await stableLearningState(page);
  const ownedBefore = {
    notes: preview.learning.store.rows.length,
    assessments: preview.learning.assessmentStore.rows.length,
    stars: preview.learning.starsStore.rows.length,
  };
  await guideDialog(page);
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await stableLearningState(page),
    beforeGuide,
    'Skipping the guide preserves existing preference, tags and bookmark',
  );
  await guideDialog(page);
  for (let index = 0; index < 4; index += 1)
    await page.locator('.learning-guide-dialog[open] footer button:last-child').click();
  await page.locator('.learning-guide-dialog[open] > .learning-primary').click();
  await page.locator('#knowledge-chat-input').waitFor({ state: 'visible' });
  assert.equal(preview.requests.length, 0, 'Guide and opening Max do not send learner messages');
  assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
    level: 'familiar',
    goal: 'practice',
  });
  assert.deepEqual(
    {
      notes: preview.learning.store.rows.length,
      assessments: preview.learning.assessmentStore.rows.length,
      stars: preview.learning.starsStore.rows.length,
    },
    ownedBefore,
    'Replaying guide cannot fabricate private work, answers or stars',
  );
  assert.deepEqual(await stableLearningState(page), beforeGuide);
  if (scene.width <= 390) {
    await pointerWorks(page, page.locator('#knowledge-chat-input'));
    const mobileMaxTabTrace = [];
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('Tab');
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const active = await page.evaluate(() => {
        const element = document.activeElement;
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          id: element.id,
          tag: element.tagName,
          insideMaxOrVisibleReturn: Boolean(
            element.closest('#knowledge-chat-panel') || element.id === 'knowledge-course-link',
          ),
          centerUncovered: Boolean(hit && (hit === element || element.contains(hit))),
          centerInViewport: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight,
        };
      });
      mobileMaxTabTrace.push(active);
      assert.equal(
        active.insideMaxOrVisibleReturn,
        true,
        `Max Tab must not reach hidden background controls: ${JSON.stringify(active)}`,
      );
      assert.equal(active.centerInViewport, true);
      assert.equal(active.centerUncovered, true);
    }
    Object.assign(result, { mobileMaxTabTrace });
  }
  await screenshot(page, result, '-max-guide');
  if (scene.width <= 920) await pointerWorks(page, page.locator('#knowledge-chat-close'));
  await pointerWorks(page, page.locator('#knowledge-course-link'));
  await courseReady(page);
  await focused(page, 'SS-02-01');
  await pointerWorks(page, page.locator('.course-structure-resume-actions a'));
  await readingReady(page, 'SS-02-01');
  assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
    level: 'familiar',
    goal: 'practice',
  });
  const beforeGlobalReplay = await stableLearningState(page);
  await page.goto(`${localBase}/guide`, { waitUntil: 'domcontentloaded' });
  await pointerWorks(page, page.locator('[data-guide-start]').first());
  await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').waitFor();
  await pointerWorks(page, page.locator('.max-tour[open] .max-tour-controls > .max-tour-later'));
  await page.locator('.max-tour[open]').waitFor({ state: 'hidden' });
  assert.deepEqual(
    await stableLearningState(page),
    beforeGlobalReplay,
    'Global Max tour can be replayed and paused without clearing learner records',
  );
  Object.assign(result, {
    optionalGuideAndResume: true,
    privateRecordsUnchanged: ownedBefore,
    simulatedMaxRequests: preview.requests.length,
  });
}
async function cycleScenario(page, result, map) {
  const nodes = map.nodes
    .filter((node) => node.id.startsWith('CAL-02-') && !/-0+$/.test(node.id))
    .slice(0, 3);
  assert.equal(nodes.length, 3);
  const edges = nodes.map((node, index) => ({
    id: `local-cycle-${index}`,
    source: node.id,
    target: nodes[(index + 1) % nodes.length].id,
    type: 'ordered',
  }));
  await page.route(`${base}/api/courses/math/map`, (route) =>
    route.fulfill({ json: { ...map, nodes, edges } }),
  );
  await page.goto(`${base}/course?course=math&as=student&theme=dark`, {
    waitUntil: 'domcontentloaded',
  });
  await courseReady(page);
  assert.equal(
    await page.locator('.course-learning-route').getAttribute('data-route-kind'),
    'ordered',
  );
  assert.equal(
    await page.locator('.course-route-branch').filter({ hasText: '同组联系，可任选' }).count(),
    3,
  );
  Object.assign(result, { connectors: await routeConnections(page, edges) });
  for (const node of nodes) {
    await openRouteNode(page, node.id, true);
    await closeOverview(page);
  }
  Object.assign(result, { cycleAllPointsFreelyOpen: nodes.map((node) => node.id) });
  await screenshot(page, result);
}
async function emptyScenario(page, result) {
  await page.goto(`${base}/course?course=digital&as=student&theme=dark`, {
    waitUntil: 'domcontentloaded',
  });
  await courseReady(page);
  Object.assign(result, { geometry: await assertFits(page) });
  assert.equal(await page.locator('.course-route-node').count(), 0);
  assert.equal(
    await page.locator('.course-route-primary').isVisible(),
    false,
    'An empty course cannot offer a fabricated first lesson',
  );
  assert.match(await page.locator('.course-route-empty').innerText(), /尚未发布/);
  await guideDialog(page);
  for (let index = 0; index < 2; index += 1)
    await page.locator('.learning-guide-dialog[open] footer button:last-child').click();
  assert.equal(
    await page.locator('.learning-guide-dialog[open] > .learning-primary').isDisabled(),
    true,
    'No nonexistent resume target is offered',
  );
  await page.locator('.learning-guide-dialog[open] footer button:last-child').click();
  assert.equal(
    await page.locator('.learning-guide-dialog[open] > .learning-primary').isDisabled(),
    true,
    'No nonexistent knowledge-point target is offered',
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
  await screenshot(page, result);
}
async function missingHelperScenario(page, result, scene) {
  await page.route(`**/${scene.asset}?*`, (route) => route.abort('failed'));
  await page.goto(`${base}/course?course=math&as=student&theme=dark`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() =>
    Boolean(document.getElementById('course-map-canvas')?.courseStructureController),
  );
  const id = 'CAL-02-002';
  await searchPoint(page, id, id, true);
  assert.equal((await state(page)).focusedNodeId, id);
  await pointerWorks(
    page,
    page.locator('#course-knowledge-overview[open] .knowledge-overview-study'),
  );
  await readingReady(page, id);
  await pointerWorks(page, page.locator('#knowledge-course-link'));
  await page.waitForFunction(() =>
    Boolean(document.getElementById('course-map-canvas')?.courseStructureController),
  );
  await focused(page, id);
  assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
  await pointerWorks(page, page.locator('.course-catalog-open'));
  await page.locator('.course-catalog-dialog[open] .course-catalog-search').fill('CAL-01-001');
  await pointerWorks(page, page.locator('[data-catalog-node-id="CAL-01-001"]'));
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await focused(page, 'CAL-01-001');
  await closeOverview(page);
  Object.assign(result, {
    localFailedAsset: scene.asset,
    directSearchReadReturnAndCatalogStillUsable: true,
  });
  await screenshot(page, result);
}
async function overviewFallbackScenario(page, result, scene) {
  if (scene.missingNative)
    await page.addInitScript(() => {
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: undefined,
      });
    });
  else await page.route('**/knowledge-overview.js?*', (route) => route.abort('failed'));
  await page.goto(`${base}/course?course=math&as=student`, { waitUntil: 'domcontentloaded' });
  await courseReady(page);
  const id = 'CAL-02-002';
  if (scene.entry === 'catalog') {
    await pointerWorks(page, page.locator('.course-catalog-open'));
    await page.locator('.course-catalog-dialog[open] .course-catalog-search').fill(id);
    await pointerWorks(page, page.locator(`[data-catalog-node-id="${id}"]`));
  } else if (scene.entry === 'route') {
    await page.locator('.course-route-chapter').selectOption('CAL-02');
    const entry = page.locator('.course-route-node').first();
    const routeId = await entry.getAttribute('data-course-route-node-id');
    Object.assign(result, { routeId });
    await pointerWorks(page, entry);
  } else {
    const search = page.locator('.course-structure-toolbar input[type="search"]');
    await search.fill(id);
    const entry = page.locator('.course-structure-search-results button').filter({ hasText: id });
    await entry.focus();
    await page.keyboard.press('Enter');
  }
  const expectedId = result.routeId || id;
  await readingReady(page, expectedId);
  assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
  const navigation = new URL(page.url()).searchParams.get('returnTo');
  assert.ok(navigation, 'Fallback carries a safe course return context');
  assert.equal(new URL(navigation, base).origin, base);
  assert.equal(new URL(navigation, base).pathname, '/course');
  await pointerWorks(page, page.locator('#knowledge-course-link'));
  await courseReady(page);
  await focused(page, expectedId);
  if (scene.entry === 'catalog') {
    await page.locator('.course-catalog-dialog[open]').waitFor();
    assert.equal(await page.locator('.course-catalog-search').inputValue(), id);
    await page.keyboard.press('Escape');
  } else if (scene.entry !== 'route')
    assert.equal(
      await page.locator('.course-structure-toolbar input[type="search"]').inputValue(),
      id,
    );
  assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
  await screenshot(page, result, '-returned');
  Object.assign(result, {
    fallback: scene.missingNative ? 'native-dialog-unavailable' : 'overview-asset-unavailable',
    safeDirectReadingAndReturnContext: true,
    expectedId,
  });
}
async function chapterFallbackScenario(page, result, localBase) {
  await page.route('**/learning-graph-layout.js?*', (route) => route.abort('failed'));
  await page.goto(`${localBase}/knowledge?course=signals&point=SS-01-00&view=reading`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
  );
  await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').waitFor();
  await pointerWorks(page, page.locator('.max-tour[open] .max-tour-controls > .max-tour-later'));
  await page.locator('.max-tour[open]').waitFor({ state: 'hidden' });
  const network = page.locator('#knowledge-chapter-network');
  await network.waitFor({ state: 'visible' });
  assert.match(await network.innerText(), /关系图暂不可用/);
  assert.equal(await network.locator('svg').count(), 0);
  const entry = network.locator('a[href*="point=SS-01-01"]');
  await entry.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      window.freeBbsKnowledge?.getLearningContext()?.node?.id === 'SS-01-01' &&
      document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
  );
  await page
    .locator('#knowledge-reading:not(.hidden) #knowledge-body')
    .waitFor({ state: 'visible' });
  assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
  await pointerWorks(page, page.locator('#knowledge-course-link'));
  await courseReady(page);
  await focused(page, 'SS-01-01');
  Object.assign(result, { missingChapterGraphKeepsRealDirectoryAndBody: true });
  await screenshot(page, result);
}
async function deliveryScenario(page, result) {
  await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').waitFor();
  await pointerWorks(page, page.locator('.max-tour[open] .max-tour-controls > .max-tour-later'));
  await page.locator('.max-tour[open]').waitFor({ state: 'hidden' });
  await page.locator('#world-course-directory a[data-course-slug="signals"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await screenshot(page, result, '-world-direct-course-entry');
  await pointerWorks(page, page.locator('#world-course-directory a[data-course-slug="signals"]'));
  await courseReady(page);
  const beforeGuide = await state(page);
  await guideDialog(page);
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await state(page),
    beforeGuide,
    'Optional guide does not change course selection',
  );
  await pointerWorks(page, page.locator('.course-catalog-open'));
  const search = page.locator('.course-catalog-dialog[open] .course-catalog-search');
  await search.fill('SS-04-09');
  const entry = page.locator('[data-catalog-node-id="SS-04-09"]');
  await entry.focus();
  await page.keyboard.press('Enter');
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.knowledge-overview-drawer-body [aria-busy]')
        ?.getAttribute('aria-busy') === 'false',
  );
  await screenshot(page, result, '-real-point-overview');
  await readAndReturn(page, 'SS-04-09', { catalogOpen: true });
  assert.equal(
    await page.locator('.course-catalog-dialog[open] .course-catalog-search').inputValue(),
    'SS-04-09',
  );
  await screenshot(page, result, '-returned-directory');
  await page.keyboard.press('Escape');
  assert.equal(
    result.writes.filter((request) =>
      /\/ai\/knowledge\/chat|\/assessments?\/|\/notes\b|\/contributions\b|\/paths\b/.test(request),
    ).length,
    0,
    'Delivery smoke does not send Max messages, answers, notes, contributions or saved plans',
  );
  Object.assign(result, {
    realPublicPoint: 'SS-04-09',
    worldDirectEntry: true,
    optionalGuideEsc: true,
    catalogReadAndReturn: true,
  });
}
async function main() {
  const maps = {};
  for (const slug of ['math', 'signals', 'circuits']) {
    const response = await fetch(`${base}/api/courses/${slug}/map`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    maps[slug] = await response.json();
  }
  const browser = await chromium.launch({
    headless: true,
    ...(options.get('--chrome') || process.env.CHROME_BIN
      ? { executablePath: options.get('--chrome') || process.env.CHROME_BIN }
      : {}),
    args: ['--disable-background-networking'],
  });
  const scenes = [
    {
      key: 'new-learner-light-1440',
      kind: 'public',
      slug: 'math',
      chapter: 'CAL-02',
      width: 1440,
      height: 1000,
      theme: 'light',
    },
    {
      key: 'returning-dark-1440',
      kind: 'public',
      slug: 'signals',
      chapter: 'SS-02',
      width: 1440,
      height: 1000,
      theme: 'dark',
    },
    {
      key: 'foundation-dark-390',
      kind: 'public',
      slug: 'math',
      chapter: 'CAL-02',
      width: 390,
      height: 844,
      theme: 'dark',
    },
    {
      key: 'expert-dark-320',
      kind: 'public',
      slug: 'signals',
      chapter: 'SS-11',
      width: 320,
      height: 640,
      theme: 'dark',
    },
    {
      key: 'no-ordered-light-1440',
      kind: 'public',
      slug: 'circuits',
      noOrder: true,
      width: 1440,
      height: 1000,
      theme: 'light',
    },
    {
      key: 'no-ordered-dark-320',
      kind: 'public',
      slug: 'circuits',
      noOrder: true,
      width: 320,
      height: 640,
      theme: 'dark',
    },
    { key: 'cycle-local-dark-390', kind: 'cycle', width: 390, height: 844, theme: 'dark' },
    { key: 'empty-course-dark-320', kind: 'empty', width: 320, height: 640, theme: 'dark' },
    {
      key: 'world-and-guides-light-1440',
      kind: 'author',
      width: 1440,
      height: 1000,
      theme: 'light',
    },
    { key: 'world-and-guides-dark-390', kind: 'author', width: 390, height: 844, theme: 'dark' },
    { key: 'world-and-guides-dark-320', kind: 'author', width: 320, height: 640, theme: 'dark' },
    {
      key: 'resilience-graph-helper-dark-320',
      kind: 'missing-helper',
      asset: 'learning-graph-layout.js',
      width: 320,
      height: 640,
      theme: 'dark',
    },
    {
      key: 'resilience-route-helper-dark-390',
      kind: 'missing-helper',
      asset: 'learning-route.js',
      width: 390,
      height: 844,
      theme: 'dark',
    },
    {
      key: 'resilience-route-view-dark-1440',
      kind: 'missing-helper',
      asset: 'course-learning-route.js',
      width: 1440,
      height: 1000,
      theme: 'dark',
    },
    {
      key: 'chapter-graph-fallback-dark-390',
      kind: 'chapter-fallback',
      width: 390,
      height: 844,
      theme: 'dark',
    },
    {
      key: 'delivery-public-light-1440',
      kind: 'delivery',
      width: 1440,
      height: 1000,
      theme: 'light',
    },
    { key: 'delivery-public-dark-390', kind: 'delivery', width: 390, height: 844, theme: 'dark' },
    { key: 'catalog-text200-dark-320', kind: 'access', width: 320, height: 500, theme: 'dark' },
    { key: 'catalog-text200-light-390', kind: 'access', width: 390, height: 844, theme: 'light' },
    { key: 'catalog-text200-dark-920', kind: 'access', width: 920, height: 700, theme: 'dark' },
    { key: 'native-ime-light-1440', kind: 'typing', width: 1440, height: 1000, theme: 'light' },
    { key: 'native-ime-dark-320', kind: 'typing', width: 320, height: 640, theme: 'dark' },
    {
      key: 'overview-asset-direct-dark-320',
      kind: 'overview-fallback',
      entry: 'direct',
      width: 320,
      height: 640,
      theme: 'dark',
    },
    {
      key: 'overview-asset-catalog-light-1440',
      kind: 'overview-fallback',
      entry: 'catalog',
      width: 1440,
      height: 1000,
      theme: 'light',
    },
    {
      key: 'overview-native-route-dark-390',
      kind: 'overview-fallback',
      entry: 'route',
      missingNative: true,
      width: 390,
      height: 844,
      theme: 'dark',
    },
  ].filter(
    (scene) =>
      (!options.has('--case') || scene.key.includes(options.get('--case'))) &&
      (scene.kind !== 'delivery' || options.get('--scope') === 'delivery') &&
      (options.get('--scope') !== 'delivery' || scene.kind === 'delivery') &&
      (scene.kind !== 'access' || ['access', 'full'].includes(options.get('--scope'))) &&
      (options.get('--scope') !== 'access' || scene.kind === 'access') &&
      (scene.kind !== 'typing' || ['typing', 'full'].includes(options.get('--scope'))) &&
      (options.get('--scope') !== 'typing' || scene.kind === 'typing') &&
      (scene.kind !== 'overview-fallback' ||
        ['resilience', 'full'].includes(options.get('--scope'))) &&
      (options.get('--scope') !== 'resilience' || scene.kind === 'overview-fallback') &&
      (options.get('--scope') !== 'core' || scene.kind !== 'author') &&
      (options.get('--scope') !== 'world' || scene.kind === 'author') &&
      (options.get('--smoke') !== 'true' ||
        ['new-learner-light-1440', 'foundation-dark-390'].includes(scene.key)),
  );
  try {
    assert.ok(
      scenes.length,
      'No scene matched the requested scope/case; this is not a passing QA run',
    );
    for (const scene of scenes) {
      let preview;
      let localBase = base;
      if (['author', 'chapter-fallback'].includes(scene.kind)) {
        preview = await startCompleteLearningPreview();
        localBase = `http://127.0.0.1:${preview.server.address().port}`;
      }
      const result = {
        ...scene,
        base: localBase,
        status: 'pending',
        sourceBefore: hashes(),
        pageErrors: [],
        externalRequestsBlocked: [],
        writes: [],
        productionRequests: 0,
      };
      report.cases.push(result);
      const context = await browser.newContext({
        viewport: { width: scene.width, height: scene.height },
        reducedMotion: 'reduce',
      });
      await context.addInitScript(
        (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
        scene.theme,
      );
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => result.pageErrors.push(error.message));
      page.on('request', (request) => {
        if (
          request.url().startsWith(`${localBase}/api/`) &&
          !['GET', 'HEAD'].includes(request.method())
        )
          result.writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === localBase || ['data:', 'blob:'].includes(url.protocol))
          return route.continue();
        result.externalRequestsBlocked.push({
          origin: url.origin,
          path: url.pathname,
          method: request.method(),
        });
        return route.abort('blockedbyclient');
      });
      try {
        if (scene.kind === 'author') await authorScenario(page, result, preview, localBase, scene);
        else if (scene.kind === 'cycle') await cycleScenario(page, result, maps.math);
        else if (scene.kind === 'empty') await emptyScenario(page, result);
        else if (scene.kind === 'missing-helper') await missingHelperScenario(page, result, scene);
        else if (scene.kind === 'chapter-fallback')
          await chapterFallbackScenario(page, result, localBase);
        else if (scene.kind === 'delivery') await deliveryScenario(page, result);
        else if (scene.kind === 'access')
          await accessibleCatalogScenario(page, result, scene, maps.math);
        else if (scene.kind === 'typing') await typingScenario(page, result);
        else if (scene.kind === 'overview-fallback')
          await overviewFallbackScenario(page, result, scene);
        else await publicScenario(page, result, scene, maps[scene.slug]);
        assert.deepEqual(result.pageErrors, [], 'No uncaught browser error');
        assert.deepEqual(
          result.externalRequestsBlocked,
          [],
          'This fixture flow makes no off-origin request',
        );
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.error = error.stack;
        result.url = page.url();
        report.errors.push({ scene: scene.key, message: error.message });
        await screenshot(page, result, '-failure').catch(() => {});
      } finally {
        result.sourceAfter = hashes();
        result.sourceChangedDuringRun =
          JSON.stringify(result.sourceBefore) !== JSON.stringify(result.sourceAfter);
        await context.close();
        if (preview)
          await new Promise((resolve) => {
            preview.server.close(resolve);
            preview.server.closeAllConnections();
          });
        save();
        console.log(
          `${scene.key}: ${result.status}${result.error ? ` (${result.error.split('\n')[0]})` : ''}`,
        );
      }
    }
  } finally {
    await browser.close();
    report.sourceAfter = hashes();
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
