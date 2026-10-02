(() => {
  const storageKey = 'free_bbs_auth_token';
  const api =
    window.FREEBBS_API_BASE ||
    (window.location.protocol === 'file:'
      ? 'http://127.0.0.1:3001/api'
      : `${window.location.origin}/api`);
  const originalFetch = window.fetch.bind(window);
  let pending;

  function requireValidUsername(user = {}) {
    if (
      !user.requiresUsernameChange &&
      /^[\p{Script=Han}A-Za-z0-9_]{2,64}$/u.test(user.username || '')
    ) {
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
          <p>用户名可使用汉字、英文字母、数字和下划线。修改后即可继续使用。</p>
          <label for="replacement-username">新用户名</label>
          <input id="replacement-username" name="username" type="text" autocomplete="username"
            minlength="2" maxlength="128" pattern="[\\p{Script=Han}A-Za-z0-9_]{2,64}" required
            aria-describedby="username-rule username-error" />
          <small id="username-rule">2–64 个字符，可用中文全名，例如张亦驰</small>
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
      input.value = /^[\p{Script=Han}A-Za-z0-9_]{2,64}$/u.test(user.username || '')
        ? user.username
        : '';
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
