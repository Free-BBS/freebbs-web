// A few actual local course paths only. No new graph fixtures, API writes, or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-relations-return-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Existing memory preview, its actually loaded map and production Chrome controls. Detect and report pre-existing demo/fixture text: this is not evidence for formal published course relations. No additional graph or uploaded course fixture. External, all non-GET API and AI blocked. Existing 45-point chapter / 55/1000 pagination evidence is separate synthetic data, not this dataset.',
    courseReturnContract:
      'The course link restores the current loaded point and its owner, not the originating directory layout, search query/page, or full navigation history.',
    scenes: [],
    requests: [],
    blocked: [],
    pageErrors: [],
    screenshots: [],
  };
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 10000,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(12000);
      const scene = { width, checks: [], issues: [], snapshots: [] };
      report.scenes.push(scene);
      await page.setViewport({ width, height: width === 390 ? 844 : 960 });
      page.on('pageerror', (error) => report.pageErrors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
          return request.respond({ status: 403, body: 'External services disabled' });
        if (url.pathname.startsWith('/api/')) {
          const record = { method: request.method(), path: url.pathname };
          report.requests.push(record);
          if (request.method() !== 'GET' || /\/ai\//.test(url.pathname)) {
            report.blocked.push(record);
            return request.respond({ status: 403, body: 'Read-only path QA' });
          }
        }
        return request.continue();
      });
      const settle = () =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
              setTimeout(resolve, 180);
            }),
        );
      const show = async (selector) => {
        await page.$eval(selector, (node) =>
          node.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await settle();
      };
      const pointer = async (selector) => {
        await show(selector);
        await page.waitForFunction(
          (value) => {
            const node = document.querySelector(value);
            const rect = node.getBoundingClientRect();
            const x = (rect.left + rect.right) / 2;
            const y = (rect.top + rect.bottom) / 2;
            const hit = document.elementFromPoint(x, y);
            return (
              x >= 0 &&
              x < window.innerWidth &&
              y >= 0 &&
              y < window.innerHeight &&
              (hit === node || node.contains(hit))
            );
          },
          { timeout: 2500 },
          selector,
        );
        await page.click(selector);
        await settle();
      };
      const snapshot = async (name) => {
        const state = await page.evaluate(() => {
          const active = document.activeElement;
          const controller =
            document.getElementById('course-map-canvas')?.courseStructureController;
          return {
            url: window.location.href,
            focus: {
              tag: active?.tagName,
              id: active?.id,
              className: active?.className,
              text: active?.textContent?.trim().slice(0, 100),
              connected: active?.isConnected,
            },
            state: controller?.getState(),
            picker: controller?.getPickerState(),
            details: document.querySelector('.course-structure-details')?.textContent.trim(),
            groups: [...document.querySelectorAll('[data-relation-group]')].map((node) => ({
              key: node.dataset.relationGroup,
              heading: node.querySelector('h4').textContent,
              ids: [...node.querySelectorAll('[data-course-related-id]')].map(
                (item) => item.dataset.courseRelatedId,
              ),
              text: node.textContent.trim(),
            })),
            graphOpen: document.querySelector('.course-structure-graph-area')?.open,
            graphNodeIds: [...document.querySelectorAll('.course-structure-node.is-knowledge')].map(
              (node) => node.getAttribute('aria-label').split(' ')[0],
            ),
            overviewOpen: Boolean(document.querySelector('#course-knowledge-overview[open]')),
          };
        });
        const filename = path.join(output, `${width}-${name}.png`);
        await page.screenshot({ path: filename });
        report.screenshots.push(filename);
        scene.snapshots.push({ name, ...state, screenshot: filename });
        return state;
      };
      try {
        await page.goto(`${base.origin}/course?course=signals&as=student&layout=directory`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForSelector('[data-course-reader-chapter]');
        const payload = await page.evaluate(() =>
          window.freeBbsApp.callApi('/courses/signals/map', { method: 'GET' }),
        );
        const cross = payload.edges.find(
          (edge) =>
            edge.source.split('-').slice(0, 2).join('-') !==
              edge.target.split('-').slice(0, 2).join('-') &&
            !edge.source.endsWith('-00') &&
            !edge.target.endsWith('-00'),
        );
        assert.ok(
          cross,
          'Real current preview has a cross-chapter point relationship; do not invent one',
        );
        scene.actual = {
          nodeCount: payload.nodes.length,
          edgeCount: payload.edges.length,
          cross,
          existingFixtureMarkers: [...payload.nodes, ...payload.edges].some((item) =>
            /本地演示|本地夹具|验收夹具/.test(JSON.stringify(item)),
          ),
        };
        const owner = cross.source.split('-').slice(0, 2).join('-');
        await page.select('[data-course-reader-chapter]', owner);
        const ownerTitle = await page.$eval(
          '#course-map-directory-title',
          (node) => node.textContent,
        );
        scene.actual.ownerTitle = ownerTitle;
        const directoryEntry = `[data-reader-node-id="${cross.source}"]`;
        await pointer(directoryEntry);
        await page.waitForFunction(
          () =>
            document.querySelector('#course-knowledge-overview[open] .knowledge-overview-people')
              ?.textContent.length,
        );
        await snapshot('directory-point-overview');
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.querySelector('#course-knowledge-overview[open]'),
        );
        const closeState = await snapshot('overview-escape-return');
        const closeFocus = await page.evaluate(
          (value) => document.activeElement.matches(value),
          directoryEntry,
        );
        if (!closeFocus)
          scene.issues.push(
            'Closing overview did not return focus to the connected directory trigger',
          );
        assert.ok(closeState.focus.connected);
        await pointer(directoryEntry);
        await page.waitForSelector('#course-knowledge-overview[open]');
        await pointer('#course-knowledge-overview footer button');
        await page.waitForFunction(
          (id) =>
            document.getElementById('course-map-canvas').courseStructureController?.getState()
              .focusedNodeId === id,
          {},
          cross.source,
        );
        const oneHop = await snapshot('source-direct-relations');
        assert.equal(oneHop.graphOpen, false);
        assert.match(oneHop.details, /不表示必须先修/);
        assert.ok(oneHop.details.includes(ownerTitle));
        const neighbors = [
          ...new Set(
            payload.edges
              .filter((edge) => edge.source === cross.source || edge.target === cross.source)
              .flatMap((edge) => [edge.source, edge.target]),
          ),
        ]
          .filter((id) => id !== cross.source && !id.endsWith('-00'))
          .sort();
        assert.deepEqual(oneHop.groups.flatMap((group) => group.ids).sort(), neighbors);
        scene.checks.push(
          'Actual chapter name, closed auxiliary graph, direct point relations only, explicit not-required-prerequisite wording',
        );
        await pointer(`[data-course-related-id="${cross.target}"]`);
        const target = await snapshot('cross-chapter-target');
        const targetOwner = cross.target.split('-').slice(0, 2).join('-');
        assert.equal(target.state.focusedNodeId, cross.target);
        assert.equal(target.state.selectedChapterId, targetOwner);
        // A blank picker intentionally means all chapters, not an incorrect owner.
        assert.ok(['', targetOwner].includes(target.picker.chapterId));
        const targetTitle = await page.$eval(
          `.course-structure-chapters [data-course-chapter-id="${targetOwner}"] strong`,
          (node) => node.textContent,
        );
        scene.actual.targetTitle = targetTitle;
        assert.ok(target.details.includes(targetTitle));
        const targetNeighbors = [
          ...new Set(
            payload.edges
              .filter((edge) => edge.source === cross.target || edge.target === cross.target)
              .flatMap((edge) => [edge.source, edge.target]),
          ),
        ]
          .filter((id) => id !== cross.target && !id.endsWith('-00'))
          .sort();
        assert.deepEqual(target.groups.flatMap((group) => group.ids).sort(), targetNeighbors);
        assert.equal(target.graphOpen, false);
        scene.checks.push(
          'Cross-chapter direct entry recomputes current point and actual owner; chapter filter may retain all-chapters; only exact direct neighbors, no whole chapter expansion',
        );
        const targetOverview = '.course-structure-primary';
        await pointer(targetOverview);
        await page.waitForSelector('#course-knowledge-overview[open]');
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.querySelector('#course-knowledge-overview[open]'),
        );
        // Native dialog closure queues a close event which restores the trigger.
        // Let that event finish before issuing the next human key.
        await settle();
        assert.equal(
          await page.evaluate(() => document.activeElement.matches('.course-structure-primary')),
          true,
        );
        scene.checks.push('Point overview Escape returns to its connected relation-page button');
        // Back precedes the restored overview trigger in actual document order.
        // Use the human one-key route, not a full-page forward-tab cycle or page.focus().
        await page.keyboard.down('Shift');
        try {
          await page.keyboard.press('Tab');
        } finally {
          await page.keyboard.up('Shift');
        }
        await settle();
        assert.ok(
          await page.evaluate(() => document.activeElement.matches('.course-structure-back')),
          'Back is reachable from the restored overview trigger with actual Shift+Tab',
        );
        await page.keyboard.press('Enter');
        await settle();
        const returned = await snapshot('native-back-return');
        assert.equal(returned.state.focusedNodeId, cross.source);
        assert.deepEqual(returned.picker, oneHop.picker);
        assert.equal(
          returned.focus.tag,
          'BUTTON',
          'Native Back must keep a connected control focused',
        );
        assert.equal(returned.focus.className, 'course-structure-back');
        await page.keyboard.press('Tab');
        await settle();
        const nextTab = await snapshot('after-back-next-tab');
        assert.equal(nextTab.focus.className, 'course-structure-primary');
        scene.checks.push('Local Back restores the previous exact point and picker snapshot');
        scene.checks.push(
          'Native Shift+Tab/Enter Back keeps the newly rendered return button focused',
        );
        await pointer('.course-structure-primary');
        await page.waitForSelector('#course-knowledge-overview[open]');
        const studyHref = await page.$eval(
          '#course-knowledge-overview .knowledge-overview-study',
          (node) => node.href,
        );
        scene.studyHref = studyHref;
        assert.ok(new URL(studyHref).searchParams.get('point') === cross.source);
        await pointer('#course-knowledge-overview .knowledge-overview-study');
        await page.waitForSelector('#knowledge-title');
        await page.waitForFunction(() => window.freeBbsKnowledge?.getLearningContext().node);
        assert.equal(
          await page.evaluate(() => window.freeBbsKnowledge.getLearningContext().node.id),
          cross.source,
        );
        scene.checks.push(
          'Enter learning reaches the exact overview point, not a chapter placeholder',
        );
        scene.courseReturnHref = await page.$eval('#knowledge-course-link', (node) => node.href);
        assert.equal(new URL(scene.courseReturnHref).searchParams.get('focus'), cross.source);
        await pointer('#knowledge-course-link');
        await page.waitForSelector('#course-map-canvas .course-structure');
        await page.waitForFunction(
          (id) =>
            document.getElementById('course-map-canvas').courseStructureController?.getState()
              .focusedNodeId === id,
          {},
          cross.source,
        );
        const courseReturned = await snapshot('learning-course-link-return');
        assert.equal(courseReturned.state.focusedNodeId, cross.source);
        assert.equal(courseReturned.state.selectedChapterId, owner);
        assert.equal(courseReturned.graphOpen, false);
        scene.checks.push(
          'Knowledge course link restores the current point and owner; does not claim to restore full prior directory/search context',
        );
      } catch (error) {
        scene.error = error.stack || error.message;
        await snapshot('error').catch(() => {});
      } finally {
        await page.close();
      }
      console.log(
        JSON.stringify({
          width,
          checks: scene.checks.length,
          issues: scene.issues,
          error: scene.error || null,
        }),
      );
    }
  } finally {
    await browser.close();
    report.executed =
      report.scenes.length === 2 &&
      report.scenes.every((scene) => !scene.error) &&
      !report.pageErrors.length &&
      !report.blocked.length;
    report.issueCount = report.scenes.reduce((sum, scene) => sum + scene.issues.length, 0);
    report.passed = report.executed && report.issueCount === 0;
    const filename = path.join(output, 'relations-return-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        filename,
        executed: report.executed,
        issueCount: report.issueCount,
        passed: report.passed,
        blocked: report.blocked,
        pageErrors: report.pageErrors,
      }),
    );
    if (!report.passed) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
