(() => {
  const STATUSES = { pending: '待处理', handled: '已处理', declined: '暂不采纳' };
  const slugValid = (value) =>
    typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(value);
  function courseHref(slug) {
    return `/course?${new URLSearchParams({ course: slug })}`;
  }
  function feedbackHref(item) {
    if (!slugValid(item.courseSlug)) return '/world';
    if (typeof item.pointId !== 'string' || !item.pointId || item.pointId.length > 120)
      return courseHref(item.courseSlug);
    return `/knowledge?${new URLSearchParams({ course: item.courseSlug, point: item.pointId, view: 'reading', tool: 'contribute' })}`;
  }
  function installTeacherParticipation({ document: doc, window: host, app }) {
    if (!doc.querySelector('[data-teacher-participation]') || !app) return;
    const el = Object.fromEntries(
      [
        'status',
        'signin',
        'certify',
        'refresh',
        'courses-section',
        'courses-status',
        'courses',
        'feedback-section',
        'feedback-course',
        'feedback-status',
        'feedback',
      ].map((name) => [name, doc.getElementById(`teacher-${name}`)]),
    );
    if (Object.values(el).some((node) => !node)) return;
    let owner = null;
    let generation = 0;
    let request = 0;
    let loading = false;
    let externalChange = false;
    let feedbackEntries = [];
    const feedbackCourses = new Map();
    let selectedCourse = '';
    function storedSessionMatches() {
      try {
        if (typeof host.localStorage?.getItem !== 'function') return true;
        return host.localStorage.getItem('free_bbs_auth_token') === app.userState.token;
      } catch {
        return false;
      }
    }
    const session = () =>
      !externalChange &&
      storedSessionMatches() &&
      app.userState.isLoggedIn &&
      app.userState.uid &&
      app.userState.token
        ? `${app.userState.uid}:${app.userState.token}:${app.userState.role || ''}`
        : '';
    const owns = (key, epoch, ticket) =>
      key === session() && epoch === generation && ticket === request;
    function clear(resetFilter = false) {
      el.courses.replaceChildren();
      el.feedback.replaceChildren();
      el['courses-section'].hidden = true;
      el['feedback-section'].hidden = true;
      el['courses-status'].textContent = '';
      el['feedback-status'].textContent = '';
      feedbackEntries = [];
      feedbackCourses.clear();
      el['feedback-course'].replaceChildren();
      el['feedback-course'].value = '';
      el['feedback-course'].disabled = true;
      if (resetFilter) selectedCourse = '';
      el.certify.textContent = '申请或查看教师认证';
      el.certify.href = '/settings?certification=teacher#certifications';
    }
    function controls() {
      el.signin.hidden = Boolean(session());
      el.certify.hidden = !session();
      el.refresh.hidden = !session();
      el.refresh.disabled = loading || !session();
      el['feedback-course'].disabled =
        loading || !session() || el['feedback-section'].hidden || feedbackCourses.size === 0;
    }
    function text(tag, value, className) {
      const node = doc.createElement(tag);
      node.textContent = value || '';
      if (className) node.className = className;
      return node;
    }
    function renderFeedback() {
      el.feedback.replaceChildren();
      const feedback = selectedCourse
        ? feedbackEntries.filter((item) => item.courseSlug === selectedCourse)
        : feedbackEntries;
      let summary = '还没有意见记录。读到需要补充或纠正的地方时，随时提交。';
      if (selectedCourse) {
        const name = feedbackCourses.get(selectedCourse);
        summary = feedback.length
          ? `「${name}」：${feedback.length} 条近期本人意见。更早记录可进入对应知识点查看。`
          : `当前显示的近期本人意见中，暂没有「${name}」的记录。`;
      } else if (feedback.length)
        summary = `最近 ${feedback.length} 条本人提交。可按课程筛选，更早记录可进入对应知识点查看。`;
      el['feedback-status'].textContent = summary;
      feedback.forEach((item) => {
        const card = text('article', '', 'teacher-feedback-card');
        const heading = text('div', '', 'teacher-panel-heading');
        const link = text('a', item.title || '课程建议');
        link.href = feedbackHref(item);
        heading.append(
          link,
          text('span', STATUSES[item.status] || '待处理', 'teacher-feedback-state'),
        );
        card.append(
          heading,
          text('p', [item.courseName, item.pointTitle].filter(Boolean).join(' · '), 'teacher-help'),
        );
        if (item.excerpt) card.append(text('blockquote', item.excerpt));
        if (item.content) card.append(text('p', item.content, 'teacher-feedback-content'));
        if (item.response)
          card.append(text('p', `课程组回复：${item.response}`, 'teacher-feedback-response'));
        const updated = new Date(item.updatedAt);
        if (Number.isFinite(updated.getTime()))
          card.append(text('p', updated.toLocaleDateString('zh-CN'), 'teacher-help'));
        el.feedback.append(card);
      });
    }
    function chooseFeedbackCourse(slug, move = false) {
      if (!session() || loading || el['feedback-section'].hidden) return;
      selectedCourse = feedbackCourses.has(slug) ? slug : '';
      el['feedback-course'].value = selectedCourse;
      renderFeedback();
      if (move) {
        el['feedback-section'].scrollIntoView?.({ block: 'start', behavior: 'auto' });
        el['feedback-course'].focus?.({ preventScroll: true });
      }
    }
    function render(payload) {
      clear();
      if (!payload.eligible) {
        selectedCourse = '';
        el.status.textContent =
          '教师身份尚未核实。您仍可体验公开课程，已有申请可前往认证页查看进度。';
        return;
      }
      el.status.textContent = `${payload.identity?.fullName ? `${payload.identity.fullName}，欢迎回来。` : '欢迎回来。'}教师身份已核实。`;
      el.certify.textContent = '查看身份信息';
      el.certify.href = '/settings#certifications';
      el['courses-section'].hidden = false;
      el['feedback-section'].hidden = false;
      const courses = (payload.courses || []).filter((item) => slugValid(item?.slug));
      el['courses-status'].textContent = courses.length
        ? `管理员已分配 ${courses.length} 门课程。可查看资料、提交意见或回看回复。`
        : '暂未分配课程。请联系管理员分配；也可以先从学习世界体验课程。';
      feedbackEntries = (payload.feedback || []).filter((item) => item && typeof item === 'object');
      for (const course of courses) feedbackCourses.set(course.slug, course.name || course.slug);
      for (const item of feedbackEntries)
        if (slugValid(item.courseSlug) && !feedbackCourses.has(item.courseSlug))
          feedbackCourses.set(item.courseSlug, item.courseName || item.courseSlug);
      const all = text('option', '全部课程');
      all.value = '';
      el['feedback-course'].append(all);
      for (const [slug, name] of feedbackCourses) {
        const option = text('option', name);
        option.value = slug;
        el['feedback-course'].append(option);
      }
      if (!feedbackCourses.has(selectedCourse)) selectedCourse = '';
      el['feedback-course'].value = selectedCourse;
      courses.forEach((course) => {
        const card = text('article', '', 'teacher-course-card');
        card.dataset.course = course.slug;
        card.append(
          text('p', course.code, 'teacher-eyebrow'),
          text('h3', course.name || course.slug),
        );
        const actions = text('div', '', 'teacher-course-actions');
        const link = text('a', '查看课程 →');
        link.href = courseHref(course.slug);
        const opinions = text('button', '查看我的意见', 'bbs-action');
        opinions.type = 'button';
        opinions.dataset.actionTone = 'quiet';
        opinions.dataset.teacherFeedbackCourse = course.slug;
        opinions.setAttribute('aria-label', `查看我的意见：${course.name || course.slug}`);
        opinions.addEventListener('click', () => chooseFeedbackCourse(course.slug, true));
        actions.append(link, opinions);
        card.append(actions);
        el.courses.append(card);
      });
      renderFeedback();
    }
    async function load() {
      const key = session();
      if (!key || loading) return;
      const epoch = generation;
      request += 1;
      const ticket = request;
      loading = true;
      clear();
      el.status.textContent = '正在读取教师状态…';
      controls();
      try {
        const payload = await app.callApi('/teacher/workspace');
        if (!owns(key, epoch, ticket)) return;
        if (
          typeof payload.eligible !== 'boolean' ||
          !Array.isArray(payload.courses) ||
          !Array.isArray(payload.feedback)
        )
          throw new Error('教师信息格式不完整，请重试。');
        render(payload);
      } catch (error) {
        if (owns(key, epoch, ticket))
          el.status.textContent = `${error.message || '暂时无法读取教师信息'} 点击“刷新状态”重试。`;
      } finally {
        if (owns(key, epoch, ticket)) {
          loading = false;
          controls();
        }
      }
    }
    function sync() {
      const key = session();
      if (owner === key) {
        controls();
        return;
      }
      owner = key;
      generation += 1;
      loading = false;
      clear(true);
      el.status.textContent = '登录后可查看身份和分配的课程。';
      controls();
      if (key) load();
    }
    el.refresh.addEventListener('click', load);
    el['feedback-course'].addEventListener('change', () =>
      chooseFeedbackCourse(el['feedback-course'].value),
    );
    host.addEventListener('freebbs:session-change', () => {
      externalChange = false;
      sync();
    });
    host.addEventListener('freebbs:certifications-updated', () => {
      if (!loading) load();
    });
    host.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) {
        externalChange = true;
        sync();
      }
    });
    host.addEventListener('pagehide', () => {
      externalChange = true;
      sync();
    });
    host.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        externalChange = !storedSessionMatches();
        sync();
        if (externalChange) el.status.textContent = '账号状态已变化或无法确认，请刷新页面后继续。';
      }
    });
    controls();
    Promise.resolve(app.sessionReady).then(sync);
  }
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { installTeacherParticipation, courseHref, feedbackHref };
  else installTeacherParticipation({ document, window, app: window.freeBbsApp });
})();
