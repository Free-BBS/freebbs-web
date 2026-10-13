// Independent current-toolbar boundary review. No production account, grade or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const TOOLBAR = '#learning-annotation-toolbar';
const ENTRY = '#knowledge-reading [data-learning-go="notes"]';
const POPOVER = '#learning-annotation-popover';
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

async function focusObservation(page) {
  return page.evaluate(() => {
    const item = document.activeElement;
    const rect = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    const visible =
      Boolean(rect.width && rect.height) &&
      !item.closest('[hidden],.hidden') &&
      style.visibility !== 'hidden';
    const hit =
      visible && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      id: item.id,
      tag: item.tagName,
      focusable:
        item.matches('a[href],button,input,select,textarea,[tabindex]') && item.tabIndex >= 0,
      action: item.dataset.annotationAction || '',
      menu: item.dataset.annotationMenu || '',
      label: item.getAttribute('aria-label') || item.textContent.trim().slice(0, 70),
      visible,
      viewport:
        visible &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth,
      hit: Boolean(hit && (item === hit || item.contains(hit))),
      outline: style.outlineStyle,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

async function tabTo(page, selector, limit = 210) {
  for (let index = 0; index < limit; index += 1) {
    if (await page.evaluate((query) => document.activeElement.matches(query), selector)) {
      // Native focus may start smooth scrolling. Observe its settled position,
      // not a transient frame; never force focus or inject a scroll to pass.
      await page
        .waitForFunction(
          (query) => {
            const item = document.activeElement;
            if (!item.matches(query)) return false;
            const box = item.getBoundingClientRect();
            return (
              box.top >= 0 &&
              box.bottom <= window.innerHeight &&
              box.left >= 0 &&
              box.right <= window.innerWidth
            );
          },
          { timeout: 2500 },
          selector,
        )
        .catch(() => {});
      await settle(page);
      return { found: true, tabs: index, focus: await focusObservation(page) };
    }
    await page.keyboard.press('Tab');
  }
  return { found: false, tabs: limit, focus: await focusObservation(page) };
}

async function selectActualProse(page) {
  const fragment = await page.evaluate(() => {
    for (const paragraph of document.querySelectorAll('#knowledge-body > p')) {
      if (paragraph.querySelector('.katex,img') || paragraph.textContent.trim().length < 30)
        continue;
      paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const start = text.data.search(/\S/);
        if (start < 0 || text.data.length - start < 20) continue;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 10);
        const boxes = [...range.getClientRects()].filter((box) => box.width > 0);
        const first = boxes[0];
        const last = boxes.at(-1);
        if (!first || first.top < 0 || last.bottom > window.innerHeight) continue;
        const hit = document.elementFromPoint(
          first.left + first.width / 2,
          first.top + first.height / 2,
        );
        if (!paragraph.contains(hit)) continue;
        return {
          text: text.data.slice(start, start + 10),
          x: first.left,
          y: first.top + first.height / 2,
          endX: last.right,
          endY: last.top + last.height / 2,
        };
      }
    }
    return null;
  });
  assert.ok(fragment, 'Actual paragraph is visible; Range measures only, mouse creates selection');
  await page.mouse.move(fragment.x + 0.2, fragment.y);
  await page.mouse.down();
  await page.mouse.move(fragment.endX - 0.2, fragment.endY, { steps: 10 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => getSelection().toString()), fragment.text);
  await page.waitForFunction(
    () => document.getElementById('learning-annotation-toolbar').dataset.hasSelection === 'true',
  );
  return fragment.text;
}

async function maxVisible(page) {
  return page.$eval(
    '#knowledge-chat-panel',
    (panel) => !panel.hidden && !panel.classList.contains('hidden'),
  );
}

async function openMax(page) {
  if (!(await maxVisible(page))) await page.locator('#knowledge-chat-toggle').click();
}

async function replaceMaxDraft(page, value) {
  await openMax(page);
  await page.locator('#knowledge-chat-input').click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value);
}

async function run(browser, output, spec) {
  const preview = createCompleteLearningPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const result = {
    name: spec.name,
    viewport: spec,
    checks: [],
    advisories: [],
    blocked: [],
    writes: [],
    errors: [],
    screenshots: [],
    dialogs: [],
  };
  const record = (name, pass, details = {}) =>
    result.checks.push({ name, pass: Boolean(pass), ...details });
  try {
    await page.setViewport({ width: spec.width, height: spec.height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
      spec.theme,
    );
    page.on('pageerror', (error) => result.errors.push(error.message));
    page.on('dialog', async (dialog) => {
      result.dialogs.push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        result.blocked.push(request.url());
        request.abort();
        return;
      }
      if (url.pathname.startsWith('/api/') && request.method() !== 'GET')
        result.writes.push({ path: url.pathname, method: request.method() });
      request.continue();
    });
    await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').click();
    await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    result.defaultCompanion = await page.evaluate(() => {
      const panel = document.getElementById('knowledge-chat-panel');
      const body = document.getElementById('knowledge-body');
      const rect = panel.getBoundingClientRect();
      const prose = body.getBoundingClientRect();
      return {
        visible: !panel.hidden && !panel.classList.contains('hidden'),
        position: getComputedStyle(panel).position,
        width: rect.width,
        height: rect.height,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        overlapWithProseWidth: Math.max(
          0,
          Math.min(rect.right, prose.right) - Math.max(rect.left, prose.left),
        ),
      };
    });
    record(
      'A fresh narrow screen defaults to reading with Max closed',
      spec.width > 920 || !result.defaultCompanion.visible,
      result.defaultCompanion,
    );
    await openMax(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    record('An explicitly opened Max panel remains open after reload', await maxVisible(page));
    if (await maxVisible(page)) await page.locator('#knowledge-chat-close').click();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    record('An explicitly closed Max panel remains closed after reload', !(await maxVisible(page)));
    if (
      await page.$eval(
        '#knowledge-chat-panel',
        (panel) => !panel.hidden && !panel.classList.contains('hidden'),
      )
    )
      await page.locator('#knowledge-chat-close').click();
    if (spec.large)
      await page.evaluate(() =>
        window.freeBbsTypography.applyPreferences({
          fontPreset: 'zhongsong-study',
          typeScale: 'large',
        }),
      );
    await page.evaluate(() => document.fonts.ready);
    record(
      'Default opt-in toolbar and no local font select',
      (await page.$eval(TOOLBAR, (bar) => bar.hidden)) &&
        (await page.$$eval('#knowledge-reading select', (items) => items.length === 0)),
    );
    const entry = await tabTo(page, ENTRY);
    record(
      'Native Tab reaches annotation entry visibly',
      entry.found && entry.focus.viewport && entry.focus.hit,
      entry,
    );
    assert.ok(entry.found);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${TOOLBAR}:not([hidden])`);
    const semantics = await page.$eval(TOOLBAR, (bar) => ({
      role: bar.getAttribute('role'),
      controls: [...bar.querySelectorAll('button')]
        .filter((item) => !item.closest('[hidden]'))
        .map((item) => ({
          label: item.getAttribute('aria-label'),
          title: item.title,
          disabled: item.disabled,
          width: item.getBoundingClientRect().width,
          height: item.getBoundingClientRect().height,
        })),
      width: bar.scrollWidth,
      clientWidth: bar.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    record(
      'All exposed icons have names and own hover titles; no page overflow',
      semantics.role === 'toolbar' &&
        semantics.controls.every((item) => item.label && item.title) &&
        semantics.pageWidth <= semantics.viewport + 1 &&
        semantics.width <= semantics.clientWidth + 1,
      semantics,
    );
    result.advisories.push(
      'Icon recognizability and hover discoverability require real first-time readers; labels alone do not prove comprehension. No touch/IME/screen-reader testing claim.',
    );
    const menu = await tabTo(page, `${TOOLBAR} [data-annotation-menu="highlight"]`);
    record(
      'Native Tab reaches separate color affordance',
      menu.found && menu.focus.viewport && menu.focus.hit,
      menu,
    );
    await page.keyboard.press('Enter');
    const green = await tabTo(
      page,
      '[data-annotation-palette="highlight"][data-annotation-color="green"]',
    );
    record(
      'Native Tab reaches labelled palette color',
      green.found && green.focus.viewport && green.focus.hit,
      green,
    );
    await page.keyboard.press('Enter');
    await settle(page);
    const afterColor = await focusObservation(page);
    record(
      'Closing palette retains a visible keyboard focus target',
      afterColor.focusable && afterColor.viewport && afterColor.hit,
      afterColor,
    );
    const reopened = await tabTo(page, `${TOOLBAR} [data-annotation-menu="highlight"]`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await settle(page);
    const afterEscape = await focusObservation(page);
    record(
      'Escape from palette returns focus outside hidden palette',
      reopened.found && afterEscape.focusable && afterEscape.viewport && afterEscape.hit,
      afterEscape,
    );
    const quote = await selectActualProse(page);
    const comment = await tabTo(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    record(
      'Native Tab reaches enabled comment action',
      comment.found && comment.focus.viewport && comment.focus.hit,
      comment,
    );
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${POPOVER}:not([hidden])`, { visible: true });
    await page.keyboard.type('这是未保存的私人批注，暂停后应仍在。');
    const draft = await page.$eval('#learning-annotation-comment', (item) => item.value);
    record('Comment keyboard activation focuses editor', draft.includes('未保存的私人批注'), {
      draft,
      focus: await focusObservation(page),
      quote,
    });
    await page.keyboard.press('Escape');
    await settle(page);
    const closedFocus = await focusObservation(page);
    record(
      'Escape preserves comment draft',
      (await page.$eval('#learning-annotation-comment', (item) => item.value)) === draft,
      { draft },
    );
    record(
      'Escape from editor restores visible keyboard focus',
      closedFocus.focusable && closedFocus.viewport && closedFocus.hit,
      closedFocus,
    );
    await tabTo(page, `${TOOLBAR} [data-annotation-action="comment"]`);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${POPOVER}:not([hidden])`, { visible: true });
    record(
      'Reopening comment restores draft and original quotation',
      (await page.$eval('#learning-annotation-comment', (item) => item.value)) === draft &&
        (
          await page.$eval('#learning-annotation-popover-quote', (item) => item.textContent)
        ).includes(quote),
    );
    const screenshot = path.join(output, `${spec.name}-comment.png`);
    await page.screenshot({ path: screenshot });
    result.screenshots.push(screenshot);
    const cancel = await tabTo(page, `${POPOVER} [data-annotation-ui="close"]`);
    record(
      'Native Tab reaches explicit discard control visibly',
      cancel.found && cancel.focus.viewport && cancel.focus.hit,
      cancel,
    );
    await page.keyboard.press('Enter');
    record(
      'Explicit cancel clears draft without annotation/AI write',
      (await page.$eval('#learning-annotation-comment', (item) => item.value)) === '' &&
        preview.requests.length === 0 &&
        result.writes.filter((item) => item.path.includes('/entries')).length === 0,
    );
    await replaceMaxDraft(page, '这个问题我写了一半，还没有决定要不要发送。');
    const maxDraft = await page.$eval('#knowledge-chat-input', (item) => item.value);
    await page.locator('#knowledge-chat-close').click();
    await page.locator('#knowledge-chat-toggle').click();
    record(
      'Closing/reopening Max retains unsent question without a model request',
      (await page.$eval('#knowledge-chat-input', (item) => item.value)) === maxDraft &&
        preview.requests.length === 0,
    );
    const dialogsBeforeReload = result.dialogs.length;
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    const maxAfterReload = await page.$eval('#knowledge-chat-input', (item) => item.value);
    const reloadWarning = result.dialogs
      .slice(dialogsBeforeReload)
      .some((dialog) => dialog.type === 'beforeunload');
    record(
      'Reload protects an unsent Max question by restoration or leave warning',
      maxAfterReload === maxDraft || reloadWarning,
      { maxDraft, maxAfterReload, reloadWarning },
    );
    const loaded = () =>
      page.waitForFunction(
        () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
      );
    const scope = () =>
      page.evaluate(() => ({
        uid: window.freeBbsApp.userState.uid,
        course: new URL(window.location.href).searchParams.get('course'),
        point: new URL(window.location.href).searchParams.get('point'),
      }));
    const leavePoint = async () => {
      const link = await page.evaluate(
        () =>
          ['knowledge-next-link', 'knowledge-previous-link']
            .map((id) => document.getElementById(id))
            .find((item) => item?.href && item.getAttribute('aria-disabled') !== 'true')?.id,
      );
      assert.ok(link, 'Authored course provides an actual previous/next point link');
      const original = page.url();
      await page.locator(`#${link}`).click();
      await page.waitForFunction((url) => window.location.href !== url, {}, original);
      await loaded();
    };
    const originalScope = await scope();
    await replaceMaxDraft(page, '回到当前知识点时，我要接着写这段尚未发送的问题。');
    const pointQuestionDraft = await page.$eval('#knowledge-chat-input', (item) => item.value);
    await page.locator('#knowledge-chat-close').click();
    const beforeMaxLeave = result.dialogs.length;
    await leavePoint();
    const otherScope = await scope();
    const otherQuestion = await page.$eval('#knowledge-chat-input', (item) => item.value);
    record(
      'Unsent Max question does not appear in a different knowledge point',
      otherScope.uid === originalScope.uid &&
        otherScope.course === originalScope.course &&
        otherScope.point !== originalScope.point &&
        !otherQuestion.includes(pointQuestionDraft),
      { originalScope, otherScope, otherQuestion },
    );
    await page.goBack({ waitUntil: 'networkidle0' });
    await loaded();
    const returnedQuestion = await page.$eval('#knowledge-chat-input', (item) => item.value);
    const maxLeaveWarning = result.dialogs
      .slice(beforeMaxLeave)
      .some((dialog) => dialog.type === 'beforeunload');
    record(
      'Leaving a point and returning protects the unsent Max question',
      returnedQuestion === pointQuestionDraft || maxLeaveWarning,
      {
        originalScope,
        returnedScope: await scope(),
        pointQuestionDraft,
        returnedQuestion,
        leaveWarning: maxLeaveWarning,
      },
    );
    // Keep annotation departure checks independent: a Max draft warning must not
    // accidentally stand in for the annotation draft's own leave protection.
    await replaceMaxDraft(page, '');
    if (await maxVisible(page)) await page.locator('#knowledge-chat-close').click();
    const startUnsavedComment = async (value) => {
      if (
        await page.$eval(
          '#knowledge-chat-panel',
          (panel) => !panel.hidden && !panel.classList.contains('hidden'),
        )
      )
        await page.locator('#knowledge-chat-close').click();
      if (await page.$eval(TOOLBAR, (bar) => bar.hidden)) await page.locator(ENTRY).click();
      const selected = await selectActualProse(page);
      await page.locator(`${TOOLBAR} [data-annotation-action="comment"]`).click();
      await page.waitForSelector(`${POPOVER}:not([hidden])`, { visible: true });
      await page.keyboard.type(value);
      return {
        value: await page.$eval('#learning-annotation-comment', (item) => item.value),
        quote: selected,
        scope: await scope(),
      };
    };
    const annotationReloadDraft = await startUnsavedComment('这是刷新前未保存的私人批注。');
    const beforeAnnotationReload = result.dialogs.length;
    await page.reload({ waitUntil: 'networkidle0' });
    await loaded();
    const afterAnnotationReload = await page.$eval(
      '#learning-annotation-comment',
      (item) => item.value,
    );
    const annotationReloadWarning = result.dialogs
      .slice(beforeAnnotationReload)
      .some((dialog) => dialog.type === 'beforeunload');
    record(
      'Reload protects an unsaved private annotation by restoration or leave warning',
      afterAnnotationReload === annotationReloadDraft.value || annotationReloadWarning,
      {
        before: annotationReloadDraft,
        after: afterAnnotationReload,
        leaveWarning: annotationReloadWarning,
        warningAcceptedByProbe: annotationReloadWarning,
        restored: afterAnnotationReload === annotationReloadDraft.value,
      },
    );
    const annotationLeaveDraft =
      await startUnsavedComment('这是离开知识点前未保存的另一条私人批注。');
    await page.locator(`${POPOVER} header [data-annotation-ui="dismiss"]`).click();
    const beforeAnnotationLeave = result.dialogs.length;
    await leavePoint();
    const otherAnnotation = await page.$eval('#learning-annotation-comment', (item) => item.value);
    record(
      'Unsaved private annotation does not appear in a different knowledge point',
      !otherAnnotation.includes(annotationLeaveDraft.value),
      { originalScope: annotationLeaveDraft.scope, otherScope: await scope(), otherAnnotation },
    );
    await page.goBack({ waitUntil: 'networkidle0' });
    await loaded();
    const returnedAnnotation = await page.$eval(
      '#learning-annotation-comment',
      (item) => item.value,
    );
    const annotationLeaveWarning = result.dialogs
      .slice(beforeAnnotationLeave)
      .some((dialog) => dialog.type === 'beforeunload');
    record(
      'Leaving a point and returning protects the unsaved private annotation',
      returnedAnnotation === annotationLeaveDraft.value || annotationLeaveWarning,
      {
        before: annotationLeaveDraft,
        returnedScope: await scope(),
        returnedAnnotation,
        leaveWarning: annotationLeaveWarning,
        warningAcceptedByProbe: annotationLeaveWarning,
        restored: returnedAnnotation === annotationLeaveDraft.value,
      },
    );
  } catch (error) {
    result.error = error.stack || error.message;
    const screenshot = path.join(output, `${spec.name}-failure.png`);
    await page.screenshot({ path: screenshot }).catch(() => {});
    result.screenshots.push(screenshot);
  } finally {
    result.aiRequests = preview.requests.length;
    await context.close();
    preview.server.closeAllConnections?.();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    result.ok =
      !result.error &&
      result.checks.every((check) => check.pass) &&
      !result.errors.length &&
      !result.blocked.length &&
      result.aiRequests === 0;
  }
  return result;
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-human-boundaries-'));
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Two fresh isolated complete memory servers and browser contexts. Native Tab/Enter/Escape/type and native mouse quote selection; DOM only measures geometry. Global large-text preference uses the actual preference API, not a local font select. No full keyboard-only text-selection, real IME, physical touch, screen reader, production data, external network or real AI claim.',
    rounds: [],
  };
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    headless: true,
  });
  try {
    for (const spec of [
      { name: 'desktop-light', width: 1440, height: 960, theme: 'light', large: false },
      { name: 'narrow-dark-large', width: 390, height: 844, theme: 'dark', large: true },
    ])
      report.rounds.push(await run(browser, output, spec));
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  report.ok = report.rounds.length === 2 && report.rounds.every((round) => round.ok);
  const filename = path.join(output, 'human-boundaries-report.json');
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        filename,
        ok: report.ok,
        rounds: report.rounds.map((round) => ({
          name: round.name,
          checks: round.checks.length,
          failed: round.checks.filter((check) => !check.pass),
          error: round.error,
          aiRequests: round.aiRequests,
          errors: round.errors,
        })),
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
