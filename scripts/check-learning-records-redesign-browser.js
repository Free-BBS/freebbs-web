// Real Chrome acceptance for the redesigned records page. The server, accounts,
// past rows, faults and delayed replies are isolated QA fixtures, never real users.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { TOKEN } = require('./preview-economy');
const {
  createLearningAnalyticsRouter,
  createMemoryAnalyticsStore,
} = require('../backend/learning-analytics');

const TOKENS = {
  student: TOKEN,
  other: 'learning-records-qa-only-other',
  admin: 'learning-records-qa-only-admin',
};
const USERS = {
  student: { id: 1, uid: 'u_preview01', username: 'NotingSr_preview', role: 'student' },
  other: { id: 2, uid: 'u_preview02', username: 'another_student', role: 'student' },
  admin: {
    id: 9,
    uid: 'u_recordsqa09',
    username: 'records_qa_admin',
    role: 'admin',
    isAdmin: true,
    is_admin: true,
  },
};
const PERSONAL = '#personal-learning-data';
const ADMIN = '#admin-learning-data';
const QUESTION = 'SS-01-01-Q-preview';
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function identity(req) {
  return Object.entries(TOKENS).find(
    ([, token]) => req.headers.authorization === `Bearer ${token}`,
  )?.[0];
}

async function createLab() {
  const preview = createCompleteLearningPreview({
    extraPages: { '/adminusers': 'adminusers.html' },
    transformHtml(html) {
      // Choose a synthetic identity before the real app restores its session.
      // The normal fixture always installs TOKEN, so only its inline setup is replaced.
      return html.replace(
        `localStorage.setItem('free_bbs_auth_token','${TOKEN}');`,
        `const recordsQaRole=new URLSearchParams(location.search).get('as')||localStorage.getItem('free_bbs_records_qa_role')||'student';localStorage.setItem('free_bbs_records_qa_role',recordsQaRole);localStorage.setItem('free_bbs_auth_token',(${JSON.stringify(TOKENS)})[recordsQaRole]||${JSON.stringify(TOKEN)});`,
      );
    },
  });
  const { contexts } = preview.learning.analyticsStore;
  const attempts = preview.learning.assessmentStore.rows;
  const store = createMemoryAnalyticsStore({
    contexts,
    users: Object.values(USERS),
    businessAttempts: attempts,
    initialPreferences: [{ user_id: 1, enabled: false }],
  });
  const faults = { assessmentsUnavailable: false };
  for (const method of ['businessRows', 'journeyAttemptRows', 'assessmentEvidenceRows']) {
    const originalMethod = store[method];
    store[method] = async (...args) =>
      faults.assessmentsUnavailable
        ? Object.defineProperty([], 'available', { value: false })
        : originalMethod.apply(store, args);
  }
  const initial = new Date(Date.now() - 12 * 86400000);
  const context = contexts.find((row) => row.slug === 'signals' && row.node_id === 'SS-01-02');
  assert.ok(context, 'complete preview contains the historical secondary point');
  store.rows.push({
    id: '9001',
    user_id: 1,
    course_id: context.course_id,
    course_slug: 'signals',
    course_name: '信号与系统',
    node_id: context.node_id,
    node_name: context.node_name || context.title,
    event_type: 'navigation',
    event_source: 'browser',
    delta_seconds: 0,
    metadata_json: { action: 'visit', tool: 'content' },
    created_at: initial,
  });
  // Historical attempts are clearly synthetic. Native submission below adds a
  // separate real preview assessment row through the actual assessment router.
  for (const [index, verdict] of ['pass', 'fail', null].entries())
    attempts.push({
      id: String(9100 + index),
      user_id: 2,
      course_id: context.course_id,
      node_id: 'SS-02-01',
      question_id: 'QA-historical-formal',
      document_version: 'a'.repeat(64),
      question_version: 'qa-1',
      is_official: 1,
      status: verdict ? 'graded' : 'pending_review',
      verdict,
      answer_json: { text: 'QA-private-answer-never-visible' },
      created_at: new Date(Date.now() - (3 - index) * 3600000),
    });
  for (let index = 0; index < 12; index += 1)
    attempts.push({
      id: String(9200 + index),
      user_id: 2,
      course_id: context.course_id,
      node_id: 'SS-02-01',
      question_id: 'QA-historical-practice',
      document_version: 'a'.repeat(64),
      question_version: 'qa-1',
      is_official: 0,
      status: 'graded',
      verdict: 'practice_only',
      created_at: new Date(Date.now() - 3600000),
    });
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const auth = async (req, res) => {
    const user = USERS[identity(req)];
    if (!user) res.status(401).json({ message: 'Synthetic QA identity required' });
    return user || null;
  };
  app.use(
    '/api/learning-analytics',
    createLearningAnalyticsRouter({
      store,
      requireAuth: auth,
      requireAdmin: async (req, res) => {
        const user = await auth(req, res);
        if (user && !user.isAdmin) {
          res.status(403).json({ message: '仅管理员可查看' });
          return null;
        }
        return user;
      },
    }),
  );
  const [original] = preview.server.listeners('request');
  preview.server.removeListener('request', original);
  preview.server.on('request', (req, res) => {
    const host = `127.0.0.1:${preview.server.address()?.port}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      res.writeHead(403);
      return res.end('Loopback QA only');
    }
    const { pathname } = new URL(req.url, `http://${host}`);
    if (pathname.startsWith('/api/learning-analytics')) return app(req, res);
    const user = USERS[identity(req)];
    const send = (body, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
      });
      return res.end(JSON.stringify(body));
    };
    if (['/api/auth/me', '/api/profile'].includes(pathname))
      return user ? send({ user }) : send({ message: 'Synthetic QA identity required' }, 401);
    if (pathname === '/api/admin/users' && req.method === 'GET')
      return user?.isAdmin
        ? send({ users: [], permissionCatalog: { boards: [], courses: [] } })
        : send({}, 403);
    if (pathname === '/api/ai/knowledge/chat')
      return send({ message: 'AI disabled: records QA never sends a real prompt' }, 403);
    return original(req, res);
  });
  const portSelection = await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${portSelection.port}`;
  const api = async (route, role = 'student', options = {}) => {
    const response = await fetch(`${base}/api/learning-analytics${route}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${TOKENS[role]}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return { status: response.status, data: await response.json() };
  };
  return { ...preview, store, attempts, base, api, portSelection, faults };
}

function contrast(foreground, background) {
  const luminance = (color) =>
    color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function open(page, lab, route, host) {
  await page.goto(`${lab.base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${host}:not([hidden]) [data-learning-data-view]`, { visible: true });
  await page.waitForFunction(
    (selector) => !document.querySelector(`${selector} [data-learning-data-status]`)?.textContent,
    {},
    host,
  );
}

async function switchView(page, host, view) {
  await page.locator(`${host} [data-learning-data-view="${view}"]`).click();
  await page.waitForSelector(`${host} [data-learning-data-panel="${view}"]:not([hidden])`, {
    visible: true,
  });
  assert.deepEqual(
    await page.$eval(host, (element) => ({
      selected: [...element.querySelectorAll('[data-learning-data-view][aria-pressed="true"]')].map(
        (button) => button.dataset.learningDataView,
      ),
      visible: [...element.querySelectorAll('[data-learning-data-panel]:not([hidden])')].map(
        (panel) => panel.dataset.learningDataPanel,
      ),
    })),
    { selected: [view], visible: [view] },
    'one selected button and exactly its panel are visible',
  );
}

async function selectAll(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
}

async function tabTo(page, selector, limit = 100) {
  // Deliberately no element.focus(): this is the browser's native tab order.
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.$eval(selector, (element) => element === document.activeElement)) {
      await sleep(500);
      const focus = await page.$eval(selector, (element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          hit: element === hit || element.contains(hit),
          visible: rect.width > 0 && rect.height > 0 && !element.closest('[hidden],.hidden'),
          within:
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth,
          outline: getComputedStyle(element).outlineStyle,
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      });
      assert.ok(
        focus.hit && focus.visible && focus.within && focus.outline !== 'none',
        `native focus is visible and usable: ${JSON.stringify(focus)}`,
      );
      return focus;
    }
  }
  throw new Error(`Native Tab could not reach ${selector}`);
}

async function layout(page, host) {
  const observation = await page.$eval(host, (element) => {
    const background = (item) => {
      for (let current = item; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        if (!['transparent', 'rgba(0, 0, 0, 0)'].includes(value)) return value;
      }
      return 'rgb(255, 255, 255)';
    };
    const samples = [
      ...element.querySelectorAll(
        'h3,.learning-data-caption,button,select,input,summary,.learning-data-link,.learning-data-unit-facts,td,th',
      ),
    ]
      .filter(
        (item) =>
          !item.closest('[hidden],.hidden') &&
          item.getBoundingClientRect().width > 0 &&
          item.getBoundingClientRect().height > 0,
      )
      .map((item) => ({
        text: item.textContent.trim().slice(0, 80),
        font: parseFloat(getComputedStyle(item).fontSize),
        color: getComputedStyle(item).color,
        background: background(item),
      }));
    const rect = element.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      panelLeft: rect.left,
      panelRight: rect.right,
      theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      samples,
      tables: [...element.querySelectorAll('.learning-data-table-scroll')]
        .filter((item) => !item.closest('[hidden],details:not([open])'))
        .map((item) => ({
          clientWidth: item.clientWidth,
          scrollWidth: item.scrollWidth,
          overflow: getComputedStyle(item).overflowX,
          focusable: item.tabIndex === 0,
          semantic: Boolean(
            item.querySelector('table thead th') && item.querySelector('table tbody'),
          ),
        })),
    };
  });
  assert.ok(
    observation.pageWidth <= observation.viewport + 1,
    `no page-wide horizontal overflow: ${JSON.stringify(observation)}`,
  );
  assert.ok(
    observation.panelLeft >= -1 && observation.panelRight <= observation.viewport + 1,
    'records panel fits viewport',
  );
  for (const sample of observation.samples) {
    sample.ratio = contrast(sample.color, sample.background);
    assert.ok(sample.ratio >= 4.5, `readable text contrast: ${JSON.stringify(sample)}`);
    assert.ok(
      sample.font >= 13,
      `records text has an actual readable font: ${JSON.stringify(sample)}`,
    );
  }
  for (const table of observation.tables)
    assert.ok(
      table.focusable && table.semantic && ['auto', 'scroll'].includes(table.overflow),
      'tables have a semantic locally scrollable keyboard region',
    );
  return observation;
}

async function main() {
  // Only the browser runner needs Puppeteer. createLab() can be imported to
  // leave this same synthetic student/admin preview running for human review.
  // eslint-disable-next-line import/no-dynamic-require
  const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-records-redesign-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Actual complete preview HTML/JS/CSS and registered learning/assessment/analytics memory routers in real Chrome. Synthetic accounts and explicitly seeded historical rows only. Natural navigation and one wrong answer use native UI. 503, legacy missing fields and delayed responses are intentionally intercepted QA faults; no production DB/users, real AI or remote services. No simulated pass by editing DOM/CSS/focus.',
    checks: [],
    matrix: [],
    requests: [],
    screenshots: [],
    pageErrors: [],
    blocked: [],
  };
  const pass = (scene, name, details = {}) =>
    report.checks.push({ scene, name, pass: true, ...details });
  const lab = await createLab();
  report.portSelection = lab.portSelection;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  let scene = 'initial-router-policy';
  const makePage = async (size = { width: 1440, height: 1000 }, theme = 'light') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setViewport(size);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (value) => localStorage.setItem('free_bbs_theme_mode', value),
      theme,
    );
    page.on('pageerror', (error) => report.pageErrors.push({ scene, message: error.message }));
    const fault = { mode: '', seen: 0, delayed: null, legacy: null };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const url = new URL(request.url());
        if (url.origin !== lab.base && !['data:', 'blob:'].includes(url.protocol)) {
          report.blocked.push(url.origin + url.pathname);
          return await request.abort('blockedbyclient');
        }
        if (url.pathname.startsWith('/api/'))
          report.requests.push({
            scene,
            method: request.method(),
            path: url.pathname + url.search,
          });
        if (url.pathname.startsWith('/api/ai/')) throw new Error('Records QA must not initiate AI');
        if (
          /^\/api\/learning-analytics\/(?:summary|admin\/overview)$/.test(url.pathname) &&
          fault.mode
        ) {
          fault.seen += 1;
          if (fault.mode === '503')
            return await request.respond({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'QA 模拟：记录服务暂不可用' }),
            });
          if (fault.mode === 'legacy')
            return await request.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(fault.legacy),
            });
          if (fault.mode === 'delay' && !fault.delayed) {
            const response = await fetch(request.url(), {
              headers: { Authorization: request.headers().authorization },
            });
            const payload = await response.text();
            fault.delayed = { request, payload, status: response.status };
            fault.mode = '';
            return undefined;
          }
        }
        return await request.continue();
      } catch (error) {
        report.pageErrors.push({ scene, message: `QA interception: ${error.message}` });
        if (!request.isInterceptResolutionHandled()) await request.abort();
        return undefined;
      }
    });
    return { page, context, fault };
  };
  try {
    const preferences = await lab.api('/preferences');
    assert.equal(
      preferences.data.preferences.enabled,
      true,
      'old false preference upgrades to automatic minimum recording',
    );
    const rejected = await lab.api('/preferences', 'student', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.preferences.enabled, true);
    assert.equal((await lab.api('/admin/overview', 'student')).status, 403);
    pass(scene, 'default recording and admin scope are actual router policy', {
      disabledStatus: rejected.status,
    });

    scene = 'natural-navigation-and-formal-attempt';
    const primary = await makePage();
    const { page } = primary;
    await page.goto(`${lab.base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').click();
    const before = lab.store.rows.length;
    await page.goto(
      `${lab.base}/knowledge?course=signals&point=SS-01-01&view=feedback&quiz=quick`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector(`[data-question-id="${QUESTION}"] input[value="B"]`, {
      visible: true,
    });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    for (let index = 0; index < 40 && lab.store.rows.length <= before; index += 1) await sleep(50);
    const visit = lab.store.rows.find(
      (row) =>
        String(row.user_id) === '1' &&
        row.node_id === 'SS-01-01' &&
        row.metadata_json.action === 'visit',
    );
    assert.ok(visit, 'normal knowledge loading records navigation without an opt-in action');
    await page.locator(`[data-question-id="${QUESTION}"] input[value="B"]`).click();
    const attemptResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/learning-assessments/signals/SS-01-01/attempts') &&
        response.request().method() === 'POST',
    );
    await page.locator(`[data-question-id="${QUESTION}"] button[type="submit"]`).click();
    assert.equal((await attemptResponse).status(), 201);
    const attempt = lab.attempts.find(
      (row) => String(row.user_id) === '1' && row.question_id === QUESTION,
    );
    assert.ok(
      attempt && attempt.is_official === 1 && attempt.verdict === 'fail',
      'real preview grading produces official failure evidence',
    );
    const manualQuestion = 'SS-01-01-Q-explain';
    await page.locator(`[data-question-id="${manualQuestion}"] textarea`).click();
    await page.keyboard.type(
      'QA-private-response-only: use shifted impulse responses and superposition.',
    );
    const manualResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/learning-assessments/signals/SS-01-01/attempts') &&
        response.request().method() === 'POST',
    );
    await page.locator(`[data-question-id="${manualQuestion}"] button[type="submit"]`).click();
    assert.equal((await manualResponse).status(), 201);
    const manualAttempt = lab.attempts.find(
      (row) => String(row.user_id) === '1' && row.question_id === manualQuestion,
    );
    assert.ok(
      manualAttempt?.status === 'pending_review' && manualAttempt.is_official === 1,
      'actual reviewed manual question produces a pending-review result, not an invented grade',
    );
    assert.ok(
      lab.store.rows.every((row) => !JSON.stringify(row.metadata_json).includes('输入与冲激响应')),
      'process rows exclude answer text',
    );
    pass(scene, 'native read → automatic visit → native wrong answer → real official result');

    scene = 'personal-views-search-and-return';
    await open(page, lab, '/profile?uid=u_preview01', PERSONAL);
    assert.equal(
      await page.$$eval(`${PERSONAL} input[type="checkbox"]`, (items) => items.length),
      0,
    );
    assert.deepEqual(
      await page.$$eval(`${PERSONAL} [data-learning-data-view]`, (items) =>
        items.map((item) => item.dataset.learningDataView),
      ),
      ['overview', 'units', 'assessment'],
    );
    const summary = (await lab.api('/summary?window=30')).data;
    assert.equal(JSON.stringify(summary).includes('QA-private-answer-never-visible'), false);
    assert.equal(
      JSON.stringify(summary).includes('QA-private-response-only'),
      false,
      'native submitted answer text is absent from the process summary',
    );
    const official = await page.$$eval(
      `${PERSONAL} [data-learning-data-panel="overview"] .learning-data-metric`,
      (items) =>
        items
          .find((item) => item.querySelector('span').textContent === '正式自测作答')
          .querySelector('strong').textContent,
    );
    assert.equal(Number(official), summary.selftest.officialAttempts);
    await switchView(page, PERSONAL, 'assessment');
    await switchView(page, PERSONAL, 'units');
    const search = `${PERSONAL} .learning-data-search`;
    const unitCount = summary.journey.units.length;
    for (const query of ['SS-01-01', '连续时间卷积', '信号与系统']) {
      await page.locator(search).click();
      await selectAll(page);
      await page.keyboard.type(query);
      const visible = await page.$$eval(`${PERSONAL} .learning-data-unit:not([hidden])`, (items) =>
        items.map((item) => item.textContent),
      );
      assert.ok(visible.length > 0, `knowledge search really matches ${query}`);
    }
    await selectAll(page);
    await page.keyboard.type('没有这个知识点-QA');
    assert.equal(
      await page.$$eval(`${PERSONAL} .learning-data-unit:not([hidden])`, (items) => items.length),
      0,
    );
    assert.match(
      await page.$eval(`${PERSONAL} .learning-data-journey`, (item) => item.textContent),
      /找到 0 个知识点记录/,
    );
    await selectAll(page);
    await page.keyboard.press('Backspace');
    assert.equal(
      await page.$$eval(`${PERSONAL} .learning-data-unit:not([hidden])`, (items) => items.length),
      unitCount,
    );
    const filtered = page.waitForResponse((response) =>
      response.url().includes('/summary?window=7'),
    );
    await page.select(`${PERSONAL} select[aria-label="统计时间范围"]`, '7');
    await filtered;
    await page.waitForFunction(
      (host) =>
        document
          .querySelector(`${host} [data-learning-data-view="units"]`)
          ?.getAttribute('aria-pressed') === 'true' &&
        !document.querySelector(`${host} [data-learning-data-status]`).textContent,
      {},
      PERSONAL,
    );
    assert.equal(
      await page.$$eval(`${PERSONAL} .learning-data-unit`, (items) => items.length),
      (await lab.api('/summary?window=7')).data.journey.units.length,
    );
    const all = page.waitForResponse((response) => response.url().includes('/summary?window=all'));
    await page.select(`${PERSONAL} select[aria-label="统计时间范围"]`, 'all');
    await all;
    await page.waitForFunction(
      (host) => !document.querySelector(`${host} [data-learning-data-status]`).textContent,
      {},
      PERSONAL,
    );
    await switchView(page, PERSONAL, 'overview');
    const next = `${PERSONAL} .learning-data-next-card a[href*="quiz=mistakes"]`;
    await page.waitForSelector(next, { visible: true });
    const nextHref = await page.$eval(next, (item) => item.getAttribute('href'));
    assert.equal(new URL(nextHref, lab.base).searchParams.get('tool'), 'feedback');
    await page.locator(next).click();
    await page.waitForSelector(`#learning-quiz-list [data-question-id="${QUESTION}"]`, {
      visible: true,
    });
    assert.equal(
      await page.$eval(
        '#learning-quiz-tabs [data-quiz-view="mistakes"]',
        (item) => item.getAttribute('aria-selected') || item.getAttribute('aria-pressed'),
      ),
      'true',
    );
    assert.match(
      await page.$eval('#learning-quiz-list', (item) => item.textContent),
      /连续时间 LTI 系统/,
    );
    pass(
      scene,
      'three views, native search, time filters retain view, actual next-step link opens recorded wrong question',
      { nextHref },
    );
    await primary.context.close();

    for (const width of [320, 390, 768, 1440])
      for (const theme of ['light', 'dark']) {
        scene = `matrix-${width}-${theme}`;
        const matrix = await makePage({ width, height: width < 620 ? 844 : 1000 }, theme);
        const matrixPage = matrix.page;
        const observations = { width, theme, personal: {}, admin: {} };
        await open(matrixPage, lab, '/profile?uid=u_preview01', PERSONAL);
        for (const view of ['overview', 'units', 'assessment']) {
          await switchView(matrixPage, PERSONAL, view);
          observations.personal[view] = await layout(matrixPage, PERSONAL);
          assert.equal(observations.personal[view].theme, theme);
          if (view === 'overview') {
            const days = await matrixPage.$$eval(`${PERSONAL} .learning-data-day`, (items) =>
              items.map((item) => item.getAttribute('aria-label')),
            );
            assert.equal(
              days.length,
              14,
              'calendar keeps empty days instead of pretending discontinuous dates are adjacent',
            );
            assert.ok(
              days.some((label) => label.includes('没有活动记录，不表示没有学习')),
              'calendar gaps are explicitly unknown learning, not zero learning',
            );
          }
        }
        await matrixPage.locator(`${PERSONAL} .learning-data-refresh`).click();
        await matrixPage.waitForFunction(
          (host) => !document.querySelector(`${host} [data-learning-data-status]`).textContent,
          {},
          PERSONAL,
        );
        await tabTo(matrixPage, `${PERSONAL} [data-learning-data-view="overview"]`);
        await matrixPage.keyboard.press('Enter');
        await matrixPage.waitForSelector(
          `${PERSONAL} [data-learning-data-panel="overview"]:not([hidden])`,
          { visible: true },
        );
        await (await matrixPage.$(PERSONAL)).scrollIntoView();
        const ownImage = path.join(output, `${scene}-personal.png`);
        await matrixPage.screenshot({ path: ownImage });
        report.screenshots.push(ownImage);
        await open(matrixPage, lab, '/adminusers?as=admin', ADMIN);
        assert.deepEqual(
          await matrixPage.$$eval(`${ADMIN} [data-learning-data-view]`, (items) =>
            items.map((item) => item.textContent),
          ),
          ['平台使用', '学习支持证据', '学习路径', '记录明细'],
        );
        const scopeText = await matrixPage.$eval(ADMIN, (item) => item.textContent);
        assert.match(scopeText, /战略部观察平台设计对学习与发展的支持/);
        assert.match(scopeText, /课程内容和题目问题由课程部跟进/);
        assert.match(scopeText, /当前仅覆盖学习页面/);
        const courseSupport = `${ADMIN} details.learning-data-next`;
        assert.equal(await matrixPage.$eval(courseSupport, (item) => item.open), false);
        assert.equal(
          await matrixPage.$eval(`${courseSupport} summary`, (item) => item.textContent),
          '课程支持待办（课程部）',
        );
        await matrixPage.locator(`${courseSupport} summary`).click();
        assert.equal(await matrixPage.$eval(courseSupport, (item) => item.open), true);
        await matrixPage.locator(`${courseSupport} summary`).click();
        assert.equal(await matrixPage.$eval(courseSupport, (item) => item.open), false);
        const adminData = (await lab.api('/admin/overview?window=30', 'admin')).data;
        assert.equal(adminData.diagnostics.coverage.businessOnlyLearners, 1);
        assert.equal(adminData.limitedSample, true);
        assert.deepEqual(
          await matrixPage.$$eval(`${ADMIN} [data-learning-data-view]`, (items) =>
            items.map((item) => item.dataset.learningDataView),
          ),
          ['overview', 'evidence', 'journey', 'users'],
        );
        for (const view of ['overview', 'evidence', 'journey', 'users']) {
          await switchView(matrixPage, ADMIN, view);
          if (view === 'users')
            await matrixPage.locator(`${ADMIN} .learning-data-users summary`).click();
          observations.admin[view] = await layout(matrixPage, ADMIN);
          if (view === 'evidence')
            assert.match(
              await matrixPage.$eval(
                `${ADMIN} [data-learning-data-panel="evidence"]`,
                (item) => item.textContent,
              ),
              /尚未验证/,
            );
        }
        const rowTexts = await matrixPage.$$eval(`${ADMIN} .learning-data-users tbody tr`, (rows) =>
          rows.map((row) => [...row.cells].map((cell) => cell.textContent)),
        );
        const second = rowTexts.find((cells) => cells[0] === USERS.other.username);
        assert.ok(second, 'synthetic other learner appears once in aggregate table');
        assert.deepEqual(second.slice(3, 8), ['15', '3', '12', '1 / 1', '1']);
        const text = await matrixPage.$eval(ADMIN, (item) => item.textContent);
        assert.match(text, /本分析不读取私人批注、聊天或答案正文/);
        assert.match(text, /不代表当前题库通过或掌握程度/);
        assert.ok(!text.includes('QA-private-answer-never-visible'));
        const scroll = `${ADMIN} .learning-data-users .learning-data-table-scroll`;
        observations.keyboard = await tabTo(matrixPage, scroll, 140);
        const scrollBefore = await matrixPage.$eval(scroll, (item) => ({
          x: item.scrollLeft,
          max: item.scrollWidth - item.clientWidth,
          pageX: window.scrollX,
        }));
        if (scrollBefore.max > 0) {
          for (let index = 0; index < 70; index += 1) await matrixPage.keyboard.press('ArrowRight');
          await sleep(200);
          const tail = await matrixPage.$eval(scroll, (item) => ({
            x: item.scrollLeft,
            max: item.scrollWidth - item.clientWidth,
            pageX: window.scrollX,
          }));
          assert.ok(
            tail.x > scrollBefore.x && tail.x >= tail.max - 1 && tail.pageX === scrollBefore.pageX,
            'native arrow keys reach the table tail without moving the entire page',
          );
          observations.localScroll = tail;
        }
        const adminImage = path.join(output, `${scene}-admin-users.png`);
        await matrixPage.screenshot({ path: adminImage });
        report.screenshots.push(adminImage);
        report.matrix.push(observations);
        pass(
          scene,
          'all personal/admin views, exact official/practice counts, privacy limits, contrast, font, native focus and local horizontal scroll',
        );
        await matrix.context.close();
      }

    scene = 'failure-refresh-legacy-and-stale-account';
    const resilience = await makePage();
    const currentPage = resilience.page;
    await open(currentPage, lab, '/profile?uid=u_preview01', PERSONAL);
    resilience.fault.mode = '503';
    resilience.fault.seen = 0;
    await currentPage.locator(`${PERSONAL} .learning-data-refresh`).click();
    await currentPage.waitForFunction(
      (host) =>
        document
          .querySelector(`${host} [data-learning-data-status]`)
          .textContent.includes('QA 模拟'),
      {},
      PERSONAL,
    );
    await sleep(1300);
    assert.equal(resilience.fault.seen, 1, 'failed summary GET is not automatically retried');
    assert.equal(
      await currentPage.$$eval(`${PERSONAL} [data-learning-data-view]`, (items) => items.length),
      3,
      'existing read-only records remain visible during failed refresh',
    );
    resilience.fault.mode = '';
    await currentPage.locator(`${PERSONAL} .learning-data-refresh`).click();
    await currentPage.waitForFunction(
      (host) => !document.querySelector(`${host} [data-learning-data-status]`).textContent,
      {},
      PERSONAL,
    );
    pass(scene, 'one failed GET, no retry loop, explicit manual refresh recovers');

    resilience.fault.legacy = structuredClone((await lab.api('/summary?window=30')).data);
    delete resilience.fault.legacy.process.activeSeconds;
    delete resilience.fault.legacy.selftest.officialAttempts;
    delete resilience.fault.legacy.selftest.passed;
    delete resilience.fault.legacy.journey.units[0].practiceAttempts;
    resilience.fault.mode = 'legacy';
    await currentPage.locator(`${PERSONAL} .learning-data-refresh`).click();
    await currentPage.waitForFunction(
      (host) =>
        document.querySelector(`${host} .learning-data-metric strong`) &&
        [...document.querySelectorAll(`${host} .learning-data-metric strong`)].filter(
          (item) => item.textContent === '未提供',
        ).length >= 2,
      {},
      PERSONAL,
    );
    await switchView(currentPage, PERSONAL, 'assessment');
    assert.match(
      await currentPage.$eval(
        `${PERSONAL} [data-learning-data-panel="assessment"]`,
        (item) => item.textContent,
      ),
      /未提供 \/ /,
    );
    await switchView(currentPage, PERSONAL, 'units');
    assert.match(
      await currentPage.$eval(`${PERSONAL} .learning-data-unit-facts`, (item) => item.textContent),
      /练习 未提供/,
    );
    pass(scene, 'intentional legacy missing fields remain unknown rather than fabricated zeros');

    resilience.fault.mode = 'delay';
    resilience.fault.delayed = null;
    await currentPage.locator(`${PERSONAL} .learning-data-refresh`).click();
    for (let index = 0; index < 100 && !resilience.fault.delayed; index += 1) await sleep(20);
    assert.ok(
      resilience.fault.delayed,
      'old owner response has actually reached the router and is withheld',
    );
    await currentPage.evaluate(
      (token, user) => {
        // Synthetic identity switch uses the production identity-updated event.
        // Profile route changes to the new owner; no DOM/state/focus is forged.
        window.history.replaceState(window.history.state, '', `/profile?uid=${user.uid}`);
        window.dispatchEvent(
          new CustomEvent('freebbs:identity-updated', { detail: { token, user } }),
        );
      },
      TOKENS.other,
      USERS.other,
    );
    await currentPage.waitForFunction(
      (host) =>
        !document.querySelector(`${host} [data-learning-data-status]`)?.textContent &&
        document.querySelector(`${host} [data-learning-data-view]`),
      {},
      PERSONAL,
    );
    const newOwnerExpected = (await lab.api('/summary?window=30', 'other')).data.selftest
      .officialAttempts;
    const metricValue = () =>
      currentPage.$$eval(
        `${PERSONAL} [data-learning-data-panel="overview"] .learning-data-metric`,
        (items) =>
          items
            .find((item) => item.querySelector('span').textContent === '正式自测作答')
            .querySelector('strong').textContent,
      );
    assert.equal(Number(await metricValue()), newOwnerExpected);
    const { delayed } = resilience.fault;
    await delayed.request.respond({
      status: delayed.status,
      contentType: 'application/json',
      body: delayed.payload,
    });
    await sleep(250);
    assert.equal(
      Number(await metricValue()),
      newOwnerExpected,
      'old owner callback cannot overwrite a new account',
    );
    pass(scene, 'actual old GET callback stays stale after real identity event', {
      newOwnerExpected,
    });
    await resilience.context.close();

    scene = 'admin-revocation-and-legacy';
    const adminResilience = await makePage();
    await open(adminResilience.page, lab, '/adminusers?as=admin', ADMIN);
    adminResilience.fault.legacy = structuredClone(
      (await lab.api('/admin/overview?window=30', 'admin')).data,
    );
    const legacyOther = adminResilience.fault.legacy.users.find((item) => String(item.id) === '2');
    delete legacyOther.selftest.officialAttempts;
    delete legacyOther.selftest.practiceAttempts;
    legacyOther.nickname = '<img src=x onerror=alert(1)> QA-literal-nickname';
    adminResilience.fault.mode = 'legacy';
    await adminResilience.page.locator(`${ADMIN} .learning-data-refresh`).click();
    await adminResilience.page.waitForFunction(
      (host) =>
        document.querySelector(host).textContent.includes('QA-literal-nickname') &&
        !document.querySelector(`${host} [data-learning-data-status]`).textContent,
      {},
      ADMIN,
    );
    await switchView(adminResilience.page, ADMIN, 'users');
    await adminResilience.page.locator(`${ADMIN} .learning-data-users summary`).click();
    assert.match(
      await adminResilience.page.$eval(`${ADMIN} .learning-data-users`, (item) => item.textContent),
      /未分列/,
    );
    assert.equal(
      await adminResilience.page.$$eval(
        `${ADMIN} .learning-data-users tbody img`,
        (items) => items.length,
      ),
      0,
    );
    const unspecified = await adminResilience.page.$$eval(
      `${ADMIN} .learning-data-users tbody tr`,
      (rows) =>
        [...rows.find((row) => row.cells[0].textContent.includes('QA-literal-nickname')).cells].map(
          (cell) => cell.textContent,
        ),
    );
    assert.deepEqual(unspecified.slice(4, 6), ['未分列', '未分列']);
    adminResilience.fault.mode = 'delay';
    adminResilience.fault.delayed = null;
    await adminResilience.page.locator(`${ADMIN} .learning-data-refresh`).click();
    for (let index = 0; index < 100 && !adminResilience.fault.delayed; index += 1) await sleep(20);
    assert.ok(adminResilience.fault.delayed);
    await adminResilience.page.evaluate(
      (token, user) =>
        window.dispatchEvent(
          new CustomEvent('freebbs:identity-updated', { detail: { token, user } }),
        ),
      TOKENS.other,
      USERS.other,
    );
    await adminResilience.page.waitForFunction(
      (host) => document.querySelector(host).hidden && !document.querySelector(host).textContent,
      {},
      ADMIN,
    );
    await adminResilience.fault.delayed.request.respond({
      status: 200,
      contentType: 'application/json',
      body: adminResilience.fault.delayed.payload,
    });
    await sleep(200);
    assert.equal(
      await adminResilience.page.$eval(ADMIN, (item) => item.hidden && !item.textContent),
      true,
    );
    pass(
      scene,
      'legacy split counts stay unspecified, literal nickname is escaped, revoked admin response cannot reveal aggregates',
    );
    await adminResilience.context.close();

    scene = 'assessment-table-unavailable';
    lab.faults.assessmentsUnavailable = true;
    const unavailable = await makePage();
    try {
      const snapshot = (await lab.api('/summary?window=30')).data;
      assert.equal(snapshot.effectiveness.assessmentDataStatus, 'not_available');
      assert.equal(snapshot.insights.assessmentDataStatus, 'not_available');
      await open(unavailable.page, lab, '/profile?uid=u_preview01', PERSONAL);
      const metrics = await unavailable.page.$$eval(
        `${PERSONAL} [data-learning-data-panel="overview"] .learning-data-metric`,
        (items) =>
          Object.fromEntries(
            items.map((item) => [
              item.querySelector('span').textContent,
              item.querySelector('strong').textContent,
            ]),
          ),
      );
      assert.equal(
        metrics['正式自测作答'],
        '未提供',
        'missing assessment table is not zero formal attempts',
      );
      assert.equal(
        metrics['待课程组复核'],
        '未提供',
        'unknown pending work is not zero pending work',
      );
      const suggestions = await unavailable.page.$eval(
        `${PERSONAL} .learning-data-next`,
        (item) => item.textContent,
      );
      assert.doesNotMatch(
        suggestions,
        /目前没有需要特别回看的记录/,
        'missing business source cannot assert there is no review needed',
      );
      assert.match(
        suggestions,
        /未提供|暂|不可用|未知/,
        'missing business source is disclosed beside next-step suggestions',
      );
      await switchView(unavailable.page, PERSONAL, 'assessment');
      assert.match(
        await unavailable.page.$eval(
          `${PERSONAL} [data-learning-data-panel="assessment"]`,
          (item) => item.textContent,
        ),
        /未提供 \/ 未提供/,
      );
      await switchView(unavailable.page, PERSONAL, 'units');
      const facts = await unavailable.page.$$eval(
        `${PERSONAL} .learning-data-unit-facts`,
        (items) => items.map((item) => item.textContent),
      );
      assert.ok(
        facts.length > 0 &&
          facts.every(
            (value) =>
              /练习 未提供/.test(value) &&
              /正式自测 未提供/.test(value) &&
              /待复核 未提供/.test(value),
          ),
        'process-only units do not imply zero business history while the assessment source is unavailable',
      );
      await open(unavailable.page, lab, '/adminusers?as=admin', ADMIN);
      const aggregate = await unavailable.page.$$eval(
        `${ADMIN} [data-learning-data-panel="overview"] .learning-data-metric`,
        (items) =>
          Object.fromEntries(
            items.map((item) => [
              item.querySelector('span').textContent,
              item.querySelector('strong').textContent,
            ]),
          ),
      );
      assert.equal(aggregate['正式自测作答'], '未提供');
      await switchView(unavailable.page, ADMIN, 'users');
      await unavailable.page.locator(`${ADMIN} .learning-data-users summary`).click();
      const userRows = await unavailable.page.$$eval(
        `${ADMIN} .learning-data-users tbody tr`,
        (rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent)),
      );
      assert.ok(
        userRows.every((cells) => cells.slice(3).every((cell) => /未提供|未分列/.test(cell))),
        'all per-user business count columns remain unknown, not a false zero',
      );
      pass(
        scene,
        'actual router unavailable markers propagate to personal/admin counts, next steps and unit facts',
      );
    } finally {
      lab.faults.assessmentsUnavailable = false;
      await unavailable.context.close();
    }

    scene = 'clear-success-summary-failure';
    const partialClear = await makePage();
    await open(partialClear.page, lab, '/profile?uid=u_preview01', PERSONAL);
    partialClear.page.on('dialog', (dialog) => dialog.accept());
    const partialAttempts = lab.attempts.length;
    assert.ok(lab.store.rows.some((row) => String(row.user_id) === '1'));
    partialClear.fault.mode = '503';
    partialClear.fault.seen = 0;
    const removedResponse = partialClear.page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/learning-analytics/events') &&
        response.request().method() === 'DELETE',
    );
    await partialClear.page
      .locator(`${PERSONAL} .learning-data-controls button:last-child`)
      .click();
    assert.equal((await removedResponse).status(), 200);
    await partialClear.page.waitForFunction(
      (host) =>
        /清空/.test(document.querySelector(`${host} [data-learning-data-status]`).textContent) &&
        !/正在加载/.test(document.querySelector(`${host} [data-learning-data-status]`).textContent),
      {},
      PERSONAL,
    );
    const partialMessage = await partialClear.page.$eval(
      `${PERSONAL} [data-learning-data-status]`,
      (item) => item.textContent,
    );
    assert.match(
      partialMessage,
      /已清空/,
      'successful DELETE is not falsely reported as a failed clear',
    );
    assert.match(
      partialMessage,
      /刷新|加载/,
      'successful clear and subsequent failed summary are distinguished',
    );
    assert.match(
      partialMessage,
      /失败|不可用|未能|重试|暂/,
      'failed post-clear load is disclosed rather than swallowed',
    );
    assert.equal(lab.store.rows.filter((row) => String(row.user_id) === '1').length, 0);
    assert.equal(lab.attempts.length, partialAttempts);
    assert.equal((await lab.api('/preferences')).data.preferences.enabled, true);
    await sleep(1300);
    assert.equal(
      partialClear.fault.seen,
      1,
      'post-clear summary failure also does not trigger a retry loop',
    );
    await partialClear.page.goto(
      `${lab.base}/knowledge?course=signals&point=SS-01-01&view=reading`,
      { waitUntil: 'domcontentloaded' },
    );
    await partialClear.page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
      visible: true,
    });
    for (
      let index = 0;
      index < 60 && !lab.store.rows.some((row) => String(row.user_id) === '1');
      index += 1
    )
      await sleep(50);
    assert.ok(
      lab.store.rows.some(
        (row) => String(row.user_id) === '1' && row.metadata_json.action === 'visit',
      ),
      'failed post-clear summary does not disable the next normal learning record',
    );
    pass(
      scene,
      'real DELETE 200 + explicit summary 503 preserves enabled recording, truthful status and business evidence',
    );
    await partialClear.context.close();

    scene = 'clear-history-keeps-learning-and-auto-recording';
    const cleanup = await makePage();
    await open(cleanup.page, lab, '/profile?uid=u_preview01', PERSONAL);
    cleanup.page.on('dialog', (dialog) => dialog.accept());
    const beforeAttempts = lab.attempts.length;
    const clearButton = await cleanup.page.$(
      `${PERSONAL} .learning-data-controls button:last-child`,
    );
    await clearButton.click();
    await cleanup.page.waitForFunction(
      (host) =>
        document
          .querySelector(`${host} [data-learning-data-status]`)
          .textContent.includes('已清空'),
      {},
      PERSONAL,
    );
    assert.equal(lab.store.rows.filter((row) => String(row.user_id) === '1').length, 0);
    assert.equal(
      lab.attempts.length,
      beforeAttempts,
      'clearing process history never clears assessment business rows',
    );
    assert.equal((await lab.api('/preferences')).data.preferences.enabled, true);
    await cleanup.page.goto(`${lab.base}/knowledge?course=signals&point=SS-01-01&view=reading`, {
      waitUntil: 'domcontentloaded',
    });
    await cleanup.page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
      visible: true,
    });
    for (
      let index = 0;
      index < 60 && !lab.store.rows.some((row) => String(row.user_id) === '1');
      index += 1
    )
      await sleep(50);
    assert.ok(
      lab.store.rows.some(
        (row) => String(row.user_id) === '1' && row.metadata_json.action === 'visit',
      ),
      'next normal read records again without preference interaction',
    );
    pass(
      scene,
      'clear own history preserves business results and automatically records the next normal read',
    );
    await cleanup.context.close();

    scene = 'all-suggestion-routes';
    // Each branch gets an explicitly isolated, bounded history in this QA-only
    // memory store. The real router derives nextSteps; no summary is fabricated.
    // Practice/notes histories below are synthetic actions, while pending/fail
    // use the actual native submissions made earlier in this run.
    const originalRows = [...lab.store.rows];
    const originalAttempts = [...lab.attempts];
    const ownRows = originalRows.filter((row) => String(row.user_id) !== '1');
    const otherAttempts = originalAttempts.filter((row) => String(row.user_id) !== '1');
    const routes = [
      {
        name: 'reading',
        point: 'SS-01-02',
        action: 'visit',
        type: 'navigation',
        tool: 'content',
        expectedId: 'resume_reading',
        view: 'reading',
      },
      {
        name: 'notes',
        point: 'SS-02-01',
        action: 'annotation_save',
        type: 'action',
        tool: 'notes',
        expectedId: 'review_annotation',
        view: 'notes',
      },
      {
        name: 'practice',
        point: 'SS-01-01',
        expectedId: 'continue_practice',
        view: 'feedback',
        quiz: 'practice',
        row: { ...attempt, id: '9601', is_official: 0, verdict: 'practice_only' },
      },
      {
        name: 'pending-review',
        point: 'SS-01-01',
        expectedId: 'pending_review',
        view: 'feedback',
        quiz: 'quick',
        row: manualAttempt,
      },
    ];
    try {
      for (const branch of routes) {
        lab.store.rows.splice(0, lab.store.rows.length, ...ownRows);
        lab.attempts.splice(
          0,
          lab.attempts.length,
          ...otherAttempts,
          ...(branch.row ? [branch.row] : []),
        );
        if (branch.action) {
          const response = await lab.api('/events', 'student', {
            method: 'POST',
            body: JSON.stringify({
              requestKey: crypto.randomUUID(),
              courseSlug: 'signals',
              nodeId: branch.point,
              type: branch.type,
              deltaSeconds: 0,
              metadata: { action: branch.action, tool: branch.tool },
            }),
          });
          assert.equal(
            response.status,
            201,
            'the real event router accepts only minimal historical action fields',
          );
        }
        const nextData = (await lab.api('/summary?window=30')).data;
        assert.equal(nextData.insights.nextSteps[0].id, branch.expectedId);
        const branchUi = await makePage();
        try {
          await open(branchUi.page, lab, '/profile?uid=u_preview01', PERSONAL);
          const link = `${PERSONAL} .learning-data-next-card a`;
          const href = await branchUi.page.$eval(link, (item) => item.getAttribute('href'));
          const query = new URL(href, lab.base).searchParams;
          assert.equal(query.get('point'), branch.point);
          assert.equal(
            branch.view === 'reading' ? query.get('view') : query.get('tool'),
            branch.view,
            'canonical content uses reader view, other tools use the workspace tool query',
          );
          if (branch.quiz) assert.equal(query.get('quiz'), branch.quiz);
          await branchUi.page.locator(link).click();
          await branchUi.page.waitForFunction(
            (point) => window.freeBbsKnowledge?.getLearningContext()?.node?.id === point,
            {},
            branch.point,
          );
          if (branch.view === 'reading' || branch.view === 'notes') {
            await branchUi.page.waitForSelector(
              '#knowledge-reading:not(.hidden) #knowledge-body > p',
              { visible: true },
            );
            if (branch.view === 'notes')
              await branchUi.page.waitForSelector('#learning-annotation-toolbar:not([hidden])', {
                visible: true,
              });
          } else {
            await branchUi.page.waitForSelector(
              `#learning-quiz-list [data-question-id="${branch.quiz === 'quick' ? manualQuestion : QUESTION}"]`,
              { visible: true },
            );
            assert.equal(
              await branchUi.page.$eval(
                `#learning-quiz-tabs [data-quiz-view="${branch.quiz}"]`,
                (item) => item.getAttribute('aria-selected') || item.getAttribute('aria-pressed'),
              ),
              'true',
            );
            if (branch.quiz === 'quick') {
              await branchUi.page.waitForFunction(() =>
                window.FreeBbsLearningAssessment.getSnapshot().attempts.some(
                  (row) =>
                    row.questionId === 'SS-01-01-Q-explain' && row.status === 'pending_review',
                ),
              );
              assert.match(
                await branchUi.page.$eval('#learning-quiz-results', (item) => item.textContent),
                /待(?:课程组)?复核/,
              );
            }
          }
          pass(
            scene,
            `actual router ${branch.expectedId} link enters the live ${branch.name} tool`,
            {
              href,
              fixture:
                {
                  practice: 'explicit synthetic practice version of native snapshot',
                  reading: 'explicit synthetic minimal historical event',
                  notes: 'explicit synthetic minimal historical event',
                }[branch.name] || 'native manual pending-review attempt',
            },
          );
        } finally {
          await branchUi.context.close();
        }
      }
    } finally {
      lab.store.rows.splice(0, lab.store.rows.length, ...originalRows);
      lab.attempts.splice(0, lab.attempts.length, ...originalAttempts);
    }
    assert.equal(report.pageErrors.length, 0, JSON.stringify(report.pageErrors));
    report.passed = true;
  } catch (error) {
    report.checks.push({ scene, name: error.message, pass: false });
    report.passed = false;
    process.exitCode = 1;
    console.error(error.stack);
  } finally {
    await browser.close();
    lab.server.closeAllConnections?.();
    await new Promise((resolve) => {
      lab.server.close(resolve);
    });
    const filename = path.join(output, 'records-redesign-report.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          checks: report.checks.filter((item) => item.pass).length,
          matrix: report.matrix.length,
          report: filename,
        },
        null,
        2,
      ),
    );
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
module.exports = { createLab, contrast };
