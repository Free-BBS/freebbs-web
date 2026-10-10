/* Personal learning evidence, independent of optional activity tracking and manual tags. */
(function exposeLearningStars(root) {
  const nodeLabels = {
    course_learning: '课程学习',
    self_learning: '自主学习',
    deep_mastery: '深入掌握',
  };
  const courseLabels = {
    course_lit: '课程点亮',
    complete_review: '完整复习',
    full_mastery: '全面掌握',
  };
  function displayModel(record = {}, { course = false } = {}) {
    const labels = course ? courseLabels : nodeLabels;
    const keys =
      !course && record.level === 'extension'
        ? ['self_learning', 'deep_mastery']
        : Object.keys(labels);
    return keys.map((key) => {
      const star = (record.stars || []).find((item) => item.key === key);
      const future = ['deep_mastery', 'complete_review', 'full_mastery'].includes(key);
      // Unfinished assessment/review mechanisms must not masquerade as earned stars.
      const earned = !future && star?.earned === true;
      let status = '未点亮';
      if (earned) status = '已记录';
      else if (future) status = '后续开发';
      else if (key === 'course_learning') status = '尚未开放';
      return {
        key,
        label: labels[key],
        earned,
        status,
        historicalVersion: earned && Boolean(star?.historicalVersion || star?.historicalScope),
      };
    });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { displayModel };
    return;
  }
  const app = root.freeBbsApp;
  const slots = new Map();
  const requests = new Map();
  let generation = 0;
  let sessionStale = false;
  const identity = () =>
    !sessionStale && app?.userState?.isLoggedIn && app.userState?.uid && app.userState?.token
      ? `${app.userState.uid}:${app.userState.token}`
      : '';
  let session = identity();
  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text) item.textContent = text;
    return item;
  }
  function render(container, options, data) {
    const record = options.nodeId
      ? data?.nodes?.find((node) => node.nodeId === options.nodeId)
      : data?.course;
    container.replaceChildren();
    container.className = 'learning-star-strip';
    container.setAttribute(
      'aria-label',
      options.nodeId ? '我的知识点学习记录' : '我的课程学习记录',
    );
    const model = displayModel(record || { level: options.level }, { course: !options.nodeId });
    const list = element('ul', 'learning-star-list');
    model.forEach((star) => {
      const item = element('li', `learning-star ${star.earned ? 'is-earned' : 'is-muted'}`);
      item.dataset.learningStar = star.key;
      item.setAttribute('aria-label', `${star.label}：${star.status}`);
      const symbol = element('span', 'learning-star-symbol', '★');
      symbol.setAttribute('aria-hidden', 'true');
      const copy = element('span', 'learning-star-copy');
      copy.append(
        element('span', 'learning-star-name', star.label),
        element('small', 'learning-star-state', star.status),
      );
      item.append(symbol, copy);
      list.append(item);
    });
    container.append(list);
    const footer = element('div', 'learning-star-footer');
    if (!identity())
      footer.append(
        element('span', '', sessionStale ? '登录状态已变化，请刷新页面' : '登录后查看自己的星记录'),
      );
    else if (options.loading) footer.append(element('span', '', '正在载入记录…'));
    else if (options.error) {
      footer.append(element('span', '', '记录暂未载入'));
      const retry = element('button', '', '重试');
      retry.type = 'button';
      retry.addEventListener('click', () => refresh());
      footer.append(retry);
    } else if (record) {
      const historical = model.some((star) => star.historicalVersion);
      if (historical)
        footer.append(
          element('span', '', options.nodeId ? '保留历史版本的星记录' : '保留历史范围的星记录'),
        );
      if (record.selftest?.available)
        footer.append(
          element(
            'span',
            '',
            `本版自测 ${record.selftest.passedQuestionCount}/${record.selftest.questionCount} 题通过${record.selftest.pendingReviewCount ? ` · ${record.selftest.pendingReviewCount} 题待复核` : ''}`,
          ),
        );
      if (!options.nodeId && record.eligibleNodeCount)
        footer.append(
          element(
            'span',
            '',
            `当前范围 ${record.litNodeCount}/${record.eligibleNodeCount} 个普通知识点有星记录`,
          ),
        );
      if (
        record.selftest?.eligible &&
        !model.some((star) => star.key === 'self_learning' && star.earned)
      ) {
        const sync = element('button', '', '同步学习记录');
        sync.type = 'button';
        sync.addEventListener('click', async () => {
          const owner = identity();
          const current = generation;
          sync.disabled = true;
          try {
            await app.callApi(
              `/learning-stars/${encodeURIComponent(options.courseSlug)}/${encodeURIComponent(options.nodeId)}/reconcile`,
              { method: 'POST', body: '{}' },
            );
            if (owner === identity() && current === generation) refresh();
          } catch {
            if (owner === identity() && current === generation) {
              sync.disabled = false;
              sync.textContent = '同步失败，重试';
            }
          }
        });
        footer.append(sync);
      }
    }
    if (footer.childElementCount) container.append(footer);
  }
  async function load(container, options) {
    const owner = identity();
    const current = generation;
    render(container, { ...options, loading: Boolean(owner) });
    if (!owner || !app?.callApi) return;
    const key = `${owner}:${options.courseSlug}`;
    if (!requests.has(key))
      requests.set(
        key,
        app.callApi(`/learning-stars/${encodeURIComponent(options.courseSlug)}`, { method: 'GET' }),
      );
    try {
      const data = await requests.get(key);
      if (
        current !== generation ||
        owner !== identity() ||
        slots.get(container) !== options ||
        !container.isConnected
      )
        return;
      render(container, options, data);
    } catch {
      requests.delete(key);
      if (
        current === generation &&
        owner === identity() &&
        slots.get(container) === options &&
        container.isConnected
      )
        render(container, { ...options, error: true });
    }
  }
  function mount(container, options) {
    if (!container || !options?.courseSlug) return;
    slots.set(container, options);
    load(container, options);
  }
  function refresh() {
    generation += 1;
    requests.clear();
    for (const [container, options] of slots) {
      if (!container.isConnected) slots.delete(container);
      else load(container, options);
    }
  }
  function clearSession() {
    session = identity();
    refresh();
  }
  root.addEventListener('freebbs:session-change', () => {
    const wasStale = sessionStale;
    sessionStale = false;
    if (wasStale || session !== identity()) clearSession();
  });
  root.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      sessionStale = true;
      generation += 1;
      requests.clear();
      for (const [container, options] of slots) render(container, options);
    }
  });
  root.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    try {
      sessionStale = localStorage.getItem('free_bbs_auth_token') !== app?.userState?.token;
    } catch {
      sessionStale = true;
    }
    clearSession();
  });
  const page = document.querySelector('[data-knowledge-page]');
  page?.addEventListener('knowledge:loaded', (event) => {
    const { course, node } = event.detail || {};
    if (!course?.slug || !node?.id) return;
    const container = document.getElementById('learning-selftest-stars');
    if (!container) return;
    const chapter = root.FreeBbsLearningContent?.isChapterNode(node);
    container.hidden = Boolean(chapter);
    if (!chapter) mount(container, { courseSlug: course.slug, nodeId: node.id });
  });
  page?.addEventListener('knowledge:assessment-updated', refresh);
  page?.addEventListener('knowledge:document-saved', refresh);
  const courseSlot = document.getElementById('course-learning-stars');
  if (courseSlot)
    mount(courseSlot, {
      courseSlug: new URLSearchParams(root.location.search).get('course') || 'signals',
    });
  root.FreeBbsLearningStars = { displayModel, mount, refresh };
})(typeof window === 'undefined' ? globalThis : window);
