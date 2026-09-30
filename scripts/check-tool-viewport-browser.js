// Local regression fixtures; no real account, saved tool or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-tool-viewport-'));
  const { server } = await createDashboardUsabilityPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    const results = [];
    for (const kind of ['fixed', 'responsive', 'centred', 'long', 'authored-zoom']) {
      const responsive = ['responsive', 'long'].includes(kind);
      const longPage = kind === 'long';
      const baseZoom = kind === 'authored-zoom' ? 0.9 : 1;
      const tool = {
        id: 't_0000000000000001',
        title: responsive ? '响应式尺寸示例' : '固定尺寸示例',
        description: '仅用于本地检查小工具视口。',
        author: { username: '本地演示' },
        html: `<style>html,body{margin:0;width:100%;height:100%;overflow:${longPage ? 'auto' : 'hidden'}}body{zoom:${baseZoom}}#surface{position:${kind === 'centred' ? 'fixed;left:50%;top:50%;transform:translate(-50%,-50%)' : 'relative'};display:flow-root;box-sizing:border-box;background:#eef5f4;${responsive ? `width:100%;height:${longPage ? '1600px' : '100%'}` : 'width:1200px;height:850px;'}}button{position:absolute;right:16px;bottom:16px}h1{padding:24px}</style><main id="surface"><h1>${kind} 工具</h1><input id="tool-input" aria-label="测试输入" style="margin:24px;width:180px"><button onclick="this.textContent='已点击'">右下角按钮</button></main>`,
      };
      await page.setRequestInterception(true);
      const intercept = (request) => {
        const url = new URL(request.url());
        if (url.origin !== origin && !/^(data|blob):/.test(request.url()))
          return request.respond({ status: 204 });
        if (/^\/api\/tools(?:\/|$)/.test(url.pathname))
          return request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(url.pathname === '/api/tools' ? { tools: [tool] } : { tool }),
          });
        return request.continue();
      };
      page.on('request', intercept);
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${origin}/tool-workshop?tool=${tool.id}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#tool-viewer[open] iframe[aria-busy="false"]');
      const frame = await (await page.$('#tool-viewer-frame')).contentFrame();
      await frame.waitForFunction(() => document.body.dataset.freebbsToolFit === 'fit');
      const geometry = await frame.evaluate(() => {
        const surface = document.getElementById('surface').getBoundingClientRect();
        const button = document.querySelector('button').getBoundingClientRect();
        return {
          viewport: [window.innerWidth, window.innerHeight],
          content: [surface.width, surface.height],
          scale: Number(document.body.dataset.freebbsToolScale),
          buttonVisible:
            button.left >= -1 &&
            button.top >= -1 &&
            button.right <= window.innerWidth + 1 &&
            button.bottom <= window.innerHeight + 1,
          scrollHeight: Math.max(
            document.scrollingElement.scrollHeight,
            document.body.scrollHeight,
          ),
        };
      });
      assert.equal(geometry.buttonVisible, !longPage, JSON.stringify({ kind, ...geometry }));
      if (longPage) assert.ok(geometry.scrollHeight > geometry.viewport[1]);
      assert.equal(responsive ? geometry.scale === 1 : geometry.scale < 1, true);
      await frame.type('#tool-input', '123');
      assert.equal(await frame.$eval('#tool-input', (node) => node.value), '123');
      await frame.click('button');
      assert.equal(await frame.$eval('button', (node) => node.textContent), '已点击');
      results.push({ kind, ...geometry });
      await page.screenshot({
        path: path.join(output, `${kind}.png`),
      });
      await page.click('#tool-viewer-fit');
      await frame.waitForFunction(() => document.body.dataset.freebbsToolFit === 'original');
      assert.equal(
        await frame.$eval('#surface', (node) => Math.round(node.getBoundingClientRect().width)),
        responsive ? geometry.viewport[0] : 1200 * baseZoom,
      );
      await page.click('#tool-viewer-fit');
      await frame.waitForFunction(() => document.body.dataset.freebbsToolFit === 'fit');
      for (const [width, height] of [
        [1366, 768],
        [390, 844],
        [1440, 900],
      ]) {
        await page.setViewport({ width, height });
        await frame.waitForFunction(
          (scrollable) => {
            if (scrollable)
              return (
                Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight) >
                window.innerHeight
              );
            const rect = document.querySelector('button').getBoundingClientRect();
            return (
              rect.left >= -1 &&
              rect.top >= -1 &&
              rect.right <= window.innerWidth + 1 &&
              rect.bottom <= window.innerHeight + 1
            );
          },
          {},
          longPage,
        );
        await frame.click('button');
      }
      page.off('request', intercept);
      await page.setRequestInterception(false);
    }
    console.log(JSON.stringify({ output, results }));
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
