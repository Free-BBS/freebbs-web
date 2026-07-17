(() => {
  const STORAGE_KEY = 'free_bbs_demo_signals_progress_v1';
  const course = window.DEMO_COURSE_DATA;
  const state = {
    activePointId: course.points[0].id,
    modalPointId: '',
    ragContextKey: '',
    view: 'overview',
  };

  const nodes = {
    bodyContent: document.getElementById('body-content'),
    continueButton: document.getElementById('continue-button'),
    detailPage: document.getElementById('detail-page'),
    detailTags: document.getElementById('detail-tags'),
    focusSummary: document.getElementById('focus-summary'),
    focusTags: document.getElementById('focus-tags'),
    focusTitle: document.getElementById('focus-title'),
    inlineResourceRow: document.getElementById('inline-resource-row'),
    learnedCount: document.getElementById('learned-count'),
    learnButton: document.getElementById('learn-button'),
    modal: document.getElementById('point-modal'),
    modalKicker: document.getElementById('modal-kicker'),
    modalPrerequisites: document.getElementById('modal-prerequisites'),
    modalResources: document.getElementById('modal-resources'),
    modalStatus: document.getElementById('modal-status'),
    modalSummary: document.getElementById('modal-summary'),
    modalTitle: document.getElementById('modal-title'),
    nextButton: document.getElementById('next-button'),
    overviewPage: document.getElementById('overview-page'),
    pointList: document.getElementById('point-list'),
    pointSummary: document.getElementById('point-summary'),
    pointTitle: document.getElementById('point-title'),
    prevButton: document.getElementById('prev-button'),
    ragClose: document.getElementById('rag-close'),
    ragContextTitle: document.getElementById('rag-context-title'),
    ragDock: document.getElementById('rag-dock'),
    ragForm: document.getElementById('rag-form'),
    ragInput: document.getElementById('rag-input'),
    ragPrompts: document.querySelector('.rag-prompts'),
    ragThread: document.getElementById('rag-thread'),
    ragToggle: document.getElementById('rag-toggle'),
    resourceList: document.getElementById('resource-list'),
    reviewButton: document.getElementById('review-button'),
    reviewCount: document.getElementById('review-count'),
    totalCount: document.getElementById('total-count'),
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function readProgress() {
    try {
      const progress = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
    } catch {
      return {};
    }
  }

  function writeProgress(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function getPoint(pointId) {
    return course.points.find((point) => point.id === pointId) || course.points[0];
  }

  function getPointIndex(pointId) {
    return course.points.findIndex((point) => point.id === pointId);
  }

  function getStatus(pointId) {
    return readProgress()[pointId]?.status || '';
  }

  function setStatus(pointId, status) {
    const progress = readProgress();
    progress[pointId] = {
      status,
      updatedAt: new Date().toISOString(),
    };
    writeProgress(progress);
  }

  function statusText(status) {
    if (status === 'learned') {
      return '已学习';
    }

    if (status === 'review') {
      return '复习中';
    }

    return '未开始';
  }

  function statusBadge(status) {
    const className = status ? ` is-${status}` : '';
    return `<span class="status-badge${className}">${statusText(status)}</span>`;
  }

  function pointTitle(pointId) {
    return getPoint(pointId).title;
  }

  function prerequisiteText(point) {
    if (!point.prerequisites.length) {
      return '无';
    }

    return point.prerequisites.map(pointTitle).join('、');
  }

  function pointHash(pointId) {
    return `#point=${encodeURIComponent(pointId)}`;
  }

  function setHash(hash) {
    if (window.location.hash === hash) {
      renderRoute();
      return;
    }

    window.location.hash = hash;
  }

  function parseRoute() {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));

    if (hash.startsWith('point=')) {
      const pointId = hash.replace(/^point=/, '');
      const exists = course.points.some((point) => point.id === pointId);

      if (exists) {
        return {
          pointId,
          view: 'detail',
        };
      }
    }

    return {
      pointId: state.activePointId,
      view: 'overview',
    };
  }

  function getContinuePoint() {
    const progress = readProgress();
    return (
      course.points.find((point) => progress[point.id]?.status !== 'learned') || course.points[0]
    );
  }

  function resourceMarkup(resources) {
    return resources
      .map(
        (resource) => `
          <article class="resource-item">
            <span class="resource-type">${escapeHtml(resource.type)}</span>
            <strong>${escapeHtml(resource.title)}</strong>
            <small>${escapeHtml(resource.description)}</small>
          </article>
        `,
      )
      .join('');
  }

  function inlineResourceMarkup(resources) {
    return resources
      .map(
        (resource) => `
          <button class="inline-resource" type="button" data-action="scroll-resources">
            <span>${escapeHtml(resource.type)}</span>
            <strong>${escapeHtml(resource.title)}</strong>
          </button>
        `,
      )
      .join('');
  }

  function tagMarkup(tags) {
    return tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  }

  function renderProgress() {
    const progress = readProgress();
    const counts = course.points.reduce(
      (summary, point) => {
        const status = progress[point.id]?.status;

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
      },
    );

    nodes.learnedCount.textContent = String(counts.learned);
    nodes.reviewCount.textContent = String(counts.review);
    nodes.totalCount.textContent = String(course.points.length);
  }

  function renderPointList(activePointId) {
    nodes.pointList.innerHTML = course.points
      .map((point, index) => {
        const isActive = point.id === activePointId;
        const className = isActive ? 'point-card is-active' : 'point-card';

        return `
          <button class="${className}" type="button" data-point-id="${escapeHtml(point.id)}">
            <span class="point-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="point-copy">
              <strong>${escapeHtml(point.title)}</strong>
              <small>${escapeHtml(point.summary)}</small>
            </span>
            <span class="point-meta">前置：${escapeHtml(prerequisiteText(point))}</span>
            ${statusBadge(getStatus(point.id))}
          </button>
        `;
      })
      .join('');
  }

  function renderBody(point) {
    const renderer = window.DEMO_MARKDOWN_RENDERER;

    if (!renderer || typeof renderer.render !== 'function') {
      nodes.bodyContent.innerHTML = `<pre class="markdown-fallback">${escapeHtml(
        point.bodyMarkdown || '',
      )}</pre>`;
      return;
    }

    nodes.bodyContent.innerHTML = renderer.render(point.bodyMarkdown || '');
  }

  function ragContext() {
    if (state.view === 'overview') {
      return {
        key: 'overview',
        title: course.name,
        intro: `我会把整门“${course.name}”作为上下文，帮你判断先学哪个知识点、哪里容易卡住，以及怎么复习。`,
      };
    }

    const point = getPoint(state.activePointId);
    return {
      key: point.id,
      title: point.title,
      intro: `我会优先参考当前知识点“${point.title}”。你可以问它和前置知识的关系、容易错的点，或者让它给你出一道小题。`,
    };
  }

  function renderRagIntro() {
    const context = ragContext();

    nodes.ragContextTitle.textContent = context.title;

    if (state.ragContextKey === context.key) {
      return;
    }

    state.ragContextKey = context.key;
    nodes.ragThread.innerHTML = `
      <article class="rag-message">
        <strong>Max Demo</strong>
        <p>${escapeHtml(context.intro)}</p>
      </article>
    `;
  }

  function updatePager() {
    const pointIndex = getPointIndex(state.activePointId);
    const previousPoint = course.points[pointIndex - 1];
    const nextPoint = course.points[pointIndex + 1];

    nodes.prevButton.disabled = !previousPoint;
    nodes.nextButton.disabled = !nextPoint;
    nodes.prevButton.dataset.pointId = previousPoint?.id || '';
    nodes.nextButton.dataset.pointId = nextPoint?.id || '';
  }

  function renderOverview() {
    const point = getContinuePoint();

    nodes.focusTitle.textContent = point.title;
    nodes.focusSummary.textContent = point.summary;
    nodes.focusTags.innerHTML = tagMarkup(point.tags);

    renderPointList(point.id);
    renderProgress();
  }

  function renderDetail() {
    const point = getPoint(state.activePointId);
    const status = getStatus(point.id);

    nodes.pointTitle.textContent = point.title;
    nodes.pointSummary.textContent = point.summary;
    nodes.detailTags.innerHTML = tagMarkup(point.tags);
    nodes.inlineResourceRow.innerHTML = inlineResourceMarkup(point.resources);
    nodes.resourceList.innerHTML = resourceMarkup(point.resources);
    nodes.learnButton.classList.toggle('is-active', status === 'learned');
    nodes.reviewButton.classList.toggle('is-active', status === 'review');

    renderBody(point);
    renderProgress();
    updatePager();
  }

  function renderRoute() {
    const route = parseRoute();

    state.view = route.view;
    state.activePointId = route.pointId;
    nodes.overviewPage.classList.toggle('hidden', state.view !== 'overview');
    nodes.detailPage.classList.toggle('hidden', state.view !== 'detail');

    if (state.view === 'detail') {
      renderDetail();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      renderOverview();
    }

    renderRagIntro();
  }

  function openModal(pointId) {
    const point = getPoint(pointId);

    state.modalPointId = point.id;
    nodes.modalKicker.textContent = course.name;
    nodes.modalTitle.textContent = point.title;
    nodes.modalSummary.textContent = point.summary;
    nodes.modalPrerequisites.textContent = prerequisiteText(point);
    nodes.modalStatus.textContent = statusText(getStatus(point.id));
    nodes.modalResources.innerHTML = resourceMarkup(point.resources);
    nodes.modal.classList.remove('hidden');
    nodes.modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    nodes.modal.classList.add('hidden');
    nodes.modal.setAttribute('aria-hidden', 'true');
  }

  function openRagDock() {
    nodes.ragDock.classList.remove('hidden');
    nodes.ragToggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(() => nodes.ragInput.focus(), 0);
  }

  function closeRagDock() {
    nodes.ragDock.classList.add('hidden');
    nodes.ragToggle.setAttribute('aria-expanded', 'false');
  }

  function appendRagMessage(role, text) {
    const article = document.createElement('article');
    article.className = role === 'user' ? 'rag-message is-user' : 'rag-message';
    article.innerHTML = `
      <strong>${role === 'user' ? '你' : 'Max Demo'}</strong>
      <p>${escapeHtml(text)}</p>
    `;
    nodes.ragThread.append(article);
    nodes.ragThread.scrollTop = nodes.ragThread.scrollHeight;
  }

  function buildOverviewReply(question) {
    const point = getContinuePoint();

    if (/顺序|路线|先学/.test(question)) {
      return `建议顺序就是页面里的路线：先看信号分类，再看 LTI 系统，最后进入傅里叶分析和采样。你当前可以继续“${point.title}”，因为它是后续知识点的入口。`;
    }

    return `这门课的主线是：${course.summary}。如果只是准备 demo 展示，可以先点开“${point.title}”，看详情页里正文、资料、讨论和学习状态怎么串起来。`;
  }

  function buildDetailReply(point, question) {
    const prereq = prerequisiteText(point);
    const firstResource = point.resources[0]?.title || '当前资料';

    if (/错|难|不会|卡|复习/.test(question)) {
      return `针对“${point.title}”，先抓住一句话：${point.summary}。容易卡住的地方通常和前置知识“${prereq}”有关，可以先看“${firstResource}”，再用一个小例子把定义走一遍。`;
    }

    if (/公式|推导|为什么|直觉/.test(question)) {
      return `可以先不要背形式。对“${point.title}”来说，先问它描述的是时域变化、系统响应，还是频域成分。再回到正文里的公式块，看每个符号对应哪个具体对象。`;
    }

    if (/题|练习|检查/.test(question)) {
      return `给你一个检查点：用自己的话解释“${point.title}”解决了什么问题，再从正文里挑一个公式，说清楚左边和右边分别代表什么。如果说不清，就回到底部资料区先补“${firstResource}”。`;
    }

    return `我会把你的问题理解为：如何学习“${point.title}”。建议顺序是：先读摘要，再看正文里的公式块，最后用资料区的“${firstResource}”做一题。当前知识点的核心是：${point.summary}`;
  }

  function buildMockReply(question) {
    if (state.view === 'overview') {
      return buildOverviewReply(question);
    }

    return buildDetailReply(getPoint(state.activePointId), question);
  }

  function submitRagQuestion(question) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    nodes.ragInput.value = '';
    openRagDock();
    appendRagMessage('user', trimmedQuestion);

    window.setTimeout(() => {
      appendRagMessage('assistant', buildMockReply(trimmedQuestion));
    }, 280);
  }

  function handleRagSubmit(event) {
    event.preventDefault();
    submitRagQuestion(nodes.ragInput.value);
  }

  function refreshAfterStatusChange(pointId) {
    if (state.view === 'detail') {
      renderDetail();
    } else {
      renderOverview();
    }

    if (pointId) {
      openModal(pointId);
    }
  }

  function bindEvents() {
    nodes.pointList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-point-id]');

      if (card) {
        openModal(card.dataset.pointId);
      }
    });

    nodes.continueButton.addEventListener('click', () => {
      setHash(pointHash(getContinuePoint().id));
    });

    nodes.prevButton.addEventListener('click', () => {
      if (nodes.prevButton.dataset.pointId) {
        setHash(pointHash(nodes.prevButton.dataset.pointId));
      }
    });

    nodes.nextButton.addEventListener('click', () => {
      if (nodes.nextButton.dataset.pointId) {
        setHash(pointHash(nodes.nextButton.dataset.pointId));
      }
    });

    nodes.inlineResourceRow.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action="scroll-resources"]');

      if (target) {
        document.getElementById('resources').scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });

    nodes.learnButton.addEventListener('click', () => {
      setStatus(state.activePointId, 'learned');
      refreshAfterStatusChange();
    });

    nodes.reviewButton.addEventListener('click', () => {
      setStatus(state.activePointId, 'review');
      refreshAfterStatusChange();
    });

    nodes.modal.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;

      if (!action) {
        return;
      }

      if (action === 'close-modal') {
        closeModal();
        return;
      }

      if (action === 'mark-learned') {
        setStatus(state.modalPointId, 'learned');
        refreshAfterStatusChange(state.modalPointId);
        return;
      }

      if (action === 'mark-review') {
        setStatus(state.modalPointId, 'review');
        refreshAfterStatusChange(state.modalPointId);
        return;
      }

      if (action === 'open-detail') {
        closeModal();
        setHash(pointHash(state.modalPointId));
      }
    });

    nodes.ragToggle.addEventListener('click', openRagDock);
    nodes.ragClose.addEventListener('click', closeRagDock);
    nodes.ragForm.addEventListener('submit', handleRagSubmit);

    nodes.ragPrompts.addEventListener('click', (event) => {
      const prompt = event.target.closest('[data-rag-question]');

      if (prompt) {
        submitRagQuestion(prompt.dataset.ragQuestion || '');
      }
    });

    window.addEventListener('hashchange', renderRoute);

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      closeModal();
      closeRagDock();
    });
  }

  function initialize() {
    document.getElementById('course-term').textContent = course.term;
    document.getElementById('course-title').textContent = course.name;
    document.getElementById('course-description').textContent = course.description;

    bindEvents();

    if (!window.location.hash) {
      window.location.hash = 'overview';
      return;
    }

    renderRoute();
  }

  initialize();
})();
