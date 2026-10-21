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
    function clear() {
      el.courses.replaceChildren();
      el.feedback.replaceChildren();
      el['courses-section'].hidden = true;
      el['feedback-section'].hidden = true;
      el['courses-status'].textContent = '';
      el['feedback-status'].textContent = '';
    }
    function controls() {
      el.signin.hidden = Boolean(session());
      el.certify.hidden = !session();
      el.refresh.hidden = !session();
      el.refresh.disabled = loading || !session();
    }
    function text(tag, value, className) {
      const node = doc.createElement(tag);
      node.textContent = value || '';
      if (className) node.className = className;
      return node;
    }
    function render(payload) {
      clear();
      if (!payload.eligible) {
        el.status.textContent =
          '教师身份尚未核实。您仍可体验公开课程，已有申请可前往认证页查看进度。';
        return;
      }
      el.status.textContent = `${payload.identity?.fullName ? `${payload.identity.fullName}，欢迎回来。` : '欢迎回来。'}教师身份已核实。`;
      el['courses-section'].hidden = false;
      el['feedback-section'].hidden = false;
      const courses = (payload.courses || []).filter((item) => slugValid(item.slug));
      el['courses-status'].textContent = courses.length
        ? '点击课程进入章节与知识点。'
        : '暂未关联任教课程。请联系工作组核实关联；也可以先从学习世界体验课程。';
      courses.forEach((course) => {
        const card = text('article', '', 'teacher-course-card');
        card.append(
          text('p', course.code, 'teacher-eyebrow'),
          text('h3', course.name || course.slug),
        );
        const link = text('a', '查看课程 →');
        link.href = courseHref(course.slug);
        card.append(link);
        el.courses.append(card);
      });
      const feedback = Array.isArray(payload.feedback) ? payload.feedback : [];
      el['feedback-status'].textContent = feedback.length
        ? `最近 ${feedback.length} 条本人提交。完整处理记录可进入对应知识点查看。`
        : '还没有意见记录。读到需要补充或纠正的地方时，随时提交。';
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
      clear();
      el.status.textContent = '登录后可查看身份和任教课程。';
      controls();
      if (key) load();
    }
    el.refresh.addEventListener('click', load);
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
