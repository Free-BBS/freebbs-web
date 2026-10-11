// Human interaction QA only: isolated memory fixtures, no production data or real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { validateEntry, documentVersion } = require('../backend/learning-workspace');
const { stableBlocks } = require('../public/knowledge-annotations');

const FIXTURE = '本地评注生命周期夹具（不是正式课程正文）';
const PRIVATE = '仅本人可见：本地评注生命周期夹具';
const FIRST_QUOTE = '私有定位甲';
const AMBIGUOUS_QUOTE = '歧义片段乙';
const CANCEL_QUOTE = '取消选区丙';
const IMAGE_ALT = '本地夹具图：相同说明，不同图像';

function fixtureImage(version) {
  return `/__annotation-fixture-image-${version}.svg`;
}

function fixtureSvg(version) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140"><rect width="320" height="140" fill="${version === 'A' ? '#d6f1f2' : '#fde0da'}"/><text x="25" y="75" font-size="26">LOCAL FIXTURE ${version}</text></svg>`;
}

function fixtureMarkdown({ revision = 0, image = 'A', duplicate = false } = {}) {
  const paragraphs = [
    `${FIRST_QUOTE}位于唯一的正文段落；此处只测定位与私密性。`,
    AMBIGUOUS_QUOTE,
    `${CANCEL_QUOTE}用于真实键盘取消选择，不代表已经保存。`,
    `![${IMAGE_ALT}](${fixtureImage(image)})`,
    ...Array.from(
      { length: 12 },
      (_, index) => `本地夹具阅读段落 ${index + 1}：原文不能被私有批注改写。`,
    ),
  ];
  if (revision) {
    paragraphs.unshift('课程组修订夹具：新增段落，原有文字内容保留。');
    paragraphs.push(paragraphs.splice(1, 1)[0]);
  }
  if (duplicate) paragraphs.push(AMBIGUOUS_QUOTE);
  return `# ${FIXTURE}\n\n${paragraphs.join('\n\n')}\n`;
}

function fixtureNode(id, markdown) {
  const node = {
    id,
    title: id === 'SS-01-01' ? FIXTURE : '本地夹具下一知识点',
    markdown,
    summary: FIXTURE,
    hasDocument: true,
    sections: {
      basicInfoMarkdown: `课程名称：信号与系统\n章节/单元：本地夹具章节\n知识点层级：一般\n参与同学：本地夹具验证者`,
      applicationsMarkdown: '本地浏览器验证，非正式学习资料。',
      knowledgeMarkdown: markdown,
    },
  };
  node.documentVersion = documentVersion({ document_markdown: markdown });
  return node;
}

async function main() {
  const nodes = [
    fixtureNode('SS-01-00', `# 本地夹具章节\n\n${FIXTURE}`),
    fixtureNode('SS-01-01', fixtureMarkdown()),
    fixtureNode('SS-01-02', `# 本地夹具下一点\n\n这里不应显示上一点的私有评注。`),
  ];
  const preview = createLearningPreview({
    mapNodes: nodes,
    mapEdges: [{ source: 'SS-01-01', target: 'SS-01-02', type: 'ordered' }],
  });
  const contextFor = async (slug, point) => {
    const node = nodes.find((item) => slug === 'signals' && item.id === point);
    return node
      ? {
          slug,
          course_id: 1,
          course_name: '信号与系统',
          node_id: point,
          title: node.title,
          document_markdown: node.markdown,
          knowledge_markdown: node.markdown,
          is_active: 1,
        }
      : null;
  };
  // The node API and memory-record version checks must use the same explicit fixture document.
  preview.store.context = contextFor;
  preview.assessmentStore.context = contextFor;
  let base = '';
  const output =
    process.env.LEARNING_ANNOTATION_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'human-annotation-lifecycle-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Explicit local UI fixture and isolated memory rows. No real user, DB, course publication or external network.',
    scenes: [],
    findings: [],
    pageErrors: [],
    requests: [],
  };
  let browser;
  let page;
  let firstEntry;
  let imageEntry;
  let legacyImageEntry;
  let ambiguousEntry;
  const ownAnnotations = () =>
    preview.store.rows.filter(
      (row) => row.user === users.student.id && row.point === 'SS-01-01' && row.annotation,
    );
  const pathFor = (point = 'SS-01-01') =>
    `${base}/knowledge?${new URLSearchParams({ course: 'signals', point, view: 'reading' })}`;
  const observe = (name, details = {}) => report.scenes.push({ name, ...details });
  const finding = (id, details) => report.findings.push({ id, ...details });
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
  const ready = async () => {
    await page.waitForSelector('#knowledge-body p');
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    await page.evaluate(() => document.fonts.ready);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await click('#knowledge-chat-close');
  };
  const visit = async (point) => {
    await page.goto(pathFor(point), { waitUntil: 'networkidle0' });
    await ready();
  };
  const recordsLoaded = async (count) => {
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll('#learning-annotation-list [data-annotation-id]').length ===
        expected,
      {},
      count,
    );
  };
  const toolbarVisible = async () => {
    assert.equal(
      await page.$eval(
        '#learning-annotation-toolbar',
        (item) => item.hidden || item.classList.contains('hidden'),
      ),
      false,
    );
    assert.equal(await page.$$eval('#knowledge-body', (items) => items.length), 1);
  };
  const selectText = async (quote) => {
    if (await page.$eval('#learning-annotation-directory', (item) => item.open))
      await click('#learning-annotation-directory > summary');
    await page.evaluate((value) => {
      const paragraph = [...document.querySelectorAll('#knowledge-body p')].find((item) =>
        item.textContent.includes(value),
      );
      if (!paragraph) throw new Error(`Fixture paragraph missing: ${value}`);
      paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, quote);
    const target = await page.evaluate((value) => {
      const walker = document.createTreeWalker(
        document.getElementById('knowledge-body'),
        NodeFilter.SHOW_TEXT,
      );
      let node = walker.nextNode();
      while (node && !node.data.includes(value)) node = walker.nextNode();
      if (!node) throw new Error(`Fixture quote missing: ${value}`);
      const start = node.data.indexOf(value);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + value.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 0.2, end: rect.right - 0.2, y: rect.top + rect.height / 2 };
    }, quote);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.end, target.y, { steps: 8 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection().toString());
    assert.equal(selected, quote, 'The real mouse selection must match the intended public quote');
    await page.waitForFunction(
      (value) =>
        document.getElementById('learning-annotation-selection').textContent.includes(value),
      {},
      quote,
    );
  };
  const saveComment = async (content) => {
    const before = ownAnnotations().length;
    await click('[data-annotation-action="comment"]');
    await page.waitForFunction(
      () => !document.getElementById('learning-annotation-comment').closest('label').hidden,
    );
    await page.type('#learning-annotation-comment', content);
    await click('[data-annotation-action="comment"]');
    await page.waitForFunction(() =>
      document.getElementById('learning-annotation-status').textContent.includes('评注已私密保存'),
    );
    assert.equal(ownAnnotations().length, before + 1);
    return ownAnnotations().at(-1);
  };
  const seed = async (annotation, count, ordinary = false) => {
    const context = await contextFor('signals', 'SS-01-01');
    for (let index = 0; index < count; index += 1)
      await preview.store.create(
        users.student,
        context,
        validateEntry({
          kind: 'note',
          title: `${FIXTURE} ${ordinary ? '普通笔记' : '评注'} ${index + 1}`,
          content: `${PRIVATE} ${index + 1}`,
          ...(!ordinary ? { annotation: structuredClone(annotation) } : {}),
        }),
        crypto.randomUUID(),
      );
  };
  const revise = (options) => {
    nodes[1] = fixtureNode('SS-01-01', fixtureMarkdown(options));
  };
  const nextPoint = async () => {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      click('#knowledge-next-link'),
    ]);
    await ready();
  };
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === base && /^\/__annotation-fixture-image-[AB]\.svg$/.test(url.pathname))
        return request.respond({
          status: 200,
          contentType: 'image/svg+xml',
          body: fixtureSvg(url.pathname.includes('-A.') ? 'A' : 'B'),
        });
      if (url.origin === base && url.pathname === '/__learning-bootstrap.js')
        return request.respond({
          status: 200,
          contentType: 'application/javascript',
          body: `window.FREEBBS_API_BASE='/api';if(!localStorage.getItem('__annotation_fixture_initialized')){localStorage.setItem('__annotation_fixture_initialized','1');localStorage.setItem('free_bbs_auth_token','learning-preview-student');}localStorage.setItem('free_bbs_theme_mode','light');`,
        });
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
        return request.continue();
      return request.respond({
        status: 403,
        body: 'External services disabled by local annotation fixture',
      });
    });
    page.on('response', (response) => {
      const request = response.request();
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/learning/'))
        report.requests.push({
          method: request.method(),
          path: url.pathname + url.search,
          status: response.status(),
        });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('DOMContentLoaded', () =>
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important'),
      );
    });
    await visit();
    await toolbarVisible();
    const originalText = await page.$eval('#knowledge-body', (item) => item.textContent);
    await selectText(FIRST_QUOTE);
    firstEntry = await saveComment(PRIVATE);
    await recordsLoaded(1);
    assert.equal(await page.$eval('#knowledge-body', (item) => item.textContent), originalText);
    assert.equal(
      await page.$eval('#knowledge-body [data-private-annotation]', (item) => item.textContent),
      FIRST_QUOTE,
    );
    observe('real mouse selection and private save preserve the canonical public text');

    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(1);
    await toolbarVisible();
    assert.equal(
      await page.$eval('#knowledge-body [data-private-annotation]', (item) => item.textContent),
      FIRST_QUOTE,
    );
    observe('reload restores only the owner mark and leaves the annotation toolbar visible');
    await nextPoint();
    assert.equal(
      await page.$$eval('#knowledge-body [data-private-annotation]', (items) => items.length),
      0,
    );
    await page.goBack({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(1);
    await toolbarVisible();
    assert.equal(
      await page.$eval('#knowledge-body [data-private-annotation]', (item) => item.textContent),
      FIRST_QUOTE,
    );
    observe('native point navigation and browser Back retain the exact original private mark');

    await selectText(CANCEL_QUOTE);
    const beforeKeyboard = await page.evaluate(() => window.getSelection().toString());
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    const afterKeyboard = await page.evaluate(() => ({
      selected: window.getSelection().toString(),
      label: document.getElementById('learning-annotation-selection').textContent,
    }));
    assert.notEqual(afterKeyboard.selected, beforeKeyboard);
    assert.ok(afterKeyboard.label.includes(afterKeyboard.selected));
    observe(
      'native Shift/Arrow selection changes update the quoted toolbar selection',
      afterKeyboard,
    );
    // Chrome without caret browsing can leave a mouse range intact on an unmodified
    // arrow. Shrink the range to zero using genuine Shift/Arrow keys instead.
    await page.keyboard.down('Shift');
    for (let index = 0; index < afterKeyboard.selected.length; index += 1)
      await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    const cancelled = await page.evaluate(() => ({
      collapsed: window.getSelection().isCollapsed,
      selected: window.getSelection().toString(),
      hasSelection: document.getElementById('learning-annotation-toolbar').dataset.hasSelection,
      label: document.getElementById('learning-annotation-selection').textContent,
    }));
    assert.equal(cancelled.collapsed, true, 'The actual browser key cancels the text range');
    const beforeCancelledSave = ownAnnotations().length;
    await click('[data-annotation-action="highlight"][data-annotation-color="yellow"]');
    await page.waitForFunction(
      () => document.getElementById('learning-annotation-status').textContent.length > 0,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    if (cancelled.hasSelection === 'true' || ownAnnotations().length !== beforeCancelledSave)
      finding('cancelled-range-remains-actionable', {
        expected: 'A cancelled original-text range is no longer an actionable quote.',
        actual: cancelled,
        savedAfterCancel: ownAnnotations().length - beforeCancelledSave,
        files: ['public/knowledge-annotations.js:479', 'public/knowledge-annotations.js:716'],
      });
    else observe('cancelled keyboard range cannot accidentally save a previous quote');
    await page.screenshot({ path: path.join(output, 'keyboard-cancel-selection.png') });
    const keyboardRecord = ownAnnotations().find(
      (entry) => entry.annotation.anchor.quote !== FIRST_QUOTE,
    );
    if (keyboardRecord)
      await preview.store.remove(
        users.student,
        await contextFor('signals', 'SS-01-01'),
        keyboardRecord.id,
      );
    await visit();
    await recordsLoaded(1);

    await click('#knowledge-body [data-private-annotation]');
    await click('[data-annotation-action="remove"]');
    await recordsLoaded(0);
    assert.equal(ownAnnotations().length, 0);
    const requestsBeforeReapply = report.requests.length;
    await click('[data-annotation-action="highlight"][data-annotation-color="yellow"]');
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    const reapplyRequests = report.requests
      .slice(requestsBeforeReapply)
      .filter((item) => item.method !== 'GET');
    if (!ownAnnotations().length)
      finding('removed-entry-remains-edit-target', {
        expected:
          'After removing a saved mark, a new mark uses a fresh entry or requests a new selection.',
        actual: {
          requests: reapplyRequests,
          status: await page.$eval('#learning-annotation-status', (item) => item.textContent),
        },
        files: ['public/knowledge-annotations.js:630', 'public/knowledge-workspace.js:1306'],
      });
    else {
      assert.ok(reapplyRequests.some((item) => item.method === 'POST' && item.status === 201));
      assert.ok(!reapplyRequests.some((item) => item.method === 'PUT'));
      firstEntry = ownAnnotations().at(-1);
      observe('removing and reapplying a mark creates a new private record');
    }
    await page.screenshot({ path: path.join(output, 'remove-then-reapply.png') });
    if (!ownAnnotations().length) {
      const context = await contextFor('signals', 'SS-01-01');
      firstEntry = await preview.store.create(
        users.student,
        context,
        validateEntry({
          kind: 'note',
          title: '原文评注',
          content: PRIVATE,
          annotation: firstEntry.annotation,
        }),
        crypto.randomUUID(),
      );
    }
    await visit();
    await recordsLoaded(1);
    await selectText(AMBIGUOUS_QUOTE);
    ambiguousEntry = await saveComment(`${PRIVATE}：重复原文不可猜测。`);
    if (await page.$eval('#learning-annotation-directory', (item) => item.open))
      await click('#learning-annotation-directory > summary');
    await click('#knowledge-body img');
    await page.waitForFunction(() => {
      const image = document.querySelector('#knowledge-body img');
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        image.src.endsWith('/__annotation-fixture-image-A.svg')
      );
    });
    imageEntry = await saveComment(`${PRIVATE}：旧图 A 的评注。`);
    observe('whole-image private annotation captures the original fixture A');
    const [legacyImageBlock] = stableBlocks([{ type: 'image', text: IMAGE_ALT }]);
    await seed(
      {
        ...imageEntry.annotation,
        anchor: { ...imageEntry.annotation.anchor, blockAnchor: legacyImageBlock.anchor },
      },
      1,
    );
    legacyImageEntry = ownAnnotations().at(-1);
    await seed(firstEntry.annotation, 57);
    await seed(null, 56, true);
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(61);
    const originalImageMarks = await page.$eval('#knowledge-body img', (item) =>
      (item.closest('[data-private-annotation-block]')?.dataset.privateAnnotationBlock || '').split(
        ',',
      ),
    );
    assert.ok(
      originalImageMarks.includes(imageEntry.id),
      'the source-aware image record remains compatible on its unchanged original body',
    );
    // Multiple whole-block records share one visual block; their individual locator
    // outcomes remain available in the private directory rather than a combined ID.
    assert.ok(
      !(
        await page.$eval(
          `#learning-annotation-list [data-annotation-id="${legacyImageEntry.id}"]`,
          (item) => item.textContent,
        )
      ).includes('待重新定位'),
      'the legacy image record remains compatible on its unchanged original body',
    );
    await toolbarVisible();
    assert.equal(
      new Set(
        await page.$$eval('#learning-annotation-list [data-annotation-id]', (items) =>
          items.map((item) => item.dataset.annotationId),
        ),
      ).size,
      61,
    );
    observe(
      '61 annotations remain accessible despite 56 newer ordinary notes and the 50-entry API page limit',
    );

    revise({ revision: 1 });
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(61);
    const unchangedImage = await page.$eval('#knowledge-body img', (item) => ({
      src: item.src,
      loaded: item.complete && item.naturalWidth > 0,
      marks: (
        item.closest('[data-private-annotation-block]')?.dataset.privateAnnotationBlock || ''
      ).split(','),
    }));
    assert.ok(
      unchangedImage.loaded && unchangedImage.src.endsWith('/__annotation-fixture-image-A.svg'),
    );
    assert.ok(
      unchangedImage.marks.includes(imageEntry.id),
      'the source-aware annotation recovers the unchanged loaded A image after an unrelated body revision',
    );
    assert.ok(
      !unchangedImage.marks.includes(legacyImageEntry.id),
      'a legacy alt-only image annotation becomes pending after body revision',
    );
    assert.match(
      await page.$eval(
        `#learning-annotation-list [data-annotation-id="${legacyImageEntry.id}"]`,
        (item) => item.textContent,
      ),
      /待重新定位/,
    );
    assert.ok(
      (
        await page.$$eval('#knowledge-body [data-private-annotation]', (items) =>
          items.map((item) => item.textContent),
        )
      ).every((text) => [FIRST_QUOTE, AMBIGUOUS_QUOTE].includes(text)),
    );
    assert.match(
      await page.$eval(
        `#learning-annotation-list [data-annotation-id="${firstEntry.id}"]`,
        (item) => item.textContent,
      ),
      /重新定位/,
    );
    observe('a revision moving unique public paragraphs relocates only their exact original text');
    observe(
      'unchanged loaded image A recovers its source-aware mark while the legacy alt-only record is retained as pending',
    );
    revise({ revision: 2, image: 'B', duplicate: true });
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(61);
    assert.equal(
      await page.$$eval(
        '#knowledge-body [data-private-annotation]',
        (items) => items.filter((item) => item.textContent === '歧义片段乙').length,
      ),
      0,
    );
    assert.ok(
      (await page.$eval('#learning-annotation-list', (item) => item.textContent)).includes(
        '待重新定位',
      ),
    );
    assert.match(
      await page.$eval(
        `#learning-annotation-list [data-annotation-id="${ambiguousEntry.id}"]`,
        (item) => item.textContent,
      ),
      /待重新定位/,
    );
    observe(
      'duplicate original paragraphs become pending while private annotation text is retained',
    );
    const imageAfterRevision = await page.$eval('#knowledge-body img', (item) => ({
      src: item.src,
      alt: item.alt,
      privateMark:
        item.closest('[data-private-annotation-block]')?.dataset.privateAnnotationBlock || '',
    }));
    await page.waitForFunction(() => {
      const image = document.querySelector('#knowledge-body img');
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        image.src.endsWith('/__annotation-fixture-image-B.svg')
      );
    });
    if (imageAfterRevision.privateMark)
      finding('replaced-image-inherits-old-image-annotation', {
        expected:
          'A different public image must not automatically inherit the prior image annotation merely because alt text is unchanged.',
        actual: imageAfterRevision,
        oldDocumentVersion: imageEntry.annotation.anchor.documentVersion,
        currentDocumentVersion: nodes[1].documentVersion,
        files: ['public/knowledge-annotations.js:271', 'public/knowledge-annotations.js:64'],
      });
    else {
      for (const entry of [imageEntry, legacyImageEntry])
        assert.match(
          await page.$eval(
            `#learning-annotation-list [data-annotation-id="${entry.id}"]`,
            (item) => item.textContent,
          ),
          /待重新定位/,
        );
      observe('a replaced image is not falsely marked with either old image private annotation');
    }
    await page.$eval('#knowledge-body img', (item) =>
      item.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.screenshot({ path: path.join(output, 'revised-image-same-alt.png') });

    // New seeded rows must use an anchor captured from the revised fixture, not pretend
    // that the backend accepts a stale document version as a newly authored annotation.
    const currentAnchor = await page.evaluate((quote) => {
      const paragraph = [...document.querySelectorAll('#knowledge-body p')].find((item) =>
        item.textContent.includes(quote),
      );
      const start = paragraph.textContent.indexOf(quote);
      const { node } = window.freeBbsKnowledge.getLearningContext();
      return window.FreeBbsKnowledgeAnnotations.createAnchor({
        nodeId: node.id,
        documentVersion: node.documentVersion,
        block: {
          text: paragraph.textContent,
          anchor: paragraph.dataset.annotationBlockAnchor,
          type: 'text',
        },
        start,
        end: start + quote.length,
      });
    }, FIRST_QUOTE);
    await seed({ ...firstEntry.annotation, anchor: currentAnchor }, 440);
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(500);
    assert.equal(await page.$eval('#learning-annotations-more', (item) => item.hidden), false);
    await click('#learning-annotations-more');
    await recordsLoaded(501);
    assert.equal(await page.$eval('#learning-annotations-more', (item) => item.hidden), true);
    await toolbarVisible();
    observe(
      'the explicit more-annotations control reaches item 501 beyond the ten-page initial bound',
    );

    await nextPoint();
    await page.evaluate(() =>
      localStorage.setItem('free_bbs_auth_token', 'learning-preview-other'),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), users.other.uid);
    await page.goBack({ waitUntil: 'networkidle0' });
    await ready();
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.uid), users.other.uid);
    await recordsLoaded(0);
    assert.equal(
      await page.$$eval(
        '#knowledge-body [data-private-annotation],[data-private-annotation-block]',
        (items) => items.length,
      ),
      0,
    );
    assert.ok(
      !(await page.$eval('#learning-annotation-list', (item) => item.textContent)).includes(
        PRIVATE,
      ),
    );
    observe(
      'browser Back after an account change never repaints the first owner private annotations',
    );
    await page.evaluate(() =>
      localStorage.setItem('free_bbs_auth_token', 'learning-preview-manager'),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(0);
    const teacherRecords = await page.evaluate(async () =>
      window.freeBbsApp.callApi('/learning/signals/SS-01-01/entries?kind=note&annotations=1', {
        method: 'GET',
      }),
    );
    assert.equal(
      teacherRecords.entries.length,
      0,
      'Actual fixture course-review capability does not grant student annotation access',
    );
    observe('assigned fixture course manager cannot read a student private annotations');
    await page.evaluate(() => localStorage.removeItem('free_bbs_auth_token'));
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await recordsLoaded(0);
    assert.equal(
      await page.$$eval(
        '#knowledge-body [data-private-annotation],[data-private-annotation-block]',
        (items) => items.length,
      ),
      0,
    );
    observe('guest reload remains readable without displaying private annotations');
    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle0' });
    await ready();
    await toolbarVisible();
    await page.$eval('#knowledge-body p', (item) =>
      item.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await click('[data-annotation-action="highlight"][data-annotation-color="yellow"]');
    assert.match(
      await page.$eval('#learning-annotation-status', (item) => item.textContent),
      /请先选择/,
    );
    assert.equal(
      await page.$$eval(
        '#knowledge-body [data-private-annotation],[data-private-annotation-block]',
        (items) => items.length,
      ),
      0,
    );
    await page.screenshot({ path: path.join(output, 'mobile-private-annotation-tools.png') });
    observe(
      'a 390px guest reader retains reachable annotation tools without private marks or unauthorized saves',
    );
    assert.deepEqual(report.pageErrors, []);
    report.success = report.findings.length === 0;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.success = false;
    report.failure = { message: error.message, stack: error.stack };
    if (page) await page.screenshot({ path: path.join(output, 'lifecycle-failure.png') });
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
    if (!report.success) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
