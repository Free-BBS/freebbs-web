(() => {
  const shell = document.querySelector('.workbench-shell');
  const app = window.freeBbsApp;

  if (!shell || !app) {
    return;
  }

  const elements = {
    importantList: document.getElementById('workbench-priority-list'),
    notificationList: document.getElementById('workbench-notification-list'),
    notificationCount: document.getElementById('workbench-notification-count'),
    notificationSearch: document.getElementById('workbench-notification-search'),
    notificationMore: document.getElementById('workbench-notification-more'),
    notificationRefresh: document.getElementById('workbench-notification-refresh'),
    noticeHint: document.getElementById('workbench-notice-hint'),
    planPanel: document.getElementById('workbench-plan-panel'),
    notificationsPanel: document.getElementById('workbench-notifications-panel'),
    viewButtons: Array.from(document.querySelectorAll('[data-workbench-view]')),
    noticeViewButtons: Array.from(document.querySelectorAll('[data-notice-view]')),
    scheduleList: document.getElementById('workbench-schedule-list'),
    weekGrid: document.getElementById('workbench-week-grid'),
    weekLabel: document.getElementById('workbench-week-label'),
    weekScroll: document.querySelector('.workbench-week-scroll'),
    weekPrevious: document.getElementById('workbench-week-previous'),
    weekToday: document.getElementById('workbench-week-today'),
    weekNext: document.getElementById('workbench-week-next'),
    viewToggle: document.getElementById('workbench-view-toggle'),
    addImportant: document.getElementById('workbench-add-important'),
    addSchedule: document.getElementById('workbench-add-schedule'),
    agentForm: document.getElementById('workbench-agent-form'),
    agentMessage: document.getElementById('workbench-agent-message'),
    agentGenerate: document.getElementById('workbench-agent-generate'),
    agentStatus: document.getElementById('workbench-agent-status'),
    agentPreview: document.getElementById('workbench-agent-preview'),
    agentProposals: document.getElementById('workbench-agent-proposals'),
    agentConfirm: document.getElementById('workbench-agent-confirm'),
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
    announcement: '平台发布',
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
    communityNotifications: [],
    communityCursor: null,
    communityUnreadCount: 0,
    noticeView: 'all',
    scheduleItems: [],
    weekStart: null,
    listView: false,
    proposals: [],
    notificationFilters: { category: '', unread: false, favorite: false, search: '' },
    conflictAcknowledgement: '',
    campusSemesters: [],
  };

  function switchWorkbenchView(view, { updateUrl = true } = {}) {
    const next = view === 'notifications' ? 'notifications' : 'plan';
    elements.planPanel.hidden = next !== 'plan';
    elements.notificationsPanel.hidden = next !== 'notifications';
    elements.viewButtons.forEach((button) => {
      if (button.dataset.workbenchView === next) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (next === 'notifications') url.searchParams.set('view', 'notifications');
      else url.searchParams.delete('view');
      window.history.pushState(
        { workbenchView: next },
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }

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

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  function getWeekStart(value = new Date()) {
    const date = toShanghaiInputValue(value).slice(0, 10);
    const [year, month, day] = date.split('-').map(Number);
    const localMidnight = Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return localMidnight - ((weekday + 6) % 7) * DAY_MS;
  }

  function formatDay(value) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
    }).format(value);
  }

  function renderWeekGrid() {
    if (!elements.weekGrid) return;
    if (state.weekStart === null) state.weekStart = getWeekStart();
    const weekEnd = state.weekStart + 7 * DAY_MS;
    elements.weekLabel.textContent = `${formatDay(new Date(state.weekStart))} — ${formatDay(new Date(weekEnd - DAY_MS))} · 北京时间`;
    const todayStart = getWeekStart(new Date());
    elements.weekToday.disabled = state.weekStart === todayStart;
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      const dayStart = state.weekStart + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const day = document.createElement('section');
      day.className = 'workbench-week-day';
      day.setAttribute('role', 'listitem');
      day.setAttribute('aria-label', `${WEEKDAYS[index]} ${formatDay(new Date(dayStart))}`);
      if (
        getWeekStart(new Date(dayStart)) === todayStart &&
        formatDay(new Date(dayStart)) === formatDay(new Date())
      ) {
        day.classList.add('is-today');
      }
      const header = document.createElement('header');
      header.className = 'workbench-week-day-header';
      const weekday = document.createElement('span');
      weekday.textContent = WEEKDAYS[index];
      const date = document.createElement('strong');
      date.textContent = formatDay(new Date(dayStart));
      header.append(weekday, date);
      const allDay = document.createElement('div');
      allDay.className = 'workbench-week-all-day';
      const timeline = document.createElement('div');
      timeline.className = 'workbench-week-timeline';
      for (const hour of [0, 6, 12, 18]) {
        const marker = document.createElement('span');
        marker.className = 'workbench-week-hour';
        marker.style.top = `${hour * 40}px`;
        marker.textContent = `${String(hour).padStart(2, '0')}:00`;
        timeline.append(marker);
      }
      const entries = state.scheduleItems
        .filter(
          (item) =>
            new Date(item.startAt).getTime() < dayEnd && new Date(item.endAt).getTime() > dayStart,
        )
        .map((item) => ({
          item,
          start: Math.max(dayStart, new Date(item.startAt).getTime()),
          end: Math.min(dayEnd, new Date(item.endAt).getTime()),
        }))
        .sort((left, right) => left.start - right.start || left.end - right.end);
      const lanes = [];
      const placed = entries
        .filter(({ item }) => !item.allDay && item.kind !== 'deadline')
        .map((entry) => {
          let lane = lanes.findIndex((end) => end <= entry.start);
          if (lane < 0) lane = lanes.length;
          lanes[lane] = entry.end;
          return { ...entry, lane };
        });
      for (const entry of entries) {
        const block = document.createElement('button');
        block.type = 'button';
        block.dataset.workbenchAction = 'edit-schedule';
        block.dataset.publicId = entry.item.publicId;
        block.className = `workbench-week-event${entry.item.status === 'draft' ? ' is-draft' : ''}${entry.item.sourceType === 'agent' ? ' is-agent' : ''}${entry.item.kind === 'deadline' ? ' is-deadline' : ''}${entry.item.kind === 'weekly' ? ' is-weekly' : ''}`;
        const title = document.createElement('strong');
        let prefix = '';
        if (entry.item.kind === 'deadline') prefix = '⏱ DDL · ';
        if (entry.item.kind === 'weekly') prefix = '↻ 周常 · ';
        title.textContent = `${prefix}${entry.item.title || '未命名日程'}`;
        const time = document.createElement('small');
        time.textContent = `${entry.item.sourceType === 'agent' ? 'Max · ' : ''}${toShanghaiInputValue(entry.item.startAt).slice(11)}–${toShanghaiInputValue(entry.item.endAt).slice(11)}`;
        if (entry.item.allDay) time.textContent = '全天';
        if (entry.item.kind === 'deadline') time.textContent = `截止 ${toShanghaiInputValue(entry.item.endAt).slice(11)}`;
        block.append(title, time);
        block.title = `${entry.item.title} · ${entry.item.kind === 'deadline' ? `截止 ${formatMoment(entry.item.endAt)}` : `${formatMoment(entry.item.startAt)} — ${formatMoment(entry.item.endAt)}`}${entry.item.updatedAt ? ` · 更新于 ${formatMoment(entry.item.updatedAt)}` : ''} · 点击编辑`;
        if (entry.item.allDay || entry.item.kind === 'deadline') {
          allDay.append(block);
        } else {
          const lane =
            placed.find(
              (candidate) => candidate.item === entry.item && candidate.start === entry.start,
            )?.lane || 0;
          const laneCount = Math.max(1, lanes.length);
          block.style.top = `${Math.floor(((entry.start - dayStart) / (60 * 60 * 1000)) * 40)}px`;
          block.style.height = `${Math.max(28, Math.ceil(((entry.end - entry.start) / (60 * 60 * 1000)) * 40))}px`;
          block.style.left = `calc(${(lane / laneCount) * 100}% + 4px)`;
          block.style.width = `calc(${100 / laneCount}% - 8px)`;
          timeline.append(block);
        }
      }
      day.append(header, allDay, timeline);
      days.push(day);
    }
    elements.weekGrid.replaceChildren(...days);
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
    const discussionKinds = new Set(['reply', 'reaction', 'comment_like']);
    const communityCategory = (kind) => {
      if (kind === 'announcement') return 'announcement';
      return discussionKinds.has(kind) ? 'discussion' : 'system';
    };
    const fromWorkbench = state.notifications.map((item) => ({
      ...item,
      origin: 'workbench',
      moment: item.publishedAt,
    }));
    const fromCommunity = state.communityNotifications.map((item) => ({
      ...item,
      publicId: `cn_${item.id}`,
      origin: 'community',
      category: communityCategory(item.kind),
      actionUrl: item.link,
      publishedAt: item.createdAt,
      moment: item.createdAt,
      importance: 'normal',
    }));
    const filters = state.notificationFilters;
    const search = filters.search.trim().toLocaleLowerCase();
    const items = [...fromWorkbench, ...fromCommunity]
      .filter((item) => {
        const isDiscussion = item.origin === 'community' && discussionKinds.has(item.kind);
        if (state.noticeView === 'discussion' ? !isDiscussion : isDiscussion) return false;
        if (filters.category && item.category !== filters.category) return false;
        if (filters.unread && item.readAt) return false;
        if (filters.favorite && !item.favoritedAt) return false;
        if (
          search &&
          !`${item.title || ''} ${item.body || ''}`.toLocaleLowerCase().includes(search)
        )
          return false;
        return true;
      })
      .sort((left, right) => {
        if (state.noticeView === 'recommended') {
          const score = (item) => {
            let importance = 0;
            if (item.importance === 'urgent') importance = 4;
            else if (item.importance === 'important') importance = 3;
            return importance + (!item.readAt ? 2 : 0);
          };
          if (score(left) !== score(right)) return score(right) - score(left);
        }
        return new Date(right.moment || 0) - new Date(left.moment || 0);
      });
    const unreadWorkbench = state.notifications.filter((item) => !item.readAt).length;
    const unreadTotal = unreadWorkbench + state.communityUnreadCount;
    elements.notificationCount.hidden = !unreadTotal;
    elements.notificationCount.textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
    const hints = {
      all: '全部通知按时间展示；讨论互动单独归类。',
      recommended:
        '推荐依据：重要程度和未读状态，其次按发布时间排序；所有通知仍可在“全部通知”查看。',
      discussion: '回复与互动单独展示，不混入公共通知。',
    };
    elements.noticeHint.textContent = hints[state.noticeView];
    if (!items.length) {
      const hasFilter = Boolean(filters.category || filters.unread || filters.favorite || search);
      renderState(
        elements.notificationList,
        '通知',
        hasFilter ? '当前筛选下没有通知' : '暂无课程通知',
        hasFilter
          ? '可以清除分类、“未读”或“收藏”筛选后再查看。'
          : '平台通知、讨论互动与课程公告会在这里显示。',
      );
      return;
    }
    elements.notificationList.replaceChildren(
      ...items.map((item) => {
        const category =
          item.category === 'discussion' ? '讨论动态' : CATEGORY_LABELS[item.category] || '通知';
        const unread = !item.readAt;
        const actions = [];
        if (item.origin === 'community' && unread) {
          actions.push(makeAction('标为已读', 'read-community-notification', item.publicId));
        } else if (item.origin === 'workbench') {
          actions.push(
            makeAction(unread ? '标为已读' : '标为未读', 'toggle-notification-read', item.publicId),
            makeAction(
              item.favoritedAt ? '取消收藏' : '收藏',
              'toggle-notification-favorite',
              item.publicId,
              item.favoritedAt ? 'is-primary' : '',
            ),
          );
        }
        return makeDataItem({
          eyebrow: unread ? `未读 · ${category}` : category,
          title: item.title || '未命名通知',
          description: [
            item.origin === 'community' && item.kind === 'announcement' ? '平台发布' : '',
            item.publishedAt ? formatMoment(item.publishedAt) : '',
            truncate(item.body),
          ]
            .filter(Boolean)
            .join(' · '),
          href: item.actionUrl,
          className: unread ? 'is-unread' : '',
          actions,
        });
      }),
    );
    elements.notificationList.setAttribute('aria-busy', 'false');
  }

  function renderScheduleItems() {
    renderWeekGrid();
    const items = state.scheduleItems.slice(0, 30);
    if (!items.length) {
      renderState(
        elements.scheduleList,
        '本周时间表',
        '本周暂无日程',
        '你可以添加日程、周常或 DDL；课程作业截止时间仍可在重要事项中查看。',
      );
      return;
    }
    elements.scheduleList.replaceChildren(
      ...items.map((item) => {
        const isDraft = item.status === 'draft';
        let timeWindow = `${formatMoment(item.startAt)} — ${formatMoment(item.endAt)}`;
        if (item.allDay) timeWindow = `${formatMoment(item.startAt, true)} · 全天`;
        if (item.kind === 'deadline') timeWindow = `截止 ${formatMoment(item.endAt)}`;
        const actions = [];
        if (isDraft) {
          actions.push(makeAction('确认加入', 'confirm-schedule', item.publicId, 'is-primary'));
        }
        actions.push(
          makeAction('编辑', 'edit-schedule', item.publicId),
          makeAction('删除', 'delete-schedule', item.publicId, 'is-danger'),
        );
        let eyebrow = item.sourceType === 'agent' ? 'Max 建议 · 已确认' : '已确认';
        if (isDraft) eyebrow = 'Agent 草稿 · 待确认';
        else if (item.kind === 'deadline') eyebrow = '⏱ DDL · 截止提醒';
        else if (item.kind === 'weekly') eyebrow = '↻ 周常 · 已确认';
        else if (item.allDay) eyebrow = '全天';
        return makeDataItem({
          eyebrow,
          title: item.title || '未命名日程',
          description: [
            timeWindow,
            truncate(item.description),
            item.updatedAt ? `更新于 ${formatMoment(item.updatedAt)}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          className: isDraft ? 'is-draft' : '',
          actions,
        });
      }),
    );
    elements.scheduleList.setAttribute('aria-busy', 'false');
  }

  function buildNotificationQuery() {
    const query = new URLSearchParams({ limit: '50' });
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

    const [importantResult, notificationResult, communityResult, scheduleResult] =
      await Promise.allSettled([
        app.callApi('/workbench/important-items', { method: 'GET' }),
        app.callApi(`/workbench/notifications?${buildNotificationQuery()}`, { method: 'GET' }),
        app.callApi('/notifications?limit=50', { method: 'GET' }),
        app.callApi(
          `/workbench/schedule-items?${new URLSearchParams({
            from: new Date(state.weekStart ?? getWeekStart()).toISOString(),
            to: new Date((state.weekStart ?? getWeekStart()) + 7 * DAY_MS).toISOString(),
          })}`,
          { method: 'GET' },
        ),
      ]);
    if (requestVersion !== state.requestVersion || !isLoggedIn() || getOwnerKey() !== ownerKey) {
      return;
    }

    const results = [importantResult, notificationResult, communityResult, scheduleResult];
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
    } else {
      state.notifications = [];
    }

    if (communityResult.status === 'fulfilled') {
      state.communityNotifications = communityResult.value.notifications || [];
      state.communityCursor = communityResult.value.nextCursor || null;
      state.communityUnreadCount = Number(communityResult.value.unreadCount) || 0;
    } else {
      state.communityNotifications = [];
      state.communityCursor = null;
      state.communityUnreadCount = 0;
    }
    elements.notificationMore.hidden = !state.communityCursor;
    if (notificationResult.status === 'rejected' && communityResult.status === 'rejected') {
      renderDataFailure(elements.notificationList, '通知', communityResult.reason);
    } else {
      renderNotifications();
      if (communityResult.status === 'rejected') {
        elements.noticeHint.textContent = '平台发布与讨论动态暂时无法加载；已显示个人计划通知。';
      } else if (notificationResult.status === 'rejected') {
        elements.noticeHint.textContent = '个人计划通知暂时无法加载；已显示平台发布与讨论动态。';
      }
    }

    if (scheduleResult.status === 'fulfilled') {
      state.scheduleItems = scheduleResult.value.scheduleItems || [];
      renderScheduleItems();
    } else {
      renderDataFailure(elements.scheduleList, '本周时间表', scheduleResult.reason);
      elements.weekGrid.textContent =
        scheduleResult.reason?.message || '本周日程暂时无法加载，请重试。';
    }
  }

  async function loadMoreCommunityNotifications() {
    if (!state.communityCursor || !isLoggedIn()) return;
    const ownerKey = getOwnerKey();
    const { requestVersion } = state;
    const { communityCursor: cursor } = state;
    elements.notificationMore.disabled = true;
    try {
      const result = await app.callApi(
        `/notifications?limit=50&before=${encodeURIComponent(cursor)}`,
        {
          method: 'GET',
        },
      );
      if (
        ownerKey !== getOwnerKey() ||
        requestVersion !== state.requestVersion ||
        cursor !== state.communityCursor
      )
        return;
      const known = new Set(state.communityNotifications.map((item) => String(item.id)));
      state.communityNotifications.push(
        ...(result.notifications || []).filter((item) => !known.has(String(item.id))),
      );
      state.communityCursor = result.nextCursor || null;
      state.communityUnreadCount = Number(result.unreadCount) || 0;
      elements.notificationMore.hidden = !state.communityCursor;
      renderNotifications();
    } catch (error) {
      elements.noticeHint.textContent = error.message || '加载更多失败，可以重试。';
    } finally {
      elements.notificationMore.disabled = false;
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
    const isDeadline = item?.kind === 'deadline';
    elements.scheduleDialog.dataset.kind = isDeadline ? 'deadline' : 'event';
    elements.scheduleStart.closest('label').hidden = isDeadline;
    elements.scheduleEnd.closest('label').querySelector('span').textContent = isDeadline ? '截止时间' : '结束时间';
    elements.scheduleAllDay.closest('label').hidden = isDeadline;
    elements.scheduleDialogTitle.textContent = item ? '编辑日程' : '新增日程';
    if (isDeadline) elements.scheduleDialogTitle.textContent = '编辑 DDL';
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
    const endAt = shanghaiInputToIso(elements.scheduleEnd.value);
    const isDeadline = elements.scheduleDialog.dataset.kind === 'deadline';
    const startAt = isDeadline && endAt
      ? new Date(new Date(endAt).getTime() - 60000).toISOString()
      : shanghaiInputToIso(elements.scheduleStart.value);
    if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) {
      elements.scheduleFormStatus.textContent = '结束时间必须晚于开始时间。';
      return;
    }

    const conflictKey = `${publicId}:${startAt}:${endAt}`;
    elements.scheduleSubmit.disabled = true;
    elements.scheduleFormStatus.textContent = '正在检查时间冲突…';
    try {
      const conflicts = isDeadline ? [] : await checkScheduleConflicts({ publicId, startAt, endAt });
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

  function renderAgentProposals() {
    const cards = state.proposals.map((item, index) => {
      const card = document.createElement('div');
      card.className = `workbench-agent-proposal${item.kind === 'deadline' ? ' is-deadline' : ''}`;
      card.dataset.kind = item.kind || 'event';
      const number = document.createElement('span');
      number.textContent = `安排 ${index + 1}`;
      if (item.kind === 'weekly') number.textContent = `↻ 周常 · 第 ${item.occurrence || index + 1}/${item.totalWeeks || state.proposals.length} 周`;
      if (item.kind === 'deadline') number.textContent = '⏱ DDL · 截止提醒';
      const titleLabel = document.createElement('label');
      titleLabel.textContent = '事项';
      const titleInput = document.createElement('input');
      titleInput.className = 'workbench-proposal-title';
      titleInput.maxLength = 200;
      titleInput.value = item.title;
      titleLabel.append(titleInput);
      const startLabel = document.createElement('label');
      if (item.kind !== 'deadline') {
        startLabel.textContent = '开始';
        const startInput = document.createElement('input');
        startInput.className = 'workbench-proposal-start';
        startInput.type = 'datetime-local';
        startInput.value = toShanghaiInputValue(item.startAt);
        startLabel.append(startInput);
      }
      const endLabel = document.createElement('label');
      endLabel.textContent = item.kind === 'deadline' ? '截止时间' : '结束';
      const endInput = document.createElement('input');
      endInput.className = 'workbench-proposal-end';
      endInput.type = 'datetime-local';
      endInput.value = toShanghaiInputValue(item.endAt);
      endLabel.append(endInput);
      card.append(number, titleLabel);
      if (item.kind !== 'deadline') card.append(startLabel);
      card.append(endLabel);
      return card;
    });
    elements.agentProposals.replaceChildren(...cards);
    elements.agentPreview.classList.toggle('hidden', !cards.length);
  }

  async function generateAgentPreview(event) {
    event.preventDefault();
    if (!requireLogin()) return;
    const message = elements.agentMessage.value.trim();
    if (!message) return;
    elements.agentGenerate.disabled = true;
    elements.agentStatus.textContent = 'Max 正在理解你的安排并检查空余时间…';
    state.proposals = [];
    renderAgentProposals();
    try {
      const result = await app.callApi('/workbench/schedule-planner/preview', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      state.proposals = result.suggestions || [];
      renderAgentProposals();
      elements.agentStatus.textContent = `已生成 ${state.proposals.length} 段安排。请检查并确认，当前尚未写入。`;
    } catch (error) {
      elements.agentStatus.textContent = error.message || '生成失败，请补充日期与时长后重试。';
    } finally {
      elements.agentGenerate.disabled = false;
    }
  }

  async function confirmAgentProposals() {
    if (!requireLogin() || !state.proposals.length) return;
    const cards = [...elements.agentProposals.querySelectorAll('.workbench-agent-proposal')];
    const suggestions = cards.map((card, index) => {
      const { kind } = card.dataset;
      const endAt = shanghaiInputToIso(card.querySelector('.workbench-proposal-end').value);
      return {
        title: card.querySelector('.workbench-proposal-title').value.trim(),
        description: state.proposals[index].description || '',
        kind,
        startAt: kind === 'deadline'
          ? endAt && new Date(new Date(endAt).getTime() - 60000).toISOString()
          : shanghaiInputToIso(card.querySelector('.workbench-proposal-start').value),
        endAt,
      };
    });
    if (
      suggestions.some(
        (item) =>
          !item.title ||
          !item.startAt ||
          !item.endAt ||
          new Date(item.endAt) <= new Date(item.startAt),
      )
    ) {
      elements.agentStatus.textContent = '请检查每段安排的标题、开始和结束时间。';
      return;
    }
    elements.agentConfirm.disabled = true;
    elements.agentStatus.textContent = '正在再次检查冲突并保存…';
    try {
      const result = await app.callApi('/workbench/schedule-planner/confirm', {
        method: 'POST',
        body: JSON.stringify({ suggestions }),
      });
      state.proposals = [];
      renderAgentProposals();
      state.weekStart = getWeekStart(new Date(suggestions[0].startAt));
      await loadWorkbenchData();
      elements.agentStatus.textContent = `已加入 ${result.created} 段安排；你可在上方时间图中继续编辑。`;
    } catch (error) {
      elements.agentStatus.textContent =
        error.status === 409
          ? '已有日程发生变化或出现冲突；计划未写入，请重新生成。'
          : error.message || '保存失败，请重试。';
    } finally {
      elements.agentConfirm.disabled = false;
    }
  }

  function shiftWeek(days) {
    state.weekStart = (state.weekStart ?? getWeekStart()) + days * DAY_MS;
    state.scheduleItems = [];
    renderWeekGrid();
    if (isLoggedIn()) loadWorkbenchData();
  }

  function toggleScheduleView() {
    state.listView = !state.listView;
    elements.weekScroll.classList.toggle('hidden', state.listView);
    elements.scheduleList.classList.toggle('hidden', !state.listView);
    elements.viewToggle.setAttribute('aria-pressed', String(state.listView));
    elements.viewToggle.textContent = state.listView ? '七天视图' : '列表视图';
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
    } else if (action === 'read-community-notification') {
      const community = state.communityNotifications.find((item) => `cn_${item.id}` === publicId);
      if (!community || community.readAt) return;
      await app.callApi(`/notifications/${encodeURIComponent(community.id)}/read`, {
        method: 'POST',
        body: '{}',
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
      let implementationLabel = '解析验证状态未知';
      if (connector.validationState === 'live_account_verified') {
        implementationLabel = '抓取解析代码已通过真实账号同步验证';
      } else if (connector.validationState === 'fixture_only') {
        implementationLabel = '抓取解析代码已实现（合成样例已验证）';
      }
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
      let connectorState = '私有连接器能力声明失败';
      if (connector) {
        connectorState =
          connector.liveSyncState === 'verified'
            ? '私有连接器：真实账号同步已验证'
            : '私有连接器：合成样例已验证，真实账号同步未验证';
      }
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
      elements.notificationRefresh,
      elements.sourceProbe,
      elements.agentMessage,
      elements.agentGenerate,
      elements.agentConfirm,
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
    state.communityNotifications = [];
    state.communityCursor = null;
    state.communityUnreadCount = 0;
    elements.notificationCount.hidden = true;
    elements.notificationMore.hidden = true;
    state.scheduleItems = [];
    state.proposals = [];
    renderAgentProposals();
    renderWeekGrid();
    state.campusSemesters = [];
    closeDialog(elements.importantDialog);
    closeDialog(elements.scheduleDialog);
    if (ownerKey) {
      loadWorkbenchData();
      loadCampusSemesters();
    } else {
      renderState(elements.notificationList, '通知', '登录后查看', '登录后可查看属于你的通知。');
      renderState(elements.importantList, '重要事项', '登录后查看', '登录后可查看个人事项。');
      renderState(elements.scheduleList, '个人计划', '登录后查看', '登录后可查看个人日程。');
    }
  }

  elements.addImportant?.addEventListener('click', () => openImportantEditor());
  elements.addSchedule?.addEventListener('click', () => openScheduleEditor());
  elements.weekPrevious?.addEventListener('click', () => shiftWeek(-7));
  elements.weekNext?.addEventListener('click', () => shiftWeek(7));
  elements.weekToday?.addEventListener('click', () => {
    state.weekStart = getWeekStart();
    if (isLoggedIn()) loadWorkbenchData();
    else renderWeekGrid();
  });
  elements.viewToggle?.addEventListener('click', toggleScheduleView);
  elements.agentForm?.addEventListener('submit', generateAgentPreview);
  elements.agentConfirm?.addEventListener('click', confirmAgentProposals);
  elements.importantForm?.addEventListener('submit', submitImportant);
  elements.scheduleForm?.addEventListener('submit', submitSchedule);
  elements.scheduleForm?.addEventListener('input', resetConflictWarning);
  elements.notificationCategory?.addEventListener('change', () => {
    state.notificationFilters.category = elements.notificationCategory.value;
    renderNotifications();
  });
  elements.notificationSearch?.addEventListener('input', () => {
    state.notificationFilters.search = elements.notificationSearch.value;
    renderNotifications();
  });
  elements.notificationFilters.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.workbenchNotificationFilter;
      state.notificationFilters[filter] = !state.notificationFilters[filter];
      button.setAttribute('aria-pressed', String(state.notificationFilters[filter]));
      renderNotifications();
    });
  });
  elements.viewButtons.forEach((button) => {
    button.addEventListener('click', () => switchWorkbenchView(button.dataset.workbenchView));
  });
  elements.noticeViewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.noticeView = button.dataset.noticeView;
      elements.noticeViewButtons.forEach((entry) =>
        entry.setAttribute('aria-pressed', String(entry === button)),
      );
      if (state.noticeView === 'discussion') {
        state.notificationFilters.category = '';
        elements.notificationCategory.value = '';
      }
      renderNotifications();
    });
  });
  elements.notificationMore?.addEventListener('click', loadMoreCommunityNotifications);
  elements.notificationRefresh?.addEventListener('click', loadWorkbenchData);
  window.addEventListener('popstate', () => {
    switchWorkbenchView(new URL(window.location.href).searchParams.get('view'), {
      updateUrl: false,
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
  switchWorkbenchView(new URL(window.location.href).searchParams.get('view'), {
    updateUrl: false,
  });
  renderWeekGrid();
})();
