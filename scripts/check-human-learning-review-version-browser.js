// Presentation-only probe: explicit synthetic saved answers, real Chrome/HTTP/UI, no grades submitted.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
const LABEL = '本地历史复核呈现夹具（非正式课程成绩）';

function fixture() {
  const quiz = {
    schemaVersion: 1,
    status: 'published',
    version: 'fixture-current-question',
    source: LABEL,
    reviewedBy: '合成夹具课程组',
    questions: [
      {
        id: QUESTION,
        type: 'short_answer',
        prompt: 'CURRENT QUESTION ONLY：合成现稿条件，请解释。',
        scoring: { method: 'manual', rubric: 'CURRENT RUBRIC ONLY', maxScore: 100, passScore: 90 },
      },
    ],
  };
  const markdown = `# ${LABEL}\n\n明确本地软件呈现夹具。\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify(quiz)}\n\x60\x60\x60\n`;
  const version = getAssessmentDocumentVersion(markdown);
  assert.equal(parseAssessmentMarkdown(markdown).questions.length, 1);
  return {
    quiz,
    version,
    node: {
      id: POINT,
      title: LABEL,
      markdown,
      documentVersion: version,
      hasDocument: true,
      sections: { basicInfoMarkdown: '知识点层级：核心', knowledgeMarkdown: markdown },
    },
    context: {
      slug: 'signals',
      course_id: 1,
      course_name: LABEL,
      node_id: POINT,
      title: LABEL,
      document_markdown: markdown,
      knowledge_markdown: markdown,
      basic_info_markdown: '知识点层级：核心',
      is_active: 1,
    },
  };
}

function seed(preview, data) {
  const definitions = [
    {
      id: '1',
      kind: 'old-body',
      document: 'e'.repeat(64),
      question: data.quiz.version,
      max: 5,
      pass: 3,
    },
    {
      id: '2',
      kind: 'old-question',
      document: data.version,
      question: 'fixture-old-question',
      max: 8,
      pass: 4,
    },
    {
      id: '3',
      kind: 'current-zero',
      document: data.version,
      question: data.quiz.version,
      max: 0,
      pass: 0,
    },
    { id: '4', kind: 'missing-version', document: null, question: null, max: 7, pass: 2 },
  ];
  for (const item of definitions) {
    const snapshot = item.question
      ? {
          id: QUESTION,
          type: 'short_answer',
          prompt: `SAVED ${item.kind} PROMPT：只适用提交时的合成条件。`,
          questionVersion: item.question,
        }
      : {};
    preview.assessmentStore.rows.push({
      id: item.id,
      user_id: 1,
      course_id: 1,
      node_id: POINT,
      question_id: QUESTION,
      question_version: item.question,
      document_version: item.document,
      question_snapshot: JSON.stringify(snapshot),
      answer_json: JSON.stringify(`Explicit saved ${item.kind} answer`),
      status: 'pending_review',
      verdict: null,
      is_official: 1,
      score: null,
      max_score: item.max,
      pass_score: item.pass,
      feedback: '',
      grading_basis: `SAVED ${item.kind} RUBRIC`,
      reference_markdown: `SAVED ${item.kind} REFERENCE`,
      request_key: crypto.randomUUID(),
      reviewed_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return definitions;
}

async function click(page, selector, text) {
  const handles = await page.$$(selector);
  try {
    let target = handles[0];
    if (text) {
      target = null;
      for (const handle of handles)
        if ((await handle.evaluate((item) => item.textContent.trim())).includes(text)) {
          target = handle;
          break;
        }
    }
    assert.ok(target, `Missing actual DOM control: ${selector} ${text || ''}`);
    const deadline = Date.now() + 10000;
    let observation;
    while (Date.now() < deadline) {
      observation = await target.evaluate((item) => {
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = item.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          reachable: rect.width > 0 && !item.disabled && (hit === item || item.contains(hit)),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          hit: hit?.outerHTML.slice(0, 300),
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
    throw new Error(
      `Actual click target remained obscured: ${selector} ${JSON.stringify(observation)}`,
    );
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function main() {
  const width = Number(process.env.LEARNING_QA_WIDTH || 1440);
  assert.ok(Number.isFinite(width) && width >= 320 && width <= 2560);
  const output =
    process.env.LEARNING_REVIEW_VERSION_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-review-version-'));
  fs.mkdirSync(output, { recursive: true });
  const data = fixture();
  const preview = createLearningPreview({
    mapNodes: [data.node],
    mapEdges: [],
    contextRows: [data.context],
  });
  const definitions = seed(preview, data);
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Real installed Chrome, production UI and registered HTTP routes against one explicit isolated memory course with four seeded synthetic pending rows. Native clicks only; no grading submission, real credentials/grades, MySQL, AI, external network, IME or effectiveness claim. Seeded old-question-only row isolates label behavior even though ordinary course editing also changes the document hash. Missing thresholds are covered by DOM units, not fabricated as a real HTTP backend field here.',
    definitions,
    viewport: { width, height: width < 620 ? 844 : 1000 },
    cases: [],
    screenshots: [],
    blockedExternal: [],
    blockedAI: [],
    pageErrors: [],
    assessmentWrites: [],
    cleanup: {},
  };
  let browser;
  let context;
  try {
    const selected = await listenAllowedLoopback(preview.server);
    report.portSelection = selected;
    const base = `http://127.0.0.1:${selected.port}`;
    // eslint-disable-next-line import/no-dynamic-require -- Explicit installed runtime supplied by the local test environment.
    const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE,
      headless: true,
      args: ['--no-sandbox', '--disable-background-networking'],
    });
    report.chrome = await browser.version();
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport(report.viewport);
    await page.setRequestInterception(true);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
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
          report.assessmentWrites.push({ path: url.pathname, method: request.method() });
        request.continue();
      }
    });
    const visit = async (as) => {
      await page.goto(`${base}/knowledge?course=signals&point=${POINT}&tool=feedback&as=${as}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      await page.waitForFunction(() => window.FreeBbsLearningAssessment?.getSnapshot().loaded);
      if (await page.$('.learning-start-dialog[open]')) await click(page, '.learning-start-exit');
      if (await page.$eval('#knowledge-chat-panel', (panel) => !panel.classList.contains('hidden')))
        await click(page, '#knowledge-chat-close');
      await click(page, '[data-knowledge-tool="feedback"]');
    };
    const observe = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#learning-quiz-results [data-attempt-id]')].map((card) => ({
          id: card.dataset.attemptId,
          summary: card.querySelector('summary').textContent,
          text: card.textContent,
          review: Boolean(card.querySelector('form')),
          scoreMax: card.querySelector('input[type="number"]')?.max,
          submitEnabled: card.querySelector('button[type="submit"]')
            ? !card.querySelector('button[type="submit"]').disabled
            : null,
        })),
      );
    const screenshot = async (name, selector) => {
      await page.$eval(selector, (item) =>
        item.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      const file = path.join(output, `${name}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
    };
    await visit('student');
    const student = await observe();
    assert.equal(student.length, 4);
    for (const id of ['1', '2'])
      assert.match(student.find((item) => item.id === id).summary, /历史版本待复核，结果不计本版/);
    assert.equal(student.find((item) => item.id === '3').summary, `${QUESTION} · 待课程组复核`);
    assert.match(student.find((item) => item.id === '4').summary, /提交时版本未完整记录/);
    assert.ok(student.every((item) => !item.review));
    assert.ok(
      student.every(
        (item) => item.text.includes('我的作答：') && !item.text.includes('学生作答：'),
      ),
    );
    report.cases.push({
      name: 'student-old-current-missing-versions',
      passed: true,
      cards: student,
    });
    await click(page, '#learning-quiz-results [data-attempt-id="1"] > summary');
    await screenshot('student-pending-versions', '#learning-quiz-results [data-attempt-id="1"]');
    await visit('manager');
    await click(page, '#learning-quiz-results > button', '查看待复核作答');
    await page.waitForSelector('.learning-quiz-review-form');
    const teacher = await observe();
    assert.equal(teacher.filter((item) => item.review).length, 4);
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll('.learning-quiz-review-form')].map((form) => {
        const card = form.closest('[data-attempt-id]');
        const rect = card.getBoundingClientRect();
        return {
          id: card.dataset.attemptId,
          left: rect.left,
          right: rect.right,
          width: card.clientWidth,
          scrollWidth: card.scrollWidth,
          controls: [...form.querySelectorAll('input, textarea, button')].map((control) => {
            const controlRect = control.getBoundingClientRect();
            return { left: controlRect.left, right: controlRect.right, width: controlRect.width };
          }),
        };
      }),
    }));
    assert.ok(
      layout.documentWidth <= layout.viewport + 1,
      'Review page does not overflow horizontally',
    );
    for (const card of layout.cards) {
      assert.ok(card.left >= -1 && card.right <= layout.viewport + 1);
      assert.ok(card.scrollWidth <= card.width + 1, `Review card ${card.id} contains its content`);
      assert.ok(
        card.controls.every(
          (control) =>
            control.width > 0 && control.left >= card.left - 1 && control.right <= card.right + 1,
        ),
      );
    }
    report.teacherLayout = layout;
    for (const item of definitions) {
      const card = teacher.find((entry) => entry.id === item.id && entry.review);
      assert.match(card.text, /学生作答：/);
      assert.doesNotMatch(card.text, /我的作答：/);
      assert.match(card.text, new RegExp(`满分 ${item.max} · 通过阈值 ${item.pass}`));
      assert.equal(card.scoreMax, String(item.max));
      assert.equal(card.submitEnabled, true, 'Missing snapshots are not automatically blocked');
      assert.doesNotMatch(
        card.text,
        /CURRENT QUESTION ONLY|CURRENT RUBRIC ONLY|满分 100|通过阈值 90/,
      );
      if (item.question) assert.match(card.text, new RegExp(`SAVED ${item.kind} PROMPT`));
      else {
        assert.match(card.text, /题干快照缺失/);
        assert.match(card.text, /提交时题目版本 未记录/);
      }
    }
    report.cases.push({
      name: 'teacher-saved-scoring-snapshot-and-missing-version',
      passed: true,
      cards: teacher,
    });
    await screenshot('teacher-old-body-scoring', '#learning-quiz-results [data-attempt-id="1"]');
    await screenshot('teacher-current-zero', '#learning-quiz-results [data-attempt-id="3"]');
    await screenshot('teacher-missing-version', '#learning-quiz-results [data-attempt-id="4"]');
    await visit('other');
    const other = await observe();
    assert.equal(other.length, 0);
    report.cases.push({
      name: 'other-student-sees-no-original-records',
      passed: true,
      cards: other,
    });
    assert.equal(report.assessmentWrites.length, 0);
    assert.equal(report.blockedAI.length, 0);
    assert.equal(report.blockedExternal.length, 0);
    assert.equal(report.pageErrors.length, 0);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    if (error.portSelection) report.portSelection = error.portSelection;
    process.exitCode = 1;
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
    const file = path.join(output, 'review-version-report.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: file,
          passed: report.passed,
          cases: report.cases.length,
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
