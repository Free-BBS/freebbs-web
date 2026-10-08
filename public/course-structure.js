/* Course structure reader. The editor and published graph data remain independent. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCourseStructure = api;
})(typeof window === 'undefined' ? null : window, (root) => {
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
          group.overview?.title ||
          group.nodes.find((node) => node.chapterTitle)?.chapterTitle ||
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
  function searchNodes(model, query) {
    const key = String(query || '')
      .trim()
      .toLocaleLowerCase();
    if (!key) return [];
    return model.nodes
      .filter((node) =>
        [
          node.id,
          node.title,
          node.chapterTitle,
          ...(Array.isArray(node.aliases) ? node.aliases : []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(key),
      )
      .slice(0, 40);
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
      const centerNodes = view.knowledgeNodes.filter(
        (node) => chapterId(node.id) === view.expanded.id,
      );
      const central = placeNodes(
        centerNodes,
        compact ? { x: 32, y: 70 } : { x: 72, y: 80 },
        compact ? 1 : 3,
        !compact,
      );
      const height = Math.max(140, ...central.map((box) => box.y + box.height));
      const centerRight = Math.max(
        compact ? 268 : 320,
        ...central.map((box) => box.x + box.width + 20),
      );
      regions.push({
        id: view.expanded.id,
        title: view.expanded.title,
        x: compact ? 12 : 48,
        y: compact ? 18 : 28,
        width: centerRight - (compact ? 12 : 48),
        height: height - (compact ? 18 : 28) + 24,
        satellite: false,
      });
      boxes.push(...central);
      let satelliteY = compact ? height + 50 : 28;
      for (const group of view.satellites) {
        const groupTop = satelliteY;
        const satellites = placeNodes(
          group.nodes,
          { x: compact ? 32 : centerRight + 64, y: satelliteY + 58 },
          compact ? 1 : 2,
          !compact,
        );
        const groupHeight = Math.max(
          148,
          ...satellites.map((box) => box.y + box.height - groupTop + 20),
        );
        const satelliteRight = Math.max(
          compact ? 268 : centerRight + 315,
          ...satellites.map((box) => box.x + box.width + 25),
        );
        regions.push({
          id: group.id,
          title: group.title,
          x: compact ? 12 : centerRight + 36,
          y: satelliteY,
          width: satelliteRight - (compact ? 12 : centerRight + 36),
          height: groupHeight,
          satellite: true,
        });
        boxes.push(...satellites);
        satelliteY += groupHeight + 26;
      }
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
    const pickerPageSize = 40;
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
    toolbar.append(
      search,
      button('全局概览', () => navigate({ type: 'reset' })),
      button('适应全图', () => fit()),
      button('−', () => zoom(0.82)),
      button('+', () => zoom(1.22)),
    );
    const columns = make('div', undefined, 'course-structure-columns');
    const graphArea = make('div', undefined, 'course-structure-graph-area');
    const viewer = make('div', undefined, 'course-structure-viewer');
    viewer.tabIndex = 0;
    viewer.setAttribute('aria-label', '知识图谱画布，拖动画布平移，滚轮缩放');
    const svg = svgNode('svg', { role: 'group', 'aria-label': `${course.name || '课程'}知识图谱` });
    const graph = svgNode('g');
    svg.append(graph);
    viewer.append(svg);
    const help = make('p', '选择一个知识点，查看它的直接关联。', 'course-structure-help');
    graphArea.append(viewer, help);
    const sidebar = make('div', undefined, 'course-structure-sidebar');
    const picker = make('section', undefined, 'course-structure-picker');
    picker.setAttribute('aria-label', '选择知识点');
    const pickerHeading = make('div', undefined, 'course-structure-picker-heading');
    const pickerCount = make('small');
    pickerHeading.append(make('h2', '知识点'), pickerCount);
    const pickerChapter = make('select', undefined, 'course-structure-picker-chapter');
    pickerChapter.setAttribute('aria-label', '筛选知识点所属章节');
    const allChapters = make('option', '全部章节');
    allChapters.value = '';
    pickerChapter.append(allChapters);
    for (const chapter of model.chapters) {
      const option = make('option', `${chapter.id} · ${chapter.title}`);
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
    const details = make('aside', undefined, 'course-structure-details');
    details.setAttribute('aria-label', '课程与知识点详情');
    sidebar.append(picker, details);
    columns.append(graphArea, sidebar);
    shell.append(toolbar, results, status, columns);
    container.replaceChildren(shell);
    function navigate(action) {
      const next = reduceState(state, action, model);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      const previous = state;
      history.push({ ...state });
      state = next;
      if (['select', 'expand'].includes(action.type)) {
        pickerChapterId = state.selectedChapterId;
        pickerQuery = '';
        pickerPage = 0;
      } else if (action.type === 'reset') {
        pickerChapterId = '';
        pickerQuery = '';
        pickerPage = 0;
      } else if (
        action.type === 'locate' ||
        (state.focusedNodeId && pickerChapterId && pickerChapterId !== state.selectedChapterId)
      ) {
        pickerChapterId = state.selectedChapterId;
        pickerQuery = '';
        pickerPage = 0;
      }
      update(
        action.type !== 'filter' &&
          (action.type !== 'select' ||
            Boolean(previous.focusedNodeId) !== Boolean(state.focusedNodeId)),
      );
    }
    function back() {
      if (history.length) {
        state = history.pop();
        pickerChapterId = state.selectedChapterId;
        pickerQuery = '';
        const selectedIndex =
          model.chapters
            .find((chapter) => chapter.id === pickerChapterId)
            ?.nodes.findIndex((node) => node.id === state.focusedNodeId) ?? -1;
        pickerPage = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / pickerPageSize);
        update(true);
      } else root.history.back();
    }
    function renderPicker() {
      const key = pickerQuery.trim().toLocaleLowerCase();
      const matches = model.nodes
        .filter(
          (node) =>
            !isChapterNode(node) &&
            (!pickerChapterId || chapterId(node.id) === pickerChapterId) &&
            (!key ||
              [node.id, node.title, ...(Array.isArray(node.aliases) ? node.aliases : [])]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase()
                .includes(key)),
        )
        .sort((left, right) => compare(left.id, right.id));
      const pages = Math.max(1, Math.ceil(matches.length / pickerPageSize));
      pickerPage = Math.max(0, Math.min(pickerPage, pages - 1));
      pickerChapter.value = pickerChapterId;
      if (pickerSearch.value !== pickerQuery) pickerSearch.value = pickerQuery;
      pickerCount.textContent = `${matches.length} 个`;
      pickerList.replaceChildren();
      for (const node of matches.slice(
        pickerPage * pickerPageSize,
        (pickerPage + 1) * pickerPageSize,
      )) {
        const item = button('', () => navigate({ type: 'focus', id: node.id }));
        item.dataset.coursePointId = node.id;
        item.setAttribute('aria-pressed', String(state.focusedNodeId === node.id));
        item.append(make('small', node.id), make('span', node.title));
        pickerList.append(item);
      }
      if (!matches.length) pickerList.append(make('p', '没有匹配的知识点。'));
      pickerList.scrollTop = 0;
      pickerPaging.hidden = pages <= 1;
      previousPage.disabled = pickerPage === 0;
      nextPage.disabled = pickerPage === pages - 1;
      pageCount.textContent = `${pickerPage + 1} / ${pages}`;
    }
    pickerChapter.addEventListener('change', () => {
      pickerChapterId = pickerChapter.value;
      pickerQuery = '';
      pickerPage = 0;
      navigate(pickerChapterId ? { type: 'select', id: pickerChapterId } : { type: 'reset' });
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
        0.18,
        Math.min(1.15, (width - 26) / currentLayout.width, (height - 26) / currentLayout.height),
      );
      camera.x = (width - currentLayout.width * camera.zoom) / 2;
      camera.y = (height - currentLayout.height * camera.zoom) / 2;
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
      group.append(
        svgNode(
          'text',
          { x: 14, y: 25, class: 'course-structure-node-id' },
          `${box.id}${level === 'extension' ? ' · ◇ 拓展/选学' : ''}`,
        ),
      );
      group.append(
        svgNode(
          'text',
          { x: 14, y: 49, class: 'course-structure-node-title' },
          title.length > 16 ? `${title.slice(0, 15)}…` : title,
        ),
      );
      const hint =
        box.kind === 'chapter'
          ? `${box.chapter.nodes.length} 个知识点${box.chapter.virtual ? ' · 暂无板块概览' : ''}`
          : (box.node.summary || '').slice(0, 20);
      if (hint)
        group.append(
          svgNode(
            'text',
            { x: 14, y: box.kind === 'chapter' ? 72 : 65, class: 'course-structure-node-detail' },
            hint,
          ),
        );
      group.append(svgNode('title', {}, `${box.id} · ${title}`));
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
        if (view.focus)
          group.append(
            svgNode('text', { x: (sx + tx) / 2, y: (sy + ty) / 2 - 7 }, edgeLabel(edge)),
          );
        graph.append(group);
      }
      for (const box of currentLayout.boxes) graph.append(graphButton(box));
      if (recompute) fit();
      else applyCamera();
    }
    function renderDetails(view) {
      details.replaceChildren(button('返回', back, 'course-structure-back'));
      if (view.focus && state.selectedNodeId === view.focus.id) {
        const node = view.focus;
        details.append(
          make('small', `${node.id} · ${view.expanded.title}`),
          make('h2', node.title),
        );
        if (node.summary) details.append(make('p', node.summary));
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
        if (metadata.childNodes.length) details.append(metadata);
        details.append(
          button('学习概览', () => open(node), 'course-structure-primary'),
          button('返回章节图', () => navigate({ type: 'unfocus' })),
        );
        details.append(make('h3', '直接连接'));
        const filters = make('div', undefined, 'course-structure-filters');
        for (const [value, label] of [
          ['all', '全部'],
          ['ordered', '学习顺序'],
          ['related', '补充关联'],
        ]) {
          if (value !== 'all' && !view.links.some((edge) => edge.type === value)) continue;
          const toggle = button(label, () => navigate({ type: 'filter', value }));
          toggle.setAttribute('aria-pressed', String(state.filter === value));
          filters.append(toggle);
        }
        details.append(filters);
        const related = make('div', undefined, 'course-structure-relations');
        const neighborIds = [
          ...new Set(
            view.links.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== node.id),
          ),
        ];
        for (const id of neighborIds) {
          const target = model.byId.get(id);
          const links = view.links.filter((edge) => edge.source === id || edge.target === id);
          const item = make('div');
          item.append(
            button(`${target.id} · ${target.title}`, () => navigate({ type: 'focus', id })),
          );
          item.append(make('small', [...new Set(links.map(edgeLabel))].join(' · ')));
          for (const link of links) if (link.note) item.append(make('p', link.note));
          related.append(item);
        }
        if (!neighborIds.length) related.append(make('p', '当前知识点暂无已发布的直接连接。'));
        details.append(related);
        details.append(
          make(
            'p',
            '学习顺序用于导航；补充关联保留课程组当前发布的说明。',
            'course-structure-help',
          ),
        );
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
        details.append(make('p', `${chapter.nodes.length} 个知识点`));
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
      renderGraph(view, recompute);
      renderDetails(view);
      renderPicker();
      status.textContent = !model.chapters.length
        ? '课程知识图谱尚未发布。'
        : view.focus
          ? `聚焦 ${view.focus.title} · ${view.knowledgeNodes.length - 1} 个直接连接知识点${view.satellites.length ? ` · ${view.satellites.length} 个关联板块` : ''}`
          : '章节概览 · 选择一个知识点查看关联';
    }
    function onSearch() {
      const matches = searchNodes(model, search.value);
      results.replaceChildren();
      results.hidden = !search.value.trim();
      for (const node of matches)
        results.append(
          button(`${node.id} · ${node.title}`, () => {
            navigate({
              type: isChapterNode(node) ? 'select' : 'locate',
              id: isChapterNode(node) ? chapterId(node.id) : node.id,
            });
            results.hidden = true;
            search.value = '';
            details.scrollTop = 0;
          }),
        );
      if (!matches.length && search.value.trim())
        results.append(make('p', '未找到匹配的已发布知识点。'));
    }
    search.addEventListener('input', onSearch);
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
    nodeLevel,
    buildModel,
    initialState,
    reduceState,
    viewModel,
    layout,
    searchNodes,
    render,
  };
});
