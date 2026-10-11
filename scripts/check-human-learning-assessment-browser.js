/* eslint-disable no-underscore-dangle */
// Real Chrome DOM + loopback-only memory routers. Every question/record is a QA fixture,
// not a formal course material, learning-effectiveness measure or real student grade.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { createCourseRelationsMap } = require('./fixtures/course-relations-map');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');

const POINT = 'SS-01-01';
const Q = { single: 'QA-single', multiple: 'QA-multiple', numeric: 'QA-numeric', text: 'QA-text' };
const card = (id) => `.learning-quiz-card[data-question-id="${id}"]`;
const textInput = `${card(Q.text)} textarea`;
const numberInput = `${card(Q.numeric)} input`;
const reviewCard = (id) => `.learning-quiz-result[data-attempt-id="${id}"]`;
const reviewForms = '.learning-quiz-review-form';
const rotatedToken = 'learning-preview-student-rotated-fixture';

function quizFixture() {
  const choice = [
    { id: 'A', text: '测试选项：线性叠加' },
    { id: 'B', text: '测试选项：移位响应' },
    { id: 'C', text: '测试选项：无条件复制' },
  ];
  return {
    schemaVersion: 1,
    status: 'published',
    version: 'qa-v1',
    source: '本地浏览器验收夹具，不是正式课程材料',
    reviewedBy: '本地测试流程，不代表课程审批',
    questions: [
      {
        id: Q.single,
        type: 'single_choice',
        prompt: '夹具单选题：请选择一项。',
        options: choice,
        scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
      },
      {
        id: Q.multiple,
        type: 'multiple_choice',
        prompt: '夹具多选题：请选择全部符合项。',
        options: choice,
        scoring: { method: 'exact', answer: ['A', 'B'], maxScore: 2, passScore: 2 },
      },
      {
        id: Q.numeric,
        type: 'numeric',
        prompt: '夹具数值题：写出数值。',
        scoring: {
          method: 'numeric',
          target: 12.5,
          absoluteTolerance: 0.01,
          relativeTolerance: 0,
          maxScore: 1,
          passScore: 1,
        },
      },
      {
        id: Q.text,
        type: 'short_answer',
        prompt: '夹具简答题：解释自己的思路。',
        scoring: {
          method: 'manual',
          rubric: '本地夹具：核对思路与条件，不代表正式评价。',
          maxScore: 3,
          passScore: 2,
        },
      },
    ],
  };
}

async function click(page, selector) {
  await page.bringToFront();
  await page.waitForSelector(selector, { visible: true });
  // The workspace scrolls its own reader after a tool change. Re-check actual
  // hit testing after that transition instead of trusting one early scroll.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const unobscured = await page.$eval(selector, (item) => {
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = item?.getBoundingClientRect();
      if (!rect) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return item === hit || item.contains(hit);
    });
    if (unobscured) {
      await page.click(selector);
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`Real DOM target stayed obscured: ${selector}`);
}
async function fill(page, selector, answer) {
  await click(page, selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (answer) await page.keyboard.type(answer);
}
async function value(page, selector) {
  return page.$eval(selector, (item) => item.value);
}
async function waitLoaded(page) {
  await page.waitForFunction(
    () => window.FreeBbsLearningAssessment?.getSnapshot()?.loaded === true,
  );
  await page.waitForSelector(card(Q.text));
  await page.waitForFunction(() =>
    sessionStorage.getItem('free_bbs_learning_answer_drafts_v1:owner'),
  );
}
async function waitDraft(page, answer) {
  await page.waitForFunction(
    (expected) =>
      Object.keys(sessionStorage).some((key) => {
        if (!key.startsWith('free_bbs_learning_answer_drafts_v1:') || key.endsWith(':owner'))
          return false;
        try {
          return Object.values(JSON.parse(sessionStorage.getItem(key)).entries).some(
            (entry) => JSON.stringify(entry.answer) === JSON.stringify(expected),
          );
        } catch {
          return false;
        }
      }),
    {},
    answer,
  );
}
async function confirmStart(page) {
  if (await page.$('.learning-start-dialog[open]')) {
    await page.select('[data-learning-start-choice="level"]', 'familiar');
    await click(page, '.learning-start-dialog[open] .learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
  }
}

async function main() {
  const fixture = createCourseRelationsMap({ pointsPerChapter: 2 });
  const node = fixture.nodes.find((item) => item.id === POINT);
  const quiz = quizFixture();
  const preview = createLearningPreview({ mapNodes: fixture.nodes, mapEdges: fixture.edges });
  const context = preview.assessmentStore.contexts.find((item) => item.node_id === POINT);
  const updateDocument = (body = '本地四题型验收正文，不是正式教材。') => {
    const markdown = `# 浏览器验收夹具\n\n${body}\n\n\`\`\`freebbs-quiz\n${JSON.stringify(quiz)}\n\`\`\`\n`;
    Object.assign(node, { markdown, documentVersion: getAssessmentDocumentVersion(markdown) });
    node.sections.knowledgeMarkdown = markdown;
    Object.assign(context, { document_markdown: markdown, knowledge_markdown: markdown });
  };
  updateDocument();
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-human-assessment-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    fixture:
      'Loopback memory backend; synthetic QA questions and attempts; no production users/grades, no external network or real AI.',
    base,
    output,
    startedAt: new Date().toISOString(),
    passed: [],
    screenshots: [],
    pageErrors: [],
    attemptRequests: [],
    reviewRequests: [],
    blockedExternal: [],
    dialogs: [],
    simulationBoundaries: [
      'Version changes mutate this process-only fixture document.',
      'Same-uid token rotation uses the app identity-updated notification and a loopback fixture authorization alias.',
      '51+ pending rows are synthetic memory-store records, not course achievement evidence.',
    ],
  };
  let browser;
  let failedPosts = 0;
  let failReviewMore = false;
  let heldReview = null;
  let holdReviewMore = false;
  const pages = [];
  const screenshot = async (page, name) => {
    await page.bringToFront();
    const filename = path.join(output, `${name}.png`);
    await page.screenshot({ path: filename, fullPage: false });
    report.screenshots.push(filename);
  };
  const newPage = async () => {
    const page = await browser.newPage();
    const originalWait = page.waitForFunction.bind(page);
    page.waitForFunction = (fn, options, ...args) =>
      originalWait(fn, { polling: 100, timeout: 10000, ...options }, ...args);
    pages.push(page);
    await page.setViewport({ width: 1440, height: 960 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      report.dialogs.push(dialog.type());
      await dialog.accept();
    });
    await page.evaluateOnNewDocument(() => {
      window.__qaTaskFocus = [];
      window.__qaOpenInteraction = [];
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
        const root = document.querySelector('[data-knowledge-page]');
        root?.addEventListener('knowledge:task-focus', (event) =>
          window.__qaTaskFocus.push(event.detail),
        );
        root?.addEventListener('knowledge:open-interaction', (event) =>
          window.__qaOpenInteraction.push(event.detail),
        );
      });
    });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== base) {
        report.blockedExternal.push(`${url.origin}${url.pathname}`);
        return request.respond({ status: 403, body: 'External services disabled in QA' });
      }
      if (url.pathname.endsWith('/attempts') && request.method() === 'POST') {
        const payload = JSON.parse(request.postData());
        report.attemptRequests.push(payload);
        if (failedPosts > 0) {
          failedPosts -= 1;
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: '本地夹具模拟提交失败' }),
          });
        }
      }
      if (url.searchParams.get('review') === 'pending') {
        report.reviewRequests.push({
          before: url.searchParams.get('before'),
          tokenScope:
            request.headers().authorization === 'Bearer learning-preview-manager'
              ? 'manager'
              : 'other',
        });
        if (url.searchParams.has('before') && holdReviewMore) {
          holdReviewMore = false;
          heldReview = request;
          return undefined;
        }
        if (url.searchParams.has('before') && failReviewMore) {
          failReviewMore = false;
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: '本地夹具模拟分页失败' }),
          });
        }
      }
      const headers = request.headers();
      if (headers.authorization === `Bearer ${rotatedToken}`)
        return request.continue({
          headers: { ...headers, authorization: 'Bearer learning-preview-student' },
        });
      return request.continue();
    });
    return page;
  };
  const visit = async (page, identity = 'student') => {
    await page.bringToFront();
    await page.goto(
      `${base}/knowledge?course=signals&point=${POINT}&tool=feedback&as=${identity}`,
      { waitUntil: 'networkidle0' },
    );
    await confirmStart(page);
    await waitLoaded(page);
    await click(page, '[data-knowledge-tool="feedback"]');
  };
  const reload = async (page) => {
    await page.bringToFront();
    await page.reload({ waitUntil: 'networkidle0' });
    await confirmStart(page);
    await waitLoaded(page);
    await click(page, '[data-knowledge-tool="feedback"]');
  };
  const pass = (name) => {
    report.passed.push(name);
    console.log(`PASS ${name}`);
  };
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 20000,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await newPage();
    await visit(page);
    assert.equal(await page.$$eval('.learning-quiz-card', (items) => items.length), 4);
    await click(page, `${card(Q.single)} input[value="B"]`);
    await click(page, `${card(Q.multiple)} input[value="A"]`);
    await click(page, `${card(Q.multiple)} input[value="B"]`);
    await fill(page, numberInput, '12.50');
    await fill(page, textInput, '未提交思路：先列条件，再解释响应叠加。');
    await waitDraft(page, '未提交思路：先列条件，再解释响应叠加。');
    await reload(page);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.learning-quiz-form .learning-form-status')].filter((item) =>
          item.textContent.startsWith('已恢复未提交作答'),
        ).length === 4,
    );
    assert.equal(
      await page.$eval(`${card(Q.single)} input[value="B"]`, (item) => item.checked),
      true,
    );
    assert.deepEqual(
      await page.$$eval(`${card(Q.multiple)} input:checked`, (items) =>
        items.map((item) => item.value),
      ),
      ['A', 'B'],
    );
    assert.equal(await value(page, numberInput), '12.50');
    assert.equal(await value(page, textInput), '未提交思路：先列条件，再解释响应叠加。');
    await screenshot(page, 'four-types-restored');
    pass('four question types restore after real refresh with visible recovery notices');

    await click(page, '[data-quiz-view="practice"]');
    assert.equal(await value(page, textInput), '');
    assert.equal(await value(page, numberInput), '');
    assert.equal(
      await page.$$eval('.learning-quiz-form input:checked', (items) => items.length),
      0,
    );
    await fill(page, textInput, '练习模式独立思路。');
    await waitDraft(page, '练习模式独立思路。');
    await click(page, '[data-quiz-view="quick"]');
    assert.equal(await value(page, textInput), '未提交思路：先列条件，再解释响应叠加。');
    await click(page, '[data-quiz-view="practice"]');
    assert.equal(await value(page, textInput), '练习模式独立思路。');
    await reload(page);
    await click(page, '[data-quiz-view="practice"]');
    assert.equal(await value(page, textInput), '练习模式独立思路。');
    pass('practice and official selftest remain separate in memory and after refresh');

    updateDocument('正文版本二：本地夹具修订，不是课程修订。');
    await reload(page);
    assert.equal(await value(page, textInput), '');
    assert.equal(await value(page, numberInput), '');
    await fill(page, textInput, '仅属于正文二版本的输入。');
    await waitDraft(page, '仅属于正文二版本的输入。');
    quiz.version = 'qa-v2';
    quiz.questions[3].prompt = '新版夹具题干：重新核对条件。';
    updateDocument('正文版本二：本地夹具修订，不是课程修订。');
    await reload(page);
    assert.equal(await value(page, textInput), '');
    pass('body and question version updates never silently migrate old draft answers');

    failedPosts = 2;
    await fill(page, numberInput, '12.5');
    await click(page, `${card(Q.numeric)} button[type="submit"]`);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-question-id="QA-numeric"] .learning-form-status')
        .textContent.includes('输入已保留'),
    );
    await reload(page);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-question-id="QA-numeric"] .learning-form-status')
        .textContent.includes('可核对后重试'),
    );
    await click(page, `${card(Q.numeric)} button[type="submit"]`);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-question-id="QA-numeric"] .learning-form-status')
        .textContent.includes('输入已保留'),
    );
    assert.deepEqual(
      report.attemptRequests[0],
      report.attemptRequests[1],
      'retry freezes full intent payload, including idempotency and version',
    );
    await fill(page, numberInput, '12.500');
    await click(page, `${card(Q.numeric)} button[type="submit"]`);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-question-id="QA-numeric"] .learning-form-status')
        .textContent.includes('本题通过'),
    );
    assert.notEqual(report.attemptRequests[2].requestKey, report.attemptRequests[1].requestKey);
    assert.equal(preview.assessmentStore.rows.length, 1);
    await reload(page);
    assert.equal(await value(page, numberInput), '');
    assert.equal(
      await page.$eval('.learning-quiz-result', (item) => item.open),
      false,
      'history answer is folded by default',
    );
    await screenshot(page, 'saved-no-resurrected-draft');
    pass(
      'failed submission retries frozen full payload; editing changes UUID; success cannot revive draft',
    );

    const focusBefore = await page.evaluate(() => window.__qaTaskFocus.length);
    await fill(page, textInput, '主动求助测试：我先确认线性假设。');
    const focus = await page.evaluate((start) => window.__qaTaskFocus.slice(start), focusBefore);
    assert.ok(focus.length > 0);
    for (const detail of focus)
      assert.deepEqual(Object.keys(detail).sort(), ['questionId', 'quizView', 'tool']);
    assert.equal(await page.evaluate(() => window.__qaOpenInteraction.length), 0);
    assert.equal(
      (
        await page.evaluate(
          () => window.freeBbsKnowledge.buildRequest('人工草稿').context.learningTask,
        )
      ).questionId,
      Q.text,
    );
    await click(page, `${card(Q.text)} .learning-quiz-ask-max`);
    await page.waitForFunction(() =>
      document.getElementById('knowledge-chat-input').value.includes('主动求助测试'),
    );
    assert.match(await value(page, '#knowledge-chat-input'), /QA-text/);
    assert.equal(preview.requests.length, 0);
    await screenshot(page, 'max-explicit-draft-only');
    await click(page, `${card(Q.single)} input[value="A"]`);
    await click(page, `${card(Q.single)} .learning-quiz-ask-max`);
    assert.match(await value(page, '#knowledge-chat-input'), /A\. 测试选项：线性叠加/);
    await click(page, `${card(Q.numeric)} .learning-quiz-ask-max`);
    assert.match(await value(page, '#knowledge-chat-input'), /还没开始作答/);
    await click(page, '[data-knowledge-tool="notes"]');
    const task = await page.evaluate(
      () => window.freeBbsKnowledge.buildRequest('人工草稿').context.learningTask,
    );
    assert.equal(task.tool, 'notes');
    assert.equal(task.questionId, undefined);
    assert.equal(preview.requests.length, 0);
    pass(
      'focus sends identity only; explicit text/choice/empty help fills Max without sending; other tool clears question',
    );

    const tab = await newPage();
    await visit(tab);
    assert.equal(
      await value(tab, textInput),
      '',
      'new tab does not inherit first tab sessionStorage',
    );
    await fill(tab, textInput, '第二标签页自己的未提交思路。');
    await waitDraft(tab, '第二标签页自己的未提交思路。');
    await click(page, '[data-knowledge-tool="feedback"]');
    assert.equal(await value(page, textInput), '主动求助测试：我先确认线性假设。');
    await visit(tab, 'other');
    assert.equal(await value(tab, textInput), '');
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('.learning-quiz-form textarea')].some((item) =>
          item.value.includes('主动求助测试'),
        ),
    );
    await visit(page, 'other');
    assert.equal(await value(page, textInput), '');
    await fill(page, textInput, '另一个账号的独立草稿。');
    await waitDraft(page, '另一个账号的独立草稿。');
    await visit(page, 'student');
    assert.equal(await value(page, textInput), '');
    await fill(page, textInput, '旧 token 不应跨会话恢复。');
    await waitDraft(page, '旧 token 不应跨会话恢复。');
    await page.evaluate(
      (user, token) =>
        window.dispatchEvent(
          new CustomEvent('freebbs:identity-updated', { detail: { user, token } }),
        ),
      users.student,
      rotatedToken,
    );
    await page.waitForFunction(
      () =>
        window.freeBbsApp.userState.token.endsWith('rotated-fixture') &&
        window.FreeBbsLearningAssessment.getSnapshot().loaded,
    );
    assert.equal(await value(page, textInput), '');
    await page.waitForFunction(() =>
      [...Object.keys(sessionStorage)]
        .filter(
          (key) => key.startsWith('free_bbs_learning_answer_drafts_v1:') && !key.endsWith(':owner'),
        )
        .every((key) => !sessionStorage.getItem(key).includes('旧 token')),
    );
    const storageKeys = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith('free_bbs_learning_answer_drafts_v1:'),
      ),
    );
    assert.ok(storageKeys.every((key) => !key.includes('learning-preview')));
    await reload(page);
    assert.equal(await value(page, textInput), '');
    await screenshot(page, 'account-session-isolation');
    pass(
      'fresh tabs isolate drafts; cross-tab account switch clears old input; same-uid token rotation rejects old owner',
    );
    await tab.close();
    await page.close();

    // Direct synthetic rows exercise the real memory-store route and sanitizer, not UI fake data.
    const documentVersion = getAssessmentDocumentVersion(context.document_markdown);
    for (let index = 0; index < 121; index += 1) {
      const id = String(preview.assessmentStore.rows.length + 1);
      const snapshot = {
        ...quiz.questions[3],
        questionVersion: `historical-${index}`,
        prompt: `历史夹具题干 ${index}：**当时条件** <script>window.__qaUnsafe=true</script>`,
        options: [
          { id: 'A', text: '历史选项 A' },
          { id: 'B', text: '历史选项 B' },
        ],
      };
      // Synthetic objective snapshots exercise option rendering; normal objective
      // submissions do not create pending-review records. No import system is implied.
      if (index % 2 === 0) snapshot.type = 'single_choice';
      preview.assessmentStore.rows.push({
        id,
        user_id: index % 2 ? 1 : 2,
        course_id: 1,
        node_id: POINT,
        question_id: Q.text,
        question_version: snapshot.questionVersion,
        document_version: documentVersion,
        question_snapshot: index === 0 ? null : JSON.stringify(snapshot),
        answer_json: JSON.stringify(`历史夹具作答 ${index}`),
        status: 'pending_review',
        verdict: 'pending',
        is_official: 1,
        score: null,
        max_score: 3,
        pass_score: 2,
        feedback: '',
        grading_basis: '历史夹具人工评分依据',
        reference_markdown: '历史夹具解析',
        request_key: crypto.randomUUID(),
        reviewed_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    const teacher = await newPage();
    await visit(teacher, 'manager');
    const head = '#learning-quiz-results > button:not(.learning-quiz-review-more)';
    await click(teacher, head);
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 50,
    );
    assert.match(
      await teacher.$eval('.learning-quiz-review-count', (item) => item.textContent),
      /已加载待复核 50 份/,
    );
    assert.doesNotMatch(
      await teacher.$eval('.learning-quiz-review-count', (item) => item.textContent),
      /共\s*121/,
    );
    assert.match(
      await teacher.$eval('.learning-quiz-review-prompt', (item) => item.textContent),
      /历史夹具题干 120/,
    );
    assert.doesNotMatch(
      await teacher.$eval('.learning-quiz-review-prompt', (item) => item.textContent),
      /新版夹具题干/,
    );
    assert.equal(await teacher.evaluate(() => window.__qaUnsafe), undefined);
    assert.match(
      await teacher.$eval('.learning-quiz-review-options', (item) => item.textContent),
      /历史选项 A/,
    );
    await screenshot(teacher, 'review-first-50-historical-snapshot');
    failReviewMore = true;
    await click(teacher, '.learning-quiz-review-more');
    await teacher.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('本地夹具模拟分页失败'),
    );
    assert.equal(await teacher.$$eval(reviewForms, (items) => items.length), 50);
    const failedCursor = report.reviewRequests.at(-1).before;
    await click(teacher, '.learning-quiz-review-more');
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 100,
    );
    assert.equal(report.reviewRequests.at(-1).before, failedCursor);
    const ids = await teacher.$$eval(`${reviewForms}`, (items) =>
      items.map((item) => item.closest('[data-attempt-id]').dataset.attemptId),
    );
    const a = ids[0];
    const b = ids[99];
    await fill(teacher, `${reviewCard(b)} input[type="number"]`, '0');
    await fill(teacher, `${reviewCard(b)} textarea`, 'B 的独立复核输入，应跨 A 保存保留。');
    await click(teacher, '.learning-quiz-review-more');
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 121,
    );
    const loadedIds = await teacher.$$eval(reviewForms, (items) =>
      items.map((item) => item.closest('[data-attempt-id]').dataset.attemptId),
    );
    assert.equal(new Set(loadedIds).size, 121);
    assert.equal(await teacher.$('.learning-quiz-review-more'), null);
    assert.match(
      await teacher.$eval(reviewCard('2'), (item) => item.textContent),
      /原作答题干快照缺失/,
    );
    assert.equal(
      await value(teacher, `${reviewCard(b)} textarea`),
      'B 的独立复核输入，应跨 A 保存保留。',
    );
    await fill(teacher, `${reviewCard(a)} input[type="number"]`, '3');
    await fill(teacher, `${reviewCard(a)} textarea`, 'A 的本地夹具复核说明。');
    await click(teacher, `${reviewCard(a)} button[type="submit"]`);
    await teacher.waitForFunction(
      (id) => !document.querySelector(`[data-attempt-id="${id}"] .learning-quiz-review-form`),
      {},
      a,
    );
    assert.equal(await value(teacher, `${reviewCard(b)} input[type="number"]`), '0');
    assert.equal(
      await value(teacher, `${reviewCard(b)} textarea`),
      'B 的独立复核输入，应跨 A 保存保留。',
    );
    await click(teacher, head);
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 50,
    );
    await click(teacher, '.learning-quiz-review-more');
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 100,
    );
    assert.equal(await value(teacher, `${reviewCard(b)} input[type="number"]`), '0');
    assert.equal(
      await value(teacher, `${reviewCard(b)} textarea`),
      'B 的独立复核输入，应跨 A 保存保留。',
    );
    await click(teacher, '.learning-quiz-review-more');
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 120,
    );
    await click(teacher, `${reviewCard(b)} textarea`);
    await screenshot(teacher, 'review-120-B-input-preserved');
    pass(
      '121 pending rows paginate 50/100/121 without invented total; retry keeps cursor; historical snapshot; A completion preserves B including zero score',
    );

    await click(teacher, head);
    await teacher.waitForFunction(
      () => document.querySelectorAll('.learning-quiz-review-form').length === 50,
    );
    holdReviewMore = true;
    await click(teacher, '.learning-quiz-review-more');
    const deadline = Date.now() + 5000;
    while (!heldReview && Date.now() < deadline)
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
    assert.ok(heldReview);
    await teacher.evaluate(
      (user) =>
        window.dispatchEvent(
          new CustomEvent('freebbs:identity-updated', {
            detail: { user, token: 'learning-preview-other' },
          }),
        ),
      users.other,
    );
    await teacher.waitForFunction(
      () =>
        window.freeBbsApp.userState.uid === 'u_learning02' &&
        !window.FreeBbsLearningAssessment.getSnapshot().canReview,
    );
    const lateResponse = teacher.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.searchParams.get('review') === 'pending' && url.searchParams.has('before');
    });
    await heldReview.continue();
    heldReview = null;
    await (await lateResponse).json();
    await teacher.waitForNetworkIdle({ idleTime: 300, timeout: 10000 });
    await teacher.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().loaded === true,
    );
    assert.equal(await teacher.$$eval(reviewForms, (items) => items.length), 0);
    await screenshot(teacher, 'review-late-response-account-isolation');
    pass('late pending page cannot restore teacher queue after account change');
    assert.equal(
      preview.requests.length,
      0,
      'all Max interactions remain drafts, not simulated or real model requests',
    );
    assert.deepEqual(report.pageErrors, []);
    report.aiRequests = preview.requests.length;
    report.syntheticPendingSeedCount = 121;
    report.finishedAt = new Date().toISOString();
    report.status = 'passed';
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.status = 'failed';
    report.failure = { message: error.message, stack: error.stack };
    for (const page of pages.filter((item) => !item.isClosed())) {
      try {
        await screenshot(page, `failure-${pages.indexOf(page)}`);
        report.failure.dom = await page.evaluate(() => ({
          tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
          quizStatus: document.getElementById('learning-quiz-status')?.textContent,
          forms: document.querySelectorAll('.learning-quiz-form').length,
          reviewForms: document.querySelectorAll('.learning-quiz-review-form').length,
          queue: document.querySelector('.learning-quiz-review-count')?.textContent,
        }));
      } catch {
        /* Preserve original test failure if a page has already navigated or closed. */
      }
    }
    throw error;
  } finally {
    report.finishedAt ||= new Date().toISOString();
    report.aiRequests = preview.requests.length;
    report.cleanup = { browserClosed: !browser, serverClosed: false };
    let cleanupError = null;
    try {
      if (heldReview) await heldReview.abort().catch(() => {});
      if (browser) await browser.close();
      report.cleanup.browserClosed = true;
    } catch (error) {
      cleanupError = error;
      report.status = 'failed';
      report.cleanup.error = error.message;
    } finally {
      preview.server.closeAllConnections();
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
      report.cleanup.serverClosed = !preview.server.listening;
    }
    fs.writeFileSync(
      path.join(output, 'assessment-browser-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          output,
          status: report.status,
          passed: report.passed,
          report: path.join(output, 'assessment-browser-report.json'),
        },
        null,
        2,
      ),
    );
    if (cleanupError) {
      console.error('Isolated preview cleanup failed:', cleanupError);
      process.exitCode = 1;
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
