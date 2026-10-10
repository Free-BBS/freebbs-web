// Real page/router + isolated memory records. All external requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { createCourseRelationsMap } = require('./fixtures/course-relations-map');

// Font loading and unrelated global polling are not learning-record completion barriers.
async function waitForLearningApiIdle(page, trigger) {
  const pending = new Set();
  let lastActivity = Date.now();
  const start = (request) => {
    if (!new URL(request.url()).pathname.startsWith('/api/learning-')) return;
    pending.add(request);
    lastActivity = Date.now();
  };
  const finish = (request) => {
    if (pending.delete(request)) lastActivity = Date.now();
  };
  page.on('request', start);
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  try {
    await trigger();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (!pending.size && Date.now() - lastActivity >= 350) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error('Learning API requests did not settle'));
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  } finally {
    page.off('request', start);
    page.off('requestfinished', finish);
    page.off('requestfailed', finish);
  }
}

// Existing scenes now enter through the real mandatory course starting-point control.
async function confirmLearningStartAutomatically(page) {
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
      // Disable only smooth document scrolling; keep real input hit-testing and page behavior.
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    });
    const confirm = () => {
      const dialog = document.querySelector('.learning-start-dialog[open]');
      if (!dialog) return;
      const level = dialog.querySelector('[data-learning-start-choice="level"]');
      if (!level) return;
      level.value = 'familiar';
      level.dispatchEvent(new Event('change', { bubbles: true }));
      dialog.querySelector('.learning-start-apply')?.click();
    };
    new MutationObserver(confirm).observe(document, { childList: true, subtree: true });
  });
}

async function clickUnobscured(page, selector) {
  await page.$eval(selector, (item) =>
    item.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.waitForFunction(
    (value) => {
      const item = document.querySelector(value);
      const rect = item?.getBoundingClientRect();
      if (!rect) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    },
    {},
    selector,
  );
  await page.click(selector);
}

async function checkCourseRelations(browser, output) {
  // Forty-five points per chapter exercises the forty-item page limit and its second page.
  const fixture = createCourseRelationsMap({ pointsPerChapter: 45 });
  const preview = createLearningPreview({ mapNodes: fixture.nodes, mapEdges: fixture.edges });
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const page = await browser.newPage();
  await confirmLearningStartAutomatically(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === base) return request.continue();
    return request.respond({ status: 403, body: 'External services disabled' });
  });
  const points = '.course-structure-picker [data-course-point-id]';
  const chapterPicker = 'select.course-structure-picker-chapter';
  const pointSearch = 'input.course-structure-picker-search';
  const graphIds = () =>
    page.$$eval('.course-structure-node.is-knowledge', (elements) =>
      elements.map((element) => element.getAttribute('aria-label').split(' ')[0]).sort(),
    );
  const assertGraph = async (expected, message) => {
    assert.deepEqual(await graphIds(), [...expected].sort(), message);
  };
  const pick = async (id) => {
    const selector = `.course-structure-picker [data-course-point-id="${id}"]`;
    await page.waitForSelector(selector);
    await page.click(selector);
    await page.waitForFunction(
      (value) =>
        document.getElementById('course-map-canvas').courseStructureController?.getState()
          .focusedNodeId === value,
      {},
      id,
    );
  };
  const assertNoOverflow = async (width) => {
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `course picker and graph have no horizontal page overflow at ${width}px`,
    );
  };
  const assertReadableGraph = async (width) => {
    const labels = await page.$$eval(
      '.course-structure-node.is-knowledge .course-structure-node-title',
      (elements) => {
        const viewer = document.querySelector('.course-structure-viewer').getBoundingClientRect();
        return elements.map((element) => {
          const matrix = element.getScreenCTM();
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent,
            fontPixels:
              parseFloat(getComputedStyle(element).fontSize) * Math.hypot(matrix.a, matrix.b),
            inside:
              rect.left >= viewer.left - 1 &&
              rect.right <= viewer.right + 1 &&
              rect.top >= viewer.top - 1 &&
              rect.bottom <= viewer.bottom + 1,
          };
        });
      },
    );
    assert.equal(labels.length, 3);
    for (const label of labels) {
      assert.ok(
        label.fontPixels >= 8,
        `${width}px graph label stays readable: ${JSON.stringify(label)}`,
      );
      assert.equal(
        label.inside,
        true,
        `${width}px graph label fits inside the viewer: ${label.text}`,
      );
    }
  };
  const waitForRelationLayout = async (compact) => {
    await page.waitForFunction(
      (stacked) => {
        const current = document
          .querySelector('.course-structure-node.is-knowledge[aria-label^="SS-01-01 "]')
          ?.getBoundingClientRect();
        const sameChapter = document
          .querySelector('.course-structure-node.is-knowledge[aria-label^="SS-01-02 "]')
          ?.getBoundingClientRect();
        const crossChapter = document
          .querySelector('.course-structure-node.is-knowledge[aria-label^="SS-02-01 "]')
          ?.getBoundingClientRect();
        if (!current || !sameChapter || !crossChapter) return false;
        return stacked
          ? crossChapter.top > Math.max(current.bottom, sameChapter.bottom)
          : crossChapter.left > Math.max(current.right, sameChapter.right);
      },
      {},
      compact,
    );
  };
  try {
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${base}/course?course=signals`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.course-structure-node.is-chapter');
      await assertGraph([], 'initial course graph contains only chapter nodes');
      assert.equal(
        await page.$$eval('.course-structure-node.is-chapter', (elements) => elements.length),
        2,
      );
      await clickUnobscured(page, '.course-structure-node.is-chapter[aria-label^="SS-01 "]');
      await page.waitForFunction(
        () => document.querySelector('select.course-structure-picker-chapter')?.value === 'SS-01',
      );
      await page.waitForSelector(`${points}[data-course-point-id="SS-01-01"]`);
      await assertGraph([], 'choosing a chapter never draws its entire knowledge graph');
      assert.equal(await page.$$eval(points, (elements) => elements.length), 40);
      assert.equal(
        await page.$$eval('[data-course-point-id]', (elements) => elements.length),
        40,
        'unselected chapters and later pages do not pre-render hidden point buttons',
      );
      await assertNoOverflow(width);

      await clickUnobscured(page, '.course-structure-picker-next');
      await page.waitForSelector(`${points}[data-course-point-id="SS-01-45"]`);
      assert.equal(await page.$$eval(points, (elements) => elements.length), 5);
      assert.equal(await page.$(`${points}[data-course-point-id="SS-01-01"]`), null);
      await clickUnobscured(page, '.course-structure-picker-previous');
      await page.waitForSelector(`${points}[data-course-point-id="SS-01-01"]`);
      assert.equal(await page.$$eval(points, (elements) => elements.length), 40);

      await page.type(pointSearch, 'SS-01-45');
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.course-structure-picker [data-course-point-id]').length === 1,
      );
      await pick('SS-01-45');
      await assertGraph(['SS-01-45'], 'a searched isolated point displays only itself');
      await page.focus(pointSearch);
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type('.course-structure-toolbar input[type="search"]', 'SS-02-01');
      await page.waitForSelector('.course-structure-search-results button');
      // Keep the target clear of the sticky page header after the course summary grows.
      await page.$eval('.course-structure-search-results button', (button) =>
        button.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await page.waitForFunction(() => {
        const button = document.querySelector('.course-structure-search-results button');
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return button === hit || button.contains(hit);
      });
      await page.click('.course-structure-search-results button');
      await page.waitForFunction(
        () =>
          document.getElementById('course-map-canvas').courseStructureController?.getState()
            .focusedNodeId === 'SS-02-01',
      );
      await assertGraph(
        ['SS-01-01', 'SS-02-01', 'SS-02-02'],
        'global search immediately focuses a point in another chapter',
      );
      assert.equal(await page.$eval(chapterPicker, (element) => element.value), 'SS-02');
      await page.click('.course-structure-details .course-structure-back');
      await assertGraph(['SS-01-45'], 'back returns to the previously focused point');
      assert.equal(await page.$eval(chapterPicker, (element) => element.value), 'SS-01');
      assert.equal(await page.$$eval(points, (elements) => elements.length), 5);
      assert.equal(
        await page.$eval(`${points}[data-course-point-id="SS-01-45"]`, (element) =>
          element.getAttribute('aria-pressed'),
        ),
        'true',
        'back synchronizes the chapter picker, page and selected point',
      );
      await page.click('.course-structure-picker-previous');
      await pick('SS-01-01');
      await assertGraph(
        ['SS-01-01', 'SS-01-02', 'SS-02-01'],
        'focus includes same-chapter and cross-chapter one-hop neighbors, excluding two hops',
      );
      assert.equal(
        await page.$$eval('.course-structure-link', (elements) => elements.length),
        2,
        'focus renders only connections incident to the current point',
      );
      assert.equal(await page.$eval(chapterPicker, (element) => element.value), 'SS-01');
      await waitForRelationLayout(width < 520);
      await assertReadableGraph(width);
      await assertNoOverflow(width);
      await page.screenshot({
        path: path.join(output, `course-relations-${width}.png`),
        fullPage: true,
      });
      if (width === 1440) {
        await page.setViewport({ width: 390, height: 900 });
        await waitForRelationLayout(true);
        await assertGraph(
          ['SS-01-01', 'SS-01-02', 'SS-02-01'],
          'resizing recomputes a compact layout without changing the focused one-hop graph',
        );
        await assertReadableGraph(390);
        await assertNoOverflow(390);
        await page.screenshot({
          path: path.join(output, 'course-relations-resize-390.png'),
          fullPage: true,
        });
        await page.setViewport({ width: 1440, height: 900 });
        await waitForRelationLayout(false);
        await assertReadableGraph(1440);
      }

      await page.click('.course-structure-node.is-knowledge[aria-label^="SS-02-01 "]');
      await assertGraph(
        ['SS-01-01', 'SS-02-01', 'SS-02-02'],
        'choosing a cross-chapter neighbor recomputes one hop from the new focus',
      );
      assert.equal(await page.$eval(chapterPicker, (element) => element.value), 'SS-02');
      assert.equal(await page.$$eval(points, (elements) => elements.length), 40);
      await page.click('.course-structure-details .course-structure-primary');
      await page.waitForFunction(() =>
        document
          .querySelector('#course-knowledge-overview .knowledge-overview-people')
          ?.textContent.includes('本地夹具验证者'),
      );
      assert.equal(
        await page.$eval(
          '#course-knowledge-overview .knowledge-overview-identity h2',
          (element) => element.textContent,
        ),
        '跨章直接关联点',
        'overview uses the exact cross-chapter fixture document',
      );
      await page.click('#course-knowledge-overview button[aria-label="关闭学习概览"]');
      await page.select(chapterPicker, 'SS-01');
      await assertGraph(
        [],
        'changing chapters returns to the macro graph without expanding points',
      );
      await assertNoOverflow(width);
    }

    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}/course?course=signals&layout=directory`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('[data-reader-node-id="SS-01-01"]');
    assert.equal(
      await page.$eval('#course-layout-toggle', (element) => element.textContent.trim()),
      '知识图',
      'an explicit directory URL labels its switch to the knowledge graph correctly',
    );
    await page.click('[data-reader-node-id="SS-01-01"]');
    await page.waitForFunction(() =>
      document
        .querySelector('#course-knowledge-overview .knowledge-overview-people')
        ?.textContent.includes('本地夹具验证者'),
    );
    const relations = await page.$('#course-knowledge-overview footer button');
    assert.equal(await relations.evaluate((element) => element.textContent), '查看知识关系');
    await relations.click();
    await page.waitForSelector('.course-structure-picker');
    await assertGraph(
      ['SS-01-01', 'SS-01-02', 'SS-02-01'],
      'directory overview relation action enters the same single-point structure graph',
    );
    assert.equal(
      await page.$eval('#course-layout-toggle', (element) => element.textContent.trim()),
      '目录视图',
    );
    assert.equal(await page.$('.course-map-focus-workspace'), null);
    const missingDetail = await page.evaluate(async () => {
      const response = await fetch('/api/courses/signals/map/nodes/SS-99-99');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(missingDetail.status, 404);
    assert.equal(
      missingDetail.body.node,
      undefined,
      'unknown fixture points cannot copy another document',
    );
    assert.deepEqual(errors, []);
    return [
      'bounded chapter point picker with forty-item pagination and search',
      'single-point graph includes all-course one-hop neighbors and excludes two hops',
      'cross-chapter refocus and exact overview document',
      'chapter changes return to the macro graph',
      'directory overview relations enter the structure graph',
      'course graph and picker responsive 1440/390/320',
      'compact graph recomputes on resize and keeps fitted point labels readable',
      'history back restores the point picker chapter, page and selection',
    ];
  } catch (error) {
    await page.screenshot({
      path: path.join(output, 'course-relations-failure.png'),
      fullPage: true,
    });
    console.error(
      'Local relations QA state:',
      await page.evaluate(() => ({
        state: document.getElementById('course-map-canvas')?.courseStructureController?.getState(),
        picker: document.querySelector('.course-structure-picker')?.textContent.slice(0, 300),
        details: document.querySelector('.course-structure-details')?.textContent.slice(0, 300),
        knowledgeIds: [...document.querySelectorAll('.course-structure-node.is-knowledge')].map(
          (element) => element.getAttribute('aria-label'),
        ),
      })),
    );
    throw error;
  } finally {
    await page.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

async function main() {
  const preview = createLearningPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-learning-restored-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      timeout: Number(process.env.LEARNING_CHROME_TIMEOUT_MS || 10000),
      ...(process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage();
    await confirmLearningStartAutomatically(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
        return request.continue();
      return request.respond({ status: 403, body: 'External services disabled' });
    });
    const visit = async (query) => {
      await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&${query}`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForFunction(
        () => document.getElementById('knowledge-title').textContent === '连续时间卷积',
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.documentElement.style.scrollBehavior = 'auto';
        if (
          document.getElementById('knowledge-chat-toggle').getAttribute('aria-expanded') === 'true'
        )
          document.getElementById('knowledge-chat-close').click();
      });
    };
    const tool = async (name) => {
      await page.click(`[data-knowledge-tool="${name}"]`);
      await page.waitForFunction(
        (value) => document.querySelector('[data-knowledge-page]').dataset.learningTool === value,
        {},
        name,
      );
    };
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}/course?course=signals`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.course-structure-node.is-chapter');
    assert.equal(
      await page.$$eval('.course-structure-node.is-knowledge', (elements) => elements.length),
      0,
      'the initial graph contains only chapter-level nodes',
    );
    await page.click('.course-structure-node.is-chapter');
    assert.match(
      await page.$eval('.course-structure-details', (element) => element.textContent),
      /线性时不变系统的时域分析/,
    );
    assert.equal(
      await page.$$eval('.course-structure-node.is-knowledge', (elements) => elements.length),
      0,
      'selecting a chapter does not automatically expand it',
    );
    await page.screenshot({ path: path.join(output, 'learning-directory.png'), fullPage: true });
    await page.click('.course-structure-picker [data-course-point-id="SS-01-01"]');
    assert.deepEqual(
      await page.$$eval('.course-structure-node.is-knowledge', (elements) =>
        elements.map((element) => element.getAttribute('aria-label').split(' ')[0]).sort(),
      ),
      ['SS-01-01', 'SS-01-02', 'SS-02-01'],
      'choosing a point displays only that point and its direct neighbors',
    );
    assert.match(
      await page.$eval('.course-structure-details', (element) => element.textContent),
      /连续时间卷积/,
    );
    assert.equal(
      await page.$eval('.course-structure-primary', (element) => getComputedStyle(element).color),
      'rgb(255, 255, 255)',
      'course primary actions retain contrasting white text despite global button rules',
    );
    await page.click('.course-structure-details .course-structure-primary');
    await page.waitForFunction(() =>
      document.getElementById('course-knowledge-overview').textContent.includes('示例复核者'),
    );
    assert.equal(
      await page.$eval(
        '#course-knowledge-overview',
        (element) =>
          !element.closest('[hidden],.hidden') && element.getBoundingClientRect().width > 0,
      ),
      true,
    );
    await page.screenshot({ path: path.join(output, 'learning-overview.png') });

    await visit('view=reading&as=student');
    assert.equal(
      await page.$eval(
        '#knowledge-previous-link',
        (element) => element.getAttribute('href')?.includes('point=SS-01-00') || false,
      ),
      false,
      'previous knowledge navigation never points to the chapter overview node',
    );
    await page.click('[data-knowledge-tag="learned"]');
    assert.equal(
      await page.$eval('[data-knowledge-tag="learned"]', (element) =>
        element.getAttribute('aria-pressed'),
      ),
      'true',
    );
    await visit('view=reading&as=other');
    assert.equal(
      await page.$eval('[data-knowledge-tag="learned"]', (element) =>
        element.getAttribute('aria-pressed'),
      ),
      'false',
      'manual learning tags are not inherited by a different account',
    );
    await visit('view=reading&as=student');
    assert.equal(
      await page.$eval('[data-knowledge-tag="learned"]', (element) =>
        element.getAttribute('aria-pressed'),
      ),
      'true',
      'the original account retains its own manual learning tag',
    );
    await page.click('[data-knowledge-tag="learned"]');
    assert.equal(
      await page.$eval('[data-knowledge-tag="learned"]', (element) =>
        element.getAttribute('aria-pressed'),
      ),
      'false',
      'manual tags are cleared before the independent scoring acceptance flow',
    );
    assert.equal(
      await page.$eval('#knowledge-overview', (element) => element.classList.contains('hidden')),
      true,
    );
    assert.match(
      await page.$eval('#knowledge-history-prose', (element) => element.textContent),
      /不必为每一种输入/,
    );
    assert.ok(await page.$$eval('#knowledge-body .katex', (elements) => elements.length >= 3));
    const answer = await page.$('#knowledge-body details');
    assert.equal(
      await page.evaluate(() => {
        const safe = window.freeBbsApp.renderMarkdownContent(
          '<details open onclick="alert(1)"><summary>参考解答</summary>正文<script>alert(2)</script></details>',
        );
        return (
          safe.includes('<details>') &&
          !safe.includes('onclick') &&
          !safe.includes('<script') &&
          !safe.includes(' open')
        );
      }),
      true,
      'answer details do not allow executable attributes or automatic expansion',
    );
    assert.ok(answer, 'answer remains a sanitized details element');
    assert.equal(await answer.evaluate((element) => element.open), false);
    await page.$eval('#knowledge-body details summary', (element) => element.click());
    assert.equal(await answer.evaluate((element) => element.open), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'learning-reading.png'), fullPage: true });
    await page.evaluate(() => {
      const history = document.getElementById('knowledge-history');
      window.scrollTo(0, history.getBoundingClientRect().top + window.scrollY + 170);
    });
    assert.ok(
      Math.abs(
        await page.$eval('#knowledge-history', (element) => element.getBoundingClientRect().top),
      ) < 1,
      'knowledge origin sticks to top',
    );
    await page.screenshot({ path: path.join(output, 'learning-origin-sticky.png') });
    await page.click('#knowledge-history-toggle');
    assert.equal(
      await page.$eval('#knowledge-history-toggle', (element) =>
        element.getAttribute('aria-expanded'),
      ),
      'false',
    );

    await tool('notes');
    await page.$eval('#learning-note-composer', (element) => {
      element.open = true;
    });
    await page.type('#learning-note-form [name="title"]', '恢复版验证笔记');
    await page.type('#learning-note-form [name="content"]', '理解了翻转、平移与非零积分区间。');
    const submit = await page.$('#learning-note-form button[type="submit"]');
    await submit.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    assert.equal(
      await submit.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return (
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          (hit === element || element.contains(hit))
        );
      }),
      true,
      'note save is not clipped or covered at 900px height',
    );
    await submit.click();
    await page.waitForFunction(() =>
      document.getElementById('learning-notes').textContent.includes('恢复版验证笔记'),
    );
    await page.screenshot({ path: path.join(output, 'learning-notes.png'), fullPage: true });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() =>
      document.getElementById('learning-notes').textContent.includes('恢复版验证笔记'),
    );
    await visit('as=other&tool=notes');
    await page.waitForFunction(() =>
      /暂无(?:补充)?笔记|还没有笔记/.test(document.getElementById('learning-notes').textContent),
    );
    assert.doesNotMatch(
      await page.$eval('#learning-notes', (element) => element.textContent),
      /恢复版验证笔记/,
    );

    await visit('as=student&tool=notes');
    await page.$eval('#learning-note-composer', (element) => {
      element.open = true;
    });
    preview.setFailSave(true);
    await page.type('#learning-note-form [name="title"]', '失败重试草稿');
    await page.type('#learning-note-form [name="content"]', '保存失败仍应保留。');
    await page.click('#learning-note-form button[type="submit"]');
    await page.waitForFunction(() =>
      document
        .querySelector('#learning-note-form [role="status"]')
        .textContent.includes('保存失败'),
    );
    assert.equal(
      await page.$eval('#learning-note-form [name="content"]', (element) => element.value),
      '保存失败仍应保留。',
    );
    preview.setFailSave(false);
    await page.click('#learning-note-form button[type="submit"]');
    await page.waitForFunction(() =>
      document.getElementById('learning-notes').textContent.includes('失败重试草稿'),
    );
    await tool('continue');
    await page.waitForFunction(
      () => document.querySelectorAll('#learning-plan-steps > li').length >= 2,
    );
    const initialSteps = await page.$$eval('#learning-plan-steps > li', (elements) =>
      elements.map((element) => element.dataset.stepId),
    );
    assert.ok(
      initialSteps.length <= 20,
      'the complete editable path preserves the backend contract',
    );
    assert.equal(await page.$$eval('.learning-plan-primary', (elements) => elements.length), 1);
    assert.ok(
      await page.$$eval('.learning-plan-alternatives button', (elements) => elements.length <= 2),
    );
    assert.equal(
      await page.$eval('#learning-plan-editor', (element) => element.open),
      false,
      'the complete path is collapsed until the user chooses to edit it',
    );
    await clickUnobscured(page, '#learning-plan-editor > summary');
    assert.equal(await page.$eval('#learning-plan-editor', (element) => element.open), true);
    await clickUnobscured(page, '#learning-plan-steps > li:first-child button[aria-label^="下移"]');
    assert.match(
      await page.$eval('#learning-plan-status', (element) => element.textContent),
      /尚未保存/,
      'a real edit click marks the path dirty before asynchronous records can refresh',
    );
    assert.deepEqual(
      await page.$$eval('#learning-plan-steps > li', (elements) =>
        elements.map((element) => element.dataset.stepId),
      ),
      [initialSteps[1], initialSteps[0], ...initialSteps.slice(2)],
      'moving the first step swaps only those two entries',
    );
    assert.equal(
      await page.$eval(
        '#learning-plan-steps > li:first-child',
        (element) => element.dataset.stepId,
      ),
      initialSteps[1],
    );
    await clickUnobscured(
      page,
      '#learning-plan-steps > li:first-child .learning-plan-step-actions button:nth-child(2)',
    );
    assert.equal(
      await page.$eval('#learning-plan-steps > li:first-child', (element) =>
        element.classList.contains('is-complete'),
      ),
      true,
    );
    const skippedStep = await page.$eval('#learning-plan-steps > li:nth-child(2)', (element) => {
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent === '跳过')
        .click();
      return element.dataset.stepId;
    });
    assert.equal(
      await page.$eval('#learning-plan-steps > li:nth-child(2)', (element) =>
        element.classList.contains('is-skipped'),
      ),
      true,
    );
    await page.click('#learning-plan-save');
    await page.waitForFunction(() =>
      document.getElementById('learning-plan-status').textContent.includes('已保存'),
    );
    await page.screenshot({
      path: path.join(output, 'learning-structured-plan.png'),
      fullPage: true,
    });
    await page.reload({ waitUntil: 'networkidle0' });
    // The original URL explicitly requests notes, so select the saved plan after reload.
    await tool('continue');
    await page.waitForFunction(
      (id) => document.querySelector('#learning-plan-steps > li')?.dataset.stepId === id,
      {},
      initialSteps[1],
    );
    await clickUnobscured(page, '#learning-plan-editor > summary');
    assert.equal(
      await page.$eval('#learning-plan-steps > li:first-child', (element) =>
        element.classList.contains('is-complete'),
      ),
      true,
    );
    assert.equal(
      await page
        .$eval('#learning-plan-steps > li:nth-child(2)', (element) => ({
          id: element.dataset.stepId,
          skipped: element.classList.contains('is-skipped'),
        }))
        .then((record) => record.id === skippedStep && record.skipped),
      true,
      'skipping preserves the saved step and its state after reload',
    );
    await page.$eval('#learning-plan-steps > li:nth-child(2)', (element) =>
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent === '恢复')
        .click(),
    );
    assert.equal(
      await page.$eval('#learning-plan-steps > li:nth-child(2)', (element) =>
        element.classList.contains('is-skipped'),
      ),
      false,
      'a skipped step can be restored without deleting it',
    );
    await page.click('#learning-plan-save');
    await page.waitForFunction(() =>
      document.getElementById('learning-plan-status').textContent.includes('已保存'),
    );
    const aiRequestsBefore = preview.requests.length;
    await page.click('#learning-open-max');
    assert.equal(
      await page.$eval('#knowledge-chat-panel', (element) => element.classList.contains('hidden')),
      false,
    );
    assert.equal(
      preview.requests.length,
      aiRequestsBefore,
      'opening Max does not auto-submit a new AI scoring or advice request',
    );
    await page.click('#knowledge-chat-close');

    await tool('feedback');
    await page.waitForFunction(
      () => document.querySelectorAll('#learning-quiz-list .learning-quiz-card').length > 0,
    );
    const questions = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning-assessments/signals/SS-01-01/questions', {
        method: 'GET',
      }),
    );
    const objective = questions.questions.find((question) => question.type === 'single_choice');
    const subjective = questions.questions.find((question) => question.type === 'short_answer');
    assert.ok(
      objective && subjective,
      'isolated browser preview supplies reviewed objective and subjective exercise fixtures',
    );
    assert.ok(
      questions.questions.every(
        (question) =>
          !('answer' in question.scoring) &&
          !('target' in question.scoring) &&
          !('rubric' in question.scoring),
      ),
      'question API strips all private scoring answers',
    );
    assert.equal(
      await page.$eval('#knowledge-body', (element) =>
        element.textContent.includes('freebbs-quiz'),
      ),
      false,
      'optional scoring data never appears in the public course body',
    );
    const objectiveSelector = `.learning-quiz-card[data-question-id="${objective.id}"]`;
    await page.click(`${objectiveSelector} input[value="${objective.options[1].id}"]`);
    await page.click(`${objectiveSelector} button[type="submit"]`);
    await page.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('本题尚未通过'),
    );
    await page.click('[data-quiz-view="practice"]');
    await page.waitForSelector(objectiveSelector);
    await page.click(`${objectiveSelector} input[value="${objective.options[0].id}"]`);
    await page.click(`${objectiveSelector} button[type="submit"]`);
    await page.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('练习反馈 1 / 1'),
    );
    assert.doesNotMatch(
      await page.$eval('#learning-quiz-results', (element) => element.textContent),
      /本题通过/,
      'practice correctness cannot claim a formal pass',
    );
    await page.click('[data-quiz-view="mistakes"]');
    await page.waitForSelector(objectiveSelector);
    assert.ok(
      await page.$(objectiveSelector),
      'a practice pass does not clear the previously failed formal question',
    );
    await page.screenshot({
      path: path.join(output, 'learning-private-mistake.png'),
      fullPage: true,
    });
    await page.click(`${objectiveSelector} input[value="${objective.options[0].id}"]`);
    await page.click(`${objectiveSelector} button[type="submit"]`);
    await page.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('本题通过'),
    );
    assert.equal(
      await page.$(objectiveSelector),
      null,
      'corrected latest attempt removes the question from active mistakes',
    );
    await page.click('[data-quiz-view="quick"]');
    const subjectiveSelector = `.learning-quiz-card[data-question-id="${subjective.id}"]`;
    await page.type(
      `${subjectiveSelector} textarea`,
      '先确认零状态与线性时不变条件，再求非零积分区间。',
    );
    await page.click(`${subjectiveSelector} button[type="submit"]`);
    await page.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('待课程组复核'),
    );
    const ownAttempts = await page.evaluate(
      async () =>
        (
          await window.freeBbsApp.callApi('/learning-assessments/signals/SS-01-01/attempts', {
            method: 'GET',
          })
        ).attempts,
    );
    assert.equal(ownAttempts.find((attempt) => attempt.questionId === subjective.id).score, null);
    assert.ok(
      ownAttempts.some((attempt) => attempt.supersedesAttemptId),
      'private correction preserves the link to its original attempt',
    );
    const formalCorrection = ownAttempts.find(
      (attempt) =>
        attempt.questionId === objective.id && attempt.official && attempt.verdict === 'pass',
    );
    const correctedFailure = ownAttempts.find(
      (attempt) => attempt.id === formalCorrection?.supersedesAttemptId,
    );
    assert.equal(correctedFailure?.official, true, 'formal correction links to the formal failure');
    assert.equal(correctedFailure?.verdict, 'fail');
    await page.screenshot({
      path: path.join(output, 'learning-scored-and-pending.png'),
      fullPage: true,
    });

    await tool('notes');
    await page.waitForSelector('#knowledge-body p');
    assert.equal(await page.$$eval('#knowledge-body', (elements) => elements.length), 1);
    assert.equal(
      await page.$('#learning-annotated-document'),
      null,
      'notes do not create a second reader',
    );
    const quote = await page.evaluate(() => {
      const body = document.getElementById('knowledge-body');
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (
        node &&
        (!node.textContent.includes('固定观察时刻') || node.parentElement.closest('.katex'))
      )
        node = walker.nextNode();
      if (!node) throw new Error('course template prose not found for annotation acceptance');
      const start = node.textContent.indexOf('固定观察时刻');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 1);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const selected = selection.toString();
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return selected;
    });
    assert.equal(quote.length, 1, 'single-character selections remain valid annotations');
    await page.waitForFunction(
      () => !document.getElementById('learning-annotation-toolbar').hidden,
    );
    const annotationPalette = await page.$$eval(
      '#learning-annotation-toolbar [data-annotation-color]',
      (buttons) =>
        buttons.map((button) => ({
          color: button.dataset.annotationColor,
          background: getComputedStyle(button).backgroundColor,
        })),
    );
    await page
      .$('#learning-annotation-toolbar')
      .then((toolbar) =>
        toolbar.screenshot({ path: path.join(output, 'learning-annotation-toolbar.png') }),
      );
    assert.equal(annotationPalette.length, 4);
    assert.equal(
      new Set(annotationPalette.map((button) => button.background)).size,
      4,
      `annotation palette backgrounds must be distinct: ${JSON.stringify(annotationPalette)}`,
    );
    assert.ok(
      annotationPalette.every(({ background }) => {
        const channels = (background.match(/[\d.]+/g) || []).map(Number);
        return (
          channels.length >= 3 &&
          (channels[0] !== channels[1] || channels[1] !== channels[2]) &&
          channels[3] !== 0
        );
      }),
      `annotation palette buttons must remain visibly colored: ${JSON.stringify(annotationPalette)}`,
    );
    await page.click('[data-annotation-action="highlight"][data-annotation-color="yellow"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('#learning-annotation-list .learning-annotation-record').length >
        0,
    );
    assert.ok(
      (await page.$eval('#learning-annotation-list', (element) => element.textContent)).includes(
        quote,
      ),
    );
    assert.equal(
      await page.$$eval(
        '#knowledge-body .learning-quiz-card, #knowledge-body [data-freebbs-quiz]',
        (elements) => elements.length,
      ),
      0,
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#knowledge-body [data-private-annotation]');
    await page.screenshot({
      path: path.join(output, 'learning-private-annotations.png'),
      fullPage: true,
    });
    await visit('as=other&tool=feedback');
    await page.waitForFunction(() =>
      document.getElementById('learning-quiz-results').textContent.includes('还没有作答记录'),
    );
    assert.doesNotMatch(
      await page.$eval('#learning-quiz-results', (element) => element.textContent),
      /先确认零状态/,
    );
    await tool('notes');
    assert.equal(
      await page.$$eval('#knowledge-body [data-private-annotation]', (elements) => elements.length),
      0,
    );
    await visit('as=student&tool=content');
    await tool('content');
    await page.click('#knowledge-return-overview');
    assert.equal(
      await page.$eval('#knowledge-overview', (element) => element.classList.contains('hidden')),
      false,
      'returning to overview is not forced back to reading',
    );

    await page.goto(`${base}/knowledge?course=signals&point=SS-01-00&view=reading`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('#knowledge-chapter-network svg');
    assert.equal(
      await page.$$eval('#knowledge-chapter-network svg a', (elements) => elements.length),
      2,
    );
    assert.equal(
      await page.$$eval('#knowledge-chapter-network line', (elements) => elements.length),
      1,
    );
    await page.screenshot({
      path: path.join(output, 'learning-chapter-network.png'),
      fullPage: true,
    });
    for (const width of [768, 390, 320]) {
      await page.setViewport({ width, height: 850 });
      await visit('as=student&view=reading');
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `no horizontal overflow at ${width}`,
      );
      await tool('notes');
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      assert.equal(
        await page.evaluate(() => document.body.classList.contains('has-mobile-header')),
        false,
      );
      await page.screenshot({
        path: path.join(output, `learning-notes-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewport({ width: 1440, height: 900 });
    await visit('as=student&view=reading&theme=dark');
    await page.screenshot({ path: path.join(output, 'learning-dark.png'), fullPage: true });

    await page.goto(`${base}/profile?uid=${encodeURIComponent(users.student.uid)}&as=student`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('#personal-learning-data .learning-data-metric');
    assert.match(
      await page.$eval('#personal-learning-data', (element) => element.textContent),
      /我的学习证据/,
    );
    assert.match(
      await page.$eval('#personal-learning-data', (element) => element.textContent),
      /延迟保持.*新情境迁移.*尚未采集/,
    );
    assert.match(
      await page.$eval('#personal-learning-data', (element) => element.textContent),
      /起点是自报选择，不是能力评定/,
    );
    const ownSummary = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning-analytics/summary?window=all'),
    );
    assert.ok(
      ownSummary.selftest.officialAttempts >= 3,
      'server-persisted attempts are counted even without optional process recording',
    );
    assert.ok(
      ownSummary.selftest.pendingReview >= 1,
      'subjective pending records stay separate from scored results',
    );
    assert.equal(
      await page.$eval(
        '#personal-learning-data input[type="checkbox"]',
        (element) => element.checked,
      ),
      false,
      'process recording starts disabled',
    );
    await page.click('#personal-learning-data input[type="checkbox"]');
    await page.waitForFunction(() =>
      document
        .querySelector('#personal-learning-data [data-learning-data-status]')
        .textContent.includes('已开启'),
    );
    await page.screenshot({
      path: path.join(output, 'learning-personal-data.png'),
      fullPage: true,
    });
    await visit('as=student&view=reading');
    await page.waitForFunction(
      async () =>
        (await window.freeBbsApp.callApi('/learning-analytics/summary?window=all')).process
          .visits >= 1,
    );
    let visitsBeforeSameSession;
    await waitForLearningApiIdle(page, async () => {
      visitsBeforeSameSession = await page.evaluate(async () => {
        const summary = await window.freeBbsApp.callApi('/learning-analytics/summary?window=all');
        window.dispatchEvent(
          new CustomEvent('freebbs:session-change', {
            detail: { user: window.freeBbsApp.userState },
          }),
        );
        return summary.process.visits;
      });
    });
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.freeBbsApp.callApi('/learning-analytics/summary?window=all')).process
            .visits,
      ),
      visitsBeforeSameSession,
      'same-identity profile or wallet refresh does not inflate knowledge visits',
    );
    const exported = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning-analytics/export'),
    );
    assert.equal(exported.scope, 'learning_analytics_only');
    assert.ok(exported.events.length >= 1);
    assert.doesNotMatch(
      JSON.stringify(exported.events),
      /先确认零状态|恢复版验证笔记|失败重试草稿/,
      'process export does not include answer or private note text',
    );
    const forbiddenAdmin = await page.evaluate(async () => {
      const response = await fetch('/api/learning-analytics/admin/overview', {
        headers: { Authorization: `Bearer ${window.freeBbsApp.userState.token}` },
      });
      return response.status;
    });
    assert.equal(forbiddenAdmin, 403, 'a student cannot read administrative learning analytics');
    await page.goto(`${base}/profile?uid=${encodeURIComponent(users.student.uid)}&as=other`, {
      waitUntil: 'networkidle0',
    });
    assert.equal(
      await page.$eval('#personal-learning-data', (element) => element.hidden),
      true,
      'viewing another public profile does not disclose private learning data',
    );
    const otherExport = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning-analytics/export'),
    );
    assert.equal(
      otherExport.events.length,
      0,
      'another account cannot export the student process records',
    );
    await page.goto(`${base}/adminusers?as=admin`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#admin-learning-data .learning-data-metric');
    assert.match(
      await page.$eval('#admin-learning-data', (element) => element.textContent),
      /不作能力评价/,
    );
    assert.doesNotMatch(
      await page.$eval('#admin-learning-data', (element) => element.textContent),
      /先确认零状态|恢复版验证笔记/,
    );
    await page.screenshot({ path: path.join(output, 'learning-admin-data.png'), fullPage: true });
    await page.goto(`${base}/profile?uid=${encodeURIComponent(users.student.uid)}&as=student`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('#personal-learning-data .learning-data-controls button');
    page.once('dialog', (dialog) => dialog.accept());
    await page.$$eval('#personal-learning-data .learning-data-controls button', (buttons) =>
      buttons.find((button) => button.textContent.includes('删除')).click(),
    );
    await page.waitForFunction(() =>
      document
        .querySelector('#personal-learning-data [data-learning-data-status]')
        .textContent.includes('过程记录已删除'),
    );
    const afterDeletion = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning-analytics/summary?window=all'),
    );
    assert.equal(afterDeletion.preferences.enabled, false);
    assert.equal(afterDeletion.process.visits, 0);
    assert.equal(
      afterDeletion.selftest.officialAttempts,
      ownSummary.selftest.officialAttempts,
      'deleting optional process records preserves the authoritative self-test attempts',
    );
    assert.deepEqual(errors, []);
    const courseRelationsTests = await checkCourseRelations(browser, output);
    console.log(
      JSON.stringify(
        {
          success: true,
          output,
          pageErrors: errors,
          tests: [
            'real chapter title and overview',
            'course primary action text contrast survives global button styles',
            'origin sticky and collapse',
            'math and answer details',
            'notes persistence and privacy',
            'account-scoped manual tags persist without crossing accounts',
            'save failure recovery',
            'structured plan reorder, completion, skip, restore and persistence',
            'reviewed objective grading, practice isolation and private corrections',
            'subjective pending review without fabricated scores',
            'private original-text annotations and session isolation',
            'four distinct annotation colors remain visible in the selection toolbar',
            'personal and administrator process views with opt-in and private export',
            'same-identity session refresh preserves real visit counts',
            'process deletion preserves notes and self-tests',
            'chapter network',
            'knowledge sequence skips chapter overview nodes',
            'responsive 1440/768/390/320',
            'dark theme',
            ...courseRelationsTests,
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (browser) {
      const pages = await browser.pages();
      const failurePage = pages.find((item) => item.url().startsWith(base));
      if (failurePage) {
        await failurePage.screenshot({
          path: path.join(output, 'learning-failure.png'),
          fullPage: true,
        });
        console.error(
          'Local learning QA state:',
          await failurePage.evaluate(() => ({
            route: window.location.pathname,
            tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
            notes: document.getElementById('learning-notes')?.textContent.slice(0, 180),
            quiz: document.getElementById('learning-quiz-status')?.textContent.slice(0, 180),
            plan: document.getElementById('learning-plan-status')?.textContent.slice(0, 180),
            annotation: document
              .getElementById('learning-annotation-status')
              ?.textContent.slice(0, 180),
          })),
        );
      }
    }
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      preview.server.closeAllConnections();
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
