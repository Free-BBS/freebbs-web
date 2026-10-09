const API_BASE_URL = (() => {
  if (window.FREEBBS_API_BASE) return window.FREEBBS_API_BASE;
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:3001/api';
  // The frontend server forwards /api to the backend, including local development.
  return `${window.location.origin}/api`;
})();

const STORAGE_KEY = 'free_bbs_auth_token';
const THEME_STORAGE_KEY = 'free_bbs_theme_mode';

const authForm = document.getElementById('auth-page-form');
const authMessage = document.getElementById('auth-message');
const authSubmit = document.getElementById('auth-submit');
const sendEmailCodeButton = document.getElementById('send-email-code');
const authMajorFixed = document.getElementById('auth-major-fixed');
const EMAIL_CODE_RESEND_SECONDS = 60;
let emailCodeCountdownTimer = null;
let emailCodeCountdownUntil = 0;
let emailCodeSending = false;
const EMAIL_CODE_COOLDOWN_KEY = `free_bbs_email_code_cooldown:${authForm?.dataset.authMode || ''}`;

function getStoredThemeMode() {
  if (window.freeBbsTheme) return window.freeBbsTheme.getCurrentMode();
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark';
  }
}

function applyThemeMode(mode) {
  if (window.freeBbsTheme) {
    window.freeBbsTheme.applyMode(mode);
    return;
  }
  const normalizedMode = mode === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', normalizedMode === 'light');
  document.body.classList.toggle('theme-dark', normalizedMode !== 'light');
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const isLight = normalizedMode === 'light';
    button.setAttribute('aria-pressed', String(isLight));
    button.innerHTML = `
      <img class="nav-icon theme-toggle-icon" src="/assets/icons/${isLight ? 'moon' : 'sun'}.svg" alt="" aria-hidden="true" />
      <span>${isLight ? '暗色模式' : '明亮模式'}</span>
    `;
    button.setAttribute('aria-label', isLight ? '切换到暗色模式' : '切换到明亮模式');
  });
}

function applyThemeModeWithTransition(mode, event) {
  const button = event?.currentTarget;

  button?.classList.add('is-theme-switching');
  applyThemeMode(mode);

  if (button) {
    window.setTimeout(() => {
      button.classList.remove('is-theme-switching');
    }, 620);
  }
}

function toggleThemeMode(event) {
  const nextMode = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  if (window.freeBbsTheme) window.freeBbsTheme.saveMode(nextMode);
  else {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // Changing the current page does not require storage permission.
    }
  }
  applyThemeModeWithTransition(nextMode, event);
}

function initializeThemeMode() {
  if (document.querySelector('[data-theme-toggle]')) {
    applyThemeMode(getStoredThemeMode());
    return;
  }

  const button = document.createElement('button');
  button.className = 'theme-toggle auth-theme-toggle';
  button.type = 'button';
  button.dataset.themeToggle = 'true';
  button.addEventListener('click', toggleThemeMode);
  document.body.appendChild(button);
  applyThemeMode(getStoredThemeMode());
}

function setMessage(message) {
  authMessage.textContent = message || '';
}

const registrationFields = [
  'auth-username',
  'auth-full-name',
  'auth-student-id',
  'auth-email',
  'auth-email-code',
  'auth-password',
  'auth-password-confirm',
  'auth-community-agreement',
];
const registrationErrorGroups = new Map();

function clearRegistrationFieldError(id) {
  const group = registrationErrorGroups.get(id) || [id];
  for (const fieldId of group) {
    const input = document.getElementById(fieldId);
    const message = document.getElementById(`${fieldId}-error`);
    if (input) input.setAttribute('aria-invalid', 'false');
    if (message) {
      message.textContent = '';
      message.hidden = true;
    }
    registrationErrorGroups.delete(fieldId);
  }
}

function setRegistrationFieldError(ids, message) {
  const fields = Array.isArray(ids) ? ids : [ids];
  for (const id of fields) {
    const input = document.getElementById(id);
    const hint = document.getElementById(`${id}-error`);
    if (!input || !hint) continue;
    input.setAttribute('aria-invalid', 'true');
    hint.textContent = message;
    hint.hidden = false;
    registrationErrorGroups.set(id, fields);
  }
}

function registrationSnapshot() {
  return Object.fromEntries(
    registrationFields.map((id) => {
      const input = document.getElementById(id);
      return [id, id === 'auth-community-agreement' ? input?.checked : input?.value];
    }),
  );
}

function validateRegistrationFields(ids = registrationFields) {
  for (const id of ids) clearRegistrationFieldError(id);
  const value = (id) => String(document.getElementById(id)?.value || '');
  const errors = {
    'auth-username': /^[A-Za-z0-9_]{3,64}$/.test(value('auth-username').trim())
      ? ''
      : '用户名须为 3 至 64 位英文字母、数字或下划线',
    'auth-full-name':
      value('auth-full-name').trim() && value('auth-full-name').trim().length <= 64
        ? ''
        : '请输入姓名，且长度不超过 64 个字符',
    'auth-student-id': /^20\d{8}$/.test(value('auth-student-id').trim())
      ? ''
      : '学号必须是 20 开头的 10 位数字',
    'auth-email':
      value('auth-email').trim().length <= 128 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('auth-email').trim())
        ? ''
        : '请输入有效邮箱地址，且长度不超过 128 个字符',
    'auth-email-code': /^\d{6}$/.test(value('auth-email-code').trim())
      ? ''
      : '请输入 6 位邮箱验证码',
    'auth-password': value('auth-password').length >= 6 ? '' : '密码长度至少为 6 位',
    'auth-password-confirm':
      value('auth-password-confirm') && value('auth-password') === value('auth-password-confirm')
        ? ''
        : '两次输入的密码不一致',
    'auth-community-agreement': document.getElementById('auth-community-agreement')?.checked
      ? ''
      : '请先阅读并同意社区公约',
  };
  const invalid = ids.filter((id) => errors[id]);
  for (const id of invalid) setRegistrationFieldError(id, errors[id]);
  if (invalid.length) document.getElementById(invalid[0])?.focus();
  return !invalid.length;
}

function showRegistrationError(error, snapshot) {
  if (authForm?.dataset.authMode !== 'register') return false;
  if (!Number.isInteger(error.status) || error.status >= 500) return false;
  const message = String(error.message || '请求失败');
  let fields;
  if (/^community_agreement_/.test(error.code || '')) fields = ['auth-community-agreement'];
  else if (['registration_not_whitelisted', 'registration_identity_claimed'].includes(error.code))
    fields = ['auth-full-name', 'auth-student-id', 'auth-email'];
  else if (/用户名、学号或邮箱已存在/.test(message))
    fields = ['auth-username', 'auth-student-id', 'auth-email'];
  else if (/邮箱验证码/.test(message)) fields = ['auth-email-code'];
  else if (/用户名/.test(message)) fields = ['auth-username'];
  else if (/学号/.test(message)) fields = ['auth-student-id'];
  else if (/姓名/.test(message)) fields = ['auth-full-name'];
  else if (/邮箱/.test(message)) fields = ['auth-email'];
  else if (/密码/.test(message)) fields = ['auth-password'];
  else if (/社区公约/.test(message)) fields = ['auth-community-agreement'];
  else if (error.status === 429) fields = ['auth-email-code'];
  if (!fields) return false;
  // A late response belongs to the submitted identity, not to a newly edited one.
  const current = registrationSnapshot();
  if (snapshot && fields.some((id) => snapshot[id] !== current[id])) {
    setMessage('');
    return true;
  }
  setRegistrationFieldError(fields, message);
  setMessage('');
  document.getElementById(fields[0])?.focus();
  return true;
}

function setEmailCodeStatus(message) {
  const status = document.getElementById('auth-email-code-status');
  if (authForm?.dataset.authMode !== 'register' || !status) {
    setMessage(message);
    return;
  }
  status.textContent = message || '';
  status.hidden = !message;
  setMessage('');
}

if (authForm?.dataset.authMode === 'register') {
  for (const id of registrationFields) {
    const input = document.getElementById(id);
    const clear = () => {
      clearRegistrationFieldError(id);
      if (id === 'auth-password') clearRegistrationFieldError('auth-password-confirm');
      if (['auth-full-name', 'auth-student-id', 'auth-email'].includes(id)) setEmailCodeStatus('');
    };
    input?.addEventListener('input', clear);
    input?.addEventListener('change', clear);
  }
}

function refreshEmailCodeCountdown() {
  if (!sendEmailCodeButton) return;
  const remaining = Math.max(0, Math.ceil((emailCodeCountdownUntil - Date.now()) / 1000));
  if (!remaining) {
    window.clearInterval(emailCodeCountdownTimer);
    emailCodeCountdownTimer = null;
    emailCodeCountdownUntil = 0;
    try {
      window.sessionStorage.removeItem(EMAIL_CODE_COOLDOWN_KEY);
    } catch {
      /* The in-memory deadline still works when storage is blocked. */
    }
  }
  sendEmailCodeButton.disabled = emailCodeSending || remaining > 0;
  sendEmailCodeButton.textContent = remaining ? `${remaining} s 后重发` : '发送验证码';
}

function setEmailCodeButtonCountdown(seconds) {
  if (!sendEmailCodeButton) return;
  window.clearInterval(emailCodeCountdownTimer);
  emailCodeCountdownUntil = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  try {
    window.sessionStorage.setItem(EMAIL_CODE_COOLDOWN_KEY, String(emailCodeCountdownUntil));
  } catch {
    /* Storage is optional; server-side resend throttling remains authoritative. */
  }
  refreshEmailCodeCountdown();
  if (emailCodeCountdownUntil > Date.now())
    emailCodeCountdownTimer = window.setInterval(refreshEmailCodeCountdown, 1000);
}

function initializeEmailCodeCountdown() {
  if (!sendEmailCodeButton) return;
  try {
    const until = Number(window.sessionStorage.getItem(EMAIL_CODE_COOLDOWN_KEY));
    const remaining = until - Date.now();
    if (
      Number.isFinite(remaining) &&
      remaining > 0 &&
      remaining <= EMAIL_CODE_RESEND_SECONDS * 1000
    )
      setEmailCodeButtonCountdown(remaining / 1000);
    else refreshEmailCodeCountdown();
  } catch {
    refreshEmailCodeCountdown();
  }
  document.addEventListener?.('visibilitychange', refreshEmailCodeCountdown);
  window.addEventListener?.('focus', refreshEmailCodeCountdown);
  window.addEventListener?.('pageshow', refreshEmailCodeCountdown);
}

async function callApi(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      payload.detail ? `${payload.message}：${payload.detail}` : payload.message || '请求失败',
    );
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }

  return payload;
}

function resetIdentity() {
  const method = document.getElementById('auth-reset-method')?.value || 'studentId';
  return method === 'username'
    ? { identifier: document.getElementById('auth-reset-identifier').value.trim() }
    : { studentId: document.getElementById('auth-student-id').value.trim() };
}

document.getElementById('auth-reset-method')?.addEventListener('change', (event) => {
  const username = event.target.value === 'username';
  document.getElementById('auth-reset-username-field').hidden = !username;
  document.getElementById('auth-reset-student-field').hidden = username;
  const identifier = document.getElementById('auth-reset-identifier');
  const studentId = document.getElementById('auth-student-id');
  identifier.disabled = !username;
  identifier.required = username;
  studentId.disabled = username;
  studentId.required = !username;
});

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = authForm.dataset.authMode;
  if (authSubmit.disabled) return;
  if (mode === 'register' && !validateRegistrationFields()) {
    setMessage('');
    return;
  }
  const submittedFields = mode === 'register' ? registrationSnapshot() : null;
  authSubmit.disabled = true;
  setMessage(
    mode === 'login' ? '正在登录...' : mode === 'remake' ? '正在重设密码...' : '正在注册...',
  );

  try {
    if (mode === 'register' || mode === 'remake') {
      const studentId = document.getElementById('auth-student-id').value.trim();
      const password = document.getElementById('auth-password').value;
      const passwordConfirm = document.getElementById('auth-password-confirm').value;

      if (
        mode === 'remake' &&
        Object.hasOwn(resetIdentity(), 'identifier') &&
        !resetIdentity().identifier
      ) {
        throw new Error('请输入登录用户名');
      }
      if (
        (mode === 'register' || !Object.hasOwn(resetIdentity(), 'identifier')) &&
        !/^20\d{8}$/.test(studentId)
      ) {
        throw new Error('学号必须是 20 开头的 10 位数字');
      }

      if (password !== passwordConfirm) {
        throw new Error('两次输入的密码不一致');
      }
    }

    let payload;

    if (mode === 'login') {
      const credentials = {
        identifier: document.getElementById('auth-identifier').value.trim(),
        password: document.getElementById('auth-password').value,
      };
      payload = await callApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
    } else if (mode === 'remake') {
      payload = await callApi('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          ...resetIdentity(),
          email: document.getElementById('auth-email').value.trim(),
          emailCode: document.getElementById('auth-email-code').value.trim(),
          password: document.getElementById('auth-password').value,
        }),
      });
    } else {
      const agreement = document.getElementById('auth-community-agreement');
      if (!agreement?.checked) {
        throw new Error('请先阅读并同意社区公约');
      }
      if (!window.freeBbsAuthChallenge) {
        throw new Error('注册验证未加载，请刷新页面后重试');
      }
      const registration = {
        username: document.getElementById('auth-username').value.trim(),
        fullName: document.getElementById('auth-full-name').value.trim(),
        studentId: document.getElementById('auth-student-id').value.trim(),
        email: document.getElementById('auth-email').value.trim(),
        emailCode: document.getElementById('auth-email-code').value.trim(),
        password: document.getElementById('auth-password').value,
        communityAgreementAccepted: true,
        communityAgreementVersion: agreement.dataset.version,
      };
      setMessage('请在弹窗中完成实验验证');
      payload = await window.freeBbsAuthChallenge.run({
        mode: 'register',
        identity: registration.email,
        agreementVersion: registration.communityAgreementVersion,
        request: callApi,
        submit: (captcha) =>
          callApi('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ ...registration, captcha }),
          }),
      });
    }

    if (!payload) {
      setMessage('已取消验证，填写内容已保留。');
      return;
    }
    if (localStorage.getItem(STORAGE_KEY) !== payload.token) {
      try {
        sessionStorage.removeItem('freebbs_activity_receipts_v2');
      } catch {
        /* Storage may be blocked. */
      }
    }
    localStorage.setItem(STORAGE_KEY, payload.token);
    if (payload.user?.requiresUsernameChange) {
      await window.freeBbsAccount.requireValidUsername(payload.user);
    }
    window.location.href =
      activityReturnPath() ||
      (window.matchMedia?.('(max-width: 900px)').matches ? '/discussion' : '/');
  } catch (error) {
    if (!showRegistrationError(error, submittedFields)) setMessage(error.message);
  } finally {
    authSubmit.disabled = false;
  }
}

async function handleSendEmailCode() {
  const emailInput = document.getElementById('auth-email');
  const studentIdInput = document.getElementById('auth-student-id');
  const mode = authForm.dataset.authMode;

  if (emailCodeSending || emailCodeCountdownUntil > Date.now()) {
    return;
  }
  if (
    mode === 'register' &&
    !validateRegistrationFields(['auth-full-name', 'auth-student-id', 'auth-email'])
  ) {
    setEmailCodeStatus('');
    return;
  }
  const submittedFields = mode === 'register' ? registrationSnapshot() : null;
  if (mode === 'register') clearRegistrationFieldError('auth-email-code');

  if (!emailInput || !emailInput.value.trim()) {
    setMessage('请先输入邮箱地址');
    return;
  }

  if (
    mode === 'remake' &&
    !Object.hasOwn(resetIdentity(), 'identifier') &&
    (!studentIdInput || !/^20\d{8}$/.test(studentIdInput.value.trim()))
  ) {
    setMessage('请先输入 20 开头的 10 位学号');
    return;
  }
  if (
    mode === 'remake' &&
    Object.hasOwn(resetIdentity(), 'identifier') &&
    !resetIdentity().identifier
  ) {
    setMessage('请先输入登录用户名');
    return;
  }

  emailCodeSending = true;
  sendEmailCodeButton.disabled = true;
  setEmailCodeStatus('正在发送验证码...');

  try {
    const payload = await callApi(
      mode === 'remake' ? '/auth/send-reset-code' : '/auth/send-email-code',
      {
        method: 'POST',
        body: JSON.stringify({
          email: emailInput.value.trim(),
          studentId: studentIdInput?.value.trim() || '',
          ...(mode === 'remake' ? resetIdentity() : {}),
          ...(mode === 'register'
            ? { fullName: document.getElementById('auth-full-name').value.trim() }
            : {}),
        }),
      },
    );

    const current = mode === 'register' ? registrationSnapshot() : null;
    const identityChanged =
      submittedFields &&
      ['auth-full-name', 'auth-student-id', 'auth-email'].some(
        (id) => submittedFields[id] !== current[id],
      );
    setEmailCodeStatus(
      identityChanged ? '身份信息已更改，请重新获取验证码' : payload.message || '验证码已发送',
    );
    setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
  } catch (error) {
    setEmailCodeStatus('');
    if (!showRegistrationError(error, submittedFields)) setMessage(error.message);
    if (error.status === 429) {
      setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
    } else {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = '发送验证码';
    }
  } finally {
    emailCodeSending = false;
    refreshEmailCodeCountdown();
  }
}

function activityReturnPath() {
  try {
    const value = new URLSearchParams(window.location.search).get('next');
    if (!value) return '';
    const next = new URL(value, window.location.origin);
    const allowed =
      next.pathname === '/publish' ||
      next.pathname === '/surveys' ||
      next.pathname.startsWith('/development/') ||
      (next.pathname === '/discussion' &&
        /^[a-zA-Z0-9_-]{1,80}$/.test(next.searchParams.get('post') || ''));
    return next.origin === window.location.origin && allowed
      ? `${next.pathname}${next.search}${next.hash}`
      : '';
  } catch {
    return '';
  }
}
function initializeAuthReturnLinks() {
  const next = activityReturnPath();
  if (!next) return;
  document.querySelectorAll('.auth-page-switch a').forEach((link) => {
    const destination = new URL(link.getAttribute('href'), window.location.origin);
    if (
      destination.origin === window.location.origin &&
      ['/login', '/register', '/remake'].includes(destination.pathname)
    ) {
      destination.searchParams.set('next', next);
      link.href = `${destination.pathname}${destination.search}`;
    }
  });
}
initializeAuthReturnLinks();
authForm?.addEventListener('submit', handleAuthSubmit);
sendEmailCodeButton?.addEventListener('click', handleSendEmailCode);
initializeEmailCodeCountdown();
authMajorFixed?.addEventListener('click', () => {
  window.alert('目前只开放给电子系同学');
});
initializeThemeMode();
