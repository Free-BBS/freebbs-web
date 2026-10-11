// UI evidence only. Real authoring examples and explicit DOM stress fixtures are reported separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const address = process.env.LEARNING_PREVIEW_URL || process.argv[2];
  assert.ok(address, 'Use an already running isolated preview; this script never starts a server');
  const base = new URL(address);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-accessibility-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Existing local preview, real long authoring examples, memory-only grading; no production account/data or real AI.',
    stressBoundary:
      'Table/code/wide formula blocks below are explicit rendered Markdown fixtures. 200% text stress doubles computed root font size, not browser zoom or full WCAG certification.',
    checks: [],
    matrix: [],
    pageErrors: [],
    requests: [],
    screenshots: [],
  };
  const record = (scene, name, pass, details = {}) =>
    report.checks.push({ scene, name, pass: Boolean(pass), ...details });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
      return request.respond({
        status: 403,
        body: 'External services disabled for local UI acceptance',
      });
    if (url.pathname.startsWith('/api/'))
      report.requests.push({ method: request.method(), path: url.pathname });
    return request.continue();
  });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  const closeMax = async () => {
    if (
      await page.$eval(
        '#knowledge-chat-panel',
        (item) => !item.hidden && !item.classList.contains('hidden'),
      )
    )
      await page.click('#knowledge-chat-close');
    await settle();
  };
  const inspect = (selector) =>
    page.$eval(selector, (item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      const x = Math.min(window.innerWidth - 1, box.left + box.width / 2);
      const tableBlock =
        item.tagName === 'TABLE' || item.classList.contains('discussion-table-scroll');
      const stickyBoundary = tableBlock
        ? Math.max(
            0,
            ...['knowledge-history', 'learning-annotation-toolbar'].map((id) => {
              const sticky = document.getElementById(id);
              return sticky && !sticky.hidden && !sticky.classList.contains('hidden')
                ? sticky.getBoundingClientRect().bottom
                : 0;
            }),
          )
        : 0;
      // An oversized scroll block may be taller than the viewport. Its focused
      // visible portion must be hit-testable below, not underneath, sticky UI.
      const visibleTop = Math.max(0, box.top, stickyBoundary);
      const visibleBottom = Math.min(window.innerHeight, box.bottom);
      const y = tableBlock
        ? (visibleTop + visibleBottom) / 2
        : Math.min(window.innerHeight - 1, box.top + box.height / 2);
      const hit = x >= 0 && y >= 0 ? document.elementFromPoint(x, y) : null;
      return {
        width: box.width,
        height: box.height,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        viewport:
          (tableBlock
            ? visibleBottom - visibleTop >= 32
            : box.top >= 0 && box.bottom <= window.innerHeight) &&
          box.left >= 0 &&
          box.right <= window.innerWidth,
        wholeBoxInViewport: box.top >= 0 && box.bottom <= window.innerHeight,
        hit: Boolean(hit && (item === hit || item.contains(hit))),
        fontSize: Number.parseFloat(style.fontSize),
        color: style.color,
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        text: item.textContent.trim().slice(0, 180),
      };
    });
  const show = async (selector) => {
    await page.$eval(selector, (item) =>
      item.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
    );
    await settle();
    return inspect(selector);
  };
  const tabTo = async (selector, scene) => {
    const anchor = await page.evaluate((targetSelector) => {
      const requested = document.querySelector(targetSelector);
      const radioPeers =
        requested.type === 'radio'
          ? [...requested.form.querySelectorAll('input[type="radio"]')].filter(
              (item) => item.name === requested.name,
            )
          : [];
      const target = radioPeers.find((item) => item.checked) || requested;
      target.dataset.qaTabTarget = 'true';
      const items = [
        ...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]'),
      ]
        .filter(
          (item) =>
            item.tabIndex >= 0 &&
            !item.disabled &&
            item.getClientRects().length &&
            !item.closest('[hidden],.hidden') &&
            getComputedStyle(item).visibility !== 'hidden',
        )
        .filter((item) => {
          // Native radio groups have one Tab stop, their checked member or first option.
          if (item.type !== 'radio') return true;
          const group = [...item.form.querySelectorAll('input[type="radio"]')].filter(
            (peer) => peer.name === item.name,
          );
          return item === (group.find((peer) => peer.checked) || group[0]);
        });
      const previous = items[items.indexOf(target) - 1];
      if (!previous) return false;
      previous.dataset.qaTabAnchor = 'true';
      previous.focus();
      return true;
    }, selector);
    if (!anchor) {
      record(scene, 'tab-predecessor-exists', false, { selector });
      return false;
    }
    await page.keyboard.press('Tab');
    await settle();
    const effectiveSelector = '[data-qa-tab-target="true"]';
    // Native keyboard focus follows the site's smooth scroll behavior. Sample the
    // settled viewport, not the first animation frame hundreds of pixels away.
    await page
      .waitForFunction(
        (targetSelector) => {
          const box = document.querySelector(targetSelector)?.getBoundingClientRect();
          return (
            box &&
            (document.querySelector(targetSelector).tagName === 'TABLE' ||
            document.querySelector(targetSelector).classList.contains('discussion-table-scroll')
              ? Math.min(box.bottom, window.innerHeight) - Math.max(0, box.top) >= 32
              : box.top >= 0 && box.bottom <= window.innerHeight)
          );
        },
        { timeout: 2500 },
        effectiveSelector,
      )
      .catch(() => {});
    const active = await page.evaluate(
      (targetSelector) => document.activeElement === document.querySelector(targetSelector),
      effectiveSelector,
    );
    const geometry = await inspect(effectiveSelector);
    record(scene, 'real-Tab-reaches-visible-control', active && geometry.viewport && geometry.hit, {
      selector,
      active,
      geometry,
      radioGroupMember: await page.$eval(effectiveSelector, (item) =>
        item.type === 'radio' ? item.value : null,
      ),
    });
    await page.evaluate(() => {
      document.querySelector('[data-qa-tab-anchor]')?.removeAttribute('data-qa-tab-anchor');
      document.querySelector('[data-qa-tab-target]')?.removeAttribute('data-qa-tab-target');
    });
    return active;
  };
  const screenshot = async (name) => {
    const target = path.join(output, name);
    await page.screenshot({ path: target });
    report.screenshots.push(target);
  };
  const reading = async (scene) => {
    await page.click('[data-knowledge-tool="content"]');
    await closeMax();
    await page.evaluate(() => {
      const paragraphs = [...document.querySelectorAll('#knowledge-body > p')];
      paragraphs[Math.floor(paragraphs.length * 0.6)]?.scrollIntoView({
        block: 'center',
        behavior: 'instant',
      });
    });
    await settle();
    const data = await page.evaluate(() => {
      const body = document.getElementById('knowledge-body');
      const origin = document.getElementById('knowledge-history-prose');
      const history = document.getElementById('knowledge-history');
      const toolbar = document.getElementById('learning-annotation-toolbar');
      const host = window.FreeBbsLearningReader.getScrollHost();
      const box =
        host === window ? { top: 0, bottom: window.innerHeight } : host.getBoundingClientRect();
      const boundary = Math.max(
        box.top,
        history.getBoundingClientRect().bottom,
        toolbar.getBoundingClientRect().bottom,
      );
      const historyBox = history.getBoundingClientRect();
      const toolbarBox = toolbar.getBoundingClientRect();
      const toggle = document.getElementById('knowledge-history-toggle');
      const toggleBox = toggle.getBoundingClientRect();
      const toggleHit = document.elementFromPoint(
        toggleBox.left + toggleBox.width / 2,
        toggleBox.top + toggleBox.height / 2,
      );
      const candidates = [...body.querySelectorAll('p')].map((item) =>
        item.getBoundingClientRect(),
      );
      return {
        root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        body: Number.parseFloat(getComputedStyle(body).fontSize),
        paragraph: Number.parseFloat(getComputedStyle(body.querySelector('p')).fontSize),
        origin: Number.parseFloat(getComputedStyle(origin).fontSize),
        originParagraph: origin.querySelector('p')
          ? Number.parseFloat(getComputedStyle(origin.querySelector('p')).fontSize)
          : null,
        pageWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        hostWidth: host === window ? document.documentElement.clientWidth : host.clientWidth,
        hostScrollWidth: host === window ? document.documentElement.scrollWidth : host.scrollWidth,
        scrollTop: host === window ? window.scrollY : host.scrollTop,
        readingSpace: Math.min(box.bottom, window.innerHeight) - boundary,
        visibleProse: candidates.some(
          (item) =>
            Math.min(item.bottom, box.bottom, window.innerHeight) - Math.max(item.top, boundary) >
            24,
        ),
        originExpanded: document
          .getElementById('knowledge-history-toggle')
          .getAttribute('aria-expanded'),
        sticky: {
          originTop: historyBox.top,
          originBottom: historyBox.bottom,
          toolbarTop: toolbarBox.top,
          toolbarBottom: toolbarBox.bottom,
          originControlHit: Boolean(
            toggleHit && (toggle === toggleHit || toggle.contains(toggleHit)),
          ),
        },
        actualFormulas: [...body.querySelectorAll('.katex-display')].map((item) => ({
          width: item.clientWidth,
          scrollWidth: item.scrollWidth,
          overflow: getComputedStyle(item).overflowX,
        })),
      };
    });
    record(
      scene,
      'actual-body-and-origin-rem-sizes',
      Math.abs(data.body - 1.15 * data.root) <= 0.15 && Math.abs(data.origin - data.root) <= 0.15,
      data,
    );
    record(
      scene,
      'actual-reader-no-global-horizontal-overflow',
      data.pageWidth <= data.viewport + 1 && data.hostScrollWidth <= data.hostWidth + 2,
      data,
    );
    record(
      scene,
      'deep-prose-remains-below-sticky-tools',
      data.scrollTop > 300 && data.readingSpace >= 100 && data.visibleProse,
      data,
    );
    record(
      scene,
      'sticky-toolbar-does-not-cover-origin-toggle',
      data.sticky.toolbarTop >= data.sticky.originBottom - 1 && data.sticky.originControlHit,
      data.sticky,
    );
    record(
      scene,
      'actual-display-formulas-contained',
      data.actualFormulas.every(
        (item) => item.scrollWidth <= item.width + 1 || ['auto', 'scroll'].includes(item.overflow),
      ),
      { formulas: data.actualFormulas },
    );
    return data;
  };
  const renderedStress = async (scene) => {
    await page.evaluate(() => {
      document.querySelector('[data-qa-markdown-stress]')?.remove();
      const fixture = document.createElement('section');
      fixture.dataset.qaMarkdownStress = 'true';
      const cols = Array.from(
        { length: 32 },
        (_, index) => `Column${index}WithLongUnbrokenHeading`,
      );
      const table = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n| ${cols.map(() => '01234567890123456789').join(' | ')} |`;
      const formula = `$$\n${Array.from({ length: 25 }, (_, index) => `x_{${index}}`).join(' + ')} = 0\n$$`;
      fixture.innerHTML = window.freeBbsApp.renderMarkdownContent(
        `### 明确的 UI 压力夹具，非课程内容\n\n\`\`\`text\n${'local_block_only_'.repeat(80)}\n\`\`\`\n\n${table}\n\n${formula}`,
      );
      document.getElementById('knowledge-body').append(fixture);
      // Same production function used for real loaded/saved body and origin.
      // This fixture is dynamically appended after the actual content load.
      window.FreeBbsLearningReader.prepareTables(fixture);
      const tableAnchor = document.createElement('button');
      tableAnchor.type = 'button';
      tableAnchor.textContent = '测试夹具：下一次 Tab 进入宽表格';
      const tableElement = fixture.querySelector('table');
      const scrollTarget = tableElement.parentElement.classList.contains('discussion-table-scroll')
        ? tableElement.parentElement
        : tableElement;
      scrollTarget.dataset.qaTableScrollTarget = 'true';
      scrollTarget.before(tableAnchor);
    });
    await settle();
    const data = await page.evaluate(() => {
      const fixture = document.querySelector('[data-qa-markdown-stress]');
      const host = window.FreeBbsLearningReader.getScrollHost();
      return {
        blocks: [...fixture.querySelectorAll('pre,table,.katex-display')].map((item) => {
          let container = item;
          while (
            container !== fixture &&
            !['auto', 'scroll'].includes(getComputedStyle(container).overflowX)
          )
            container = container.parentElement;
          return {
            tag: item.tagName,
            className: item.className,
            width: item.clientWidth,
            scrollWidth: item.scrollWidth,
            localScroll: container !== fixture,
            containerTag: container.tagName,
            containerWidth: container.clientWidth,
            containerScrollWidth: container.scrollWidth,
          };
        }),
        pageWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        hostWidth: host === window ? window.innerWidth : host.clientWidth,
        hostScrollWidth: host === window ? document.documentElement.scrollWidth : host.scrollWidth,
      };
    });
    record(
      scene,
      'explicit-wide-markdown-fixtures-contained-locally',
      data.blocks.length >= 3 &&
        data.blocks.every((item) => item.localScroll || item.scrollWidth <= item.width + 1) &&
        data.pageWidth <= data.viewport + 1 &&
        data.hostScrollWidth <= data.hostWidth + 2,
      data,
    );
    const tableSelector = '[data-qa-markdown-stress] table';
    const scrollSelector = '[data-qa-markdown-stress] [data-qa-table-scroll-target]';
    const tableSemantics = await page.$eval(tableSelector, (item) => ({
      tag: item.tagName,
      role: item.getAttribute('role'),
      tabIndex: item.tabIndex,
      label: item.getAttribute('aria-label'),
      display: getComputedStyle(item).display,
      wrapper: item.parentElement.classList.contains('discussion-table-scroll'),
      target: {
        tag: (item.parentElement.classList.contains('discussion-table-scroll')
          ? item.parentElement
          : item
        ).tagName,
        role: (item.parentElement.classList.contains('discussion-table-scroll')
          ? item.parentElement
          : item
        ).getAttribute('role'),
        tabIndex: (item.parentElement.classList.contains('discussion-table-scroll')
          ? item.parentElement
          : item
        ).tabIndex,
        label: (item.parentElement.classList.contains('discussion-table-scroll')
          ? item.parentElement
          : item
        ).getAttribute('aria-label'),
      },
      firstCell: {
        width: item.querySelector('th').getBoundingClientRect().width,
        height: item.querySelector('th').getBoundingClientRect().height,
      },
      rootSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    record(
      scene,
      'production-table-preparer-retains-semantics-and-keyboard-label',
      tableSemantics.tag === 'TABLE' &&
        tableSemantics.role === null &&
        tableSemantics.target.tabIndex === 0 &&
        Boolean(tableSemantics.target.label) &&
        (tableSemantics.wrapper
          ? tableSemantics.tabIndex < 0 &&
            tableSemantics.target.role === 'region' &&
            tableSemantics.display === 'table'
          : tableSemantics.tabIndex === 0),
      tableSemantics,
    );
    record(
      scene,
      'wide-table-cells-have-readable-minimum-width',
      tableSemantics.firstCell.width >= 6.5 * tableSemantics.rootSize - 1,
      tableSemantics.firstCell,
    );
    await tabTo(scrollSelector, scene);
    await page.evaluate(() => {
      window.qaTableFocusScroll = { previous: null, stable: 0 };
    });
    await page.waitForFunction(
      () => {
        const host = window.FreeBbsLearningReader.getScrollHost();
        const position = host === window ? window.scrollY : host.scrollTop;
        const state = window.qaTableFocusScroll;
        state.stable = position === state.previous ? state.stable + 1 : 0;
        state.previous = position;
        return state.stable >= 8;
      },
      { polling: 'raf', timeout: 2000 },
    );
    await page.evaluate(() => {
      delete window.qaTableFocusScroll;
    });
    const horizontalBefore = await page.evaluate(() => ({
      target: document.querySelector('[data-qa-markdown-stress] [data-qa-table-scroll-target]')
        .scrollLeft,
      table: document.querySelector('[data-qa-markdown-stress] table').scrollLeft,
      page: window.scrollX,
      host: window.FreeBbsLearningReader.getScrollHost().scrollLeft || 0,
    }));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page
      .waitForFunction(
        () =>
          document.querySelector('[data-qa-markdown-stress] [data-qa-table-scroll-target]')
            .scrollLeft > 0,
        { timeout: 1500 },
      )
      .catch(() => {});
    const horizontalAfter = await page.evaluate(() => ({
      target: document.querySelector('[data-qa-markdown-stress] [data-qa-table-scroll-target]')
        .scrollLeft,
      table: document.querySelector('[data-qa-markdown-stress] table').scrollLeft,
      page: window.scrollX,
      host: window.FreeBbsLearningReader.getScrollHost().scrollLeft || 0,
    }));
    record(
      scene,
      'ArrowRight-scrolls-only-production-table-target',
      horizontalAfter.target > horizontalBefore.target &&
        (!tableSemantics.wrapper || horizontalAfter.table === horizontalBefore.table) &&
        horizontalAfter.page === horizontalBefore.page &&
        horizontalAfter.host === horizontalBefore.host,
      { horizontalBefore, horizontalAfter },
    );
    if (scene === '390-light-large' || scene === '200%-root-text-stress') {
      // Keyboard evidence above is native focus. This separate image positions
      // the fixture below sticky tools to inspect its text wrapping by eye.
      const expanded = await page.$eval(
        '#knowledge-history-toggle',
        (item) => item.getAttribute('aria-expanded') === 'true',
      );
      if (expanded) {
        await page.click('#knowledge-history-toggle');
        await settle();
      }
      await page.$eval(scrollSelector, (item) => {
        const boundary = Math.max(
          ...['knowledge-history', 'learning-annotation-toolbar'].map(
            (id) => document.getElementById(id).getBoundingClientRect().bottom,
          ),
        );
        window.FreeBbsLearningReader.getScrollHost().scrollBy({
          top: item.getBoundingClientRect().top - boundary - 12,
          behavior: 'instant',
        });
      });
      await settle();
      await screenshot(`${scene}-wide-table-keyboard.png`);
      if (expanded) {
        await page.click('#knowledge-history-toggle');
        await settle();
      }
    }
    await page.evaluate(() => document.querySelector('[data-qa-markdown-stress]')?.remove());
    return data;
  };
  const assessment = async (scene) => {
    await page.click('[data-knowledge-tool="feedback"]');
    await closeMax();
    const card = '[data-question-id="SS-02-01-Q02"]';
    const option = `${card} .learning-quiz-option`;
    const optionData = await show(option);
    record(
      scene,
      'actual-question-option-visible-not-obscured',
      optionData.viewport && optionData.hit,
      optionData,
    );
    const submit = await show(`${card} button[type="submit"]`);
    record(scene, 'actual-submit-visible-not-obscured', submit.viewport && submit.hit, submit);
    await page.$eval(`${card} .learning-quiz-info`, (item) => {
      item.open = true;
    });
    const score = await show(`${card} .learning-quiz-info p:last-child`);
    record(
      scene,
      'actual-formal-grading-rules-readable',
      score.viewport && score.hit && /正式通过标准/.test(score.text),
      score,
    );
    await page.$eval(`${card} .learning-quiz-info`, (item) => {
      item.open = false;
    });
    return { option: optionData, submit, grading: score };
  };
  try {
    await page.setViewport({ width: 1440, height: 960 });
    await page.goto(
      new URL('/knowledge?course=signals&point=SS-02-01&as=student&view=reading&tool=content', base)
        .href,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningReader?.getScrollHost &&
        document.querySelectorAll('#knowledge-body p').length > 20 &&
        document.querySelector('.learning-reading-size select'),
    );
    await page.evaluate(() => document.fonts.ready);
    await closeMax();
    report.realCoverage = await page.evaluate(() => ({
      paragraphs: document.querySelectorAll('#knowledge-body p').length,
      formulas: document.querySelectorAll('#knowledge-body .katex-display').length,
      tables: document.querySelectorAll('#knowledge-body table').length,
      codeBlocks: document.querySelectorAll('#knowledge-body pre').length,
      resourcesState: document.querySelector('#learning-resources-content')?.dataset.resourcesState,
      resourcesCopy: document.querySelector('#learning-resources-content')?.textContent.trim(),
    }));
    await page.click('.learning-start-adjust');
    await page.select('.learning-start-dialog [name="level"]', 'new');
    await page.select('.learning-start-dialog [name="goal"]', 'concepts');
    await page.click('.learning-start-apply');
    const preference = await page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
    const beforeWrites = report.requests.filter((item) => item.method !== 'GET');
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 960 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => window.freeBbsTheme.applyMode(mode), theme);
        for (const scale of ['standard', 'comfortable', 'large']) {
          const scene = `${width}-${theme}-${scale}`;
          await page.click('[data-knowledge-tool="content"]');
          await closeMax();
          await page.select('.learning-reading-size select', scale);
          await settle();
          const prose = await reading(scene);
          const stress = await renderedStress(scene);
          const quiz = await assessment(scene);
          await tabTo('[data-question-id="SS-02-01-Q02"] input[type="radio"][value="A"]', scene);
          await tabTo('[data-question-id="SS-02-01-Q02"] button[type="submit"]', scene);
          const goal = await page.evaluate(() => window.FreeBbsLearningStart.currentPreference());
          record(
            scene,
            'font-theme-choice-does-not-change-learning-goal',
            JSON.stringify(goal) === JSON.stringify(preference),
            { goal },
          );
          report.matrix.push({ width, theme, scale, prose, stress, quiz });
          if (scale === 'large' && (width === 390 || (width === 1440 && theme === 'light'))) {
            await reading(`${scene}-screenshot`);
            await screenshot(`${scene}-reader.png`);
            await assessment(`${scene}-screenshot`);
            await screenshot(`${scene}-quiz.png`);
          }
        }
      }
    }
    record(
      'matrix-boundaries',
      'no-auto-AI-or-assessment-stars-mutation-during-reading-settings',
      report.requests.every((item) => !item.path.startsWith('/api/ai/')) &&
        JSON.stringify(report.requests.filter((item) => item.method !== 'GET')) ===
          JSON.stringify(beforeWrites),
      { nonGetRequests: report.requests.filter((item) => item.method !== 'GET') },
    );

    const keyboardScene = '390-large-real-keyboard';
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => window.freeBbsTheme.applyMode('light'));
    await page.click('[data-knowledge-tool="content"]');
    await closeMax();
    await tabTo('.learning-reading-size select', keyboardScene);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Windows native selects may open their popup on Enter after arrow changes.
    // Escape closes only that popup; the already chosen value is retained.
    await page.keyboard.press('Escape');
    await settle();
    record(
      keyboardScene,
      'keyboard-select-large-updates-shared-scale',
      (await page.$eval('.learning-reading-size select', (item) => item.value === 'large')) &&
        (await page.evaluate(
          () => window.freeBbsTypography.getCurrentPreferences().typeScale === 'large',
        )),
    );
    await tabTo('#knowledge-history-toggle', keyboardScene);
    const originBefore = await page.$eval('#knowledge-history-toggle', (item) =>
      item.getAttribute('aria-expanded'),
    );
    await page.keyboard.press('Enter');
    record(
      keyboardScene,
      'Enter-toggles-origin',
      (await page.$eval('#knowledge-history-toggle', (item) =>
        item.getAttribute('aria-expanded'),
      )) !== originBefore,
    );
    await tabTo('[data-knowledge-tool="feedback"]', keyboardScene);
    await page.keyboard.press('Enter');
    await settle();
    record(
      keyboardScene,
      'Enter-opens-selftest-panel',
      await page.$eval('[data-knowledge-page]', (item) => item.dataset.learningTool === 'feedback'),
    );
    const radio = '[data-question-id="SS-02-01-Q02"] input[type="radio"][value="A"]';
    await tabTo(radio, keyboardScene);
    if (!(await page.$eval(radio, (item) => item === document.activeElement)))
      await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    record(
      keyboardScene,
      'Space-chooses-actual-radio-option',
      await page.$eval(radio, (item) => item.checked),
    );
    const submit = '[data-question-id="SS-02-01-Q02"] button[type="submit"]';
    await tabTo(submit, keyboardScene);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      /本题通过|本题尚未通过/.test(
        document.querySelector('[data-question-id="SS-02-01-Q02"] .learning-form-status')
          ?.textContent,
      ),
    );
    const result = await show('[data-question-id="SS-02-01-Q02"] .learning-form-status');
    record(
      keyboardScene,
      'keyboard-submit-gets-visible-formal-result',
      result.hit && result.viewport && /本题通过.*1 \/ 1/.test(result.text),
      result,
    );
    await screenshot('390-large-keyboard-result.png');
    await page.click('#knowledge-chat-toggle');
    await settle();
    const close = await show('#knowledge-chat-close');
    record(
      keyboardScene,
      'Max-header-close-at-least44px-visible',
      close.width >= 44 && close.height >= 44 && close.viewport && close.hit,
      close,
    );
    await tabTo('#knowledge-chat-close', keyboardScene);
    await page.keyboard.press('Enter');
    await settle();
    record(
      keyboardScene,
      'Enter-closes-Max-without-send',
      await page.$eval(
        '#knowledge-chat-panel',
        (item) => item.hidden || item.classList.contains('hidden'),
      ),
    );

    await page.click('[data-knowledge-tool="content"]');
    await page.select('.learning-reading-size select', 'standard');
    const standardRoot = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size * 2}px`;
    }, standardRoot);
    await settle();
    report.text200Stress = {
      width: 390,
      rootSize: standardRoot * 2,
      reading: await reading('200%-root-text-stress'),
      fixtures: await renderedStress('200%-root-text-stress'),
      assessment: await assessment('200%-root-text-stress'),
    };
    await screenshot('390-text200-quiz.png');
    await reading('200%-root-text-screenshot');
    await screenshot('390-text200-reader.png');
    if (
      await page.$eval(
        '#knowledge-history-toggle',
        (item) => item.getAttribute('aria-expanded') !== 'true',
      )
    )
      await page.click('#knowledge-history-toggle');
    report.text200Stress.expandedOrigin = await reading('200%-text-expanded-origin');
    record(
      '200%-text-expanded-origin',
      'origin-can-actually-expand-with-pointer',
      report.text200Stress.expandedOrigin.originExpanded === 'true',
    );
    await screenshot('390-text200-expanded-origin-attempt.png');
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('font-size');
    });
    record(
      'final-boundaries',
      'no-AI-request-including-keyboard-submit-and-Max-open-close',
      report.requests.every((item) => !item.path.startsWith('/api/ai/')),
    );
    record(
      'final-boundaries',
      'size-controls-never-send-stars-mutations',
      report.requests.every(
        (item) => !item.path.startsWith('/api/learning-stars') || item.method === 'GET',
      ),
    );
    record('final-boundaries', 'no-JavaScript-page-errors', report.pageErrors.length === 0, {
      errors: report.pageErrors,
    });
  } catch (error) {
    report.executionFailure = error.message;
    await screenshot('execution-failure.png').catch(() => {});
  } finally {
    report.failedChecks = report.checks.filter((item) => !item.pass);
    report.passedChecks = report.checks.filter((item) => item.pass).length;
    report.ok = !report.executionFailure && report.failedChecks.length === 0;
    fs.writeFileSync(
      path.join(output, 'accessibility-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        output,
        ok: report.ok,
        matrixCases: report.matrix.length,
        passedChecks: report.passedChecks,
        failedChecks: report.failedChecks,
        pageErrors: report.pageErrors,
        executionFailure: report.executionFailure,
        screenshots: report.screenshots,
      }),
    );
    await browser.close();
  }
  return report;
}
if (require.main === module)
  main()
    .then((report) => {
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { main };
