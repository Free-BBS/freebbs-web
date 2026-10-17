(() => {
  let controller = null;
  let activeSession = '';
  let sessionBlocked = false;

  function initRegistrationWhitelist({ apiBaseUrl, getToken }) {
    const section = document.getElementById('registration-whitelist-panel');
    if (!section || controller) return controller;
    const message = section.querySelector('.whitelist-message');
    const uploadForm = section.querySelector('.whitelist-upload-form');
    const searchForm = section.querySelector('.whitelist-search-form');
    let page = 1;
    let query = '';
    let loadGeneration = 0;
    const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/admin/registration-whitelist`;

    function showMessage(text, failed = false) {
      message.textContent = text;
      message.classList.toggle('is-error', failed);
    }

    async function request(suffix = '', options = {}) {
      const token = getToken();
      if (sessionBlocked || !token || !window.freeBbsApp?.userState?.isAdmin)
        throw new Error('请使用管理员账号登录后重试。');
      const response = await fetch(`${endpoint}${suffix}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
      });
      if (sessionBlocked || token !== getToken() || !window.freeBbsApp?.userState?.isAdmin)
        throw new Error('登录状态已变化，请重新操作。');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const errors = (payload.errors || []).map(
          (error) => `第 ${error.row} 行：${error.message}`,
        );
        throw new Error([payload.message || '白名单操作失败', ...errors].join('\n'));
      }
      return response;
    }

    async function load({ preserveMessage = false } = {}) {
      loadGeneration += 1;
      const generation = loadGeneration;
      if (!preserveMessage) showMessage('正在加载白名单…');
      try {
        const response = await request(`?page=${page}&search=${encodeURIComponent(query)}`);
        const payload = await response.json();
        if (generation !== loadGeneration) return;
        if (!preserveMessage) showMessage('');
        const totalPages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
        if (page > totalPages) {
          page = totalPages;
          await load({ preserveMessage });
          return;
        }
        section.querySelector('[data-whitelist-count]').textContent =
          `${payload.stats.total} 条 · ${payload.stats.total - payload.stats.claimed} 条可注册`;
        section.querySelector('[data-whitelist-page]').textContent =
          `第 ${page} / ${totalPages} 页`;
        section.querySelector('[data-whitelist-prev]').disabled = page <= 1;
        section.querySelector('[data-whitelist-next]').disabled = page >= totalPages;
        const body = section.querySelector('tbody');
        body.replaceChildren();
        payload.entries.forEach((entry) => {
          const row = document.createElement('tr');
          [
            entry.studentId || '不限',
            entry.fullName || '不限',
            entry.email || '不限',
            entry.claimed ? '已注册' : '可注册',
          ].forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
          });
          const action = document.createElement('td');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'admin-button admin-button-secondary';
          button.textContent = '移除';
          button.setAttribute(
            'aria-label',
            `移除白名单 ${entry.studentId || entry.fullName || entry.email}`,
          );
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await request(`/${entry.id}`, { method: 'DELETE' });
              showMessage('白名单记录已移除，已有账户不受影响。');
              await load({ preserveMessage: true });
            } catch (error) {
              showMessage(error.message, true);
              button.disabled = false;
            }
          });
          action.append(button);
          row.append(action);
          body.append(row);
        });
        if (!payload.entries.length) {
          const row = document.createElement('tr');
          const cell = document.createElement('td');
          cell.colSpan = 5;
          cell.className = 'whitelist-empty';
          cell.textContent = query
            ? '没有匹配的白名单记录'
            : '白名单为空，当前不允许新用户注册。请上传填写好的模板。';
          row.append(cell);
          body.append(row);
        }
      } catch (error) {
        if (generation !== loadGeneration) return;
        section.querySelector('[data-whitelist-count]').textContent = '加载失败';
        showMessage(error.message, true);
      }
    }

    uploadForm.elements.mode.addEventListener('change', () => {
      section.querySelector('[data-whitelist-mode-help]').textContent =
        uploadForm.elements.mode.value === 'replace'
          ? '替换后，仅本次文件中的身份可注册。已有账户和已使用的注册记录会保留。'
          : '支持 .xlsx 文件，最多 10,000 行、5 MB。导入错误时整份文件均不会生效。';
    });
    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = uploadForm.elements.file.files[0];
      if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
        showMessage('请选择不超过 5 MB 的 .xlsx 文件。', true);
        return;
      }
      const button = uploadForm.querySelector('[type="submit"]');
      button.disabled = true;
      showMessage('正在校验并导入白名单…');
      try {
        const response = await request(`/import?mode=${uploadForm.elements.mode.value}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          body: file,
        });
        const result = await response.json();
        showMessage(
          `已导入 ${result.imported} 条白名单${result.duplicates ? `，忽略 ${result.duplicates} 条重复记录` : ''}。`,
        );
        uploadForm.elements.file.value = '';
        page = 1;
        await load({ preserveMessage: true });
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    section.querySelector('[data-whitelist-template]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const response = await request('/template');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = 'registration-whitelist-template.xlsx';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      page = 1;
      query = searchForm.elements.search.value.trim();
      load();
    });
    section.querySelector('[data-whitelist-prev]').addEventListener('click', () => {
      page -= 1;
      load();
    });
    section.querySelector('[data-whitelist-next]').addEventListener('click', () => {
      page += 1;
      load();
    });
    section.querySelector('[data-whitelist-retry]').addEventListener('click', () => load());
    controller = {
      refresh() {
        section.querySelectorAll('input, select, button').forEach((element) => {
          element.removeAttribute('disabled');
        });
        return load();
      },
      reset() {
        loadGeneration += 1;
        page = 1;
        query = '';
        searchForm.reset();
        uploadForm.reset();
        section.querySelector('tbody').replaceChildren();
        section.querySelector('[data-whitelist-count]').textContent = '等待加载';
        section.querySelector('[data-whitelist-page]').textContent = '';
        showMessage('');
        section.querySelectorAll('input, select, button').forEach((element) => {
          element.setAttribute('disabled', '');
        });
      },
    };
    controller.refresh();
    return controller;
  }
  window.initRegistrationWhitelist = initRegistrationWhitelist;

  function syncSession() {
    if (sessionBlocked) return;
    const app = window.freeBbsApp;
    const user = app?.userState;
    const session =
      user?.isLoggedIn && user.isAdmin && user.token ? `${user.uid || ''}:${user.token}` : '';
    if (session === activeSession) return;
    activeSession = session;
    const previous = controller;
    previous?.reset();
    if (!session) return;
    const current = initRegistrationWhitelist({
      apiBaseUrl: app.apiBaseUrl,
      getToken: () => app.userState.token,
    });
    if (previous) current.refresh();
  }

  window.addEventListener('freebbs:session-change', () => {
    sessionBlocked = false;
    syncSession();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      sessionBlocked = true;
      activeSession = '';
      controller?.reset();
    }
  });
  Promise.resolve(window.freeBbsApp?.sessionReady).then(syncSession);
})();
