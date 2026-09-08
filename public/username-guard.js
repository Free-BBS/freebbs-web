(() => {
  const storageKey = 'free_bbs_auth_token';
  const local =
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) ||
    window.location.port === '3000' ||
    window.location.protocol === 'file:';
  const host = window.location.hostname === '0.0.0.0' ? '127.0.0.1' : window.location.hostname;
  const api = local ? `http://${host || '127.0.0.1'}:3001/api` : `${window.location.origin}/api`;
  const originalFetch = window.fetch.bind(window);
  let pending;

  function requireValidUsername(user = {}) {
    if (!user.requiresUsernameChange && /^[A-Za-z0-9_]{3,64}$/.test(user.username || '')) {
      return Promise.resolve(null);
    }
    if (pending) return pending;
    pending = new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'username-dialog';
      dialog.setAttribute('aria-labelledby', 'username-dialog-title');
      dialog.innerHTML = `
        <form class="username-dialog-form">
          <h2 id="username-dialog-title">请修改用户名</h2>
          <p>用户名仅可使用英文字母、数字和下划线。修改后即可继续使用。</p>
          <label for="replacement-username">新用户名</label>
          <input id="replacement-username" name="username" type="text" autocomplete="username"
            minlength="3" maxlength="64" pattern="[A-Za-z0-9_]+" required
            aria-describedby="username-rule username-error" />
          <small id="username-rule">3–64 个字符，例如 zhang_san2026</small>
          <p id="username-error" class="username-dialog-error" role="alert"></p>
          <button type="submit">保存并继续</button>
          <button class="username-signout" type="button">退出登录</button>
        </form>`;
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      dialog.querySelector('.username-signout').addEventListener('click', () => {
        localStorage.removeItem(storageKey);
        window.location.assign('/login');
      });
      const input = dialog.querySelector('input');
      input.value = /^[A-Za-z0-9_]{3,64}$/.test(user.username || '') ? user.username : '';
      dialog.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = dialog.querySelector('[type="submit"]');
        const errorText = dialog.querySelector('[role="alert"]');
        button.disabled = true;
        errorText.textContent = '';
        try {
          const response = await originalFetch(`${api}/profile/username`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem(storageKey) || ''}`,
            },
            body: JSON.stringify({ username: input.value }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || '保存失败，请重试');
          localStorage.setItem(storageKey, result.token);
          dialog.close();
          dialog.remove();
          pending = null;
          window.dispatchEvent(new CustomEvent('freebbs:username-updated', { detail: result }));
          resolve(result);
        } catch (error) {
          errorText.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      document.body.append(dialog);
      dialog.showModal();
      input.focus();
    });
    return pending;
  }

  // All API clients share this gate, including independently loaded course and workbench pages.
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = String(args[0]?.url || args[0]);
    if (requestUrl.startsWith(`${api}/`) && response.status === 403) {
      const body = await response
        .clone()
        .json()
        .catch(() => ({}));
      if (body.code === 'username_change_required') requireValidUsername(body);
    }
    return response;
  };
  window.freeBbsAccount = { requireValidUsername };
})();
