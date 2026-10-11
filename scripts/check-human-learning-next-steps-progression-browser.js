// Explicit isolated course and memory identities; no formal course content is published.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const label = '本地继续学习推进夹具（非正式课程）';
function fixtureNode(id, quiz = false) {
  const markdown = `# ${label} ${id}\n\n这是明确标记的本地正文。\n${
    quiz
      ? `\n\n\`\`\`freebbs-quiz\n${JSON.stringify(
          {
            schemaVersion: 1,
            status: 'published',
            version: 'local-progression-v1',
            source: label,
            reviewedBy: '本地夹具复核者',
            questions: [
              {
                id: `${id}-Q1`,
                type: 'single_choice',
                assessmentRole: 'selftest',
                difficulty: 'standard',
                prompt: `${label}：请选择A。`,
                options: [
                  { id: 'A', text: '夹具正确答案' },
                  { id: 'B', text: '夹具错误答案' },
                ],
                scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
                explanation: '本地夹具仅用于复核真实流程。',
              },
            ],
          },
          null,
          2,
        )}\n\`\`\`\n`
      : ''
  }`;
  return {
    id,
    title: `${label} ${id}`,
    markdown,
    documentVersion: getAssessmentDocumentVersion(markdown),
    hasDocument: true,
    sections: {
      basicInfoMarkdown: '课程名称：本地夹具\n章节/单元：本地章节\n知识点层级：核心',
      knowledgeMarkdown: markdown,
      applicationsMarkdown: '',
    },
  };
}
const nodes = [
  fixtureNode('SS-01-00'),
  fixtureNode('SS-01-01', true),
  fixtureNode('SS-01-02', true),
];
const contexts = nodes.map((node) => ({
  slug: 'signals',
  course_id: 1,
  course_name: label,
  node_id: node.id,
  title: node.title,
  document_markdown: node.markdown,
  knowledge_markdown: node.markdown,
  basic_info_markdown: node.sections.basicInfoMarkdown,
  is_active: 1,
}));

async function pointer(page, selector, name) {
  const handles = await page.$$(selector);
  try {
    let item = handles[0];
    if (name) {
      item = null;
      for (const handle of handles)
        if ((await handle.evaluate((value) => value.textContent.trim())) === name) {
          item = handle;
          break;
        }
    }
    assert.ok(item, `Missing ${selector} ${name || ''}`);
    await item.evaluate((value) => value.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(
      (value) => {
        const rect = value.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return rect.width > 0 && !value.disabled && (hit === value || value.contains(hit));
      },
      { timeout: 10000 },
      item,
    );
    await item.click();
  } finally {
    await Promise.all(handles.map((item) => item.dispose()));
  }
}

async function main() {
  const preview = createLearningPreview({
    mapNodes: nodes,
    contextRows: contexts,
    mapEdges: [{ source: 'SS-01-01', target: 'SS-01-02', type: 'ordered' }],
  });
  let base = '';
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-next-steps-progression-'));
  const report = {
    boundary:
      'Installed Chrome, actual pointer, real production frontend and routers; isolated labelled course quiz and memory users/attempts/stars/paths. No formal publishing, production learner writes, or production file edits.',
    scenes: [],
    findings: [],
    pageErrors: [],
  };
  let browser;
  let page;
  const ready = async () => {
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 1 &&
        document.querySelector('#learning-plan-summary h3'),
    );
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await pointer(page, '#knowledge-chat-close');
  };
  const visit = async (point = 'SS-01-01', as = 'student') => {
    await page.goto(
      `${base}/knowledge?${new URLSearchParams({ course: 'signals', point, as, view: 'reading' })}`,
      { waitUntil: 'networkidle0' },
    );
    await ready();
  };
  const tool = async (name) => {
    await pointer(page, `[data-knowledge-tool="${name}"]`);
    await page.waitForFunction(
      (value) => document.querySelector('[data-knowledge-page]').dataset.learningTool === value,
      {},
      name,
    );
  };
  const preference = async (goal) => {
    await pointer(page, '.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]', { visible: true });
    await page.select('[data-learning-start-choice="level"]', 'basic');
    await page.select('[data-learning-start-choice="goal"]', goal);
    await pointer(page, '.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
  };
  const snapshot = async () =>
    page.evaluate(() => ({
      preference: window.FreeBbsLearningStart.currentPreference(),
      title: document.getElementById('learning-plan-title').textContent,
      reason: document.getElementById('learning-plan-reason').textContent,
      primary: document.querySelector('#learning-plan-summary h3')?.textContent,
      chain: document.getElementById('learning-plan-chain').textContent,
      alternatives: [...document.querySelectorAll('.learning-plan-alternatives button')].map(
        (item) => item.textContent,
      ),
      successor: {
        href: document.getElementById('knowledge-next-link').getAttribute('href'),
        disabled: document.getElementById('knowledge-next-link').getAttribute('aria-disabled'),
        title: document.getElementById('knowledge-next-title').textContent,
      },
      attempts: window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.map(
        ({ official, verdict, questionId }) => ({ official, verdict, questionId }),
      ),
      star: {
        earned: document
          .querySelector('[data-learning-star="self_learning"]')
          ?.classList.contains('is-earned'),
        text: document.querySelector('[data-learning-star="self_learning"]')?.textContent,
      },
    }));
  const pass = async (point) => {
    await tool('feedback');
    await pointer(page, '[data-quiz-view="quick"]');
    await pointer(page, `#learning-quiz-list [data-question-id="${point}-Q1"] input[value="A"]`);
    await pointer(
      page,
      `#learning-quiz-list [data-question-id="${point}-Q1"] button[type="submit"]`,
    );
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.some(
        (item) => item.official && item.verdict === 'pass',
      ),
    );
    await page.waitForFunction(() =>
      document
        .querySelector('[data-learning-star="self_learning"]')
        ?.classList.contains('is-earned'),
    );
    await tool('continue');
  };
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
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      return url.origin === base || ['data:', 'blob:'].includes(url.protocol)
        ? request.continue()
        : request.respond({ status: 403, body: 'Explicit local fixture: no external network' });
    });
    await visit();
    await preference('practice');
    await tool('continue');
    const before = await snapshot();
    await pass('SS-01-01');
    const after = await snapshot();
    assert.equal(after.star.earned, true);
    assert.ok(after.attempts.every((item) => item.official && item.verdict === 'pass'));
    assert.ok(after.successor.href.includes('point=SS-01-02'));
    await page.screenshot({
      path: path.join(output, 'passed-star-current-practice-and-footer-next.png'),
    });
    const nextFromRecommendation = after.alternatives.includes('开始下一知识点');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      nextFromRecommendation
        ? pointer(page, '.learning-plan-alternatives button', '开始下一知识点')
        : pointer(page, '#knowledge-next-link'),
    ]);
    await ready();
    assert.equal(new URL(page.url()).searchParams.get('point'), 'SS-01-02');
    report.scenes.push({
      name: 'current formal selftest pass earns real memory-store star; stored practice recommendation vs genuinely reachable footer successor',
      before,
      after,
      nextReached: true,
      nextFromRecommendation,
    });
    if (
      after.primary === before.primary &&
      !after.alternatives.some((item) => /下一知识点/.test(item))
    )
      report.findings.push({
        id: 'passed-stored-goal-repeats-current-task-without-recommendation-successor',
        impact:
          '已通过且获得自主星后，继续学习首荐仍是当前题目练习；也可以区无下一点。页尾下一点真实可达，因此不是导航锁定。',
        source: 'public/learning-next-steps.js:532-592; public/knowledge.js:103',
      });
    await pass('SS-01-02');
    const last = await snapshot();
    assert.equal(last.star.earned, true);
    assert.equal(last.successor.href, null);
    assert.equal(last.successor.disabled, 'true');
    assert.match(last.successor.title, /最后一个/);
    report.scenes.push({
      name: 'last course point has no invented successor and does not claim full mastery',
      last,
    });
    await visit();
    await tool('continue');
    await pointer(page, '#learning-plan-editor > summary');
    await pointer(page, '#learning-plan-steps > li:nth-child(1) button', '完成');
    await pointer(page, '#learning-plan-steps > li:nth-child(2) button', '跳过');
    await pointer(page, '#learning-plan-save');
    await page.waitForFunction(
      () => document.getElementById('learning-plan-status').textContent === '已保存',
    );
    const saved = await snapshot();
    const storedBefore = await page.evaluate(
      async () =>
        (
          await window.freeBbsApp.callApi('/learning/signals/SS-01-01/entries?kind=path', {
            method: 'GET',
          })
        ).entries[0].path,
    );
    await preference('explore');
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await tool('continue');
    const restoredPath = await snapshot();
    const storedAfter = await page.evaluate(
      async () =>
        (
          await window.freeBbsApp.callApi('/learning/signals/SS-01-01/entries?kind=path', {
            method: 'GET',
          })
        ).entries[0].path,
    );
    assert.deepEqual(storedAfter, storedBefore);
    assert.equal(restoredPath.chain, saved.chain);
    report.scenes.push({
      name: 'personal path retains order, completion and skip after pass and course-goal change',
      saved,
      restoredPath,
      storedBefore,
      storedAfter,
    });
    await visit('SS-01-01', 'other');
    await preference('practice');
    await pointer(page, '[data-knowledge-tag="learned"]');
    await tool('continue');
    const markedOnly = await snapshot();
    assert.equal(markedOnly.attempts.length, 0);
    assert.equal(markedOnly.star.earned, false);
    assert.doesNotMatch(markedOnly.reason, /自测.*通过/);
    report.scenes.push({
      name: 'other fixture account manual learned tag does not fabricate formal pass or a star',
      markedOnly,
    });
    assert.equal(preview.requests.length, 0);
    assert.deepEqual(report.pageErrors, []);
    report.executed = true;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.executed = false;
    report.failure = { message: error.message, stack: error.stack };
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          output,
          executed: report.executed,
          scenes: report.scenes.map((item) => item.name),
          findings: report.findings,
          failure: report.failure,
          pageErrors: report.pageErrors,
        },
        null,
        2,
      ),
    );
    if (!report.executed) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
