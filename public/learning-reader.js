/* A reading bookmark is a local convenience, never assessment or time-on-task evidence. */
(function exposeLearningReader(root) {
  const BASE = 'free_bbs_reading_bookmark_v1';
  const BLOCKS = 'h2,h3,h4,h5,p,li,pre,table,figure,blockquote';
  const text = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  function fingerprint(value) {
    const source = text(value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      // eslint-disable-next-line no-bitwise -- FNV is a UI bookmark checksum, not an integrity claim.
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    // eslint-disable-next-line no-bitwise -- Serialize the unsigned checksum.
    return `${source.length}:${(hash >>> 0).toString(16)}`;
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!Number.isSafeInteger(value.index) || value.index < 0 || value.index > 100000) return null;
    if (typeof value.fingerprint !== 'string' || !/^\d{1,8}:[a-f0-9]{1,8}$/.test(value.fingerprint))
      return null;
    if (!Number.isFinite(value.offset) || Math.abs(value.offset) > 10000) return null;
    if (typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)) return null;
    return {
      index: value.index,
      fingerprint: value.fingerprint,
      offset: value.offset,
      version: value.version,
    };
  }
  function resolve(value, blocks, version) {
    const bookmark = normalize(value);
    if (!bookmark || !Array.isArray(blocks)) return null;
    const same = (block) => fingerprint(block?.textContent ?? block) === bookmark.fingerprint;
    if (version === bookmark.version && blocks[bookmark.index] && same(blocks[bookmark.index]))
      return { block: blocks[bookmark.index], offset: bookmark.offset, relocated: false };
    // Across versions only an unambiguous unchanged block may be relocated.
    const matches = blocks.filter(same);
    return matches.length === 1
      ? { block: matches[0], offset: bookmark.offset, relocated: true }
      : null;
  }
  function scrollHost(target, browser = root) {
    let ancestor = target?.parentElement;
    while (ancestor) {
      const overflow = browser.getComputedStyle?.(ancestor).overflowY || '';
      if (/(auto|scroll|overlay)/.test(overflow) && ancestor.scrollHeight > ancestor.clientHeight)
        return ancestor;
      ancestor = ancestor.parentElement;
    }
    return browser;
  }
  function readableBlocks(container) {
    if (!container || container.hasAttribute?.('data-learning-document-empty')) return [];
    // Chromium can give closed-details children non-zero geometry. Geometry alone
    // must never make a hidden reference answer the learner's reading bookmark.
    return [...container.querySelectorAll(BLOCKS)].filter(
      (block) =>
        text(block.textContent) && !block.closest?.('details:not([open]),[hidden],.hidden'),
    );
  }
  function prepareTables(container) {
    if (!container) return;
    container.querySelectorAll('table').forEach((table) => {
      // The shared Markdown renderer already supplies one labelled scroll region.
      // Do not make its semantic table a second, redundant keyboard stop.
      if (table.parentElement?.classList?.contains('discussion-table-scroll')) return;
      if (!table.hasAttribute('tabindex')) table.setAttribute('tabindex', '0');
      if (!table.hasAttribute('aria-label') && !table.hasAttribute('aria-labelledby')) {
        const caption = text(table.querySelector('caption')?.textContent);
        table.setAttribute(
          'aria-label',
          caption ? `${caption}，可左右滚动查看` : '表格，可左右滚动查看',
        );
      }
    });
  }
  function install(browser, dom, app) {
    const page = dom.querySelector('[data-knowledge-page]');
    const body = dom.getElementById('knowledge-body');
    const reading = dom.getElementById('knowledge-reading');
    const progress = browser.FreeBbsLearningProgress;
    if (!page || !body || !reading || !progress) return null;
    let context = null;
    let generation = 0;
    let stale = false;
    let restoring = false;
    let bookmark = null;
    let entryBookmark = null;
    let host = browser;
    let timer = null;
    let identity = '';
    let interaction = 0;
    let bookmarkInteraction = 0;
    let persistenceAvailable = true;
    const memory = new Map();
    const signature = () =>
      JSON.stringify([app?.userState?.isLoggedIn, app?.userState?.uid, app?.userState?.token]);
    const blocks = () => readableBlocks(body);
    const readingVisible = () =>
      !reading.hidden &&
      !reading.classList.contains('hidden') &&
      ['content', 'notes'].includes(page.dataset.learningTool || 'content');
    const layoutCurrent = () => context && !stale && identity === signature();
    const valid = () => layoutCurrent() && Boolean(progress.scopedKey(BASE, app?.userState));
    const entryKey = () => JSON.stringify([context?.course?.slug, context?.node?.id]);
    const memoryKey = () => `${progress.scopedKey(BASE, app?.userState)}:${entryKey()}`;
    const inset = () => {
      const history = dom.getElementById('knowledge-history');
      const toolbar = dom.getElementById('learning-annotation-toolbar');
      const visible = [history, toolbar].filter(
        (element) =>
          element &&
          !element.hidden &&
          !element.classList.contains('hidden') &&
          ['sticky', 'fixed'].includes(browser.getComputedStyle(element).position) &&
          element.getBoundingClientRect().height > 0,
      );
      const stickyTop = Number.parseFloat(browser.getComputedStyle(visible[0] || reading).top) || 0;
      return visible.reduce(
        (sum, element) => sum + element.getBoundingClientRect().height,
        16 + stickyTop,
      );
    };
    const top = () => (host === browser ? 0 : host.getBoundingClientRect().top);
    function navigationInset(block) {
      let margin = inset();
      const bounds = block.getBoundingClientRect();
      for (const control of [
        dom.getElementById('knowledge-course-link'),
        dom.querySelector('.topbar'),
      ]) {
        if (!control || control.hidden || control.closest?.('[hidden],.hidden')) continue;
        const style = browser.getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        if (
          ['fixed', 'sticky'].includes(style.position) &&
          rect.width > 0 &&
          rect.top < top() + 100 &&
          rect.bottom > top() &&
          rect.right > bounds.left &&
          rect.left < bounds.right
        )
          margin = Math.max(margin, rect.bottom - top() + 16);
      }
      return margin;
    }
    function capture() {
      if (!valid() || restoring || !readingVisible()) return false;
      const version = context.node.documentVersion;
      if (!/^[a-f0-9]{64}$/.test(version || '')) return false;
      const items = blocks();
      const boundary = top() + inset();
      const index = items.findIndex((block) => block.getBoundingClientRect().bottom > boundary);
      if (index < 0) return false;
      bookmark = normalize({
        index,
        fingerprint: fingerprint(items[index].textContent),
        offset: items[index].getBoundingClientRect().top - boundary,
        version,
      });
      bookmarkInteraction = interaction;
      memory.set(memoryKey(), bookmark);
      try {
        const records = progress.read(browser.localStorage, BASE, app.userState);
        progress.write(browser.localStorage, BASE, app.userState, {
          ...records,
          [entryKey()]: bookmark,
        });
      } catch {
        persistenceAvailable = false;
        /* Keep this page's position without claiming cross-device persistence. */
      }
      updateButton();
      return true;
    }
    function restore(value = bookmark) {
      if (!valid() || !readingVisible()) return false;
      bindHost();
      const target = resolve(value, blocks(), context.node.documentVersion);
      if (!target) return false;
      const delta = target.block.getBoundingClientRect().top - (top() + inset() + target.offset);
      host.scrollBy({ top: delta, behavior: 'instant' });
      return true;
    }
    function scrollToHeading(block) {
      if (
        !layoutCurrent() ||
        !readingVisible() ||
        !body.contains?.(block) ||
        !/^H[1-6]$/.test(block.tagName || '') ||
        block.closest?.('details:not([open]),[hidden],.hidden')
      )
        return false;
      bindHost();
      const delta = block.getBoundingClientRect().top - (top() + navigationInset(block));
      host.scrollBy({ top: delta, behavior: 'instant' });
      return true;
    }
    const resume = dom.createElement('button');
    resume.id = 'learning-reader-resume';
    resume.type = 'button';
    resume.className = 'learning-reading-notes';
    resume.textContent = '回到上次位置';
    resume.hidden = true;
    reading.querySelector('.knowledge-reading-actions')?.prepend(resume);
    // The shortcut refers to the previous visit, not the latest debounced scroll.
    // Going back to the header must not overwrite its destination with the header.
    resume.addEventListener('click', () => restore(entryBookmark));
    // Reading follows the site's typography preferences. Annotation controls
    // are one opt-in toolbar, not a second place to configure text size.
    function updateButton() {
      const usable = valid() && resolve(entryBookmark, blocks(), context.node.documentVersion);
      resume.hidden = !usable;
      resume.title = persistenceAvailable
        ? '仅恢复本机阅读位置，不代表学习完成'
        : '仅恢复本页阅读位置，不代表学习完成';
    }
    function onScroll() {
      browser.clearTimeout(timer);
      const request = generation;
      timer = browser.setTimeout(() => {
        if (request === generation) capture();
      }, 180);
    }
    function bindHost() {
      host.removeEventListener?.('scroll', onScroll);
      host = scrollHost(body, browser);
      host.addEventListener('scroll', onScroll, { passive: true });
    }
    function reset(detail, { entry = false } = {}) {
      generation += 1;
      browser.clearTimeout(timer);
      context = detail || context;
      identity = signature();
      stale = false;
      restoring = true;
      bookmark = null;
      entryBookmark = null;
      if (valid()) {
        try {
          const records = progress.read(browser.localStorage, BASE, app.userState);
          bookmark = normalize(records[entryKey()]);
        } catch {
          persistenceAvailable = false;
        }
        bookmark ||= normalize(memory.get(memoryKey()));
        entryBookmark = bookmark;
      }
      bookmarkInteraction = interaction;
      bindHost();
      prepareTables(body);
      prepareTables(dom.getElementById('knowledge-history-prose'));
      updateButton();
      const request = generation;
      const userInteraction = interaction;
      const savedPosition = bookmark;
      const params = new URLSearchParams(browser.location.search);
      // Explicit destinations always win over a saved reading position.
      const targeted =
        ['focus', 'question', 'quiz', 'interaction'].some((key) => params.has(key)) ||
        params.get('view') === 'overview' ||
        (params.has('tool') && !['content', 'notes'].includes(params.get('tool')));
      browser.requestAnimationFrame(() =>
        browser.requestAnimationFrame(() => {
          if (request !== generation || !layoutCurrent()) return;
          if (!targeted && interaction === userInteraction) {
            const resumed = restore(savedPosition);
            // Opening Reading is a destination, not a request to stay above it.
            // A real bookmark or an explicit question/origin link still wins.
            if (entry && !resumed && params.get('view') === 'reading' && readingVisible()) {
              reading.style?.setProperty('scroll-margin-top', `${navigationInset(reading)}px`);
              reading.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
          }
          restoring = false;
        }),
      );
      // Local fonts may finish after the first layout. Do not move a reader who has begun acting.
      dom.fonts?.ready?.then(() => {
        browser.requestAnimationFrame(() => {
          if (targeted || request !== generation || interaction !== userInteraction || !valid())
            return;
          bindHost();
          restore(savedPosition);
        });
      });
    }
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((type) =>
      dom.addEventListener(
        type,
        () => {
          interaction += 1;
        },
        { capture: true, passive: true },
      ),
    );
    page.addEventListener('knowledge:loaded', (event) => reset(event.detail, { entry: true }));
    page.addEventListener('knowledge:document-saved', (event) => {
      if (event.detail?.node && context) reset({ ...context, node: event.detail.node });
    });
    // Capture before earlier controllers hide the sticky origin or change the layout.
    page.addEventListener('knowledge:tool-select', () => capture(), { capture: true });
    page.addEventListener('knowledge:before-view-change', () => capture());
    browser.addEventListener('freebbs:session-change', () => reset());
    browser.addEventListener('storage', (event) => {
      if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
      generation += 1;
      stale = true;
      bookmark = null;
      entryBookmark = null;
      resume.hidden = true;
      browser.clearTimeout(timer);
    });
    browser.addEventListener('pagehide', capture);
    browser.addEventListener('resize', () => {
      bindHost();
      if (!valid() || !readingVisible()) return;
      // A recent wheel/keyboard action takes priority over an older debounced bookmark.
      if (interaction !== bookmarkInteraction) capture();
      else restore();
    });
    dom.addEventListener('visibilitychange', () => {
      if (dom.hidden) capture();
    });
    // Public GETs can finish before this deferred reader script arrives.
    const existing = browser.freeBbsKnowledge?.getLearningContext?.();
    if (existing?.node && existing?.course && page.getAttribute?.('aria-busy') === 'false')
      reset(existing, { entry: true });
    return { capture, restore, scrollToHeading, getScrollHost: () => scrollHost(body, browser) };
  }
  const api = {
    BASE,
    BLOCKS,
    fingerprint,
    normalize,
    resolve,
    scrollHost,
    readableBlocks,
    prepareTables,
    install,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    const controller = install(root, root.document, root.freeBbsApp);
    root.FreeBbsLearningReader = { ...api, ...controller };
  }
})(typeof window !== 'undefined' ? window : globalThis);
