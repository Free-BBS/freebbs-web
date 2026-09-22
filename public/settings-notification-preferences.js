((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const app = root.freeBbsApp;
    const form = root.document.getElementById('settings-notification-form');
    if (!form || !app) return;
    const controller = api.createController({
      form,
      callApi: (...args) => app.callApi(...args),
      getSession: () =>
        app.userState.isLoggedIn ? `${app.userState.uid}:${app.userState.token}` : '',
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
  const KEYS = ['reply', 'reaction', 'commentLike', 'announcement', 'weeklyDigest', 'aiTask'];

  function createController({ form, callApi, getSession }) {
    const message = form.querySelector('[data-notification-preferences-message]');
    const submit = form.querySelector('button[type="submit"]');
    const inputs = Object.fromEntries(
      KEYS.map((key) => [key, form.querySelector(`[data-notification-preference="${key}"]`)]),
    );
    let values = Object.fromEntries(KEYS.map((key) => [key, true]));
    let busy = false;
    let revision = 0;

    function render() {
      form.setAttribute('aria-busy', String(busy));
      for (const key of KEYS) {
        if (inputs[key]) inputs[key].checked = Boolean(values[key]);
        if (inputs[key]) inputs[key].disabled = busy;
      }
      if (submit) submit.disabled = busy;
    }

    function reset() {
      revision += 1;
      busy = false;
      values = Object.fromEntries(KEYS.map((key) => [key, true]));
      if (message) message.textContent = '';
      render();
    }

    async function load() {
      if (busy || !getSession()) return;
      const session = getSession();
      const request = ++revision;
      busy = true;
      render();
      try {
        const payload = await callApi('/notifications/email-preferences', { method: 'GET' });
        if (request !== revision || session !== getSession()) return;
        values = { ...values, ...(payload.preferences || {}) };
        if (message) message.textContent = '';
      } catch (error) {
        if (request !== revision || session !== getSession()) return;
        if (message) message.textContent = error.message || '通知偏好读取失败，请稍后重试。';
      } finally {
        if (request === revision) {
          busy = false;
          render();
        }
      }
    }

    async function save() {
      if (busy || !getSession()) return;
      const session = getSession();
      const request = ++revision;
      values = Object.fromEntries(KEYS.map((key) => [key, Boolean(inputs[key]?.checked)]));
      busy = true;
      if (message) message.textContent = '正在保存通知偏好…';
      render();
      try {
        const payload = await callApi('/notifications/email-preferences', {
          method: 'PATCH',
          body: JSON.stringify(values),
        });
        if (request !== revision || session !== getSession()) return;
        values = { ...values, ...(payload.preferences || {}) };
        if (message) message.textContent = '邮件通知偏好已保存';
      } catch (error) {
        if (request !== revision || session !== getSession()) return;
        if (message) message.textContent = error.message || '保存失败，请重试。';
      } finally {
        if (request === revision) {
          busy = false;
          render();
        }
      }
    }

    for (const input of Object.values(inputs)) input?.addEventListener('change', render);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });
    reset();
    return { load, save, reset };
  }

  return { createController };
});
