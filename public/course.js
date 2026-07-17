(() => {
  const PROGRESS_STORAGE_KEY = 'free_bbs_course_progress_v1';
  const DEFAULT_COURSE_SLUG = 'signals';
  const coursePage = document.querySelector('[data-course-page]');
  const knowledgePage = document.querySelector('[data-knowledge-page]');
  const courses = window.freeBbsCourseCatalog?.courses || [];
  const appBridge = window.freeBbsApp || {};
  const ragState = {
    messages: [],
    isSending: false,
  };

  function courseEscapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getCourse(slug = DEFAULT_COURSE_SLUG) {
    return courses.find((course) => course.slug === slug) || null;
  }

  function getPoint(course, pointId) {
    return course?.knowledgePoints.find((point) => point.id === pointId) || null;
  }

  function knowledgeHref(course, point) {
    const params = new URLSearchParams({
      course: course.slug,
      point: point.id,
    });
    return `/knowledge?${params.toString()}`;
  }

  function courseHref(course) {
    return `/course?course=${encodeURIComponent(course.slug)}`;
  }

  function discussionHref(course) {
    return `/discussion?board=${encodeURIComponent(course.board)}`;
  }

  function readProgress() {
    try {
      const progress = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}') || {};

      if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
        return {};
      }

      return progress;
    } catch {
      return {};
    }
  }

  function writeProgress(progress) {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  }

  function getPointStatus(course, point) {
    const progress = readProgress();
    return progress[course.slug]?.[point.id]?.status || '';
  }

  function setPointStatus(course, point, status) {
    const progress = readProgress();
    progress[course.slug] = progress[course.slug] || {};
    progress[course.slug][point.id] = {
      status,
      updatedAt: new Date().toISOString(),
    };
    writeProgress(progress);
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

  function renderStatusBadge(status) {
    const className = status ? ` is-${status}` : '';
    return `<span class="course-status-badge${className}">${statusLabel(status)}</span>`;
  }

  function getPrerequisiteTitles(course, point) {
    return point.prerequisites.map((id) => getPoint(course, id)?.title).filter(Boolean);
  }

  function renderTagList(tags = []) {
    if (!tags.length) {
      return '';
    }

    return `
      <div class="course-tags">
        ${tags.map((tag) => `<span>${courseEscapeHtml(tag)}</span>`).join('')}
      </div>
    `;
  }

  function renderResourceList(resources = []) {
    if (!resources.length) {
      return '<p class="course-muted">暂无资料。</p>';
    }

    return resources
      .map((resource) => {
        const title = courseEscapeHtml(resource.title);
        const body = `
          <span class="course-resource-type">${courseEscapeHtml(resource.type)}</span>
          <strong>${title}</strong>
          <small>${courseEscapeHtml(resource.description)}</small>
        `;

        if (resource.url) {
          return `
            <a class="course-resource-item" href="${courseEscapeHtml(resource.url)}">
              ${body}
            </a>
          `;
        }

        return `<article class="course-resource-item">${body}</article>`;
      })
      .join('');
  }

  function summarizeProgress(course) {
    return course.knowledgePoints.reduce(
      (summary, point) => {
        const status = getPointStatus(course, point);

        if (status === 'learned') {
          summary.learned += 1;
        }

        if (status === 'review') {
          summary.review += 1;
        }

        return summary;
      },
      {
        learned: 0,
        review: 0,
        total: course.knowledgePoints.length,
      },
    );
  }

  function renderProgressSummary(course) {
    const progress = summarizeProgress(course);
    const progressNode = document.getElementById('course-progress-summary');

    if (!progressNode) {
      return;
    }

    progressNode.innerHTML = `
      <span><strong>${progress.learned}</strong> 已学习</span>
      <span><strong>${progress.review}</strong> 复习中</span>
      <span><strong>${progress.total}</strong> 总知识点</span>
    `;
  }

  function renderCourseCards(course, query = '') {
    const list = document.getElementById('course-point-list');

    if (!list) {
      return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const points = course.knowledgePoints.filter((point) => {
      const searchable = [point.title, point.summary, ...point.tags].join(' ').toLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery);
    });

    if (!points.length) {
      list.innerHTML = '<article class="course-empty">没有找到匹配的知识点。</article>';
      return;
    }

    list.innerHTML = points
      .map((point, index) => {
        const status = getPointStatus(course, point);
        const prerequisites = getPrerequisiteTitles(course, point);
        const prerequisiteText = prerequisites.length ? prerequisites.join('、') : '无';

        return `
          <article class="course-point-card" data-point-id="${courseEscapeHtml(point.id)}">
            <div class="course-point-index">${String(index + 1).padStart(2, '0')}</div>
            <div class="course-point-main">
              <div class="course-point-head">
                <h2>${courseEscapeHtml(point.title)}</h2>
                ${renderStatusBadge(status)}
              </div>
              <p>${courseEscapeHtml(point.summary)}</p>
              <small>前置：${courseEscapeHtml(prerequisiteText)}</small>
              ${renderTagList(point.tags)}
            </div>
            <div class="course-point-actions">
              <button type="button" data-action="open-point" data-point-id="${courseEscapeHtml(point.id)}">
                预览
              </button>
              <a href="${knowledgeHref(course, point)}">详情</a>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function closePointModal() {
    document.getElementById('course-point-modal')?.classList.add('hidden');
  }

  function openPointModal(course, point) {
    const modal = document.getElementById('course-point-modal');

    if (!modal) {
      return;
    }

    const status = getPointStatus(course, point);
    const prerequisites = getPrerequisiteTitles(course, point);
    const prerequisiteText = prerequisites.length ? prerequisites.join('、') : '无';

    modal.innerHTML = `
      <div class="course-modal-backdrop" data-action="close-modal"></div>
      <section class="course-modal-panel" role="dialog" aria-modal="true" aria-labelledby="course-modal-title">
        <button class="course-modal-close" type="button" data-action="close-modal" aria-label="关闭">×</button>
        <p class="course-kicker">${courseEscapeHtml(course.name)}</p>
        <h2 id="course-modal-title">${courseEscapeHtml(point.title)}</h2>
        <p>${courseEscapeHtml(point.summary)}</p>
        ${renderTagList(point.tags)}
        <dl class="course-modal-meta">
          <div>
            <dt>学习状态</dt>
            <dd>${statusLabel(status)}</dd>
          </div>
          <div>
            <dt>前置知识</dt>
            <dd>${courseEscapeHtml(prerequisiteText)}</dd>
          </div>
        </dl>
        <section class="course-modal-resources" aria-label="资料预览">
          ${renderResourceList(point.resources)}
        </section>
        <div class="course-modal-actions">
          <button type="button" data-action="mark-learned" data-point-id="${courseEscapeHtml(point.id)}">
            标记学习
          </button>
          <button type="button" data-action="mark-review" data-point-id="${courseEscapeHtml(point.id)}">
            标记复习
          </button>
          <a href="${knowledgeHref(course, point)}">查看详情</a>
          <a href="${discussionHref(course)}">进入讨论</a>
        </div>
      </section>
    `;
    modal.classList.remove('hidden');
  }

  function renderCoursePage() {
    if (!coursePage) {
      return;
    }

    const course = getCourse(getParams().get('course') || DEFAULT_COURSE_SLUG);

    if (!course) {
      coursePage.innerHTML = '<section class="course-empty">课程不存在。</section>';
      return;
    }

    document.title = `FREE-BBS - ${course.name}`;
    document.getElementById('course-code').textContent = course.code;
    document.getElementById('course-title').textContent = course.name;
    document.getElementById('course-description').textContent = course.description;
    document.getElementById('course-summary').textContent = course.summary;
    document.getElementById('course-discussion-link').href = discussionHref(course);

    renderProgressSummary(course);
    renderCourseCards(course);

    const searchInput = document.getElementById('course-search-input');
    searchInput?.addEventListener('input', () => {
      renderCourseCards(course, searchInput.value);
    });

    document.getElementById('course-point-list')?.addEventListener('click', (event) => {
      const button = event.target.closest("[data-action='open-point']");

      if (!button) {
        return;
      }

      const point = getPoint(course, button.dataset.pointId);

      if (point) {
        openPointModal(course, point);
      }
    });

    document.getElementById('course-point-modal')?.addEventListener('click', (event) => {
      const actionTarget = event.target.closest('[data-action]');

      if (!actionTarget) {
        return;
      }

      const point = getPoint(course, actionTarget.dataset.pointId);

      if (actionTarget.dataset.action === 'close-modal') {
        closePointModal();
        return;
      }

      if (!point) {
        return;
      }

      if (actionTarget.dataset.action === 'mark-learned') {
        setPointStatus(course, point, 'learned');
      }

      if (actionTarget.dataset.action === 'mark-review') {
        setPointStatus(course, point, 'review');
      }

      renderProgressSummary(course);
      renderCourseCards(course, searchInput?.value || '');
      openPointModal(course, point);
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePointModal();
      }
    });
  }

  function renderKnowledgeList(course, activePoint) {
    const list = document.getElementById('knowledge-point-list');

    if (!list) {
      return;
    }

    list.innerHTML = course.knowledgePoints
      .map((point) => {
        const status = getPointStatus(course, point);
        const activeClass = point.id === activePoint.id ? ' is-active' : '';

        return `
          <a class="knowledge-list-item${activeClass}" href="${knowledgeHref(course, point)}">
            <span>${courseEscapeHtml(point.title)}</span>
            ${renderStatusBadge(status)}
          </a>
        `;
      })
      .join('');
  }

  function renderKnowledgeActions(course, point) {
    const actions = document.getElementById('knowledge-actions');
    const status = getPointStatus(course, point);

    if (!actions) {
      return;
    }

    actions.innerHTML = `
      <button class="${status === 'learned' ? 'is-active' : ''}" type="button" data-action="mark-learned">
        学习
      </button>
      <button class="${status === 'review' ? 'is-active' : ''}" type="button" data-action="mark-review">
        复习
      </button>
      <a href="${discussionHref(course)}">讨论入口</a>
    `;
  }

  function enhanceCourseMarkdown(root) {
    if (!root) {
      return;
    }

    const renderMarkdown = appBridge.renderMarkdownContent || ((value) => courseEscapeHtml(value));
    root.innerHTML = renderMarkdown(root.dataset.markdown || '');
    appBridge.enhanceMarkdownContent?.(root);
  }

  function renderRagIntro(course, point) {
    const thread = document.getElementById('knowledge-rag-thread');

    if (!thread) {
      return;
    }

    thread.innerHTML = `
      <article class="knowledge-rag-message is-assistant">
        <strong>Max</strong>
        <div>我会优先参考《${courseEscapeHtml(course.name)}》中“${courseEscapeHtml(point.title)}”这页的内容。</div>
      </article>
    `;

    if (!appBridge.userState?.token) {
      thread.insertAdjacentHTML(
        'beforeend',
        '<article class="knowledge-rag-message is-system">登录后可以围绕这个知识点继续追问。</article>',
      );
    }
  }

  function appendRagMessage(role, content) {
    const thread = document.getElementById('knowledge-rag-thread');

    if (!thread) {
      return null;
    }

    const article = document.createElement('article');
    article.className = `knowledge-rag-message is-${role}`;
    article.innerHTML = `
      <strong>${role === 'user' ? '你' : 'Max'}</strong>
      <div class="discussion-markdown-body"></div>
    `;
    article.querySelector('div').dataset.markdown = content;
    enhanceCourseMarkdown(article.querySelector('div'));
    thread.append(article);
    thread.scrollTop = thread.scrollHeight;
    return article;
  }

  function updateRagMessage(article, content) {
    const body = article?.querySelector('div');

    if (!body) {
      return;
    }

    body.dataset.markdown = content || '...';
    enhanceCourseMarkdown(body);
    document.getElementById('knowledge-rag-thread')?.scrollTo({
      top: document.getElementById('knowledge-rag-thread').scrollHeight,
      behavior: 'smooth',
    });
  }

  function buildRagPayload(course, point, question) {
    const resources = point.resources
      .map((resource) => `${resource.type}：${resource.title}。${resource.description}`)
      .join('\n');
    const contextPrompt = [
      '请作为课程助教回答问题。优先依据下面的课程资料；如果资料不足，请明确说明并给出可继续查证的方向。',
      '',
      `课程：${course.name}`,
      `知识点：${point.title}`,
      `摘要：${point.summary}`,
      `标签：${point.tags.join('、')}`,
      `资料：\n${resources}`,
      `正文：\n${point.bodyMarkdown}`,
      '',
      `学生问题：${question}`,
    ].join('\n');

    return {
      agent: 'general_chat',
      source: 'course_knowledge_detail',
      channel: 'course_rag',
      messages: [
        ...ragState.messages.slice(-6),
        {
          role: 'user',
          content: contextPrompt,
        },
      ],
      stream: true,
      temperature: 0.45,
    };
  }

  function setRagStatus(message) {
    const status = document.getElementById('knowledge-rag-status');

    if (status) {
      status.textContent = message || '';
    }
  }

  async function handleRagSubmit(course, point, event) {
    event.preventDefault();

    if (ragState.isSending) {
      return;
    }

    const input = document.getElementById('knowledge-rag-input');
    const sendButton = document.getElementById('knowledge-rag-send');
    const question = input?.value.trim() || '';

    if (!question) {
      return;
    }

    if (!appBridge.userState?.token) {
      setRagStatus('请先登录后再向 Max 提问。');
      return;
    }

    if (!appBridge.streamAiChatResponse) {
      setRagStatus('AI 对话组件不可用，请刷新页面后再试。');
      return;
    }

    ragState.isSending = true;
    input.value = '';
    input.disabled = true;
    if (sendButton) {
      sendButton.disabled = true;
    }

    appendRagMessage('user', question);
    const assistantArticle = appendRagMessage('assistant', 'Max 正在整理这页资料...');
    let assistantContent = '';
    setRagStatus('Max 正在参考当前知识点。');

    try {
      await appBridge.streamAiChatResponse(buildRagPayload(course, point, question), (delta) => {
        assistantContent += delta;
        updateRagMessage(assistantArticle, assistantContent);
      });
      ragState.messages.push({ role: 'user', content: question });
      ragState.messages.push({ role: 'assistant', content: assistantContent });
      setRagStatus('');
    } catch (error) {
      updateRagMessage(assistantArticle, `请求失败：${error.message}`);
      setRagStatus('AI 服务不可用，请稍后再试。');
    } finally {
      ragState.isSending = false;
      input.disabled = false;
      if (sendButton) {
        sendButton.disabled = false;
      }
      input.focus();
    }
  }

  function renderKnowledgePage() {
    if (!knowledgePage) {
      return;
    }

    const params = getParams();
    const course = getCourse(params.get('course') || DEFAULT_COURSE_SLUG);
    const point = getPoint(course, params.get('point') || '');

    if (!course || !point) {
      knowledgePage.innerHTML = '<section class="course-empty">知识点不存在。</section>';
      return;
    }

    document.title = `FREE-BBS - ${point.title}`;
    document.getElementById('knowledge-course-link').href = courseHref(course);
    document.getElementById('knowledge-course-link').textContent = course.name;
    document.getElementById('knowledge-title').textContent = point.title;
    document.getElementById('knowledge-summary').textContent = point.summary;
    document.getElementById('knowledge-body').dataset.markdown = point.bodyMarkdown;
    document.getElementById('knowledge-resources').innerHTML = renderResourceList(point.resources);
    document.getElementById('knowledge-discussion-link').href = discussionHref(course);

    enhanceCourseMarkdown(document.getElementById('knowledge-body'));
    renderKnowledgeList(course, point);
    renderKnowledgeActions(course, point);
    renderRagIntro(course, point);

    document.getElementById('knowledge-actions')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');

      if (!button) {
        return;
      }

      if (button.dataset.action === 'mark-learned') {
        setPointStatus(course, point, 'learned');
      }

      if (button.dataset.action === 'mark-review') {
        setPointStatus(course, point, 'review');
      }

      renderKnowledgeList(course, point);
      renderKnowledgeActions(course, point);
    });

    document.getElementById('knowledge-rag-form')?.addEventListener('submit', (event) => {
      handleRagSubmit(course, point, event);
    });
  }

  renderCoursePage();
  renderKnowledgePage();
})();
