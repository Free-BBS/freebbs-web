(() => {
  const shell = document.querySelector('.workbench-shell');
  const app = window.freeBbsApp;

  if (!shell || !app) {
    return;
  }

  const elements = {
    importantList: document.getElementById('workbench-priority-list'),
    notificationList: document.getElementById('workbench-notification-list'),
    scheduleList: document.getElementById('workbench-schedule-list'),
    addImportant: document.getElementById('workbench-add-important'),
    addSchedule: document.getElementById('workbench-add-schedule'),
    notificationCategory: document.getElementById('workbench-notification-category'),
    notificationFilters: Array.from(
      document.querySelectorAll('[data-workbench-notification-filter]'),
    ),
    importantDialog: document.getElementById('workbench-important-dialog'),
    importantDialogTitle: document.getElementById('workbench-important-dialog-title'),
    importantForm: document.getElementById('workbench-important-form'),
    importantId: document.getElementById('workbench-important-id'),
    importantTitle: document.getElementById('workbench-important-title'),
    importantDescription: document.getElementById('workbench-important-description'),
    importantDue: document.getElementById('workbench-important-due'),
    importantPriority: document.getElementById('workbench-important-priority'),
    importantFormStatus: document.getElementById('workbench-important-form-status'),
    scheduleDialog: document.getElementById('workbench-schedule-dialog'),
    scheduleDialogTitle: document.getElementById('workbench-schedule-dialog-title'),
    scheduleForm: document.getElementById('workbench-schedule-form'),
    scheduleId: document.getElementById('workbench-schedule-id'),
    scheduleVersion: document.getElementById('workbench-schedule-version'),
    scheduleTitle: document.getElementById('workbench-schedule-title'),
    scheduleDescription: document.getElementById('workbench-schedule-description'),
    scheduleStart: document.getElementById('workbench-schedule-start'),
    scheduleEnd: document.getElementById('workbench-schedule-end'),
    scheduleAllDay: document.getElementById('workbench-schedule-all-day'),
    scheduleFormStatus: document.getElementById('workbench-schedule-form-status'),
    scheduleSubmit: document.getElementById('workbench-schedule-submit'),
    conflictPanel: document.getElementById('workbench-conflict-panel'),
    sourceProbe: document.getElementById('workbench-source-probe'),
    sourceStatus: document.getElementById('workbench-source-status'),
    sourceMetrics: document.getElementById('workbench-source-metrics'),
    sourceHttp: document.getElementById('workbench-source-http'),
    sourceDuration: document.getElementById('workbench-source-duration'),
    sourceBytes: document.getElementById('workbench-source-bytes'),
    sourceCount: document.getElementById('workbench-source-count'),
    sourceProof: document.getElementById('workbench-source-proof'),
    sourceResults: document.getElementById('workbench-source-results'),
    campusSemester: document.getElementById('workbench-campus-semester'),
    campusCoursesStatus: document.getElementById('workbench-campus-courses-status'),
    campusCourseList: document.getElementById('workbench-campus-course-list'),
    campusNoticeList: document.getElementById('workbench-campus-notice-list'),
  };

  const CATEGORY_LABELS = {
    course: '课程',
    organization: '组织',
    personal: '个人',
    system: '系统',
    activity: '活动',
  };
  const PRIORITY_LABELS = {
    low: '低优先级',
    normal: '普通',
    high: '重要',
    urgent: '紧急',
  };
  const state = {
    ownerKey: '',
    requestVersion: 0,
    importantItems: [],
    notifications: [],
    scheduleItems: [],
    notificationFilters: { category: '', unread: false, favorite: false },
    conflictAcknowledgement: '',
    campusSemesters: [],
  };

  function getUser() {
    return app.userState || {};
  }

  function getOwnerKey() {
    const user = getUser();
    return String(user.uid || user.username || '');
  }

  function isLoggedIn() {
    return Boolean(getUser().isLoggedIn && getOwnerKey());
  }

  function safeActionUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const url = new URL(raw, window.location.origin);
      if (url.username || url.password) {
        return '';
      }
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function renderCampusSemester(semester) {
    elements.campusCourseList.replaceChildren();
    elements.campusNoticeList.replaceChildren();
    const courses = Array.isArray(semester?.courses) ? semester.courses : [];
    const notices = Array.isArray(semester?.notifications) ? semester.notifications : [];

    if (!courses.length) {
      const empty = document.createElement('p');
      empty.className = 'workbench-campus-empty';
      empty.textContent = '该学期没有同步到课程。';
      elements.campusCourseList.append(empty);
    }
    courses.forEach((course) => {
      const item = document.createElement('article');
      item.className = 'workbench-campus-course';
      const title = document.createElement('strong');
      title.textContent = course.title || '未命名课程';
      const detail = document.createElement('p');
      detail.textContent =
        [course.teacher, course.scheduleText, course.locationText].filter(Boolean).join(' · ') ||
        '暂无教师与上课地点信息';
      item.append(title, detail);
      elements.campusCourseList.append(item);
    });

    if (!notices.length) {
      const empty = document.createElement('p');
      empty.className = 'workbench-campus-empty';
      empty.textContent = '该学期没有同步到课程公告。';
      elements.campusNoticeList.append(empty);
    }
    notices.forEach((notice) => {
      const item = document.createElement('article');
      item.className = 'workbench-campus-notice';
      const title = document.createElement('strong');
      title.textContent = notice.title || '未命名公告';
      const detail = document.createElement('p');
      detail.textContent = truncate(notice.body || '暂无公告正文', 180);
      item.append(title, detail);
      const actionUrl = safeActionUrl(notice.actionUrl);
      if (actionUrl) {
        const link = document.createElement('a');
        link.href = actionUrl;
        link.target = actionUrl.startsWith('http') ? '_blank' : '_self';
        link.rel = 'noopener noreferrer';
        link.textContent = '在网络学堂查看 ↗';
        item.append(link);
      }
      elements.campusNoticeList.append(item);
    });

    elements.campusCoursesStatus.textContent = `同步于 ${formatMoment(semester.fetchedAt)} · ${courses.length} 门课程 · ${notices.length} 条公告${semester.syncStatus === 'partial' ? ' · 部分同步' : ''}`;
  }

  async function loadCampusSemester(semesterId) {
    if (!semesterId) return;
    elements.campusCoursesStatus.textContent = '正在读取该学期课程与公告…';
    try {
      const payload = await app.callApi(
        `/workbench/campus/semesters/${encodeURIComponent(semesterId)}`,
        { method: 'GET' },
      );
      renderCampusSemester(payload.semester);
    } catch (error) {
      elements.campusCoursesStatus.textContent = error.message || '读取学期数据失败';
    }
  }

  async function syncCampusSemester(semesterId) {
    elements.campusSemester.disabled = true;
    elements.campusCoursesStatus.textContent = `正在同步 ${semesterId} 的课程与公告…`;
    try {
      const payload = await app.callApi('/workbench/connectors/tsinghua/sync-runs', {
        method: 'POST',
        body: JSON.stringify({ semesterId }),
      });
      const publicId = payload.run?.publicId;
      if (!publicId) throw new Error('同步任务没有返回有效标识');
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 1000);
        });
        const result = await app.callApi(
          `/workbench/connectors/tsinghua/sync-runs/${encodeURIComponent(publicId)}`,
          { method: 'GET' },
        );
        if (['succeeded', 'partial'].includes(result.run?.status)) {
          await loadCampusSemesters(semesterId);
          window.dispatchEvent(new CustomEvent('freebbs:workbench-refresh'));
          return;
        }
        if (['failed', 'cancelled'].includes(result.run?.status)) {
          throw new Error(result.run.errorCode || '该学期同步失败');
        }
      }
      throw new Error('该学期同步等待超时');
    } catch (error) {
      elements.campusCoursesStatus.textContent = error.message || '该学期同步失败';
      elements.campusSemester.disabled = false;
    }
  }

  async function loadCampusSemesters(preferredSemesterId = '') {
    if (!elements.campusSemester || !isLoggedIn()) return;
    elements.campusSemester.disabled = true;
    try {
      const payload = await app.callApi('/workbench/campus/semesters', { method: 'GET' });
      state.campusSemesters = payload.semesters || [];
      elements.campusSemester.replaceChildren();
      if (!state.campusSemesters.length) {
        elements.campusSemester.append(new Option('尚无同步学期', ''));
        renderCampusSemester({ courses: [], notifications: [] });
        elements.campusCoursesStatus.textContent = '点击“立即同步”后显示网络学堂课程。';
        return;
      }
      state.campusSemesters.forEach((semester) => {
        elements.campusSemester.append(
          new Option(
            `${semester.label || semester.id}${semester.synced ? `（${semester.courseCount} 门）` : '（选择后同步）'}`,
            semester.id,
          ),
        );
      });
      const selectedId = state.campusSemesters.some(
        (semester) => semester.id === preferredSemesterId,
      )
        ? preferredSemesterId
        : payload.currentSemesterId || state.campusSemesters[0].id;
      elements.campusSemester.value = selectedId;
      elements.campusSemester.disabled = false;
      const selected = state.campusSemesters.find((semester) => semester.id === selectedId);
      if (selected?.synced) await loadCampusSemester(selectedId);
      else {
        renderCampusSemester({ courses: [], notifications: [] });
        elements.campusCoursesStatus.textContent = '选择该学期后将从网络学堂同步课程与公告。';
      }
    } catch (error) {
      elements.campusCoursesStatus.textContent = error.message || '读取同步学期失败';
    }
  }

  function truncate(value, maxLength = 110) {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
      : normalized;
  }

  function formatMoment(value, allDay = false) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return '时间待确认';
    }
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
    }).format(date);
  }

  function formatImportantDue(item) {
    if (!item?.dueAt) {
      return item?.sourceType === 'network_classroom'
        ? '网络学堂未提供截止时间'
        : '暂未设置截止时间';
    }
    const dueAt = new Date(item.dueAt);
    if (Number.isNaN(dueAt.getTime())) return '截止时间待确认';
    const remainingMs = dueAt.getTime() - Date.now();
    const absolute = formatMoment(item.dueAt);
    if (remainingMs < 0) return `已逾期 · ${absolute}`;
    if (remainingMs <= 24 * 60 * 60 * 1_000) return `24 小时内截止 · ${absolute}`;
    if (remainingMs <= 48 * 60 * 60 * 1_000) return `48 小时内截止 · ${absolute}`;
    return `截止：${absolute}`;
  }

  function toShanghaiInputValue(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(date)
      .replace(' ', 'T');
  }

  function shanghaiInputToIso(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
      return '';
    }
    const [, year, month, day, hour, minute] = match.map(Number);
    const milliseconds = Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function makeAction(label, action, publicId, className = '') {
    const button = document.createElement('button');
    button.className = `workbench-item-action ${className}`.trim();
    button.type = 'button';
    button.dataset.workbenchAction = action;
    button.dataset.publicId = publicId;
    button.textContent = label;
    return button;
  }

  function makeDataItem({ eyebrow, title, description, href, actions = [], className = '' }) {
    const item = document.createElement('li');
    item.className = `workbench-state-item ${className}`.trim();
    const eyebrowElement = document.createElement('span');
    eyebrowElement.textContent = eyebrow;
    const titleElement = document.createElement('strong');
    titleElement.textContent = title;
    const safeHref = safeActionUrl(href);

    item.append(eyebrowElement);
    if (safeHref) {
      const link = document.createElement('a');
      link.className = 'workbench-state-link';
      link.href = safeHref;
      link.append(titleElement);
      if (new URL(safeHref, window.location.origin).origin !== window.location.origin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      item.append(link);
    } else {
      item.append(titleElement);
    }

    const detail = document.createElement('small');
    detail.textContent = description;
    item.append(detail);
    if (actions.length) {
      const actionRow = document.createElement('div');
      actionRow.className = 'workbench-item-actions';
      actionRow.append(...actions);
      item.append(actionRow);
    }
    return item;
  }

  function renderState(list, eyebrow, title, description, { busy = false, retry = false } = {}) {
    if (!list) {
      return;
    }
    const item = makeDataItem({ eyebrow, title, description });
    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'workbench-item-actions';
      actions.append(makeAction('重新加载', 'retry', ''));
      item.append(actions);
    }
    list.setAttribute('aria-busy', String(busy));
    list.replaceChildren(item);
  }

  function renderImportantItems() {
    const items = state.importantItems.slice(0, 20);
    if (!items.length) {
      renderState(
        elements.importantList,
        '重要事项',
        '暂无重要事项',
        '点击“新增事项”，或从通知中确认需要处理的内容。',
      );
      return;
    }
    elements.importantList.replaceChildren(
      ...items.map((item) =>
        makeDataItem({
          eyebrow:
            item.status === 'draft' ? '待确认草稿' : PRIORITY_LABELS[item.priority] || '事项',
          title: item.title || '未命名事项',
          href: item.actionUrl,
          description: [formatImportantDue(item), truncate(item.description)]
            .filter(Boolean)
            .join(' · '),
          className: item.status === 'draft' ? 'is-draft' : '',
          actions: [
            ...(item.status === 'draft'
              ? [makeAction('确认事项', 'confirm-important', item.publicId, 'is-primary')]
              : []),
            makeAction('编辑', 'edit-important', item.publicId),
            ...(item.status === 'draft'
              ? []
              : [makeAction('完成', 'complete-important', item.publicId, 'is-primary')]),
            makeAction('删除', 'delete-important', item.publicId, 'is-danger'),
          ],
        }),
      ),
    );
    elements.importantList.setAttribute('aria-busy', 'false');
  }

  function renderNotifications() {
    const items = state.notifications.slice(0, 30);
    if (!items.length) {
      const hasFilter = Boolean(
        state.notificationFilters.category ||
        state.notificationFilters.unread ||
        state.notificationFilters.favorite,
      );
      renderState(
        elements.notificationList,
        '通知',
        hasFilter ? '当前筛选下没有通知' : '暂无课程通知',
        hasFilter
          ? '可以清除分类、“未读”或“收藏”筛选后再查看。'
          : '连接并同步网络学堂后，课程公告会显示在这里。',
      );
      return;
    }
    elements.notificationList.replaceChildren(
      ...items.map((item) => {
        const category = CATEGORY_LABELS[item.category] || '通知';
        const unread = !item.readAt;
        return makeDataItem({
          eyebrow: unread ? `未读 · ${category}` : category,
          title: item.title || '未命名通知',
          description: [item.publishedAt ? formatMoment(item.publishedAt) : '', truncate(item.body)]
            .filter(Boolean)
            .join(' · '),
          href: item.actionUrl,
          className: unread ? 'is-unread' : '',
          actions: [
            makeAction(unread ? '标为已读' : '标为未读', 'toggle-notification-read', item.publicId),
            makeAction(
              item.favoritedAt ? '取消收藏' : '收藏',
              'toggle-notification-favorite',
              item.publicId,
              item.favoritedAt ? 'is-primary' : '',
            ),
          ],
        });
      }),
    );
    elements.notificationList.setAttribute('aria-busy', 'false');
  }

  function renderScheduleItems() {
    const items = state.scheduleItems.slice(0, 30);
    if (!items.length) {
      renderState(
        elements.scheduleList,
        '本周时间表',
        '本周暂无日程',
        '作业截止时间会进入重要事项，不会自动占用时间表；你可以手动安排学习时段。',
      );
      return;
    }
    elements.scheduleList.replaceChildren(
      ...items.map((item) => {
        const isDraft = item.status === 'draft';
        const timeWindow = item.allDay
          ? `${formatMoment(item.startAt, true)} · 全天`
          : `${formatMoment(item.startAt)} — ${formatMoment(item.endAt)}`;
        const actions = [];
        if (isDraft) {
          actions.push(makeAction('确认加入', 'confirm-schedule', item.publicId, 'is-primary'));
        }
        actions.push(
          makeAction('编辑', 'edit-schedule', item.publicId),
          makeAction('删除', 'delete-schedule', item.publicId, 'is-danger'),
        );
        let eyebrow = '已确认';
        if (isDraft) eyebrow = 'Agent 草稿 · 待确认';
        else if (item.allDay) eyebrow = '全天';
        return makeDataItem({
          eyebrow,
          title: item.title || '未命名日程',
          description: [timeWindow, truncate(item.description)].filter(Boolean).join(' · '),
          className: isDraft ? 'is-draft' : '',
          actions,
        });
      }),
    );
    elements.scheduleList.setAttribute('aria-busy', 'false');
  }

  function buildNotificationQuery() {
    const query = new URLSearchParams({ limit: '30' });
    const filters = state.notificationFilters;
    if (filters.category) query.set('category', filters.category);
    if (filters.unread) query.set('unread', 'true');
    if (filters.favorite) query.set('favorite', 'true');
    return query.toString();
  }

  function renderDataFailure(list, eyebrow, error) {
    const detail = error?.status === 401 ? '登录状态已失效，请重新登录。' : error?.message;
    renderState(list, eyebrow, '暂时无法加载', detail || '请检查后端服务。', {
      retry: true,
    });
  }

  async function loadWorkbenchData() {
    if (!isLoggedIn()) {
      return;
    }
    const ownerKey = getOwnerKey();
    const requestVersion = state.requestVersion + 1;
    state.requestVersion = requestVersion;
    state.ownerKey = ownerKey;
    renderState(elements.importantList, '重要事项', '正在加载', '正在读取你的个人事项。', {
      busy: true,
    });
    renderState(elements.notificationList, '通知', '正在加载', '正在读取分类通知。', {
      busy: true,
    });
    renderState(elements.scheduleList, '本周时间表', '正在加载', '正在读取本周日程与草稿。', {
      busy: true,
    });

    const [importantResult, notificationResult, scheduleResult] = await Promise.allSettled([
      app.callApi('/workbench/important-items', { method: 'GET' }),
      app.callApi(`/workbench/notifications?${buildNotificationQuery()}`, { method: 'GET' }),
      app.callApi('/workbench/schedule-items', { method: 'GET' }),
    ]);
    if (requestVersion !== state.requestVersion || !isLoggedIn() || getOwnerKey() !== ownerKey) {
      return;
    }

    const results = [importantResult, notificationResult, scheduleResult];
    if (
      results.some((result) => result.status === 'rejected' && result.reason?.status === 401) &&
      typeof app.clearSession === 'function'
    ) {
      app.clearSession();
      return;
    }

    if (importantResult.status === 'fulfilled') {
      state.importantItems = importantResult.value.importantItems || [];
      renderImportantItems();
    } else {
      renderDataFailure(elements.importantList, '重要事项', importantResult.reason);
    }

    if (notificationResult.status === 'fulfilled') {
      state.notifications = notificationResult.value.notifications || [];
      renderNotifications();
    } else {
      renderDataFailure(elements.notificationList, '通知', notificationResult.reason);
    }

    if (scheduleResult.status === 'fulfilled') {
      state.scheduleItems = scheduleResult.value.scheduleItems || [];
      renderScheduleItems();
    } else {
      renderDataFailure(elements.scheduleList, '本周时间表', scheduleResult.reason);
    }
  }

  function openDialog(dialog) {
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    else dialog?.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog?.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
  }

  function requireLogin() {
    if (isLoggedIn()) return true;
    window.location.assign('/login');
    return false;
  }

  function openImportantEditor(item = null) {
    if (!requireLogin()) return;
    elements.importantForm?.reset();
    elements.importantId.value = item?.publicId || '';
    elements.importantTitle.value = item?.title || '';
    elements.importantDescription.value = item?.description || '';
    elements.importantDue.value = toShanghaiInputValue(item?.dueAt);
    elements.importantPriority.value = item?.priority || 'normal';
    elements.importantDialogTitle.textContent = item ? '编辑重要事项' : '新增重要事项';
    elements.importantFormStatus.textContent = '';
    openDialog(elements.importantDialog);
    elements.importantTitle.focus();
  }

  function getDefaultScheduleWindow() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    return {
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    };
  }

  function resetConflictWarning() {
    state.conflictAcknowledgement = '';
    elements.conflictPanel.classList.add('hidden');
    elements.conflictPanel.textContent = '';
    elements.scheduleSubmit.textContent = '保存日程';
  }

  function openScheduleEditor(item = null) {
    if (!requireLogin()) return;
    const fallback = getDefaultScheduleWindow();
    elements.scheduleForm?.reset();
    elements.scheduleId.value = item?.publicId || '';
    elements.scheduleVersion.value = item?.version || '';
    elements.scheduleTitle.value = item?.title || '';
    elements.scheduleDescription.value = item?.description || '';
    elements.scheduleStart.value = toShanghaiInputValue(item?.startAt || fallback.startAt);
    elements.scheduleEnd.value = toShanghaiInputValue(item?.endAt || fallback.endAt);
    elements.scheduleAllDay.checked = Boolean(item?.allDay);
    elements.scheduleDialogTitle.textContent = item ? '编辑日程' : '新增日程';
    elements.scheduleFormStatus.textContent = '';
    resetConflictWarning();
    openDialog(elements.scheduleDialog);
    elements.scheduleTitle.focus();
  }

  async function submitImportant(event) {
    event.preventDefault();
    const publicId = elements.importantId.value;
    const dueAt = elements.importantDue.value
      ? shanghaiInputToIso(elements.importantDue.value)
      : null;
    const submitButton = elements.importantForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    elements.importantFormStatus.textContent = '正在保存…';
    try {
      await app.callApi(
        publicId
          ? `/workbench/important-items/${encodeURIComponent(publicId)}`
          : '/workbench/important-items',
        {
          method: publicId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            title: elements.importantTitle.value,
            description: elements.importantDescription.value,
            dueAt,
            priority: elements.importantPriority.value,
          }),
        },
      );
      closeDialog(elements.importantDialog);
      await loadWorkbenchData();
    } catch (error) {
      elements.importantFormStatus.textContent = error.message || '保存事项失败';
    } finally {
      submitButton.disabled = false;
    }
  }

  async function checkScheduleConflicts(item) {
    const query = new URLSearchParams({ startAt: item.startAt, endAt: item.endAt });
    if (item.publicId) query.set('excludePublicId', item.publicId);
    const payload = await app.callApi(`/workbench/schedule-items/conflicts?${query}`, {
      method: 'GET',
    });
    return payload.conflicts || [];
  }

  function showConflicts(conflicts) {
    elements.conflictPanel.classList.remove('hidden');
    elements.conflictPanel.textContent = `与 ${conflicts.length} 项已确认日程冲突：${conflicts
      .slice(0, 3)
      .map((item) => `${item.title}（${formatMoment(item.startAt)}）`)
      .join('、')}。再次点击“仍然保存”可由你覆盖此提醒。`;
    elements.scheduleSubmit.textContent = '仍然保存';
  }

  async function submitSchedule(event) {
    event.preventDefault();
    const publicId = elements.scheduleId.value;
    const startAt = shanghaiInputToIso(elements.scheduleStart.value);
    const endAt = shanghaiInputToIso(elements.scheduleEnd.value);
    if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) {
      elements.scheduleFormStatus.textContent = '结束时间必须晚于开始时间。';
      return;
    }

    const conflictKey = `${publicId}:${startAt}:${endAt}`;
    elements.scheduleSubmit.disabled = true;
    elements.scheduleFormStatus.textContent = '正在检查时间冲突…';
    try {
      const conflicts = await checkScheduleConflicts({ publicId, startAt, endAt });
      if (conflicts.length && state.conflictAcknowledgement !== conflictKey) {
        state.conflictAcknowledgement = conflictKey;
        showConflicts(conflicts);
        elements.scheduleFormStatus.textContent = '日程尚未保存，请确认冲突后再提交。';
        return;
      }

      const payload = {
        title: elements.scheduleTitle.value,
        description: elements.scheduleDescription.value,
        startAt,
        endAt,
        allDay: elements.scheduleAllDay.checked,
        timezone: 'Asia/Shanghai',
      };
      if (publicId && elements.scheduleVersion.value) {
        payload.version = Number(elements.scheduleVersion.value);
      }
      elements.scheduleFormStatus.textContent = '正在保存…';
      await app.callApi(
        publicId
          ? `/workbench/schedule-items/${encodeURIComponent(publicId)}`
          : '/workbench/schedule-items',
        {
          method: publicId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      closeDialog(elements.scheduleDialog);
      await loadWorkbenchData();
    } catch (error) {
      elements.scheduleFormStatus.textContent =
        error.status === 409 ? '日程已被更新，已刷新，请重新编辑。' : error.message;
      if (error.status === 409) await loadWorkbenchData();
    } finally {
      elements.scheduleSubmit.disabled = false;
    }
  }

  async function mutate(action, publicId) {
    const importantItem = state.importantItems.find((item) => item.publicId === publicId);
    const notification = state.notifications.find((item) => item.publicId === publicId);
    const scheduleItem = state.scheduleItems.find((item) => item.publicId === publicId);

    if (action === 'edit-important' && importantItem) {
      openImportantEditor(importantItem);
      return;
    }
    if (action === 'edit-schedule' && scheduleItem) {
      openScheduleEditor(scheduleItem);
      return;
    }
    if (action === 'retry') {
      await loadWorkbenchData();
      return;
    }

    if (action === 'confirm-important' && importantItem) {
      await app.callApi(`/workbench/important-items/${encodeURIComponent(publicId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmed' }),
      });
    } else if (action === 'complete-important' && importantItem) {
      await app.callApi(`/workbench/important-items/${encodeURIComponent(publicId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
    } else if (action === 'delete-important' && importantItem) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`删除事项“${importantItem.title}”？`)) return;
      await app.callApi(`/workbench/important-items/${encodeURIComponent(publicId)}`, {
        method: 'DELETE',
      });
    } else if (action === 'toggle-notification-read' && notification) {
      await app.callApi(`/workbench/notifications/${encodeURIComponent(publicId)}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ read: !notification.readAt }),
      });
    } else if (action === 'toggle-notification-favorite' && notification) {
      await app.callApi(`/workbench/notifications/${encodeURIComponent(publicId)}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ favorited: !notification.favoritedAt }),
      });
    } else if (action === 'delete-schedule' && scheduleItem) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`删除日程“${scheduleItem.title}”？`)) return;
      await app.callApi(`/workbench/schedule-items/${encodeURIComponent(publicId)}`, {
        method: 'DELETE',
      });
    } else if (action === 'confirm-schedule' && scheduleItem) {
      const conflicts = await checkScheduleConflicts({
        publicId,
        startAt: scheduleItem.startAt,
        endAt: scheduleItem.endAt,
      });
      if (
        conflicts.length &&
        // eslint-disable-next-line no-alert
        !window.confirm(`该草稿与 ${conflicts.length} 项日程冲突，仍然确认加入时间表吗？`)
      ) {
        return;
      }
      await app.callApi(`/workbench/schedule-items/${encodeURIComponent(publicId)}/confirm`, {
        method: 'POST',
        body: '{}',
      });
    } else {
      return;
    }
    await loadWorkbenchData();
  }

  async function handleShellClick(event) {
    const actionButton = event.target.closest('[data-workbench-action]');
    if (!actionButton) return;
    actionButton.disabled = true;
    try {
      await mutate(actionButton.dataset.workbenchAction, actionButton.dataset.publicId || '');
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert(error.message || '操作失败，请稍后重试');
    } finally {
      actionButton.disabled = false;
    }
  }

  function formatProbeTimestamp(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return '检查时间未知';
    }
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  }

  function renderSourceEvidence(publicSource, portals, connector) {
    const portalResults = Array.isArray(portals) ? portals : [];
    const livePortals = portalResults.filter((portal) => portal.network === 'live');
    elements.sourceMetrics.classList.remove('hidden');
    elements.sourceHttp.textContent = String(publicSource?.status || '—');
    elements.sourceDuration.textContent = publicSource ? `${publicSource.durationMs} ms` : '—';
    elements.sourceBytes.textContent = publicSource
      ? Number(publicSource.responseBytes).toLocaleString('zh-CN')
      : '—';
    elements.sourceCount.textContent = String(publicSource?.itemCount || 0);

    const portalSummary =
      portalResults
        .map((portal) => {
          if (portal.network !== 'live') {
            return `${portal.target?.id || 'portal'}: ${portal.error?.code || 'failed'}`;
          }
          return `${portal.target.id}: HTTP ${portal.status} / ${portal.classification} / ${
            portal.cached ? '缓存' : '实时'
          }`;
        })
        .join('；') || '门户证据不可用';
    const credentialsState =
      livePortals.length &&
      livePortals.every(
        (portal) =>
          portal.safeguards?.credentialsSent === false && portal.safeguards?.cookiesSent === false,
      )
        ? 'false'
        : '未确认';
    const redirectState =
      livePortals.length &&
      livePortals.every((portal) => portal.safeguards?.redirectFollowed === false)
        ? 'false'
        : '未确认';
    const publicAuthState =
      publicSource?.safeguards?.authenticationUsed === false ? 'false' : '未确认';
    const detailFollowState = Number.isInteger(publicSource?.safeguards?.detailsFollowed)
      ? String(publicSource.safeguards.detailsFollowed)
      : '未确认';
    const sourceEvidence = publicSource
      ? `run_id ${publicSource.runId} · source=${publicSource.cached ? '缓存' : '实时'} · SHA-256 ${
          publicSource.contentSha256
        }`
      : '公开解析源本次不可用';
    const connectorEvidence = connector
      ? `${connector.id}: implementation=${connector.implementationState} / validation=${connector.validationState} / live_sync=${connector.liveSyncState} / auth=${connector.transport?.state} / parser=${connector.parserVersion || 'unknown'}`
      : '私有连接器能力声明不可用';

    elements.sourceProof.classList.remove('hidden');
    elements.sourceProof.textContent = `${sourceEvidence} · ${portalSummary} · ${connectorEvidence} · credentials_sent=${credentialsState} · redirects_followed=${redirectState} · public_auth_used=${publicAuthState} · details_followed=${detailFollowState}`;

    const rows = [];
    if (connector) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = 'https://learn.tsinghua.edu.cn/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const status = document.createElement('time');
      status.textContent = '私有连接器';
      const title = document.createElement('span');
      const implementationLabel =
        connector.validationState === 'live_account_verified'
          ? '抓取解析代码已通过真实账号同步验证'
          : connector.validationState === 'fixture_only'
            ? '抓取解析代码已实现（合成样例已验证）'
            : '解析验证状态未知';
      const liveSyncLabel =
        connector.liveSyncState === 'verified' ? '真实账号同步已验证' : '真实账号同步未验证';
      const authorizationLabel =
        connector.transport?.state === 'configured' ? '授权传输已配置' : '等待校方批准的授权传输';
      title.textContent = `${connector.name} · ${implementationLabel} · ${liveSyncLabel} · ${authorizationLabel}`;
      link.append(status, title);
      item.append(link);
      rows.push(item);
    }
    portalResults.forEach((portal) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = portal.target.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const status = document.createElement('time');
      const title = document.createElement('span');
      const checkedAt = formatProbeTimestamp(portal.checkedAt);
      if (portal.network === 'live') {
        status.textContent = `HTTP ${portal.status}`;
        const classification =
          portal.classification === 'auth_required'
            ? '需要官方授权会话'
            : portal.classification || '状态未知';
        const redirect = portal.redirectLocation ? ` · 跳转 ${portal.redirectLocation}` : '';
        title.textContent = `${portal.target.name} · ${classification} · ${
          portal.cached ? '缓存证据' : '实时响应'
        } · ${checkedAt}${redirect}`;
      } else {
        status.textContent = '失败';
        title.textContent = `${portal.target.name} · ${portal.error?.code || 'probe_failed'} · ${
          portal.error?.message || '未取得响应'
        } · ${checkedAt}`;
      }
      link.append(status, title);
      item.append(link);
      rows.push(item);
    });
    (publicSource?.items || []).slice(0, 8).forEach((notice) => {
      const safeUrl = safeActionUrl(notice.url);
      if (!safeUrl) return;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = safeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const date = document.createElement('time');
      date.dateTime = notice.date || '';
      date.textContent = notice.date || '日期未知';
      const title = document.createElement('span');
      title.textContent = notice.title;
      link.append(date, title);
      item.append(link);
      rows.push(item);
    });
    elements.sourceResults.replaceChildren(...rows);
  }

  async function runSourceProbe() {
    if (!requireLogin()) return;
    elements.sourceProbe.disabled = true;
    elements.sourceStatus.textContent = '正在探测两个校内认证边界并抓取公开样本…';
    try {
      const [publicResult, portalResult, connectorResult] = await Promise.allSettled([
        app.callApi('/workbench/connectors/public-notices/probe', { method: 'GET' }),
        app.callApi('/workbench/connectors/primary-portals/probe', { method: 'GET' }),
        app.callApi('/workbench/connectors/tsinghua-learn/capabilities', { method: 'GET' }),
      ]);
      if (
        publicResult.status === 'rejected' &&
        portalResult.status === 'rejected' &&
        connectorResult.status === 'rejected'
      ) {
        throw publicResult.reason;
      }
      const publicSource = publicResult.status === 'fulfilled' ? publicResult.value.probe : null;
      const portals = portalResult.status === 'fulfilled' ? portalResult.value.portals : [];
      const connector =
        connectorResult.status === 'fulfilled' ? connectorResult.value.connector : null;
      renderSourceEvidence(publicSource, portals, connector);
      const failedChecks = [publicResult, portalResult, connectorResult].filter(
        (result) => result.status === 'rejected',
      ).length;
      const livePortals = portals.filter((portal) => portal.network === 'live');
      const cachedPortals = livePortals.filter((portal) => portal.cached).length;
      const failedPortals = Math.max(0, 2 - livePortals.length);
      const portalState = `门户 ${livePortals.length}/2 可达${
        cachedPortals ? `（${cachedPortals} 个缓存）` : ''
      }${failedPortals ? ` · ${failedPortals} 个失败` : ''}`;
      const publicState = publicSource
        ? `公开样本 ${publicSource.itemCount} 条（${publicSource.cached ? '缓存' : '实时'}）`
        : '公开样本失败';
      const connectorState = connector
        ? connector.liveSyncState === 'verified'
          ? '私有连接器：真实账号同步已验证'
          : '私有连接器：合成样例已验证，真实账号同步未验证'
        : '私有连接器能力声明失败';
      const completionState = failedChecks ? `自检部分完成（${failedChecks} 项失败）` : '自检完成';
      elements.sourceStatus.textContent = `${completionState} · ${portalState} · ${publicState} · ${connectorState}`;
    } catch (error) {
      elements.sourceStatus.textContent = error.message || '连接器自检失败';
    } finally {
      elements.sourceProbe.disabled = false;
    }
  }

  function updateAuthControls() {
    const loggedIn = isLoggedIn();
    [
      elements.addImportant,
      elements.addSchedule,
      elements.notificationCategory,
      elements.sourceProbe,
      ...elements.notificationFilters,
    ]
      .filter(Boolean)
      .forEach((control) => control.toggleAttribute('disabled', !loggedIn));
    if (elements.sourceStatus && !loggedIn) {
      elements.sourceStatus.textContent = '登录后可运行';
      elements.sourceMetrics.classList.add('hidden');
      elements.sourceProof.classList.add('hidden');
      elements.sourceResults.replaceChildren();
    }
  }

  function syncSession() {
    const ownerKey = isLoggedIn() ? getOwnerKey() : '';
    updateAuthControls();
    if (ownerKey === state.ownerKey) return;
    state.requestVersion += 1;
    state.ownerKey = ownerKey;
    state.importantItems = [];
    state.notifications = [];
    state.scheduleItems = [];
    state.campusSemesters = [];
    closeDialog(elements.importantDialog);
    closeDialog(elements.scheduleDialog);
    if (ownerKey) {
      loadWorkbenchData();
      loadCampusSemesters();
    }
  }

  elements.addImportant?.addEventListener('click', () => openImportantEditor());
  elements.addSchedule?.addEventListener('click', () => openScheduleEditor());
  elements.importantForm?.addEventListener('submit', submitImportant);
  elements.scheduleForm?.addEventListener('submit', submitSchedule);
  elements.scheduleForm?.addEventListener('input', resetConflictWarning);
  elements.notificationCategory?.addEventListener('change', () => {
    state.notificationFilters.category = elements.notificationCategory.value;
    loadWorkbenchData();
  });
  elements.notificationFilters.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.workbenchNotificationFilter;
      state.notificationFilters[filter] = !state.notificationFilters[filter];
      button.setAttribute('aria-pressed', String(state.notificationFilters[filter]));
      loadWorkbenchData();
    });
  });
  elements.sourceProbe?.addEventListener('click', runSourceProbe);
  elements.campusSemester?.addEventListener('change', () => {
    const semester = state.campusSemesters.find(
      (item) => item.id === elements.campusSemester.value,
    );
    if (semester?.synced) loadCampusSemester(semester.id);
    else if (semester) syncCampusSemester(semester.id);
  });
  shell.addEventListener('click', handleShellClick);
  document.querySelectorAll('[data-workbench-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(button.closest('dialog')));
  });
  [elements.importantDialog, elements.scheduleDialog].forEach((dialog) => {
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  window.addEventListener('freebbs:workbench-refresh', () => {
    if (isLoggedIn()) {
      loadWorkbenchData();
      loadCampusSemesters();
    }
  });

  const authObserver = new MutationObserver(syncSession);
  authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  Promise.resolve(app.sessionReady)
    .catch(() => {})
    .finally(syncSession);
})();
