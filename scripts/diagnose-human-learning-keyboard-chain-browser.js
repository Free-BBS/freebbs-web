// Native keyboard diagnostic, not a screen-reader study or WCAG certification.
// Real Chrome + production UI/router; isolated memory fixture users/materials.
// No mouse clicks, programmatic focus/scroll, answer submission or AI requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

function selectedViewports() {
  const defaults = [
    { width: 1440, height: 1000 },
    { width: 920, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ];
  const raw = process.env.LEARNING_KEYBOARD_QA_VIEWPORTS;
  if (raw === undefined) return defaults;
  let viewports;
  try {
    viewports = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LEARNING_KEYBOARD_QA_VIEWPORTS must be a JSON array: ${error.message}`);
  }
  assert.ok(
    Array.isArray(viewports) && viewports.length > 0,
    'LEARNING_KEYBOARD_QA_VIEWPORTS must be a nonempty JSON array',
  );
  return viewports.map((viewport, index) => {
    assert.ok(
      viewport && typeof viewport === 'object' && !Array.isArray(viewport),
      `Viewport ${index} must be an object with width and height`,
    );
    assert.ok(
      Number.isInteger(viewport.width) && viewport.width >= 320 && viewport.width <= 1920,
      `Viewport ${index} width must be an integer in 320–1920`,
    );
    assert.ok(
      Number.isInteger(viewport.height) && viewport.height >= 300 && viewport.height <= 1400,
      `Viewport ${index} height must be an integer in 300–1400`,
    );
    return { width: viewport.width, height: viewport.height };
  });
}

function focusObservation() {
  const node = document.activeElement;
  if (!node || node === document.body)
    return { tag: node?.tagName || '', body: true, visible: true };
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const hiddenAncestor = node.closest('[hidden],.hidden,[inert]');
  const closedDetails = node.closest('details:not([open])');
  const inSummary = closedDetails?.querySelector(':scope > summary')?.contains(node);
  const hidden = Boolean(hiddenAncestor || (closedDetails && !inSummary));
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const hitReachable =
    x >= 0 &&
    x < window.innerWidth &&
    y >= 0 &&
    y < window.innerHeight &&
    (hit === node || node.contains(hit));
  const hitAncestors = [];
  if (!hitReachable && hit) {
    for (
      let ancestor = hit;
      ancestor && hitAncestors.length < 10;
      ancestor = ancestor.parentElement
    ) {
      const hitRect = ancestor.getBoundingClientRect();
      const hitStyle = getComputedStyle(ancestor);
      hitAncestors.push({
        tag: ancestor.tagName,
        id: ancestor.id,
        className: typeof ancestor.className === 'string' ? ancestor.className : '',
        text: ancestor.textContent.replace(/\s+/g, ' ').trim().slice(0, 180),
        position: hitStyle.position,
        zIndex: hitStyle.zIndex,
        pointerEvents: hitStyle.pointerEvents,
        previewBanner: ancestor.matches('[data-learning-preview]'),
        rect: {
          top: hitRect.top,
          bottom: hitRect.bottom,
          left: hitRect.left,
          right: hitRect.right,
        },
      });
    }
  }
  return {
    tag: node.tagName,
    id: node.id,
    className: typeof node.className === 'string' ? node.className : '',
    text: (
      node.getAttribute('aria-label') ||
      node.textContent.trim() ||
      node.getAttribute('title') ||
      ''
    ).slice(0, 160),
    hidden,
    hiddenAncestor: hiddenAncestor?.id || hiddenAncestor?.className || '',
    disabled: Boolean(node.disabled),
    rect: {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    },
    visible:
      !hidden &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden',
    hitReachable,
    hit: hit?.id || (typeof hit?.className === 'string' ? hit.className : '') || hit?.tagName || '',
    hitAncestors,
    panel: node.closest('[data-learning-panel]')?.dataset.learningPanel || '',
    tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool || '',
    view: document.querySelector('[data-knowledge-page]')?.dataset.knowledgeView || '',
  };
}

function maxGeometry() {
  const inspect = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      tag: node.tagName,
      id: node.id,
      className: typeof node.className === 'string' ? node.className : '',
      position: style.position,
      overflowY: style.overflowY,
      gridTemplateColumns: style.gridTemplateColumns,
      gridColumnStart: style.gridColumnStart,
      gridColumnEnd: style.gridColumnEnd,
      display: style.display,
      visibility: style.visibility,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      rect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
    };
  };
  const input = document.getElementById('knowledge-chat-input');
  const ancestors = [];
  for (let node = input?.parentElement; node; node = node.parentElement)
    ancestors.push(inspect(node));
  const host = window.FreeBbsLearningReader?.getScrollHost?.();
  const rect = input.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    windowScroll: {
      x: window.scrollX,
      y: window.scrollY,
      height: document.documentElement.scrollHeight,
    },
    activeId: document.activeElement.id,
    panel: inspect(document.getElementById('knowledge-chat-panel')),
    input: inspect(input),
    workbench: inspect(document.getElementById('knowledge-workbench')),
    reading: inspect(document.getElementById('knowledge-reading')),
    body: inspect(document.getElementById('knowledge-body')),
    ancestors,
    readerHost: host === window ? { window: true, scrollTop: window.scrollY } : inspect(host),
    inputHitReachable:
      x >= 0 &&
      x < window.innerWidth &&
      y >= 0 &&
      y < window.innerHeight &&
      (hit === input || input.contains(hit)),
  };
}

function readingGeometry(saved = null) {
  const reader = window.FreeBbsLearningReader;
  const body = document.getElementById('knowledge-body');
  const host = reader.getScrollHost();
  const visibleSticky = ['knowledge-history', 'learning-annotation-toolbar']
    .map((id) => document.getElementById(id))
    .filter(
      (node) =>
        node &&
        !node.hidden &&
        !node.classList.contains('hidden') &&
        ['sticky', 'fixed'].includes(getComputedStyle(node).position) &&
        node.getBoundingClientRect().height > 0,
    );
  const inset =
    16 +
    (parseFloat(
      getComputedStyle(visibleSticky[0] || document.getElementById('knowledge-reading')).top,
    ) || 0) +
    visibleSticky.reduce((height, node) => height + node.getBoundingClientRect().height, 0);
  const boundary = (host === window ? 0 : host.getBoundingClientRect().top) + inset;
  // The actual production API excludes closed-details answers and hidden blocks.
  const blocks = reader.readableBlocks(body);
  const stickyLayers = visibleSticky.map((layer) => {
    const layerRect = layer.getBoundingClientRect();
    const style = getComputedStyle(layer);
    return {
      id: layer.id,
      position: style.position,
      topStyle: style.top,
      zIndex: style.zIndex,
      overflowY: style.overflowY,
      clientHeight: layer.clientHeight,
      scrollHeight: layer.scrollHeight,
      rect: {
        top: layerRect.top,
        bottom: layerRect.bottom,
        width: layerRect.width,
        height: layerRect.height,
      },
    };
  });
  const viewportBlocks = blocks
    .map((block, blockIndex) => {
      const blockRect = block.getBoundingClientRect();
      return {
        index: blockIndex,
        tag: block.tagName,
        quote: block.textContent.replace(/\s+/g, ' ').trim().slice(0, 100),
        top: blockRect.top,
        bottom: blockRect.bottom,
      };
    })
    .filter((block) => block.top < window.innerHeight && block.bottom > 0);
  const visiblyReadable = (block) => {
    const bounds = block.getBoundingClientRect();
    const visibleTop = Math.max(bounds.top, boundary);
    const visibleBottom = Math.min(bounds.bottom, window.innerHeight);
    if (visibleBottom <= visibleTop || bounds.width <= 0) return false;
    const hit = document.elementFromPoint(
      bounds.left + Math.min(8, bounds.width / 2),
      (visibleTop + visibleBottom) / 2,
    );
    return hit === block || block.contains(hit);
  };
  const index = saved ? saved.index : blocks.findIndex(visiblyReadable);
  const node = blocks[index];
  const bodyRect = body.getBoundingClientRect();
  const same =
    node &&
    visiblyReadable(node) &&
    (!saved || reader.fingerprint(node.textContent) === saved.fingerprint);
  const rect = node?.getBoundingClientRect();
  return {
    found: Boolean(same),
    index,
    fingerprint: same ? reader.fingerprint(node.textContent) : null,
    quote: same ? node.textContent.replace(/\s+/g, ' ').trim().slice(0, 100) : null,
    tag: node?.tagName || '',
    top: rect?.top,
    bottom: rect?.bottom,
    offset: rect ? rect.top - boundary : null,
    boundary,
    inset,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    estimatedReadingHeight: Math.max(0, window.innerHeight - Math.max(0, boundary)),
    stickyLayers,
    viewportBlocks,
    body: { top: bodyRect.top, bottom: bodyRect.bottom, width: bodyRect.width },
    host:
      host === window
        ? { window: true, scrollTop: window.scrollY }
        : { id: host.id, scrollTop: host.scrollTop },
  };
}

async function settledReading(page, saved = null) {
  let previous;
  let same = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = await page.evaluate(readingGeometry, saved);
    const signature = JSON.stringify([
      value.index,
      value.fingerprint,
      value.top,
      value.offset,
      value.host.scrollTop,
    ]);
    same = signature === previous ? same + 1 : 0;
    if (same >= 3) return value;
    previous = signature;
    // Observe actual scrolling/production restoration; no fake clocks or RAF.
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  }
  throw new Error('Actual reading geometry did not settle');
}

async function settledPanel(page) {
  // Await only the panel's actual finite entrance animation, not a mocked clock.
  await page.evaluate(() =>
    Promise.all(
      document
        .getElementById('knowledge-chat-panel')
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
}

async function axNode(page, selector) {
  const session = await page.createCDPSession();
  try {
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    assert.ok(nodeId, `Actual DOM control exists: ${selector}`);
    const { node } = await session.send('DOM.describeNode', { nodeId });
    const { nodes } = await session.send('Accessibility.getPartialAXTree', {
      backendNodeId: node.backendNodeId,
    });
    const item = nodes.find((value) => value.backendDOMNodeId === node.backendNodeId);
    return {
      selector,
      ignored: item?.ignored,
      role: item?.role?.value,
      name: item?.name?.value,
      properties: item?.properties,
    };
  } finally {
    await session.detach();
  }
}

async function main() {
  // Validate configured dimensions before starting any server or browser.
  const viewports = selectedViewports();
  const preview = createLearningPreview();
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-learning-keyboard-chain-'));
  const report = {
    boundary:
      'Installed headless Chrome, main chain uses native Tab/Shift+Tab/Enter/Escape and PageUp/PageDown only; native wheel is a separately labelled recovery diagnostic after an offscreen Max input. Native local answer selection and unsent Max draft never submit. Production frontend and real router, labelled isolated memory auth/course fixtures. Large is the actual supported 118% typography preset, not browser zoom. No programmatic focus/scroll, AI, grading, private note writes or production DB. No observed real students or screen-reader session.',
    scenes: [],
    findings: [],
    pageErrors: [],
    blockedWrites: [],
    trace: [],
    selectedViewports: viewports,
  };
  const watched = [
    'public/knowledge.js',
    'public/knowledge.html',
    'public/course-structure.js',
    'public/course-structure.css',
    'public/knowledge-workspace.css',
    'public/human-learning-annotations.css',
    'public/learning-reader.js',
  ].map((file) => path.resolve(__dirname, '..', file));
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = watched.map(hash);
  let base = '';
  let browser;
  let scene;
  let phase = '';
  const inspect = async (page, label, { stable = true } = {}) => {
    const observation = await page.evaluate(focusObservation);
    report.trace.push({ scene: scene.name, phase, label, stable, ...observation });
    if (stable && !observation.body && (!observation.visible || observation.hidden))
      report.findings.push({
        id: 'focus-in-hidden-panel',
        scene: scene.name,
        phase,
        label,
        observation,
      });
    return observation;
  };
  const tabTo = async (page, selector, { reverse = false, limit = 140 } = {}) => {
    for (let count = 0; count <= limit; count += 1) {
      if (await page.evaluate((value) => document.activeElement?.matches(value), selector)) {
        // Give production view transition/native focus scroll time to settle.
        // Never scroll or focus the control to make its geometry pass.
        await page
          .waitForFunction(
            () => {
              const node = document.activeElement;
              const rect = node.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
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
        const focused = await inspect(page, `target ${selector}`);
        if (!focused.hitReachable) {
          const screenshot = path.join(
            output,
            `${scene.viewport.width}-covered-${scene.controls.length}.png`,
          );
          await page.screenshot({ path: screenshot });
          report.findings.push({
            id: 'keyboard-target-visually-covered',
            scene: scene.name,
            phase,
            selector,
            observation: focused,
            screenshot,
          });
        }
        const ax = await axNode(page, selector);
        scene.controls.push({ ...ax, tabs: count, reverse, focused });
        assert.equal(ax.ignored, false, `${selector} exists in actual Chrome AX tree`);
        assert.ok(ax.name?.trim(), `${selector} has a real accessible name`);
        return focused;
      }
      if (reverse) {
        await page.keyboard.down('Shift');
        try {
          await page.keyboard.press('Tab');
        } finally {
          await page.keyboard.up('Shift');
        }
      } else await page.keyboard.press('Tab');
      await inspect(page, reverse ? 'Shift+Tab' : 'Tab');
    }
    throw new Error(`Native keyboard cannot reach ${selector} in ${limit} Tabs`);
  };
  const named = async (page, selector, expected) => {
    const ax = await axNode(page, selector);
    scene.names.push(ax);
    assert.equal(ax.ignored, false);
    assert.equal(ax.name, expected);
  };
  const enter = async (page) => {
    await page.keyboard.press('Enter');
    // setChatOpen intentionally hands focus to its input on a later native task.
    // This immediate observation is transition evidence, never a defect verdict.
    await inspect(page, 'after Enter (transition trace)', { stable: false });
  };
  const knowledgeReady = async (page) => {
    await page.waitForFunction(
      () =>
        document.querySelector('#knowledge-body p') &&
        !document.getElementById('knowledge-start-reading').disabled &&
        window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 2,
    );
    await page.evaluate(() => document.fonts.ready);
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
    for (const viewport of viewports) {
      scene = {
        name: `${viewport.width}x${viewport.height}/large`,
        viewport,
        controls: [],
        names: [],
        observations: [],
      };
      const sceneName = scene.name;
      report.scenes.push(scene);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      try {
        await page.setViewport(viewport);
        page.on('pageerror', (error) =>
          report.pageErrors.push({ scene: sceneName, message: error.message }),
        );
        await page.evaluateOnNewDocument(() => {
          localStorage.setItem(
            'free_bbs_typography_preferences',
            JSON.stringify({ fontPreset: 'transistor-lab', typeScale: 'large' }),
          );
        });
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = new URL(request.url());
          if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
            return request.respond({
              status: 403,
              body: 'Isolated keyboard diagnostic: external network disabled',
            });
          if (url.origin === base && request.method() !== 'GET') {
            report.blockedWrites.push({
              scene: sceneName,
              method: request.method(),
              path: url.pathname,
            });
            return request.respond({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Diagnostic forbids all business writes and AI' }),
            });
          }
          return request.continue();
        });
        phase = 'chapter and point directory';
        await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-course-chapter-id="SS-01"]');
        await page.evaluate(() => document.fonts.ready);
        scene.typography = await page.evaluate(() => ({
          current: window.freeBbsTypography.getCurrentPreferences(),
          rootPixels: getComputedStyle(document.documentElement).fontSize,
        }));
        assert.equal(scene.typography.current.typeScale, 'large');
        await tabTo(page, '[data-course-chapter-id="SS-01"]');
        await enter(page);
        await tabTo(page, '[data-course-point-id="SS-01-01"]');
        await enter(page);
        await page.waitForFunction(() =>
          document.querySelector('.course-structure-details h2')?.textContent.includes('卷积'),
        );
        scene.observations.push(await inspect(page, 'point direct relations current content'));
        phase = 'course overview open, close and restore';
        await tabTo(page, '.course-structure-primary');
        await enter(page);
        await page.waitForSelector('#course-knowledge-overview[open]');
        await named(
          page,
          '#course-knowledge-overview button[aria-label="关闭学习概览"]',
          '关闭学习概览',
        );
        await tabTo(page, '#course-knowledge-overview button[aria-label="关闭学习概览"]');
        await enter(page);
        await page.waitForFunction(
          () => !document.getElementById('course-knowledge-overview').open,
        );
        assert.equal(
          await page.evaluate(() => document.activeElement.matches('.course-structure-primary')),
          true,
        );
        await enter(page);
        await page.waitForSelector('#course-knowledge-overview[open]');
        await tabTo(page, '#course-knowledge-overview .knowledge-overview-study');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          page.keyboard.press('Enter'),
        ]);
        await knowledgeReady(page);
        // Stored fixture interaction preference may be open by default. Close
        // by native Escape before testing the unobstructed reading chain.
        if (
          await page.$eval(
            '#knowledge-chat-panel',
            (node) => !node.hidden && !node.classList.contains('hidden'),
          )
        )
          await page.keyboard.press('Escape');
        phase = 'knowledge overview and reading';
        await tabTo(page, '#knowledge-return-overview');
        await named(page, '#knowledge-return-overview', '← 返回概览');
        await enter(page);
        await page.waitForFunction(
          () => !document.getElementById('knowledge-overview').classList.contains('hidden'),
        );
        scene.observations.push(await inspect(page, 'knowledge overview heading focus'));
        await tabTo(page, '#knowledge-start-reading');
        await enter(page);
        await page.waitForFunction(
          () => !document.getElementById('knowledge-reading').classList.contains('hidden'),
        );
        scene.observations.push(await inspect(page, 'reading section focus'));
        await page.screenshot({ path: path.join(output, `${viewport.width}-reading.png`) });
        phase = 'visible annotation toolbar';
        await tabTo(
          page,
          '#learning-annotation-toolbar [data-annotation-action="highlight"][data-annotation-color="yellow"]',
        );
        await named(
          page,
          '#learning-annotation-toolbar [data-annotation-action="highlight"][data-annotation-color="yellow"]',
          '黄色高亮',
        );
        await tabTo(page, '#learning-annotation-toolbar [data-annotation-action="underline"]');
        await tabTo(page, '#learning-annotation-toolbar [data-annotation-action="comment"]');
        // Reach tools but do not activate a saving action or fabricate a selection.
        phase = 'feedback question without submission';
        await tabTo(page, '[data-knowledge-tool="feedback"]', { reverse: true });
        await enter(page);
        await page.waitForFunction(
          () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback',
        );
        scene.observations.push(await inspect(page, 'feedback heading focus'));
        await tabTo(
          page,
          '#learning-quiz-list [data-question-id="SS-01-01-Q-preview"] input[value="A"]',
        );
        await page.keyboard.press('Space');
        assert.equal(
          await page.$eval(
            '#learning-quiz-list [data-question-id="SS-01-01-Q-preview"] input[value="A"]',
            (node) => node.checked,
          ),
          true,
        );
        await tabTo(
          page,
          '#learning-quiz-list [data-question-id="SS-01-01-Q-preview"] button[type="submit"]',
        );
        await page.screenshot({ path: path.join(output, `${viewport.width}-question.png`) });
        phase = 'return content, open and close Max without sending';
        await tabTo(page, '[data-knowledge-tool="content"]', { reverse: true });
        await enter(page);
        await page.waitForFunction(
          () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'content',
        );
        await tabTo(page, '#knowledge-chat-toggle');
        // Keep focus on the real fixed FAB while native paging finds public text.
        // The block used as evidence is not a closed reference answer.
        let readingBeforeMax = await settledReading(page);
        scene.readingPaging = [{ key: 'before native paging', geometry: readingBeforeMax }];
        for (let attempt = 0; !readingBeforeMax.found && attempt < 12; attempt += 1) {
          const key =
            readingBeforeMax.body.bottom <= readingBeforeMax.boundary ? 'PageUp' : 'PageDown';
          await page.keyboard.press(key);
          readingBeforeMax = await settledReading(page);
          scene.readingPaging.push({ key, geometry: readingBeforeMax });
        }
        scene.readingBeforeMax = readingBeforeMax;
        assert.equal(
          readingBeforeMax.found,
          true,
          'A real public reading block is visible before opening Max',
        );
        await enter(page);
        await page.waitForFunction(() => document.activeElement.id === 'knowledge-chat-input');
        await settledPanel(page);
        await tabTo(page, '#knowledge-chat-input');
        const openedMax = await page.evaluate(maxGeometry);
        openedMax.screenshot = path.join(output, `${viewport.width}-Max-open-focused-input.png`);
        await page.screenshot({ path: openedMax.screenshot });
        scene.maxOpened = openedMax;
        if (
          viewport.width <= 920 &&
          Math.abs(openedMax.body.rect.width - readingBeforeMax.body.width) > 2
        )
          report.findings.push({
            id: 'overlay-shrinks-reading-column',
            scene: scene.name,
            phase,
            beforeWidth: readingBeforeMax.body.width,
            openedWidth: openedMax.body.rect.width,
            columns: openedMax.workbench.gridTemplateColumns,
          });
        // Explicit diagnostic recovery only, after the pure keyboard chain.
        // Native wheel is allowed by this probe's task; never scroll DOM in JS.
        if (!openedMax.inputHitReachable) {
          scene.nativeWheelRecovery = [];
          await page.mouse.move(
            Math.round(viewport.width * 0.65),
            Math.round(viewport.height * 0.55),
          );
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const previous = await page.evaluate(maxGeometry);
            if (previous.inputHitReachable) break;
            const deltaY =
              previous.input.rect.top < 0
                ? -Math.round(viewport.height * 0.8)
                : Math.round(viewport.height * 0.8);
            await page.mouse.wheel({ deltaY });
            await page
              .waitForFunction(
                (top) =>
                  document.getElementById('knowledge-chat-input').getBoundingClientRect().top !==
                  top,
                { timeout: 500 },
                previous.input.rect.top,
              )
              .catch(() => {});
            scene.nativeWheelRecovery.push({ deltaY, ...(await page.evaluate(maxGeometry)) });
          }
          scene.maxAfterRecovery = await page.evaluate(maxGeometry);
          scene.maxAfterRecovery.screenshot = path.join(
            output,
            `${viewport.width}-Max-native-wheel-recovery.png`,
          );
          await page.screenshot({ path: scene.maxAfterRecovery.screenshot });
        }
        const maxDraft = `独立键盘诊断草稿 ${viewport.width}（不发送）`;
        await page.keyboard.type(maxDraft);
        assert.equal(await page.$eval('#knowledge-chat-input', (node) => node.value), maxDraft);
        await tabTo(page, '#knowledge-chat-close', { reverse: true });
        await named(page, '#knowledge-chat-close', '关闭课程学习面板');
        await page.screenshot({
          path: path.join(output, `${viewport.width}-Max-close-focused.png`),
        });
        await enter(page);
        await page.waitForFunction(() =>
          document.getElementById('knowledge-chat-panel').classList.contains('hidden'),
        );
        const closed = await inspect(page, 'closed Max focus');
        scene.observations.push(closed);
        assert.equal(closed.id, 'knowledge-chat-toggle');
        assert.equal(closed.visible, true);
        assert.equal(
          await page.$eval('#knowledge-reading', (node) => !node.classList.contains('hidden')),
          true,
        );
        const afterCloseReading = await settledReading(page, readingBeforeMax);
        scene.readingAfterClose = afterCloseReading;
        if (!scene.nativeWheelRecovery?.length) {
          assert.equal(
            afterCloseReading.found,
            true,
            'The same public reading block survives close',
          );
          assert.ok(
            Math.abs(afterCloseReading.offset - readingBeforeMax.offset) <= 2,
            `Close restores the real paragraph offset: ${readingBeforeMax.offset} -> ${afterCloseReading.offset}`,
          );
          scene.readingPositionPreserved = true;
        } else scene.readingPositionSkippedBecauseUserWheeled = true;
        assert.equal(await page.$eval('#knowledge-chat-input', (node) => node.value), maxDraft);
        // Reopen by the still-focused FAB; validate live draft and native Escape.
        const beforeReopen = await settledReading(page);
        await enter(page);
        await page.waitForFunction(() => document.activeElement.id === 'knowledge-chat-input');
        await settledPanel(page);
        await tabTo(page, '#knowledge-chat-input');
        assert.equal(await page.$eval('#knowledge-chat-input', (node) => node.value), maxDraft);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() =>
          document.getElementById('knowledge-chat-panel').classList.contains('hidden'),
        );
        const escapeFocus = await inspect(page, 'native Escape closed Max focus');
        assert.equal(escapeFocus.id, 'knowledge-chat-toggle');
        const afterEscape = await settledReading(page, beforeReopen);
        assert.equal(afterEscape.found, true);
        assert.ok(Math.abs(afterEscape.offset - beforeReopen.offset) <= 2);
        scene.maxDraftPreserved = true;
        scene.readingAfterEscape = afterEscape;
        await named(page, '#knowledge-course-link', '返回课程目录');
        await tabTo(page, '#knowledge-return-overview', { reverse: true });
        await page.screenshot({ path: path.join(output, `${viewport.width}-after-Max-close.png`) });
        // The answer is a local draft, not a formal attempt or grading evidence.
        phase = 'local answer draft after reading and Max';
        await tabTo(page, '[data-knowledge-tool="feedback"]', { reverse: true });
        await enter(page);
        await page.waitForFunction(
          () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'feedback',
        );
        assert.equal(
          await page.$eval(
            '#learning-quiz-list [data-question-id="SS-01-01-Q-preview"] input[value="A"]',
            (node) => node.checked,
          ),
          true,
        );
        scene.localAnswerDraftPreserved = true;
        scene.completed = true;
      } catch (error) {
        scene.error = error.stack || String(error);
        scene.failureReading = await page.evaluate(readingGeometry).catch(() => null);
        await page
          .screenshot({ path: path.join(output, `${viewport.width}-failure.png`) })
          .catch(() => {});
        report.findings.push({
          id: 'keyboard-chain-stopped',
          scene: scene.name,
          phase,
          error: scene.error,
        });
      } finally {
        await context.close();
      }
    }
    assert.equal(preview.requests.length, 0);
    assert.equal(preview.store.rows.length, 0);
    assert.equal(preview.assessmentStore.rows.length, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    assert.equal(report.blockedWrites.length, 0);
    assert.equal(report.scenes.length, viewports.length);
    assert.equal(
      report.scenes.every((item) => item.completed),
      true,
    );
  } catch (error) {
    report.error = error.stack || String(error);
    report.portSelection ||= error.portSelection;
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    report.sourceUnchangedDuringRun = watched.every((file, index) => hash(file) === before[index]);
    if (!report.sourceUnchangedDuringRun) {
      report.findings.push({ id: 'source-changed-during-run', files: watched });
      process.exitCode = 1;
    }
    report.cleanup = {
      browserClosed: !browser || !browser.connected,
      serverClosed: !preview.server.listening,
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          output,
          scenes: report.scenes.map(({ name, completed, error }) => ({ name, completed, error })),
          findings: report.findings,
          pageErrors: report.pageErrors,
          blockedWrites: report.blockedWrites,
          portSelection: report.portSelection,
          cleanup: report.cleanup,
        },
        null,
        2,
      ),
    );
    if ((report.findings.length || report.pageErrors.length) && !process.exitCode)
      process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
