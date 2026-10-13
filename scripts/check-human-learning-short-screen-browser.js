// Existing loopback preview only: real long reading content, no business writes or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

function inspectShortScreen() {
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      width: rect.width,
      hidden: node.hidden || css.display === 'none' || css.visibility === 'hidden',
      position: css.position,
      overflowY: css.overflowY,
      maxHeight: css.maxHeight,
      fontSize: css.fontSize,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    };
  };
  const control = (selector) => {
    const node = document.querySelector(selector);
    const rect = box(node);
    if (!node) return { selector, missing: true };
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      selector,
      ...rect,
      disabled: Boolean(node.disabled),
      text: node.textContent.trim() || node.getAttribute('aria-label'),
      hit: hit?.id || hit?.className || hit?.tagName,
      reachable:
        !rect.hidden &&
        x >= 0 &&
        x < window.innerWidth &&
        y >= 0 &&
        y < window.innerHeight &&
        (hit === node || node.contains(hit)),
    };
  };
  const history = document.getElementById('knowledge-history');
  const toolbar = document.getElementById('learning-annotation-toolbar');
  const prose = document.getElementById('knowledge-body');
  const scroller = window.FreeBbsLearningReader?.getScrollHost();
  const ceiling = Math.max(
    0,
    scroller === window ? 0 : scroller?.getBoundingClientRect().top || 0,
    ...[history, toolbar]
      .filter((node) => node && !node.hidden && getComputedStyle(node).display !== 'none')
      .map((node) => Math.min(window.innerHeight, node.getBoundingClientRect().bottom)),
  );
  let visibleTextRects = 0;
  const walker = prose && document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  if (walker)
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const parent = node.parentElement;
      const css = getComputedStyle(parent);
      if (css.display === 'none' || css.visibility === 'hidden') continue;
      if (parent.closest('details:not([open])') && !parent.closest('summary')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (
          rect.top < ceiling ||
          rect.bottom > window.innerHeight ||
          rect.left < 0 ||
          rect.right > window.innerWidth
        )
          continue;
        const hit = document.elementFromPoint(
          (rect.left + rect.right) / 2,
          (rect.top + rect.bottom) / 2,
        );
        if (hit === parent || parent.contains(hit)) visibleTextRects += 1;
      }
    }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
    view: document.querySelector('[data-knowledge-page]')?.dataset.knowledgeView,
    rootFont: getComputedStyle(document.documentElement).fontSize,
    history: box(history),
    historyContent: box(document.getElementById('knowledge-history-content')),
    toolbar: box(toolbar),
    body: box(prose),
    scroller: scroller === window ? { window: true, scrollTop: window.scrollY } : box(scroller),
    remainingBelowStickyPx: Math.max(0, window.innerHeight - ceiling),
    visibleTextRects,
    historyExpanded: document
      .getElementById('knowledge-history-toggle')
      .getAttribute('aria-expanded'),
    controls: [
      '#knowledge-history-toggle',
      '#learning-annotation-toolbar [data-annotation-action="underline"]',
      '#learning-annotation-toolbar [data-annotation-action="comment"]',
      '#learning-annotation-toolbar [data-annotation-action="remove"]',
    ].map(control),
  };
}

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-short-screen-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Existing local memory preview and actual long authoring text in Chrome. External and non-GET API calls blocked. Formal submit is focused, never activated; no fabricated attempt/result. Geometry and native pointer/Tab/Enter, not WCAG certification or browser zoom.',
    scenes: [],
    requests: [],
    blocked: [],
    pageErrors: [],
    screenshots: [],
  };
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 10000,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  let page;
  const createPage = async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({ status: 403, body: 'External services disabled' });
      if (url.pathname.startsWith('/api/')) {
        const record = { method: request.method(), path: url.pathname };
        report.requests.push(record);
        if (request.method() !== 'GET' || /\/ai\//.test(url.pathname)) {
          report.blocked.push(record);
          return request.respond({ status: 403, body: 'Read-only QA: write and AI disabled' });
        }
      }
      return request.continue();
    });
  };
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
          // Error capture must finish even when a loading page has no animation frames.
          setTimeout(resolve, 150);
        }),
    );
  const pointer = async (selector) => {
    for (const block of ['center', 'end']) {
      await page.$eval(
        selector,
        (node, value) => node.scrollIntoView({ block: value, behavior: 'instant' }),
        block,
      );
      await settle();
      const reachable = await page.$eval(selector, (node) => {
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return (
          !node.disabled &&
          x >= 0 &&
          x < window.innerWidth &&
          y >= 0 &&
          y < window.innerHeight &&
          (hit === node || node.contains(hit))
        );
      });
      if (reachable) {
        await page.click(selector);
        await settle();
        return true;
      }
    }
    return false;
  };
  const capture = async (scene, name) => {
    await page.mouse.move(2, 2);
    await settle();
    const filename = path.join(output, `${scene}-${name}.png`);
    await page.screenshot({ path: filename });
    report.screenshots.push(filename);
    return { name, ...(await page.evaluate(inspectShortScreen)), screenshot: filename };
  };
  const tabTo = async (selector, limit = 100) => {
    for (let count = 0; count <= limit; count += 1) {
      const focused = await page.evaluate(
        (value) => document.activeElement?.matches(value),
        selector,
      );
      if (focused) {
        await settle();
        // Native focus/scroll may complete after a production smooth view transition.
        // Do not programmatically scroll the focused control into view to fake a pass.
        await page
          .waitForFunction(
            () => {
              const node = document.activeElement;
              const box = node.getBoundingClientRect();
              const x = box.left + box.width / 2;
              const y = box.top + box.height / 2;
              const hit = document.elementFromPoint(x, y);
              return (
                x >= 0 &&
                x < window.innerWidth &&
                y >= 0 &&
                y < window.innerHeight &&
                (hit === node || node.contains(hit))
              );
            },
            { timeout: 1500 },
          )
          .catch(() => {});
        return page.evaluate(() => {
          const node = document.activeElement;
          const box = node.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          const hit = document.elementFromPoint(x, y);
          return {
            found: true,
            selector: node.tagName,
            text: node.textContent.trim(),
            top: box.top,
            bottom: box.bottom,
            reachable:
              x >= 0 &&
              x < window.innerWidth &&
              y >= 0 &&
              y < window.innerHeight &&
              (hit === node || node.contains(hit)),
          };
        });
      }
      await page.keyboard.press('Tab');
    }
    return { found: false, reachable: false };
  };
  try {
    for (const viewport of [
      { width: 844, height: 390, theme: 'dark' },
      { width: 1366, height: 600, theme: 'light' },
      { width: 1280, height: 720, theme: 'dark' },
    ]) {
      const name = `${viewport.width}x${viewport.height}-${viewport.theme}-large`;
      const scene = { name, states: [], failures: [], advisories: [] };
      report.scenes.push(scene);
      try {
        if (page) await page.close();
        await createPage();
        await page.setViewport({ width: viewport.width, height: viewport.height });
        console.log(`START ${name}`);
        await page.goto(
          `${base.origin}/knowledge?course=signals&point=SS-02-01&as=student&theme=${viewport.theme}&view=reading&tool=content`,
          { waitUntil: 'domcontentloaded' },
        );
        await page.waitForFunction(
          () =>
            document.querySelectorAll('#knowledge-body p').length > 20 &&
            window.FreeBbsLearningAssessment?.getSnapshot().loaded,
        );
        await page.select('.learning-reading-size select', 'large');
        await page.evaluate(() => document.fonts.ready);
        if (
          await page.$eval(
            '#knowledge-chat-panel',
            (node) => !node.hidden && !node.classList.contains('hidden'),
          )
        )
          assert.ok(
            await pointer('#knowledge-chat-close'),
            'Max close is reachable without any AI',
          );
        scene.actualParagraphs = await page.$$eval('#knowledge-body p', (nodes) => nodes.length);
        const readingPage = page;
        const deepScroll = async () => {
          const target = await readingPage.$eval('#knowledge-body', (body) => {
            const paragraphs = [...body.querySelectorAll(':scope > p')];
            const readable = paragraphs.filter(
              (node) => node.textContent.length > 60 && node.getBoundingClientRect().height > 0,
            );
            if (!readable.length) throw new Error('No actual long body paragraph to inspect');
            const paragraph = readable[Math.floor(readable.length * 0.4)];
            return { index: paragraphs.indexOf(paragraph), text: paragraph.textContent };
          });
          const traversal = { target, method: 'native-mouse-wheel', steps: [] };
          scene.deepReadingTraversals ||= [];
          scene.deepReadingTraversals.push(traversal);
          const measure = () =>
            readingPage.evaluate((value) => {
              const body = document.getElementById('knowledge-body');
              const paragraph = body.querySelectorAll(':scope > p')[value.index];
              if (!paragraph || paragraph.textContent !== value.text)
                throw new Error('The public target paragraph changed during native traversal');
              const rect = paragraph.getBoundingClientRect();
              const bodyRect = body.getBoundingClientRect();
              const host = window.FreeBbsLearningReader.getScrollHost();
              const hostRect = host === window ? null : host.getBoundingClientRect();
              const surfaces = ['knowledge-history', 'learning-annotation-toolbar'].map((id) =>
                document.getElementById(id),
              );
              const ceiling = Math.max(
                0,
                hostRect?.top || 0,
                ...surfaces
                  .filter(
                    (node) => node && !node.hidden && getComputedStyle(node).display !== 'none',
                  )
                  .map((node) => Math.min(window.innerHeight, node.getBoundingClientRect().bottom)),
              );
              const nav = document.querySelector('.mobile-nav');
              const navRect = nav?.getBoundingClientRect();
              const navVisible =
                nav && navRect.height > 0 && getComputedStyle(nav).display !== 'none';
              const floor = Math.min(
                window.innerHeight,
                hostRect?.bottom || window.innerHeight,
                navVisible ? navRect.top : window.innerHeight,
              );
              let targetTextRects = 0;
              const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!node.textContent.trim()) continue;
                const parent = node.parentElement;
                const css = getComputedStyle(parent);
                if (css.display === 'none' || css.visibility === 'hidden') continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const line of range.getClientRects()) {
                  if (
                    line.top < ceiling ||
                    line.bottom > floor ||
                    line.left < 0 ||
                    line.right > window.innerWidth
                  )
                    continue;
                  const hit = document.elementFromPoint(
                    (line.left + line.right) / 2,
                    (line.top + line.bottom) / 2,
                  );
                  if (hit === parent || parent.contains(hit)) targetTextRects += 1;
                }
              }
              // Wheel over the origin's header, not its independently scrolling
              // prose. The later origin-wheel assertion must still start at zero.
              const toggleRect = document
                .getElementById('knowledge-history-toggle')
                .getBoundingClientRect();
              const candidates = [
                {
                  x: (toggleRect.left + toggleRect.right) / 2,
                  y: (toggleRect.top + toggleRect.bottom) / 2,
                },
                {
                  x: Math.min(
                    window.innerWidth - 16,
                    Math.max(16, (bodyRect.left + bodyRect.right) / 2),
                  ),
                  y: Math.max(16, floor - 16),
                },
              ];
              const wheelPoint = candidates.find(({ x, y }) => {
                if (x < 0 || x >= window.innerWidth || y < 0 || y >= floor) return false;
                const hit = document.elementFromPoint(x, y);
                return (
                  hit &&
                  !hit.closest('#knowledge-history-content,.mobile-nav,.knowledge-chat') &&
                  (host === window || host.contains(hit))
                );
              });
              if (!wheelPoint)
                throw new Error(
                  'No native wheel point outside independently scrolling origin prose',
                );
              return {
                targetTop: rect.top,
                targetBottom: rect.bottom,
                scrollTop: host === window ? window.scrollY : host.scrollTop,
                originScroll: document.getElementById('knowledge-history-content').scrollTop,
                ceiling,
                floor,
                targetTextRects,
                pointer: wheelPoint,
              };
            }, target);
          const stableGeometry = async () => {
            await readingPage.evaluate(
              () =>
                new Promise((resolve, reject) => {
                  let previous;
                  let equalFrames = 0;
                  const timer = setTimeout(
                    () => reject(new Error('Native reading geometry did not settle')),
                    2000,
                  );
                  const inspect = () => {
                    const body = document.getElementById('knowledge-body');
                    const host = window.FreeBbsLearningReader.getScrollHost();
                    const geometry = JSON.stringify([
                      host === window ? window.scrollY : host.scrollTop,
                      body.getBoundingClientRect().top,
                      ...['knowledge-history', 'learning-annotation-toolbar'].flatMap((id) => {
                        const rect = document.getElementById(id).getBoundingClientRect();
                        return [rect.top, rect.height];
                      }),
                    ]);
                    equalFrames = geometry === previous ? equalFrames + 1 : 0;
                    previous = geometry;
                    if (equalFrames >= 3) {
                      clearTimeout(timer);
                      resolve();
                    } else requestAnimationFrame(inspect);
                  };
                  requestAnimationFrame(inspect);
                }),
            );
          };
          let geometry = await measure();
          // At least one trusted reading action supersedes pending typography/
          // bookmark restoration. No focus(), scrollIntoView() or scroll write.
          for (let step = 0; step < 24; step += 1) {
            const delta = geometry.targetTextRects
              ? 48
              : Math.max(
                  -180,
                  Math.min(
                    180,
                    geometry.targetTop - Math.min(geometry.ceiling + 16, geometry.floor - 48),
                  ),
                );
            const deltaY = Math.abs(delta) < 24 ? (delta < 0 ? -24 : 24) : delta;
            traversal.steps.push({ before: geometry, deltaY });
            await readingPage.mouse.move(geometry.pointer.x, geometry.pointer.y);
            await readingPage.mouse.wheel({ deltaY });
            await readingPage.waitForFunction(
              (value, previous) => {
                const paragraph = document.querySelectorAll('#knowledge-body > p')[value.index];
                const host = window.FreeBbsLearningReader.getScrollHost();
                return (
                  Math.abs(paragraph.getBoundingClientRect().top - previous.targetTop) > 1 ||
                  Math.abs(
                    (host === window ? window.scrollY : host.scrollTop) - previous.scrollTop,
                  ) > 1 ||
                  document.getElementById('knowledge-history-content').scrollTop !==
                    previous.originScroll
                );
              },
              { polling: 'raf', timeout: 1500 },
              target,
              geometry,
            );
            await stableGeometry();
            geometry = await measure();
            traversal.steps.at(-1).after = geometry;
            if (geometry.targetTextRects > 0) return;
          }
          throw new Error(
            'Native traversal did not expose the selected public paragraph in 24 wheel actions',
          );
        };
        if (
          await page.$eval(
            '#knowledge-history-toggle',
            (node) => node.getAttribute('aria-expanded') !== 'true',
          )
        )
          assert.ok(await pointer('#knowledge-history-toggle'));
        await deepScroll();
        await settle();
        const expanded = await capture(name, 'reading-origin-expanded');
        scene.states.push(expanded);
        console.log(
          `READING ${name} bodyRects=${expanded.visibleTextRects} band=${expanded.remainingBelowStickyPx}`,
        );
        if (!expanded.visibleTextRects)
          scene.failures.push(
            'Expanded origin and toolbar leave no fully visible real body text rect',
          );
        if (expanded.remainingBelowStickyPx < 64)
          scene.advisories.push(
            'Expanded sticky elements leave under64px; this is a local usability heuristic, not a WCAG threshold',
          );
        const originContent = await page.$eval('#knowledge-history-content', (node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: (rect.left + rect.right) / 2,
            y: (rect.top + rect.bottom) / 2,
            scrollable: node.scrollHeight > node.clientHeight + 1,
          };
        });
        if (originContent.scrollable) {
          await page.mouse.move(originContent.x, originContent.y);
          await page.mouse.wheel({ deltaY: 200 });
          await page.waitForFunction(
            () => document.getElementById('knowledge-history-content').scrollTop > 0,
          );
          scene.states.push(await capture(name, 'origin-content-native-wheel'));
        }
        assert.ok(
          await pointer('#knowledge-history-toggle'),
          'Origin collapse pointer is reachable',
        );
        await deepScroll();
        scene.states.push(await capture(name, 'reading-origin-collapsed'));
        const underline = '#learning-annotation-toolbar [data-annotation-action="underline"]';
        scene.annotationKeyboard = await tabTo(underline);
        if (!scene.annotationKeyboard.reachable)
          scene.failures.push('Native Tab cannot visibly reach underline control');
        assert.ok(
          await pointer('#knowledge-history-toggle'),
          'Origin expansion pointer is reachable',
        );
        scene.states.push(await capture(name, 'origin-reexpanded-controls'));
        assert.ok(
          await pointer('[data-knowledge-tool="feedback"]'),
          'Formal assessment tool is pointer reachable',
        );
        await page.waitForFunction(
          () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback',
        );
        assert.ok(await pointer('[data-quiz-view="quick"]'), 'Formal selftest tab reachable');
        const firstQuestion = await page.$eval(
          '#learning-quiz-list [data-question-id]',
          (node) => node.dataset.questionId,
        );
        const card = `[data-question-id="${firstQuestion}"]`;
        await page.$eval(card, (node) =>
          node.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        scene.formalQuestion = firstQuestion;
        const radio = `${card} input[type="radio"]`;
        if (await page.$(radio))
          assert.ok(await pointer(radio), 'Actual option can be selected without submission');
        const submit = `${card} button[type="submit"]`;
        scene.submitKeyboard = await tabTo(submit);
        if (!scene.submitKeyboard.reachable)
          scene.failures.push('Native Tab cannot visibly reach formal submit');
        scene.states.push(await capture(name, 'formal-submit-focus-not-activated'));
        assert.ok(
          await pointer('[data-knowledge-tool="content"]'),
          'Return to reading tool is reachable',
        );
        assert.ok(
          await pointer('#knowledge-return-overview'),
          'Reading overview entry is reachable',
        );
        await page.waitForFunction(
          () => !document.getElementById('knowledge-overview').classList.contains('hidden'),
        );
        scene.overviewExitKeyboard = await tabTo('#knowledge-start-reading');
        if (!scene.overviewExitKeyboard.reachable)
          scene.failures.push('Native Tab cannot visibly reach overview return-to-reading');
        scene.states.push(await capture(name, 'overview-return-focus'));
        if (scene.overviewExitKeyboard.found) {
          await page.keyboard.press('Enter');
          await page.waitForFunction(
            () => !document.getElementById('knowledge-reading').classList.contains('hidden'),
          );
          scene.overviewReturned = true;
        }
      } catch (error) {
        scene.failures.push(error.stack || error.message);
        scene.states.push(
          await capture(name, 'error').catch(() => ({ name: 'error-screenshot-failed' })),
        );
      }
      scene.ok = scene.failures.length === 0;
      fs.writeFileSync(
        path.join(output, 'short-screen-report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      console.log(`DONE ${name} ok=${scene.ok}`);
    }
  } finally {
    await browser.close();
    report.ok =
      report.scenes.length === 3 &&
      report.scenes.every((scene) => scene.ok) &&
      !report.pageErrors.length &&
      !report.blocked.length;
    const filename = path.join(output, 'short-screen-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        filename,
        ok: report.ok,
        scenes: report.scenes.map(({ name, ok, failures, advisories }) => ({
          name,
          ok,
          failures,
          advisories,
        })),
        blocked: report.blocked,
        pageErrors: report.pageErrors,
      }),
    );
    if (!report.ok) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
