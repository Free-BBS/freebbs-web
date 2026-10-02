// Fresh loopback preview and fictional accounts only; no production API or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createIdentityUsabilityPreview } = require('./preview-identity-usability');

(async () => {
  const preview = await createIdentityUsabilityPreview();
  const { server } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output =
    process.env.IDENTITY_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-identity-ui-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    for (const context of [studentContext, adminContext]) {
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    }
    const student = await studentContext.newPage();
    const admin = await adminContext.newPage();
    const studentReady = async () => {
      await student.waitForFunction(
        () =>
          !document.getElementById('certification-refresh').disabled &&
          document.getElementById('certification-status').textContent.startsWith('已认证'),
      );
    };
    const adminReady = async () => {
      await admin.waitForFunction(
        () =>
          !document.getElementById('certifications').hidden &&
          !document.getElementById('admin-certification-refresh').disabled,
      );
    };
    await student.goto(`${origin}/settings?demo=student`);
    await studentReady();
    assert.equal(await student.locator('#certification-kind').inputValue(), 'undergraduate');
    assert.equal(await student.locator('#certification-year').inputValue(), '2021');
    assert.equal(
      await student.locator('#certification-institution').inputValue(),
      '清华大学电子系',
    );
    assert.match(await student.locator('#certification-suggestion').innerText(), /已绑定学号/);
    await admin.goto(`${origin}/adminusers?demo=admin`);
    await adminReady();
    assert.deepEqual(
      await admin.evaluate(() => ({
        role: window.freeBbsApp.userState.role,
        isAdmin: window.freeBbsApp.userState.isAdmin,
      })),
      { role: 'teacher', isAdmin: true },
    );

    const submit = async (kind, values = {}) => {
      await student.locator('#certification-kind').selectOption(kind);
      for (const [name, value] of Object.entries(values))
        await student.locator(`#certification-${name}`).fill(value);
      await student.locator('#certification-submit').click();
      await student.waitForFunction(() =>
        document.getElementById('certification-message').textContent.includes('已提交'),
      );
      await studentReady();
      assert.equal(await student.locator('#certification-submit').isDisabled(), true);
    };
    const review = async (action, note = '') => {
      await admin.locator('#admin-certification-refresh').click();
      await adminReady();
      const card = admin.locator('.certification-review').first();
      await card.waitFor();
      assert.equal(await card.locator('[data-review-action="approve"]').isDisabled(), true);
      if (note) await card.locator('textarea').fill(note);
      if (action === 'approve') {
        await card.locator('[data-identity-confirmed]').check();
        assert.equal(await card.locator('[data-review-action="approve"]').isDisabled(), false);
      }
      await card.locator(`[data-review-action="${action}"]`).click();
      await admin.waitForFunction(() =>
        document.getElementById('admin-certification-status').textContent.includes('已处理'),
      );
      await adminReady();
      await student.locator('#certification-refresh').click();
      await studentReady();
    };
    await submit('undergraduate', { institution: '例示大学电子工程学院', class: '甲班' });
    assert.equal(await student.locator('#certification-approved .certification-entry').count(), 0);
    assert.match(await student.locator('#certification-requests').innerText(), /等待审核/);
    assert.ok(
      preview.notices.some(
        (notice) => notice.userId === 1 && notice.link === '/adminusers#certifications',
      ),
    );
    await review('reject', '请核对院系信息');
    assert.match(await student.locator('#certification-requests').innerText(), /请核对院系信息/);
    assert.equal(await student.locator('#certification-approved .certification-entry').count(), 0);
    await submit('undergraduate', {
      institution: '例示大学电子工程学院',
      year: '2021',
      class: '甲班',
    });
    await review('approve');
    assert.equal(await student.locator('#certification-approved .certification-entry').count(), 1);
    assert.match(
      await student.locator('#certification-approved').innerText(),
      /例示大学电子工程学院/,
    );
    assert.match(await student.locator('#certification-approved').innerText(), /2021 年/);
    await submit('undergraduate', { year: '2022', class: '乙班' });
    assert.match(await student.locator('#certification-approved').innerText(), /2021 年/);
    assert.match(await student.locator('#certification-requests').innerText(), /2022 年/);
    await review('reject', '暂保留原年级');
    assert.match(await student.locator('#certification-approved').innerText(), /2021 年/);
    for (const kind of ['master', 'doctor', 'teacher', 'company']) {
      await submit(
        kind,
        kind === 'company'
          ? { company: '例示电子有限公司' }
          : {
              institution: '例示大学电子工程学院',
              year: kind === 'teacher' ? '' : '2026',
              class: '',
            },
      );
      await review('approve');
    }
    assert.equal(await student.locator('#certification-approved .certification-entry').count(), 5);
    assert.equal(await student.evaluate(() => window.freeBbsApp.userState.role), 'student');
    const teacher = [...preview.approved.get(2).values()].find((item) => item.type === 'teacher');
    assert.equal(teacher.year, null);
    await student.locator('.notification-bell').click();
    await student.waitForFunction(() =>
      document.querySelector('.notification-list')?.textContent.includes('认证审核结果'),
    );
    await student.locator('.notification-item-button').first().click();
    await student.waitForURL(`${origin}/settings#certifications`);
    await studentReady();
    assert.equal(await student.locator('#certification-approved .certification-entry').count(), 5);
    await submit('company', { company: `${'X'.repeat(120)}公司` });
    await submit('master', {
      institution: `${'ElectronicEngineering'.repeat(5)}学院`,
      year: '2026',
    });
    await admin.locator('#admin-certification-refresh').click();
    await adminReady();
    assert.equal(await admin.locator('.certification-review').count(), 2);

    const usernames = await student.evaluate(() => {
      const input = document.getElementById('settings-username');
      return ['张老师', '𠀀𠀁', 'a', 'a-b', 'a b', '张'.repeat(65), '𠀀'.repeat(64)].map(
        (value) => {
          input.value = value;
          return {
            value,
            valid: input.checkValidity(),
            patternMismatch: input.validity.patternMismatch,
          };
        },
      );
    });
    assert.deepEqual(
      usernames.map((item) => item.valid),
      [true, true, false, false, false, false, true],
    );
    await student.locator('#settings-username').fill('演示同学');
    await student.setViewportSize({ width: 390, height: 1100 });
    await student.evaluate(() =>
      document.querySelectorAll('.personal-fold').forEach((fold) => {
        fold.open = false;
      }),
    );
    await student.locator('.settings-jump-links a[href="#settings-reading"]').click();
    assert.equal(
      await student
        .locator('#settings-reading')
        .evaluate((node) => node.closest('.personal-fold').open),
      true,
    );
    let checked = 0;
    for (const page of [student, admin]) {
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate(async (mode) => {
            if (document.body.classList.contains('theme-light') !== (mode === 'light'))
              window.freeBbsApp.toggleThemeMode();
            window.freeBbsTypography.applyPreferences({
              fontPreset: 'zhongsong-study',
              typeScale: 'large',
            });
            document.querySelectorAll('.personal-fold').forEach((fold) => {
              fold.open = true;
            });
            window.scrollTo(0, 0);
            await document.fonts.ready;
            await new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
          }, theme);
          const bounds = await page.evaluate(() => {
            const root = document.documentElement;
            const panels = [
              ...document.querySelectorAll('.settings-column > *, #certifications'),
            ].map((node) => ({ id: node.id, ...node.getBoundingClientRect().toJSON() }));
            const columns = [...document.querySelectorAll('.settings-column')].map((node) =>
              node.getBoundingClientRect().toJSON(),
            );
            return { scrollWidth: root.scrollWidth, viewport: window.innerWidth, panels, columns };
          });
          const label = `${page === student ? 'settings' : 'admin'} ${width} ${theme}`;
          assert.ok(
            bounds.scrollWidth <= width + 1,
            `${label}: horizontal overflow ${JSON.stringify(bounds)}`,
          );
          assert.ok(
            bounds.panels.every((panel) => panel.right <= width + 1 && panel.left >= -1),
            `${label}: panels fit viewport`,
          );
          if (page === student && width >= 1440) {
            assert.ok(
              bounds.columns[1].left > bounds.columns[0].right,
              `${label}: two independent desktop columns`,
            );
            assert.ok(
              bounds.columns[0].width >= 480,
              `${label}: profile uses available desktop width`,
            );
          }
          if ([390, 1440, 1920].includes(width))
            await page.screenshot({
              path: path.join(
                output,
                `${page === student ? 'settings' : 'admin'}-${width}-${theme}.png`,
              ),
              fullPage: true,
            });
          checked += 1;
        }
      }
    }
    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
    console.log(
      `Certification UI passed: suggestion, reject/approve, retained identity, five slots, notification, Unicode usernames, ${checked} responsive/theme views. Screenshots: ${output}`,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
