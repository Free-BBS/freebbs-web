import { expect, test, type APIRequestContext } from '@playwright/test';
const api = '/api/development/v1';
const sportsHome = `${api}/organizations/student_union/sports_center/home`;
const headers = { 'X-Demo-User': 'demo-sports-member' };
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#e0f2fe;color:#123}button{padding:12px}#tall{height:1100px}</style></head><body><h1>浏览器部门主页</h1><button onclick="document.getElementById('result').textContent='点击成功'">文档交互</button><p id="result">等待点击</p><p id="isolation"></p><script>let checks=[];try{parent.document.body.dataset.escaped='yes';checks.push('dom escaped')}catch{checks.push('DOM blocked')}try{localStorage.setItem('escaped','yes');checks.push('storage escaped')}catch{checks.push('storage blocked')}try{top.location='/department-escape';checks.push('navigation escaped')}catch{checks.push('navigation blocked')}fetch('/api/development/v1/me').then(()=>checks.push('fetch escaped')).catch(()=>{checks.push('network blocked');document.getElementById('isolation').textContent=checks.join(',')});document.getElementById('isolation').textContent=checks.join(',');</script></body></html>`;
async function home(request: APIRequestContext) {
  const response = await request.get(sportsHome, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
async function put(request: APIRequestContext, contents: string, filename = '部门主页-é.html') {
  const current = await home(request);
  const response = await request.put(sportsHome, {
    headers,
    multipart: {
      revision: String(current.revision),
      file: { name: filename, mimeType: 'text/html', buffer: Buffer.from(contents) },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
async function member(page: import('@playwright/test').Page) {
  await page.getByLabel('预览身份 / Demo user').selectOption('demo-sports-member');
  await expect(page.getByLabel('选择 HTML 文件')).toBeVisible();
}

test('member previews, confirms, runs inline JS in opaque isolation, and identity switch discards an unsaved preview', async ({
  page,
  request,
}) => {
  const original = await home(request);
  try {
    await page.goto('./organizations/student_union/sports_center', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByLabel('选择 HTML 文件')).toHaveCount(0);
    await member(page);
    await page
      .getByLabel('选择 HTML 文件')
      .setInputFiles({ name: '部门主页-é.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    const preview = page.frameLocator('iframe[title="体育中心主页预览"]');
    await expect(preview.getByRole('heading', { name: '浏览器部门主页' })).toBeVisible();
    expect((await home(request)).revision).toBe(original.revision);
    await preview.getByRole('button', { name: '文档交互' }).click();
    await expect(preview.getByText('点击成功')).toBeVisible();
    await expect(preview.locator('#isolation')).toContainText('DOM blocked');
    await expect(preview.locator('#isolation')).toContainText('storage blocked');
    await expect(preview.locator('#isolation')).toContainText('network blocked');
    await expect(preview.locator('#isolation')).toContainText('navigation blocked');
    await expect(page.locator('body')).not.toHaveAttribute('data-escaped', 'yes');
    await expect(page.locator('iframe[title="体育中心主页预览"]')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    );
    expect(await preview.locator('html').evaluate(() => document.compatMode)).toBe('CSS1Compat');
    await page.getByRole('button', { name: '确认替换主页' }).click();
    await expect(page.getByText('主页已经更新。')).toBeVisible();
    const saved = await home(request);
    expect(saved.revision).toBe(original.revision + 1);
    expect(saved.originalFilename).toBe('部门主页-é.html');
    expect(saved.html).toBe(html);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await member(page);
    await expect(
      page
        .frameLocator('iframe[title="体育中心主页"]')
        .getByRole('heading', { name: '浏览器部门主页' }),
    ).toBeVisible();
    await page.getByLabel('选择 HTML 文件').setInputFiles({
      name: 'unsaved.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<h1>Unsaved identity</h1>'),
    });
    await expect(page.locator('iframe[title="体育中心主页预览"]')).toBeVisible();
    await page.getByLabel('预览身份 / Demo user').selectOption('demo-student');
    await expect(page.getByLabel('选择 HTML 文件')).toHaveCount(0);
    await expect(page.locator('iframe[title="体育中心主页预览"]')).toHaveCount(0);
    await member(page);
    await expect(page.locator('iframe[title="体育中心主页预览"]')).toHaveCount(0);
  } finally {
    if (original.html) await put(request, original.html, original.originalFilename);
  }
});

test('stale uploads retain their preview and require reload before a deliberate retry', async ({
  page,
  request,
}) => {
  const original = await home(request);
  try {
    await page.goto('./organizations/student_union/sports_center', {
      waitUntil: 'domcontentloaded',
    });
    await member(page);
    await page.getByLabel('选择 HTML 文件').setInputFiles({
      name: 'retry.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<h1>Retry preview</h1>'),
    });
    await expect(
      page
        .frameLocator('iframe[title="体育中心主页预览"]')
        .getByRole('heading', { name: 'Retry preview' }),
    ).toBeVisible();
    await put(request, '<h1>Concurrent member</h1>');
    await page.getByRole('button', { name: '确认替换主页' }).click();
    await expect(page.getByText(/主页已被其他成员更新/)).toBeVisible();
    await expect(page.getByRole('button', { name: '确认替换主页' })).toBeDisabled();
    await page.getByRole('button', { name: '重新加载当前主页' }).click();
    await expect(
      page
        .frameLocator('iframe[title="体育中心主页"]')
        .getByRole('heading', { name: 'Concurrent member' }),
    ).toBeVisible();
    await expect(
      page
        .frameLocator('iframe[title="体育中心主页预览"]')
        .getByRole('heading', { name: 'Retry preview' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '确认替换主页' }).click();
    await expect(page.getByText('主页已经更新。')).toBeVisible();
  } finally {
    if (original.html) await put(request, original.html, original.originalFilename);
  }
});

test('publisher selection roundtrips through public associated native and historical details', async ({
  page,
  request,
}) => {
  await page.goto('./collections/workbench/new');
  await page.getByLabel('预览身份 / Demo user').selectOption('demo-sports-member');
  await expect(page.getByLabel('发布部门')).toHaveValue('student_union.sports_center');
  const title = `部门浏览器发布 ${Date.now()}`;
  await page.getByLabel('表单名称', { exact: true }).fill(title);
  await page.getByRole('textbox', { name: '开场说明' }).fill('真实发布与部门活动关联');
  await page.getByRole('button', { name: '检查并发布' }).click();
  await expect(page.getByRole('status')).toContainText('表单已经发布');
  const id = page.url().split('/').at(-1)!;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('预览身份 / Demo user').selectOption('demo-sports-member');
  await expect(page.getByLabel('发布部门')).toHaveValue('student_union.sports_center');
  await page.getByLabel('预览身份 / Demo user').selectOption('demo-student');
  await page.goto('./organizations/student_union/sports_center', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(new RegExp(`focus=native_collection%3A${id}`));
  await expect(page.getByRole('button', { name: '确认报名' })).toBeEnabled();
  const response = await request.post(`${api}/collections/forms`, {
    headers,
    data: {
      title: `历史 ${title}`,
      description: '以往活动公开说明',
      schema: {
        title: `历史 ${title}`,
        description: '以往活动公开说明',
        publisherDepartmentId: 'student_union.sports_center',
        fields: [
          {
            id: 'identity',
            kind: 'identity',
            label: '基本信息',
            helpText: '',
            options: [],
            rules: [],
          },
        ],
        formRules: [{ id: 'past', kind: 'schedule', value: { end: '2000-01-01T00:00:00.000Z' } }],
        outputs: [],
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  const pastId = (await response.json()).data.id;
  const publication = await request.post(`${api}/collections/forms/${pastId}/publish`, { headers });
  expect(publication.ok()).toBeTruthy();
  await page.goto('./organizations/student_union/sports_center', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTitle('体育中心主页')).toBeVisible();
  await expect(page.getByRole('region', { name: '相关活动' })).not.toContainText(
    '正在整理相关活动…',
  );
  await page.getByRole('button', { name: '以往活动' }).click();
  await expect(page.getByRole('button', { name: '以往活动' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: new RegExp(`历史 ${title}`) }).click();
  await expect(page).toHaveURL(/includePast=true/);
  await expect(page.getByRole('button', { name: '报名已截止' })).toBeDisabled();
  await page.goto('./organizations/student_union/sports_center', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTitle('体育中心主页')).toBeVisible();
  await expect(page.getByRole('region', { name: '相关活动' })).not.toContainText(
    '正在整理相关活动…',
  );
  await page.getByRole('button', { name: '以往活动' }).click();
  await expect(page.getByRole('button', { name: '以往活动' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: /校园夜跑/ }).click();
  await expect(page).toHaveURL(/events\/activity-night-run$/);
  await expect(page.getByRole('heading', { name: '校园夜跑', exact: true })).toBeVisible();
  await expect(page.getByLabel('报名状态')).toContainText('报名已截止');
  await expect(page.getByRole('button', { name: '报名活动', exact: true })).toBeDisabled();
});

for (const width of [390, 768, 1440])
  test(`full documents stay responsive and viewport-height templates stop growing at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./organizations/student_union/sports_center', {
      waitUntil: 'domcontentloaded',
    });
    await member(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('free_bbs_theme_mode', value);
        document.body.classList.toggle('theme-light', value === 'light');
        document.body.classList.toggle('theme-dark', value === 'dark');
      }, theme);
      await page.getByLabel('选择 HTML 文件').setInputFiles({
        name: `vh-${theme}.html`,
        mimeType: 'text/html',
        buffer: Buffer.from(
          '<!doctype html><html><head><style>body{min-height:100vh;padding:24px;margin:8px;background:#f1f5f9}h1{overflow-wrap:anywhere}</style></head><body><h1>Viewport height template</h1></body></html>',
        ),
      });
      const frame = page.locator('iframe[title="体育中心主页预览"]');
      await expect(frame).toBeVisible();
      await expect(
        page
          .frameLocator('iframe[title="体育中心主页预览"]')
          .getByRole('heading', { name: 'Viewport height template' }),
      ).toBeVisible();
      await expect
        .poll(async () => await frame.evaluate((el) => el.getBoundingClientRect().height))
        .toBeGreaterThan(400);
      const first = await frame.evaluate((el) => el.getBoundingClientRect().height);
      await page.waitForTimeout(1200);
      const later = await frame.evaluate((el) => el.getBoundingClientRect().height);
      expect(later).toBeLessThan(1200);
      expect(Math.abs(later - first)).toBeLessThan(300);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      const rects = await page.evaluate(() => ({
        doc: document.querySelector('iframe[title="体育中心主页"]')!.getBoundingClientRect().bottom,
        activities: document.querySelector('.department-activities')!.getBoundingClientRect().top,
      }));
      expect(rects.activities).toBeGreaterThan(rects.doc);
      await frame.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`department-preview-${width}-${theme}.png`),
      });
      await page.screenshot({
        path: testInfo.outputPath(`department-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  });
for (const width of [390, 1440]) {
  test(`document height shrinks after content collapse and width settling at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./organizations/student_union/sports_center', {
      waitUntil: 'domcontentloaded',
    });
    await member(page);
    const expandHtml =
      '<!doctype html><html lang="zh-CN"><head><style>*{box-sizing:border-box}body{margin:0;padding:20px;font:16px Arial}button{padding:10px}#panel{height:1400px;background:#dbeafe}#panel[hidden]{display:none}</style></head><body><h1>可收起的完整文档</h1><button onclick="document.getElementById(\'panel\').hidden=!document.getElementById(\'panel\').hidden">展开或收起</button><div id="panel" hidden>长文档内容</div><p>文档结束</p></body></html>';
    await page.getByLabel('选择 HTML 文件').setInputFiles({
      name: 'collapse.html',
      mimeType: 'text/html',
      buffer: Buffer.from(expandHtml),
    });
    const outer = page.locator('iframe[title="体育中心主页预览"]');
    const inner = page.frameLocator('iframe[title="体育中心主页预览"]');
    await expect(inner.getByRole('heading', { name: '可收起的完整文档' })).toBeVisible();
    await inner.getByRole('button', { name: '展开或收起' }).click();
    await expect.poll(() => outer.evaluate((el) => el.clientHeight)).toBeGreaterThan(1400);
    await inner.getByRole('button', { name: '展开或收起' }).press('Enter');
    await expect(inner.locator('#panel')).toBeHidden();
    await expect.poll(() => outer.evaluate((el) => el.clientHeight)).toBeLessThan(500);
    const collapsed = await inner.locator('body').evaluate((body) => ({
      body: body.scrollHeight,
      root: document.documentElement.scrollHeight,
      viewport: innerHeight,
    }));
    expect(collapsed.viewport - collapsed.body).toBeLessThan(100);
    const words = '宽度变化之后内容应当回到自然高度。'.repeat(45);
    const settleHtml = `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.4 Arial}#wrap{width:90px}button{padding:10px}</style></head><body><h1>布局稳定后收缩</h1><button onclick="document.getElementById('wrap').style.width='100%'">放宽文档</button><div id="wrap">${words}</div><p>文档结束</p></body></html>`;
    await page.getByLabel('选择 HTML 文件').setInputFiles({
      name: 'settle.html',
      mimeType: 'text/html',
      buffer: Buffer.from(settleHtml),
    });
    await expect(inner.getByRole('heading', { name: '布局稳定后收缩' })).toBeVisible();
    await expect.poll(() => outer.evaluate((el) => el.clientHeight)).toBeGreaterThan(1800);
    await inner.getByRole('button', { name: '放宽文档' }).click();
    await expect
      .poll(() => outer.evaluate((el) => el.clientHeight))
      .toBeLessThan(width === 390 ? 1400 : 600);
    const settled = await inner
      .locator('body')
      .evaluate((body) => ({ body: body.getBoundingClientRect().height, viewport: innerHeight }));
    expect(settled.viewport - settled.body).toBeLessThan(8);
    // A later parent width change must resize the same document, then shrink again.
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect.poll(() => outer.evaluate((el) => el.clientHeight)).toBeGreaterThan(500);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(() => outer.evaluate((el) => el.clientHeight)).toBeLessThan(600);
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`department-collapse-settle-${width}.png`) });
  });
}
