const API_BASE_URL = (() => {
  const isLocalFrontend =
    window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname) ||
    window.location.port === "3000";

  if (isLocalFrontend) {
    const host = window.location.hostname && window.location.protocol !== "file:" && window.location.hostname !== "0.0.0.0"
      ? window.location.hostname
      : "127.0.0.1";
    return `http://${host}:3001/api`;
  }

  return `${window.location.origin}/api`;
})();

const STORAGE_KEY = "free_bbs_auth_token";
const THEME_STORAGE_KEY = "free_bbs_theme_mode";

const authForm = document.getElementById("auth-page-form");
const authMessage = document.getElementById("auth-message");
const authSubmit = document.getElementById("auth-submit");
const sendEmailCodeButton = document.getElementById("send-email-code");
const authMajorFixed = document.getElementById("auth-major-fixed");
const EMAIL_CODE_RESEND_SECONDS = 60;
let emailCodeCountdownTimer = null;
let emailCodeCountdownRemaining = 0;

function getStoredThemeMode() {
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function applyThemeMode(mode) {
  const normalizedMode = mode === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", normalizedMode === "light");
  document.body.classList.toggle("theme-dark", normalizedMode !== "light");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const isLight = normalizedMode === "light";
    button.setAttribute("aria-pressed", String(isLight));
    button.innerHTML = `
      <img class="nav-icon theme-toggle-icon" src="/assets/icons/${isLight ? "moon" : "sun"}.svg" alt="" aria-hidden="true" />
      <span>${isLight ? "暗色模式" : "明亮模式"}</span>
    `;
    button.setAttribute("aria-label", isLight ? "切换到暗色模式" : "切换到明亮模式");
  });
}

function getThemeRevealOrigin(event) {
  if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
    if (event.clientX !== 0 || event.clientY !== 0) {
      return { x: event.clientX, y: event.clientY };
    }
  }

  const button = event?.currentTarget;
  if (button) {
    const rect = button.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function playThemeToggleMicroInteraction(event) {
  const button = event?.currentTarget;
  button?.classList.add("is-theme-switching");

  window.setTimeout(() => {
    button?.classList.remove("is-theme-switching");
  }, 680);
}

function applyThemeModeWithTransition(mode, event) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const origin = getThemeRevealOrigin(event);

  if (!prefersReducedMotion) {
    playThemeToggleMicroInteraction(event);
  }

  if (typeof document.startViewTransition !== "function" || prefersReducedMotion) {
    applyThemeMode(mode);
    return;
  }

  const { x, y } = origin;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
  const transition = document.startViewTransition(() => applyThemeMode(mode));

  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
          ]
        },
        {
          duration: 560,
          easing: "cubic-bezier(0.22, 0.76, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)"
        }
      );
    })
    .catch(() => {});
}

function toggleThemeMode(event) {
  const nextMode = document.body.classList.contains("theme-light") ? "dark" : "light";
  localStorage.setItem(THEME_STORAGE_KEY, nextMode);
  applyThemeModeWithTransition(nextMode, event);
}

function initializeThemeMode() {
  if (document.querySelector("[data-theme-toggle]")) {
    applyThemeMode(getStoredThemeMode());
    return;
  }

  const button = document.createElement("button");
  button.className = "theme-toggle auth-theme-toggle";
  button.type = "button";
  button.dataset.themeToggle = "true";
  button.addEventListener("click", toggleThemeMode);
  document.body.appendChild(button);
  applyThemeMode(getStoredThemeMode());
}

function setMessage(message) {
  authMessage.textContent = message || "";
}

function setEmailCodeButtonCountdown(seconds) {
  if (!sendEmailCodeButton) {
    return;
  }

  window.clearInterval(emailCodeCountdownTimer);
  emailCodeCountdownRemaining = Math.max(0, Number(seconds) || 0);

  if (!emailCodeCountdownRemaining) {
    sendEmailCodeButton.disabled = false;
    sendEmailCodeButton.textContent = "发送验证码";
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
      sendEmailCodeButton.textContent = "发送验证码";
      return;
    }

    renderCountdown();
  }, 1000);
}

async function callApi(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.detail ? `${payload.message}：${payload.detail}` : (payload.message || "请求失败"));
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = authForm.dataset.authMode;
  authSubmit.disabled = true;
  setMessage(mode === "login" ? "正在登录..." : (mode === "remake" ? "正在重设密码..." : "正在注册..."));

  try {
    if (mode === "register" || mode === "remake") {
      const studentId = document.getElementById("auth-student-id").value.trim();
      const password = document.getElementById("auth-password").value;
      const passwordConfirm = document.getElementById("auth-password-confirm").value;

      if (!/^20\d{8}$/.test(studentId)) {
        throw new Error("学号必须是 20 开头的 10 位数字");
      }

      if (password !== passwordConfirm) {
        throw new Error("两次输入的密码不一致");
      }
    }

    let payload;

    if (mode === "login") {
      payload = await callApi("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier: document.getElementById("auth-identifier").value.trim(),
            password: document.getElementById("auth-password").value
          })
        });
    } else if (mode === "remake") {
      payload = await callApi("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          studentId: document.getElementById("auth-student-id").value.trim(),
          email: document.getElementById("auth-email").value.trim(),
          emailCode: document.getElementById("auth-email-code").value.trim(),
          password: document.getElementById("auth-password").value
        })
      });
    } else {
      payload = await callApi("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: document.getElementById("auth-username").value.trim(),
            fullName: document.getElementById("auth-full-name").value.trim(),
            studentId: document.getElementById("auth-student-id").value.trim(),
            email: document.getElementById("auth-email").value.trim(),
            emailCode: document.getElementById("auth-email-code").value.trim(),
            password: document.getElementById("auth-password").value
          })
        });
    }

    localStorage.setItem(STORAGE_KEY, payload.token);
    window.location.href = "/";
  } catch (error) {
    setMessage(error.message);
  } finally {
    authSubmit.disabled = false;
  }
}

async function handleSendEmailCode() {
  const emailInput = document.getElementById("auth-email");
  const studentIdInput = document.getElementById("auth-student-id");
  const mode = authForm.dataset.authMode;

  if (emailCodeCountdownRemaining > 0) {
    return;
  }

  if (!emailInput || !emailInput.value.trim()) {
    setMessage("请先输入邮箱地址");
    return;
  }

  if (mode === "remake" && (!studentIdInput || !/^20\d{8}$/.test(studentIdInput.value.trim()))) {
    setMessage("请先输入 20 开头的 10 位学号");
    return;
  }

  sendEmailCodeButton.disabled = true;
  setMessage("正在发送验证码...");

  try {
    const payload = await callApi(mode === "remake" ? "/auth/send-reset-code" : "/auth/send-email-code", {
      method: "POST",
      body: JSON.stringify({
        email: emailInput.value.trim(),
        ...(mode === "remake" ? { studentId: studentIdInput.value.trim() } : {})
      })
    });

    setMessage(payload.message || "验证码已发送");
    setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
  } catch (error) {
    setMessage(error.message);
    if (error.status === 429) {
      setEmailCodeButtonCountdown(EMAIL_CODE_RESEND_SECONDS);
    } else {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = "发送验证码";
    }
  } finally {
    if (emailCodeCountdownRemaining <= 0) {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = "发送验证码";
    }
  }
}

authForm?.addEventListener("submit", handleAuthSubmit);
sendEmailCodeButton?.addEventListener("click", handleSendEmailCode);
authMajorFixed?.addEventListener("click", () => {
  window.alert("目前只开放给电子系同学");
});
initializeThemeMode();
