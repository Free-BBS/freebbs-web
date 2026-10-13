// Real Chrome acceptance of research and owner-scoped Max context. Accounts,
// research tasks, clocks and AI replies are isolated local QA fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PERSONAL = '[data-learning-research-personal]';
const ADMIN = '[data-learning-research-admin]';
const NOTE_TEXT = 'QA_OWNER_PRIVATE_NOTE：我不理解反转与平移的区别。';
const ANSWER_TEXT = 'QA_OWNER_PRIVATE_ANSWER：先反转输入，再平移并计算重叠区间。';
const FEEDBACK_TEXT = 'QA_PRIVATE_FEEDBACK：导航让我不知道接下来该做什么。<b>不是 HTML</b>';
const STUDY_TITLE = 'QA 平台学习支持与知识保持';
const PHASES = ['baseline', 'post', 'delayed', 'transfer'];

function studyDefinition() {
  return {
    title: STUDY_TITLE,
    description: '合成研究任务，仅用于验证数据流程，不是真实课程测量工具。',
    knowledgeTarget: '验证学习前后、知识保持和新情境应用的数据链。',
    comparability: 'QA 题目具有同一目标与题数；本示例未进行真实测量效度验证。',
    selectionNote: '隔离的本地 QA 账号，不代表平台用户。',
    questionVersion: 'qa-v1',
    phases: Object.fromEntries(
      PHASES.map((phase) => [
        phase,
        [
          {
            id: `Q-${phase}`,
            prompt: `QA ${phase}：本阶段的示例问题。`,
            options: [
              { id: 'a', label: '方案 A' },
              { id: 'b', label: '方案 B' },
            ],
            correctOption: ['baseline', 'transfer'].includes(phase) ? 'b' : 'a',
          },
        ],
      ]),
    ),
  };
}

async function click(page, selector) {
  await page.locator(selector).setTimeout(15000).click();
}

async function dismissOptionalTour(page) {
  if (await page.$('.max-tour[open]')) {
    await click(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
    await page.waitForFunction(() => !document.querySelector('.max-tour[open]'));
  }
}

async function clickSummary(page, host, text) {
  const summaries = await page.$$(`${host} summary`);
  for (const summary of summaries) {
    if ((await summary.evaluate((item) => item.textContent)).includes(text)) {
      const open = await summary.evaluate((item) => item.parentElement.open);
      if (!open) await summary.click();
      return;
    }
  }
  assert.fail(`Summary missing: ${text}`);
}

async function ownApi(page, route, options = {}) {
  return page.evaluate(
    async (value, init) => {
      const response = await fetch(`/api${value}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${window.freeBbsApp.userState.token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      return { status: response.status, data: await response.json() };
    },
    route,
    options,
  );
}

async function readyResearch(page, base, route, host = PERSONAL) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${host}:not([hidden]) [data-research-action="refresh"]`, {
    visible: true,
  });
  await page.waitForFunction(
    (selector) => {
      const panel = document.querySelector(selector);
      return (
        panel &&
        !panel.hidden &&
        !panel.querySelector('.learning-research-heading + [role="status"]')?.textContent
      );
    },
    {},
    host,
  );
}

async function selectProse(page, host) {
  const box = await page.evaluate((selector) => {
    const body = document.querySelector(selector);
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.parentElement.closest('p,li') || text.parentElement.closest('.katex')) continue;
      const start = text.textContent.search(/\S/);
      if (start < 0 || text.textContent.trim().length < 12) continue;
      text.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 10);
      const rect = [...range.getClientRects()].find((item) => item.width > 35);
      if (!rect) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!body.contains(hit)) continue;
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
    }
    return null;
  }, host);
  assert.ok(box, 'Published prose is visible and hit-testable');
  // The Range only measures text geometry; native pointer dragging selects it.
  await page.mouse.move(box.left + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.right - 1, box.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForSelector('#learning-annotation-toolbar:not([hidden])', { visible: true });
}

async function submitResearchStage(page, studyId, phase, answers, assistance) {
  const form = `[data-research-study="${studyId}"] [data-research-phase="${phase}"]`;
  await page.waitForSelector(form, { visible: true });
  for (const [question, answer] of Object.entries(answers))
    await click(page, `${form} input[name="research-${studyId}-${question}"][value="${answer}"]`);
  await page.select(`${form} select`, assistance);
  await click(page, `${form} [data-research-action="study-attempt"]`);
  await page.waitForFunction((selector) => !document.querySelector(selector), {}, form);
}

async function askMax(page, question) {
  const reply = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/ai/knowledge/chat' &&
      response.request().method() === 'POST',
  );
  await page.type('#knowledge-chat-input', question);
  await click(page, '#knowledge-chat-form button[type="submit"]');
  assert.equal((await reply).status(), 200);
  await page.waitForFunction(
    () => !document.querySelector('#knowledge-chat-form button[type="submit"]')?.disabled,
  );
}

async function companionGeometry(page) {
  return page.evaluate(() => {
    const sources = document.querySelector('[data-learning-companion-sources]');
    const thread = document.querySelector('#knowledge-chat-thread');
    const sourceBox = sources.getBoundingClientRect();
    const threadBox = thread.getBoundingClientRect();
    const overflow = getComputedStyle(sources).overflowY;
    // A scroll container clips its own children. With visible overflow, their
    // drawn boundary, not only the shrunken grid track, must clear the thread.
    const drawnBottom = ['auto', 'scroll', 'hidden', 'clip'].includes(overflow)
      ? sourceBox.bottom
      : Math.max(
          sourceBox.bottom,
          ...[...sources.querySelectorAll('*')]
            .filter((item) => item.getBoundingClientRect().height > 0)
            .map((item) => item.getBoundingClientRect().bottom),
        );
    return {
      overlap: drawnBottom > threadBox.top + 2,
      threadHeight: thread.clientHeight,
      sourceHeight: sources.clientHeight,
    };
  });
}

async function main() {
  // Import only when the integrated preview exists; running never contacts a
  // production database, external model or real account.
  const { createResearchPreview } = require('./preview-learning-research');
  // eslint-disable-next-line import/no-dynamic-require
  const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-research-browser-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Real HTML/JS/CSS, authenticated memory routers and native Chrome controls. Synthetic feedback, study definitions, accounts and explicitly controlled research clock only. Max is a local simulated reply using the trusted companion context; no external AI, production data or claim of pedagogical effectiveness. Private original text and answers are omitted from this report.',
    checks: [],
    screenshots: [],
    pageErrors: [],
    requests: [],
    blocked: [],
  };
  let scene = 'setup';
  const pass = (name, details = {}) => report.checks.push({ scene, name, pass: true, ...details });
  const lab = await createResearchPreview({ seed: false });
  report.portSelection = lab.portSelection;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const contexts = [];
  const makePage = async (size = { width: 1440, height: 1000 }, theme = 'light') => {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setViewport(size);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (value) => localStorage.setItem('free_bbs_theme_mode', value),
      theme,
    );
    page.on('pageerror', (error) => report.pageErrors.push({ scene, message: error.message }));
    page.on('dialog', (dialog) => dialog.accept());
    const fault = { feedbackOnce: false, joinOnce: false, analyticsFailure: false };
    const writes = [];
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      try {
        if (url.origin !== lab.base && !['data:', 'blob:'].includes(url.protocol)) {
          report.blocked.push(`${url.origin}${url.pathname}`);
          await request.abort('blockedbyclient');
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          report.requests.push({ scene, method: request.method(), path: url.pathname });
          if (request.method() !== 'GET')
            writes.push({
              path: url.pathname,
              method: request.method(),
              body: request.postData() ? JSON.parse(request.postData()) : null,
            });
        }
        if (
          fault.feedbackOnce &&
          request.method() === 'POST' &&
          url.pathname === '/api/learning/research/feedback'
        ) {
          fault.feedbackOnce = false;
          await request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'QA：反馈服务暂不可用' }),
          });
          return;
        }
        if (
          fault.joinOnce &&
          request.method() === 'POST' &&
          /^\/api\/learning\/research\/studies\/[^/]+\/join$/.test(url.pathname)
        ) {
          fault.joinOnce = false;
          await request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'QA：报名服务暂不可用' }),
          });
          return;
        }
        if (
          fault.analyticsFailure &&
          request.method() === 'GET' &&
          ['/api/learning-analytics/summary', '/api/learning-analytics/admin/overview'].includes(
            url.pathname,
          )
        ) {
          await request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'QA：所选时间范围加载失败' }),
          });
          return;
        }
        await request.continue();
      } catch (error) {
        report.pageErrors.push({ scene, message: `QA interception: ${error.message}` });
        if (!request.isInterceptResolutionHandled()) await request.abort();
      }
    });
    return { page, writes, fault };
  };
  try {
    scene = 'student-feedback';
    const student = await makePage();
    const { page } = student;
    await readyResearch(page, lab.base, '/profile?as=student#personal-learning-data');
    assert.equal(
      student.writes.filter((write) => write.path.includes('/learning/research')).length,
      0,
    );
    pass('Opening the profile does not enroll, submit feedback or contact Max');
    assert.equal((await ownApi(page, '/learning/research/admin')).status, 403);
    pass('Students cannot read administrator research summaries');
    await clickSummary(page, PERSONAL, '告诉我们');
    const form = `${PERSONAL} .learning-research-form form`;
    await page.select(`${form} select[name="module"]`, 'workbench');
    await page.select(`${form} select[name="purpose"]`, 'plan');
    await page.select(`${form} select[name="helpfulness"]`, '3');
    await click(page, `${form} input[name="barrier"][value="navigation"]`);
    await page.type(`${form} textarea[name="comment"]`, FEEDBACK_TEXT);
    await click(page, `${form} [data-research-action="feedback-submit"]`);
    assert.equal(
      student.writes.filter((write) => write.path.endsWith('/research/feedback')).length,
      0,
    );
    pass('Feedback requires an explicit voluntary confirmation');
    await click(page, `${form} input[name="consent"]`);
    student.fault.feedbackOnce = true;
    await click(page, `${form} [data-research-action="feedback-submit"]`);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent.includes('QA：'),
      {},
      `${form} [role="status"]`,
    );
    assert.equal(
      await page.$eval(`${form} textarea[name="comment"]`, (item) => item.value),
      FEEDBACK_TEXT,
    );
    await click(page, `${form} [data-research-action="feedback-submit"]`);
    await page.waitForFunction(
      (selector, text) => document.querySelector(selector)?.textContent.includes(text),
      {},
      PERSONAL,
      FEEDBACK_TEXT,
    );
    const feedbackWrites = student.writes.filter((write) =>
      write.path.endsWith('/research/feedback'),
    );
    assert.equal(feedbackWrites.length, 2);
    assert.equal(feedbackWrites[0].body.requestKey, feedbackWrites[1].body.requestKey);
    assert.equal(feedbackWrites[1].body.consent, true);
    await clickSummary(page, PERSONAL, '我提供的反馈');
    assert.equal(
      await page.$$eval(`${PERSONAL} .learning-research-quote b`, (items) => items.length),
      0,
    );
    pass(
      'Failed submission preserves the draft and idempotency key; successful feedback is text-safe and owner-readable',
    );

    scene = 'administrator-study-publication';
    const administrator = await makePage();
    await readyResearch(
      administrator.page,
      lab.base,
      '/adminusers?as=admin#admin-learning-data',
      ADMIN,
    );
    const aggregate = await ownApi(administrator.page, '/learning/research/admin');
    assert.equal(aggregate.status, 200);
    assert.doesNotMatch(
      JSON.stringify(aggregate.data),
      /QA_PRIVATE_FEEDBACK|QA_OWNER_PRIVATE_NOTE|comment|answers|userId|username/,
    );
    pass('Administrator research response contains aggregates, never private feedback or notes');
    await clickSummary(administrator.page, ADMIN, '发布一项');
    const create = `${ADMIN} .learning-research-form form`;
    const definition = studyDefinition();
    for (const [name, value] of Object.entries(definition)) {
      if (name !== 'phases') await administrator.page.type(`${create} [name="${name}"]`, value);
    }
    await click(administrator.page, `${create} input[name="module"][value="learning"]`);
    await click(administrator.page, `${create} input[name="module"][value="max"]`);
    for (const phase of PHASES)
      await administrator.page.type(
        `${create} textarea[name="${phase}"]`,
        JSON.stringify(definition.phases[phase]),
      );
    const publish = administrator.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/learning/research/studies' &&
        response.request().method() === 'POST',
    );
    await click(administrator.page, `${create} [data-research-action="study-create"]`);
    const published = await publish;
    assert.equal(published.status(), 201);
    const studyId = (await published.json()).study.id;
    assert.ok(studyId);
    pass('Administrator publishes four server-scored research phases through the actual form');

    scene = 'voluntary-four-stage-research';
    await click(page, `${PERSONAL} [data-research-action="refresh"]`);
    const study = `[data-research-study="${studyId}"]`;
    await page.waitForSelector(`${study} [data-research-action="study-join"]`, { visible: true });
    await page.select(`${study} select`, 'understand');
    await click(page, `${study} input[type="checkbox"]`);
    student.fault.joinOnce = true;
    await click(page, `${study} [data-research-action="study-join"]`);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent.includes('QA：报名'),
      {},
      study,
    );
    await page.select(`${study} select`, 'practice');
    await click(page, `${study} [data-research-action="study-join"]`);
    await page.waitForSelector(`${study} [data-research-phase="baseline"]`, { visible: true });
    const joinWrites = student.writes.filter((write) => write.path.endsWith(`/${studyId}/join`));
    assert.equal(joinWrites.length, 2);
    assert.notEqual(joinWrites[0].body.requestKey, joinWrites[1].body.requestKey);
    assert.equal(joinWrites[0].body.goal, 'understand');
    assert.equal(joinWrites[1].body.goal, 'practice');
    assert.equal(
      (await ownApi(page, '/learning/research/me')).data.enrollments.find(
        (item) => item.studyId === studyId,
      ).goal,
      'practice',
    );
    pass(
      'After an interrupted signup, the student can change goals and submit a fresh valid request',
    );
    const baselineTask = (await ownApi(page, '/learning/research/studies')).data.studies.find(
      (item) => item.id === studyId,
    );
    assert.equal(baselineTask.nextPhase, 'baseline');
    assert.equal(baselineTask.questions.length, 1);
    assert.doesNotMatch(
      JSON.stringify(baselineTask),
      /correctOption|QA post：|QA delayed：|QA transfer：/,
    );
    pass('Participant receives only the current stage, never correct options or future task text');
    assert.ok(Array.isArray(lab.learning.assessmentStore.rows));
    assert.ok(Array.isArray(lab.learning.starsStore.rows));
    const beforeFormal = lab.learning.assessmentStore.rows.length;
    const beforeStars = lab.learning.starsStore.rows.length;
    await submitResearchStage(page, studyId, 'baseline', { 'Q-baseline': 'a' }, 'none');
    await submitResearchStage(page, studyId, 'post', { 'Q-post': 'a' }, 'max');
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent.includes('后开放'),
      {},
      study,
    );
    assert.equal(await page.$(`${study} [data-research-action="study-attempt"]`), null);
    const premature = await ownApi(page, `/learning/research/studies/${studyId}/attempts`, {
      method: 'POST',
      body: JSON.stringify({
        requestKey: randomUUID(),
        phase: 'delayed',
        answers: { 'Q-delayed': 'a' },
        assistance: 'none',
      }),
    });
    assert.equal(premature.status, 409);
    const own = (await ownApi(page, '/learning/research/me')).data.enrollments.find(
      (item) => item.studyId === studyId,
    );
    assert.equal(own.attempts.find((item) => item.phase === 'baseline').score, 0);
    assert.equal(own.attempts.find((item) => item.phase === 'post').score, 1);
    assert.equal(own.attempts.find((item) => item.phase === 'post').assistance, 'max');
    await readyResearch(
      administrator.page,
      lab.base,
      '/adminusers?as=admin#admin-platform-research',
      ADMIN,
    );
    const preDue = (await ownApi(administrator.page, '/learning/research/admin')).data.studies
      .find((item) => item.id === studyId)
      .stages.find((item) => item.phase === 'delayed');
    assert.equal(preDue.missingCount, 1);
    assert.equal(preDue.eligibility.notYetDueCount, 1);
    assert.equal(preDue.eligibility.awaitingSubmissionCount, 0);
    let checkedEligibility = false;
    for (const card of await administrator.page.$$(`${ADMIN} .learning-research-card`)) {
      if ((await card.$eval('h4', (element) => element.textContent)) !== STUDY_TITLE) continue;
      for (const summary of await card.$$('summary')) {
        if ((await summary.evaluate((element) => element.textContent)) !== '本期参与者的未提交情况')
          continue;
        await summary.click();
        const text = await summary.evaluate((element) => element.parentElement.textContent);
        assert.match(text, /未到时间|未到开放时间/);
        assert.match(text, /前置未完成|前置任务未完成/);
        checkedEligibility = true;
      }
    }
    assert.equal(checkedEligibility, true, 'The intended study has a readable eligibility table');
    pass(
      'The administrator can distinguish a future delayed assessment from an already eligible missing submission',
    );
    pass(
      'Server scores actual submitted choices and preserves self-reported help; delayed stage enforces its wait',
    );
    assert.equal(
      typeof lab.advance,
      'function',
      'QA preview must expose an explicit synthetic research clock',
    );
    lab.advance(25 * 3600000);
    const due = (await ownApi(administrator.page, '/learning/research/admin')).data.studies
      .find((item) => item.id === studyId)
      .stages.find((item) => item.phase === 'delayed');
    assert.equal(due.eligibility.notYetDueCount, 0);
    assert.equal(due.eligibility.awaitingSubmissionCount, 1);
    await click(page, `${PERSONAL} [data-research-action="refresh"]`);
    await submitResearchStage(page, studyId, 'delayed', { 'Q-delayed': 'a' }, 'none');
    await submitResearchStage(page, studyId, 'transfer', { 'Q-transfer': 'b' }, 'none');
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent.includes('阶段任务已完成'),
      {},
      study,
    );
    const completed = (await ownApi(page, '/learning/research/me')).data.enrollments.find(
      (item) => item.studyId === studyId,
    );
    assert.deepEqual(completed.attempts.map((attempt) => attempt.phase).sort(), [...PHASES].sort());
    assert.equal(lab.learning?.assessmentStore.rows.length, beforeFormal);
    assert.equal(lab.learning?.starsStore.rows.length, beforeStars);
    const stageWrites = student.writes.filter(
      (write) => write.path.endsWith('/attempts') && write.path.includes('/research/'),
    );
    assert.equal(
      stageWrites.every(
        (write) => !Object.hasOwn(write.body, 'score') && !Object.hasOwn(write.body, 'stars'),
      ),
      true,
    );
    pass(
      'Explicit QA clock opens delayed review and transfer; research never modifies formal scores or stars',
    );
    await click(administrator.page, `${ADMIN} [data-research-action="refresh"]`);
    const measured = (
      await ownApi(administrator.page, '/learning/research/admin')
    ).data.studies.find((item) => item.id === studyId);
    assert.equal(measured.paired.pairCount, 1);
    assert.equal(measured.paired.assistedPairCount, 1);
    assert.equal(measured.paired.independentPairCount, 0);
    assert.equal(measured.paired.meanChange, null);
    assert.equal(measured.paired.suppressed, true);
    assert.match(
      await administrator.page.$eval(ADMIN, (item) => item.textContent),
      /不是平台造成提升的因果证明/,
    );
    pass(
      'Administrator sees paired stage evidence, assisted-vs-independent declarations and small-sample suppression, not causal claims',
    );

    scene = 'research-deletion-and-owner-boundaries';
    await click(page, `${study} [data-research-action="study-withdraw"]`);
    await page.waitForSelector(`${study} [data-research-action="study-join"]`, { visible: true });
    assert.equal(
      (await ownApi(page, '/learning/research/me')).data.enrollments.some(
        (item) => item.studyId === studyId,
      ),
      false,
    );
    assert.equal(
      lab.researchStore.state.attempts.some(
        (item) => item.studyId === studyId && String(item.userId) === '1',
      ),
      false,
    );
    pass('Withdrawing removes the owner enrollment and all associated research attempts');
    await clickSummary(page, PERSONAL, '我提供的反馈');
    const beforeDelete = (await ownApi(administrator.page, '/learning/research/admin')).data
      .feedback.responseCount;
    await click(page, `${PERSONAL} [data-research-action="feedback-delete"]`);
    await page.waitForFunction(
      (selector, text) => !document.querySelector(selector)?.textContent.includes(text),
      {},
      PERSONAL,
      FEEDBACK_TEXT,
    );
    assert.equal(
      (await ownApi(administrator.page, '/learning/research/admin')).data.feedback.responseCount,
      beforeDelete - 1,
    );
    pass('Deleting owner feedback removes it from subsequent strategic aggregate results');
    const other = await makePage();
    await readyResearch(other.page, lab.base, '/profile?as=other#personal-platform-research');
    assert.equal((await ownApi(other.page, '/learning/research/me')).data.feedback.length, 0);
    assert.doesNotMatch(
      await other.page.$eval(PERSONAL, (item) => item.textContent),
      /QA_PRIVATE_FEEDBACK/,
    );
    pass('A different synthetic user has a separate personal research view');

    scene = 'analytics-window-failure-recovery';
    for (const [target, host] of [
      [student, '#personal-learning-data'],
      [administrator, '#admin-learning-data'],
    ]) {
      await target.page.waitForFunction(
        (selector) =>
          document.querySelector(`${selector} .learning-data-body`)?.childElementCount > 0,
        {},
        host,
      );
      target.fault.analyticsFailure = true;
      await target.page.select(`${host} select`, '7');
      await target.page.waitForFunction(
        (selector) =>
          document.querySelector(`${selector} [role="status"]`)?.textContent.includes('QA：'),
        {},
        host,
      );
      assert.equal(
        await target.page.$eval(
          `${host} .learning-data-body`,
          (element) => element.childElementCount,
        ),
        0,
      );
      target.fault.analyticsFailure = false;
      await click(target.page, `${host} .learning-data-refresh`);
      await target.page.waitForFunction(
        (selector) =>
          document.querySelector(`${selector} .learning-data-body`)?.childElementCount > 0,
        {},
        host,
      );
      assert.equal(await target.page.$eval(`${host} select`, (element) => element.value), '7');
      pass(`${host}: a failed period change clears stale data and recovers the selected window`);
    }

    scene = 'saved-owner-content-to-Max';
    await page.goto(`${lab.base}/knowledge?course=signals&point=SS-02-01&view=reading&as=student`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 4,
    );
    await page.waitForSelector('#knowledge-body > p', { visible: true });
    // This research QA account is new to the knowledge page. Dismiss the
    // existing optional global tour through its real control before testing
    // controls underneath the modal; do not modify persisted tour state.
    await dismissOptionalTour(page);
    const beforeChat = lab.requests.length;
    await clickSummary(page, '[data-learning-companion-sources]', 'Max 的参考资料');
    await page.waitForFunction(() =>
      document.querySelector('[data-companion-source-status]')?.textContent.includes('笔记 0'),
    );
    assert.equal(lab.requests.length, beforeChat);
    const emptySources = await ownApi(
      page,
      '/learning-companion/sources?course=signals&point=SS-02-01',
    );
    assert.equal(emptySources.status, 200);
    assert.equal(emptySources.data.sources.sources.length, 0);
    await askMax(page, '给我一个整理基本原理的提示。');
    await page.waitForFunction(() =>
      document.getElementById('knowledge-chat-thread')?.textContent.includes('本地模拟回答'),
    );
    await click(page, '.learning-save-answer');
    await page.waitForSelector('#learning-note-dialog[open]', { visible: true });
    for (const [selector, value] of [
      ['#learning-note-form [name="title"]', 'QA 本人的疑问笔记'],
      ['#learning-note-form [name="content"]', NOTE_TEXT],
    ]) {
      await page.click(selector);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.type(selector, value);
    }
    await click(page, '#learning-note-form button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#learning-note-dialog[open]'));
    const saved = lab.learning.store.rows.find(
      (row) => row.content === NOTE_TEXT && row.user === 1,
    );
    assert.ok(saved, 'The actual private note form persists its saved content');
    await click(page, '#knowledge-chat-close');
    await click(page, '#knowledge-reading [data-learning-go="notes"]');
    await selectProse(page, '#knowledge-body');
    await click(page, '[data-annotation-action="highlight"]');
    await page.waitForSelector('#knowledge-body [data-private-annotation]');
    const annotationRecord = lab.learning.store.rows.find(
      (row) => row.user === 1 && row.annotation,
    );
    assert.ok(annotationRecord?.annotation.anchor.documentVersion);
    await click(page, '[data-knowledge-tool="feedback"]');
    await click(page, '#learning-quiz-tabs [data-quiz-view="practice"]');
    await page.select('.learning-quiz-filters select[aria-label="练习难度"]', 'basic');
    await click(page, '[data-question-id="SS-02-01-Q01"] input[value="A"]');
    await click(page, '[data-question-id="SS-02-01-Q01"] button[type="submit"]');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q01' && !item.official,
      ),
    );
    await click(page, '#learning-quiz-tabs [data-quiz-view="quick"]');
    await page.type('[data-question-id="SS-02-01-Q05"] textarea', ANSWER_TEXT);
    await click(page, '[data-question-id="SS-02-01-Q05"] button[type="submit"]');
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
        (item) => item.questionId === 'SS-02-01-Q05' && item.status === 'pending_review',
      ),
    );
    assert.equal(lab.learning.starsStore.rows.length, 0);
    await click(page, '#knowledge-chat-toggle');
    await page.waitForSelector('#knowledge-chat-input', { visible: true });
    await click(page, '[data-companion-source-refresh]');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-companion-source-status]')?.textContent.includes('笔记 1') &&
        document.querySelector('[data-companion-source-status]')?.textContent.includes('批注 1') &&
        document.querySelector('[data-companion-source-status]')?.textContent.includes('作答 2'),
    );
    const sourceManifest = (
      await ownApi(page, '/learning-companion/sources?course=signals&point=SS-02-01')
    ).data.sources;
    assert.equal(sourceManifest.counts.note, 1);
    assert.equal(sourceManifest.counts.annotation, 1);
    assert.equal(sourceManifest.counts.attempt, 2);
    assert.doesNotMatch(
      JSON.stringify(sourceManifest),
      /QA_OWNER_PRIVATE_NOTE|QA_OWNER_PRIVATE_ANSWER|quote|answer|content/,
    );
    pass(
      'Native saved note and highlight appear in an owner-only metadata manifest without duplicating private text',
    );
    const unrelated = {
      ...saved,
      id: '99999',
      user: 2,
      content: 'QA_OTHER_PRIVATE_NOTE',
      key: randomUUID(),
    };
    lab.learning.store.rows.push(unrelated);
    await askMax(page, '结合我保存的疑问，建议先理解哪一步？');
    await page.waitForFunction(() =>
      document.getElementById('knowledge-chat-thread')?.textContent.includes('模拟服务已接收'),
    );
    const trusted = lab.requests.at(-1).trustedCompanionContext;
    assert.equal(trusted.knowledgePointId, 'SS-02-01');
    assert.match(JSON.stringify(trusted.personalLearningContent), /QA_OWNER_PRIVATE_NOTE/);
    assert.match(JSON.stringify(trusted.personalLearningContent), /QA_OWNER_PRIVATE_ANSWER/);
    assert.doesNotMatch(JSON.stringify(trusted), /QA_OTHER_PRIVATE_NOTE/);
    assert.equal(
      trusted.personalLearningContent.records.filter((item) => item.source === 'annotation').length,
      1,
    );
    assert.equal(
      trusted.personalLearningContent.records.filter((item) => item.source === 'attempt').length,
      2,
    );
    const pending = trusted.personalLearningContent.records.find(
      (item) => item.source === 'attempt' && item.questionId === 'SS-02-01-Q05',
    );
    assert.equal(pending.status, 'pending_review');
    assert.doesNotMatch(
      JSON.stringify(trusted.personalLearningContent),
      /correctOption|correctAnswer|scoring|referenceAnswer|questionSnapshot/,
    );
    pass(
      'Actual chat submission forwards saved owner content through server-trusted context and excludes another owner',
    );
    pass(
      'Actual practice and pending formal answer are available to Max without trusted grading or answer keys',
    );
    const sourceGeometry = await companionGeometry(page);
    assert.equal(sourceGeometry.overlap, false, 'Expanded source details must not cover chat');
    assert.ok(sourceGeometry.threadHeight >= 100, 'Source details preserve space for chat');
    pass('Expanded saved-source details remain separate from a usable chat thread');
    const maxImage = path.join(output, 'desktop-light-Max-sources.png');
    await page.screenshot({ path: maxImage });
    report.screenshots.push(maxImage);
    const removed = await ownApi(page, `/learning/signals/SS-02-01/entries/${saved.id}`, {
      method: 'DELETE',
    });
    assert.equal(removed.status, 200);
    await askMax(page, '再查看现在保存的资料。');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('#knowledge-chat-thread .knowledge-chat-message.is-assistant')
          .length >= count,
      {},
      4,
    );
    assert.doesNotMatch(
      JSON.stringify(lab.requests.at(-1).trustedCompanionContext.personalLearningContent),
      /QA_OWNER_PRIVATE_NOTE|QA_OTHER_PRIVATE_NOTE/,
    );
    assert.ok(lab.learning.store.rows.some((row) => row.id === annotationRecord.id));
    assert.doesNotMatch(
      JSON.stringify((await ownApi(administrator.page, '/learning/research/admin')).data),
      /QA_OWNER_PRIVATE_NOTE|QA_OTHER_PRIVATE_NOTE|QA_OWNER_PRIVATE_ANSWER/,
    );
    pass(
      'Deleted note is absent from the next freshly loaded Max context while annotations remain; strategic summaries never include either private text',
    );

    scene = 'responsive-light-dark-layout';
    for (const dimensions of [
      { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
      { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
      { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
      { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
    ]) {
      const matrix = await makePage(
        { width: dimensions.width, height: dimensions.height },
        dimensions.theme,
      );
      for (const target of [
        {
          route: '/profile?as=student#personal-platform-research',
          host: PERSONAL,
          name: 'personal',
        },
        { route: '/adminusers?as=admin#admin-platform-research', host: ADMIN, name: 'strategic' },
      ]) {
        await readyResearch(matrix.page, lab.base, target.route, target.host);
        await matrix.page.$eval(target.host, (element) =>
          element.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        const geometry = await matrix.page.$eval(target.host, (element) => {
          const rect = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll('button,select,textarea,input')].filter(
            (item) =>
              item.getBoundingClientRect().width > 0 && !item.closest('details:not([open])'),
          );
          return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: window.innerWidth,
            bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            controlsOutside: controls.filter((item) => {
              const box = item.getBoundingClientRect();
              return box.left < rect.left - 2 || box.right > rect.right + 2;
            }).length,
          };
        });
        assert.ok(geometry.width > 0);
        assert.equal(
          geometry.bodyOverflow,
          false,
          `${dimensions.name} ${target.name} should not overflow the page`,
        );
        assert.equal(
          geometry.controlsOutside,
          0,
          `${dimensions.name} ${target.name} controls fit their panel`,
        );
        const image = path.join(output, `${dimensions.name}-${target.name}.png`);
        await matrix.page.screenshot({ path: image });
        report.screenshots.push(image);
      }
      pass(
        `${dimensions.name}: personal and strategic panels fit the viewport with local table scrolling`,
      );
      scene = `${dimensions.name}-Max-expanded-sources`;
      await matrix.page.goto(
        `${lab.base}/knowledge?course=signals&point=SS-02-01&view=reading&as=student`,
        { waitUntil: 'domcontentloaded' },
      );
      await matrix.page.waitForFunction(
        () => window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 4,
      );
      await dismissOptionalTour(matrix.page);
      if (
        await matrix.page.$eval('#knowledge-chat-panel', (element) =>
          element.classList.contains('hidden'),
        )
      )
        await click(matrix.page, '#knowledge-chat-toggle');
      await matrix.page.waitForSelector('#knowledge-chat-input', { visible: true });
      await clickSummary(matrix.page, '[data-learning-companion-sources]', 'Max 的参考资料');
      await matrix.page.waitForFunction(() =>
        document.querySelector('[data-companion-source-status]')?.textContent.includes('作答 2'),
      );
      await askMax(matrix.page, '按现在保存的资料给我一个简短的下一步。');
      const companionLayout = await companionGeometry(matrix.page);
      assert.equal(companionLayout.overlap, false, `${dimensions.name} sources never cover chat`);
      assert.ok(companionLayout.threadHeight >= 100, `${dimensions.name} keeps usable chat height`);
      const chatDisplay = await matrix.page.$eval('#knowledge-chat-thread', (element) => {
        const thread = element.getBoundingClientRect();
        const reply = element.querySelector('.knowledge-chat-message.is-assistant:last-child');
        const bubble = reply.getBoundingClientRect();
        return {
          scrollable: ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
          latestVisible: bubble.bottom > thread.top && bubble.top < thread.bottom,
        };
      });
      assert.equal(chatDisplay.scrollable, true);
      assert.equal(chatDisplay.latestVisible, true);
      const companionImage = path.join(output, `${dimensions.name}-Max-sources.png`);
      await matrix.page.screenshot({ path: companionImage });
      report.screenshots.push(companionImage);
      pass(
        `${dimensions.name}: expanded sources and latest reply remain separate and locally scrollable`,
      );
    }
    assert.equal(report.pageErrors.length, 0, JSON.stringify(report.pageErrors));
    report.passed = true;
  } catch (error) {
    report.checks.push({ scene, name: error.message, pass: false });
    report.passed = false;
    process.exitCode = 1;
    console.error(error.stack);
    try {
      const pages = await browser.pages();
      for (const [index, page] of pages.entries()) {
        const filename = path.join(output, `failure-${index}.png`);
        await page.screenshot({ path: filename });
        report.screenshots.push(filename);
      }
    } catch {
      /* Preserve the original test failure even if screenshot capture fails. */
    }
  } finally {
    await browser.close();
    lab.server.closeAllConnections?.();
    await new Promise((resolve) => {
      lab.server.close(resolve);
    });
    const filename = path.join(output, 'learning-research-report.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          checks: report.checks.filter((item) => item.pass).length,
          screenshots: report.screenshots.length,
          report: filename,
        },
        null,
        2,
      ),
    );
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
module.exports = { main, readyResearch, selectProse, submitResearchStage };
