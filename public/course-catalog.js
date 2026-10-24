/* A temporary full-course directory. Browsing never changes learning evidence. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsCourseCatalog = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  let sequence = 0;
  const chapterOf = (id) =>
    String(id || '')
      .split('-')
      .slice(0, 2)
      .join('-');
  const normalizeQuery = (value) =>
    String(value || '')
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase();
  function normalizeState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const state = {
      chapterId: value.chapterId ?? '',
      query: value.query ?? '',
      page: value.page ?? 0,
      open: value.open ?? false,
    };
    if (
      typeof state.chapterId !== 'string' ||
      state.chapterId.length > 64 ||
      (state.chapterId && !/^[A-Z][A-Z0-9]*-[A-Z0-9]+$/.test(state.chapterId)) ||
      typeof state.query !== 'string' ||
      Array.from(state.query).length > 200 ||
      Array.from(state.query).some(
        (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
      ) ||
      !Number.isSafeInteger(state.page) ||
      state.page < 0 ||
      state.page > 10000 ||
      typeof state.open !== 'boolean'
    )
      return null;
    return state;
  }
  function normalizeNodes(input) {
    const seen = new Set();
    return (Array.isArray(input) ? input : []).filter((node) => {
      if (
        !node ||
        typeof node.id !== 'string' ||
        node.id.length > 64 ||
        !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(node.id) ||
        /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node.id) ||
        seen.has(node.id)
      )
        return false;
      seen.add(node.id);
      return true;
    });
  }
  function filterNodes(input, { chapterId = '', query = '', matches } = {}) {
    const nodes = normalizeNodes(input);
    const term = normalizeQuery(query);
    if (!term) return chapterId ? nodes.filter((node) => chapterOf(node.id) === chapterId) : nodes;
    // A search always spans the whole course; the selected browsing chapter is
    // retained independently and takes effect again only when the query clears.
    if (Array.isArray(matches)) {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const ids = new Set();
      return matches.flatMap((item) => {
        const id = typeof item === 'string' ? item : item?.id;
        if (!byId.has(id) || ids.has(id)) return [];
        ids.add(id);
        return [byId.get(id)];
      });
    }
    return nodes.filter((node) => {
      const aliases = Array.isArray(node.aliases)
        ? node.aliases
        : [node.aliases || node.alias || ''];
      return [node.id, node.title, ...aliases].some((value) =>
        normalizeQuery(value).includes(term),
      );
    });
  }
  function paginate(input, page = 0) {
    const nodes = Array.isArray(input) ? input : [];
    const total = nodes.length;
    const pageSize = 40;
    const pageCount = Math.ceil(total / pageSize);
    const selected = Number.isSafeInteger(page) && page >= 0 ? page : 0;
    const current = Math.min(selected, Math.max(0, pageCount - 1));
    const offset = current * pageSize;
    return {
      nodes: nodes.slice(offset, offset + pageSize),
      total,
      page: current,
      pageCount,
      pageSize,
      start: total ? offset + 1 : 0,
      end: Math.min(total, offset + pageSize),
    };
  }
  function create({ document, model = {}, searchNodes, onOpenNode, trigger } = {}) {
    const inert = {
      open: () => false,
      getState: () => ({ chapterId: '', query: '', page: 0, open: false }),
      restoreState: () => false,
      destroy() {},
    };
    if (!document?.body?.append || typeof document.createElement !== 'function') return inert;
    const dialog = document.createElement('dialog');
    if (
      typeof dialog?.showModal !== 'function' ||
      typeof dialog.close !== 'function' ||
      typeof dialog.append !== 'function' ||
      typeof dialog.addEventListener !== 'function'
    )
      return inert;
    const nodes = normalizeNodes(model.nodes);
    const chapters = (Array.isArray(model.chapters) ? model.chapters : []).filter(
      (chapter, index, all) =>
        chapter &&
        typeof chapter.id === 'string' &&
        all.findIndex((item) => item?.id === chapter.id) === index,
    );
    const byChapter = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    sequence += 1;
    const id = `course-catalog-${sequence}`;
    let chapterId = '';
    let query = '';
    let page = 0;
    let destroyed = false;
    let restoreFocus = true;
    let initialized = false;
    let lastChoiceViewport = null;
    let viewportRevision = 0;
    let viewportFrame = 0;
    function cancelViewportRestore() {
      viewportRevision += 1;
      document.defaultView?.cancelAnimationFrame?.(viewportFrame);
      viewportFrame = 0;
    }
    const make = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const button = (text, action, className) => {
      const element = make('button', text, className);
      element.type = 'button';
      element.addEventListener('click', action);
      return element;
    };
    dialog.className = 'course-catalog-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    const header = make('header', undefined, 'course-catalog-header');
    const title = make('h2', '完整目录');
    title.id = `${id}-title`;
    const close = button('×', () => dialog.close(), 'course-catalog-close');
    close.setAttribute('aria-label', '关闭完整目录');
    header.append(title, close);
    const body = make('div', undefined, 'course-catalog-body');
    const chapterPicker = make('details', undefined, 'course-catalog-chapter-picker');
    const chapterSummary = make('summary', '选择章节');
    const compact = document.defaultView?.matchMedia?.('(max-width: 700px), (max-height: 700px)');
    chapterPicker.open = !compact?.matches;
    const syncChapterPicker = () => {
      chapterPicker.open = !compact?.matches;
    };
    compact?.addEventListener?.('change', syncChapterPicker);
    const chapterList = make('nav', undefined, 'course-catalog-chapters');
    chapterList.setAttribute('aria-label', '按章节查看知识点');
    chapterPicker.append(chapterSummary, chapterList);
    const chapterButtons = new Map();
    const chooseChapter = (value) => {
      chapterId = value;
      query = '';
      search.value = '';
      page = 0;
      render();
      if (compact?.matches) {
        chapterPicker.open = false;
        chapterSummary.focus({ preventScroll: true });
      }
    };
    const chooseNode = (node) => {
      if (destroyed) return;
      const sourceState = getState();
      lastChoiceViewport = {
        nodeId: node.id,
        chapterId,
        query,
        page,
        scroll: [dialog, body, chapterList, main, results].map((element) => ({
          element,
          top: element.scrollTop || 0,
          left: element.scrollLeft || 0,
        })),
      };
      restoreFocus = false;
      dialog.close();
      onOpenNode?.(node, sourceState);
    };
    const all = button('全部知识点', () => chooseChapter(''), 'course-catalog-chapter');
    chapterList.append(all);
    chapterButtons.set('', all);
    for (const chapter of chapters) {
      const item = button('', () => chooseChapter(chapter.id), 'course-catalog-chapter');
      item.append(
        make('strong', chapter.title || chapter.id),
        make('span', `${nodes.filter((node) => chapterOf(node.id) === chapter.id).length} 个`),
      );
      item.dataset.catalogChapterId = chapter.id;
      chapterButtons.set(chapter.id, item);
      chapterList.append(item);
    }
    const main = make('section', undefined, 'course-catalog-main');
    main.setAttribute('aria-label', '知识点目录');
    const searchRow = make('div', undefined, 'course-catalog-search-row');
    const label = make('label', undefined, 'course-catalog-search-label');
    label.append(make('span', '搜索全课程'));
    const search = make('input', undefined, 'course-catalog-search');
    search.type = 'search';
    search.placeholder = '名称、编号或别名';
    search.setAttribute('aria-label', '在完整目录中搜索全课程');
    search.setAttribute('aria-controls', `${id}-results`);
    label.append(search);
    const clear = button(
      '清空',
      () => {
        query = '';
        search.value = '';
        page = 0;
        render();
        search.focus({ preventScroll: true });
      },
      'course-catalog-clear',
    );
    searchRow.append(label, clear);
    const status = make('p', '', 'course-catalog-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const results = make('div', undefined, 'course-catalog-results');
    results.id = `${id}-results`;
    const footer = make('footer', undefined, 'course-catalog-paging');
    const previous = button('上一页', () => changePage(-1), 'course-catalog-previous');
    const count = make('span', '', 'course-catalog-page-count');
    const next = button('下一页', () => changePage(1), 'course-catalog-next');
    footer.append(previous, count, next);
    main.append(searchRow, status, results, footer);
    body.append(chapterPicker, main);
    dialog.append(header, body);
    document.body.append(dialog);
    function revealReturnedCard(entry) {
      const region = results.getBoundingClientRect?.();
      const card = entry.getBoundingClientRect?.();
      if (!(region?.height > 0 && results.clientHeight > 0 && card?.height > 0)) return;
      let top = region.top + (results.clientTop || 0);
      let bottom = top + results.clientHeight;
      for (const host of [body, main, dialog]) {
        const box = host.getBoundingClientRect?.();
        if (!(box?.height > 0)) continue;
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
      if (bottom <= top) return;
      const outside = card.top >= bottom || card.bottom <= top;
      const clipped =
        card.height <= bottom - top && (card.top < top - 1 || card.bottom > bottom + 1);
      if (outside || clipped)
        entry.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    function verifyReturnedCard(entry) {
      revealReturnedCard(entry);
      const revision = viewportRevision;
      viewportFrame = document.defaultView?.requestAnimationFrame?.(() => {
        viewportFrame = 0;
        if (
          destroyed ||
          revision !== viewportRevision ||
          !dialog.open ||
          document.activeElement !== entry ||
          entry.isConnected === false ||
          ![...results.children].includes(entry)
        )
          return;
        revealReturnedCard(entry);
      });
    }
    const viewportInputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const event of viewportInputEvents)
      dialog.addEventListener(event, cancelViewportRestore, { passive: true });
    function render() {
      cancelViewportRestore();
      let matches;
      if (normalizeQuery(query) && typeof searchNodes === 'function') {
        try {
          matches = searchNodes(query);
        } catch {
          /* Local title/ID/alias search remains available. */
        }
      }
      const selected = paginate(filterNodes(nodes, { chapterId, query, matches }), page);
      page = selected.page;
      const term = normalizeQuery(query);
      status.textContent = `${term ? '全课程搜索' : chapterId ? '本章' : '全部知识点'} · ${selected.total} 个知识点${selected.total ? ` · ${selected.start}–${selected.end}` : ''}`;
      chapterSummary.textContent = chapterId ? '已选章节' : '选择章节';
      chapterSummary.setAttribute(
        'aria-label',
        `选择章节，当前为${byChapter.get(chapterId)?.title || '全部知识点'}`,
      );
      clear.disabled = !query;
      for (const [value, item] of chapterButtons)
        item.setAttribute('aria-pressed', String(!term && value === chapterId));
      results.replaceChildren();
      for (const node of selected.nodes) {
        const item = button('', () => chooseNode(node), 'course-catalog-result');
        item.dataset.catalogNodeId = node.id;
        item.setAttribute('aria-label', `${node.title || node.id}，${node.id}，查看学习概览`);
        item.append(
          make('strong', node.title || node.id),
          make(
            'span',
            `${node.id}${byChapter.get(chapterOf(node.id))?.title ? ` · ${byChapter.get(chapterOf(node.id)).title}` : ''}`,
          ),
        );
        results.append(item);
      }
      if (!selected.total)
        results.append(
          make(
            'p',
            term ? '没有匹配的知识点，试试其他名称或编号。' : '这里尚未发布知识点。',
            'course-catalog-empty',
          ),
        );
      results.scrollTop = 0;
      previous.disabled = page === 0;
      next.disabled = page + 1 >= selected.pageCount;
      count.textContent = `${selected.pageCount ? page + 1 : 0} / ${selected.pageCount}`;
      footer.hidden = selected.pageCount <= 1;
    }
    function changePage(direction) {
      page += direction;
      render();
      // Keep repeated Enter useful, unless the control has reached its boundary.
      if (document.activeElement === next && next.disabled) previous.focus({ preventScroll: true });
      else if (document.activeElement === previous && previous.disabled)
        next.focus({ preventScroll: true });
    }
    search.addEventListener('input', () => {
      query = Array.from(search.value).slice(0, 200).join('');
      if (search.value !== query) search.value = query;
      page = 0;
      render();
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      cancelViewportRestore();
      if (restoreFocus && !destroyed) trigger?.focus?.({ preventScroll: true });
    });
    function getState() {
      return { chapterId, query, page, open: !destroyed && Boolean(dialog.open) };
    }
    return {
      open(options = {}) {
        if (destroyed) return false;
        if (!initialized && options && Object.hasOwn(options, 'chapterId')) {
          chapterId = byChapter.has(options.chapterId) ? options.chapterId : '';
          query = '';
          search.value = '';
          page = 0;
        }
        initialized = true;
        restoreFocus = true;
        render();
        if (!dialog.open) dialog.showModal();
        const entry =
          typeof options?.focusNodeId === 'string'
            ? [...results.children].find(
                (item) => item.dataset.catalogNodeId === options.focusNodeId,
              )
            : null;
        if (entry) {
          entry.focus({ preventScroll: true });
          const saved = lastChoiceViewport;
          if (
            options?.preserveScroll === true &&
            saved?.nodeId === options.focusNodeId &&
            saved.chapterId === chapterId &&
            saved.query === query &&
            saved.page === page
          ) {
            for (const scroll of saved.scroll) {
              scroll.element.scrollTop = scroll.top;
              scroll.element.scrollLeft = scroll.left;
            }
          } else
            entry.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          verifyReturnedCard(entry);
        } else search.focus({ preventScroll: true });
        return true;
      },
      getState,
      restoreState(value, { reopen = false } = {}) {
        if (destroyed) return false;
        const nextState = normalizeState(value);
        if (!nextState || typeof reopen !== 'boolean') return false;
        chapterId = byChapter.has(nextState.chapterId) ? nextState.chapterId : '';
        query = nextState.query;
        search.value = query;
        page = nextState.page;
        initialized = true;
        render();
        if (reopen) {
          restoreFocus = true;
          if (!dialog.open) dialog.showModal();
          search.focus({ preventScroll: true });
        } else if (dialog.open) dialog.close();
        return true;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelViewportRestore();
        restoreFocus = false;
        for (const event of viewportInputEvents)
          dialog.removeEventListener?.(event, cancelViewportRestore);
        compact?.removeEventListener?.('change', syncChapterPicker);
        if (dialog.open) dialog.close();
        dialog.remove?.();
      },
    };
  }
  return { create, normalizeNodes, normalizeState, filterNodes, paginate };
});
