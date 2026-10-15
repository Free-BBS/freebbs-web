// Real Chrome with real isolated memory routers; authored examples are not production materials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { parse } = require('../docs/course-authoring/tools/整理知识点.cjs');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

function fixtures() {
  const authored = parse(
    fs.readFileSync(
      path.join(__dirname, '../docs/course-authoring/examples/知识点/SS-02-01.md'),
      'utf8',
    ),
    { allowDemo: true },
  );
  const plain = (id, title, markdown) => ({
    id,
    title,
    summary: '',
    chapterTitle: '材料边界验收（非课程内容）',
    hasDocument: Boolean(markdown),
    sections: {
      basicInfoMarkdown: '',
      applicationsMarkdown: '',
      knowledgeMarkdown: markdown,
    },
    markdown,
    position: { x: 100, y: 100 },
    documentVersion: getAssessmentDocumentVersion(markdown),
  });
  const mapNodes = [
    {
      ...authored,
      chapterTitle: authored.metadata['章节/单元'],
      markdown: authored.sections.knowledgeMarkdown,
      documentVersion: getAssessmentDocumentVersion(authored.sections.knowledgeMarkdown),
      hasDocument: true,
      position: { x: 0, y: 0 },
    },
    plain('SS-03-01', '尚未提供教材的知识点', ''),
    plain(
      'SS-03-02',
      '旧格式练习（本地验收）',
      '### 一个已有定义\n\n这段正文不需要先设置起点即可查阅。\n\n### 题目 SS-03-02-Q1\n\n请用自己的话说明当前条件。\n\n<details><summary>参考解答</summary>这是明确标注的本地验收参考，不是正式课程材料。</details>',
    ),
  ];
  return {
    mapNodes,
    mapEdges: [],
    contextRows: mapNodes.map((item) => ({
      slug: 'signals',
      course_id: 1,
      course_name: '信号与系统',
      node_id: item.id,
      title: item.title,
      basic_info_markdown: item.sections.basicInfoMarkdown,
      applications_markdown: item.sections.applicationsMarkdown,
      knowledge_markdown: item.markdown,
      document_markdown: item.markdown,
      has_relations: false,
      summary: item.summary,
      is_active: 1,
    })),
  };
}

async function main() {
  const preview = createLearningPreview(fixtures());
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'human-content-boundaries-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Real Chrome, actual public modules and memory routers. Missing/legacy materials and upload response are explicit local fixtures; no real AI, production course or MySQL.',
    scenes: [],
    errors: [],
  };
  let browser;
  let page;
  let scene = 'initial';
  let resourcesUnavailable = false;
  const check = (details = {}) => report.scenes.push({ name: scene, ...details });
  const visit = async (point, extra = {}) => {
    await page.goto(
      `${base}/knowledge?${new URLSearchParams({ course: 'signals', point, as: 'student', ...extra })}`,
      { waitUntil: 'networkidle0' },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.freeBbsKnowledge?.getLearningContext().node);
    if (extra.as !== 'guest')
      await page.waitForFunction(() => window.FreeBbsLearningAssessment?.getSnapshot().loaded);
  };
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  const originPosition = () =>
    page.evaluate(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      const rect =
        host === window ? { top: 0, bottom: window.innerHeight } : host.getBoundingClientRect();
      const paragraph = document.querySelector('#knowledge-body [data-origin-reading-probe]');
      const origin = document.getElementById('knowledge-history');
      const toolbar = document.getElementById('learning-annotation-toolbar');
      const inset = Math.max(
        origin.getBoundingClientRect().bottom,
        toolbar.getBoundingClientRect().bottom,
      );
      const block = paragraph.getBoundingClientRect();
      return {
        text: paragraph.textContent,
        top: block.top,
        bottom: block.bottom,
        boundary: Math.max(rect.top, inset),
        hostBottom: rect.bottom,
        scroll: host === window ? window.scrollY : host.scrollTop,
        expanded: document.getElementById('knowledge-history-toggle').getAttribute('aria-expanded'),
      };
    });
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.setViewport({ width: 1440, height: 960 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({ status: 403, body: 'External service disabled' });
      if (url.pathname.includes('/course-upload/public/'))
        return request.respond({
          status: resourcesUnavailable ? 503 : 200,
          contentType: 'application/json',
          body: resourcesUnavailable
            ? '{"message":"Local upload service unavailable"}'
            : '{"files":[]}',
        });
      return request.continue();
    });

    scene = 'collapsing-origin-keeps-current-reading-visible';
    await visit('SS-02-01');
    await page.click('#knowledge-chat-close');
    await page.mouse.move(900, 650);
    await page.mouse.wheel({ deltaY: 1800 });
    await page.waitForFunction(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      return (host === window ? window.scrollY : host.scrollTop) > 1000;
    });
    await frames();
    await page.evaluate(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      const bottom = host === window ? window.innerHeight : host.getBoundingClientRect().bottom;
      const boundary = Math.max(
        document.getElementById('knowledge-history').getBoundingClientRect().bottom,
        document.getElementById('learning-annotation-toolbar').getBoundingClientRect().bottom,
      );
      const paragraphs = [...document.querySelectorAll('#knowledge-body p')].filter((item) => {
        const rect = item.getBoundingClientRect();
        return (
          !item.closest('details:not([open])') &&
          rect.height > 0 &&
          rect.top > boundary &&
          rect.top < bottom
        );
      });
      const block = paragraphs[0];
      if (!block) throw new Error('No actually visible paragraph at the chosen deep position');
      block.dataset.originReadingProbe = 'true';
    });
    await frames();
    const expanded = await originPosition();
    assert.ok(
      expanded.top > expanded.boundary && expanded.top < expanded.hostBottom,
      JSON.stringify(expanded),
    );
    await page.click('#knowledge-history-toggle');
    await frames();
    const collapsed = await originPosition();
    assert.equal(collapsed.expanded, 'false');
    assert.equal(collapsed.text, expanded.text);
    assert.ok(collapsed.bottom > collapsed.boundary && collapsed.top < collapsed.hostBottom);
    assert.ok(
      Math.abs(collapsed.top - expanded.top) < 180,
      JSON.stringify({ expanded, collapsed }),
    );
    await page.click('#knowledge-history-toggle');
    await frames();
    const reopened = await originPosition();
    assert.ok(reopened.bottom > reopened.boundary && reopened.top < reopened.hostBottom);
    assert.ok(Math.abs(reopened.top - expanded.top) < 180, JSON.stringify({ expanded, reopened }));
    check({ expanded, collapsed, reopened });
    await page.screenshot({ path: path.join(output, 'origin-deep-reading.png') });

    scene = 'missing-origin-and-body-are-not-invented';
    await visit('SS-03-01');
    assert.match(await page.$eval('#knowledge-body', (item) => item.textContent), /正文暂未提供/);
    assert.equal(await page.$eval('#knowledge-history-empty', (item) => item.hidden), false);
    assert.equal(await page.$eval('#knowledge-history-prose', (item) => item.textContent), '');
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    assert.deepEqual(
      await page.evaluate(() => window.FreeBbsLearningAssessment.getSnapshot().questions),
      [],
    );
    await page.click('[data-knowledge-tool="feedback"]');
    await page.click('[data-quiz-view="quick"]');
    assert.match(
      await page.$eval('#learning-quiz-list', (item) => item.textContent),
      /暂无正式自测题|正式自测尚未开放/,
    );
    assert.equal(await page.$('[data-question-id] form'), null);
    check();

    scene = 'empty-public-resources-are-not-a-login-gate';
    await page.click('[data-knowledge-tool="resources"]');
    await page.waitForSelector('[data-resources-state="empty"]');
    const emptyCopy = await page.$eval('#learning-resources-content', (item) => item.textContent);
    assert.match(emptyCopy, /无需登录/);
    assert.match(emptyCopy, /未找到/);
    check({ copy: emptyCopy });

    scene = 'resource-loading-failure-is-not-fake-empty-material';
    resourcesUnavailable = true;
    await visit('SS-03-01', { tool: 'resources' });
    await page.waitForSelector('[data-resources-state="error"]');
    const failedCopy = await page.$eval('#learning-resources-content', (item) => item.textContent);
    assert.match(failedCopy, /不表示没有资料/);
    assert.match(failedCopy, /重试/);
    resourcesUnavailable = false;
    await page.click('#learning-resources-content button');
    await page.waitForSelector('[data-resources-state="empty"]');
    check({ copy: failedCopy });

    scene = 'legacy-practice-does-not-become-official-selftest';
    await visit('SS-03-02', { tool: 'feedback', quiz: 'practice' });
    await page.waitForSelector('[data-question-id="SS-03-02-Q1"]');
    const legacy = await page.evaluate(() => window.FreeBbsLearningAssessment.getSnapshot());
    assert.equal(legacy.questions.length, 0);
    assert.equal(legacy.practiceQuestions.length, 1);
    assert.equal(legacy.practiceQuestions[0].official, false);
    assert.equal(legacy.practiceQuestions[0].assessmentRole, 'practice');
    await page.click('[data-quiz-view="quick"]');
    assert.equal(await page.$('[data-question-id="SS-03-02-Q1"]'), null);
    check();

    scene = 'guest-can-read-without-acquiring-private-evidence';
    await visit('SS-03-02', { as: 'guest', tool: 'content' });
    assert.match(await page.$eval('#knowledge-body', (item) => item.textContent), /已有定义/);
    assert.equal(await page.$('.learning-start-dialog[open]'), null);
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.isLoggedIn), false);
    assert.equal(preview.requests.length, 0);
    assert.equal(preview.assessmentStore.rows.length, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    assert.deepEqual(report.errors, []);
    check();
    report.ok = true;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.ok = false;
    report.failedScene = scene;
    report.failure = error.message;
    await page
      ?.screenshot({ path: path.join(output, 'content-boundaries-failure.png') })
      .catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(output, 'content-boundaries-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify({ output, ...report }));
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections?.();
    });
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { fixtures, main };
