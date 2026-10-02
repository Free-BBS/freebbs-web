(() => {
  const app = window.freeBbsApp;
  const root = document.getElementById('settings-identity');
  if (!app || !root) return;
  const emailForm = root.querySelector('#settings-email-form');
  const studentForm = root.querySelector('#settings-student-form');
  const status = root.querySelector('#settings-identity-status');
  const emailMessage = root.querySelector('#settings-email-message');
  const studentMessage = root.querySelector('#settings-student-message');
  const sendButton = root.querySelector('#settings-email-code');
  let owner = '';
  let busy = false;
  let cooldown = 0;
  let timer;
  let externalSessionChanged = false;
  const session = () =>
    !externalSessionChanged && app.userState.isLoggedIn
      ? `${app.userState.uid}:${app.userState.token}`
      : '';

  function render() {
    root.querySelectorAll('input,button').forEach((field) => {
      field.disabled = busy || !session();
    });
    sendButton.disabled = busy || !session() || cooldown > Date.now();
    sendButton.textContent =
      cooldown > Date.now()
        ? `${Math.ceil((cooldown - Date.now()) / 1000)} 秒后重发`
        : '发送验证码';
  }
  async function load() {
    const current = session();
    if (!current) return;
    try {
      const identity = await app.callApi('/profile/identity');
      if (current !== session()) return;
      const pending = identity.studentRequest;
      status.textContent = [
        identity.email
          ? `邮箱：${identity.email}${identity.emailVerified ? '（已验证）' : '（待验证）'}`
          : '邮箱：未绑定',
        identity.studentId ? `学号：${identity.studentId}` : '学号：未绑定',
        pending?.status === 'pending'
          ? `学号 ${pending.studentId} 等待管理员核验`
          : pending?.status === 'rejected'
            ? `学号 ${pending.studentId} 的申请未通过，请核实后联系管理员`
            : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (!emailForm.elements.email.value) emailForm.elements.email.value = identity.email;
    } catch (error) {
      if (current === session()) status.textContent = error.message;
    }
  }
  async function run(message, work) {
    if (busy || !session()) return;
    const current = session();
    busy = true;
    message.textContent = '处理中…';
    render();
    try {
      const payload = await work();
      if (current !== session()) return;
      message.textContent = payload.message;
      await load();
    } catch (error) {
      if (current === session()) message.textContent = error.message;
    } finally {
      if (current === session()) {
        busy = false;
        render();
      }
    }
  }
  sendButton.addEventListener('click', () => {
    if (
      !emailForm.elements.email.reportValidity() ||
      !emailForm.elements.currentPassword.reportValidity()
    )
      return;
    const current = session();
    run(emailMessage, async () => {
      const payload = await app.callApi('/profile/email-code', {
        method: 'POST',
        body: JSON.stringify({
          email: emailForm.elements.email.value,
          currentPassword: emailForm.elements.currentPassword.value,
        }),
      });
      if (current === session()) {
        cooldown = Date.now() + 60000;
        window.clearInterval(timer);
        timer = window.setInterval(() => {
          render();
          if (Date.now() >= cooldown) window.clearInterval(timer);
        }, 1000);
      }
      return payload;
    });
  });
  emailForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = session();
    const body = Object.fromEntries(new FormData(emailForm));
    run(emailMessage, async () => {
      const payload = await app.callApi('/profile/email', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (current !== session()) return payload;
      emailForm.elements.currentPassword.value = '';
      emailForm.elements.emailCode.value = '';
      window.dispatchEvent(new CustomEvent('freebbs:identity-updated', { detail: payload }));
      return payload;
    });
  });
  studentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = session();
    const body = Object.fromEntries(new FormData(studentForm));
    run(studentMessage, async () => {
      const payload = await app.callApi('/profile/student-id', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (current === session()) studentForm.elements.currentPassword.value = '';
      return payload;
    });
  });
  function sync() {
    const current = session();
    if (current === owner) return;
    owner = current;
    busy = false;
    emailForm.reset();
    studentForm.reset();
    emailMessage.textContent = '';
    studentMessage.textContent = '';
    status.textContent = '请登录后查看绑定状态。';
    cooldown = 0;
    window.clearInterval(timer);
    render();
    if (current) load();
  }
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
  window.addEventListener('pagehide', () => {
    emailForm.reset();
    studentForm.reset();
    window.clearInterval(timer);
  });
  Promise.resolve(app.sessionReady).then(sync);
  render();
})();
