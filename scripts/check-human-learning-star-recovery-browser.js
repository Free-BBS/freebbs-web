// Explicit memory-only fault fixture. Chrome clicks exercise the real learner UI and routers.
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
const QUESTION = `${POINT}-Q1`;
const LABEL = '本地学习星故障恢复夹具（非正式课程）';
const STAR_PATH = `/api/learning-stars/signals/${POINT}`;
const ATTEMPT_PATH = `/api/learning-assessments/signals/${POINT}/attempts`;

function fixture() {
  const quiz = {
    schemaVersion: 1,
    status: 'published',
    version: 'local-star-recovery-v1',
    source: LABEL,
    reviewedBy: '本地夹具复核者',
    questions: [
      {
        id: QUESTION,
        type: 'single_choice',
        assessmentRole: 'selftest',
        difficulty: 'standard',
        prompt: `${LABEL}：请选择 A。`,
        options: [
          { id: 'A', text: '夹具正确答案' },
          { id: 'B', text: '夹具错误答案' },
        ],
        scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
        explanation: '仅验证本地软件流程，不代表任何真实课程成绩。',
      },
    ],
  };
  const markdown = `# ${LABEL}\n\n明确标记的本地正文。\n\n\`\`\`freebbs-quiz\n${JSON.stringify(quiz, null, 2)}\n\`\`\`\n`;
  const node = {
    id: POINT,
    title: LABEL,
    markdown,
    documentVersion: getAssessmentDocumentVersion(markdown),
    hasDocument: true,
    sections: {
      basicInfoMarkdown: '课程名称：本地夹具\n章节/单元：本地章节\n知识点层级：核心',
      knowledgeMarkdown: markdown,
      applicationsMarkdown: '',
    },
  };
  const context = {
    slug: 'signals',
    course_id: 1,
    course_name: LABEL,
    node_id: POINT,
    title: LABEL,
    document_markdown: markdown,
    knowledge_markdown: markdown,
    basic_info_markdown: node.sections.basicInfoMarkdown,
    is_active: 1,
  };
  const assessment = parseAssessmentMarkdown(markdown);
  assert.equal(assessment.questions.length, 1);
  assert.deepEqual(assessment.warnings, []);
  return { node, context, assessment };
}

async function pointer(page, selector, text) {
  const handles = await page.$$(selector);
  try {
    let handle = handles[0];
    if (text) {
      handle = null;
      for (const candidate of handles)
        if ((await candidate.evaluate((item) => item.textContent.trim())) === text) {
          handle = candidate;
          break;
        }
    }
    assert.ok(handle, `Missing real UI control: ${selector} ${text || ''}`);
    await handle.evaluate((item) => item.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(
      (item) => {
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return box.width > 0 && !item.disabled && (hit === item || item.contains(hit));
      },
      { timeout: 10000 },
      handle,
    );
    await handle.click();
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function observe(page) {
  return page.evaluate(() => {
    const snapshot = window.FreeBbsLearningAssessment.getSnapshot();
    const strip = document.querySelector('#learning-selftest-stars');
    return {
      uid: window.freeBbsApp.userState.uid,
      documentVersion: snapshot.documentVersion,
      questions: snapshot.questions.map(({ id, questionVersion }) => ({ id, questionVersion })),
      attempts: snapshot.attempts,
      currentAttempts: snapshot.currentAttempts,
      historyText: document.querySelector('#learning-quiz-results').textContent,
      starEarned: strip
        .querySelector('[data-learning-star="self_learning"]')
        .classList.contains('is-earned'),
      starText: strip.textContent,
      buttons: [...strip.querySelectorAll('button')].map((item) => ({
        text: item.textContent,
        disabled: item.disabled,
      })),
    };
  });
}

async function runCase({ browser, output, report, name, changeBody }) {
  const data = fixture();
  const preview = createLearningPreview({
    mapNodes: [data.node],
    mapEdges: [],
    contextRows: [data.context],
  });
  const record = {
    name,
    fixture: { questionId: QUESTION, documentVersion: data.node.documentVersion },
    scenes: [],
    requests: [],
    responses: [],
    grantCalls: [],
    screenshots: [],
  };
  report.cases.push(record);
  const originalGrant = preview.starsStore.grant.bind(preview.starsStore);
  let outage = true;
  preview.starsStore.grant = async (...args) => {
    record.grantCalls.push({ userId: args[0].id, point: args[2], key: args[3], outage });
    if (outage) throw new Error('Explicit memory fixture: star-store grant outage');
    return originalGrant(...args);
  };
  let context;
  let page;
  const responseReads = new Set();
  const drain = async () => {
    while (responseReads.size) await Promise.all([...responseReads]);
  };
  const attemptPosts = () =>
    record.requests.filter((item) => item.method === 'POST' && item.path === ATTEMPT_PATH).length;
  const reconcilePosts = () =>
    record.requests.filter(
      (item) => item.method === 'POST' && item.path === `${STAR_PATH}/reconcile`,
    ).length;
  const scene = async (title) => {
    await drain();
    const state = await observe(page);
    record.scenes.push({
      title,
      passed: true,
      state,
      attemptPosts: attemptPosts(),
      reconcilePosts: reconcilePosts(),
      memoryStarRows: preview.starsStore.rows.length,
    });
    const file = path.join(output, `${name}-${record.scenes.length}.png`);
    await page.screenshot({ path: file, fullPage: true });
    record.screenshots.push(file);
    return state;
  };
  try {
    record.portSelection = await listenAllowedLoopback(preview.server);
    const base = `http://127.0.0.1:${preview.server.address().port}`;
    record.base = base;
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push({ name, message: error.message }));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        report.blockedExternal.push({ name, url: request.url() });
        request.abort();
      } else if (url.pathname.startsWith('/api/ai/')) {
        report.blockedAI.push({ name, path: url.pathname });
        request.abort();
      } else {
        if (
          url.pathname.startsWith('/api/learning-stars/') ||
          url.pathname.startsWith('/api/learning-assessments/')
        )
          record.requests.push({ path: `${url.pathname}${url.search}`, method: request.method() });
        request.continue();
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (
        !url.pathname.startsWith('/api/learning-stars/') &&
        !url.pathname.startsWith('/api/learning-assessments/')
      )
        return;
      const read = (async () => {
        try {
          record.responses.push({
            path: `${url.pathname}${url.search}`,
            method: response.request().method(),
            status: response.status(),
            body: await response.json(),
          });
        } catch (error) {
          record.responses.push({
            path: url.pathname,
            status: response.status(),
            readError: error.message,
          });
        }
      })();
      responseReads.add(read);
      read.finally(() => responseReads.delete(read));
    });
    const ready = async (uid = 'u_learning01') => {
      await page.waitForFunction(
        (owner) =>
          window.freeBbsApp?.userState.uid === owner &&
          window.FreeBbsLearningAssessment?.getSnapshot().loaded &&
          window.FreeBbsLearningAssessment.getSnapshot().questions.length === 1 &&
          document.querySelector('#learning-selftest-stars')?.textContent.includes('本版自测'),
        {},
        uid,
      );
      if (await page.$('.learning-start-dialog[open]')) await pointer(page, '.learning-start-exit');
      if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
        await pointer(page, '#knowledge-chat-close');
      await drain();
    };
    const visit = async (as = 'student') => {
      await page.goto(
        `${base}/knowledge?${new URLSearchParams({ course: 'signals', point: POINT, as, view: 'reading' })}`,
        { waitUntil: 'networkidle0' },
      );
      await ready(as === 'other' ? 'u_learning02' : 'u_learning01');
    };
    const feedback = async () => {
      await pointer(page, '[data-knowledge-tool="feedback"]');
      await page.waitForFunction(
        () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback',
      );
      await pointer(page, '[data-quiz-view="quick"]');
    };
    await visit();
    assert.equal(reconcilePosts(), 0);
    await feedback();
    await pointer(page, `#learning-quiz-list [data-question-id="${QUESTION}"] input[value="A"]`);
    await pointer(
      page,
      `#learning-quiz-list [data-question-id="${QUESTION}"] button[type="submit"]`,
    );
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
          (item) => item.official && item.verdict === 'pass',
        ) && document.querySelector('#learning-selftest-stars').textContent.includes('更新学习星'),
    );
    await drain();
    let state = await observe(page);
    assert.ok(state.historyText.includes('本题通过'));
    assert.equal(state.starEarned, false);
    assert.equal(preview.assessmentStore.rows.length, 1);
    assert.equal(preview.starsStore.rows.length, 0);
    assert.equal(attemptPosts(), 1);
    assert.equal(reconcilePosts(), 0);
    assert.equal(record.grantCalls.length, 1);
    const attemptResponse = record.responses.find(
      (item) => item.path === ATTEMPT_PATH && item.method === 'POST',
    );
    assert.equal(attemptResponse.status, 201);
    assert.equal(attemptResponse.body.attempt.verdict, 'pass');
    const firstRead = [...record.responses]
      .reverse()
      .find(
        (item) =>
          item.path === STAR_PATH && item.method === 'GET' && item.body.node.selftest.eligible,
      );
    assert.ok(firstRead);
    assert.equal(
      firstRead.body.node.stars.find((item) => item.key === 'self_learning').earned,
      false,
    );
    const savedAttempt = state.attempts[0];
    await scene(
      'Native formal answer passed; failed hook left eligible evidence without an earned star',
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await feedback();
    state = await observe(page);
    assert.ok(state.historyText.includes('本题通过'));
    assert.equal(state.starEarned, false);
    assert.equal(attemptPosts(), 1);
    assert.equal(reconcilePosts(), 0);
    assert.equal(record.grantCalls.length, 1);
    await scene(
      'Actual reload and GETs preserve the pass but do not silently reconcile or resubmit',
    );
    if (changeBody) {
      const revised = data.node.markdown.replace(
        '明确标记的本地正文。',
        '明确标记的本地正文。\n\n本地夹具新增正文版本；题目内容和题目版本不变。',
      );
      const parsed = parseAssessmentMarkdown(revised);
      assert.equal(parsed.questions.length, 1);
      assert.deepEqual(parsed.warnings, []);
      assert.equal(parsed.questionVersion, data.assessment.questionVersion);
      assert.notEqual(parsed.documentVersion, data.assessment.documentVersion);
      data.node.markdown = revised;
      data.node.sections.knowledgeMarkdown = revised;
      data.node.documentVersion = parsed.documentVersion;
      data.context.document_markdown = revised;
      data.context.knowledge_markdown = revised;
      record.fixture.bodyVersionMutation = {
        before: data.assessment.documentVersion,
        after: parsed.documentVersion,
        questionVersionUnchanged: true,
        placement: 'before final quiz fence; one valid published fixture question remains',
      };
      outage = false;
      await page.reload({ waitUntil: 'networkidle0' });
      await ready();
      await feedback();
      state = await observe(page);
      assert.equal(state.documentVersion, parsed.documentVersion);
      assert.equal(state.attempts.length, 1);
      assert.equal(state.attempts[0].id, savedAttempt.id);
      assert.equal(state.attempts[0].verdict, 'pass');
      assert.equal(state.attempts[0].documentVersion, savedAttempt.documentVersion);
      assert.ok(state.historyText.includes('历史版本作答'));
      assert.ok(state.starText.includes('本版自测 0/1 题通过'));
      assert.equal(state.starEarned, false);
      assert.equal(state.buttons.length, 0);
      assert.equal(reconcilePosts(), 0);
      assert.equal(attemptPosts(), 1);
      assert.equal(record.grantCalls.length, 1);
      assert.equal(preview.starsStore.rows.length, 0);
      const latestRead = [...record.responses]
        .reverse()
        .find((item) => item.path === STAR_PATH && item.method === 'GET');
      assert.equal(latestRead.body.node.selftest.eligible, false);
      await scene(
        'Legally changed body keeps historical pass visible, excludes old evidence and offers no old-star backfill',
      );
    } else {
      await pointer(page, '#learning-selftest-stars button', '更新学习星');
      await page.waitForFunction(
        () =>
          document.querySelector('#learning-selftest-stars button')?.textContent ===
            '更新失败，重试' && !document.querySelector('#learning-selftest-stars button').disabled,
      );
      await drain();
      assert.equal(reconcilePosts(), 1);
      assert.equal(preview.starsStore.rows.length, 0);
      assert.equal(
        record.responses.find(
          (item) => item.method === 'POST' && item.path === `${STAR_PATH}/reconcile`,
        ).status,
        500,
      );
      assert.equal(attemptPosts(), 1);
      await scene(
        'Native update click fails visibly and enables explicit retry without losing the saved pass',
      );
      outage = false;
      await pointer(page, '#learning-selftest-stars button', '更新失败，重试');
      await page.waitForFunction(() =>
        document
          .querySelector('#learning-selftest-stars [data-learning-star="self_learning"]')
          .classList.contains('is-earned'),
      );
      await drain();
      state = await observe(page);
      assert.equal(reconcilePosts(), 2);
      assert.equal(attemptPosts(), 1);
      assert.equal(preview.assessmentStore.rows.length, 1);
      assert.equal(preview.starsStore.rows.length, 2);
      assert.deepEqual(preview.starsStore.rows.map((item) => item.star_key).sort(), [
        'course_lit',
        'self_learning',
      ]);
      assert.equal(state.buttons.length, 0);
      assert.equal(state.attempts[0].id, savedAttempt.id);
      assert.equal(
        record.responses.filter(
          (item) => item.method === 'POST' && item.path === `${STAR_PATH}/reconcile`,
        )[1].status,
        200,
      );
      const grantCalls = record.grantCalls.length;
      await scene(
        'Native retry records one node star and one course star from the same saved attempt',
      );
      await page.reload({ waitUntil: 'networkidle0' });
      await ready();
      state = await observe(page);
      assert.equal(state.starEarned, true);
      assert.equal(reconcilePosts(), 2);
      assert.equal(attemptPosts(), 1);
      assert.equal(record.grantCalls.length, grantCalls);
      assert.equal(preview.starsStore.rows.length, 2);
      await scene(
        'Reload of recovered record does not repeat answering, grant calls or reconcile POSTs',
      );
      await visit('other');
      state = await observe(page);
      assert.equal(state.uid, 'u_learning02');
      assert.equal(state.attempts.length, 0);
      assert.equal(state.starEarned, false);
      assert.equal(state.buttons.length, 0);
      assert.ok(state.starText.includes('本版自测 0/1 题通过'));
      assert.equal(preview.starsStore.rows.length, 2);
      assert.ok(preview.starsStore.rows.every((item) => item.user_id === 1));
      await scene(
        'Actual account navigation to another uid exposes neither original pass nor original stars',
      );
      await visit();
      state = await observe(page);
      assert.equal(state.uid, 'u_learning01');
      assert.equal(state.starEarned, true);
      assert.equal(state.attempts.length, 1);
      assert.equal(reconcilePosts(), 2);
      assert.equal(attemptPosts(), 1);
      assert.equal(record.grantCalls.length, grantCalls);
      await scene(
        'Returning to original uid restores only its existing records without new writes',
      );
    }
    record.passed = true;
  } catch (error) {
    if (error.portSelection) record.portSelection = error.portSelection;
    record.error = error.stack || error.message;
    if (page && !page.isClosed()) {
      try {
        record.failureState = await observe(page);
        const file = path.join(output, `${name}-failure.png`);
        await page.screenshot({ path: file, fullPage: true });
        record.screenshots.push(file);
      } catch (captureError) {
        record.captureError = captureError.message;
      }
    }
  } finally {
    try {
      await context?.close();
    } catch (error) {
      record.cleanupError = error.message;
    } finally {
      preview.server.closeAllConnections?.();
      if (preview.server.listening)
        await new Promise((resolve, reject) => {
          preview.server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      record.closed = !preview.server.listening;
      record.aiRequests = preview.requests.length;
      record.memory = {
        attempts: preview.assessmentStore.rows.length,
        awards: preview.starsStore.rows.length,
      };
    }
  }
}

async function main() {
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'human-star-recovery-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    fixture:
      'Installed Chrome + actual native pointer on production UI and registered HTTP routers. Two independently bound isolated createLearningPreview memory fixtures; each has one explicitly synthetic published objective question. No real learner grades, real MySQL, financial writes, real or simulated AI, or educational-effectiveness claims.',
    boundaries: [
      'Only memory starsStore.grant throws; formal objective attempt still saves through the real browser POST and grading route. GETs are observed rather than replaced or stubbed.',
      'Outage recovery and legal body revision are explicit process-only fixtures, not claims about a real teacher publishing or a real service outage.',
      'Account switch uses actual browser navigation with the existing preview identity bootstrap; it is not the production login flow or a multi-device test.',
      'Controls use native ElementHandle.click with hit testing; DOM reads and scrollIntoView prepare or observe, never dispatch fake input or trigger a reconcile API directly.',
      'External page requests and all /api/ai requests are blocked. Each own browser context and ephemeral server has setup-inclusive cleanup; fixed preview52146 is not used.',
    ],
    cases: [],
    pageErrors: [],
    blockedExternal: [],
    blockedAI: [],
  };
  let browser;
  try {
    // Existing explicitly configured local runtime; never install dependencies for this probe.
    // eslint-disable-next-line import/no-dynamic-require
    const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    });
    report.chrome = await browser.version();
    await runCase({
      browser,
      output,
      report,
      name: 'current-evidence-recovery',
      changeBody: false,
    });
    await runCase({ browser, output, report, name: 'changed-body-exclusion', changeBody: true });
  } catch (error) {
    report.error = error.stack || error.message;
    if (error.portSelection) report.portSelection = error.portSelection;
  } finally {
    try {
      await browser?.close();
      report.browserClosed = true;
    } catch (error) {
      report.cleanupError = error.message;
    }
    report.finishedAt = new Date().toISOString();
    report.passed =
      !report.error &&
      !report.cleanupError &&
      report.pageErrors.length === 0 &&
      report.blockedAI.length === 0 &&
      report.cases.length === 2 &&
      report.cases.every(
        (item) => item.passed && !item.cleanupError && item.closed && item.aiRequests === 0,
      );
    const filename = path.join(output, 'star-recovery-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: filename,
          passed: report.passed,
          cases: report.cases.map(({ name, scenes, error, closed, portSelection }) => ({
            name,
            scenes: scenes.length,
            error,
            closed,
            portSelection,
          })),
          blockedAI: report.blockedAI,
          pageErrors: report.pageErrors,
        },
        null,
        2,
      ),
    );
    if (!report.passed) process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main };
