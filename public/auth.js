const API_BASE_URL = (() => {
  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:3001/api";
  }

  return `${window.location.origin}/api`;
})();

const STORAGE_KEY = "free_bbs_auth_token";

const authForm = document.getElementById("auth-page-form");
const authMessage = document.getElementById("auth-message");
const authSubmit = document.getElementById("auth-submit");
const sendEmailCodeButton = document.getElementById("send-email-code");
const authMajorFixed = document.getElementById("auth-major-fixed");

function setMessage(message) {
  authMessage.textContent = message || "";
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
    throw new Error(payload.detail ? `${payload.message}：${payload.detail}` : (payload.message || "请求失败"));
  }

  return payload;
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = authForm.dataset.authMode;
  authSubmit.disabled = true;
  setMessage(mode === "login" ? "正在登录..." : "正在注册...");

  try {
    if (mode === "register") {
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

    const payload = mode === "login"
      ? await callApi("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier: document.getElementById("auth-identifier").value.trim(),
            password: document.getElementById("auth-password").value
          })
        })
      : await callApi("/auth/register", {
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

    localStorage.setItem(STORAGE_KEY, payload.token);
    window.location.href = "./index.html";
  } catch (error) {
    setMessage(error.message);
  } finally {
    authSubmit.disabled = false;
  }
}

async function handleSendEmailCode() {
  const emailInput = document.getElementById("auth-email");

  if (!emailInput || !emailInput.value.trim()) {
    setMessage("请先输入邮箱地址");
    return;
  }

  sendEmailCodeButton.disabled = true;
  setMessage("正在发送验证码...");

  try {
    const payload = await callApi("/auth/send-email-code", {
      method: "POST",
      body: JSON.stringify({ email: emailInput.value.trim() })
    });

    setMessage(payload.message || "验证码已发送");
  } catch (error) {
    setMessage(error.message);
  } finally {
    sendEmailCodeButton.disabled = false;
  }
}

authForm?.addEventListener("submit", handleAuthSubmit);
sendEmailCodeButton?.addEventListener("click", handleSendEmailCode);
authMajorFixed?.addEventListener("click", () => {
  window.alert("目前只开放给电子系同学");
});
