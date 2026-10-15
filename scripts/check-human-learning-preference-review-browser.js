// Independent read-only human-flow review. Never starts a server or submits business data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-preference-review-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Existing loopback memory preview, fresh isolated browser context, actual authoring question bank. All non-GET API calls are blocked. No business records or AI are submitted.',
    fixtureBoundary:
      'Cross-course preference checks call the production context API directly because this preview only publishes signals. Historical-star and delayed-WebCrypto responses are explicit isolated fixtures, not real student records or measured ordinary network latency.',
    checks: [],
    pageErrors: [],
    blockedMutations: [],
    screenshots: [],
  };
  const record = (name, pass, details = {}) =>
    report.checks.push({ name, pass: Boolean(pass), ...details });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const context = await browser.createBrowserContext();
  let activePage = null;
  const prepare = async (options = {}) => {
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15000);
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({ status: 403, body: 'External services disabled' });
      if (url.pathname.startsWith('/api/') && request.method() !== 'GET') {
        report.blockedMutations.push({ method: request.method(), path: url.pathname });
        return request.respond({
          status: 409,
          contentType: 'application/json',
          body: '{"message":"Independent read-only review blocks writes"}',
        });
      }
      if (options.stars && url.pathname === '/api/learning-stars/signals/SS-02-01')
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            node: {
              nodeId: 'SS-02-01',
              level: 'core',
              stars: [
                { key: 'self_learning', earned: true, historicalVersion: true },
                { key: 'deep_mastery', earned: true },
              ],
              selftest: {
                available: true,
                questionCount: 4,
                passedQuestionCount: 1,
                pendingReviewCount: 1,
                eligible: false,
              },
            },
          }),
        });
      return request.continue();
    });
    if (options.delayDigest)
      await page.evaluateOnNewDocument(() => {
        const original = crypto.subtle.digest.bind(crypto.subtle);
        let held = false;
        window.learningDigestFixture = { held: false, released: false };
        crypto.subtle.digest = (algorithm, bytes) => {
          const value = new TextDecoder().decode(bytes);
          if (!held && value.startsWith('[true,"u_learning01",')) {
            held = true;
            window.learningDigestFixture.held = true;
            return new Promise((resolve, reject) => {
              window.releaseLearningDigest = async () => {
                window.learningDigestFixture.released = true;
                try {
                  resolve(await original(algorithm, bytes));
                } catch (error) {
                  reject(error);
                }
              };
            });
          }
          return original(algorithm, bytes);
        };
      });
    return page;
  };
  const visit = async (page, identity = 'student', point = 'SS-02-01', course = false) => {
    const query = new URLSearchParams({
      course: 'signals',
      as: identity,
      ...(course ? {} : { point }),
    });
    await page.goto(`${base.origin}/${course ? 'course' : 'knowledge'}?${query}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('.learning-start-adjust');
    if (!course)
      await page.waitForFunction(() => window.FreeBbsLearningAssessment?.getSnapshot().loaded);
    if (
      !course &&
      (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
    )
      await page.click('#knowledge-chat-close');
  };
  const preference = (page) => page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
  const modalCount = (page) => page.$$eval('.learning-start-dialog[open]', (items) => items.length);
  const click = async (page, selector) => {
    const item = await page.waitForSelector(selector, { visible: true });
    await item.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.waitForFunction(
      (element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !element.disabled && (hit === element || element.contains(hit));
      },
      {},
      item,
    );
    await item.click();
    await item.dispose();
  };
  const save = async (page, level, goal) => {
    await click(page, '.learning-start-adjust');
    await page.select('.learning-start-dialog [name="level"]', level);
    await page.select('.learning-start-dialog [name="goal"]', goal);
    await click(page, '.learning-start-dialog .learning-start-apply');
  };
  let scene = 'initial';
  try {
    const page = await prepare();
    await visit(page);
    record(
      'unset preference opens reading without a forced dialog',
      (await modalCount(page)) === 0 && (await preference(page)) === null,
    );
    await save(page, 'basic', 'practice');
    record(
      'explicit choice saves browser scope once without a dialog remaining',
      JSON.stringify(await preference(page)) ===
        JSON.stringify({ level: 'basic', goal: 'practice' }) && (await modalCount(page)) === 0,
    );

    scene = 'reload';
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.learning-start-adjust');
    record(
      'reload restores the same course goal without asking again',
      JSON.stringify(await preference(page)) ===
        JSON.stringify({ level: 'basic', goal: 'practice' }) && (await modalCount(page)) === 0,
    );
    scene = 'directory-point-back';
    await visit(page, 'student', 'SS-02-01', true);
    record(
      'course directory reuses that course preference',
      (await preference(page))?.goal === 'practice' && (await modalCount(page)) === 0,
    );
    await visit(page, 'student', 'SS-01-01');
    record(
      'another point in the same course reuses the preference',
      (await preference(page))?.level === 'basic' && (await modalCount(page)) === 0,
    );
    await page.goBack({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.learning-start-adjust');
    record(
      'actual browser back preserves preference without a new choice dialog',
      (await preference(page))?.goal === 'practice' && (await modalCount(page)) === 0,
      { actualUrl: page.url() },
    );

    scene = 'new-tab-course-context';
    const second = await prepare();
    await visit(second);
    record(
      'a new tab restores the browser-scoped course preference',
      (await preference(second))?.goal === 'practice' && (await modalCount(second)) === 0,
    );
    await second.evaluate(() => window.FreeBbsLearningStart.setContext('calculus'));
    record(
      'a different course context never inherits signals preference',
      (await preference(second)) === null && (await modalCount(second)) === 0,
      { explicitContextFixture: true },
    );
    await save(second, 'familiar', 'concepts');
    await second.evaluate(() => window.FreeBbsLearningStart.setContext('signals'));
    record(
      'returning to signals restores its own level and goal',
      (await preference(second))?.level === 'basic' &&
        (await preference(second))?.goal === 'practice',
      { explicitContextFixture: true },
    );
    await second.evaluate(() => window.FreeBbsLearningStart.setContext('calculus'));
    record(
      'returning to the second context restores its independent saved goal',
      (await preference(second))?.level === 'familiar' &&
        (await preference(second))?.goal === 'concepts',
      { explicitContextFixture: true },
    );

    scene = 'cross-tab-account';
    await visit(second, 'other');
    await page.waitForFunction(() =>
      document.getElementById('learning-start-selector').textContent.includes('登录状态已变化'),
    );
    record(
      'cross-tab account switch immediately suspends the prior preference and does not force a selector',
      (await preference(page)) === null &&
        (await modalCount(page)) === 0 &&
        (await page.evaluate(() => window.FreeBbsLearningStart.promptHint())) === '',
    );
    record(
      'another account does not inherit the first account goal',
      (await preference(second)) === null && (await modalCount(second)) === 0,
    );
    await save(second, 'new', 'concepts');
    await visit(page, 'student');
    record(
      'returning to the first account restores only its saved preference',
      (await preference(page))?.level === 'basic' &&
        (await preference(page))?.goal === 'practice' &&
        (await modalCount(page)) === 0,
    );
    await visit(second, 'other');
    record(
      'returning to the second account restores its own saved preference',
      (await preference(second))?.level === 'new' &&
        (await preference(second))?.goal === 'concepts' &&
        (await modalCount(second)) === 0,
    );
    await second.close();

    scene = 'formal-bank-and-grey-star';
    const stars = await prepare({ stars: true });
    await visit(stars);
    await save(stars, 'advanced', 'explore');
    await click(stars, '[data-knowledge-tool="feedback"]');
    await click(stars, '[data-quiz-view="practice"]');
    await click(stars, '[data-quiz-view="quick"]');
    const bank = await stars.evaluate(() => ({
      formal: window.FreeBbsLearningAssessment.getSnapshot()
        .questions.map((question) => question.id)
        .sort(),
      rendered: [...document.querySelectorAll('#learning-quiz-list [data-question-id]')]
        .map((item) => item.dataset.questionId)
        .sort(),
      deep: [...document.querySelectorAll('[data-learning-star="deep_mastery"]')].map((item) => ({
        className: item.className,
        text: item.textContent,
      })),
      strip: [...document.querySelectorAll('.learning-star-strip')]
        .map((item) => item.textContent)
        .join('\n'),
    }));
    record(
      'exploration preference and practice view do not hide any formal questions',
      bank.formal.length === 4 && JSON.stringify(bank.formal) === JSON.stringify(bank.rendered),
      { formalIds: bank.formal, renderedIds: bank.rendered },
    );
    record(
      'third mastery star stays grey even if an unsupported fixture claims earned',
      bank.deep.length > 0 &&
        bank.deep.every(
          (item) => item.className.includes('is-muted') && item.text.includes('后续开发'),
        ),
      { explicitStarFixture: true, stars: bank.deep },
    );
    record(
      'historical self-learning award is distinct from current 1-of-4 progress and pending review',
      bank.strip.includes('保留历史版本的星记录') &&
        bank.strip.includes('本版自测 1/4 题通过 · 1 题待复核'),
      { explicitStarFixture: true },
    );
    const screenshot = path.join(output, 'formal-bank-and-historical-stars.png');
    await stars.screenshot({ path: screenshot, fullPage: false });
    report.screenshots.push(screenshot);
    await stars.close();

    scene = 'late-fingerprint-visit';
    const race = await prepare({ delayDigest: true });
    await visit(race);
    scene = 'late-fingerprint-held';
    await race.waitForFunction(
      () => window.learningDigestFixture.held && window.releaseLearningDigest,
    );
    // The novice exploration route opens this point's origin in place. The
    // independent-doing route legitimately navigates to the course relations
    // page, which would discard the old document rather than test its late UI.
    await save(race, 'new', 'practice');
    scene = 'late-fingerprint-current-goal';
    await race.evaluate(() => {
      const { recommend } = window.FreeBbsLearningNextSteps;
      window.FreeBbsLearningNextSteps.recommend = (input) => {
        window.learningReviewActiveGoal = input.activeGoal;
        return recommend(input);
      };
    });
    await click(race, '[data-knowledge-tool="continue"]');
    const alternatives = await race.$$('.learning-plan-alternatives button');
    let selectedExploration = false;
    for (const alternative of alternatives) {
      if (await alternative.evaluate((item) => item.textContent.trim() === '探索研究')) {
        await alternative.evaluate((item) =>
          item.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await alternative.click();
        selectedExploration = true;
        break;
      }
    }
    await Promise.all(alternatives.map((item) => item.dispose()));
    assert.ok(
      selectedExploration,
      'The current task is deliberately changed through the real exploration alternative',
    );
    await race.waitForFunction(() => window.learningReviewActiveGoal === 'explore');
    scene = 'late-fingerprint-editor';
    await click(race, '.learning-start-adjust');
    await race.select('.learning-start-dialog [name="level"]', 'familiar');
    await race.select('.learning-start-dialog [name="goal"]', 'concepts');
    const before = await race.evaluate(() => ({
      level: document.querySelector('.learning-start-dialog [name="level"]').value,
      goal: document.querySelector('.learning-start-dialog [name="goal"]').value,
      effective: window.FreeBbsLearningStart.currentPreference(),
      activeGoal: window.learningReviewActiveGoal,
    }));
    await race.evaluate(() => {
      window.learningReviewLateChanges = 0;
      window.addEventListener('learning:start-change', () => {
        window.learningReviewLateChanges += 1;
      });
    });
    await race.evaluate(async () => {
      await window.releaseLearningDigest();
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });
    const after = await race.evaluate(() => ({
      level: document.querySelector('.learning-start-dialog [name="level"]')?.value,
      goal: document.querySelector('.learning-start-dialog [name="goal"]')?.value,
      effective: window.FreeBbsLearningStart.currentPreference(),
      fixture: window.learningDigestFixture,
      activeGoal: window.learningReviewActiveGoal,
      changeEvents: window.learningReviewLateChanges,
    }));
    record(
      'late superseded preference restoration preserves the actively edited unsaved draft',
      before.level === after.level && before.goal === after.goal,
      { explicitLatencyFixture: true, before, after },
    );
    record(
      'a late superseded completion emits no preference change and does not clear the deliberately selected exploration task',
      before.activeGoal === 'explore' && after.activeGoal === 'explore' && after.changeEvents === 0,
      {
        explicitLatencyFixture: true,
        currentTaskObservedAtProductionRecommendInput: true,
        before,
        after,
      },
    );
    record(
      'the late completion does not change the applied preference or leak another owner',
      JSON.stringify(before.effective) === JSON.stringify(after.effective),
      { explicitLatencyFixture: true },
    );
    const raceScreenshot = path.join(output, 'late-fingerprint-editor.png');
    await race.screenshot({ path: raceScreenshot, fullPage: false });
    report.screenshots.push(raceScreenshot);
    await race.close();
    record(
      'no business mutation or AI submission was triggered by reading and preference changes',
      report.blockedMutations.length === 0,
      { blockedMutations: report.blockedMutations },
    );
  } catch (error) {
    let diagnostics;
    if (activePage && !activePage.isClosed()) {
      diagnostics = await activePage.evaluate(() => ({
        url: window.location.href,
        fixture: window.learningDigestFixture,
        preference: window.FreeBbsLearningStart?.currentPreference(),
        goal: window.learningReviewActiveGoal,
        preferenceText: document.getElementById('learning-start-selector')?.textContent,
        primary: document.querySelector('.learning-plan-primary')?.textContent,
        alternatives: [...document.querySelectorAll('.learning-plan-alternatives button')].map(
          (item) => item.textContent,
        ),
      }));
      const screenshot = path.join(output, 'execution-failure.png');
      await activePage.screenshot({ path: screenshot, fullPage: false });
      report.screenshots.push(screenshot);
    }
    record(`execution:${scene}`, false, { error: error.message, diagnostics });
  } finally {
    await browser.close();
    report.summary = {
      passed: report.checks.filter((check) => check.pass).length,
      failed: report.checks.filter((check) => !check.pass).length,
      pageErrors: report.pageErrors.length,
    };
    fs.writeFileSync(
      path.join(output, 'preference-review-report.json'),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(
      `${JSON.stringify({ output, summary: report.summary, failures: report.checks.filter((check) => !check.pass) }, null, 2)}\n`,
    );
    if (report.summary.failed || report.pageErrors.length) process.exitCode = 1;
  }
}
main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
