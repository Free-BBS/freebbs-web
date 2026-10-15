// Diagnostic only: real installed Chrome, native input and HTTP SVG responses.
// Authored prose, identities and revisions are explicitly isolated memory fixtures.
// No RAF/font mocks, AI calls, annotation writes or production database are used.
/* eslint-disable no-param-reassign -- Scene callbacks fill only the explicit diagnostic report. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { documentVersion } = require('../backend/learning-workspace');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const LABEL = '迟到图片阅读夹具（非正式课程材料）';
const POINT = 'SS-01-01';
const IMAGE_PREFIX = '/__late-image-fixture/';
const sourceFiles = [
  'public/learning-reader.js',
  'public/knowledge.js',
  'public/knowledge-workspace.js',
];
const sourceHashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(__dirname, '..', file)))
        .digest('hex'),
    ]),
  );
const paragraph = (number) =>
  `公开段落 ${number}：本地阅读定位标识 ${number}。这是明确合成的长正文，不是课程组发布的知识或研究结论。读者可以查阅条件、复习概念或直接离开，不必调用人工智能，也不产生掌握或学习时长证据。迟到的图片只能改变布局，不能替读者选择新的阅读任务。`;
function markdown(version = 'a') {
  const parts = [`# ${LABEL}`];
  if (version === 'b') parts.push('修订版说明：此段是本地夹具中新增的公开说明。');
  for (let index = 1; index <= 96; index += 1) {
    parts.push(paragraph(index));
    if ([12, 28, 42, 66].includes(index))
      parts.push(`![${LABEL} 图 ${index}](${IMAGE_PREFIX}${version}-${index}.svg)`);
  }
  parts.splice(
    6,
    0,
    '<details><summary>默认收起的夹具解析</summary><p>隐藏答案不是阅读定位目标。</p></details>',
  );
  return parts.join('\n\n');
}
function node(version = 'a') {
  const body = markdown(version);
  return {
    id: POINT,
    title: LABEL,
    summary: LABEL,
    markdown: body,
    hasDocument: true,
    documentVersion: documentVersion({ document_markdown: body }),
    sections: {
      basicInfoMarkdown: '课程名称：隔离夹具\n章节/单元：本地章节\n参与同学：本地测试',
      applicationsMarkdown: LABEL,
      knowledgeMarkdown: body,
    },
  };
}
const pause = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
async function until(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  throw new Error(`Missing diagnostic precondition: ${label}`);
}
async function frames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}
async function idle(page) {
  const deadline = Date.now() + 5000;
  let previous;
  let stable = Date.now();
  while (Date.now() < deadline) {
    const y = await page.evaluate(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      return host === window ? window.scrollY : host.scrollTop;
    });
    if (y !== previous) {
      previous = y;
      stable = Date.now();
    }
    if (Date.now() - stable >= 250) return;
    await pause(25);
  }
  throw new Error('Native scroll animation did not settle');
}
async function metrics(page, anchor = null) {
  return page.evaluate((saved) => {
    const api = window.FreeBbsLearningReader;
    const body = document.getElementById('knowledge-body');
    const host = api.getScrollHost();
    const bounds =
      host === window ? { top: 0, bottom: window.innerHeight } : host.getBoundingClientRect();
    const sticky = ['knowledge-history', 'learning-annotation-toolbar']
      .map((id) => document.getElementById(id))
      .filter((item) => item && !item.hidden && !item.classList.contains('hidden'));
    const stickyTop =
      parseFloat(getComputedStyle(sticky[0] || document.getElementById('knowledge-reading')).top) ||
      0;
    const boundary =
      bounds.top +
      16 +
      stickyTop +
      sticky.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    // Never infer closed-details visibility from nonzero Chrome geometry.
    const blocks = api
      .readableBlocks(body)
      .filter((item) => !item.closest('details:not([open]),[hidden],.hidden'));
    const current = blocks.find((item) => item.getBoundingClientRect().bottom > boundary);
    const resolved = saved
      ? api.resolve(
          saved,
          blocks,
          window.freeBbsKnowledge.getLearningContext().node.documentVersion,
        )
      : null;
    const target = resolved?.block || current;
    const rect = target?.getBoundingClientRect();
    const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
    return {
      text: target?.textContent.replace(/\s+/g, ' ').trim(),
      currentText: current?.textContent.replace(/\s+/g, ' ').trim(),
      currentNumber: Number(current?.textContent.match(/^公开段落 (\d+)：/)?.[1]) || null,
      offset: rect ? rect.top - boundary : null,
      visible: Boolean(rect && rect.bottom > boundary && rect.top < bounds.bottom),
      boundary,
      viewportBottom: bounds.bottom,
      scrollTop: host === window ? window.scrollY : host.scrollTop,
      scrollHost: host === window ? 'window' : `${host.tagName}.${host.className}`,
      nativeOverflowAnchor: getComputedStyle(host === window ? document.documentElement : host)
        .overflowAnchor,
      bookmark: JSON.parse(localStorage.getItem(key) || '{}')['["signals","SS-01-01"]'] || null,
      tool: document.querySelector('[data-knowledge-page]').dataset.learningTool,
      readingVisible:
        !document.getElementById('knowledge-reading').hidden &&
        !document.getElementById('knowledge-reading').classList.contains('hidden'),
      version: window.freeBbsKnowledge.getLearningContext().node.documentVersion,
      fontsStatus: document.fonts.status,
      fontReadyObservation: window.lateImageFontReady,
      images: [...body.querySelectorAll('img')].map((image) => ({
        src: new URL(image.src).pathname,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        renderedHeight: image.getBoundingClientRect().height,
        widthAttribute: image.getAttribute('width'),
        heightAttribute: image.getAttribute('height'),
        loading: image.loading,
      })),
    };
  }, anchor);
}
async function wheel(page, deltaY) {
  const hit = await page.evaluate(() => {
    const body = document.getElementById('knowledge-body');
    const rect = body.getBoundingClientRect();
    const x = Math.max(50, Math.min(window.innerWidth - 50, rect.left + rect.width * 0.65));
    const y = 720;
    const target = document.elementFromPoint(x, y);
    return {
      x,
      y,
      usable: Boolean(
        target &&
        window.FreeBbsLearningReader.scrollHost(target) ===
          window.FreeBbsLearningReader.getScrollHost(),
      ),
    };
  });
  assert.ok(hit.usable, `Native wheel must target the reader scroll host: ${JSON.stringify(hit)}`);
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.wheel({ deltaY });
  await idle(page);
}
async function click(page, selector) {
  const point = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      usable:
        x > 0 &&
        x < window.innerWidth &&
        y > 0 &&
        y < window.innerHeight &&
        (hit === element || element.contains(hit)),
    };
  });
  assert.ok(point.usable, `Real pointer can reach ${selector}: ${JSON.stringify(point)}`);
  await page.mouse.click(point.x, point.y);
}
async function selectVisibleText(page) {
  const geometry = await page.evaluate(() => {
    const paragraphElement = [...document.querySelectorAll('#knowledge-body p')].find((item) => {
      const rect = item.getBoundingClientRect();
      return (
        !item.closest('details:not([open]),[hidden],.hidden') &&
        /^公开段落/.test(item.textContent) &&
        rect.top > 450 &&
        rect.bottom < window.innerHeight - 30
      );
    });
    if (!paragraphElement) return null;
    const text = paragraphElement.firstChild;
    const end = text.data.indexOf('。') + 1;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, end);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + 0.3,
      end: rect.right - 0.3,
      y: rect.top + rect.height / 2,
      expected: text.data.slice(0, end),
    };
  });
  assert.ok(geometry, 'An actual public paragraph is visible and selectable');
  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.end, geometry.y, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection().toString());
  assert.equal(selected, geometry.expected);
  // Native click clears the selection without creating a private annotation.
  await page.mouse.click(geometry.end + 10, geometry.y);
  return selected;
}
async function main() {
  const mapNodes = [node()];
  const contexts = [
    {
      slug: 'signals',
      course_id: 1,
      course_name: LABEL,
      node_id: POINT,
      title: LABEL,
      document_markdown: mapNodes[0].markdown,
      knowledge_markdown: mapNodes[0].markdown,
      is_active: 1,
    },
  ];
  const preview = createLearningPreview({ mapNodes, mapEdges: [], contextRows: contexts });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-reader-late-images-'));
  const report = {
    boundary:
      'Real installed Chrome with native wheel/PageDown/pointer selection. Explicit synthetic long prose and memory identity; SVGs are normal same-origin HTTP responses with no image element width/height. The revision event is an explicitly labelled fixture driver, not an authoring permission claim. One overflow-anchor:none diagnostic control is NOT production behavior. No RAF/font timing mocks or AI/DB/learning-outcome claims.',
    output,
    portSelection: null,
    sourceHashesBefore: sourceHashes(),
    scenes: [],
    findings: [],
    pageErrors: [],
    imageRequests: [],
    writes: [],
    aiRequests: [],
    screenshots: [],
    browserClosed: false,
    serverClosed: false,
  };
  let base = '';
  let browser;
  let activePage;
  let activeGate;
  // Add an isolated HTTP fixture route without changing the preview or production source.
  const originalHandler = preview.server.listeners('request')[0];
  preview.server.removeListener('request', originalHandler);
  preview.server.on('request', (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(IMAGE_PREFIX)) return originalHandler(request, response);
    if (request.headers.host !== `127.0.0.1:${preview.server.address()?.port}`)
      return response.writeHead(403).end();
    const record = {
      path: url.pathname,
      requestedAt: Date.now(),
      releasedAt: null,
      canceled: false,
      held: false,
      scene: activeGate?.name || 'seed',
    };
    report.imageRequests.push(record);
    const send = () => {
      record.releasedAt = Date.now();
      record.delayMs = record.releasedAt - record.requestedAt;
      if (response.destroyed) {
        record.canceled = true;
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      response.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760"><rect width="1000" height="760" fill="#e6f2ef"/><path d="M80 630L400 160L720 500L920 100" fill="none" stroke="#167d8d" stroke-width="18"/><text x="60" y="70" font-size="30">LOCAL DELAYED IMAGE FIXTURE ${url.pathname.slice(IMAGE_PREFIX.length)}</text></svg>`,
      );
    };
    if (activeGate?.enabled && /\/a-/.test(url.pathname)) {
      record.held = true;
      activeGate.pending.push({ send, record });
      return undefined;
    }
    send();
    return undefined;
  });
  async function ready(page) {
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningReader?.getScrollHost &&
        /^公开段落/.test(document.querySelector('#knowledge-body p')?.textContent),
    );
    // A real fonts.ready promise can remain unsettled while held SVGs keep the
    // document loading. Observe it, never replace it or deadlock image release.
    await page.evaluate(() => {
      window.lateImageFontReady = { settled: false, observedAt: performance.now() };
      document.fonts.ready.then(() => {
        window.lateImageFontReady.settled = true;
        window.lateImageFontReady.settledAt = performance.now();
      });
    });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await frames(page);
    await pause(250);
  }
  const screenshot = async (page, name) => {
    const filename = path.join(output, `${name}.png`);
    // Do not wait for a fonts.ready promise blocked by this HTTP image fixture.
    await page.screenshot({ path: filename, waitForFonts: false });
    report.screenshots.push(filename);
  };
  async function run(name, action) {
    const result = { name, passed: false };
    report.scenes.push(result);
    mapNodes[0] = node();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    activePage = page;
    const gate = { name, enabled: false, pending: [] };
    activeGate = gate;
    const release = async () => {
      gate.enabled = false;
      gate.pending.splice(0).forEach(({ send }) => send());
      await frames(page);
      await pause(350);
      await idle(page);
    };
    try {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.setCacheEnabled(false);
      page.on('pageerror', (error) => report.pageErrors.push(error.message));
      await page.evaluateOnNewDocument(() => {
        window.lateImageTrace = [];
        for (const type of ['wheel', 'keydown', 'pointerdown', 'resize', 'scroll'])
          window.addEventListener(
            type,
            (event) =>
              window.lateImageTrace.push({
                type,
                key: event.key,
                deltaY: event.deltaY,
                trusted: event.isTrusted,
                time: performance.now(),
              }),
            { capture: true, passive: true },
          );
      });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
          return request.respond({
            status: 403,
            body: 'External requests disabled by local diagnostic',
          });
        if (url.pathname.includes('/course-upload/public/'))
          return request.respond({
            status: 200,
            contentType: 'application/json',
            body: '{"files":[]}',
          });
        if (url.pathname.startsWith('/api/') && request.method() !== 'GET')
          report.writes.push({ method: request.method(), path: url.pathname });
        if (url.pathname.startsWith('/api/ai/')) report.aiRequests.push(url.pathname);
        return request.continue();
      });
      await page.goto(`${base}/knowledge?course=signals&point=${POINT}&view=reading&as=student`, {
        waitUntil: 'domcontentloaded',
      });
      result.stage = 'seed-prose';
      console.log(`STAGE ${name}: seed-prose`);
      await ready(page);
      for (let step = 0; step < 30; step += 1) {
        const current = await metrics(page);
        if (current.currentNumber >= 46 && current.currentNumber <= 58) break;
        assert.ok(
          !current.currentNumber || current.currentNumber < 58,
          'Native scrolling must not overshoot the middle prose',
        );
        await wheel(page, 900);
      }
      result.seedSelection = await selectVisibleText(page);
      await wheel(page, 5);
      await pause(300);
      result.seed = await metrics(page);
      assert.ok(
        result.seed.currentNumber >= 46 && result.seed.currentNumber <= 58,
        JSON.stringify(result.seed),
      );
      assert.ok(
        result.seed.bookmark?.index > 30,
        'Save a genuine debounced semantic middle bookmark',
      );
      assert.ok(
        result.seed.images
          .filter((image) => /a-(12|28|42)\.svg$/.test(image.src))
          .every((image) => image.complete && image.naturalWidth === 1000),
      );
      const saved = result.seed.bookmark;
      gate.enabled = true;
      result.stage = 'reload-with-held-images';
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      await until(
        () => gate.pending.length >= 3,
        'Three real delayed HTTP images above the middle paragraph',
      );
      result.before = await metrics(page, saved);
      assert.equal(
        result.before.fontsStatus,
        'loaded',
        'Fonts finish normally before image release',
      );
      assert.ok(
        result.before.images.every(
          (image) => image.widthAttribute === null && image.heightAttribute === null,
        ),
      );
      assert.ok(
        Math.abs(result.before.offset - saved.offset) <= 3,
        `Initial semantic restore precedes late HTTP images: ${JSON.stringify(result.before)}`,
      );
      result.stage = 'late-image-action';
      console.log(`STAGE ${name}: late-image-action`);
      await action({ page, result, saved, release });
      result.trace = await page.evaluate(() => window.lateImageTrace);
      assert.ok(
        !result.trace.some((event) => event.type === 'resize'),
        'No unrelated window resize may explain the image result',
      );
      result.passed = true;
      result.stage = 'complete';
      console.log(`PASS ${name}`);
    } catch (error) {
      result.failure = error.stack || String(error);
      result.snapshot = await metrics(page).catch(() => null);
      result.trace = await page.evaluate(() => window.lateImageTrace).catch(() => null);
      await screenshot(page, `${name}-failure`).catch(() => {});
      console.log(`FAIL ${name}: ${error.message}`);
    } finally {
      await release().catch(() => {});
      await context.close();
      activePage = null;
    }
  }
  try {
    report.portSelection = await listenAllowedLoopback(preview.server, { diagnostic: console.log });
    base = `http://127.0.0.1:${report.portSelection.port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    await run('no-input-native-anchoring', async ({ page, result, saved, release }) => {
      await pause(700);
      result.held = await metrics(page, saved);
      await release();
      result.after = await metrics(page, saved);
      result.semanticDrift = result.after.offset - result.before.offset;
      result.nativeScrollAdjustment = result.after.scrollTop - result.before.scrollTop;
      if (!result.after.visible || Math.abs(result.semanticDrift) > 40)
        report.findings.push({
          id: 'late-image-loses-restored-paragraph-without-input',
          scene: result.name,
          before: result.before,
          after: result.after,
        });
      await screenshot(page, result.name);
    });
    for (const input of ['wheel', 'PageDown'])
      await run(`reader-${input}-before-image`, async ({ page, result, saved, release }) => {
        if (input === 'wheel') await wheel(page, 420);
        else {
          // Focus the actual noninteractive prose with a native click, then PageDown.
          const point = await page.$eval('#knowledge-body', (item) => ({
            x: item.getBoundingClientRect().left + 80,
            y: 760,
          }));
          await page.mouse.click(point.x, point.y);
          await page.keyboard.press('PageDown');
          await idle(page);
        }
        await pause(250);
        result.userDestination = await metrics(page);
        assert.notEqual(
          result.userDestination.bookmark.fingerprint,
          saved.fingerprint,
          'Actual input advances to another paragraph before image release',
        );
        await release();
        result.after = await metrics(page, result.userDestination.bookmark);
        result.oldAnchorAfter = await metrics(page, saved);
        result.semanticDrift = result.after.offset - result.userDestination.offset;
        if (!result.after.visible || Math.abs(result.semanticDrift) > 40)
          report.findings.push({
            id: 'late-image-loses-user-chosen-paragraph',
            scene: result.name,
            userDestination: result.userDestination,
            after: result.after,
          });
        await screenshot(page, result.name);
      });
    await run('tool-switch-before-image', async ({ page, result, saved, release }) => {
      await click(page, '[data-knowledge-tool="feedback"]');
      await frames(page);
      // The native focus/navigation scroll can still be animating after two RAFs.
      // Hold images until the user's tool-switch destination has really settled.
      await idle(page);
      await pause(250);
      result.inTool = await metrics(page, saved);
      assert.equal(result.inTool.tool, 'feedback');
      assert.equal(result.inTool.readingVisible, false);
      await release();
      result.afterReleaseInTool = await metrics(page, saved);
      assert.equal(result.afterReleaseInTool.tool, 'feedback');
      assert.equal(result.afterReleaseInTool.readingVisible, false);
      assert.ok(
        Math.abs(result.afterReleaseInTool.scrollTop - result.inTool.scrollTop) <= 3,
        'Old image completion does not scroll the active feedback tool',
      );
      await click(page, '[data-knowledge-tool="content"]');
      await frames(page);
      await idle(page);
      result.returned = await metrics(page, saved);
      assert.ok(
        result.returned.visible && Math.abs(result.returned.offset - saved.offset) <= 3,
        'Explicit return to prose restores its semantic bookmark after images load',
      );
      await screenshot(page, result.name);
    });
    await run('document-revision-before-old-image', async ({ page, result, saved, release }) => {
      const revised = node('b');
      result.revisionDriver =
        'Explicit local fixture document-saved event; not an authoring permission or server-save claim';
      await page.evaluate(
        (updated) =>
          document
            .querySelector('[data-knowledge-page]')
            .dispatchEvent(
              new CustomEvent('knowledge:document-saved', { detail: { node: updated } }),
            ),
        revised,
      );
      await frames(page);
      await pause(350);
      result.revisedBeforeOldRelease = await metrics(page, saved);
      await release();
      result.after = await metrics(page, saved);
      assert.equal(result.after.version, revised.documentVersion);
      assert.notEqual(result.after.version, result.before.version);
      assert.ok(
        result.after.images.every((image) => /\/b-/.test(image.src)),
        'Old pending image elements are not attached to the revised prose',
      );
      assert.ok(
        result.after.visible,
        'The unique unchanged public paragraph remains recognizable across the fixture revision',
      );
      await screenshot(page, result.name);
    });
    await run('diagnostic-control-native-anchoring-disabled', async ({ page, result, release }) => {
      result.controlBoundary =
        'One explicit test-only overflow-anchor:none on the real host; not a production recommendation or failure';
      await page.evaluate(() => {
        const host = window.FreeBbsLearningReader.getScrollHost();
        (host === window ? document.documentElement : host).style.overflowAnchor = 'none';
      });
      // Native wheel both selects a new reading destination and makes the
      // production fonts-ready guard reject the old restore. Otherwise that
      // guard can compensate for disabled anchoring and confound this control.
      await wheel(page, 420);
      await pause(250);
      result.controlBefore = await metrics(page);
      await release();
      result.after = await metrics(page, result.controlBefore.bookmark);
      result.semanticDrift = result.after.offset - result.controlBefore.offset;
      result.nativeScrollAdjustment = result.after.scrollTop - result.controlBefore.scrollTop;
      assert.equal(result.after.nativeOverflowAnchor, 'none');
      assert.ok(
        Math.abs(result.nativeScrollAdjustment) <= 3 && result.semanticDrift > 1000,
        'Only the explicitly disabled-anchoring control loses the new paragraph when images add height',
      );
      await screenshot(page, result.name);
    });
    assert.equal(preview.requests.length, 0);
    assert.equal(preview.assessmentStore.rows.length, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    assert.deepEqual(report.aiRequests, []);
    assert.deepEqual(report.writes, []);
    assert.deepEqual(report.pageErrors, []);
    report.success = report.scenes.every((scene) => scene.passed) && report.findings.length === 0;
  } catch (error) {
    report.portSelection ||= error.portSelection || null;
    report.success = false;
    report.failure = {
      message: error.message,
      stack: error.stack,
      portSelection: report.portSelection,
    };
    if (activePage) await screenshot(activePage, 'failure').catch(() => {});
  } finally {
    activeGate?.pending.splice(0).forEach(({ send }) => send());
    if (browser) {
      await browser.close();
      report.browserClosed = true;
    }
    if (preview.server.listening) {
      preview.server.closeAllConnections?.();
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    }
    report.serverClosed = !preview.server.listening;
    report.sourceHashesAfter = sourceHashes();
    report.productionSourcesUnchanged =
      JSON.stringify(report.sourceHashesAfter) === JSON.stringify(report.sourceHashesBefore);
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          output,
          portSelection: report.portSelection,
          success: report.success,
          findings: report.findings,
          scenes: report.scenes.map((scene) => ({
            name: scene.name,
            passed: scene.passed,
            semanticDrift: scene.semanticDrift,
            nativeScrollAdjustment: scene.nativeScrollAdjustment,
            failure: scene.failure,
          })),
          pageErrors: report.pageErrors,
          browserClosed: report.browserClosed,
          serverClosed: report.serverClosed,
          productionSourcesUnchanged: report.productionSourcesUnchanged,
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
