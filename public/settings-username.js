((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const app = root.freeBbsApp;
    const form = root.document.getElementById('settings-username-form');
    if (!form || !app) return;
    const controller = api.createController({
      form,
      callApi: (...args) => app.callApi(...args),
      getSession: () =>
        app.userState.isLoggedIn ? `${app.userState.uid}:${app.userState.token}` : '',
      onSaved: (payload) =>
        root.dispatchEvent(new CustomEvent('freebbs:username-updated', { detail: payload })),
    });
    let owner = '';
    const syncSession = () => {
      const nextOwner = app.userState.isLoggedIn ? app.userState.uid : '';
      if (nextOwner === owner) return;
      owner = nextOwner;
      controller.reset();
      if (owner) controller.load();
    };
    root.addEventListener('freebbs:session-change', syncSession);
    Promise.resolve(app.sessionReady).then(syncSession);
  }
})(typeof window === 'object' ? window : globalThis, () => {
  function createController({ form, callApi, getSession, onSaved }) {
    const input = form.querySelector('#settings-username');
    const policyText = form.querySelector('#settings-username-policy');
    const payment = form.querySelector('#settings-username-payment');
    const paid = form.querySelector('#settings-username-paid');
    const message = form.querySelector('#settings-username-message');
    const submitButton = form.querySelector('#settings-username-submit');
    const refresh = form.querySelector('#settings-username-refresh');
    let policy = null;
    let busy = false;
    let revision = 0;

    function render() {
      form.setAttribute('aria-busy', String(busy));
      input.disabled = busy || !policy;
      paid.disabled = busy;
      payment.hidden = !policy?.cost;
      submitButton.disabled =
        busy || !policy || (policy.cost > 0 && (!paid.checked || policy.balance < policy.cost));
      submitButton.textContent = busy
        ? '处理中…'
        : policy?.cost
          ? '支付 10 磁元并改名'
          : '免费修改昵称';
      refresh.disabled = busy;
      if (policy) {
        const next = policy.nextFreeAt ? new Date(policy.nextFreeAt).toLocaleString('zh-CN') : '';
        policyText.textContent = policy.freeAvailable
          ? '本次可免费修改昵称。免费次数不累计。'
          : `本次需要 10 磁元，当前余额 ${policy.balance} 磁元。下次免费时间：${next}。`;
      }
    }

    function reset() {
      revision += 1;
      policy = null;
      busy = false;
      input.value = '';
      paid.checked = false;
      message.textContent = '';
      policyText.textContent = '请登录后查看改名信息。';
      render();
    }

    async function load() {
      if (busy || !getSession()) return;
      const session = getSession();
      revision += 1;
      const request = revision;
      busy = true;
      render();
      try {
        const payload = await callApi('/profile/username', { method: 'GET' });
        if (request !== revision || session !== getSession()) return;
        if (!input.value) input.value = payload.policy.username;
        policy = payload.policy;
        paid.checked = false;
        message.textContent = '';
      } catch (error) {
        if (request !== revision || session !== getSession()) return;
        policy = null;
        message.textContent = error.message || '读取失败，请刷新改名信息。';
      } finally {
        if (request === revision) {
          busy = false;
          render();
        }
      }
    }

    async function submit() {
      if (busy || !policy || !getSession()) return;
      const username = input.value;
      if (!/^[A-Za-z0-9_]{3,64}$/.test(username) || /[^A-Za-z0-9_]/.test(username)) {
        message.textContent = '昵称须为 3–64 位英文字母、数字或下划线。';
        return;
      }
      if (username === policy.username) {
        message.textContent = '昵称未变化，未扣费。';
        return;
      }
      if (policy.cost && !paid.checked) {
        message.textContent = '请先确认支付 10 磁元。';
        return;
      }
      if (policy.cost && policy.balance < policy.cost) {
        message.textContent = '磁元不足，请等待免费改名或积累磁元。';
        return;
      }
      const session = getSession();
      revision += 1;
      const request = revision;
      busy = true;
      message.textContent = '';
      render();
      try {
        const payload = await callApi('/profile/username', {
          method: 'PATCH',
          body: JSON.stringify({
            username,
            expectedUsername: policy.username,
            allowPaid: policy.cost > 0 && paid.checked,
          }),
        });
        if (request !== revision || session !== getSession()) return;
        policy = payload.policy;
        input.value = payload.user.username;
        paid.checked = false;
        // A server success is final even when the local session/display cannot be refreshed.
        try {
          onSaved(payload);
          message.textContent = `${payload.message}。下次请用新昵称或邮箱登录。`;
        } catch {
          message.textContent = '昵称已更新；页面同步失败，请刷新或使用新昵称重新登录。';
        }
      } catch (error) {
        if (request !== revision || session !== getSession()) return;
        policy = null;
        paid.checked = false;
        message.textContent = `${error.message || '请求未完成'}。请先刷新改名信息核对结果，再重试。`;
      } finally {
        if (request === revision) {
          busy = false;
          render();
        }
      }
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    paid.addEventListener('change', render);
    input.addEventListener('input', () => {
      paid.checked = false;
      render();
    });
    refresh.addEventListener('click', load);
    reset();
    return { load, submit, reset };
  }
  return { createController };
});
