// Local-only integration: actual pages, assessment routes and course-entry choices; simulated data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, seedLearningEvidence } = require('./preview-learning-workspace');

async function main() {
  const preview = createLearningPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-learning-stars-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  const errors = [];
  try {
    await seedLearningEvidence(preview);
    console.log('Preview evidence prepared; launching browser.');
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    console.log('Browser ready; checking mandatory course entry.');
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
        return request.continue();
      return request.respond({ status: 403, body: 'No external services in local QA' });
    });
    await page.setViewport({ width: 1440, height: 960 });
    await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
    console.log('Course loaded; checking selection dialog.');
    await page.waitForSelector('.learning-start-dialog[open]');
    assert.equal(await page.$eval('.learning-start-apply', (button) => button.disabled), true);
    await page.keyboard.press('Escape');
    assert.ok(
      await page.$('.learning-start-dialog[open]'),
      'course entry cannot skip required selection',
    );
    await page.screenshot({
      path: path.join(output, 'course-start-required.png'),
      fullPage: false,
    });
    await page.select('[data-learning-start-choice="level"]', 'basic');
    await page.select('[data-learning-start-choice="goal"]', 'practice');
    await page.click('.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    assert.deepEqual(await page.evaluate(() => window.FreeBbsLearningStart.currentPreference()), {
      level: 'basic',
      goal: 'practice',
    });
    assert.equal(
      preview.requests.length,
      0,
      'starting-point selection sends no automatic AI request',
    );
    await page.goto(`${base}/course?as=student`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.learning-start-dialog[open]');
    assert.equal(
      await page.$eval('[data-learning-start-choice="level"]', (select) => select.value),
      'basic',
      'default course entry remembers the choice but still requires confirmation',
    );
    await page.click('.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&as=student`, {
      waitUntil: 'networkidle0',
    });
    assert.equal(
      await page.$('.learning-start-dialog[open]'),
      null,
      'same-course knowledge navigation reuses confirmed ticket',
    );
    await page.waitForSelector(
      '#knowledge-overview-brief [data-learning-star="self_learning"].is-earned',
    );
    await page.click('.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]');
    await page.click('.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    assert.ok(
      await page.$('#knowledge-overview-brief [data-learning-star="deep_mastery"].is-muted'),
    );
    assert.equal(
      await page.$eval('#knowledge-overview-brief .learning-star-strip', (item) =>
        /获取条件|通过对应课程后|完整学习路径/.test(item.textContent),
      ),
      false,
    );
    await page.screenshot({
      path: path.join(output, 'knowledge-stars-earned.png'),
      fullPage: false,
    });
    await page.click('[data-knowledge-tool="feedback"]');
    await page.waitForSelector(
      '#learning-selftest-stars [data-learning-star="self_learning"].is-earned',
    );
    const starCard = await page.$('#learning-selftest-stars');
    await starCard.screenshot({ path: path.join(output, 'knowledge-point-stars.png') });
    const request = await page.evaluate(() => window.freeBbsKnowledge.buildRequest('请解释卷积'));
    assert.equal(request.question, '请解释卷积');
    assert.deepEqual(request.context.learningStartPreference, { level: 'basic', goal: 'practice' });
    await page.screenshot({
      path: path.join(output, 'selftest-stars-earned.png'),
      fullPage: false,
    });
    await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&as=other&tool=feedback`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('.learning-start-dialog[open]');
    assert.equal(
      await page.$eval('[data-learning-start-choice="level"]', (select) => select.value),
      '',
      'other account does not inherit a starting point',
    );
    await page.select('[data-learning-start-choice="level"]', 'new');
    await page.click('.learning-start-apply');
    await page.waitForFunction(() =>
      document.getElementById('learning-selftest-stars').textContent.includes('待复核'),
    );
    assert.equal(
      await page.$('#learning-selftest-stars .is-earned'),
      null,
      'partial/pending self-test does not grant a star',
    );
    await page.screenshot({
      path: path.join(output, 'selftest-stars-pending.png'),
      fullPage: false,
    });
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 900 });
      if (
        await page.$eval(
          '#knowledge-chat-toggle',
          (button) => button.getAttribute('aria-expanded') === 'true',
        )
      )
        await page.click('#knowledge-chat-close');
      await page.click('.learning-start-adjust');
      await page.waitForSelector('.learning-start-dialog[open]');
      const box = await page.$eval('.learning-start-dialog', (dialog) => {
        const rect = dialog.getBoundingClientRect();
        return { left: rect.left, right: rect.right, innerWidth: window.innerWidth };
      });
      assert.ok(
        box.left >= 0 && box.right <= box.innerWidth + 1,
        `mandatory selection fits ${width}px`,
      );
      await page.click('.learning-start-apply');
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      );
      await page.screenshot({
        path: path.join(output, `selftest-stars-${width}.png`),
        fullPage: false,
      });
    }
    await page.setViewport({ width: 1440, height: 960 });
    await page.goto(`${base}/adminusers?as=admin`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() =>
      document.getElementById('admin-learning-data')?.textContent.includes('学习变化证据'),
    );
    const evidence = await page.evaluate(
      async () =>
        (await window.freeBbsApp.callApi('/learning-analytics/admin/overview?window=30'))
          .effectiveness,
    );
    assert.equal(evidence.improvedSequences, 2);
    assert.equal(evidence.improvedLearners, 1);
    assert.equal(evidence.notRetriedFailedSequences, 1);
    assert.equal(evidence.limitedSample, true);
    await page.$eval('#admin-learning-data', (element) =>
      element.scrollIntoView({ block: 'start' }),
    );
    await page.screenshot({
      path: path.join(output, 'admin-learning-evidence.png'),
      fullPage: false,
    });
    await page
      .$('#admin-learning-data')
      .then((element) =>
        element.screenshot({ path: path.join(output, 'admin-learning-evidence-panel.png') }),
      );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          output,
          passed: [
            'mandatory course-level choice',
            'default course and remembered re-entry confirmation',
            'same-course continuation',
            'visible desktop starting-point adjustment',
            'account isolation',
            'no automatic AI calls',
            'normalized AI context',
            'trusted published selftest star',
            'pending blocks star',
            'grey future star without conditions',
            '390/320 responsive',
            'admin sample denominators and limitations',
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
