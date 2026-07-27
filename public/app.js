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
const API_ROOT = API_BASE_URL.replace(/\/api$/, '');
const DEFAULT_AVATAR = '/assets/avatar_placeholder.webp';
const MAX_AGENT_AVATAR = '/assets/max_the_agent_avatar.webp';

const STORAGE_KEY = 'free_bbs_auth_token';
const THEME_STORAGE_KEY = 'free_bbs_theme_mode';
const USER_ROLE_LABELS = {
  student: '学生',
  ta: '助教',
  teacher: '教师',
  admin: '管理员',
};
const ADMIN_ROLE_OPTIONS = Object.entries(USER_ROLE_LABELS).filter(([role]) => role !== 'admin');
const userState = {
  isLoggedIn: false,
  token: localStorage.getItem(STORAGE_KEY) || '',
  uid: '',
  username: '',
  fullName: '',
  studentId: '',
  avatarPath: '',
  bio: '',
  websiteUrl: '',
  electrons: 0,
  manetrons: 0,
  heat: 0,
  isAdmin: false,
  fortuneBonusEnabled: false,
};
let economyShopItems = [];
let adminPermissionCatalog = { boards: [], courses: [] };
let adminExpandedUserId = '';
let adminMessageTimer = 0;
let sessionReady = Promise.resolve();

const userName = document.getElementById('user-name');
const userRole = document.getElementById('user-role');
const userStatus = document.getElementById('user-status');
const userSettingsButton = document.getElementById('user-settings-button');
const userLogoutButton = document.getElementById('user-logout-button');
const adminSection = document.getElementById('admin-section');
const adminUsers = document.getElementById('admin-users');
const adminMessage = document.getElementById('admin-message');
const adminAddUserButton = document.getElementById('admin-add-user');
const adminUserSearch = document.getElementById('admin-user-search');
const adminUserRoleFilter = document.getElementById('admin-user-role-filter');
const adminUserScopeFilter = document.getElementById('admin-user-scope-filter');
const adminUserVisibleCount = document.getElementById('admin-user-visible-count');
const adminUserCountLabel = document.getElementById('admin-user-count-label');
const adminUserEmpty = document.getElementById('admin-user-empty');
const fortuneBonusToggle = document.getElementById('fortune-bonus-toggle');
const manageLinks = document.querySelectorAll('.manage-link');
const fortuneLinks = document.querySelectorAll('.fortune-link');
const avatarImages = document.querySelectorAll('.avatar-image');
const avatarButtons = document.querySelectorAll('.avatar');
const electromagneticLinks = Array.from(document.querySelectorAll('.electromagnetic-link'));
const inventoryLinks = Array.from(document.querySelectorAll('.inventory-link'));
const settingsForm = document.getElementById('settings-form');
const settingsMessage = document.getElementById('settings-message');
const settingsFullName = document.getElementById('settings-full-name');
const settingsBio = document.getElementById('settings-bio');
const settingsWebsiteUrl = document.getElementById('settings-website-url');
const settingsAvatarInput = document.getElementById('settings-avatar-input');
const settingsAvatarImage = document.getElementById('settings-avatar-image');
const settingsLogoutButton = document.getElementById('settings-logout-button');
const settingsPasswordForm = document.getElementById('settings-password-form');
const settingsPasswordMessage = document.getElementById('settings-password-message');
const settingsCurrentPassword = document.getElementById('settings-current-password');
const settingsNewPassword = document.getElementById('settings-new-password');
const settingsNewPasswordConfirm = document.getElementById('settings-new-password-confirm');
const publicProfileAvatar = document.getElementById('public-profile-avatar');
const publicProfileName = document.getElementById('public-profile-name');
const publicProfileStudentId = document.getElementById('public-profile-student-id');
const publicProfileMajor = document.getElementById('public-profile-major');
const publicProfilePostCount = document.getElementById('public-profile-post-count');
const publicProfileLikeCount = document.getElementById('public-profile-like-count');
const publicProfileBio = document.getElementById('public-profile-bio');
const publicProfileWebsite = document.getElementById('public-profile-website');
const publicProfileMessage = document.getElementById('public-profile-message');
const homeDiscussionList = document.getElementById('home-discussion-list');
const homeFeedToggle = document.getElementById('home-feed-toggle');
const homeFeedModeLabel = document.getElementById('home-feed-mode-label');
const homeFeedStatus = document.getElementById('home-feed-status');
const homeBoardActivity = document.getElementById('home-board-activity');
const homeBoardStatus = document.getElementById('home-board-status');
const homeHeatList = document.getElementById('landing-heat-list');
const homeHeatStatus = document.getElementById('home-heat-status');
const homeBoardDesktopMedia = window.matchMedia('(min-width: 901px)');
const discussionLayout = document.querySelector('.discussion-layout');
const discussionBoardList = document.getElementById('discussion-board-list');
const discussionPostList = document.getElementById('discussion-post-list');
const discussionDetail = document.getElementById('discussion-detail');
const discussionCreateToggle = document.getElementById('discussion-create-toggle');
const discussionComposeForm = document.getElementById('discussion-compose-form');
const discussionComposeBoard = document.getElementById('discussion-compose-board');
const discussionComposeTitle = document.getElementById('discussion-compose-title');
const discussionComposeContent = document.getElementById('discussion-compose-content');
const discussionComposeMessage = document.getElementById('discussion-compose-message');
const discussionInsertImage = document.getElementById('discussion-insert-image');
const discussionImageInput = document.getElementById('discussion-image-input');
const discussionBoardAboutTitle = document.getElementById('discussion-board-about-title');
const discussionBoardAboutBody = document.getElementById('discussion-board-about-body');
const discussionBoardEdit = document.getElementById('discussion-board-edit');
const discussionBoardModerators = document.getElementById('discussion-board-moderators');
const discussionStatsPosts = document.getElementById('discussion-stats-posts');
const discussionStatsLikes = document.getElementById('discussion-stats-likes');
const aiChatForm = document.getElementById('aichat-form');
const aiChatInput = document.getElementById('aichat-input');
const aiChatThread = document.getElementById('aichat-thread');
const aiChatStatus = document.getElementById('aichat-status');
const aiChatSend = document.getElementById('aichat-send');
const aiChatDialogList = document.getElementById('aichat-dialog-list');
const aiChatNewDialog = document.getElementById('aichat-new-dialog');
const aiChatDialogId = document.getElementById('aichat-dialog-id');
const aiChatShell = document.querySelector('.aichat-shell');
const aiChatDialogToggle = document.getElementById('aichat-dialog-toggle');
const aiChatDialogBackdrop = document.querySelector('.aichat-dialog-backdrop');
const aiChatDialogs = document.getElementById('aichat-dialogs');
const aiChatDialogClose = document.querySelector('.aichat-dialog-close');
const aiChatMain = document.querySelector('.aichat-main');
const aiChatDrawerMedia = window.matchMedia('(max-width: 900px)');
const discussionState = {
  boards: [],
  posts: [],
  postsHashByBoard: {},
  postCache: new Map(),
  activeBoard: 'all',
  activePostId: '',
  isFallback: false,
  activePost: null,
  comments: [],
};
const DISCUSSION_COMMENT_PREVIEW_DELAY_MS = 160;
const DISCUSSION_COMMENT_DRAFT_LIMIT = 40;
const discussionCommentDrafts = new Map();
const discussionOpenReplyByPost = new Map();
const discussionCommentPreviewTimers = new WeakMap();
const homeDashboardState = {
  feedMode: 'hot',
  feedCache: new Map(),
  feedRequestId: 0,
};
const aiChatState = {
  currentDid: '',
  dialogs: [],
  messages: [],
  isSending: false,
  statusTimer: 0,
};

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

function createThemeToggleButton(className) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.dataset.themeToggle = 'true';
  button.addEventListener('click', toggleThemeMode);
  return button;
}

function initializeThemeMode() {
  const navActions = document.querySelector('.nav-actions');
  const userPanel = document.getElementById('user-panel');
  const userActions = document.getElementById('user-actions');

  if (navActions && !navActions.querySelector('[data-theme-toggle]')) {
    const themeButton = createThemeToggleButton('theme-toggle nav-link');
    navActions.insertBefore(themeButton, userPanel || null);
  }

  if (userActions && !userActions.querySelector('[data-theme-toggle]')) {
    userActions.appendChild(createThemeToggleButton('theme-toggle mobile-theme-toggle'));
  } else if (userPanel && !userPanel.querySelector('[data-theme-toggle]')) {
    userPanel.appendChild(createThemeToggleButton('theme-toggle mobile-theme-toggle'));
  }

  applyThemeMode(getStoredThemeMode());
}

function createNavLink({ href = '#', icon, text, className = '' }) {
  const link = document.createElement('a');
  link.className = `nav-link ${className}`.trim();
  link.href = href;
  link.innerHTML = `
    <img class="nav-icon" src="/assets/icons/${icon}.svg" alt="" aria-hidden="true" />
    <span>${escapeHtml(text)}</span>
  `;
  return link;
}

function centerActiveMobileNavigation() {
  document.querySelectorAll('.mobile-nav').forEach((nav) => {
    const activeLink = nav.querySelector('.nav-link.is-active');

    if (!activeLink) {
      return;
    }

    window.requestAnimationFrame(() => {
      const centeredScrollLeft =
        activeLink.offsetLeft - (nav.clientWidth - activeLink.offsetWidth) / 2;
      nav.scrollLeft = Math.max(0, centeredScrollLeft);
    });
  });
}

function initializeDashboardShell() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const pageTitles = {
    '/': '首页',
    '/world': '学习世界',
    '/course': '课程',
    '/knowledge': '知识点',
    '/discussion': '讨论区',
    '/workbench': '我的工作台',
    '/aichat': '问问 Max',
    '/development': '发展端',
    '/settings': '设置',
    '/profile': '个人主页',
    '/adminusers': '用户管理',
    '/system-settings': '系统设置',
    '/system-settings/model': '模型与密钥',
    '/system-settings/course-materials': '课程资料',
    '/electromagnetic': '电磁场',
    '/inventory': '仓库',
    '/login': '登录',
    '/register': '注册',
    '/remake': '找回密码',
  };
  const navItems = [
    { href: '/', icon: 'home', label: '首页' },
    { href: '/world', icon: 'map', label: '学习世界' },
    { href: '/discussion', icon: 'people', label: '讨论区' },
    { href: '/workbench', icon: 'run', label: '我的工作台' },
    { href: '/aichat', icon: 'ai', label: '问问 Max' },
    { href: '/development', icon: 'star', label: '发展端' },
    { href: '/settings', icon: 'gear', label: '设置' },
    {
      href: '/system-settings',
      icon: 'gear',
      label: '系统设置',
      className: 'system-settings-link hidden',
    },
  ];
  let activePath = path;
  if (path.startsWith('/system-settings') || path === '/adminusers') {
    activePath = '/system-settings';
  } else if (['/course', '/knowledge'].includes(path)) {
    activePath = '/world';
  }

  document.body.dataset.pageTitle = pageTitles[path] || 'FREE-BBS';
  document.querySelectorAll('.main-content').forEach((main) => {
    main.dataset.pageTitle = document.body.dataset.pageTitle;
  });

  document.querySelectorAll('.nav-actions, .mobile-nav').forEach((nav) => {
    navItems.forEach(({ href, icon, label, className = '' }) => {
      let link = nav.querySelector(`.nav-link[href="${href}"]`);
      if (!link) {
        link = createNavLink({
          href,
          icon,
          text: label,
          className: className || (href === '/settings' ? 'settings-nav-link' : ''),
        });
      }

      const navAnchor = nav.querySelector('.fortune-link, .manage-link, #user-panel');
      nav.insertBefore(link, navAnchor || null);

      const text = link.querySelector('span');
      if (text) {
        text.textContent = label;
      }

      link.classList.toggle('is-active', href === activePath);
      if (href === activePath) {
        link.setAttribute('aria-current', 'page');
      } else if (link.getAttribute('aria-current') === 'page') {
        link.removeAttribute('aria-current');
      }
    });
  });

  centerActiveMobileNavigation();
}

function initializeEconomyNavigation() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';

  fortuneLinks.forEach((link) => {
    const text = link.querySelector('span');
    const icon = link.querySelector('img');
    if (text) {
      text.textContent = '签到';
    }
    if (icon) {
      icon.src = '/assets/icons/electron.svg';
    }
  });

  document.querySelectorAll('.nav-actions, .mobile-nav').forEach((nav) => {
    let electromagneticLink = nav.querySelector('.electromagnetic-link');
    if (!electromagneticLink) {
      electromagneticLink = createNavLink({
        href: '/electromagnetic',
        icon: 'battery',
        text: '电磁场',
        className: 'electromagnetic-link hidden',
      });
      const manageLink = nav.querySelector('.manage-link');
      nav.insertBefore(electromagneticLink, manageLink || null);
    }

    if (!electromagneticLinks.includes(electromagneticLink)) {
      electromagneticLinks.push(electromagneticLink);
    }
    electromagneticLink.classList.toggle('is-active', path === '/electromagnetic');
    if (path === '/electromagnetic') {
      electromagneticLink.setAttribute('aria-current', 'page');
    }

    let inventoryLink = nav.querySelector('.inventory-link');
    if (!inventoryLink) {
      inventoryLink = createNavLink({
        href: '/inventory',
        icon: 'inventory',
        text: '仓库',
        className: 'inventory-link hidden',
      });
      const manageLink = nav.querySelector('.manage-link');
      nav.insertBefore(inventoryLink, manageLink || null);
    }

    if (!inventoryLinks.includes(inventoryLink)) {
      inventoryLinks.push(inventoryLink);
    }
    inventoryLink.classList.toggle('is-active', path === '/inventory');
    if (path === '/inventory') {
      inventoryLink.setAttribute('aria-current', 'page');
    }
  });

  centerActiveMobileNavigation();
}
const FALLBACK_DISCUSSION_BOARDS = [
  {
    id: -1,
    slug: 'daily',
    name: '日常',
    description: '本地测试版块',
    descriptionMarkdown: '本地测试版块。后端连接失败时显示。',
    canModerate: false,
    canManageModerators: false,
    sortOrder: 10,
  },
];
const FALLBACK_DISCUSSION_POST = {
  id: 'local-test-post',
  title: '测试帖子',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  board: {
    slug: 'daily',
    name: '日常',
  },
  isPinned: false,
  isFeatured: false,
  canFeature: false,
  canPin: false,
  canDelete: false,
  author: {
    id: -1,
    uid: 'u_local_admin',
    username: 'admin',
    fullName: '管理员',
    displayName: '管理员',
    avatarPath: '',
  },
  likeCount: 0,
  lightCount: 0,
  fireworksCount: 0,
  commentCount: 0,
  likedByMe: false,
  lightedByMe: false,
  fireworksByMe: false,
  contentMarkdown: [
    '这是一篇本地测试帖子，用于接口请求失败时占位。',
    '',
    '支持 **Markdown**，也支持 KaTeX：$E=mc^2$。',
    '',
    '$$',
    '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
    '$$',
  ].join('\n'),
};
const DISCUSSION_REACTIONS = {
  smile: {
    countKey: 'likeCount',
    activeKey: 'likedByMe',
    label: '令人高兴',
    inactiveIcon: '/assets/icons/smile.svg',
    activeIcon: '/assets/icons/smile.svg',
  },
  light: {
    countKey: 'lightCount',
    activeKey: 'lightedByMe',
    label: '有启发性',
    inactiveIcon: '/assets/icons/light-off.svg',
    activeIcon: '/assets/icons/light-on.svg',
  },
  fireworks: {
    countKey: 'fireworksCount',
    activeKey: 'fireworksByMe',
    label: '恭喜',
    inactiveIcon: '/assets/icons/fireworks.svg',
    activeIcon: '/assets/icons/fireworks.svg',
  },
};

function resolveAssetUrl(assetPath) {
  const normalizedPath = String(assetPath || '').trim();
  if (!normalizedPath || /^(?:https?:|data:|blob:)/i.test(normalizedPath)) {
    return normalizedPath;
  }
  if (normalizedPath.startsWith('/uploads/')) {
    return `${API_ROOT}${normalizedPath}`;
  }
  return normalizedPath;
}

function getAvatarUrl(avatarPath) {
  return resolveAssetUrl(avatarPath) || DEFAULT_AVATAR;
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFortuneResult(score, date = getTodayKey()) {
  if (score >= 90) {
    return {
      score,
      date,
      label: '祥瑞',
      colorClass: 'fortune-great',
      colorName: '金色',
      tagline: 'Absoulute legend',
    };
  }

  if (score >= 70) {
    return {
      score,
      date,
      label: '大吉',
      colorClass: 'fortune-awful',
      colorName: '红色',
      tagline: 'Absoulute legend',
    };
  }

  if (score >= 50) {
    return {
      score,
      date,
      label: '吉',
      colorClass: 'fortune-bad',
      colorName: '绿色',
      tagline: '闭眼写，随手推',
    };
  }

  if (score >= 20) {
    return {
      score,
      date,
      label: '顺',
      colorClass: 'fortune-good',
      colorName: '粉色',
      tagline: '人生是个泊松过程，一时的等待是为了下一次跳跃',
    };
  }

  return {
    score,
    date,
    label: '平',
    colorClass: 'fortune-neutral',
    colorName: '白色',
    tagline: '人生是个泊松过程，一时的等待是为了下一次跳跃',
  };
}

function ensureFortuneModal() {
  let modal = document.getElementById('fortune-modal');

  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'fortune-modal';
  modal.className = 'fortune-modal hidden';
  modal.innerHTML = `
    <div class="fortune-backdrop" data-action="close"></div>
    <section class="fortune-panel" aria-labelledby="fortune-title">
      <button class="fortune-close" type="button" data-action="close" aria-label="关闭">×</button>
      <h2 class="fortune-title" id="fortune-title">签到</h2>
      <p class="fortune-date" id="fortune-date"></p>
      <div class="fortune-badge" id="fortune-badge"></div>
      <p class="fortune-score" id="fortune-score"></p>
      <p class="fortune-tagline" id="fortune-tagline"></p>
      <button class="fortune-checkin-button" id="fortune-checkin-button" type="button">签到</button>
      <div class="fortune-records" id="fortune-records" aria-label="签到记录">
      </div>
      <p class="fortune-chart-caption" id="fortune-chart-caption">签到记录</p>
    </section>
  `;

  document.body.append(modal);

  modal.addEventListener('click', (event) => {
    const target = event.target.closest("[data-action='close']");
    if (target) {
      modal.classList.add('hidden');
    }
  });

  return modal;
}

function drawFortuneChart(canvas, history) {
  if (!canvas || !history?.length) {
    return;
  }

  const context = canvas.getContext('2d');
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
  const xFor = (index) =>
    padding.left +
    (history.length === 1 ? chartWidth / 2 : (chartWidth * index) / (history.length - 1));
  const yFor = (score) =>
    padding.top + chartHeight - ((score - minScore) / (maxScore - minScore)) * chartHeight;

  context.lineWidth = 1;
  context.strokeStyle = 'rgba(232, 237, 243, 0.16)';
  context.fillStyle = 'rgba(232, 237, 243, 0.5)';
  context.font = '12px sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';

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
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = '#ffe59a';
  context.stroke();

  history.forEach((item, index) => {
    if (item.score === null || item.score === undefined) {
      return;
    }

    const x = xFor(index);
    const y = yFor(Number(item.score) || 0);
    context.beginPath();
    context.arc(x, y, index === history.length - 1 ? 4.5 : 3, 0, Math.PI * 2);
    context.fillStyle = index === history.length - 1 ? '#ffffff' : '#ffe59a';
    context.fill();
  });

  const firstDate = history[0]?.date?.slice(5) || '';
  const lastDate = history[history.length - 1]?.date?.slice(5) || '';
  context.fillStyle = 'rgba(232, 237, 243, 0.6)';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(firstDate, padding.left, height - 20);
  context.textAlign = 'right';
  context.fillText(lastDate, width - padding.right, height - 20);
}

async function openFortuneModal() {
  if (!userState.isLoggedIn || !userState.studentId) {
    return;
  }

  const modal = ensureFortuneModal();
  const badge = modal.querySelector('#fortune-badge');
  const date = modal.querySelector('#fortune-date');
  const score = modal.querySelector('#fortune-score');
  const tagline = modal.querySelector('#fortune-tagline');
  const checkinButton = modal.querySelector('#fortune-checkin-button');
  const records = modal.querySelector('#fortune-records');
  const chartCaption = modal.querySelector('#fortune-chart-caption');

  modal.classList.remove('hidden');
  badge.className = 'fortune-badge';
  badge.textContent = '加载中';
  date.textContent = '';
  score.textContent = '';
  tagline.textContent = '';
  chartCaption.textContent = '签到记录';
  records.innerHTML = `<p class="fortune-record-empty">正在加载签到记录...</p>`;
  checkinButton.disabled = true;
  checkinButton.textContent = '加载中';

  const renderCheckinPayload = (payload) => {
    userState.fortuneBonusEnabled = Boolean(payload.fortuneBonusEnabled);
    if (payload.user) {
      saveSession(userState.token, payload.user);
    }
    const today = payload.today || payload.todayFortune;
    const result = getFortuneResult(Number(today?.fortuneScore ?? today?.score ?? 0), today?.date);

    badge.className = `fortune-badge ${result.colorClass}`;
    badge.textContent = result.label;
    date.textContent = result.date;
    score.textContent = `今日运势 ${result.score}`;
    tagline.textContent = result.tagline;
    checkinButton.disabled = Boolean(payload.checkedInToday);
    checkinButton.textContent = payload.checkedInToday ? '今日已签到' : '签到领取电元';
    records.innerHTML = (payload.records || []).length
      ? payload.records
          .map(
            (item) => `
          <div class="fortune-record-row">
            <span>${escapeHtml(item.date)}</span>
            <strong>连续 ${Number(item.streak || 0)} 天</strong>
            <span>+${Number(item.rewardElectrons || 0)} 电元</span>
          </div>
        `,
          )
          .join('')
      : `<p class="fortune-record-empty">还没有签到记录。</p>`;
  };

  try {
    const payload = await callApi('/checkin', { method: 'GET' });
    renderCheckinPayload(payload);
    checkinButton.onclick = async () => {
      checkinButton.disabled = true;
      checkinButton.textContent = '签到中';
      const nextPayload = await callApi('/checkin', { method: 'POST' });
      renderCheckinPayload(
        nextPayload.summary
          ? {
              ...nextPayload.summary,
              user: nextPayload.user,
            }
          : nextPayload,
      );
    };
  } catch (error) {
    badge.className = 'fortune-badge fortune-awful';
    badge.textContent = '失败';
    tagline.textContent = error.message || '获取签到失败';
    checkinButton.disabled = false;
    checkinButton.textContent = '重试';
  }
}

function ensureElectromagneticModal() {
  let modal = document.getElementById('electromagnetic-modal');

  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'electromagnetic-modal';
  modal.className = 'fortune-modal electromagnetic-modal hidden';
  modal.innerHTML = `
    <div class="fortune-backdrop" data-action="close"></div>
    <section class="fortune-panel electromagnetic-panel" aria-labelledby="electromagnetic-title">
      <button class="fortune-close" type="button" data-action="close" aria-label="关闭">×</button>
      <h2 class="fortune-title" id="electromagnetic-title">电磁场</h2>
      <p class="fortune-tagline">购买资产会消耗电元或磁元，并把消耗值加入热力。</p>
      <div class="electromagnetic-balances" id="electromagnetic-balances"></div>
      <section class="electromagnetic-section">
        <h3>商店</h3>
        <article class="electromagnetic-shop-item">
          <div>
            <strong>微分器</strong>
            <p>消耗 1 个电元或 1 个磁元购买。拥有后可在电元和磁元之间按 5:5 转换。</p>
          </div>
          <div class="electromagnetic-actions">
            <button class="electromagnetic-button" data-action="buy-differentiator" data-currency="electric" type="button">电元购买</button>
            <button class="electromagnetic-button" data-action="buy-differentiator" data-currency="magnetic" type="button">磁元购买</button>
          </div>
        </article>
      </section>
      <section class="electromagnetic-section">
        <h3>资产</h3>
        <div id="electromagnetic-assets"></div>
        <div class="electromagnetic-actions">
          <button class="electromagnetic-button" data-action="convert" data-direction="electric_to_magnetic" type="button">5 电元 → 5 磁元</button>
          <button class="electromagnetic-button" data-action="convert" data-direction="magnetic_to_electric" type="button">5 磁元 → 5 电元</button>
        </div>
      </section>
      <p class="discussion-message" id="electromagnetic-message"></p>
    </section>
  `;
  document.body.append(modal);
  modal.addEventListener('click', handleElectromagneticModalClick);
  return modal;
}

function renderElectromagneticModal(payload) {
  const modal = ensureElectromagneticModal();
  const balances = modal.querySelector('#electromagnetic-balances');
  const assets = modal.querySelector('#electromagnetic-assets');

  if (payload.user) {
    saveSession(userState.token, payload.user);
  }

  balances.innerHTML = [
    renderCurrency('electric', userState.electrons),
    renderCurrency('magnetic', userState.manetrons),
    renderCurrency('heat', userState.heat),
  ].join('');

  const assetRows = payload.assets || [];
  const differentiator = assetRows.find((item) => item.key === 'differential_converter');
  assets.innerHTML = differentiator
    ? `<p>微分器 × ${Number(differentiator.quantity || 0)}</p>`
    : `<p>还没有资产。</p>`;
}

async function openElectromagneticModal() {
  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  const modal = ensureElectromagneticModal();
  const message = modal.querySelector('#electromagnetic-message');
  modal.classList.remove('hidden');
  message.textContent = '正在加载...';

  try {
    const payload = await callApi('/electromagnetic', { method: 'GET' });
    renderElectromagneticModal(payload);
    message.textContent = '';
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleElectromagneticModalClick(event) {
  const close = event.target.closest("[data-action='close']");
  if (close) {
    ensureElectromagneticModal().classList.add('hidden');
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button || button.dataset.action === 'close') {
    return;
  }

  const modal = ensureElectromagneticModal();
  const message = modal.querySelector('#electromagnetic-message');
  const { action } = button.dataset;
  button.disabled = true;
  message.textContent = '处理中...';

  try {
    let payload;
    if (action === 'buy-differentiator') {
      payload = await callApi('/electromagnetic/shop/differential-converter', {
        method: 'POST',
        body: JSON.stringify({ currency: button.dataset.currency }),
      });
    } else if (action === 'convert') {
      payload = await callApi('/electromagnetic/convert', {
        method: 'POST',
        body: JSON.stringify({ direction: button.dataset.direction }),
      });
    }

    if (payload) {
      renderElectromagneticModal(payload);
      message.textContent = '已更新';
      loadHeatLeaderboard();
    }
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function getCurrentAssets() {
  const payload = await callApi('/electromagnetic', { method: 'GET' });
  return payload.assets || [];
}

function renderEconomyBalances(target, user = userState) {
  if (!target) {
    return;
  }

  target.innerHTML = [
    renderCurrency('electric', user.electrons ?? 0),
    renderCurrency('magnetic', user.manetrons ?? 0),
    renderCurrency('heat', user.heat ?? 0),
  ].join('');
}

function renderShopCost(cost = {}) {
  const parts = [];

  if (Number(cost.electric || 0) > 0) {
    parts.push(`${Number(cost.electric)} 电元`);
  }

  if (Number(cost.magnetic || 0) > 0) {
    parts.push(`${Number(cost.magnetic)} 磁元`);
  }

  return parts.join(' / ') || '未定价';
}

function ensureShopInspectModal() {
  let modal = document.getElementById('shop-inspect-modal');

  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'shop-inspect-modal';
  modal.className = 'fortune-modal shop-inspect-modal hidden';
  modal.innerHTML = `
    <div class="fortune-backdrop" data-action="close-shop-inspect"></div>
    <section class="fortune-panel shop-inspect-panel" aria-labelledby="shop-inspect-title">
      <button class="fortune-close" type="button" data-action="close-shop-inspect" aria-label="关闭">×</button>
      <div class="shop-inspect-layout">
        <div class="shop-inspect-image">
          <img id="shop-inspect-image" src="/assets/icons/battery.svg" alt="" aria-hidden="true" />
        </div>
        <div class="shop-inspect-copy">
          <p class="discussion-kicker" id="shop-inspect-class"></p>
          <h2 id="shop-inspect-title"></h2>
          <p id="shop-inspect-desc"></p>
          <strong id="shop-inspect-price"></strong>
          <div class="shop-inspect-actions" id="shop-inspect-actions"></div>
          <p class="discussion-message" id="shop-inspect-message"></p>
        </div>
      </div>
    </section>
  `;
  document.body.append(modal);
  return modal;
}

function getCurrencyOwned(currency) {
  if (currency === 'electric') {
    return Number(userState.electrons || 0);
  }

  if (currency === 'magnetic') {
    return Number(userState.manetrons || 0);
  }

  return 0;
}

function renderActivationButton(item, currency) {
  const price = Number(item.cost?.[currency] || 0);

  if (!price) {
    return '';
  }

  const icon = currency === 'electric' ? 'electron' : 'magnetron';
  const label = currency === 'electric' ? '电激发' : '磁激发';
  const owned = getCurrencyOwned(currency);

  return `
    <button
      class="electromagnetic-button economy-activation-button"
      data-action="purchase-item"
      data-item-key="${escapeHtml(item.key)}"
      data-currency="${currency}"
      data-tooltip="${label}：消耗 ${price}，当前持有 ${owned}"
      title="${label}：${price}/${owned}"
      type="button"
    >
      <img src="/assets/icons/${icon}.svg" alt="" aria-hidden="true" />
      <span>${price}/${owned}</span>
    </button>
  `;
}

function normalizeShopCatalogItem(item) {
  const key = String(item?.key || '').trim();

  return {
    ...item,
    key,
    assetKey: String(item?.assetKey || key).trim(),
    name: String(item?.name || key).trim(),
    class: String(item?.class || 'usable').trim(),
    description: String(item?.description || '').trim(),
    desc: String(item?.desc || item?.description || '').trim(),
    image: String(item?.image || '').trim(),
    isGift: !(item?.isgift === false || item?.is_gift === false || item?.isGift === false),
    cost: item?.cost && typeof item.cost === 'object' ? item.cost : {},
  };
}

async function loadShopCatalogFromJson() {
  try {
    const response = await fetch('/data/shop-items.json', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('shop catalog unavailable');
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map(normalizeShopCatalogItem).filter((item) => item.key);
  } catch {
    return [];
  }
}

function openShopInspectModal(itemKey) {
  const item = economyShopItems.find((shopItem) => shopItem.key === itemKey);

  if (!item) {
    return;
  }

  const modal = ensureShopInspectModal();
  modal.querySelector('#shop-inspect-image').src = item.image || '/assets/icons/battery.svg';
  modal.querySelector('#shop-inspect-class').textContent =
    item.class === 'useless' ? '无用类' : '资产';
  modal.querySelector('#shop-inspect-title').textContent = item.name || item.key;
  modal.querySelector('#shop-inspect-desc').textContent = item.desc || item.description || '';
  modal.querySelector('#shop-inspect-price').textContent = renderShopCost(item.cost);
  modal.querySelector('#shop-inspect-message').textContent = '';
  modal.querySelector('#shop-inspect-actions').innerHTML =
    [renderActivationButton(item, 'electric'), renderActivationButton(item, 'magnetic')].join('') ||
    `<p class="fortune-record-empty">这个物品暂时无法激发。</p>`;
  modal.classList.remove('hidden');
}

function openInventoryInspectModal(asset) {
  if (!asset) {
    return;
  }

  const catalogItem = economyShopItems.find(
    (shopItem) => shopItem.assetKey === asset.key || shopItem.key === asset.key,
  );
  const item = catalogItem || asset.item || asset.metadata || {};
  const modal = ensureShopInspectModal();
  modal.querySelector('#shop-inspect-image').src = item.image || '/assets/icons/inventory.svg';
  modal.querySelector('#shop-inspect-class').textContent =
    item.class === 'useless' ? '无用类' : '资产';
  modal.querySelector('#shop-inspect-title').textContent = item.name || asset.key || '资产';
  modal.querySelector('#shop-inspect-desc').textContent =
    item.desc || item.description || '这个资产还没有说明。';
  modal.querySelector('#shop-inspect-price').textContent = `持有 ${Number(asset.quantity || 0)} 个`;
  modal.querySelector('#shop-inspect-message').textContent = '';
  const canGift = Boolean(catalogItem) && catalogItem.isGift !== false;
  const converterActions =
    asset.key === 'differential_converter'
      ? `
      <button class="electromagnetic-button" data-action="convert" data-direction="electric_to_magnetic" type="button" title="5 电元转 5 磁元">电 → 磁</button>
      <button class="electromagnetic-button" data-action="convert" data-direction="magnetic_to_electric" type="button" title="5 磁元转 5 电元">磁 → 电</button>
    `
      : '';
  const giftActions = canGift
    ? `
      <div class="inventory-gift-form" data-gift-asset-key="${escapeHtml(asset.key)}">
        <input class="inventory-gift-input" type="text" placeholder="输入 UID 或昵称" maxlength="64" />
        <button class="electromagnetic-button" data-action="gift-inventory-item" data-asset-key="${escapeHtml(asset.key)}" type="button">赠与</button>
      </div>
    `
    : `<p class="fortune-record-empty">这个资产不能赠与。</p>`;
  modal.querySelector('#shop-inspect-actions').innerHTML = [converterActions, giftActions]
    .filter(Boolean)
    .join('');
  modal.classList.remove('hidden');
}

function refreshOpenShopInspectActions(itemKey) {
  const modal = document.getElementById('shop-inspect-modal');

  if (!modal || modal.classList.contains('hidden')) {
    return;
  }

  const item = economyShopItems.find((shopItem) => shopItem.key === itemKey);
  const actions = modal.querySelector('#shop-inspect-actions');

  if (!item || !actions) {
    return;
  }

  actions.innerHTML =
    [renderActivationButton(item, 'electric'), renderActivationButton(item, 'magnetic')].join('') ||
    `<p class="fortune-record-empty">这个物品暂时无法激发。</p>`;
}

async function loadElectromagneticPage() {
  if (!isElectromagneticPage()) {
    return;
  }

  const grid = document.getElementById('shop-grid');
  const message = document.getElementById('economy-message');
  const balances = document.getElementById('economy-balance-row');

  if (!userState.isLoggedIn) {
    return;
  }

  try {
    if (message) {
      message.textContent = '正在加载商店...';
    }
    const payload = await callApi('/electromagnetic', { method: 'GET' });
    if (payload.user) {
      saveSession(userState.token, payload.user);
    }
    const staticShopItems = await loadShopCatalogFromJson();
    economyShopItems = staticShopItems.length
      ? staticShopItems
      : (payload.shopItems || []).map(normalizeShopCatalogItem);
    const assetQuantityByKey = new Map(
      (payload.assets || []).map((asset) => [asset.key, Number(asset.quantity || 0)]),
    );
    renderEconomyBalances(balances);
    if (grid) {
      grid.innerHTML =
        economyShopItems
          .map(
            (item) => `
        <article class="shop-item-card" data-item-key="${escapeHtml(item.key)}">
          <span class="asset-quantity-badge">${assetQuantityByKey.get(item.assetKey || item.key) || 0}</span>
          <div class="shop-item-image">
            <img src="${escapeHtml(item.image || '/assets/icons/battery.svg')}" alt="" aria-hidden="true" />
          </div>
          <div class="shop-item-copy">
            <p class="discussion-kicker">Asset</p>
            <h2>${escapeHtml(item.name)}</h2>
          </div>
          <div class="shop-item-actions">
            <button class="electromagnetic-button" data-action="inspect-item" data-item-key="${escapeHtml(item.key)}" type="button">端详</button>
          </div>
        </article>
      `,
          )
          .join('') || `<p class="fortune-record-empty">暂无商品。</p>`;
    }
    if (message) {
      message.textContent = '';
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

async function loadInventoryPage() {
  if (!isInventoryPage()) {
    return;
  }

  const list = document.getElementById('inventory-list');
  const message = document.getElementById('inventory-message');
  const balances = document.getElementById('inventory-balance-row');

  if (!userState.isLoggedIn) {
    return;
  }

  try {
    if (message) {
      message.textContent = '正在加载仓库...';
    }
    const payload = await callApi('/electromagnetic', { method: 'GET' });
    if (payload.user) {
      saveSession(userState.token, payload.user);
    }
    const staticShopItems = await loadShopCatalogFromJson();
    economyShopItems = staticShopItems.length
      ? staticShopItems
      : (payload.shopItems || economyShopItems).map(normalizeShopCatalogItem);
    const shopItemByAsset = new Map(
      economyShopItems.flatMap((item) => [
        [item.assetKey || item.key, item],
        [item.key, item],
      ]),
    );
    const assets = (payload.assets || []).map((asset) => {
      const catalogItem = shopItemByAsset.get(asset.key);
      return catalogItem
        ? {
            ...asset,
            item: catalogItem,
            isGift: catalogItem.isGift !== false,
          }
        : asset;
    });
    window.freeBbsInventoryAssets = assets;
    renderEconomyBalances(balances);
    if (list) {
      list.innerHTML =
        assets
          .map((asset) => {
            const item = asset.item || asset.metadata || {};
            return `
          <article class="inventory-item-row" data-asset-key="${escapeHtml(asset.key)}">
            <span class="asset-quantity-badge">${Number(asset.quantity || 0)}</span>
            <div class="inventory-item-image">
              <img src="${escapeHtml(item.image || '/assets/icons/inventory.svg')}" alt="" aria-hidden="true" />
            </div>
            <div class="inventory-item-copy">
              <h2>${escapeHtml(item.name || asset.key)}</h2>
            </div>
            <div class="inventory-item-actions">
              <button class="electromagnetic-button" data-action="inspect-inventory-item" data-asset-key="${escapeHtml(asset.key)}" type="button">端详</button>
            </div>
          </article>
        `;
          })
          .join('') || `<p class="fortune-record-empty">仓库里还没有物品。</p>`;
    }
    if (message) {
      message.textContent = '';
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

async function handleElectromagneticPageClick(event) {
  const closeInspect = event.target.closest("[data-action='close-shop-inspect']");
  if (closeInspect) {
    ensureShopInspectModal().classList.add('hidden');
    return;
  }

  const button = event.target.closest('[data-action]');

  if (!button || !isElectromagneticPage()) {
    return;
  }

  const message = document.getElementById('economy-message');
  button.disabled = true;
  if (message) {
    message.textContent = '处理中...';
  }

  try {
    if (button.dataset.action === 'inspect-item') {
      openShopInspectModal(button.dataset.itemKey || '');
      if (message) {
        message.textContent = '';
      }
      return;
    }

    if (button.dataset.action === 'purchase-item') {
      const itemKey = button.dataset.itemKey || '';
      const payload = await callApi(
        `/electromagnetic/shop/${encodeURIComponent(itemKey)}/purchase`,
        {
          method: 'POST',
          body: JSON.stringify({ currency: button.dataset.currency }),
        },
      );
      if (payload.user) {
        saveSession(userState.token, payload.user);
      }
      refreshOpenShopInspectActions(itemKey);
      await loadElectromagneticPage();
      const modal = document.getElementById('shop-inspect-modal');
      const modalMessage = modal?.querySelector('#shop-inspect-message');
      if (modalMessage) {
        modalMessage.textContent = '已激发';
      }
      refreshOpenShopInspectActions(itemKey);
    }

    if (message) {
      message.textContent = '已更新';
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
}

async function handleInventoryPageClick(event) {
  const closeInspect = event.target.closest("[data-action='close-shop-inspect']");
  if (closeInspect) {
    ensureShopInspectModal().classList.add('hidden');
    return;
  }

  const button = event.target.closest('[data-action]');

  if (!button || !isInventoryPage()) {
    return;
  }

  const message = document.getElementById('inventory-message');

  if (button.dataset.action === 'inspect-inventory-item') {
    const assets = window.freeBbsInventoryAssets || [];
    openInventoryInspectModal(assets.find((asset) => asset.key === button.dataset.assetKey));
    if (message) {
      message.textContent = '';
    }
    return;
  }

  if (button.dataset.action === 'gift-inventory-item') {
    const modal = document.getElementById('shop-inspect-modal');
    const modalMessage = modal?.querySelector('#shop-inspect-message');
    const targetInput = modal?.querySelector('.inventory-gift-input');
    const target = targetInput?.value.trim() || '';

    if (!target) {
      if (modalMessage) {
        modalMessage.textContent = '请输入接收者 UID 或昵称';
      }
      return;
    }

    button.disabled = true;
    if (message) {
      message.textContent = '正在赠与...';
    }
    if (modalMessage) {
      modalMessage.textContent = '正在赠与...';
    }

    try {
      const assetKey = button.dataset.assetKey || '';
      let payload;
      try {
        payload = await callApi(`/electromagnetic/assets/${encodeURIComponent(assetKey)}/gift`, {
          method: 'POST',
          body: JSON.stringify({ target }),
        });
      } catch (error) {
        const fetchFailed = error.message === 'Failed to fetch' || error.message === '请求失败';
        throw new Error(fetchFailed ? '赠与接口不可用，请确认后端已加载最新代码' : error.message);
      }
      await loadInventoryPage();
      const assets = window.freeBbsInventoryAssets || [];
      const activeAsset = assets.find((asset) => asset.key === assetKey);
      if (activeAsset) {
        openInventoryInspectModal(activeAsset);
      } else {
        modal?.classList.add('hidden');
      }
      const recipient = payload.recipient?.username || payload.recipient?.uid || target;
      if (message) {
        message.textContent = `已赠与给 ${recipient}`;
      }
      const refreshedMessage = document.getElementById('shop-inspect-message');
      if (refreshedMessage) {
        refreshedMessage.textContent = `已赠与给 ${recipient}`;
      }
    } catch (error) {
      if (message) {
        message.textContent = error.message;
      }
      if (modalMessage) {
        modalMessage.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action !== 'convert') {
    return;
  }

  button.disabled = true;
  if (message) {
    message.textContent = '正在转换...';
  }

  try {
    await callApi('/electromagnetic/convert', {
      method: 'POST',
      body: JSON.stringify({ direction: button.dataset.direction }),
    });
    await loadInventoryPage();
    const modal = document.getElementById('shop-inspect-modal');
    const activeAssetKey =
      modal && !modal.classList.contains('hidden') ? 'differential_converter' : '';
    if (activeAssetKey) {
      const assets = window.freeBbsInventoryAssets || [];
      const activeAsset = assets.find((asset) => asset.key === activeAssetKey);
      if (activeAsset) {
        openInventoryInspectModal(activeAsset);
      } else {
        modal.classList.add('hidden');
      }
    }
    if (message) {
      message.textContent = '已转换';
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
}

function renderHeatLeaderboard(users) {
  if (!homeHeatList) {
    return;
  }

  if (!users.length) {
    homeHeatList.innerHTML = `
      <li class="home-dashboard-empty">
        <p>还没有用户进入热力榜。</p>
      </li>
    `;
    return;
  }

  homeHeatList.innerHTML = users
    .map((user, index) => {
      const displayName = user.nickname || user.username || '匿名用户';
      return `
        <li class="home-heat-item">
          <a href="/profile?uid=${encodeURIComponent(user.uid || user.username)}">
            <span class="home-heat-rank">${index + 1}</span>
            <img src="${escapeHtml(getAvatarUrl(user.avatarPath))}" alt="" />
            <span class="home-heat-user-copy">
              <strong>${escapeHtml(displayName)}</strong>
              <small>${index === 0 ? '本期领跑' : '社区贡献'}</small>
            </span>
            <span class="home-heat-score">
              <strong>${Number(user.heat || 0)}</strong>
              <small>热力</small>
            </span>
          </a>
        </li>
      `;
    })
    .join('');
}

function renderHeatLeaderboardLoading() {
  if (!homeHeatList) {
    return;
  }

  homeHeatList.innerHTML = Array.from(
    { length: 5 },
    () => `
      <li class="home-heat-loading-item" aria-hidden="true">
        <span class="home-loading-rank"></span>
        <span class="home-loading-avatar"></span>
        <span class="home-loading-meta"></span>
      </li>
    `,
  ).join('');
}

async function loadHeatLeaderboard() {
  if (!homeHeatList) {
    return;
  }

  homeHeatList.setAttribute('aria-busy', 'true');
  renderHeatLeaderboardLoading();
  if (homeHeatStatus) {
    homeHeatStatus.textContent = '正在加载热力榜…';
  }

  try {
    const payload = await callApi('/leaderboard/heat?limit=5', {
      method: 'GET',
    });
    const users = payload.users || [];
    renderHeatLeaderboard(users);
    if (homeHeatStatus) {
      homeHeatStatus.textContent = `已加载热力榜前 ${users.length} 名`;
    }
  } catch {
    homeHeatList.innerHTML = `
      <li class="home-dashboard-empty">
        <p>热力榜暂时无法加载。</p>
        <button type="button" data-action="retry-home-heat">重新加载</button>
      </li>
    `;
    if (homeHeatStatus) {
      homeHeatStatus.textContent = '热力榜加载失败';
    }
  } finally {
    homeHeatList.setAttribute('aria-busy', 'false');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getCopySuccessMessage(format) {
  if (format === 'word') {
    return '复制成功！请在word中粘贴使用';
  }

  if (format === 'latex') {
    return '复制成功！请复制到overleaf或其他latex编辑软件中使用';
  }

  return '复制成功';
}

function showCopySuccessPopup(format) {
  let popup = document.getElementById('copy-success-popup');

  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'copy-success-popup';
    popup.className = 'copy-success-popup hidden';
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'polite');
    document.body.append(popup);
  }

  window.clearTimeout(Number(popup.dataset.timer || 0));
  popup.textContent = getCopySuccessMessage(format);
  popup.classList.remove('hidden');
  popup.classList.remove('is-visible');
  window.requestAnimationFrame(() => {
    popup.classList.add('is-visible');
  });
  popup.dataset.timer = String(
    window.setTimeout(() => {
      popup.classList.remove('is-visible');
      window.setTimeout(() => popup.classList.add('hidden'), 180);
    }, 2200),
  );
}

function renderCurrency(type, value) {
  const iconMap = {
    electric: 'electron',
    magnetic: 'magnetron',
    heat: 'flame',
  };
  const labelMap = {
    electric: '电元',
    magnetic: '磁元',
    heat: '热力',
  };
  const icon = iconMap[type] || 'electron';
  const label = labelMap[type] || '电元';

  return `
    <span class="currency currency-${type}" data-tooltip="${label}" aria-label="${label}">
      <img class="currency-icon" src="/assets/icons/${icon}.svg" alt="${label}" />
      <span class="currency-value">${value}</span>
    </span>
  `;
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function renderUser() {
  if (isAiChatPage()) {
    document.body.classList.add('is-ai-session-ready');
    document.body.classList.toggle('is-ai-authenticated', userState.isLoggedIn);
  }

  if (isEconomyPage()) {
    document.body.classList.toggle('is-economy-authenticated', userState.isLoggedIn);
  }

  if (!userState.isLoggedIn) {
    userName.textContent = '登录/注册';
    userName.disabled = false;
    if (userRole) {
      userRole.textContent = '学生';
    }
    userSettingsButton?.classList.add('hidden');
    userLogoutButton?.classList.add('hidden');
    userStatus.innerHTML = [
      renderCurrency('electric', '-'),
      renderCurrency('magnetic', '-'),
      renderCurrency('heat', '-'),
    ].join('');
    avatarImages.forEach((image) => {
      image.src = DEFAULT_AVATAR;
    });
    avatarButtons.forEach((button) => {
      button.setAttribute('aria-label', '登录或注册');
    });
    document.querySelectorAll('.aichat-message-user .aichat-avatar-image').forEach((image) => {
      image.src = DEFAULT_AVATAR;
    });
    renderAiDialogList();
    renderDiscussionComposerState();
    return;
  }

  userName.textContent = userState.fullName || userState.username;
  userName.disabled = true;
  if (userRole) {
    userRole.textContent = userState.isAdmin
      ? '管理员'
      : USER_ROLE_LABELS[userState.role] || '学生';
  }
  userSettingsButton?.classList.remove('hidden');
  userLogoutButton?.classList.remove('hidden');
  userStatus.innerHTML = [
    renderCurrency('electric', userState.electrons),
    renderCurrency('magnetic', userState.manetrons),
    renderCurrency('heat', userState.heat),
  ].join('');
  avatarImages.forEach((image) => {
    image.src = getAvatarUrl(userState.avatarPath);
  });
  avatarButtons.forEach((button) => {
    button.setAttribute('aria-label', '打开账户设置');
  });
  document.querySelectorAll('.aichat-message-user .aichat-avatar-image').forEach((image) => {
    image.src = getAvatarUrl(userState.avatarPath);
  });
  renderAiDialogList();

  if (settingsAvatarImage) {
    settingsAvatarImage.src = getAvatarUrl(userState.avatarPath);
  }

  renderDiscussionComposerState();
}

function setAdminMessage(message, autoHideDelay = 0) {
  window.clearTimeout(adminMessageTimer);
  adminMessageTimer = 0;
  if (adminMessage) {
    adminMessage.textContent = message || '';
  }
  if (adminMessage && message && autoHideDelay > 0) {
    adminMessageTimer = window.setTimeout(() => {
      if (adminMessage.textContent === message) {
        adminMessage.textContent = '';
      }
      adminMessageTimer = 0;
    }, autoHideDelay);
  }
}

function setSettingsMessage(message) {
  if (settingsMessage) {
    settingsMessage.textContent = message || '';
  }
}

function setSettingsPasswordMessage(message) {
  if (settingsPasswordMessage) {
    settingsPasswordMessage.textContent = message || '';
  }
}

function setDiscussionMessage(message) {
  if (discussionComposeMessage) {
    discussionComposeMessage.textContent = message || '';
  }
}

function openModal(mode = 'login') {
  window.location.href = mode === 'register' ? '/register' : '/login';
}

function saveSession(token, user) {
  userState.isLoggedIn = true;
  userState.token = token;
  userState.uid = user.uid || '';
  userState.username = user.username;
  userState.fullName = user.fullName || '';
  userState.studentId = user.studentId || '';
  userState.role = user.role || 'student';
  userState.isAdmin = Boolean(user.isAdmin || user.role === 'admin');
  userState.avatarPath = user.avatarPath || '';
  userState.bio = user.bio || '';
  userState.websiteUrl = user.websiteUrl || '';
  userState.electrons = user.electrons ?? 0;
  userState.manetrons = user.manetrons ?? 0;
  userState.heat = user.heat ?? 0;
  localStorage.setItem(STORAGE_KEY, token);
  renderUser();
  loadAiDialogs();
  renderSettingsForm();
  renderAdminSection();
}

function clearSession() {
  userState.isLoggedIn = false;
  userState.token = '';
  userState.uid = '';
  userState.username = '';
  userState.fullName = '';
  userState.studentId = '';
  userState.role = '';
  userState.isAdmin = false;
  userState.avatarPath = '';
  userState.bio = '';
  userState.websiteUrl = '';
  userState.electrons = 0;
  userState.manetrons = 0;
  userState.heat = 0;
  localStorage.removeItem(STORAGE_KEY);
  aiChatState.currentDid = '';
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
      'Content-Type': 'application/json',
      ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.detail ? `${payload.message}：${payload.detail}` : payload.message || '请求失败',
    );
  }

  return payload;
}

async function restoreSession() {
  if (!userState.token) {
    if (isSettingsPage() || isAdminManagementPage()) {
      window.location.replace('/login');
      return;
    }
    renderUser();
    return;
  }

  try {
    const payload = await callApi('/auth/me', {
      method: 'GET',
    });

    saveSession(userState.token, payload.user);

    if (isAdminManagementPage() && !userState.isAdmin) {
      window.location.replace('/');
    }
  } catch {
    clearSession();
    if (isSettingsPage() || isAdminManagementPage()) {
      window.location.replace('/login');
    }
  }
}

async function loadFortuneConfig() {
  try {
    const payload = await callApi('/fortune-config', {
      method: 'GET',
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
  return isCurrentPath('/settings');
}

function isAdminUsersPage() {
  return isCurrentPath('/adminusers');
}

function isSystemSettingsPage() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  return path === '/system-settings' || path.startsWith('/system-settings/');
}

function isAdminManagementPage() {
  return isAdminUsersPage() || isSystemSettingsPage();
}

function isDiscussionPage() {
  return isCurrentPath('/discussion');
}

function isAiChatPage() {
  return isCurrentPath('/aichat');
}

function isElectromagneticPage() {
  return isCurrentPath('/electromagnetic');
}

function isInventoryPage() {
  return isCurrentPath('/inventory');
}

function isEconomyPage() {
  return isElectromagneticPage() || isInventoryPage();
}

function isPublicProfilePage() {
  return isCurrentPath('/profile');
}

function isCurrentPath(pagePath) {
  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  return pathname === pagePath || pathname === `${pagePath}.html`;
}

function getProfileUidFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('uid') || params.get('studentId') || '').trim();
}

function isValidPublicUid(uid) {
  const value = String(uid || '').trim();
  return /^u_?[a-z0-9]{6,32}$/i.test(value) || /^20\d{8}$/.test(value);
}

function getProfileHref(uid) {
  if (!isValidPublicUid(uid)) {
    return '';
  }

  return `/profile?uid=${encodeURIComponent(uid)}`;
}

function renderAuthorProfileLink(author, className, includeAvatar = false) {
  const displayName = escapeHtml(
    author?.displayName || author?.fullName || author?.username || '匿名用户',
  );
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
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return '';
  }
}

function setPublicProfileMessage(message) {
  if (publicProfileMessage) {
    publicProfileMessage.textContent = message || '';
  }
}

function getDiscussionQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    board:
      String(params.get('board') || 'all')
        .trim()
        .toLowerCase() || 'all',
    postId: String(params.get('post') || '').trim(),
  };
}

function updateDiscussionQuery({ board, postId } = {}) {
  if (!isDiscussionPage()) {
    return;
  }

  const url = new URL(window.location.href);

  if (board && board !== 'all') {
    url.searchParams.set('board', board);
  } else {
    url.searchParams.delete('board');
  }

  if (postId) {
    url.searchParams.set('post', String(postId));
  } else {
    url.searchParams.delete('post');
  }

  window.history.replaceState({}, '', url);
}

function setHomeFeedStatus(message) {
  if (homeFeedStatus) {
    homeFeedStatus.textContent = message || '';
  }
}

function updateHomeFeedToggle() {
  if (!homeFeedToggle || !homeFeedModeLabel) {
    return;
  }

  const isHot = homeDashboardState.feedMode === 'hot';
  const currentLabel = isHot ? '热帖' : '最新帖';
  const nextLabel = isHot ? '最新帖' : '热帖';

  homeFeedModeLabel.textContent = currentLabel;
  homeFeedToggle.setAttribute('aria-pressed', String(isHot));
  homeFeedToggle.setAttribute('aria-label', '热帖优先');
  homeFeedToggle.title = `切换到${nextLabel}`;
}

function renderHomeFeedLoading() {
  if (!homeDiscussionList) {
    return;
  }

  homeDiscussionList.setAttribute('aria-busy', 'true');
  homeDiscussionList.innerHTML = Array.from(
    { length: 5 },
    () => `
      <article class="home-feed-loading-item" aria-hidden="true">
        <span class="home-loading-kicker"></span>
        <span class="home-loading-title"></span>
        <span class="home-loading-meta"></span>
      </article>
    `,
  ).join('');
}

function getHomePostReactionCount(post) {
  return (
    Number(post.likeCount || 0) + Number(post.lightCount || 0) + Number(post.fireworksCount || 0)
  );
}

function renderHomeDiscussionPosts(posts, mode = homeDashboardState.feedMode) {
  if (!homeDiscussionList) {
    return;
  }

  if (!posts.length) {
    homeDiscussionList.innerHTML = `
      <article class="home-dashboard-empty">
        <p>暂时没有${mode === 'hot' ? '热帖' : '最新帖子'}。</p>
        <a href="/discussion">进入讨论区发帖</a>
      </article>
    `;
    return;
  }

  homeDiscussionList.innerHTML = posts
    .map((post) => {
      const reactionCount = getHomePostReactionCount(post);
      const commentCount = Number(post.commentCount || 0);
      const authorName =
        post.author?.displayName || post.author?.fullName || post.author?.username || '匿名用户';
      const boardSlug = post.board?.slug || 'all';
      const boardName = post.board?.name || '全部';

      return `
        <a
          class="home-feed-item"
          role="listitem"
          href="/discussion?board=${encodeURIComponent(boardSlug)}&post=${encodeURIComponent(post.id)}"
        >
          <span class="home-feed-item-top">
            <span class="home-feed-board">r/${escapeHtml(boardName)}</span>
            ${post.isPinned ? '<span class="home-feed-badge">置顶</span>' : ''}
            ${post.isFeatured ? '<span class="home-feed-badge">精华</span>' : ''}
            <time datetime="${escapeHtml(post.createdAt)}">${escapeHtml(formatDateOnly(post.createdAt))}</time>
          </span>
          <h3 class="home-feed-title">${escapeHtml(post.title)}</h3>
          <span class="home-feed-meta">
            <span class="home-feed-author">${escapeHtml(authorName)}</span>
            <span
              class="home-feed-signals"
              aria-label="${commentCount} 条评论，${reactionCount} 个反应"
            >
              <span class="home-feed-signal">评论 ${commentCount}</span>
              <span class="home-feed-signal">反应 ${reactionCount}</span>
            </span>
          </span>
        </a>
      `;
    })
    .join('');
}

function renderHomeDiscussionError() {
  if (!homeDiscussionList) {
    return;
  }

  homeDiscussionList.innerHTML = `
    <article class="home-dashboard-empty">
      <p>帖子暂时无法加载。</p>
      <button type="button" data-action="retry-home-feed">重新加载</button>
    </article>
  `;
}

function renderHomeBoardActivity(boards) {
  if (!homeBoardActivity) {
    return;
  }

  if (!boards.length) {
    homeBoardActivity.innerHTML = `
      <div class="home-dashboard-empty">
        <p>还没有分区互动记录。</p>
      </div>
    `;
    return;
  }

  const maxInteractions = Math.max(
    1,
    ...boards.map((board) => Number(board.interactionCount || 0)),
  );

  homeBoardActivity.innerHTML = boards
    .map((board) => {
      const postCount = Number(board.postCount || 0);
      const commentCount = Number(board.commentCount || 0);
      const reactionCount = Number(board.reactionCount || 0);
      const interactionCount = Number(board.interactionCount ?? commentCount + reactionCount);

      return `
        <a
          class="home-board-item"
          role="listitem"
          href="/discussion?board=${encodeURIComponent(board.slug || 'all')}"
        >
          <span class="home-board-item-head">
            <strong class="home-board-name"># ${escapeHtml(board.name || board.slug)}</strong>
            <span class="home-board-interactions">${interactionCount} 次互动</span>
          </span>
          <progress
            class="home-board-progress"
            max="${maxInteractions}"
            value="${interactionCount}"
            aria-hidden="true"
          >${interactionCount}</progress>
          <span class="home-board-meta">
            ${postCount} 帖 · ${commentCount} 评论 · ${reactionCount} 反应
          </span>
        </a>
      `;
    })
    .join('');
}

function useFallbackDiscussionData() {
  discussionState.boards = FALLBACK_DISCUSSION_BOARDS;
  discussionState.posts = [FALLBACK_DISCUSSION_POST];
  discussionState.activeBoard = 'daily';
  discussionState.isFallback = true;
}

function renderDiscussionBoards() {
  if (!discussionBoardList) {
    return;
  }

  const boards = [
    {
      slug: 'all',
      name: '全部',
      description: '所有版块的最新帖子',
    },
    ...discussionState.boards,
  ];

  discussionBoardList.innerHTML = boards
    .map(
      (board) => `
    <button
      class="discussion-board-chip ${discussionState.activeBoard === board.slug ? 'is-active' : ''}"
      type="button"
      data-board-slug="${board.slug}"
      title="${escapeHtml(board.description || board.name)}"
      aria-pressed="${discussionState.activeBoard === board.slug ? 'true' : 'false'}"
    >
      <span class="discussion-board-name">${escapeHtml(board.name)}</span>
    </button>
  `,
    )
    .join('');

  renderDiscussionBoardAbout();
}

function getActiveDiscussionBoard() {
  if (discussionState.activeBoard === 'all') {
    return {
      slug: 'all',
      name: '全部',
      descriptionMarkdown: '所有版块的最新帖子。',
      canModerate: false,
    };
  }

  return discussionState.boards.find((board) => board.slug === discussionState.activeBoard) || null;
}

function renderDiscussionBoardAbout() {
  if (!discussionBoardAboutTitle || !discussionBoardAboutBody) {
    return;
  }

  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById('discussion-board-about');

  if (!board || board.slug === 'all') {
    aboutBox?.classList.add('hidden');
    return;
  }

  aboutBox?.classList.remove('hidden');
  aboutBox?.classList.remove('is-editing', 'is-managing-moderators');
  discussionBoardAboutTitle.textContent = `${board.name}版块`;
  discussionBoardAboutBody.innerHTML = renderMarkdownContent(
    board.descriptionMarkdown || board.description || '暂无说明。',
  );
  enhanceMarkdownContent(discussionBoardAboutBody);

  if (discussionBoardEdit) {
    discussionBoardEdit.classList.toggle('hidden', !board.canModerate);
    discussionBoardEdit.textContent = '编辑';
  }

  if (discussionBoardModerators) {
    discussionBoardModerators.classList.toggle('hidden', !board.canManageModerators);
    discussionBoardModerators.textContent = '管理版主';
  }
}

function renderDiscussionComposeBoards() {
  if (!discussionComposeBoard) {
    return;
  }

  const availableBoards = discussionState.boards.filter(
    (board) => board.slug !== 'changelog' || userState.isAdmin,
  );

  discussionComposeBoard.innerHTML = availableBoards
    .map(
      (board) => `
    <option value="${board.slug}">${escapeHtml(board.name)}</option>
  `,
    )
    .join('');

  const preferredBoard =
    discussionState.activeBoard !== 'all' &&
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

  discussionPostList.innerHTML = discussionState.posts
    .map(
      (post) => `
    <article
      class="discussion-post-card ${discussionState.activePostId === post.id ? 'is-active' : ''}"
      data-post-id="${escapeHtml(post.id)}"
    >
      <div class="discussion-post-author">
        ${renderAuthorProfileLink(post.author, 'discussion-author-link discussion-author-link-avatar', true)}
      </div>
      <div class="discussion-post-card-main">
        <div class="discussion-post-source">
          <span class="discussion-post-board">r/${escapeHtml(post.board.name)}</span>
          ${post.isPinned ? `<span class="discussion-pin-badge">置顶</span>` : ''}
          ${post.isFeatured ? `<span class="discussion-feature-badge">精华</span>` : ''}
          ${renderAuthorProfileLink(post.author, 'discussion-author-link')}
          <span>${escapeHtml(formatDateOnly(post.createdAt))}</span>
        </div>
        <h3>
          <button
            class="discussion-post-title"
            type="button"
            data-action="open-post"
            data-post-id="${escapeHtml(post.id)}"
          >
            ${escapeHtml(post.title)}
          </button>
        </h3>
        <div class="discussion-post-actions">
          <span class="discussion-comment-count" title="评论">
            <img src="/assets/icons/chats.svg" alt="" aria-hidden="true" />
            <strong>${post.commentCount || 0}</strong>
          </span>
          <div class="discussion-inline-reactions" aria-label="帖子反应">
            ${renderDiscussionReactionButton(post, 'smile')}
            ${renderDiscussionReactionButton(post, 'light')}
            ${renderDiscussionReactionButton(post, 'fireworks')}
          </div>
          ${post.canDelete ? `<button class="discussion-delete-action" type="button" data-action="delete-post" data-post-id="${escapeHtml(post.id)}"><img class="discussion-action-icon" src="/assets/icons/trash.svg" alt="" aria-hidden="true" /><span>删除</span></button>` : ''}
        </div>
      </div>
      <span class="discussion-post-open" aria-hidden="true">↗</span>
    </article>
  `,
    )
    .join('');
}

function renderDiscussionReactionButton(post, reactionType) {
  const reaction = DISCUSSION_REACTIONS[reactionType];

  if (!reaction) {
    return '';
  }

  const active = Boolean(post[reaction.activeKey]);
  const icon = active ? reaction.activeIcon : reaction.inactiveIcon;

  return `
    <button
      class="discussion-reaction-button ${active ? 'is-reacted' : ''}"
      type="button"
      data-action="toggle-reaction"
      data-reaction-type="${reactionType}"
      data-post-id="${escapeHtml(post.id)}"
      aria-label="${escapeHtml(reaction.label)}"
      aria-pressed="${active ? 'true' : 'false'}"
      title="${escapeHtml(reaction.label)}"
    >
      <img src="${escapeHtml(icon)}" alt="" aria-hidden="true" />
      <strong>${post[reaction.countKey] || 0}</strong>
    </button>
  `;
}

function renderMarkdownContent(markdown) {
  const mathBlocks = [];
  const placeholderNonce =
    window.crypto?.randomUUID?.().replace(/-/g, '') ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const placeholderPrefix = `FREE_BBS_MATH_TOKEN_${placeholderNonce}_`;
  const protectedMarkdown = String(markdown || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression) => {
      const token = `${placeholderPrefix}${mathBlocks.length}`;
      mathBlocks.push({
        displayMode: true,
        expression: String(expression || '').trim(),
      });
      return `\n\n${token}\n\n`;
    })
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix, expression) => {
      const token = `${placeholderPrefix}${mathBlocks.length}`;
      mathBlocks.push({
        displayMode: false,
        expression: String(expression || '').trim(),
      });
      return `${prefix}${token}`;
    });

  const renderedMarkdown = window.marked?.parse
    ? window.marked.parse(protectedMarkdown, {
        gfm: true,
        breaks: true,
      })
    : escapeHtml(protectedMarkdown).replace(/\n/g, '<br />');

  const safeRenderedMarkdown = sanitizeRenderedMarkdown(renderedMarkdown);

  const renderMathBlock = (index) => {
    const mathBlock = mathBlocks[Number(index)];

    if (!mathBlock) {
      return null;
    }

    if (window.katex?.renderToString) {
      return window.katex.renderToString(mathBlock.expression, {
        displayMode: mathBlock.displayMode,
        throwOnError: false,
        trust: false,
      });
    }

    const delimiter = mathBlock.displayMode ? '$$' : '$';
    return `${delimiter}${escapeHtml(mathBlock.expression)}${delimiter}`;
  };

  if (typeof document === 'undefined') {
    return safeRenderedMarkdown;
  }

  const resultTemplate = document.createElement('template');
  resultTemplate.innerHTML = safeRenderedMarkdown;
  const mathTokenPattern = new RegExp(`${placeholderPrefix}(\\d+)`, 'g');
  const standaloneMathTokenPattern = new RegExp(`^\\s*${placeholderPrefix}(\\d+)\\s*$`);
  const textNodes = [];
  const walker = document.createTreeWalker(resultTemplate.content, window.NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  const createMathFragment = (index) => {
    const renderedMath = renderMathBlock(index);

    if (renderedMath === null) {
      return null;
    }

    const mathTemplate = document.createElement('template');
    mathTemplate.innerHTML = renderedMath;
    return mathTemplate.content;
  };

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || '';
    mathTokenPattern.lastIndex = 0;

    if (!mathTokenPattern.test(text)) {
      return;
    }

    const standaloneMatch = text.match(standaloneMathTokenPattern);
    const parent = textNode.parentElement;

    if (standaloneMatch && parent?.tagName === 'P' && parent.childNodes.length === 1) {
      const mathFragment = createMathFragment(standaloneMatch[1]);

      if (mathFragment) {
        parent.replaceWith(mathFragment);
      }
      return;
    }

    const replacement = document.createDocumentFragment();
    let previousIndex = 0;
    mathTokenPattern.lastIndex = 0;

    text.replace(mathTokenPattern, (match, index, offset) => {
      replacement.append(document.createTextNode(text.slice(previousIndex, offset)));
      const mathFragment = createMathFragment(index);

      if (mathFragment) {
        replacement.append(mathFragment);
      } else {
        replacement.append(document.createTextNode(match));
      }

      previousIndex = offset + match.length;
      return match;
    });

    replacement.append(document.createTextNode(text.slice(previousIndex)));
    textNode.replaceWith(replacement);
  });

  return resultTemplate.innerHTML;
}

const SAFE_MARKDOWN_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const DROP_MARKDOWN_TAGS = new Set([
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'link',
  'meta',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'template',
  'textarea',
]);
const SAFE_MARKDOWN_ATTRIBUTES_BY_TAG = {
  a: new Set(['href', 'title']),
  code: new Set(['class']),
  img: new Set(['alt', 'src', 'title']),
  input: new Set(['checked', 'disabled', 'type']),
  li: new Set(['class', 'value']),
  ol: new Set(['class', 'reversed', 'start', 'type']),
  p: new Set(['class']),
  pre: new Set(['class']),
  table: new Set(['class']),
  td: new Set(['align', 'colspan', 'rowspan']),
  th: new Set(['align', 'colspan', 'rowspan']),
  ul: new Set(['class']),
};

function isSafeRenderedMarkdownUrl(value, attributeName) {
  const rawValue = String(value || '').trim();
  const hasUnsafeControlCharacter = Array.from(rawValue).some((character) => {
    const codePoint = character.codePointAt(0);
    return (codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159);
  });

  if (!rawValue || hasUnsafeControlCharacter) {
    return false;
  }

  if (attributeName === 'href' && rawValue.startsWith('#')) {
    return true;
  }

  try {
    const url = new URL(rawValue, window.location.href);
    const allowedProtocols =
      attributeName === 'src'
        ? new Set(['http:', 'https:'])
        : new Set(['http:', 'https:', 'mailto:', 'tel:']);
    return allowedProtocols.has(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeRenderedMarkdown(html) {
  if (typeof document === 'undefined') {
    return escapeHtml(String(html || ''));
  }

  const template = document.createElement('template');
  template.innerHTML = String(html || '');

  Array.from(template.content.querySelectorAll('*')).forEach((element) => {
    const tagName = element.tagName.toLowerCase();

    if (!SAFE_MARKDOWN_TAGS.has(tagName)) {
      if (DROP_MARKDOWN_TAGS.has(tagName)) {
        element.remove();
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      return;
    }

    const allowedAttributes = SAFE_MARKDOWN_ATTRIBUTES_BY_TAG[tagName] || new Set();
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || '';

      if (!allowedAttributes.has(name)) {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'src') && !isSafeRenderedMarkdownUrl(value, name)) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === 'class') {
        const safeClasses = value
          .split(/\s+/)
          .filter(
            (className) =>
              /^(?:contains-task-list|task-list-item)$/.test(className) ||
              /^language-[\w#+.-]{1,48}$/.test(className),
          );

        if (safeClasses.length) {
          element.setAttribute('class', safeClasses.join(' '));
        } else {
          element.removeAttribute('class');
        }
        return;
      }

      if (name === 'align' && !/^(?:left|center|right)$/i.test(value)) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (
        ['colspan', 'rowspan'].includes(name) &&
        (!/^\d{1,2}$/.test(value) || Number(value) < 1)
      ) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (['start', 'value'].includes(name) && !/^-?\d{1,9}$/.test(value)) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (tagName === 'ol' && name === 'type' && !/^[1aAiI]$/.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });

    if (tagName === 'input') {
      if (element.getAttribute('type') !== 'checkbox') {
        element.remove();
        return;
      }

      element.setAttribute('disabled', '');
    }
  });

  return template.innerHTML;
}

function shouldWaitForMaxReply(contentMarkdown) {
  return /(^|[^\p{L}\p{N}_])@max(?=$|[^\p{L}\p{N}_])/iu.test(String(contentMarkdown || ''));
}

function applyMathRendering(root) {
  if (!root || typeof window.renderMathInElement !== 'function') {
    return;
  }

  window.renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true },
    ],
    throwOnError: false,
    trust: false,
  });
}

function addCodeCopyButtons(root) {
  root?.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-copy-button')) {
      return;
    }

    const code = pre.querySelector('code');
    const language = getCodeBlockLanguage(code);
    const button = document.createElement('button');
    button.className = 'code-copy-button';
    button.type = 'button';
    button.dataset.action = 'toggle-code-copy-menu';
    button.title = '复制代码';
    button.setAttribute('aria-label', '复制代码');
    button.dataset.code = code?.textContent || pre.textContent || '';
    button.dataset.language = language;
    button.innerHTML = `<img src="/assets/icons/copy.svg" alt="" aria-hidden="true" />`;
    pre.append(button);
    pre.append(createCodeCopyMenu());
  });
}

function createCodeCopyMenu() {
  const menu = document.createElement('div');
  menu.className = 'code-copy-menu hidden';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="text">纯文本</button>
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="latex">LaTeX</button>
    <button type="button" role="menuitem" data-action="copy-code" data-copy-format="word">Word</button>
  `;
  return menu;
}

function normalizeCodeLanguageName(language) {
  const value = String(language || '')
    .trim()
    .toLowerCase();

  if (value === 'python' || value === 'py' || value === 'python3') {
    return 'python';
  }

  if (value === 'matlab' || value === 'm') {
    return 'matlab';
  }

  if (value === 'java') {
    return 'java';
  }

  if (value === 'c' || value === 'gcc') {
    return 'c';
  }

  if (
    value === 'cpp' ||
    value === 'c++' ||
    value === 'cplusplus' ||
    value === 'cc' ||
    value === 'cxx' ||
    value === 'g++'
  ) {
    return 'cpp';
  }

  if (
    value === 'bash' ||
    value === 'sh' ||
    value === 'shell' ||
    value === 'zsh' ||
    value === 'terminal' ||
    value === 'console'
  ) {
    return 'bash';
  }

  return value;
}

function getCodeBlockLanguage(code) {
  const className = code?.className || '';
  const languageMatch = className.match(/(?:^|\s)language-([^\s]+)/);
  return normalizeCodeLanguageName(languageMatch?.[1] || code?.dataset.language || '');
}

function applyCodeHighlighting(root) {
  const highlighter = window.hljs;

  if (!root || !highlighter?.highlightElement) {
    return;
  }

  highlighter.configure?.({
    ignoreUnescapedHTML: true,
    languages: [
      'python',
      'matlab',
      'java',
      'c',
      'cpp',
      'bash',
      'javascript',
      'json',
      'css',
      'html',
      'xml',
    ],
  });
  highlighter.registerAliases?.(['py', 'python3'], { languageName: 'python' });
  highlighter.registerAliases?.(['m'], { languageName: 'matlab' });
  highlighter.registerAliases?.(['c++', 'cplusplus', 'cc', 'cxx', 'g++'], { languageName: 'cpp' });
  highlighter.registerAliases?.(['gcc'], { languageName: 'c' });
  highlighter.registerAliases?.(['sh', 'shell', 'zsh', 'terminal', 'console'], {
    languageName: 'bash',
  });

  root.querySelectorAll('pre code').forEach((code) => {
    const language = getCodeBlockLanguage(code);

    if (language && highlighter.getLanguage?.(language)) {
      code.className = code.className.replace(/(?:^|\s)language-[^\s]+/g, '').trim();
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

  if (language === 'python') {
    return 'python';
  }

  if (language === 'c' || language === 'cpp') {
    return 'cpp';
  }

  return '';
}

function addCodeRunButtons(root) {
  if (!isAiChatPage()) {
    return;
  }

  root?.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-run-button')) {
      return;
    }

    const code = pre.querySelector('code');
    const language = normalizeRunnableCodeLanguage(code);

    if (!language) {
      return;
    }

    const button = document.createElement('button');
    button.className = 'code-run-button';
    button.type = 'button';
    button.dataset.action = 'run-code';
    button.dataset.language = language;
    button.dataset.code = code?.textContent || '';
    button.title = '运行代码';
    button.setAttribute('aria-label', '运行代码');
    button.innerHTML = `<img src="/assets/icons/run.svg" alt="" aria-hidden="true" />`;
    pre.append(button);
  });
}

function enhanceMarkdownContent(root, { interactiveCodeControls = true } = {}) {
  if (!root) {
    return;
  }

  applyMathRendering(root);
  applyCodeHighlighting(root);
  if (interactiveCodeControls) {
    addCodeCopyButtons(root);
    addCodeRunButtons(root);
  }
  root.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  root.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src') || '';
    if (source.startsWith('/uploads/')) {
      image.src = `${API_ROOT}${source}`;
    }
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
  });
}

function setAiChatStatus(message) {
  if (aiChatStatus) {
    aiChatStatus.textContent = message || '';
    aiChatStatus.classList.toggle(
      'is-thinking',
      Boolean(message && /^Max 正在(?:思考|输入)/.test(message)),
    );
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
  setAiChatStatus('Max 正在思考......');
  aiChatState.statusTimer = window.setTimeout(
    () => {
      setAiChatStatus('Max 正在输入......');
      aiChatState.statusTimer = 0;
    },
    1000 + Math.floor(Math.random() * 4001),
  );
}

function stopAiChatThinkingStatus(message = '') {
  clearAiChatStatusTimer();
  setAiChatStatus(message);
}

function setAiChatThinkingBubble(article, message) {
  const bubble = article?.querySelector('.aichat-bubble');

  if (!bubble || article?.dataset.markdown) {
    return;
  }

  bubble.innerHTML = `<span class="aichat-thinking-inline">${escapeHtml(message)}</span>`;
  scrollAiChatToBottom();
}

function setAiDialogId(did) {
  if (aiChatDialogId) {
    aiChatDialogId.textContent = did ? `did: ${did}` : '';
  }
}

function setAiDialogsOpen(isOpen, { restoreFocus = false } = {}) {
  if (!aiChatShell) {
    return;
  }

  const shouldOpen = Boolean(isOpen && aiChatDrawerMedia.matches);
  const inertTargets = [
    document.querySelector('.topbar'),
    document.querySelector('.mobile-nav'),
    aiChatDialogToggle,
    aiChatMain,
  ].filter(Boolean);

  aiChatShell.classList.toggle('is-dialogs-open', shouldOpen);
  aiChatDialogToggle?.setAttribute('aria-expanded', String(shouldOpen));
  inertTargets.forEach((element) => element.toggleAttribute('inert', shouldOpen));

  if (shouldOpen) {
    aiChatDialogs?.setAttribute('role', 'dialog');
    aiChatDialogs?.setAttribute('aria-modal', 'true');
    window.requestAnimationFrame(() => aiChatDialogClose?.focus());
  } else {
    aiChatDialogs?.removeAttribute('role');
    aiChatDialogs?.removeAttribute('aria-modal');
  }

  if (restoreFocus && !shouldOpen && aiChatDrawerMedia.matches) {
    aiChatDialogToggle?.focus();
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
    aiChatInput.style.height = '';
    return;
  }

  aiChatInput.style.height = 'auto';
  aiChatInput.style.height = `${Math.min(aiChatInput.scrollHeight, 180)}px`;
}

function addAiMessageCopyControls(article) {
  if (
    !article ||
    !article.classList.contains('aichat-message-assistant') ||
    article.querySelector('.aichat-copy-control')
  ) {
    return;
  }

  const control = document.createElement('div');
  control.className = 'aichat-copy-control';
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

function appendAiChatMessage(role, content = '') {
  if (!aiChatThread) {
    return null;
  }

  const article = document.createElement('article');
  article.className = `aichat-message aichat-message-${role}`;
  const avatarUrl = role === 'user' ? getAvatarUrl(userState.avatarPath) : MAX_AGENT_AVATAR;
  const avatarAlt = role === 'user' ? '你的头像' : 'Max 的头像';
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
  const welcome = aiChatThread.querySelector('.aichat-message-assistant');
  if (welcome) {
    welcome.dataset.markdown = '你好，我是 Max。可以问我课程、推导、代码或讨论区里适合展开的问题。';
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
  const bubble = article?.querySelector('.aichat-bubble');

  if (!bubble) {
    return;
  }

  article.dataset.markdown = content || '';
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
    agent: 'general_chat',
    source: 'direct_chat',
    channel: 'aichat',
    did: aiChatState.currentDid || '',
    messages: [
      ...recentMessages,
      {
        role: 'user',
        content: userMessage,
      },
    ],
    stream: true,
    temperature: 0.6,
  };
}

function getAiDialogTitle(messages = aiChatState.messages) {
  const firstUserMessage =
    messages.find((message) => message.role === 'user')?.content || '新的对话';
  return firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 32) || '新的对话';
}

function getAiDialogIdFromUrl() {
  return String(new URLSearchParams(window.location.search).get('did') || '').trim();
}

function updateAiDialogUrl(did, { replace = false } = {}) {
  if (!isAiChatPage()) {
    return;
  }

  const url = new URL(window.location.href);

  if (did) {
    url.searchParams.set('did', did);
  } else {
    url.searchParams.delete('did');
  }

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', url);
}

function renderAiDialogList() {
  if (!aiChatDialogList) {
    return;
  }

  if (!userState.isLoggedIn) {
    aiChatDialogList.innerHTML = `<p class="aichat-dialog-empty">登录后保存最近对话。</p>`;
    setAiDialogId('');
    return;
  }

  if (!aiChatState.dialogs.length) {
    aiChatDialogList.innerHTML = `<p class="aichat-dialog-empty">还没有保存的对话。</p>`;
    setAiDialogId(aiChatState.currentDid);
    return;
  }

  aiChatDialogList.innerHTML = aiChatState.dialogs
    .map(
      (dialog) => `
    <button class="aichat-dialog-item ${dialog.did === aiChatState.currentDid ? 'is-active' : ''}" type="button" data-did="${escapeHtml(dialog.did)}">
      <span>${escapeHtml(dialog.title || '新的对话')}</span>
      <small>${escapeHtml(formatDateTime(dialog.updatedAt || dialog.createdAt))}</small>
    </button>
  `,
    )
    .join('');
  setAiDialogId(aiChatState.currentDid);
}

async function loadAiDialogs() {
  if (!isAiChatPage() || !aiChatDialogList || !userState.token) {
    renderAiDialogList();
    return;
  }

  try {
    const payload = await callApi('/ai/dialogs?limit=20', {
      method: 'GET',
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
    const payload = await callApi('/ai/dialogs', {
      method: 'POST',
      body: JSON.stringify({
        did: aiChatState.currentDid || undefined,
        title: getAiDialogTitle(),
        messages: aiChatState.messages,
      }),
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
    setAiChatStatus('正在加载对话...');
    const payload = await callApi(`/ai/dialogs/${encodeURIComponent(did)}`, {
      method: 'GET',
    });
    aiChatState.currentDid = payload.dialog.did;
    aiChatState.messages = payload.dialog.messages || [];
    if (updateUrl) {
      updateAiDialogUrl(aiChatState.currentDid);
    }
    renderAiChatThread();
    renderAiDialogList();
    setAiChatStatus('');
  } catch (error) {
    setAiChatStatus(error.message);
  }
}

function startNewAiDialog() {
  if (aiChatState.isSending) {
    return;
  }

  clearAiChatStatusTimer();
  aiChatState.currentDid = '';
  aiChatState.messages = [];
  updateAiDialogUrl('');
  renderAiChatThread();
  renderAiDialogList();
  setAiDialogsOpen(false);
  setAiChatStatus('');
  aiChatInput?.focus();
}

async function streamAiChatResponse(payload, onDelta) {
  if (!userState.token) {
    throw new Error('请先登录后再使用问问 Max');
  }

  const response = await fetch(`${API_BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(
      errorPayload.detail
        ? `${errorPayload.message}：${errorPayload.detail}`
        : errorPayload.message || 'AI 请求失败',
    );
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const eventText of events) {
      const dataLine = eventText.split('\n').find((line) => line.startsWith('data:'));

      if (!dataLine) {
        continue;
      }

      const eventPayload = JSON.parse(dataLine.replace(/^data:\s*/, ''));

      if (eventPayload.error) {
        throw new Error(eventPayload.error.message || 'AI 服务返回错误');
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
    openModal('login');
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
  aiChatInput.value = '';
  resizeAiChatInput();
  aiChatInput.disabled = true;
  if (aiChatSend) {
    aiChatSend.disabled = true;
  }
  appendAiChatMessage('user', userMessage);
  const assistantArticle = appendAiChatMessage('assistant', '');
  startAiChatThinkingStatus();
  setAiChatThinkingBubble(assistantArticle, 'Max 正在思考......');
  const bubbleTimer = window.setTimeout(
    () => {
      setAiChatThinkingBubble(assistantArticle, 'Max 正在输入......');
    },
    1000 + Math.floor(Math.random() * 4001),
  );
  let assistantContent = '';

  try {
    await streamAiChatResponse(buildAiChatPayload(userMessage), (delta) => {
      window.clearTimeout(bubbleTimer);
      assistantContent += delta;
      updateAiChatMessage(assistantArticle, assistantContent);
    });

    aiChatState.messages.push({ role: 'user', content: userMessage });
    aiChatState.messages.push({ role: 'assistant', content: assistantContent });
    stopAiChatThinkingStatus();
    await saveAiDialog();
  } catch (error) {
    window.clearTimeout(bubbleTimer);
    updateAiChatMessage(assistantArticle, `请求失败：${error.message}`);
    stopAiChatThinkingStatus('AI 服务不可用，请确认 freebbs-agent 已启动。');
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

  aiChatInput?.addEventListener('input', resizeAiChatInput);
  aiChatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      aiChatForm?.requestSubmit();
    }
  });
  aiChatForm?.addEventListener('submit', handleAiChatSubmit);
  aiChatNewDialog?.addEventListener('click', startNewAiDialog);
  aiChatDialogToggle?.addEventListener('click', () => {
    setAiDialogsOpen(!aiChatShell?.classList.contains('is-dialogs-open'));
  });
  aiChatDialogClose?.addEventListener('click', () =>
    setAiDialogsOpen(false, { restoreFocus: true }),
  );
  aiChatDialogBackdrop?.addEventListener('click', () =>
    setAiDialogsOpen(false, { restoreFocus: true }),
  );
  aiChatDialogList?.addEventListener('click', (event) => {
    const button = event.target.closest('.aichat-dialog-item');

    if (button) {
      loadAiDialog(button.dataset.did || '');
      setAiDialogsOpen(false, { restoreFocus: true });
    }
  });
  aiChatDrawerMedia.addEventListener('change', (event) => {
    if (!event.matches) {
      setAiDialogsOpen(false);
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && aiChatShell?.classList.contains('is-dialogs-open')) {
      setAiDialogsOpen(false, { restoreFocus: true });
    }
  });
  window.addEventListener('popstate', () => {
    const did = getAiDialogIdFromUrl();
    if (did) {
      loadAiDialog(did, { updateUrl: false });
    } else {
      aiChatState.currentDid = '';
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
  discussionLayout?.classList.toggle('is-detail-view', Boolean(isDetailView));
}

function renderDiscussionStats(stats) {
  if (discussionStatsPosts) {
    discussionStatsPosts.textContent = String(
      stats?.postCount ?? discussionState.posts.length ?? 0,
    );
  }

  if (discussionStatsLikes) {
    discussionStatsLikes.textContent = String(stats?.likeCount ?? 0);
  }
}

function getDiscussionCommentDraftKey(postId, parentCommentId = 0) {
  return JSON.stringify([String(postId || ''), Number(parentCommentId || 0)]);
}

function getDiscussionCommentDraft(postId, parentCommentId = 0) {
  return discussionCommentDrafts.get(getDiscussionCommentDraftKey(postId, parentCommentId)) || '';
}

function rememberDiscussionCommentDraft(postId, parentCommentId, value) {
  const key = getDiscussionCommentDraftKey(postId, parentCommentId);
  const draft = String(value || '');

  if (!draft.trim()) {
    discussionCommentDrafts.delete(key);
    return;
  }

  // Reinsert existing drafts so the map also acts as a small LRU cache.
  discussionCommentDrafts.delete(key);
  discussionCommentDrafts.set(key, draft);

  while (discussionCommentDrafts.size > DISCUSSION_COMMENT_DRAFT_LIMIT) {
    discussionCommentDrafts.delete(discussionCommentDrafts.keys().next().value);
  }
}

function clearDiscussionCommentDraft(postId, parentCommentId = 0) {
  discussionCommentDrafts.delete(getDiscussionCommentDraftKey(postId, parentCommentId));
}

function renderDiscussionCommentComposerFields({
  postId,
  parentCommentId = 0,
  rows = 4,
  placeholder,
  ariaLabel,
  inputId = '',
}) {
  const previewId = parentCommentId
    ? `discussion-comment-preview-${Number(parentCommentId)}`
    : 'discussion-comment-preview';
  const draft = getDiscussionCommentDraft(postId, parentCommentId);

  return `
    <div class="discussion-comment-editor">
      <textarea
        class="discussion-comment-input"
        ${inputId ? `id="${escapeHtml(inputId)}"` : ''}
        rows="${Number(rows)}"
        maxlength="5000"
        placeholder="${escapeHtml(placeholder)}"
        aria-label="${escapeHtml(ariaLabel)}"
        aria-controls="${previewId}"
        required
      >${escapeHtml(draft)}</textarea>
      <section class="discussion-comment-preview is-empty" data-comment-preview aria-label="Markdown 实时预览">
        <div class="discussion-comment-preview-head" aria-hidden="true">
          <strong>实时预览</strong>
          <span>Markdown</span>
        </div>
        <div
          class="discussion-comment-preview-body discussion-markdown-body is-empty"
          id="${previewId}"
          data-comment-preview-body
        >
          <p class="discussion-comment-preview-empty">输入 Markdown 后将在这里预览。</p>
        </div>
      </section>
    </div>
  `;
}

function getDiscussionCommentFormContext(inputOrForm) {
  const form = inputOrForm?.closest?.('.discussion-comment-form');

  if (!form) {
    return null;
  }

  return {
    form,
    input: form.querySelector('.discussion-comment-input'),
    parentCommentId: Number(form.dataset.parentCommentId || 0),
    postId: String(
      form.dataset.postId || discussionDetail?.dataset.postId || discussionState.activePostId || '',
    ),
  };
}

function updateDiscussionCommentPreview(form) {
  const context = getDiscussionCommentFormContext(form);
  const preview = context?.form.querySelector('[data-comment-preview]');
  const previewBody = context?.form.querySelector('[data-comment-preview-body]');

  if (!context?.input || !preview || !previewBody) {
    return;
  }

  const markdown = context.input.value;
  const isEmpty = !markdown.trim();
  preview.classList.toggle('is-empty', isEmpty);
  previewBody.classList.toggle('is-empty', isEmpty);

  if (isEmpty) {
    previewBody.innerHTML =
      '<p class="discussion-comment-preview-empty">输入 Markdown 后将在这里预览。</p>';
    return;
  }

  previewBody.innerHTML = renderMarkdownContent(markdown);
  enhanceMarkdownContent(previewBody, {
    interactiveCodeControls: false,
  });
}

function initializeDiscussionCommentComposer(form) {
  const context = getDiscussionCommentFormContext(form);

  if (!context?.input) {
    return;
  }

  rememberDiscussionCommentDraft(context.postId, context.parentCommentId, context.input.value);
  updateDiscussionCommentPreview(context.form);
}

function scheduleDiscussionCommentPreview(input, delay = DISCUSSION_COMMENT_PREVIEW_DELAY_MS) {
  const context = getDiscussionCommentFormContext(input);

  if (!context?.input) {
    return;
  }

  rememberDiscussionCommentDraft(context.postId, context.parentCommentId, context.input.value);

  const pendingTimer = discussionCommentPreviewTimers.get(context.input);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
  }

  const timer = window.setTimeout(() => {
    discussionCommentPreviewTimers.delete(context.input);

    if (context.input.isConnected) {
      updateDiscussionCommentPreview(context.form);
    }
  }, delay);
  discussionCommentPreviewTimers.set(context.input, timer);
}

function clearDiscussionCommentComposer(form) {
  const context = getDiscussionCommentFormContext(form);

  if (!context?.input) {
    return;
  }

  const pendingTimer = discussionCommentPreviewTimers.get(context.input);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
    discussionCommentPreviewTimers.delete(context.input);
  }

  context.input.value = '';
  clearDiscussionCommentDraft(context.postId, context.parentCommentId);
  updateDiscussionCommentPreview(context.form);
}

function handleDiscussionCommentInput(event) {
  const input = event.target.closest?.('.discussion-comment-input');

  if (!input) {
    return;
  }

  const context = getDiscussionCommentFormContext(input);
  if (context) {
    rememberDiscussionCommentDraft(context.postId, context.parentCommentId, context.input.value);
  }

  if (event.isComposing || input.dataset.isComposing === 'true') {
    return;
  }

  scheduleDiscussionCommentPreview(input);
}

function handleDiscussionCommentCompositionStart(event) {
  const input = event.target.closest?.('.discussion-comment-input');
  if (input) {
    input.dataset.isComposing = 'true';
  }
}

function handleDiscussionCommentCompositionEnd(event) {
  const input = event.target.closest?.('.discussion-comment-input');

  if (!input) {
    return;
  }

  delete input.dataset.isComposing;
  // Let the browser commit the final IME value before rendering the preview.
  scheduleDiscussionCommentPreview(input, 0);
}

function getDiscussionCommentById(commentId) {
  return discussionState.comments.find((comment) => String(comment.id) === String(commentId));
}

function getDiscussionCommentAuthorName(comment) {
  return (
    comment?.author?.displayName ||
    comment?.author?.fullName ||
    comment?.author?.username ||
    '这条评论'
  );
}

function renderDiscussionReplyForm(postId, commentId, authorName) {
  return `
    <form
      class="discussion-comment-form discussion-reply-form"
      data-post-id="${escapeHtml(postId)}"
      data-parent-comment-id="${Number(commentId)}"
    >
      ${renderDiscussionCommentComposerFields({
        postId,
        parentCommentId: commentId,
        rows: 3,
        placeholder: `回复 ${authorName}，支持 Markdown 和 KaTeX`,
        ariaLabel: `回复 ${authorName}`,
      })}
      <div class="discussion-compose-actions">
        <p class="discussion-message discussion-comment-message" role="status" aria-live="polite"></p>
        <button class="auth-submit discussion-submit" type="submit">发布回复</button>
      </div>
    </form>
  `;
}

function mountDiscussionReplyForm(slot, postId, commentId, authorName, { focus = false } = {}) {
  slot.innerHTML = renderDiscussionReplyForm(postId, commentId, authorName);
  const form = slot.querySelector('.discussion-reply-form');
  initializeDiscussionCommentComposer(form);

  if (focus) {
    form?.querySelector('.discussion-comment-input')?.focus();
  }
}

function restoreOpenDiscussionReplyComposer() {
  const postId = String(discussionState.activePostId || '');
  const commentId = discussionOpenReplyByPost.get(postId);

  if (!postId || !commentId) {
    return;
  }

  const comment = getDiscussionCommentById(commentId);
  const slot = discussionDetail?.querySelector(`[data-reply-slot="${Number(commentId)}"]`);

  if (!comment || !slot) {
    discussionOpenReplyByPost.delete(postId);
    return;
  }

  mountDiscussionReplyForm(slot, postId, commentId, getDiscussionCommentAuthorName(comment));
}

function renderDiscussionComments() {
  const list = document.getElementById('discussion-comment-list');

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
    <article class="discussion-comment ${depth > 0 ? 'discussion-comment-reply' : ''}" data-comment-id="${comment.id}" data-comment-depth="${displayDepth}" style="--comment-depth: ${displayDepth}">
      ${renderAuthorProfileLink(comment.author, 'discussion-comment-author-link', true)}
      <div class="discussion-comment-body">
        <div class="discussion-comment-meta">
          ${renderAuthorProfileLink(comment.author, 'discussion-author-link')}
          <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
          <button class="discussion-comment-reply-button" type="button" data-action="reply-comment" data-comment-id="${comment.id}" data-author-name="${escapeHtml(comment.author?.displayName || comment.author?.fullName || comment.author?.username || '匿名用户')}">回复</button>
        </div>
        <div class="discussion-comment-content discussion-markdown-body">${renderMarkdownContent(comment.contentMarkdown)}</div>
        <div class="discussion-comment-reply-slot" data-reply-slot="${comment.id}"></div>
      </div>
    </article>
  `;

    return [current, ...replies.map((reply) => renderComment(reply, depth + 1))].join('');
  };

  list.innerHTML = (commentsByParent.get(0) || [])
    .map((comment) => renderComment(comment))
    .join('');

  list
    .querySelectorAll('.discussion-comment-content')
    .forEach((node) => enhanceMarkdownContent(node));
  restoreOpenDiscussionReplyComposer();
}

function renderDiscussionDetail(post) {
  if (!discussionDetail) {
    return;
  }

  if (!post) {
    setDiscussionDetailView(false);
    discussionDetail.classList.add('hidden');
    discussionDetail.innerHTML = '';
    discussionState.activePost = null;
    discussionState.comments = [];
    return;
  }

  setDiscussionDetailView(true);
  discussionDetail.classList.remove('hidden');
  discussionDetail.dataset.postId = String(post.id);
  discussionState.activePost = post;
  discussionDetail.innerHTML = `
    <header class="discussion-detail-head">
      <div class="discussion-detail-toolbar">
        <button class="discussion-detail-back" type="button" data-action="close-detail">
          <img class="discussion-action-icon" src="/assets/icons/return.svg" alt="" aria-hidden="true" />
          <span>返回帖子</span>
        </button>
        ${
          post.canPin || post.canFeature || post.canDelete
            ? `
          <div class="discussion-moderator-actions">
            ${post.canPin ? `<button class="discussion-detail-pin ${post.isPinned ? 'is-active' : ''}" type="button" data-action="toggle-pin" data-post-id="${escapeHtml(post.id)}" data-pinned="${post.isPinned ? '1' : '0'}"><img class="discussion-action-icon" src="/assets/icons/top.svg" alt="" aria-hidden="true" /><span>${post.isPinned ? '取消置顶' : '置顶文章'}</span></button>` : ''}
            ${post.canFeature ? `<button class="discussion-detail-feature ${post.isFeatured ? 'is-active' : ''}" type="button" data-action="toggle-feature" data-post-id="${escapeHtml(post.id)}" data-featured="${post.isFeatured ? '1' : '0'}"><img class="discussion-action-icon" src="/assets/icons/star.svg" alt="" aria-hidden="true" /><span>${post.isFeatured ? '取消精华' : '加精华'}</span></button>` : ''}
            ${post.canDelete ? `<button class="discussion-detail-delete" type="button" data-action="delete-post" data-post-id="${escapeHtml(post.id)}"><img class="discussion-action-icon" src="/assets/icons/trash.svg" alt="" aria-hidden="true" /><span>删除帖子</span></button>` : ''}
          </div>
        `
            : ''
        }
      </div>
      <h2 id="discussion-detail-title" tabindex="-1">${escapeHtml(post.title)}</h2>
      <div class="discussion-detail-meta">
        <span class="discussion-detail-board">#${escapeHtml(post.board.name)}</span>
        ${renderAuthorProfileLink(post.author, 'discussion-author-link')}
        <span>${escapeHtml(formatDateTime(post.createdAt))}</span>
        <div class="discussion-detail-reactions">
          ${renderDiscussionReactionButton(post, 'smile')}
          ${renderDiscussionReactionButton(post, 'light')}
          ${renderDiscussionReactionButton(post, 'fireworks')}
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
      <form
        class="discussion-comment-form"
        id="discussion-comment-form"
        data-post-id="${escapeHtml(post.id)}"
        data-parent-comment-id=""
      >
        ${renderDiscussionCommentComposerFields({
          postId: post.id,
          rows: 4,
          placeholder: '写一条评论，支持 Markdown 和 KaTeX',
          ariaLabel: '评论内容',
          inputId: 'discussion-comment-input',
        })}
        <div class="discussion-compose-actions">
          <p class="discussion-message discussion-comment-message" id="discussion-comment-message" role="status" aria-live="polite"></p>
          <button class="auth-submit discussion-submit" type="submit">发表评论</button>
        </div>
      </form>
      <div class="discussion-comment-list" id="discussion-comment-list">
        <p class="discussion-stats-muted">正在加载评论...</p>
      </div>
    </section>
  `;

  const markdownBody = document.getElementById('discussion-markdown-body');
  enhanceMarkdownContent(markdownBody);
  initializeDiscussionCommentComposer(document.getElementById('discussion-comment-form'));
  loadDiscussionComments(post.id);
}

function renderDiscussionComposerState() {
  if (!discussionCreateToggle || !discussionComposeForm) {
    return;
  }

  if (userState.isLoggedIn) {
    discussionCreateToggle.textContent = discussionState.isFallback ? '重试发布' : '发布帖子';
    discussionCreateToggle.disabled = false;
    return;
  }

  discussionCreateToggle.textContent = '登录后发帖';
  discussionCreateToggle.disabled = false;
  discussionComposeForm.classList.add('hidden');
}

async function loadHomeDiscussionPosts(mode = homeDashboardState.feedMode, { force = false } = {}) {
  if (!homeDiscussionList) {
    return;
  }

  const normalizedMode = mode === 'latest' ? 'latest' : 'hot';
  homeDashboardState.feedMode = normalizedMode;
  updateHomeFeedToggle();

  const cachedPosts = homeDashboardState.feedCache.get(normalizedMode);
  if (cachedPosts && !force) {
    renderHomeDiscussionPosts(cachedPosts, normalizedMode);
    homeDiscussionList.setAttribute('aria-busy', 'false');
    setHomeFeedStatus(`已显示${normalizedMode === 'hot' ? '热帖' : '最新帖'}`);
    return;
  }

  const requestId = homeDashboardState.feedRequestId + 1;
  homeDashboardState.feedRequestId = requestId;
  homeFeedToggle.disabled = true;
  renderHomeFeedLoading();
  setHomeFeedStatus(`正在加载${normalizedMode === 'hot' ? '热帖' : '最新帖'}…`);

  try {
    const query = new URLSearchParams({
      board: 'all',
      limit: '6',
      sort: normalizedMode,
    });
    const payload = await callApi(`/discussion/posts?${query.toString()}`, {
      method: 'GET',
    });

    if (requestId !== homeDashboardState.feedRequestId) {
      return;
    }

    const posts = payload.posts || [];
    homeDashboardState.feedCache.set(normalizedMode, posts);
    renderHomeDiscussionPosts(posts, normalizedMode);
    setHomeFeedStatus(`已显示${normalizedMode === 'hot' ? '热帖' : '最新帖'}`);
  } catch {
    if (requestId === homeDashboardState.feedRequestId) {
      renderHomeDiscussionError();
      setHomeFeedStatus('帖子加载失败');
    }
  } finally {
    if (requestId === homeDashboardState.feedRequestId) {
      homeDiscussionList.setAttribute('aria-busy', 'false');
      homeFeedToggle.disabled = false;
    }
  }
}

function renderHomeBoardLoading() {
  if (!homeBoardActivity) {
    return;
  }

  homeBoardActivity.innerHTML = Array.from(
    { length: 5 },
    () => `
      <div class="home-board-loading-item" aria-hidden="true">
        <span class="home-loading-title"></span>
        <span class="home-loading-meta"></span>
      </div>
    `,
  ).join('');
}

async function loadHomeBoardActivity() {
  if (!homeBoardActivity || homeBoardActivity.dataset.loading === 'true') {
    return;
  }

  homeBoardActivity.dataset.loading = 'true';
  homeBoardActivity.setAttribute('aria-busy', 'true');
  renderHomeBoardLoading();
  if (homeBoardStatus) {
    homeBoardStatus.textContent = '正在加载分区互动数据…';
  }

  try {
    const payload = await callApi('/discussion/stats', {
      method: 'GET',
    });
    const boards = payload.boards || [];
    renderHomeBoardActivity(boards);
    homeBoardActivity.dataset.loaded = 'true';
    if (homeBoardStatus) {
      homeBoardStatus.textContent = `已加载 ${boards.length} 个分区的互动数据`;
    }
  } catch {
    homeBoardActivity.innerHTML = `
      <div class="home-dashboard-empty">
        <p>分区互动暂时无法加载。</p>
        <button type="button" data-action="retry-home-boards">重新加载</button>
      </div>
    `;
    if (homeBoardStatus) {
      homeBoardStatus.textContent = '分区互动数据加载失败';
    }
  } finally {
    homeBoardActivity.setAttribute('aria-busy', 'false');
    delete homeBoardActivity.dataset.loading;
  }
}

function loadHomeBoardActivityForViewport(event = homeBoardDesktopMedia) {
  if (event.matches && homeBoardActivity?.dataset.loaded !== 'true') {
    loadHomeBoardActivity();
  }
}

function handleHomeFeedToggleClick() {
  const nextMode = homeDashboardState.feedMode === 'hot' ? 'latest' : 'hot';
  loadHomeDiscussionPosts(nextMode);
}

function handleHomeDashboardRetry(event) {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  if (button.dataset.action === 'retry-home-feed') {
    loadHomeDiscussionPosts(homeDashboardState.feedMode, { force: true });
  } else if (button.dataset.action === 'retry-home-boards') {
    loadHomeBoardActivity();
  } else if (button.dataset.action === 'retry-home-heat') {
    loadHeatLeaderboard();
  }
}

async function loadDiscussionBoards() {
  try {
    const payload = await callApi('/discussion/boards', {
      method: 'GET',
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
    const payload = await callApi('/discussion/stats', {
      method: 'GET',
    });
    renderDiscussionStats(payload);
  } catch {
    renderDiscussionStats(null);
  }
}

async function loadDiscussionComments(postId) {
  try {
    const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'GET',
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
          messageNode.textContent = 'Max 已回复';
        }
        return;
      }
    } catch {
      // loadDiscussionComments already handles display fallback.
    }

    if (attempts >= 12) {
      window.clearInterval(timer);
      if (messageNode) {
        messageNode.textContent = '评论已发布，Max 可能稍后回复';
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
    fireworksCount: Number(counts.fireworksCount || 0),
  };

  discussionState.posts = discussionState.posts.map((post) =>
    post.id === postId
      ? {
          ...post,
          ...updates,
        }
      : post,
  );

  if (discussionState.activePost?.id === postId) {
    discussionState.activePost = {
      ...discussionState.activePost,
      ...updates,
    };
  }
}

async function toggleDiscussionReaction(postId, reactionType = 'smile') {
  if (!postId) {
    return;
  }

  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}/like`, {
    method: 'POST',
    body: JSON.stringify({ reactionType }),
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

  if (postId === FALLBACK_DISCUSSION_POST.id) {
    discussionState.activePostId = FALLBACK_DISCUSSION_POST.id;
    renderDiscussionPosts();
    renderDiscussionDetail(FALLBACK_DISCUSSION_POST);
    discussionDetail.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId,
    });
    return;
  }

  const cachedPost = discussionState.postCache.get(postId);
  if (cachedPost) {
    discussionState.activePostId = cachedPost.id;
    renderDiscussionPosts();
    renderDiscussionDetail(cachedPost);
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId,
    });
  } else {
    setDiscussionDetailView(true);
    discussionDetail.classList.remove('hidden');
    discussionDetail.innerHTML = `
      <div class="discussion-detail-empty">
        <p>正在加载帖子详情...</p>
      </div>
    `;
  }

  const payload = await callApi(`/discussion/posts/${encodeURIComponent(postId)}`, {
    method: 'GET',
  });
  discussionState.activePostId = payload.post.id;
  discussionState.postCache.set(payload.post.id, payload.post);
  renderDiscussionPosts();
  renderDiscussionDetail(payload.post);
  discussionDetail.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: discussionState.activePostId,
  });
}

async function loadDiscussionPosts({ autoOpen = false } = {}) {
  if (!discussionPostList) {
    return;
  }

  const activeBoard = discussionState.activeBoard || 'all';
  const currentHash = discussionState.postsHashByBoard[activeBoard] || '';

  if (!discussionState.posts.length) {
    discussionPostList.innerHTML = `
      <article class="discussion-empty">
        <p>正在加载帖子...</p>
      </article>
    `;
  }

  try {
    const query = new URLSearchParams({
      board: activeBoard,
      limit: '30',
    });

    if (currentHash) {
      query.set('hash', currentHash);
    }

    const payload = await callApi(`/discussion/posts?${query.toString()}`, {
      method: 'GET',
    });
    if (!payload.notModified) {
      discussionState.posts = payload.posts || [];
      discussionState.postsHashByBoard[activeBoard] = payload.hash || '';
      discussionState.posts.forEach((post) => {
        const cachedPost = discussionState.postCache.get(post.id);
        discussionState.postCache.set(post.id, {
          ...(cachedPost || {}),
          ...post,
        });
      });
    }
  } catch {
    useFallbackDiscussionData();
  }

  if (
    discussionState.activePostId &&
    !discussionState.posts.some((post) => post.id === discussionState.activePostId)
  ) {
    discussionState.activePostId = '';
  }

  renderDiscussionBoards();
  renderDiscussionComposeBoards();
  renderDiscussionPosts();
  loadDiscussionStats();

  if (!autoOpen) {
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId,
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
    postId: '',
  });
}

async function initializeDiscussionPage() {
  if (!isDiscussionPage()) {
    return;
  }

  try {
    await loadDiscussionBoards();

    const query = getDiscussionQueryState();
    const validBoard =
      query.board === 'all' || discussionState.boards.some((board) => board.slug === query.board);
    discussionState.activeBoard = validBoard ? query.board : 'all';
    discussionState.activePostId = '';

    if (query.postId) {
      try {
        const payload = await callApi(`/discussion/posts/${encodeURIComponent(query.postId)}`, {
          method: 'GET',
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
      autoOpen: Boolean(discussionState.activePostId),
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
      publicProfileName.textContent = '未找到用户';
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = '请从帖子作者头像进入个人主页。';
    }
    setPublicProfileMessage('无效用户 UID');
    return;
  }

  setPublicProfileMessage('正在加载个人主页...');

  try {
    const payload = await callApi(`/users/${encodeURIComponent(profileUid)}/public-profile`, {
      method: 'GET',
    });
    const profile = payload.profile || {};

    if (publicProfileAvatar) {
      publicProfileAvatar.src = getAvatarUrl(profile.avatarPath);
    }
    if (publicProfileName) {
      publicProfileName.textContent = profile.username || '未命名用户';
    }
    if (publicProfileStudentId) {
      publicProfileStudentId.textContent = profile.uid ? `UID ${profile.uid}` : '未公开 UID';
    }
    if (publicProfileMajor) {
      const majorParts = [profile.grade, profile.major].filter(Boolean);
      publicProfileMajor.textContent = majorParts.join(' · ') || '未填写院系信息';
    }
    if (publicProfilePostCount) {
      publicProfilePostCount.textContent = String(profile.postCount ?? 0);
    }
    if (publicProfileLikeCount) {
      publicProfileLikeCount.textContent = String(profile.likeCount ?? 0);
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = profile.bio || '这个人很神秘，什么都没写。';
    }
    if (publicProfileWebsite) {
      const websiteUrl = normalizeWebsiteUrl(profile.websiteUrl);
      if (websiteUrl) {
        publicProfileWebsite.innerHTML = `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(profile.websiteUrl)}</a>`;
      } else {
        publicProfileWebsite.textContent = '未填写';
      }
    }

    setPublicProfileMessage('');
  } catch (error) {
    if (publicProfileName) {
      publicProfileName.textContent = '加载失败';
    }
    if (publicProfileBio) {
      publicProfileBio.textContent = '暂时无法获取该用户的公开资料。';
    }
    setPublicProfileMessage(error.message);
  }
}

function normalizeAdminRole(role) {
  return ADMIN_ROLE_OPTIONS.some(([value]) => value === role) ? role : 'student';
}

function getAdminRoleLabel(role) {
  return USER_ROLE_LABELS[normalizeAdminRole(role)] || USER_ROLE_LABELS.student;
}

function getAdminUserInitial(user) {
  return String(user.fullName || user.username || '?')
    .trim()
    .slice(0, 1)
    .toUpperCase();
}

function renderAdminRoleOptions(selectedRole = 'student') {
  const normalizedRole = normalizeAdminRole(selectedRole);
  return ADMIN_ROLE_OPTIONS.map(
    ([role, label]) =>
      `<option value="${role}" ${normalizedRole === role ? 'selected' : ''}>${label}</option>`,
  ).join('');
}

function renderAdminScopeBadges(boardCount, courseCount, isAdmin = false) {
  const badges = [];
  if (isAdmin) {
    badges.push('<span class="admin-user-badge is-admin">管理员</span>');
  }
  if (boardCount > 0) {
    badges.push(`<span class="admin-user-badge">讨论区负责人 · ${Number(boardCount)}</span>`);
  }
  if (courseCount > 0) {
    badges.push(`<span class="admin-user-badge">课程负责人 · ${Number(courseCount)}</span>`);
  }
  if (!badges.length) {
    badges.push('<span class="admin-user-badge is-muted">普通成员</span>');
  }
  return badges.join('');
}

function renderAdminPermissionGroup(title, type, options, activeSlugs = []) {
  const active = new Set(activeSlugs);
  return `
    <fieldset class="admin-permission-group" data-permission-group="${escapeHtml(type)}">
      <legend>
        <span>${escapeHtml(title)}</span>
        <small data-permission-count="${escapeHtml(type)}">${active.size} / ${options.length}</small>
      </legend>
      <div class="admin-permission-options">
        ${
          options.length
            ? options
                .map(
                  (option) => `
            <label class="admin-permission-toggle">
              <input
                type="checkbox"
                data-permission="${escapeHtml(type)}"
                value="${escapeHtml(option.slug)}"
                ${active.has(option.slug) ? 'checked' : ''}
              />
              <span>${escapeHtml(option.name)}</span>
            </label>
          `,
                )
                .join('')
            : '<p class="admin-permission-empty">暂无可分配项目</p>'
        }
      </div>
    </fieldset>
  `;
}

function renderAdminTextField({
  label,
  field,
  value = '',
  type = 'text',
  readonly = false,
  placeholder = '',
  autocomplete = '',
  className = '',
  ownerLabel = '',
}) {
  return `
    <label class="admin-user-field ${className}">
      <span>${escapeHtml(label)}</span>
      <input
        data-field="${escapeHtml(field)}"
        type="${escapeHtml(type)}"
        value="${escapeHtml(value)}"
        ${readonly ? 'readonly' : ''}
        ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
        ${autocomplete ? `autocomplete="${escapeHtml(autocomplete)}"` : ''}
        aria-label="${escapeHtml(ownerLabel ? `${ownerLabel}的${label}` : label)}"
      />
    </label>
  `;
}

function renderAdminUserEditor(user, permissionCatalog) {
  const ownerLabel = user.username || '用户';
  return `
    <div class="admin-user-editor" id="admin-user-editor-${user.id}" hidden>
      <section class="admin-user-editor-section">
        <header>
          <div>
            <h3>账号资料</h3>
            <p>姓名可以修改，其余账号标识保持只读。</p>
          </div>
        </header>
        <div class="admin-user-fields-grid">
          ${renderAdminTextField({
            label: '姓名',
            field: 'fullName',
            value: user.fullName,
            ownerLabel,
          })}
          ${renderAdminTextField({
            label: '用户名',
            field: 'username',
            value: user.username,
            readonly: true,
            ownerLabel,
          })}
          ${renderAdminTextField({
            label: '学号',
            field: 'studentId',
            value: user.studentId,
            readonly: true,
            ownerLabel,
          })}
          ${renderAdminTextField({
            label: '邮箱',
            field: 'email',
            value: user.email,
            type: 'email',
            readonly: true,
            className: 'is-wide',
            ownerLabel,
          })}
        </div>
      </section>

      <section class="admin-user-editor-section">
        <header>
          <div>
            <h3>身份与账户数值</h3>
            <p>管理员权限与教学身份相互独立。</p>
          </div>
        </header>
        <div class="admin-user-access-grid">
          <label class="admin-user-field">
            <span>身份</span>
            <select data-field="role" aria-label="${escapeHtml(ownerLabel)}的身份">
              ${renderAdminRoleOptions(user.role)}
            </select>
          </label>
          <label class="admin-admin-toggle">
            <input data-field="isAdmin" type="checkbox" ${user.isAdmin ? 'checked' : ''} />
            <span class="admin-admin-toggle-control" aria-hidden="true"></span>
            <span>
              <strong>管理员</strong>
              <small>允许管理全站用户与设置</small>
            </span>
          </label>
          <div class="admin-user-balance-fields">
            ${renderAdminTextField({
              label: '电元',
              field: 'electrons',
              value: user.electrons,
              type: 'number',
              ownerLabel,
            })}
            ${renderAdminTextField({
              label: '磁元',
              field: 'manetrons',
              value: user.manetrons,
              type: 'number',
              ownerLabel,
            })}
            ${renderAdminTextField({
              label: '热力',
              field: 'heat',
              value: user.heat || 0,
              type: 'number',
              ownerLabel,
            })}
          </div>
        </div>
      </section>

      <section class="admin-user-editor-section">
        <header>
          <div>
            <h3>负责范围</h3>
            <p>选择该用户可以管理的讨论板块与课程资料。</p>
          </div>
        </header>
        <div class="admin-user-permissions">
          ${renderAdminPermissionGroup(
            '讨论区板块负责人',
            'board',
            permissionCatalog.boards || [],
            user.boardModeratorSlugs || [],
          )}
          ${renderAdminPermissionGroup(
            '课程资料负责人',
            'course',
            permissionCatalog.courses || [],
            user.courseManagerSlugs || [],
          )}
        </div>
      </section>

      <footer class="admin-user-editor-actions">
        <p class="admin-user-card-status" role="status" aria-live="polite">尚未修改</p>
        <div>
          <button class="admin-button admin-button-danger" data-action="delete" type="button">
            删除账号
          </button>
          <button class="admin-button admin-button-primary" data-action="save" type="button">
            保存修改
          </button>
        </div>
      </footer>
    </div>
  `;
}

function renderAdminUserCard(user, permissionCatalog) {
  const boardCount = (user.boardModeratorSlugs || []).length;
  const courseCount = (user.courseManagerSlugs || []).length;
  const normalizedRole = normalizeAdminRole(user.role);
  const searchIndex = [user.uid, user.username, user.fullName, user.studentId, user.email]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return `
    <article
      class="admin-user-row"
      data-user-id="${user.id}"
      data-role="${escapeHtml(normalizedRole)}"
      data-is-admin="${user.isAdmin ? 'true' : 'false'}"
      data-board-count="${boardCount}"
      data-course-count="${courseCount}"
      data-search-index="${escapeHtml(searchIndex)}"
      role="listitem"
    >
      <header class="admin-user-summary">
        <button
          class="admin-user-disclosure"
          data-admin-ui-action="toggle-editor"
          type="button"
          aria-expanded="false"
          aria-controls="admin-user-editor-${user.id}"
        >
          <span class="admin-user-avatar">
            <img
              src="${escapeHtml(getAvatarUrl(user.avatarPath))}"
              alt="${escapeHtml(user.fullName || user.username)}的头像"
            />
            <span aria-hidden="true">${escapeHtml(getAdminUserInitial(user))}</span>
          </span>
          <span class="admin-user-summary-copy">
            <strong data-admin-summary-name>${escapeHtml(user.fullName || user.username)}</strong>
            <small data-admin-summary-meta
              >@${escapeHtml(user.username)} · ${escapeHtml(user.studentId || user.uid || '无学号')}</small
            >
          </span>
          <span class="admin-user-role-badge" data-admin-summary-role>
            ${escapeHtml(getAdminRoleLabel(normalizedRole))}
          </span>
          <span class="admin-user-summary-scopes" data-admin-summary-scopes>
            ${renderAdminScopeBadges(boardCount, courseCount, user.isAdmin)}
          </span>
          <span class="admin-user-disclosure-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
          </span>
        </button>
      </header>
      ${renderAdminUserEditor(user, permissionCatalog)}
    </article>
  `;
}

function setAdminUserCardExpanded(card, expanded) {
  const disclosure = card?.querySelector('[data-admin-ui-action="toggle-editor"]');
  const editor = card?.querySelector('.admin-user-editor');
  if (!card || !disclosure || !editor) {
    return;
  }
  card.classList.toggle('is-expanded', expanded);
  disclosure.setAttribute('aria-expanded', String(expanded));
  editor.hidden = !expanded;
}

function updateAdminUserListFilters() {
  if (!adminUsers) {
    return;
  }
  const query = String(adminUserSearch?.value || '')
    .trim()
    .toLowerCase();
  const roleFilter = adminUserRoleFilter?.value || 'all';
  const scopeFilter = adminUserScopeFilter?.value || 'all';
  const cards = Array.from(
    adminUsers.querySelectorAll('.admin-user-row:not(.admin-user-row-draft)'),
  );
  let visibleCount = 0;

  cards.forEach((card) => {
    const boardCount = Number(card.dataset.boardCount || 0);
    const courseCount = Number(card.dataset.courseCount || 0);
    const matchesQuery = !query || String(card.dataset.searchIndex || '').includes(query);
    const matchesRole =
      roleFilter === 'all' ||
      (roleFilter === 'admin' ? card.dataset.isAdmin === 'true' : card.dataset.role === roleFilter);
    const matchesScope =
      scopeFilter === 'all' ||
      (scopeFilter === 'board' && boardCount > 0) ||
      (scopeFilter === 'course' && courseCount > 0) ||
      (scopeFilter === 'none' && boardCount === 0 && courseCount === 0);
    const keepVisible =
      card.classList.contains('is-expanded') || card.classList.contains('is-dirty');
    const visible = keepVisible || (matchesQuery && matchesRole && matchesScope);
    card.hidden = !visible;
    visibleCount += visible ? 1 : 0;
  });

  if (adminUserVisibleCount) {
    adminUserVisibleCount.textContent = String(visibleCount);
  }
  if (adminUserCountLabel) {
    adminUserCountLabel.textContent =
      visibleCount === cards.length ? '位用户' : ` / ${cards.length} 位用户`;
  }
  adminUserEmpty?.classList.toggle(
    'hidden',
    visibleCount > 0 || Boolean(adminUsers.querySelector('.admin-user-row-draft')),
  );
}

function renderAdminUsers(users, permissionCatalog = adminPermissionCatalog) {
  if (!adminUsers) {
    return;
  }

  adminUsers.innerHTML = users.map((user) => renderAdminUserCard(user, permissionCatalog)).join('');
  if (adminExpandedUserId) {
    const expandedCard = Array.from(adminUsers.querySelectorAll('.admin-user-row')).find(
      (card) => card.dataset.userId === String(adminExpandedUserId),
    );
    setAdminUserCardExpanded(expandedCard, true);
  }
  updateAdminUserListFilters();
}

function renderAdminDraftEditor() {
  return `
    <article
      class="admin-user-row admin-user-row-draft is-expanded"
      data-user-id="draft"
      data-role="student"
      data-is-admin="false"
      data-board-count="0"
      data-course-count="0"
      role="listitem"
    >
      <header class="admin-user-summary is-draft">
        <span class="admin-user-avatar is-new" aria-hidden="true">+</span>
        <span class="admin-user-summary-copy">
          <strong>创建新用户</strong>
          <small>填写登录资料和初始账户设置</small>
        </span>
        <span class="admin-user-badge is-new">新账号</span>
      </header>
      <div class="admin-user-editor">
        <section class="admin-user-editor-section">
          <header>
            <div>
              <h3>登录资料</h3>
              <p>创建后可以继续分配讨论区和课程负责范围。</p>
            </div>
          </header>
          <div class="admin-user-fields-grid">
            ${renderAdminTextField({
              label: '用户名',
              field: 'username',
              placeholder: '至少 3 个字符',
              autocomplete: 'off',
              ownerLabel: '新用户',
            })}
            ${renderAdminTextField({
              label: '姓名',
              field: 'fullName',
              placeholder: '真实姓名',
              ownerLabel: '新用户',
            })}
            ${renderAdminTextField({
              label: '学号',
              field: 'studentId',
              placeholder: '20 开头的 10 位学号',
              ownerLabel: '新用户',
            })}
            ${renderAdminTextField({
              label: '邮箱',
              field: 'email',
              type: 'email',
              placeholder: 'name@example.com',
              ownerLabel: '新用户',
            })}
            ${renderAdminTextField({
              label: '初始密码',
              field: 'password',
              type: 'password',
              placeholder: '至少 6 位',
              autocomplete: 'new-password',
              className: 'is-wide',
              ownerLabel: '新用户',
            })}
          </div>
        </section>

        <section class="admin-user-editor-section">
          <header>
            <div>
              <h3>身份与初始数值</h3>
              <p>负责范围可在账号创建完成后设置。</p>
            </div>
          </header>
          <div class="admin-user-access-grid">
            <label class="admin-user-field">
              <span>身份</span>
              <select data-field="role" aria-label="新用户的身份">
                ${renderAdminRoleOptions('student')}
              </select>
            </label>
            <label class="admin-admin-toggle">
              <input data-field="isAdmin" type="checkbox" />
              <span class="admin-admin-toggle-control" aria-hidden="true"></span>
              <span>
                <strong>管理员</strong>
                <small>允许管理全站用户与设置</small>
              </span>
            </label>
            <div class="admin-user-balance-fields">
              ${renderAdminTextField({
                label: '电元',
                field: 'electrons',
                value: 0,
                type: 'number',
                ownerLabel: '新用户',
              })}
              ${renderAdminTextField({
                label: '磁元',
                field: 'manetrons',
                value: 0,
                type: 'number',
                ownerLabel: '新用户',
              })}
              ${renderAdminTextField({
                label: '热力',
                field: 'heat',
                value: 0,
                type: 'number',
                ownerLabel: '新用户',
              })}
            </div>
          </div>
        </section>

        <footer class="admin-user-editor-actions">
          <p class="admin-user-card-status" role="status" aria-live="polite">
            创建后即可配置负责范围
          </p>
          <div>
            <button class="admin-button admin-button-secondary" data-action="cancel" type="button">
              取消
            </button>
            <button class="admin-button admin-button-primary" data-action="create" type="button">
              创建用户
            </button>
          </div>
        </footer>
      </div>
    </article>
  `;
}

function insertAdminDraftRow() {
  if (!adminUsers) {
    return;
  }
  const existingDraft = adminUsers.querySelector('.admin-user-row-draft');
  if (existingDraft) {
    existingDraft.scrollIntoView({ behavior: 'smooth', block: 'start' });
    existingDraft.querySelector('[data-field="username"]')?.focus();
    return;
  }

  const dirtyCard = adminUsers.querySelector('.admin-user-row:not(.admin-user-row-draft).is-dirty');
  if (dirtyCard) {
    adminUsers
      .querySelectorAll('.admin-user-row:not(.admin-user-row-draft).is-expanded')
      .forEach((card) => setAdminUserCardExpanded(card, false));
    setAdminUserCardExpanded(dirtyCard, true);
    adminExpandedUserId = dirtyCard.dataset.userId || '';
    setAdminUserCardStatus(dirtyCard, '请先保存当前修改，再创建新用户', 'dirty');
    setAdminMessage('请先保存当前账号的修改', 3200);
    dirtyCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  adminUsers.insertAdjacentHTML('afterbegin', renderAdminDraftEditor());
  const draft = adminUsers.querySelector('.admin-user-row-draft');
  adminExpandedUserId = 'draft';
  adminUsers
    .querySelectorAll('.admin-user-row:not(.admin-user-row-draft).is-expanded')
    .forEach((card) => setAdminUserCardExpanded(card, false));
  updateAdminUserListFilters();
  requestAnimationFrame(() => {
    draft?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    draft?.querySelector('[data-field="username"]')?.focus();
  });
}

function setAdminUserCardStatus(card, message, tone = '') {
  const status = card?.querySelector('.admin-user-card-status');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.dataset.tone = tone;
}

function getAdminUserCardValues(card) {
  return {
    fullName: card.querySelector('[data-field="fullName"]')?.value.trim() || '',
    role: card.querySelector('[data-field="role"]')?.value || 'student',
    isAdmin: Boolean(card.querySelector('[data-field="isAdmin"]')?.checked),
    electrons: Number(card.querySelector('[data-field="electrons"]')?.value || 0),
    manetrons: Number(card.querySelector('[data-field="manetrons"]')?.value || 0),
    heat: Number(card.querySelector('[data-field="heat"]')?.value || 0),
    boardModeratorSlugs: Array.from(
      card.querySelectorAll('[data-permission="board"]:checked'),
      (input) => input.value,
    ),
    courseManagerSlugs: Array.from(
      card.querySelectorAll('[data-permission="course"]:checked'),
      (input) => input.value,
    ),
  };
}

function refreshAdminPermissionCounts(card) {
  ['board', 'course'].forEach((type) => {
    const output = card.querySelector(`[data-permission-count="${type}"]`);
    if (!output) {
      return;
    }
    const total = card.querySelectorAll(`[data-permission="${type}"]`).length;
    const active = card.querySelectorAll(`[data-permission="${type}"]:checked`).length;
    output.textContent = `${active} / ${total}`;
  });
}

function refreshAdminUserCardSummary(card) {
  if (!card || card.classList.contains('admin-user-row-draft')) {
    return;
  }

  const values = getAdminUserCardValues(card);
  const username = card.querySelector('[data-field="username"]')?.value.trim() || '';
  const studentId = card.querySelector('[data-field="studentId"]')?.value.trim() || '';
  const email = card.querySelector('[data-field="email"]')?.value.trim() || '';
  const boardCount = values.boardModeratorSlugs.length;
  const courseCount = values.courseManagerSlugs.length;
  const normalizedRole = normalizeAdminRole(values.role);

  card.dataset.role = normalizedRole;
  card.dataset.isAdmin = String(values.isAdmin);
  card.dataset.boardCount = String(boardCount);
  card.dataset.courseCount = String(courseCount);
  card.dataset.searchIndex = [username, values.fullName, studentId, email]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const summaryName = card.querySelector('[data-admin-summary-name]');
  const summaryRole = card.querySelector('[data-admin-summary-role]');
  const summaryScopes = card.querySelector('[data-admin-summary-scopes]');
  if (summaryName) {
    summaryName.textContent = values.fullName || username;
  }
  if (summaryRole) {
    summaryRole.textContent = getAdminRoleLabel(normalizedRole);
  }
  if (summaryScopes) {
    summaryScopes.innerHTML = renderAdminScopeBadges(boardCount, courseCount, values.isAdmin);
  }

  refreshAdminPermissionCounts(card);
  updateAdminUserListFilters();
}

function resetAdminDeleteConfirmation(button, card) {
  if (!button) {
    return;
  }
  window.clearTimeout(button.adminDeleteConfirmationTimer);
  button.adminDeleteConfirmationTimer = null;
  button.dataset.confirming = 'false';
  button.classList.remove('is-confirming');
  button.textContent = '删除账号';
  if (card?.classList.contains('is-dirty')) {
    setAdminUserCardStatus(card, '有未保存的修改', 'dirty');
  } else {
    setAdminUserCardStatus(
      card,
      button.dataset.previousStatus || '尚未修改',
      button.dataset.previousTone || '',
    );
  }
  delete button.dataset.previousStatus;
  delete button.dataset.previousTone;
}

function handleAdminUserFieldInput(event) {
  const field = event.target.closest('[data-field], [data-permission]');
  const card = field?.closest('.admin-user-row');
  if (!field || !card) {
    return;
  }

  const adminToggle = card.querySelector('[data-field="isAdmin"]');
  const roleField = card.querySelector('[data-field="role"]');
  if (field === adminToggle && !adminToggle.checked && roleField?.value === 'admin') {
    roleField.value = 'student';
  }

  if (card.classList.contains('admin-user-row-draft')) {
    setAdminUserCardStatus(card, '正在填写新账号', 'dirty');
    return;
  }

  card.classList.add('is-dirty');
  resetAdminDeleteConfirmation(card.querySelector('[data-action="delete"]'), card);
  setAdminUserCardStatus(card, '有未保存的修改', 'dirty');
  refreshAdminUserCardSummary(card);
}

function toggleAdminUserEditor(card) {
  if (!card || card.classList.contains('admin-user-row-draft')) {
    return;
  }
  const draft = adminUsers?.querySelector('.admin-user-row-draft');
  if (draft) {
    setAdminUserCardStatus(draft, '请先创建或取消新用户，再编辑其他账号', 'dirty');
    setAdminMessage('请先完成或取消新用户', 3200);
    draft.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    draft.querySelector('[data-field="username"]')?.focus();
    return;
  }
  const shouldExpand = !card.classList.contains('is-expanded');
  adminUsers
    ?.querySelectorAll('.admin-user-row:not(.admin-user-row-draft).is-expanded')
    .forEach((otherCard) => setAdminUserCardExpanded(otherCard, false));
  setAdminUserCardExpanded(card, shouldExpand);
  adminExpandedUserId = shouldExpand ? card.dataset.userId || '' : '';
  updateAdminUserListFilters();
}

async function loadAdminUsers() {
  if (!adminSection || !isAdminUsersPage() || !userState.isAdmin) {
    return;
  }

  try {
    const payload = await callApi('/admin/users', { method: 'GET' });
    adminPermissionCatalog = payload.permissionCatalog || { boards: [], courses: [] };
    renderAdminUsers(payload.users || [], adminPermissionCatalog);
  } catch (error) {
    setAdminMessage(error.message);
  }
}

function renderAdminSection() {
  const isAdmin = userState.isLoggedIn && userState.isAdmin;
  const showFortune = userState.isLoggedIn && Boolean(userState.studentId);

  manageLinks.forEach((link) => {
    link.classList.toggle('hidden', !isAdmin);
  });

  document.querySelectorAll('.system-settings-link').forEach((link) => {
    link.classList.toggle('hidden', !isAdmin);
  });

  document.querySelectorAll('[data-admin-content]').forEach((content) => {
    content.classList.toggle('hidden', !isAdmin);
  });

  fortuneLinks.forEach((link) => {
    link.classList.toggle('hidden', !showFortune);
  });

  electromagneticLinks.forEach((link) => {
    link.classList.toggle('hidden', !showFortune);
  });

  inventoryLinks.forEach((link) => {
    link.classList.toggle('hidden', !showFortune);
  });

  centerActiveMobileNavigation();

  if (!adminSection) {
    return;
  }

  adminSection.classList.toggle('hidden', !isAdmin);

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

  settingsFullName.value = userState.fullName || '';
  settingsBio.value = userState.bio || '';
  settingsWebsiteUrl.value = userState.websiteUrl || '';
  settingsAvatarImage.src = getAvatarUrl(userState.avatarPath);
}

function handleAuthEntry() {
  if (!userState.isLoggedIn) {
    openModal('login');
  }
}

function handleAvatarEntry() {
  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  if (!isSettingsPage()) {
    window.location.href = '/settings';
  }
}

function handleUserSettingsClick() {
  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  if (!isSettingsPage()) {
    window.location.href = '/settings';
  }
}

function handleUserLogoutClick() {
  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  if (window.confirm(`确认退出 ${userState.fullName || userState.username}？`)) {
    clearSession();
    if (isSettingsPage()) {
      window.location.href = '/';
    }
  }
}

function handleSettingsLogout() {
  if (!isSettingsPage() || !userState.isLoggedIn) {
    return;
  }

  if (window.confirm(`确认退出 ${userState.fullName || userState.username}？`)) {
    clearSession();
    window.location.href = '/';
  }
}

async function handleSettingsSubmit(event) {
  if (!isSettingsPage()) {
    return;
  }

  event.preventDefault();
  setSettingsMessage('正在保存设置...');

  try {
    const payload = await callApi('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: settingsFullName.value.trim(),
        bio: settingsBio.value.trim(),
        websiteUrl: settingsWebsiteUrl.value.trim(),
      }),
    });

    saveSession(userState.token, payload.user);
    renderSettingsForm();
    setSettingsMessage(payload.message || '个人设置已保存');
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
    setSettingsPasswordMessage('新密码长度至少为 6 位');
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    setSettingsPasswordMessage('两次输入的新密码不一致');
    return;
  }

  setSettingsPasswordMessage('正在更新密码...');

  try {
    const payload = await callApi('/profile/password', {
      method: 'PATCH',
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    });

    settingsPasswordForm.reset();
    setSettingsPasswordMessage(payload.message || '密码已更新');
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

  if (!file.type.startsWith('image/')) {
    setSettingsMessage('请选择图片文件');
    event.target.value = '';
    return;
  }

  setSettingsMessage('正在上传头像...');

  try {
    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取头像文件失败'));
      reader.readAsDataURL(file);
    });

    const payload = await callApi('/profile/avatar', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    });

    saveSession(userState.token, payload.user);
    renderSettingsForm();
    setSettingsMessage(payload.message || '头像上传成功');
  } catch (error) {
    setSettingsMessage(error.message);
  } finally {
    event.target.value = '';
  }
}

async function handleAdminUsersClick(event) {
  if (!isAdminUsersPage()) {
    return;
  }

  const disclosure = event.target.closest('[data-admin-ui-action="toggle-editor"]');
  if (disclosure) {
    toggleAdminUserEditor(disclosure.closest('.admin-user-row'));
    return;
  }

  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const card = button.closest('.admin-user-row');
  const userId = card?.dataset.userId;

  if (!card || !userId) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'cancel') {
    card.remove();
    adminExpandedUserId = '';
    updateAdminUserListFilters();
    setAdminMessage('');
    adminAddUserButton?.focus();
    return;
  }

  if (action === 'delete' && button.dataset.confirming !== 'true') {
    const currentStatus = card.querySelector('.admin-user-card-status');
    button.dataset.previousStatus = currentStatus?.textContent.trim() || '尚未修改';
    button.dataset.previousTone = currentStatus?.dataset.tone || '';
    button.dataset.confirming = 'true';
    button.classList.add('is-confirming');
    button.textContent = '再次点击确认';
    setAdminUserCardStatus(
      card,
      `即将删除“${
        card.querySelector('[data-admin-summary-name]')?.textContent.trim() || '该用户'
      }”，请再次点击确认`,
      'danger',
    );
    button.adminDeleteConfirmationTimer = window.setTimeout(() => {
      resetAdminDeleteConfirmation(button, card);
    }, 5000);
    return;
  }

  const values = getAdminUserCardValues(card);
  const actionButtons = Array.from(card.querySelectorAll('button[data-action]'));
  const mutableFields = Array.from(card.querySelectorAll('input:not([readonly]), select')).map(
    (field) => ({
      field,
      wasDisabled: field.disabled,
    }),
  );
  actionButtons.forEach((actionButton) => {
    actionButton.disabled = true;
  });
  mutableFields.forEach(({ field }) => {
    field.disabled = true;
  });
  card.classList.add('is-saving');
  card.setAttribute('aria-busy', 'true');

  try {
    if (action === 'create') {
      setAdminUserCardStatus(card, '正在创建账号…');
      setAdminMessage('正在创建用户...');
      const payload = await callApi('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: card.querySelector('[data-field="username"]').value.trim(),
          fullName: values.fullName,
          studentId: card.querySelector('[data-field="studentId"]').value.trim(),
          email: card.querySelector('[data-field="email"]').value.trim(),
          password: card.querySelector('[data-field="password"]').value,
          role: values.role,
          isAdmin: values.isAdmin,
          electrons: values.electrons,
          manetrons: values.manetrons,
          heat: values.heat,
        }),
      });
      adminExpandedUserId = String(payload.user?.id || '');
      setAdminMessage('用户创建成功', 3200);
      await loadAdminUsers();
      const createdCard = Array.from(adminUsers?.querySelectorAll('.admin-user-row') || []).find(
        (item) => item.dataset.userId === adminExpandedUserId,
      );
      if (createdCard) {
        setAdminUserCardStatus(createdCard, '账号已创建', 'success');
        createdCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    if (action === 'save') {
      setAdminUserCardStatus(card, '正在保存…');
      setAdminMessage('正在保存用户...');
      await callApi(`/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: values.fullName,
          role: values.role,
          isAdmin: values.isAdmin,
          electrons: values.electrons,
          manetrons: values.manetrons,
          heat: values.heat,
          boardModeratorSlugs: values.boardModeratorSlugs,
          courseManagerSlugs: values.courseManagerSlugs,
        }),
      });
      card.classList.remove('is-dirty');
      refreshAdminUserCardSummary(card);
      setAdminUserCardStatus(
        card,
        `已保存 · ${new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date())}`,
        'success',
      );
      setAdminMessage('用户已更新', 3200);
      return;
    }

    if (action === 'delete') {
      window.clearTimeout(button.adminDeleteConfirmationTimer);
      setAdminUserCardStatus(card, '正在删除账号…', 'danger');
      setAdminMessage('正在删除用户...');
      await callApi(`/admin/users/${userId}`, {
        method: 'DELETE',
      });
      card.remove();
      adminExpandedUserId = '';
      updateAdminUserListFilters();
      setAdminMessage('用户已删除', 3200);
    }
  } catch (error) {
    if (action === 'delete') {
      resetAdminDeleteConfirmation(button, card);
    }
    setAdminUserCardStatus(card, error.message, 'danger');
    setAdminMessage(error.message);
  } finally {
    card.classList.remove('is-saving');
    card.removeAttribute('aria-busy');
    if (card.isConnected) {
      actionButtons.forEach((actionButton) => {
        actionButton.disabled = false;
      });
      mutableFields.forEach(({ field, wasDisabled }) => {
        field.disabled = wasDisabled;
      });
    }
  }
}

async function handleFortuneBonusToggle(event) {
  if (!isAdminUsersPage() || !userState.isAdmin || !fortuneBonusToggle) {
    return;
  }

  const enabled = event.target.checked;
  fortuneBonusToggle.disabled = true;
  setAdminMessage('正在更新运势开关...');

  try {
    const payload = await callApi('/admin/fortune-config', {
      method: 'PATCH',
      body: JSON.stringify({
        fortuneBonusEnabled: enabled,
      }),
    });

    userState.fortuneBonusEnabled = Boolean(payload.fortuneBonusEnabled);
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
    setAdminMessage(userState.fortuneBonusEnabled ? '运势加成已开启' : '运势加成已关闭', 3200);
  } catch (error) {
    fortuneBonusToggle.checked = userState.fortuneBonusEnabled;
    setAdminMessage(error.message);
  } finally {
    fortuneBonusToggle.disabled = false;
  }
}

async function handleDiscussionBoardClick(event) {
  const button = event.target.closest('[data-board-slug]');

  if (!button) {
    return;
  }

  discussionState.activeBoard = button.dataset.boardSlug || 'all';
  discussionState.activePostId = '';
  renderDiscussionDetail(null);
  await loadDiscussionPosts({
    autoOpen: false,
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
    await toggleDiscussionReaction(
      likeButton.dataset.postId || '',
      likeButton.dataset.reactionType || 'smile',
    );
    return;
  }

  const pinButton = event.target.closest("[data-action='toggle-pin']");

  if (pinButton) {
    await toggleDiscussionPin(pinButton.dataset.postId || '', pinButton.dataset.pinned === '1');
    return;
  }

  const featureButton = event.target.closest("[data-action='toggle-feature']");

  if (featureButton) {
    await toggleDiscussionFeature(
      featureButton.dataset.postId || '',
      featureButton.dataset.featured === '1',
    );
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await deleteDiscussionPost(deleteButton.dataset.postId || '');
    return;
  }

  const button = event.target.closest('[data-post-id]');

  if (!button) {
    return;
  }

  const postId = button.dataset.postId || '';

  if (!postId) {
    return;
  }

  await loadDiscussionDetail(postId);
  window.requestAnimationFrame(() => {
    document.getElementById('discussion-detail-title')?.focus({
      preventScroll: true,
    });
  });
}

async function deleteDiscussionPost(postId) {
  if (!postId || !userState.isLoggedIn) {
    return;
  }

  if (!window.confirm('确认删除这篇帖子？')) {
    return;
  }

  try {
    await callApi(`/discussion/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    });

    discussionState.postCache.delete(postId);
    delete discussionState.postsHashByBoard[discussionState.activeBoard || 'all'];
    discussionState.posts = userState.isAdmin
      ? discussionState.posts.map((post) =>
          post.id === postId
            ? { ...post, title: '已删除的帖子', isDeleted: true, canDelete: false }
            : post,
        )
      : discussionState.posts.filter((post) => post.id !== postId);

    if (discussionState.activePostId === postId) {
      discussionState.activePostId = '';
      renderDiscussionDetail(null);
      updateDiscussionQuery({
        board: discussionState.activeBoard,
        postId: '',
      });
    }

    renderDiscussionPosts();
    await loadDiscussionPosts({
      autoOpen: false,
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
      method: 'PATCH',
      body: JSON.stringify({ pinned: !pinned }),
    });

    discussionState.posts = discussionState.posts.map((post) =>
      post.id === postId ? { ...post, isPinned: Boolean(payload.isPinned) } : post,
    );

    if (discussionState.activePost?.id === postId) {
      discussionState.activePost = {
        ...discussionState.activePost,
        isPinned: Boolean(payload.isPinned),
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
      method: 'PATCH',
      body: JSON.stringify({ featured: !featured }),
    });

    discussionState.posts = discussionState.posts.map((post) =>
      post.id === postId ? { ...post, isFeatured: Boolean(payload.isFeatured) } : post,
    );

    if (discussionState.activePost?.id === postId) {
      discussionState.activePost = {
        ...discussionState.activePost,
        isFeatured: Boolean(payload.isFeatured),
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

  if (!board || board.slug === 'all' || !board.canModerate) {
    return;
  }

  const aboutBox = document.getElementById('discussion-board-about');

  if (!aboutBox || !discussionBoardAboutBody) {
    return;
  }

  if (aboutBox.classList.contains('is-editing')) {
    renderDiscussionBoardAbout();
    return;
  }

  const currentMarkdown = board.descriptionMarkdown || board.description || '';
  aboutBox.classList.add('is-editing');
  discussionBoardEdit.textContent = '取消';
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

  const input = discussionBoardAboutBody.querySelector('.discussion-board-description-input');
  const preview = discussionBoardAboutBody.querySelector('.discussion-board-description-preview');

  const renderPreview = () => {
    preview.innerHTML = renderMarkdownContent(input.value || '暂无说明。');
    enhanceMarkdownContent(preview);
  };

  input.addEventListener('input', renderPreview);
  renderPreview();
  input.focus();
}

async function saveActiveBoardDescription() {
  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById('discussion-board-about');
  const input = discussionBoardAboutBody?.querySelector('.discussion-board-description-input');
  const message = document.getElementById('discussion-board-edit-message');

  if (!board || !board.canModerate || !input) {
    return;
  }

  const trimmed = input.value.trim();

  if (!trimmed) {
    if (message) {
      message.textContent = '版块说明不能为空';
    }
    return;
  }

  try {
    if (message) {
      message.textContent = '正在保存...';
    }

    const payload = await callApi(
      `/discussion/boards/${encodeURIComponent(board.slug)}/description`,
      {
        method: 'PATCH',
        body: JSON.stringify({ descriptionMarkdown: trimmed }),
      },
    );

    discussionState.boards = discussionState.boards.map((item) =>
      item.slug === board.slug ? { ...item, ...(payload.board || {}), canModerate: true } : item,
    );
    aboutBox?.classList.remove('is-editing');
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
    user.uid ? `uid ${user.uid}` : '',
    user.studentId ? `学号 ${user.studentId}` : '',
    user.email || '',
    user.fullName || '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `
    <article class="discussion-moderator-row" data-user-id="${user.id}">
      <img class="discussion-moderator-avatar" src="${escapeHtml(getAvatarUrl(user.avatarPath))}" alt="${escapeHtml(title)} 的头像" />
      <div class="discussion-moderator-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(meta || '无更多信息')}</span>
      </div>
      <button
        class="discussion-moderator-toggle ${user.isModerator ? 'is-active' : ''}"
        type="button"
        data-action="toggle-board-moderator"
        data-user-id="${user.id}"
        data-is-moderator="${user.isModerator ? '1' : '0'}"
      >${user.isModerator ? '移出版主' : '设为版主'}</button>
    </article>
  `;
}

async function loadBoardModeratorList(board) {
  const list = discussionBoardAboutBody?.querySelector('#discussion-moderator-list');
  const message = discussionBoardAboutBody?.querySelector('#discussion-moderator-message');

  if (!list) {
    return;
  }

  try {
    if (message) {
      message.textContent = '正在加载版主名单...';
    }

    const payload = await callApi(
      `/discussion/boards/${encodeURIComponent(board.slug)}/moderators`,
      {
        method: 'GET',
      },
    );
    const moderators = payload.moderators || [];
    list.innerHTML = moderators.length
      ? moderators.map(renderModeratorUserRow).join('')
      : `<p class="discussion-stats-muted">这个版块还没有单独设置版主。</p>`;

    if (message) {
      message.textContent = '';
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

async function openBoardModeratorsPanel() {
  const board = getActiveDiscussionBoard();
  const aboutBox = document.getElementById('discussion-board-about');

  if (!board || board.slug === 'all' || !board.canManageModerators || !discussionBoardAboutBody) {
    return;
  }

  if (aboutBox?.classList.contains('is-managing-moderators')) {
    renderDiscussionBoardAbout();
    return;
  }

  aboutBox?.classList.remove('is-editing');
  aboutBox?.classList.add('is-managing-moderators');
  if (discussionBoardEdit) {
    discussionBoardEdit.textContent = '编辑';
  }
  if (discussionBoardModerators) {
    discussionBoardModerators.textContent = '关闭名单';
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

  discussionBoardAboutBody.querySelector('#discussion-moderator-query')?.focus();
  await loadBoardModeratorList(board);
}

async function searchBoardModeratorCandidates() {
  const board = getActiveDiscussionBoard();
  const input = discussionBoardAboutBody?.querySelector('#discussion-moderator-query');
  const results = discussionBoardAboutBody?.querySelector('#discussion-moderator-results');
  const message = discussionBoardAboutBody?.querySelector('#discussion-moderator-message');
  const query = input?.value.trim() || '';

  if (!board || !results || !message) {
    return;
  }

  if (query.length < 2) {
    message.textContent = '请输入至少 2 个字符';
    return;
  }

  try {
    message.textContent = '正在搜索...';
    const payload = await callApi(
      `/discussion/boards/${encodeURIComponent(board.slug)}/moderator-candidates?query=${encodeURIComponent(query)}`,
      {
        method: 'GET',
      },
    );
    const users = payload.users || [];
    results.innerHTML = users.length
      ? users.map(renderModeratorUserRow).join('')
      : `<p class="discussion-stats-muted">没有找到匹配用户。</p>`;
    message.textContent = '';
  } catch (error) {
    message.textContent = error.message;
  }
}

async function toggleBoardModerator(button) {
  const board = getActiveDiscussionBoard();
  const userId = Number(button.dataset.userId || 0);
  const isModerator = button.dataset.isModerator === '1';
  const message = discussionBoardAboutBody?.querySelector('#discussion-moderator-message');

  if (!board || !userId) {
    return;
  }

  button.disabled = true;

  try {
    if (message) {
      message.textContent = '正在更新版主名单...';
    }

    const payload = await callApi(
      `/discussion/boards/${encodeURIComponent(board.slug)}/moderators/${userId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ isModerator: !isModerator }),
      },
    );

    button.dataset.isModerator = payload.isModerator ? '1' : '0';
    button.classList.toggle('is-active', Boolean(payload.isModerator));
    button.textContent = payload.isModerator ? '移出版主' : '设为版主';
    await loadBoardModeratorList(board);

    if (message) {
      message.textContent = '版主名单已更新';
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
      openModal('login');
      return;
    }

    const commentId = Number(replyButton.dataset.commentId || 0);
    const authorName = replyButton.dataset.authorName || '这条评论';
    const slot = discussionDetail.querySelector(`[data-reply-slot="${commentId}"]`);

    if (!slot) {
      return;
    }

    const postId = String(discussionState.activePostId || '');
    if (slot.innerHTML.trim()) {
      discussionOpenReplyByPost.delete(postId);
      slot.innerHTML = '';
      return;
    }

    discussionDetail.querySelectorAll('.discussion-reply-form').forEach((form) => {
      const context = getDiscussionCommentFormContext(form);
      if (context?.input) {
        rememberDiscussionCommentDraft(
          context.postId,
          context.parentCommentId,
          context.input.value,
        );
      }
    });
    discussionDetail.querySelectorAll('.discussion-comment-reply-slot').forEach((node) => {
      node.innerHTML = '';
    });
    discussionOpenReplyByPost.set(postId, commentId);
    mountDiscussionReplyForm(slot, postId, commentId, authorName, {
      focus: true,
    });
    return;
  }

  const likeButton = event.target.closest("[data-action='toggle-reaction']");

  if (likeButton) {
    await toggleDiscussionReaction(
      likeButton.dataset.postId || '',
      likeButton.dataset.reactionType || 'smile',
    );
    return;
  }

  const pinButton = event.target.closest("[data-action='toggle-pin']");

  if (pinButton) {
    await toggleDiscussionPin(pinButton.dataset.postId || '', pinButton.dataset.pinned === '1');
    return;
  }

  const featureButton = event.target.closest("[data-action='toggle-feature']");

  if (featureButton) {
    await toggleDiscussionFeature(
      featureButton.dataset.postId || '',
      featureButton.dataset.featured === '1',
    );
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-post']");

  if (deleteButton) {
    await deleteDiscussionPost(deleteButton.dataset.postId || '');
    return;
  }

  const button = event.target.closest("[data-action='close-detail']");

  if (!button) {
    return;
  }

  const previousPostId = String(discussionState.activePostId || '');
  discussionState.activePostId = '';
  renderDiscussionPosts();
  renderDiscussionDetail(null);
  updateDiscussionQuery({
    board: discussionState.activeBoard,
    postId: '',
  });
  discussionLayout?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
  window.requestAnimationFrame(() => {
    const titleButton = Array.from(
      discussionPostList?.querySelectorAll('.discussion-post-title') || [],
    ).find((candidate) => candidate.dataset.postId === previousPostId);
    titleButton?.focus({
      preventScroll: true,
    });
  });
}

async function handleDiscussionCommentSubmit(event) {
  const form = event.target.closest('.discussion-comment-form');

  if (!form || !discussionState.activePostId) {
    return;
  }

  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  const input = form.querySelector('.discussion-comment-input');
  const message = form.querySelector('.discussion-comment-message');
  const parentCommentId = Number(form.dataset.parentCommentId || 0);
  const contentMarkdown = input?.value.trim() || '';
  const postId = String(form.dataset.postId || discussionState.activePostId);
  const submitButton = form.querySelector('[type="submit"]');

  if (!contentMarkdown) {
    if (message) {
      message.textContent = parentCommentId ? '请输入回复内容' : '请输入评论内容';
    }
    input?.focus();
    return;
  }

  rememberDiscussionCommentDraft(postId, parentCommentId, input?.value || '');

  if (message) {
    message.textContent = parentCommentId ? '正在发布回复...' : '正在发布评论...';
  }
  form.setAttribute('aria-busy', 'true');
  if (submitButton) {
    submitButton.disabled = true;
  }

  try {
    const payload = await callApi(
      `/discussion/posts/${encodeURIComponent(discussionState.activePostId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          contentMarkdown,
          parentCommentId: parentCommentId || undefined,
        }),
      },
    );

    const baselineCommentCount = discussionState.comments.length;
    const newComments = [payload.comment].filter(Boolean);
    discussionState.comments = [...discussionState.comments, ...newComments];
    const addedCommentCount = newComments.length;
    if (discussionState.activePost) {
      discussionState.activePost.commentCount =
        Number(discussionState.activePost.commentCount || 0) + addedCommentCount;
    }
    discussionState.posts = discussionState.posts.map((post) =>
      post.id === discussionState.activePostId
        ? {
            ...post,
            commentCount: Number(post.commentCount || 0) + addedCommentCount,
          }
        : post,
    );
    clearDiscussionCommentComposer(form);
    if (parentCommentId) {
      discussionOpenReplyByPost.delete(postId);
    }
    if (message) {
      message.textContent = payload.message || (parentCommentId ? '回复已发布' : '评论已发布');
    }
    renderDiscussionComments();
    renderDiscussionPosts();
    if (payload.maxPending || shouldWaitForMaxReply(contentMarkdown)) {
      pollDiscussionCommentsForMax(
        discussionState.activePostId,
        baselineCommentCount + addedCommentCount,
        message,
      );
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  } finally {
    form.removeAttribute('aria-busy');
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function handleDiscussionCreateToggle() {
  if (!discussionComposeForm) {
    return;
  }

  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  if (discussionState.isFallback) {
    setDiscussionMessage('正在重新连接讨论后端...');
    await loadDiscussionBoards();

    if (discussionState.isFallback) {
      setDiscussionMessage('讨论后端暂不可用，请确认后端已启动并刷新重试');
      return;
    }

    setDiscussionMessage('');
  }

  discussionComposeForm.classList.toggle('hidden');
  if (!discussionComposeForm.classList.contains('hidden')) {
    discussionComposeTitle?.focus();
  }
}

async function handleDiscussionComposeSubmit(event) {
  if (!discussionComposeForm) {
    return;
  }

  event.preventDefault();

  if (!userState.isLoggedIn) {
    openModal('login');
    return;
  }

  if (discussionState.isFallback) {
    setDiscussionMessage('讨论后端暂不可用，无法发布帖子');
    return;
  }

  setDiscussionMessage('正在发布帖子...');

  try {
    const payload = await callApi('/discussion/posts', {
      method: 'POST',
      body: JSON.stringify({
        boardSlug: discussionComposeBoard.value,
        title: discussionComposeTitle.value.trim(),
        contentMarkdown: discussionComposeContent.value,
      }),
    });

    setDiscussionMessage(payload.message || '帖子发布成功');
    discussionComposeForm.reset();
    discussionComposeForm.classList.add('hidden');
    discussionState.activeBoard = payload.post.board.slug;
    discussionState.activePostId = payload.post.id;
    await loadDiscussionPosts({
      autoOpen: false,
    });
    renderDiscussionDetail(payload.post);
    updateDiscussionQuery({
      board: discussionState.activeBoard,
      postId: discussionState.activePostId,
    });
  } catch (error) {
    setDiscussionMessage(error.message);
    discussionComposeForm.classList.remove('hidden');
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
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  textarea.value = `${before}${prefix}${text}${suffix}${after}`;
  const cursor = before.length + prefix.length + text.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
}

async function resizeImageFileToWebp(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const readOriginalFile = () =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });

  let source;

  try {
    if (typeof createImageBitmap === 'function') {
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
          reject(new Error('读取图片失败'));
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    source.close?.();
    return readOriginalFile();
  }

  context.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/webp', 0.82);
  });

  if (!blob || !blob.type || blob.type.toLowerCase() !== 'image/webp') {
    return readOriginalFile();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function uploadDiscussionImage(file) {
  if (!userState.isLoggedIn) {
    openModal('login');
    return '';
  }

  setDiscussionMessage(`正在处理图片：${file.name || 'image'}`);
  const imageDataUrl = await resizeImageFileToWebp(file);
  setDiscussionMessage(`正在上传图片：${file.name || 'image'}`);
  const payload = await callApi('/discussion/uploads/images', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl }),
  });

  return payload.url || '';
}

async function insertDiscussionImages(files) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'));

  if (!imageFiles.length) {
    return;
  }

  try {
    for (const file of imageFiles) {
      const url = await uploadDiscussionImage(file);

      if (url) {
        insertTextAtTextarea(
          discussionComposeContent,
          `![${file.name ? file.name.replace(/\.[^.]+$/, '') : '图片'}](${getAvatarUrl(url)})`,
        );
      }
    }

    setDiscussionMessage('图片已插入正文');
  } catch (error) {
    setDiscussionMessage(error.message);
  }
}

async function handleDiscussionPaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith('image/'),
  );

  if (!files.length) {
    return;
  }

  event.preventDefault();
  await insertDiscussionImages(files);
}

async function writeClipboardText(text) {
  await navigator.clipboard.writeText(String(text || ''));
}

async function writeClipboardHtml(html, text) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return;
  }

  await writeClipboardText(text);
}

function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => `\n${code.trimEnd()}\n`)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

function hasCjkText(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function normalizeWordStrongSpacing(root) {
  root.querySelectorAll('strong, b').forEach((strong) => {
    strong.textContent = strong.textContent.trim();

    const previous = strong.previousSibling;
    if (
      previous?.nodeType === Node.TEXT_NODE &&
      /\s$/.test(previous.textContent || '') &&
      hasCjkText(`${previous.textContent}${strong.textContent}`)
    ) {
      previous.textContent = previous.textContent.replace(/\s+$/, '');
    }

    const next = strong.nextSibling;
    if (
      next?.nodeType === Node.TEXT_NODE &&
      /^\s/.test(next.textContent || '') &&
      hasCjkText(`${strong.textContent}${next.textContent}`)
    ) {
      next.textContent = next.textContent.replace(/^\s+/, '');
    }
  });
}

function applyWordThreeLineTables(root) {
  root.querySelectorAll('table').forEach((table) => {
    table.setAttribute('width', '100%');
    table.setAttribute(
      'style',
      'border-collapse:collapse;width:100%;margin:8pt 0;border-top:1.5pt solid #000;border-bottom:1.5pt solid #000;mso-table-lspace:0pt;mso-table-rspace:0pt;',
    );

    table.querySelectorAll('th, td').forEach((cell) => {
      cell.setAttribute(
        'style',
        'padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:0;vertical-align:top;',
      );
    });

    const headerCells = table.querySelectorAll('thead th');
    headerCells.forEach((cell) => {
      cell.setAttribute(
        'style',
        'padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:1pt solid #000;vertical-align:top;font-weight:bold;',
      );
    });

    if (!headerCells.length) {
      table.querySelectorAll('tr:first-child th, tr:first-child td').forEach((cell) => {
        cell.setAttribute(
          'style',
          'padding:5pt 6pt;border-left:0;border-right:0;border-top:0;border-bottom:1pt solid #000;vertical-align:top;font-weight:bold;',
        );
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
    const template = document.createElement('template');
    template.innerHTML = highlighter.highlight(String(rawText || ''), {
      language,
      ignoreIllegals: true,
    }).value;
    return Array.from(template.content.childNodes);
  }

  return [document.createTextNode(String(rawText || ''))];
}

function appendWordCodeWithBreaks(cell, nodes) {
  const appendTextWithBreaks = (text) => {
    String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .forEach((line, index) => {
        if (index) {
          cell.append(document.createElement('br'));
        }
        const chunks = String(line || ' ').match(/.{1,72}/g) || [' '];
        chunks.forEach((chunk, chunkIndex) => {
          if (chunkIndex) {
            cell.append(document.createElement('wbr'));
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

    const span = document.createElement('span');
    span.className = node.className || '';
    span.innerHTML = '';
    appendWordCodeWithBreaks(span, Array.from(node.childNodes));
    cell.append(span);
  });
}

function createWordCodeTable(text, language = '') {
  const table = document.createElement('table');
  table.setAttribute('width', '100%');
  table.setAttribute('border', '1');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('cellpadding', '0');
  table.setAttribute(
    'style',
    'border-collapse:collapse;width:100%;max-width:100%;table-layout:fixed;margin:8pt 0;mso-width-percent:1000;mso-table-lspace:0pt;mso-table-rspace:0pt;border:1pt solid #8a8f98;mso-border-alt:solid #8a8f98 .75pt;',
  );
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
    table.querySelector('td'),
    buildWordHighlightedCodeNodesForLanguage(normalizeCodeLanguageName(language), text),
  );
  return table;
}

function buildWordDocumentHtml(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body,p,li,td,th{font-family:"Times New Roman",SimSun,serif;mso-ascii-font-family:"Times New Roman";mso-hansi-font-family:"Times New Roman";mso-fareast-font-family:SimSun;} strong,b{font-weight:bold;}.hljs-keyword,.hljs-selector-tag,.hljs-built_in{color:#cf222e;}.hljs-title,.hljs-title.function_{color:#8250df;}.hljs-string,.hljs-attr{color:#0a3069;}.hljs-number,.hljs-literal{color:#0550ae;}.hljs-comment{color:#6e7781;font-style:italic;}.hljs-meta,.hljs-preprocessor{color:#953800;}.hljs-type,.hljs-class .hljs-title{color:#116329;}</style></head><body style="font-family:'Times New Roman',SimSun,serif;mso-ascii-font-family:'Times New Roman';mso-hansi-font-family:'Times New Roman';mso-fareast-font-family:SimSun;font-size:11pt;line-height:1.55;">${bodyHtml}</body></html>`;
}

function buildWordHtmlFromMarkdown(markdown) {
  const template = document.createElement('template');
  template.innerHTML = renderMarkdownContent(markdown);
  normalizeWordStrongSpacing(template.content);
  applyWordThreeLineTables(template.content);

  template.content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    const text = code?.textContent || pre.textContent || '';
    pre.replaceWith(createWordCodeTable(text, getCodeBlockLanguage(code)));
  });

  template.content.querySelectorAll('code').forEach((code) => {
    code.setAttribute(
      'style',
      "font-family:Consolas,'Courier New',monospace;background:transparent;padding:0;",
    );
  });

  return buildWordDocumentHtml(template.innerHTML);
}

function escapeLatexText(value) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%#_{}])/g, '\\$1')
    .replace(/\$/g, '\\$')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function escapeLatexInline(value) {
  return String(value || '')
    .split(/(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$)/g)
    .map((part) => {
      if (/^\$\$[\s\S]+\$\$$/.test(part) || /^\$[^\n$]+\$$/.test(part)) {
        return part;
      }

      return escapeLatexText(part)
        .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
        .replace(/\*([^*]+)\*/g, '\\emph{$1}')
        .replace(/`([^`]+)`/g, '\\texttt{$1}')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 (\\url{$2})');
    })
    .join('');
}

function latexListingLanguage(language) {
  const normalized = normalizeCodeLanguageName(language);

  if (normalized === 'python') {
    return 'Python';
  }

  if (normalized === 'java') {
    return 'Java';
  }

  if (normalized === 'c') {
    return 'C';
  }

  if (normalized === 'cpp') {
    return 'C++';
  }

  if (normalized === 'matlab') {
    return 'Matlab';
  }

  return '';
}

function markdownToLatexBody(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let inCode = false;
  let codeLanguage = '';
  let inList = false;

  const closeList = () => {
    if (inList) {
      output.push('\\end{itemize}');
      inList = false;
    }
  };

  lines.forEach((line) => {
    const fence = line.match(/^```([^\s`]*)/);

    if (fence) {
      if (inCode) {
        output.push('\\end{lstlisting}');
        inCode = false;
        codeLanguage = '';
      } else {
        closeList();
        codeLanguage = latexListingLanguage(fence[1]);
        output.push(`\\begin{lstlisting}${codeLanguage ? `[language=${codeLanguage}]` : ''}`);
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
      const command =
        heading[1].length === 1
          ? 'section'
          : heading[1].length === 2
            ? 'subsection'
            : 'subsubsection';
      output.push(`\\${command}{${escapeLatexInline(heading[2])}}`);
      return;
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        output.push('\\begin{itemize}');
        inList = true;
      }
      output.push(`\\item ${escapeLatexInline(listItem[1])}`);
      return;
    }

    closeList();

    if (!line.trim()) {
      output.push('');
      return;
    }

    output.push(escapeLatexInline(line.replace(/^>\s?/, '')));
  });

  if (inCode) {
    output.push('\\end{lstlisting}');
  }
  closeList();
  return output.join('\n');
}

function buildLatexDocument(markdown) {
  const author = userState.username || userState.fullName || 'FREE-BBS 用户';

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
  document.querySelectorAll('.aichat-copy-menu').forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.add('hidden');
    }
  });
}

function closeCodeCopyMenus(exceptMenu = null) {
  document.querySelectorAll('.code-copy-menu').forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.add('hidden');
    }
  });
}

function buildCodeLatexListing(code, language = '') {
  const listingLanguage = latexListingLanguage(language);
  return `\\begin{lstlisting}${listingLanguage ? `[language=${listingLanguage}]` : ''}
${String(code || '').replace(/\\end\{lstlisting\}/g, '\\end {lstlisting}')}
\\end{lstlisting}
`;
}

function buildCodeWordHtml(code, language = '') {
  const container = document.createElement('div');
  container.append(createWordCodeTable(code, language));
  return buildWordDocumentHtml(container.innerHTML);
}

async function copyCodeText(code, language, format) {
  if (format === 'latex') {
    await writeClipboardText(buildCodeLatexListing(code, language));
    return;
  }

  if (format === 'word') {
    await writeClipboardHtml(buildCodeWordHtml(code, language), code);
    return;
  }

  await writeClipboardText(code);
}

async function copyAiMessage(article, format) {
  const markdown = article?.dataset.markdown || '';

  if (format === 'markdown') {
    await writeClipboardText(markdown);
    return;
  }

  if (format === 'word') {
    await writeClipboardHtml(buildWordHtmlFromMarkdown(markdown), markdownToPlainText(markdown));
    return;
  }

  if (format === 'latex') {
    await writeClipboardText(buildLatexDocument(markdown));
    return;
  }

  await writeClipboardText(markdownToPlainText(markdown));
}

async function handleAiMessageCopyClick(event) {
  const toggle = event.target.closest("[data-action='toggle-ai-copy-menu']");

  if (toggle) {
    const menu = toggle.closest('.aichat-copy-control')?.querySelector('.aichat-copy-menu');
    if (!menu) {
      return;
    }

    const isHidden = menu.classList.contains('hidden');
    closeAiCopyMenus(menu);
    menu.classList.toggle('hidden', !isHidden);
    event.stopPropagation();
    return;
  }

  const option = event.target.closest("[data-action='copy-ai-message']");

  if (!option) {
    closeAiCopyMenus();
    return;
  }

  const article = option.closest('.aichat-message-assistant');
  const button = article?.querySelector('.aichat-copy-button');
  const originalTitle = button?.title || '复制';

  try {
    const format = option.dataset.copyFormat;
    await copyAiMessage(article, format);
    showCopySuccessPopup(format);
    if (button) {
      button.title = '已复制';
      window.setTimeout(() => {
        button.title = originalTitle;
      }, 1200);
    }
  } catch {
    if (button) {
      button.title = '复制失败';
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
    const menu = toggle.parentElement?.querySelector('.code-copy-menu');
    if (!menu) {
      return;
    }

    const isHidden = menu.classList.contains('hidden');
    closeCodeCopyMenus(menu);
    menu.classList.toggle('hidden', !isHidden);
    event.stopPropagation();
    return;
  }

  const option = event.target.closest("[data-action='copy-code']");

  if (!option) {
    closeCodeCopyMenus();
    return;
  }

  const container = option.closest('pre, .code-run-result');
  const button = container?.querySelector("[data-action='toggle-code-copy-menu']");
  const code = button?.dataset.code || '';
  const language = button?.dataset.language || '';
  const originalTitle = button?.title || '复制代码';

  try {
    const format = option.dataset.copyFormat;
    await copyCodeText(code, language, format);
    showCopySuccessPopup(format);
    if (button) {
      button.title = '已复制';
    }
    window.setTimeout(() => {
      if (button) {
        button.title = originalTitle;
      }
    }, 1200);
  } catch {
    if (button) {
      button.title = '复制失败';
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
  return /\.(?:png|jpg|jpeg|webp|gif)(?:$|\?)/i.test(String(file || ''));
}

function revokeCodeRunObjectUrls(result) {
  result?.querySelectorAll('img[data-object-url]').forEach((image) => {
    URL.revokeObjectURL(image.dataset.objectUrl);
  });
}

function addCodeRunResultCopyControls(result, text) {
  const copyButton = document.createElement('button');
  copyButton.className = 'code-result-copy-button';
  copyButton.type = 'button';
  copyButton.dataset.action = 'toggle-code-copy-menu';
  copyButton.dataset.code = String(text || '');
  copyButton.dataset.language = '';
  copyButton.title = '复制运行结果';
  copyButton.setAttribute('aria-label', '复制运行结果');
  copyButton.innerHTML = `<img src="/assets/icons/copy.svg" alt="" aria-hidden="true" />`;
  result.append(copyButton);
  result.append(createCodeCopyMenu());
}

async function loadAuthenticatedCodeRunImage(image, file) {
  try {
    const response = await fetch(`${API_ROOT}${file}`, {
      headers: {
        ...(userState.token ? { Authorization: `Bearer ${userState.token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error('图片加载失败');
    }

    const objectUrl = URL.createObjectURL(await response.blob());
    image.dataset.objectUrl = objectUrl;
    image.src = objectUrl;
  } catch (error) {
    image.replaceWith(
      Object.assign(document.createElement('p'), {
        className: 'code-run-image-error',
        textContent: error.message,
      }),
    );
  }
}

function renderCodeRunResult(result, payload) {
  revokeCodeRunObjectUrls(result);
  result.innerHTML = '';

  const stdout = String(payload?.stdout || '');
  const stderr = String(payload?.stderr || '');
  const files = (Array.isArray(payload?.files) ? payload.files : []).filter(isImageOutputFile);
  const exitCode = Number(payload?.exit_code ?? payload?.exitCode ?? 0);
  const isSuccess = Number.isFinite(exitCode) && exitCode === 0 && !stderr;
  const output =
    [stdout ? `stdout:\n${stdout.trimEnd()}` : '', stderr ? `stderr:\n${stderr.trimEnd()}` : '']
      .filter(Boolean)
      .join('\n\n') ||
    (isSuccess ? '' : `代码执行结束，exit code: ${payload?.exit_code ?? 'unknown'}`);
  result.classList.toggle('is-code-run-success', isSuccess);
  result.classList.toggle('is-code-run-error', !isSuccess);
  const copyText = output.trimEnd();
  addCodeRunResultCopyControls(result, copyText);

  [
    ['stdout', stdout],
    ['stderr', stderr],
  ].forEach(([label, value]) => {
    if (!value) {
      return;
    }

    const block = document.createElement('div');
    block.className = 'code-run-output-block';
    block.innerHTML = `<span class="code-run-output-label">${label}</span>`;
    const text = document.createElement('pre');
    text.className = 'code-run-result-text';
    text.textContent = String(value).trimEnd();
    block.append(text);
    result.append(block);
  });

  if (!stdout && !stderr && !isSuccess) {
    const block = document.createElement('div');
    block.className = 'code-run-output-block';
    const text = document.createElement('pre');
    text.className = 'code-run-result-text';
    text.textContent = output;
    block.append(text);
    result.append(block);
  }

  if (files.length) {
    const gallery = document.createElement('div');
    gallery.className = 'code-run-gallery';

    files.forEach((file) => {
      const image = document.createElement('img');
      image.alt = '代码生成的图片';
      image.loading = 'lazy';
      image.decoding = 'async';
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

  const pre = button.closest('pre');
  let result = pre?.nextElementSibling?.classList?.contains('code-run-result')
    ? pre.nextElementSibling
    : null;

  if (!result) {
    result = document.createElement('div');
    result.className = 'code-run-result';
    pre?.after(result);
  }

  button.disabled = true;
  button.title = '运行中';
  result.textContent = '正在执行代码...';

  try {
    const payload = await callApi('/code/run', {
      method: 'POST',
      body: JSON.stringify({
        language: button.dataset.language,
        code: button.dataset.code || '',
        timeout: 10,
      }),
    });
    renderCodeRunResult(result, payload);
  } catch (error) {
    const { message } = error;
    result.innerHTML = '';
    result.classList.remove('is-code-run-success');
    result.classList.add('is-code-run-error');
    addCodeRunResultCopyControls(result, message);
    result.append(
      Object.assign(document.createElement('pre'), {
        className: 'code-run-result-text',
        textContent: error.message,
      }),
    );
  } finally {
    button.disabled = false;
    button.title = '运行代码';
  }
}

function initializeLandingMotion() {
  const landingMain = document.querySelector('.landing-main');
  if (!landingMain) {
    return;
  }

  const revealSelectors = [
    '.landing-hero .hero-copy > *',
    '.landing-hero .hero-visual',
    '.landing-bridge',
    '.landing-section-copy > *',
    '.landing-mission-path article',
    '.landing-product-card',
    '.landing-roadmap-track article',
  ];
  const revealElements = document.querySelectorAll(revealSelectors.join(','));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  revealElements.forEach((element, index) => {
    element.classList.add('landing-reveal');
    element.style.setProperty('--reveal-index', String(index % 6));

    if (prefersReducedMotion) {
      element.classList.add('is-visible');
    }
  });

  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: '0px 0px -12% 0px',
        threshold: 0.16,
      },
    );

    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add('is-visible'));
  }

  document.querySelectorAll('.landing-product-card').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
}

window.freeBbsApp = {
  callApi,
  enhanceMarkdownContent,
  get sessionReady() {
    return sessionReady;
  },
  get userState() {
    return userState;
  },
  renderMarkdownContent,
  resolveAssetUrl,
  streamAiChatResponse,
};

userName.addEventListener('click', handleAuthEntry);
avatarButtons.forEach((button) => button.addEventListener('click', handleAvatarEntry));
userSettingsButton?.addEventListener('click', handleUserSettingsClick);
userLogoutButton?.addEventListener('click', handleUserLogoutClick);
fortuneLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openFortuneModal();
  });
});
adminAddUserButton?.addEventListener('click', insertAdminDraftRow);
adminUsers?.addEventListener('click', handleAdminUsersClick);
adminUsers?.addEventListener('input', handleAdminUserFieldInput);
adminUserSearch?.addEventListener('input', updateAdminUserListFilters);
adminUserRoleFilter?.addEventListener('change', updateAdminUserListFilters);
adminUserScopeFilter?.addEventListener('change', updateAdminUserListFilters);
fortuneBonusToggle?.addEventListener('change', handleFortuneBonusToggle);
settingsForm?.addEventListener('submit', handleSettingsSubmit);
settingsPasswordForm?.addEventListener('submit', handleSettingsPasswordSubmit);
settingsAvatarInput?.addEventListener('change', handleAvatarUpload);
settingsLogoutButton?.addEventListener('click', handleSettingsLogout);
discussionBoardList?.addEventListener('click', (event) => {
  handleDiscussionBoardClick(event);
});
discussionPostList?.addEventListener('click', (event) => {
  handleDiscussionPostClick(event);
});
discussionDetail?.addEventListener('click', handleDiscussionDetailClick);
discussionDetail?.addEventListener('submit', handleDiscussionCommentSubmit);
discussionDetail?.addEventListener('input', handleDiscussionCommentInput);
discussionDetail?.addEventListener('compositionstart', handleDiscussionCommentCompositionStart);
discussionDetail?.addEventListener('compositionend', handleDiscussionCommentCompositionEnd);
discussionCreateToggle?.addEventListener('click', handleDiscussionCreateToggle);
discussionComposeForm?.addEventListener('submit', handleDiscussionComposeSubmit);
discussionBoardEdit?.addEventListener('click', editActiveBoardDescription);
discussionBoardModerators?.addEventListener('click', openBoardModeratorsPanel);
discussionBoardAboutBody?.addEventListener('click', (event) => {
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
discussionBoardAboutBody?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.closest('#discussion-moderator-query')) {
    event.preventDefault();
    searchBoardModeratorCandidates();
  }
});
discussionInsertImage?.addEventListener('click', () => discussionImageInput?.click());
discussionImageInput?.addEventListener('change', async (event) => {
  await insertDiscussionImages(event.target.files);
  event.target.value = '';
});
discussionComposeContent?.addEventListener('paste', handleDiscussionPaste);
homeFeedToggle?.addEventListener('click', handleHomeFeedToggleClick);
homeBoardDesktopMedia.addEventListener('change', loadHomeBoardActivityForViewport);
document.addEventListener('click', handleCodeCopyClick);
document.addEventListener('click', handleCodeRunClick);
document.addEventListener('click', handleAiMessageCopyClick);
document.addEventListener('click', handleElectromagneticPageClick);
document.addEventListener('click', handleInventoryPageClick);
document.addEventListener('click', handleHomeDashboardRetry);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.getElementById('fortune-modal')?.classList.add('hidden');
    closeAiCopyMenus();
    closeCodeCopyMenus();
  }
});
renderUser();
loadFortuneConfig();
sessionReady = restoreSession().finally(() => {
  renderAdminSection();
  loadElectromagneticPage();
  loadInventoryPage();
});
renderAdminSection();
renderSettingsForm();
renderDiscussionComposerState();
initializeDashboardShell();
initializeThemeMode();
initializeEconomyNavigation();
renderAdminSection();
loadHomeDiscussionPosts();
loadHomeBoardActivityForViewport();
loadHeatLeaderboard();
initializeLandingMotion();
initializeDiscussionPage();
initializeAiChatPage();
loadPublicProfile();
