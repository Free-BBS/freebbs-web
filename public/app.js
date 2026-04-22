const API_BASE_URL = (() => {
  const protocol = window.location.protocol === "file:" ? "http:" : window.location.protocol;
  const hostname = window.location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:3001/api`;
})();
const API_ROOT = API_BASE_URL.replace(/\/api$/, "");
const DEFAULT_AVATAR = "./assets/avatar_placeholder.png";

const STORAGE_KEY = "free_bbs_auth_token";
const userState = {
  isLoggedIn: false,
  token: localStorage.getItem(STORAGE_KEY) || "",
  username: "",
  fullName: "",
  avatarPath: "",
  bio: "",
  websiteUrl: "",
  electrons: 0,
  manetrons: 0
};

const userName = document.getElementById("user-name");
const userRole = document.getElementById("user-role");
const userStatus = document.getElementById("user-status");
const avatarButton = document.querySelector(".avatar");
const adminSection = document.getElementById("admin-section");
const adminUsers = document.getElementById("admin-users");
const adminMessage = document.getElementById("admin-message");
const adminAddUserButton = document.getElementById("admin-add-user");
const manageLinks = document.querySelectorAll(".manage-link");
const avatarImages = document.querySelectorAll(".avatar-image");
const settingsForm = document.getElementById("settings-form");
const settingsMessage = document.getElementById("settings-message");
const settingsFullName = document.getElementById("settings-full-name");
const settingsBio = document.getElementById("settings-bio");
const settingsWebsiteUrl = document.getElementById("settings-website-url");
const settingsAvatarInput = document.getElementById("settings-avatar-input");
const settingsAvatarImage = document.getElementById("settings-avatar-image");

function getAvatarUrl(avatarPath) {
  return avatarPath ? `${API_ROOT}${avatarPath}` : DEFAULT_AVATAR;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCurrency(type, value) {
  const icon = type === "electric" ? "electron" : "magnetron";
  const label = type === "electric" ? "电元" : "磁元";

  return `
    <span class="currency currency-${type}" data-tooltip="${label}" aria-label="${label}">
      <img class="currency-icon" src="./assets/icons/${icon}.svg" alt="${label}" />
      <span class="currency-value">${value}</span>
    </span>
  `;
}

function renderUser() {
  if (!userState.isLoggedIn) {
    userName.textContent = "登录/注册";
    if (userRole) {
      userRole.textContent = "学生";
    }
    userStatus.innerHTML = [
      renderCurrency("electric", "-"),
      renderCurrency("magnetic", "-")
    ].join("");
    avatarImages.forEach((image) => {
      image.src = DEFAULT_AVATAR;
    });
    return;
  }

  userName.textContent = userState.fullName || userState.username;
  if (userRole) {
    userRole.textContent = userState.role === "admin" ? "管理员" : "学生";
  }
  userStatus.innerHTML = [
    renderCurrency("electric", userState.electrons),
    renderCurrency("magnetic", userState.manetrons)
  ].join("");
  avatarImages.forEach((image) => {
    image.src = getAvatarUrl(userState.avatarPath);
  });

  if (settingsAvatarImage) {
    settingsAvatarImage.src = getAvatarUrl(userState.avatarPath);
  }
}

function setAdminMessage(message) {
  if (adminMessage) {
    adminMessage.textContent = message || "";
  }
}

function setSettingsMessage(message) {
  if (settingsMessage) {
    settingsMessage.textContent = message || "";
  }
}

function openModal(mode = "login") {
  window.location.href = mode === "register" ? "./register.html" : "./login.html";
}

function saveSession(token, user) {
  userState.isLoggedIn = true;
  userState.token = token;
  userState.username = user.username;
  userState.fullName = user.fullName || "";
  userState.role = user.role || "student";
  userState.avatarPath = user.avatarPath || "";
  userState.bio = user.bio || "";
  userState.websiteUrl = user.websiteUrl || "";
  userState.electrons = user.electrons ?? 0;
  userState.manetrons = user.manetrons ?? 0;
  localStorage.setItem(STORAGE_KEY, token);
  renderUser();
  renderSettingsForm();
  renderAdminSection();
}

function clearSession() {
  userState.isLoggedIn = false;
  userState.token = "";
  userState.username = "";
  userState.fullName = "";
  userState.role = "";
  userState.avatarPath = "";
  userState.bio = "";
  userState.websiteUrl = "";
  userState.electrons = 0;
  userState.manetrons = 0;
  localStorage.removeItem(STORAGE_KEY);
  renderUser();
  renderSettingsForm();
  renderAdminSection();
}

async function callApi(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {}),
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

async function restoreSession() {
  if (!userState.token) {
    if (isSettingsPage() || isAdminUsersPage()) {
      window.location.href = "./login.html";
      return;
    }
    renderUser();
    return;
  }

  try {
    const payload = await callApi("/auth/me", {
      method: "GET"
    });

    saveSession(userState.token, payload.user);
  } catch {
    clearSession();
    if (isSettingsPage() || isAdminUsersPage()) {
      window.location.href = "./login.html";
    }
  }
}

function isSettingsPage() {
  return window.location.pathname.endsWith("/settings.html");
}

function isAdminUsersPage() {
  return window.location.pathname.endsWith("/adminusers.html");
}

function renderAdminUsers(users) {
  if (!adminUsers) {
    return;
  }

  adminUsers.innerHTML = users.map((user) => `
    <article class="admin-user-row" data-user-id="${user.id}">
      <div class="admin-user-cell">
        <input data-field="username" type="text" value="${escapeHtml(user.username)}" readonly />
      </div>
      <div class="admin-user-cell">
        <input data-field="fullName" type="text" value="${escapeHtml(user.fullName)}" />
      </div>
      <div class="admin-user-cell">
        <input data-field="studentId" type="text" value="${escapeHtml(user.studentId)}" readonly />
      </div>
      <div class="admin-user-cell">
        <input data-field="email" type="email" value="${escapeHtml(user.email)}" readonly />
      </div>
      <div class="admin-user-cell">
        <select data-field="role">
          ${["student", "admin"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </div>
      <div class="admin-user-cell">
        <input data-field="electrons" type="number" value="${user.electrons}" />
      </div>
      <div class="admin-user-cell">
        <input data-field="manetrons" type="number" value="${user.manetrons}" />
      </div>
      <div class="admin-actions admin-user-cell">
        <button class="admin-button admin-button-primary" data-action="save">保存</button>
        <button class="admin-button admin-button-danger" data-action="delete">删除</button>
      </div>
    </article>
  `).join("");
}

function insertAdminDraftRow() {
  if (!adminUsers) {
    return;
  }

  const draft = document.createElement("article");
  draft.className = "admin-user-row admin-user-row-draft";
  draft.dataset.userId = "draft";
  draft.innerHTML = `
    <div class="admin-user-cell">
      <input data-field="username" type="text" placeholder="用户名" />
    </div>
    <div class="admin-user-cell">
      <input data-field="fullName" type="text" placeholder="姓名" />
    </div>
    <div class="admin-user-cell">
      <input data-field="studentId" type="text" placeholder="学号" />
    </div>
    <div class="admin-user-cell">
      <input data-field="email" type="email" placeholder="邮箱" />
    </div>
    <div class="admin-user-cell">
      <select data-field="role">
        <option value="student">student</option>
        <option value="admin">admin</option>
      </select>
    </div>
    <div class="admin-user-cell">
      <input data-field="electrons" type="number" value="0" />
    </div>
    <div class="admin-user-cell">
      <input data-field="manetrons" type="number" value="0" />
    </div>
    <div class="admin-actions admin-user-cell">
      <input class="admin-password-input" data-field="password" type="password" placeholder="初始密码" />
      <button class="admin-button admin-button-primary" data-action="create">保存</button>
      <button class="admin-button admin-button-secondary" data-action="cancel">取消</button>
    </div>
  `;

  adminUsers.prepend(draft);
  draft.querySelector('[data-field="username"]').focus();
}

async function loadAdminUsers() {
  if (!adminSection || !isAdminUsersPage() || userState.role !== "admin") {
    return;
  }

  try {
    const payload = await callApi("/admin/users", { method: "GET" });
    renderAdminUsers(payload.users || []);
  } catch (error) {
    setAdminMessage(error.message);
  }
}

function renderAdminSection() {
  const isAdmin = userState.isLoggedIn && userState.role === "admin";

  manageLinks.forEach((link) => {
    link.classList.toggle("hidden", !isAdmin);
  });

  if (!adminSection) {
    return;
  }

  adminSection.classList.toggle("hidden", !isAdmin);

  if (isAdmin && isAdminUsersPage()) {
    loadAdminUsers();
  }
}

function renderSettingsForm() {
  if (!settingsForm) {
    return;
  }

  settingsFullName.value = userState.fullName || "";
  settingsBio.value = userState.bio || "";
  settingsWebsiteUrl.value = userState.websiteUrl || "";
  settingsAvatarImage.src = getAvatarUrl(userState.avatarPath);
}

function handleAuthEntry() {
  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (window.confirm(`以 ${userState.fullName || userState.username} 身份登录中。是否退出登录？`)) {
    clearSession();
  }
}

function handleAvatarClick() {
  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (!window.location.pathname.endsWith("/settings.html")) {
    window.location.href = "./settings.html";
  }
}

async function handleSettingsSubmit(event) {
  if (!isSettingsPage()) {
    return;
  }

  event.preventDefault();
  setSettingsMessage("正在保存设置...");

  try {
    const payload = await callApi("/profile", {
      method: "PATCH",
      body: JSON.stringify({
        fullName: settingsFullName.value.trim(),
        bio: settingsBio.value.trim(),
        websiteUrl: settingsWebsiteUrl.value.trim()
      })
    });

    saveSession(userState.token, payload.user);
    renderSettingsForm();
    setSettingsMessage(payload.message || "个人设置已保存");
  } catch (error) {
    setSettingsMessage(error.message);
  }
}

async function handleAvatarUpload(event) {
  if (!isSettingsPage()) {
    return;
  }

  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    setSettingsMessage("请选择图片文件");
    event.target.value = "";
    return;
  }

  setSettingsMessage("正在上传头像...");

  try {
    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取头像文件失败"));
      reader.readAsDataURL(file);
    });

    const payload = await callApi("/profile/avatar", {
      method: "POST",
      body: JSON.stringify({ imageDataUrl })
    });

    saveSession(userState.token, payload.user);
    renderSettingsForm();
    setSettingsMessage(payload.message || "头像上传成功");
  } catch (error) {
    setSettingsMessage(error.message);
  } finally {
    event.target.value = "";
  }
}

async function handleAdminUsersClick(event) {
  if (!isAdminUsersPage()) {
    return;
  }

  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const card = button.closest(".admin-user-row");
  const userId = card?.dataset.userId;

  if (!card || !userId) {
    return;
  }

  const fullName = card.querySelector('[data-field="fullName"]').value.trim();
  const role = card.querySelector('[data-field="role"]').value;
  const electrons = Number(card.querySelector('[data-field="electrons"]').value || 0);
  const manetrons = Number(card.querySelector('[data-field="manetrons"]').value || 0);

  try {
    if (button.dataset.action === "cancel") {
      card.remove();
      setAdminMessage("");
      return;
    }

    if (button.dataset.action === "create") {
      setAdminMessage("正在创建用户...");
      await callApi("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: card.querySelector('[data-field="username"]').value.trim(),
          fullName,
          studentId: card.querySelector('[data-field="studentId"]').value.trim(),
          email: card.querySelector('[data-field="email"]').value.trim(),
          password: card.querySelector('[data-field="password"]').value,
          role,
          electrons,
          manetrons
        })
      });
      setAdminMessage("用户创建成功");
      loadAdminUsers();
      return;
    }

    if (button.dataset.action === "save") {
      setAdminMessage("正在保存用户...");
      await callApi(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ fullName, role, electrons, manetrons })
      });
      setAdminMessage("用户已更新");
      loadAdminUsers();
      return;
    }

    if (button.dataset.action === "delete") {
      if (!window.confirm("确认删除该用户？")) {
        return;
      }

      setAdminMessage("正在删除用户...");
      await callApi(`/admin/users/${userId}`, {
        method: "DELETE"
      });
      setAdminMessage("用户已删除");
      loadAdminUsers();
    }
  } catch (error) {
    setAdminMessage(error.message);
  }
}

userName.addEventListener("click", handleAuthEntry);
avatarButton.addEventListener("click", handleAvatarClick);
adminAddUserButton?.addEventListener("click", insertAdminDraftRow);
adminUsers?.addEventListener("click", handleAdminUsersClick);
settingsForm?.addEventListener("submit", handleSettingsSubmit);
settingsAvatarInput?.addEventListener("change", handleAvatarUpload);
renderUser();
restoreSession();
renderAdminSection();
renderSettingsForm();
