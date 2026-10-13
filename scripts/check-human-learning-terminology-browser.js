// Read-only terminology diagnostics, using the pre-existing local relations fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const expectedFixed = process.argv.includes('--expected-fixed');
  const width = Number(process.env.LEARNING_QA_WIDTH || 1440);
  assert.ok([390, 1440].includes(width));
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'human-terminology-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Fresh isolated Chrome, actual production controls, pre-existing local relations fixture. No formal course content or real students. All API non-GET/AI and external services blocked; no new service or graph fixture.',
    mode: expectedFixed ? 'expected-fixed' : 'diagnostic',
    width,
    checks: [],
    findings: [],
    requests: [],
    blocked: [],
    pageErrors: [],
    snapshots: [],
  };
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 10000,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
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
          return request.respond({ status: 403, body: 'Read-only terminology QA' });
        }
      }
      return request.continue();
    });
    const snapshot = async (name, data) => {
      if (name === 'fresh-directory' || name === 'real-current-directory') {
        await page.$eval('.course-map-directory-current', (node) =>
          node.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
      }
      const filename = path.join(output, `${name}.png`);
      await page.screenshot({ path: filename });
      report.snapshots.push({ name, ...data, screenshot: filename });
    };
    const directoryRecord = () =>
      page.evaluate(() => ({
        storedCurrent: window.FreeBbsLearningProgress.read(
          localStorage,
          'free_bbs_current_learning_node_v1',
          window.freeBbsApp.userState,
        ),
        storedProgress: window.FreeBbsLearningProgress.read(
          localStorage,
          'free_bbs_course_progress_v1',
          window.freeBbsApp.userState,
        ),
        primaryText: document.querySelector('.course-map-directory-current').textContent.trim(),
        primaryId: document.querySelector('.course-map-directory-current [data-reader-node-id]')
          .dataset.readerNodeId,
      }));
    await page.goto(`${base.origin}/course?course=signals&as=student&layout=directory`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-course-reader-chapter]');
    const fresh = await directoryRecord();
    await snapshot('fresh-directory', fresh);
    assert.ok(
      !fresh.storedCurrent?.signals && !fresh.storedProgress?.signals,
      'Fresh isolation must actually have no course history',
    );
    if (/继续学习/.test(fresh.primaryText) && /上次学习位置/.test(fresh.primaryText))
      report.findings.push(
        'Fresh student with no current/progress record is labelled Continue learning / Located your last learning position',
      );
    if (expectedFixed) {
      assert.match(fresh.primaryText, /从这里开始/);
      assert.doesNotMatch(fresh.primaryText, /继续学习|上次学习位置/);
      assert.ok(fresh.primaryId);
      report.checks.push(
        'Fresh storage has no history; actual first-point entry says start here, not resume',
      );
    }
    const payload = await page.evaluate(() =>
      window.freeBbsApp.callApi('/courses/signals/map', { method: 'GET' }),
    );
    report.existingFixtureMarkers = /本地演示|本地夹具|验收夹具/.test(JSON.stringify(payload));
    const chapters = payload.nodes.filter((node) => /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node.id));
    assert.ok(
      chapters.length >= 2,
      'Use an actual existing second chapter overview, not a fabricated node',
    );
    const chapter = chapters[1];
    const owner = chapter.id.split('-').slice(0, 2).join('-');
    const point = payload.nodes.find(
      (node) => node.id.startsWith(`${owner}-`) && !/^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node.id),
    );
    assert.ok(point);
    // A real production GET reading navigation creates the private local resume record.
    // No localStorage seed, fabricated API response, or assessment/analytics POST.
    await page.goto(
      `${base.origin}/knowledge?course=signals&point=${encodeURIComponent(point.id)}&view=reading`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      (id) => window.freeBbsKnowledge?.getLearningContext().node?.id === id,
      {},
      point.id,
    );
    await page.goto(`${base.origin}/course?course=signals&layout=directory`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-course-reader-chapter]');
    const resumed = await directoryRecord();
    await snapshot('real-current-directory', resumed);
    assert.equal(resumed.storedCurrent.signals, point.id);
    assert.equal(resumed.primaryId, point.id);
    assert.match(resumed.primaryText, /继续学习/);
    assert.match(resumed.primaryText, /上次学习位置/);
    report.checks.push(
      'Actual reading navigation creates current record and directory correctly resumes that point',
    );
    await page.select('[data-course-reader-chapter]', owner);
    await page.click(`[data-reader-node-id="${chapter.id}"]`);
    await page.waitForSelector('#course-knowledge-overview[open]');
    const chapterDrawer = await page.evaluate(() => ({
      heading: document.querySelector('#course-knowledge-overview-title').textContent,
      relationLabel: document.querySelector('#course-knowledge-overview footer button').textContent,
      studyHref: document.querySelector('#course-knowledge-overview .knowledge-overview-study')
        .href,
      facts: document.querySelector('#course-knowledge-overview').textContent.trim(),
    }));
    await snapshot('chapter-overview', { chapterId: chapter.id, ...chapterDrawer });
    assert.equal(chapterDrawer.relationLabel, '查看章节知识网络');
    await page.click('#course-knowledge-overview .knowledge-overview-study');
    await page.waitForFunction(
      (id) => window.freeBbsKnowledge?.getLearningContext().node?.id === id,
      {},
      chapter.id,
    );
    const chapterReading = await page.evaluate(() => ({
      title: document.querySelector('#knowledge-title').textContent,
      courseHref: document.querySelector('#knowledge-course-link').href,
      networkLabel: document
        .querySelector('#knowledge-chapter-network a')
        ?.getAttribute('aria-label'),
      networkHref: document.querySelector('#knowledge-chapter-network a')?.href.baseVal,
      readingVisible:
        document.querySelector('#knowledge-reading').getBoundingClientRect().height > 0,
    }));
    await snapshot('chapter-reading', chapterReading);
    assert.equal(new URL(chapterReading.courseHref).searchParams.get('focus'), chapter.id);
    await page.click('#knowledge-course-link');
    await page.waitForSelector('#course-map-canvas .course-structure');
    const returned = await page.evaluate(() => ({
      url: window.location.href,
      state: document.getElementById('course-map-canvas').courseStructureController.getState(),
      details: document.querySelector('.course-structure-details').textContent.trim(),
      title: document.querySelector('.course-structure-details h2').textContent,
      graphOpen: document.querySelector('.course-structure-graph-area').open,
      graphKnowledgeNodes: document.querySelectorAll('.course-structure-node.is-knowledge').length,
    }));
    await snapshot('chapter-course-return', returned);
    if (!returned.state.focusedNodeId && returned.state.selectedChapterId !== owner)
      report.findings.push(
        'Returning from a zero-level chapter overview safely avoids point focus, but drops its owner selection and returns to global course overview',
      );
    if (expectedFixed) {
      assert.equal(returned.state.selectedChapterId, owner);
      assert.equal(returned.state.focusedNodeId, '');
      assert.equal(returned.title, chapter.title);
      assert.equal(returned.graphOpen, false);
      assert.equal(returned.graphKnowledgeNodes, 0);
      report.checks.push(
        'Zero-level chapter return selects its actual chapter, never focuses a point or expands whole-chapter relations',
      );
    }
    await page.goto(
      `${base.origin}/knowledge?course=signals&point=${encodeURIComponent(point.id)}&view=reading`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      (id) => window.freeBbsKnowledge?.getLearningContext().node?.id === id,
      {},
      point.id,
    );
    const pointHref = await page.$eval('#knowledge-course-link', (node) => node.href);
    assert.equal(new URL(pointHref).searchParams.get('focus'), point.id);
    await page.click('#knowledge-course-link');
    await page.waitForFunction(
      (id) =>
        document.getElementById('course-map-canvas')?.courseStructureController?.getState()
          .focusedNodeId === id,
      {},
      point.id,
    );
    const pointReturn = await page.evaluate(() => ({
      url: window.location.href,
      state: document.getElementById('course-map-canvas').courseStructureController.getState(),
      graphOpen: document.querySelector('.course-structure-graph-area').open,
    }));
    await snapshot('normal-point-return', pointReturn);
    assert.equal(pointReturn.state.focusedNodeId, point.id);
    assert.equal(pointReturn.state.selectedChapterId, owner);
    assert.equal(pointReturn.graphOpen, false);
    report.checks.push('Normal-point course return still focuses exact current point and owner');
    await page.goto(`${base.origin}/course?course=signals&focus=SS-99-00`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#course-map-canvas .course-structure');
    const unknown = await page.evaluate(() => ({
      state: document.getElementById('course-map-canvas').courseStructureController.getState(),
      title: document.querySelector('.course-structure-details h2').textContent,
      graphOpen: document.querySelector('.course-structure-graph-area').open,
    }));
    await snapshot('unknown-focus', unknown);
    assert.equal(unknown.state.focusedNodeId, '');
    assert.equal(unknown.state.selectedChapterId, '');
    assert.equal(unknown.title, payload.course.name);
    assert.equal(unknown.graphOpen, false);
    report.checks.push('Unknown chapter focus safely falls back to global course overview');
    if (expectedFixed) assert.deepEqual(report.findings, []);
    report.executed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (report.blocked.length || report.pageErrors.length) process.exitCode = 1;
    fs.writeFileSync(
      path.join(output, 'terminology-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        report: path.join(output, 'terminology-report.json'),
        mode: report.mode,
        width,
        executed: report.executed || false,
        checks: report.checks.length,
        findings: report.findings,
        requests: report.requests.length,
        blocked: report.blocked,
        pageErrors: report.pageErrors,
        error: report.error || null,
      }),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
