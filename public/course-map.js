(() => {
  const mapPage = document.querySelector('[data-course-map-page]');
  const editorPage = document.querySelector('[data-course-map-editor]');

  if (!mapPage && !editorPage) {
    return;
  }

  const app = window.freeBbsApp;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const NODE_LABEL_WIDTH = 230;
  const NODE_LABEL_HEIGHT = 112;
  const NODE_DOT_RADIUS = 11;
  const READER_FIT_MIN_WIDTH = 900;
  const READER_FIT_MAX_SCALE = 1.75;
  const EDITOR_CANVAS_INSET_X = editorPage ? 96 : 0;
  const EDITOR_CANVAS_INSET_Y = editorPage ? 104 : 0;
  const PROGRESS_STORAGE_KEY = 'free_bbs_course_progress_v1';
  const CURRENT_LEARNING_STORAGE_KEY = 'free_bbs_current_learning_node_v1';
  const SIGNALS_CHAPTER_TITLES = {
    'SS-01': '信号与系统基础',
    'SS-02': '连续系统时域分析',
    'SS-03': 'Fourier 分析',
    'SS-04': 'Laplace 与连续系统',
    'SS-05': '系统响应与信号处理',
    'SS-06': '信号空间与相关分析',
    'SS-07': '离散系统时域分析',
    'SS-08': 'z 变换与数字系统',
    'SS-11': '反馈系统',
    'SS-12': '状态空间',
  };
  const state = {
    course: null,
    nodes: [],
    edges: [],
    backgroundUrl: '',
    selectedNodeId: '',
    creatingNode: false,
    edgeTool: '',
    edgeSource: '',
    drag: null,
    suppressClickUntil: 0,
    activePanelId: '',
    focusedNodeId: '',
    learningNodeId: '',
    activeChapterId: '',
    manualExpandedChapters: new Set(),
    manuallyCollapsedChapters: new Set(),
    learningNodeRevealed: false,
  };

  const canvas = document.getElementById('course-map-canvas');
  const scroller = document.getElementById('course-map-scroller');
  const status = document.getElementById('course-map-status');
  const nodeForm = document.getElementById('course-node-form');
  const saveState = document.getElementById('course-map-save-state');
  const nodePanel = document.getElementById('course-node-panel');
  const positionSaveQueues = new Map();
  let readerEdgeFrame = 0;
  let readerEdgeTimer = 0;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    status.textContent = message || '';
    status.classList.toggle('is-error', isError);
    status.classList.toggle('hidden', !message);
  }

  function setSaveState(message, isError = false) {
    if (!saveState) {
      return;
    }
    saveState.textContent = message || '';
    saveState.classList.toggle('is-error', isError);
  }

  function resolveBackgroundUrl(value = state.backgroundUrl) {
    return app.resolveAssetUrl?.(value) || value || '';
  }

  function setBackgroundSurface() {
    if (!canvas) {
      return;
    }
    const resolvedUrl = resolveBackgroundUrl();
    canvas.classList.toggle('has-custom-background', Boolean(resolvedUrl));
    if (resolvedUrl) {
      canvas.style.setProperty('--course-map-background-image', `url("${resolvedUrl}")`);
    } else {
      canvas.style.removeProperty('--course-map-background-image');
    }
    const preview = document.getElementById('course-map-background-preview');
    if (preview) {
      preview.classList.toggle('has-image', Boolean(resolvedUrl));
      preview.style.backgroundImage = resolvedUrl ? `url("${resolvedUrl}")` : '';
      preview.innerHTML = `<span>${resolvedUrl ? '当前地图背景' : '当前使用默认星图背景'}</span>`;
    }
    document
      .getElementById('course-map-background-clear')
      ?.toggleAttribute('disabled', !resolvedUrl);
  }

  function closeStudioPanels() {
    document.querySelectorAll('.course-map-studio-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });
    document
      .querySelectorAll('#course-edge-panel-toggle, #course-background-panel-toggle')
      .forEach((button) => {
        button.classList.remove('is-active');
        button.setAttribute('aria-expanded', 'false');
      });
    state.activePanelId = '';
  }

  function openStudioPanel(panelId, triggerId = '', allowToggle = false) {
    const panel = document.getElementById(panelId);
    if (!panel) {
      return;
    }
    const shouldClose =
      allowToggle && state.activePanelId === panelId && !panel.classList.contains('hidden');
    closeStudioPanels();
    if (shouldClose) {
      return;
    }
    panel.classList.remove('hidden');
    state.activePanelId = panelId;
    if (triggerId) {
      const trigger = document.getElementById(triggerId);
      trigger?.classList.add('is-active');
      trigger?.setAttribute('aria-expanded', 'true');
    }
  }

  function nodeById(nodeId) {
    return state.nodes.find((node) => node.id === nodeId) || null;
  }

  function knowledgeHref(nodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nodeId });
    return `/knowledge?${query.toString()}`;
  }

  function mapEditorHref() {
    return `/course-map-editor?course=${encodeURIComponent(courseSlug)}`;
  }

  function courseDirectoryHref() {
    return `/course?course=${encodeURIComponent(courseSlug)}`;
  }

  function markdownEditorHref(nodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nodeId });
    return `/markdown-editor?${query.toString()}`;
  }

  function readLocalJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function getLearningNodeId() {
    const current = readLocalJson(CURRENT_LEARNING_STORAGE_KEY);
    const currentNodeId = typeof current === 'string' ? current : current?.[courseSlug];
    if (currentNodeId && nodeById(currentNodeId)) {
      return currentNodeId;
    }

    const progress = readLocalJson(PROGRESS_STORAGE_KEY);
    const courseProgress = progress?.[courseSlug];
    if (!courseProgress || typeof courseProgress !== 'object') {
      return '';
    }

    const [latestReview] = Object.entries(courseProgress)
      .filter(([nodeId, entry]) => nodeById(nodeId) && entry?.status === 'review')
      .sort((left, right) =>
        String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')),
      );
    return latestReview?.[0] || '';
  }

  function chapterIdForNodeId(nodeId) {
    const match = String(nodeId || '').match(/^([A-Z][A-Z0-9]*-\d+)/);
    return (
      match?.[1] ||
      String(nodeId || '')
        .split('-')
        .slice(0, 2)
        .join('-')
    );
  }

  function chapterTitle(chapterId) {
    if (courseSlug === 'signals' && SIGNALS_CHAPTER_TITLES[chapterId]) {
      return SIGNALS_CHAPTER_TITLES[chapterId];
    }
    const chapterNumber = Number(chapterId.split('-').at(-1));
    return Number.isFinite(chapterNumber) ? `第 ${chapterNumber} 章` : chapterId;
  }

  function courseChapters() {
    const chaptersById = new Map();
    state.nodes.forEach((node) => {
      const chapterId = chapterIdForNodeId(node.id);
      if (!chaptersById.has(chapterId)) {
        chaptersById.set(chapterId, {
          id: chapterId,
          title: chapterTitle(chapterId),
          nodes: [],
        });
      }
      chaptersById.get(chapterId).nodes.push(node);
    });

    return [...chaptersById.values()]
      .map((chapter) => ({
        ...chapter,
        nodes: chapter.nodes.sort((left, right) =>
          left.id.localeCompare(right.id, undefined, { numeric: true }),
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  }

  function readerViewModel() {
    const chapters = courseChapters();
    const focusedChapterId = state.focusedNodeId ? chapterIdForNodeId(state.focusedNodeId) : '';
    const focusedEdges = state.focusedNodeId
      ? state.edges.filter(
          (edge) => edge.source === state.focusedNodeId || edge.target === state.focusedNodeId,
        )
      : [];
    const neighborNodeIds = new Set(
      focusedEdges.map((edge) => (edge.source === state.focusedNodeId ? edge.target : edge.source)),
    );
    const sameChapterNeighborNodes = focusedChapterId
      ? chapters
          .find((chapter) => chapter.id === focusedChapterId)
          ?.nodes.filter((node) => neighborNodeIds.has(node.id)) || []
      : [];
    const sameChapterIncomingNodes = [];
    const sameChapterOutgoingNodes = [];
    const crossIncomingNodesByChapter = new Map();
    const crossOutgoingNodesByChapter = new Map();
    focusedEdges.forEach((edge) => {
      const isIncoming = edge.target === state.focusedNodeId;
      const neighborNodeId = isIncoming ? edge.source : edge.target;
      const neighborNode = nodeById(neighborNodeId);
      const neighborChapterId = chapterIdForNodeId(neighborNodeId);
      if (!neighborNode || !neighborChapterId) {
        return;
      }

      if (neighborChapterId === focusedChapterId) {
        (isIncoming ? sameChapterIncomingNodes : sameChapterOutgoingNodes).push(neighborNode);
        return;
      }

      const nodesByChapter = isIncoming ? crossIncomingNodesByChapter : crossOutgoingNodesByChapter;
      if (!nodesByChapter.has(neighborChapterId)) {
        nodesByChapter.set(neighborChapterId, []);
      }
      nodesByChapter.get(neighborChapterId).push(neighborNode);
    });
    [
      sameChapterIncomingNodes,
      sameChapterOutgoingNodes,
      ...crossIncomingNodesByChapter.values(),
      ...crossOutgoingNodesByChapter.values(),
    ].forEach((nodes) => {
      nodes.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
    });
    const learningChapterId = state.learningNodeId ? chapterIdForNodeId(state.learningNodeId) : '';
    const previewNodesByChapter = new Map();
    [crossIncomingNodesByChapter, crossOutgoingNodesByChapter].forEach((nodesByChapter) => {
      nodesByChapter.forEach((nodes, chapterId) => {
        if (!previewNodesByChapter.has(chapterId)) {
          previewNodesByChapter.set(chapterId, []);
        }
        previewNodesByChapter.get(chapterId).push(...nodes);
      });
    });
    previewNodesByChapter.forEach((nodes) => {
      nodes.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
    });

    const fullExpandedChapters = state.focusedNodeId
      ? new Set([focusedChapterId])
      : new Set([
          ...state.manualExpandedChapters,
          ...(learningChapterId ? [learningChapterId] : []),
        ]);
    const previewChapters = state.focusedNodeId
      ? new Set(
          [...previewNodesByChapter.keys()].filter(
            (chapterId) => !state.manuallyCollapsedChapters.has(chapterId),
          ),
        )
      : new Set();
    const incomingPreviewChapters = new Set(
      [...crossIncomingNodesByChapter.keys()].filter((chapterId) => previewChapters.has(chapterId)),
    );
    const outgoingPreviewChapters = new Set(
      [...crossOutgoingNodesByChapter.keys()].filter((chapterId) => previewChapters.has(chapterId)),
    );
    state.manuallyCollapsedChapters.forEach((chapterId) => fullExpandedChapters.delete(chapterId));
    const expandedChapters = new Set([...fullExpandedChapters, ...previewChapters]);

    const nodeDegrees = new Map(state.nodes.map((node) => [node.id, 0]));
    state.edges.forEach((edge) => {
      nodeDegrees.set(edge.source, (nodeDegrees.get(edge.source) || 0) + 1);
      nodeDegrees.set(edge.target, (nodeDegrees.get(edge.target) || 0) + 1);
    });

    return {
      chapters,
      focusedEdges,
      focusedChapterId,
      neighborNodeIds,
      sameChapterNeighborNodes,
      sameChapterIncomingNodes,
      sameChapterOutgoingNodes,
      crossIncomingNodesByChapter,
      crossOutgoingNodesByChapter,
      previewNodesByChapter,
      previewChapters,
      incomingPreviewChapters,
      outgoingPreviewChapters,
      fullExpandedChapters,
      expandedChapters,
      learningChapterId,
      nodeDegrees,
    };
  }

  function chapterDrift(index) {
    const xOffsets = [-12, 15, -4, 18, -16, 9, -8, 14, -13, 6];
    const yOffsets = [6, 25, -7, 18, 2, 30, -11, 13, 24, -4];
    return {
      x: xOffsets[index % xOffsets.length],
      y: yOffsets[index % yOffsets.length],
    };
  }

  function renderReaderNode(node, viewModel) {
    const isFocused = node.id === state.focusedNodeId;
    const isNeighbor = viewModel.neighborNodeIds.has(node.id);
    const isLearning = node.id === state.learningNodeId;
    const isDimmed = Boolean(state.focusedNodeId) && !isFocused && !isNeighbor;
    const classNames = [
      'course-map-topic',
      isFocused ? 'is-focused' : '',
      isNeighbor ? 'is-neighbor' : '',
      isLearning ? 'is-learning' : '',
      isDimmed ? 'is-dimmed' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const relationLabel = isFocused
      ? '当前聚焦'
      : isNeighbor
        ? '直接关联'
        : `${viewModel.nodeDegrees.get(node.id) || 0} 条关联`;

    return `
      <article class="${classNames}">
        <button
          class="course-map-topic-main"
          type="button"
          data-reader-node-id="${escapeHtml(node.id)}"
          aria-pressed="${String(isFocused)}"
          title="${escapeHtml(node.summary || node.title)}"
        >
          <span class="course-map-topic-code">${escapeHtml(node.id)}</span>
          <strong>${escapeHtml(node.title)}</strong>
          <span class="course-map-topic-meta">
            ${isLearning ? '<b>正在学习</b>' : ''}
            <i>${relationLabel}</i>
          </span>
        </button>
        <a
          class="course-map-topic-detail"
          href="${knowledgeHref(node.id)}"
          aria-label="打开${escapeHtml(node.title)}的知识详情"
          title="打开知识详情"
        >↗</a>
      </article>
    `;
  }

  function renderReaderChapter(chapter, index, viewModel, preview = null) {
    const isExpanded = viewModel.fullExpandedChapters.has(chapter.id);
    const isPreview = Boolean(preview) || viewModel.previewChapters.has(chapter.id);
    const isOpen = isExpanded || isPreview;
    const visibleNodes =
      preview?.nodes ||
      (isPreview ? viewModel.previewNodesByChapter.get(chapter.id) || [] : chapter.nodes);
    const learningNode = chapter.nodes.find((node) => node.id === state.learningNodeId);
    const drift = chapterDrift(index);
    const cardClasses = [
      'course-map-chapter-card',
      isExpanded ? 'is-expanded' : '',
      isPreview ? 'is-preview' : '',
      preview?.direction ? `is-${preview.direction}` : '',
      !isOpen ? 'is-collapsed' : '',
      chapter.id === viewModel.focusedChapterId ? 'is-focus-chapter' : '',
      learningNode ? 'has-learning-node' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const chapterPanelId = `course-map-chapter-${chapter.id.toLowerCase()}${preview?.direction ? `-${preview.direction}` : ''}`;
    const relationCopy =
      preview?.direction === 'incoming'
        ? `${chapter.id} → ${state.focusedNodeId}`
        : preview?.direction === 'outgoing'
          ? `${state.focusedNodeId} → ${chapter.id}`
          : `与 ${state.focusedNodeId} 直接相连`;

    return `
      <section
        class="${cardClasses}"
        data-reader-chapter="${escapeHtml(chapter.id)}"
        style="--chapter-drift-x:${drift.x}px;--chapter-drift-y:${drift.y}px"
      >
        <button
          class="course-map-chapter-toggle"
          type="button"
          data-chapter-toggle="${escapeHtml(chapter.id)}"
          aria-expanded="${String(isOpen)}"
          aria-controls="${chapterPanelId}"
        >
          <span class="course-map-chapter-orbit" aria-hidden="true"><i></i></span>
          <span class="course-map-chapter-copy">
            <small>${escapeHtml(chapter.id)} · Chapter</small>
            <strong>${escapeHtml(chapter.title)}</strong>
            <span>
              ${
                isPreview
                  ? `${visibleNodes.length} 个直接关联 · 全章 ${chapter.nodes.length} 个`
                  : `${chapter.nodes.length} 个知识点`
              }
              ${learningNode ? ` · 正在学习 ${escapeHtml(learningNode.id)}` : ''}
            </span>
          </span>
          <span class="course-map-chapter-action" aria-hidden="true">
            ${isExpanded ? '收起' : isPreview ? '展开全章' : '展开'} <i>${isPreview ? '↗' : '⌄'}</i>
          </span>
        </button>
        ${
          isPreview
            ? `<div class="course-map-preview-context">
                <span><i aria-hidden="true"></i>${escapeHtml(relationCopy)}</span>
                <button type="button" data-preview-close="${escapeHtml(chapter.id)}" aria-label="隐藏${escapeHtml(chapter.title)}的关联预览">隐藏</button>
              </div>`
            : ''
        }
        <div class="course-map-chapter-nodes${isPreview ? ' is-preview-list' : ''}" id="${chapterPanelId}" ${isOpen ? '' : 'hidden'}>
          ${isOpen ? visibleNodes.map((node) => renderReaderNode(node, viewModel)).join('') : ''}
        </div>
      </section>
    `;
  }

  function renderDirectoryChapter(chapter, isActive) {
    const learningNode = chapter.nodes.find((node) => node.id === state.learningNodeId);
    const chapterNumber = chapter.id.split('-').at(-1);
    const classNames = [
      'course-map-index-item',
      isActive ? 'is-active' : '',
      learningNode ? 'has-learning-node' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <button
        class="${classNames}"
        type="button"
        data-chapter-toggle="${escapeHtml(chapter.id)}"
        aria-pressed="${String(isActive)}"
      >
        <span class="course-map-index-number" aria-hidden="true">${escapeHtml(chapterNumber)}</span>
        <span class="course-map-index-copy">
          <small>${escapeHtml(chapter.id)}</small>
          <strong>${escapeHtml(chapter.title)}</strong>
          <span>${chapter.nodes.length} 个知识点${learningNode ? ` · 学到 ${escapeHtml(learningNode.id)}` : ''}</span>
        </span>
        <i aria-hidden="true">›</i>
      </button>
    `;
  }

  function renderDirectoryView(viewModel) {
    const fallbackChapter = viewModel.chapters[0] || null;
    const activeChapter =
      viewModel.chapters.find((chapter) => chapter.id === state.activeChapterId) ||
      viewModel.chapters.find((chapter) => chapter.id === viewModel.learningChapterId) ||
      fallbackChapter;
    if (!activeChapter) {
      return '';
    }

    state.activeChapterId = activeChapter.id;
    const learningNode = activeChapter.nodes.find((node) => node.id === state.learningNodeId);
    const primaryNode = learningNode || activeChapter.nodes[0];
    const remainingNodes = primaryNode
      ? activeChapter.nodes.filter((node) => node.id !== primaryNode.id)
      : activeChapter.nodes;
    const primaryRelationCount = primaryNode ? viewModel.nodeDegrees.get(primaryNode.id) || 0 : 0;

    return `
      <div class="course-map-directory-layout">
        <aside class="course-map-index-sidebar" aria-label="章节索引">
          <header class="course-map-index-heading">
            <small>COURSE INDEX</small>
            <strong>章节索引</strong>
            <span>${state.nodes.length} 个知识点 · ${viewModel.chapters.length} 个章节</span>
          </header>
          <div class="course-map-index-list">
            ${viewModel.chapters
              .map((chapter) => renderDirectoryChapter(chapter, chapter.id === activeChapter.id))
              .join('')}
          </div>
        </aside>

        <section class="course-map-directory-panel" aria-labelledby="course-map-directory-title">
          <header class="course-map-directory-heading">
            <span>
              <small>${escapeHtml(activeChapter.id)} · CHAPTER</small>
              <strong id="course-map-directory-title">${escapeHtml(activeChapter.title)}</strong>
              <i>${activeChapter.nodes.length} 个知识点</i>
            </span>
            <p>选择知识点后查看它的直接关联</p>
          </header>

          ${
            primaryNode
              ? `<div class="course-map-directory-current${learningNode ? ' is-learning' : ''}">
                  <div class="course-map-directory-current-copy">
                    <small>${learningNode ? 'CURRENT LEARNING · 正在学习' : 'CHAPTER START · 本章起点'}</small>
                    <span>${escapeHtml(primaryNode.id)}</span>
                    <h2>${escapeHtml(primaryNode.title)}</h2>
                    <p>${escapeHtml(primaryNode.summary || '从这个知识点进入学习，或查看它与课程中其他知识点的关系。')}</p>
                    <div>
                      <b>${primaryRelationCount}</b> 条直接关联
                      ${learningNode ? '<i>已为你定位到上次学习位置</i>' : ''}
                    </div>
                  </div>
                  <div class="course-map-directory-current-actions">
                    <button type="button" data-reader-node-id="${escapeHtml(primaryNode.id)}">查看知识关联</button>
                    <a href="${knowledgeHref(primaryNode.id)}">进入学习 ↗</a>
                  </div>
                </div>`
              : ''
          }

          <div class="course-map-directory-section-heading">
            <span>
              <small>CHAPTER CONTENTS</small>
              <strong>${primaryNode ? '本章其他知识点' : '本章知识点'}</strong>
            </span>
            <i>${remainingNodes.length} 项</i>
          </div>
          <div class="course-map-directory-nodes">
            ${remainingNodes.map((node) => renderReaderNode(node, viewModel)).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function renderFocusedChapter(chapter, viewModel) {
    const focusedNode = nodeById(state.focusedNodeId);
    if (!focusedNode) {
      return '';
    }
    const leftNodes = viewModel.sameChapterIncomingNodes;
    const rightNodes = viewModel.sameChapterOutgoingNodes;
    const hiddenNodeCount = Math.max(
      0,
      chapter.nodes.length - viewModel.sameChapterNeighborNodes.length - 1,
    );
    const learningNode = chapter.nodes.find((node) => node.id === state.learningNodeId);

    return `
      <section class="course-map-focused-chapter${learningNode ? ' has-learning-node' : ''}" data-reader-chapter="${escapeHtml(chapter.id)}">
        <header class="course-map-focused-heading">
          <span class="course-map-chapter-orbit" aria-hidden="true"><i></i></span>
          <span class="course-map-chapter-copy">
            <small>${escapeHtml(chapter.id)} · RELATION FOCUS</small>
            <strong>${escapeHtml(chapter.title)}</strong>
            <span>${viewModel.sameChapterNeighborNodes.length} 个同章直接关联 · ${hiddenNodeCount} 个无关知识点已折叠</span>
          </span>
        </header>
        <div class="course-map-focus-stage">
          <div class="course-map-focus-side is-left" aria-label="指进当前聚焦的同章知识点">
            <span class="course-map-focus-direction">指进当前聚焦 →</span>
            ${leftNodes.map((node) => renderReaderNode(node, viewModel)).join('')}
          </div>
          <div class="course-map-focus-center">
            <small>当前聚焦</small>
            ${renderReaderNode(focusedNode, viewModel)}
            <span>再次点击可打开知识点正文</span>
          </div>
          <div class="course-map-focus-side is-right" aria-label="由当前聚焦指出的同章知识点">
            <span class="course-map-focus-direction">当前聚焦指出 →</span>
            ${rightNodes.map((node) => renderReaderNode(node, viewModel)).join('')}
          </div>
        </div>
        <footer class="course-map-focus-summary">
          <span>仅显示与 ${escapeHtml(focusedNode.id)} 直接相连的本章知识点</span>
        </footer>
      </section>
    `;
  }

  function readerEdgePath(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const controlX = Math.max(70, Math.abs(dx) * 0.46);
      return `M ${source.x} ${source.y} C ${source.x + Math.sign(dx || 1) * controlX} ${source.y}, ${target.x - Math.sign(dx || 1) * controlX} ${target.y}, ${target.x} ${target.y}`;
    }
    const controlY = Math.max(70, Math.abs(dy) * 0.42);
    return `M ${source.x} ${source.y} C ${source.x} ${source.y + Math.sign(dy || 1) * controlY}, ${target.x} ${target.y - Math.sign(dy || 1) * controlY}, ${target.x} ${target.y}`;
  }

  function readerEdgeEndpoint(node, toward) {
    const dx = toward.x - node.x;
    const dy = toward.y - node.y;
    if (!dx && !dy) {
      return { x: node.x, y: node.y };
    }
    const horizontalScale = dx ? (node.width / 2 + 3) / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const verticalScale = dy ? (node.height / 2 + 3) / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const scale = Math.min(horizontalScale, verticalScale);
    return {
      x: node.x + dx * scale,
      y: node.y + dy * scale,
    };
  }

  function renderReaderEdges() {
    const edgeLayer = canvas?.querySelector('.course-map-reader-edges');
    if (!edgeLayer) {
      return;
    }
    const viewModel = readerViewModel();
    const nodeElements = new Map(
      [...canvas.querySelectorAll('[data-reader-node-id]')].map((element) => [
        element.dataset.readerNodeId,
        element,
      ]),
    );
    const canvasRect = canvas.getBoundingClientRect();
    const positionFor = (nodeId) => {
      const element = nodeElements.get(nodeId);
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - canvasRect.left + rect.width / 2,
        y: rect.top - canvasRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      };
    };
    const paths = viewModel.focusedEdges
      .map((edge, index) => {
        const source = positionFor(edge.source);
        const target = positionFor(edge.target);
        if (!source || !target) {
          return '';
        }
        const path = readerEdgePath(
          readerEdgeEndpoint(source, target),
          readerEdgeEndpoint(target, source),
        );
        return `
          <path class="course-map-edge-halo is-${edge.type}" d="${path}"></path>
          <path class="course-map-edge is-${edge.type}" d="${path}" ${
            edge.type === 'ordered' ? 'marker-end="url(#course-map-reader-arrow)"' : ''
          }></path>
          ${
            edge.type === 'ordered'
              ? `<path class="course-map-edge-pulse" d="${path}" pathLength="1" style="--edge-delay:${index * -0.72}s"></path>`
              : ''
          }
        `;
      })
      .join('');

    edgeLayer.setAttribute('width', String(canvas.scrollWidth));
    edgeLayer.setAttribute('height', String(canvas.scrollHeight));
    edgeLayer.setAttribute('viewBox', `0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);
    edgeLayer.innerHTML = `
      <defs>
        <marker id="course-map-reader-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
        <linearGradient id="course-map-signal-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop class="course-map-gradient-start" offset="0%"></stop>
          <stop class="course-map-gradient-middle" offset="52%"></stop>
          <stop class="course-map-gradient-end" offset="100%"></stop>
        </linearGradient>
      </defs>
      ${paths}
    `;
  }

  function queueReaderEdges() {
    window.cancelAnimationFrame(readerEdgeFrame);
    window.clearTimeout(readerEdgeTimer);
    readerEdgeFrame = window.requestAnimationFrame(renderReaderEdges);
    readerEdgeTimer = window.setTimeout(renderReaderEdges, 280);
  }

  function renderCrossRelations(direction, chapters, nodesByChapter, chapterIndex, viewModel) {
    if (!chapters.length) {
      return '';
    }
    const isIncoming = direction === 'incoming';
    const relationCount = chapters.reduce(
      (total, chapter) => total + (nodesByChapter.get(chapter.id)?.length || 0),
      0,
    );

    return `
      <section class="course-map-cross-relations is-${direction}" aria-label="${isIncoming ? '指进当前聚焦的跨章节关联' : '由当前聚焦指出的跨章节关联'}">
        <header>
          <small>${isIncoming ? 'INCOMING RELATIONS' : 'OUTGOING RELATIONS'}</small>
          <strong>${isIncoming ? '跨章节指进当前聚焦' : '当前聚焦指向跨章节'}</strong>
          <span>${chapters.length} 个章节 · ${relationCount} 个知识点</span>
        </header>
        <div class="course-map-cross-grid">
          ${chapters
            .map((chapter) =>
              renderReaderChapter(chapter, chapterIndex.get(chapter.id), viewModel, {
                direction,
                nodes: nodesByChapter.get(chapter.id) || [],
              }),
            )
            .join('')}
        </div>
      </section>
    `;
  }

  function renderReaderMap() {
    const viewModel = readerViewModel();
    const focusedChapter = viewModel.focusedChapterId
      ? viewModel.chapters.find((chapter) => chapter.id === viewModel.focusedChapterId)
      : null;
    const incomingCrossChapters = viewModel.chapters.filter((chapter) =>
      viewModel.incomingPreviewChapters.has(chapter.id),
    );
    const outgoingCrossChapters = viewModel.chapters.filter((chapter) =>
      viewModel.outgoingPreviewChapters.has(chapter.id),
    );
    const chapterIndex = new Map(viewModel.chapters.map((chapter, index) => [chapter.id, index]));
    const chapterContent = focusedChapter
      ? `
        <div class="course-map-focus-workspace${incomingCrossChapters.length || outgoingCrossChapters.length ? '' : ' has-no-external'}">
          ${renderCrossRelations(
            'incoming',
            incomingCrossChapters,
            viewModel.crossIncomingNodesByChapter,
            chapterIndex,
            viewModel,
          )}
          ${renderFocusedChapter(focusedChapter, viewModel)}
          ${renderCrossRelations(
            'outgoing',
            outgoingCrossChapters,
            viewModel.crossOutgoingNodesByChapter,
            chapterIndex,
            viewModel,
          )}
        </div>
      `
      : `
        ${renderDirectoryView(viewModel)}
      `;
    canvas.classList.remove('is-reader-fit');
    scroller?.classList.remove('is-reader-fit');
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.innerHTML = `
      <div class="course-map-background" aria-hidden="true"></div>
      <div class="course-map-grid" aria-hidden="true"></div>
      <svg class="course-map-edges course-map-reader-edges" aria-hidden="true"></svg>
      ${chapterContent}
    `;
    setBackgroundSurface();
    renderReaderHeader();
    queueReaderEdges();

    state.learningNodeRevealed = true;
  }

  function readerGraphLayout() {
    if (!mapPage || !scroller || !state.nodes.length) {
      return null;
    }

    const viewportWidth = scroller?.clientWidth || 1100;
    const viewportHeight = scroller?.clientHeight || 680;
    if (viewportWidth < READER_FIT_MIN_WIDTH) {
      return null;
    }

    const xValues = state.nodes.map((node) => node.position.x);
    const yValues = state.nodes.map((node) => node.position.y);
    const sourceMinX = Math.min(...xValues);
    const sourceMaxX = Math.max(...xValues);
    const sourceMinY = Math.min(...yValues);
    const sourceMaxY = Math.max(...yValues);
    const sourceWidth = Math.max(sourceMaxX - sourceMinX, 1);
    const sourceHeight = Math.max(sourceMaxY - sourceMinY, 1);
    const anchorMinX = NODE_LABEL_WIDTH / 2 + 40;
    const anchorMaxX = viewportWidth - NODE_LABEL_WIDTH / 2 - 40;
    const anchorMinY = NODE_LABEL_HEIGHT + 70;
    const anchorMaxY = viewportHeight - NODE_DOT_RADIUS - 58;
    const availableWidth = Math.max(anchorMaxX - anchorMinX, 1);
    const availableHeight = Math.max(anchorMaxY - anchorMinY, 1);
    const scale = Math.min(
      READER_FIT_MAX_SCALE,
      availableWidth / sourceWidth,
      availableHeight / sourceHeight,
    );

    return {
      width: viewportWidth,
      height: viewportHeight,
      scale,
      sourceCenterX: (sourceMinX + sourceMaxX) / 2,
      sourceCenterY: (sourceMinY + sourceMaxY) / 2,
      targetCenterX: (anchorMinX + anchorMaxX) / 2,
      targetCenterY: (anchorMinY + anchorMaxY) / 2,
    };
  }

  function displayPosition(node, layout = null) {
    if (!layout) {
      return node.position;
    }

    return {
      x: layout.targetCenterX + (node.position.x - layout.sourceCenterX) * layout.scale,
      y: layout.targetCenterY + (node.position.y - layout.sourceCenterY) * layout.scale,
    };
  }

  function mapDimensions(layout = null) {
    const viewportWidth = scroller?.clientWidth || 1100;
    const viewportHeight = scroller?.clientHeight || 680;
    if (layout) {
      return { width: layout.width, height: layout.height };
    }

    const trailingSpaceX = editorPage ? 180 : 54;
    const trailingSpaceY = editorPage ? 180 : 96;
    const maxX = Math.max(
      viewportWidth,
      1100,
      ...state.nodes.map(
        (node) => node.position.x + EDITOR_CANVAS_INSET_X + NODE_LABEL_WIDTH / 2 + trailingSpaceX,
      ),
    );
    const maxY = Math.max(
      viewportHeight,
      680,
      ...state.nodes.map(
        (node) => node.position.y + EDITOR_CANVAS_INSET_Y + NODE_DOT_RADIUS + trailingSpaceY,
      ),
    );
    return { width: maxX, height: maxY };
  }

  function orderedNodeSequence() {
    const orderedEdges = state.edges.filter((edge) => edge.type === 'ordered');
    const targets = new Set(orderedEdges.map((edge) => edge.target));
    const nextBySource = new Map();
    orderedEdges.forEach((edge) => {
      if (!nextBySource.has(edge.source)) {
        nextBySource.set(edge.source, edge.target);
      }
    });
    const positionedNodes = [...state.nodes].sort(
      (a, b) =>
        a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id),
    );
    const roots = positionedNodes.filter((node) => !targets.has(node.id));
    const sequence = [];
    const visited = new Set();

    [...roots, ...positionedNodes].forEach((root) => {
      let currentId = root.id;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        sequence.push(currentId);
        currentId = nextBySource.get(currentId);
      }
    });

    return new Map(sequence.map((id, index) => [id, index + 1]));
  }

  function edgePath(edge, layout = null) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) {
      return '';
    }
    const sourceCenter = displayPosition(source, layout);
    const targetCenter = displayPosition(target, layout);
    const boundaryPoint = (from, toward, radius) => {
      const dx = toward.x - from.x;
      const dy = toward.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const scale = radius / distance;
      return {
        x: from.x + dx * scale,
        y: from.y + dy * scale,
      };
    };
    const sourcePoint = boundaryPoint(sourceCenter, targetCenter, NODE_DOT_RADIUS);
    const targetPoint = boundaryPoint(targetCenter, sourceCenter, NODE_DOT_RADIUS + 6);
    const sourceX = sourcePoint.x;
    const sourceY = sourcePoint.y;
    const targetX = targetPoint.x;
    const targetY = targetPoint.y;
    const middleX = (sourceX + targetX) / 2;
    return `M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`;
  }

  function renderEdgesSvg(dimensions, layout = null) {
    return `
      <svg class="course-map-edges" width="${dimensions.width}" height="${dimensions.height}" aria-hidden="true">
        <defs>
          <marker id="course-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
          <linearGradient id="course-map-signal-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop class="course-map-gradient-start" offset="0%"></stop>
            <stop class="course-map-gradient-middle" offset="52%"></stop>
            <stop class="course-map-gradient-end" offset="100%"></stop>
          </linearGradient>
        </defs>
        ${state.edges
          .map(
            (edge, index) => `
          <path
            class="course-map-edge-halo is-${edge.type}"
            data-edge-index="${index}"
            d="${edgePath(edge, layout)}"
          ></path>
          <path
            class="course-map-edge is-${edge.type}"
            data-edge-index="${index}"
            d="${edgePath(edge, layout)}"
            ${edge.type === 'ordered' ? 'marker-end="url(#course-map-arrow)"' : ''}
          ></path>
          ${
            edge.type === 'ordered'
              ? `<path
                  class="course-map-edge-pulse"
                  data-edge-index="${index}"
                  d="${edgePath(edge, layout)}"
                  pathLength="1"
                  style="--edge-delay: ${index * -0.72}s"
                ></path>`
              : ''
          }
        `,
          )
          .join('')}
      </svg>
    `;
  }

  function renderMap() {
    if (!canvas) {
      return;
    }
    if (mapPage) {
      renderReaderMap();
      return;
    }
    const layout = readerGraphLayout();
    const dimensions = mapDimensions(layout);
    const sequence = orderedNodeSequence();
    canvas.classList.toggle('is-reader-fit', Boolean(layout));
    scroller?.classList.toggle('is-reader-fit', Boolean(layout));
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    canvas.innerHTML = `
      <div class="course-map-background" aria-hidden="true"></div>
      <div class="course-map-grid" aria-hidden="true"></div>
      ${renderEdgesSvg(dimensions, layout)}
      ${state.nodes
        .map((node) => {
          const selectedClass = node.id === state.selectedNodeId ? ' is-selected' : '';
          const sourceClass = node.id === state.edgeSource ? ' is-edge-source' : '';
          const documentClass = node.hasDocument ? ' has-document' : ' is-document-empty';
          const sequenceLabel = String(sequence.get(node.id) || 0).padStart(2, '0');
          const position = displayPosition(node, layout);
          return `
            <button
              class="course-map-node${selectedClass}${sourceClass}${documentClass}"
              type="button"
              data-node-id="${escapeHtml(node.id)}"
              style="left:${position.x}px;top:${position.y}px"
              aria-label="${escapeHtml(node.title)}，结点 ${escapeHtml(node.id)}${node.hasDocument ? '，已挂载文档' : ''}"
            >
              <span class="course-map-hologram">
                <span class="course-map-node-index" aria-hidden="true">${sequenceLabel}</span>
                <span class="course-map-node-copy">
                  <span class="course-map-node-id">${escapeHtml(node.id)}</span>
                  <strong>${escapeHtml(node.title)}</strong>
                </span>
                <span class="course-map-node-arrow" aria-hidden="true">↗</span>
              </span>
              <span class="course-map-beacon" aria-hidden="true">
                <span></span>
              </span>
            </button>
          `;
        })
        .join('')}
    `;
    setBackgroundSurface();
    bindNodeEvents();
    renderEdgeList();
  }

  function updateEdgeGeometry() {
    canvas?.querySelectorAll('[data-edge-index]').forEach((pathNode) => {
      pathNode.setAttribute('d', edgePath(state.edges[Number(pathNode.dataset.edgeIndex)]));
    });
  }

  function syncCanvasDimensions() {
    if (!canvas) {
      return;
    }
    const dimensions = mapDimensions();
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    const edgesSvg = canvas.querySelector('.course-map-edges');
    edgesSvg?.setAttribute('width', String(dimensions.width));
    edgesSvg?.setAttribute('height', String(dimensions.height));
  }

  function renderReaderHeader() {
    document.title = `FREE-BBS - ${state.course.name}知识地图`;
    const editLink = document.getElementById('course-map-edit-link');
    const directoryLink = document.getElementById('course-map-directory-link');
    editLink.href = mapEditorHref();
    editLink.classList.toggle('hidden', !state.course.canEditMap);
    if (directoryLink) {
      const returnToDirectory = Boolean(state.focusedNodeId);
      const label = returnToDirectory ? '返回课程知识点总览' : '返回学习世界';
      directoryLink.href = returnToDirectory ? courseDirectoryHref() : '/world';
      directoryLink.setAttribute('aria-label', label);
      directoryLink.title = label;
    }
  }

  function renderEditorHeader() {
    document.title = `FREE-BBS - 编辑${state.course.name}地图`;
    document.getElementById('course-editor-title').textContent = `编辑「${state.course.name}」地图`;
    document.getElementById('course-map-reader-link').href =
      `/course?course=${encodeURIComponent(courseSlug)}`;
  }

  async function createEdge(targetNodeId) {
    if (!state.edgeSource) {
      state.edgeSource = targetNodeId;
      setEdgeStatus(`已选择起点 ${targetNodeId}，请选择终点。`);
      renderMap();
      return;
    }
    if (state.edgeSource === targetNodeId) {
      setEdgeStatus('起点和终点不能相同。', true);
      return;
    }
    try {
      const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/edges`, {
        method: 'POST',
        body: JSON.stringify({
          source: state.edgeSource,
          target: targetNodeId,
          type: state.edgeTool,
        }),
      });
      state.edges.push(payload.edge);
      state.edgeSource = '';
      setEdgeStatus('连接已创建，可继续选择下一条连接的起点。');
      setSaveState('连接已创建');
      renderMap();
    } catch (error) {
      setEdgeStatus(error.message, true);
    }
  }

  function selectNode(nodeId) {
    const node = nodeById(nodeId);
    if (!node) {
      return;
    }
    state.selectedNodeId = nodeId;
    state.creatingNode = false;
    openStudioPanel('course-node-panel');
    nodePanel?.classList.remove('hidden');
    nodeForm?.classList.remove('hidden');
    document.getElementById('course-node-form-title').textContent = '编辑知识结点';
    const idInput = document.getElementById('course-node-id');
    idInput.value = node.id;
    idInput.readOnly = true;
    document.getElementById('course-node-title').value = node.title;
    document.getElementById('course-node-summary').value = node.summary || '';
    document.getElementById('course-node-x').value = node.position.x;
    document.getElementById('course-node-y').value = node.position.y;
    document.getElementById('course-delete-node').classList.remove('hidden');
    const documentLink = document.getElementById('course-document-edit-link');
    documentLink.href = markdownEditorHref(node.id);
    documentLink.classList.remove('hidden');
    setNodeMessage('');
    renderMap();
  }

  function bindNodeEvents() {
    canvas?.querySelectorAll('.course-map-node').forEach((nodeElement) => {
      nodeElement.addEventListener('click', (event) => {
        const nodeId = nodeElement.dataset.nodeId;
        if (Date.now() < state.suppressClickUntil) {
          event.preventDefault();
          return;
        }
        if (!editorPage) {
          window.location.href = knowledgeHref(nodeId);
          return;
        }
        if (state.edgeTool) {
          createEdge(nodeId);
          return;
        }
        selectNode(nodeId);
      });

      if (!editorPage) {
        return;
      }
      nodeElement.addEventListener('keydown', (event) => {
        const direction = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!direction || state.edgeTool) {
          return;
        }
        event.preventDefault();
        const node = nodeById(nodeElement.dataset.nodeId);
        if (!node) {
          return;
        }
        const previousPosition = { ...node.position };
        const step = event.shiftKey ? 12 : 1;
        node.position.x = Math.max(70, node.position.x + direction[0] * step);
        node.position.y = Math.max(NODE_LABEL_HEIGHT + 24, node.position.y + direction[1] * step);
        nodeElement.style.left = `${node.position.x}px`;
        nodeElement.style.top = `${node.position.y}px`;
        syncCanvasDimensions();
        updateEdgeGeometry();
        if (state.selectedNodeId === node.id) {
          document.getElementById('course-node-x').value = node.position.x;
          document.getElementById('course-node-y').value = node.position.y;
        }
        queuePositionSave(node, { ...node.position }, previousPosition);
      });
      nodeElement.addEventListener('pointerdown', (event) => {
        if (state.edgeTool || event.button !== 0) {
          return;
        }
        const node = nodeById(nodeElement.dataset.nodeId);
        if (!node) {
          return;
        }
        state.drag = {
          node,
          element: nodeElement,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: node.position.x,
          startY: node.position.y,
          moved: false,
        };
        nodeElement.setPointerCapture(event.pointerId);
        nodeElement.classList.add('is-dragging');
      });
      nodeElement.addEventListener('pointermove', (event) => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const dx = event.clientX - state.drag.startClientX;
        const dy = event.clientY - state.drag.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > 4) {
          state.drag.moved = true;
        }
        state.drag.node.position.x = Math.max(70, Math.round(state.drag.startX + dx));
        state.drag.node.position.y = Math.max(
          NODE_LABEL_HEIGHT + 24,
          Math.round(state.drag.startY + dy),
        );
        nodeElement.style.left = `${state.drag.node.position.x}px`;
        nodeElement.style.top = `${state.drag.node.position.y}px`;
        syncCanvasDimensions();
        updateEdgeGeometry();
      });
      nodeElement.addEventListener('pointerup', (event) => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const drag = state.drag;
        state.drag = null;
        nodeElement.classList.remove('is-dragging');
        if (nodeElement.hasPointerCapture(event.pointerId)) {
          nodeElement.releasePointerCapture(event.pointerId);
        }
        if (!drag.moved) {
          return;
        }
        state.suppressClickUntil = Date.now() + 260;
        const savedPosition = { ...drag.node.position };
        if (state.selectedNodeId === drag.node.id) {
          document.getElementById('course-node-x').value = savedPosition.x;
          document.getElementById('course-node-y').value = savedPosition.y;
        }
        queuePositionSave(drag.node, savedPosition, {
          x: drag.startX,
          y: drag.startY,
        });
      });
      const cancelDrag = () => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const drag = state.drag;
        state.drag = null;
        drag.node.position.x = drag.startX;
        drag.node.position.y = drag.startY;
        nodeElement.style.left = `${drag.startX}px`;
        nodeElement.style.top = `${drag.startY}px`;
        nodeElement.classList.remove('is-dragging');
        syncCanvasDimensions();
        updateEdgeGeometry();
        setSaveState('已取消移动');
      };
      nodeElement.addEventListener('pointercancel', cancelDrag);
      nodeElement.addEventListener('lostpointercapture', cancelDrag);
    });
  }

  function queuePositionSave(node, position, previousPosition) {
    setSaveState(`正在保存 ${node.id} 的位置…`);
    const previousQueue = positionSaveQueues.get(node.id) || Promise.resolve();
    const nextQueue = previousQueue
      .catch(() => {})
      .then(async () => {
        try {
          await updateNode(node, position);
          if (node.position.x === position.x && node.position.y === position.y) {
            setSaveState(
              `已保存 · ${new Date().toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}`,
            );
          }
        } catch (error) {
          if (node.position.x === position.x && node.position.y === position.y) {
            node.position = { ...previousPosition };
            renderMap();
          }
          setSaveState(error.message, true);
          setEdgeStatus(`位置保存失败：${error.message}`, true);
        }
      })
      .finally(() => {
        if (positionSaveQueues.get(node.id) === nextQueue) {
          positionSaveQueues.delete(node.id);
        }
      });
    positionSaveQueues.set(node.id, nextQueue);
  }

  function setNodeMessage(message, isError = false) {
    const messageNode = document.getElementById('course-node-message');
    if (messageNode) {
      messageNode.textContent = message || '';
      messageNode.classList.toggle('is-error', isError);
    }
  }

  function setEdgeStatus(message, isError = false) {
    const messageNode = document.getElementById('course-edge-status');
    if (messageNode) {
      messageNode.textContent = message || '';
      messageNode.classList.toggle('is-error', isError);
    }
  }

  function beginCreateNode() {
    state.selectedNodeId = '';
    state.creatingNode = true;
    state.edgeTool = '';
    state.edgeSource = '';
    openStudioPanel('course-node-panel');
    nodePanel?.classList.remove('hidden');
    nodeForm.classList.remove('hidden');
    document.getElementById('course-node-form-title').textContent = '添加知识结点';
    const idInput = document.getElementById('course-node-id');
    idInput.value = '';
    idInput.readOnly = false;
    document.getElementById('course-node-title').value = '';
    document.getElementById('course-node-summary').value = '';
    document.getElementById('course-node-x').value = Math.max(
      70,
      Math.round(scroller.scrollLeft + scroller.clientWidth / 2),
    );
    document.getElementById('course-node-y').value = Math.max(
      NODE_LABEL_HEIGHT + 24,
      Math.round(scroller.scrollTop + scroller.clientHeight / 2),
    );
    document.getElementById('course-delete-node').classList.add('hidden');
    document.getElementById('course-document-edit-link').classList.add('hidden');
    setNodeMessage('结点 ID 创建后不可修改。');
    updateToolState();
    renderMap();
    idInput.focus();
  }

  function readNodeForm() {
    return {
      id: document.getElementById('course-node-id').value.trim().toUpperCase(),
      title: document.getElementById('course-node-title').value.trim(),
      summary: document.getElementById('course-node-summary').value.trim(),
      position: {
        x: Number(document.getElementById('course-node-x').value),
        y: Number(document.getElementById('course-node-y').value),
      },
    };
  }

  async function updateNode(node, position = node.position) {
    await app.callApi(
      `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: node.title,
          summary: node.summary,
          position,
        }),
      },
    );
  }

  async function saveNodeForm(event) {
    event.preventDefault();
    const draft = readNodeForm();
    setNodeMessage('正在保存…');
    try {
      if (state.creatingNode) {
        const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/nodes`, {
          method: 'POST',
          body: JSON.stringify(draft),
        });
        state.nodes.push(payload.node);
        selectNode(payload.node.id);
        setNodeMessage('知识结点已创建。');
        setSaveState('结点已创建');
      } else {
        const node = nodeById(state.selectedNodeId);
        Object.assign(node, {
          title: draft.title,
          summary: draft.summary,
          position: draft.position,
        });
        await updateNode(node);
        renderMap();
        selectNode(node.id);
        setNodeMessage('知识结点已保存。');
        setSaveState('结点已保存');
      }
    } catch (error) {
      setNodeMessage(error.message, true);
    }
  }

  async function deleteSelectedNode() {
    const node = nodeById(state.selectedNodeId);
    if (!node || !window.confirm(`确认删除知识结点 ${node.id}？相关连接也会一并删除。`)) {
      return;
    }
    try {
      await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
        { method: 'DELETE' },
      );
      state.nodes = state.nodes.filter((item) => item.id !== node.id);
      state.edges = state.edges.filter(
        (edge) => edge.source !== node.id && edge.target !== node.id,
      );
      state.selectedNodeId = '';
      nodeForm.classList.add('hidden');
      closeStudioPanels();
      renderMap();
      setEdgeStatus(`已删除 ${node.id}。`);
      setSaveState('结点已删除');
    } catch (error) {
      setNodeMessage(error.message, true);
    }
  }

  function renderEdgeList() {
    const list = document.getElementById('course-edge-list');
    if (!list) {
      return;
    }
    list.innerHTML = state.edges.length
      ? state.edges
          .map(
            (edge, index) => `
          <article class="course-edge-list-item">
            <span>${escapeHtml(edge.source)} ${edge.type === 'ordered' ? '→' : '---'} ${escapeHtml(edge.target)}</span>
            <button data-delete-edge="${index}" type="button" aria-label="删除连接">删除</button>
          </article>
        `,
          )
          .join('')
      : '<p class="course-muted">暂无连接。</p>';
  }

  async function deleteEdge(index) {
    const edge = state.edges[index];
    if (!edge || !window.confirm(`确认删除 ${edge.source} 与 ${edge.target} 之间的连接？`)) {
      return;
    }
    try {
      await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/edges`, {
        method: 'DELETE',
        body: JSON.stringify(edge),
      });
      state.edges.splice(index, 1);
      renderMap();
      setEdgeStatus('连接已删除。');
      setSaveState('连接已删除');
    } catch (error) {
      setEdgeStatus(error.message, true);
    }
  }

  function updateToolState() {
    document.querySelectorAll('[data-edge-tool]').forEach((tool) => {
      const toolValue = tool.dataset.edgeTool;
      const isActive = toolValue === 'none' ? !state.edgeTool : toolValue === state.edgeTool;
      tool.classList.toggle('is-active', isActive);
      tool.setAttribute('aria-pressed', String(isActive));
    });
    scroller?.classList.toggle('is-connecting', Boolean(state.edgeTool));
  }

  async function saveBackground(body) {
    setSaveState('正在更新地图背景…');
    try {
      const payload = await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/background`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      );
      state.backgroundUrl = payload.backgroundUrl || '';
      setBackgroundSurface();
      setSaveState(state.backgroundUrl ? '地图背景已更新' : '已恢复默认背景');
    } catch (error) {
      setSaveState(error.message, true);
      setEdgeStatus(`背景更新失败：${error.message}`, true);
    }
  }

  async function uploadBackground(file) {
    if (!file?.type.startsWith('image/')) {
      setEdgeStatus('请选择图片文件。', true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setEdgeStatus('背景图片需在 20MB 以内。', true);
      return;
    }
    setSaveState('正在处理背景图片…');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取背景图片失败'));
        reader.readAsDataURL(file);
      });
      await saveBackground({ imageDataUrl });
    } catch (error) {
      setSaveState(error.message, true);
    }
  }

  function bindCanvasPanning() {
    if (!scroller) {
      return;
    }
    let pan = null;
    scroller.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        state.edgeTool ||
        event.target.closest('.course-map-node') ||
        event.target.closest('button, a, input, textarea')
      ) {
        return;
      }
      pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      scroller.setPointerCapture(event.pointerId);
      scroller.classList.add('is-panning');
    });
    scroller.addEventListener('pointermove', (event) => {
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
      scroller.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    });
    const finishPan = (event) => {
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      pan = null;
      scroller.classList.remove('is-panning');
      if (scroller.hasPointerCapture(event.pointerId)) {
        scroller.releasePointerCapture(event.pointerId);
      }
    };
    scroller.addEventListener('pointerup', finishPan);
    scroller.addEventListener('pointercancel', finishPan);
    if ('ResizeObserver' in window) {
      new ResizeObserver(syncCanvasDimensions).observe(scroller);
    } else {
      window.addEventListener('resize', syncCanvasDimensions);
    }
  }

  function bindEditorControls() {
    document.getElementById('course-add-node-button')?.addEventListener('click', beginCreateNode);
    nodeForm?.addEventListener('submit', saveNodeForm);
    document.getElementById('course-delete-node')?.addEventListener('click', deleteSelectedNode);
    document
      .getElementById('course-edge-panel-toggle')
      ?.addEventListener('click', () =>
        openStudioPanel('course-edge-panel', 'course-edge-panel-toggle', true),
      );
    document.getElementById('course-background-panel-toggle')?.addEventListener('click', () => {
      openStudioPanel('course-background-panel', 'course-background-panel-toggle', true);
      setBackgroundSurface();
    });
    document.querySelectorAll('[data-close-studio-panel]').forEach((button) => {
      button.addEventListener('click', closeStudioPanels);
    });
    document.querySelectorAll('[data-edge-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        state.edgeTool = button.dataset.edgeTool === 'none' ? '' : button.dataset.edgeTool;
        state.edgeSource = '';
        updateToolState();
        setEdgeStatus(
          state.edgeTool
            ? `已选择${state.edgeTool === 'ordered' ? '顺序箭头' : '关联虚线'}，请点击起点。`
            : '拖拽光点移动结点 · 拖拽空白处平移画布',
        );
        renderMap();
      });
    });
    document.getElementById('course-edge-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-edge]');
      if (button) {
        deleteEdge(Number(button.dataset.deleteEdge));
      }
    });
    const backgroundInput = document.getElementById('course-map-background-input');
    document.getElementById('course-map-background-upload')?.addEventListener('click', () => {
      backgroundInput?.click();
    });
    backgroundInput?.addEventListener('change', (event) => {
      uploadBackground(event.target.files?.[0]);
      event.target.value = '';
    });
    document.getElementById('course-map-background-clear')?.addEventListener('click', () => {
      saveBackground({ backgroundUrl: '' });
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isEditingField =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') {
        if (state.edgeTool) {
          state.edgeTool = '';
          state.edgeSource = '';
          updateToolState();
          renderMap();
          setEdgeStatus('已退出连接模式。');
        } else {
          closeStudioPanels();
        }
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        state.selectedNodeId &&
        !isEditingField
      ) {
        event.preventDefault();
        deleteSelectedNode();
      }
    });
    bindCanvasPanning();
    updateToolState();
  }

  function bindReaderViewport() {
    if (!mapPage) {
      return;
    }

    const restoreFocusedChapter = () => {
      const focusedChapterId = chapterIdForNodeId(state.focusedNodeId);
      if (focusedChapterId) {
        state.activeChapterId = focusedChapterId;
        state.manuallyCollapsedChapters.delete(focusedChapterId);
        state.manualExpandedChapters.add(focusedChapterId);
      }
      state.focusedNodeId = '';
      renderMap();
    };

    const focusNode = (nodeId) => {
      if (state.focusedNodeId === nodeId) {
        window.location.assign(knowledgeHref(nodeId));
        return;
      }

      state.focusedNodeId = nodeId;
      state.activeChapterId = chapterIdForNodeId(nodeId);
      state.manualExpandedChapters.add(chapterIdForNodeId(nodeId));
      const relatedChapters = new Set([chapterIdForNodeId(nodeId)]);
      state.edges.forEach((edge) => {
        if (edge.source === nodeId) {
          relatedChapters.add(chapterIdForNodeId(edge.target));
        } else if (edge.target === nodeId) {
          relatedChapters.add(chapterIdForNodeId(edge.source));
        }
      });
      relatedChapters.forEach((chapterId) => state.manuallyCollapsedChapters.delete(chapterId));
      renderMap();
      window.requestAnimationFrame(() => {
        const focusedElement = [...canvas.querySelectorAll('[data-reader-node-id]')].find(
          (element) => element.dataset.readerNodeId === nodeId,
        );
        focusedElement?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      });
    };

    const toggleChapter = (chapterId) => {
      const viewModel = readerViewModel();
      if (!state.focusedNodeId) {
        state.activeChapterId = chapterId;
        state.manuallyCollapsedChapters.delete(chapterId);
      } else if (viewModel.previewChapters.has(chapterId)) {
        state.focusedNodeId = '';
        state.activeChapterId = chapterId;
        state.manuallyCollapsedChapters.delete(chapterId);
        state.manualExpandedChapters.add(chapterId);
      } else if (state.focusedNodeId && chapterId !== viewModel.focusedChapterId) {
        state.focusedNodeId = '';
        state.activeChapterId = chapterId;
        state.manuallyCollapsedChapters.delete(chapterId);
        state.manualExpandedChapters.add(chapterId);
      } else if (viewModel.fullExpandedChapters.has(chapterId)) {
        state.manualExpandedChapters.delete(chapterId);
        state.manuallyCollapsedChapters.add(chapterId);
        if (viewModel.focusedChapterId === chapterId) {
          state.focusedNodeId = '';
        }
      } else {
        state.manuallyCollapsedChapters.delete(chapterId);
        state.manualExpandedChapters.add(chapterId);
      }
      renderMap();
    };

    const resetReaderView = () => {
      state.focusedNodeId = '';
      state.activeChapterId =
        chapterIdForNodeId(state.learningNodeId) || courseChapters()[0]?.id || '';
      state.manualExpandedChapters.clear();
      state.manuallyCollapsedChapters.clear();
      renderMap();
      scroller?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    };

    canvas.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const chapterButton = target?.closest('[data-chapter-toggle]');
      if (chapterButton) {
        toggleChapter(chapterButton.dataset.chapterToggle);
        return;
      }

      const previewClose = target?.closest('[data-preview-close]');
      if (previewClose) {
        state.manuallyCollapsedChapters.add(previewClose.dataset.previewClose);
        renderMap();
        return;
      }

      const topicButton = target?.closest('[data-reader-node-id]');
      if (topicButton) {
        focusNode(topicButton.dataset.readerNodeId);
        return;
      }

      const clickedStaticContent = target?.closest(
        '.course-map-focused-heading, .course-map-cross-relations > header, .course-map-chapter-card, .course-map-focus-summary',
      );
      if (state.focusedNodeId && target && !target.closest('button, a') && !clickedStaticContent) {
        restoreFocusedChapter();
      }
    });

    document.getElementById('course-map-reset-view')?.addEventListener('click', resetReaderView);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.focusedNodeId) {
        restoreFocusedChapter();
      }
    });

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(queueReaderEdges);
    });
    scroller?.addEventListener('scroll', queueReaderEdges, { passive: true });
  }

  async function initialize() {
    await app.sessionReady;
    try {
      const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map`, {
        method: 'GET',
      });
      state.course = payload.course;
      state.nodes = payload.nodes || [];
      state.edges = payload.edges || [];
      state.backgroundUrl = payload.backgroundUrl || '';
      state.learningNodeId = getLearningNodeId();
      const initialChapters = courseChapters();
      if (!state.learningNodeId) {
        state.learningNodeId = initialChapters[0]?.nodes[0]?.id || '';
      }
      state.activeChapterId =
        chapterIdForNodeId(state.learningNodeId) || initialChapters[0]?.id || '';
      if (editorPage && !state.course.canEditMap) {
        renderEditorHeader();
        renderMap();
        setStatus('你不是该课程的资料负责人，无法编辑这张地图。', true);
        editorPage.classList.add('is-readonly');
        editorPage.querySelectorAll('button, input, textarea').forEach((control) => {
          control.disabled = true;
        });
        return;
      }
      if (mapPage) {
        renderReaderHeader();
        bindReaderViewport();
      } else {
        renderEditorHeader();
        bindEditorControls();
      }
      renderMap();
      setSaveState(editorPage ? '所有修改会自动保存' : '');
      setStatus(state.nodes.length ? '' : `「${state.course.name}」的知识地图还没有录入知识点。`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  initialize();
})();
