(() => {
  const storageKey = 'free_bbs_auth_token';
  const local =
    window.location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) ||
    window.location.port === '3000';
  const host =
    window.location.hostname &&
    window.location.protocol !== 'file:' &&
    window.location.hostname !== '0.0.0.0'
      ? window.location.hostname
      : '127.0.0.1';
  const apiBase = local ? `http://${host}:3001/api` : `${window.location.origin}/api`;
  const state = {
    user: null,
    token: '',
    unreadCount: 0,
    items: [],
    cursor: null,
    busy: false,
    sessionVersion: 0,
    selectedUsers: new Map(),
    audienceVersion: 0,
  };
  const widget = document.createElement('div');
  widget.className = 'notification-widget';
  widget.hidden = true;
  widget.innerHTML = `
    <button class="notification-bell" type="button" aria-label="通知" aria-expanded="false"
      aria-controls="notification-panel" title="通知">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
        <path d="M10 21h4M12 2V1" stroke-linecap="round" />
      </svg>
      <span class="notification-badge" hidden aria-hidden="true"></span>
    </button>
    <section class="notification-panel" id="notification-panel" role="dialog" aria-label="通知收件箱" hidden>
      <header class="notification-panel-header"><h2>通知</h2>
        <button type="button" class="notification-read-all">全部已读</button>
        <button type="button" class="notification-close" aria-label="关闭通知">×</button>
      </header>
      <p class="notification-message" role="status" aria-live="polite"></p>
      <div class="notification-list"></div>
      <button class="notification-load-more" type="button" hidden>加载更多</button>
    </section>`;
  document.body.append(widget);
  const bell = widget.querySelector('.notification-bell');
  const badge = widget.querySelector('.notification-badge');
  const panel = widget.querySelector('.notification-panel');
  const message = widget.querySelector('.notification-message');
  const list = widget.querySelector('.notification-list');
  const loadMore = widget.querySelector('.notification-load-more');
  let adminSection = null;
  let searchTimer;
  let requestId;

  async function api(path, options = {}) {
    const token = localStorage.getItem(storageKey) || '';
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || '通知加载失败，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function updateCount(count) {
    state.unreadCount = Number(count) || 0;
    badge.hidden = !state.unreadCount;
    badge.textContent = state.unreadCount > 99 ? '99+' : String(state.unreadCount);
    bell.setAttribute(
      'aria-label',
      state.unreadCount ? `通知，${state.unreadCount} 条未读` : '通知，无未读',
    );
    widget.querySelector('.notification-read-all').disabled = !state.unreadCount;
  }

  function closePanel(restoreFocus = false) {
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
    if (restoreFocus) bell.focus();
  }

  function canLoad() {
    return (
      state.user &&
      !state.user.requiresUsernameChange &&
      state.token === localStorage.getItem(storageKey)
    );
  }

  function safeLink(link) {
    if (
      typeof link !== 'string' ||
      !link.startsWith('/') ||
      link.startsWith('//') ||
      /[\\\s]/.test(link)
    )
      return '';
    return new URL(link, window.location.origin).origin === window.location.origin ? link : '';
  }

  function renderItems() {
    list.replaceChildren();
    for (const item of state.items) {
      const row = document.createElement('article');
      row.className = `notification-item${item.readAt ? '' : ' is-unread'}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notification-item-button';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const body = document.createElement('span');
      body.className = 'notification-item-body';
      body.textContent = item.body;
      const time = document.createElement('time');
      const date = new Date(item.createdAt);
      time.textContent = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
      time.dateTime = Number.isNaN(date.getTime()) ? '' : date.toISOString();
      const action = document.createElement('span');
      action.className = 'notification-item-action';
      const link = safeLink(item.link);
      action.textContent = item.readAt ? '已读' : '标为已读';
      if (link) action.textContent = '查看详情 →';
      button.append(title, body, time, action);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if (!item.readAt) {
            await api(`/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST' });
            item.readAt = new Date().toISOString();
            updateCount(Math.max(0, state.unreadCount - 1));
          }
          if (link) window.location.assign(link);
          else renderItems();
        } catch (error) {
          message.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      row.append(button);
      list.append(row);
    }
    loadMore.hidden = !state.cursor;
  }

  async function loadInbox(append = false) {
    if (!canLoad() || state.busy) return;
    const version = state.sessionVersion;
    state.busy = true;
    loadMore.disabled = true;
    message.textContent = '正在加载…';
    try {
      const query = append && state.cursor ? `?before=${encodeURIComponent(state.cursor)}` : '';
      const payload = await api(`/notifications${query}`);
      if (version !== state.sessionVersion) return;
      state.items = append ? [...state.items, ...payload.notifications] : payload.notifications;
      state.cursor = payload.nextCursor;
      updateCount(payload.unreadCount);
      renderItems();
      message.textContent = state.items.length ? '' : '暂时没有通知';
    } catch (error) {
      if (version === state.sessionVersion) message.textContent = error.message;
    } finally {
      state.busy = false;
      loadMore.disabled = false;
    }
  }

  async function refreshCount() {
    if (!canLoad() || document.hidden) return;
    const version = state.sessionVersion;
    try {
      const payload = await api('/notifications/unread-count');
      if (version !== state.sessionVersion) return;
      const changed = payload.unreadCount !== state.unreadCount;
      updateCount(payload.unreadCount);
      if (changed && !panel.hidden) await loadInbox();
    } catch (error) {
      if (!panel.hidden) message.textContent = error.message;
      if (error.status === 401) widget.hidden = true;
    }
  }

  function removeSelectedUser(id) {
    state.selectedUsers.delete(id);
    requestId = null;
    const checkbox = adminSection.querySelector(`input[data-recipient-id="${id}"]`);
    if (checkbox) checkbox.checked = false;
    renderSelection();
  }

  function renderSelection() {
    const target = adminSection.querySelector('.notification-selected-users');
    target.replaceChildren();
    for (const [id, user] of state.selectedUsers) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${user.fullName || user.username} ×`;
      button.setAttribute('aria-label', `移除 ${user.fullName || user.username}`);
      button.addEventListener('click', () => removeSelectedUser(id));
      target.append(button);
    }
    adminSection.querySelector('.notification-selection-count').textContent =
      `已选择 ${state.selectedUsers.size} 人`;
  }

  async function loadAudience(query = '') {
    state.audienceVersion += 1;
    const version = state.audienceVersion;
    const section = adminSection;
    const status = section.querySelector('.notification-audience-status');
    status.textContent = '正在加载接收对象…';
    try {
      const payload = await api(`/admin/notifications/audience?q=${encodeURIComponent(query)}`);
      if (version !== state.audienceVersion || section !== adminSection) return;
      const target = section.querySelector('.notification-user-options');
      target.replaceChildren();
      for (const user of payload.users) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.recipientId = user.id;
        checkbox.checked = state.selectedUsers.has(user.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) state.selectedUsers.set(user.id, user);
          else state.selectedUsers.delete(user.id);
          renderSelection();
        });
        const text = document.createElement('span');
        text.textContent = `${user.fullName || user.username} · ${user.username} · ${user.studentId}`;
        label.append(checkbox, text);
        target.append(label);
      }
      const courseSelect = section.querySelector('[name="notification-course"]');
      const selectedCourse = courseSelect.value;
      courseSelect.replaceChildren(new Option('请选择课程管理组', ''));
      for (const course of payload.courses) {
        const option = new Option(
          `${course.name} · 课程管理组（${course.memberCount} 人）`,
          course.id,
        );
        option.disabled = !course.memberCount;
        courseSelect.append(option);
      }
      courseSelect.value = selectedCourse;
      status.textContent = payload.users.length
        ? '最多显示 100 人，可按姓名、用户名或学号搜索。'
        : '未找到用户';
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function refreshDelivery() {
    const section = adminSection;
    if (!section) return;
    const target = section.querySelector('.notification-delivery-status');
    try {
      const payload = await api('/admin/notifications/delivery');
      if (section !== adminSection) return;
      const sent = payload.delivery
        .filter((row) => row.status === 'sent')
        .reduce((sum, row) => sum + row.count, 0);
      const pending = payload.delivery
        .filter((row) => row.status !== 'sent')
        .reduce((sum, row) => sum + row.count, 0);
      const failed = payload.delivery
        .filter((row) => row.errorCode)
        .reduce((sum, row) => sum + row.count, 0);
      target.textContent = `邮件：${sent} 封已发送，${pending} 封待发送${failed ? `（其中 ${failed} 封等待重试，请检查邮件配置及收件邮箱）` : ''}。`;
    } catch (error) {
      target.textContent = error.message;
    }
  }

  function setupAdmin(user) {
    if (!user?.isAdmin && user?.role !== 'admin') {
      clearTimeout(searchTimer);
      state.audienceVersion += 1;
      adminSection?.remove();
      adminSection = null;
      state.selectedUsers.clear();
      return;
    }
    const container = document.querySelector('#admin-users-content .admin-directory-shell');
    if (!container || adminSection || user.requiresUsernameChange) return;
    adminSection = document.createElement('section');
    adminSection.className = 'notification-admin';
    adminSection.setAttribute('aria-labelledby', 'notification-admin-heading');
    adminSection.innerHTML = `
      <h2 id="notification-admin-heading">发布通知</h2>
      <p>站内通知会同时加入邮件发送队列。课程管理组包含该课程的负责人。</p>
      <form class="notification-publish-form">
        <label>标题<input name="notification-title" required maxlength="160" placeholder="通知标题" /></label>
        <label>正文<textarea name="notification-body" required maxlength="5000" rows="5" placeholder="填写通知内容"></textarea></label>
        <label>详情链接（可选）<input name="notification-link" maxlength="500" placeholder="例如 /discussion" /></label>
        <label>接收对象<select name="notification-audience">
          <option value="users">指定用户</option><option value="course">课程管理组</option>
          <option value="role">身份分组</option><option value="all">全体用户</option>
        </select></label>
        <div class="notification-target-users">
          <label>搜索用户<input name="notification-search" type="search" placeholder="姓名、用户名或学号" /></label>
          <p class="notification-audience-status" role="status"></p>
          <div class="notification-user-options"></div>
          <p class="notification-selection-count">已选择 0 人</p>
          <div class="notification-selected-users"></div>
        </div>
        <label class="notification-target-course" hidden>课程管理组<select name="notification-course"><option value="">请选择课程管理组</option></select></label>
        <label class="notification-target-role" hidden>身份分组<select name="notification-role">
          <option value="student">学生</option><option value="ta">助教</option><option value="teacher">教师</option><option value="admin">管理员</option>
        </select></label>
        <p class="notification-target-all" hidden>此通知将发送给站内所有用户。</p>
        <div class="notification-admin-actions"><button type="submit">发布通知</button>
          <button type="button" class="notification-delivery-refresh">刷新邮件状态</button></div>
        <p class="notification-publish-status" role="status" aria-live="polite"></p>
        <p class="notification-delivery-status" role="status"></p>
      </form>`;
    container.append(adminSection);
    const form = adminSection.querySelector('form');
    const field = (name) => form.elements.namedItem(`notification-${name}`);
    form.addEventListener('input', () => {
      requestId = null;
    });
    field('audience').addEventListener('change', () => {
      requestId = null;
      for (const type of ['users', 'course', 'role', 'all']) {
        adminSection.querySelector(`.notification-target-${type}`).hidden =
          field('audience').value !== type;
      }
    });
    field('search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadAudience(field('search').value), 250);
    });
    adminSection
      .querySelector('.notification-delivery-refresh')
      .addEventListener('click', refreshDelivery);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('.notification-publish-status');
      const button = form.querySelector('[type="submit"]');
      const audience = { type: field('audience').value };
      if (audience.type === 'users') audience.userIds = [...state.selectedUsers.keys()];
      if (audience.type === 'role') audience.role = field('role').value;
      if (audience.type === 'course') audience.courseId = field('course').value;
      if (audience.type === 'users' && !audience.userIds.length) {
        status.textContent = '请至少选择一位接收用户';
        return;
      }
      if (audience.type === 'course' && !audience.courseId) {
        status.textContent = '请选择课程管理组';
        return;
      }
      requestId ||= window.crypto.randomUUID();
      button.disabled = true;
      status.textContent = '正在发布…';
      try {
        const payload = await api('/admin/notifications', {
          method: 'POST',
          body: JSON.stringify({
            title: field('title').value,
            body: field('body').value,
            link: field('link').value,
            audience,
            requestId,
          }),
        });
        status.textContent = `已通知 ${payload.recipientCount} 位用户，${payload.emailQueued} 封邮件已加入发送队列。`;
        field('title').value = '';
        field('body').value = '';
        field('link').value = '';
        requestId = null;
        await refreshDelivery();
        await refreshCount();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    loadAudience();
    refreshDelivery();
  }

  async function syncSession(event) {
    state.sessionVersion += 1;
    const version = state.sessionVersion;
    const token = localStorage.getItem(storageKey) || '';
    state.token = token;
    state.user = null;
    widget.hidden = true;
    closePanel();
    state.items = [];
    state.cursor = null;
    list.replaceChildren();
    updateCount(0);
    if (!token) {
      setupAdmin(null);
      return;
    }
    try {
      const user = event?.detail?.user || (await api('/auth/me')).user;
      if (version !== state.sessionVersion || token !== localStorage.getItem(storageKey)) return;
      state.user = user;
      widget.hidden = Boolean(user.requiresUsernameChange);
      setupAdmin(user);
      if (canLoad()) await refreshCount();
    } catch (_error) {
      setupAdmin(null);
    }
  }

  bell.addEventListener('click', () => {
    if (!panel.hidden) {
      closePanel();
      return;
    }
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
    widget.querySelector('.notification-close').focus();
    loadInbox();
  });
  widget.querySelector('.notification-close').addEventListener('click', () => closePanel(true));
  loadMore.addEventListener('click', () => loadInbox(true));
  widget.querySelector('.notification-read-all').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/notifications/read-all', { method: 'POST' });
      await loadInbox();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = !state.unreadCount;
    }
  });
  document.addEventListener('click', (event) => {
    if (!widget.contains(event.target)) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      closePanel(true);
      event.preventDefault();
    }
  });
  window.addEventListener('freebbs:session-change', syncSession);
  window.addEventListener('freebbs:username-updated', syncSession);
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) syncSession();
  });
  window.addEventListener('focus', () => {
    if (state.token !== (localStorage.getItem(storageKey) || '')) syncSession();
    else refreshCount();
  });
  let timer = setInterval(refreshCount, 30000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    clearInterval(timer);
    timer = setInterval(refreshCount, 30000);
    syncSession();
  });
  syncSession();
})();
