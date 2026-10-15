// Single native short-screen workflow. Synthetic memory annotation only, not real student evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLearningPreview, users } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { documentVersion } = require('../backend/learning-workspace');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const QUOTE = '中段唯一短句';
const COMMENT = '合成私密评注：只测短屏选择与返回，不代表课程理解。';
const paragraphs = Array.from({ length: 20 }, (_, index) =>
  index === 9
    ? `${QUOTE}。这是第十段的合成文字，记录一个待核对的条件；不是真实教材，也不代表已经掌握。`
    : `合成阅读段落${index + 1}：这是一段明确标记的本地材料，用于观察原文批注的选择、工具与阅读位置，不作为正式课程内容。`,
);
const markdown = `# 短屏评注内存夹具（非正式课程）\n\n${paragraphs.join('\n\n')}`;
const contextRow = {
  slug: 'signals',
  course_id: 1,
  course_name: '明确本地夹具',
  node_id: 'SS-01-01',
  title: '短屏评注内存夹具（非正式课程）',
  document_markdown: markdown,
  knowledge_markdown: markdown,
  basic_info_markdown: '知识点层级：一般',
  is_active: 1,
};
const node = {
  id: contextRow.node_id,
  title: contextRow.title,
  summary: '合成材料：不是教学验收或生产数据',
  markdown,
  hasDocument: true,
  documentVersion: documentVersion(contextRow),
  sections: {
    knowledgeMarkdown: markdown,
    basicInfoMarkdown: contextRow.basic_info_markdown,
    applicationsMarkdown: '本地阅读流程诊断，不调用AI。',
  },
};

function geometry({ selector, quote } = {}) {
  let element = selector ? document.querySelector(selector) : null;
  let rect;
  if (quote) {
    const body = document.getElementById('knowledge-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.data.includes(quote)) text = walker.nextNode();
    if (!text) throw new Error('Unique synthetic quote is missing');
    element = text.parentElement;
    const start = text.data.indexOf(quote);
    // Range is measurement only: never assign it to native Selection.
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + quote.length);
    const rects = [...range.getClientRects()];
    if (rects.length !== 1) throw new Error('Exact short quote must occupy one real line');
    [rect] = rects;
  } else rect = element?.getBoundingClientRect();
  if (!element || !rect) throw new Error(`Missing control: ${selector}`);
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const history = document.getElementById('knowledge-history');
  const historyRect = history.getBoundingClientRect();
  const toolbar = document.getElementById('learning-annotation-toolbar');
  const toolbarRect = toolbar.getBoundingClientRect();
  const hiddenFor = (target) => {
    const result = [];
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const summary =
        ancestor.tagName === 'DETAILS'
          ? [...ancestor.children].find((child) => child.tagName === 'SUMMARY')
          : null;
      let reason;
      if (ancestor.matches('[hidden], .hidden, [inert]')) reason = 'hidden or inert';
      else if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility))
        reason = 'hidden computed style';
      else if (ancestor.tagName === 'DETAILS' && !ancestor.open && !summary?.contains(target))
        reason = 'closed details content';
      if (reason) result.push({ tag: ancestor.tagName, id: ancestor.id, reason });
    }
    return result;
  };
  const hiddenAncestors = hiddenFor(element);
  const clipAncestors = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (!['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) continue;
    const ancestorRect = ancestor.getBoundingClientRect();
    const visibleTop = Math.max(0, ancestorRect.top);
    const visibleBottom = Math.min(window.innerHeight, ancestorRect.bottom);
    const wheelX = Math.max(
      1,
      Math.min(window.innerWidth - 1, ancestorRect.left + ancestorRect.width / 2),
    );
    const wheelY = (visibleTop + visibleBottom) / 2;
    const hostHit = visibleBottom > visibleTop ? document.elementFromPoint(wheelX, wheelY) : null;
    clipAncestors.push({
      id: ancestor.id,
      className: String(ancestor.className || ''),
      overflowY: style.overflowY,
      scrollTop: ancestor.scrollTop,
      scrollHeight: ancestor.scrollHeight,
      clientHeight: ancestor.clientHeight,
      rect: {
        top: ancestorRect.top,
        bottom: ancestorRect.bottom,
        left: ancestorRect.left,
        right: ancestorRect.right,
      },
      clipsTarget: rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom,
      scrollable:
        ['auto', 'scroll'].includes(style.overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight + 1,
      wheelPoint: { x: wheelX, y: wheelY },
      wheelPointReachable: Boolean(hostHit && (hostHit === ancestor || ancestor.contains(hostHit))),
    });
  }
  const describe = (item) =>
    item && {
      tag: item.tagName,
      id: item.id,
      className: String(item.className || ''),
      text: item.textContent.trim().slice(0, 120),
    };
  return {
    selector,
    quote,
    x,
    y,
    rect: {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      width: rect.width,
    },
    reachable:
      hiddenAncestors.length === 0 &&
      x >= 0 &&
      x < window.innerWidth &&
      y >= 0 &&
      y < window.innerHeight &&
      (hit === element || element.contains(hit)),
    hit: describe(hit),
    active: describe(document.activeElement),
    activeHiddenAncestors: hiddenFor(document.activeElement),
    scrollY: window.scrollY,
    history: {
      position: getComputedStyle(history).position,
      top: historyRect.top,
      bottom: historyRect.bottom,
    },
    toolbar: {
      position: getComputedStyle(toolbar).position,
      top: toolbarRect.top,
      bottom: toolbarRect.bottom,
      hasSelection: toolbar.dataset.hasSelection,
    },
    selected: window.getSelection().toString(),
    selectionLabel: document.getElementById('learning-annotation-selection').textContent,
    comment: document.getElementById('learning-annotation-comment').value,
    directoryOpen: document.getElementById('learning-annotation-directory').open,
    hiddenAncestors,
    clipAncestors,
  };
}

async function main() {
  const preview = createLearningPreview({
    mapNodes: [node],
    mapEdges: [],
    contextRows: [contextRow],
  });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-short-annotation-'));
  const report = {
    boundary:
      'Installed Chrome, 320x380 actual supported 118% large typography. Explicit 20-paragraph memory fixture, native wheel/drag/click/keyboard. Range measures only; no synthetic Selection, focus(), scrollIntoView(), DOM scrolling, RAF/font mocks, real AI/accounts/database. Exactly one allowed synthetic private annotation POST. Not a virtual-keyboard/IME or real-person learning study.',
    viewport: { width: 320, height: 380 },
    actions: [],
    findings: [],
    pageErrors: [],
    allowedWrites: [],
    blockedWrites: [],
    blockedExternal: [],
    screenshots: [],
  };
  const watched = [
    'knowledge.js',
    'knowledge.html',
    'knowledge-workspace.js',
    'knowledge-workspace.css',
    'knowledge-annotations.js',
    'human-learning-annotations.css',
    'learning-reader.js',
  ].map((file) => path.resolve(__dirname, '../public', file));
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = watched.map(hash);
  let browser;
  let page;
  let base;
  let phase = 'start';
  const snapshot = async (name) => {
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  };
  const settle = async (target) => {
    let last;
    let same = 0;
    for (let index = 0; index < 50; index += 1) {
      const value = await page.evaluate(geometry, target);
      const signature = JSON.stringify([value.scrollY, value.rect.top, value.rect.bottom]);
      same = signature === last ? same + 1 : 0;
      if (same >= 3) return value;
      last = signature;
      await new Promise((resolve) => {
        setTimeout(resolve, 60);
      });
    }
    throw new Error('Real native geometry did not settle');
  };
  const reach = async (target) => {
    for (let index = 0; index < 100; index += 1) {
      const value = await settle(target);
      if (value.reachable) return value;
      if (value.hiddenAncestors.length)
        throw new Error(
          `Cannot naturally reach hidden control ${target.selector || target.quote}: ${JSON.stringify(value.hiddenAncestors)}`,
        );
      const scrollHost = value.clipAncestors.find((ancestor) => ancestor.scrollable);
      const safeTop = Math.max(20, value.history.bottom + 8);
      // A clipped list item is not a page-scroll target. Wheel its real visible
      // scroll host, or first move that host into view by natural outer scrolling.
      const anchorY = scrollHost ? (scrollHost.rect.top + scrollHost.rect.bottom) / 2 : value.y;
      const nested = scrollHost?.wheelPointReachable;
      const deltaY = nested
        ? value.y < scrollHost.rect.top
          ? -140
          : 140
        : anchorY < safeTop
          ? -140
          : 140;
      const wheelPoint = nested ? scrollHost.wheelPoint : { x: 64, y: 334 };
      await page.mouse.move(wheelPoint.x, wheelPoint.y);
      await page.mouse.wheel({ deltaY });
      report.actions.push({
        phase,
        action: 'native wheel',
        deltaY,
        wheelPoint,
        scrollHost: nested ? scrollHost.id || scrollHost.className : 'outer page',
        before: value,
      });
    }
    throw new Error(`Natural scrolling cannot reach ${target.selector || target.quote}`);
  };
  const click = async (selector) => {
    const value = await reach({ selector });
    report.actions.push({ phase, action: 'native click', geometry: value });
    await page.mouse.click(value.x, value.y);
  };
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${report.portSelection.port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    report.chrome = await browser.version();
    page = await browser.newPage();
    await page.setViewport(report.viewport);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem(
        'free_bbs_typography_preferences',
        JSON.stringify({ fontPreset: 'transistor-lab', typeScale: 'large' }),
      );
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        report.blockedExternal.push(url.origin);
        return request.respond({
          status: 403,
          body: 'No external network in this memory diagnostic',
        });
      }
      if (url.origin === base && request.method() !== 'GET') {
        let body;
        try {
          body = JSON.parse(request.postData() || '{}');
        } catch {
          body = null;
        }
        const allowed =
          request.method() === 'POST' &&
          url.pathname === '/api/learning/signals/SS-01-01/entries' &&
          report.allowedWrites.length === 0 &&
          body?.kind === 'note' &&
          body.content === COMMENT &&
          body.annotation?.style === 'comment' &&
          body.annotation?.anchor?.quote === QUOTE;
        if (allowed) {
          report.allowedWrites.push({ method: request.method(), path: url.pathname, body });
          return request.continue();
        }
        report.blockedWrites.push({ method: request.method(), path: url.pathname });
        return request.respond({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Only one explicit synthetic memory annotation is allowed',
          }),
        });
      }
      return request.continue();
    });
    await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&as=student&view=reading`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () =>
        window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion &&
        document.getElementById('learning-annotation-toolbar') &&
        !document.getElementById('learning-annotation-toolbar').hidden,
    );
    await page.evaluate(() => document.fonts.ready);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await page.keyboard.press('Escape');
    report.typography = await page.evaluate(() => window.freeBbsTypography.getCurrentPreferences());
    assert.equal(report.typography.typeScale, 'large');
    const originalText = await page.$eval('#knowledge-body', (item) => item.textContent);
    phase = 'read and native select middle paragraph';
    report.originalParagraph = await reach({ quote: QUOTE });
    await snapshot('middle-before-selection');
    const rect = report.originalParagraph.rect;
    await page.mouse.move(rect.left + 0.2, report.originalParagraph.y);
    await page.mouse.down();
    await page.mouse.move(rect.right - 0.2, report.originalParagraph.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), QUOTE);
    await page.waitForFunction(
      (quote) =>
        document.getElementById('learning-annotation-selection').textContent.includes(quote),
      {},
      QUOTE,
    );
    report.nativeSelection = await page.evaluate(geometry, { quote: QUOTE });
    await snapshot('middle-selected');
    phase = 'return to inline toolbar and enter synthetic comment';
    await click('[data-annotation-action="comment"]');
    assert.ok(
      (await page.$eval('#learning-annotation-selection', (item) => item.textContent)).includes(
        QUOTE,
      ),
    );
    await click('#learning-annotation-comment');
    await page.keyboard.type(COMMENT);
    report.beforeSave = await page.evaluate(geometry, { selector: '#learning-annotation-comment' });
    await snapshot('synthetic-comment-entered');
    phase = 'save exactly one memory comment';
    await click('[data-annotation-action="comment"]');
    await page.waitForFunction(
      () =>
        document
          .getElementById('learning-annotation-status')
          .textContent.includes('评注已私密保存'),
      { timeout: 10000 },
    );
    assert.equal(preview.store.rows.length, 1);
    const row = preview.store.rows[0];
    assert.equal(row.user, users.student.id);
    assert.equal(row.status, 'private');
    assert.equal(row.content, COMMENT);
    assert.equal(row.annotation.anchor.quote, QUOTE);
    assert.equal(await page.$eval('#knowledge-body', (item) => item.textContent), originalText);
    report.saved = {
      id: row.id,
      owner: row.user,
      status: row.status,
      quote: row.annotation.anchor.quote,
      content: row.content,
    };
    await snapshot('saved-toolbar');
    phase = 'actual directory return to original paragraph';
    report.directoryBeforeReturn = await page.$eval(
      '#learning-annotation-directory',
      (item) => item.open,
    );
    if (!report.directoryBeforeReturn) await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    await click('#learning-annotation-list [data-annotation-id] [data-annotation-locate]');
    report.returnedParagraph = await settle({ quote: QUOTE });
    await snapshot('returned-original-paragraph');
    assert.equal(
      report.returnedParagraph.reachable,
      true,
      'Locate Original must expose the actual quote without a rescue scroll or opening its editor',
    );
    assert.deepEqual(report.returnedParagraph.activeHiddenAncestors, []);
    assert.equal(
      await page.$eval('#knowledge-body [data-private-annotation]', (item) => item.textContent),
      QUOTE,
    );
    assert.equal(
      await page.$eval('.learning-annotation-comment-field', (item) => item.hidden),
      true,
      'Locating is reading navigation, not an instruction to open the comment editor',
    );
    phase = 'edit the saved private comment independently';
    await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    await click('#learning-annotation-list [data-annotation-id] [data-annotation-edit]');
    report.editorBeforeManualClick = await settle({ selector: '#learning-annotation-comment' });
    assert.equal(report.editorBeforeManualClick.active?.id, 'learning-annotation-comment');
    assert.deepEqual(report.editorBeforeManualClick.activeHiddenAncestors, []);
    await click('#learning-annotation-comment');
    report.editor = await settle({ selector: '#learning-annotation-comment' });
    assert.equal(report.editor.reachable, true);
    assert.equal(report.editor.active?.id, 'learning-annotation-comment');
    assert.equal(report.editor.comment, COMMENT);
    assert.ok(report.editor.selectionLabel.includes(QUOTE));
    const addition = '（未保存的补充）';
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    assert.deepEqual(
      await page.$eval('#learning-annotation-comment', (item) => [
        item.selectionStart,
        item.selectionEnd,
        item.value.length,
      ]),
      [COMMENT.length, COMMENT.length, COMMENT.length],
      'Native Control+End must place the caret at the entire comment end, not a wrapped line',
    );
    await page.keyboard.type(addition);
    const draft = COMMENT + addition;
    assert.equal(await page.$eval('#learning-annotation-comment', (item) => item.value), draft);
    phase = 'locate original without discarding an unsaved edit';
    await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    await click('#learning-annotation-list [data-annotation-id] [data-annotation-locate]');
    report.returnedWithDraft = await settle({ quote: QUOTE });
    assert.equal(
      report.returnedWithDraft.reachable,
      true,
      'Pending edits must not obstruct locating',
    );
    assert.equal(report.returnedWithDraft.comment, draft, 'Pure locating must retain the draft');
    assert.deepEqual(report.returnedWithDraft.activeHiddenAncestors, []);
    assert.equal(
      await page.$eval('.learning-annotation-comment-field', (item) => item.hidden),
      true,
    );
    phase = 'resume that unsaved edit through the independent edit action';
    await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    await click('#learning-annotation-list [data-annotation-id] [data-annotation-edit]');
    report.resumedBeforeManualClick = await settle({ selector: '#learning-annotation-comment' });
    assert.equal(report.resumedBeforeManualClick.active?.id, 'learning-annotation-comment');
    assert.deepEqual(report.resumedBeforeManualClick.activeHiddenAncestors, []);
    await click('#learning-annotation-comment');
    report.resumedEditor = await settle({ selector: '#learning-annotation-comment' });
    assert.equal(report.resumedEditor.comment, draft);
    assert.equal(report.resumedEditor.reachable, true);
    assert.equal(report.resumedEditor.active?.id, 'learning-annotation-comment');
    phase = 'native mouseup and click on the existing mark preserve the same edit target';
    await click('#learning-annotation-directory > summary');
    await page.waitForFunction(() => document.getElementById('learning-annotation-directory').open);
    await click('#learning-annotation-list [data-annotation-id] [data-annotation-locate]');
    const markBeforeClick = await settle({ quote: QUOTE });
    assert.equal(markBeforeClick.reachable, true);
    report.actions.push({
      phase,
      action: 'native click original private mark',
      geometry: markBeforeClick,
    });
    await page.mouse.click(markBeforeClick.x, markBeforeClick.y);
    report.markEditor = await settle({ selector: '#learning-annotation-comment' });
    assert.equal(report.markEditor.comment, draft);
    assert.ok(
      report.markEditor.selectionLabel.includes(QUOTE),
      'Native mouseup preceding mark click must not cancel the existing edit anchor',
    );
    assert.equal(report.markEditor.active?.id, 'learning-annotation-comment');
    assert.equal(
      report.markEditor.reachable,
      true,
      'The mark editor must remain visible, not focused off-screen',
    );
    assert.deepEqual(report.markEditor.activeHiddenAncestors, []);
    assert.equal(preview.store.rows.length, 1);
    assert.equal(preview.store.rows[0].content, COMMENT, 'Unsent edits are not implicit saves');
    assert.equal(await page.$eval('#knowledge-body', (item) => item.textContent), originalText);
    await snapshot('independent-editor-with-retained-draft');
    report.success = true;
  } catch (error) {
    report.success = false;
    report.failure = { phase, message: error.message, stack: error.stack };
    report.findings.push(report.failure);
    report.portSelection ||= error.portSelection;
    if (page) {
      report.failureGeometry = await page.evaluate(geometry, { quote: QUOTE }).catch(() => null);
      await snapshot('failure').catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    report.memoryRows = {
      notes: preview.store.rows.length,
      assessments: preview.assessmentStore.rows.length,
      stars: preview.starsStore.rows.length,
      ai: preview.requests.length,
    };
    if (browser) await browser.close();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    report.sourceUnchangedDuringRun = watched.every((file, index) => hash(file) === before[index]);
    report.cleanup = {
      browserClosed: !browser || !browser.connected,
      serverClosed: !preview.server.listening,
    };
    if (
      !report.sourceUnchangedDuringRun ||
      report.pageErrors.length ||
      report.blockedWrites.length ||
      preview.requests.length ||
      preview.assessmentStore.rows.length ||
      preview.starsStore.rows.length
    )
      process.exitCode = 1;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          output,
          success: report.success,
          failure: report.failure,
          memoryRows: report.memoryRows,
          writes: report.allowedWrites.length,
          blockedWrites: report.blockedWrites,
          pageErrors: report.pageErrors,
          sourceUnchanged: report.sourceUnchangedDuringRun,
          cleanup: report.cleanup,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
