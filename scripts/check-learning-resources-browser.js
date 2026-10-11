// Browser file responses below are explicit schema fixtures, not production course content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const address = process.env.LEARNING_PREVIEW_URL || process.argv[2];
  assert.ok(address, 'Use an already running isolated preview');
  const base = new URL(address);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'learning-resources-'));
  fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage();
  const errors = [];
  const publicRequests = [];
  const downloads = [];
  const files = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      nodeId: 'SS-02-01',
      fileName: '<img src=x onerror=alert(1)>.pdf',
    },
    { id: '00000000-0000-4000-8000-000000000002', nodeId: null, fileName: '课程公开总览.pdf' },
    {
      id: '00000000-0000-4000-8000-000000000003',
      nodeId: 'SS-01-01',
      fileName: '其他知识点文件.pdf',
    },
  ].map((file) => ({
    ...file,
    contentType: 'application/pdf',
    size: 2048,
    sha256: 'a'.repeat(64),
    createdAt: '2026-10-10T00:00:00.000Z',
    url: 'https://untrusted.invalid/file',
    markdown: '<img src=x>',
  }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
      return request.respond({ status: 403, body: 'External services disabled' });
    if (url.pathname === '/api/course-upload/public/courses/signals/files') {
      publicRequests.push({ path: url.pathname, authorization: request.headers().authorization });
      return request.respond({
        status: publicRequests.length === 1 ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          publicRequests.length === 1 ? { message: 'Simulated temporary failure' } : { files },
        ),
      });
    }
    if (url.pathname.startsWith('/api/course-upload/files/')) {
      downloads.push(url.pathname);
      return request.respond({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="fixture.pdf"' },
        body: '%PDF-1.4\n% UI download fixture, not course material\n',
      });
    }
    return request.continue();
  });
  try {
    await page.setViewport({ width: 1440, height: 960 });
    const url = new URL('/knowledge?course=signals&point=SS-02-01&view=reading&as=student', base);
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#learning-resources-content');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-resources-content').dataset.resourcesState === 'error',
    );
    await page.click('[data-knowledge-tool="resources"]');
    assert.match(
      await page.$eval('#learning-resources-content', (item) => item.textContent),
      /不表示没有资料/,
    );
    await page.click('#learning-resources-content button');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-resources-content').dataset.resourcesState === 'ready',
    );
    const model = await page.$eval('#learning-resources-content', (item) => ({
      copy: item.textContent,
      groups: [...item.querySelectorAll('.learning-resource-group')].map((group) => ({
        title: group.querySelector('h3').textContent,
        links: [...group.querySelectorAll('a')].map((link) => ({
          copy: link.textContent,
          href: link.href,
        })),
      })),
      injected: item.querySelectorAll('img,script,iframe').length,
    }));
    assert.equal(model.groups[0].links.length, 1);
    assert.equal(model.groups[1].links.length, 1);
    assert.match(model.groups[0].title, /SS-02-01/);
    assert.match(model.groups[1].title, /未指定知识点/);
    assert.doesNotMatch(model.copy, /其他知识点文件.pdf/);
    assert.match(model.copy, /最多 200 份.*不代表全部/);
    assert.equal(model.injected, 0);
    assert.equal(model.groups[0].links[0].copy, files[0].fileName);
    assert.equal(
      model.groups[0].links[0].href,
      `${base.origin}/api/course-upload/files/${files[0].id}`,
    );
    assert.equal(publicRequests.length, 2);
    assert.ok(
      publicRequests.every((request) => request.authorization === undefined),
      'Public reads do not carry private bearer tokens',
    );
    const requestedFile = page.waitForRequest(
      (request) => new URL(request.url()).pathname === `/api/course-upload/files/${files[0].id}`,
    );
    await page.click('.learning-resource-group a');
    await requestedFile;
    assert.deepEqual(downloads, [`/api/course-upload/files/${files[0].id}`]);
    await page.screenshot({ path: path.join(output, 'resources-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.hidden))
      await page.click('#knowledge-chat-close');
    await page.$eval('#learning-resources-content', (item) =>
      item.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    const mobileLink = await page.$('.learning-resource-group a');
    assert.equal(
      await mobileLink.evaluate((item) => {
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit === item || item.contains(hit);
      }),
      true,
      'The mobile resource download link is visible and unobscured after closing Max',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
    );
    await page.screenshot({ path: path.join(output, 'resources-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ok: true,
        output,
        evidence:
          'Browser public-file responses are fixtures; this does not prove production course files exist.',
        checks: [
          'failure versus empty',
          'real retry',
          'exact node grouping',
          'course-level separation',
          'text-only filenames',
          'canonical download',
          'no private bearer token',
          'mobile width',
        ],
      }),
    );
  } finally {
    await browser.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
