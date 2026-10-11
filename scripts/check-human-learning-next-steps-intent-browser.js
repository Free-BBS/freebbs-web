// Real frontend/router against explicit memory fixtures; never formal learner records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function pointer(page, selector, name) {
  const handles = await page.$$(selector);
  try {
    const item = name
      ? await (async () => {
          for (const handle of handles)
            if ((await handle.evaluate((value) => value.textContent.trim())) === name)
              return handle;
          return null;
        })()
      : handles[0];
    assert.ok(item, `Missing pointer target: ${selector} ${name || ''}`);
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
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function main() {
  const preview = createLearningPreview();
  let base = '';
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-next-steps-intent-'));
  const report = {
    boundary:
      'Installed Chrome, real pointer and real production frontend/router. All users, course documents, published quizzes and attempts are isolated labelled memory fixtures, not formal course records or access evidence. No production files or storage schema were changed.',
    scenes: [],
    findings: [],
    pageErrors: [],
  };
  let browser;
  let page;
  const wire = async (target) => {
    await target.setViewport({ width: 1440, height: 1000 });
    target.on('pageerror', (error) => report.pageErrors.push(error.message));
    target.on('dialog', (dialog) => dialog.accept());
    await target.setRequestInterception(true);
    target.on('request', (request) => {
      const url = new URL(request.url());
      return url.origin === base || ['data:', 'blob:'].includes(url.protocol)
        ? request.continue()
        : request.respond({
            status: 403,
            body: 'Explicit isolated fixture: external network disabled',
          });
    });
  };
  const ready = async (target) => {
    await target.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 2 &&
        document.querySelector('#learning-plan-summary h3'),
    );
    if (await target.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await pointer(target, '#knowledge-chat-close');
  };
  const visit = async (target = page) => {
    await target.goto(`${base}/knowledge?course=signals&point=SS-01-01&view=reading`, {
      waitUntil: 'networkidle0',
    });
    await ready(target);
  };
  const tool = async (name) => {
    await pointer(page, `[data-knowledge-tool="${name}"]`);
    await page.waitForFunction(
      (value) => document.querySelector('[data-knowledge-page]').dataset.learningTool === value,
      {},
      name,
    );
  };
  const preference = async (level, goal = '') => {
    await pointer(page, '.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]', { visible: true });
    await page.select('[data-learning-start-choice="level"]', level);
    await page.select('[data-learning-start-choice="goal"]', goal);
    await pointer(page, '.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
      level,
      goal,
    });
  };
  const plan = async (target = page) =>
    target.evaluate(() => ({
      preference: window.FreeBbsLearningStart.currentPreference(),
      dialogOpen: Boolean(document.querySelector('.learning-start-dialog[open]')),
      title: document.getElementById('learning-plan-title').textContent,
      reason: document.getElementById('learning-plan-reason').textContent,
      primary: document.querySelector('#learning-plan-summary h3').textContent,
      chain: document.getElementById('learning-plan-chain').textContent,
      alternatives: [...document.querySelectorAll('.learning-plan-alternatives button')].map(
        (item) => item.textContent,
      ),
      shortcuts: [...document.querySelectorAll('.learning-task-options button')].map(
        (item) => item.textContent,
      ),
    }));
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
    await wire(page);
    await visit();
    assert.equal(
      await page.evaluate(() => Boolean(document.querySelector('.learning-start-dialog[open]'))),
      false,
    );
    assert.equal(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), null);
    assert.ok(await page.$eval('#knowledge-body', (item) => item.textContent.trim().length > 0));
    await tool('continue');
    const untouched = await plan();
    await preference('new', '');
    const newNoGoal = await plan();
    await page.reload({ waitUntil: 'networkidle0' });
    await ready(page);
    const reloaded = await plan();
    const secondTab = await browser.newPage();
    await wire(secondTab);
    await visit(secondTab);
    const newTab = await plan(secondTab);
    await secondTab.close();
    assert.deepEqual(reloaded.preference, { level: 'new', goal: '' });
    assert.deepEqual(newTab.preference, { level: 'new', goal: '' });
    assert.equal(reloaded.dialogOpen, false);
    assert.equal(newTab.dialogOpen, false);
    report.scenes.push({
      name: 'new learner skips optional goal; reading remains open and chosen level restores without reprompt',
      untouched,
      newNoGoal,
      reloaded,
      newTab,
    });

    await tool('continue');
    await preference('advanced', 'explore');
    const mastered = await plan();
    await pointer(page, '.learning-plan-alternatives button', '直接自测');
    await page.waitForFunction(
      () => window.FreeBbsLearningAssessment.getSnapshot().view === 'quick',
    );
    const question = '#learning-quiz-list [data-question-id="SS-01-01-Q-preview"]';
    await page.waitForSelector(question, { visible: true });
    const selftest = await page.$eval(question, (item) => ({
      text: item.textContent,
      maxEnabled: !item.querySelector('.learning-quiz-ask-max').disabled,
    }));
    assert.equal(selftest.maxEnabled, true);
    await pointer(page, `${question} input[value="B"]`);
    await tool('content');
    assert.ok(await page.$eval('#knowledge-body', (item) => item.textContent.trim().length > 0));
    await tool('feedback');
    assert.equal(await page.$eval(`${question} input[value="B"]`, (item) => item.checked), true);
    const stillSelftest = await page.evaluate(
      () => window.FreeBbsLearningAssessment.getSnapshot().view,
    );
    assert.equal(stillSelftest, 'quick');
    report.scenes.push({
      name: 'self-described mastery directly enters formal selftest; reading and Max help are not closed-book gates',
      mastered,
      selftest,
      afterReadingView: stillSelftest,
    });
    if (
      mastered.shortcuts.includes('独立自测') &&
      selftest.maxEnabled &&
      !/闭卷|不等于闭卷|作答由本人/.test(selftest.text)
    )
      report.findings.push({
        id: 'independent-selftest-name-has-no-defined-aid-boundary',
        source: 'public/learning-next-steps.js:45; public/learning-assessment.js:711',
        impact:
          '“独立自测”是正式自测入口，不是闭卷模式；同一正式表单允许查看正文且有可用Max思路按钮。当前未明确独立指本人作答而非闭卷，名称容易诱导错误预期，不能据此声称系统执行了闭卷。',
      });
    await pointer(page, `${question} button[type="submit"]`);
    await page.waitForFunction(() =>
      window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.some(
        (item) => item.official && item.verdict === 'fail',
      ),
    );
    await tool('continue');
    const formalFailure = await plan();
    await page.screenshot({ path: path.join(output, 'saved-explore-after-formal-failure.png') });
    let explorationDestination = null;
    if (/订正/.test(formalFailure.primary)) {
      await pointer(page, '.learning-plan-alternatives button', '探索研究');
      await page.waitForFunction(
        () => !document.querySelector('#learning-plan-summary h3').textContent.includes('订正'),
      );
    } else {
      assert.equal(formalFailure.title, mastered.title);
      assert.equal(formalFailure.chain, mastered.chain);
      assert.equal(formalFailure.primary, mastered.primary);
      assert.ok(formalFailure.alternatives.includes('订正自测'));
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        pointer(page, '.learning-plan-primary button', '开始'),
      ]);
      explorationDestination = page.url();
      assert.ok(new URL(explorationDestination).pathname.startsWith('/course'));
      await page.goBack({ waitUntil: 'networkidle0' });
      await ready(page);
      await tool('continue');
    }
    const chosenExplore = await plan();
    await page.screenshot({ path: path.join(output, 'chosen-explore-repair-chain.png') });
    await page.reload({ waitUntil: 'networkidle0' });
    await ready(page);
    await tool('continue');
    const afterReturn = await plan();
    const formalEvidence = await page.evaluate(() =>
      window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.map(
        ({ questionId, official, verdict }) => ({ questionId, official, verdict }),
      ),
    );
    assert.ok(formalEvidence.some((item) => item.official && item.verdict === 'fail'));
    assert.deepEqual(afterReturn.preference, { level: 'advanced', goal: 'explore' });
    assert.equal(afterReturn.dialogOpen, false);
    report.scenes.push({
      name: 'expert keeps saved exploration intent and a real fixture formal wrong answer; verify title, chain, primary and navigation',
      formalFailure,
      chosenExplore,
      afterReturn,
      formalEvidence,
      explorationDestination,
    });
    if (formalFailure.preference.goal === 'explore' && /订正/.test(formalFailure.primary))
      report.findings.push({
        id: 'formal-failure-overrides-saved-explore-while-title-and-chain-disagree-with-explicit-exploration',
        source:
          'public/learning-next-steps.js:342-412,518; public/knowledge-workspace.js:741,1126,1282',
        impact:
          '课程已保存探索目标仍被首荐订正；点击探索后只有当前主按钮换为探索，标题和完整链仍订正。重载目标未丢却再次首荐订正。入口未被锁，但推荐诱导与用户已选目标矛盾。',
      });
    else {
      assert.equal(chosenExplore.title, mastered.title);
      assert.equal(chosenExplore.chain, mastered.chain);
      assert.equal(afterReturn.title, mastered.title);
      assert.equal(afterReturn.chain, mastered.chain);
      assert.equal(afterReturn.primary, mastered.primary);
    }
    // A level-only choice is not an explicit research goal. Preserve the honest
    // default repair suggestion, while allowing an immediate temporary task switch.
    await preference('advanced', '');
    const implicitGoalFailure = await plan();
    assert.match(implicitGoalFailure.primary, /订正/);
    let temporaryExplore = null;
    const consoleObservation = (message) => {
      const marker = '__fixture_intent_navigate__';
      if (message.text().startsWith(marker))
        temporaryExplore = JSON.parse(message.text().slice(marker.length));
    };
    page.on('console', consoleObservation);
    // Observe the already-rendered plan before the real navigation leaves this
    // document. No task/preference is fabricated or written by the observer.
    await page.evaluate(() =>
      document.querySelector('[data-knowledge-page]').addEventListener(
        'knowledge:navigate',
        () => {
          console.debug(
            `__fixture_intent_navigate__${JSON.stringify({
              preference: window.FreeBbsLearningStart.currentPreference(),
              title: document.getElementById('learning-plan-title').textContent,
              primary: document.querySelector('#learning-plan-summary h3').textContent,
              chain: document.getElementById('learning-plan-chain').textContent,
            })}`,
          );
        },
        { once: true },
      ),
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      pointer(page, '.learning-plan-alternatives button', '探索研究'),
    ]);
    page.off('console', consoleObservation);
    assert.ok(temporaryExplore, 'Actual rendered task-switch plan was observed before navigation');
    assert.equal(temporaryExplore.title, mastered.title);
    assert.equal(temporaryExplore.chain, mastered.chain);
    assert.deepEqual(temporaryExplore.preference, { level: 'advanced', goal: '' });
    const temporaryDestination = page.url();
    await page.goBack({ waitUntil: 'networkidle0' });
    await ready(page);
    await tool('continue');
    const afterTemporaryReturn = await plan();
    assert.match(afterTemporaryReturn.primary, /订正/);
    const evidenceAfterSwitch = await page.evaluate(() =>
      window.FreeBbsLearningAssessment.getSnapshot().currentAttempts.map(
        ({ official, verdict }) => ({ official, verdict }),
      ),
    );
    assert.ok(evidenceAfterSwitch.some((item) => item.official && item.verdict === 'fail'));
    report.scenes.push({
      name: 'no explicitly saved goal keeps default repair; temporary task switch does not rewrite preference or formal evidence',
      implicitGoalFailure,
      temporaryExplore,
      temporaryDestination,
      afterTemporaryReturn,
      evidenceAfterSwitch,
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
