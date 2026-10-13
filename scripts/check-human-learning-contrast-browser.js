// Existing localhost preview only. Actual visible content and explicit feedback
// GET fixtures are kept separate. No business writes, external service or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createContrastMath } = require('./fixtures/learning-contrast');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

function auditVisibleText(selector) {
  const math = window.qaLearningContrast;
  const root = document.querySelector(selector);
  if (!root) return { selector, samples: [], omitted: { missingRoot: 1 } };
  const samples = [];
  const omitted = { hidden: 0, outsideOrCovered: 0, empty: 0, decorative: 0, inactiveControl: 0 };
  function address(element) {
    const parts = [];
    for (
      let item = element;
      item && item.nodeType === Node.ELEMENT_NODE;
      item = item.parentElement
    ) {
      if (item.id) {
        parts.unshift(`#${item.id}`);
        break;
      }
      const peers = item.parentElement
        ? [...item.parentElement.children].filter((peer) => peer.tagName === item.tagName)
        : [];
      parts.unshift(
        `${item.tagName.toLowerCase()}${peers.length > 1 ? `:nth-of-type(${peers.indexOf(item) + 1})` : ''}`,
      );
    }
    return parts.join(' > ');
  }
  function concealed(element) {
    for (let item = element; item; item = item.parentElement) {
      const style = getComputedStyle(item);
      if (
        item.hidden ||
        item.classList.contains('hidden') ||
        style.display === 'none' ||
        ['hidden', 'collapse'].includes(style.visibility) ||
        style.contentVisibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        return true;
      if (
        item.tagName === 'DETAILS' &&
        !item.open &&
        !item.querySelector(':scope > summary')?.contains(element)
      )
        return true;
    }
    return false;
  }
  function visibleRect(node, element) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      let area = {
        left: Math.max(0, rect.left),
        right: Math.min(window.innerWidth, rect.right),
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
      for (let item = element.parentElement; item; item = item.parentElement) {
        const style = getComputedStyle(item);
        const box = item.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX))
          area = {
            ...area,
            left: Math.max(area.left, box.left),
            right: Math.min(area.right, box.right),
          };
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY))
          area = {
            ...area,
            top: Math.max(area.top, box.top),
            bottom: Math.min(area.bottom, box.bottom),
          };
      }
      if (area.right - area.left < 1 || area.bottom - area.top < 1) continue;
      const hit = document.elementFromPoint(
        (area.left + area.right) / 2,
        (area.top + area.bottom) / 2,
      );
      if (hit && (hit === element || element.contains(hit))) return area;
    }
    return null;
  }
  function inspect(node) {
    const element = node.parentElement;
    if (!node.textContent.trim()) {
      omitted.empty += 1;
      return;
    }
    // A glyph explicitly hidden from AT and consisting only of symbols is
    // decorative (the star has separate visible textual status beside it).
    // Do not exempt aria-hidden phrases such as the origin disclosure label.
    if (element.closest('[aria-hidden="true"]') && /^[\p{P}\p{S}\s]+$/u.test(node.textContent)) {
      omitted.decorative += 1;
      return;
    }
    if (element.closest('button:disabled,input:disabled,select:disabled,textarea:disabled')) {
      omitted.inactiveControl += 1;
      return;
    }
    if (concealed(element)) {
      omitted.hidden += 1;
      return;
    }
    const rect = visibleRect(node, element);
    if (!rect) {
      omitted.outsideOrCovered += 1;
      return;
    }
    const style = getComputedStyle(element);
    const foreground = math.parseColor(style.color);
    const reasons = [];
    if (!foreground) reasons.push(`unsupported color ${style.color}`);
    let backgroundPixel = [0, 0, 0, 0];
    let textPixel = foreground || [0, 0, 0, 0];
    const layers = [];
    for (let item = element; item; item = item.parentElement) {
      const css = getComputedStyle(item);
      const background = math.parseColor(css.backgroundColor);
      const opacity = Number(css.opacity);
      if (!background) reasons.push(`unsupported background ${css.backgroundColor}`);
      if (backgroundPixel[3] < 1 - 1e-9 && css.backgroundImage !== 'none')
        reasons.push(`image/gradient at ${address(item)}: ${css.backgroundImage}`);
      if (
        css.mixBlendMode !== 'normal' ||
        css.filter !== 'none' ||
        (css.backdropFilter && css.backdropFilter !== 'none')
      )
        reasons.push(`unmodelled blend/filter at ${address(item)}`);
      if (css.textShadow !== 'none') reasons.push(`text shadow at ${address(item)}`);
      if (item.namespaceURI?.includes('svg'))
        reasons.push('SVG sibling paint is not a CSS ancestor background');
      layers.push({
        selector: address(item),
        color: css.color,
        background: css.backgroundColor,
        image: css.backgroundImage,
        opacity,
        filter: css.filter,
        backdropFilter: css.backdropFilter,
        mixBlendMode: css.mixBlendMode,
        textShadow: css.textShadow,
      });
      backgroundPixel = math.opacity(
        math.over(backgroundPixel, background || [0, 0, 0, 0]),
        opacity,
      );
      textPixel = math.opacity(math.over(textPixel, background || [0, 0, 0, 0]), opacity);
    }
    // A transparent root ultimately paints onto Chrome's default white canvas.
    const background = math.over(backgroundPixel, [255, 255, 255, 1]);
    const ink = math.over(textPixel, [255, 255, 255, 1]);
    const size = Number.parseFloat(style.fontSize);
    const required = math.threshold(size, Number(style.fontWeight));
    const ratio = reasons.length ? null : math.ratio(ink, background);
    samples.push({
      selector: address(element),
      text: node.textContent.trim().slice(0, 180),
      fontSize: size,
      fontWeight: style.fontWeight,
      color: style.color,
      opacity: style.opacity,
      rect,
      layers,
      compositeForeground: reasons.length ? null : ink,
      compositeBackground: reasons.length ? null : background,
      required,
      ratio,
      result: reasons.length ? 'uncertain' : ratio >= required ? 'pass' : 'fail',
      reasons: [...new Set(reasons)],
    });
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) inspect(walker.currentNode);
  return { selector, samples, omitted };
}

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'learning-contrast-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Existing memory preview and actual long course content in Chrome. External requests and all non-GET business calls blocked. Feedback history is an explicitly labelled GET-only UI fixture, not a real student result or server record. No real AI.',
    rules:
      'WCAG text threshold 4.5:1 ordinarily; 3:1 at >=24 CSS px or >=18.6667px with weight >=700. sRGB source-over including ancestor opacity, then relative luminance with breakpoint0.04045. Ratios not rounded before classification. Hidden/closed-details/outside/covered text omitted; gradients/images/filter paint remain uncertain, not an exact pass. Computed-style samples, not full WCAG certification.',
    groups: [],
    errors: [],
    requests: [],
    screenshots: [],
    coverage: [],
  };
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  let feedbackFixture;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
      return request.respond({ status: 403, body: 'External services disabled' });
    if (url.pathname.startsWith('/api/')) {
      report.requests.push({ method: request.method(), path: url.pathname });
      if (request.method() !== 'GET' || /\/ai\//.test(url.pathname))
        return request.respond({
          status: 403,
          body: 'Writes and AI disabled for read-only contrast QA',
        });
    }
    if (
      feedbackFixture &&
      url.pathname === '/api/learning-assessments/signals/SS-02-01/attempts' &&
      !url.search
    )
      return request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attempts: [feedbackFixture],
          currentAttempts: [feedbackFixture],
          nextCursor: null,
          documentVersion: feedbackFixture.documentVersion,
        }),
      });
    return request.continue();
  });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  const installMath = () =>
    page.addScriptTag({
      content: `window.qaLearningContrast = (${createContrastMath.toString()})();`,
    });
  const show = async (selector) => {
    await page.$eval(selector, (node) =>
      node.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await settle();
  };
  const pointer = async (selector) => {
    await show(selector);
    await page.waitForFunction(
      (value) => {
        const node = document.querySelector(value);
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return box.width > 0 && box.height > 0 && (hit === node || node.contains(hit));
      },
      { timeout: 2500 },
      selector,
    );
    await page.click(selector);
    await settle();
  };
  const closeMax = async () => {
    if (
      await page.$eval(
        '#knowledge-chat-panel',
        (node) => !node.hidden && !node.classList.contains('hidden'),
      )
    )
      await pointer('#knowledge-chat-close');
  };
  const collect = async (scene, group, selector) => {
    // Sample resting controls, not a transient hover brightness filter caused
    // by the QA pointer remaining over the scrolled content.
    await page.mouse.move(2, 2);
    await settle();
    const values = await page.evaluate(auditVisibleText, selector);
    report.groups.push({ scene, group, ...values });
    return values;
  };
  const screenshot = async (scene, suffix) => {
    const target = path.join(output, `${scene}-${suffix}.png`);
    await page.screenshot({ path: target });
    report.screenshots.push(target);
  };
  try {
    await page.goto(
      `${base.origin}/knowledge?course=signals&point=SS-02-01&as=student&view=reading&tool=content`,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot().loaded &&
        document.querySelectorAll('#knowledge-body p').length > 20,
    );
    const actual = await page.evaluate(() => window.FreeBbsLearningAssessment.getSnapshot());
    const q = actual.questions.find((item) => item.id === 'SS-02-01-Q02') || actual.questions[0];
    assert.ok(q?.id);
    feedbackFixture = {
      id: '810001',
      questionId: q.id,
      questionVersion: q.questionVersion,
      documentVersion: actual.documentVersion,
      answer: '只读对比度夹具，不代表学生真实作答',
      status: 'graded',
      verdict: 'fail',
      official: true,
      score: 0,
      maxScore: q.scoring.maxScore,
      passScore: q.scoring.passScore,
      feedback: '只读 UI 夹具：核对条件与推导；不代表真实学习结果。',
      gradingBasis: '只读 UI 夹具评分说明',
      referenceMarkdown: '',
      createdAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-10T00:00:00Z',
    };
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 960 });
      for (const theme of ['light', 'dark']) {
        for (const scale of ['comfortable', 'large']) {
          const scene = `${width}-${theme}-${scale}`;
          await page.goto(
            `${base.origin}/knowledge?course=signals&point=SS-02-01&as=student&theme=${theme}&view=reading&tool=content`,
            { waitUntil: 'networkidle0' },
          );
          await page.waitForFunction(
            () =>
              document.querySelector('.learning-reading-size select') &&
              document.querySelectorAll('#knowledge-body p').length > 20 &&
              window.FreeBbsLearningAssessment?.getSnapshot().loaded,
          );
          await page.select('.learning-reading-size select', scale);
          await page.evaluate(() => document.fonts.ready);
          await closeMax();
          await installMath();
          await settle();
          report.coverage.push({
            scene,
            ...(await page.evaluate(() => ({
              actualBodyParagraphs: document.querySelectorAll('#knowledge-body p').length,
              realOriginCharacters:
                document.getElementById('knowledge-history-prose').textContent.length,
              actualQuestionCount: window.FreeBbsLearningAssessment.getSnapshot().questions.length,
              rootFont: getComputedStyle(document.documentElement).fontSize,
              bodyFont: getComputedStyle(document.getElementById('knowledge-body')).fontSize,
              theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
            }))),
          });
          await page.evaluate(() => {
            const paragraphs = [...document.querySelectorAll('#knowledge-body > p')];
            paragraphs[Math.floor(paragraphs.length * 0.6)].scrollIntoView({
              block: 'center',
              behavior: 'instant',
            });
          });
          await settle();
          await collect(scene, 'body-deep-real', '#knowledge-body');
          await collect(scene, 'reading-controls', '#learning-annotation-toolbar');
          await screenshot(scene, 'deep-body');
          if (
            await page.$eval(
              '#knowledge-history-toggle',
              (node) => node.getAttribute('aria-expanded') !== 'true',
            )
          )
            await pointer('#knowledge-history-toggle');
          await page.$eval('#knowledge-history-content', (node) => {
            node.scrollTop = 0;
          });
          await show('#knowledge-history-toggle');
          await collect(scene, 'origin-expanded-real', '#knowledge-history');
          await screenshot(scene, 'origin');
          await pointer('[data-knowledge-tool="feedback"]');
          await closeMax();
          await page.waitForFunction(
            () =>
              document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback',
          );
          const card = `[data-question-id="${q.id}"]`;
          await show(`${card} .learning-quiz-prompt`);
          await collect(scene, 'question-prompt-options-real', card);
          await screenshot(scene, 'quiz');
          await page.$eval(`${card} .learning-quiz-info`, (node) => {
            node.open = true;
          });
          await show(`${card} .learning-quiz-info`);
          await collect(scene, 'grading-rules-open-real', `${card} .learning-quiz-info`);
          await show('[data-attempt-id="810001"] summary');
          await pointer('[data-attempt-id="810001"] summary');
          await show('[data-attempt-id="810001"]');
          await collect(scene, 'feedback-open-explicit-get-fixture', '[data-attempt-id="810001"]');
          await screenshot(scene, 'feedback-fixture');
          await page.goto(
            `${base.origin}/course?course=signals&as=student&theme=${theme}&layout=directory`,
            { waitUntil: 'networkidle0' },
          );
          await page.waitForSelector('.course-map-directory-panel');
          await page.evaluate(
            (value) =>
              window.freeBbsTypography.applyPreferences({
                ...window.freeBbsTypography.getCurrentPreferences(),
                typeScale: value,
              }),
            scale,
          );
          await installMath();
          // The real authoring preview has only one node in some chapters;
          // that primary entry is not in the optional "other nodes" container.
          const topic = '.course-map-directory-current-actions [data-reader-node-id]';
          await show(topic);
          await collect(scene, 'small-directory-real', '.course-map-directory-layout');
          await screenshot(scene, 'directory');
          await pointer(topic);
          await page.waitForFunction(() =>
            document.querySelector(
              '.knowledge-overview-drawer[open] .knowledge-overview-content .knowledge-overview-course',
            ),
          );
          await settle();
          await collect(
            scene,
            'half-screen-overview-open-real',
            '.knowledge-overview-drawer[open]',
          );
          await screenshot(scene, 'overview');
        }
      }
    }
  } catch (error) {
    report.errors.push(error.stack || error.message);
    report.errorSnapshot = await page
      .evaluate(() => ({
        tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool,
        boxes: [
          '.scroller',
          '.knowledge-workbench',
          '.course-material-reader',
          '#knowledge-body',
          '#knowledge-history',
          '#knowledge-chat-panel',
        ].map((selector) => {
          const node = document.querySelector(selector);
          if (!node) return { selector, missing: true };
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            selector,
            width: box.width,
            height: box.height,
            left: box.left,
            top: box.top,
            display: style.display,
            gridTemplateColumns: style.gridTemplateColumns,
            hidden: node.hidden,
            className: node.className,
          };
        }),
      }))
      .catch(() => null);
  } finally {
    await browser.close();
    const samples = report.groups.flatMap((group) =>
      group.samples.map((sample) => ({ scene: group.scene, group: group.group, ...sample })),
    );
    report.summary = {
      groups: report.groups.length,
      samples: samples.length,
      exactPass: samples.filter((sample) => sample.result === 'pass').length,
      exactFail: samples.filter((sample) => sample.result === 'fail').length,
      uncertain: samples.filter((sample) => sample.result === 'uncertain').length,
      emptyVisibleGroups: report.groups
        .filter((group) => !group.samples.length)
        .map((group) => ({ scene: group.scene, group: group.group })),
      nonGetRequests: report.requests.filter((request) => request.method !== 'GET'),
      aiRequests: report.requests.filter((request) => /\/ai\//.test(request.path)),
    };
    report.failures = samples.filter((sample) => sample.result === 'fail');
    const reportPath = path.join(output, 'contrast-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, ...report.summary, errors: report.errors }));
    process.exitCode =
      report.errors.length || report.summary.exactFail || report.summary.emptyVisibleGroups.length
        ? 1
        : 0;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
