// Explicit blank-document/term fixtures and simulated AI; production remains read-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const LABEL = '本地资料缺口夹具（非正式课程）';
const EXPECT_EMPTY_STATE_FIX = process.env.MATERIAL_GAP_FIX_EXPECTED !== '0';
function node(id, markdown, title = LABEL) {
  return {
    id,
    title,
    markdown,
    documentVersion: getAssessmentDocumentVersion(markdown),
    hasDocument: Boolean(markdown),
    sections: {
      knowledgeMarkdown: markdown,
      basicInfoMarkdown: '课程名称：本地夹具\n章节/单元：本地章节\n知识点层级：核心',
      applicationsMarkdown: '',
    },
  };
}
const nodes = [
  node('SS-01-00', `# ${LABEL}`),
  node('SS-01-01', ''),
  node(
    'SS-01-02',
    '# 本地条件查阅夹具\n\n夹具陌生术语是测试用标签，不是科学结论。\n\n## 使用条件\n\n此段仅用于检查查阅后直接离开，不产生学习完成或评分证据。',
  ),
  node(
    'SS-01-03',
    '# 本地作者同句夹具\n\n这个知识点的正文暂未提供。\n\n上句由夹具作者实际写入正文，测试不能按句子内容禁用原文评注。',
  ),
  node(
    'SS-01-04',
    `\`\`\`freebbs-quiz\n${JSON.stringify(
      {
        schemaVersion: 1,
        status: 'published',
        version: 'local-empty-body-v1',
        source: LABEL,
        reviewedBy: '本地夹具复核者',
        questions: [
          {
            id: 'SS-01-04-Q1',
            type: 'single_choice',
            prompt: '本地仅题目配置夹具：请选择A。',
            options: [
              { id: 'A', text: '本地正确选项' },
              { id: 'B', text: '本地错误选项' },
            ],
            scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
          },
        ],
      },
      null,
      2,
    )}\n\`\`\``,
  ),
];
const contexts = nodes.map((entry) => ({
  slug: 'signals',
  course_id: 1,
  course_name: LABEL,
  node_id: entry.id,
  title: entry.title,
  document_markdown: entry.markdown,
  knowledge_markdown: entry.markdown,
  basic_info_markdown: entry.sections.basicInfoMarkdown,
  is_active: 1,
}));

async function click(page, selector) {
  const item = await page.$(selector);
  assert.ok(item, `Missing ${selector}`);
  try {
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
    await item.dispose();
  }
}
async function select(page, quote) {
  await page.evaluate((value) => {
    [...document.querySelectorAll('#knowledge-body p')]
      .find(
        (item) =>
          !item.closest('details:not([open]),[hidden],.hidden') && item.textContent.includes(value),
      )
      .scrollIntoView({ block: 'center', behavior: 'instant' });
  }, quote);
  await new Promise((resolve) => {
    setTimeout(resolve, 250);
  });
  const rect = await page.evaluate((value) => {
    const walker = document.createTreeWalker(
      document.getElementById('knowledge-body'),
      NodeFilter.SHOW_TEXT,
    );
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement.closest('details:not([open]),[hidden],.hidden')) continue;
      const start = text.data.indexOf(value);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + value.length);
      const geometry = range.getBoundingClientRect();
      return {
        left: geometry.left + 0.2,
        right: geometry.right - 0.2,
        y: geometry.top + geometry.height / 2,
      };
    }
    return null;
  }, quote);
  assert.ok(rect);
  await page.mouse.move(rect.left, rect.y);
  await page.mouse.down();
  await page.mouse.move(rect.right, rect.y, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), quote);
}
async function main() {
  const preview = createLearningPreview({ mapNodes: nodes, contextRows: contexts, mapEdges: [] });
  let base;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-material-gaps-'));
  const report = {
    boundary:
      'Installed Chrome and native pointer, actual frontend and private memory routers. Empty course materials and an AI SSE response are explicitly simulated fixtures, not formal content, access, or live AI reliability evidence. No production edits or formal learner records.',
    scenes: [],
    findings: [],
    pageErrors: [],
    portSelection: null,
  };
  let browser;
  let page;
  let publicResourceFailure = true;
  const aiRequests = [];
  const writes = [];
  const visit = async (point) => {
    await page.goto(
      `${base}/knowledge?${new URLSearchParams({ course: 'signals', point, view: 'reading' })}`,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot()?.documentVersion &&
        document.querySelector('#learning-plan-summary h3'),
    );
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
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
  try {
    // Port retries belong only to fixture startup. No browser task or business
    // assertion is rerun if its first execution fails.
    report.portSelection = await listenAllowedLoopback(preview.server, {
      diagnostic: (message) => console.log(message),
    });
    base = `http://127.0.0.1:${report.portSelection.port}`;
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
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({
          status: 403,
          body: 'Explicit local fixture: external network disabled',
        });
      if (request.method() !== 'GET') writes.push(url.pathname);
      if (url.pathname === '/api/course-upload/public/courses/signals/files')
        return request.respond({
          status: publicResourceFailure ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            publicResourceFailure ? { message: '明确夹具模拟不可用' } : { files: [] },
          ),
        });
      if (url.pathname === '/api/ai/knowledge/chat') {
        aiRequests.push(JSON.parse(request.postData()));
        return request.respond({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ delta: '【内存夹具模拟输出】小题：请用自己的话说明一个条件，再指出仍需查证的部分。' })}\n\n`,
        });
      }
      return request.continue();
    });
    await visit('SS-01-01');
    assert.equal(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), null);
    assert.equal(
      await page.evaluate(() => Boolean(document.querySelector('.learning-start-dialog[open]'))),
      false,
    );
    const missing = await page.$eval('#knowledge-body', (item) => item.textContent);
    assert.match(missing, /正文暂未提供/);
    await tool('continue');
    const emptyPlan = await page.evaluate(() => ({
      primary: document.querySelector('#learning-plan-summary h3').textContent,
      chain: document.getElementById('learning-plan-chain').textContent,
      shortcuts: [...document.querySelectorAll('.learning-task-options button')].map(
        (item) => item.textContent,
      ),
    }));
    assert.ok(!emptyPlan.shortcuts.includes('正式自测'));
    assert.ok(!emptyPlan.shortcuts.includes('查阅正文'));
    await click(page, '.learning-plan-primary button');
    await page.waitForFunction(
      () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'notes',
    );
    await tool('resources');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-resources-content').dataset.resourcesState === 'error',
    );
    const resourceFailure = await page.$eval(
      '#learning-resources-content',
      (item) => item.textContent,
    );
    assert.match(resourceFailure, /不表示没有资料/);
    publicResourceFailure = false;
    await click(page, '#learning-resources-content button');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-resources-content').dataset.resourcesState === 'empty',
    );
    const resourcesEmpty = await page.$eval(
      '#learning-resources-content',
      (item) => item.textContent,
    );
    assert.match(resourcesEmpty, /最近 200/);
    report.scenes.push({
      name: 'no content or goal has an honest empty message and actionable notes; resource failure differs from scoped empty results',
      missing,
      emptyPlan,
      resourceFailure,
      resourcesEmpty,
    });

    await tool('content');
    await select(page, '这个知识点的正文暂未提供。');
    const emptyControls = await page.evaluate(() => ({
      toolbarHidden: document.getElementById('learning-annotation-toolbar').hidden,
      buttonDisabled: document.querySelector('[data-annotation-color="yellow"]').disabled,
    }));
    if (!emptyControls.toolbarHidden && !emptyControls.buttonDisabled)
      await click(page, '[data-annotation-color="yellow"]');
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    const placeholder = await page.evaluate(async () => {
      const data = await window.freeBbsApp.callApi(
        '/learning/signals/SS-01-01/entries?kind=note&annotations=1',
        { method: 'GET' },
      );
      return {
        entries: data.entries.map((entry) => ({
          quote: entry.annotation?.anchor?.quote,
          documentVersion: entry.annotation?.anchor?.documentVersion,
        })),
        marks: document.querySelectorAll('#knowledge-body [data-private-annotation]').length,
        explicitlyEmpty: document
          .getElementById('knowledge-body')
          .hasAttribute('data-learning-document-empty'),
        readingCaptured: window.FreeBbsLearningReader.capture(),
      };
    });
    placeholder.controls = emptyControls;
    if (EXPECT_EMPTY_STATE_FIX) {
      assert.equal(
        placeholder.entries.length,
        0,
        'System empty-state text cannot be stored as original content',
      );
      assert.equal(
        placeholder.marks,
        0,
        'System empty-state text receives no original-content marker',
      );
      assert.equal(placeholder.explicitlyEmpty, true);
      assert.equal(placeholder.readingCaptured, false);
    }
    if (placeholder.entries.some((entry) => entry.quote === '这个知识点的正文暂未提供。'))
      report.findings.push({
        id: 'empty-document-placeholder-can-be-saved-as-original-text-annotation',
        source: 'public/knowledge.js:1788; public/knowledge-annotations.js:515-532',
        impact:
          '课程正文为空时，系统自己的空态提示仍在原文容器内，可以被标记、保存并称作原文评注；这不是课程正文或学生查到的材料。应仅把空态排除可批注原文，保留普通笔记/资料任务。',
        evidence: placeholder,
      });
    await page.screenshot({ path: path.join(output, 'empty-document-placeholder-annotation.png') });
    await tool('notes');
    if (!(await page.$eval('#learning-note-composer', (item) => item.open)))
      await click(page, '#learning-note-composer > summary');
    await page.type('#learning-note-form [name="title"]', '本地资料缺口手记');
    await page.type(
      '#learning-note-form [name="content"]',
      '这是明确的本地普通手记夹具，不是课程正文。',
    );
    await click(page, '#learning-note-form button[type="submit"]');
    await page.waitForFunction(() =>
      document
        .querySelector('#learning-note-form .learning-form-status')
        .textContent.includes('已保存'),
    );
    const normalNotes = await page.evaluate(
      async () =>
        (
          await window.freeBbsApp.callApi('/learning/signals/SS-01-01/entries?kind=note', {
            method: 'GET',
          })
        ).entries,
    );
    assert.ok(normalNotes.some((entry) => entry.title === '本地资料缺口手记' && !entry.annotation));
    await visit('SS-01-03');
    await select(page, '这个知识点的正文暂未提供。');
    await click(page, '[data-annotation-color="yellow"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('#learning-annotation-list [data-annotation-id]').length === 1,
    );
    const authorSameSentence = await page.evaluate(async () =>
      (
        await window.freeBbsApp.callApi(
          '/learning/signals/SS-01-03/entries?kind=note&annotations=1',
          { method: 'GET' },
        )
      ).entries.map((entry) => ({
        quote: entry.annotation.anchor.quote,
        documentVersion: entry.annotation.anchor.documentVersion,
      })),
    );
    assert.equal(authorSameSentence.length, 1);
    assert.equal(authorSameSentence[0].quote, '这个知识点的正文暂未提供。');
    const authoredReading = await page.evaluate(() => ({
      explicitlyEmpty: document
        .getElementById('knowledge-body')
        .hasAttribute('data-learning-document-empty'),
      capture: window.FreeBbsLearningReader.capture(),
    }));
    assert.equal(authoredReading.explicitlyEmpty, false);
    assert.equal(authoredReading.capture, true);
    await visit('SS-01-04');
    await select(page, '这个知识点的正文暂未提供。');
    await click(page, '[data-annotation-color="yellow"]');
    const quizOnly = await page.evaluate(async () => ({
      entries: (
        await window.freeBbsApp.callApi(
          '/learning/signals/SS-01-04/entries?kind=note&annotations=1',
          { method: 'GET' },
        )
      ).entries.length,
      explicitlyEmpty: document
        .getElementById('knowledge-body')
        .hasAttribute('data-learning-document-empty'),
      readingCaptured: window.FreeBbsLearningReader.capture(),
      formalQuestions: window.FreeBbsLearningAssessment.getSnapshot().questions.length,
      marks: document.querySelectorAll('#knowledge-body [data-private-annotation]').length,
    }));
    if (EXPECT_EMPTY_STATE_FIX) {
      assert.equal(quizOnly.entries, 0);
      assert.equal(quizOnly.explicitlyEmpty, true);
      assert.equal(quizOnly.readingCaptured, false);
      assert.equal(quizOnly.marks, 0);
      assert.equal(
        quizOnly.formalQuestions,
        1,
        'Published selftest remains available separately from missing authored prose',
      );
    }
    report.scenes.push({
      name: 'empty-state text is distinct from authored same sentence; ordinary gap notes remain savable',
      placeholder,
      ordinaryNoteSaved: true,
      authorSameSentence,
      authoredReading,
      quizOnly,
      strictEmptyStateFixExpected: EXPECT_EMPTY_STATE_FIX,
    });

    await visit('SS-01-02');
    await select(page, '夹具陌生术语');
    await click(page, '[data-annotation-action="ask"]');
    const terminologyDraft = await page.$eval('#knowledge-chat-input', (item) => item.value);
    assert.match(terminologyDraft, /夹具陌生术语/);
    assert.equal(aiRequests.length, 0);
    await click(page, '.knowledge-chat-prompts [data-chat-prompt*="小题"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#knowledge-chat-thread .knowledge-chat-message-body')].some(
        (item) => item.textContent.includes('内存夹具模拟输出'),
      ),
    );
    await page.waitForFunction(() => !document.getElementById('knowledge-chat-input').disabled);
    const generated = await page.evaluate(() => ({
      chat: document.getElementById('knowledge-chat-thread').textContent,
      status: document.getElementById('knowledge-chat-status').textContent,
      formalQuestions: window.FreeBbsLearningAssessment.getSnapshot().questions.length,
      attempts: window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.length,
      formalCards: document.querySelectorAll('#learning-quiz-list [data-question-id]').length,
      starEarned: document
        .querySelector('[data-learning-star="self_learning"]')
        ?.classList.contains('is-earned'),
      preference: window.FreeBbsLearningStart.currentPreference(),
    }));
    assert.equal(generated.formalQuestions, 0);
    assert.equal(generated.attempts, 0);
    assert.equal(generated.formalCards, 0);
    assert.equal(generated.starEarned, false);
    assert.equal(generated.preference, null);
    await page.screenshot({
      path: path.join(output, 'simulated-max-small-question-not-formal.png'),
    });
    report.scenes.push({
      name: 'unknown-term ask prefill does not auto-send; explicit simulated Max question remains chat, not formal scoring',
      terminologyDraft,
      generated,
      aiCount: aiRequests.length,
    });

    // Keep the original no-goal tasks above untouched; this explicit preference
    // is applied only for the additional quiz-only-content recommendation task.
    await visit('SS-01-04');
    await click(page, '.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]', { visible: true });
    await page.select('[data-learning-start-choice="level"]', 'new');
    await page.select('[data-learning-start-choice="goal"]', 'concepts');
    await click(page, '.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    await tool('continue');
    const quizOnlyConcepts = await page.evaluate(() => ({
      preference: window.FreeBbsLearningStart.currentPreference(),
      primary: document.querySelector('#learning-plan-summary h3').textContent,
      chain: document.getElementById('learning-plan-chain').textContent,
      shortcuts: [...document.querySelectorAll('.learning-task-options button')].map(
        (item) => item.textContent,
      ),
      empty: document.getElementById('knowledge-body').hasAttribute('data-learning-document-empty'),
      formalQuestions: window.FreeBbsLearningAssessment.getSnapshot().questions.length,
    }));
    assert.deepEqual(quizOnlyConcepts.preference, { level: 'new', goal: 'concepts' });
    assert.equal(quizOnlyConcepts.empty, true);
    assert.equal(quizOnlyConcepts.formalQuestions, 1);
    assert.ok(!quizOnlyConcepts.shortcuts.includes('查阅正文'));
    assert.ok(quizOnlyConcepts.shortcuts.includes('正式自测'));
    await click(page, '.learning-plan-primary button');
    await page.waitForFunction(
      () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'notes',
    );
    quizOnlyConcepts.primaryReached = 'notes';
    await tool('continue');
    const directSelftestIndex = await page.$$eval(
      '.learning-plan-alternatives button',
      (items) => items.findIndex((item) => item.textContent === '直接自测') + 1,
    );
    assert.ok(directSelftestIndex > 0);
    await click(page, `.learning-plan-alternatives button:nth-of-type(${directSelftestIndex})`);
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment.getSnapshot().view === 'quick' &&
        document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback' &&
        document.querySelector('#learning-quiz-list [data-question-id="SS-01-04-Q1"]'),
    );
    quizOnlyConcepts.formalSelftestReached = 'quick';
    await page.screenshot({
      path: path.join(output, 'quiz-only-concepts-direct-formal-selftest.png'),
    });
    report.scenes.push({
      name: 'quiz-only prose stays absent for concepts recommendation; primary opens ordinary notes while formal selftest stays directly reachable',
      quizOnlyConcepts,
    });
    assert.ok(
      !writes.some(
        (url) => url.startsWith('/api/learning-assessments/') || url.includes('/reconcile'),
      ),
    );
    assert.deepEqual(report.pageErrors, []);
    report.executed = true;
  } catch (error) {
    report.executed = false;
    report.portSelection ||= error.portSelection || null;
    report.failure = {
      message: error.message,
      stack: error.stack,
      portSelection: error.portSelection || report.portSelection,
    };
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  } finally {
    if (browser) await browser.close();
    if (preview.server.listening) {
      preview.server.closeAllConnections();
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    }
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
          portSelection: report.portSelection,
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
