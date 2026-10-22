// Production settings controllers against a fictional, loopback-only preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createAboutTeachersPreview } = require('./preview-about-teachers');
const { DEMO_CODE, DEMO_PASSWORD } = require('./preview-teacher-accounts');

async function main() {
  const preview = createAboutTeachersPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.SETTINGS_IDENTITY_QA_DIR ||
    path.resolve(
      __dirname,
      '../output/settings-identity',
      new Date().toISOString().replace(/[:.]/g, '-'),
    );
  fs.mkdirSync(output, { recursive: true });
  const report = { layouts: [], checks: [], pageErrors: [], offOrigin: [] };
  let browser;
  let page;
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
    page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    const load = async () => {
      await page.goto(`${origin}/settings?as=teacher&qa=${Date.now()}#certifications`, {
        waitUntil: 'networkidle',
      });
      await page.evaluate(() => window.freeBbsApp.sessionReady);
      await page.getByText('电子工程系 · 教师', { exact: true }).waitFor();
    };
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await load();
        await page.evaluate((mode) => {
          window.freeBbsTheme.saveMode(mode);
          window.freeBbsTheme.applyMode(mode);
          const fold = document.getElementById('settings-form').closest('details');
          if (fold) fold.open = true;
        }, theme);
        const structure = await page.evaluate(() => {
          const card = document.getElementById('certifications');
          const bindings = document.getElementById('settings-identity');
          const forms = ['settings-email-form', 'settings-student-form', 'certification-form'].map(
            (id) => {
              const form = document.getElementById(id);
              return {
                id,
                count: document.querySelectorAll(`#${id}`).length,
                nested: Boolean(form.parentElement.closest('form')),
                inCard: card.contains(form),
              };
            },
          );
          return {
            titles: [...card.querySelectorAll('h2')].map((node) => node.textContent.trim()),
            innerAnchor: bindings.parentElement === card,
            navOld: document.querySelectorAll('.settings-jump-links a[href="#settings-identity"]')
              .length,
            navNew: document.querySelectorAll('.settings-jump-links a[href="#certifications"]')
              .length,
            bindingForms: bindings.querySelectorAll('form').length,
            certificationOutsideBindings: !bindings.contains(
              document.getElementById('certification-form'),
            ),
            forms,
            loadedShell: [...document.styleSheets].some((sheet) =>
              sheet.href?.endsWith('/personal-polish.css'),
            ),
          };
        });
        assert.deepEqual(structure.titles, ['身份认证']);
        assert.equal(structure.innerAnchor, true);
        assert.equal(structure.navOld, 0);
        assert.equal(structure.navNew, 1);
        assert.equal(structure.bindingForms, 2);
        assert.equal(structure.certificationOutsideBindings, true);
        assert.equal(structure.loadedShell, true);
        assert.ok(structure.forms.every((form) => form.count === 1 && !form.nested && form.inCard));
        assert.equal(await page.locator('#settings-email-binding').getAttribute('open'), null);
        assert.equal(await page.locator('#settings-student-binding').getAttribute('open'), null);
        const toolbarLayout = await page.locator('.certification-toolbar').evaluate((toolbar) => {
          const box = (node) => {
            const rect = node.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
            };
          };
          const actions = toolbar.querySelector('.certification-toolbar-actions');
          const count = toolbar.querySelector('#certification-status');
          const add = actions.querySelector('#certification-add');
          const refresh = actions.querySelector('#certification-refresh');
          return {
            toolbar: box(toolbar),
            count: box(count),
            actions: box(actions),
            add: box(add),
            refresh: box(refresh),
            order: [...actions.children].map((node) => node.id),
            wrapped: actions.getBoundingClientRect().top >= count.getBoundingClientRect().bottom,
            oldAddRows: document.querySelectorAll('.certification-add-row').length,
          };
        });
        const label = `${theme}/${width}`;
        assert.deepEqual(toolbarLayout.order, ['certification-add', 'certification-refresh']);
        assert.equal(toolbarLayout.oldAddRows, 0, `${label} has no obsolete extra button row`);
        assert.ok(toolbarLayout.add.right < toolbarLayout.refresh.left, `${label} button order`);
        assert.ok(
          Math.abs(toolbarLayout.add.top - toolbarLayout.refresh.top) <= 1,
          `${label} action buttons stay on the same line`,
        );
        assert.ok(
          Math.abs(toolbarLayout.add.height - toolbarLayout.refresh.height) <= 1 &&
            toolbarLayout.add.height >= 44,
          `${label} action buttons have matching accessible heights`,
        );
        assert.ok(
          Math.abs(toolbarLayout.actions.right - toolbarLayout.toolbar.right) <= 1,
          `${label} action group is right aligned`,
        );
        assert.ok(
          Math.abs(toolbarLayout.count.left - toolbarLayout.toolbar.left) <= 1,
          `${label} identity count is left aligned`,
        );
        assert.ok(
          toolbarLayout.add.left >= toolbarLayout.toolbar.left - 1 &&
            toolbarLayout.refresh.right <= toolbarLayout.toolbar.right + 1,
          `${label} neither action overflows its toolbar`,
        );
        if (width > 900)
          assert.equal(toolbarLayout.wrapped, false, `${label} desktop stays one row`);
        if (toolbarLayout.wrapped) {
          assert.ok(
            toolbarLayout.actions.top >= toolbarLayout.count.bottom + 8,
            `${label} wrapped actions have breathing room below the count`,
          );
        } else {
          assert.ok(
            toolbarLayout.add.left >= toolbarLayout.count.right + 8,
            `${label} inline actions do not crowd the count`,
          );
        }
        await page.locator('#certification-add').click();
        const editorLayout = await page.evaluate(() => {
          const title = document
            .querySelector('.certification-editor-heading')
            .getBoundingClientRect();
          const kind = document.getElementById('certification-kind').getBoundingClientRect();
          const institution = document
            .getElementById('certification-institution')
            .getBoundingClientRect();
          const entryStyle = getComputedStyle(
            document.querySelector('#certification-approved .certification-entry'),
          );
          return {
            titleBottom: title.bottom,
            kindTop: kind.top,
            institutionTop: institution.top,
            heightDifference: kind.height - institution.height,
            border: entryStyle.borderTopWidth,
            background: entryStyle.backgroundColor,
          };
        });
        assert.ok(editorLayout.titleBottom <= editorLayout.kindTop, 'editor title has its own row');
        assert.ok(Math.abs(editorLayout.heightDifference) <= 1);
        if (width > 1180)
          assert.ok(Math.abs(editorLayout.kindTop - editorLayout.institutionTop) <= 1);
        assert.equal(editorLayout.border, '0px');
        assert.equal(editorLayout.background, 'rgba(0, 0, 0, 0)');
        await page.locator('#certification-cancel').click();
        const geometry = await page.evaluate(() => {
          const measure = (id) => {
            const node = document.getElementById(id);
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              top: rect.top,
              height: rect.height,
              background: style.backgroundColor,
              radius: style.borderRadius,
              padding: style.padding,
            };
          };
          const name = measure('settings-full-name');
          const website = measure('settings-website-url');
          return {
            name,
            website,
            topDifference: website.top - name.top,
            heightDifference: website.height - name.height,
            avatar: measure('settings-avatar-editor'),
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        });
        assert.equal(geometry.overflow, false, `${theme}/${width}`);
        assert.ok(Math.abs(geometry.heightDifference) <= 1, `${theme}/${width} input heights`);
        if (width > 900) {
          assert.ok(
            Math.abs(geometry.topDifference) <= 1,
            `${theme}/${width} paired input alignment`,
          );
          assert.equal(
            geometry.avatar.background,
            theme === 'light' ? 'rgb(252, 250, 245)' : 'rgb(23, 42, 48)',
          );
          assert.equal(geometry.avatar.radius, '14px');
          assert.equal(geometry.avatar.padding, '24px');
        } else {
          assert.ok(
            geometry.topDifference > geometry.name.height,
            'mobile keeps intentional single-column fields',
          );
        }
        await page.locator('#settings-avatar-editor').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `profile-${theme}-${width}.png`) });
        await page
          .locator('#certifications')
          .screenshot({ path: path.join(output, `identity-${theme}-${width}.png`) });
        await page.evaluate(() => {
          window.location.hash = '#settings-identity';
        });
        assert.equal(await page.locator('#settings-email-form').isVisible(), true);
        assert.equal(await page.locator('#settings-student-form').isVisible(), true);
        report.layouts.push({ theme, width, toolbarLayout, ...geometry });
      }
    }
    report.checks.push(
      'One identity card/title/navigation destination; all three forms remain separate, with the legacy binding anchor intact',
      'Production shell restores the existing avatar treatment and exact desktop input alignment in both themes; mobile remains single-column',
      'Supplement and refresh actions stay in that order at the right edge, with the count at the left and safe wrapping down to 320px in both themes',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await load();
    await page.locator('#certification-add').click();
    await page.locator('#settings-email-binding > summary').click();
    await page.locator('#settings-student-binding > summary').click();
    let finishEmailCode;
    let emailStarted;
    const emailStartedPromise = new Promise((resolve) => {
      emailStarted = resolve;
    });
    await page.route('**/api/profile/email-code', async (route) => {
      emailStarted();
      await new Promise((resolve) => {
        finishEmailCode = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: '本地测试验证码已发送；未发送真实邮件' }),
      });
    });
    await page.locator('#settings-email-form [name=email]').fill('preview-only@tsinghua.edu.cn');
    await page.locator('#settings-email-form [name=currentPassword]').fill('SyntheticOnly42!');
    await page.locator('#settings-email-code').click();
    await emailStartedPromise;
    assert.equal(await page.locator('#settings-email-code').isDisabled(), true);
    assert.equal(await page.locator('#certification-kind').isEnabled(), true);
    assert.equal(await page.locator('#certification-cancel').isEnabled(), true);
    finishEmailCode();
    await page.getByText('本地测试验证码已发送；未发送真实邮件', { exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector('#settings-email-form [name=currentPassword]').disabled,
    );
    await page.unroute('**/api/profile/email-code');
    let finishCertification;
    let certificationStarted;
    const certificationStartedPromise = new Promise((resolve) => {
      certificationStarted = resolve;
    });
    await page.route('**/api/me/certifications', async (route) => {
      certificationStarted();
      await new Promise((resolve) => {
        finishCertification = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          automatic: [
            { type: 'teacher', verifiedName: '演示教师', automatic: true, source: 'account_role' },
          ],
          managedSlots: ['teacher'],
          approved: [],
          requests: [],
        }),
      });
    });
    await page.locator('#certification-refresh').click();
    await certificationStartedPromise;
    assert.equal(await page.locator('#certification-kind').isDisabled(), true);
    assert.equal(
      await page.locator('#settings-email-form [name=currentPassword]').isEnabled(),
      true,
    );
    assert.equal(await page.locator('#settings-student-form [name=studentId]').isEnabled(), true);
    finishCertification();
    await page.waitForFunction(() => !document.getElementById('certification-refresh').disabled);
    await page.unroute('**/api/me/certifications');
    report.checks.push(
      'Binding request and certification refresh disable only their own controller fields, not the neighboring forms',
      'All account data, suggested emails and OTP requests are fictional loopback fixtures, never production identity evidence',
    );
    for (const [role, expected, managed] of [
      ['student', '2026 · 电子工程系 · 本科生', 'undergraduate'],
      ['graduate', '2026 · 电子工程系 · 硕士研究生', 'master'],
      ['doctor', '2025 · 电子工程系 · 博士研究生', 'doctor'],
    ]) {
      await page.goto(`${origin}/settings?as=${role}#certifications`, { waitUntil: 'networkidle' });
      await page.getByText(expected, { exact: true }).waitFor();
      assert.equal(await page.locator('#certification-form').isVisible(), false);
      await page.locator('#certification-add').click();
      assert.equal(
        await page
          .locator(`#certification-kind option[value=${managed}]`)
          .evaluate((option) => option.disabled),
        true,
      );
      assert.equal(
        await page.locator(`#certification-kind option[value=${managed}]`).getAttribute('hidden'),
        '',
      );
    }
    report.checks.push(
      'All three education stages are shown on one line without a duplicate application',
    );
    await page.addInitScript(() => {
      window.settingsIdentityUpdates = [];
      window.addEventListener('freebbs:identity-updated', (event) => {
        window.settingsIdentityUpdates.push({ uid: event.detail?.user?.uid });
      });
    });
    const candidateWrites = [];
    const observeCandidateRequest = (request) => {
      const url = new URL(request.url());
      if (
        url.origin === origin &&
        ['/api/profile/email-code', '/api/profile/email', '/api/profile/student-id'].includes(
          url.pathname,
        ) &&
        ['POST', 'PATCH'].includes(request.method())
      )
        candidateWrites.push(url.pathname);
    };
    page.on('request', observeCandidateRequest);
    await page.goto(`${origin}/settings?as=student&qa=email-candidate#certifications`, {
      waitUntil: 'networkidle',
    });
    const suggestedEmail = 'preview-only-student@tsinghua.edu.cn';
    await page.waitForFunction(
      (email) => document.querySelector('#settings-email-form [name=email]').value === email,
      suggestedEmail,
    );
    assert.equal(
      await page.locator('#settings-email-binding').evaluate((panel) => panel.open),
      true,
    );
    assert.equal(await page.locator('#settings-email-summary').innerText(), '名单邮箱待验证');
    assert.match(await page.locator('#settings-identity-status').innerText(), /邮箱：未绑定/);
    assert.doesNotMatch(await page.locator('#settings-identity-status').innerText(), /已验证/);
    assert.equal(preview.teacher.accounts.get(4).email, null);
    assert.equal(preview.teacher.accounts.get(4).emailVerified, false);
    assert.equal(await page.evaluate(() => window.settingsIdentityUpdates.length), 0);
    assert.deepEqual(candidateWrites, [], 'suggestion never sends an OTP or binding request');
    await page.screenshot({ path: path.join(output, 'suggested-email-unverified.png') });
    await page.locator('#settings-email-form [name=currentPassword]').fill(DEMO_PASSWORD);
    await page.locator('#settings-email-code').click();
    await page.getByText(`本地演示验证码：${DEMO_CODE}；未发送邮件`, { exact: true }).waitFor();
    assert.deepEqual(candidateWrites, ['/api/profile/email-code']);
    assert.equal(preview.teacher.accounts.get(4).email, null, 'issuing an OTP is not verification');
    assert.equal(preview.teacher.accounts.get(4).emailVerified, false);
    assert.equal(await page.evaluate(() => window.settingsIdentityUpdates.length), 0);
    await page.locator('#settings-email-form [name=emailCode]').fill(DEMO_CODE);
    await page.locator('#settings-email-form button[type=submit]').click();
    await page.waitForFunction(
      () => document.getElementById('settings-email-summary').textContent === '已验证',
    );
    assert.deepEqual(candidateWrites, ['/api/profile/email-code', '/api/profile/email']);
    assert.equal(preview.teacher.accounts.get(4).email, suggestedEmail);
    assert.equal(preview.teacher.accounts.get(4).emailVerified, true);
    assert.match(await page.locator('#settings-identity-status').innerText(), /（已验证）/);
    assert.equal(
      await page.locator('#settings-email-form [name=currentPassword]').inputValue(),
      '',
    );
    assert.equal(await page.locator('#settings-email-form [name=emailCode]').inputValue(), '');
    assert.equal(
      await page.locator('#settings-email-binding').evaluate((panel) => panel.open),
      true,
    );
    assert.deepEqual(await page.evaluate(() => window.settingsIdentityUpdates), [
      { uid: preview.teacher.accounts.get(4).uid },
    ]);
    await page.screenshot({ path: path.join(output, 'suggested-email-verified.png') });
    page.off('request', observeCandidateRequest);
    report.checks.push(
      'A unique fictional school-mail suggestion prefills and opens its panel, but remains unbound with no OTP request or identity event',
      'Explicit local OTP issuance still does not verify the address; only successful OTP submission binds it, emits one current-account update and clears secrets',
    );
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.offOrigin, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
    await context.close();
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    preview.server.closeAllConnections?.();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
