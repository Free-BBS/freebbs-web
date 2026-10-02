const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createStaffTeacherCalendarPreview } = require('./preview-staff-teacher-calendar');
const { DEMO_PASSWORD, DEMO_CODE } = require('./preview-teacher-accounts');

async function main() {
  const preview = await createStaffTeacherCalendarPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-staff-teacher-calendar-'));
  const errors = [];
  const report = { checks: [], layouts: [], screenshots: [] };
  let browser;
  let stage = 'start';
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) =>
      route.request().url().startsWith(`${base}/`) || /^(data:|blob:)/.test(route.request().url())
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const goto = async (route) => {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => window.freeBbsApp?.sessionReady);
      if (await page.locator('.max-tour[open]').count())
        await page.getByText('稍后再看', { exact: true }).click();
    };
    stage = 'admin creates unbound teacher';
    await goto('/adminusers?demo=admin');
    await page.click('#admin-add-user');
    const draft = page.locator('.admin-user-row-draft');
    await draft.locator('[data-field="username"]').fill('new_demo_teacher');
    await draft.locator('[data-field="fullName"]').fill('演示新教师');
    await draft.locator('[data-field="role"]').selectOption('teacher');
    const initialPassword = 'InitialPreview42!';
    await draft.locator('[data-field="password"]').fill(initialPassword);
    await draft.locator('[data-action="create"]').click();
    await page.locator('.admin-account-dialog[open]').waitFor();
    const delivered = await page.locator('[aria-label="初始登录信息"]').inputValue();
    assert.match(delivered, /new_demo_teacher/);
    assert.ok(delivered.includes(initialPassword));
    const created = [...preview.teacher.accounts.values()].find(
      (user) => user.username === 'new_demo_teacher',
    );
    assert.equal(created.studentId, null);
    assert.equal(created.email, null);
    await page.getByText('关闭并清除', { exact: true }).click();
    assert.equal(await page.locator('.admin-account-dialog').count(), 0);
    assert.equal(
      await page.evaluate(
        (password) => JSON.stringify({ ...localStorage }).includes(password),
        initialPassword,
      ),
      false,
    );
    report.checks.push(
      'Admin creates teacher with no email/student ID; delivery clears and never enters localStorage',
    );

    stage = 'teacher binds email and changes username';
    await goto('/settings?demo=teacher');
    await page.waitForFunction(() => !document.querySelector('#settings-email-code').disabled);
    const emailForm = page.locator('#settings-email-form');
    await emailForm.locator('[name="email"]').fill('demo-teacher@example.invalid');
    await emailForm.locator('[name="currentPassword"]').fill(DEMO_PASSWORD);
    await page.click('#settings-email-code');
    await page.waitForFunction(() =>
      document.querySelector('#settings-email-message').textContent.includes('246810'),
    );
    await emailForm.locator('[name="emailCode"]').fill(DEMO_CODE);
    await emailForm.locator('[type="submit"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#settings-identity-status').textContent.includes('已验证'),
    );
    assert.equal(await emailForm.locator('[name="currentPassword"]').inputValue(), '');
    assert.equal(await emailForm.locator('[name="emailCode"]').inputValue(), '');
    await page.fill('#settings-username', 'renamed_demo_teacher');
    await page.click('#settings-username-submit');
    await page.waitForFunction(() =>
      document.querySelector('#settings-username-message').textContent.includes('免费'),
    );
    assert.equal(preview.teacher.accounts.get(2).username, 'renamed_demo_teacher');
    report.checks.push('Teacher verifies email and changes login username for free');

    stage = 'student ID awaits administrator review';
    const studentForm = page.locator('#settings-student-form');
    await studentForm.locator('[name="studentId"]').fill('2099123456');
    await studentForm.locator('[name="currentPassword"]').fill(DEMO_PASSWORD);
    await studentForm.locator('[type="submit"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#settings-identity-status').textContent.includes('等待管理员核验'),
    );
    assert.equal(preview.teacher.accounts.get(2).studentId, null);
    await goto('/adminusers?demo=admin');
    const requestList = page.locator('#admin-student-request-list');
    await requestList.getByText(/2099123456/).waitFor();
    await requestList.locator('input[type="checkbox"]').check();
    await requestList.getByText('批准绑定', { exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#admin-student-request-list').textContent.includes('暂无待核验'),
    );
    assert.equal(preview.teacher.accounts.get(2).studentId, '2099123456');
    report.checks.push('Student ID remains unbound until administrator confirms ownership');

    stage = 'teacher changes password and logs in under new username';
    await goto('/settings?demo=teacher');
    await page.fill('#settings-current-password', DEMO_PASSWORD);
    await page.fill('#settings-new-password', 'ChangedPreview42!');
    await page.fill('#settings-new-password-confirm', 'ChangedPreview42!');
    await page.locator('#settings-password-form [type="submit"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#settings-password-message').textContent.includes('已修改'),
    );
    await goto('/login');
    await page.fill('#auth-identifier', 'renamed_demo_teacher');
    await page.fill('#auth-password', 'ChangedPreview42!');
    await page.click('#auth-submit');
    await page.waitForURL((url) => url.pathname === '/');
    await page.waitForFunction(() => window.freeBbsApp?.userState.isLoggedIn);
    report.checks.push('New username and password log in successfully through the real auth form');

    stage = 'verified email supports password recovery without student ID';
    await goto('/remake');
    await page.selectOption('#auth-reset-method', 'studentId');
    assert.equal(await page.locator('#auth-reset-identifier').isDisabled(), true);
    assert.equal(await page.locator('#auth-student-id').isDisabled(), false);
    await page.selectOption('#auth-reset-method', 'username');
    assert.equal(await page.locator('#auth-reset-identifier').isDisabled(), false);
    assert.equal(await page.locator('#auth-student-id').isDisabled(), true);
    await page.fill('#auth-reset-identifier', 'renamed_demo_teacher');
    await page.fill('#auth-email', 'demo-teacher@example.invalid');
    await page.click('#send-email-code');
    await page.waitForFunction(() =>
      document.querySelector('#auth-message').textContent.includes('246810'),
    );
    await page.fill('#auth-email-code', DEMO_CODE);
    await page.fill('#auth-password', 'RecoveredPreview42!');
    await page.fill('#auth-password-confirm', 'RecoveredPreview42!');
    await page.click('#auth-submit');
    await page.waitForURL((url) => url.pathname === '/');
    await goto('/login');
    await page.fill('#auth-identifier', 'renamed_demo_teacher');
    await page.fill('#auth-password', 'RecoveredPreview42!');
    await page.click('#auth-submit');
    await page.waitForURL((url) => url.pathname === '/');
    report.checks.push(
      'Password recovery switches identity fields and verifies email before resetting',
    );

    stage = 'staff and handbook responsive presentation';
    for (const route of ['/staff', '/guide', '/settings?demo=teacher']) {
      await goto(route);
      if (route === '/guide') {
        assert.equal(await page.locator('.guide-place').count(), 3);
        assert.equal(await page.locator('[data-guide-station]').count(), 5);
        assert.equal(
          await page.locator('#guide-horizon, #guide-missions, .guide-economy-card').count(),
          0,
        );
      }
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        assert.equal(overflow, false, `${route} overflows at ${width}`);
        report.layouts.push({ route, width, overflow });
      }
      const screenshot = path.join(output, `${route.split('?')[0].slice(1)}.png`);
      await page.screenshot({ path: screenshot });
      report.screenshots.push(screenshot);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  } catch (error) {
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
