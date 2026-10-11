// Read-only production inspection. All authored text, identities and records below are local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { documentVersion } = require('../backend/learning-workspace');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const LABEL = '本地换位阅读探针（非正式课程正文）';
const QUOTE = '夹具定位甲';
const PRIVATE = '本人的本地私密评注，禁止串到其他课程或访客';
const markdown = `# ${LABEL}\n\n${QUOTE}是一段正常公开正文，只用于本地选区定位。\n\n<details><summary>夹具解析（默认收起）</summary><p>隐藏解析甲：此处不能作为可见阅读位置。</p><p>隐藏解析乙：关闭 details 时即便有非零几何框也不可见。</p></details>\n\n${Array.from({ length: 24 }, (_, index) => `公开阅读段落 ${index + 1}：这是无需调用人工智能也能阅读、查阅和复习的本地夹具。`).join('\n\n')}`;
const node = (id, body) => ({
  id,
  title: `${LABEL} ${id}`,
  markdown: body,
  summary: LABEL,
  hasDocument: true,
  documentVersion: documentVersion({ document_markdown: body }),
  sections: {
    basicInfoMarkdown: `课程名称：本地课程夹具\n章节/单元：本地章节夹具\n参与同学：本地测试`,
    applicationsMarkdown: LABEL,
    knowledgeMarkdown: body,
  },
});
const nodes = [
  node('SS-01-00', `# ${LABEL}`),
  node('SS-01-01', markdown),
  node('SS-01-02', `# ${LABEL}\n\n下一点不含上一点的私密评注。`),
];
const contexts = ['signals', 'circuits'].flatMap((slug) =>
  nodes.map((item) => ({
    slug,
    course_id: slug === 'signals' ? 1 : 2,
    course_name: `${LABEL} ${slug}`,
    node_id: item.id,
    title: item.title,
    document_markdown: item.markdown,
    knowledge_markdown: item.markdown,
    is_active: 1,
  })),
);

async function main() {
  const preview = createLearningPreview({
    mapNodes: nodes,
    mapEdges: [{ source: 'SS-01-01', target: 'SS-01-02', type: 'ordered' }],
    contextRows: contexts,
  });
  let base = '';
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-annotation-navigation-a11y-'));
  const report = {
    boundary:
      'Real installed Chrome, native pointer/keyboard and real frontend. Two course GET map responses and all authenticated rows are explicit isolated fixtures, not formal access evidence. Logout invokes the real handler through its DOM button; Windows forced-colors is Chrome emulation, not an NVDA or native Windows certification.',
    scenes: [],
    findings: [],
    pageErrors: [],
    aiRequests: [],
  };
  let browser;
  let page;
  const visit = async (course = 'signals', point = 'SS-01-01') => {
    await page.goto(
      `${base}/knowledge?${new URLSearchParams({ course, point, view: 'reading' })}`,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForFunction(
      () =>
        window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion &&
        document.querySelector('#knowledge-body p'),
    );
    await page.evaluate(() => document.fonts.ready);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await page.click('#knowledge-chat-close');
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  };
  const click = async (selector) => {
    await page.$eval(selector, (item) =>
      item.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.waitForFunction(
      (value) => {
        const item = document.querySelector(value);
        const rect = item?.getBoundingClientRect();
        if (!rect?.width) return false;
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === item || item.contains(hit);
      },
      {},
      selector,
    );
    await page.click(selector);
  };
  const records = async (count) =>
    page.waitForFunction(
      (value) =>
        document.querySelectorAll('#learning-annotation-list [data-annotation-id]').length ===
        value,
      {},
      count,
    );
  const privateState = async () =>
    page.evaluate(() => ({
      uid: window.freeBbsApp.userState.uid,
      hasSelection: document.getElementById('learning-annotation-toolbar').dataset.hasSelection,
      toolbarHidden: document.getElementById('learning-annotation-toolbar').hidden,
      marks: document.querySelectorAll('#knowledge-body [data-private-annotation]').length,
      comment: document.getElementById('learning-annotation-comment').value,
      directory: document.getElementById('learning-annotation-list').textContent,
    }));
  const currentReadingPosition = async () =>
    page.evaluate(() => {
      const api = window.FreeBbsLearningReader;
      const host = api.getScrollHost();
      const sticky = ['knowledge-history', 'learning-annotation-toolbar']
        .map((id) => document.getElementById(id))
        .filter((item) => item && !item.hidden && !item.classList.contains('hidden'));
      const boundary =
        (host === window ? 0 : host.getBoundingClientRect().top) +
        sticky.reduce(
          (sum, item) => sum + item.getBoundingClientRect().height,
          16 + (Number.parseFloat(getComputedStyle(sticky[0]).top) || 0),
        );
      const container = document.querySelector('#knowledge-body');
      const all = api.readableBlocks
        ? api.readableBlocks(container)
        : [...container.querySelectorAll(api.BLOCKS)].filter((item) => item.textContent.trim());
      const visible = all.filter(
        (item) =>
          !item.closest('details:not([open]),[hidden],.hidden') &&
          getComputedStyle(item).visibility !== 'hidden' &&
          item.getBoundingClientRect().height > 0,
      );
      const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
      const saved = JSON.parse(localStorage.getItem(key) || '{}')[
        JSON.stringify(['signals', 'SS-01-01'])
      ];
      const target = api.resolve(
        saved,
        all,
        window.freeBbsKnowledge.getLearningContext().node.documentVersion,
      )?.block;
      return {
        saved,
        target: target?.textContent,
        targetClosed: Boolean(target?.closest('details:not([open])')),
        visible: visible.find((item) => item.getBoundingClientRect().bottom > boundary)
          ?.textContent,
      };
    });
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({
          status: 403,
          body: 'External networks disabled by explicit local fixture',
        });
      if (url.pathname === '/__learning-bootstrap.js')
        return request.respond({
          status: 200,
          contentType: 'application/javascript',
          body: "window.FREEBBS_API_BASE='/api';if(!localStorage.getItem('__navigation_fixture_seeded')){localStorage.setItem('__navigation_fixture_seeded','1');localStorage.setItem('free_bbs_auth_token','learning-preview-student');}localStorage.setItem('free_bbs_theme_mode','light');",
        });
      if (url.pathname.startsWith('/api/courses/circuits/map')) {
        const point = url.pathname.split('/nodes/')[1];
        const course = {
          slug: 'circuits',
          name: `${LABEL} 课程B`,
          boardSlug: 'circuit',
          canEditMap: false,
        };
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            point
              ? { course, node: nodes.find((item) => item.id === point) }
              : { course, nodes, edges: [] },
          ),
        });
      }
      if (url.pathname.startsWith('/api/ai/'))
        report.aiRequests.push({ method: request.method(), path: url.pathname });
      return request.continue();
    });
    await visit();
    await page.evaluate((quote) => {
      const item = [...document.querySelectorAll('#knowledge-body p')].find(
        (paragraph) =>
          !paragraph.closest('details:not([open])') && paragraph.textContent.includes(quote),
      );
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, QUOTE);
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    const geometry = await page.evaluate((quote) => {
      const item = [...document.querySelectorAll('#knowledge-body p')].find(
        (paragraph) =>
          !paragraph.closest('details:not([open])') && paragraph.textContent.includes(quote),
      );
      const text = item.firstChild;
      const range = document.createRange();
      range.setStart(text, text.data.indexOf(quote));
      range.setEnd(text, text.data.indexOf(quote) + quote.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 0.2, end: rect.right - 0.2, y: rect.top + rect.height / 2 };
    }, QUOTE);
    await page.mouse.move(geometry.x, geometry.y);
    await page.mouse.down();
    await page.mouse.move(geometry.end, geometry.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), QUOTE);
    await click('[data-annotation-action="comment"]');
    await page.type('#learning-annotation-comment', PRIVATE);
    await click('[data-annotation-action="comment"]');
    await records(1);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      click('#knowledge-next-link'),
    ]);
    await records(0);
    const secondPoint = await privateState();
    assert.equal(secondPoint.marks, 0);
    assert.equal(secondPoint.comment, '');
    assert.equal(secondPoint.hasSelection, 'false');
    assert.equal(secondPoint.toolbarHidden, false);
    await page.goBack({ waitUntil: 'networkidle0' });
    await records(1);
    assert.equal((await privateState()).marks, 1);
    await visit('circuits');
    await records(0);
    const otherCourse = await privateState();
    assert.equal(otherCourse.marks, 0);
    assert.ok(!otherCourse.directory.includes(PRIVATE));
    assert.equal(otherCourse.comment, '');
    assert.equal(otherCourse.hasSelection, 'false');
    const courseRows = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning/circuits/SS-01-01/entries?kind=note&annotations=1', {
        method: 'GET',
      }),
    );
    assert.equal(courseRows.entries.length, 0);
    await page.goBack({ waitUntil: 'networkidle0' });
    await records(1);
    // The immersive reader intentionally has no account panel. Dispatching the real
    // existing logout button is a fixture session driver, not a claim of pointer reachability.
    await page.$eval('#user-logout-button', (item) => item.click());
    await page.waitForFunction(() => !window.freeBbsApp.userState.isLoggedIn);
    await records(0);
    const loggedOut = await privateState();
    assert.equal(loggedOut.marks, 0);
    assert.equal(loggedOut.comment, '');
    assert.ok(!loggedOut.directory.includes(PRIVATE));
    await visit('signals', 'SS-01-02');
    await page.goBack({ waitUntil: 'networkidle0' });
    await records(0);
    const returnedGuest = await privateState();
    assert.equal(returnedGuest.uid, '');
    assert.equal(returnedGuest.marks, 0);
    assert.equal(returnedGuest.toolbarHidden, false);
    report.scenes.push({
      name: 'scoped marks, selection and drafts across knowledge, course, real logout handler and Back',
      secondPoint,
      otherCourse,
      loggedOut,
      returnedGuest,
    });
    await page.evaluate(() =>
      localStorage.setItem('free_bbs_auth_token', 'learning-preview-student'),
    );
    await visit();
    await records(1);
    const positions = [];
    for (let index = 1; index <= 10; index += 1) {
      await page.evaluate((number) => {
        const target = [...document.querySelectorAll('#knowledge-body p')]
          .filter((item) => !item.closest('details:not([open])'))
          .find((item) => item.textContent.startsWith(`公开阅读段落 ${number}：`));
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        const host = window.FreeBbsLearningReader.getScrollHost();
        const inset = ['knowledge-history', 'learning-annotation-toolbar'].reduce(
          (sum, id) => sum + document.getElementById(id).getBoundingClientRect().height,
          16,
        );
        host.scrollBy({ top: -inset, behavior: 'instant' });
      }, index);
      const measured = await page.evaluate(() => {
        const api = window.FreeBbsLearningReader;
        api.capture();
        const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
        const mark = JSON.parse(localStorage.getItem(key) || '{}')[
          JSON.stringify(['signals', 'SS-01-01'])
        ];
        const container = document.querySelector('#knowledge-body');
        const all = api.readableBlocks
          ? api.readableBlocks(container)
          : [...container.querySelectorAll(api.BLOCKS)].filter((item) => item.textContent.trim());
        const version = window.freeBbsKnowledge.getLearningContext().node.documentVersion;
        const target = api.resolve(mark, all, version)?.block;
        return {
          saved: mark,
          target: target?.textContent,
          targetClosed: Boolean(target?.closest('details:not([open])')),
          hiddenRects: [...document.querySelectorAll('#knowledge-body details:not([open]) p')].map(
            (item) => ({
              text: item.textContent,
              width: item.getBoundingClientRect().width,
              height: item.getBoundingClientRect().height,
            }),
          ),
        };
      });
      positions.push(measured);
    }
    if (positions.some((item) => item.targetClosed))
      report.findings.push({
        id: 'reading-bookmark-targets-closed-details',
        evidence: positions.filter((item) => item.targetClosed),
        source: 'public/learning-reader.js:98',
        impact: '真实保存的阅读书签可能命中关闭解析，返回时位置与当前可见原文不对应。',
      });
    report.scenes.push({
      name: 'reading probes exclude closed details regardless of nonzero DOM geometry',
      positions,
    });
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('#knowledge-body p')].find(
        (item) =>
          !item.closest('details:not([open])') && item.textContent.startsWith('公开阅读段落 1：'),
      );
      const host = window.FreeBbsLearningReader.getScrollHost();
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      const inset = ['knowledge-history', 'learning-annotation-toolbar'].reduce(
        (sum, id) => sum + document.getElementById(id).getBoundingClientRect().height,
        16,
      );
      host.scrollBy({ top: -inset, behavior: 'instant' });
    });
    const wheelPoint = await page.evaluate(() => {
      const item = [...document.querySelectorAll('#knowledge-body p')].find(
        (paragraph) =>
          !paragraph.closest('details:not([open]),[hidden],.hidden') &&
          paragraph.textContent.startsWith('公开阅读段落 1：'),
      );
      const rect = item.getBoundingClientRect();
      const x = rect.left + 50;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, visible: hit === item || item.contains(hit) };
    });
    assert.equal(wheelPoint.visible, true);
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.wheel({ deltaY: 4 });
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    const nativeWheel = await currentReadingPosition();
    const movedParagraph = markdown.match(/公开阅读段落 1：[^\n]+/)[0];
    // Keep enough text below the destination for a real scroll restore, rather
    // than asking Chrome to align the final paragraph beyond the scroll limit.
    const revised = markdown
      .replace(movedParagraph, '')
      .replace('公开阅读段落 12：', `${movedParagraph}\n\n公开阅读段落 12：`);
    await page.evaluate(() => {
      window.addEventListener('pagehide', (event) => {
        const api = window.FreeBbsLearningReader;
        const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
        const saved = JSON.parse(localStorage.getItem(key) || '{}')[
          JSON.stringify(['signals', 'SS-01-01'])
        ];
        sessionStorage.setItem(
          '__navigation_fixture_pagehide_observation',
          JSON.stringify({ saved, persisted: event.persisted }),
        );
      });
    });
    nodes[1] = node('SS-01-01', revised);
    for (const context of contexts.filter((item) => item.node_id === 'SS-01-01')) {
      context.document_markdown = revised;
      context.knowledge_markdown = revised;
    }
    await visit();
    const afterRevision = await currentReadingPosition();
    const pagehide = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('__navigation_fixture_pagehide_observation') || 'null'),
    );
    const lifecycle = {
      nativeWheel,
      pagehide,
      afterRevision,
      movedUnchangedPublicParagraph: movedParagraph,
    };
    const bookmarkFinding = report.findings.find(
      (item) => item.id === 'reading-bookmark-targets-closed-details',
    );
    if (bookmarkFinding) bookmarkFinding.lifecycle = lifecycle;
    report.scenes.push({
      name: 'native wheel bookmark and reload after moving the same public paragraph',
      ...lifecycle,
    });
    if (!bookmarkFinding) {
      assert.equal(nativeWheel.targetClosed, false);
      assert.equal(nativeWheel.target, movedParagraph);
      assert.equal(pagehide.saved.fingerprint, nativeWheel.saved.fingerprint);
      assert.equal(afterRevision.targetClosed, false);
      assert.equal(afterRevision.visible, movedParagraph);
    }
    // Restore the annotated original paragraph for rendered accessibility inspection.
    await visit();
    await records(1);
    if (await page.$eval('#learning-annotation-directory', (item) => item.open))
      await click('#learning-annotation-directory > summary');
    await page.$eval('#knowledge-body [data-private-annotation]', (item) =>
      item.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    const client = await page.createCDPSession();
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    // Choose a palette value without submitting an annotation. Initial/no-text
    // state has no pressed palette button, so it cannot prove selected styling.
    await click('[data-annotation-color="blue"]');
    const forced = await page.evaluate(() => ({
      active: matchMedia('(forced-colors: active)').matches,
      colors: [...document.querySelectorAll('[data-annotation-color]')].map((item) => {
        const after = getComputedStyle(item, '::after');
        return {
          label: item.getAttribute('aria-label'),
          text: item.textContent.trim(),
          renderedAfter: after.content,
          afterDisplay: after.display,
          afterVisibility: after.visibility,
          afterFontSize: after.fontSize,
          pressed: item.getAttribute('aria-pressed'),
          outline: getComputedStyle(item).outlineStyle,
          background: getComputedStyle(item).backgroundColor,
          border: getComputedStyle(item).borderColor,
        };
      }),
      mark: [...document.querySelectorAll('#knowledge-body [data-private-annotation]')].map(
        (item) => ({
          text: item.textContent,
          background: getComputedStyle(item).backgroundColor,
          border: getComputedStyle(item).borderBottomStyle,
          decoration: getComputedStyle(item).textDecorationLine,
        }),
      ),
    }));
    const ax = await client.send('Accessibility.getFullAXTree');
    const buttonNames = ax.nodes
      .filter((item) => !item.ignored && item.role?.value === 'button')
      .map((item) => item.name?.value || '');
    assert.ok(
      [
        '黄色高亮',
        '绿色高亮',
        '蓝色高亮',
        '紫色高亮',
        '下划线',
        '评注',
        '问 Max',
        '纠错',
        '取消标注',
      ].every((name) => buttonNames.includes(name)),
    );
    const comment = await page.$('[data-annotation-action="comment"]');
    await comment.focus();
    await page.keyboard.press('Tab');
    const nextFocus = await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      text: document.activeElement.textContent,
      action: document.activeElement.dataset.annotationAction,
      outline: getComputedStyle(document.activeElement).outlineStyle,
    }));
    assert.equal(nextFocus.action, 'ask');
    assert.notEqual(nextFocus.outline, 'none');
    if (
      new Set(forced.colors.map((item) => item.background)).size === 1 &&
      forced.colors.every(
        (item) =>
          !item.text &&
          (!item.renderedAfter || ['none', 'normal', '""'].includes(item.renderedAfter)),
      )
    )
      report.findings.push({
        id: 'forced-colors-erases-visible-palette-labels',
        evidence: forced,
        source: 'public/knowledge.html:723; public/knowledge-workspace.css:522',
        impact:
          '真实Chrome强制颜色模拟中，四个无文字颜色钮视觉完全相同；有可访问名称，但不使用读屏器的高对比用户无法目视区别颜色选择。',
      });
    if (
      !report.findings.some((item) => item.id === 'forced-colors-erases-visible-palette-labels')
    ) {
      assert.deepEqual(
        forced.colors.map((item) => item.renderedAfter.replace(/^"|"$/g, '')),
        ['黄', '绿', '蓝', '紫'],
      );
      assert.ok(forced.colors.every((item) => item.afterVisibility === 'visible'));
      assert.ok(forced.colors.some((item) => item.pressed === 'true' && item.outline !== 'none'));
    }
    await page.screenshot({ path: path.join(output, 'forced-colors-annotation.png') });
    await client.send('Emulation.setEmulatedMedia', { features: [] });
    await page.evaluate(() =>
      localStorage.setItem(
        'free_bbs_typography_preferences',
        JSON.stringify({ fontPreset: 'transistor-lab', typeScale: 'large' }),
      ),
    );
    await page.setViewport({ width: 390, height: 844 });
    await visit();
    await records(1);
    await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    const size = await page.$eval('#knowledge-body p', (item) => getComputedStyle(item).fontSize);
    assert.ok(Number.parseFloat(size) >= 16);
    await page.screenshot({ path: path.join(output, 'mobile-large-private-directory.png') });
    assert.equal(preview.requests.length, 0);
    assert.ok(!report.aiRequests.some((item) => item.method === 'POST'));
    report.scenes.push({
      name: 'native Chrome accessibility tree, keyboard focus, 390px large text and no-AI expert routes',
      forced,
      buttonNames,
      nextFocus,
      size,
      aiPostCount: 0,
    });
    assert.deepEqual(report.pageErrors, []);
    report.success = report.findings.length === 0;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.success = false;
    report.failure = { message: error.message, stack: error.stack };
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          output,
          scenes: report.scenes.map((item) => item.name),
          findings: report.findings,
          pageErrors: report.pageErrors,
          success: report.success,
          failure: report.failure,
        },
        null,
        2,
      ),
    );
    if (!report.success) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
