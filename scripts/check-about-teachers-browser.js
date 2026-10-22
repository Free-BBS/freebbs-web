// Real page controllers against a fresh loopback-only lab; no production credentials or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createAboutTeachersPreview } = require('./preview-about-teachers');

async function main() {
  const preview = createAboutTeachersPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.ABOUT_TEACHERS_QA_DIR ||
    path.resolve(
      __dirname,
      '../output/about-teachers',
      new Date().toISOString().replace(/[:.]/g, '-'),
    );
  fs.mkdirSync(output, { recursive: true });
  const report = { checks: [], layouts: [], screenshots: [], pageErrors: [], offOrigin: [] };
  let browser;
  let activePage;
  let stage = 'start';
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || /^(data:|blob:)/.test(url)) return route.continue();
      report.offOrigin.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    const goto = async (route) => {
      await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => window.freeBbsApp?.sessionReady);
      assert.equal(
        await page.locator('.privacy-restore-notice').count(),
        0,
        'preview privacy status must be coherent, not an overlapping error banner',
      );
    };
    stage = 'visitor about and teacher entry';
    await goto('/about?as=guest');
    await page.locator('main h1').waitFor();
    assert.ok(
      await page.locator('a[href="/teachers"]').count(),
      'about has teacher participation entry',
    );
    await goto('/teachers?as=guest');
    await page.locator('#teacher-signin').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#teacher-courses-section').isVisible(), false);
    assert.equal(await page.locator('#teacher-certify').isVisible(), false);
    assert.equal(
      await page.locator('#teacher-signin').getAttribute('href'),
      '/login?next=%2Fteachers',
    );
    report.checks.push('Guest sees About and honest teacher login entry without private data');
    stage = 'verified teacher courses and responses';
    await goto('/teachers?as=teacher');
    await page.waitForFunction(() =>
      document.getElementById('teacher-status').textContent.includes('教师身份已核实'),
    );
    assert.match(await page.locator('#teacher-courses').innerText(), /信号与系统/);
    assert.equal(await page.locator('#teacher-courses-title').innerText(), '我管理的课程');
    assert.equal(await page.locator('#teacher-courses article').count(), 3);
    await page.locator('[data-teacher-feedback-course="math"]').click();
    assert.equal(await page.locator('#teacher-feedback-course').inputValue(), 'math');
    assert.equal(await page.locator('#teacher-feedback article').count(), 0);
    assert.match(await page.locator('#teacher-feedback-status').innerText(), /近期本人意见中/);
    await page.locator('#teacher-feedback-course').selectOption('');
    assert.match(await page.locator('#teacher-feedback').innerText(), /本地演示：补充卷积变量解释/);
    assert.match(await page.locator('#teacher-feedback').innerText(), /课程组回复/);
    assert.equal(
      await page.locator('#teacher-feedback a').getAttribute('href'),
      '/knowledge?course=signals&point=SS-01-01&view=reading&tool=contribute',
    );
    await page.locator('#teacher-courses a').first().click();
    await page.waitForURL(`${origin}/course?course=signals`);
    await page.locator('[data-course-map-page]').waitFor();
    await goto('/knowledge?course=signals&point=SS-01-01&view=reading&tool=contribute');
    await page.locator('#learning-contribution-form').waitFor({ state: 'visible' });
    assert.equal(
      await page.locator('#learning-review-section').isVisible(),
      false,
      'teacher assignment does not grant review permissions',
    );
    const contribution = page.locator('#learning-contribution-form');
    await contribution.locator('[name="category"]').selectOption('improvement');
    await contribution.locator('[name="title"]').fill('演示浏览器：补充边界条件');
    await contribution
      .locator('[name="content"]')
      .fill('建议补充这个结论依赖的边界条件，并给出不适用时的反例。');
    await contribution.getByRole('button', { name: '提交给课程组', exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('#learning-contribution-form .learning-form-status')
        .textContent.includes('已提交给课程组'),
    );
    await goto('/teachers?as=teacher');
    await page.getByText('演示浏览器：补充边界条件', { exact: true }).waitFor();
    assert.match(await page.locator('#teacher-feedback').innerText(), /待处理/);
    report.checks.push(
      'Verified teacher opens real course and submits a pending suggestion shown in own workspace; assignment grants no review',
    );
    stage = 'unverified teacher application';
    await goto('/teachers?as=unverified');
    await page.waitForFunction(() =>
      document.getElementById('teacher-status').textContent.includes('尚未核实'),
    );
    assert.equal(await page.locator('#teacher-courses-section').isVisible(), false);
    await page.locator('#teacher-certify').click();
    await page.waitForURL(`${origin}/settings?certification=teacher#certifications`);
    await page.waitForFunction(
      () =>
        document.querySelector('#certification-kind').value === 'teacher' &&
        !document.querySelector('#certification-submit').disabled,
    );
    assert.equal(preview.certificationRequests.length, 0, 'deep link never submits automatically');
    report.checks.push(
      'Unverified teacher reaches preselected teacher certification without automatic submission',
    );
    stage = 'automatic identity without repeated application';
    await goto('/settings?as=teacher#certifications');
    await page.getByText('电子工程系 · 教师', { exact: true }).waitFor();
    assert.equal(await page.locator('#certification-form').isVisible(), false);
    await goto('/settings?as=student#certifications');
    await page.getByText('2026 · 电子工程系 · 本科生', { exact: true }).waitFor();
    assert.equal(await page.locator('#certification-form').isVisible(), false);
    await page.locator('#certification-add').click();
    assert.equal(
      await page
        .locator('#certification-kind option[value="undergraduate"]')
        .evaluate((option) => option.disabled && option.hidden),
      true,
    );
    await page.locator('#certification-kind').focus();
    await page.keyboard.press('Home');
    assert.notEqual(await page.locator('#certification-kind').inputValue(), 'undergraduate');
    const requestsBeforeDuplicate = preview.certificationRequests.length;
    await page.locator('#certification-kind').selectOption('undergraduate');
    assert.equal(await page.locator('#certification-submit').isDisabled(), true);
    await page.locator('#certification-form').evaluate((form) => form.requestSubmit());
    assert.equal(preview.certificationRequests.length, requestsBeforeDuplicate);
    await goto('/settings?as=graduate#certifications');
    await page.getByText('2026 · 电子工程系 · 硕士研究生', { exact: true }).waitFor();
    await page.locator('#certification-add').click();
    await page.locator('#certification-kind').selectOption('undergraduate');
    assert.equal(await page.locator('#certification-year').inputValue(), '');
    assert.equal(await page.locator('#certification-institution').inputValue(), '');
    report.checks.push(
      'Teacher identity stays compact; bound student identities skip duplicate requests and history fields start blank',
    );
    stage = 'admin standalone course association';
    await goto('/adminusers?as=admin');
    await page.locator('[data-user-id="2"] [data-teaching-user]').waitFor({ state: 'visible' });
    await page.locator('[data-user-id="2"] [data-teaching-user]').click();
    await page.locator('#teaching-form').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#teaching-save').isEnabled(), false);
    await page.locator('#teaching-options input[value="circuits"]').check();
    await page.locator('#teaching-options input[value="math"]').uncheck();
    await page.locator('#teaching-confirmed').check();
    await page.locator('#teaching-save').click();
    await page.waitForFunction(() =>
      document.getElementById('teaching-status').textContent.includes('课程分配已保存'),
    );
    assert.deepEqual(preview.assignments.get(2), ['signals', 'circuits']);
    assert.equal(preview.writes.length, 1);
    assert.equal(preview.teacher.accounts.get(2).role, 'teacher');
    assert.deepEqual(preview.teacher.accounts.get(2).courseManagerSlugs, []);
    report.checks.push(
      'Admin saves only the independent confirmed teaching relation, not role or editing permissions',
    );
    stage = 'teacher logout data isolation';
    await goto('/teachers?as=teacher');
    await page.waitForFunction(
      () => document.querySelectorAll('#teacher-courses article').length === 2,
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#user-logout-button').evaluate((button) => button.click());
    await page.locator('#teacher-signin').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#teacher-courses article').count(), 0);
    assert.equal(await page.locator('#teacher-feedback article').count(), 0);
    report.checks.push('Real logout handler clears all personal teacher cards immediately');
    stage = 'revoked teacher old associations clear-only';
    preview.teacher.accounts.get(2).role = 'student';
    await goto('/adminusers?as=admin');
    await page.locator('[data-user-id="2"] [data-teaching-user]').waitFor({ state: 'visible' });
    await page.locator('[data-user-id="2"] [data-teaching-user]').click();
    await page.getByRole('button', { name: '清除旧分配', exact: true }).waitFor();
    assert.equal(await page.locator('#teaching-options input:not(:disabled)').count(), 0);
    await page.locator('#teaching-confirmed').check();
    await page.locator('#teaching-save').click();
    await page.waitForFunction(() =>
      document.getElementById('teaching-status').textContent.includes('旧课程分配已清除'),
    );
    assert.deepEqual(preview.assignments.get(2), []);
    preview.teacher.accounts.get(2).role = 'teacher';
    preview.assignments.set(2, ['signals', 'circuits']);
    report.checks.push('Revoked teacher associations can only be explicitly cleared, not expanded');
    stage = 'BFCache token removal';
    await goto('/teachers?as=teacher');
    await page.waitForFunction(
      () => document.querySelectorAll('#teacher-courses article').length === 2,
    );
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      localStorage.removeItem('free_bbs_auth_token');
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    assert.equal(await page.locator('#teacher-courses article').count(), 0);
    assert.equal(await page.locator('#teacher-feedback article').count(), 0);
    assert.equal(await page.locator('#teacher-signin').isVisible(), true);
    report.checks.push(
      'BFCache restoration with removed storage token does not restore frozen teacher data',
    );
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        for (const route of ['/about?as=guest', '/teachers?as=teacher']) {
          stage = `layout ${theme}/${width}/${route}`;
          const layoutStage = stage;
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((mode) => localStorage.setItem('free_bbs_theme_mode', mode), theme);
          await goto(route);
          if (route.startsWith('/teachers'))
            await page.waitForFunction(() =>
              document.getElementById('teacher-status').textContent.includes('教师身份已核实'),
            );
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          );
          assert.equal(overflow, false, stage);
          const images = page.locator('main img:visible');
          for (let index = 0; index < (await images.count()); index += 1) {
            const image = images.nth(index);
            await image.scrollIntoViewIfNeeded();
            await image.evaluate((element) => element.decode());
            assert.equal(
              await image.evaluate((element) => element.complete && element.naturalWidth > 0),
              true,
              `${stage}: displayed illustration must actually load`,
            );
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          const brokenImages = await page
            .locator('main img')
            .evaluateAll((elements) =>
              elements
                .filter((image) => image.complete && image.naturalWidth === 0)
                .map((image) => image.src),
            );
          assert.deepEqual(brokenImages, [], stage);
          const contrast = await page
            .locator('main a.bbs-action[data-action-tone="primary"]')
            .evaluateAll((links) => {
              const canvas = document.createElement('canvas');
              canvas.width = 1;
              canvas.height = 1;
              const drawing = canvas.getContext('2d', { willReadFrequently: true });
              const luminance = (value) => {
                drawing.clearRect(0, 0, 1, 1);
                drawing.fillStyle = value;
                drawing.fillRect(0, 0, 1, 1);
                const rgb = Array.from(drawing.getImageData(0, 0, 1, 1).data)
                  .slice(0, 3)
                  .map((channel) => {
                    const normalized = channel / 255;
                    return normalized <= 0.04045
                      ? normalized / 12.92
                      : ((normalized + 0.055) / 1.055) ** 2.4;
                  });
                return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
              };
              return links.map((link) => {
                const style = getComputedStyle(link);
                const foreground = luminance(style.color);
                const background = luminance(style.backgroundColor);
                return {
                  text: link.textContent.trim(),
                  ratio:
                    (Math.max(foreground, background) + 0.05) /
                    (Math.min(foreground, background) + 0.05),
                };
              });
            });
          contrast.forEach((button) =>
            assert.ok(
              button.ratio >= 4.5,
              `${layoutStage}: ${button.text} contrast ${button.ratio}`,
            ),
          );
          assert.ok(contrast.length, `${stage}: shared primary CTA exists`);
          report.layouts.push({ theme, width, route, overflow, contrast });
          const name = `${route.startsWith('/about') ? 'about' : 'teachers'}-${theme}-${width}.png`;
          await page.screenshot({ path: path.join(output, name), fullPage: true });
          report.screenshots.push(name);
        }
      }
    }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.offOrigin, []);
    report.checks.push(
      'About and teacher pages fit light/dark desktop and 390px with intact illustrations',
    );
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  } catch (error) {
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify({ stage, message: error.message, ...report }, null, 2),
    );
    if (activePage)
      await activePage
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {});
    error.message = `${stage}: ${error.message}`;
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
