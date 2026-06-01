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
const API_ROOT = API_BASE_URL.replace(/\/api$/, "");
const DEFAULT_AVATAR = "/assets/avatar_placeholder.webp";
const MAX_AGENT_AVATAR = "/assets/max_the_agent_avatar.webp";

const STORAGE_KEY = "free_bbs_auth_token";
const userState = {
  isLoggedIn: false,
  token: localStorage.getItem(STORAGE_KEY) || "",
  uid: "",
  username: "",
  fullName: "",
  studentId: "",
  avatarPath: "",
  bio: "",
  websiteUrl: "",
  electrons: 0,
  manetrons: 0,
  fortuneBonusEnabled: false
};

const userName = document.getElementById("user-name");
const userRole = document.getElementById("user-role");
const userStatus = document.getElementById("user-status");
const userSettingsButton = document.getElementById("user-settings-button");
const userLogoutButton = document.getElementById("user-logout-button");
const adminSection = document.getElementById("admin-section");
const adminUsers = document.getElementById("admin-users");
const adminMessage = document.getElementById("admin-message");
const adminAddUserButton = document.getElementById("admin-add-user");
const fortuneBonusToggle = document.getElementById("fortune-bonus-toggle");
const manageLinks = document.querySelectorAll(".manage-link");
const fortuneLinks = document.querySelectorAll(".fortune-link");
const avatarImages = document.querySelectorAll(".avatar-image");
const settingsForm = document.getElementById("settings-form");
const settingsMessage = document.getElementById("settings-message");
const settingsFullName = document.getElementById("settings-full-name");
const settingsBio = document.getElementById("settings-bio");
const settingsWebsiteUrl = document.getElementById("settings-website-url");
const settingsAvatarInput = document.getElementById("settings-avatar-input");
const settingsAvatarImage = document.getElementById("settings-avatar-image");
const settingsLogoutButton = document.getElementById("settings-logout-button");
const settingsPasswordForm = document.getElementById("settings-password-form");
const settingsPasswordMessage = document.getElementById("settings-password-message");
const settingsCurrentPassword = document.getElementById("settings-current-password");
const settingsNewPassword = document.getElementById("settings-new-password");
const settingsNewPasswordConfirm = document.getElementById("settings-new-password-confirm");
const publicProfileAvatar = document.getElementById("public-profile-avatar");
const publicProfileName = document.getElementById("public-profile-name");
const publicProfileStudentId = document.getElementById("public-profile-student-id");
const publicProfileMajor = document.getElementById("public-profile-major");
const publicProfilePostCount = document.getElementById("public-profile-post-count");
const publicProfileLikeCount = document.getElementById("public-profile-like-count");
const publicProfileBio = document.getElementById("public-profile-bio");
const publicProfileWebsite = document.getElementById("public-profile-website");
const publicProfileMessage = document.getElementById("public-profile-message");
const homeDiscussionList = document.getElementById("home-discussion-list");
const discussionLayout = document.querySelector(".discussion-layout");
const discussionBoardList = document.getElementById("discussion-board-list");
const discussionPostList = document.getElementById("discussion-post-list");
const discussionDetail = document.getElementById("discussion-detail");
const discussionCreateToggle = document.getElementById("discussion-create-toggle");
const discussionComposeForm = document.getElementById("discussion-compose-form");
const discussionComposeBoard = document.getElementById("discussion-compose-board");
const discussionComposeTitle = document.getElementById("discussion-compose-title");
const discussionComposeContent = document.getElementById("discussion-compose-content");
const discussionComposeMessage = document.getElementById("discussion-compose-message");
const discussionInsertImage = document.getElementById("discussion-insert-image");
const discussionImageInput = document.getElementById("discussion-image-input");
const discussionBoardAboutTitle = document.getElementById("discussion-board-about-title");
const discussionBoardAboutBody = document.getElementById("discussion-board-about-body");
const discussionBoardEdit = document.getElementById("discussion-board-edit");
const discussionBoardModerators = document.getElementById("discussion-board-moderators");
const discussionStatsPosts = document.getElementById("discussion-stats-posts");
const discussionStatsLikes = document.getElementById("discussion-stats-likes");
const aiChatForm = document.getElementById("aichat-form");
const aiChatInput = document.getElementById("aichat-input");
const aiChatThread = document.getElementById("aichat-thread");
const aiChatStatus = document.getElementById("aichat-status");
const aiChatSend = document.getElementById("aichat-send");
const aiChatDialogList = document.getElementById("aichat-dialog-list");
const aiChatNewDialog = document.getElementById("aichat-new-dialog");
const aiChatDialogId = document.getElementById("aichat-dialog-id");
const aiChatShell = document.querySelector(".aichat-shell");
const aiChatDialogToggle = document.getElementById("aichat-dialog-toggle");
const discussionState = {
  boards: [],
  posts: [],
  activeBoard: "all",
  activePostId: "",
  isFallback: false,
  activePost: null,
  comments: []
};
const aiChatState = {
  currentDid: "",
  dialogs: [],
  messages: [],
  isSending: false,
  statusTimer: 0
};
const FALLBACK_DISCUSSION_BOARDS = [
  {
    id: -1,
    slug: "daily",
    name: "日常",
    description: "本地测试版块",
    descriptionMarkdown: "本地测试版块。后端连接失败时显示。",
    canModerate: false,
    canManageModerators: false,
    sortOrder: 10
  }
];
const FALLBACK_DISCUSSION_POST = {
  id: "local-test-post",
  title: "测试帖子",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  board: {
    slug: "daily",
    name: "日常"
  },
  isPinned: false,
  isFeatured: false,
  canFeature: false,
  canPin: false,
  canDelete: false,
  author: {
    id: -1,
    uid: "u_local_admin",
    username: "admin",
    fullName: "管理员",
    displayName: "管理员",
    avatarPath: ""
  },
  likeCount: 0,
  lightCount: 0,
  fireworksCount: 0,
  commentCount: 0,
  likedByMe: false,
  lightedByMe: false,
  fireworksByMe: false,
  contentMarkdown: [
    "这是一篇本地测试帖子，用于接口请求失败时占位。",
    "",
    "支持 **Markdown**，也支持 KaTeX：$E=mc^2$。",
    "",
    "$$",
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    "$$"
  ].join("\n")
};
const DISCUSSION_REACTIONS = {
  smile: {
    countKey: "likeCount",
    activeKey: "likedByMe",
    label: "令人高兴",
    inactiveIcon: "/assets/icons/smile.svg",
    activeIcon: "/assets/icons/smile.svg"
  },
  light: {
    countKey: "lightCount",
    activeKey: "lightedByMe",
    label: "有启发性",
    inactiveIcon: "/assets/icons/light-off.svg",
    activeIcon: "/assets/icons/light-on.svg"
  },
  fireworks: {
    countKey: "fireworksCount",
    activeKey: "fireworksByMe",
    label: "恭喜",
    inactiveIcon: "/assets/icons/fireworks.svg",
    activeIcon: "/assets/icons/fireworks.svg"
  }
};

function getAvatarUrl(avatarPath) {
  if (!avatarPath) {
    return DEFAULT_AVATAR;
  }

  if (String(avatarPath).startsWith("/assets/") || /^https?:\/\//i.test(String(avatarPath))) {
    return avatarPath;
  }

  return `${API_ROOT}${avatarPath}`;
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getFortuneResult(score, date = getTodayKey()) {
  if (score >= 90) {
    return {
      score,
      date,
      label: "大吉",
      colorClass: "fortune-great",
      colorName: "金色",
      tagline: "Absolute legend 🤩"
    };
  }

  if (score >= 50) {
    return {
      score,
      date,
      label: "吉",
      colorClass: "fortune-good",
      colorName: "红色",
      tagline: "闭眼写，随手推"
    };
  }

  if (score >= 20) {
    return {
      score,
      date,
      label: "平",
      colorClass: "fortune-neutral",
      colorName: "白色",
      tagline: "人生是个泊松过程，一时的等待是为了下一次跳跃"
    };
  }

  if (score >= 3) {
    return {
      score,
      date,
      label: "凶",
      colorClass: "fortune-bad",
      colorName: "绿色",
      tagline: "六根清净方为稻，退步原来是向前"
    };
  }

  return {
    score,
    date,
    label: "大凶",
    colorClass: "fortune-awful",
    colorName: "黑色",
    tagline: "前所未见，触目惊心。"
  };
}

function ensureFortuneModal() {
  let modal = document.getElementById("fortune-modal");

  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "fortune-modal";
  modal.className = "fortune-modal hidden";
  modal.innerHTML = `
    <div class="fortune-backdrop" data-action="close"></div>
    <section class="fortune-panel" aria-labelledby="fortune-title">
      <button class="fortune-close" type="button" data-action="close" aria-label="关闭">×</button>
      <h2 class="fortune-title" id="fortune-title">今日运势</h2>
      <p class="fortune-date" id="fortune-date"></p>
      <div class="fortune-badge" id="fortune-badge"></div>
      <p class="fortune-score" id="fortune-score"></p>
      <p class="fortune-tagline" id="fortune-tagline"></p>
      <div class="fortune-chart-wrap">
        <canvas class="fortune-chart" id="fortune-chart" width="720" height="260" aria-label="近一个月运势曲线"></canvas>
      </div>
      <p class="fortune-chart-caption" id="fortune-chart-caption"></p>
    </section>
  `;

  document.body.append(modal);

  modal.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='close']");
    if (target) {
      modal.classList.add("hidden");
    }
  });

  return modal;
}

function drawFortuneChart(canvas, history) {
  if (!canvas || !history?.length) {
    return;
  }

  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width || canvas.width));
  const height = Math.max(160, Math.floor(rect.height || canvas.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { top: 18, right: 18, bottom: 30, left: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const scoredHistory = history.filter((item) => item.score !== null && item.score !== undefined);
  const maxScore = Math.max(120, ...scoredHistory.map((item) => Number(item.score) || 0));
  const minScore = 0;
  const xFor = (index) => padding.left + (history.length === 1 ? chartWidth / 2 : (chartWidth * index) / (history.length - 1));
  const yFor = (score) => padding.top + chartHeight - ((score - minScore) / (maxScore - minScore)) * chartHeight;

  context.lineWidth = 1;
  context.strokeStyle = "rgba(232, 237, 243, 0.16)";
  context.fillStyle = "rgba(232, 237, 243, 0.5)";
  context.font = "12px sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  [0, 30, 60, 90, 120].forEach((tick) => {
    const y = yFor(tick);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(tick), padding.left - 8, y);
  });

  context.beginPath();
  let hasActiveLine = false;
  history.forEach((item, index) => {
    if (item.score === null || item.score === undefined) {
      hasActiveLine = false;
      return;
    }

    const x = xFor(index);
    const y = yFor(Number(item.score) || 0);
    if (!hasActiveLine) {
      context.moveTo(x, y);
      hasActiveLine = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "#ffe59a";
  context.stroke();

  history.forEach((item, index) => {
    if (item.score === null || item.score === undefined) {
      return;
    }

    const x = xFor(index);
    const y = yFor(Number(item.score) || 0);
    context.beginPath();
    context.arc(x, y, index === history.length - 1 ? 4.5 : 3, 0, Math.PI * 2);
    context.fillStyle = index === history.length - 1 ? "#ffffff" : "#ffe59a";
    context.fill();
  });

  const firstDate = history[0]?.date?.slice(5) || "";
  const lastDate = history[history.length - 1]?.date?.slice(5) || "";
  context.fillStyle = "rgba(232, 237, 243, 0.6)";
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillText(firstDate, padding.left, height - 20);
  context.textAlign = "right";
  context.fillText(lastDate, width - padding.right, height - 20);
}

async function openFortuneModal() {
  if (!userState.isLoggedIn || !userState.studentId) {
    return;
  }

  const modal = ensureFortuneModal();
  const badge = modal.querySelector("#fortune-badge");
  const date = modal.querySelector("#fortune-date");
  const score = modal.querySelector("#fortune-score");
  const tagline = modal.querySelector("#fortune-tagline");
  const chart = modal.querySelector("#fortune-chart");
  const chartCaption = modal.querySelector("#fortune-chart-caption");

  modal.classList.remove("hidden");
  badge.className = "fortune-badge";
  badge.textContent = "加载中";
  date.textContent = "";
  score.textContent = "";
  tagline.textContent = "";
  chartCaption.textContent = "";

  try {
    const payload = await callApi("/fortune", {
      method: "GET"
    });
    userState.fortuneBonusEnabled = Boolean(payload.fortuneBonusEnabled);
    const result = getFortuneResult(Number(payload.today.score), payload.today.date);

    badge.className = `fortune-badge ${result.colorClass}`;
    badge.textContent = result.label;
    date.textContent = result.date;
    score.textContent = `运势得分 ${result.score}`;
    tagline.textContent = result.tagline;
    chartCaption.textContent = "近一个月运势曲线";
    window.requestAnimationFrame(() => drawFortuneChart(chart, payload.history || []));
  } catch (error) {
    badge.className = "fortune-badge fortune-awful";
    badge.textContent = "失败";
    tagline.textContent = error.message || "获取运势失败";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCopySuccessMessage(format) {
  if (format === "word") {
    return "复制成功！请在word中粘贴使用";
  }

  if (format === "latex") {
    return "复制成功！请复制到overleaf或其他latex编辑软件中使用";
  }

  return "复制成功";
}

function showCopySuccessPopup(format) {
  let popup = document.getElementById("copy-success-popup");

  if (!popup) {
    popup = document.createElement("div");
    popup.id = "copy-success-popup";
    popup.className = "copy-success-popup hidden";
    popup.setAttribute("role", "status");
    popup.setAttribute("aria-live", "polite");
    document.body.append(popup);
  }

  window.clearTimeout(Number(popup.dataset.timer || 0));
  popup.textContent = getCopySuccessMessage(format);
  popup.classList.remove("hidden");
  popup.classList.remove("is-visible");
  window.requestAnimationFrame(() => {
    popup.classList.add("is-visible");
  });
  popup.dataset.timer = String(window.setTimeout(() => {
    popup.classList.remove("is-visible");
    window.setTimeout(() => popup.classList.add("hidden"), 180);
  }, 2200));
}

function renderCurrency(type, value) {
  const icon = type === "electric" ? "electron" : "magnetron";
  const label = type === "electric" ? "电元" : "磁元";

  return `
    <span class="currency currency-${type}" data-tooltip="${label}" aria-label="${label}">
      <img class="currency-icon" src="/assets/icons/${icon}.svg" alt="${label}" />
      <span class="currency-value">${value}</span>
    </span>
  `;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function renderUser() {
  if (isAiChatPage()) {
    document.body.classList.add("is-ai-session-ready");
    document.body.classList.toggle("is-ai-authenticated", userState.isLoggedIn);
  }

  if (!userState.isLoggedIn) {
    userName.textContent = "登录/注册";
    userName.disabled = false;
    if (userRole) {
      userRole.textContent = "学生";
    }
    userSettingsButton?.classList.add("hidden");
    userLogoutButton?.classList.add("hidden");
    userStatus.innerHTML = [
      renderCurrency("electric", "-"),
      renderCurrency("magnetic", "-")
    ].join("");
    avatarImages.forEach((image) => {
      image.src = DEFAULT_AVATAR;
    });
    document.querySelectorAll(".aichat-message-user .aichat-avatar-image").forEach((image) => {
      image.src = DEFAULT_AVATAR;
    });
    renderAiDialogList();
    renderDiscussionComposerState();
    return;
  }

  userName.textContent = userState.fullName || userState.username;
  userName.disabled = true;
  if (userRole) {
    userRole.textContent = userState.role === "admin" ? "管理员" : "学生";
  }
  userSettingsButton?.classList.remove("hidden");
  userLogoutButton?.classList.remove("hidden");
  userStatus.innerHTML = [
    renderCurrency("electric", userState.electrons),
    renderCurrency("magnetic", userState.manetrons)
  ].join("");
  avatarImages.forEach((image) => {
    image.src = getAvatarUrl(userState.avatarPath);
  });
  document.querySelectorAll(".aichat-message-user .aichat-avatar-image").forEach((image) => {
    image.src = getAvatarUrl(userState.avatarPath);
  });
  renderAiDialogList();

  if (settingsAvatarImage) {
    settingsAvatarImage.src = getAvatarUrl(userState.avatarPath);
  }

  renderDiscussionComposerState();
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

function setSettingsPasswordMessage(message) {
  if (settingsPasswordMessage) {
    settingsPasswordMessage.textContent = message || "";
  }
}

function setDiscussionMessage(message) {
  if (discussionComposeMessage) {
    discussionComposeMessage.textContent = message || "";
  }
}

function openModal(mode = "login") {
  window.location.href = mode === "register" ? "/register" : "/login";
}

function saveSession(token, user) {
  userState.isLoggedIn = true;
  userState.token = token;
  userState.uid = user.uid || "";
  userState.username = user.username;
  userState.fullName = user.fullName || "";
  userState.studentId = user.studentId || "";
  userState.role = user.role || "student";
  userState.avatarPath = user.avatarPath || "";
  userState.bio = user.bio || "";
  userState.websiteUrl = user.websiteUrl || "";
  userState.electrons = user.electrons ?? 0;
  userState.manetrons = user.manetrons ?? 0;
  localStorage.setItem(STORAGE_KEY, token);
  renderUser();
  loadAiDialogs();
  renderSettingsForm();
  renderAdminSection();
}

function clearSession() {
  userState.isLoggedIn = false;
  userState.token = "";
  userState.uid = "";
  userState.username = "";
  userState.fullName = "";
  userState.studentId = "";
  userState.role = "";
  userState.avatarPath = "";
  userState.bio = "";
  userState.websiteUrl = "";
  userState.electrons = 0;
  userState.manetrons = 0;
  localStorage.removeItem(STORAGE_KEY);
  aiChatState.currentDid = "";
  aiChatState.dialogs = [];
  aiChatState.messages = [];
  renderUser();
  renderAiChatThread();
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
      window.location.href = "/login";
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
      window.location.href = "/login";
    }
  }
}

async function loadFortuneConfig() {
  try {
    const payload = await callApi("/fortune-config", {
      method: "GET"
    });

    userState.fortuneBonusEnabled = Boolean(payload.fortuneBonusEnabled);
  } catch {
    userState.fortuneBonusEnabled = false;
  }

  if (fortuneBonusToggle) {
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
  }
}

function isSettingsPage() {
  return isCurrentPath("/settings");
}

function isAdminUsersPage() {
  return isCurrentPath("/adminusers");
}

function isDiscussionPage() {
  return isCurrentPath("/discussion");
}

function isAiChatPage() {
  return isCurrentPath("/aichat");
}

function isPublicProfilePage() {
  return isCurrentPath("/profile");
}

function isCurrentPath(pagePath) {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  return pathname === pagePath || pathname === `${pagePath}.html`;
}

function getProfileUidFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("uid") || params.get("studentId") || "").trim();
}

function isValidPublicUid(uid) {
  const value = String(uid || "").trim();
  return /^u_?[a-z0-9]{6,32}$/i.test(value) || /^20\d{8}$/.test(value);
}

function getProfileHref(uid) {
  if (!isValidPublicUid(uid)) {
    return "";
  }

  return `/profile?uid=${encodeURIComponent(uid)}`;
}

function renderAuthorProfileLink(author, className, includeAvatar = false) {
  const displayName = escapeHtml(author?.displayName || author?.fullName || author?.username || "匿名用户");
  const profileHref = getProfileHref(author?.uid);

  if (!profileHref) {
    return includeAvatar
      ? `
        <span class="${className}">
          <img class="discussion-post-avatar" src="${escapeHtml(getAvatarUrl(author?.avatarPath))}" alt="${displayName} 的头像" />
          <span>${displayName}</span>
        </span>
      `
      : `<span class="${className}">${displayName}</span>`;
  }

  return includeAvatar
    ? `
      <a class="${className}" data-action="open-profile" href="${profileHref}">
        <img class="discussion-post-avatar" src="${escapeHtml(getAvatarUrl(author?.avatarPath))}" alt="${displayName} 的头像" />
        <span>${displayName}</span>
      </a>
    `
    : `<a class="${className}" data-action="open-profile" href="${profileHref}">${displayName}</a>`;
}

function normalizeWebsiteUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return "";
  }
}

function setPublicProfileMessage(message) {
  if (publicProfileMessage) {
    publicProfileMessage.textContent = message || "";
  }
}

function getDiscussionQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    board: String(params.get("board") || "all").trim().toLowerCase() || "all",
    postId: String(params.get("post") || "").trim()
  };
}

function updateDiscussionQuery({ board, postId } = {}) {
  if (!isDiscussionPage()) {
    return;
  }

  const url = new URL(window.location.href);

  if (board && board !== "all") {
    url.searchParams.set("board", board);
  } else {
    url.searchParams.delete("board");
  }

  if (postId) {
    url.searchParams.set("post", String(postId));
  } else {
    url.searchParams.delete("post");
  }

  window.history.replaceState({}, "", url);
}

function renderHomeDiscussionPosts(posts) {
  if (!homeDiscussionList) {
    return;
  }

  if (!posts.length) {
    homeDiscussionList.innerHTML = `
      <article class="home-discussion-empty">
        <p>讨论区还没有帖子，去发第一篇吧。</p>
      </article>
    `;
    return;
  }

  homeDiscussionList.innerHTML = posts.map((post) => `
    <a class="home-discussion-item" href="/discussion?post=${encodeURIComponent(post.id)}">
      <div class="home-discussion-item-main">
        <h3>${escapeHtml(post.title)}</h3>
      </div>
      <div class="home-discussion-meta">
        <span>${escapeHtml(post.author.displayName)}</span>
        <span>${escapeHtml(formatDateOnly(post.createdAt))}</span>
      </div>
    </a>
  `).join("");
}

function renderFallbackHomeDiscussionPost() {
  renderHomeDiscussionPosts([FALLBACK_DISCUSSION_POST]);
}

function useFallbackDiscussionData() {
  discussionState.boards = FALLBACK_DISCUSSION_BOARDS;
  discussionState.posts = [FALLBACK_DISCUSSION_POST];
  discussionState.activeBoard = "daily";
  discussionState.isFallback = true;
}

function renderDiscussionBoards() {
  if (!discussionBoardList) {
    return;
  }

  const boards = [
    {
      slug: "all",
      name: "全部",
      description: "所有版块的最新帖子"
    },
    ...discussionState.boards
  ];

  discussionBoardList.innerHTML = boards.map((board) => `
    <button
      class="discussion-board-chip ${discussionState.activeBoard === board.slug ? "is-active" : ""}"
      type="button"
      data-board-slug="${board.slug}"
      title="${escapeHtml(board.description || board.name)}"
    >
      <span class="discussion-board-name">${escapeHtml(board.name)}</span>
    </button>
  `).join("");

  renderDiscussionBoardAbout();
}

function getActiveDiscussionBoard() {
  if (discussionState.activeBoard === "all") {
    return {
      slug: "all",
      name: "全部",
      descriptionMarkdown: "所有版块的最新帖子。",
      canModerate: false
    };
  }

  return discussionState.boards.find((board) => board.slug === discussionState.activeBoard) || null;
}

function renderDiscussionBoardAbout() {
  if (!discussionBoardAboutTitle || !discussionBoardAboutBody) {
    return;
  }

  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById("discussion-board-about");

  if (!board || board.slug === "all") {
    aboutBox?.classList.add("hidden");
    return;
  }

  aboutBox?.classList.remove("hidden");
  aboutBox?.classList.remove("is-editing", "is-managing-moderators");
  discussionBoardAboutTitle.textContent = `${board.name}版块`;
  discussionBoardAboutBody.innerHTML = renderMarkdownContent(board.descriptionMarkdown || board.description || "暂无说明。");
  enhanceMarkdownContent(discussionBoardAboutBody);

  if (discussionBoardEdit) {
    discussionBoardEdit.classList.toggle("hidden", !board.canModerate);
    discussionBoardEdit.textContent = "编辑";
  }

  if (discussionBoardModerators) {
    discussionBoardModerators.classList.toggle("hidden", !board.canManageModerators);
    discussionBoardModerators.textContent = "管理版主";
  }
}

function renderDiscussionComposeBoards() {
  if (!discussionComposeBoard) {
    return;
  }

  const availableBoards = discussionState.boards.filter((board) => (
    board.slug !== "changelog" || userState.role === "admin"
  ));

  discussionComposeBoard.innerHTML = availableBoards.map((board) => `
    <option value="${board.slug}">${escapeHtml(board.name)}</option>
  `).join("");

  const preferredBoard =
    discussionState.activeBoard !== "all" &&
    availableBoards.some((board) => board.slug === discussionState.activeBoard)
      ? discussionState.activeBoard
      : availableBoards[0]?.slug;

  if (preferredBoard) {
    discussionComposeBoard.value = preferredBoard;
  }
}

function renderDiscussionPosts() {
  if (!discussionPostList) {
    return;
  }

  if (!discussionState.posts.length) {
    discussionPostList.innerHTML = `
      <article class="discussion-empty">
        <p>这个版块还没有帖子。</p>
      </article>
    `;
    return;
  }

  discussionPostList.innerHTML = discussionState.posts.map((post) => `
    <article
      class="discussion-post-card ${discussionState.activePostId === post.id ? "is-active" : ""}"
      role="button"
      tabindex="0"
      data-post-id="${escapeHtml(post.id)}"
    >
      <div class="discussion-post-author">
        ${renderAuthorProfileLink(post.author, "discussion-author-link discussion-author-link-avatar", true)}
      </div>
      <div class="discussion-post-card-main">
        <div class="discussion-post-source">
          <span class="discussion-post-board">r/${escapeHtml(post.board.name)}</span>
          ${post.isPinned ? `<span class="discussion-pin-badge">置顶</span>` : ""}
          ${post.isFeatured ? `<span class="discussion-feature-badge">精华</span>` : ""}
          ${renderAuthorProfileLink(post.author, "discussion-author-link")}
          <span>${escapeHtml(formatDateOnly(post.createdAt))}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <div class="discussion-post-actions" aria-hidden="true">
          <span class="discussion-comment-count" title="评论">
            <img src="/assets/icons/chats.svg" alt="" aria-hidden="true" />
            <strong>${post.commentCount || 0}</strong>
          </span>
          <div class="discussion-inline-reactions" aria-label="帖子反应">
            ${renderDiscussionReactionButton(post, "smile")}
            ${renderDiscussionReactionButton(post, "light")}
            ${renderDiscussionReactionButton(post, "fireworks")}
          </div>
          ${post.canDelete ? `<span class="discussion-delete-action" data-action="delete-post" data-post-id="${escapeHtml(post.id)}"><img class="discussion-action-icon" src="/assets/icons/trash.svg" alt="" aria-hidden="true" /><span>删除</span></span>` : ""}
        </div>
      </div>
      <span class="discussion-post-open" aria-hidden="true">↗</span>
    </article>
  `).join("");
}

function renderDiscussionReactionButton(post, reactionType) {
  const reaction = DISCUSSION_REACTIONS[reactionType];

  if (!reaction) {
    return "";
  }

  const active = Boolean(post[reaction.activeKey]);
  const icon = active ? reaction.activeIcon : reaction.inactiveIcon;

  return `
    <button
      class="discussion-reaction-button ${active ? "is-reacted" : ""}"
      type="button"
      data-action="toggle-reaction"
      data-reaction-type="${reactionType}"
      data-post-id="${escapeHtml(post.id)}"
      aria-label="${escapeHtml(reaction.label)}"
      title="${escapeHtml(reaction.label)}"
    >
      <img src="${escapeHtml(icon)}" alt="" aria-hidden="true" />
      <strong>${post[reaction.countKey] || 0}</strong>
    </button>
  `;
}

function renderMarkdownContent(markdown) {
  const mathBlocks = [];
  const placeholderPrefix = "FREE_BBS_MATH_TOKEN_";
  const protectedMarkdown = String(markdown || "")
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression) => {
      const token = `${placeholderPrefix}${mathBlocks.length}`;
      mathBlocks.push({
        displayMode: true,
        expression: String(expression || "").trim()
      });
      return `\n\n${token}\n\n`;
    })
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix, expression) => {
      const token = `${placeholderPrefix}${mathBlocks.length}`;
      mathBlocks.push({
        displayMode: false,
        expression: String(expression || "").trim()
      });
      return `${prefix}${token}`;
    });

  const renderedMarkdown = window.marked?.parse
    ? window.marked.parse(protectedMarkdown, {
        gfm: true,
        breaks: true
      })
    : escapeHtml(protectedMarkdown).replace(/\n/g, "<br />");

  const safeRenderedMarkdown = sanitizeRenderedMarkdown(renderedMarkdown);

  const renderMathBlock = (_match, index) => {
    const mathBlock = mathBlocks[Number(index)];

    if (!mathBlock) {
      return "";
    }

    if (window.katex?.renderToString) {
      return window.katex.renderToString(mathBlock.expression, {
        displayMode: mathBlock.displayMode,
        throwOnError: false
      });
    }

    const delimiter = mathBlock.displayMode ? "$$" : "$";
    return `${delimiter}${escapeHtml(mathBlock.expression)}${delimiter}`;
  };

  return safeRenderedMarkdown
    .replace(new RegExp(`<p>\\s*${placeholderPrefix}(\\d+)\\s*</p>`, "g"), renderMathBlock)
    .replace(new RegExp(`${placeholderPrefix}(\\d+)`, "g"), renderMathBlock);
}

function sanitizeRenderedMarkdown(html) {
  if (typeof document === "undefined") {
    return String(html || "");
  }

  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const blockedTags = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option"
  ]);
  const allowedAttributes = new Set([
    "href",
    "src",
    "alt",
    "title",
    "class",
    "id",
    "colspan",
    "rowspan",
    "align"
  ]);

  template.content.querySelectorAll("*").forEach((element) => {
    const tagName = element.tagName.toLowerCase();

    if (blockedTags.has(tagName)) {
      element.remove();
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || "";

      if (name.startsWith("on") || !allowedAttributes.has(name)) {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === "href" || name === "src") && /^(?:javascript|data):/i.test(value.trim())) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
}

function shouldWaitForMaxReply(contentMarkdown) {
  return /(^|[^\p{L}\p{N}_])@max(?=$|[^\p{L}\p{N}_])/iu.test(String(contentMarkdown || ""));
}

function applyMathRendering(root) {
  if (!root || typeof window.renderMathInElement !== "function") {
    return;
  }

  window.renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true }
    ],
    throwOnError: false
  });
}

function addCodeCopyButtons(root) {
  root?.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy-button")) {
      return;
    }

    const code = pre.querySelector("code");
    const language = getCodeBlockLanguage(code);
    const button = document.createElement("button");
    button.className = "code-copy-button";
    button.type = "button";
    button.dataset.action = "toggle-code-copy-menu";
    button.title = "复制代码";
    button.setAttribute("aria-label", "复制代码");
    button.dataset.code = code?.textContent || pre.textContent || "";
    button.dataset.language = language;
    button.innerHTML = `<img src="/assets/icons/copy.svg" alt="" aria-hidden="true" />`;
    pre.append(button);
    pre.append(createCodeCopyMenu());
  });
}

function createCodeCopyMenu() {
  const menu = document.createElement("div");
  menu.className = "code-copy-menu hidden";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="text">纯文本</button>
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="latex">LaTeX</button>
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="word">Word</button>
  `;
  return menu;
}

function normalizeCodeLanguageName(language) {
  const value = String(language || "").trim().toLowerCase();

  if (value === "python" || value === "py" || value === "python3") {
    return "python";
  }

  if (value === "matlab" || value === "m") {
    return "matlab";
  }

  if (value === "java") {
    return "java";
  }

  if (value === "c" || value === "gcc") {
    return "c";
  }

  if (value === "cpp" || value === "c++" || value === "cplusplus" || value === "cc" || value === "cxx" || value === "g++") {
    return "cpp";
  }

  if (value === "bash" || value === "sh" || value === "shell" || value === "zsh" || value === "terminal" || value === "console") {
    return "bash";
  }

  return value;
}

function getCodeBlockLanguage(code) {
  const className = code?.className || "";
  const languageMatch = className.match(/(?:^|\s)language-([^\s]+)/);
  return normalizeCodeLanguageName(languageMatch?.[1] || code?.dataset.language || "");
}

function applyCodeHighlighting(root) {
  const highlighter = window.hljs;

  if (!root || !highlighter?.highlightElement) {
    return;
  }

  highlighter.configure?.({
    ignoreUnescapedHTML: true,
    languages: ["python", "matlab", "java", "c", "cpp", "bash", "javascript", "json", "css", "html", "xml"]
  });
  highlighter.registerAliases?.(["py", "python3"], { languageName: "python" });
  highlighter.registerAliases?.(["m"], { languageName: "matlab" });
  highlighter.registerAliases?.(["c++", "cplusplus", "cc", "cxx", "g++"], { languageName: "cpp" });
  highlighter.registerAliases?.(["gcc"], { languageName: "c" });
  highlighter.registerAliases?.(["sh", "shell", "zsh", "terminal", "console"], { languageName: "bash" });

  root.querySelectorAll("pre code").forEach((code) => {
    const language = getCodeBlockLanguage(code);

    if (language && highlighter.getLanguage?.(language)) {
      code.className = code.className.replace(/(?:^|\s)language-[^\s]+/g, "").trim();
      code.classList.add(`language-${language}`);
      code.dataset.language = language;
    }

    if (!code.dataset.highlighted) {
      highlighter.highlightElement(code);
    }
  });
}

function normalizeRunnableCodeLanguage(code) {
  const language = getCodeBlockLanguage(code);

  if (language === "python") {
    return "python";
  }

  if (language === "c" || language === "cpp") {
    return "cpp";
  }

  return "";
}

function addCodeRunButtons(root) {
  if (!isAiChatPage()) {
    return;
  }

  root?.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-run-button")) {
      return;
    }

    const code = pre.querySelector("code");
    const language = normalizeRunnableCodeLanguage(code);

    if (!language) {
      return;
    }

    const button = document.createElement("button");
    button.className = "code-run-button";
    button.type = "button";
    button.dataset.action = "run-code";
    button.dataset.language = language;
    button.dataset.code = code?.textContent || "";
    button.title = "运行代码";
    button.setAttribute("aria-label", "运行代码");
    button.innerHTML = `<img src="/assets/icons/run.svg" alt="" aria-hidden="true" />`;
    pre.append(button);
  });
}

function enhanceMarkdownContent(root) {
  if (!root) {
    return;
  }

  applyMathRendering(root);
  applyCodeHighlighting(root);
  addCodeCopyButtons(root);
  addCodeRunButtons(root);
  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noreferrer";
  });
  root.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
  });
}

function setAiChatStatus(message) {
  if (aiChatStatus) {
    aiChatStatus.textContent = message || "";
    aiChatStatus.classList.toggle("is-thinking", Boolean(message && /^Max 正在(?:思考|输入)/.test(message)));
  }
}

function clearAiChatStatusTimer() {
  if (aiChatState.statusTimer) {
    window.clearTimeout(aiChatState.statusTimer);
    aiChatState.statusTimer = 0;
  }
}

function startAiChatThinkingStatus() {
  clearAiChatStatusTimer();
  setAiChatStatus("Max 正在思考......");
  aiChatState.statusTimer = window.setTimeout(() => {
    setAiChatStatus("Max 正在输入......");
    aiChatState.statusTimer = 0;
  }, 1000 + Math.floor(Math.random() * 4001));
}

function stopAiChatThinkingStatus(message = "") {
  clearAiChatStatusTimer();
  setAiChatStatus(message);
}

function setAiChatThinkingBubble(article, message) {
  const bubble = article?.querySelector(".aichat-bubble");

  if (!bubble || article?.dataset.markdown) {
    return;
  }

  bubble.innerHTML = `<span class="aichat-thinking-inline">${escapeHtml(message)}</span>`;
  scrollAiChatToBottom();
}

function setAiDialogId(did) {
  if (aiChatDialogId) {
    aiChatDialogId.textContent = did ? `did: ${did}` : "";
  }
}

function scrollAiChatToBottom() {
  if (aiChatThread) {
    aiChatThread.scrollTop = aiChatThread.scrollHeight;
  }
}

function resizeAiChatInput() {
  if (!aiChatInput) {
    return;
  }

  if (!aiChatInput.value) {
    aiChatInput.style.height = "";
    return;
  }

  aiChatInput.style.height = "auto";
  aiChatInput.style.height = `${Math.min(aiChatInput.scrollHeight, 180)}px`;
}

function addAiMessageCopyControls(article) {
  if (!article || !article.classList.contains("aichat-message-assistant") || article.querySelector(".aichat-copy-control")) {
    return;
  }

  const control = document.createElement("div");
  control.className = "aichat-copy-control";
  control.innerHTML = `
    <button class="aichat-copy-button" type="button" data-action="toggle-ai-copy-menu" aria-label="复制 Max 回复" title="复制">
      <img src="/assets/icons/copy.svg" alt="" aria-hidden="true" />
    </button>
    <div class="aichat-copy-menu hidden" role="menu">
      <button type="button" role="menuitem" data-action="copy-ai-message" data-copy-format="markdown">Markdown</button>
      <button type="button" role="menuitem" data-action="copy-ai-message" data-copy-format="word">Word</button>
      <button type="button" role="menuitem" data-action="copy-ai-message" data-copy-format="text">纯文本</button>
      <button type="button" role="menuitem" data-action="copy-ai-message" data-copy-format="latex">LaTeX</button>
    </div>
  `;
  article.append(control);
}

function appendAiChatMessage(role, content = "") {
  if (!aiChatThread) {
    return null;
  }

  const article = document.createElement("article");
  article.className = `aichat-message aichat-message-${role}`;
  const avatarUrl = role === "user" ? getAvatarUrl(userState.avatarPath) : MAX_AGENT_AVATAR;
  const avatarAlt = role === "user" ? "你的头像" : "Max 的头像";
  article.innerHTML = `
    <div class="aichat-avatar">
      <img class="aichat-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(avatarAlt)}" />
    </div>
    <div class="aichat-bubble discussion-markdown-body"></div>
  `;

  aiChatThread.append(article);
  addAiMessageCopyControls(article);
  updateAiChatMessage(article, content);
  scrollAiChatToBottom();
  return article;
}

function renderAiWelcomeMessage() {
  if (!aiChatThread) {
    return;
  }

  aiChatThread.innerHTML = `
    <article class="aichat-message aichat-message-assistant">
      <div class="aichat-avatar">
        <img class="aichat-avatar-image" src="${escapeHtml(MAX_AGENT_AVATAR)}" alt="Max 的头像" />
      </div>
      <div class="aichat-bubble discussion-markdown-body">
        <p>你好，我是 Max。可以问我课程、推导、代码或讨论区里适合展开的问题。</p>
      </div>
    </article>
  `;
  const welcome = aiChatThread.querySelector(".aichat-message-assistant");
  if (welcome) {
    welcome.dataset.markdown = "你好，我是 Max。可以问我课程、推导、代码或讨论区里适合展开的问题。";
    addAiMessageCopyControls(welcome);
  }
}

function renderAiChatThread() {
  if (!aiChatThread) {
    return;
  }

  renderAiWelcomeMessage();
  aiChatState.messages.forEach((message) => {
    appendAiChatMessage(message.role, message.content);
  });
  setAiDialogId(aiChatState.currentDid);
  scrollAiChatToBottom();
}

function updateAiChatMessage(article, content) {
  const bubble = article?.querySelector(".aichat-bubble");

  if (!bubble) {
    return;
  }

  article.dataset.markdown = content || "";
  if (content) {
    bubble.innerHTML = renderMarkdownContent(content);
    enhanceMarkdownContent(bubble);
  } else {
    bubble.innerHTML = `<span class="aichat-thinking-inline">Max 正在思考......</span>`;
  }
  addAiMessageCopyControls(article);
  scrollAiChatToBottom();
}

function buildAiChatPayload(userMessage) {
  const recentMessages = aiChatState.messages.slice(-13);

  return {
    agent: "general_chat",
    source: "direct_chat",
    channel: "aichat",
    did: aiChatState.currentDid || "",
    messages: [
      ...recentMessages,
      {
        role: "user",
        content: userMessage
      }
    ],
    stream: true,
    temperature: 0.6
  };
}

function getAiDialogTitle(messages = aiChatState.messages) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content || "新的对话";
  return firstUserMessage.replace(/\s+/g, " ").trim().slice(0, 32) || "新的对话";
}

function getAiDialogIdFromUrl() {
  return String(new URLSearchParams(window.location.search).get("did") || "").trim();
}

function updateAiDialogUrl(did, { replace = false } = {}) {
  if (!isAiChatPage()) {
    return;
  }

  const url = new URL(window.location.href);

  if (did) {
    url.searchParams.set("did", did);
  } else {
    url.searchParams.delete("did");
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
}

function renderAiDialogList() {
  if (!aiChatDialogList) {
    return;
  }

  if (!userState.isLoggedIn) {
    aiChatDialogList.innerHTML = `<p class="aichat-dialog-empty">登录后保存最近对话。</p>`;
    setAiDialogId("");
    return;
  }

  if (!aiChatState.dialogs.length) {
    aiChatDialogList.innerHTML = `<p class="aichat-dialog-empty">还没有保存的对话。</p>`;
    setAiDialogId(aiChatState.currentDid);
    return;
  }

  aiChatDialogList.innerHTML = aiChatState.dialogs.map((dialog) => `
    <button class="aichat-dialog-item ${dialog.did === aiChatState.currentDid ? "is-active" : ""}" type="button" data-did="${escapeHtml(dialog.did)}">
      <span>${escapeHtml(dialog.title || "新的对话")}</span>
      <small>${escapeHtml(formatDateTime(dialog.updatedAt || dialog.createdAt))}</small>
    </button>
  `).join("");
  setAiDialogId(aiChatState.currentDid);
}

async function loadAiDialogs() {
  if (!isAiChatPage() || !aiChatDialogList || !userState.token) {
    renderAiDialogList();
    return;
  }

  try {
    const payload = await callApi("/ai/dialogs?limit=20", {
      method: "GET"
    });
    aiChatState.dialogs = payload.dialogs || [];
  } catch {
    aiChatState.dialogs = [];
  }

  renderAiDialogList();

  const urlDid = getAiDialogIdFromUrl();
  if (urlDid && urlDid !== aiChatState.currentDid) {
    await loadAiDialog(urlDid, { updateUrl: false });
  }
}

async function saveAiDialog() {
  if (!userState.token || !aiChatState.messages.length) {
    renderAiDialogList();
    return;
  }

  try {
    const payload = await callApi("/ai/dialogs", {
      method: "POST",
      body: JSON.stringify({
        did: aiChatState.currentDid || undefined,
        title: getAiDialogTitle(),
        messages: aiChatState.messages
      })
    });

    aiChatState.currentDid = payload.dialog.did;
    updateAiDialogUrl(aiChatState.currentDid, { replace: true });
    const rest = aiChatState.dialogs.filter((dialog) => dialog.did !== payload.dialog.did);
    aiChatState.dialogs = [payload.dialog, ...rest].slice(0, 20);
    renderAiDialogList();
  } catch (error) {
    setAiChatStatus(`对话未保存：${error.message}`);
  }
}

async function loadAiDialog(did, { updateUrl = true } = {}) {
  if (!did || aiChatState.isSending) {
    return;
  }

  try {
    setAiChatStatus("正在加载对话...");
    const payload = await callApi(`/ai/dialogs/${encodeURIComponent(did)}`, {
      method: "GET"
    });
    aiChatState.currentDid = payload.dialog.did;
    aiChatState.messages = payload.dialog.messages || [];
    if (updateUrl) {
      updateAiDialogUrl(aiChatState.currentDid);
    }
    renderAiChatThread();
    renderAiDialogList();
    setAiChatStatus("");
  } catch (error) {
    setAiChatStatus(error.message);
  }
}

function startNewAiDialog() {
  if (aiChatState.isSending) {
    return;
  }

  clearAiChatStatusTimer();
  aiChatState.currentDid = "";
  aiChatState.messages = [];
  updateAiDialogUrl("");
  renderAiChatThread();
  renderAiDialogList();
  aiChatShell?.classList.remove("is-dialogs-open");
  setAiChatStatus("");
  aiChatInput?.focus();
}

async function streamAiChatResponse(payload, onDelta) {
  if (!userState.token) {
    throw new Error("请先登录后再使用问问 Max");
  }

  const response = await fetch(`${API_BASE_URL}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload.detail ? `${errorPayload.message}：${errorPayload.detail}` : (errorPayload.message || "AI 请求失败"));
  }

  if (!response.body) {
    throw new Error("浏览器不支持流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventText of events) {
      const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));

      if (!dataLine) {
        continue;
      }

      const eventPayload = JSON.parse(dataLine.replace(/^data:\s*/, ""));

      if (eventPayload.error) {
        throw new Error(eventPayload.error.message || "AI 服务返回错误");
      }

      if (eventPayload.delta) {
        onDelta(eventPayload.delta);
      }
    }

    if (done) {
      break;
    }
  }
}

async function handleAiChatSubmit(event) {
  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (!aiChatInput || aiChatState.isSending) {
    return;
  }

  const userMessage = aiChatInput.value.trim();

  if (!userMessage) {
    return;
  }

  aiChatState.isSending = true;
  aiChatInput.value = "";
  resizeAiChatInput();
  aiChatInput.disabled = true;
  if (aiChatSend) {
    aiChatSend.disabled = true;
  }
  appendAiChatMessage("user", userMessage);
  const assistantArticle = appendAiChatMessage("assistant", "");
  startAiChatThinkingStatus();
  setAiChatThinkingBubble(assistantArticle, "Max 正在思考......");
  const bubbleTimer = window.setTimeout(() => {
    setAiChatThinkingBubble(assistantArticle, "Max 正在输入......");
  }, 1000 + Math.floor(Math.random() * 4001));
  let assistantContent = "";

  try {
    await streamAiChatResponse(buildAiChatPayload(userMessage), (delta) => {
      window.clearTimeout(bubbleTimer);
      assistantContent += delta;
      updateAiChatMessage(assistantArticle, assistantContent);
    });

    aiChatState.messages.push({ role: "user", content: userMessage });
    aiChatState.messages.push({ role: "assistant", content: assistantContent });
    stopAiChatThinkingStatus();
    await saveAiDialog();
  } catch (error) {
    window.clearTimeout(bubbleTimer);
    updateAiChatMessage(assistantArticle, `请求失败：${error.message}`);
    stopAiChatThinkingStatus("AI 服务不可用，请确认 freebbs-agent 已启动。");
  } finally {
    aiChatState.isSending = false;
    aiChatInput.disabled = false;
    if (aiChatSend) {
      aiChatSend.disabled = false;
    }
    aiChatInput.focus();
  }
}

function initializeAiChatPage() {
  if (!isAiChatPage()) {
    return;
  }

  aiChatInput?.addEventListener("input", resizeAiChatInput);
  aiChatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      aiChatForm?.requestSubmit();
    }
  });
  aiChatForm?.addEventListener("submit", handleAiChatSubmit);
  aiChatNewDialog?.addEventListener("click", startNewAiDialog);
  aiChatDialogToggle?.addEventListener("click", () => {
    aiChatShell?.classList.toggle("is-dialogs-open");
  });
  aiChatDialogList?.addEventListener("click", (event) => {
    const button = event.target.closest(".aichat-dialog-item");

    if (button) {
      loadAiDialog(button.dataset.did || "");
      aiChatShell?.classList.remove("is-dialogs-open");
    }
  });
  window.addEventListener("popstate", () => {
    const did = getAiDialogIdFromUrl();
    if (did) {
      loadAiDialog(did, { updateUrl: false });
    } else {
      aiChatState.currentDid = "";
      aiChatState.messages = [];
      renderAiChatThread();
      renderAiDialogList();
    }
  });
  renderAiChatThread();
  loadAiDialogs();
  resizeAiChatInput();
}

function setDiscussionDetailView(isDetailView) {
  discussionLayout?.classList.toggle("is-detail-view", Boolean(isDetailView));
}

function renderDiscussionStats(stats) {
  if (discussionStatsPosts) {
    discussionStatsPosts.textContent = String(stats?.postCount ?? discussionState.posts.length ?? 0);
  }

  if (discussionStatsLikes) {
    discussionStatsLikes.textContent = String(stats?.likeCount ?? 0);
  }
}

function renderDiscussionComments() {
  const list = document.getElementById("discussion-comment-list");

  if (!list) {
    return;
  }

  if (!discussionState.comments.length) {
    list.innerHTML = `<p class="discussion-stats-muted">还没有评论。</p>`;
    return;
  }

  const commentsByParent = new Map();
  discussionState.comments.forEach((comment) => {
    const parentId = comment.parentCommentId || 0;
    commentsByParent.set(parentId, [...(commentsByParent.get(parentId) || []), comment]);
  });

  const renderComment = (comment, depth = 0) => {
    const replies = commentsByParent.get(comment.id) || [];
    const displayDepth = Math.min(depth, 4);

    const current = `
    <article class="discussion-comment ${depth > 0 ? "discussion-comment-reply" : ""}" data-comment-id="${comment.id}" data-comment-depth="${displayDepth}" style="--comment-depth: ${displayDepth}">
      ${renderAuthorProfileLink(comment.author, "discussion-comment-author-link", true)}
      <div class="discussion-comment-body">
        <div class="discussion-comment-meta">
          ${renderAuthorProfileLink(comment.author, "discussion-author-link")}
          <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
          <button class="discussion-comment-reply-button" type="button" data-action="reply-comment" data-comment-id="${comment.id}" data-author-name="${escapeHtml(comment.author?.displayName || comment.author?.fullName || comment.author?.username || "匿名用户")}">回复</button>
        </div>
        <div class="discussion-comment-content">${renderMarkdownContent(comment.contentMarkdown)}</div>
        <div class="discussion-comment-reply-slot" data-reply-slot="${comment.id}"></div>
      </div>
    </article>
  `;

    return [current, ...replies.map((reply) => renderComment(reply, depth + 1))].join("");
  };

  list.innerHTML = (commentsByParent.get(0) || []).map((comment) => renderComment(comment)).join("");

  list.querySelectorAll(".discussion-comment-content").forEach((node) => enhanceMarkdownContent(node));
}

function renderDiscussionDetail(post) {
  if (!discussionDetail) {
    return;
  }

  if (!post) {
    setDiscussionDetailView(false);
    discussionDetail.classList.add("hidden");
    discussionDetail.innerHTML = "";
    discussionState.activePost = null;
    discussionState.comments = [];
    return;
  }

  setDiscussionDetailView(true);
  discussionDetail.classList.remove("hidden");
  discussionDetail.dataset.postId = String(post.id);
  discussionState.activePost = post;
  discussionDetail.innerHTML = `
    <header class="discussion-detail-head">
      <div class="discussion-detail-toolbar">
        <button class="discussion-detail-back" type="button" data-action="close-detail">
          <img class="discussion-action-icon" src="/assets/icons/return.svg" alt="" aria-hidden="true" />
          <span>返回帖子</span>
        </button>
        ${(post.canPin || post.canFeature || post.canDelete) ? `
          <div class="discussion-moderator-actions">
            ${post.canPin ? `<button class="discussion-detail-pin ${post.isPinned ? "is-active" : ""}" type="button" data-action="toggle-pin" data-post-id="${escapeHtml(post.id)}" data-pinned="${post.isPinned ? "1" : "0"}"><img class="discussion-action-icon" src="/assets/icons/top.svg" alt="" aria-hidden="true" /><span>${post.isPinned ? "取消置顶" : "置顶文章"}</span></button>` : ""}
            ${post.canFeature ? `<button class="discussion-detail-feature ${post.isFeatured ? "is-active" : ""}" type="button" data-action="toggle-feature" data-post-id="${escapeHtml(post.id)}" data-featured="${post.isFeatured ? "1" : "0"}"><img class="discussion-action-icon" src="/assets/icons/star.svg" alt="" aria-hidden="true" /><span>${post.isFeatured ? "取消精华" : "加精华"}</span></button>` : ""}
            ${post.canDelete ? `<button class="discussion-detail-delete" type="button" data-action="delete-post" data-post-id="${escapeHtml(post.id)}"><img class="discussion-action-icon" src="/assets/icons/trash.svg" alt="" aria-hidden="true" /><span>删除帖子</span></button>` : ""}
          </div>
        ` : ""}
      </div>
      <h2>${escapeHtml(post.title)}</h2>
      <div class="discussion-detail-meta">
        <span class="discussion-detail-board">#${escapeHtml(post.board.name)}</span>
        ${renderAuthorProfileLink(post.author, "discussion-author-link")}
        <span>${escapeHtml(formatDateTime(post.createdAt))}</span>
        <div class="discussion-detail-reactions">
          ${renderDiscussionReactionButton(post, "smile")}
          ${renderDiscussionReactionButton(post, "light")}
          ${renderDiscussionReactionButton(post, "fireworks")}
        </div>
        <span class="discussion-comment-count" title="评论">
          <img src="/assets/icons/chats.svg" alt="" aria-hidden="true" />
          <strong>${post.commentCount || 0}</strong>
        </span>
      </div>
    </header>
    <div class="discussion-markdown-body" id="discussion-markdown-body">${renderMarkdownContent(post.contentMarkdown)}</div>
    <section class="discussion-comments" aria-label="评论">
      <div class="discussion-comments-head">
        <h3>评论</h3>
      </div>
      <form class="discussion-comment-form" id="discussion-comment-form" data-parent-comment-id="">
        <textarea class="discussion-comment-input" id="discussion-comment-input" rows="4" maxlength="5000" placeholder="写一条评论，支持 Markdown 和 KaTeX"></textarea>
        <div class="discussion-compose-actions">
          <p class="discussion-message discussion-comment-message" id="discussion-comment-message"></p>
          <button class="auth-submit discussion-submit" type="submit">发表评论</button>
        </div>
      </form>
      <div class="discussion-comment-list" id="discussion-comment-list">
        <p class="discussion-stats-muted">正在加载评论...</p>
      </div>
    </section>
  `;

  const markdownBody = document.getElementById("discussion-markdown-body");
  enhanceMarkdownContent(markdownBody);
  loadDiscussionComments(post.id);
}

function renderDiscussionComposerState() {
  if (!discussionCreateToggle || !discussionComposeForm) {
    return;
  }

  if (userState.isLoggedIn) {
    discussionCreateToggle.textContent = discussionState.isFallback ? "重试发布" : "发布帖子";
    discussionCreateToggle.disabled = false;
    return;
  }

  discussionCreateToggle.textContent = "登录后发帖";
  discussionCreateToggle.disabled = false;
  discussionComposeForm.classList.add("hidden");
}

async function loadHomeDiscussionPosts() {
  if (!homeDiscussionList) {
    return;
  }

  try {
    const payload = await callApi("/discussion/posts?board=all&limit=6", {
      method: "GET"
    });
    renderHomeDiscussionPosts(payload.posts || []);
  } catch {
    renderFallbackHomeDiscussionPost();
  }
}

async function loadDiscussionBoards() {
  try {
    const payload = await callApi("/discussion/boards", {
      method: "GET"
    });
    discussionState.boards = payload.boards || [];
    discussionState.isFallback = false;
  } catch {
    discussionState.boards = FALLBACK_DISCUSSION_BOARDS;
    discussionState.isFallback = true;
  }

  renderDiscussionBoards();
  renderDiscussionComposeBoards();
  renderDiscussionComposerState();
}

async function loadDiscussionStats() {
  if (!discussionStatsPosts && !discussionStatsLikes) {
    return;
  }

  try {
    const payload = await callApi("/discussion/stats", {
      method: "GET"
    });
    renderDiscussionStats(payload);
  } catch {
    renderDiscussionStats(null);
  }
}

async function loadDiscussionComments(postId) {
  try {
    const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/comments`, {
      method: "GET"
    });
    discussionState.comments = payload.comments || [];
  } catch {
    discussionState.comments = [];
  }

  renderDiscussionComments();
}

function pollDiscussionCommentsForMax(postId, baselineCount, messageNode) {
  let attempts = 0;
  const timer = window.setInterval(async () => {
    attempts += 1;

    try {
      await loadDiscussionComments(postId);

      if (discussionState.comments.length > baselineCount) {
        window.clearInterval(timer);
        if (messageNode) {
          messageNode.textContent = "Max 已回复";
        }
        return;
      }
    } catch {
      // loadDiscussionComments already handles display fallback.
    }

    if (attempts >= 12) {
      window.clearInterval(timer);
      if (messageNode) {
        messageNode.textContent = "评论已发布，Max 可能稍后回复";
      }
    }
  }, 2500);
}

function updatePostReactionState(postId, reactionType, active, counts) {
  const reaction = DISCUSSION_REACTIONS[reactionType];

  if (!reaction) {
    return;
  }

  const updates = {
    [reaction.activeKey]: active,
    likeCount: Number(counts.likeCount || 0),
    lightCount: Number(counts.lightCount || 0),
    fireworksCount: Number(counts.fireworksCount || 0)
  };

  discussionState.posts = discussionState.posts.map((post) => (
    post.id === postId
      ? {
          ...post,
          ...updates
        }
      : post
  ));

  if (discussionState.activePost?.id === postId) {
    discussionState.activePost = {
      ...discussionState.activePost,
      ...updates
    };
  }
}

async function toggleDiscussionReaction(postId, reactionType = "smile") {
  if (!postId) {
    return;
  }

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/like`, {
    method: "POST",
    body: JSON.stringify({ reactionType })
  });

  updatePostReactionState(postId, reactionType, Boolean(payload.active), payload);
  renderDiscussionPosts();

  if (discussionState.activePost?.id === postId) {
    renderDiscussionDetail(discussionState.activePost);
  }

  loadDiscussionStats();
}

async function loadDiscussionDetail(postId) {
  if (!discussionDetail || !postId) {
    return;
  }

  setDiscussionDetailView(true);
  discussionDetail.classList.remove("hidden");
  discussionDetail.innerHTML = `
    <div class="discussion-detail-empty">
      <p>正在加载帖子详情...</p>
    </div>
  `;

  if (postId === FALLBACK_DISCUSSION_POST.id) {
    discussionState.activePostId = FALLBACK_DISCUSSION_POST.id;
    renderDiscussionPosts();
    renderDiscussionDetail(FALLBACK_DISCUSSION_POST);
    discussionDetail.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId
    });
    return;
  }

  const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}`, {
    method: "GET"
  });
  discussionState.activePostId = payload.post.id;
  renderDiscussionPosts();
  renderDiscussionDetail(payload.post);
  discussionDetail.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: discussionState.activePostId
  });
}

async function loadDiscussionPosts({ autoOpen = false } = {}) {
  if (!discussionPostList) {
    return;
  }

  discussionPostList.innerHTML = `
    <article class="discussion-empty">
      <p>正在加载帖子...</p>
    </article>
  `;

  try {
    const payload = await callApi(
      `/discussion/posts?board=${encodeURIComponent(discussionState.activeBoard)}&limit=30`,
      {
        method: "GET"
      }
    );
    discussionState.posts = payload.posts || [];
  } catch {
    useFallbackDiscussionData();
  }

  if (discussionState.activePostId && !discussionState.posts.some((post) => post.id === discussionState.activePostId)) {
    discussionState.activePostId = "";
  }

  renderDiscussionBoards();
  renderDiscussionComposeBoards();
  renderDiscussionPosts();
  loadDiscussionStats();

  if (!autoOpen) {
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId
    });
    return;
  }

  if (discussionState.activePostId) {
    await loadDiscussionDetail(discussionState.activePostId);
    return;
  }

  if (discussionState.posts[0]) {
    await loadDiscussionDetail(discussionState.posts[0].id);
    return;
  }

  renderDiscussionDetail(null);
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: ""
  });
}

async function initializeDiscussionPage() {
  if (!isDiscussionPage()) {
    return;
  }

  try {
    await loadDiscussionBoards();

    const query = getDiscussionQueryState();
    const validBoard = query.board === "all" || discussionState.boards.some((board) => board.slug === query.board);
    discussionState.activeBoard = validBoard ? query.board : "all";
    discussionState.activePostId = "";

    if (query.postId) {
      try {
        const payload = await callApi(`/discussion/posts/${encodeURIComponent(query.postId)}`, {
          method: "GET"
        });
        discussionState.activePostId = payload.post.id;
        discussionState.activeBoard = payload.post.board.slug;
        renderDiscussionDetail(payload.post);
      } catch {
        discussionState.activePostId = FALLBACK_DISCUSSION_POST.id;
        discussionState.activeBoard = FALLBACK_DISCUSSION_POST.board.slug;
        renderDiscussionDetail(FALLBACK_DISCUSSION_POST);
      }
    }

    await loadDiscussionPosts({
      autoOpen: Boolean(discussionState.activePostId)
    });
  } catch {
    useFallbackDiscussionData();
    discussionState.activePostId = FALLBACK_DISCUSSION_POST.id;
    renderDiscussionBoards();
    renderDiscussionComposeBoards();
    renderDiscussionPosts();
    renderDiscussionDetail(FALLBACK_DISCUSSION_POST);
  }
}

async function loadPublicProfile() {
  if (!isPublicProfilePage()) {
    return;
  }

  const profileUid = getProfileUidFromQuery();

  if (!isValidPublicUid(profileUid)) {
    if (publicProfileName) {
      publicProfileName.textContent = "未找到用户";
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = "请从帖子作者头像进入个人主页。";
    }
    setPublicProfileMessage("无效用户 UID");
    return;
  }

  setPublicProfileMessage("正在加载个人主页...");

  try {
    const payload = await callApi(`/users/${encodeURIComponent(profileUid)}/public-profile`, {
      method: "GET"
    });
    const profile = payload.profile || {};

    if (publicProfileAvatar) {
      publicProfileAvatar.src = getAvatarUrl(profile.avatarPath);
    }
    if (publicProfileName) {
      publicProfileName.textContent = profile.username || "未命名用户";
    }
    if (publicProfileStudentId) {
      publicProfileStudentId.textContent = profile.uid ? `UID ${profile.uid}` : "未公开 UID";
    }
    if (publicProfileMajor) {
      const majorParts = [profile.grade, profile.major].filter(Boolean);
      publicProfileMajor.textContent = majorParts.join(" · ") || "未填写院系信息";
    }
    if (publicProfilePostCount) {
      publicProfilePostCount.textContent = String(profile.postCount ?? 0);
    }
    if (publicProfileLikeCount) {
      publicProfileLikeCount.textContent = String(profile.likeCount ?? 0);
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = profile.bio || "这个人很神秘，什么都没写。";
    }
    if (publicProfileWebsite) {
      const websiteUrl = normalizeWebsiteUrl(profile.websiteUrl);
      if (websiteUrl) {
        publicProfileWebsite.innerHTML = `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(profile.websiteUrl)}</a>`;
      } else {
        publicProfileWebsite.textContent = "未填写";
      }
    }

    setPublicProfileMessage("");
  } catch (error) {
    if (publicProfileName) {
      publicProfileName.textContent = "加载失败";
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = "暂时无法获取该用户的公开资料。";
    }
    setPublicProfileMessage(error.message);
  }
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
  const showFortune = userState.isLoggedIn && Boolean(userState.studentId);

  manageLinks.forEach((link) => {
    link.classList.toggle("hidden", !isAdmin);
  });

  fortuneLinks.forEach((link) => {
    link.classList.toggle("hidden", !showFortune);
  });

  if (!adminSection) {
    return;
  }

  adminSection.classList.toggle("hidden", !isAdmin);

  if (fortuneBonusToggle) {
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
    fortuneBonusToggle.disabled = !isAdmin;
  }

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
  }
}

function handleUserSettingsClick() {
  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (!isSettingsPage()) {
    window.location.href = "/settings";
  }
}

function handleUserLogoutClick() {
  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (window.confirm(`确认退出 ${userState.fullName || userState.username}？`)) {
    clearSession();
    if (isSettingsPage()) {
      window.location.href = "/";
    }
  }
}

function handleSettingsLogout() {
  if (!isSettingsPage() || !userState.isLoggedIn) {
    return;
  }

  if (window.confirm(`确认退出 ${userState.fullName || userState.username}？`)) {
    clearSession();
    window.location.href = "/";
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

async function handleSettingsPasswordSubmit(event) {
  if (!isSettingsPage()) {
    return;
  }

  event.preventDefault();

  const currentPassword = settingsCurrentPassword.value;
  const newPassword = settingsNewPassword.value;
  const newPasswordConfirm = settingsNewPasswordConfirm.value;

  if (newPassword.length < 6) {
    setSettingsPasswordMessage("新密码长度至少为 6 位");
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    setSettingsPasswordMessage("两次输入的新密码不一致");
    return;
  }

  setSettingsPasswordMessage("正在更新密码...");

  try {
    const payload = await callApi("/profile/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });

    settingsPasswordForm.reset();
    setSettingsPasswordMessage(payload.message || "密码已更新");
  } catch (error) {
    setSettingsPasswordMessage(error.message);
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

async function handleFortuneBonusToggle(event) {
  if (!isAdminUsersPage() || userState.role !== "admin" || !fortuneBonusToggle) {
    return;
  }

  const enabled = event.target.checked;
  fortuneBonusToggle.disabled = true;
  setAdminMessage("正在更新运势开关...");

  try {
    const payload = await callApi("/admin/fortune-config", {
      method: "PATCH",
      body: JSON.stringify({
        fortuneBonusEnabled: enabled
      })
    });

    userState.fortuneBonusEnabled = Boolean(payload.fortuneBonusEnabled);
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
    setAdminMessage(userState.fortuneBonusEnabled ? "运势加成已开启" : "运势加成已关闭");
  } catch (error) {
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
    setAdminMessage(error.message);
  } finally {
    fortuneBonusToggle.disabled = false;
  }
}

async function handleDiscussionBoardClick(event) {
  const button = event.target.closest("[data-board-slug]");

  if (!button) {
    return;
  }

  discussionState.activeBoard = button.dataset.boardSlug || "all";
  discussionState.activePostId = "";
  renderDiscussionDetail(null);
  await loadDiscussionPosts({
    autoOpen: false
  });
}

async function handleDiscussionPostClick(event) {
  if (event.target.closest("[data-action='open-profile']")) {
    return;
  }

  const likeButton = event.target.closest("[data-action='toggle-reaction']");

  if (likeButton) {
    event.preventDefault();
    event.stopPropagation();
    await toggleDiscussionReaction(likeButton.dataset.postId || "", likeButton.dataset.reactionType || "smile");
    return;
  }

  const pinButton = event.target.closest("[data-action='toggle-pin']");

  if (pinButton) {
    await toggleDiscussionPin(pinButton.dataset.postId || "", pinButton.dataset.pinned === "1");
    return;
  }

  const featureButton = event.target.closest("[data-action='toggle-feature']");

  if (featureButton) {
    await toggleDiscussionFeature(featureButton.dataset.postId || "", featureButton.dataset.featured === "1");
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await deleteDiscussionPost(deleteButton.dataset.postId || "");
    return;
  }

  const button = event.target.closest("[data-post-id]");

  if (!button) {
    return;
  }

  const postId = button.dataset.postId || "";

  if (!postId) {
    return;
  }

  await loadDiscussionDetail(postId);
}

async function deleteDiscussionPost(postId) {
  if (!postId || !userState.isLoggedIn) {
    return;
  }

  if (!window.confirm("确认删除这篇帖子？")) {
    return;
  }

  try {
    await callApi(`/discussion/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE"
    });

    discussionState.posts = discussionState.posts.filter((post) => post.id !== postId);

    if (discussionState.activePostId === postId) {
      discussionState.activePostId = "";
      renderDiscussionDetail(null);
      updateDiscussionQuery({
        board: discussionState.activeBoard,
        postId: ""
      });
    }

    renderDiscussionPosts();
    await loadDiscussionPosts({
      autoOpen: false
    });
  } catch (error) {
    window.alert(error.message);
  }
}

async function toggleDiscussionPin(postId, pinned) {
  if (!postId || !userState.isLoggedIn) {
    return;
  }

  try {
    const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: !pinned })
    });

    discussionState.posts = discussionState.posts.map((post) => (
      post.id === postId
        ? { ...post, isPinned: Boolean(payload.isPinned) }
        : post
    ));

    if (discussionState.activePost?.id === postId) {
      discussionState.activePost = {
        ...discussionState.activePost,
        isPinned: Boolean(payload.isPinned)
      };
      renderDiscussionDetail(discussionState.activePost);
    }

    await loadDiscussionPosts({ autoOpen: false });
  } catch (error) {
    window.alert(error.message);
  }
}

async function toggleDiscussionFeature(postId, featured) {
  if (!postId || !userState.isLoggedIn) {
    return;
  }

  try {
    const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/feature`, {
      method: "PATCH",
      body: JSON.stringify({ featured: !featured })
    });

    discussionState.posts = discussionState.posts.map((post) => (
      post.id === postId
        ? { ...post, isFeatured: Boolean(payload.isFeatured) }
        : post
    ));

    if (discussionState.activePost?.id === postId) {
      discussionState.activePost = {
        ...discussionState.activePost,
        isFeatured: Boolean(payload.isFeatured)
      };
      renderDiscussionDetail(discussionState.activePost);
    }

    await loadDiscussionPosts({ autoOpen: false });
  } catch (error) {
    window.alert(error.message);
  }
}

async function editActiveBoardDescription() {
  const board = getActiveDiscussionBoard();

  if (!board || board.slug === "all" || !board.canModerate) {
    return;
  }

  const aboutBox = document.getElementById("discussion-board-about");

  if (!aboutBox || !discussionBoardAboutBody) {
    return;
  }

  if (aboutBox.classList.contains("is-editing")) {
    renderDiscussionBoardAbout();
    return;
  }

  const currentMarkdown = board.descriptionMarkdown || board.description || "";
  aboutBox.classList.add("is-editing");
  discussionBoardEdit.textContent = "取消";
  discussionBoardAboutBody.innerHTML = `
    <div class="discussion-board-edit-grid">
      <textarea class="discussion-board-description-input" rows="7" maxlength="10000">${escapeHtml(currentMarkdown)}</textarea>
      <div class="discussion-board-description-preview discussion-markdown-body"></div>
    </div>
    <div class="discussion-board-edit-actions">
      <p class="discussion-message" id="discussion-board-edit-message"></p>
      <button class="discussion-board-save" type="button" data-action="save-board-description">保存说明</button>
    </div>
  `;

  const input = discussionBoardAboutBody.querySelector(".discussion-board-description-input");
  const preview = discussionBoardAboutBody.querySelector(".discussion-board-description-preview");

  const renderPreview = () => {
    preview.innerHTML = renderMarkdownContent(input.value || "暂无说明。");
    enhanceMarkdownContent(preview);
  };

  input.addEventListener("input", renderPreview);
  renderPreview();
  input.focus();
}

async function saveActiveBoardDescription() {
  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById("discussion-board-about");
  const input = discussionBoardAboutBody?.querySelector(".discussion-board-description-input");
  const message = document.getElementById("discussion-board-edit-message");

  if (!board || !board.canModerate || !input) {
    return;
  }

  const trimmed = input.value.trim();

  if (!trimmed) {
    if (message) {
      message.textContent = "版块说明不能为空";
    }
    return;
  }

  try {
    if (message) {
      message.textContent = "正在保存...";
    }

    const payload = await callApi(`/discussion/boards/${encodeURIComponent(board.slug)}/description`, {
      method: "PATCH",
      body: JSON.stringify({ descriptionMarkdown: trimmed })
    });

    discussionState.boards = discussionState.boards.map((item) => (
      item.slug === board.slug
        ? { ...item, ...(payload.board || {}), canModerate: true }
        : item
    ));
    aboutBox?.classList.remove("is-editing");
    renderDiscussionBoards();
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

function renderModeratorUserRow(user) {
  const title = user.username || user.uid || `用户 ${user.id}`;
  const meta = [
    user.uid ? `uid ${user.uid}` : "",
    user.studentId ? `学号 ${user.studentId}` : "",
    user.email || "",
    user.fullName || ""
  ].filter(Boolean).join(" · ");

  return `
    <article class="discussion-moderator-row" data-user-id="${user.id}">
      <img class="discussion-moderator-avatar" src="${escapeHtml(getAvatarUrl(user.avatarPath))}" alt="${escapeHtml(title)} 的头像" />
      <div class="discussion-moderator-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(meta || "无更多信息")}</span>
      </div>
      <button
        class="discussion-moderator-toggle ${user.isModerator ? "is-active" : ""}"
        type="button"
        data-action="toggle-board-moderator"
        data-user-id="${user.id}"
        data-is-moderator="${user.isModerator ? "1" : "0"}"
      >${user.isModerator ? "移出版主" : "设为版主"}</button>
    </article>
  `;
}

async function loadBoardModeratorList(board) {
  const list = discussionBoardAboutBody?.querySelector("#discussion-moderator-list");
  const message = discussionBoardAboutBody?.querySelector("#discussion-moderator-message");

  if (!list) {
    return;
  }

  try {
    if (message) {
      message.textContent = "正在加载版主名单...";
    }

    const payload = await callApi(`/discussion/boards/${encodeURIComponent(board.slug)}/moderators`, {
      method: "GET"
    });
    const moderators = payload.moderators || [];
    list.innerHTML = moderators.length
      ? moderators.map(renderModeratorUserRow).join("")
      : `<p class="discussion-stats-muted">这个版块还没有单独设置版主。</p>`;

    if (message) {
      message.textContent = "";
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

async function openBoardModeratorsPanel() {
  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById("discussion-board-about");

  if (!board || board.slug === "all" || !board.canManageModerators || !discussionBoardAboutBody) {
    return;
  }

  if (aboutBox?.classList.contains("is-managing-moderators")) {
    renderDiscussionBoardAbout();
    return;
  }

  aboutBox?.classList.remove("is-editing");
  aboutBox?.classList.add("is-managing-moderators");
  if (discussionBoardEdit) {
    discussionBoardEdit.textContent = "编辑";
  }
  if (discussionBoardModerators) {
    discussionBoardModerators.textContent = "关闭名单";
  }

  discussionBoardAboutBody.innerHTML = `
    <div class="discussion-moderator-panel">
      <div class="discussion-moderator-search">
        <input id="discussion-moderator-query" type="search" placeholder="按 uid、学号、用户名、邮箱或姓名搜索" />
        <button class="discussion-board-save" type="button" data-action="search-board-moderator">搜索</button>
      </div>
      <p class="discussion-message" id="discussion-moderator-message"></p>
      <div class="discussion-moderator-results" id="discussion-moderator-results"></div>
      <h3>当前版主</h3>
      <div class="discussion-moderator-list" id="discussion-moderator-list"></div>
    </div>
  `;

  discussionBoardAboutBody.querySelector("#discussion-moderator-query")?.focus();
  await loadBoardModeratorList(board);
}

async function searchBoardModeratorCandidates() {
  const board = getActiveDiscussionBoard();
  const input = discussionBoardAboutBody?.querySelector("#discussion-moderator-query");
  const results = discussionBoardAboutBody?.querySelector("#discussion-moderator-results");
  const message = discussionBoardAboutBody?.querySelector("#discussion-moderator-message");
  const query = input?.value.trim() || "";

  if (!board || !results || !message) {
    return;
  }

  if (query.length < 2) {
    message.textContent = "请输入至少 2 个字符";
    return;
  }

  try {
    message.textContent = "正在搜索...";
    const payload = await callApi(`/discussion/boards/${encodeURIComponent(board.slug)}/moderator-candidates?query=${encodeURIComponent(query)}`, {
      method: "GET"
    });
    const users = payload.users || [];
    results.innerHTML = users.length
      ? users.map(renderModeratorUserRow).join("")
      : `<p class="discussion-stats-muted">没有找到匹配用户。</p>`;
    message.textContent = "";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function toggleBoardModerator(button) {
  const board = getActiveDiscussionBoard();
  const userId = Number(button.dataset.userId || 0);
  const isModerator = button.dataset.isModerator === "1";
  const message = discussionBoardAboutBody?.querySelector("#discussion-moderator-message");

  if (!board || !userId) {
    return;
  }

  button.disabled = true;

  try {
    if (message) {
      message.textContent = "正在更新版主名单...";
    }

    const payload = await callApi(`/discussion/boards/${encodeURIComponent(board.slug)}/moderators/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isModerator: !isModerator })
    });

    button.dataset.isModerator = payload.isModerator ? "1" : "0";
    button.classList.toggle("is-active", Boolean(payload.isModerator));
    button.textContent = payload.isModerator ? "移出版主" : "设为版主";
    await loadBoardModeratorList(board);

    if (message) {
      message.textContent = "版主名单已更新";
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
}

async function handleDiscussionDetailClick(event) {
  const replyButton = event.target.closest("[data-action='reply-comment']");

  if (replyButton) {
    if (!userState.isLoggedIn) {
      openModal("login");
      return;
    }

    const commentId = Number(replyButton.dataset.commentId || 0);
    const authorName = replyButton.dataset.authorName || "这条评论";
    const slot = discussionDetail.querySelector(`[data-reply-slot="${commentId}"]`);

    if (!slot) {
      return;
    }

    if (slot.innerHTML.trim()) {
      slot.innerHTML = "";
      return;
    }

    discussionDetail.querySelectorAll(".discussion-comment-reply-slot").forEach((node) => {
      node.innerHTML = "";
    });
    slot.innerHTML = `
      <form class="discussion-comment-form discussion-reply-form" data-parent-comment-id="${commentId}">
        <textarea class="discussion-comment-input" rows="3" maxlength="5000" placeholder="回复 ${escapeHtml(authorName)}，支持 Markdown 和 KaTeX"></textarea>
        <div class="discussion-compose-actions">
          <p class="discussion-message discussion-comment-message"></p>
          <button class="auth-submit discussion-submit" type="submit">发布回复</button>
        </div>
      </form>
    `;
    slot.querySelector("textarea")?.focus();
    return;
  }

  const likeButton = event.target.closest("[data-action='toggle-reaction']");

  if (likeButton) {
    await toggleDiscussionReaction(likeButton.dataset.postId || "", likeButton.dataset.reactionType || "smile");
    return;
  }

  const pinButton = event.target.closest("[data-action='toggle-pin']");

  if (pinButton) {
    await toggleDiscussionPin(pinButton.dataset.postId || "", pinButton.dataset.pinned === "1");
    return;
  }

  const featureButton = event.target.closest("[data-action='toggle-feature']");

  if (featureButton) {
    await toggleDiscussionFeature(featureButton.dataset.postId || "", featureButton.dataset.featured === "1");
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    await deleteDiscussionPost(deleteButton.dataset.postId || "");
    return;
  }

  const button = event.target.closest("[data-action='close-detail']");

  if (!button) {
    return;
  }

  discussionState.activePostId = "";
  renderDiscussionPosts();
  renderDiscussionDetail(null);
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: ""
  });
}

async function handleDiscussionCommentSubmit(event) {
  const form = event.target.closest(".discussion-comment-form");

  if (!form || !discussionState.activePostId) {
    return;
  }

  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  const input = form.querySelector(".discussion-comment-input");
  const message = form.querySelector(".discussion-comment-message");
  const parentCommentId = Number(form.dataset.parentCommentId || 0);
  const contentMarkdown = input?.value.trim() || "";

  if (message) {
    message.textContent = parentCommentId ? "正在发布回复..." : "正在发布评论...";
  }

  try {
    const payload = await callApi(`/discussion/posts/${encodeURIComponent(discussionState.activePostId)}/comments`, {
      method: "POST",
      body: JSON.stringify({
        contentMarkdown,
        parentCommentId: parentCommentId || undefined
      })
    });

    const baselineCommentCount = discussionState.comments.length;
    const newComments = [payload.comment].filter(Boolean);
    discussionState.comments = [...discussionState.comments, ...newComments];
    const addedCommentCount = newComments.length;
    if (discussionState.activePost) {
      discussionState.activePost.commentCount = Number(discussionState.activePost.commentCount || 0) + addedCommentCount;
    }
    discussionState.posts = discussionState.posts.map((post) => (
      post.id === discussionState.activePostId
        ? {
            ...post,
            commentCount: Number(post.commentCount || 0) + addedCommentCount
          }
        : post
    ));
    input.value = "";
    if (message) {
      message.textContent = payload.message || (parentCommentId ? "回复已发布" : "评论已发布");
    }
    renderDiscussionComments();
    renderDiscussionPosts();
    if (payload.maxPending || shouldWaitForMaxReply(contentMarkdown)) {
      pollDiscussionCommentsForMax(discussionState.activePostId, baselineCommentCount + addedCommentCount, message);
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

async function handleDiscussionCreateToggle() {
  if (!discussionComposeForm) {
    return;
  }

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (discussionState.isFallback) {
    setDiscussionMessage("正在重新连接讨论后端...");
    await loadDiscussionBoards();

    if (discussionState.isFallback) {
      setDiscussionMessage("讨论后端暂不可用，请确认后端已启动并刷新重试");
      return;
    }

    setDiscussionMessage("");
  }

  discussionComposeForm.classList.toggle("hidden");
  if (!discussionComposeForm.classList.contains("hidden")) {
    discussionComposeTitle?.focus();
  }
}

async function handleDiscussionComposeSubmit(event) {
  if (!discussionComposeForm) {
    return;
  }

  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  if (discussionState.isFallback) {
    setDiscussionMessage("讨论后端暂不可用，无法发布帖子");
    return;
  }

  setDiscussionMessage("正在发布帖子...");

  try {
    const payload = await callApi("/discussion/posts", {
      method: "POST",
      body: JSON.stringify({
        boardSlug: discussionComposeBoard.value,
        title: discussionComposeTitle.value.trim(),
        contentMarkdown: discussionComposeContent.value
      })
    });

    setDiscussionMessage(payload.message || "帖子发布成功");
    discussionComposeForm.reset();
    discussionComposeForm.classList.add("hidden");
    discussionState.activeBoard = payload.post.board.slug;
    discussionState.activePostId = payload.post.id;
    await loadDiscussionPosts({
      autoOpen: false
    });
    renderDiscussionDetail(payload.post);
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId
    });
  } catch (error) {
    setDiscussionMessage(error.message);
    discussionComposeForm.classList.remove("hidden");
  }
}

function insertTextAtTextarea(textarea, text) {
  if (!textarea) {
    return;
  }

  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n" : "";
  textarea.value = `${before}${prefix}${text}${suffix}${after}`;
  const cursor = before.length + prefix.length + text.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
}

async function resizeImageFileToWebp(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const readOriginalFile = () => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

  let source;

  try {
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("读取图片失败"));
        };
        image.src = objectUrl;
      });
    }
  } catch {
    return readOriginalFile();
  }

  if (!source?.width || !source?.height) {
    return readOriginalFile();
  }

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    source.close?.();
    return readOriginalFile();
  }

  context.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/webp", 0.82);
  });

  if (!blob || !blob.type || blob.type.toLowerCase() !== "image/webp") {
    return readOriginalFile();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function uploadDiscussionImage(file) {
  if (!userState.isLoggedIn) {
    openModal("login");
    return "";
  }

  setDiscussionMessage(`正在处理图片：${file.name || "image"}`);
  const imageDataUrl = await resizeImageFileToWebp(file);
  setDiscussionMessage(`正在上传图片：${file.name || "image"}`);
  const payload = await callApi("/discussion/uploads/images", {
    method: "POST",
    body: JSON.stringify({ imageDataUrl })
  });

  return payload.url || "";
}

async function insertDiscussionImages(files) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));

  if (!imageFiles.length) {
    return;
  }

  try {
    for (const file of imageFiles) {
      const url = await uploadDiscussionImage(file);

      if (url) {
        insertTextAtTextarea(discussionComposeContent, `![${file.name ? file.name.replace(/\.[^.]+$/, "") : "图片"}](${getAvatarUrl(url)})`);
      }
    }

    setDiscussionMessage("图片已插入正文");
  } catch (error) {
    setDiscussionMessage(error.message);
  }
}

async function handleDiscussionPaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));

  if (!files.length) {
    return;
  }

  event.preventDefault();
  await insertDiscussionImages(files);
}

async function writeClipboardText(text) {
  await navigator.clipboard.writeText(String(text || ""));
}

async function writeClipboardHtml(html, text) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })
    ]);
    return;
  }

  await writeClipboardText(text);
}

function markdownToPlainText(markdown) {
  return String(markdown || "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => `\n${code.trimEnd()}\n`)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

function hasCjkText(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function normalizeWordStrongSpacing(root) {
  root.querySelectorAll("strong, b").forEach((strong) => {
    strong.textContent = strong.textContent.trim();

    const previous = strong.previousSibling;
    if (
      previous?.nodeType === Node.TEXT_NODE &&
      /\s$/.test(previous.textContent || "") &&
      hasCjkText(`${previous.textContent}${strong.textContent}`)
    ) {
      previous.textContent = previous.textContent.replace(/\s+$/, "");
    }

    const next = strong.nextSibling;
    if (
      next?.nodeType === Node.TEXT_NODE &&
      /^\s/.test(next.textContent || "") &&
      hasCjkText(`${strong.textContent}${next.textContent}`)
    ) {
      next.textContent = next.textContent.replace(/^\s+/, "");
    }
  });
}

function applyWordThreeLineTables(root) {
  root.querySelectorAll("table").forEach((table) => {
    table.setAttribute("width", "100%");
    table.setAttribute("style", "border-collapse:collapse;width:100%;margin:8pt 0;border-top:1.5pt solid #000;border-bottom:1.5pt solid #000;mso-table-lspace:0pt;mso-table-rspace:0pt;");

    table.querySelectorAll("th, td").forEach((cell) => {
      cell.setAttribute("style", "padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:0;vertical-align:top;");
    });

    const headerCells = table.querySelectorAll("thead th");
    headerCells.forEach((cell) => {
      cell.setAttribute("style", "padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:1pt solid #000;vertical-align:top;font-weight:bold;");
    });

    if (!headerCells.length) {
      table.querySelectorAll("tr:first-child th, tr:first-child td").forEach((cell) => {
        cell.setAttribute("style", "padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:1pt solid #000;vertical-align:top;font-weight:bold;");
      });
    }
  });
}

function buildWordHighlightedCodeNodes(code, rawText) {
  return buildWordHighlightedCodeNodesForLanguage(getCodeBlockLanguage(code), rawText);
}

function buildWordHighlightedCodeNodesForLanguage(language, rawText) {
  const highlighter = window.hljs;

  if (language && highlighter?.highlight && highlighter.getLanguage?.(language)) {
    const template = document.createElement("template");
    template.innerHTML = highlighter.highlight(String(rawText || ""), {
      language,
      ignoreIllegals: true
    }).value;
    return Array.from(template.content.childNodes);
  }

  return [document.createTextNode(String(rawText || ""))];
}

function appendWordCodeWithBreaks(cell, nodes) {
  const appendTextWithBreaks = (text) => {
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
      if (index) {
        cell.append(document.createElement("br"));
      }
      const chunks = String(line || " ").match(/.{1,72}/g) || [" "];
      chunks.forEach((chunk, chunkIndex) => {
        if (chunkIndex) {
          cell.append(document.createElement("wbr"));
        }
        cell.append(document.createTextNode(chunk));
      });
    });
  };

  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendTextWithBreaks(node.textContent);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const span = document.createElement("span");
    span.className = node.className || "";
    span.innerHTML = "";
    appendWordCodeWithBreaks(span, Array.from(node.childNodes));
    cell.append(span);
  });
}

function createWordCodeTable(text, language = "") {
  const table = document.createElement("table");
  table.setAttribute("width", "100%");
  table.setAttribute("border", "1");
  table.setAttribute("cellspacing", "0");
  table.setAttribute("cellpadding", "0");
  table.setAttribute("style", "border-collapse:collapse;width:100%;max-width:100%;table-layout:fixed;margin:8pt 0;mso-width-percent:1000;mso-table-lspace:0pt;mso-table-rspace:0pt;border:1pt solid #8a8f98;mso-border-alt:solid #8a8f98 .75pt;");
  table.innerHTML = `
    <colgroup>
      <col width="100%" style="width:100%;" />
    </colgroup>
    <tbody>
      <tr>
        <td width="100%" style="width:100%;max-width:100%;border:1pt solid #8a8f98;mso-border-alt:solid #8a8f98 .75pt;padding:8pt;background:transparent;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;line-height:1.35;word-break:break-word;word-wrap:break-word;overflow-wrap:break-word;"></td>
      </tr>
    </tbody>
  `;
  appendWordCodeWithBreaks(
    table.querySelector("td"),
    buildWordHighlightedCodeNodesForLanguage(normalizeCodeLanguageName(language), text)
  );
  return table;
}

function buildWordDocumentHtml(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body,p,li,td,th{font-family:"Times New Roman",SimSun,serif;mso-ascii-font-family:"Times New Roman";mso-hansi-font-family:"Times New Roman";mso-fareast-font-family:SimSun;} strong,b{font-weight:bold;}.hljs-keyword,.hljs-selector-tag,.hljs-built_in{color:#cf222e;}.hljs-title,.hljs-title.function_{color:#8250df;}.hljs-string,.hljs-attr{color:#0a3069;}.hljs-number,.hljs-literal{color:#0550ae;}.hljs-comment{color:#6e7781;font-style:italic;}.hljs-meta,.hljs-preprocessor{color:#953800;}.hljs-type,.hljs-class .hljs-title{color:#116329;}</style></head><body style="font-family:'Times New Roman',SimSun,serif;mso-ascii-font-family:'Times New Roman';mso-hansi-font-family:'Times New Roman';mso-fareast-font-family:SimSun;font-size:11pt;line-height:1.55;">${bodyHtml}</body></html>`;
}

function buildWordHtmlFromMarkdown(markdown) {
  const template = document.createElement("template");
  template.innerHTML = renderMarkdownContent(markdown);
  normalizeWordStrongSpacing(template.content);
  applyWordThreeLineTables(template.content);

  template.content.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const text = code?.textContent || pre.textContent || "";
    pre.replaceWith(createWordCodeTable(text, getCodeBlockLanguage(code)));
  });

  template.content.querySelectorAll("code").forEach((code) => {
    code.setAttribute("style", "font-family:Consolas,'Courier New',monospace;background:transparent;padding:0;");
  });

  return buildWordDocumentHtml(template.innerHTML);
}

function escapeLatexText(value) {
  return String(value || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%#_{}])/g, "\\$1")
    .replace(/\$/g, "\\$")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeLatexInline(value) {
  return String(value || "")
    .split(/(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$)/g)
    .map((part) => {
      if (/^\$\$[\s\S]+\$\$$/.test(part) || /^\$[^\n$]+\$$/.test(part)) {
        return part;
      }

      return escapeLatexText(part)
        .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
        .replace(/\*([^*]+)\*/g, "\\emph{$1}")
        .replace(/`([^`]+)`/g, "\\texttt{$1}")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 (\\url{$2})");
    })
    .join("");
}

function latexListingLanguage(language) {
  const normalized = normalizeCodeLanguageName(language);

  if (normalized === "python") {
    return "Python";
  }

  if (normalized === "java") {
    return "Java";
  }

  if (normalized === "c") {
    return "C";
  }

  if (normalized === "cpp") {
    return "C++";
  }

  if (normalized === "matlab") {
    return "Matlab";
  }

  return "";
}

function markdownToLatexBody(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const output = [];
  let inCode = false;
  let codeLanguage = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      output.push("\\end{itemize}");
      inList = false;
    }
  };

  lines.forEach((line) => {
    const fence = line.match(/^```([^\s`]*)/);

    if (fence) {
      if (inCode) {
        output.push("\\end{lstlisting}");
        inCode = false;
        codeLanguage = "";
      } else {
        closeList();
        codeLanguage = latexListingLanguage(fence[1]);
        output.push(`\\begin{lstlisting}${codeLanguage ? `[language=${codeLanguage}]` : ""}`);
        inCode = true;
      }
      return;
    }

    if (inCode) {
      output.push(line);
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const command = heading[1].length === 1 ? "section" : heading[1].length === 2 ? "subsection" : "subsubsection";
      output.push(`\\${command}{${escapeLatexInline(heading[2])}}`);
      return;
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        output.push("\\begin{itemize}");
        inList = true;
      }
      output.push(`\\item ${escapeLatexInline(listItem[1])}`);
      return;
    }

    closeList();

    if (!line.trim()) {
      output.push("");
      return;
    }

    output.push(escapeLatexInline(line.replace(/^>\s?/, "")));
  });

  if (inCode) {
    output.push("\\end{lstlisting}");
  }
  closeList();
  return output.join("\n");
}

function buildLatexDocument(markdown) {
  const author = userState.username || userState.fullName || "FREE-BBS 用户";

  return `\\documentclass[UTF8]{ctexart}
\\usepackage{amsmath,amssymb}
\\usepackage{xcolor}
\\usepackage{hyperref}
\\usepackage{listings}
\\lstset{
  basicstyle=\\ttfamily\\small,
  breaklines=true,
  frame=single,
  columns=fullflexible
}
\\title{Max 回复}
\\author{${escapeLatexText(author)}}
\\date{\\today}

\\begin{document}
\\maketitle

${markdownToLatexBody(markdown)}

\\end{document}
`;
}

function closeAiCopyMenus(exceptMenu = null) {
  document.querySelectorAll(".aichat-copy-menu").forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.add("hidden");
    }
  });
}

function closeCodeCopyMenus(exceptMenu = null) {
  document.querySelectorAll(".code-copy-menu").forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.add("hidden");
    }
  });
}

function buildCodeLatexListing(code, language = "") {
  const listingLanguage = latexListingLanguage(language);
  return `\\begin{lstlisting}${listingLanguage ? `[language=${listingLanguage}]` : ""}
${String(code || "").replace(/\\end\{lstlisting\}/g, "\\end {lstlisting}")}
\\end{lstlisting}
`;
}

function buildCodeWordHtml(code, language = "") {
  const container = document.createElement("div");
  container.append(createWordCodeTable(code, language));
  return buildWordDocumentHtml(container.innerHTML);
}

async function copyCodeText(code, language, format) {
  if (format === "latex") {
    await writeClipboardText(buildCodeLatexListing(code, language));
    return;
  }

  if (format === "word") {
    await writeClipboardHtml(buildCodeWordHtml(code, language), code);
    return;
  }

  await writeClipboardText(code);
}

async function copyAiMessage(article, format) {
  const markdown = article?.dataset.markdown || "";

  if (format === "markdown") {
    await writeClipboardText(markdown);
    return;
  }

  if (format === "word") {
    await writeClipboardHtml(buildWordHtmlFromMarkdown(markdown), markdownToPlainText(markdown));
    return;
  }

  if (format === "latex") {
    await writeClipboardText(buildLatexDocument(markdown));
    return;
  }

  await writeClipboardText(markdownToPlainText(markdown));
}

async function handleAiMessageCopyClick(event) {
  const toggle = event.target.closest("[data-action='toggle-ai-copy-menu']");

  if (toggle) {
    const menu = toggle.closest(".aichat-copy-control")?.querySelector(".aichat-copy-menu");
    if (!menu) {
      return;
    }

    const isHidden = menu.classList.contains("hidden");
    closeAiCopyMenus(menu);
    menu.classList.toggle("hidden", !isHidden);
    event.stopPropagation();
    return;
  }

  const option = event.target.closest("[data-action='copy-ai-message']");

  if (!option) {
    closeAiCopyMenus();
    return;
  }

  const article = option.closest(".aichat-message-assistant");
  const button = article?.querySelector(".aichat-copy-button");
  const originalTitle = button?.title || "复制";

  try {
    const format = option.dataset.copyFormat;
    await copyAiMessage(article, format);
    showCopySuccessPopup(format);
    if (button) {
      button.title = "已复制";
      window.setTimeout(() => {
        button.title = originalTitle;
      }, 1200);
    }
  } catch {
    if (button) {
      button.title = "复制失败";
      window.setTimeout(() => {
        button.title = originalTitle;
      }, 1200);
    }
  } finally {
    closeAiCopyMenus();
  }
}

async function handleCodeCopyClick(event) {
  const toggle = event.target.closest("[data-action='toggle-code-copy-menu']");

  if (toggle) {
    const menu = toggle.parentElement?.querySelector(".code-copy-menu");
    if (!menu) {
      return;
    }

    const isHidden = menu.classList.contains("hidden");
    closeCodeCopyMenus(menu);
    menu.classList.toggle("hidden", !isHidden);
    event.stopPropagation();
    return;
  }

  const option = event.target.closest("[data-action='copy-code']");

  if (!option) {
    closeCodeCopyMenus();
    return;
  }

  const container = option.closest("pre, .code-run-result");
  const button = container?.querySelector("[data-action='toggle-code-copy-menu']");
  const code = button?.dataset.code || "";
  const language = button?.dataset.language || "";
  const originalTitle = button?.title || "复制代码";

  try {
    const format = option.dataset.copyFormat;
    await copyCodeText(code, language, format);
    showCopySuccessPopup(format);
    if (button) {
      button.title = "已复制";
    }
    window.setTimeout(() => {
      if (button) {
        button.title = originalTitle;
      }
    }, 1200);
  } catch {
    if (button) {
      button.title = "复制失败";
    }
    window.setTimeout(() => {
      if (button) {
        button.title = originalTitle;
      }
    }, 1200);
  } finally {
    closeCodeCopyMenus();
  }
}

function isImageOutputFile(file) {
  return /\.(?:png|jpg|jpeg|webp|gif)(?:$|\?)/i.test(String(file || ""));
}

function revokeCodeRunObjectUrls(result) {
  result?.querySelectorAll("img[data-object-url]").forEach((image) => {
    URL.revokeObjectURL(image.dataset.objectUrl);
  });
}

function addCodeRunResultCopyControls(result, text) {
  const copyButton = document.createElement("button");
  copyButton.className = "code-result-copy-button";
  copyButton.type = "button";
  copyButton.dataset.action = "toggle-code-copy-menu";
  copyButton.dataset.code = String(text || "");
  copyButton.dataset.language = "";
  copyButton.title = "复制运行结果";
  copyButton.setAttribute("aria-label", "复制运行结果");
  copyButton.innerHTML = `<img src="/assets/icons/copy.svg" alt="" aria-hidden="true" />`;
  result.append(copyButton);
  result.append(createCodeCopyMenu());
}

async function loadAuthenticatedCodeRunImage(image, file) {
  try {
    const response = await fetch(`${API_ROOT}${file}`, {
      headers: {
        ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {})
      }
    });

    if (!response.ok) {
      throw new Error("图片加载失败");
    }

    const objectUrl = URL.createObjectURL(await response.blob());
    image.dataset.objectUrl = objectUrl;
    image.src = objectUrl;
  } catch (error) {
    image.replaceWith(Object.assign(document.createElement("p"), {
      className: "code-run-image-error",
      textContent: error.message
    }));
  }
}

function renderCodeRunResult(result, payload) {
  revokeCodeRunObjectUrls(result);
  result.innerHTML = "";

  const stdout = String(payload?.stdout || "");
  const stderr = String(payload?.stderr || "");
  const files = (Array.isArray(payload?.files) ? payload.files : []).filter(isImageOutputFile);
  const exitCode = Number(payload?.exit_code ?? payload?.exitCode ?? 0);
  const isSuccess = Number.isFinite(exitCode) && exitCode === 0 && !stderr;
  const output = [
    stdout ? `stdout:\n${stdout.trimEnd()}` : "",
    stderr ? `stderr:\n${stderr.trimEnd()}` : ""
  ].filter(Boolean).join("\n\n") || (isSuccess ? "" : `代码执行结束，exit code: ${payload?.exit_code ?? "unknown"}`);
  result.classList.toggle("is-code-run-success", isSuccess);
  result.classList.toggle("is-code-run-error", !isSuccess);
  const copyText = output.trimEnd();
  addCodeRunResultCopyControls(result, copyText);

  [
    ["stdout", stdout],
    ["stderr", stderr]
  ].forEach(([label, value]) => {
    if (!value) {
      return;
    }

    const block = document.createElement("div");
    block.className = "code-run-output-block";
    block.innerHTML = `<span class="code-run-output-label">${label}</span>`;
    const text = document.createElement("pre");
    text.className = "code-run-result-text";
    text.textContent = String(value).trimEnd();
    block.append(text);
    result.append(block);
  });

  if (!stdout && !stderr && !isSuccess) {
    const block = document.createElement("div");
    block.className = "code-run-output-block";
    const text = document.createElement("pre");
    text.className = "code-run-result-text";
    text.textContent = output;
    block.append(text);
    result.append(block);
  }

  if (files.length) {
    const gallery = document.createElement("div");
    gallery.className = "code-run-gallery";

    files.forEach((file) => {
      const image = document.createElement("img");
      image.alt = "代码生成的图片";
      image.loading = "lazy";
      image.decoding = "async";
      gallery.append(image);
      loadAuthenticatedCodeRunImage(image, file);
    });

    result.append(gallery);
  }
}

async function handleCodeRunClick(event) {
  const button = event.target.closest("[data-action='run-code']");

  if (!button) {
    return;
  }

  const pre = button.closest("pre");
  let result = pre?.nextElementSibling?.classList?.contains("code-run-result")
    ? pre.nextElementSibling
    : null;

  if (!result) {
    result = document.createElement("div");
    result.className = "code-run-result";
    pre?.after(result);
  }

  button.disabled = true;
  button.title = "运行中";
  result.textContent = "正在执行代码...";

  try {
    const payload = await callApi("/code/run", {
      method: "POST",
      body: JSON.stringify({
        language: button.dataset.language,
        code: button.dataset.code || "",
        timeout: 10
      })
    });
    renderCodeRunResult(result, payload);
  } catch (error) {
    const message = error.message;
    result.innerHTML = "";
    result.classList.remove("is-code-run-success");
    result.classList.add("is-code-run-error");
    addCodeRunResultCopyControls(result, message);
    result.append(Object.assign(document.createElement("pre"), {
      className: "code-run-result-text",
      textContent: error.message
    }));
  } finally {
    button.disabled = false;
    button.title = "运行代码";
  }
}

function initializeLandingMotion() {
  const landingMain = document.querySelector(".landing-main");
  if (!landingMain) {
    return;
  }

  const revealSelectors = [
    ".landing-hero .hero-copy > *",
    ".landing-hero .hero-visual",
    ".landing-bridge",
    ".landing-section-copy > *",
    ".landing-mission-path article",
    ".landing-product-card",
    ".landing-roadmap-track article"
  ];
  const revealElements = document.querySelectorAll(revealSelectors.join(","));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  revealElements.forEach((element, index) => {
    element.classList.add("landing-reveal");
    element.style.setProperty("--reveal-index", String(index % 6));

    if (prefersReducedMotion) {
      element.classList.add("is-visible");
    }
  });

  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.16
      }
    );

    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }

  document.querySelectorAll(".landing-product-card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });
  });
}

userName.addEventListener("click", handleAuthEntry);
userSettingsButton?.addEventListener("click", handleUserSettingsClick);
userLogoutButton?.addEventListener("click", handleUserLogoutClick);
fortuneLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openFortuneModal();
  });
});
adminAddUserButton?.addEventListener("click", insertAdminDraftRow);
adminUsers?.addEventListener("click", handleAdminUsersClick);
fortuneBonusToggle?.addEventListener("change", handleFortuneBonusToggle);
settingsForm?.addEventListener("submit", handleSettingsSubmit);
settingsPasswordForm?.addEventListener("submit", handleSettingsPasswordSubmit);
settingsAvatarInput?.addEventListener("change", handleAvatarUpload);
settingsLogoutButton?.addEventListener("click", handleSettingsLogout);
discussionBoardList?.addEventListener("click", (event) => {
  handleDiscussionBoardClick(event);
});
discussionPostList?.addEventListener("click", (event) => {
  handleDiscussionPostClick(event);
});
discussionDetail?.addEventListener("click", handleDiscussionDetailClick);
discussionDetail?.addEventListener("submit", handleDiscussionCommentSubmit);
discussionCreateToggle?.addEventListener("click", handleDiscussionCreateToggle);
discussionComposeForm?.addEventListener("submit", handleDiscussionComposeSubmit);
discussionBoardEdit?.addEventListener("click", editActiveBoardDescription);
discussionBoardModerators?.addEventListener("click", openBoardModeratorsPanel);
discussionBoardAboutBody?.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='save-board-description']")) {
    saveActiveBoardDescription();
    return;
  }

  if (event.target.closest("[data-action='search-board-moderator']")) {
    searchBoardModeratorCandidates();
    return;
  }

  const moderatorToggle = event.target.closest("[data-action='toggle-board-moderator']");
  if (moderatorToggle) {
    toggleBoardModerator(moderatorToggle);
  }
});
discussionBoardAboutBody?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.closest("#discussion-moderator-query")) {
    event.preventDefault();
    searchBoardModeratorCandidates();
  }
});
discussionInsertImage?.addEventListener("click", () => discussionImageInput?.click());
discussionImageInput?.addEventListener("change", async (event) => {
  await insertDiscussionImages(event.target.files);
  event.target.value = "";
});
discussionComposeContent?.addEventListener("paste", handleDiscussionPaste);
document.addEventListener("click", handleCodeCopyClick);
document.addEventListener("click", handleCodeRunClick);
document.addEventListener("click", handleAiMessageCopyClick);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.getElementById("fortune-modal")?.classList.add("hidden");
    closeAiCopyMenus();
    closeCodeCopyMenus();
  }
});
renderUser();
loadFortuneConfig();
restoreSession();
renderAdminSection();
renderSettingsForm();
renderDiscussionComposerState();
loadHomeDiscussionPosts();
initializeLandingMotion();
initializeDiscussionPage();
initializeAiChatPage();
loadPublicProfile();
