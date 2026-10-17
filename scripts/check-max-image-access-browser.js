// Synthetic local fixtures only: no account, production database, or model API is used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const express = require('express');
const sharp = require('sharp');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createMaxImageAccess } = require('../backend/max-image-access');

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function main() {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-max-image-browser-'));
  const oldName = 'max-image-42-1791900000000-1234567890abcdef.webp';
  const newName = 'max-image-42-1791900000001-1234567890abcdef.webp';
  const publicName = 'max-image-42-1791900000002-1234567890abcdef.webp';
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#345678' },
  })
    .webp()
    .toBuffer();
  await fs.mkdir(path.join(uploadDir, '.max-images'));
  await fs.writeFile(path.join(uploadDir, oldName), bytes);
  await fs.writeFile(path.join(uploadDir, publicName), bytes);
  await fs.writeFile(path.join(uploadDir, '.max-images', newName), bytes);
  const requests = [];
  const users = {
    'synthetic-owner': { id: 42 },
    'synthetic-other': { id: 43 },
    'synthetic-admin': { id: 1, is_admin: 1 },
  };
  const optional = async (request) =>
    users[request.headers.authorization?.replace('Bearer ', '')] || null;
  const app = express();
  app.use((request, _response, next) => {
    requests.push({ url: request.originalUrl, authorization: request.headers.authorization || '' });
    next();
  });
  const access = createMaxImageAccess({
    uploadDir,
    getOptionalAuthUser: optional,
    pool: {
      execute: async (_sql, values) => [
        values[2].includes(publicName)
          ? [{ user_id: 42, is_hidden: 0, is_deleted: 0, login_required: 0 }]
          : [],
      ],
    },
    requireAuth: async (request, response) => {
      const user = await optional(request);
      if (!user) response.sendStatus(401);
      return user;
    },
  });
  await access.publishDiscussionImages([publicName], { ownerId: 42, postId: 101, commentId: 202 });
  app.use('/uploads', access.guardUploads, express.static(uploadDir));
  app.use('/api/ai/images', access.router);
  app.get('/api/image-fixture', (_request, response) =>
    response
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Private images fixture</title><main></main><script src="/max-image-results.js"></script>',
      ),
  );
  const backend = require('node:http').createServer(app);
  const backendPort = await listen(backend);
  const reservation = net.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => {
    reservation.close(resolve);
  });
  const frontend = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      API_HOST: '127.0.0.1',
      API_PORT: String(backendPort),
    },
  });
  const origin = `http://127.0.0.1:${port}`;
  let browser;
  const checks = [];
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local frontend failed to start')), 10000);
      frontend.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Frontend exited: ${code}`));
      });
      frontend.stdout.on('data', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/api/image-fixture`);
    const show = async (token, source) => {
      await page.evaluate(
        ({ auth, src }) => {
          if (auth) localStorage.setItem('free_bbs_auth_token', auth);
          else localStorage.removeItem('free_bbs_auth_token');
          window.dispatchEvent(new Event('freebbs:session-change'));
          const template = document.createElement('template');
          template.innerHTML = `<img alt="synthetic" src="${src}">`;
          document.querySelector('main').innerHTML =
            `<article><div class="aichat-bubble">${template.innerHTML}</div></article>`;
          window.FreeBbsMaxImageResults.enhanceImages(document.querySelector('.aichat-bubble'));
          window.FreeBbsMaxImageResults.decorate(document.querySelector('article'));
        },
        { auth: token, src: source },
      );
    };
    for (const source of [`/api/ai/images/${newName}`, `/uploads/${oldName}`]) {
      await show('synthetic-owner', source);
      await page.waitForSelector('[data-state="ready"]');
      const result = await page.evaluate(() => ({
        src: document.querySelector('img').src,
        width: document.querySelector('img').naturalWidth,
        links: [...document.querySelectorAll('figcaption a')].map((a) => a.href),
      }));
      assert.equal(result.width, 64);
      assert.match(result.src, /^blob:/);
      assert.deepEqual(result.links, [result.src, result.src]);
      checks.push(
        `owner renders and opens/downloads ${source.startsWith('/api') ? 'new' : 'historical'} image through real frontend proxy`,
      );
      await page.evaluate(() => {
        localStorage.removeItem('free_bbs_auth_token');
        window.dispatchEvent(new Event('freebbs:session-change'));
      });
      assert.equal(await page.locator('img').getAttribute('src'), null);
      assert.equal(await page.locator('figcaption a').count(), 0);
      checks.push('logout clears image and original/download links');
      for (const other of ['synthetic-other', 'synthetic-admin', '']) {
        await show(other, source);
        await page.waitForSelector('.is-image-unavailable');
        assert.equal(await page.locator('img').getAttribute('src'), null);
      }
      checks.push('other user, admin and unauthenticated requests rejected');
    }
    await show('synthetic-owner', `/api/ai/images/${newName}`);
    await page.waitForSelector('[data-state="ready"]');
    await page.evaluate(() => {
      localStorage.setItem('free_bbs_auth_token', 'synthetic-other');
      window.dispatchEvent(new StorageEvent('storage', { key: 'free_bbs_auth_token' }));
    });
    assert.equal(await page.locator('img').getAttribute('src'), null);
    checks.push('cross-tab account change clears loaded bytes');
    let pausedRoute;
    let notifyPaused;
    const paused = new Promise((resolve) => {
      notifyPaused = resolve;
    });
    await page.route(`**/api/ai/images/${newName}`, (route) => {
      pausedRoute = route;
      notifyPaused();
    });
    await show('synthetic-owner', `/api/ai/images/${newName}`);
    await paused;
    await page.evaluate(() => {
      localStorage.setItem('free_bbs_auth_token', 'synthetic-other');
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    await pausedRoute
      .fulfill({ status: 200, contentType: 'image/webp', body: bytes })
      .catch(() => {});
    await page.unroute(`**/api/ai/images/${newName}`);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    assert.equal(await page.locator('img').getAttribute('src'), null);
    assert.equal(await page.locator('figcaption a').count(), 0);
    checks.push('a delayed owner response cannot restore image after account switch');
    await page.evaluate((name) => {
      localStorage.removeItem('free_bbs_auth_token');
      window.dispatchEvent(new Event('freebbs:session-change'));
      document.querySelector('main').innerHTML =
        `<blockquote class="ordinary-comment"><p>公开图片引用</p><img src="/uploads/${name}" alt="public quote"></blockquote>`;
      window.FreeBbsMaxImageResults.enhanceImages(document.querySelector('.ordinary-comment'));
    }, publicName);
    await page.waitForSelector('[data-state="ready"]');
    assert.equal(await page.locator('img').evaluate((image) => image.naturalWidth), 64);
    checks.push(
      'ordinary public Markdown quotation hydrates without a Max message wrapper or login',
    );
    assert.ok(requests.some((request) => request.authorization === 'Bearer synthetic-owner'));
    assert.ok(requests.every((request) => !/synthetic-|token=|authorization=/i.test(request.url)));
    assert.deepEqual(errors, []);
    checks.push('credentials only in Authorization header; no browser script errors');
    console.log(JSON.stringify({ ok: true, checks, checkCount: checks.length }));
  } finally {
    await browser?.close();
    frontend.kill();
    await new Promise((resolve) => {
      backend.close(resolve);
      backend.closeAllConnections();
    });
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
