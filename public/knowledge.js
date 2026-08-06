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
  const INTERACTION_WIDTH_STORAGE_KEY = 'free_bbs_knowledge_interaction_width_v1';
  const TOOLS_COLLAPSED_STORAGE_KEY = 'free_bbs_knowledge_tools_collapsed_v1';
  const state = {
    status: '',
    course: null,
    node: null,
    map: null,
    chatOpen: false,
    chatTab: 'max',
    interactionWidth: 0,
    toolsCollapsed: false,
    discussionPosts: [],
    discussionLoaded: false,
    discussionLoading: false,
    discussionActivePostId: '',
    discussionListRequest: 0,
    discussionDetailRequest: 0,
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
    return `/knowledge?${query.toString()}`;
  }

  function courseDirectoryHref() {
    return `/course?course=${encodeURIComponent(courseSlug)}`;
  }

  function orderedKnowledgeNodes(map) {
    const nodes = Array.isArray(map?.nodes) ? map.nodes : [];
    return [...nodes].sort((left, right) =>
      left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' }),
    );
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
      `${linkId.includes('previous') ? '上一个' : '下一个'}知识点：${targetNode.title}`,
    );
  }

  function renderKnowledgeSequence(map) {
    const nodes = orderedKnowledgeNodes(map);
    const currentIndex = nodes.findIndex((node) => node.id === nodeId);
    const previousNode = currentIndex > 0 ? nodes[currentIndex - 1] : null;
    const nextNode =
      currentIndex >= 0 && currentIndex < nodes.length - 1 ? nodes[currentIndex + 1] : null;
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
    try {
      const progress = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}') || {};
      return progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
    } catch {
      return {};
    }
  }

  function getStoredStatus() {
    const status = readProgress()[courseSlug]?.[nodeId]?.status;
    return status === 'learned' || status === 'review' ? status : '';
  }

  function statusLabel(status) {
    if (status === 'learned') {
      return '已学习';
    }

    if (status === 'review') {
      return '复习中';
    }

    return '未开始';
  }

  function renderStatus() {
    const statusBadge = document.getElementById('knowledge-status');
    const learnButton = document.getElementById('knowledge-learn-button');
    const reviewButton = document.getElementById('knowledge-review-button');

    if (statusBadge) {
      statusBadge.textContent = statusLabel(state.status);
      statusBadge.className = `knowledge-status-badge${state.status ? ` is-${state.status}` : ''}`;
    }

    [learnButton, reviewButton].forEach((button) => {
      if (!button) {
        return;
      }

      const isActive = button.dataset.status === state.status;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function saveStatus(status) {
    const progress = readProgress();
    progress[courseSlug] = progress[courseSlug] || {};
    progress[courseSlug][nodeId] = {
      status,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    state.status = status;
    renderStatus();
  }

  function showPageError(message) {
    page.innerHTML = `<section class="course-empty course-material-error">${escapeHtml(message)}</section>`;
  }

  function bindStatusControls() {
    document.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => saveStatus(button.dataset.status));
    });
  }

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
    setToolsCollapsed(toolsCollapsed);

    toolsToggle?.addEventListener('click', () => {
      setToolsCollapsed(!state.toolsCollapsed, true);
    });
    document.querySelectorAll('[data-knowledge-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        const tool = button.dataset.knowledgeTool;
        const toolLabel = button.querySelector('strong')?.textContent?.trim() || '该工具';
        document.querySelectorAll('[data-knowledge-tool]').forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });
        if (tool === 'content') {
          document.getElementById('knowledge-body')?.scrollIntoView({ behavior: 'smooth' });
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
    window.addEventListener('resize', () => setInteractionWidth(state.interactionWidth));
  }

  function setChatOpen(isOpen) {
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

    state.chatOpen = Boolean(isOpen);
    workbench.classList.toggle('is-interaction-open', state.chatOpen);
    setHidden(panel, !state.chatOpen);
    setHidden(resizer, !state.chatOpen);
    toggle.classList.toggle('is-active', state.chatOpen);
    toggle.setAttribute('aria-expanded', String(state.chatOpen));
    toggle.setAttribute('aria-label', state.chatOpen ? '关闭课程学习面板' : '打开课程学习面板');
    if (symbol) {
      symbol.textContent = state.chatOpen ? '×' : '＋';
    }
    if (tooltip) {
      tooltip.textContent = state.chatOpen ? '关闭交互区' : '打开交互区';
    }
    if (state.chatOpen) {
      const focusTarget =
        state.chatTab === 'max'
          ? input
          : document.querySelector(`[data-knowledge-chat-tab="${state.chatTab}"]`);
      window.setTimeout(() => focusTarget?.focus(), 0);
    }
  }

  function appendChatMessage(role, message) {
    const thread = document.getElementById('knowledge-chat-thread');
    if (!thread) {
      return;
    }

    const item = document.createElement('article');
    const author = document.createElement('span');
    const content = document.createElement('p');
    item.className = `knowledge-chat-message is-${role}`;
    author.textContent = role === 'user' ? '你' : 'Max';
    content.textContent = message;
    item.append(author, content);
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
  }

  function createMockReply(prompt) {
    const title = state.node?.title || '当前知识点';
    const summary = String(state.node?.summary || '').trim();
    const summarySentence = summary.replace(/[。！？!?]+$/, '');

    if (/直觉|解释|看懂/.test(prompt)) {
      return summary
        ? `先抓住一句话：${summarySentence}。读正文时，把每个定义都对应到“它描述什么、输入是什么、结果怎么变化”这三个问题上。`
        : `先把「${title}」理解成一个解决问题的工具：确认它描述的对象、允许的操作，以及结论成立的条件。`;
    }

    if (/易错|错误|坑/.test(prompt)) {
      return `学习「${title}」时重点检查三件事：符号和自变量是否统一、连续与离散情形是否混用、结论的适用条件是否被省略。做题后再用定义反查一次。`;
    }

    if (/题|练习|检查/.test(prompt)) {
      return `自测题：先不看正文，用自己的话说明「${title}」解决了什么问题；再写出一个相关定义或运算，并举一个不满足条件的反例。`;
    }

    return `我记住你正在学习「${title}」。目前这是纯前端演示，我可以先提供“直觉解释、易错点、自测题”三类固定引导；正式问答会在后端协议确定后接入。`;
  }

  function submitChatPrompt(rawPrompt) {
    const prompt = String(rawPrompt || '').trim();
    if (!prompt) {
      return;
    }

    setChatOpen(true);
    appendChatMessage('user', prompt);
    appendChatMessage('assistant', createMockReply(prompt));
  }

  function setHidden(element, isHidden) {
    if (!element) {
      return;
    }

    element.toggleAttribute('hidden', Boolean(isHidden));
    element.classList.toggle('hidden', Boolean(isHidden));
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
          <a href="${discussionBoardHref()}">去发布第一条讨论 ↗</a>
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
    state.discussionActivePostId = '';

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
      renderDiscussionDetail(payload.post || {});
    } catch (error) {
      if (requestId !== state.discussionDetailRequest) {
        return;
      }
      renderDiscussionDetailError(error.message || '获取帖子详情失败。');
    }
  }

  async function loadDiscussionPosts({ force = false } = {}) {
    if (!app || !state.course || state.discussionLoading) {
      return;
    }
    if (state.discussionLoaded && !force) {
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

  function setChatTab(rawTab) {
    const nextTab = rawTab === 'discussion' ? 'discussion' : 'max';
    state.chatTab = nextTab;
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
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitChatPrompt(input?.value);
      if (input) {
        input.value = '';
        input.focus();
      }
    });
    document.querySelectorAll('[data-chat-prompt]').forEach((button) => {
      button.addEventListener('click', () => submitChatPrompt(button.dataset.chatPrompt));
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
      const card = event.target.closest?.('[data-discussion-post-id]');
      if (card) {
        openDiscussionPost(card.dataset.discussionPostId);
      }
    });
    discussionRefresh?.addEventListener('click', () => {
      showDiscussionList();
      loadDiscussionPosts({ force: true });
    });
    discussionBack?.addEventListener('click', () => showDiscussionList({ focus: true }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.chatOpen) {
        setChatOpen(false);
        toggle?.focus();
      }
    });
  }

  async function initialize() {
    bindStatusControls();
    bindWorkspaceControls();
    bindChatControls();

    if (!app) {
      showPageError('课程渲染模块未加载，请刷新页面后重试。');
      return;
    }

    await app.sessionReady;
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
      const markdown = String(node.markdown || '').trim();
      state.course = course;
      state.node = node;
      state.map = map;

      document.title = `FREE-BBS - ${node.title}`;
      document.getElementById('knowledge-course-link').href = courseDirectoryHref();
      document.getElementById('knowledge-course-name').textContent = course.name;
      document.getElementById('knowledge-node-id').textContent = node.id;
      document.getElementById('knowledge-title').textContent = node.title;
      document.getElementById('knowledge-summary').textContent = node.summary || '';
      document.getElementById('knowledge-chat-context').textContent = `${node.id} · ${node.title}`;
      document.getElementById('knowledge-chat-welcome').textContent =
        `我已经定位到「${node.title}」。你可以让我做直觉解释、提醒易错点，或出一道自测题。当前为纯前端演示。`;

      const documentStatus = document.getElementById('knowledge-document-status');
      documentStatus.textContent = markdown ? 'Markdown 课程资料' : '文档待补充';
      const body = document.getElementById('knowledge-body');
      body.innerHTML = app.renderMarkdownContent(
        markdown || '*这个知识结点还没有挂载 Markdown 文档。*',
      );
      app.enhanceMarkdownContent(body);

      state.status = getStoredStatus();
      renderStatus();
      renderKnowledgeSequence(map);
      syncDiscussionContext();
      loadDiscussionPosts();
    } catch (error) {
      showPageError(error.message || '知识点加载失败。');
    }
  }

  initialize();
})();
