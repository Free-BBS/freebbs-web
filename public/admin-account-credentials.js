(() => {
  const app = window.freeBbsApp;
  if (!app || !document.getElementById('admin-users')) return;
  let dialog;
  let owner = '';
  let externalSessionChanged = false;
  const session = () =>
    !externalSessionChanged && app.userState.isLoggedIn && app.userState.isAdmin
      ? `${app.userState.uid}:${app.userState.token}`
      : '';

  function clearDialog() {
    if (!dialog) return;
    dialog.querySelectorAll('input,textarea').forEach((field) => {
      field.value = '';
    });
    dialog.close();
    dialog.remove();
    dialog = null;
  }
  function createDialog(title) {
    clearDialog();
    const node = document.createElement('dialog');
    node.className = 'settings-form admin-account-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    node.append(heading);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭并清除';
    close.addEventListener('click', clearDialog);
    node.append(close);
    node.addEventListener('cancel', clearDialog);
    document.body.append(node);
    dialog = node;
    node.showModal();
    return node;
  }
  function showCreated({ username, password }) {
    if (!session()) return;
    const node = createDialog('交付初始登录信息');
    const help = document.createElement('p');
    help.textContent =
      '请复制后单独交给账号本人。本人可在设置中修改用户名和密码。关闭后不会再显示此密码；忘记时可重新设置。';
    const text = document.createElement('textarea');
    text.readOnly = true;
    text.rows = 4;
    text.setAttribute('aria-label', '初始登录信息');
    text.value = `登录地址：${window.location.origin}/login\n用户名：${username}\n初始密码：${password}`;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制登录信息';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text.value);
        copy.textContent = '已复制';
      } catch {
        text.focus();
        text.select();
        copy.textContent = '请选择文字手动复制';
      }
    });
    node.append(help, text, copy);
  }
  function openReset({ id, username }) {
    const current = session();
    if (!current) return;
    const node = createDialog(`重置教师 ${username} 的密码`);
    const form = document.createElement('form');
    form.innerHTML =
      '<label class="auth-field"><span>管理员当前密码</span><input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required /></label><label class="auth-field"><span>教师新初始密码</span><input name="password" type="password" autocomplete="new-password" minlength="6" maxlength="128" required /></label><button type="button" data-generate-password>生成初始密码</button><p role="status" aria-live="polite"></p><button type="submit">确认重置</button>';
    form.querySelector('[data-generate-password]').addEventListener('click', () => {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      form.elements.password.value = Array.from(bytes, (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled || current !== session()) return;
      submit.disabled = true;
      const password = form.elements.password.value;
      try {
        await app.callApi(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, password }),
        });
        if (current !== session() || node !== dialog) return;
        showCreated({ username, password });
      } catch (error) {
        if (current === session() && node === dialog)
          form.querySelector('[role="status"]').textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
    node.append(form);
  }

  const panel = document.getElementById('admin-student-requests');
  const list = document.getElementById('admin-student-request-list');
  const message = document.getElementById('admin-student-request-message');
  async function loadRequests() {
    const current = session();
    if (!current || !panel) return;
    try {
      const payload = await app.callApi('/admin/student-id-requests');
      if (current !== session()) return;
      list.replaceChildren();
      panel.hidden = false;
      if (!payload.requests.length) {
        list.textContent = '暂无待核验的学号申请。';
        return;
      }
      for (const request of payload.requests) {
        const row = document.createElement('div');
        row.className = 'admin-user-editor-section';
        const identity = document.createElement('p');
        identity.textContent = `${request.fullName}（${request.username}）申请绑定 ${request.studentId}`;
        const label = document.createElement('label');
        const confirmed = document.createElement('input');
        confirmed.type = 'checkbox';
        label.append(confirmed, document.createTextNode('已核实本人与学号归属'));
        row.append(identity, label);
        for (const action of ['approve', 'reject']) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = action === 'approve' ? '批准绑定' : '拒绝申请';
          button.addEventListener('click', async () => {
            if (current !== session()) return;
            if (action === 'approve' && !confirmed.checked) {
              message.textContent = '请先核实真实身份，再勾选确认。';
              return;
            }
            row.querySelectorAll('button').forEach((item) => {
              item.disabled = true;
            });
            try {
              const result = await app.callApi(
                `/admin/student-id-requests/${encodeURIComponent(request.userId)}`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    action,
                    studentId: request.studentId,
                    identityConfirmed: confirmed.checked,
                  }),
                },
              );
              if (current !== session()) return;
              message.textContent = result.message;
              await loadRequests();
            } catch (error) {
              if (current === session()) message.textContent = error.message;
              row.querySelectorAll('button').forEach((item) => {
                item.disabled = false;
              });
            }
          });
          row.append(button);
        }
        list.append(row);
      }
    } catch (error) {
      if (current === session()) {
        panel.hidden = false;
        message.textContent = error.message;
      }
    }
  }
  function sync() {
    const current = session();
    if (owner === current) return;
    owner = current;
    clearDialog();
    if (panel) {
      panel.hidden = true;
      list.replaceChildren();
      message.textContent = '';
    }
    if (current) loadRequests();
  }
  window.FreeBbsAdminAccounts = { showCreated, openReset };
  window.addEventListener('freebbs:session-change', () => {
    externalSessionChanged = false;
    sync();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      externalSessionChanged = true;
      sync();
    }
  });
  window.addEventListener('pagehide', clearDialog);
  Promise.resolve(app.sessionReady).then(sync);
})();
