/* Isolated browser QA; a supplied public-preview factory reads real public snapshots only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const policy = require('../public/learning-policy');
const { withLearningPolicyPage } = require('./preview-learning-policy');

async function main() {
  const source = process.argv.find((arg) => arg.startsWith('--preview-module='))?.slice(17);
  if (!source) throw new Error('Use --preview-module=<read-only public snapshot preview factory>');
  const playwrightPath =
    process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/yc-z2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
  // eslint-disable-next-line import/no-dynamic-require
  const { chromium } = require(playwrightPath);
  // eslint-disable-next-line import/no-dynamic-require
  const preview = withLearningPolicyPage(require(path.resolve(source)).createPublicPreview());
  await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const output = path.resolve(
    'output/learning-policy-lab',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(output, { recursive: true });
  const fingerprint = () =>
    Object.fromEntries(
      [
        'learning-policy.js',
        'learning-policy-lab.js',
        'learning-policy-lab.html',
        'learning-policy-lab.css',
      ].map((file) => [
        file,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.resolve(__dirname, '../public', file)))
          .digest('hex'),
      ]),
    );
  const report = {
    origin,
    boundary:
      'Real public course snapshots; isolated synthetic identity; no production writes or AI requests.',
    scenarios: [],
    failures: [],
    sourcesBefore: fingerprint(),
  };
  let browser;
  const record = async (name, action) => {
    try {
      await action();
      report.scenarios.push({ name, passed: true });
    } catch (error) {
      report.scenarios.push({ name, passed: false, error: error.message });
      throw error;
    }
  };
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    const mutations = [];
    const external = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        mutations.push({ url: request.url(), method: request.method() });
      if (!request.url().startsWith(origin) && !request.url().startsWith('blob:'))
        external.push(request.url());
    });
    await record('real public signal map and detail load without a login gate', async () => {
      await page.goto(`${origin}/learning-policy-lab.html?course=signals&point=SS-02-01`, {
        waitUntil: 'networkidle',
      });
      await page.locator('#policy-apply').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#policy-apply').disabled);
      assert.ok((await page.locator('#policy-point option').count()) > 100);
      assert.match(await page.locator('#identity-status').innerText(), /当前页面/);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
    });
    await record(
      'all sixteen configurations render controlled links and three or four visible modular steps',
      async () => {
        for (const purpose of Object.keys(policy.PURPOSES))
          for (const level of Object.keys(policy.LEVELS)) {
            await page.locator(`input[name="purpose"][value="${purpose}"]`).check();
            await page.selectOption('#policy-level', level);
            await page.locator('#policy-apply').click();
            assert.equal(
              await page.locator('.policy-step:visible').count(),
              purpose === 'review' ? 3 : 4,
            );
            const links = await page
              .locator('#plan-content a[href^="/knowledge?"]')
              .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('href')));
            assert.ok(links.length >= 5);
            for (const href of links) {
              const url = new URL(href, origin);
              assert.equal(url.searchParams.get('policy'), policy.POLICY_VERSION);
              assert.equal(url.searchParams.get('purpose'), purpose);
              assert.equal(url.searchParams.get('level'), level);
              assert.equal(url.searchParams.get('point'), 'SS-02-01');
              assert.ok(Object.hasOwn(policy.MODULES, url.searchParams.get('module')));
            }
            assert.equal(await page.evaluate(() => localStorage.length), 0);
          }
      },
    );
    await record(
      'new learner review may skip recall, pause, resume and expand without failing or awarding stars',
      async () => {
        await page.locator('input[name="purpose"][value="review"]').check();
        await page.selectOption('#policy-level', 'new');
        await page.locator('#policy-apply').click();
        assert.match(await page.locator('[data-module="retrieve"]').innerText(), /立即跳过回忆/);
        await page
          .locator('[data-module="retrieve"]')
          .getByRole('button', { name: '先跳过', exact: true })
          .click();
        assert.match(
          await page.locator('[data-module="retrieve"] .step-status').innerText(),
          /不计失败/,
        );
        await page.getByRole('button', { name: '先暂停', exact: true }).click();
        assert.match(await page.locator('.paused-notice').innerText(), /所有原课程入口仍可使用/);
        await page.getByRole('button', { name: '继续这条链', exact: true }).click();
        await page.locator('[data-more-steps] summary').click();
        assert.equal(await page.locator('.policy-step:visible').count(), 5);
        await page
          .locator('[data-module="repair"]')
          .getByRole('button', { name: '我已完成这一步', exact: true })
          .click();
        assert.match(
          await page.locator('[data-module="repair"] .step-status').innerText(),
          /不代表掌握或授星/,
        );
      },
    );
    await record(
      'Max question is only prepared in an editable native dialog and never automatically sent',
      async () => {
        await page
          .locator('[data-module="retrieve"]')
          .getByRole('button', { name: '准备问 Max', exact: true })
          .click();
        assert.ok(await page.locator('#max-question-dialog').evaluate((dialog) => dialog.open));
        const prompt = await page.locator('#max-question-text').inputValue();
        assert.match(prompt, /不是测评结果/);
        assert.match(prompt, /不代答/);
        assert.match(
          await page.locator('#max-open-reader').getAttribute('href'),
          /interaction=max/,
        );
        await page.keyboard.press('Escape');
        assert.equal(
          await page.locator('#max-question-dialog').evaluate((dialog) => dialog.open),
          false,
        );
        assert.deepEqual(mutations, []);
      },
    );
    await record(
      'relation and origin links follow real available materials including prepared Max links',
      async () => {
        await page.locator('input[name="purpose"][value="explore"]').check();
        await page.selectOption('#policy-level', 'new');
        await page.locator('#policy-apply').click();
        const originHref = await page
          .locator('[data-module="origin"] a')
          .first()
          .getAttribute('href');
        assert.equal(new URL(originHref, origin).searchParams.has('focus'), false);
        await page
          .locator('[data-module="origin"]')
          .getByRole('button', { name: '准备问 Max', exact: true })
          .click();
        assert.equal(
          new URL(
            await page.locator('#max-open-reader').getAttribute('href'),
            origin,
          ).searchParams.has('focus'),
          false,
        );
        assert.match(
          await page.locator('#max-question-dialog').innerText(),
          /本实验目的会随链接带到当前知识页的 Max/,
        );
        assert.match(await page.locator('#max-question-dialog').innerText(), /线上尚未部署/);
        await page.keyboard.press('Escape');
        const disclosure = page.locator('[data-more-steps]');
        if (!(await disclosure.evaluate((item) => item.open)))
          await disclosure.locator('summary').click();
        const relationHref = await page
          .locator('[data-module="explore"] a')
          .first()
          .getAttribute('href');
        assert.equal(new URL(relationHref, origin).searchParams.get('focus'), 'relations');
        await page
          .locator('[data-module="explore"]')
          .getByRole('button', { name: '准备问 Max', exact: true })
          .click();
        assert.equal(
          new URL(
            await page.locator('#max-open-reader').getAttribute('href'),
            origin,
          ).searchParams.get('focus'),
          'relations',
        );
        await page.keyboard.press('Escape');
        await page.selectOption('#policy-course', 'circuits');
        await page.waitForFunction(
          () =>
            !document.querySelector('#policy-apply').disabled &&
            document
              .querySelector('#course-directory')
              .getAttribute('href')
              .includes('course=circuits'),
        );
        await page.locator('#policy-apply').click();
        const missingRelationsHref = await page
          .locator('[data-module="explore"] a')
          .first()
          .getAttribute('href');
        assert.equal(new URL(missingRelationsHref, origin).searchParams.has('focus'), false);
        await page
          .locator('[data-module="explore"]')
          .getByRole('button', { name: '准备问 Max', exact: true })
          .click();
        assert.equal(
          new URL(
            await page.locator('#max-open-reader').getAttribute('href'),
            origin,
          ).searchParams.has('focus'),
          false,
        );
        await page.keyboard.press('Escape');
      },
    );
    await record(
      'mobile large text, dark mode and complete public-course switching stay readable',
      async () => {
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '24px';
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
        );
        await page.screenshot({ path: path.join(output, 'mobile-dark-large.png'), fullPage: true });
        for (const course of ['math', 'circuits', 'signals']) {
          await page.selectOption('#policy-course', course);
          await page.waitForFunction(
            (value) =>
              !document.querySelector('#policy-apply').disabled &&
              document
                .querySelector('#course-directory')
                .getAttribute('href')
                .includes(`course=${value}`),
            course,
          );
          assert.ok((await page.locator('#policy-point option').count()) > 10);
          await page.locator('#policy-apply').click();
          assert.match(
            await page.locator('#plan-content .small').first().innerText(),
            new RegExp(`^${course} /`),
          );
        }
      },
    );
    await context.close();
    const privateContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const privatePage = await privateContext.newPage();
    privatePage.on('pageerror', (error) => pageErrors.push(error.message));
    privatePage.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        mutations.push({ url: request.url(), method: request.method() });
    });
    await privateContext.addInitScript(() => {
      localStorage.setItem('free_bbs_auth_token', 'learning-preview-student');
      localStorage.setItem(
        'free_bbs_learning_start_v1:user:u_learning01',
        'ORIGINAL_PREFERENCE_CANARY',
      );
    });
    await record(
      'verified synthetic accounts persist only isolated lab records and export no private contents',
      async () => {
        await privatePage.goto(
          `${origin}/learning-policy-lab.html?course=signals&point=SS-02-01&purpose=practice&level=basic`,
          { waitUntil: 'networkidle' },
        );
        await privatePage.waitForFunction(() => !document.querySelector('#policy-apply').disabled);
        await privatePage.locator('#policy-apply').click();
        const stored = await privatePage.evaluate(() =>
          Object.fromEntries(Object.entries(localStorage)),
        );
        const key = policy.ownerKey({ verified: true, uid: 'u_learning01' });
        assert.ok(stored[key]);
        assert.equal(
          stored['free_bbs_learning_start_v1:user:u_learning01'],
          'ORIGINAL_PREFERENCE_CANARY',
        );
        const lab = JSON.parse(stored[key]);
        assert.equal(lab.schemaVersion, 2);
        assert.equal(lab.records[0].purpose, 'practice');
        assert.doesNotMatch(
          stored[key],
          /learning-preview-student|knowledgeMarkdown|correctAnswer/,
        );
        await privatePage.locator('.support-details summary').click();
        const downloadPromise = privatePage.waitForEvent('download');
        await privatePage.getByRole('button', { name: '导出本次实验记录', exact: true }).click();
        const download = await downloadPromise;
        await download.saveAs(path.join(output, 'own-record.json'));
        const exported = JSON.parse(fs.readFileSync(path.join(output, 'own-record.json'), 'utf8'));
        assert.equal(exported.purpose, 'practice');
        assert.doesNotMatch(
          JSON.stringify(exported),
          /learning-preview|u_learning|"token"|"uid"|"answer"|"markdown"/,
        );
      },
    );
    await record(
      'return URL prefills an explicit different goal without silently applying or overwriting saved work',
      async () => {
        const owner = policy.ownerKey({ verified: true, uid: 'u_learning01' });
        const prior = await privatePage.evaluate((key) => localStorage.getItem(key), owner);
        await privatePage.goto(
          `${origin}/learning-policy-lab.html?course=signals&point=SS-02-01&purpose=review&level=familiar`,
          { waitUntil: 'networkidle' },
        );
        await privatePage.waitForFunction(() => !document.querySelector('#policy-apply').disabled);
        assert.equal(
          await privatePage.locator('input[name="purpose"]:checked').inputValue(),
          'review',
        );
        assert.equal(await privatePage.locator('#policy-level').inputValue(), 'familiar');
        assert.equal(await privatePage.locator('#plan-content').isVisible(), false);
        assert.equal(await privatePage.evaluate((key) => localStorage.getItem(key), owner), prior);
        await privatePage.locator('#policy-apply').click();
        assert.match(await privatePage.locator('.plan-topline').innerText(), /复习知识/);
      },
    );
    await record(
      'switching synthetic account clears prior progress and Max draft without rewriting the prior owner',
      async () => {
        await privatePage
          .locator('.policy-step')
          .first()
          .getByRole('button', { name: '我已完成这一步', exact: true })
          .click();
        await privatePage
          .locator('.policy-step')
          .first()
          .getByRole('button', { name: '准备问 Max', exact: true })
          .click();
        const prior = await privatePage.evaluate(
          (key) => localStorage.getItem(key),
          policy.ownerKey({ verified: true, uid: 'u_learning01' }),
        );
        await privatePage.evaluate(() => {
          localStorage.setItem('free_bbs_auth_token', 'learning-preview-other');
          dispatchEvent(
            new StorageEvent('storage', {
              key: 'free_bbs_auth_token',
              newValue: 'learning-preview-other',
            }),
          );
        });
        await privatePage.waitForFunction(
          () =>
            !document.querySelector('#policy-apply').disabled &&
            !document.querySelector('#max-question-dialog').open,
        );
        assert.equal(await privatePage.locator('#max-question-text').inputValue(), '');
        await privatePage.locator('#policy-apply').click();
        assert.equal(await privatePage.locator('.step-status').count(), 0);
        const result = await privatePage.evaluate(() =>
          Object.fromEntries(Object.entries(localStorage)),
        );
        assert.equal(result[policy.ownerKey({ verified: true, uid: 'u_learning01' })], prior);
        assert.ok(result[policy.ownerKey({ verified: true, uid: 'u_learning02' })]);
      },
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(mutations, []);
    assert.deepEqual(external, []);
    report.pageErrors = pageErrors;
    report.nonGetRequests = mutations;
    report.externalRequests = external;
    await privateContext.close();
  } catch (error) {
    report.failures.push(error.stack);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    report.sourcesAfter = fingerprint();
    report.sourcesStable =
      JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter);
    if (!report.sourcesStable) {
      report.failures.push('Public experiment sources changed while browser QA was running.');
      process.exitCode = 1;
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        output,
        passed: report.scenarios.filter((row) => row.passed).length,
        failed: report.failures.length,
        scenarios: report.scenarios,
      }),
    );
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
