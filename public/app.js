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
const DEFAULT_AVATAR = "./assets/avatar_placeholder.png";

const STORAGE_KEY = "free_bbs_auth_token";
const userState = {
  isLoggedIn: false,
  token: localStorage.getItem(STORAGE_KEY) || "",
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
const avatarButton = document.querySelector(".avatar");
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
const discussionStatsPosts = document.getElementById("discussion-stats-posts");
const discussionStatsLikes = document.getElementById("discussion-stats-likes");
const discussionState = {
  boards: [],
  posts: [],
  activeBoard: "all",
  activePostId: 0,
  isFallback: false,
  activePost: null,
  comments: []
};
const FALLBACK_DISCUSSION_BOARDS = [
  {
    id: -1,
    slug: "daily",
    name: "日常",
    description: "本地测试版块",
    sortOrder: 10
  }
];
const FALLBACK_DISCUSSION_POST = {
  id: -1,
  title: "测试帖子",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  board: {
    slug: "daily",
    name: "日常"
  },
  author: {
    id: -1,
    username: "admin",
    fullName: "管理员",
    displayName: "管理员",
    studentId: "0000000000",
    avatarPath: ""
  },
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
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

function getAvatarUrl(avatarPath) {
  return avatarPath ? `${API_ROOT}${avatarPath}` : DEFAULT_AVATAR;
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashFortuneSeed(seed) {
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0);
}

function getFortuneResult() {
  const score =
    (hashFortuneSeed(`${userState.studentId}-${getTodayKey()}`) % 101) +
    (userState.fortuneBonusEnabled ? 20 : 0);

  if (score >= 90) {
    return {
      score,
      date: getTodayKey(),
      label: "大吉",
      colorClass: "fortune-great",
      colorName: "金色",
      tagline: "Absolute legend 🤩"
    };
  }

  if (score >= 50) {
    return {
      score,
      date: getTodayKey(),
      label: "吉",
      colorClass: "fortune-good",
      colorName: "红色",
      tagline: "闭眼写，随手推"
    };
  }

  if (score >= 20) {
    return {
      score,
      date: getTodayKey(),
      label: "平",
      colorClass: "fortune-neutral",
      colorName: "白色",
      tagline: "人生是个泊松过程，一时的等待是为了下一次跳跃"
    };
  }

  if (score >= 3) {
    return {
      score,
      date: getTodayKey(),
      label: "凶",
      colorClass: "fortune-bad",
      colorName: "绿色",
      tagline: "六根清净方为稻，退步原来是向前"
    };
  }

  return {
    score,
    date: getTodayKey(),
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
      <p class="fortune-tagline" id="fortune-tagline"></p>
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

function openFortuneModal() {
  if (!userState.isLoggedIn || !userState.studentId) {
    return;
  }

  const modal = ensureFortuneModal();
  const result = getFortuneResult();
  const badge = modal.querySelector("#fortune-badge");
  const date = modal.querySelector("#fortune-date");
  const tagline = modal.querySelector("#fortune-tagline");

  badge.className = `fortune-badge ${result.colorClass}`;
  badge.textContent = result.label;
  date.textContent = result.date;
  tagline.textContent = result.tagline;
  modal.classList.remove("hidden");
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
    renderDiscussionComposerState();
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

function setDiscussionMessage(message) {
  if (discussionComposeMessage) {
    discussionComposeMessage.textContent = message || "";
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
  userState.studentId = user.studentId || "";
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
  userState.studentId = "";
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
  return window.location.pathname.endsWith("/settings.html");
}

function isAdminUsersPage() {
  return window.location.pathname.endsWith("/adminusers.html");
}

function isDiscussionPage() {
  return window.location.pathname.endsWith("/discussion.html");
}

function isPublicProfilePage() {
  return window.location.pathname.endsWith("/profile.html");
}

function getProfileStudentIdFromQuery() {
  return String(new URLSearchParams(window.location.search).get("studentId") || "").trim();
}

function isValidPublicStudentId(studentId) {
  return /^20\d{8}$/.test(String(studentId || "").trim());
}

function getProfileHref(studentId) {
  if (!isValidPublicStudentId(studentId)) {
    return "";
  }

  return `./profile.html?studentId=${encodeURIComponent(studentId)}`;
}

function renderAuthorProfileLink(author, className, includeAvatar = false) {
  const displayName = escapeHtml(author?.displayName || author?.fullName || author?.username || "匿名用户");
  const profileHref = getProfileHref(author?.studentId);

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
    postId: Number(params.get("post") || 0)
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
    <a class="home-discussion-item" href="./discussion.html?post=${post.id}">
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
}

function renderDiscussionComposeBoards() {
  if (!discussionComposeBoard) {
    return;
  }

  discussionComposeBoard.innerHTML = discussionState.boards.map((board) => `
    <option value="${board.slug}">${escapeHtml(board.name)}</option>
  `).join("");

  const preferredBoard =
    discussionState.activeBoard !== "all" &&
    discussionState.boards.some((board) => board.slug === discussionState.activeBoard)
      ? discussionState.activeBoard
      : discussionState.boards[0]?.slug;

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
      data-post-id="${post.id}"
    >
      <div class="discussion-post-author">
        ${renderAuthorProfileLink(post.author, "discussion-author-link discussion-author-link-avatar", true)}
        <button class="discussion-like-button ${post.likedByMe ? "is-liked" : ""}" type="button" data-action="toggle-like" data-post-id="${post.id}" aria-label="点赞">
          <span aria-hidden="true">▲</span>
          <strong>${post.likeCount || 0}</strong>
        </button>
      </div>
      <div class="discussion-post-card-main">
        <div class="discussion-post-source">
          <span class="discussion-post-board">r/${escapeHtml(post.board.name)}</span>
          ${renderAuthorProfileLink(post.author, "discussion-author-link")}
          <span>${escapeHtml(formatDateOnly(post.createdAt))}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <div class="discussion-post-actions" aria-hidden="true">
          <span>${post.commentCount || 0} 条评论</span>
          <span>${post.likeCount || 0} 个赞</span>
          ${userState.role === "admin" ? `<span class="discussion-delete-action" data-action="delete-post" data-post-id="${post.id}">删除</span>` : ""}
        </div>
      </div>
      <span class="discussion-post-open" aria-hidden="true">↗</span>
    </article>
  `).join("");
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

  const safeMarkdown = escapeHtml(protectedMarkdown);
  const renderedMarkdown = window.marked?.parse
    ? window.marked.parse(safeMarkdown, {
        gfm: true,
        breaks: true
      })
    : safeMarkdown.replace(/\n/g, "<br />");

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

  return renderedMarkdown
    .replace(new RegExp(`<p>\\s*${placeholderPrefix}(\\d+)\\s*</p>`, "g"), renderMathBlock)
    .replace(new RegExp(`${placeholderPrefix}(\\d+)`, "g"), renderMathBlock);
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

  list.innerHTML = discussionState.comments.map((comment) => `
    <article class="discussion-comment">
      ${renderAuthorProfileLink(comment.author, "discussion-comment-author-link", true)}
      <div class="discussion-comment-body">
        <div class="discussion-comment-meta">
          ${renderAuthorProfileLink(comment.author, "discussion-author-link")}
          <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
        </div>
        <div class="discussion-comment-content">${renderMarkdownContent(comment.contentMarkdown)}</div>
      </div>
    </article>
  `).join("");

  list.querySelectorAll(".discussion-comment-content").forEach((node) => applyMathRendering(node));
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
        <button class="discussion-detail-back" type="button" data-action="close-detail">返回帖子列表</button>
        ${userState.role === "admin" ? `<button class="discussion-detail-delete" type="button" data-action="delete-post" data-post-id="${post.id}">删除帖子</button>` : ""}
      </div>
      <span class="discussion-post-board">${escapeHtml(post.board.name)}</span>
      <h2>${escapeHtml(post.title)}</h2>
      <div class="discussion-detail-meta">
        ${renderAuthorProfileLink(post.author, "discussion-author-link")}
        <span>${escapeHtml(formatDateTime(post.createdAt))}</span>
        <button class="discussion-detail-like ${post.likedByMe ? "is-liked" : ""}" type="button" data-action="toggle-like" data-post-id="${post.id}">${post.likeCount || 0} 赞</button>
        <span>${post.commentCount || 0} 条评论</span>
      </div>
    </header>
    <div class="discussion-markdown-body" id="discussion-markdown-body">${renderMarkdownContent(post.contentMarkdown)}</div>
    <section class="discussion-comments" aria-label="评论">
      <div class="discussion-comments-head">
        <h3>评论</h3>
      </div>
      <form class="discussion-comment-form" id="discussion-comment-form">
        <textarea id="discussion-comment-input" rows="4" maxlength="5000" placeholder="写一条评论，支持 Markdown 和 KaTeX"></textarea>
        <div class="discussion-compose-actions">
          <p class="discussion-message" id="discussion-comment-message"></p>
          <button class="auth-submit discussion-submit" type="submit">发表评论</button>
        </div>
      </form>
      <div class="discussion-comment-list" id="discussion-comment-list">
        <p class="discussion-stats-muted">正在加载评论...</p>
      </div>
    </section>
  `;

  const markdownBody = document.getElementById("discussion-markdown-body");
  applyMathRendering(markdownBody);
  markdownBody?.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noreferrer";
  });
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
    const payload = await callApi(`/discussion/posts/${postId}/comments`, {
      method: "GET"
    });
    discussionState.comments = payload.comments || [];
  } catch {
    discussionState.comments = [];
  }

  renderDiscussionComments();
}

function updatePostReactionState(postId, liked, likeCount) {
  discussionState.posts = discussionState.posts.map((post) => (
    post.id === postId
      ? {
          ...post,
          likedByMe: liked,
          likeCount
        }
      : post
  ));

  if (discussionState.activePost?.id === postId) {
    discussionState.activePost = {
      ...discussionState.activePost,
      likedByMe: liked,
      likeCount
    };
  }
}

async function toggleDiscussionLike(postId) {
  if (!postId) {
    return;
  }

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  const payload = await callApi(`/discussion/posts/${postId}/like`, {
    method: "POST"
  });

  updatePostReactionState(postId, Boolean(payload.liked), Number(payload.likeCount || 0));
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

  const payload = await callApi(`/discussion/posts/${postId}`, {
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
    discussionState.activePostId = 0;
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
    postId: 0
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
    discussionState.activePostId = 0;

    if (query.postId) {
      try {
        const payload = await callApi(`/discussion/posts/${query.postId}`, {
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

  const studentId = getProfileStudentIdFromQuery();

  if (!isValidPublicStudentId(studentId)) {
    if (publicProfileName) {
      publicProfileName.textContent = "未找到用户";
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = "请从帖子作者头像进入个人主页。";
    }
    setPublicProfileMessage("无效学号");
    return;
  }

  setPublicProfileMessage("正在加载个人主页...");

  try {
    const payload = await callApi(`/users/${encodeURIComponent(studentId)}/public-profile`, {
      method: "GET"
    });
    const profile = payload.profile || {};

    if (publicProfileAvatar) {
      publicProfileAvatar.src = getAvatarUrl(profile.avatarPath);
    }
    if (publicProfileName) {
      publicProfileName.textContent = profile.fullName || profile.username || "未命名用户";
    }
    if (publicProfileStudentId) {
      publicProfileStudentId.textContent = profile.studentId || "未公开学号";
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

function handleSettingsLogout() {
  if (!isSettingsPage() || !userState.isLoggedIn) {
    return;
  }

  if (window.confirm(`确认退出 ${userState.fullName || userState.username}？`)) {
    clearSession();
    window.location.href = "./index.html";
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
  discussionState.activePostId = 0;
  renderDiscussionDetail(null);
  await loadDiscussionPosts({
    autoOpen: false
  });
}

async function handleDiscussionPostClick(event) {
  if (event.target.closest("[data-action='open-profile']")) {
    return;
  }

  const likeButton = event.target.closest("[data-action='toggle-like']");

  if (likeButton) {
    event.preventDefault();
    event.stopPropagation();
    await toggleDiscussionLike(Number(likeButton.dataset.postId || 0));
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await deleteDiscussionPost(Number(deleteButton.dataset.postId || 0));
    return;
  }

  const button = event.target.closest("[data-post-id]");

  if (!button) {
    return;
  }

  const postId = Number(button.dataset.postId || 0);

  if (!postId) {
    return;
  }

  await loadDiscussionDetail(postId);
}

async function deleteDiscussionPost(postId) {
  if (!postId || userState.role !== "admin") {
    return;
  }

  if (!window.confirm("确认删除这篇帖子？")) {
    return;
  }

  try {
    await callApi(`/admin/discussion/posts/${postId}`, {
      method: "DELETE"
    });

    discussionState.posts = discussionState.posts.filter((post) => post.id !== postId);

    if (discussionState.activePostId === postId) {
      discussionState.activePostId = 0;
      renderDiscussionDetail(null);
      updateDiscussionQuery({
        board: discussionState.activeBoard,
        postId: 0
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

async function handleDiscussionDetailClick(event) {
  const likeButton = event.target.closest("[data-action='toggle-like']");

  if (likeButton) {
    await toggleDiscussionLike(Number(likeButton.dataset.postId || 0));
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    await deleteDiscussionPost(Number(deleteButton.dataset.postId || 0));
    return;
  }

  const button = event.target.closest("[data-action='close-detail']");

  if (!button) {
    return;
  }

  discussionState.activePostId = 0;
  renderDiscussionPosts();
  renderDiscussionDetail(null);
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: 0
  });
}

async function handleDiscussionCommentSubmit(event) {
  const form = event.target.closest("#discussion-comment-form");

  if (!form || !discussionState.activePostId) {
    return;
  }

  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal("login");
    return;
  }

  const input = form.querySelector("#discussion-comment-input");
  const message = form.querySelector("#discussion-comment-message");
  const contentMarkdown = input?.value.trim() || "";

  if (message) {
    message.textContent = "正在发布评论...";
  }

  try {
    const payload = await callApi(`/discussion/posts/${discussionState.activePostId}/comments`, {
      method: "POST",
      body: JSON.stringify({ contentMarkdown })
    });

    discussionState.comments = [...discussionState.comments, payload.comment];
    if (discussionState.activePost) {
      discussionState.activePost.commentCount = Number(discussionState.activePost.commentCount || 0) + 1;
    }
    discussionState.posts = discussionState.posts.map((post) => (
      post.id === discussionState.activePostId
        ? {
            ...post,
            commentCount: Number(post.commentCount || 0) + 1
          }
        : post
    ));
    input.value = "";
    if (message) {
      message.textContent = payload.message || "评论已发布";
    }
    renderDiscussionComments();
    renderDiscussionPosts();
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

userName.addEventListener("click", handleAuthEntry);
avatarButton.addEventListener("click", handleAvatarClick);
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
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.getElementById("fortune-modal")?.classList.add("hidden");
  }
});
renderUser();
loadFortuneConfig();
restoreSession();
renderAdminSection();
renderSettingsForm();
renderDiscussionComposerState();
loadHomeDiscussionPosts();
initializeDiscussionPage();
loadPublicProfile();
