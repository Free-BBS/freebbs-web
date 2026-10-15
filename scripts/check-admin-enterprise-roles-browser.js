// Exercise the real admin editor against a fresh loopback-only memory preview.
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
    process.env.IDENTITY_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-enterprise-ui-'));
  fs.mkdirSync(output, { recursive: true });
  const education = {
    type: 'education',
    education: 'undergraduate',
    year: 2021,
    institution: '清华大学电子系',
    className: '示例班',
    companyName: '',
    label: '2021 清华大学电子系 本科',
  };
  const approved = new Map([['undergraduate', education]]);
  preview.approved.set(2, approved);
  const pendingCompany = () => {
    const request = {
      id: preview.requests.length + 1,
      userId: 2,
      slot: 'company',
      status: 'pending',
    };
    preview.requests.push(request);
    return request;
  };
  const originalRequest = pendingCompany();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const payloads = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && /\/api\/admin\/users\/2$/.test(request.url()))
        payloads.push(request.postDataJSON());
    });
    const card = page.locator('.admin-user-row[data-user-id="2"]');
    const company = card.locator('[data-field="companyName"]');
    const role = card.locator('[data-field="role"]');
    const loadEditor = async () => {
      await page.goto(`${origin}/adminusers?demo=admin`);
      await card.waitFor();
      await card.locator('[data-admin-ui-action="toggle-editor"]').click();
    };
    const save = async () => {
      const response = page.waitForResponse(
        (item) => item.request().method() === 'PATCH' && /\/api\/admin\/users\/2$/.test(item.url()),
      );
      await card.locator('[data-action="save"]').click();
      assert.equal((await response).status(), 200);
      await card.locator('[data-action="save"]').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const row = document.querySelector('.admin-user-row[data-user-id="2"]');
        return !row.classList.contains('is-saving') && !row.classList.contains('is-dirty');
      });
    };
    await loadEditor();
    assert.equal(await company.isVisible(), false);
    await role.selectOption('enterprise');
    assert.equal(await company.isVisible(), true);
    assert.equal(
      await company.inputValue(),
      '',
      'a personal name must never become a company guess',
    );
    assert.match(await card.locator('[data-admin-company-note]').innerText(), /核实企业全称/);
    for (const invalid of ['', '司', 'X'.repeat(129)]) {
      await company.fill(invalid);
      await card.locator('[data-action="save"]').click();
      assert.equal(payloads.length, 0, 'invalid company names must not reach the PATCH endpoint');
      assert.match(await card.locator('.admin-user-card-status').innerText(), /2–128/);
    }
    await company.fill('  示例科技有限公司  ');
    await save();
    assert.equal(payloads[0].companyName, '示例科技有限公司');
    assert.equal(payloads[0].fullName, '演示同学');
    assert.equal(preview.teacher.accounts.get(2).role, 'enterprise');
    assert.equal(approved.get('company').companyName, '示例科技有限公司');
    assert.equal(originalRequest.status, 'rejected');
    assert.deepEqual(approved.get('undergraduate'), education);
    assert.equal(
      await company.inputValue(),
      '示例科技有限公司',
      'saved field shows the actual approved name',
    );
    await loadEditor();
    assert.equal(
      await company.inputValue(),
      '示例科技有限公司',
      'the verified company wins over the personal name',
    );
    const renameRequest = pendingCompany();
    await company.fill('𠀀'.repeat(128));
    await save();
    assert.equal(
      Array.from(approved.get('company').companyName).length,
      128,
      'Unicode codepoints, not UTF-16 units',
    );
    assert.equal(renameRequest.status, 'rejected');
    await company.fill('示例科技股份有限公司');
    await save();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      const bounds = await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(bounds.scroll <= bounds.width + 1, `company editor fits ${width}px`);
      await card.locator('[data-admin-company-field]').evaluate((node) => {
        node.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
      await page.screenshot({ path: path.join(output, `enterprise-editor-${width}.png`) });
    }
    const downgradeRequest = pendingCompany();
    await role.selectOption('teacher');
    assert.equal(await company.isVisible(), false);
    assert.match(await card.locator('[data-admin-company-note]').innerText(), /移除企业认证/);
    await save();
    assert.equal(
      Object.hasOwn(payloads.at(-1), 'companyName'),
      false,
      'hidden company field is omitted',
    );
    assert.equal(approved.has('company'), false);
    assert.equal(downgradeRequest.status, 'rejected');
    assert.deepEqual(approved.get('undergraduate'), education, 'education survives the downgrade');
    assert.equal(await company.inputValue(), '', 'removed company name is cleared after save');
    approved.set('company', {
      type: 'company',
      companyName: '自主认证企业',
      label: '自主认证企业',
    });
    await loadEditor();
    await role.selectOption('ta');
    await save();
    assert.equal(
      approved.get('company').companyName,
      '自主认证企业',
      'unrelated roles preserve independent certification',
    );
    await loadEditor();
    await role.selectOption('enterprise');
    assert.equal(await company.inputValue(), '自主认证企业');
    await save();
    assert.equal(payloads.at(-1).companyName, '自主认证企业');
    approved.delete('company');
    preview.teacher.accounts.get(2).fullName = '遗留企业名称';
    await loadEditor();
    assert.equal(
      await company.inputValue(),
      '遗留企业名称',
      'legacy enterprise name is offered for admin verification',
    );
    assert.match(await card.locator('[data-admin-company-note]').innerText(), /核实后保存/);
    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
    console.log(
      `Enterprise admin UI passed: no personal-name guessing, validation, promotion, verified-name reload, rename, pending closure, downgrade, education retention, unrelated role transitions, 128 Unicode codepoints, responsive screenshots: ${output}`,
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
