/* Course structure reader. The editor and published graph data remain independent. */
(function (root, factory) {
  const content =
    typeof module !== 'undefined' && module.exports
      ? require('./learning-content')
      : root?.FreeBbsLearningContent;
  const api = factory(root, content);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCourseStructure = api;
})(typeof window === 'undefined' ? null : window, (root, content) => {
  const compare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  // Match the existing course-map API contract, including legacy two-part and
  // deeper identifiers. Only the explicit zero-level convention marks a chapter.
  const isValidNodeId = (id) =>
    typeof id === 'string' &&
    id.length >= 4 &&
    id.length <= 64 &&
    /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(id);
  const chapterId = (id) =>
    String(id || '')
      .split('-')
      .slice(0, 2)
      .join('-');
  const isChapterNode = (node) => /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node?.id || '');
  const edgeLabel = (edge) => (edge.type === 'ordered' ? '学习顺序' : '补充关联');
  function abbreviateNodeId(id, limit = 10) {
    const text = String(id || '');
    const size = Number.isFinite(limit) ? Math.max(5, Math.floor(limit)) : 10;
    if (text.length <= size) return text;
    const head = Math.ceil((size - 1) / 2);
    const tail = Math.floor((size - 1) / 2);
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
  }
  function nodeLevel(node) {
    const raw =
      node.level ||
      node.metadata?.['知识点层级'] ||
      String(node.sections?.basicInfoMarkdown || '').match(
        /(?:知识点层级|层级)\s*[:：|]\s*([^\n|]+)/,
      )?.[1] ||
      '';
    const value = String(raw).replace(/[*`"'\s]/g, '');
    if (/^(核心|core)$/.test(value)) return 'core';
    if (/^(一般|general)$/.test(value)) return 'general';
    if (/^(拓展|拓展\/选学|extension|elective)$/.test(value)) return 'extension';
    return '';
  }
  function buildModel(nodes = [], edges = []) {
    const byId = new Map();
    for (const node of nodes)
      if (node && isValidNodeId(node.id) && !byId.has(node.id)) byId.set(node.id, node);
    const groups = new Map();
    for (const node of byId.values()) {
      const id = chapterId(node.id);
      if (!groups.has(id))
        groups.set(id, { id, title: id, overview: null, nodes: [], virtual: true });
      const group = groups.get(id);
      if (isChapterNode(node)) {
        if (!group.overview || compare(node.id, group.overview.id) < 0) group.overview = node;
      } else group.nodes.push(node);
    }
    const chapters = [...groups.values()]
      .sort((a, b) => compare(a.id, b.id))
      .map((group) => ({
        ...group,
        virtual: !group.overview,
        title:
          content?.chapterName([...group.nodes, group.overview].filter(Boolean), group.id) ||
          group.id,
        nodes: group.nodes.sort((a, b) => compare(a.id, b.id)),
      }));
    const validEdges = edges.filter(
      (edge) =>
        edge &&
        ['ordered', 'related'].includes(edge.type) &&
        byId.has(edge.source) &&
        byId.has(edge.target) &&
        edge.source !== edge.target,
    );
    return {
      nodes: [...byId.values()],
      byId,
      chapters,
      macroEdges: validEdges.filter(
        (edge) => isChapterNode(byId.get(edge.source)) && isChapterNode(byId.get(edge.target)),
      ),
      knowledgeEdges: validEdges.filter(
        (edge) => !isChapterNode(byId.get(edge.source)) && !isChapterNode(byId.get(edge.target)),
      ),
    };
  }
  const initialState = () => ({
    selectedChapterId: '',
    selectedNodeId: '',
    expandedChapterId: '',
    focusedNodeId: '',
    searchTargetId: '',
    filter: 'all',
  });
  function reduceState(state, action, model) {
    const chapter = model.chapters.find((item) => item.id === action.id);
    const node = model.byId.get(action.id);
    if (['select', 'expand'].includes(action.type) && chapter)
      return {
        ...state,
        selectedChapterId: chapter.id,
        selectedNodeId: '',
        expandedChapterId: '',
        focusedNodeId: '',
        searchTargetId: '',
        filter: 'all',
      };
    if (action.type === 'collapse')
      return {
        ...state,
        selectedNodeId: '',
        expandedChapterId: '',
        focusedNodeId: '',
        filter: 'all',
      };
    if (['focus', 'locate'].includes(action.type) && node && !isChapterNode(node))
      return {
        ...state,
        selectedChapterId: chapterId(node.id),
        selectedNodeId: node.id,
        expandedChapterId: '',
        focusedNodeId: node.id,
        searchTargetId: '',
        filter: 'all',
      };
    if (action.type === 'unfocus')
      return {
        ...state,
        selectedChapterId: chapterId(state.focusedNodeId) || state.selectedChapterId,
        selectedNodeId: '',
        expandedChapterId: '',
        focusedNodeId: '',
        searchTargetId: '',
        filter: 'all',
      };
    if (action.type === 'filter' && ['all', 'ordered', 'related'].includes(action.value))
      return { ...state, filter: action.value };
    if (action.type === 'reset') return initialState();
    return state;
  }
  function viewModel(model, state = initialState()) {
    if (!state.focusedNodeId) {
      return {
        chapters: model.chapters,
        expanded: null,
        focus: null,
        satellites: [],
        knowledgeNodes: [],
        links: [],
        outsideCount: 0,
      };
    }
    const focus = model.byId.get(state.focusedNodeId);
    if (!focus || isChapterNode(focus)) return viewModel(model, { ...state, focusedNodeId: '' });
    const links = model.knowledgeEdges.filter(
      (edge) => edge.source === focus.id || edge.target === focus.id,
    );
    const ids = new Set([focus.id, ...links.flatMap((edge) => [edge.source, edge.target])]);
    const knowledgeNodes = [...ids]
      .map((id) => model.byId.get(id))
      .sort((a, b) => compare(a.id, b.id));
    const owner = chapterId(focus.id);
    const satellites = model.chapters
      .filter((chapter) => chapter.id !== owner)
      .map((chapter) => ({ ...chapter, nodes: chapter.nodes.filter((node) => ids.has(node.id)) }))
      .filter((chapter) => chapter.nodes.length);
    return {
      chapters: model.chapters,
      expanded: model.chapters.find((chapter) => chapter.id === owner),
      focus,
      satellites,
      knowledgeNodes,
      links: links.map((edge) => ({
        ...edge,
        active: state.filter === 'all' || state.filter === edge.type,
      })),
      outsideCount: satellites.reduce((sum, group) => sum + group.nodes.length, 0),
    };
  }
  const PAGE_SIZE = 40;
  // Keep typed spaces: trimming a live input would make multi-word queries impossible.
  const normalizeQuery = (value) => (typeof value === 'string' ? value : '');
  function matchesQuery(model, node, key) {
    const owner = model.chapters.find((chapter) => chapter.id === chapterId(node.id));
    return [
      node.id,
      node.title,
      node.chapterTitle,
      owner?.title,
      ...(Array.isArray(node.aliases) ? node.aliases : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(key);
  }
  function searchNodes(model, query) {
    const key = normalizeQuery(query).trim().toLocaleLowerCase();
    if (!key) return [];
    return model.nodes
      .filter((node) => matchesQuery(model, node, key))
      .sort((left, right) => compare(left.id, right.id));
  }
  function relationGroups(view) {
    const groups = [
      { key: 'incoming', title: '可先了解', entries: new Map() },
      { key: 'outgoing', title: '接着了解', entries: new Map() },
      { key: 'related', title: '补充联系', entries: new Map() },
    ];
    if (view.focus) {
      for (const edge of view.links) {
        if (edge.active === false) continue;
        const incoming = edge.target === view.focus.id;
        const id = incoming ? edge.source : edge.target;
        const node = view.knowledgeNodes.find((item) => item.id === id);
        if (!node || node.id === view.focus.id) continue;
        const key = edge.type === 'related' ? 'related' : incoming ? 'incoming' : 'outgoing';
        const group = groups.find((item) => item.key === key);
        if (!group.entries.has(id)) group.entries.set(id, { node, edges: [] });
        group.entries.get(id).edges.push(edge);
      }
    }
    return groups.map(({ key, title, entries }) => ({ key, title, items: [...entries.values()] }));
  }
  function paginateMatches(matches, page = 0) {
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const requested = Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0;
    const current = Math.min(requested, pageCount - 1);
    return {
      page: current,
      pageCount,
      total: matches.length,
      start: matches.length ? current * PAGE_SIZE + 1 : 0,
      end: Math.min((current + 1) * PAGE_SIZE, matches.length),
      nodes: matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE),
    };
  }
  function pickerMatches(model, picker) {
    const key = picker.query.trim().toLocaleLowerCase();
    return model.nodes
      .filter(
        (node) =>
          !isChapterNode(node) &&
          (!picker.chapterId || chapterId(node.id) === picker.chapterId) &&
          (!key || matchesQuery(model, node, key)),
      )
      .sort((left, right) => compare(left.id, right.id));
  }
  function normalizePickerState(model, value = {}) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const picker = {
      chapterId: model.chapters.some((chapter) => chapter.id === raw.chapterId)
        ? raw.chapterId
        : '',
      query: normalizeQuery(raw.query),
      page: 0,
    };
    picker.page = paginateMatches(pickerMatches(model, picker), raw.page).page;
    return picker;
  }
  function placeNodes(nodes, origin, columns = 3, reusePosition = true) {
    const seen = new Set();
    const raw = nodes.map((node) => ({ x: Number(node.position?.x), y: Number(node.position?.y) }));
    const usable =
      reusePosition &&
      raw.length > 1 &&
      raw.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          !seen.has(`${point.x},${point.y}`) &&
          seen.add(`${point.x},${point.y}`),
      ) &&
      raw.every((point, index) =>
        raw
          .slice(index + 1)
          .every(
            (other) => Math.abs(other.x - point.x) >= 224 || Math.abs(other.y - point.y) >= 94,
          ),
      );
    const minX = usable ? Math.min(...raw.map((point) => point.x)) : 0;
    const minY = usable ? Math.min(...raw.map((point) => point.y)) : 0;
    return nodes.map((node, index) => ({
      id: node.id,
      node,
      kind: 'knowledge',
      x: origin.x + (usable ? raw[index].x - minX : (index % columns) * 234),
      y: origin.y + (usable ? raw[index].y - minY : Math.floor(index / columns) * 106),
      width: 208,
      height: 72,
    }));
  }
  function layout(model, view, { compact = false } = {}) {
    let boxes = [];
    const regions = [];
    if (view.focus) {
      // Chapter ownership belongs in the directory/text, not in relationship fences.
      boxes = placeNodes(
        [view.focus, ...view.knowledgeNodes.filter((node) => node.id !== view.focus.id)],
        compact ? { x: 24, y: 30 } : { x: 40, y: 40 },
        compact ? 1 : 3,
        !compact,
      );
    } else {
      const macro = placeNodes(
        model.chapters.map((chapter) => ({ id: chapter.id, position: chapter.overview?.position })),
        compact ? { x: 32, y: 38 } : { x: 70, y: 60 },
        compact ? 1 : 3,
        !compact,
      );
      boxes = macro.map((box, index) => ({
        ...box,
        kind: 'chapter',
        chapter: model.chapters[index],
        node: model.chapters[index].overview,
        x: box.x,
        y: box.y,
        width: 210,
        height: 88,
      }));
    }
    const maxX = Math.max(
      compact ? 300 : 700,
      ...boxes.map((box) => box.x + box.width + 45),
      ...regions.map((region) => region.x + region.width + 35),
    );
    const maxY = Math.max(
      compact ? 200 : 390,
      ...boxes.map((box) => box.y + box.height + 40),
      ...regions.map((region) => region.y + region.height + 35),
    );
    return { boxes, regions, width: maxX, height: maxY };
  }
  function render({ container, nodes = [], edges = [], course = {}, onOpenOverview } = {}) {
    if (!container || !root?.document) return null;
    container.courseStructureController?.destroy();
    const document = container.ownerDocument;
    const model = buildModel(nodes, edges);
    let state = initialState();
    const history = [];
    const camera = { x: 0, y: 0, zoom: 1 };
    let currentLayout;
    let drag = null;
    let pickerChapterId = '';
    let pickerQuery = '';
    let pickerPage = 0;
    let searchPage = 0;
    const filterButtons = new Map();
    const make = (tag, value, className) => {
      const element = document.createElement(tag);
      if (value !== undefined) element.textContent = value;
      if (className) element.className = className;
      return element;
    };
    const svgNode = (tag, attributes, text) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes || {}).forEach(([key, value]) =>
        element.setAttribute(key, String(value)),
      );
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (label, action, className) => {
      const element = make('button', label, className);
      element.type = 'button';
      element.addEventListener('click', action);
      return element;
    };
    const shell = make('section', undefined, 'course-structure');
    shell.setAttribute('aria-label', '课程知识结构');
    const toolbar = make('div', undefined, 'course-structure-toolbar');
    const search = make('input');
    search.type = 'search';
    search.placeholder = '查找知识板块或知识点';
    search.setAttribute('aria-label', '查找课程知识点');
    const status = make('p', '', 'course-structure-status');
    status.setAttribute('role', 'status');
    const results = make('div', undefined, 'course-structure-search-results');
    results.hidden = true;
    const searchPanel = make('section', undefined, 'course-structure-search-panel');
    searchPanel.hidden = true;
    searchPanel.setAttribute('aria-label', '课程查找结果');
    const searchSummary = make('p', '', 'course-structure-search-summary');
    searchSummary.setAttribute('role', 'status');
    const searchPaging = make(
      'div',
      undefined,
      'course-structure-picker-paging course-structure-search-paging',
    );
    const previousSearchPage = button(
      '上一页',
      () => {
        searchPage -= 1;
        renderSearch();
      },
      'course-structure-search-previous',
    );
    const nextSearchPage = button(
      '下一页',
      () => {
        searchPage += 1;
        renderSearch();
      },
      'course-structure-search-next',
    );
    const searchPageCount = make('span');
    searchPaging.append(previousSearchPage, searchPageCount, nextSearchPage);
    searchPanel.append(searchSummary, results, searchPaging);
    toolbar.append(
      search,
      button('全局概览', () => navigate({ type: 'reset' })),
    );
    const columns = make('div', undefined, 'course-structure-columns');
    const graphArea = make('details', undefined, 'course-structure-graph-area');
    const graphSummary = make('summary', '查看关系图（辅助）');
    const cameraTools = make('div', undefined, 'course-structure-camera');
    cameraTools.append(
      button('重置图位置', () => fit()),
      button('−', () => zoom(0.82)),
      button('+', () => zoom(1.22)),
    );
    const viewer = make('div', undefined, 'course-structure-viewer');
    viewer.tabIndex = 0;
    viewer.setAttribute('aria-label', '知识图谱画布，拖动画布平移，滚轮缩放');
    const svg = svgNode('svg', { role: 'group', 'aria-label': `${course.name || '课程'}知识图谱` });
    const graph = svgNode('g');
    svg.append(graph);
    viewer.append(svg);
    const help = make('p', '拖动或用方向键移动；滚轮、+ / − 缩放。', 'course-structure-help');
    const legend = make('p', '实线箭头：学习顺序 · 虚线：补充联系', 'course-structure-legend');
    graphArea.append(graphSummary, cameraTools, legend, viewer, help);
    const sidebar = make('aside', undefined, 'course-structure-sidebar');
    sidebar.setAttribute('aria-label', '课程目录');
    const chapterList = make('nav', undefined, 'course-structure-chapters');
    chapterList.setAttribute('aria-label', '课程章节');
    chapterList.append(make('h2', '课程章节'));
    for (const chapter of model.chapters) {
      const item = button('', () => navigate({ type: 'select', id: chapter.id }));
      item.dataset.courseChapterId = chapter.id;
      item.append(
        make('strong', chapter.title),
        make('span', `包含 ${chapter.nodes.length} 个知识点`),
      );
      chapterList.append(item);
    }
    const picker = make('section', undefined, 'course-structure-picker');
    picker.setAttribute('aria-label', '选择知识点');
    const pickerHeading = make('div', undefined, 'course-structure-picker-heading');
    const pickerCount = make('small');
    pickerHeading.append(make('h2', '选择知识点'), pickerCount);
    const pickerChapter = make('select', undefined, 'course-structure-picker-chapter');
    pickerChapter.setAttribute('aria-label', '筛选知识点所属章节');
    const allChapters = make('option', '全部章节');
    allChapters.value = '';
    pickerChapter.append(allChapters);
    for (const chapter of model.chapters) {
      const option = make('option', `${chapter.title} · ${chapter.nodes.length} 个知识点`);
      option.value = chapter.id;
      pickerChapter.append(option);
    }
    const pickerSearch = make('input', undefined, 'course-structure-picker-search');
    pickerSearch.type = 'search';
    pickerSearch.placeholder = '名称、编号或别名';
    pickerSearch.setAttribute('aria-label', '筛选知识点');
    const pickerList = make('div', undefined, 'course-structure-picker-list');
    const pickerPaging = make('div', undefined, 'course-structure-picker-paging');
    const previousPage = button(
      '上一页',
      () => {
        pickerPage -= 1;
        renderPicker();
      },
      'course-structure-picker-previous',
    );
    const nextPage = button(
      '下一页',
      () => {
        pickerPage += 1;
        renderPicker();
      },
      'course-structure-picker-next',
    );
    const pageCount = make('span');
    pickerPaging.append(previousPage, pageCount, nextPage);
    picker.append(pickerHeading, pickerChapter, pickerSearch, pickerList, pickerPaging);
    const details = make('section', undefined, 'course-structure-details');
    details.setAttribute('aria-label', '课程与知识点详情');
    const currentContent = make('section', undefined, 'course-structure-current');
    currentContent.setAttribute('aria-label', '当前内容与直接关系');
    currentContent.tabIndex = -1;
    sidebar.append(chapterList, picker);
    currentContent.append(details, graphArea);
    columns.append(sidebar, currentContent);
    shell.append(toolbar, searchPanel, status, columns);
    container.replaceChildren(shell);
    const pickerSnapshot = () => ({
      chapterId: pickerChapterId,
      query: pickerQuery,
      page: pickerPage,
    });
    function applyPicker(value) {
      const pickerState = normalizePickerState(model, value);
      pickerChapterId = pickerState.chapterId;
      pickerQuery = pickerState.query;
      pickerPage = pickerState.page;
    }
    function navigate(action, options = {}) {
      const next = reduceState(state, action, model);
      if (JSON.stringify(next) === JSON.stringify(state) && !options.picker && !options.hideSearch)
        return;
      const previous = state;
      let nextPicker = pickerSnapshot();
      if (['select', 'expand'].includes(action.type)) {
        nextPicker = { chapterId: next.selectedChapterId, query: '', page: 0 };
      } else if (action.type === 'reset') {
        nextPicker = { chapterId: '', query: '', page: 0 };
      } else if (
        action.type === 'locate' ||
        (next.focusedNodeId && pickerChapterId && pickerChapterId !== next.selectedChapterId)
      ) {
        nextPicker = { chapterId: next.selectedChapterId, query: '', page: 0 };
      }
      nextPicker = normalizePickerState(model, options.picker || nextPicker);
      if (options.revealFocus && next.focusedNodeId) {
        const index = pickerMatches(model, nextPicker).findIndex(
          (node) => node.id === next.focusedNodeId,
        );
        if (index >= 0) nextPicker.page = Math.floor(index / PAGE_SIZE);
      }
      if (
        JSON.stringify(next) === JSON.stringify(state) &&
        JSON.stringify(nextPicker) === JSON.stringify(pickerSnapshot()) &&
        !(options.hideSearch && !searchPanel.hidden)
      )
        return;
      history.push({
        state: { ...state },
        picker: pickerSnapshot(),
        search: { query: search.value, page: searchPage, open: !searchPanel.hidden },
      });
      state = next;
      applyPicker(nextPicker);
      if (options.hideSearch) {
        searchPanel.hidden = true;
        results.hidden = true;
      }
      update(
        action.type !== 'filter' &&
          (action.type !== 'select' ||
            Boolean(previous.focusedNodeId) !== Boolean(state.focusedNodeId)),
      );
      if (
        ['focus', 'locate'].includes(action.type) &&
        next.focusedNodeId !== previous.focusedNodeId
      ) {
        currentContent.focus?.({ preventScroll: true });
        if (root.matchMedia?.('(max-width: 900px)').matches)
          currentContent.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }
    function back() {
      if (history.length) {
        const restoreBackFocus = document.activeElement === details.children[0];
        const previous = history.pop();
        state = previous.state;
        applyPicker(previous.picker);
        search.value = normalizeQuery(previous.search.query);
        searchPage = previous.search.page;
        renderSearch(previous.search.open);
        update(true);
        // The focused Back button was replaced; leave unrelated stable controls alone.
        if (restoreBackFocus) details.children[0]?.focus?.({ preventScroll: true });
      } else root.history.back();
    }
    function renderPicker() {
      applyPicker(pickerSnapshot());
      const page = paginateMatches(pickerMatches(model, pickerSnapshot()), pickerPage);
      pickerChapter.value = pickerChapterId;
      if (pickerSearch.value !== pickerQuery) pickerSearch.value = pickerQuery;
      pickerCount.textContent = `${page.total} 个`;
      pickerList.replaceChildren();
      for (const node of page.nodes) {
        const item = button('', () => navigate({ type: 'focus', id: node.id }));
        item.dataset.coursePointId = node.id;
        item.setAttribute('aria-pressed', String(state.focusedNodeId === node.id));
        item.append(make('small', node.id), make('span', node.title));
        pickerList.append(item);
      }
      if (!page.total) pickerList.append(make('p', '没有匹配的知识点。'));
      pickerList.scrollTop = 0;
      pickerPaging.hidden = page.pageCount <= 1;
      previousPage.disabled = pickerPage === 0;
      nextPage.disabled = pickerPage === page.pageCount - 1;
      pageCount.textContent = `${pickerPage + 1} / ${page.pageCount}`;
      for (const item of chapterList.children)
        if (item.dataset.courseChapterId)
          item.setAttribute(
            'aria-pressed',
            String(item.dataset.courseChapterId === state.selectedChapterId),
          );
    }
    pickerChapter.addEventListener('change', () => {
      const pickerState = normalizePickerState(model, { chapterId: pickerChapter.value });
      navigate(
        pickerState.chapterId ? { type: 'select', id: pickerState.chapterId } : { type: 'reset' },
        { picker: pickerState },
      );
      renderPicker();
    });
    pickerSearch.addEventListener('input', () => {
      pickerQuery = pickerSearch.value;
      pickerPage = 0;
      renderPicker();
    });
    function open(node) {
      if (onOpenOverview) {
        onOpenOverview(node);
        return;
      }
      root.location.href = `/knowledge?${new URLSearchParams({ course: course.slug || '', point: node.id })}`;
    }
    function applyCamera() {
      graph.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.zoom})`);
      viewer.classList.toggle('is-detailed', camera.zoom >= 1.1);
    }
    function fit() {
      if (!currentLayout) return;
      const width = Math.max(1, viewer.clientWidth);
      const height = Math.max(360, viewer.clientHeight);
      camera.zoom = Math.max(
        1,
        Math.min(1.15, (width - 26) / currentLayout.width, (height - 26) / currentLayout.height),
      );
      camera.x = (width - currentLayout.width * camera.zoom) / 2;
      camera.y = (height - currentLayout.height * camera.zoom) / 2;
      const focus = currentLayout.boxes.find((box) => box.id === state.focusedNodeId);
      if (focus) {
        camera.x = 16 - focus.x * camera.zoom;
        camera.y = 16 - focus.y * camera.zoom;
      }
      applyCamera();
    }
    function zoom(factor, point) {
      const previous = camera.zoom;
      const next = Math.max(0.12, Math.min(3, previous * factor));
      const pivot = point || { x: viewer.clientWidth / 2, y: viewer.clientHeight / 2 };
      camera.x = pivot.x - ((pivot.x - camera.x) * next) / previous;
      camera.y = pivot.y - ((pivot.y - camera.y) * next) / previous;
      camera.zoom = next;
      applyCamera();
    }
    function graphButton(box) {
      const selected =
        box.kind === 'chapter'
          ? state.selectedChapterId === box.id
          : state.focusedNodeId === box.id || state.searchTargetId === box.id;
      const level = box.kind === 'knowledge' ? nodeLevel(box.node) : '';
      const group = svgNode('g', {
        transform: `translate(${box.x} ${box.y})`,
        class: `course-structure-node is-${box.kind}${selected ? ' is-selected' : ''}${level ? ` is-${level}` : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-label': `${box.id} ${box.chapter?.title || box.node?.title || ''}`,
        'aria-pressed': selected,
      });
      group.append(
        svgNode('rect', {
          width: box.width,
          height: box.height,
          rx: box.kind === 'chapter' ? 16 : 11,
        }),
      );
      const title = box.chapter?.title || box.node?.title || box.id;
      const idSuffix = `${state.focusedNodeId === box.id ? ' · 当前点' : ''}${level === 'extension' ? ' · ◇ 拓展/选学' : ''}`;
      group.append(
        svgNode(
          'text',
          { x: 14, y: 25, class: 'course-structure-node-id' },
          `${abbreviateNodeId(box.id)}${idSuffix}`,
        ),
      );
      group.append(
        svgNode(
          'text',
          { x: 14, y: 49, class: 'course-structure-node-title' },
          title.length > 8 ? `${title.slice(0, 7)}…` : title,
        ),
      );
      const hint =
        box.kind === 'chapter'
          ? `${box.chapter.nodes.length} 个知识点${box.chapter.virtual ? ' · 暂无板块概览' : ''}`
          : '';
      if (hint)
        group.append(
          svgNode(
            'text',
            { x: 14, y: box.kind === 'chapter' ? 72 : 65, class: 'course-structure-node-detail' },
            hint,
          ),
        );
      group.append(svgNode('title', {}, `${box.id} · ${title}${idSuffix}`));
      group.courseStructureIdSuffix = idSuffix;
      const action = () => {
        if (drag?.moved) return;
        navigate({ type: box.kind === 'chapter' ? 'select' : 'focus', id: box.id });
      };
      group.addEventListener('click', action);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          action();
        }
      });
      return group;
    }
    function fitGraphIdLabel(group, box) {
      const label = group.children[1];
      if (typeof label?.getComputedTextLength !== 'function') return;
      const suffix = group.courseStructureIdSuffix;
      // Reserve extra breathing room for glyph overhang and a late font/style reflow.
      const available = box.width - 40;
      let limit = Math.min(box.id.length, 10);
      label.textContent = `${abbreviateNodeId(box.id, limit)}${suffix}`;
      // Closed details may not have measurable SVG text yet; reopening redraws and measures it.
      if (!label.getComputedTextLength()) {
        label.textContent = `${abbreviateNodeId(box.id)}${suffix}`;
        return;
      }
      const minimum = box.id.length <= 10 ? box.id.length : 5;
      while (label.getComputedTextLength() > available && limit > minimum) {
        limit -= 1;
        label.textContent = `${abbreviateNodeId(box.id, limit)}${suffix}`;
      }
      let suffixLength = suffix.length;
      while (label.getComputedTextLength() > available && suffixLength > 0) {
        suffixLength -= 1;
        label.textContent = `${abbreviateNodeId(box.id, limit)}${suffix.slice(0, suffixLength)}…`;
      }
    }
    function renderGraph(view, recompute) {
      if (recompute || !currentLayout)
        currentLayout = layout(model, view, { compact: viewer.clientWidth < 520 });
      graph.replaceChildren();
      for (const region of currentLayout.regions) {
        const group = svgNode('g', {
          class: `course-structure-region${region.satellite ? ' is-satellite' : ''}`,
        });
        group.append(
          svgNode('rect', {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            rx: 18,
          }),
        );
        group.append(
          svgNode(
            'text',
            { x: region.x + 18, y: region.y + 28 },
            `${region.title}${region.satellite ? ' · 一跳关联' : ''}`,
          ),
        );
        graph.append(group);
      }
      const positions = new Map(currentLayout.boxes.map((box) => [box.id, box]));
      const connections = [
        ...(!view.focus
          ? model.macroEdges.map((edge) => ({
              ...edge,
              source: chapterId(edge.source),
              target: chapterId(edge.target),
            }))
          : []),
        ...view.links,
      ];
      for (const edge of connections) {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!a || !b) continue;
        const x1 = a.x + a.width / 2;
        const y1 = a.y + a.height / 2;
        const x2 = b.x + b.width / 2;
        const y2 = b.y + b.height / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.hypot(dx, dy) || 1;
        const inset = (box) =>
          Math.min(
            box.width / 2 / (Math.abs(dx) / distance || 1e-9),
            box.height / 2 / (Math.abs(dy) / distance || 1e-9),
            distance / 2,
          );
        const ai = inset(a);
        const bi = inset(b);
        const sx = x1 + (dx / distance) * ai;
        const sy = y1 + (dy / distance) * ai;
        const tx = x2 - (dx / distance) * bi;
        const ty = y2 - (dy / distance) * bi;
        const group = svgNode('g', {
          class: `course-structure-link is-${edge.type}${edge.active === false ? ' is-muted' : ''}`,
        });
        group.append(svgNode('line', { x1: sx, y1: sy, x2: tx, y2: ty }));
        if (edge.type === 'ordered') {
          const angle = Math.atan2(dy, dx);
          const size = 8;
          group.append(
            svgNode('path', {
              d: `M ${tx} ${ty} L ${tx - size * Math.cos(angle - 0.45)} ${ty - size * Math.sin(angle - 0.45)} L ${tx - size * Math.cos(angle + 0.45)} ${ty - size * Math.sin(angle + 0.45)} Z`,
            }),
          );
        }
        group.append(
          svgNode('title', {}, `${edgeLabel(edge)}${edge.note ? `：${edge.note}` : ''}`),
        );
        // The readable legend and relationship cards carry labels outside SVG nodes.
        graph.append(group);
      }
      for (const box of currentLayout.boxes) {
        const group = graphButton(box);
        graph.append(group);
        fitGraphIdLabel(group, box);
      }
      if (recompute) fit();
      else applyCamera();
    }
    function renderDetails(view) {
      filterButtons.clear();
      details.replaceChildren(button('返回', back, 'course-structure-back'));
      if (view.focus && state.selectedNodeId === view.focus.id) {
        const node = view.focus;
        details.append(
          make('small', `所属章节：${view.expanded.title} · ${node.id}`),
          make('h2', node.title),
        );
        const overview = root.FreeBbsKnowledgeOverview?.model(node, course);
        const metadata = make('dl', undefined, 'course-structure-metadata');
        for (const [label, value] of [
          ['类型', overview?.type],
          ['层级', overview?.level],
          ['难度', overview?.difficulty],
          ['重要程度', overview?.importance],
          ['建议学习时长', overview?.duration],
        ]) {
          if (value) metadata.append(make('dt', label), make('dd', String(value)));
        }
        const actions = make('div', undefined, 'course-structure-point-actions');
        actions.append(
          button('学习概览', () => open(node), 'course-structure-primary'),
          button('返回章节目录', () => navigate({ type: 'unfocus' })),
        );
        details.append(actions);
        details.append(make('h3', '当前点的直接关系'));
        const filters = make('div', undefined, 'course-structure-filters');
        for (const [value, label] of [
          ['all', '全部'],
          ['ordered', '学习顺序'],
          ['related', '补充关联'],
        ]) {
          if (value !== 'all' && !view.links.some((edge) => edge.type === value)) continue;
          const toggle = button(label, () => {
            navigate({ type: 'filter', value });
            filterButtons.get(value)?.focus?.({ preventScroll: true });
          });
          toggle.dataset.courseRelationFilter = value;
          filterButtons.set(value, toggle);
          toggle.setAttribute('aria-pressed', String(state.filter === value));
          filters.append(toggle);
        }
        details.append(filters);
        const related = make('div', undefined, 'course-structure-relations');
        const groups = relationGroups(view).filter((group) => group.items.length);
        for (const group of groups) {
          const section = make('section', undefined, 'course-structure-relation-group');
          section.dataset.relationGroup = group.key;
          section.append(make('h4', group.title));
          for (const { node: target, edges: links } of group.items) {
            const owner = model.chapters.find((item) => item.id === chapterId(target.id));
            const item = make('div', undefined, 'course-structure-relation-item');
            const entry = button(target.title, () => navigate({ type: 'focus', id: target.id }));
            entry.dataset.courseRelatedId = target.id;
            item.append(entry, make('small', `所属章节：${owner.title} · ${target.id}`));
            for (const note of new Set(links.map((link) => link.note).filter(Boolean)))
              item.append(make('p', note));
            section.append(item);
          }
          related.append(section);
        }
        if (!view.links.length)
          related.append(make('p', '尚未发布直接关系，可从目录选择其他知识点。'));
        details.append(related);
        details.append(
          make(
            'p',
            '仅依据课程组发布的学习顺序和补充联系，不表示必须先修。',
            'course-structure-help',
          ),
        );
        if (metadata.childNodes.length || node.summary) {
          const information = make('details', undefined, 'course-structure-information');
          information.append(make('summary', '知识点信息'));
          if (node.summary) information.append(make('p', node.summary));
          if (metadata.childNodes.length) information.append(metadata);
          details.append(information);
        }
        return;
      }
      const chapter = model.chapters.find((item) => item.id === state.selectedChapterId);
      if (chapter) {
        details.append(make('small', `${chapter.id} · 知识板块`), make('h2', chapter.title));
        details.append(
          make(
            'p',
            chapter.overview?.summary ||
              (chapter.virtual ? '本章已有知识点，板块概览尚未发布。' : '本章知识概览。'),
          ),
        );
        details.append(
          make('p', `本章包含 ${chapter.nodes.length} 个知识点，请从目录选择具体内容。`),
        );
        const levels = { core: 0, general: 0, extension: 0, unknown: 0 };
        for (const node of chapter.nodes) levels[nodeLevel(node) || 'unknown'] += 1;
        if (levels.core || levels.general || levels.extension)
          details.append(
            make(
              'p',
              `核心 ${levels.core} · 一般 ${levels.general} · 拓展 ${levels.extension}${levels.unknown ? ` · 未标注 ${levels.unknown}` : ''}`,
            ),
          );
        if (chapter.overview) details.append(button('查看板块概览', () => open(chapter.overview)));
      } else {
        details.append(make('small', '课程概览'), make('h2', course.name || '课程知识结构'));
        if (course.description || course.summary)
          details.append(make('p', course.description || course.summary));
        const count = model.chapters.reduce((sum, item) => sum + item.nodes.length, 0);
        details.append(make('p', `${model.chapters.length} 个知识板块 · ${count} 个知识点`));
        const metadata = make('dl', undefined, 'course-structure-metadata');
        for (const [label, value] of [
          ['学分', course.credits],
          ['推荐修读学期', course.recommendedSemester],
          ['授课教师', course.teacher || course.teachers],
        ])
          if (value !== undefined && value !== '')
            metadata.append(
              make('dt', label),
              make('dd', Array.isArray(value) ? value.join('、') : String(value)),
            );
        if (metadata.childNodes.length) details.append(metadata);
      }
    }
    function update(recompute = true) {
      const view = viewModel(model, state);
      shell.classList.toggle('has-focus', Boolean(view.focus));
      renderGraph(view, recompute);
      renderDetails(view);
      renderPicker();
      graphSummary.textContent = view.focus
        ? '查看当前点直连关系图（辅助）'
        : '查看课程组发布的板块顺序图';
      legend.textContent =
        !view.focus && !model.macroEdges.length
          ? '尚未发布板块之间的学习顺序或补充联系。'
          : '实线箭头：学习顺序 · 虚线：补充联系';
      status.textContent = !model.chapters.length
        ? '课程知识图谱尚未发布。'
        : view.focus
          ? `聚焦 ${view.focus.title} · ${view.knowledgeNodes.length - 1} 个直接连接知识点${view.satellites.length ? ` · ${view.satellites.length} 个关联板块` : ''}`
          : '章节概览 · 选择一个知识点查看关联';
    }
    function renderSearch(visible = true) {
      const query = normalizeQuery(search.value);
      const page = paginateMatches(searchNodes(model, query), searchPage);
      searchPage = page.page;
      searchPanel.hidden = !visible || !query.trim();
      results.replaceChildren();
      results.hidden = searchPanel.hidden;
      searchSummary.textContent = `共 ${page.total} 个结果 · 显示 ${page.start}–${page.end}`;
      for (const node of page.nodes)
        results.append(
          button(`${node.id} · ${node.title}`, () => {
            navigate(
              {
                type: isChapterNode(node) ? 'select' : 'locate',
                id: isChapterNode(node) ? chapterId(node.id) : node.id,
              },
              {
                picker: {
                  chapterId: chapterId(node.id),
                  query: isChapterNode(node) ? '' : query,
                  page: 0,
                },
                revealFocus: true,
                hideSearch: true,
              },
            );
            details.scrollTop = 0;
          }),
        );
      if (!page.total && query.trim()) results.append(make('p', '未找到匹配的已发布知识点。'));
      results.scrollTop = 0;
      searchPaging.hidden = page.pageCount <= 1;
      previousSearchPage.disabled = searchPage === 0;
      nextSearchPage.disabled = searchPage === page.pageCount - 1;
      searchPageCount.textContent = `${searchPage + 1} / ${page.pageCount}`;
    }
    search.addEventListener('input', () => {
      searchPage = 0;
      renderSearch();
    });
    graphArea.addEventListener('toggle', () => {
      if (graphArea.open) {
        svg.setAttribute(
          'viewBox',
          `0 0 ${Math.max(1, viewer.clientWidth)} ${Math.max(1, viewer.clientHeight)}`,
        );
        renderGraph(viewModel(model, state), true);
      }
    });
    viewer.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = viewer.getBoundingClientRect();
        zoom(event.deltaY < 0 ? 1.12 : 0.89, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      { passive: false },
    );
    viewer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.course-structure-node')) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
        moved: false,
      };
      viewer.setPointerCapture(event.pointerId);
      viewer.classList.add('is-dragging');
    });
    viewer.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
      camera.x = drag.cameraX + dx;
      camera.y = drag.cameraY + dy;
      applyCamera();
    });
    const stopDrag = () => {
      drag = null;
      viewer.classList.remove('is-dragging');
    };
    viewer.addEventListener('pointerup', stopDrag);
    viewer.addEventListener('pointercancel', stopDrag);
    viewer.addEventListener('keydown', (event) => {
      if (event.target !== viewer) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.22);
      } else if (event.key === '-') {
        event.preventDefault();
        zoom(0.82);
      } else if (event.key === 'Home') {
        event.preventDefault();
        fit();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        camera.x += event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0;
        camera.y += event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0;
        applyCamera();
      }
    });
    let previousWidth = viewer.clientWidth;
    let previousHeight = viewer.clientHeight;
    const observer = root.ResizeObserver
      ? new root.ResizeObserver(() => {
          const width = viewer.clientWidth;
          const height = viewer.clientHeight;
          svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
          if (width && previousWidth < 520 !== width < 520)
            renderGraph(viewModel(model, state), true);
          else if (width && (previousWidth !== width || previousHeight !== height)) fit();
          previousWidth = width;
          previousHeight = height;
        })
      : null;
    observer?.observe(viewer);
    svg.setAttribute(
      'viewBox',
      `0 0 ${Math.max(1, viewer.clientWidth)} ${Math.max(1, viewer.clientHeight)}`,
    );
    update();
    const controller = {
      selectChapter: (id) => navigate({ type: 'select', id }),
      expandChapter: (id) => navigate({ type: 'expand', id }),
      focusNode: (id) => navigate({ type: 'focus', id }),
      clearFocus: () => navigate({ type: 'unfocus' }),
      reset: () => navigate({ type: 'reset' }),
      getState: () => ({ ...state }),
      getPickerState: () => pickerSnapshot(),
      destroy: () => {
        observer?.disconnect();
        shell.remove();
        if (container.courseStructureController === controller)
          delete container.courseStructureController;
      },
    };
    container.courseStructureController = controller;
    return controller;
  }
  return {
    isValidNodeId,
    chapterId,
    isChapterNode,
    abbreviateNodeId,
    nodeLevel,
    buildModel,
    initialState,
    reduceState,
    viewModel,
    layout,
    searchNodes,
    relationGroups,
    paginateMatches,
    normalizePickerState,
    render,
  };
});
