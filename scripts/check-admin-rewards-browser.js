const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');
const { createAdminRewardsRouter } = require('../backend/admin-rewards');
const { createWalletLedgerRouter, ensureWalletLedger } = require('../backend/wallet-ledger');
const {
  createNotificationService,
  createNotificationsRouter,
} = require('../backend/notifications');

(async () => {
  const socketPath = process.env.ADMIN_REWARDS_MYSQL_SOCKET;
  assert.ok(socketPath?.startsWith('\\\\.\\pipe\\'), 'use only a disposable local MySQL pipe');
  const config = { socketPath, user: 'root', password: '' };
  const connection = await mysql.createConnection(config);
  const [[safety]] = await connection.query('SELECT @@skip_networking AS isolated');
  assert.equal(Number(safety.isolated), 1);
  const database = `admin_rewards_browser_${randomUUID().replaceAll('-', '')}`;
  assert.match(database, /^admin_rewards_browser_[a-f0-9]{32}$/);
  await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
  await connection.end();
  const pool = mysql.createPool({ ...config, database });
  await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY, username VARCHAR(120), full_name VARCHAR(120), student_id VARCHAR(64),
    is_admin TINYINT DEFAULT 0, electrons BIGINT DEFAULT 10, manetrons BIGINT DEFAULT 5
  ) ENGINE=InnoDB`);
  await pool.query(
    "INSERT INTO users(id, username, full_name, student_id, is_admin) VALUES(1,'qa_admin','管理员','QA-1',1),(2,'alice','张同学','2026000002',0),(3,'bob','李同学','2026000003',0)",
  );
  await pool.query('CREATE TABLE courses (id BIGINT PRIMARY KEY, name VARCHAR(80))');
  await pool.query('CREATE TABLE course_material_managers (course_id BIGINT, user_id BIGINT)');
  const api = express();
  api.use(express.json());
  // Fixed QA credentials on an ephemeral loopback server; never production authentication.
  const requireAuth = async (req, res) => {
    const token = req.headers.authorization;
    const id =
      token === 'Bearer reward-qa-admin' ? 1 : token === 'Bearer reward-qa-student' ? 2 : 0;
    if (!id) {
      res.status(401).json({});
      return null;
    }
    const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    return user;
  };
  const requireAdmin = async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return null;
    if (!user.is_admin) {
      res.status(403).json({});
      return null;
    }
    return user;
  };
  const notifications = createNotificationService({ pool });
  await ensureWalletLedger(pool);
  api.use('/api', createWalletLedgerRouter({ pool, requireAuth }));
  api.use('/api', createAdminRewardsRouter({ pool, requireAdmin, requireAuth, notifications }));
  api.use(
    '/api',
    createNotificationsRouter({ pool, requireAdmin, requireAuth, service: notifications }),
  );
  const apiServer = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    apiServer.once('listening', resolve);
  });
  const { server } = createEconomyPreview({
    extraPages: {
      '/system-settings/rewards': 'system-settings-rewards.html',
      '/system-settings': 'system-settings.html',
    },
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const apiBase = `http://127.0.0.1:${apiServer.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let userId = 1;
    let loseResponse = true;
    // Replace the preview bootstrap token immediately before app.js starts.
    await page.route('**/app.js', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({
        response,
        body: `localStorage.setItem('free_bbs_auth_token','${userId === 1 ? 'reward-qa-admin' : 'reward-qa-student'}');\n${source}`,
      });
    });
    await page.route('**/api/auth/me', async (route) => {
      const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
      await route.fulfill({
        json: {
          user: {
            id: user.id,
            uid: `qa${user.id}`,
            username: user.username,
            fullName: user.full_name,
            isAdmin: Boolean(user.is_admin),
            role: user.is_admin ? 'admin' : 'student',
            electrons: user.electrons,
            manetrons: user.manetrons,
          },
        },
      });
    });
    await page.route('**/api/electromagnetic', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
      body.user = {
        id: user.id,
        uid: `qa${user.id}`,
        username: user.username,
        fullName: user.full_name,
        isAdmin: Boolean(user.is_admin),
        role: user.is_admin ? 'admin' : 'student',
        electrons: user.electrons,
        manetrons: user.manetrons,
      };
      await route.fulfill({ response, json: body });
    });
    let failLedgerPage = false;
    const proxy = async (route) => {
      const url = new URL(route.request().url());
      if (
        failLedgerPage &&
        url.pathname === '/api/wallet/ledger' &&
        url.searchParams.has('before')
      ) {
        failLedgerPage = false;
        await route.fulfill({ status: 503, json: { message: '模拟账本分页失败' } });
        return;
      }
      const response = await route.fetch({ url: apiBase + url.pathname + url.search });
      if (
        url.pathname === '/api/admin/rewards' &&
        route.request().method() === 'POST' &&
        loseResponse
      ) {
        loseResponse = false;
        assert.equal(response.status(), 201);
        await route.fulfill({ status: 503, json: { message: '模拟响应丢失' } });
      } else await route.fulfill({ response });
    };
    for (const pattern of [
      '**/api/admin/**',
      '**/api/rewards*',
      '**/api/notifications*',
      '**/api/wallet/**',
    ]) {
      await page.route(pattern, proxy);
    }
    await page.goto(`${base}/system-settings/rewards`);
    await page.locator('#reward-users input').first().waitFor();
    await page.locator('#reward-users input[value="2"]').check();
    await page.locator('#reward-search').fill('bob');
    await page.locator('#reward-search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#reward-users input').length === 1);
    await page.locator('#reward-select-page').click();
    assert.match(await page.locator('#reward-selection-count').textContent(), /2 人/);
    await page.locator('[data-reward-amount="20"]').click();
    await page.locator('#reward-magnetic').fill('3');
    await page.locator('#reward-title').fill('<img src=x onerror=alert(1)>');
    await page.locator('#reward-reason').fill('发现重要问题，感谢认真反馈。');
    await page.locator('#reward-submit').click();
    assert.match(await page.locator('#reward-confirm-summary').textContent(), /40 电元 \+ 6 磁元/);
    await page.locator('#reward-confirm-cancel').click();
    const [[notSent]] = await pool.query('SELECT COUNT(*) AS count FROM admin_reward_batches');
    assert.equal(notSent.count, 0);
    await page.locator('#reward-submit').click();
    await page.locator('#reward-confirm-send').click();
    await page.waitForFunction(() =>
      document.getElementById('reward-status').textContent.includes('模拟响应丢失'),
    );
    assert.ok(await page.locator('#reward-electric').isDisabled());
    await page.reload();
    await page.locator('#reward-retry:visible').waitFor();
    await page.locator('#reward-retry').click();
    await page.waitForFunction(() =>
      document.getElementById('reward-status').textContent.includes('原奖励已到账'),
    );
    const [[credited]] = await pool.query('SELECT electrons, manetrons FROM users WHERE id=2');
    assert.deepEqual([credited.electrons, credited.manetrons], [30, 8]);
    const [[notices]] = await pool.query('SELECT COUNT(*) AS count FROM community_notifications');
    assert.equal(notices.count, 2);
    await page.locator('#reward-batches button').first().click();
    await page.locator('#reward-batches li').first().waitFor();
    assert.equal(await page.locator('#reward-batches img').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('freebbs:session-change')));
    assert.ok(await page.locator('[data-admin-content]').isVisible());
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        );
      }
      if (process.env.REWARD_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.REWARD_SCREENSHOT_DIR, { recursive: true });
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({
          path: path.join(process.env.REWARD_SCREENSHOT_DIR, `admin-rewards-${mode}.png`),
          fullPage: true,
        });
      }
    }
    userId = 2;
    await page.goto(`${base}/inventory#wallet-ledger`);
    await page.locator('#wallet-ledger-list .reward-batch').waitFor();
    assert.match(await page.locator('#wallet-ledger-list').textContent(), /20 电元/);
    assert.match(await page.locator('#wallet-ledger-list').textContent(), /发现重要问题/);
    assert.equal(await page.locator('#wallet-ledger-list img').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('freebbs:session-change')));
    assert.equal(await page.locator('#wallet-ledger-list .reward-batch').count(), 1);
    const inbox = await page.evaluate(async () => {
      const response = await fetch('/api/notifications', {
        headers: { Authorization: 'Bearer reward-qa-student' },
      });
      return response.json();
    });
    assert.equal(inbox.notifications.length, 1);
    assert.equal(inbox.notifications[0].link, '/inventory#wallet-ledger');
    for (let i = 0; i < 35; i += 1)
      await pool.query('UPDATE users SET electrons = electrons + 1 WHERE id = 2');
    await page.locator('#wallet-ledger-refresh').click();
    await page.waitForFunction(
      () => document.querySelectorAll('.wallet-ledger-entry').length === 30,
    );
    failLedgerPage = true;
    await page.locator('#wallet-ledger-more').click();
    await page.waitForFunction(() =>
      document.getElementById('wallet-ledger-status').textContent.includes('分页失败'),
    );
    assert.equal(await page.locator('.wallet-ledger-entry').count(), 30);
    await page.locator('#wallet-ledger-more').click();
    await page.waitForFunction(
      () => document.querySelectorAll('.wallet-ledger-entry').length === 36,
    );
    await page.locator('#wallet-ledger-currency').selectOption('magnetic');
    await page.waitForFunction(
      () => document.querySelectorAll('.wallet-ledger-entry').length === 1,
    );
    await page.evaluate(() => {
      window.freeBbsApp.userState.isLoggedIn = false;
      localStorage.removeItem('free_bbs_auth_token');
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    assert.equal(await page.locator('.wallet-ledger-entry').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: real MySQL browser flow, selection across searches, confirmation, lost-response retry after reload, audit history, station notification, own ledger, safe text and light/dark mobile layouts.',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await new Promise((resolve) => {
      apiServer.close(resolve);
    });
    await pool.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
