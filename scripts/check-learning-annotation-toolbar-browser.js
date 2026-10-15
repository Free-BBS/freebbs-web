// Native pointer/keyboard QA on isolated complete-preview records. No real AI or account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const ACTIONS = ['highlight', 'underline', 'comment', 'correction', 'ask'];
const TOOLBAR = '#learning-annotation-toolbar';
const POPOVER = '#learning-annotation-popover';
const NOTES_ENTRY = '#knowledge-reading [data-learning-go="notes"]';

async function click(page, selector) {
  await page.locator(selector).setTimeout(15000).click();
}

async function visible(page, selector) {
  return page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return (
      !element.hidden && !element.closest('.hidden,[hidden]') && Boolean(rect.width && rect.height)
    );
  });
}

async function selectProse(page, paragraphIndex, container = '#knowledge-body') {
  const fragment = await page.evaluate(
    ({ wanted, selector }) => {
      const body = document.querySelector(selector);
      const paragraphs = [...body.querySelectorAll('p')].filter(
        (paragraph) =>
          paragraph.textContent.trim().length >= 24 && !paragraph.querySelector('.katex,img'),
      );
      for (let index = wanted; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (text.parentElement.closest('[data-private-annotation],.katex')) continue;
          const start = text.data.search(/\S/);
          if (start < 0 || text.data.length - start < 20) continue;
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + 12);
          const rectangles = [...range.getClientRects()].filter((item) => item.width > 0);
          const rect = rectangles.find((item) => item.width > 40);
          if (!rect) continue;
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          if (!paragraph.contains(hit)) continue;
          const end = rectangles.at(-1);
          return {
            left: rect.left,
            right: end.right,
            y: rect.top + rect.height / 2,
            endY: end.top + end.height / 2,
            text: text.data.slice(start, start + 12),
          };
        }
      }
      return null;
    },
    { wanted: paragraphIndex, selector: container },
  );
  assert.ok(fragment, 'A real public prose fragment is visible and hit-testable');
  // The Range above only measures geometry. Native pointer events create the selection.
  await page.mouse.move(fragment.left + 0.2, fragment.y);
  await page.mouse.down();
  await page.mouse.move(fragment.right - 0.2, fragment.endY, { steps: 12 });
  await page.mouse.up();
  const actual = await page.evaluate(() => window.getSelection().toString());
  assert.equal(actual, fragment.text, 'Real pointer selection matches the public quote');
  await page.waitForFunction(
    () => document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'true',
  );
  for (const action of ACTIONS)
    assert.equal(
      await page.$eval(
        `${TOOLBAR} [data-annotation-action="${action}"]`,
        (element) => element.disabled,
      ),
      false,
    );
  return actual;
}

async function clickPlainProse(page) {
  const locatePoint = () =>
    page.evaluate(() => {
      const body = document.getElementById('knowledge-body');
      for (const paragraph of body.querySelectorAll('p')) {
        if (paragraph.textContent.trim().length < 24 || paragraph.querySelector('.katex,img'))
          continue;
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (
            text.data.trim().length < 24 ||
            text.parentElement.closest('[data-private-annotation],.katex')
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const rect of range.getClientRects()) {
            const y = rect.top + rect.height / 2;
            if (y < 0 || y >= window.innerHeight || !rect.width) continue;
            for (const x of [rect.left + 2, rect.left + rect.width / 2, rect.right - 2]) {
              if (x < 0 || x >= window.innerWidth) continue;
              const hit = document.elementFromPoint(x, y);
              if (
                paragraph.contains(hit) &&
                !hit.closest('[data-private-annotation],[data-private-annotation-block],a,button')
              )
                return { x, y, text: text.data.trim().slice(0, 80) };
            }
          }
        }
      }
      return null;
    });
  let point = await locatePoint();
  for (let attempt = 0; !point && attempt < 4; attempt += 1) {
    const freeColumn = await page.$eval('#knowledge-body', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: window.innerHeight - 20 };
    });
    // An expanded sticky origin can leave only the next heading below a mobile
    // comment editor. Native wheel navigation exposes prose without replacing
    // the current quote or fabricating a selection.
    await page.mouse.move(freeColumn.x, freeColumn.y);
    await page.mouse.wheel({ deltaY: 160 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    point = await locatePoint();
  }
  assert.ok(point, 'Plain public prose remains visible outside the floating comment editor');
  // Geometry and hit testing above only choose a target; a native click changes focus/selection.
  await page.mouse.click(point.x, point.y);
  assert.equal(
    await page.evaluate(() => window.getSelection().isCollapsed),
    true,
    'A native click in the prose collapses the browser selection',
  );
  return point;
}

async function expectWrite(page, method, operation) {
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname.startsWith('/api/learning/signals/SS-02-01/entries') &&
      item.request().method() === method,
  );
  await operation();
  const result = await response;
  assert.ok(
    result.status() >= 200 && result.status() < 300,
    `${method} annotation succeeds, received ${result.status()}`,
  );
  return result;
}

async function closePopover(page) {
  if (await visible(page, POPOVER))
    await click(page, `${POPOVER} header [data-annotation-ui="dismiss"]`);
}

async function saved(page) {
  await page.waitForFunction(
    () =>
      document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'false' &&
      !document.querySelector('#learning-annotation-toolbar [data-annotation-action="undo"]')
        .disabled,
  );
}

async function clickMark(page, entry) {
  const container =
    entry.annotation.anchor.section === 'origin' ? '#knowledge-history-prose' : '#knowledge-body';
  const selector = `${container} [data-private-annotation~="${entry.id}"],${container} [data-private-annotation="${entry.id}"],${container} [data-private-annotation-block="${entry.id}"]`;
  await click(page, selector);
  await page.waitForSelector(`${POPOVER}:not([hidden])`, { visible: true });
  assert.match(
    await page.$eval('#learning-annotation-popover-quote', (element) => element.textContent),
    new RegExp(entry.annotation.anchor.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.equal(
    await visible(page, '#learning-annotation-comment-field'),
    false,
    'A saved mark first opens read-only detail, not an editor',
  );
  assert.equal(await visible(page, `${POPOVER} [data-annotation-action="remove"]`), true);
}

async function replaceChatDraft(page, value) {
  await page.focus('#knowledge-chat-input');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await page.type('#knowledge-chat-input', value);
}

async function selectedMaxGuidance(page, preview, quote, section = 'body') {
  await page.waitForSelector('#knowledge-selection-guidance', { visible: true });
  assert.ok(
    (await page.$eval('#knowledge-selection-quote', (element) => element.textContent)).includes(
      quote,
    ),
    'Max local guidance visibly retains the exact selected quote',
  );
  const guidance = await page.$eval(
    '#knowledge-selection-guidance',
    (element) => element.textContent,
  );
  assert.match(guidance, /这部分你理解了吗/);
  assert.match(guidance, /Max.*学习引导/);
  if (section === 'origin') assert.match(guidance, /知识起源/);
  assert.equal(
    await page.$$eval(
      '#knowledge-selection-guidance [data-selection-help]',
      (elements) => elements.length,
    ),
    3,
  );
  assert.equal(preview.requests.length, 0, 'The local opening question sends no model request');
  for (const [choice, instruction] of [
    ['explain', /解释/],
    ['check', /检查|自测|问题/],
  ]) {
    await click(page, `#knowledge-selection-guidance [data-selection-help="${choice}"]`);
    const draft = await page.$eval('#knowledge-chat-input', (element) => element.value);
    assert.ok(draft.includes(quote), 'Every suggested request retains its explicit quote');
    assert.match(draft, instruction);
    if (section === 'origin') assert.match(draft, /知识起源/);
    assert.equal(
      preview.requests.length,
      0,
      'Choosing a suggested request is not an AI send action',
    );
  }
  const userDraft = '我已经写到一半的问题，请不要替我改掉。';
  await replaceChatDraft(page, userDraft);
  await click(page, '#knowledge-selection-guidance [data-selection-help="explain"]');
  assert.equal(
    await page.$eval('#knowledge-chat-input', (element) => element.value),
    userDraft,
    "A suggested selection prompt cannot overwrite the student's hand-written question",
  );
  assert.match(
    await page.$eval('#knowledge-selection-notice', (element) => element.textContent),
    /保留/,
  );
  await replaceChatDraft(page, '');
  await click(page, '#knowledge-selection-guidance [data-selection-help="question"]');
  assert.ok(
    (await page.$eval('#knowledge-chat-input', (element) => element.value)).includes(quote),
  );
  assert.equal(preview.requests.length, 0);
  // Leave no unsent text to collide with the next independently selected section.
  await replaceChatDraft(page, '');
}

async function run(browser, output, scenario) {
  const preview = createCompleteLearningPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  const requests = [];
  const dialogs = [];
  const scenes = [];
  let stage = 'initial-reading';
  const own = () =>
    preview.learning.store.rows.filter(
      (row) => row.user === 1 && row.point === 'SS-02-01' && row.annotation,
    );
  const capture = async (name) =>
    page.screenshot({ path: path.join(output, `${scenario.name}-${name}.png`) });
  try {
    await page.setViewport({ width: scenario.width, height: scenario.height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
      scenario.theme,
    );
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => {
      dialogs.push({
        type: dialog.type(),
        message: dialog.message(),
        accepted: dialog.type() === 'beforeunload',
      });
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else {
        errors.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
        await dialog.dismiss();
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === base && url.pathname.startsWith('/api/learning/'))
        requests.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base) request.continue();
      else {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
        request.abort('blockedbyclient');
      }
    });
    await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await click(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
    await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
      visible: true,
    });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    assert.equal(
      await visible(page, '#knowledge-chat-panel'),
      scenario.width > 920,
      'A first narrow-screen reading visit does not require closing an overlay',
    );
    if (await visible(page, '#knowledge-chat-panel')) await click(page, '#knowledge-chat-close');
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Annotation controls stay closed until the reader requests them',
    );
    assert.equal(await visible(page, POPOVER), false);
    assert.equal(
      await page.$$eval('#knowledge-reading select', (elements) => elements.length),
      0,
      'No per-reader font/size select or secondary dropdown remains',
    );
    assert.equal(
      await page.$eval('#learning-annotation-directory', (element) => element.open),
      false,
      'The annotation directory is not an inline always-open panel',
    );
    const original = await page.$eval('#knowledge-body', (element) => element.textContent);
    const originalOrigin = await page.$eval(
      '#knowledge-history-prose',
      (element) => element.textContent,
    );
    assert.ok(originalOrigin.trim().length >= 24, 'The authored origin contains real prose');
    assert.equal(own().length, 0);
    scenes.push(
      'Default reading has no annotation toolbar, inline directory, or local font selector',
    );

    stage = 'one-compact-icon-toolbar';
    await click(page, NOTES_ENTRY);
    await page.waitForSelector(`${TOOLBAR}:not([hidden])`, { visible: true });
    const toolbar = await page.$eval(TOOLBAR, (element) => ({
      role: element.getAttribute('role'),
      height: element.getBoundingClientRect().height,
      details: element.querySelectorAll('details').length,
      icons: [
        ...element.querySelectorAll('[data-annotation-action],#learning-reader-overview'),
      ].map((button) => ({
        action: button.dataset.annotationAction || 'overview',
        icon: Boolean(button.querySelector('svg')),
        label: button.getAttribute('aria-label'),
      })),
    }));
    assert.equal(toolbar.role, 'toolbar');
    assert.ok(
      toolbar.height <= 80,
      'The narrow toolbar remains one compact strip rather than a stack of forms',
    );
    assert.equal(toolbar.details, 0);
    assert.equal(toolbar.icons.length, 7);
    assert.ok(
      toolbar.icons.every((icon) => icon.icon && icon.label),
      'All seven actions use labelled icons',
    );
    for (const action of ACTIONS)
      assert.equal(
        await page.$eval(
          `${TOOLBAR} [data-annotation-action="${action}"]`,
          (element) => element.disabled,
        ),
        true,
        `${action} requires selected public content`,
      );
    assert.equal(
      await page.$eval(`${TOOLBAR} [data-annotation-action="undo"]`, (element) => element.disabled),
      true,
    );
    assert.equal(
      await page.$eval(NOTES_ENTRY, (element) => element.getAttribute('aria-pressed')),
      'true',
    );
    await click(page, NOTES_ENTRY);
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Clicking the native entry again folds the toolbar',
    );
    assert.equal(
      await page.$eval(NOTES_ENTRY, (element) => element.getAttribute('aria-pressed')),
      'false',
    );
    await click(page, NOTES_ENTRY);
    await page.waitForSelector(`${TOOLBAR}:not([hidden])`, { visible: true });
    assert.equal(
      await page.$eval(NOTES_ENTRY, (element) => element.getAttribute('aria-pressed')),
      'true',
    );
    assert.equal(own().length, 0, 'Opening/folding the toolbar does not create a note');
    await capture('toolbar');
    scenes.push(
      'Native annotation entry opens and folds one accessible icon strip; pressed state follows visibility, and five quote actions initially disabled',
    );

    stage = 'independent-color-menus-and-highlight';
    const highlightQuote = await selectProse(page, 0);
    await click(page, '[data-annotation-menu="highlight"]');
    await click(page, '[data-annotation-palette="highlight"][data-annotation-color="green"]');
    assert.equal(own().length, 0, 'Choosing a color does not save or apply a mark');
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="highlight"]`),
    );
    await page.waitForSelector('#knowledge-body .learning-annotation-highlight');
    const highlight = own().at(-1);
    assert.equal(highlight.annotation.style, 'highlight');
    assert.equal(highlight.annotation.color, 'green');
    assert.equal(highlight.annotation.anchor.quote, highlightQuote);
    await page.waitForFunction(
      () =>
        !document.getElementById('learning-annotation-toolbar').dataset.hasSelection ||
        document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'false',
    );
    for (const action of ACTIONS)
      assert.equal(
        await page.$eval(
          `${TOOLBAR} [data-annotation-action="${action}"]`,
          (element) => element.disabled,
        ),
        true,
      );
    await closePopover(page);
    const underlineQuote = await selectProse(page, 1);
    await click(page, '[data-annotation-menu="underline"]');
    await click(page, '[data-annotation-palette="underline"][data-annotation-color="blue"]');
    assert.equal(own().length, 1);
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="underline"]`),
    );
    await page.waitForSelector('#knowledge-body .learning-annotation-underline');
    await saved(page);
    const underline = own().at(-1);
    assert.equal(underline.annotation.style, 'underline');
    assert.equal(underline.annotation.color, 'blue');
    assert.equal(underline.annotation.anchor.quote, underlineQuote);
    assert.equal(highlight.annotation.color, 'green');
    const colors = await page.$$eval('[data-annotation-palette][aria-pressed="true"]', (elements) =>
      elements
        .map((element) => `${element.dataset.annotationPalette}:${element.dataset.annotationColor}`)
        .sort(),
    );
    assert.deepEqual(colors, ['highlight:green', 'underline:blue']);
    scenes.push(
      'Highlight and underline retain independent colors; only pressing the primary icon writes a private mark',
    );

    stage = 'click-existing-detail-and-delete';
    await clickMark(page, underline);
    assert.equal(
      await page.$eval('#learning-annotation-popover-content', (element) => element.textContent),
      underline.content,
    );
    await capture('mark-detail');
    const deleteReadback = await page.$eval(
      `${POPOVER} [data-annotation-action="remove"]`,
      (button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const ancestors = [];
        for (let element = button; element; element = element.parentElement) {
          const css = getComputedStyle(element);
          ancestors.push({
            tag: element.tagName,
            id: element.id,
            className: element.className,
            pointerEvents: css.pointerEvents,
            zIndex: css.zIndex,
            opacity: css.opacity,
            position: css.position,
            background: css.backgroundColor,
            transform: css.transform,
          });
        }
        const hitAncestors = [];
        for (let element = hit; element; element = element.parentElement) {
          const css = getComputedStyle(element);
          hitAncestors.push({
            tag: element.tagName,
            id: element.id,
            className: element.className,
            zIndex: css.zIndex,
            position: css.position,
            opacity: css.opacity,
            isolation: css.isolation,
          });
        }
        return {
          disabled: button.disabled,
          hitIsButton: hit === button || button.contains(hit),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          hit: hit?.outerHTML.slice(0, 500),
          ancestors,
          hitAncestors,
        };
      },
    );
    scenes.push({ deleteReadback });
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        stage: 'delete-native-hit-readback',
        deleteReadback,
      }),
    );
    stage = 'existing-delete-request';
    assert.equal(
      deleteReadback.hitIsButton,
      true,
      'The floating detail Delete control must be above the reader and pointer-hit-testable',
    );
    await expectWrite(page, 'DELETE', () =>
      click(page, `${POPOVER} [data-annotation-action="remove"]`),
    );
    await page.waitForFunction(
      (id) => !document.querySelector(`#knowledge-body [data-private-annotation="${id}"]`),
      {},
      underline.id,
    );
    assert.deepEqual(
      own().map((entry) => entry.id),
      [highlight.id],
    );
    stage = 'undo-deletion-restores-content-with-new-id';
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="undo"]`),
    );
    await page.waitForSelector('#knowledge-body .learning-annotation-underline');
    const restoredUnderline = own().find((entry) => entry.annotation.style === 'underline');
    assert.ok(restoredUnderline);
    assert.notEqual(
      restoredUnderline.id,
      underline.id,
      'Restoring a removed private record uses a new confirmed ID',
    );
    assert.equal(restoredUnderline.content, underline.content);
    assert.deepEqual(restoredUnderline.annotation, underline.annotation);
    await clickMark(page, restoredUnderline);
    await expectWrite(page, 'DELETE', () =>
      click(page, `${POPOVER} [data-annotation-action="remove"]`),
    );
    await page.waitForFunction(
      () => !document.querySelector('#knowledge-body .learning-annotation-underline'),
    );
    assert.equal(own().length, 1);
    scenes.push(
      "Clicking an existing mark opens its detail and delete control without auto-editing or revealing anyone else's records",
    );

    stage = 'floating-comment-cancel-and-save';
    await closePopover(page);
    const commentQuote = await selectProse(page, 2);
    const beforeHeight = await page.$eval('#knowledge-body', (element) => element.offsetHeight);
    await click(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    await page.waitForSelector(`${POPOVER}:not([hidden]) #learning-annotation-comment`, {
      visible: true,
    });
    assert.equal(
      await page.$eval(POPOVER, (element) => getComputedStyle(element).position),
      'fixed',
      'A comment floats over the page rather than reserving a prose row',
    );
    assert.equal(
      await page.$eval('#knowledge-body', (element) => element.offsetHeight),
      beforeHeight,
    );
    await page.type('#learning-annotation-comment', '这是一条未保存的本地演示批注。');
    await click(page, `${POPOVER} footer [data-annotation-ui="close"]`);
    assert.equal(own().length, 1, 'Cancelling a comment creates no saved note');
    await selectProse(page, 2);
    await click(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
      visible: true,
    });
    await page.focus('#learning-annotation-comment');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.type('#learning-annotation-comment', '私有批注：这里还需要区分连续与离散情况。');
    stage = 'dirty-comment-survives-native-prose-click';
    const dirtyQuote = await page.$eval(
      '#learning-annotation-popover-quote',
      (element) => element.textContent,
    );
    const dirtyContent = await page.$eval(
      '#learning-annotation-comment',
      (element) => element.value,
    );
    await click(page, `${POPOVER} [data-annotation-ui="dismiss"]`);
    assert.equal(await visible(page, POPOVER), false);
    await click(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    assert.equal(
      await page.$eval('#learning-annotation-comment', (element) => element.value),
      dirtyContent,
    );
    assert.equal(
      await page.$eval('#learning-annotation-popover-quote', (element) => element.textContent),
      dirtyQuote,
    );
    assert.equal(
      own().length,
      1,
      'Closing and reopening a draft cannot silently discard or save it',
    );
    const plainProseClick = await clickPlainProse(page);
    assert.equal(
      await visible(page, POPOVER),
      true,
      'An unsaved comment remains open after a prose click',
    );
    assert.equal(
      await page.$eval('#learning-annotation-popover-quote', (element) => element.textContent),
      dirtyQuote,
    );
    assert.equal(
      await page.$eval('#learning-annotation-comment', (element) => element.value),
      dirtyContent,
    );
    assert.equal(await page.$eval(TOOLBAR, (element) => element.dataset.hasSelection), 'true');
    assert.equal(own().length, 1, 'A prose click cannot write or redirect an unsaved comment');
    scenes.push({ dirtyCommentProseClick: plainProseClick });
    await capture('comment-editor');
    stage = 'save-dirty-comment-after-native-prose-click';
    await expectWrite(page, 'POST', () =>
      click(page, `${POPOVER} [data-annotation-action="comment-save"]`),
    );
    await page.waitForSelector('#knowledge-body .learning-annotation-comment');
    await saved(page);
    const comment = own().at(-1);
    assert.equal(comment.annotation.style, 'comment');
    assert.equal(comment.annotation.anchor.quote, commentQuote);
    assert.equal(
      comment.content,
      dirtyContent,
      'Saving retains the exact original quote and draft after a prose click',
    );
    assert.match(comment.content, /^私有批注/);
    assert.equal(comment.status, 'private');
    assert.equal(
      await page.$eval('#learning-annotation-directory', (element) => element.open),
      false,
      'Saving cannot reopen an inline annotation list',
    );
    await closePopover(page);
    await clickMark(page, comment);
    assert.match(
      await page.$eval('#learning-annotation-popover-content', (element) => element.textContent),
      /私有批注/,
    );
    await click(page, `${POPOVER} [data-annotation-ui="edit"]`);
    await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
      visible: true,
    });
    assert.equal(
      await page.$eval('#learning-annotation-comment', (element) => element.value),
      comment.content,
    );
    await click(page, `${POPOVER} footer [data-annotation-ui="close"]`);
    assert.equal(own().length, 2);
    stage = 'undo-edit-restores-previous-comment';
    const commentContent = comment.content;
    await clickMark(page, comment);
    await click(page, `${POPOVER} [data-annotation-ui="edit"]`);
    await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
      visible: true,
    });
    await page.focus('#learning-annotation-comment');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.type('#learning-annotation-comment', '私有批注的第二次修改，稍后用撤销恢复。');
    await expectWrite(page, 'PUT', () =>
      click(page, `${POPOVER} [data-annotation-action="comment-save"]`),
    );
    await saved(page);
    assert.notEqual(own().find((entry) => entry.id === comment.id).content, commentContent);
    await expectWrite(page, 'PUT', () => click(page, `${TOOLBAR} [data-annotation-action="undo"]`));
    assert.equal(own().find((entry) => entry.id === comment.id).content, commentContent);
    assert.equal(own().length, 2);
    scenes.push(
      'Undo also restores a deleted note with a remapped ID and reverses an explicit saved comment edit without discarding other notes',
    );
    scenes.push(
      'A private sticky-style comment uses an out-of-flow editor; cancel does not write, save does not expand a directory, and later edit is explicit',
    );

    stage = 'private-correction-and-selected-max-draft';
    const correctionQuote = await selectProse(page, 3);
    await click(page, `${TOOLBAR} [data-annotation-action="correction"]`);
    await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
      visible: true,
    });
    await page.type('#learning-annotation-comment', '私有纠错：建议课程组核对这个条件。');
    await expectWrite(page, 'POST', () =>
      click(page, `${POPOVER} [data-annotation-action="comment-save"]`),
    );
    await saved(page);
    const correction = own().at(-1);
    assert.equal(correction.title, '原文纠错');
    assert.equal(correction.annotation.style, 'comment');
    assert.equal(correction.annotation.anchor.quote, correctionQuote);
    assert.equal(correction.status, 'private');
    assert.equal(
      preview.learning.store.rows.filter((row) => row.kind === 'contribution').length,
      0,
      'Saving a personal correction does not automatically publish a course contribution',
    );
    await closePopover(page);
    await clickMark(page, correction);
    assert.match(
      await page.$eval('#learning-annotation-popover-title', (element) => element.textContent),
      /纠错/,
    );
    await closePopover(page);
    const maxQuote = await selectProse(page, 4);
    await click(page, `${TOOLBAR} [data-annotation-action="ask"]`);
    await page.waitForSelector('#knowledge-chat-input', { visible: true });
    assert.ok(
      (await page.$eval('#knowledge-chat-input', (element) => element.value)).includes(maxQuote),
    );
    assert.equal(
      preview.requests.length,
      0,
      'Ask Max opens an attributed draft; the student must explicitly send it',
    );
    await selectedMaxGuidance(page, preview, maxQuote);
    assert.equal(own().length, 3);
    await click(page, '#knowledge-chat-close');
    scenes.push(
      'Correction remains private; selected-text Max opens a visible quote and local understanding/help question, its suggested prompts never auto-send or overwrite a hand-written draft',
    );

    stage = 'undo-current-session-confirmed-change';
    await closePopover(page);
    const undoQuote = await selectProse(page, 5);
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="highlight"]`),
    );
    await page.waitForFunction(
      (quote) =>
        [...document.querySelectorAll('#knowledge-body [data-private-annotation]')].some(
          (element) => element.textContent === quote,
        ),
      {},
      undoQuote,
    );
    const newest = own().at(-1);
    assert.equal(own().length, 4);
    await expectWrite(page, 'DELETE', () =>
      click(page, `${TOOLBAR} [data-annotation-action="undo"]`),
    );
    assert.equal(own().length, 3);
    assert.ok(!own().some((entry) => entry.id === newest.id));
    assert.ok(own().some((entry) => entry.id === comment.id));
    scenes.push(
      'Undo reverses the latest confirmed current-session creation and leaves older private notes intact',
    );

    stage = 'authored-origin-selection-highlight-and-comment';
    await closePopover(page);
    if (!(await visible(page, '#knowledge-history-prose')))
      await click(page, '#knowledge-history-toggle');
    const bodyNoteIds = own().map((entry) => entry.id);
    const originHighlightQuote = await selectProse(page, 0, '#knowledge-history-prose');
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="highlight"]`),
    );
    await page.waitForSelector('#knowledge-history-prose .learning-annotation-highlight');
    await saved(page);
    const originHighlight = own().at(-1);
    assert.equal(originHighlight.annotation.anchor.section, 'origin');
    assert.equal(originHighlight.annotation.anchor.quote, originHighlightQuote);
    assert.equal(
      originHighlight.annotation.anchor.documentVersion,
      await page.evaluate(
        () => window.freeBbsKnowledge.getLearningContext().node.originDocumentVersion,
      ),
      'Origin annotations use the authored origin revision, not the main prose revision',
    );
    assert.equal(own().length, 4);
    assert.equal(
      await page.$$eval(
        `#knowledge-body [data-private-annotation~="${originHighlight.id}"]`,
        (elements) => elements.length,
      ),
      0,
      'An origin highlight must not render on the main prose',
    );
    for (const id of bodyNoteIds)
      assert.equal(
        await page.$$eval(
          `#knowledge-history-prose [data-private-annotation~="${id}"]`,
          (elements) => elements.length,
        ),
        0,
        'Existing main prose annotations cannot leak into the origin section',
      );
    await closePopover(page);
    const originCommentQuote = await selectProse(page, 0, '#knowledge-history-prose');
    await click(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    await page.waitForSelector('#learning-annotation-comment-field:not([hidden])', {
      visible: true,
    });
    await page.type('#learning-annotation-comment', '知识起源批注：这说明了学习变换域方法的动机。');
    await expectWrite(page, 'POST', () =>
      click(page, `${POPOVER} [data-annotation-action="comment-save"]`),
    );
    await saved(page);
    const originComment = own().at(-1);
    assert.equal(originComment.annotation.anchor.section, 'origin');
    assert.equal(originComment.annotation.anchor.quote, originCommentQuote);
    assert.equal(originComment.status, 'private');
    assert.equal(own().length, 5);
    await closePopover(page);
    await clickMark(page, originComment);
    assert.match(
      await page.$eval('#learning-annotation-popover-content', (element) => element.textContent),
      /知识起源批注/,
    );
    await expectWrite(page, 'DELETE', () =>
      click(page, `${POPOVER} [data-annotation-action="remove"]`),
    );
    assert.equal(own().length, 4);
    await expectWrite(page, 'POST', () =>
      click(page, `${TOOLBAR} [data-annotation-action="undo"]`),
    );
    await page.waitForSelector('#knowledge-history-prose .learning-annotation-comment');
    await saved(page);
    const restoredOriginComment = own().find(
      (entry) =>
        entry.annotation.anchor.section === 'origin' && entry.annotation.style === 'comment',
    );
    assert.ok(restoredOriginComment);
    assert.notEqual(restoredOriginComment.id, originComment.id);
    assert.equal(restoredOriginComment.content, originComment.content);
    assert.deepEqual(restoredOriginComment.annotation, originComment.annotation);
    assert.equal(own().length, 5);
    await closePopover(page);
    await click(page, '#knowledge-history-toggle');
    assert.equal(await visible(page, '#knowledge-history-prose'), false);
    assert.equal(own().length, 5, 'Folding origin is not a deletion or a hidden save action');
    await click(page, '#knowledge-history-toggle');
    await clickMark(page, restoredOriginComment);
    await capture('origin-comment-detail');
    await closePopover(page);
    stage = 'selected-origin-max-local-guidance';
    const originMaxQuote = await selectProse(page, 0, '#knowledge-history-prose');
    await click(page, `${TOOLBAR} [data-annotation-action="ask"]`);
    await page.waitForSelector('#knowledge-chat-input', { visible: true });
    await selectedMaxGuidance(page, preview, originMaxQuote, 'origin');
    assert.equal(own().length, 5, 'Selected-origin Max guidance is not a saved annotation');
    await capture('origin-max-guidance');
    await click(page, '#knowledge-chat-close');
    scenes.push(
      'Authored origin uses native highlight/comment/detail/delete/undo, persists after folding, and selected Max guidance attributes the origin quote; section/version boundaries isolate origin and main prose marks',
    );

    stage = 'reload-private-marks-while-tools-stay-closed';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(
      '#knowledge-reading:not(.hidden) #knowledge-body [data-private-annotation]',
      { visible: true },
    );
    if (await visible(page, '#knowledge-chat-panel')) await click(page, '#knowledge-chat-close');
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Reload does not force an annotation editing strip open',
    );
    assert.equal(await page.$$eval('#knowledge-body', (elements) => elements.length), 1);
    assert.equal(
      await page.$eval('#knowledge-body', (element) => element.textContent),
      original,
      'The single public prose text is unchanged by all private marks',
    );
    assert.equal(
      await page.$eval('#knowledge-history-prose', (element) => element.textContent),
      originalOrigin,
      'Private origin marks leave the authored origin prose unchanged',
    );
    assert.equal(own().length, 5);
    assert.equal(
      await page.$eval(`${TOOLBAR} [data-annotation-action="undo"]`, (element) => element.disabled),
      true,
      'Reload cannot undo an unowned historical operation',
    );
    await clickMark(page, comment);
    assert.match(
      await page.$eval('#learning-annotation-popover-content', (element) => element.textContent),
      /私有批注/,
    );
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Saved notes can be inspected without opening editing tools',
    );
    await closePopover(page);
    await clickMark(page, restoredOriginComment);
    assert.match(
      await page.$eval('#learning-annotation-popover-content', (element) => element.textContent),
      /知识起源批注/,
    );
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Reloaded origin notes can be inspected without reopening annotation tools',
    );
    await closePopover(page);
    await clickMark(page, comment);
    await expectWrite(page, 'DELETE', () =>
      click(page, `${POPOVER} [data-annotation-action="remove"]`),
    );
    await page.waitForFunction(
      (id) => !document.querySelector(`#knowledge-body [data-private-annotation="${id}"]`),
      {},
      comment.id,
    );
    assert.equal(own().length, 4);
    assert.equal(
      await visible(page, TOOLBAR),
      false,
      'Deleting from a saved-note detail cannot automatically expand the editing toolbar',
    );
    await closePopover(page);
    await click(page, NOTES_ENTRY);
    await page.waitForSelector(`${TOOLBAR}:not([hidden])`, { visible: true });
    await capture('reload');
    await click(page, '#learning-reader-overview');
    await page.waitForSelector('#knowledge-overview:not(.hidden)', { visible: true });
    assert.equal(
      await page.$eval('#knowledge-reading', (element) => element.classList.contains('hidden')),
      true,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    assert.equal(preview.learning.assessmentStore.rows.length, 0);
    assert.equal(preview.learning.starsStore.rows.length, 0);
    scenes.push(
      'Reload preserves isolated private overlays on unchanged main prose and origin; inspection still works with the toolbar closed; overview uses a native icon and records no self-test/star',
    );
    return { scenario, passed: true, stage, scenes, requests, errors, blocked, dialogs };
  } catch (error) {
    await capture('failure').catch(() => {});
    return {
      scenario,
      passed: false,
      stage,
      message: error.message,
      scenes,
      requests,
      errors,
      blocked,
      dialogs,
      state: await page
        .evaluate(() => ({
          url: window.location.href,
          dialogs: [...document.querySelectorAll('dialog[open]')].map(
            (element) => element.id || element.className,
          ),
          toolbar: document.getElementById('learning-annotation-toolbar')?.outerHTML.slice(0, 2000),
          status: document.getElementById('learning-annotation-status')?.textContent,
        }))
        .catch(() => ({})),
    };
  } finally {
    await context.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections();
    });
  }
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-annotation-toolbar-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const results = [];
  try {
    for (const scenario of [
      { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
      { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
    ]) {
      const result = await run(browser, output, scenario);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          boundary:
            'Native pointer/keyboard on desktop Chrome and a narrow Chrome viewport; not physical touch/mobile/IME QA. Isolated preview memory only, no real model or account.',
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Annotation toolbar browser QA: ${output}`);
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
