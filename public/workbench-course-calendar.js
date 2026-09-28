(() => {
  const app = window.freeBbsApp;
  const section = document.getElementById('workbench-course-calendar');
  if (!app || !section) return;
  const form = document.getElementById('workbench-course-calendar-form');
  const monday = document.getElementById('workbench-course-calendar-monday');
  const teachingWeeks = document.getElementById('workbench-course-calendar-weeks');
  const save = document.getElementById('workbench-course-calendar-save');
  const status = document.getElementById('workbench-course-calendar-status');
  const issues = document.getElementById('workbench-course-calendar-issues');
  const semesterSelect = document.getElementById('workbench-campus-semester');
  const dialog = document.getElementById('workbench-course-calendar-detail');
  const preset = document.getElementById('workbench-calendar-preset');
  const skipDates = document.getElementById('workbench-calendar-skip');
  const includeDates = document.getElementById('workbench-calendar-include');
  const sections = document.getElementById('workbench-calendar-sections');
  const holidays = document.getElementById('workbench-calendar-holidays');
  let presets = [];
  let courseSections = {};
  const renderDate = () => {
    const label = document.getElementById('workbench-date');
    if (label && window.FreeBbsAcademicCalendar)
      label.textContent = window.FreeBbsAcademicCalendar.format();
  };
  const renderHolidays = () => {
    const calendar = presets.find((item) => item.id === preset.value);
    holidays.textContent = calendar
      ? calendar.holidays
          .map(
            (item) =>
              `${item.name}：${item.start}${item.start !== item.end ? ` 至 ${item.end}` : ''}`,
          )
          .join('；')
      : '自定义校历：可填写停课日期。';
  };
  preset.addEventListener('change', () => {
    const calendar = presets.find((item) => item.id === preset.value);
    if (calendar) monday.value = calendar.firstWeekMonday;
    renderHolidays();
  });
  monday.addEventListener('change', () => {
    if (presets.find((item) => item.id === preset.value)?.firstWeekMonday !== monday.value)
      preset.value = '';
    renderHolidays();
  });
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
    teachingWeeks.value = '';
    preset.replaceChildren(new Option('自定义校历', ''));
    skipDates.value = '';
    includeDates.value = '';
    sections.replaceChildren();
    holidays.textContent = '';
    presets = [];
    courseSections = {};
    status.textContent = '';
    issues.replaceChildren();
    save.disabled = false;
    monday.disabled = false;
    teachingWeeks.disabled = false;
    if (dialog.open) dialog.close();
  };
  const render = (data) => {
    window.FreeBbsAcademicCalendar?.setSemester(data);
    renderDate();
    monday.value = data.firstWeekMonday || '';
    teachingWeeks.value = data.teachingWeeks || '';
    presets = data.presets || [];
    preset.replaceChildren(
      new Option('自定义校历', ''),
      ...presets.map((item) => new Option(item.name, item.id)),
    );
    preset.value = data.options?.holidayPreset || '';
    skipDates.value = (data.options?.skipDates || []).join('\n');
    includeDates.value = (data.options?.includeDates || []).join('\n');
    courseSections = data.options?.courseSections || {};
    sections.replaceChildren(
      ...(data.courses || []).map((course) => {
        const row = document.createElement('div');
        row.className = 'workbench-calendar-course-options';
        const title = document.createElement('strong');
        title.textContent = course.title;
        row.append(title);
        for (const number of course.sections) {
          const label = document.createElement('label');
          const text = document.createElement('span');
          text.textContent = `第 ${number} 大节`;
          const select = document.createElement('select');
          select.dataset.courseReference = course.reference;
          select.dataset.section = number;
          const choices = data.sectionChoices?.[number] || [];
          select.replaceChildren(
            ...choices.map(
              (choice) =>
                new Option(`${choice.count} 小节 · ${choice.start}–${choice.end}`, choice.count),
            ),
          );
          select.value = courseSections[course.reference]?.[number] || choices.at(-1)?.count || '';
          label.append(text, select);
          row.append(label);
        }
        return row;
      }),
    );
    renderHolidays();
    issues.replaceChildren(
      ...(Array.isArray(data.issues) ? data.issues : []).map((issue) => {
        const item = document.createElement('li');
        item.textContent = `${issue.title || '课程'}：${issue.message || '上课信息不完整，暂未生成。'}`;
        return item;
      }),
    );
    status.textContent = data.firstWeekMonday
      ? `已设置本学期校历；${data.parsedCourses || 0} / ${data.totalCourses || 0} 门课程可自动生成固定日程。${data.skippedLessons ? `已跳过 ${data.skippedLessons} 次假期课程。` : ''}`
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
    const count = teachingWeeks.value === '' ? null : Number(teachingWeeks.value);
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > 53)) {
      status.textContent = '教学周数必须是 1–53 的整数，请按本学期校历确认';
      return;
    }
    version += 1;
    const requestVersion = version;
    const requestOwner = owner();
    save.disabled = true;
    monday.disabled = true;
    teachingWeeks.disabled = true;
    status.textContent = '正在保存校历并生成课程…';
    try {
      const counts = Object.fromEntries(
        Object.entries(courseSections).map(([key, value]) => [key, { ...value }]),
      );
      sections.querySelectorAll('select[data-course-reference]').forEach((select) => {
        const key = select.dataset.courseReference;
        if (!Object.hasOwn(counts, key))
          Object.defineProperty(counts, key, { value: {}, enumerable: true });
        counts[key][select.dataset.section] = Number(select.value);
      });
      const data = await app.callApi('/workbench/campus/course-calendar', {
        method: 'PUT',
        body: JSON.stringify({
          semesterId: selected,
          firstWeekMonday: monday.value,
          teachingWeeks: count,
          options: {
            holidayPreset: preset.value,
            skipDates: skipDates.value
              .split(/[\n,，;；]+/)
              .map((dateText) => dateText.trim())
              .filter(Boolean),
            includeDates: includeDates.value
              .split(/[\n,，;；]+/)
              .map((dateText) => dateText.trim())
              .filter(Boolean),
            courseSections: counts,
          },
        }),
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
        teachingWeeks.disabled = false;
      }
    }
  });
  window.addEventListener('freebbs:campus-semester', (event) => load(event.detail?.id));
  semesterSelect?.addEventListener('change', reset);
  window.addEventListener('freebbs:session-change', () => {
    const nextOwner = owner();
    if (nextOwner !== currentOwner) {
      reset();
      window.FreeBbsAcademicCalendar?.reset();
      renderDate();
    }
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
  document.addEventListener('visibilitychange', renderDate);
  setInterval(renderDate, 60000);
  renderDate();
})();
