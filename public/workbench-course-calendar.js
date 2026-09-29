(() => {
  const app = window.freeBbsApp;
  const section = document.getElementById('workbench-course-calendar');
  if (!app || !section) return;
  const status = document.getElementById('workbench-course-calendar-status');
  const issues = document.getElementById('workbench-course-calendar-issues');
  const open = document.getElementById('workbench-course-import-open');
  const modal = document.getElementById('workbench-course-import-dialog');
  const confirm = document.getElementById('workbench-course-import-confirm');
  const resultStatus = document.getElementById('workbench-course-import-status');
  const semesterSelect = document.getElementById('workbench-campus-semester');
  const detail = document.getElementById('workbench-course-calendar-detail');
  const owner = () =>
    app.userState?.isLoggedIn ? `${app.userState.uid || ''}:${app.userState.token || ''}` : '';
  let currentOwner = owner();
  let selected = '';
  let version = 0;
  let imported = false;
  let preview = null;
  const offered = new Set();
  const renderDate = () => {
    const label = document.getElementById('workbench-date');
    if (label && window.FreeBbsAcademicCalendar)
      label.textContent = window.FreeBbsAcademicCalendar.format();
  };
  const reset = () => {
    version += 1;
    selected = '';
    preview = null;
    section.hidden = true;
    open.disabled = false;
    issues.replaceChildren();
    document.getElementById('workbench-course-import-list').replaceChildren();
    document.getElementById('workbench-course-import-summary').textContent = '';
    resultStatus.textContent = '';
    if (modal.open) modal.close();
    if (detail.open) detail.close();
  };
  const current = (token, user) => token === version && user === owner();
  async function showPreview(refresh = false) {
    if (!selected || !owner() || open.disabled) return;
    const semester = selected;
    const token = version;
    const user = owner();
    open.disabled = true;
    status.textContent = refresh ? '正在从网络学堂重新读取课程…' : '正在准备课程预览…';
    try {
      if (refresh) {
        const started = await app.callApi('/workbench/connectors/tsinghua/sync-runs', {
          method: 'POST',
          body: JSON.stringify({ semesterId: semester }),
        });
        if (!started.run?.publicId) throw new Error('未能启动同步，请稍后重试。');
        let finished = false;
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 1000);
          });
          if (!current(token, user)) return;
          const state = await app.callApi(
            `/workbench/connectors/tsinghua/sync-runs/${encodeURIComponent(started.run.publicId)}`,
            { method: 'GET' },
          );
          if (['succeeded', 'partial'].includes(state.run?.status)) {
            finished = true;
            break;
          }
          if (['failed', 'cancelled'].includes(state.run?.status))
            throw new Error('课程同步失败，原有安排没有改变。');
        }
        if (!finished) throw new Error('同步等待超时，原有安排没有改变，请稍后重试。');
      }
      if (!current(token, user)) return;
      const data = await app.callApi(
        `/workbench/campus/course-import?${new URLSearchParams({ semester })}`,
        { method: 'GET' },
      );
      if (!current(token, user)) return;
      preview = data;
      document.getElementById('workbench-course-import-summary').textContent =
        `${data.courses.length} 门课程 · ${data.scheduledLessons} 次安排${data.skippedLessons ? ` · 跳过假期 ${data.skippedLessons} 次` : ''}`;
      document.getElementById('workbench-course-import-list').replaceChildren(
        ...data.courses.map((course) => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          title.textContent = course.title;
          const time = document.createElement('p');
          time.textContent = [course.schedule, course.location].filter(Boolean).join(' · ');
          item.append(title, time);
          return item;
        }),
      );
      resultStatus.textContent = (data.issues || [])
        .map((issue) => `${issue.title}：${issue.message}`)
        .join('\n');
      confirm.disabled = !data.scheduledLessons;
      status.textContent = imported ? '课程已保存，等待确认新的接入。' : '确认后加入个人计划表。';
      if (!modal.open) modal.showModal();
      offered.add(`${user}:${semester}`);
    } catch (error) {
      if (current(token, user))
        status.textContent = error.message || '读取课程失败，原有安排没有改变。';
    } finally {
      if (current(token, user)) open.disabled = false;
    }
  }
  async function load(semesterId) {
    reset();
    if (!semesterId || !owner()) return;
    selected = semesterId;
    section.hidden = false;
    const token = version;
    const user = owner();
    open.disabled = true;
    status.textContent = '正在读取已保存课程…';
    try {
      const data = await app.callApi(
        `/workbench/campus/course-calendar?${new URLSearchParams({ semester: semesterId })}`,
        { method: 'GET' },
      );
      if (!current(token, user)) return;
      imported = data.imported;
      open.textContent = imported ? '重新接入课程' : '接入课程';
      status.textContent = imported
        ? '课程已保存在个人计划表。'
        : '课程已就绪，确认后加入个人计划表。';
      open.disabled = false;
      const key = `${user}:${semesterId}`;
      if (!imported && !offered.has(key)) {
        await showPreview();
      }
    } catch (error) {
      if (current(token, user)) status.textContent = error.message || '课程读取失败，请稍后重试。';
    } finally {
      if (current(token, user)) open.disabled = false;
    }
  }
  open.addEventListener('click', () => showPreview(imported));
  confirm.addEventListener('click', async () => {
    if (!preview || confirm.disabled || !owner()) return;
    const token = version;
    const user = owner();
    const semesterId = selected;
    confirm.disabled = true;
    resultStatus.textContent = '正在保存课程…';
    try {
      await app.callApi('/workbench/campus/course-import', {
        method: 'POST',
        body: JSON.stringify({ semesterId, revision: preview.revision }),
      });
      if (!current(token, user)) return;
      modal.close();
      await load(semesterId);
      window.dispatchEvent(new CustomEvent('freebbs:course-calendar-updated'));
    } catch (error) {
      if (current(token, user)) {
        resultStatus.textContent = error.message || '保存失败，请重新预览后重试。';
        confirm.disabled = false;
      }
    }
  });
  window.addEventListener('freebbs:campus-semester', (event) => load(event.detail?.id));
  semesterSelect?.addEventListener('change', reset);
  window.addEventListener('freebbs:session-change', () => {
    const next = owner();
    if (next !== currentOwner) {
      reset();
      offered.clear();
      window.FreeBbsAcademicCalendar?.reset();
      renderDate();
    }
    currentOwner = next;
  });
  window.addEventListener('freebbs:course-calendar-show', (event) => {
    const item = event.detail;
    if (!owner() || !item?.courseScheduleReference) return;
    const format = (value) =>
      new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    document.getElementById('workbench-course-calendar-title').textContent = item.title;
    document.getElementById('workbench-course-calendar-time').textContent =
      `${format(item.startAt)} — ${format(item.endAt)} · 北京时间`;
    document.getElementById('workbench-course-calendar-description').textContent =
      item.description || '暂无地点/备注';
    if (!detail.open) detail.showModal();
  });
  document
    .getElementById('workbench-course-calendar-close')
    .addEventListener('click', () => detail.close());
  if (semesterSelect?.value) load(semesterSelect.value);
  document.addEventListener('visibilitychange', renderDate);
  setInterval(renderDate, 60000);
  renderDate();
})();
