(() => {
  const page = document.querySelector('[data-knowledge-page]');
  if (!page) {
    return;
  }

  const app = window.freeBbsApp || null;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const nodeId = params.get('point') || '';
  const PROGRESS_STORAGE_KEY = 'free_bbs_course_progress_v1';
  const CURRENT_LEARNING_STORAGE_KEY = 'free_bbs_current_learning_node_v1';
  const INTERACTION_WIDTH_STORAGE_KEY = 'free_bbs_knowledge_interaction_width_v1';
  const INTERACTION_PREFERENCES_STORAGE_KEY = 'free_bbs_knowledge_interaction_preferences_v1';
  const TOOLS_COLLAPSED_STORAGE_KEY = 'free_bbs_knowledge_tools_collapsed_v1';
  const KNOWLEDGE_TAGS = [
    { key: 'important', label: '重要' },
    { key: 'learned', label: '已学习' },
    { key: 'consolidated', label: '已巩固' },
  ];
  const state = {
    tags: {
      important: false,
      learned: false,
      consolidated: false,
    },
    course: null,
    node: null,
    map: null,
    chatOpen: true,
    chatTab: 'max',
    chatMessages: [],
    chatSending: false,
    chatSelection: null,
    chatSelectionDraft: '',
    interactionWidth: 0,
    toolsCollapsed: false,
    discussionPosts: [],
    discussionLoaded: false,
    discussionLoading: false,
    discussionActivePostId: '',
    discussionListRequest: 0,
    discussionDetailRequest: 0,
    discussionPost: null,
    discussionComments: [],
    discussionCommentDrafts: new Map(),
    discussionCommentParentId: 0,
    discussionCommentSending: false,
    discussionPostSending: false,
    discussionComposeMode: 'edit',
    discussionSessionUid: '',
    discussionSessionVersion: 0,
    // The map already offers an overview. A direct knowledge link is a reading destination.
    view: params.get('view') === 'overview' ? 'overview' : 'reading',
  };
  const discussionDateFormatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function knowledgeHref(nextNodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nextNodeId });
    const returnTo = window.FreeBbsCourseNavigation?.encode?.(params.get('returnTo'), courseSlug);
    if (returnTo) query.set('returnTo', returnTo);
    return `/knowledge?${query.toString()}`;
  }

  function courseDirectoryHref() {
    const query =
      window.FreeBbsCourseNavigation?.parse?.(params.get('returnTo'), courseSlug) ||
      new URLSearchParams({ course: courseSlug });
    if (state.node?.id) {
      if (query.get('focus') !== state.node.id) query.delete('routePage');
      query.set('focus', state.node.id);
    }
    return `/course?${query.toString()}`;
  }

  function setSequenceLink(linkId, titleId, targetNode, emptyLabel) {
    const link = document.getElementById(linkId);
    const title = document.getElementById(titleId);
    if (!link || !title) {
      return;
    }

    if (!targetNode) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.classList.add('is-disabled');
      title.textContent = emptyLabel;
      return;
    }

    link.href = knowledgeHref(targetNode.id);
    link.removeAttribute('aria-disabled');
    link.classList.remove('is-disabled');
    title.textContent = `${targetNode.id} · ${targetNode.title}`;
    link.setAttribute(
      'aria-label',
      `目录中的${linkId.includes('previous') ? '上一个' : '下一个'}知识点：${targetNode.title}`,
    );
  }

  function renderKnowledgeSequence(map) {
    const sequence = window.FreeBbsLearningNextSteps?.sequenceNode;
    const previousNode = sequence?.(map, { id: nodeId }, 'previous') || null;
    const nextNode = sequence?.(map, { id: nodeId }, 'next') || null;
    setSequenceLink(
      'knowledge-previous-link',
      'knowledge-previous-title',
      previousNode,
      '已经是第一个知识点',
    );
    setSequenceLink(
      'knowledge-next-link',
      'knowledge-next-title',
      nextNode,
      '已经是最后一个知识点',
    );
  }

  function readProgress() {
    return (
      window.FreeBbsLearningProgress?.read(localStorage, PROGRESS_STORAGE_KEY, app?.userState) || {}
    );
  }

  function currentProgressNodeId() {
    return state.node?.id || nodeId;
  }

  function getStoredTags() {
    const entry = readProgress()[courseSlug]?.[currentProgressNodeId()] || {};
    const storedTags = Array.isArray(entry.tags) ? entry.tags : [];
    const legacyLearned = entry.status === 'learned' || entry.status === 'review';
    const legacyConsolidated = entry.status === 'review';
    return {
      important: storedTags.includes('important'),
      learned:
        storedTags.includes('learned') || storedTags.includes('consolidated') || legacyLearned,
      consolidated: storedTags.includes('consolidated') || legacyConsolidated,
    };
  }

  function saveCurrentLearningNode(currentNodeId) {
    try {
      const progress = window.FreeBbsLearningProgress;
      const stored = progress.read(localStorage, CURRENT_LEARNING_STORAGE_KEY, app?.userState);
      progress.write(localStorage, CURRENT_LEARNING_STORAGE_KEY, app?.userState, {
        ...stored,
        [courseSlug]: currentNodeId,
      });
    } catch {
      // The knowledge page should remain usable when browser storage is unavailable.
    }
  }

  function activeTagLabels() {
    return KNOWLEDGE_TAGS.filter(({ key }) => state.tags[key]).map(({ label }) => label);
  }

  function renderTags() {
    const statusBadge = document.getElementById('knowledge-status');
    const labels = activeTagLabels();

    if (statusBadge) {
      statusBadge.textContent = labels.length ? labels.join(' · ') : '未标记';
      statusBadge.className = [
        'knowledge-status-badge',
        state.tags.important ? 'is-important' : '',
        state.tags.learned ? 'is-learned' : '',
        state.tags.consolidated ? 'is-consolidated' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    document.querySelectorAll('[data-knowledge-tag]').forEach((button) => {
      const isActive = Boolean(state.tags[button.dataset.knowledgeTag]);
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      const indicator = button.querySelector('.knowledge-tag-state');
      if (indicator) {
        indicator.textContent = isActive ? '✓' : '＋';
      }
    });
  }

  function setToolsStatus(message) {
    const toolsStatus = document.querySelector('#knowledge-tools-status p');
    if (toolsStatus) {
      toolsStatus.textContent = message;
    }
  }

  function setKnowledgeView(view, { focus = false } = {}) {
    const nextView = view === 'reading' ? 'reading' : 'overview';
    // Do not turn pending public material into an apparently available empty document.
    if (nextView === 'reading' && !state.node) return;
    if (state.view !== nextView) {
      page.dispatchEvent(
        new CustomEvent('knowledge:before-view-change', { detail: { view: nextView } }),
      );
    }
    state.view = nextView;
    const overview = document.getElementById('knowledge-overview');
    const reading = document.getElementById('knowledge-reading');
    overview?.classList.toggle('hidden', nextView !== 'overview');
    reading?.classList.toggle('hidden', nextView !== 'reading');
    page.dispatchEvent(
      new CustomEvent('knowledge:view-change', {
        detail: { view: nextView, activateContent: focus },
      }),
    );
    if (nextView === 'reading' && state.node) saveCurrentLearningNode(state.node.id);

    if (focus) {
      const target = nextView === 'reading' ? reading : overview;
      // Returning from the overview continues the learner's paragraph, not the document header.
      const resumed = nextView === 'reading' && window.FreeBbsLearningReader?.restore?.();
      target?.focus({ preventScroll: true });
      if (!resumed) target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function toggleKnowledgeTag(tagKey) {
    if (!KNOWLEDGE_TAGS.some(({ key }) => key === tagKey)) {
      return;
    }

    const nextTags = { ...state.tags, [tagKey]: !state.tags[tagKey] };
    if (tagKey === 'consolidated' && nextTags.consolidated) {
      nextTags.learned = true;
    }
    if (tagKey === 'learned' && !nextTags.learned) {
      nextTags.consolidated = false;
    }

    const progress = readProgress();
    if (
      !progress[courseSlug] ||
      typeof progress[courseSlug] !== 'object' ||
      Array.isArray(progress[courseSlug])
    ) {
      progress[courseSlug] = {};
    }
    const progressNodeId = currentProgressNodeId();
    const previousEntry = progress[courseSlug][progressNodeId];
    const entry = {
      ...(previousEntry && typeof previousEntry === 'object' && !Array.isArray(previousEntry)
        ? previousEntry
        : {}),
      tags: KNOWLEDGE_TAGS.filter(({ key }) => nextTags[key]).map(({ key }) => key),
      updatedAt: new Date().toISOString(),
    };

    if (nextTags.consolidated) {
      entry.status = 'review';
    } else if (nextTags.learned) {
      entry.status = 'learned';
    } else {
      delete entry.status;
    }
    progress[courseSlug][progressNodeId] = entry;

    try {
      window.FreeBbsLearningProgress.write(
        localStorage,
        PROGRESS_STORAGE_KEY,
        app?.userState,
        progress,
      );
    } catch {
      setToolsStatus('标签保存失败，请检查浏览器存储权限');
      return;
    }

    const wasActive = state.tags[tagKey];
    state.tags = nextTags;
    renderTags();
    page.dispatchEvent(
      new CustomEvent('knowledge:tags-change', {
        detail: { tags: { ...state.tags }, changedTag: tagKey },
      }),
    );
    const label = KNOWLEDGE_TAGS.find(({ key }) => key === tagKey)?.label || '标签';
    const suffix = tagKey === 'consolidated' && !wasActive ? '，并标记为已学习' : '';
    setToolsStatus(`${wasActive ? '已移除' : '已添加'}「${label}」${suffix}`);
  }

  function setKnowledgeLoading(isLoading) {
    page.setAttribute('aria-busy', String(Boolean(isLoading)));
    const readingButton = document.getElementById('knowledge-start-reading');
    if (readingButton) readingButton.disabled = Boolean(isLoading);
    const readingLabel = document.getElementById('knowledge-start-reading-label');
    if (readingLabel) readingLabel.textContent = isLoading ? '正在载入正文…' : '开始阅读正文';
    const readingArrow = document.getElementById('knowledge-start-reading-arrow');
    if (readingArrow) readingArrow.hidden = Boolean(isLoading);
  }

  function showPageError(message) {
    page.setAttribute('aria-busy', 'false');
    const confirmedCourse = state.course?.slug;
    const canReturnToCourse =
      typeof confirmedCourse === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(confirmedCourse);
    const returnHref = canReturnToCourse
      ? `/course?${new URLSearchParams({ course: confirmedCourse })}`
      : '/world';
    page.innerHTML = `
      <section class="course-empty course-material-error" role="alert">
        <p>${escapeHtml(message)}</p>
        <div class="learning-actions">
          <button class="bbs-action" data-action-tone="primary" id="knowledge-reload-page" type="button">重新加载</button>
          <a class="bbs-action" id="knowledge-error-return" href="${returnHref}">${canReturnToCourse ? '返回课程' : '返回学习世界'}</a>
        </div>
      </section>`;
    // Reload is explicit and restores fresh authenticated state; do not rerun bound handlers.
    document.getElementById('knowledge-reload-page')?.addEventListener('click', () => {
      window.location.reload();
    });
  }

  function bindTagControls() {
    document.querySelectorAll('[data-knowledge-tag]').forEach((button) => {
      button.addEventListener('click', () => toggleKnowledgeTag(button.dataset.knowledgeTag));
    });
  }

  let progressScope = window.FreeBbsLearningProgress?.scopedKey(
    PROGRESS_STORAGE_KEY,
    app?.userState,
  );
  window.addEventListener('freebbs:session-change', () => {
    const scope = window.FreeBbsLearningProgress?.scopedKey(PROGRESS_STORAGE_KEY, app?.userState);
    if (scope === progressScope) return;
    progressScope = scope;
    if (!state.node) return;
    state.tags = getStoredTags();
    document.querySelectorAll('[data-knowledge-tag]').forEach((button) => {
      button.disabled = !scope;
    });
    renderTags();
    if (state.view === 'reading') saveCurrentLearningNode(state.node.id);
    page.dispatchEvent(
      new CustomEvent('knowledge:tags-change', { detail: { tags: { ...state.tags } } }),
    );
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
    state.tags = { important: false, learned: false, consolidated: false };
    document.querySelectorAll('[data-knowledge-tag]').forEach((button) => {
      button.disabled = true;
    });
    renderTags();
    page.dispatchEvent(
      new CustomEvent('knowledge:tags-change', { detail: { tags: { ...state.tags } } }),
    );
  });

  function interactionWidthBounds() {
    const min = 320;
    const max = Math.max(min, Math.min(720, Math.round(window.innerWidth * 0.52)));
    return { min, max };
  }

  function setInteractionWidth(rawWidth, persist = false) {
    const workbench = document.getElementById('knowledge-workbench');
    const resizer = document.getElementById('knowledge-panel-resizer');
    if (!workbench) {
      return;
    }

    const { min, max } = interactionWidthBounds();
    const fallback = Math.round(window.innerWidth / 3);
    const width = Math.round(Math.max(min, Math.min(max, Number(rawWidth) || fallback)));
    state.interactionWidth = width;
    workbench.style.setProperty('--knowledge-interaction-width', `${width}px`);
    if (resizer) {
      resizer.setAttribute('aria-valuemin', String(min));
      resizer.setAttribute('aria-valuemax', String(max));
      resizer.setAttribute('aria-valuenow', String(width));
    }
    if (persist) {
      try {
        localStorage.setItem(INTERACTION_WIDTH_STORAGE_KEY, String(width));
      } catch {
        // The layout still works when storage is unavailable.
      }
    }
  }

  function revealNarrowChatControl(target) {
    if (!window.matchMedia?.('(max-width: 920px)').matches) return;
    const view = target?.closest('.knowledge-chat-view');
    if (!view) return;
    const controlBounds = target.getBoundingClientRect();
    const viewBounds = view.getBoundingClientRect();
    // Only scroll the drawer's own content, never the saved reading scroller.
    if (controlBounds.bottom > viewBounds.bottom)
      view.scrollTop += controlBounds.bottom - viewBounds.bottom + 8;
    else if (controlBounds.top < viewBounds.top)
      view.scrollTop -= viewBounds.top - controlBounds.top + 8;
  }

  let chatFocusGeneration = 0;
  function syncChatViewport() {
    const workbench = document.getElementById('knowledge-workbench');
    if (!workbench) return;
    const viewport = window.visualViewport;
    const height = Number(viewport?.height) || window.innerHeight;
    const top = Math.max(0, Number(viewport?.offsetTop) || 0);
    workbench.style.setProperty('--knowledge-chat-viewport-height', `${Math.floor(height)}px`);
    workbench.style.setProperty('--knowledge-chat-viewport-top', `${top}px`);
    const generation = chatFocusGeneration;
    window.requestAnimationFrame(() => {
      if (state.chatOpen && generation === chatFocusGeneration)
        revealNarrowChatControl(document.activeElement);
    });
  }

  function setToolsCollapsed(isCollapsed, persist = false) {
    const workbench = document.getElementById('knowledge-workbench');
    const toggle = document.getElementById('knowledge-tools-toggle');
    state.toolsCollapsed = Boolean(isCollapsed);
    workbench?.classList.toggle('is-tools-collapsed', state.toolsCollapsed);
    if (toggle) {
      toggle.textContent = state.toolsCollapsed ? '»' : '«';
      toggle.setAttribute('aria-expanded', String(!state.toolsCollapsed));
      toggle.setAttribute('aria-label', state.toolsCollapsed ? '展开工具栏' : '收起工具栏');
    }
    if (persist) {
      try {
        localStorage.setItem(TOOLS_COLLAPSED_STORAGE_KEY, String(state.toolsCollapsed));
      } catch {
        // The layout still works when storage is unavailable.
      }
    }
  }

  function bindWorkspaceControls() {
    const workbench = document.getElementById('knowledge-workbench');
    const toolsToggle = document.getElementById('knowledge-tools-toggle');
    const toolsStatus = document.querySelector('#knowledge-tools-status p');
    const resizer = document.getElementById('knowledge-panel-resizer');
    let storedWidth = 0;
    let toolsCollapsed = false;
    try {
      storedWidth = Number(localStorage.getItem(INTERACTION_WIDTH_STORAGE_KEY));
      toolsCollapsed = localStorage.getItem(TOOLS_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      storedWidth = 0;
    }
    setInteractionWidth(storedWidth || window.innerWidth / 3);
    syncChatViewport();
    setToolsCollapsed(toolsCollapsed);

    toolsToggle?.addEventListener('click', () => {
      setToolsCollapsed(!state.toolsCollapsed, true);
    });
    document.querySelectorAll('[data-knowledge-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        const tool = button.dataset.knowledgeTool;
        if (page.dataset.learningToolsReady === 'true') {
          page.dispatchEvent(
            new CustomEvent('knowledge:tool-select', {
              detail: { tool, course: courseSlug, point: nodeId },
            }),
          );
          return;
        }
        const toolLabel = button.querySelector('strong')?.textContent?.trim() || '该工具';
        document.querySelectorAll('[data-knowledge-tool]').forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });
        if (tool === 'content') {
          setKnowledgeView('reading', { focus: true });
          if (toolsStatus) {
            toolsStatus.textContent = '正在查看知识正文';
          }
        } else if (toolsStatus) {
          toolsStatus.textContent = `${toolLabel}接口已预留`;
        }
        page.dispatchEvent(
          new CustomEvent('knowledge:tool-select', {
            detail: { tool, course: courseSlug, point: nodeId },
          }),
        );
      });
    });

    document.getElementById('knowledge-start-reading')?.addEventListener('click', () => {
      setKnowledgeView('reading', { focus: true });
    });
    document.getElementById('knowledge-return-overview')?.addEventListener('click', () => {
      setKnowledgeView('overview', { focus: true });
    });

    let resizePointerId = null;
    resizer?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      resizePointerId = event.pointerId;
      resizer.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing-knowledge-panel');
      event.preventDefault();
    });
    resizer?.addEventListener('pointermove', (event) => {
      if (resizePointerId !== event.pointerId || !workbench) {
        return;
      }
      const width = workbench.getBoundingClientRect().right - event.clientX - 18;
      setInteractionWidth(width);
    });
    const finishResize = (event) => {
      if (resizePointerId !== event.pointerId) {
        return;
      }
      resizePointerId = null;
      if (resizer.hasPointerCapture(event.pointerId)) {
        resizer.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove('is-resizing-knowledge-panel');
      setInteractionWidth(state.interactionWidth, true);
    };
    resizer?.addEventListener('pointerup', finishResize);
    resizer?.addEventListener('pointercancel', finishResize);
    resizer?.addEventListener('keydown', (event) => {
      const { min, max } = interactionWidthBounds();
      const nextWidth = {
        ArrowLeft: state.interactionWidth + 24,
        ArrowRight: state.interactionWidth - 24,
        Home: min,
        End: max,
      }[event.key];
      if (!nextWidth) {
        return;
      }
      event.preventDefault();
      setInteractionWidth(nextWidth, true);
    });
    window.addEventListener('resize', () => {
      setInteractionWidth(state.interactionWidth);
      syncChatViewport();
    });
    window.visualViewport?.addEventListener('resize', syncChatViewport);
    window.visualViewport?.addEventListener('scroll', syncChatViewport);
  }

  function setChatOpen(isOpen, { focus = true, persist = true } = {}) {
    const workbench = document.getElementById('knowledge-workbench');
    const panel = document.getElementById('knowledge-chat-panel');
    const resizer = document.getElementById('knowledge-panel-resizer');
    const toggle = document.getElementById('knowledge-chat-toggle');
    const symbol = document.getElementById('knowledge-chat-toggle-symbol');
    const tooltip = toggle?.querySelector('.knowledge-chat-fab-tooltip');
    const input = document.getElementById('knowledge-chat-input');
    if (!workbench || !panel || !toggle) {
      return;
    }

    chatFocusGeneration += 1;
    const focusGeneration = chatFocusGeneration;
    const keepReading = focus && window.FreeBbsLearningReader?.capture?.();
    state.chatOpen = Boolean(isOpen);
    if (persist) persistInteractionPreferences();
    workbench.classList.toggle('is-interaction-open', state.chatOpen);
    setHidden(panel, !state.chatOpen);
    setHidden(resizer, !state.chatOpen);
    toggle.classList.toggle('is-active', state.chatOpen);
    toggle.setAttribute('aria-expanded', String(state.chatOpen));
    toggle.setAttribute('aria-label', state.chatOpen ? '关闭课程学习面板' : '打开课程学习面板');
    if (symbol) {
      symbol.textContent = state.chatOpen ? '×' : 'AI';
    }
    if (tooltip) {
      tooltip.textContent = state.chatOpen ? '关闭交互区' : '打开交互区';
    }
    if (!state.chatOpen && focus) {
      toggle.focus({ preventScroll: true });
    } else if (state.chatOpen && focus) {
      const focusTarget =
        state.chatTab === 'max'
          ? input
          : document.querySelector(`[data-knowledge-chat-tab="${state.chatTab}"]`);
      window.setTimeout(() => {
        if (!state.chatOpen || focusGeneration !== chatFocusGeneration) return;
        focusTarget?.focus({ preventScroll: true });
        revealNarrowChatControl(focusTarget);
      }, 0);
    }
    if (keepReading) window.requestAnimationFrame(() => window.FreeBbsLearningReader?.restore?.());
  }

  function renderChatMessage(content, message, { plainText = false } = {}) {
    if (!content) {
      return;
    }
    const messageBody = content;

    if (!plainText && app?.renderMarkdownContent) {
      messageBody.innerHTML = app.renderMarkdownContent(message || '…');
      app.enhanceMarkdownContent?.(messageBody);
    } else {
      messageBody.textContent = message || '…';
    }
  }

  function appendChatMessage(role, message, { loading = false } = {}) {
    const thread = document.getElementById('knowledge-chat-thread');
    if (!thread) {
      return null;
    }

    const item = document.createElement('article');
    const author = document.createElement('span');
    const content = document.createElement('div');
    item.className = `knowledge-chat-message is-${role}`;
    content.className = 'knowledge-chat-message-body';
    author.textContent = role === 'user' ? '你' : 'Max';

    if (loading) {
      item.classList.add('is-loading');
      const loadingLabel = document.createElement('span');
      const loadingDots = document.createElement('span');
      loadingLabel.className = 'knowledge-chat-loading-label';
      loadingLabel.textContent = message;
      loadingDots.className = 'knowledge-chat-loading-dots';
      loadingDots.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index += 1) {
        loadingDots.append(document.createElement('i'));
      }
      content.append(loadingLabel, loadingDots);
    } else {
      renderChatMessage(content, message, { plainText: role === 'user' });
    }
    item.append(author, content);
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
    return content;
  }

  function updateChatMessage(content, message) {
    content?.closest('.knowledge-chat-message')?.classList.remove('is-loading');
    renderChatMessage(content, message);
    const thread = document.getElementById('knowledge-chat-thread');
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  function selectionHelpPrompt(selection, mode = 'question') {
    const source = selection.source === 'origin' ? '知识起源' : '正文';
    // Keep the complete question visible and editable, within the API's 4,000-character limit.
    const quote = selection.quote.slice(0, 3300);
    const excerpt = `${quote}${quote.length < selection.quote.length ? '…（引用已截取）' : ''}`;
    const instructions = {
      explain: '请从必要的基础开始，分步解释这段内容，并说明关键条件。',
      check: '请围绕这段内容问我一个检查理解的问题，先不要给答案。这不计正式自测或星标。',
      question: '我的问题是：',
    };
    return `关于${source}中选中的内容「${excerpt}」，${instructions[mode] || instructions.question}`;
  }

  function draftSelectionHelp(mode = 'question') {
    const input = document.getElementById('knowledge-chat-input');
    if (!input || !state.chatSelection || state.chatSending) return false;
    const notice = document.getElementById('knowledge-selection-notice');
    const hasOwnDraft = input.value.trim() && input.value !== state.chatSelectionDraft;
    if (hasOwnDraft) {
      if (notice) notice.textContent = '已保留你的问题草稿，发送或清空后可选择帮助方式。';
      input.focus({ preventScroll: true });
      return false;
    }
    const prompt = selectionHelpPrompt(state.chatSelection, mode);
    input.value = prompt;
    state.chatSelectionDraft = prompt;
    persistChatDraft();
    if (notice) notice.textContent = '可修改问题，点击“发送”后再交给 Max。';
    input.focus({ preventScroll: true });
    return true;
  }

  function showSelectionHelp(rawSelection) {
    if (!rawSelection || typeof rawSelection.quote !== 'string' || !rawSelection.quote.trim())
      return false;
    if (rawSelection.nodeId && rawSelection.nodeId !== (state.node?.id || nodeId)) return false;
    const source = rawSelection.source === 'origin' ? 'origin' : 'annotation';
    const currentVersion =
      source === 'origin' ? state.node?.originDocumentVersion : state.node?.documentVersion;
    if (
      rawSelection.documentVersion &&
      currentVersion &&
      rawSelection.documentVersion !== currentVersion
    )
      return false;
    state.chatSelection = { quote: rawSelection.quote.slice(0, 8000), source };
    document.getElementById('knowledge-selection-guidance')?.remove();
    const thread = document.getElementById('knowledge-chat-thread');
    if (!thread) return false;
    // This is a local choice prompt, never a generated answer, conversation record, or API call.
    const item = document.createElement('article');
    item.id = 'knowledge-selection-guidance';
    item.className = 'knowledge-chat-message is-assistant knowledge-selection-guidance';
    const author = document.createElement('span');
    author.textContent = 'Max · 学习引导';
    const body = document.createElement('div');
    body.className = 'knowledge-chat-message-body';
    const label = document.createElement('small');
    label.textContent = source === 'origin' ? '已选知识起源' : '已选正文';
    const quote = document.createElement('blockquote');
    quote.id = 'knowledge-selection-quote';
    quote.textContent = state.chatSelection.quote;
    const question = document.createElement('p');
    question.textContent = '这部分你理解了吗？想检查理解，还是需要我解释一下？';
    const choices = document.createElement('div');
    choices.className = 'knowledge-selection-choices';
    choices.setAttribute('aria-label', '选择这段内容的帮助方式');
    for (const [mode, title] of [
      ['explain', '解释一下'],
      ['check', '检查理解'],
      ['question', '我自己提问'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.selectionHelp = mode;
      button.textContent = title;
      button.disabled = state.chatSending;
      button.addEventListener('click', () => draftSelectionHelp(mode));
      choices.append(button);
    }
    const notice = document.createElement('p');
    notice.id = 'knowledge-selection-notice';
    notice.className = 'knowledge-selection-notice';
    notice.setAttribute('role', 'status');
    body.append(label, quote, question, choices, notice);
    item.append(author, body);
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
    draftSelectionHelp();
    return true;
  }

  function buildKnowledgeChatRequest(prompt) {
    const course = state.course || {};
    const node = state.node || {};
    const purposes = {
      concepts: 'learn',
      practice: 'practice',
      review: 'review',
      explore: 'explore',
    };
    const task = state.learningTask || {};
    const preference = window.FreeBbsLearningStart?.currentPreference?.() || null;
    const activeGoal = window.FreeBbsLearningWorkspace?.currentGoal?.() || task.goal || '';
    const goal =
      typeof activeGoal === 'string' && Object.hasOwn(purposes, activeGoal) ? activeGoal : '';
    let learningPolicyContext = null;
    // Current confirmed self-report and current intention are the normal entry.
    // An explicit old URL is only a fallback; it never overrides a newer choice.
    if (
      !state.learningPolicySuspended &&
      typeof window.FreeBbsLearningPolicy?.normalizeContext === 'function'
    ) {
      const policy = window.FreeBbsLearningPolicy;
      const policyParams = new URLSearchParams(window.location.search);
      if (
        ['policy', 'purpose', 'level', 'module'].every(
          (key) => policyParams.getAll(key).length <= 1,
        )
      ) {
        learningPolicyContext =
          !state.learningPolicyUrlSuspended &&
          policy.normalizeContext({
            policyVersion: policyParams.get('policy'),
            purpose: policyParams.get('purpose'),
            level: policyParams.get('level'),
            ...(policyParams.has('module') && !state.learningPolicyUrlModuleSuperseded
              ? { module: policyParams.get('module') }
              : {}),
          });
      }
      const selectedGoal = goal || preference?.goal;
      if (preference && typeof selectedGoal === 'string' && Object.hasOwn(purposes, selectedGoal)) {
        const purpose = purposes[selectedGoal];
        learningPolicyContext = policy.normalizeContext({
          policyVersion: policy.POLICY_VERSION,
          purpose,
          level: preference.level,
          ...(learningPolicyContext?.purpose === purpose &&
          learningPolicyContext.level === preference.level &&
          learningPolicyContext.module
            ? { module: learningPolicyContext.module }
            : {}),
        });
      }
    }

    const learningStepContext = learningPolicyContext
      ? normalizeCurrentLearningStep(
          window.FreeBbsLearningWorkspace?.currentStep?.(),
          learningPolicyContext,
        )
      : null;
    // A live page step supersedes an older source URL module, never the reverse.
    if (learningStepContext) {
      delete learningPolicyContext.module;
      state.learningPolicyUrlModuleSuperseded = true;
    }
    return {
      question: prompt,
      history: state.chatMessages.slice(-6),
      context: {
        courseSlug,
        courseName: course.name || courseSlug,
        knowledgePointId: node.id || nodeId,
        knowledgePointTitle: node.title || '',
        knowledgePointSummary: node.summary || '',
        knowledgePointMarkdown: node.markdown || '',
        learningStartPreference: preference,
        learningTask:
          Object.keys(task).length || goal ? { ...task, ...(goal ? { goal } : {}) } : null,
        ...(learningPolicyContext ? { learningPolicyContext } : {}),
        ...(learningStepContext ? { learningStepContext } : {}),
      },
    };
  }

  function normalizeCurrentLearningStep(raw, policyContext) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const purposes = {
      concepts: 'learn',
      practice: 'practice',
      review: 'review',
      explore: 'explore',
    };
    const phases = {
      learn: ['path', 'finished'],
      practice: ['path', 'finished'],
      review: ['recall', 'repair', 'check', 'finished'],
      explore: ['question', 'investigate', 'finished'],
    };
    const modules = window.FreeBbsLearningPolicy?.MODULES || {};
    const status = raw.status || 'active';
    if (
      typeof raw.goal !== 'string' ||
      !Object.hasOwn(purposes, raw.goal) ||
      purposes[raw.goal] !== policyContext.purpose ||
      raw.level !== policyContext.level ||
      typeof raw.moduleId !== 'string' ||
      !Object.hasOwn(modules, raw.moduleId) ||
      !phases[policyContext.purpose]?.includes(raw.phase) ||
      !['unknown', 'gap', 'clear'].includes(raw.outcome) ||
      !['active', 'paused', 'finished'].includes(status) ||
      (status === 'finished') !== (raw.phase === 'finished') ||
      !/^[a-f0-9]{64}$/.test(state.node?.documentVersion || '') ||
      (raw.question !== undefined && typeof raw.question !== 'string')
    )
      return null;
    const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, 1000) : '';
    return {
      goal: raw.goal,
      level: raw.level,
      moduleId: raw.moduleId,
      phase: raw.phase,
      outcome: raw.outcome,
      status,
      courseSlug,
      knowledgePointId: state.node.id || nodeId,
      documentVersion: state.node.documentVersion,
      ...(question ? { question } : {}),
    };
  }

  function renderLearningPolicyContext() {
    document.getElementById('knowledge-learning-policy-context')?.remove();
    const requestContext = buildKnowledgeChatRequest('').context;
    const context = requestContext.learningPolicyContext;
    const mount = document.getElementById('knowledge-chat-context')?.parentElement;
    if (!context || !state.node || !mount) return;
    const policy = window.FreeBbsLearningPolicy;
    const row = document.createElement('div');
    row.id = 'knowledge-learning-policy-context';
    row.className = 'learning-actions';
    const label = document.createElement('small');
    label.textContent = `学习方向：${policy.PURPOSES[context.purpose]} · ${policy.LEVELS[context.level]}`;
    const currentStep = requestContext.learningStepContext;
    if (currentStep)
      label.textContent += ` · ${policy.MODULES[currentStep.moduleId].title}${{ paused: '（已暂停）', finished: '（本次已结束）' }[currentStep.status] || ''}`;
    row.append(label);
    const definition = !currentStep && context.module && policy.MODULES[context.module];
    if (definition) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '准备这一步的问题';
      button.title = `来自学习链的「${definition.title}」，只准备可编辑草稿`;
      button.addEventListener('click', () => {
        const current = buildKnowledgeChatRequest('').context.learningPolicyContext;
        if (
          !current ||
          current.purpose !== context.purpose ||
          current.level !== context.level ||
          current.module !== context.module
        )
          return;
        // Existing draft/busy guards remain authoritative. Opening this source
        // never switches the actual learning tool or sends a question for them.
        prepareChatPrompt(definition.question);
      });
      row.append(button);
    }
    mount.append(row);
  }

  function bindLearningPolicyContext() {
    let token = app?.userState?.token || '';
    let uid = app?.userState?.uid || '';
    const clear = () => {
      state.learningPolicySuspended = true;
      state.learningPolicyUrlSuspended = true;
      document.getElementById('knowledge-learning-policy-context')?.remove();
    };
    window.addEventListener('freebbs:session-change', () => {
      const nextToken = app?.userState?.token || '';
      const nextUid = app?.userState?.uid || '';
      if (nextToken === token && nextUid === uid) return;
      const initialConfirmation = !uid && nextUid && token && token === nextToken;
      token = nextToken;
      uid = nextUid;
      if (!initialConfirmation) clear();
    });
    window.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) clear();
    });
    window.addEventListener('learning:start-change', () => {
      // currentPreference itself enforces owner/session validity. The old URL
      // remains suspended even after this account confirms a new preference.
      if (state.learningTask) delete state.learningTask.goal;
      if (window.FreeBbsLearningStart?.currentPreference?.()) state.learningPolicySuspended = false;
      renderLearningPolicyContext();
    });
    window.addEventListener('knowledge:learning-step-change', renderLearningPolicyContext);
    if (typeof page !== 'undefined')
      page.addEventListener('knowledge:learning-step-change', renderLearningPolicyContext);
  }

  function setChatSending(isSending, status = '') {
    state.chatSending = Boolean(isSending);
    const input = document.getElementById('knowledge-chat-input');
    const sendButton = document.querySelector('#knowledge-chat-form button[type="submit"]');
    const statusElement = document.getElementById('knowledge-chat-status');

    if (input) {
      // Let the learner think ahead while a reply is pending. Only another send is blocked.
      input.disabled = false;
    }
    if (sendButton) {
      sendButton.disabled = state.chatSending;
    }
    document.querySelectorAll('[data-chat-prompt], [data-selection-help]').forEach((button) => {
      const promptButton = button;
      promptButton.disabled = state.chatSending;
    });
    if (statusElement) {
      statusElement.textContent = status || 'Max 小题不计正式自测 · 对话不写入讨论区';
    }
  }

  function prepareChatPrompt(rawPrompt) {
    const prompt = String(rawPrompt || '')
      .trim()
      .slice(0, 4000);
    if (!prompt) return false;
    setChatTab('max');
    setChatOpen(true);
    const input = document.getElementById('knowledge-chat-input');
    if (!input) return false;
    if (state.chatSending) {
      setChatDraftNotice('正在等待回答，你的下一条问题草稿仍保留。');
      return false;
    }
    if (input.value.trim()) {
      setChatDraftNotice('已保留你的问题草稿，可先编辑或发送。');
      input.focus({ preventScroll: true });
      return false;
    }
    input.value = prompt;
    persistChatDraft();
    setChatDraftNotice('已准备问题，可修改后点击“发送”。');
    input.focus({ preventScroll: true });
    return true;
  }

  async function submitChatPrompt(rawPrompt) {
    const prompt = String(rawPrompt || '').trim();
    if (!prompt || state.chatSending) {
      return;
    }

    setChatOpen(true);
    if (!app?.userState?.token) {
      appendChatMessage('assistant', '请先登录后再向 Max 提问。');
      return;
    }
    if (!app.streamKnowledgeRagResponse) {
      appendChatMessage('assistant', 'AI 对话组件未加载，请刷新页面后重试。');
      return;
    }

    const input = document.getElementById('knowledge-chat-input');
    const submittedInput = input?.value;
    const submittedOwnDraft = submittedInput?.trim() === prompt;
    persistChatDraft();
    appendChatMessage('user', prompt);
    const answerContent = appendChatMessage('assistant', '正在检索课程资料', { loading: true });
    const sessionToken = app.userState.token;
    const generation = chatGeneration;
    let answer = '';
    setChatSending(true);
    page.dispatchEvent(new CustomEvent('knowledge:chat-start', { detail: {} }));

    try {
      await app.streamKnowledgeRagResponse(buildKnowledgeChatRequest(prompt), (delta) => {
        if (app.userState.token !== sessionToken || generation !== chatGeneration) return;
        answer += delta;
        updateChatMessage(answerContent, answer);
      });
      if (app.userState.token !== sessionToken || generation !== chatGeneration) return;
      if (!answer.trim()) {
        throw new Error('Agent 未返回回答内容');
      }
      state.chatMessages.push({ role: 'user', content: prompt });
      state.chatMessages.push({ role: 'assistant', content: answer });
      page.dispatchEvent(
        new CustomEvent('knowledge:answer', { detail: { answer, element: answerContent } }),
      );
      // A delayed reply must never remove a different, newly typed question.
      if (submittedOwnDraft && input?.value === submittedInput) {
        input.value = '';
        state.chatSelectionDraft = '';
        persistChatDraft();
        setChatDraftNotice('');
      }
      setChatSending(false);
    } catch (error) {
      if (app.userState.token !== sessionToken || generation !== chatGeneration) return;
      updateChatMessage(answerContent, `请求失败：${error.message || 'AI 服务暂时不可用'}`);
      setChatSending(
        false,
        input?.value.trim()
          ? 'Max 暂时不可用，问题草稿已保留，可稍后再发。'
          : 'Max 暂时不可用，可稍后再试。',
      );
    }
  }

  // Share only this knowledge point's current, user-visible conversation.
  window.freeBbsKnowledge = {
    buildRequest: buildKnowledgeChatRequest,
    getLearningContext: () => ({
      tags: { ...state.tags },
      map: state.map,
      course: state.course,
      node: state.node,
    }),
  };
  Promise.resolve(app?.sessionReady).then(bindLearningPolicyContext, () => {});
  page.addEventListener('knowledge:loaded', renderLearningPolicyContext);
  page.addEventListener('knowledge:tool-select', renderLearningPolicyContext);
  page.addEventListener('knowledge:task-focus', renderLearningPolicyContext);
  page.addEventListener('knowledge:goal-change', renderLearningPolicyContext);
  page.addEventListener('knowledge:open-interaction', (event) => {
    setChatTab(event.detail?.tab === 'discussion' ? 'discussion' : 'max');
    setChatOpen(true);
    const input = document.getElementById('knowledge-chat-input');
    if (state.chatTab === 'max' && input && !state.chatSending) {
      if (event.detail?.selectionContext) {
        showSelectionHelp(event.detail.selectionContext);
      } else if (event.detail?.prompt) {
        if (!input.value.trim()) {
          input.value = String(event.detail.prompt).slice(0, 4000);
          persistChatDraft();
        } else setChatDraftNotice('已保留你的问题草稿。');
      }
      input.focus({ preventScroll: true });
    }
  });
  page.addEventListener('knowledge:ask', (event) => {
    prepareChatPrompt(event.detail?.prompt);
  });
  page.addEventListener('knowledge:show-content', () => setKnowledgeView('reading'));
  let pendingQuestionNavigation = null;
  function focusLearningTask(detail = {}) {
    const tools = [
      'content',
      'notes',
      'feedback',
      'discussion',
      'continue',
      'resources',
      'contribute',
    ];
    const tool = tools.includes(detail.tool) ? detail.tool : 'content';
    state.learningTask = {
      tool,
      ...(tool === 'feedback' && ['practice', 'quick', 'mistakes'].includes(detail.quizView)
        ? { quizView: detail.quizView }
        : {}),
      ...(tool === 'feedback' &&
      typeof detail.questionId === 'string' &&
      /^[A-Za-z0-9._:-]{1,120}$/.test(detail.questionId)
        ? { questionId: detail.questionId }
        : {}),
      ...(tool === 'content' && ['origin', 'overview'].includes(detail.view)
        ? { view: detail.view }
        : {}),
    };
  }
  page.addEventListener('knowledge:task-focus', (event) => focusLearningTask(event.detail));
  page.addEventListener('knowledge:tool-select', (event) => {
    // Changing tools must not leave Max on a question that is no longer being studied.
    pendingQuestionNavigation = null;
    focusLearningTask(event.detail);
  });
  function navigateLearning(detail = {}) {
    if (detail.view === 'relations') {
      window.location.assign(courseDirectoryHref());
      return;
    }
    page.dispatchEvent(
      new CustomEvent('knowledge:tool-select', {
        detail: {
          tool: [
            'content',
            'notes',
            'feedback',
            'discussion',
            'continue',
            'resources',
            'contribute',
          ].includes(detail.tool)
            ? detail.tool
            : 'content',
          preserveView: true,
        },
      }),
    );
    const quizView = ['practice', 'quick', 'mistakes'].includes(detail.quizView)
      ? detail.quizView
      : '';
    const snapshot = window.FreeBbsLearningAssessment?.getSnapshot?.() || {};
    const targetQuestion = [
      ...(snapshot.questions || []),
      ...(snapshot.practiceQuestions || []),
    ].find((question) => question.id === detail.questionId);
    if (detail.tool === 'feedback' && quizView) {
      window.FreeBbsLearningAssessment?.selectView(
        quizView,
        quizView === 'practice'
          ? {
              assessmentRole: targetQuestion?.assessmentRole === 'exploration' ? 'exploration' : '',
            }
          : undefined,
      );
    }
    if (detail.tool === 'content' || detail.tool === 'notes')
      setKnowledgeView(
        detail.tool === 'content' && detail.view === 'overview' ? 'overview' : 'reading',
        { focus: detail.tool === 'content' && detail.view === 'overview' },
      );
    state.learningTask = {
      tool: [
        'content',
        'notes',
        'feedback',
        'discussion',
        'continue',
        'resources',
        'contribute',
      ].includes(detail.tool)
        ? detail.tool
        : 'content',
      ...(quizView ? { quizView } : {}),
      ...(typeof detail.questionId === 'string' &&
      /^[A-Za-z0-9._:-]{1,120}$/.test(detail.questionId)
        ? { questionId: detail.questionId }
        : {}),
      ...(detail.tool === 'content' && ['origin', 'overview'].includes(detail.view)
        ? { view: detail.view }
        : {}),
    };
    // Heading-only fallback questions can share IDs with reviewed questions but not their role.
    // Only a server-loaded snapshot resolves the destination permanently.
    pendingQuestionNavigation =
      state.learningTask.questionId && (!snapshot.loaded || !targetQuestion) ? { ...detail } : null;
    window.requestAnimationFrame(() => {
      if (detail.view === 'origin')
        document.getElementById('knowledge-history')?.scrollIntoView({ block: 'start' });
      else if (state.learningTask.questionId) {
        const question = [...document.querySelectorAll('[data-question-id]')].find(
          (element) => element.dataset.questionId === state.learningTask.questionId,
        );
        question?.scrollIntoView({ block: 'center' });
      }
    });
  }
  page.addEventListener('knowledge:navigate', (event) => navigateLearning(event.detail));
  page.addEventListener('knowledge:assessment-updated', (event) => {
    if (!pendingQuestionNavigation) return;
    if (event.detail?.loaded !== true) return;
    const questions = [
      ...(event.detail?.questions || []),
      ...(event.detail?.practiceQuestions || []),
    ];
    if (questions.some((question) => question.id === pendingQuestionNavigation.questionId))
      navigateLearning(pendingQuestionNavigation);
    else pendingQuestionNavigation = null;
  });
  document.querySelectorAll('[data-quiz-view]').forEach((button) =>
    button.addEventListener('click', () => {
      pendingQuestionNavigation = null;
      state.learningTask = { tool: 'feedback', quizView: button.dataset.quizView };
    }),
  );
  let chatSessionToken = app?.userState?.token || '';
  let chatSessionUid = app?.userState?.uid || '';
  let chatGeneration = 0;
  let chatDraftStore = null;
  let chatDraftIdentity = '';
  let chatDraftVersionBlocked = false;

  function chatDraftContext() {
    return {
      courseSlug,
      nodeId: state.node?.id || nodeId,
      documentVersion: state.node?.documentVersion || '',
      originDocumentVersion: state.node?.originDocumentVersion || '',
    };
  }

  function activeChatDraftIdentity() {
    return app?.userState?.uid && app?.userState?.token
      ? JSON.stringify([app.userState.uid, app.userState.token])
      : '';
  }

  function setChatDraftNotice(message) {
    const notice = document.getElementById('knowledge-chat-draft-status');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
  }

  function persistChatDraft() {
    if (
      chatDraftVersionBlocked ||
      !chatDraftIdentity ||
      chatDraftIdentity !== activeChatDraftIdentity()
    )
      return false;
    const text = document.getElementById('knowledge-chat-input')?.value || '';
    return chatDraftStore?.save(chatDraftContext(), text.trim() ? { text } : null) === true;
  }

  async function restoreChatDraft() {
    if (!state.node || !activeChatDraftIdentity()) return;
    const input = document.getElementById('knowledge-chat-input');
    if (!input) return;
    const generation = chatGeneration;
    const identity = activeChatDraftIdentity();
    if (!chatDraftStore) {
      let storage = null;
      try {
        storage = window.sessionStorage;
      } catch {
        // In-page questions and the leave warning remain usable without storage.
      }
      chatDraftStore = window.FreeBbsLearningChatDrafts?.createDraftStore({
        storage,
        crypto: window.crypto,
      });
    }
    const ready = await chatDraftStore?.bind(app.userState.uid, app.userState.token);
    if (generation !== chatGeneration || identity !== activeChatDraftIdentity()) return;
    chatDraftIdentity = ready ? identity : '';
    if (!ready) {
      if (input.value.trim()) setChatDraftNotice('问题暂存在本页，离开前请保留。');
      return;
    }
    // Never replace a question typed while the account or material was loading.
    if (input.value) {
      if (persistChatDraft()) setChatDraftNotice('');
      return;
    }
    const draft = chatDraftStore.read(chatDraftContext());
    if (draft) {
      input.value = draft.text;
      setChatDraftNotice('已恢复未发送的问题。');
    }
  }

  function clearChatForSession() {
    chatGeneration += 1;
    chatDraftStore?.clear();
    chatDraftStore = null;
    chatDraftIdentity = '';
    chatDraftVersionBlocked = false;
    setChatDraftNotice('');
    state.chatMessages = [];
    state.chatSelection = null;
    state.chatSelectionDraft = '';
    state.learningTask = null;
    pendingQuestionNavigation = null;
    document.getElementById('knowledge-chat-thread')?.replaceChildren();
    // Session initialization can run before the node loads. Keep the public welcome mount alive.
    const welcome = appendChatMessage(
      'assistant',
      state.node
        ? `一起梳理「${state.node.title}」。需要时，我可以讲解原理、举例或提示下一步。`
        : '需要时，我可以讲解原理、举例或提示下一步。',
    );
    if (welcome) welcome.id = 'knowledge-chat-welcome';
    const input = document.getElementById('knowledge-chat-input');
    if (input) input.value = '';
  }
  window.addEventListener('freebbs:session-change', () => {
    const token = app?.userState?.token || '';
    const uid = app?.userState?.uid || '';
    if (token === chatSessionToken && uid === chatSessionUid) return;
    // Confirming the initial token is not an account switch. Keep text just typed while
    // /auth/me was pending; no previously restored private history exists at this point.
    const initialConfirmation =
      !chatSessionUid && uid && token && token === chatSessionToken && !state.chatMessages.length;
    const input = document.getElementById('knowledge-chat-input');
    const provisionalDraft = initialConfirmation ? input?.value || '' : '';
    chatSessionToken = token;
    chatSessionUid = uid;
    clearChatForSession();
    if (input && provisionalDraft) input.value = provisionalDraft;
    setChatSending(false);
    restoreChatDraft().catch(() => {
      if (input?.value.trim()) setChatDraftNotice('问题暂存在本页，离开前请保留。');
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
    clearChatForSession();
    setChatSending(true, '账号已在其他页面变更，请刷新后继续对话');
  });

  function setHidden(element, isHidden) {
    if (!element) {
      return;
    }

    element.toggleAttribute('hidden', Boolean(isHidden));
    element.classList.toggle('hidden', Boolean(isHidden));
  }

  function readInteractionPreferences() {
    // Small screens start with an unobstructed document; an explicit choice always wins.
    const defaultOpen = window.innerWidth > 920;
    try {
      const stored = JSON.parse(localStorage.getItem(INTERACTION_PREFERENCES_STORAGE_KEY));
      return {
        open: typeof stored?.open === 'boolean' ? stored.open : defaultOpen,
        tab: stored?.tab === 'discussion' ? 'discussion' : 'max',
      };
    } catch {
      return { open: defaultOpen, tab: 'max' };
    }
  }

  function persistInteractionPreferences() {
    try {
      // This is a browser layout preference shared across knowledge points, not chat history.
      localStorage.setItem(
        INTERACTION_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ open: state.chatOpen, tab: state.chatTab }),
      );
    } catch {
      // A blocked or full browser store must not prevent opening, closing or changing tabs.
    }
  }

  function restoreInteractionPreferences() {
    const preferences = readInteractionPreferences();
    setChatTab(preferences.tab, { persist: false });
    setChatOpen(preferences.open, { focus: false, persist: false });
  }

  function getDiscussionBoardSlug() {
    return String(state.course?.boardSlug || 'all')
      .trim()
      .toLowerCase();
  }

  function discussionBoardHref() {
    return `/discussion?board=${encodeURIComponent(getDiscussionBoardSlug())}`;
  }

  function discussionPostHref(postId) {
    const query = new URLSearchParams({
      board: getDiscussionBoardSlug(),
      post: String(postId || ''),
    });
    return `/discussion?${query.toString()}`;
  }

  function formatDiscussionDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : discussionDateFormatter.format(date);
  }

  function getDiscussionAuthor(post) {
    return (
      post?.author?.displayName || post?.author?.fullName || post?.author?.username || '匿名用户'
    );
  }

  function getDiscussionReactionCount(post) {
    return (
      Number(post?.likeCount || 0) +
      Number(post?.lightCount || 0) +
      Number(post?.fireworksCount || 0)
    );
  }

  function renderDiscussionBadges(post) {
    return [
      post?.isPinned ? '<span class="is-pinned">置顶</span>' : '',
      post?.isFeatured ? '<span class="is-featured">精华</span>' : '',
    ].join('');
  }

  function setDiscussionStatus(message, tone = '') {
    const status = document.getElementById('knowledge-discussion-status');
    if (!status) {
      return;
    }

    status.textContent = message || '';
    status.className = `knowledge-discussion-status${tone ? ` is-${tone}` : ''}`;
    status.hidden = !message;
  }

  function syncDiscussionContext() {
    if (!state.course) {
      return;
    }

    const boardName = document.getElementById('knowledge-discussion-board-name');
    const boardLink = document.getElementById('knowledge-discussion-board-link');
    const footerLink = document.getElementById('knowledge-discussion-link');
    const label = state.course.name ? `${state.course.name} · 课程讨论` : '课程讨论';
    const href = discussionBoardHref();

    if (boardName) {
      boardName.textContent = label;
    }
    if (boardLink) {
      boardLink.href = href;
      setHidden(boardLink, !state.course.boardSlug);
    }
    if (footerLink) {
      footerLink.href = href;
    }
  }

  function renderDiscussionList() {
    const list = document.getElementById('knowledge-discussion-list');
    const count = document.getElementById('knowledge-discussion-count');
    if (!list) {
      return;
    }

    const posts = state.discussionPosts;
    if (count) {
      count.textContent = posts.length >= 10 ? '10+' : String(posts.length);
    }

    if (!posts.length) {
      list.innerHTML = `
        <section class="knowledge-discussion-empty">
          <span aria-hidden="true">◌</span>
          <strong>这里还没有课程讨论</strong>
          <p>可以从一个概念、一道题或正文里没看懂的步骤开始。</p>
          <button type="button" data-knowledge-discussion-compose>发布第一条讨论</button>
        </section>
      `;
      return;
    }

    list.innerHTML = posts
      .map((post) => {
        const author = getDiscussionAuthor(post);
        const date = formatDiscussionDate(post.createdAt);
        const reactions = getDiscussionReactionCount(post);
        return `
          <button
            class="knowledge-discussion-card"
            type="button"
            data-discussion-post-id="${escapeHtml(post.id)}"
            aria-label="查看帖子：${escapeHtml(post.title)}"
          >
            <span class="knowledge-discussion-card-accent" aria-hidden="true"></span>
            <span class="knowledge-discussion-card-main">
              <span class="knowledge-discussion-card-topline">
                <span class="knowledge-discussion-badges">${renderDiscussionBadges(post)}</span>
                <span>${escapeHtml(post.board?.name || state.course?.name || '课程讨论')}</span>
              </span>
              <strong>${escapeHtml(post.title)}</strong>
              <span class="knowledge-discussion-card-meta">
                ${escapeHtml(author)}${date ? ` · ${escapeHtml(date)}` : ''}
              </span>
            </span>
            <span class="knowledge-discussion-card-stats" aria-label="帖子互动">
              <span>评论 ${Number(post.commentCount || 0)}</span>
              <span>反应 ${reactions}</span>
              <i aria-hidden="true">→</i>
            </span>
          </button>
        `;
      })
      .join('');
  }

  function showDiscussionList({ focus = false } = {}) {
    const listView = document.getElementById('knowledge-discussion-list-view');
    const detail = document.getElementById('knowledge-discussion-detail');
    const previousPostId = state.discussionActivePostId;
    setHidden(listView, false);
    setHidden(detail, true);
    setHidden(document.getElementById('knowledge-discussion-compose'), true);
    state.discussionActivePostId = '';
    state.discussionDetailRequest += 1;

    if (focus && previousPostId) {
      const previousCard = [...document.querySelectorAll('[data-discussion-post-id]')].find(
        (card) => card.dataset.discussionPostId === previousPostId,
      );
      previousCard?.focus();
    }
  }

  function showDiscussionDetailLoading(postId) {
    const listView = document.getElementById('knowledge-discussion-list-view');
    const detail = document.getElementById('knowledge-discussion-detail');
    const title = document.getElementById('knowledge-discussion-detail-title');
    const meta = document.getElementById('knowledge-discussion-detail-meta');
    const badges = document.getElementById('knowledge-discussion-detail-badges');
    const body = document.getElementById('knowledge-discussion-detail-body');
    const stats = document.getElementById('knowledge-discussion-detail-stats');
    const link = document.getElementById('knowledge-discussion-post-link');
    const summary = state.discussionPosts.find((post) => String(post.id) === String(postId));

    setHidden(listView, true);
    setHidden(detail, false);
    setHidden(document.getElementById('knowledge-discussion-compose'), true);
    setHidden(document.getElementById('knowledge-discussion-comment-form'), true);
    const comments = document.getElementById('knowledge-discussion-comments');
    if (comments) comments.textContent = '正在载入评论…';
    state.discussionPost = null;
    state.discussionComments = [];
    detail?.setAttribute('aria-busy', 'true');
    if (title) {
      title.textContent = summary?.title || '正在载入帖子…';
    }
    if (meta) {
      meta.textContent = summary
        ? `${getDiscussionAuthor(summary)} · 正在读取正文`
        : '正在读取正文';
    }
    if (badges) {
      badges.innerHTML = summary ? renderDiscussionBadges(summary) : '';
    }
    if (body) {
      body.innerHTML = `
        <div class="knowledge-discussion-loading" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      `;
    }
    if (stats) {
      stats.innerHTML = '';
    }
    if (link) {
      link.href = discussionPostHref(postId);
    }
  }

  function renderDiscussionDetail(post) {
    const detail = document.getElementById('knowledge-discussion-detail');
    const title = document.getElementById('knowledge-discussion-detail-title');
    const meta = document.getElementById('knowledge-discussion-detail-meta');
    const badges = document.getElementById('knowledge-discussion-detail-badges');
    const body = document.getElementById('knowledge-discussion-detail-body');
    const stats = document.getElementById('knowledge-discussion-detail-stats');
    const link = document.getElementById('knowledge-discussion-post-link');
    const date = formatDiscussionDate(post.createdAt);
    const reactions = getDiscussionReactionCount(post);

    detail?.removeAttribute('aria-busy');
    if (title) {
      title.textContent = post.title || '未命名帖子';
    }
    if (meta) {
      meta.textContent = [
        getDiscussionAuthor(post),
        post.board?.name || state.course?.name || '',
        date,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (badges) {
      badges.innerHTML = renderDiscussionBadges(post);
    }
    if (body && app) {
      body.innerHTML = app.renderMarkdownContent(
        String(post.contentMarkdown || '').trim() || '*这篇帖子暂时没有正文。*',
      );
      app.enhanceMarkdownContent(body);
    }
    if (stats) {
      stats.innerHTML = `
        <span>评论 <strong>${Number(post.commentCount || 0)}</strong></span>
        <span>反应 <strong>${reactions}</strong></span>
        <span>帖子编号 <strong>${escapeHtml(post.pid || post.id)}</strong></span>
      `;
    }
    if (link) {
      link.href = discussionPostHref(post.id);
    }
  }

  function renderDiscussionDetailError(message) {
    const detail = document.getElementById('knowledge-discussion-detail');
    const meta = document.getElementById('knowledge-discussion-detail-meta');
    const body = document.getElementById('knowledge-discussion-detail-body');
    const stats = document.getElementById('knowledge-discussion-detail-stats');
    detail?.removeAttribute('aria-busy');
    if (meta) {
      meta.textContent = '帖子正文载入失败';
    }
    if (body) {
      body.textContent = message || '请返回列表后重试。';
    }
    if (stats) {
      stats.innerHTML = '';
    }
  }

  async function openDiscussionPost(postId) {
    if (!app || !postId) {
      return;
    }

    state.discussionActivePostId = String(postId);
    state.discussionDetailRequest += 1;
    const requestId = state.discussionDetailRequest;
    showDiscussionDetailLoading(postId);

    try {
      const payload = await app.callApi(`/discussion/posts/${encodeURIComponent(postId)}`, {
        method: 'GET',
      });
      if (requestId !== state.discussionDetailRequest) {
        return;
      }
      state.discussionPost = payload.post || {};
      renderDiscussionDetail(state.discussionPost);
      selectDiscussionCommentTarget(0, { focus: false, force: true });
      await loadDiscussionComments(postId, requestId);
      if (requestId === state.discussionDetailRequest) {
        setHidden(
          document.getElementById('knowledge-discussion-comment-form'),
          Boolean(state.discussionPost.isDeleted),
        );
      }
    } catch (error) {
      if (requestId !== state.discussionDetailRequest) {
        return;
      }
      renderDiscussionDetailError(error.message || '获取帖子详情失败。');
    }
  }

  async function loadDiscussionPosts({ force = false } = {}) {
    if (!app || !state.course || (state.discussionLoading && !force)) {
      return;
    }
    if (state.discussionLoaded && !force) {
      return;
    }
    if (!state.course.boardSlug) {
      state.discussionPosts = [];
      state.discussionLoaded = true;
      setDiscussionStatus('当前课程尚未关联讨论区，请联系课程负责人。');
      document.getElementById('knowledge-discussion-list')?.replaceChildren();
      const count = document.getElementById('knowledge-discussion-count');
      if (count) count.textContent = '0';
      return;
    }

    const refreshButton = document.getElementById('knowledge-discussion-refresh');
    state.discussionLoading = true;
    state.discussionListRequest += 1;
    const requestId = state.discussionListRequest;
    if (refreshButton) {
      refreshButton.disabled = true;
    }
    setDiscussionStatus(force ? '正在刷新课程讨论…' : '正在载入课程讨论…');

    try {
      const boardSlug = getDiscussionBoardSlug();
      const payload = await app.callApi(
        `/discussion/posts?board=${encodeURIComponent(boardSlug)}&limit=10&sort=latest`,
        { method: 'GET' },
      );
      if (requestId !== state.discussionListRequest) {
        return;
      }
      state.discussionPosts = Array.isArray(payload.posts) ? payload.posts : [];
      state.discussionLoaded = true;
      setDiscussionStatus('');
      renderDiscussionList();
    } catch (error) {
      if (requestId !== state.discussionListRequest) {
        return;
      }
      setDiscussionStatus(error.message || '课程讨论暂时无法载入。', 'error');
      if (!state.discussionPosts.length) {
        const list = document.getElementById('knowledge-discussion-list');
        if (list) {
          list.innerHTML = '';
        }
        const count = document.getElementById('knowledge-discussion-count');
        if (count) {
          count.textContent = '!';
        }
      }
    } finally {
      if (requestId === state.discussionListRequest) {
        state.discussionLoading = false;
        if (refreshButton) {
          refreshButton.disabled = false;
        }
      }
    }
  }

  function setDiscussionFormStatus(kind, message, error = false) {
    const status = document.getElementById(`knowledge-discussion-${kind}-status`);
    if (status) {
      status.textContent = message;
      status.classList.toggle('is-error', error);
    }
  }

  function updateDiscussionFormControls() {
    ['compose', 'comment'].forEach((kind) => {
      const busy =
        kind === 'compose' ? state.discussionPostSending : state.discussionCommentSending;
      const form = document.getElementById(`knowledge-discussion-${kind}-form`);
      setHidden(
        document.getElementById(`knowledge-discussion-${kind}-login`),
        Boolean(app.userState.isLoggedIn),
      );
      form?.setAttribute('aria-busy', String(busy));
      form?.querySelectorAll('button, input, textarea').forEach((control) => {
        const input = control;
        input.disabled = busy;
      });
    });
  }

  function setDiscussionComposeMode(mode) {
    state.discussionComposeMode = mode === 'preview' ? 'preview' : 'edit';
    const isPreview = state.discussionComposeMode === 'preview';
    setHidden(document.getElementById('knowledge-discussion-compose-edit-pane'), isPreview);
    setHidden(document.getElementById('knowledge-discussion-compose-preview-pane'), !isPreview);
    document.querySelectorAll('[data-knowledge-discussion-compose-mode]').forEach((button) => {
      const selected =
        button.dataset.knowledgeDiscussionComposeMode === state.discussionComposeMode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (isPreview) {
      const preview = document.getElementById('knowledge-discussion-compose-preview');
      const content = document.getElementById('knowledge-discussion-compose-content');
      if (preview) {
        preview.innerHTML = app.renderMarkdownContent(content?.value || '*还没有正文。*');
        app.enhanceMarkdownContent(preview);
      }
    }
  }

  function showDiscussionComposer() {
    restoreDiscussionPostDraft();
    state.discussionDetailRequest += 1;
    state.discussionActivePostId = '';
    setHidden(document.getElementById('knowledge-discussion-list-view'), true);
    setHidden(document.getElementById('knowledge-discussion-detail'), true);
    setHidden(document.getElementById('knowledge-discussion-compose'), false);
    setDiscussionComposeMode(state.discussionComposeMode);
    if (!state.discussionPostSending) {
      setDiscussionFormStatus(
        'compose',
        app.userState.isLoggedIn ? '' : '登录后可以发布，当前草稿会保留。',
      );
      document.getElementById('knowledge-discussion-compose-title')?.focus();
    }
  }

  async function submitDiscussionPost() {
    if (state.discussionPostSending) return;
    const titleInput = document.getElementById('knowledge-discussion-compose-title');
    const contentInput = document.getElementById('knowledge-discussion-compose-content');
    const title = String(titleInput?.value || '').trim();
    const contentMarkdown = String(contentInput?.value || '').trim();
    if (!app.userState.isLoggedIn) {
      setDiscussionFormStatus('compose', '请先登录后再发布，当前草稿已保留。', true);
      return;
    }
    if (!title || title.length > 120 || !contentMarkdown || contentMarkdown.length > 20000) {
      setDiscussionFormStatus(
        'compose',
        '请填写标题和正文，标题最多 120 字，正文最多 20000 字。',
        true,
      );
      return;
    }
    if (!state.course?.boardSlug) {
      setDiscussionFormStatus('compose', '当前课程尚未关联讨论区，请联系课程负责人。', true);
      return;
    }
    const version = state.discussionSessionVersion;
    state.discussionPostSending = true;
    updateDiscussionFormControls();
    setDiscussionFormStatus('compose', '正在发布…');
    try {
      const payload = await app.callApi('/discussion/posts', {
        method: 'POST',
        body: JSON.stringify({ boardSlug: getDiscussionBoardSlug(), title, contentMarkdown }),
      });
      if (version !== state.discussionSessionVersion) return;
      titleInput.value = '';
      contentInput.value = '';
      persistDiscussionPostDraft();
      document.getElementById('knowledge-discussion-compose-preview')?.replaceChildren();
      state.discussionComposeMode = 'edit';
      setDiscussionFormStatus('compose', '帖子已发布');
      const { post } = payload;
      if (post?.id) {
        state.discussionPosts = [
          post,
          ...state.discussionPosts.filter((item) => item.id !== post.id),
        ];
        renderDiscussionList();
        await Promise.all([loadDiscussionPosts({ force: true }), openDiscussionPost(post.id)]);
      } else {
        showDiscussionList();
        await loadDiscussionPosts({ force: true });
      }
    } catch (error) {
      if (version === state.discussionSessionVersion) {
        setDiscussionFormStatus('compose', `${error.message || '发布失败'}，草稿已保留。`, true);
      }
    } finally {
      if (version === state.discussionSessionVersion) {
        state.discussionPostSending = false;
        updateDiscussionFormControls();
      }
    }
  }

  function discussionCommentDraftKey(
    postId = state.discussionActivePostId,
    parentId = state.discussionCommentParentId,
  ) {
    return `${postId}:${parentId}`;
  }

  function selectDiscussionCommentTarget(rawParentId, { focus = true, force = false } = {}) {
    if (state.discussionCommentSending && !force) return;
    const parentId = Number(rawParentId) || 0;
    const parent = state.discussionComments.find((comment) => Number(comment.id) === parentId);
    state.discussionCommentParentId = parent ? parentId : 0;
    const source = document.getElementById('knowledge-discussion-comment-content');
    if (source) source.value = state.discussionCommentDrafts.get(discussionCommentDraftKey()) || '';
    const name = document.getElementById('knowledge-discussion-comment-target-name');
    if (name) name.textContent = parent ? getDiscussionAuthor(parent) : '';
    setHidden(document.getElementById('knowledge-discussion-comment-target'), !parent);
    setDiscussionFormStatus(
      'comment',
      app.userState.isLoggedIn ? '' : '登录后可以回复；如已输入草稿，请先复制再前往登录。',
    );
    if (focus) source?.focus();
  }

  function renderDiscussionComments() {
    const list = document.getElementById('knowledge-discussion-comments');
    if (!list) return;
    if (!state.discussionComments.length) {
      list.innerHTML =
        '<p class="knowledge-discussion-empty-copy">还没有评论，可以在下方发表你的看法。</p>';
      return;
    }
    list.innerHTML = state.discussionComments
      .map((comment) => {
        const parent = state.discussionComments.find(
          (item) => Number(item.id) === Number(comment.parentCommentId),
        );
        return `<article class="knowledge-discussion-comment" data-knowledge-discussion-comment="${escapeHtml(comment.id)}">
        <header class="knowledge-discussion-comment-meta">
          <strong>${escapeHtml(getDiscussionAuthor(comment))}</strong>
          <time>${escapeHtml(formatDiscussionDate(comment.createdAt))}</time>
          <button type="button" data-knowledge-discussion-reply="${escapeHtml(comment.id)}">回复</button>
        </header>
        ${parent ? `<p class="knowledge-discussion-comment-parent">回复 ${escapeHtml(getDiscussionAuthor(parent))}</p>` : ''}
        <div class="discussion-markdown-body">${app.renderMarkdownContent(comment.contentMarkdown || '')}</div>
      </article>`;
      })
      .join('');
    app.enhanceMarkdownContent(list);
  }

  async function loadDiscussionComments(postId, requestId) {
    try {
      const payload = await app.callApi(
        `/discussion/posts/${encodeURIComponent(postId)}/comments`,
        { method: 'GET' },
      );
      if (
        requestId !== state.discussionDetailRequest ||
        String(postId) !== state.discussionActivePostId
      )
        return;
      state.discussionComments = Array.isArray(payload.comments) ? payload.comments : [];
      renderDiscussionComments();
    } catch (error) {
      if (requestId !== state.discussionDetailRequest) return;
      const list = document.getElementById('knowledge-discussion-comments');
      if (list) list.textContent = error.message || '评论读取失败，请重新打开帖子重试。';
    }
  }

  async function submitDiscussionComment() {
    if (state.discussionCommentSending || !state.discussionPost || state.discussionPost.isDeleted)
      return;
    const source = document.getElementById('knowledge-discussion-comment-content');
    const contentMarkdown = String(source?.value || '').trim();
    if (!app.userState.isLoggedIn) {
      setDiscussionFormStatus('comment', '请先复制当前草稿，再登录后回复。', true);
      return;
    }
    if (!contentMarkdown || contentMarkdown.length > 5000) {
      setDiscussionFormStatus('comment', '评论不能为空，且最多 5000 字。', true);
      return;
    }
    const postId = state.discussionActivePostId;
    const parentCommentId = state.discussionCommentParentId;
    const key = discussionCommentDraftKey(postId, parentCommentId);
    const version = state.discussionSessionVersion;
    const detailRequest = state.discussionDetailRequest;
    state.discussionCommentDrafts.set(key, source.value);
    state.discussionCommentSending = true;
    updateDiscussionFormControls();
    setDiscussionFormStatus('comment', '正在发布回复…');
    try {
      const payload = await app.callApi(
        `/discussion/posts/${encodeURIComponent(postId)}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ contentMarkdown, parentCommentId: parentCommentId || undefined }),
        },
      );
      if (version !== state.discussionSessionVersion) return;
      state.discussionCommentDrafts.delete(key);
      loadDiscussionPosts({ force: true });
      if (
        state.discussionActivePostId === postId &&
        state.discussionDetailRequest === detailRequest
      ) {
        if (discussionCommentDraftKey() === key) source.value = '';
        if (payload.comment) {
          state.discussionComments = [
            ...state.discussionComments.filter((comment) => comment.id !== payload.comment.id),
            payload.comment,
          ];
        }
        if (state.discussionPost) {
          state.discussionPost.commentCount = Math.max(
            Number(state.discussionPost.commentCount || 0) + 1,
            state.discussionComments.length,
          );
          renderDiscussionDetail(state.discussionPost);
        }
        renderDiscussionComments();
        setDiscussionFormStatus('comment', payload.message || '回复已发布');
      }
    } catch (error) {
      if (
        version === state.discussionSessionVersion &&
        state.discussionActivePostId === postId &&
        state.discussionDetailRequest === detailRequest
      ) {
        setDiscussionFormStatus(
          'comment',
          `${error.message || '发布回复失败'}，草稿已保留。`,
          true,
        );
      }
    } finally {
      if (version === state.discussionSessionVersion) {
        state.discussionCommentSending = false;
        updateDiscussionFormControls();
      }
    }
  }

  function discussionPostStorageKey() {
    return `free_bbs_knowledge_discussion_draft_v1:${courseSlug}:${nodeId}`;
  }

  function persistDiscussionPostDraft() {
    const title = document.getElementById('knowledge-discussion-compose-title')?.value || '';
    const content = document.getElementById('knowledge-discussion-compose-content')?.value || '';
    try {
      if (!title && !content) {
        sessionStorage.removeItem(discussionPostStorageKey());
      } else {
        sessionStorage.setItem(
          discussionPostStorageKey(),
          JSON.stringify({
            uid: app.userState.isLoggedIn ? app.userState.uid : '',
            title,
            content,
          }),
        );
      }
      return true;
    } catch {
      // The in-page draft remains available when tab storage is unavailable.
      return false;
    }
  }

  function restoreDiscussionPostDraft() {
    const title = document.getElementById('knowledge-discussion-compose-title');
    const content = document.getElementById('knowledge-discussion-compose-content');
    if (!title || !content || title.value || content.value) return;
    try {
      const draft = JSON.parse(sessionStorage.getItem(discussionPostStorageKey()) || 'null');
      if (!draft) return;
      const uid = app.userState.isLoggedIn ? app.userState.uid : '';
      if (draft.uid && draft.uid !== uid) {
        sessionStorage.removeItem(discussionPostStorageKey());
        return;
      }
      title.value = typeof draft.title === 'string' ? draft.title.slice(0, 120) : '';
      content.value = typeof draft.content === 'string' ? draft.content.slice(0, 20000) : '';
      persistDiscussionPostDraft();
    } catch {
      // Malformed or inaccessible storage must not prevent opening the composer.
    }
  }

  function bindDiscussionComposer() {
    state.discussionSessionUid = app?.userState?.uid || '';
    document
      .getElementById('knowledge-discussion-compose-toggle')
      ?.addEventListener('click', showDiscussionComposer);
    document
      .getElementById('knowledge-discussion-compose-cancel')
      ?.addEventListener('click', () => showDiscussionList());
    document
      .getElementById('knowledge-discussion-compose-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitDiscussionPost();
      });
    document.querySelectorAll('[data-knowledge-discussion-compose-mode]').forEach((button) => {
      button.addEventListener('click', () =>
        setDiscussionComposeMode(button.dataset.knowledgeDiscussionComposeMode),
      );
    });
    ['title', 'content'].forEach((name) => {
      document
        .getElementById(`knowledge-discussion-compose-${name}`)
        ?.addEventListener('input', persistDiscussionPostDraft);
    });
    document
      .getElementById('knowledge-discussion-comment-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitDiscussionComment();
      });
    document
      .getElementById('knowledge-discussion-comment-content')
      ?.addEventListener('input', (event) => {
        state.discussionCommentDrafts.set(discussionCommentDraftKey(), event.target.value);
      });
    document
      .getElementById('knowledge-discussion-comment-target-cancel')
      ?.addEventListener('click', () => selectDiscussionCommentTarget(0));
    document.getElementById('knowledge-discussion-comments')?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-knowledge-discussion-reply]');
      if (button) selectDiscussionCommentTarget(button.dataset.knowledgeDiscussionReply);
    });
    window.addEventListener('freebbs:session-change', () => {
      const uid = app.userState.isLoggedIn ? app.userState.uid : '';
      const previousUid = state.discussionSessionUid;
      if (uid === previousUid) return;
      state.discussionSessionUid = uid;
      state.discussionSessionVersion += 1;
      state.discussionListRequest += 1;
      state.discussionDetailRequest += 1;
      state.discussionLoading = false;
      state.discussionLoaded = false;
      state.discussionPostSending = false;
      state.discussionCommentSending = false;
      state.discussionPosts = [];
      state.discussionPost = null;
      state.discussionComments = [];
      if (previousUid) {
        state.discussionCommentDrafts.clear();
        ['compose-title', 'compose-content', 'comment-content'].forEach((name) => {
          const input = document.getElementById(`knowledge-discussion-${name}`);
          if (input) input.value = '';
        });
        document.getElementById('knowledge-discussion-compose-preview')?.replaceChildren();
        persistDiscussionPostDraft();
        selectDiscussionCommentTarget(0, { focus: false });
        setDiscussionFormStatus('compose', '');
      } else {
        restoreDiscussionPostDraft();
        persistDiscussionPostDraft();
      }
      if (previousUid || state.discussionActivePostId) showDiscussionList();
      [
        'detail-title',
        'detail-meta',
        'detail-badges',
        'detail-body',
        'detail-stats',
        'comments',
      ].forEach((name) => {
        document.getElementById(`knowledge-discussion-${name}`)?.replaceChildren();
      });
      renderDiscussionList();
      updateDiscussionFormControls();
      loadDiscussionPosts({ force: true });
    });
    window.addEventListener('beforeunload', (event) => {
      const hasPostDraft = ['title', 'content'].some((name) =>
        document.getElementById(`knowledge-discussion-compose-${name}`)?.value.trim(),
      );
      const hasCommentDraft = [...state.discussionCommentDrafts.values()].some((value) =>
        value.trim(),
      );
      if (
        (hasPostDraft && !persistDiscussionPostDraft()) ||
        hasCommentDraft ||
        state.discussionPostSending ||
        state.discussionCommentSending
      )
        event.preventDefault();
    });
  }

  function setChatTab(rawTab, { persist = true } = {}) {
    const nextTab = rawTab === 'discussion' ? 'discussion' : 'max';
    state.chatTab = nextTab;
    if (persist) persistInteractionPreferences();
    document.querySelectorAll('[data-knowledge-chat-tab]').forEach((button) => {
      const isActive = button.dataset.knowledgeChatTab === nextTab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    document.querySelectorAll('[data-knowledge-chat-view]').forEach((view) => {
      const isActive = view.dataset.knowledgeChatView === nextTab;
      view.classList.toggle('is-active', isActive);
      setHidden(view, !isActive);
    });

    if (nextTab === 'discussion') {
      loadDiscussionPosts();
    }
  }

  function confineNarrowChatFocus(event) {
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !state.chatOpen ||
      !window.matchMedia?.('(max-width: 920px)').matches ||
      document.querySelector(
        'dialog[open], .learning-annotation-colors:not([hidden]), #learning-annotation-popover:not([hidden])',
      )
    )
      return false;
    const panel = document.getElementById('knowledge-chat-panel');
    if (!panel || !panel.getClientRects().length) return false;
    const controls = [
      ...panel.querySelectorAll(
        'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]',
      ),
    ].filter((element) => {
      if (
        element.tabIndex < 0 ||
        element.matches(':disabled') ||
        element.closest('[inert]') ||
        !element.getClientRects().length
      )
        return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.visibility !== 'collapse';
    });
    if (!controls.length) return false;
    const index = controls.indexOf(document.activeElement);
    // Chrome can include a scroll container in native Tab order without an
    // explicit tabindex. It already belongs to this panel, not the underlay.
    if (index === -1 && panel.contains(document.activeElement)) return false;
    if (
      index !== -1 &&
      !(event.shiftKey && index === 0) &&
      !(!event.shiftKey && index === controls.length - 1)
    )
      return false;
    const target = event.shiftKey ? controls.at(-1) : controls[0];
    event.preventDefault();
    target.focus({ preventScroll: true });
    revealNarrowChatControl(target);
    return true;
  }

  function bindChatControls() {
    const toggle = document.getElementById('knowledge-chat-toggle');
    const close = document.getElementById('knowledge-chat-close');
    const form = document.getElementById('knowledge-chat-form');
    const input = document.getElementById('knowledge-chat-input');
    const tabs = [...document.querySelectorAll('[data-knowledge-chat-tab]')];
    const discussionList = document.getElementById('knowledge-discussion-list');
    const discussionRefresh = document.getElementById('knowledge-discussion-refresh');
    const discussionBack = document.getElementById('knowledge-discussion-back');

    toggle?.addEventListener('click', () => setChatOpen(!state.chatOpen));
    close?.addEventListener('click', () => setChatOpen(false));
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prompt = input?.value;
      await submitChatPrompt(prompt);
    });
    input?.addEventListener('input', () => {
      chatDraftVersionBlocked = false;
      if (persistChatDraft()) setChatDraftNotice('');
      else if (input.value.trim()) setChatDraftNotice('问题暂存在本页，离开前请保留。');
      else setChatDraftNotice('');
    });
    window.addEventListener('pagehide', persistChatDraft);
    window.addEventListener('beforeunload', (event) => {
      if ((input?.value.trim() && !persistChatDraft()) || state.chatSending) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    document.querySelectorAll('[data-chat-prompt]').forEach((button) => {
      button.addEventListener('click', () => prepareChatPrompt(button.dataset.chatPrompt));
    });
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => setChatTab(button.dataset.knowledgeChatTab));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const nextButton = tabs[(index + offset + tabs.length) % tabs.length];
        setChatTab(nextButton.dataset.knowledgeChatTab);
        nextButton.focus();
      });
    });
    discussionList?.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-knowledge-discussion-compose]')) {
        showDiscussionComposer();
        return;
      }
      const card = event.target.closest?.('[data-discussion-post-id]');
      if (card) {
        openDiscussionPost(card.dataset.discussionPostId);
      }
    });
    discussionRefresh?.addEventListener('click', () => {
      if (state.discussionActivePostId) openDiscussionPost(state.discussionActivePostId);
      loadDiscussionPosts({ force: true });
    });
    discussionBack?.addEventListener('click', () => showDiscussionList({ focus: true }));
    document.addEventListener('keydown', (event) => {
      if (confineNarrowChatFocus(event)) return;
      const keyboardOverlayOpen = document.querySelector(
        'dialog[open], .learning-annotation-colors:not([hidden]), #learning-annotation-popover:not([hidden])',
      );
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !keyboardOverlayOpen &&
        state.chatOpen
      ) {
        setChatOpen(false);
        toggle?.focus();
      }
    });
  }

  function renderKnowledgeOrigin(node) {
    const origin = window.FreeBbsLearningContent?.originMarkdown(node.sections) || '';
    // Only authored origin content earns a reading surface. An application
    // summary or an empty-state message must not become a sticky document.
    document
      .getElementById('knowledge-history')
      ?.setAttribute('data-learning-origin-state', origin ? 'available' : 'empty');
    const history = document.getElementById('knowledge-history-prose');
    if (history) {
      history.toggleAttribute('data-learning-document-empty', !origin);
      history.innerHTML = origin ? app.renderMarkdownContent(origin) : '';
      app.enhanceMarkdownContent(history);
    }
    const historyEmpty = document.getElementById('knowledge-history-empty');
    if (historyEmpty) {
      historyEmpty.textContent = '本知识点尚未提供起源说明。';
      historyEmpty.toggleAttribute('hidden', Boolean(origin));
    }
  }

  function renderKnowledgeContent(node) {
    renderKnowledgeOrigin(node);
    if (window.FreeBbsLearningContent?.isChapterNode(node))
      document
        .getElementById('knowledge-body')
        ?.before(document.getElementById('knowledge-chapter-network'));
    if (state.map)
      window.FreeBbsLearningContent?.renderNetwork(
        document.getElementById('knowledge-chapter-network'),
        state.map,
        node,
        state.course,
      );
    const sections = node.sections || {};
    const markdown = window.FreeBbsLearningContent.stripQuizSource(
      String(sections.knowledgeMarkdown ?? node.markdown ?? ''),
    ).trim();
    const basicInfoMarkdown = String(sections.basicInfoMarkdown || '').trim();
    const applicationsMarkdown = String(sections.applicationsMarkdown || '').trim();
    const brief = document.getElementById('knowledge-overview-brief');
    if (brief) window.FreeBbsKnowledgeOverview?.render(brief, node, state.course);

    document.title = `FREE-BBS - ${node.title}`;
    document.getElementById('knowledge-node-id').textContent = node.id;
    document.getElementById('knowledge-title').textContent = node.title;
    document.getElementById('knowledge-summary').textContent = node.summary || '';
    document.getElementById('knowledge-chat-context').textContent = `${node.id} · ${node.title}`;
    document.getElementById('knowledge-chat-welcome').textContent =
      `一起梳理「${node.title}」。需要时，我可以讲解原理、举例或提示下一步。`;

    const body = document.getElementById('knowledge-body');
    // Keep the UI empty-state copy distinct from course-authored material.
    body.toggleAttribute('data-learning-document-empty', !markdown);
    body.innerHTML = app.renderMarkdownContent(markdown || '*这个知识点的正文暂未提供。*');
    app.enhanceMarkdownContent(body);

    const supplementary = document.getElementById('knowledge-supplementary');
    const supplementarySections = [
      {
        markdown: basicInfoMarkdown,
        card: document.getElementById('knowledge-basic-info-card'),
        body: document.getElementById('knowledge-basic-info'),
      },
      {
        markdown: applicationsMarkdown,
        card: document.getElementById('knowledge-applications-card'),
        body: document.getElementById('knowledge-applications'),
      },
    ];
    supplementarySections.forEach((section) => {
      const { markdown: supplementaryMarkdown, card, body: supplementaryBody } = section;
      card?.classList.toggle('hidden', !supplementaryMarkdown);
      if (supplementaryBody) {
        supplementaryBody.innerHTML = supplementaryMarkdown
          ? app.renderMarkdownContent(supplementaryMarkdown)
          : '';
        if (supplementaryMarkdown) {
          app.enhanceMarkdownContent(supplementaryBody);
        }
      }
    });
    supplementary?.classList.toggle('hidden', !basicInfoMarkdown && !applicationsMarkdown);
    document
      .getElementById('knowledge-overview-empty')
      ?.classList.toggle('hidden', Boolean(basicInfoMarkdown || applicationsMarkdown));
    setKnowledgeView(state.view);
  }

  page.addEventListener('knowledge:document-saved', (event) => {
    const node = event.detail?.node;
    if (!node || !state.node || node.id !== state.node.id) {
      return;
    }
    if (
      node.documentVersion !== state.node.documentVersion ||
      node.originDocumentVersion !== state.node.originDocumentVersion
    ) {
      // A reply based on old material must not append to, or unlock, a newer question.
      chatGeneration += 1;
      state.chatMessages = [];
      document
        .querySelectorAll('#knowledge-chat-thread .is-loading .knowledge-chat-message-body')
        .forEach((content) => updateChatMessage(content, '课程资料已更新，请核对引用后重新提问。'));
      setChatSending(false);
      chatDraftStore?.save(chatDraftContext(), null);
      chatDraftVersionBlocked = Boolean(
        document.getElementById('knowledge-chat-input')?.value.trim(),
      );
      state.chatSelection = null;
      state.chatSelectionDraft = '';
      document.getElementById('knowledge-selection-guidance')?.remove();
      if (chatDraftVersionBlocked)
        setChatDraftNotice('课程内容已更新，请核对问题中的引用后再发送。');
    }
    state.node = node;
    renderKnowledgeContent(node);
  });

  async function initialize() {
    setKnowledgeLoading(true);
    bindTagControls();
    bindWorkspaceControls();
    bindChatControls();
    bindDiscussionComposer();
    restoreInteractionPreferences();

    if (!app) {
      showPageError('课程渲染模块未加载，请刷新页面后重试。');
      return;
    }

    await app.sessionReady;
    restoreDiscussionPostDraft();
    updateDiscussionFormControls();
    if (!nodeId) {
      showPageError('未指定知识结点。');
      return;
    }

    try {
      const [detail, map] = await Promise.all([
        app.callApi(
          `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(nodeId)}`,
          { method: 'GET' },
        ),
        app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map`, { method: 'GET' }),
      ]);
      const { course, node } = detail;
      state.course = course;
      state.node = node;
      state.map = map;

      document.getElementById('knowledge-course-link').href = courseDirectoryHref();
      document.getElementById('knowledge-course-name').textContent = course.name;
      renderKnowledgeContent(node);
      await restoreChatDraft();

      state.tags = getStoredTags();
      renderTags();
      renderKnowledgeSequence(map);
      setKnowledgeLoading(false);
      syncDiscussionContext();
      loadDiscussionPosts();
      page.dispatchEvent(new CustomEvent('knowledge:loaded', { detail: { course, node } }));
      // Apply saved cross-point destinations after peer modules have selected the initial tool.
      const focus = params.get('focus');
      const quiz = params.get('quiz');
      const questionId = params.get('question');
      if (focus === 'origin' || focus === 'relations' || quiz || questionId) {
        Promise.resolve().then(() =>
          navigateLearning({
            tool: quiz || questionId ? 'feedback' : 'content',
            ...(focus === 'origin' || focus === 'relations' ? { view: focus } : {}),
            ...(quiz || questionId
              ? { quizView: ['practice', 'quick', 'mistakes'].includes(quiz) ? quiz : 'practice' }
              : {}),
            ...(questionId ? { questionId } : {}),
          }),
        );
      }
    } catch (error) {
      showPageError(error.message || '知识点加载失败。');
    }
  }

  initialize();
})();
