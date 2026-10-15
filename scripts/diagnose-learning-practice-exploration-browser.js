// One real learner journey, entirely within a labelled isolated memory fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const {
  getAssessmentDocumentVersion,
  parseAssessmentMarkdown,
} = require('../backend/learning-assessment');

const POINT = 'SS-01-01';
const LABEL = '本地练习转探索边界夹具（非正式成绩）';
const BASIC = `${POINT}-basic`;
const FORMAL = `${POINT}-formal`;
const EXPLORE = `${POINT}-explore`;

function fixture() {
  const quiz = {
    schemaVersion: 1,
    status: 'published',
    version: 'practice-explore-fixture-v1',
    source: LABEL,
    reviewedBy: '本地夹具课程组',
    questions: [
      { id: BASIC, assessmentRole: 'practice', difficulty: 'basic' },
      { id: FORMAL, assessmentRole: 'selftest', difficulty: 'standard' },
      { id: EXPLORE, assessmentRole: 'exploration', difficulty: 'challenge' },
    ].map((question) => ({
      ...question,
      type: 'single_choice',
      prompt: `${LABEL} ${question.id}：仅夹具规则，选择 A。`,
      options: [
        { id: 'A', text: '夹具正确选项' },
        { id: 'B', text: '夹具错误选项' },
      ],
      scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
    })),
  };
  const markdown = `# ${LABEL}\n\n明示本地软件夹具正文。\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify(quiz)}\n\x60\x60\x60\n`;
  const parsed = parseAssessmentMarkdown(markdown);
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.practiceQuestions.length, 2);
  assert.deepEqual(parsed.warnings, []);
  const node = {
    id: POINT,
    title: LABEL,
    markdown,
    documentVersion: getAssessmentDocumentVersion(markdown),
    hasDocument: true,
    sections: { basicInfoMarkdown: '知识点层级：核心', knowledgeMarkdown: markdown },
  };
  const context = {
    slug: 'signals',
    course_id: 1,
    course_name: LABEL,
    node_id: POINT,
    title: LABEL,
    document_markdown: markdown,
    knowledge_markdown: markdown,
    basic_info_markdown: '知识点层级：核心',
    is_active: 1,
  };
  return { node, context, parsed };
}

async function click(page, selector, text) {
  const handles = await page.$$(selector);
  try {
    let target = handles[0];
    if (text) {
      target = null;
      for (const handle of handles)
        if ((await handle.evaluate((item) => item.textContent.trim())) === text) {
          target = handle;
          break;
        }
    }
    assert.ok(target, `Missing real pointer target: ${selector} ${text || ''}`);
    const deadline = Date.now() + 10000;
    let observation;
    while (Date.now() < deadline) {
      observation = await target.evaluate((item) => {
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          reachable: box.width > 0 && !item.disabled && (hit === item || item.contains(hit)),
          top: box.top,
          hit: hit?.outerHTML.slice(0, 160),
        };
      });
      if (observation.reachable) {
        await target.click();
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    throw new Error(`Pointer target remained blocked: ${selector} ${JSON.stringify(observation)}`);
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function main() {
  const output =
    process.env.LEARNING_PRACTICE_EXPLORATION_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-practice-exploration-'));
  fs.mkdirSync(output, { recursive: true });
  const data = fixture();
  const preview = createLearningPreview({
    mapNodes: [data.node],
    mapEdges: [],
    contextRows: [data.context],
  });
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Installed Chrome, native clicks and actual production HTTP/UI against an explicitly labelled isolated memory course. One basic practice and one formal selftest answer are deliberately submitted only to this synthetic memory store; one manual path step remains unsaved in-page. No real accounts/course grades, production MySQL, AI, external network or mastery/learning-effectiveness claim. Body revision is an explicit fixture mutation before the final quiz fence, not a tested publication workflow.',
    scenes: [],
    requests: [],
    pageErrors: [],
    blockedAI: [],
    blockedExternal: [],
    dialogs: [],
    screenshots: [],
    cleanup: {},
  };
  let browser;
  let context;
  let page;
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    const base = `http://127.0.0.1:${report.portSelection.port}`;
    // eslint-disable-next-line import/no-dynamic-require -- Reuses the installed runtime supplied by the local environment.
    const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE,
      headless: true,
      args: ['--no-sandbox', '--disable-background-networking'],
    });
    report.chrome = await browser.version();
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      report.dialogs.push({ type: dialog.type(), message: dialog.message() });
      // The test deliberately discards its unsaved, manually checked in-page path
      // when refreshing the synthetic body revision. Do not swallow other dialogs.
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        report.blockedExternal.push(request.url());
        request.abort();
      } else if (url.pathname.startsWith('/api/ai/')) {
        report.blockedAI.push(url.pathname);
        request.abort();
      } else {
        if (url.pathname.startsWith('/api/learning-assessments/') && request.method() !== 'GET')
          report.requests.push({
            method: request.method(),
            path: url.pathname,
            body: JSON.parse(request.postData()),
          });
        request.continue();
      }
    });
    const ready = async () => {
      await page.waitForFunction(
        () =>
          window.FreeBbsLearningAssessment?.getSnapshot().loaded &&
          document.querySelector('#learning-selftest-stars')?.textContent.includes('本版自测'),
      );
      if (await page.$('.learning-start-dialog[open]')) await click(page, '.learning-start-exit');
      if (await page.$eval('#knowledge-chat-panel', (panel) => !panel.classList.contains('hidden')))
        await click(page, '#knowledge-chat-close');
    };
    const tool = async (name) => {
      await click(page, `[data-knowledge-tool="${name}"]`);
      await page.waitForFunction(
        (value) => document.querySelector('[data-knowledge-page]').dataset.learningTool === value,
        {},
        name,
      );
    };
    const observe = () =>
      page.evaluate(() => {
        const assessment = window.FreeBbsLearningAssessment.getSnapshot();
        const stars = document.querySelector('#learning-selftest-stars');
        return {
          tool: document.querySelector('[data-knowledge-page]').dataset.learningTool,
          preference: window.FreeBbsLearningStart.currentPreference(),
          history: document.querySelector('#learning-quiz-results').textContent,
          attempts: assessment.attempts,
          currentAttempts: assessment.currentAttempts,
          displayedQuestions: [
            ...document.querySelectorAll('#learning-quiz-list [data-question-id]'),
          ].map((item) => item.dataset.questionId),
          starText: stars.textContent,
          starEarned: stars
            .querySelector('[data-learning-star="self_learning"]')
            .classList.contains('is-earned'),
          deepMastery: stars.querySelector('[data-learning-star="deep_mastery"]').textContent,
          plan: {
            title: document.querySelector('#learning-plan-title').textContent,
            reason: document.querySelector('#learning-plan-reason').textContent,
            chain: document.querySelector('#learning-plan-chain').textContent,
            primary: document.querySelector('#learning-plan-summary h3')?.textContent,
          },
          tag: document.querySelector('#knowledge-status').textContent,
        };
      });
    const scene = async (name, selector) => {
      // A saved attempt emits an independent stars GET. Observe its real read result,
      // not the transient loading placeholder; this does not repeat any learner action.
      await page.waitForFunction(() =>
        document.querySelector('#learning-selftest-stars')?.textContent.includes('本版自测'),
      );
      const state = await observe();
      report.scenes.push({ name, state });
      await page.$eval(selector, (item) =>
        item.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      const file = path.join(output, `${report.scenes.length}-${name}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
      return state;
    };
    await page.goto(`${base}/knowledge?course=signals&point=${POINT}&as=student&tool=feedback`, {
      waitUntil: 'networkidle0',
    });
    await ready();
    await tool('feedback');
    await click(page, '[data-quiz-view="practice"]');
    await click(page, `#learning-quiz-list [data-question-id="${BASIC}"] input[value="A"]`);
    await click(page, `#learning-quiz-list [data-question-id="${BASIC}"] button[type="submit"]`);
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().attempts.length === 1,
    );
    let state = await scene('basic-practice-feedback', '#learning-quiz-results');
    assert.match(state.history, /练习反馈 1 \/ 1 · 不计入正式测评/);
    assert.doesNotMatch(state.history, /本题通过/);
    assert.match(state.starText, /本版自测 0\/1 题通过/);
    assert.equal(state.starEarned, false);
    assert.equal(preview.starsStore.rows.length, 0);
    assert.equal(state.currentAttempts[0].official, false);
    assert.equal(state.currentAttempts[0].verdict, 'practice_only');
    await tool('continue');
    await click(page, '.learning-plan-alternatives button', '探索研究');
    await tool('continue');
    await click(page, '#learning-plan-summary .learning-plan-primary button', '完成这一步');
    state = await scene('explore-goal-and-manual-step', '#learning-plan-summary');
    assert.match(state.plan.title, /入口|联系|探究|检验/);
    assert.equal(state.preference, null);
    assert.equal(state.plan.reason, '探索研究 · 起点未设置');
    assert.doesNotMatch(state.plan.reason, /第一次学|学生自述/);
    assert.match(state.plan.chain, /✓/);
    assert.doesNotMatch(state.plan.reason, /正式自测已通过|完整掌握/);
    assert.equal(state.tag, '未标记');
    assert.equal(preview.assessmentStore.rows.length, 1);
    assert.equal(preview.starsStore.rows.length, 0);
    await tool('feedback');
    await click(page, '[data-quiz-view="practice"]');
    await click(page, '.learning-quiz-filters button', '探索题');
    state = await scene(
      'challenge-exploration-open-without-formal-pass',
      `#learning-quiz-list [data-question-id="${EXPLORE}"]`,
    );
    assert.deepEqual(state.displayedQuestions, [EXPLORE]);
    assert.equal(state.preference, null);
    assert.equal(state.plan.reason, '探索研究 · 起点未设置');
    assert.equal(state.starEarned, false);
    assert.equal(preview.assessmentStore.rows.length, 1);
    await click(page, '[data-quiz-view="quick"]');
    await click(page, `#learning-quiz-list [data-question-id="${FORMAL}"] input[value="A"]`);
    await click(page, `#learning-quiz-list [data-question-id="${FORMAL}"] button[type="submit"]`);
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
          (entry) => entry.official && entry.verdict === 'pass',
        ) &&
        document
          .querySelector('#learning-selftest-stars [data-learning-star="self_learning"]')
          .classList.contains('is-earned'),
    );
    state = await scene('deliberate-current-formal-pass', '#learning-selftest-stars');
    assert.match(state.history, /本题通过/);
    assert.match(state.starText, /本版自测 1\/1 题通过/);
    assert.doesNotMatch(state.starText, /历史版本/);
    assert.match(state.deepMastery, /后续开发/);
    assert.equal(preview.assessmentStore.rows.length, 2);
    const revised = data.node.markdown.replace(
      '明示本地软件夹具正文。',
      '明示本地软件夹具正文。\n\n夹具正文修订，题目版本不变。',
    );
    const parsed = parseAssessmentMarkdown(revised);
    assert.equal(parsed.questions.length, 1);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.questionVersion, data.parsed.questionVersion);
    data.node.markdown = revised;
    data.node.sections.knowledgeMarkdown = revised;
    data.node.documentVersion = getAssessmentDocumentVersion(revised);
    data.context.document_markdown = revised;
    data.context.knowledge_markdown = revised;
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await tool('feedback');
    state = await scene('history-star-not-current-version-proof', '#learning-selftest-stars');
    assert.equal(state.starEarned, true);
    assert.match(state.starText, /保留历史版本的星记录/);
    assert.match(state.starText, /本版自测 0\/1 题通过/);
    assert.match(state.history, /历史版本作答/);
    assert.equal(preview.assessmentStore.rows.length, 2);
    assert.equal(report.requests.length, 2);
    assert.deepEqual(
      report.requests.map((request) => request.body.mode),
      ['practice', 'selftest'],
    );
    assert.equal(report.pageErrors.length, 0);
    assert.equal(report.blockedAI.length, 0);
    assert.equal(report.blockedExternal.length, 0);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    if (error.portSelection) report.portSelection = error.portSelection;
    process.exitCode = 1;
    if (page) {
      const file = path.join(output, 'failure.png');
      await page.screenshot({ path: file }).catch(() => {});
      report.screenshots.push(file);
    }
  } finally {
    try {
      if (context) await context.close();
      report.cleanup.contextClosed = true;
    } finally {
      try {
        if (browser) await browser.close();
        report.cleanup.browserClosed = true;
      } finally {
        await new Promise((resolve, reject) => {
          preview.server.close((error) => {
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
            else resolve();
          });
        });
        report.cleanup.serverClosed = !preview.server.listening;
      }
    }
    report.finishedAt = new Date().toISOString();
    const file = path.join(output, 'practice-exploration-report.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: file,
          passed: report.passed,
          scenes: report.scenes.length,
          error: report.error,
          cleanup: report.cleanup,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
