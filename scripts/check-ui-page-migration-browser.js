// Loopback-only browser regression, in-memory preview data, no production accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  require.resolve('playwright', { paths: [path.join(__dirname, '../development'), __dirname] }),
);
const { createCourseThreadsPreview } = require('./preview-course-threads');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const preview = createCourseThreadsPreview({ extraPages: { '/adminusers': 'adminusers.html' } });
  const { server } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-list-state-'));
  const errors = [];
  const results = [];
  const calls = { posts: 0, boards: 0, admin: 0 };
  let postsMode = 'error';
  let boardsMode = 'error';
  let adminMode = 'error';
  let heldAdmin;
  let browser;
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      const response = await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
      assert.ok(response.ok);
    }
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE ||
        process.env.CHROME_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['about:', 'data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (url.origin !== origin) return route.abort();
      const json = (status, payload) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
      if (url.pathname === '/api/auth/me')
        return json(200, {
          user: {
            uid: 'u_preview01',
            id: 1,
            username: 'NotingSr_preview',
            fullName: '本地演示管理员',
            isAdmin: true,
            role: 'admin',
            electrons: 120,
            manetrons: 80,
            heat: 20,
          },
        });
      if (url.pathname === '/api/discussion/boards') {
        calls.boards += 1;
        return boardsMode === 'error'
          ? json(503, { message: '模拟板块失败' })
          : json(200, { boards: preview.discussion.boards });
      }
      if (url.pathname === '/api/discussion/posts') {
        calls.posts += 1;
        if (postsMode === 'error') return json(503, { message: '模拟帖子失败' });
        if (postsMode === 'denied') return json(403, { message: '模拟权限撤回' });
        return json(200, {
          posts: postsMode === 'empty' ? [] : [preview.discussion.posts[0]],
          nextCursor: '',
          hash: '',
        });
      }
      if (url.pathname === '/api/admin/users') {
        calls.admin += 1;
        if (adminMode === 'slow') {
          heldAdmin = route;
          return undefined;
        }
        if (adminMode === 'error') return json(503, { message: '模拟管理员列表失败' });
        if (adminMode === 'denied') return json(403, { message: '模拟权限撤回' });
        return json(200, {
          users:
            adminMode === 'empty'
              ? []
              : [
                  {
                    id: 'fixture-only',
                    uid: 'fixture-user',
                    username: '演示用户',
                    fullName: '列表回归用户',
                    role: 'student',
                    boardModeratorSlugs: [],
                    courseManagerSlugs: [],
                    electrons: 0,
                    manetrons: 0,
                    heat: 0,
                  },
                ],
          permissionCatalog: { boards: [], courses: [] },
        });
      }
      return route.continue();
    });
    const waitState = async (id, kind) => {
      await page.waitForFunction(
        ({ key, value }) => document.getElementById(key)?.dataset.uiState === value,
        { key: id, value: kind },
      );
    };
    const listState = (id) =>
      page.locator(`#${id}`).evaluate((node) => ({
        kind: node.dataset.uiState,
        busy: node.getAttribute('aria-busy'),
        text: node.innerText,
        alerts: node.querySelectorAll('[role="alert"]').length,
      }));

    await page.goto(`${origin}/discussion`, { waitUntil: 'networkidle' });
    await waitState('discussion-post-list', 'error');
    const initial = await listState('discussion-post-list');
    assert.equal(initial.busy, 'false');
    assert.equal(initial.alerts, 1);
    assert.doesNotMatch(initial.text, /还没有帖子/);
    assert.equal(await page.locator('[data-action="retry-discussion-boards"]').count(), 1);
    assert.equal(await page.locator('[data-action="retry-discussion-posts"]').count(), 1);
    await page.screenshot({ path: path.join(output, 'discussion-error.png') });
    const beforeRetry = { ...calls };
    boardsMode = 'ready';
    postsMode = 'ready';
    await page.locator('[data-action="retry-discussion-posts"]').click();
    await waitState('discussion-post-list', 'ready');
    assert.equal(calls.boards, beforeRetry.boards + 1);
    assert.equal(calls.posts, beforeRetry.posts + 1);
    assert.equal(await page.locator('.discussion-post-card').count(), 1);
    assert.equal(await page.locator('[data-action="retry-discussion-boards"]').count(), 0);
    results.push('discussion initial error → explicit metadata/posts GET retry → ready');

    await page.locator('.discussion-post-card').evaluate((node) => {
      node.dataset.retainedMarker = 'same-dom';
    });
    postsMode = 'error';
    await page.evaluate(() => window.loadDiscussionPosts());
    await waitState('discussion-post-list', 'error');
    assert.equal(
      await page.locator('.discussion-post-card[data-retained-marker="same-dom"]').count(),
      1,
    );
    assert.match(await page.locator('#discussion-filter-status').innerText(), /已保留/);
    postsMode = 'denied';
    await page.evaluate(() => window.loadDiscussionPosts());
    assert.equal(await page.locator('.discussion-post-card').count(), 0);
    assert.equal(await page.locator('#discussion-post-list [role="alert"]').count(), 1);
    postsMode = 'empty';
    await page.locator('[data-action="retry-discussion-posts"]').click();
    await waitState('discussion-post-list', 'empty');
    assert.equal(await page.locator('#discussion-post-list [role="alert"]').count(), 0);
    results.push('discussion refresh 503 retains DOM → 403 clears rows → successful empty');

    await page.goto(`${origin}/adminusers`, { waitUntil: 'networkidle' });
    await waitState('admin-users', 'error');
    assert.equal(await page.locator('#admin-user-empty').isVisible(), false);
    assert.equal((await listState('admin-users')).alerts, 1);
    await page.screenshot({ path: path.join(output, 'admin-error.png') });
    const adminBefore = calls.admin;
    adminMode = 'empty';
    await page.locator('[data-action="retry-admin-users"]').click();
    await waitState('admin-users', 'empty');
    assert.equal(calls.admin, adminBefore + 1);
    assert.equal(await page.locator('#admin-user-empty').isVisible(), true);
    assert.equal(await page.locator('#admin-users [role="alert"]').count(), 0);
    adminMode = 'ready';
    await page.evaluate(() => window.loadAdminUsers());
    await waitState('admin-users', 'ready');
    assert.equal(await page.locator('.admin-user-row').count(), 1);
    assert.equal(await page.locator('#admin-user-empty').isVisible(), false);
    results.push('admin initial error → manual GET retry → genuine empty → real rows');

    await page.locator('.admin-user-row').evaluate((node) => {
      node.dataset.retainedMarker = 'same-dom';
    });
    adminMode = 'error';
    await page.evaluate(() => window.loadAdminUsers());
    await waitState('admin-users', 'error');
    assert.equal(await page.locator('.admin-user-row[data-retained-marker="same-dom"]').count(), 1);
    assert.equal(await page.locator('#admin-user-empty').isVisible(), false);
    assert.equal(await page.locator('#admin-users [role="alert"]').count(), 1);
    adminMode = 'denied';
    await page.evaluate(() => window.loadAdminUsers());
    assert.equal(await page.locator('.admin-user-row').count(), 0);
    assert.equal(await page.locator('#admin-user-empty').isVisible(), false);
    results.push('admin refresh 503 retains row DOM → 403 clears private rows');

    adminMode = 'slow';
    await page.evaluate(() => {
      window.loadAdminUsers();
    });
    await waitState('admin-users', 'loading');
    await page.waitForFunction(
      () => document.getElementById('admin-users').getAttribute('aria-busy') === 'true',
    );
    adminMode = 'ready';
    await page.evaluate(() => {
      window.freeBbsApp.userState.uid = 'another-fixture-owner';
      window.renderAdminSection();
    });
    await waitState('admin-users', 'ready');
    assert.ok(heldAdmin);
    await heldAdmin.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '迟到的旧账号失败' }),
    });
    await page.waitForLoadState('networkidle');
    assert.equal((await listState('admin-users')).kind, 'ready');
    assert.equal(await page.locator('#admin-users [role="alert"]').count(), 0);
    assert.equal(await page.locator('.admin-user-row').count(), 1);
    results.push('admin pending old-owner error cannot overwrite new-owner ready data');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, output, results, calls, errors }));
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
