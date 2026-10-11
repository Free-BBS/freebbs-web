// Reuses an existing isolated preview. This check never starts a server or calls real AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const address = process.env.LEARNING_PREVIEW_URL || process.argv[2];
  assert.ok(address, 'Pass the URL of an already running isolated learning preview');
  const base = new URL(address);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local preview');
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-annotations-'));
  fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin) {
      requests.push(url.pathname);
      return request.continue();
    }
    if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
    return request.respond({ status: 403, body: 'External services disabled in local QA' });
  });

  const visit = async (identity = 'student') => {
    const url = new URL('/knowledge', base);
    url.search = new URLSearchParams({
      course: 'signals',
      point: process.env.LEARNING_ANNOTATION_POINT || 'SS-02-01',
      view: 'reading',
      as: identity,
    });
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#knowledge-body p'));
    const dialog = await page.$('.learning-start-dialog[open] [name="level"]');
    if (dialog) {
      await page.select('.learning-start-dialog[open] [name="level"]', 'familiar');
      await page.click('.learning-start-dialog[open] .learning-start-apply');
    }
    await page.waitForSelector('#learning-annotation-toolbar', { visible: true });
    await page.waitForFunction(() => window.freeBbsApp?.userState?.isLoggedIn);
    await page.evaluate(() => {
      let scroller = document.getElementById('knowledge-body').parentElement;
      while (scroller) {
        if (
          /(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY) &&
          scroller.scrollHeight > scroller.clientHeight
        )
          break;
        scroller = scroller.parentElement;
      }
      window.annotationReadingScroller = scroller || document.scrollingElement;
    });
  };

  try {
    await page.setViewport({ width: 1440, height: 960 });
    await visit();
    assert.ok(
      await page.$eval('#knowledge-body', (item) => item.getBoundingClientRect().height > 960),
      'Use the long authoring-course preview, not the thirty-character relations fixture',
    );
    assert.equal(
      await page.$eval('#learning-annotation-toolbar', (item) => item.parentElement.id),
      'knowledge-reading',
      'The toolbar is a direct part of the original reader, outside hidden tool panels',
    );
    assert.equal(
      await page.$eval('#knowledge-history', (item) => getComputedStyle(item).position),
      'sticky',
      'The existing sticky origin remains available while reading',
    );
    assert.equal(
      await page.$eval('#learning-annotation-toolbar', (item) => getComputedStyle(item).position),
      'sticky',
    );
    const beforeIds = await page.$$eval('#learning-annotation-list [data-annotation-id]', (items) =>
      items.map((item) => item.dataset.annotationId),
    );
    await page.evaluate(() => {
      window.annotationToolSelections = [];
      document
        .querySelector('[data-knowledge-page]')
        .addEventListener('knowledge:tool-select', (e) =>
          window.annotationToolSelections.push(e.detail?.tool),
        );
    });
    const selection = await page.evaluate(() => {
      const body = document.getElementById('knowledge-body');
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const candidates = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (text.textContent.trim().length < 20) continue;
        if (!text.parentElement.closest('p,li,blockquote')) continue;
        if (text.parentElement.closest('.katex,script,style,details:not([open])')) continue;
        candidates.push(text);
      }
      for (const text of candidates.reverse()) {
        text.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
        const range = document.createRange();
        const start = text.textContent.search(/\S/);
        range.setStart(text, start);
        range.setEnd(text, start + 12);
        const rect = [...range.getClientRects()].find((item) => item.width > 40 && item.height > 0);
        if (!rect) continue;
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          height: rect.height,
          y: window.annotationReadingScroller.scrollTop,
          windowY: window.scrollY,
        };
      }
      return null;
    });
    assert.ok(selection, 'A deep, visible original prose selection exists');
    assert.ok(selection.y > 300, 'The pointer selection is deep in the real reading scroller');
    await page.mouse.move(selection.left + 1, selection.top + selection.height / 2);
    await page.mouse.down();
    await page.mouse.move(selection.right - 1, selection.top + selection.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () => document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'true',
    );
    const afterSelection = await page.evaluate(() => ({
      y: window.annotationReadingScroller.scrollTop,
      windowY: window.scrollY,
      tool: document.querySelector('[data-knowledge-page]').dataset.learningTool,
      selections: window.annotationToolSelections,
      quote: getSelection().toString(),
      rect: (() => {
        const box = document.getElementById('learning-annotation-toolbar').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, right: box.right };
      })(),
      originBottom: document.getElementById('knowledge-history').getBoundingClientRect().bottom,
    }));
    assert.ok(afterSelection.quote.length, 'Real pointer dragging selected original text');
    assert.equal(afterSelection.tool, 'content');
    assert.deepEqual(afterSelection.selections, [], 'Selecting does not change learning tools');
    assert.ok(
      Math.abs(afterSelection.y - selection.y) <= 2,
      'Selecting leaves reading position intact',
    );
    assert.ok(
      Math.abs(afterSelection.windowY - selection.windowY) <= 2,
      'Selecting does not scroll the outer page',
    );
    assert.ok(afterSelection.rect.top >= Math.max(0, afterSelection.originBottom + 4));
    assert.ok(afterSelection.rect.bottom < 960, 'All annotation actions remain in the viewport');
    await page.screenshot({ path: path.join(output, 'annotations-deep-selection.png') });

    const highlight = await page.$(
      '[data-annotation-action="highlight"][data-annotation-color="yellow"]',
    );
    await highlight.click();
    await page.waitForFunction(
      () =>
        document.getElementById('learning-annotation-status').textContent === '评注已私密保存。',
    );
    const saved = await page.evaluate((ids) => {
      const toolbar = document.getElementById('learning-annotation-toolbar');
      const record = [
        ...document.querySelectorAll('#learning-annotation-list [data-annotation-id]'),
      ].find((item) => !ids.includes(item.dataset.annotationId));
      return {
        id: record?.dataset.annotationId,
        quote: record?.querySelector('blockquote')?.textContent,
        visible: !toolbar.hidden && toolbar.getBoundingClientRect().top >= 0,
        directoryOpen: document.getElementById('learning-annotation-directory').open,
        y: window.annotationReadingScroller.scrollTop,
        windowY: window.scrollY,
        selections: window.annotationToolSelections,
      };
    }, beforeIds);
    assert.ok(saved.id, 'The real private note API saved a new original-text annotation');
    assert.equal(saved.quote, afterSelection.quote);
    assert.equal(saved.visible, true, 'Saving keeps the toolbar visible');
    assert.equal(saved.directoryOpen, true, 'Saved annotations open in the same reader');
    assert.deepEqual(saved.selections, []);
    assert.ok(
      Math.abs(saved.y - afterSelection.y) <= 2,
      `Saving leaves reading position intact (${afterSelection.y} → ${saved.y})`,
    );
    assert.ok(
      Math.abs(saved.windowY - afterSelection.windowY) <= 2,
      'Saving does not scroll the outer page',
    );
    await page.screenshot({ path: path.join(output, 'annotations-private-save.png') });

    await visit('other');
    assert.equal(
      await page.$(`#learning-annotation-list [data-annotation-id="${saved.id}"]`),
      null,
      'Another account cannot see the saved private annotation',
    );
    assert.equal(await page.$(`#knowledge-body [data-private-annotation~="${saved.id}"]`), null);
    await page.setViewport({ width: 390, height: 844 });
    await visit();
    if (
      await page.$eval(
        '#knowledge-chat-panel',
        (item) => !item.hidden && !item.classList.contains('hidden'),
      )
    )
      await page.click('#knowledge-chat-close');
    await page.$eval('#knowledge-body', (item) =>
      item.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    const mobileAction = await page.$('[data-annotation-action="underline"]');
    const mobileBox = await mobileAction.boundingBox();
    assert.ok(mobileBox && mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 844);
    assert.equal(
      await mobileAction.evaluate((item) => {
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit === item || item.contains(hit);
      }),
      true,
      'The mobile annotation action is visible and unobscured',
    );
    await mobileAction.click();
    await page.waitForFunction(() =>
      document.getElementById('learning-annotation-status').textContent.includes('请先选择原文'),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
      'The mobile reader and visible annotation toolbar do not overflow horizontally',
    );
    await page.screenshot({ path: path.join(output, 'annotations-mobile-reader.png') });
    assert.equal(
      requests.some((route) => route.startsWith('/api/ai/')),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ok: true,
        output,
        checks: [
          'visible toolbar',
          'deep selection without tool/scroll changes',
          'private save',
          'same-page directory',
          'account isolation',
          'mobile width',
          'no automatic AI',
        ],
      }),
    );
  } catch (error) {
    console.error(
      await page.evaluate(() => ({
        tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
        readerHidden: document.getElementById('knowledge-reading')?.hidden,
        readerClass: document.getElementById('knowledge-reading')?.className,
        bodyHeight: document.getElementById('knowledge-body')?.getBoundingClientRect().height,
        paragraphs: [...document.querySelectorAll('#knowledge-body p')].map(
          (item) => item.textContent.length,
        ),
        annotations: document.querySelectorAll('#knowledge-body [data-private-annotation]').length,
      })),
    );
    await page.screenshot({ path: path.join(output, 'annotations-failure.png') });
    throw error;
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
