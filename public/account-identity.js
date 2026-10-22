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
  const emailBinding = root.querySelector('#settings-email-binding');
  const studentBinding = root.querySelector('#settings-student-binding');
  const emailSummary = root.querySelector('#settings-email-summary');
  const studentSummary = root.querySelector('#settings-student-summary');
  let owner = '';
  let busy = false;
  let cooldown = 0;
  let timer;
  let externalSessionChanged = false;
  let generation = 0;
  let loadTicket = 0;
  let emailDirty = false;
  function storedSessionMatches() {
    try {
      return (
        typeof window.localStorage?.getItem !== 'function' ||
        window.localStorage.getItem('free_bbs_auth_token') === app.userState.token
      );
    } catch {
      return false;
    }
  }
  const session = () =>
    !externalSessionChanged &&
    storedSessionMatches() &&
    app.userState.isLoggedIn &&
    app.userState.uid &&
    app.userState.token
      ? `${app.userState.uid}:${app.userState.token}`
      : '';
  const owns = (current, version) => current && current === session() && version === generation;
  function revealBindings() {
    if (window.location?.hash !== '#settings-identity') return;
    if (emailBinding) emailBinding.open = true;
    if (studentBinding) studentBinding.open = true;
  }
  function updateIdentity(payload) {
    if (!payload.user || payload.user.uid !== app.userState.uid) return;
    window.dispatchEvent(new CustomEvent('freebbs:identity-updated', { detail: payload }));
  }

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
    const version = generation;
    loadTicket += 1;
    const ticket = loadTicket;
    try {
      const identity = await app.callApi('/profile/identity');
      if (!owns(current, version) || ticket !== loadTicket) return;
      const pending = identity.studentRequest;
      const suggested = identity.emailSuggestion;
      const suggestedEmail =
        suggested?.source === 'whitelist_pair' &&
        suggested.requiresVerification === true &&
        typeof suggested.email === 'string' &&
        suggested.email.length <= 128 &&
        /^[^\s@]+@(?:tsinghua\.edu\.cn|mails\.tsinghua\.edu\.cn)$/i.test(suggested.email) &&
        !identity.emailVerified &&
        (!identity.email || identity.email.toLowerCase() === suggested.email.toLowerCase())
          ? suggested.email
          : '';
      if (emailSummary)
        emailSummary.textContent = suggestedEmail
          ? '名单邮箱待验证'
          : identity.email
            ? identity.emailVerified
              ? '已验证'
              : '待验证'
            : '未绑定';
      if (studentSummary)
        studentSummary.textContent = identity.studentId
          ? '已绑定'
          : pending?.status === 'pending'
            ? '待核验'
            : pending?.status === 'rejected'
              ? '需补充'
              : '未绑定';
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
      if (!emailDirty && !emailForm.elements.email.value) {
        emailForm.elements.email.value = identity.email || suggestedEmail || '';
        if (suggestedEmail) {
          emailMessage.textContent = '已从白名单带入邮箱，验证后完成绑定。';
          if (emailBinding) emailBinding.open = true;
        }
      }
    } catch (error) {
      if (owns(current, version) && ticket === loadTicket) {
        status.textContent = error.message;
        if (emailSummary) emailSummary.textContent = '读取失败';
        if (studentSummary) studentSummary.textContent = '读取失败';
      }
    }
  }
  emailForm.elements.email.addEventListener('input', () => {
    emailDirty = true;
  });
  async function run(message, work) {
    if (busy || !session()) return;
    const current = session();
    const version = generation;
    busy = true;
    const panel = message === emailMessage ? emailBinding : studentBinding;
    if (panel) panel.open = true;
    message.textContent = '处理中…';
    render();
    try {
      const payload = await work(current, version);
      if (!owns(current, version)) return;
      message.textContent = payload.message;
      if (panel) panel.open = true;
      await load();
    } catch (error) {
      if (owns(current, version)) {
        message.textContent = error.message;
        if (panel) panel.open = true;
      }
    } finally {
      if (owns(current, version)) {
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
    run(emailMessage, async (current, version) => {
      const payload = await app.callApi('/profile/email-code', {
        method: 'POST',
        body: JSON.stringify({
          email: emailForm.elements.email.value,
          currentPassword: emailForm.elements.currentPassword.value,
        }),
      });
      if (owns(current, version)) {
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
    const body = Object.fromEntries(new FormData(emailForm));
    run(emailMessage, async (current, version) => {
      const payload = await app.callApi('/profile/email', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!owns(current, version)) return payload;
      emailForm.elements.currentPassword.value = '';
      emailForm.elements.emailCode.value = '';
      updateIdentity(payload);
      return payload;
    });
  });
  studentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(studentForm));
    run(studentMessage, async (current, version) => {
      const payload = await app.callApi('/profile/student-id', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (owns(current, version)) {
        studentForm.elements.currentPassword.value = '';
        if (payload.status === 'bound') updateIdentity(payload);
      }
      return payload;
    });
  });
  function sync() {
    const current = session();
    if (current === owner) return;
    owner = current;
    generation += 1;
    loadTicket += 1;
    busy = false;
    emailDirty = false;
    emailForm.reset();
    studentForm.reset();
    emailMessage.textContent = '';
    studentMessage.textContent = '';
    status.textContent = '请登录后查看绑定状态。';
    if (emailSummary) emailSummary.textContent = current ? '读取中…' : '未登录';
    if (studentSummary) studentSummary.textContent = current ? '读取中…' : '未登录';
    if (emailBinding) emailBinding.open = false;
    if (studentBinding) studentBinding.open = false;
    cooldown = 0;
    window.clearInterval(timer);
    render();
    revealBindings();
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
    externalSessionChanged = true;
    sync();
  });
  window.addEventListener('pageshow', () => {
    externalSessionChanged = false;
    sync();
  });
  window.addEventListener('hashchange', revealBindings);
  document.getElementById('certification-refresh')?.addEventListener('click', () => {
    if (!busy && session()) load();
  });
  Promise.resolve(app.sessionReady).then(sync);
  render();
})();
