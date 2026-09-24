(() => {
  const app = window.freeBbsApp;
  const section = document.getElementById('workbench-course-calendar');
  if (!app || !section) return;
  const form = document.getElementById('workbench-course-calendar-form');
  const monday = document.getElementById('workbench-course-calendar-monday');
  const save = document.getElementById('workbench-course-calendar-save');
  const status = document.getElementById('workbench-course-calendar-status');
  const issues = document.getElementById('workbench-course-calendar-issues');
  const semesterSelect = document.getElementById('workbench-campus-semester');
  const dialog = document.getElementById('workbench-course-calendar-detail');
  let selected = '';
  let version = 0;
  const owner = () =>
    app.userState?.isLoggedIn ? `${app.userState.uid || ''}:${app.userState.token || ''}` : '';
  let currentOwner = owner();
  const reset = () => {
    version += 1;
    selected = '';
    section.hidden = true;
    monday.value = '';
    status.textContent = '';
    issues.replaceChildren();
    save.disabled = false;
    monday.disabled = false;
    if (dialog.open) dialog.close();
  };
  const render = (data) => {
    monday.value = data.firstWeekMonday || '';
    issues.replaceChildren(
      ...(Array.isArray(data.issues) ? data.issues : []).map((issue) => {
        const item = document.createElement('li');
        item.textContent = `${issue.title || '课程'}：${issue.message || '上课信息不完整，暂未生成。'}`;
        return item;
      }),
    );
    status.textContent = data.firstWeekMonday
      ? `已设置本学期校历；${data.parsedCourses || 0} / ${data.totalCourses || 0} 门课程可自动生成固定日程。`
      : '请先填写第一教学周的周一日期；未设置前不会猜测或生成课程。';
  };
  async function load(semesterId) {
    reset();
    if (!semesterId || !owner()) return;
    selected = semesterId;
    section.hidden = false;
    version += 1;
    const requestVersion = version;
    const requestOwner = owner();
    save.disabled = true;
    status.textContent = '正在读取课程校历和时间识别结果…';
    try {
      const data = await app.callApi(
        `/workbench/campus/course-calendar?${new URLSearchParams({ semester: semesterId })}`,
        { method: 'GET' },
      );
      if (requestVersion !== version || requestOwner !== owner()) return;
      render(data);
    } catch (error) {
      if (requestVersion !== version || requestOwner !== owner()) return;
      status.textContent = error.message || '课程校历读取失败，请重新选择学期后重试。';
    } finally {
      if (requestVersion === version && requestOwner === owner()) save.disabled = false;
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selected || !owner() || save.disabled) return;
    const date = new Date(`${monday.value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.getUTCDay() !== 1) {
      status.textContent = '第一教学周起点必须是周一，请按本学期校历填写。';
      return;
    }
    version += 1;
    const requestVersion = version;
    const requestOwner = owner();
    save.disabled = true;
    monday.disabled = true;
    status.textContent = '正在保存校历并生成课程…';
    try {
      const data = await app.callApi('/workbench/campus/course-calendar', {
        method: 'PUT',
        body: JSON.stringify({ semesterId: selected, firstWeekMonday: monday.value }),
      });
      if (requestVersion !== version || requestOwner !== owner()) return;
      render(data);
      window.dispatchEvent(new CustomEvent('freebbs:course-calendar-updated'));
    } catch (error) {
      if (requestVersion !== version || requestOwner !== owner()) return;
      status.textContent = error.message || '校历保存失败，请重试。';
    } finally {
      if (requestVersion === version && requestOwner === owner()) {
        save.disabled = false;
        monday.disabled = false;
      }
    }
  });
  window.addEventListener('freebbs:campus-semester', (event) => load(event.detail?.id));
  semesterSelect?.addEventListener('change', reset);
  window.addEventListener('freebbs:session-change', () => {
    const nextOwner = owner();
    if (nextOwner !== currentOwner) reset();
    currentOwner = nextOwner;
  });
  window.addEventListener('freebbs:course-calendar-show', (event) => {
    const item = event.detail;
    if (!owner() || !item?.courseScheduleReference) return;
    const format = (value) =>
      new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      });
    document.getElementById('workbench-course-calendar-title').textContent = item.title;
    document.getElementById('workbench-course-calendar-time').textContent =
      `${format(item.startAt)} — ${format(item.endAt)} · 北京时间`;
    document.getElementById('workbench-course-calendar-description').textContent =
      item.description || '暂无地点/备注';
    if (!dialog.open) dialog.showModal();
  });
  document
    .getElementById('workbench-course-calendar-close')
    .addEventListener('click', () => dialog.close());
  if (semesterSelect?.value) load(semesterSelect.value);
})();
