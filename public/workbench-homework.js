(() => {
  const app = window.freeBbsApp;
  const root = document.getElementById('workbench-homework');
  if (!app || !root) return;
  const course = document.getElementById('homework-course');
  const filter = document.getElementById('homework-status-filter');
  const list = document.getElementById('homework-list');
  const message = document.getElementById('homework-message');
  const dialog = document.getElementById('homework-dialog');
  const detail = document.getElementById('homework-detail');
  const detailMessage = document.getElementById('homework-detail-message');
  const labels = { unsubmitted: '未交', submitted: '已交', graded: '已批' };
  const roles = {
    assignment: '题目附件',
    answer: '参考答案',
    submitted: '已交文件',
    feedback: '批改附件',
    attachment: '附件',
  };
  let semester = '';
  let items = [];
  let syncStatus = '';
  let version = 0;
  let selection = 0;
  let observedToken = app.userState.token;
  let observedOwner = app.userState.uid || app.userState.username || '';
  const base = '/workbench/connectors/tsinghua/homework/semesters/';
  const encode = encodeURIComponent;
  const pathFor = (item) => `${base}${encode(semester)}/items/${encode(item.sourceReference)}`;
  const date = (value) =>
    value
      ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      : '未提供';
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, handler) {
    const element = node('button', text);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }
  async function request(path, options = {}, blob = false) {
    const { token } = app.userState;
    if (!token || !app.userState.isLoggedIn) throw new Error('请先登录本站。');
    const response = await fetch(`${app.apiBaseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    if (token !== app.userState.token) throw new Error('账号已切换，请重新打开作业。');
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || '作业操作失败，请稍后重试。');
    }
    const result = blob ? await response.blob() : await response.json();
    if (token !== app.userState.token) throw new Error('账号已切换，请重新打开作业。');
    return result;
  }
  function render() {
    list.replaceChildren();
    const visible = items.filter(
      (item) =>
        (!course.value || item.courseReference === course.value) &&
        (!filter.value || item.status === filter.value),
    );
    visible.sort((a, b) => new Date(a.dueAt || '9999-01-01') - new Date(b.dueAt || '9999-01-01'));
    visible.forEach((item) => {
      const card = node('article', undefined, 'workbench-homework-item');
      card.append(
        node('strong', item.title),
        node(
          'p',
          `${labels[item.status] || '待核对'} · 截止 ${item.deadlineUnverified ? '待核对（请查看网络学堂）' : date(item.dueAt)}${item.submissionType === 0 ? ' · 线下提交' : ''}`,
        ),
        button('详情与下载', () => open(item)),
      );
      list.append(card);
    });
    if (!visible.length) {
      if (items.length) list.append(node('p', '当前筛选下没有作业。'));
      else if (syncStatus)
        list.append(
          node(
            'p',
            syncStatus === 'partial'
              ? '作业尚未完整同步，不能确认该学期没有作业。请重新连接网络学堂后点击“立即同步”。'
              : '该学期暂未同步到作业。请确认所选学期，或点击“立即同步”获取最新作业。',
          ),
        );
    }
  }
  async function load() {
    version += 1;
    const current = version;
    items = [];
    syncStatus = '';
    list.replaceChildren();
    if (!semester) {
      message.textContent = '请先选择并同步一个学期。';
      return;
    }
    message.textContent = '正在读取作业…';
    try {
      const payload = await request(`${base}${encode(semester)}`);
      if (current !== version) return;
      items = payload.items || [];
      syncStatus = payload.syncStatus || 'complete';
      render();
      message.textContent = `${items.length} 项作业 · 同步于 ${date(payload.fetchedAt)}${payload.syncStatus === 'partial' ? ' · 部分同步，列表可能不完整' : ''}。新发布的作业请点击上方“立即同步”。`;
    } catch (error) {
      if (current === version) message.textContent = error.message;
    }
  }
  async function download(item, attachment, current) {
    detailMessage.textContent = '正在下载附件…';
    try {
      const blob = await request(`${pathFor(item)}/attachments/${encode(attachment.id)}`, {}, true);
      if (current !== selection) return;
      const url = URL.createObjectURL(blob);
      const link = node('a');
      link.href = url;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      detailMessage.textContent = '附件已下载。';
    } catch (error) {
      if (current === selection) detailMessage.textContent = error.message;
    }
  }
  function section(title, text) {
    const block = node('section');
    block.append(node('h3', title), node('p', text || '暂无内容', 'workbench-homework-text'));
    detail.append(block);
  }
  function renderDetail(item, current) {
    detail.replaceChildren();
    section(
      '作业状态',
      `${labels[item.status] || '待核对'} · 截止 ${item.deadlineUnverified ? '待核对（请查看网络学堂）' : date(item.dueAt)}${item.lateDueAt ? ` · 补交截止 ${date(item.lateDueAt)}` : ''}`,
    );
    section('作业要求', item.description);
    (item.attachments || []).forEach((attachment) => {
      detail.append(
        button(`${roles[attachment.role] || '附件'}：${attachment.name}`, () =>
          download(item, attachment, current),
        ),
      );
    });
    if (item.submittedContent) section('已交正文', item.submittedContent);
    if (item.answer) section('参考答案', item.answer);
    if (item.grade != null || item.feedback)
      section(
        '教师反馈',
        [item.grade == null ? '' : `成绩：${item.grade}`, item.feedback].filter(Boolean).join('\n'),
      );
    const original = node('a', '在网络学堂查看 ↗');
    original.href = `https://learn.tsinghua.edu.cn/f/wlxt/kczy/zy/student/viewCj?wlkcid=${encode(item.providerCourseId)}&xszyid=${encode(item.providerStudentHomeworkId)}`;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    detail.append(original);
    detail.append(button('重新检测作业状态与详情', () => open(item)));
  }
  async function open(item) {
    selection += 1;
    const current = selection;
    detail.replaceChildren();
    detailMessage.textContent = '正在核对学堂详情…';
    document.getElementById('homework-dialog-title').textContent = item.title;
    if (!dialog.open) dialog.showModal();
    try {
      const payload = await request(pathFor(item));
      if (current !== selection) return;
      renderDetail(payload.homework, current);
      detailMessage.textContent = '';
    } catch (error) {
      if (current === selection) detailMessage.textContent = error.message;
    }
  }
  function clear() {
    version += 1;
    selection += 1;
    items = [];
    syncStatus = '';
    semester = '';
    list.replaceChildren();
    detail.replaceChildren();
    dialog.close();
    message.textContent = '连接学堂并同步学期后显示作业。';
  }
  window.addEventListener('freebbs:campus-semester', (event) => {
    selection += 1;
    dialog.close();
    detail.replaceChildren();
    semester = event.detail?.id || '';
    course.replaceChildren(new Option('全部课程', ''));
    (event.detail?.courses || []).forEach((entry) =>
      course.append(new Option(entry.title, entry.sourceReference)),
    );
    load();
  });
  window.addEventListener('freebbs:campus-course-homework', (event) => {
    course.value = event.detail.courseReference;
    render();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('freebbs:session-change', () => {
    const owner = app.userState.uid || app.userState.username || '';
    if (app.userState.token === observedToken) return;
    observedToken = app.userState.token;
    if (!observedToken || owner !== observedOwner) clear();
    else {
      selection += 1;
      detail.replaceChildren();
      dialog.close();
      load();
    }
    observedOwner = owner;
  });
  window.addEventListener('freebbs:campus-disconnected', clear);
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) clear();
  });
  course.addEventListener('change', render);
  filter.addEventListener('change', render);
  document.getElementById('homework-refresh').addEventListener('click', load);
  document.getElementById('homework-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selection += 1;
    detail.replaceChildren();
  });
})();
