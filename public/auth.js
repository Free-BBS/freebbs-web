const API_BASE_URL = (() => {
  const isLocalFrontend =
    window.location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) ||
    window.location.port === '3000';

  if (isLocalFrontend) {
    const host =
      window.location.hostname &&
      window.location.protocol !== 'file:' &&
      window.location.hostname !== '0.0.0.0'
        ? window.location.hostname
        : '127.0.0.1';
    return `http://${host}:3001/api`;
  }

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
let emailCodeCountdownRemaining = 0;

function getStoredThemeMode() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function applyThemeMode(mode) {
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
  localStorage.setItem(THEME_STORAGE_KEY, nextMode);
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

function setEmailCodeButtonCountdown(seconds) {
  if (!sendEmailCodeButton) {
    return;
  }

  window.clearInterval(emailCodeCountdownTimer);
  emailCodeCountdownRemaining = Math.max(0, Number(seconds) || 0);

  if (!emailCodeCountdownRemaining) {
    sendEmailCodeButton.disabled = false;
    sendEmailCodeButton.textContent = '发送验证码';
    return;
  }

  const renderCountdown = () => {
    sendEmailCodeButton.disabled = true;
    sendEmailCodeButton.textContent = `${emailCodeCountdownRemaining}s后重发`;
  };

  renderCountdown();
  emailCodeCountdownTimer = window.setInterval(() => {
    emailCodeCountdownRemaining -= 1;

    if (emailCodeCountdownRemaining <= 0) {
      window.clearInterval(emailCodeCountdownTimer);
      emailCodeCountdownTimer = null;
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = '发送验证码';
      return;
    }

    renderCountdown();
  }, 1000);
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

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = authForm.dataset.authMode;
  if (authSubmit.disabled) return;
  authSubmit.disabled = true;
  setMessage(
    mode === 'login' ? '正在登录...' : mode === 'remake' ? '正在重设密码...' : '正在注册...',
  );

  try {
    if (mode === 'register' || mode === 'remake') {
      const studentId = document.getElementById('auth-student-id').value.trim();
      const password = document.getElementById('auth-password').value;
      const passwordConfirm = document.getElementById('auth-password-confirm').value;

      if (!/^20\d{8}$/.test(studentId)) {
        throw new Error('学号必须是 20 开头的 10 位数字');
      }

      if (password !== passwordConfirm) {
        throw new Error('两次输入的密码不一致');
      }
    }

    let payload;

    if (mode === 'login') {
      if (!window.freeBbsAuthChallenge) {
        throw new Error('登录验证未加载，请刷新页面后重试');
      }
      const credentials = {
        identifier: document.getElementById('auth-identifier').value.trim(),
        password: document.getElementById('auth-password').value,
      };
      setMessage('请在弹窗中完成能带验证');
      payload = await window.freeBbsAuthChallenge.run({
        mode: 'login',
        identity: credentials.identifier,
        request: callApi,
        submit: (captcha) =>
          callApi('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ ...credentials, captcha }),
          }),
      });
    } else if (mode === 'remake') {
      payload = await callApi('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          studentId: document.getElementById('auth-student-id').value.trim(),
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
      setMessage('请在弹窗中完成能带验证');
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
    localStorage.setItem(STORAGE_KEY, payload.token);
    if (payload.user?.requiresUsernameChange) {
      await window.freeBbsAccount.requireValidUsername(payload.user);
    }
    window.location.href = '/';
  } catch (error) {
    setMessage(error.message);
  } finally {
    authSubmit.disabled = false;
  }
}

async function handleSendEmailCode() {
  const emailInput = document.getElementById('auth-email');
  const studentIdInput = document.getElementById('auth-student-id');
  const mode = authForm.dataset.authMode;

  if (emailCodeCountdownRemaining > 0) {
    return;
  }

  if (!emailInput || !emailInput.value.trim()) {
    setMessage('请先输入邮箱地址');
    return;
  }

  if (mode === 'remake' && (!studentIdInput || !/^20\d{8}$/.test(studentIdInput.value.trim()))) {
    setMessage('请先输入 20 开头的 10 位学号');
    return;
  }

  sendEmailCodeButton.disabled = true;
  setMessage('正在发送验证码...');

  try {
    const payload = await callApi(
      mode === 'remake' ? '/auth/send-reset-code' : '/auth/send-email-code',
      {
        method: 'POST',
        body: JSON.stringify({
          email: emailInput.value.trim(),
          studentId: studentIdInput?.value.trim() || '',
          ...(mode === 'register'
            ? { fullName: document.getElementById('auth-full-name').value.trim() }
            : {}),
        }),
      },
    );

    setMessage(payload.message || '验证码已发送');
    setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
  } catch (error) {
    setMessage(error.message);
    if (error.status === 429) {
      setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
    } else {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = '发送验证码';
    }
  } finally {
    if (emailCodeCountdownRemaining <= 0) {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = '发送验证码';
    }
  }
}

authForm?.addEventListener('submit', handleAuthSubmit);
sendEmailCodeButton?.addEventListener('click', handleSendEmailCode);
authMajorFixed?.addEventListener('click', () => {
  window.alert('目前只开放给电子系同学');
});
initializeThemeMode();
