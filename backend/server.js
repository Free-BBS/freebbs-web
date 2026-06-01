const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pool = require("./db");
const config = require("./config");
const { hashPassword, verifyPassword } = require("./password");
const { sign, verify } = require("./token");
const { CODE_TTL_MINUTES, buildExpiryDate, generateEmailCode, hashCode } = require("./verification");

const app = express();
const FORTUNE_BONUS_KEY = "fortune_bonus_enabled";
const HEAT_DECAY_DATE_KEY = "heat_decay_last_date";
const FORTUNE_LOOKBACK_DAYS = 30;
const CHECKIN_LOOKBACK_DAYS = 14;
const MAX_CHECKIN_STREAK_REWARD = 5;
const SHOP_CATALOG_PATH = path.join(__dirname, "..", "public", "data", "shop-items.json");
const REACTION_MANETRON_REWARDS = {
  smile: 1,
  light: 2,
  fireworks: 1
};
const MAX_AGENT_USER = {
  username: "max_the_agent",
  fullName: "Max",
  studentId: "2099999999",
  email: "max@free-bbs.local",
  avatarPath: "/assets/max_the_agent_avatar.webp"
};

async function sendVerificationCode(email, code) {
  const mailer = require("./mailer");
  return mailer.sendVerificationCode(email, code);
}
const MAX_MENTION_PATTERN = /(^|[^\p{L}\p{N}_])@max(?=$|[^\p{L}\p{N}_])/iu;
const DISCUSSION_REACTION_TYPES = new Set(["smile", "light", "fireworks"]);
const DISCUSSION_BOARD_SEEDS = [
  {
    slug: "daily",
    name: "日常",
    description: "生活、课程与校园碎碎念",
    descriptionMarkdown: "生活、课程与校园碎碎念。可以分享日常、提问、吐槽和轻量讨论。",
    sortOrder: 10
  },
  {
    slug: "math",
    name: "数理",
    description: "数学、物理与推导讨论",
    descriptionMarkdown: "数学、物理与推导讨论。支持 Markdown 与 KaTeX，例如 `$E=mc^2$`。",
    sortOrder: 20
  },
  {
    slug: "circuit",
    name: "电路",
    description: "模电、数电与硬件实现",
    descriptionMarkdown: "模电、数电与硬件实现相关内容。建议附上电路图、波形、公式或关键参数。",
    sortOrder: 30
  },
  {
    slug: "signal",
    name: "信号",
    description: "信号、系统与通信方向讨论",
    descriptionMarkdown: "信号、系统与通信方向讨论。可以贴推导、代码、仿真结果和参考资料。",
    sortOrder: 40
  },
  {
    slug: "changelog",
    name: "更新日志",
    description: "站点更新、修复与版本记录",
    descriptionMarkdown: "FREE-BBS 的站点更新、修复与版本记录。这里用于同步功能变化和维护信息。",
    sortOrder: 50
  }
];

fs.mkdirSync(config.uploadDir, { recursive: true });

app.use(express.json({ limit: "28mb" }));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.use("/uploads", express.static(config.uploadDir));

async function ensureAppSettingsTable() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      setting_value VARCHAR(255) NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );
}

function generateUserUid() {
  return `u_${crypto.randomBytes(8).toString("hex")}`;
}

function generateDiscussionPostPid() {
  return `p_${crypto.randomBytes(8).toString("hex")}`;
}

async function createUniqueUserUid() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const uid = generateUserUid();
    const [rows] = await pool.execute(
      `SELECT id FROM users WHERE uid = ? LIMIT 1`,
      [uid]
    );

    if (!rows[0]) {
      return uid;
    }
  }

  throw new Error("无法生成唯一 UID");
}

async function createUniqueDiscussionPostPid() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pid = generateDiscussionPostPid();
    const [rows] = await pool.execute(
      `SELECT id FROM discussion_posts WHERE pid = ? LIMIT 1`,
      [pid]
    );

    if (!rows[0]) {
      return pid;
    }
  }

  throw new Error("无法生成唯一 PID");
}

async function ensureUsersUidColumn() {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'uid'
     LIMIT 1`
  );

  if (!columns[0]) {
    await pool.execute(
      `ALTER TABLE users
       ADD COLUMN uid VARCHAR(32) NULL AFTER id,
       ADD UNIQUE KEY uq_users_uid (uid)`
    );
  }

  const [usersWithoutUid] = await pool.execute(
    `SELECT id
     FROM users
     WHERE uid IS NULL OR uid = ''
     ORDER BY id ASC`
  );

  for (const row of usersWithoutUid) {
    await pool.execute(
      `UPDATE users
       SET uid = ?
       WHERE id = ? AND (uid IS NULL OR uid = '')`,
      [await createUniqueUserUid(), row.id]
    );
  }

  const [indexes] = await pool.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'uid'
       AND NON_UNIQUE = 0
     LIMIT 1`
  );

  if (!indexes[0]) {
    await pool.execute(`ALTER TABLE users ADD UNIQUE KEY uq_users_uid (uid)`);
  }
}

async function ensureDiscussionTables() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_boards (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      description VARCHAR(255) NULL,
      description_markdown MEDIUMTEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  const [boardDescriptionColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_boards'
       AND COLUMN_NAME = 'description_markdown'
     LIMIT 1`
  );

  if (!boardDescriptionColumns[0]) {
    await pool.execute(
      `ALTER TABLE discussion_boards
       ADD COLUMN description_markdown MEDIUMTEXT NULL AFTER description`
    );
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_posts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      pid VARCHAR(32) NULL UNIQUE,
      board_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      author_student_id VARCHAR(10) NULL,
      title VARCHAR(120) NOT NULL,
      content_markdown MEDIUMTEXT NOT NULL,
      is_pinned TINYINT(1) NOT NULL DEFAULT 0,
      pinned_at DATETIME NULL,
      pinned_by BIGINT NULL,
      is_featured TINYINT(1) NOT NULL DEFAULT 0,
      featured_at DATETIME NULL,
      featured_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_discussion_posts_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_discussion_posts_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_posts_pinned_by
        FOREIGN KEY (pinned_by) REFERENCES users (id)
        ON DELETE SET NULL,
      CONSTRAINT fk_discussion_posts_featured_by
        FOREIGN KEY (featured_by) REFERENCES users (id)
        ON DELETE SET NULL,
      INDEX idx_discussion_posts_featured_created_at (is_featured, featured_at DESC, created_at DESC),
      INDEX idx_discussion_posts_pinned_created_at (is_pinned, pinned_at DESC, created_at DESC),
      INDEX idx_discussion_posts_board_created_at (board_id, created_at DESC),
      INDEX idx_discussion_posts_created_at (created_at DESC)
    )`
  );

  const [pidColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_posts'
       AND COLUMN_NAME = 'pid'
     LIMIT 1`
  );

  if (!pidColumns[0]) {
    await pool.execute(
      `ALTER TABLE discussion_posts
       ADD COLUMN pid VARCHAR(32) NULL AFTER id`
    );
  }

  const [postsWithoutPid] = await pool.execute(
    `SELECT id
     FROM discussion_posts
     WHERE pid IS NULL OR pid = ''
     ORDER BY id ASC`
  );

  for (const row of postsWithoutPid) {
    await pool.execute(
      `UPDATE discussion_posts
       SET pid = ?
       WHERE id = ? AND (pid IS NULL OR pid = '')`,
      [await createUniqueDiscussionPostPid(), row.id]
    );
  }

  const [pidIndexes] = await pool.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_posts'
       AND COLUMN_NAME = 'pid'
       AND NON_UNIQUE = 0
     LIMIT 1`
  );

  if (!pidIndexes[0]) {
    await pool.execute(`ALTER TABLE discussion_posts ADD UNIQUE KEY uq_discussion_posts_pid (pid)`);
  }

  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_posts'
       AND COLUMN_NAME = 'author_student_id'
     LIMIT 1`
  );

  if (!columns[0]) {
    await pool.execute(
      `ALTER TABLE discussion_posts
       ADD COLUMN author_student_id VARCHAR(10) NULL AFTER user_id`
    );
  }

  await pool.execute(
    `UPDATE discussion_posts p
     INNER JOIN users u ON u.id = p.user_id
     SET p.author_student_id = u.student_id
     WHERE p.author_student_id IS NULL`
  );

  const postPinColumns = [
    ["is_pinned", "ALTER TABLE discussion_posts ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER content_markdown"],
    ["pinned_at", "ALTER TABLE discussion_posts ADD COLUMN pinned_at DATETIME NULL AFTER is_pinned"],
    ["pinned_by", "ALTER TABLE discussion_posts ADD COLUMN pinned_by BIGINT NULL AFTER pinned_at"],
    ["is_featured", "ALTER TABLE discussion_posts ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER pinned_by"],
    ["featured_at", "ALTER TABLE discussion_posts ADD COLUMN featured_at DATETIME NULL AFTER is_featured"],
    ["featured_by", "ALTER TABLE discussion_posts ADD COLUMN featured_by BIGINT NULL AFTER featured_at"]
  ];

  for (const [columnName, alterSql] of postPinColumns) {
    const [pinColumns] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'discussion_posts'
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [columnName]
    );

    if (!pinColumns[0]) {
      await pool.execute(alterSql);
    }
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_post_likes (
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      reaction_type VARCHAR(24) NOT NULL DEFAULT 'smile',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id, reaction_type),
      CONSTRAINT fk_discussion_post_likes_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_post_likes_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_post_likes_user (user_id)
    )`
  );

  const [reactionColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_post_likes'
       AND COLUMN_NAME = 'reaction_type'
     LIMIT 1`
  );

  if (!reactionColumns[0]) {
    await pool.execute(
      `ALTER TABLE discussion_post_likes
       ADD COLUMN reaction_type VARCHAR(24) NOT NULL DEFAULT 'smile' AFTER user_id,
       DROP PRIMARY KEY,
       ADD PRIMARY KEY (post_id, user_id, reaction_type)`
    );
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      post_id BIGINT NOT NULL,
      parent_comment_id BIGINT NULL,
      user_id BIGINT NOT NULL,
      author_student_id VARCHAR(10) NULL,
      content_markdown TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_discussion_comments_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_comments_parent
        FOREIGN KEY (parent_comment_id) REFERENCES discussion_comments (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_comments_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_comments_parent (parent_comment_id),
      INDEX idx_discussion_comments_post_created_at (post_id, created_at ASC),
      INDEX idx_discussion_comments_user (user_id)
    )`
  );

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_board_moderators (
      board_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (board_id, user_id),
      CONSTRAINT fk_discussion_board_moderators_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_board_moderators_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_board_moderators_user (user_id)
    )`
  );

  const [commentColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discussion_comments'
       AND COLUMN_NAME = 'parent_comment_id'
     LIMIT 1`
  );

  if (!commentColumns[0]) {
    await pool.execute(
      `ALTER TABLE discussion_comments
       ADD COLUMN parent_comment_id BIGINT NULL AFTER post_id,
       ADD INDEX idx_discussion_comments_parent (parent_comment_id),
       ADD CONSTRAINT fk_discussion_comments_parent
         FOREIGN KEY (parent_comment_id) REFERENCES discussion_comments (id)
         ON DELETE CASCADE`
    );
  }

  for (const board of DISCUSSION_BOARD_SEEDS) {
    await pool.execute(
      `INSERT INTO discussion_boards (slug, name, description, description_markdown, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         description_markdown = COALESCE(discussion_boards.description_markdown, VALUES(description_markdown)),
         sort_order = VALUES(sort_order),
         is_active = VALUES(is_active)`,
      [board.slug, board.name, board.description, board.descriptionMarkdown, board.sortOrder]
    );
  }
}

async function ensureAiDialogTables() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS ai_dialogs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      did VARCHAR(36) NOT NULL UNIQUE,
      user_id BIGINT NOT NULL,
      title VARCHAR(120) NOT NULL,
      messages_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_ai_dialogs_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_ai_dialogs_user_updated_at (user_id, updated_at DESC)
    )`
  );
}

async function ensureFortuneTables() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS user_fortunes (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      fortune_date DATE NOT NULL,
      score INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_fortunes_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      UNIQUE KEY uq_user_fortunes_user_date (user_id, fortune_date),
      INDEX idx_user_fortunes_user_date (user_id, fortune_date)
    )`
  );
}

async function ensureEconomyTables() {
  const userColumns = [
    ["heat", "ALTER TABLE users ADD COLUMN heat BIGINT NOT NULL DEFAULT 0 AFTER manetrons"]
  ];

  for (const [columnName, alterSql] of userColumns) {
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [columnName]
    );

    if (!columns[0]) {
      await pool.execute(alterSql);
    }
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS user_assets (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      asset_key VARCHAR(64) NOT NULL,
      quantity BIGINT NOT NULL DEFAULT 0,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_assets_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      UNIQUE KEY uq_user_assets_user_asset (user_id, asset_key),
      INDEX idx_user_assets_asset_key (asset_key)
    )`
  );

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS user_checkins (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      checkin_date DATE NOT NULL,
      streak_count INT NOT NULL DEFAULT 1,
      reward_electrons INT NOT NULL DEFAULT 1,
      fortune_score INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_checkins_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      UNIQUE KEY uq_user_checkins_user_date (user_id, checkin_date),
      INDEX idx_user_checkins_user_date (user_id, checkin_date)
    )`
  );
}

async function ensureEconomyReady() {
  await ensureFortuneTables();
  await ensureEconomyTables();
}

async function ensureMaxAgentUser() {
  const existing = await getUserByIdFromUsername(MAX_AGENT_USER.username);

  if (existing) {
    await pool.execute(
      `UPDATE users
       SET uid = COALESCE(NULLIF(uid, ''), ?),
           full_name = ?,
           avatar_path = ?
       WHERE id = ?`,
      [await createUniqueUserUid(), MAX_AGENT_USER.fullName, MAX_AGENT_USER.avatarPath, existing.id]
    );
    return;
  }

  const passwordHash = hashPassword(crypto.randomUUID());

  await pool.execute(
    `INSERT INTO users (uid, username, full_name, student_id, email, password_hash, email_verified_at, role, avatar_path)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 'student', ?)`,
    [
      await createUniqueUserUid(),
      MAX_AGENT_USER.username,
      MAX_AGENT_USER.fullName,
      MAX_AGENT_USER.studentId,
      MAX_AGENT_USER.email,
      passwordHash,
      MAX_AGENT_USER.avatarPath
    ]
  );
}

async function getAppSetting(key, defaultValue = "") {
  const [rows] = await pool.execute(
    `SELECT setting_value
     FROM app_settings
     WHERE setting_key = ?
     LIMIT 1`,
    [key]
  );

  return rows[0]?.setting_value ?? defaultValue;
}

async function setAppSetting(key, value) {
  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, String(value)]
  );
}

async function getFortuneBonusEnabled() {
  return (await getAppSetting(FORTUNE_BONUS_KEY, "0")) === "1";
}

async function decayHeatIfNeeded(referenceDate = new Date()) {
  await ensureEconomyTables();

  const todayKey = toDateKey(referenceDate);
  const lastDecayDate = await getAppSetting(HEAT_DECAY_DATE_KEY, "");

  if (!lastDecayDate) {
    await setAppSetting(HEAT_DECAY_DATE_KEY, todayKey);
    return false;
  }

  if (lastDecayDate === todayKey) {
    return false;
  }

  await pool.execute(
    `UPDATE users
     SET heat = CEIL(heat / 2)
     WHERE heat > 0`
  );
  await setAppSetting(HEAT_DECAY_DATE_KEY, todayKey);
  return true;
}

function scheduleNextHeatDecay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const delay = Math.max(1000, next.getTime() - now.getTime());

  setTimeout(async () => {
    try {
      await decayHeatIfNeeded(new Date());
    } catch (error) {
      console.error("Failed to decay heat", error);
    } finally {
      scheduleNextHeatDecay();
    }
  }, delay);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function generateFortuneScore(fortuneBonusEnabled) {
  return crypto.randomInt(0, 101) + (fortuneBonusEnabled ? 20 : 0);
}

async function ensureUserFortuneWindow(user, fortuneBonusEnabled) {
  await ensureFortuneTables();

  const today = new Date();
  const todayKey = toDateKey(today);
  const dates = Array.from({ length: FORTUNE_LOOKBACK_DAYS }, (_, index) => (
    toDateKey(addDays(today, index - FORTUNE_LOOKBACK_DAYS + 1))
  ));

  await pool.execute(
    `INSERT IGNORE INTO user_fortunes (user_id, fortune_date, score)
     VALUES (?, ?, ?)`,
    [user.id, todayKey, generateFortuneScore(fortuneBonusEnabled)]
  );

  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(fortune_date, '%Y-%m-%d') AS fortune_date, score
     FROM user_fortunes
     WHERE user_id = ?
       AND fortune_date BETWEEN ? AND ?`,
    [user.id, dates[0], dates[dates.length - 1]]
  );
  const scoreByDate = new Map(rows.map((row) => [row.fortune_date, Number(row.score)]));

  return dates.map((date) => ({
    date,
    score: scoreByDate.has(date) ? scoreByDate.get(date) : null
  }));
}

async function getCheckinSummary(user, fortuneBonusEnabled) {
  await ensureEconomyReady();

  const today = new Date();
  const todayKey = toDateKey(today);
  const startKey = toDateKey(addDays(today, -CHECKIN_LOOKBACK_DAYS + 1));
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(checkin_date, '%Y-%m-%d') AS checkin_date,
            streak_count,
            reward_electrons,
            fortune_score
     FROM user_checkins
     WHERE user_id = ?
       AND checkin_date BETWEEN ? AND ?
     ORDER BY checkin_date DESC`,
    [user.id, startKey, todayKey]
  );
  const todayRow = rows.find((row) => row.checkin_date === todayKey);
  const fortuneHistory = await ensureUserFortuneWindow(user, fortuneBonusEnabled);
  const todayFortune = fortuneHistory.find((item) => item.date === todayKey);

  return {
    checkedInToday: Boolean(todayRow),
    today: todayRow ? {
      date: todayRow.checkin_date,
      streak: Number(todayRow.streak_count || 0),
      rewardElectrons: Number(todayRow.reward_electrons || 0),
      fortuneScore: Number(todayRow.fortune_score ?? todayFortune?.score ?? 0)
    } : null,
    todayFortune: {
      date: todayKey,
      score: Number(todayFortune?.score ?? 0)
    },
    records: rows.map((row) => ({
      date: row.checkin_date,
      streak: Number(row.streak_count || 0),
      rewardElectrons: Number(row.reward_electrons || 0),
      fortuneScore: Number(row.fortune_score || 0)
    }))
  };
}

async function performDailyCheckin(user) {
  await ensureEconomyReady();

  const fortuneBonusEnabled = await getFortuneBonusEnabled();
  const today = new Date();
  const todayKey = toDateKey(today);
  const yesterdayKey = toDateKey(addDays(today, -1));
  const fortuneHistory = await ensureUserFortuneWindow(user, fortuneBonusEnabled);
  const todayFortune = fortuneHistory.find((item) => item.date === todayKey);

  const [existing] = await pool.execute(
    `SELECT DATE_FORMAT(checkin_date, '%Y-%m-%d') AS checkin_date,
            streak_count,
            reward_electrons,
            fortune_score
     FROM user_checkins
     WHERE user_id = ? AND checkin_date = ?
     LIMIT 1`,
    [user.id, todayKey]
  );

  if (existing[0]) {
    return {
      alreadyCheckedIn: true,
      summary: await getCheckinSummary(user, fortuneBonusEnabled)
    };
  }

  const [previousRows] = await pool.execute(
    `SELECT streak_count
     FROM user_checkins
     WHERE user_id = ? AND checkin_date = ?
     LIMIT 1`,
    [user.id, yesterdayKey]
  );
  const streak = previousRows[0] ? Number(previousRows[0].streak_count || 0) + 1 : 1;
  const rewardElectrons = Math.min(streak, MAX_CHECKIN_STREAK_REWARD);
  const fortuneScore = Number(todayFortune?.score ?? generateFortuneScore(fortuneBonusEnabled));

  await pool.execute(
    `INSERT INTO user_checkins (user_id, checkin_date, streak_count, reward_electrons, fortune_score)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, todayKey, streak, rewardElectrons, fortuneScore]
  );
  await pool.execute(
    `UPDATE users
     SET electrons = electrons + ?
     WHERE id = ?`,
    [rewardElectrons, user.id]
  );

  return {
    alreadyCheckedIn: false,
    summary: await getCheckinSummary(user, fortuneBonusEnabled)
  };
}

async function getUserAssets(userId) {
  await ensureEconomyTables();
  const shopItems = getShopItems();
  const shopItemByAsset = new Map(shopItems.map((item) => [item.assetKey, item]));

  const [rows] = await pool.execute(
    `SELECT asset_key, quantity, metadata_json, created_at, updated_at
     FROM user_assets
     WHERE user_id = ?
       AND quantity > 0
     ORDER BY asset_key ASC`,
    [userId]
  );

  return rows.map((row) => ({
    key: row.asset_key,
    quantity: Number(row.quantity || 0),
    metadata: row.metadata_json || null,
    item: shopItemByAsset.get(row.asset_key) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function getShopItems() {
  try {
    const raw = JSON.parse(fs.readFileSync(SHOP_CATALOG_PATH, "utf8"));
    const items = Array.isArray(raw.items) ? raw.items : [];

    return items.map((item) => {
      const key = String(item.key || "").trim();
      const baseCost = item.cost && typeof item.cost === "object" ? item.cost : {};
      const cost = {
        ...baseCost,
        ...(item.electric ? { electric: item.electric } : {}),
        ...(item.magnetic ? { magnetic: item.magnetic } : {})
      };

      return {
        key,
        assetKey: String(item.assetKey || key).trim(),
        name: String(item.name || key).trim(),
        class: String(item.class || "usable").trim(),
        description: String(item.description || "").trim(),
        desc: String(item.desc || item.description || "").trim(),
        image: String(item.image || "").trim(),
        cost: Object.fromEntries(
          Object.entries(cost)
            .map(([currency, value]) => [normalizeCurrencyType(currency), Number(value)])
            .filter(([currency, value]) => ["electric", "magnetic"].includes(currency) && Number.isFinite(value) && value > 0)
        ),
        use: item.use && typeof item.use === "object" ? item.use : null
      };
    }).filter((item) => item.key && item.assetKey);
  } catch (error) {
    console.error("Failed to load shop catalog", error);
    return [];
  }
}

function getShopItem(key) {
  const normalizedKey = String(key || "").replace(/-/g, "_");
  return getShopItems().find((item) => item.key === normalizedKey || item.assetKey === normalizedKey) || null;
}

async function getHeatLeaderboard(limit = 3) {
  await ensureEconomyTables();

  const [rows] = await pool.execute(
    `SELECT uid, username, full_name, avatar_path, heat
     FROM users
     WHERE heat > 0
     ORDER BY heat DESC, updated_at DESC, id ASC
     LIMIT ${normalizeLimit(limit, 3, 10)}`
  );

  return rows.map((row) => ({
    uid: row.uid || "",
    username: row.username,
    fullName: row.full_name,
    avatarPath: row.avatar_path || "",
    heat: Number(row.heat || 0)
  }));
}

function normalizeCurrencyType(value) {
  const currency = String(value || "").trim().toLowerCase();

  if (["electric", "electron", "electrons"].includes(currency)) {
    return "electric";
  }

  if (["magnetic", "magnetron", "manetron", "manetrons", "magnetrons"].includes(currency)) {
    return "magnetic";
  }

  return "";
}

function currencyColumn(currency) {
  if (currency === "electric") {
    return "electrons";
  }

  if (currency === "magnetic") {
    return "manetrons";
  }

  return "manetrons";
}

async function awardPostAuthorManetrons(post, delta) {
  if (!post?.user_id || !delta) {
    return;
  }

  await pool.execute(
    `UPDATE users
     SET manetrons = GREATEST(0, manetrons + ?)
     WHERE id = ?`,
    [delta, post.user_id]
  );
}

function toUserProfile(row) {
  return {
    id: row.id,
    uid: row.uid || "",
    username: row.username,
    fullName: row.full_name,
    studentId: row.student_id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    role: row.role,
    grade: row.grade,
    major: row.major,
    avatarPath: row.avatar_path || "",
    bio: row.bio || "",
    websiteUrl: row.website_url || "",
    electrons: Number(row.electrons || 0),
    manetrons: Number(row.manetrons || 0),
    heat: Number(row.heat || 0),
    createdAt: row.created_at
  };
}

function toDiscussionBoard(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    descriptionMarkdown: row.description_markdown || row.description || "",
    sortOrder: Number(row.sort_order || 0),
    canModerate: Boolean(row.can_moderate),
    canManageModerators: Boolean(row.can_manage_moderators)
  };
}

function toDiscussionPostSummary(row) {
  return {
    id: row.pid || String(row.id),
    pid: row.pid || String(row.id),
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    board: {
      slug: row.board_slug,
      name: row.board_name
    },
    isPinned: Boolean(row.is_pinned),
    pinnedAt: row.pinned_at || null,
    isFeatured: Boolean(row.is_featured),
    featuredAt: row.featured_at || null,
    canFeature: Boolean(row.can_feature),
    canPin: Boolean(row.can_pin),
    canDelete: Boolean(row.can_delete),
    author: {
      id: row.user_id,
      uid: row.uid || "",
      username: row.username,
      fullName: "",
      displayName: row.username || "匿名用户",
      avatarPath: row.avatar_path || ""
    },
    likeCount: Number(row.like_count || 0),
    lightCount: Number(row.light_count || 0),
    fireworksCount: Number(row.fireworks_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByMe: Boolean(row.liked_by_me),
    lightedByMe: Boolean(row.lighted_by_me),
    fireworksByMe: Boolean(row.fireworks_by_me)
  };
}

function toDiscussionComment(row) {
  return {
    id: row.id,
    parentCommentId: row.parent_comment_id ? Number(row.parent_comment_id) : null,
    contentMarkdown: row.content_markdown || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.user_id,
      uid: row.uid || "",
      username: row.username,
      fullName: "",
      displayName: row.username || "匿名用户",
      avatarPath: row.avatar_path || ""
    }
  };
}

function toDiscussionPostDetail(row) {
  return {
    ...toDiscussionPostSummary(row),
    contentMarkdown: row.content_markdown || ""
  };
}

async function getDiscussionCommentById(commentId) {
  const [rows] = await pool.execute(
    `SELECT c.id, c.post_id, c.parent_comment_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
            COALESCE(c.author_student_id, u.student_id) AS author_student_id,
            u.student_id, u.uid, u.username, u.full_name, u.avatar_path
     FROM discussion_comments c
     INNER JOIN users u ON u.id = c.user_id
     WHERE c.id = ?
     LIMIT 1`,
    [commentId]
  );

  return rows[0] ? toDiscussionComment(rows[0]) : null;
}

function shouldAskMax(contentMarkdown) {
  return MAX_MENTION_PATTERN.test(String(contentMarkdown || ""));
}

function buildMaxDiscussionPrompt(post, comments, triggerComment) {
  const renderedComments = comments.map((comment) => {
    const prefix = comment.id === triggerComment.id ? "[触发 @max 的评论]" : "[评论]";
    const parent = comment.parentCommentId ? ` 回复 #${comment.parentCommentId}` : "";
    return `${prefix} #${comment.id}${parent} ${comment.author.displayName}：\n${comment.contentMarkdown}`;
  }).join("\n\n");

  return [
    "你是 FREE-BBS 讨论区中的 Max。请根据帖子正文和评论上下文，回复触发 @max 的那条评论。",
    "要求：直接给出可作为评论发布的内容；支持 Markdown 和 KaTeX；不要编造未知事实；如果信息不足，请说明需要补充的信息。",
    "",
    `帖子标题：${post.title}`,
    `版块：${post.board.name}`,
    `发帖人：${post.author.displayName}`,
    "",
    "帖子正文：",
    post.contentMarkdown,
    "",
    "评论上下文：",
    renderedComments || "暂无其他评论"
  ].join("\n");
}

function buildAgentUserContext(user) {
  if (!user) {
    return null;
  }

  return {
    uid: user.uid || "",
    username: user.username || "",
    fullName: user.fullName || user.full_name || "",
    studentId: user.student_id || user.studentId || "",
    displayName: user.displayName || user.fullName || user.full_name || user.username || ""
  };
}

function buildAgentChatPayload(user, payload, defaults = {}) {
  return {
    ...payload,
    agent: payload.agent || defaults.agent || "general_chat",
    source: payload.source || defaults.source || "direct_chat",
    channel: payload.channel || defaults.channel || payload.source || defaults.source || "direct_chat",
    user: buildAgentUserContext(user),
    context: {
      ...(defaults.context || {}),
      ...(payload.context && typeof payload.context === "object" ? payload.context : {})
    }
  };
}

async function postAgentChat(payload) {
  return fetch(`${config.agentBaseUrl.replace(/\/$/, "")}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function normalizeSandboxLanguage(language) {
  const value = String(language || "").trim().toLowerCase();

  if (value === "python" || value === "py") {
    return "python";
  }

  if (value === "c" || value === "gcc" || value === "cpp" || value === "c++" || value === "cplusplus" || value === "cc" || value === "cxx" || value === "g++") {
    return "cpp";
  }

  return "";
}

function getSandboxUid(user) {
  return user.uid || user.username || `user-${user.id}`;
}

function isSafeSandboxFilename(filename) {
  return /^[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(String(filename || ""));
}

function mapSandboxOutputFiles(files, uid) {
  const outputRoot = path.resolve(config.sandboxOutputDir);
  const userOutputRoot = path.resolve(outputRoot, uid);

  return (Array.isArray(files) ? files : [])
    .map((file) => {
      const resolved = path.resolve(String(file || ""));

      if (!resolved.startsWith(`${userOutputRoot}${path.sep}`)) {
        return "";
      }

      const filename = path.basename(resolved);

      if (!isSafeSandboxFilename(filename)) {
        return "";
      }

      return `/api/code/outputs/${encodeURIComponent(uid)}/${encodeURIComponent(filename)}`;
    })
    .filter(Boolean);
}

async function postSandboxRun(payload, timeoutSeconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 3) * 1000);

  try {
    return await fetch(`${config.sandboxBaseUrl.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function createMaxDiscussionReply(postId, triggerComment) {
  await ensureMaxAgentUser();

  const [postRows] = await pool.execute(
    `SELECT p.id, p.pid, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
            p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
            b.slug AS board_slug, b.name AS board_name,
            COALESCE(p.author_student_id, u.student_id) AS author_student_id,
            u.student_id, u.uid, u.username, u.full_name, u.avatar_path,
            0 AS like_count,
            0 AS light_count,
            0 AS fireworks_count,
            0 AS comment_count,
            0 AS liked_by_me,
            0 AS lighted_by_me,
            0 AS fireworks_by_me,
            0 AS can_feature,
            0 AS can_pin,
            0 AS can_delete
     FROM discussion_posts p
     INNER JOIN discussion_boards b ON b.id = p.board_id
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.id = ?
     LIMIT 1`,
    [postId]
  );

  if (!postRows[0]) {
    return null;
  }

  const [commentRows] = await pool.execute(
    `SELECT c.id, c.post_id, c.parent_comment_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
            COALESCE(c.author_student_id, u.student_id) AS author_student_id,
            u.student_id, u.uid, u.username, u.full_name, u.avatar_path
     FROM discussion_comments c
     INNER JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC, c.id ASC`,
    [postId]
  );

  const post = toDiscussionPostDetail(postRows[0]);
  const comments = commentRows.map(toDiscussionComment);
  const prompt = buildMaxDiscussionPrompt(post, comments, triggerComment);
  const agentResponse = await postAgentChat({
    agent: "comment_mention",
    source: "comment",
    channel: "discussion_comment",
    message: prompt,
    temperature: 0.5,
    context: {
      post: {
        id: post.id,
        pid: post.pid,
        title: post.title,
        board: post.board,
        author: post.author,
        contentMarkdown: post.contentMarkdown
      },
      triggerComment,
      comments
    }
  });

  const agentPayload = await agentResponse.json().catch(() => ({}));

  if (!agentResponse.ok) {
    throw new Error(agentPayload?.error?.message || agentPayload.message || "Max 暂时无法回复");
  }

  const answer = String(agentPayload.answer || agentPayload.content || "").trim();

  if (!answer) {
    return null;
  }

  const maxUser = await getUserByIdFromUsername(MAX_AGENT_USER.username);
  if (!maxUser) {
    return null;
  }

  const [result] = await pool.execute(
    `INSERT INTO discussion_comments (post_id, parent_comment_id, user_id, author_student_id, content_markdown)
     VALUES (?, ?, ?, ?, ?)`,
    [postId, triggerComment.id, maxUser.id, maxUser.student_id, answer.slice(0, 5000)]
  );

  return getDiscussionCommentById(result.insertId);
}

function toAiDialogSummary(row) {
  return {
    did: row.did,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAiMessages(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages = [];

  for (const message of value) {
    if (!message || typeof message !== "object") {
      return null;
    }

    const role = message.role;
    const content = message.content;

    if (!["user", "assistant"].includes(role)) {
      return null;
    }

    if (typeof content !== "string") {
      return null;
    }

    messages.push({
      role,
      content: content.slice(0, 20000)
    });
  }

  return messages;
}

function buildAiDialogTitle(title, messages) {
  const explicitTitle = String(title || "").trim();

  if (explicitTitle) {
    return explicitTitle.slice(0, 120);
  }

  const firstUserMessage = messages.find((message) => message.role === "user")?.content || "新的对话";
  return firstUserMessage.replace(/\s+/g, " ").trim().slice(0, 32) || "新的对话";
}

function normalizeLimit(value, defaultLimit = 12, maxLimit = 50) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.floor(parsed), maxLimit);
}

async function getDiscussionBoardBySlug(slug) {
  const [rows] = await pool.execute(
    `SELECT id, slug, name, description, description_markdown, sort_order
     FROM discussion_boards
     WHERE slug = ?
       AND is_active = 1
     LIMIT 1`,
    [slug]
  );

  return rows[0] || null;
}

async function getDiscussionPostByPublicId(value) {
  const postKey = String(value || "").trim();

  if (!postKey) {
    return null;
  }

  const params = [postKey];
  let legacyCondition = "";

  if (/^\d+$/.test(postKey)) {
    legacyCondition = " OR id = ?";
    params.push(Number(postKey));
  }

  const [rows] = await pool.execute(
    `SELECT id, pid, board_id
     FROM discussion_posts
     WHERE pid = ?${legacyCondition}
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

async function canModerateBoard(user, boardId) {
  if (!user || !boardId) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  const [rows] = await pool.execute(
    `SELECT board_id
     FROM discussion_board_moderators
     WHERE board_id = ? AND user_id = ?
     LIMIT 1`,
    [boardId, user.id]
  );

  return Boolean(rows[0]);
}

async function requireDiscussionBoardModerator(user, boardId, response) {
  if (await canModerateBoard(user, boardId)) {
    return true;
  }

  response.status(403).json({ message: "需要该版块版主权限" });
  return false;
}

function issueToken(user) {
  return sign({
    sub: user.id,
    username: user.username,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
}

async function getUserById(id) {
  const [rows] = await pool.execute(
    `SELECT id, uid, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, heat, grade, major, avatar_path, bio, website_url, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

async function getUserByIdFromUsername(username) {
  const [rows] = await pool.execute(
    `SELECT id, uid, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, heat, grade, major, avatar_path, bio, website_url, created_at
     FROM users WHERE username = ? LIMIT 1`,
    [username]
  );

  return rows[0] || null;
}

async function requireAuth(request, response) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const payload = verify(token);

  if (!payload || !payload.sub) {
    response.status(401).json({ message: "未登录或登录已失效" });
    return null;
  }

  const user = await getUserById(payload.sub);

  if (!user) {
    response.status(401).json({ message: "用户不存在" });
    return null;
  }

  return user;
}

async function getOptionalAuthUser(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const payload = verify(token);

  if (!payload || !payload.sub) {
    return null;
  }

  return getUserById(payload.sub);
}

async function requireAdmin(request, response) {
  const user = await requireAuth(request, response);

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    response.status(403).json({ message: "需要管理员权限" });
    return null;
  }

  return user;
}

function sanitizeWebsiteUrl(value) {
  const websiteUrl = String(value || "").trim();

  if (!websiteUrl) {
    return "";
  }

  try {
    const url = new URL(websiteUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function buildAvatarFileName(userId, mimeType) {
  const extensionMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const extension = extensionMap[mimeType];

  if (!extension) {
    return null;
  }

  return `user-${userId}-${Date.now()}${extension}`;
}

function buildDiscussionImageFileName(userId) {
  const suffix = crypto.randomBytes(8).toString("hex");
  return `discussion-${userId}-${Date.now()}-${suffix}.webp`;
}

function removeStoredAvatar(avatarPath) {
  if (!avatarPath) {
    return;
  }

  const fileName = path.basename(avatarPath);
  fs.promises.unlink(path.join(config.uploadDir, fileName)).catch(() => {});
}

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({
      ok: true,
      dbHost: config.db.host,
      database: config.db.database
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Database connection failed",
      detail: error.message
    });
  }
});

app.post("/api/ai/chat", async (request, response) => {
  const user = await requireAuth(request, response);

  if (!user) {
    return;
  }

  const payload = request.body;

  if (!payload || typeof payload !== "object") {
    response.status(400).json({ message: "请求体必须是 JSON 对象" });
    return;
  }

  try {
    const agentPayload = buildAgentChatPayload(user, payload, {
      agent: "general_chat",
      source: "direct_chat",
      channel: "aichat",
      context: {
        dialogId: payload.did || payload.conversationId || payload.conversation_id || ""
      }
    });
    const agentResponse = await postAgentChat(agentPayload);

    if (payload.stream) {
      response.status(agentResponse.status);
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("X-Accel-Buffering", "no");

      if (!agentResponse.body) {
        response.end();
        return;
      }

      for await (const chunk of agentResponse.body) {
        response.write(chunk);
      }
      response.end();
      return;
    }

    const text = await agentResponse.text();
    response.status(agentResponse.status);
    response.setHeader("Content-Type", agentResponse.headers.get("content-type") || "application/json; charset=utf-8");
    response.send(text);
  } catch (error) {
    response.status(502).json({
      message: "AI 服务暂时不可用",
      detail: error.message
    });
  }
});

app.post("/api/code/run", async (request, response) => {
  const user = await requireAuth(request, response);

  if (!user) {
    return;
  }

  const language = normalizeSandboxLanguage(request.body?.language);
  const code = String(request.body?.code || "");
  const timeout = Math.min(Math.max(Number(request.body?.timeout || 10), 1), 30);

  if (!language) {
    response.status(400).json({ message: "仅支持运行 Python 和 C++ 代码" });
    return;
  }

  if (!code.trim()) {
    response.status(400).json({ message: "代码不能为空" });
    return;
  }

  if (Buffer.byteLength(code, "utf8") > 256 * 1024) {
    response.status(400).json({ message: "代码过长" });
    return;
  }

  const uid = getSandboxUid(user);

  try {
    const sandboxResponse = await postSandboxRun({
      language,
      code,
      uid,
      timeout
    }, timeout);
    const text = await sandboxResponse.text();
    const payload = JSON.parse(text || "{}");
    payload.files = mapSandboxOutputFiles(payload.files, uid);

    response.status(sandboxResponse.ok ? 200 : sandboxResponse.status).json(payload);
  } catch (error) {
    const message = error.name === "AbortError" ? "代码执行超时" : "代码沙盒不可用";
    response.status(502).json({
      message,
      detail: error.message
    });
  }
});

app.get("/api/code/outputs/:uid/:filename", async (request, response) => {
  const user = await requireAuth(request, response);

  if (!user) {
    return;
  }

  const uid = String(request.params.uid || "");
  const filename = String(request.params.filename || "");
  const expectedUid = getSandboxUid(user);

  if (uid !== expectedUid && user.role !== "admin") {
    response.status(403).json({ message: "无权访问该输出文件" });
    return;
  }

  if (!isSafeSandboxFilename(filename)) {
    response.status(400).json({ message: "非法文件名" });
    return;
  }

  const outputRoot = path.resolve(config.sandboxOutputDir);
  const targetPath = path.resolve(outputRoot, uid, filename);

  if (!targetPath.startsWith(`${path.resolve(outputRoot, uid)}${path.sep}`)) {
    response.status(400).json({ message: "非法文件路径" });
    return;
  }

  response.setHeader("Cache-Control", "private, max-age=3600");
  response.sendFile(targetPath, (error) => {
    if (error && !response.headersSent) {
      response.status(error.statusCode || 404).json({ message: "输出文件不存在" });
    }
  });
});

app.get("/api/ai/dialogs", async (request, response) => {
  try {
    await ensureAiDialogTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const limit = normalizeLimit(request.query.limit, 12, 30);
    const [rows] = await pool.execute(
      `SELECT did, title, created_at, updated_at
       FROM ai_dialogs
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ${limit}`,
      [user.id]
    );

    response.json({
      dialogs: rows.map(toAiDialogSummary)
    });
  } catch (error) {
    response.status(500).json({ message: "获取 AI 对话失败", detail: error.message });
  }
});

app.get("/api/ai/dialogs/:did", async (request, response) => {
  try {
    await ensureAiDialogTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const did = String(request.params.did || "").trim();
    const [rows] = await pool.execute(
      `SELECT did, title, messages_json, created_at, updated_at
       FROM ai_dialogs
       WHERE did = ? AND user_id = ?
       LIMIT 1`,
      [did, user.id]
    );

    if (!rows[0]) {
      response.status(404).json({ message: "对话不存在" });
      return;
    }

    response.json({
      dialog: {
        ...toAiDialogSummary(rows[0]),
        messages: JSON.parse(rows[0].messages_json || "[]")
      }
    });
  } catch (error) {
    response.status(500).json({ message: "获取 AI 对话详情失败", detail: error.message });
  }
});

app.post("/api/ai/dialogs", async (request, response) => {
  try {
    await ensureAiDialogTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const messages = normalizeAiMessages(request.body.messages);

    if (!messages || !messages.length) {
      response.status(400).json({ message: "对话内容不能为空" });
      return;
    }

    const did = String(request.body.did || "").trim() || crypto.randomUUID();
    const title = buildAiDialogTitle(request.body.title, messages);
    const messagesJson = JSON.stringify(messages);

    const [existing] = await pool.execute(
      `SELECT did
       FROM ai_dialogs
       WHERE did = ? AND user_id = ?
       LIMIT 1`,
      [did, user.id]
    );

    if (existing[0]) {
      await pool.execute(
        `UPDATE ai_dialogs
         SET title = ?, messages_json = ?
         WHERE did = ? AND user_id = ?`,
        [title, messagesJson, did, user.id]
      );
    } else {
      await pool.execute(
        `INSERT INTO ai_dialogs (did, user_id, title, messages_json)
         VALUES (?, ?, ?, ?)`,
        [did, user.id, title, messagesJson]
      );
    }

    const [rows] = await pool.execute(
      `SELECT did, title, created_at, updated_at
       FROM ai_dialogs
       WHERE did = ? AND user_id = ?
       LIMIT 1`,
      [did, user.id]
    );

    response.status(existing[0] ? 200 : 201).json({
      dialog: toAiDialogSummary(rows[0])
    });
  } catch (error) {
    response.status(500).json({ message: "保存 AI 对话失败", detail: error.message });
  }
});

app.get("/api/fortune-config", async (_request, response) => {
  try {
    response.json({
      fortuneBonusEnabled: await getFortuneBonusEnabled()
    });
  } catch (error) {
    response.status(500).json({ message: "获取运势配置失败", detail: error.message });
  }
});

app.get("/api/fortune", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const fortuneBonusEnabled = await getFortuneBonusEnabled();
    const history = await ensureUserFortuneWindow(user, fortuneBonusEnabled);
    const todayKey = toDateKey(new Date());
    const today = history.find((item) => item.date === todayKey) || history[history.length - 1];

    response.json({
      fortuneBonusEnabled,
      today,
      history
    });
  } catch (error) {
    response.status(500).json({ message: "获取运势失败", detail: error.message });
  }
});

app.get("/api/checkin", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const fortuneBonusEnabled = await getFortuneBonusEnabled();
    const summary = await getCheckinSummary(user, fortuneBonusEnabled);

    response.json({
      fortuneBonusEnabled,
      ...summary,
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "获取签到信息失败", detail: error.message });
  }
});

app.post("/api/checkin", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const result = await performDailyCheckin(user);

    response.json({
      ...result,
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "签到失败", detail: error.message });
  }
});

app.get("/api/electromagnetic", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    await decayHeatIfNeeded(new Date());

    response.json({
      user: toUserProfile(await getUserById(user.id)),
      assets: await getUserAssets(user.id),
      shopItems: getShopItems()
    });
  } catch (error) {
    response.status(500).json({ message: "获取电磁场失败", detail: error.message });
  }
});

app.post("/api/electromagnetic/heat", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    await decayHeatIfNeeded(new Date());
    const currency = normalizeCurrencyType(request.body.currency);

    if (!["electric", "magnetic"].includes(currency)) {
      response.status(400).json({ message: "请选择消耗电元或磁元" });
      return;
    }

    const column = currencyColumn(currency);
    const [result] = await pool.execute(
      `UPDATE users
       SET ${column} = ${column} - 1,
           heat = heat + 1
       WHERE id = ? AND ${column} >= 1`,
      [user.id]
    );

    if (!result.affectedRows) {
      response.status(400).json({ message: "余额不足" });
      return;
    }

    response.json({
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "兑换热力失败", detail: error.message });
  }
});

async function purchaseShopItem(request, response, itemKey) {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const item = getShopItem(itemKey);
    const currency = normalizeCurrencyType(request.body.currency);

    if (!item) {
      response.status(404).json({ message: "商品不存在" });
      return;
    }

    const cost = Number(item.cost[currency] || 0);

    if (!cost) {
      response.status(400).json({ message: "请选择电元或磁元购买" });
      return;
    }

    const column = currencyColumn(currency);
    const [result] = await pool.execute(
      `UPDATE users
       SET ${column} = ${column} - ?
           , heat = heat + ?
       WHERE id = ? AND ${column} >= ?`,
      [cost, cost, user.id, cost]
    );

    if (!result.affectedRows) {
      response.status(400).json({ message: "余额不足" });
      return;
    }

    await pool.execute(
      `INSERT INTO user_assets (user_id, asset_key, quantity, metadata_json)
       VALUES (?, ?, 1, JSON_OBJECT('name', ?, 'description', ?, 'desc', ?, 'image', ?, 'class', ?))
       ON DUPLICATE KEY UPDATE
         quantity = quantity + 1,
         metadata_json = VALUES(metadata_json)`,
      [user.id, item.assetKey, item.name, item.description, item.desc, item.image, item.class]
    );

    response.json({
      user: toUserProfile(await getUserById(user.id)),
      assets: await getUserAssets(user.id)
    });
  } catch (error) {
    response.status(500).json({ message: "购买失败", detail: error.message });
  }
}

app.post("/api/electromagnetic/shop/:itemKey/purchase", async (request, response) => {
  await purchaseShopItem(request, response, String(request.params.itemKey || ""));
});

app.post("/api/electromagnetic/shop/differential-converter", async (request, response) => {
  await purchaseShopItem(request, response, "differential_converter");
});

app.post("/api/electromagnetic/convert", async (request, response) => {
  let connection;

  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const direction = String(request.body.direction || "").trim().toLowerCase();
    const fromColumn = direction === "electric_to_magnetic" ? "electrons" : (direction === "magnetic_to_electric" ? "manetrons" : "");
    const toColumn = direction === "electric_to_magnetic" ? "manetrons" : (direction === "magnetic_to_electric" ? "electrons" : "");

    if (!fromColumn || !toColumn) {
      response.status(400).json({ message: "无效转换方向" });
      return;
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [assetResult] = await connection.execute(
      `UPDATE user_assets
       SET quantity = quantity - 1
       WHERE user_id = ?
         AND asset_key = 'differential_converter'
         AND quantity >= 1`,
      [user.id]
    );

    if (!assetResult.affectedRows) {
      await connection.rollback();
      response.status(400).json({ message: "需要先拥有微分器" });
      return;
    }

    const [result] = await connection.execute(
      `UPDATE users
       SET ${fromColumn} = ${fromColumn} - 5,
           ${toColumn} = ${toColumn} + 5
       WHERE id = ? AND ${fromColumn} >= 5`,
      [user.id]
    );

    if (!result.affectedRows) {
      await connection.rollback();
      response.status(400).json({ message: "余额不足，至少需要 5 个" });
      return;
    }

    await connection.commit();

    response.json({
      user: toUserProfile(await getUserById(user.id)),
      assets: await getUserAssets(user.id)
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }
    response.status(500).json({ message: "转换失败", detail: error.message });
  } finally {
    connection?.release();
  }
});

app.get("/api/leaderboard/heat", async (request, response) => {
  try {
    await decayHeatIfNeeded(new Date());
    response.json({
      users: await getHeatLeaderboard(normalizeLimit(request.query.limit, 3, 10))
    });
  } catch (error) {
    response.status(500).json({ message: "获取热力榜失败", detail: error.message });
  }
});

app.get("/api/discussion/boards", async (_request, response) => {
  try {
    await ensureDiscussionTables();
    const currentUser = await getOptionalAuthUser(_request);

    const [rows] = await pool.execute(
      `SELECT b.id, b.slug, b.name, b.description, b.description_markdown, b.sort_order,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_moderate,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_manage_moderators
       FROM discussion_boards b
       LEFT JOIN discussion_board_moderators m ON m.board_id = b.id AND m.user_id = ?
       WHERE b.is_active = 1
       GROUP BY b.id, b.slug, b.name, b.description, b.description_markdown, b.sort_order
       ORDER BY b.sort_order ASC, b.id ASC`,
      [currentUser?.role || "", currentUser?.role || "", currentUser?.id || 0]
    );

    response.json({
      boards: rows.map(toDiscussionBoard)
    });
  } catch (error) {
    response.status(500).json({ message: "获取讨论版块失败", detail: error.message });
  }
});

app.patch("/api/discussion/boards/:slug/description", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAdmin(request, response);

    if (!user) {
      return;
    }

    const slug = String(request.params.slug || "").trim().toLowerCase();
    const descriptionMarkdown = String(request.body.descriptionMarkdown || "").trim();

    if (!descriptionMarkdown || descriptionMarkdown.length > 10000) {
      response.status(400).json({ message: "版块说明不能为空，且不能超过 10000 个字符" });
      return;
    }

    const board = await getDiscussionBoardBySlug(slug);

    if (!board) {
      response.status(404).json({ message: "讨论版块不存在" });
      return;
    }

    await pool.execute(
      `UPDATE discussion_boards
       SET description_markdown = ?
       WHERE id = ?`,
      [descriptionMarkdown, board.id]
    );

    response.json({
      board: {
        ...toDiscussionBoard({
          ...board,
          description_markdown: descriptionMarkdown,
          can_moderate: 1,
          can_manage_moderators: user.role === "admin" ? 1 : 0
        })
      }
    });
  } catch (error) {
    response.status(500).json({ message: "更新版块说明失败", detail: error.message });
  }
});

function toModeratorUser(row) {
  return {
    id: row.id,
    uid: row.uid || "",
    username: row.username,
    fullName: row.full_name || "",
    studentId: row.student_id || "",
    email: row.email || "",
    avatarPath: row.avatar_path || "",
    isModerator: Boolean(row.is_moderator)
  };
}

app.get("/api/discussion/boards/:slug/moderators", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const board = await getDiscussionBoardBySlug(String(request.params.slug || "").trim().toLowerCase());

    if (!board) {
      response.status(404).json({ message: "讨论版块不存在" });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.uid, u.username, u.full_name, u.student_id, u.email, u.avatar_path, 1 AS is_moderator
       FROM discussion_board_moderators m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.board_id = ?
       ORDER BY u.username ASC, u.id ASC`,
      [board.id]
    );

    response.json({
      moderators: rows.map(toModeratorUser)
    });
  } catch (error) {
    response.status(500).json({ message: "获取版主名单失败", detail: error.message });
  }
});

app.get("/api/discussion/boards/:slug/moderator-candidates", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const board = await getDiscussionBoardBySlug(String(request.params.slug || "").trim().toLowerCase());

    if (!board) {
      response.status(404).json({ message: "讨论版块不存在" });
      return;
    }

    const query = String(request.query.query || "").trim();

    if (!query || query.length < 2) {
      response.status(400).json({ message: "请输入至少 2 个字符用于搜索" });
      return;
    }

    const likeQuery = `%${query}%`;
    const [rows] = await pool.execute(
      `SELECT u.id, u.uid, u.username, u.full_name, u.student_id, u.email, u.avatar_path,
              CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS is_moderator
       FROM users u
       LEFT JOIN discussion_board_moderators m ON m.board_id = ? AND m.user_id = u.id
       WHERE u.uid = ?
          OR u.student_id = ?
          OR u.username = ?
          OR u.email = ?
          OR u.full_name = ?
          OR u.uid LIKE ?
          OR u.student_id LIKE ?
          OR u.username LIKE ?
          OR u.email LIKE ?
          OR u.full_name LIKE ?
       ORDER BY is_moderator DESC, u.username ASC, u.id ASC
       LIMIT 20`,
      [board.id, query, query, query, query, query, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery]
    );

    response.json({
      users: rows.map(toModeratorUser)
    });
  } catch (error) {
    response.status(500).json({ message: "搜索用户失败", detail: error.message });
  }
});

app.patch("/api/discussion/boards/:slug/moderators/:userId", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const board = await getDiscussionBoardBySlug(String(request.params.slug || "").trim().toLowerCase());
    const targetUserId = Number(request.params.userId);
    const isModerator = Boolean(request.body.isModerator);

    if (!board) {
      response.status(404).json({ message: "讨论版块不存在" });
      return;
    }

    if (!targetUserId) {
      response.status(400).json({ message: "无效用户 ID" });
      return;
    }

    const [users] = await pool.execute(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [targetUserId]
    );

    if (!users[0]) {
      response.status(404).json({ message: "用户不存在" });
      return;
    }

    if (isModerator) {
      await pool.execute(
        `INSERT INTO discussion_board_moderators (board_id, user_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [board.id, targetUserId]
      );
    } else {
      await pool.execute(
        `DELETE FROM discussion_board_moderators
         WHERE board_id = ? AND user_id = ?`,
        [board.id, targetUserId]
      );
    }

    response.json({
      ok: true,
      userId: targetUserId,
      isModerator
    });
  } catch (error) {
    response.status(500).json({ message: "更新版主名单失败", detail: error.message });
  }
});

app.post("/api/discussion/uploads/images", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const imageDataUrl = String(request.body.imageDataUrl || "");
    const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|heic|heif|bmp|tiff|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i);

    if (!match) {
      response.status(400).json({ message: "请上传图片文件" });
      return;
    }

    const fileBuffer = Buffer.from(match[2], "base64");

    if (!fileBuffer.length || fileBuffer.length > 20 * 1024 * 1024) {
      response.status(400).json({ message: "图片大小需在 20MB 以内" });
      return;
    }

    const outputBuffer = await sharp(fileBuffer, { animated: false })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer();

    if (!outputBuffer.length || outputBuffer.length > 4 * 1024 * 1024) {
      response.status(400).json({ message: "图片转换后仍超过 4MB，请换一张更小的图片" });
      return;
    }

    const fileName = buildDiscussionImageFileName(user.id);
    await fs.promises.writeFile(path.join(config.uploadDir, fileName), outputBuffer);

    response.status(201).json({
      url: `/uploads/${fileName}`
    });
  } catch (error) {
    response.status(500).json({ message: "上传图片失败", detail: error.message });
  }
});

app.get("/api/discussion/stats", async (_request, response) => {
  try {
    await ensureDiscussionTables();

    const [summaryRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM discussion_posts) AS post_count,
         (SELECT COUNT(*) FROM discussion_post_likes WHERE reaction_type = 'smile') AS like_count`
    );
    const [boardRows] = await pool.execute(
      `SELECT b.slug, b.name, b.description, b.description_markdown, COUNT(p.id) AS post_count
       FROM discussion_boards b
       LEFT JOIN discussion_posts p ON p.board_id = b.id
       WHERE b.is_active = 1
       GROUP BY b.id, b.slug, b.name, b.description, b.description_markdown, b.sort_order
       ORDER BY b.sort_order ASC, b.id ASC`
    );

    response.json({
      postCount: Number(summaryRows[0]?.post_count || 0),
      likeCount: Number(summaryRows[0]?.like_count || 0),
      boards: boardRows.map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description || "",
        descriptionMarkdown: row.description_markdown || row.description || "",
        postCount: Number(row.post_count || 0)
      }))
    });
  } catch (error) {
    response.status(500).json({ message: "获取讨论统计失败", detail: error.message });
  }
});

app.get("/api/discussion/posts", async (request, response) => {
  const boardSlug = String(request.query.board || "all").trim().toLowerCase();
  const limit = normalizeLimit(request.query.limit, 12, 50);

  try {
    await ensureDiscussionTables();
    const currentUser = await getOptionalAuthUser(request);

    if (boardSlug !== "all") {
      const board = await getDiscussionBoardBySlug(boardSlug);

      if (!board) {
        response.status(404).json({ message: "讨论版块不存在" });
        return;
      }
    }

    const where = boardSlug === "all" ? "WHERE b.is_active = 1" : "WHERE b.is_active = 1 AND b.slug = ?";
    const params = boardSlug === "all" ? [] : [boardSlug];
    const [rows] = await pool.execute(
      `SELECT p.id, p.pid, p.title, p.created_at, p.updated_at, p.user_id,
              p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.uid, u.username, u.full_name, u.avatar_path,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'smile' THEN l.user_id END) AS like_count,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'light' THEN l.user_id END) AS light_count,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'fireworks' THEN l.user_id END) AS fireworks_count,
              COUNT(DISTINCT c.id) AS comment_count,
              MAX(CASE WHEN my_smile.user_id IS NULL THEN 0 ELSE 1 END) AS liked_by_me,
              MAX(CASE WHEN my_light.user_id IS NULL THEN 0 ELSE 1 END) AS lighted_by_me,
              MAX(CASE WHEN my_fireworks.user_id IS NULL THEN 0 ELSE 1 END) AS fireworks_by_me,
              MAX(CASE WHEN ? = 'admin' OR bm.user_id IS NOT NULL THEN 1 ELSE 0 END) AS can_feature,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_pin,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_delete
       FROM discussion_posts p
       INNER JOIN discussion_boards b ON b.id = p.board_id
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN discussion_post_likes l ON l.post_id = p.id
       LEFT JOIN discussion_comments c ON c.post_id = p.id
       LEFT JOIN discussion_board_moderators bm ON bm.board_id = b.id AND bm.user_id = ?
       LEFT JOIN discussion_post_likes my_smile ON my_smile.post_id = p.id AND my_smile.reaction_type = 'smile' AND my_smile.user_id = ${currentUser ? "?" : "0"}
       LEFT JOIN discussion_post_likes my_light ON my_light.post_id = p.id AND my_light.reaction_type = 'light' AND my_light.user_id = ${currentUser ? "?" : "0"}
       LEFT JOIN discussion_post_likes my_fireworks ON my_fireworks.post_id = p.id AND my_fireworks.reaction_type = 'fireworks' AND my_fireworks.user_id = ${currentUser ? "?" : "0"}
       ${where}
       GROUP BY p.id, p.pid, p.title, p.created_at, p.updated_at, p.user_id, p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
                b.slug, b.name, p.author_student_id, u.student_id, u.uid, u.username, u.full_name, u.avatar_path
       ORDER BY ${boardSlug === "all" ? "p.is_pinned DESC, p.pinned_at DESC, p.created_at DESC, p.id DESC" : "p.is_pinned DESC, p.pinned_at DESC, p.is_featured DESC, p.featured_at DESC, p.created_at DESC, p.id DESC"}
       LIMIT ${limit}`,
      currentUser
        ? [currentUser.role, currentUser.role, currentUser.role, currentUser.id, currentUser.id, currentUser.id, currentUser.id, ...params]
        : ["", "", "", 0, ...params]
    );

    response.json({
      posts: rows.map(toDiscussionPostSummary)
    });
  } catch (error) {
    console.error("Failed to list discussion posts", error);
    response.status(500).json({ message: "获取帖子列表失败", detail: error.message });
  }
});

app.get("/api/discussion/posts/:id", async (request, response) => {
  try {
    await ensureDiscussionTables();
    const currentUser = await getOptionalAuthUser(request);
    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT p.id, p.pid, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
              p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.uid, u.username, u.full_name, u.avatar_path,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'smile' THEN l.user_id END) AS like_count,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'light' THEN l.user_id END) AS light_count,
              COUNT(DISTINCT CASE WHEN l.reaction_type = 'fireworks' THEN l.user_id END) AS fireworks_count,
              COUNT(DISTINCT c.id) AS comment_count,
              MAX(CASE WHEN my_smile.user_id IS NULL THEN 0 ELSE 1 END) AS liked_by_me,
              MAX(CASE WHEN my_light.user_id IS NULL THEN 0 ELSE 1 END) AS lighted_by_me,
              MAX(CASE WHEN my_fireworks.user_id IS NULL THEN 0 ELSE 1 END) AS fireworks_by_me,
              MAX(CASE WHEN ? = 'admin' OR bm.user_id IS NOT NULL THEN 1 ELSE 0 END) AS can_feature,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_pin,
              MAX(CASE WHEN ? = 'admin' THEN 1 ELSE 0 END) AS can_delete
       FROM discussion_posts p
       INNER JOIN discussion_boards b ON b.id = p.board_id
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN discussion_post_likes l ON l.post_id = p.id
       LEFT JOIN discussion_comments c ON c.post_id = p.id
       LEFT JOIN discussion_board_moderators bm ON bm.board_id = b.id AND bm.user_id = ?
       LEFT JOIN discussion_post_likes my_smile ON my_smile.post_id = p.id AND my_smile.reaction_type = 'smile' AND my_smile.user_id = ${currentUser ? "?" : "0"}
       LEFT JOIN discussion_post_likes my_light ON my_light.post_id = p.id AND my_light.reaction_type = 'light' AND my_light.user_id = ${currentUser ? "?" : "0"}
       LEFT JOIN discussion_post_likes my_fireworks ON my_fireworks.post_id = p.id AND my_fireworks.reaction_type = 'fireworks' AND my_fireworks.user_id = ${currentUser ? "?" : "0"}
       WHERE p.id = ?
         AND b.is_active = 1
       GROUP BY p.id, p.pid, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id, p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
                b.slug, b.name, p.author_student_id, u.student_id, u.uid, u.username, u.full_name, u.avatar_path
       LIMIT 1`,
      currentUser
        ? [currentUser.role, currentUser.role, currentUser.role, currentUser.id, currentUser.id, currentUser.id, currentUser.id, post.id]
        : ["", "", "", 0, post.id]
    );

    if (!rows[0]) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    response.json({
      post: toDiscussionPostDetail(rows[0])
    });
  } catch (error) {
    response.status(500).json({ message: "获取帖子详情失败", detail: error.message });
  }
});

app.post("/api/discussion/posts", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const boardSlug = String(request.body.boardSlug || "").trim().toLowerCase();
    const title = String(request.body.title || "").trim();
    const contentMarkdown = String(request.body.contentMarkdown || "").trim();

    if (!boardSlug) {
      response.status(400).json({ message: "请选择版块" });
      return;
    }

    if (!title || title.length > 120) {
      response.status(400).json({ message: "标题不能为空，且长度不能超过 120 个字符" });
      return;
    }

    if (!contentMarkdown || contentMarkdown.length > 20000) {
      response.status(400).json({ message: "正文不能为空，且长度不能超过 20000 个字符" });
      return;
    }

    const board = await getDiscussionBoardBySlug(boardSlug);

    if (!board) {
      response.status(404).json({ message: "讨论版块不存在" });
      return;
    }

    if (board.slug === "changelog" && user.role !== "admin") {
      response.status(403).json({ message: "更新日志版块仅管理员可以发帖" });
      return;
    }

    const canFeatureCreatedPost = await canModerateBoard(user, board.id);

    const postPid = await createUniqueDiscussionPostPid();
    const [result] = await pool.execute(
      `INSERT INTO discussion_posts (pid, board_id, user_id, author_student_id, title, content_markdown)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [postPid, board.id, user.id, user.student_id, title, contentMarkdown]
    );
    await pool.execute(
      `UPDATE users
       SET manetrons = manetrons + 1
       WHERE id = ?`,
      [user.id]
    );

    const [rows] = await pool.execute(
      `SELECT p.id, p.pid, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
              p.is_pinned, p.pinned_at, p.is_featured, p.featured_at,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.uid, u.username, u.full_name, u.avatar_path,
              0 AS like_count,
              0 AS light_count,
              0 AS fireworks_count,
              0 AS comment_count,
              0 AS liked_by_me,
              0 AS lighted_by_me,
              0 AS fireworks_by_me,
              ${canFeatureCreatedPost ? "1" : "0"} AS can_feature,
              ${user.role === "admin" ? "1" : "0"} AS can_pin,
              ${user.role === "admin" ? "1" : "0"} AS can_delete
       FROM discussion_posts p
       INNER JOIN discussion_boards b ON b.id = p.board_id
       INNER JOIN users u ON u.id = p.user_id
       WHERE p.id = ?
       LIMIT 1`,
      [result.insertId]
    );

    response.status(201).json({
      message: "帖子发布成功",
      post: toDiscussionPostDetail(rows[0])
    });
  } catch (error) {
    response.status(500).json({ message: "发布帖子失败", detail: error.message });
  }
});

app.patch("/api/discussion/posts/:id/pin", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAdmin(request, response);

    if (!user) {
      return;
    }

    const pinned = Boolean(request.body.pinned);
    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    await pool.execute(
      `UPDATE discussion_posts
       SET is_pinned = ?,
           pinned_at = ${pinned ? "NOW()" : "NULL"},
           pinned_by = ?
       WHERE id = ?`,
      [pinned ? 1 : 0, pinned ? user.id : null, post.id]
    );

    response.json({
      ok: true,
      isPinned: pinned
    });
  } catch (error) {
    response.status(500).json({ message: "更新置顶状态失败", detail: error.message });
  }
});

app.patch("/api/discussion/posts/:id/feature", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const featured = Boolean(request.body.featured);
    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    if (!(await requireDiscussionBoardModerator(user, post.board_id, response))) {
      return;
    }

    await pool.execute(
      `UPDATE discussion_posts
       SET is_featured = ?,
           featured_at = ${featured ? "NOW()" : "NULL"},
           featured_by = ?
       WHERE id = ?`,
      [featured ? 1 : 0, featured ? user.id : null, post.id]
    );

    response.json({
      ok: true,
      isFeatured: featured
    });
  } catch (error) {
    response.status(500).json({ message: "更新精华状态失败", detail: error.message });
  }
});

app.post("/api/discussion/posts/:id/like", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const reactionType = String(request.body.reactionType || "smile").trim().toLowerCase();

    if (!DISCUSSION_REACTION_TYPES.has(reactionType)) {
      response.status(400).json({ message: "无效反应类型" });
      return;
    }

    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [existing] = await pool.execute(
      `SELECT post_id
       FROM discussion_post_likes
       WHERE post_id = ? AND user_id = ? AND reaction_type = ?
       LIMIT 1`,
      [post.id, user.id, reactionType]
    );

    let active = true;

    if (existing[0]) {
      await pool.execute(
        `DELETE FROM discussion_post_likes
         WHERE post_id = ? AND user_id = ? AND reaction_type = ?`,
        [post.id, user.id, reactionType]
      );
      active = false;
    } else {
      await pool.execute(
        `INSERT INTO discussion_post_likes (post_id, user_id, reaction_type)
         VALUES (?, ?, ?)`,
        [post.id, user.id, reactionType]
      );
    }

    if (post.user_id !== user.id) {
      const reward = REACTION_MANETRON_REWARDS[reactionType] || 0;
      await awardPostAuthorManetrons(post, active ? reward : -reward);
    }

    const [countRows] = await pool.execute(
      `SELECT reaction_type, COUNT(*) AS reaction_count
       FROM discussion_post_likes
       WHERE post_id = ?
       GROUP BY reaction_type`,
      [post.id]
    );
    const counts = Object.fromEntries(countRows.map((row) => [row.reaction_type, Number(row.reaction_count || 0)]));

    response.json({
      reactionType,
      active,
      liked: reactionType === "smile" ? active : undefined,
      likeCount: counts.smile || 0,
      lightCount: counts.light || 0,
      fireworksCount: counts.fireworks || 0
    });
  } catch (error) {
    response.status(500).json({ message: "更新点赞失败", detail: error.message });
  }
});

app.get("/api/discussion/posts/:id/comments", async (request, response) => {
  try {
    await ensureDiscussionTables();
    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT c.id, c.post_id, c.parent_comment_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
              COALESCE(c.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.uid, u.username, u.full_name, u.avatar_path
       FROM discussion_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [post.id]
    );

    response.json({
      comments: rows.map(toDiscussionComment)
    });
  } catch (error) {
    response.status(500).json({ message: "获取评论失败", detail: error.message });
  }
});

app.post("/api/discussion/posts/:id/comments", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const parentCommentId = Number(request.body.parentCommentId || 0);
    const contentMarkdown = String(request.body.contentMarkdown || "").trim();

    if (!contentMarkdown || contentMarkdown.length > 5000) {
      response.status(400).json({ message: "评论不能为空，且长度不能超过 5000 个字符" });
      return;
    }

    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    if (parentCommentId) {
      const [parentRows] = await pool.execute(
        `SELECT id
         FROM discussion_comments
         WHERE id = ? AND post_id = ?
         LIMIT 1`,
        [parentCommentId, post.id]
      );

      if (!parentRows[0]) {
        response.status(404).json({ message: "被回复的评论不存在" });
        return;
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO discussion_comments (post_id, parent_comment_id, user_id, author_student_id, content_markdown)
       VALUES (?, ?, ?, ?, ?)`,
      [post.id, parentCommentId || null, user.id, user.student_id, contentMarkdown]
    );

    const [rows] = await pool.execute(
      `SELECT c.id, c.post_id, c.parent_comment_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
              COALESCE(c.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.uid, u.username, u.full_name, u.avatar_path
       FROM discussion_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [result.insertId]
    );

    const comment = toDiscussionComment(rows[0]);
    const maxPending = user.username !== MAX_AGENT_USER.username && shouldAskMax(contentMarkdown);

    if (maxPending) {
      setImmediate(() => {
        createMaxDiscussionReply(post.id, comment).catch((error) => {
          console.error("Failed to create Max discussion reply", error);
        });
      });
    }

    response.status(201).json({
      message: maxPending ? "评论已发布，Max 正在回复" : "评论已发布",
      comment,
      maxPending
    });
  } catch (error) {
    response.status(500).json({ message: "发布评论失败", detail: error.message });
  }
});

app.delete("/api/discussion/posts/:id", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAdmin(request, response);

    if (!user) {
      return;
    }

    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    await pool.execute(
      `DELETE FROM discussion_posts
       WHERE id = ?`,
      [post.id]
    );

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ message: "删除帖子失败", detail: error.message });
  }
});

app.delete("/api/admin/discussion/posts/:id", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const post = await getDiscussionPostByPublicId(request.params.id);

    if (!post) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [result] = await pool.execute(
      `DELETE FROM discussion_posts
       WHERE id = ?`,
      [post.id]
    );

    if (result.affectedRows === 0) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ message: "删除帖子失败", detail: error.message });
  }
});

app.post("/api/auth/register", async (request, response) => {
  const username = String(request.body.username || "").trim();
  const fullName = String(request.body.fullName || "").trim();
  const studentId = String(request.body.studentId || "").trim();
  const email = String(request.body.email || "").trim();
  const password = String(request.body.password || "");
  const emailCode = String(request.body.emailCode || "").trim();

  if (!username || username.length < 3 || username.length > 64) {
    response.status(400).json({ message: "用户名长度需在 3 到 64 个字符之间" });
    return;
  }

  if (!fullName || fullName.length > 64) {
    response.status(400).json({ message: "请输入姓名，且长度不超过 64 个字符" });
    return;
  }

  if (!/^20\d{8}$/.test(studentId)) {
    response.status(400).json({ message: "学号必须是 20 开头的 10 位数字" });
    return;
  }

  if (!password || password.length < 6) {
    response.status(400).json({ message: "密码长度至少为 6 位" });
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: "请输入有效邮箱地址" });
    return;
  }

  if (!/^\d{6}$/.test(emailCode)) {
    response.status(400).json({ message: "请输入 6 位邮箱验证码" });
    return;
  }

  try {
    const [codeRows] = await pool.execute(
      `SELECT id
       FROM email_verification_codes
       WHERE email = ?
         AND code_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [email, hashCode(email, emailCode)]
    );

    if (!codeRows[0]) {
      response.status(400).json({ message: "邮箱验证码错误或已过期" });
      return;
    }

    const grade = studentId.slice(0, 4);
    const major = "电子信息科学与技术";

    const [result] = await pool.execute(
      `INSERT INTO users (uid, username, full_name, student_id, email, password_hash, role, grade, major, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, 'student', ?, ?, NOW())`,
      [await createUniqueUserUid(), username, fullName, studentId, email, hashPassword(password), grade, major]
    );

    await pool.execute(
      `UPDATE email_verification_codes
       SET used_at = NOW()
       WHERE id = ?`,
      [codeRows[0].id]
    );

    const rows = [await getUserById(result.insertId)];

    const user = toUserProfile(rows[0]);

    response.status(201).json({
      token: issueToken(user),
      user
    });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      response.status(409).json({ message: "用户名或邮箱已存在" });
      return;
    }

    response.status(500).json({ message: "注册失败", detail: error.message });
  }
});

app.post("/api/auth/send-email-code", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: "请输入有效邮箱地址" });
    return;
  }

  try {
    const [existingUsers] = await pool.execute(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (existingUsers[0]) {
      response.status(409).json({ message: "该邮箱已被注册" });
      return;
    }

    const [recentCodes] = await pool.execute(
      `SELECT id
       FROM email_verification_codes
       WHERE email = ?
         AND created_at > (NOW() - INTERVAL 60 SECOND)
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );

    if (recentCodes[0]) {
      response.status(429).json({ message: "发送过于频繁，请稍后再试" });
      return;
    }

    const code = generateEmailCode();

    await pool.execute(`DELETE FROM email_verification_codes WHERE email = ?`, [email]);
    await pool.execute(
      `INSERT INTO email_verification_codes (email, code_hash, expires_at)
       VALUES (?, ?, ?)`,
      [email, hashCode(email, code), buildExpiryDate()]
    );

    await sendVerificationCode(email, code);

    response.json({
      message: `验证码已发送，${CODE_TTL_MINUTES} 分钟内有效`
    });
  } catch (error) {
    response.status(500).json({ message: "发送验证码失败", detail: error.message });
  }
});

app.post("/api/auth/send-reset-code", async (request, response) => {
  const studentId = String(request.body.studentId || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();

  if (!/^20\d{8}$/.test(studentId)) {
    response.status(400).json({ message: "学号必须是 20 开头的 10 位数字" });
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: "请输入有效邮箱地址" });
    return;
  }

  try {
    const [users] = await pool.execute(
      `SELECT id
       FROM users
       WHERE student_id = ? AND LOWER(email) = ?
       LIMIT 1`,
      [studentId, email]
    );

    if (!users[0]) {
      response.status(404).json({ message: "学号和邮箱不匹配" });
      return;
    }

    const [recentCodes] = await pool.execute(
      `SELECT id
       FROM email_verification_codes
       WHERE email = ?
         AND created_at > (NOW() - INTERVAL 60 SECOND)
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );

    if (recentCodes[0]) {
      response.status(429).json({ message: "发送过于频繁，请稍后再试" });
      return;
    }

    const code = generateEmailCode();

    await pool.execute(`DELETE FROM email_verification_codes WHERE email = ?`, [email]);
    await pool.execute(
      `INSERT INTO email_verification_codes (email, code_hash, expires_at)
       VALUES (?, ?, ?)`,
      [email, hashCode(email, code), buildExpiryDate()]
    );

    await sendVerificationCode(email, code);

    response.json({
      message: `验证码已发送，${CODE_TTL_MINUTES} 分钟内有效`
    });
  } catch (error) {
    response.status(500).json({ message: "发送验证码失败", detail: error.message });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const identifier = String(request.body.identifier || "").trim();
  const password = String(request.body.password || "");

  if (!identifier || !password) {
    response.status(400).json({ message: "请输入用户名/邮箱和密码" });
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, uid, username, full_name, student_id, email, email_verified_at, password_hash, role, electrons, manetrons, heat, grade, major, avatar_path, bio, website_url, created_at
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [identifier, identifier]
    );

    const row = rows[0];

    if (!row || !verifyPassword(password, row.password_hash)) {
      response.status(401).json({ message: "用户名/邮箱或密码错误" });
      return;
    }

    const user = toUserProfile(row);

    response.json({
      token: issueToken(user),
      user
    });
  } catch (error) {
    response.status(500).json({ message: "登录失败", detail: error.message });
  }
});

app.post("/api/auth/reset-password", async (request, response) => {
  const studentId = String(request.body.studentId || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const emailCode = String(request.body.emailCode || "").trim();
  const password = String(request.body.password || "");

  if (!/^20\d{8}$/.test(studentId)) {
    response.status(400).json({ message: "学号必须是 20 开头的 10 位数字" });
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: "请输入有效邮箱地址" });
    return;
  }

  if (!/^\d{6}$/.test(emailCode)) {
    response.status(400).json({ message: "请输入 6 位邮箱验证码" });
    return;
  }

  if (!password || password.length < 6) {
    response.status(400).json({ message: "新密码长度至少为 6 位" });
    return;
  }

  try {
    const [codeRows] = await pool.execute(
      `SELECT id
       FROM email_verification_codes
       WHERE email = ?
         AND code_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [email, hashCode(email, emailCode)]
    );

    if (!codeRows[0]) {
      response.status(400).json({ message: "邮箱验证码错误或已过期" });
      return;
    }

    const [users] = await pool.execute(
      `SELECT id, uid, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, heat, grade, major, avatar_path, bio, website_url, created_at
       FROM users
       WHERE student_id = ? AND LOWER(email) = ?
       LIMIT 1`,
      [studentId, email]
    );

    const row = users[0];

    if (!row) {
      response.status(404).json({ message: "学号和邮箱不匹配" });
      return;
    }

    await pool.execute(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?`,
      [hashPassword(password), row.id]
    );

    await pool.execute(
      `UPDATE email_verification_codes
       SET used_at = NOW()
       WHERE id = ?`,
      [codeRows[0].id]
    );

    const user = toUserProfile(await getUserById(row.id));

    response.json({
      message: "密码已重设",
      token: issueToken(user),
      user
    });
  } catch (error) {
    response.status(500).json({ message: "重设密码失败", detail: error.message });
  }
});

app.get("/api/auth/me", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    response.json({
      user: toUserProfile(user)
    });
  } catch (error) {
    response.status(500).json({ message: "获取用户信息失败", detail: error.message });
  }
});

app.get("/api/users/:uid/public-profile", async (request, response) => {
  const userKey = String(request.params.uid || "").trim();
  const isUid = /^u_?[a-z0-9]{6,32}$/i.test(userKey);
  const isLegacyStudentId = /^20\d{8}$/.test(userKey);

  if (!isUid && !isLegacyStudentId) {
    response.status(400).json({ message: "无效用户 UID" });
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, uid, username, full_name, student_id, role, grade, major, avatar_path, bio, website_url, created_at
       FROM users
       WHERE ${isUid ? "uid" : "student_id"} = ?
       LIMIT 1`,
      [userKey]
    );

    if (!rows[0]) {
      response.status(404).json({ message: "用户不存在" });
      return;
    }

    const user = rows[0];
    const studentId = user.student_id;
    const [statsRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM discussion_posts WHERE author_student_id = ?) AS post_count,
	         (SELECT COUNT(*) FROM discussion_post_likes l
	            INNER JOIN discussion_posts p ON p.id = l.post_id
	            WHERE p.author_student_id = ? AND l.reaction_type = 'smile') AS like_count`
      ,
      [studentId, studentId]
    );

    response.json({
      profile: {
        id: user.id,
        uid: user.uid || "",
        username: user.username,
        fullName: "",
        role: user.role,
        grade: user.grade || "",
        major: user.major || "",
        avatarPath: user.avatar_path || "",
        bio: user.bio || "",
        websiteUrl: user.website_url || "",
        createdAt: user.created_at,
        postCount: Number(statsRows[0]?.post_count || 0),
        likeCount: Number(statsRows[0]?.like_count || 0)
      }
    });
  } catch (error) {
    response.status(500).json({ message: "获取公开主页失败", detail: error.message });
  }
});

app.patch("/api/profile", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const fullName = String(request.body.fullName || "").trim();
    const bio = String(request.body.bio || "").trim();
    const websiteUrl = sanitizeWebsiteUrl(request.body.websiteUrl || "");

    if (!fullName || fullName.length > 64) {
      response.status(400).json({ message: "姓名不能为空，且长度不超过 64 个字符" });
      return;
    }

    if (bio.length > 1000) {
      response.status(400).json({ message: "个人简介不能超过 1000 个字符" });
      return;
    }

    if (websiteUrl === null) {
      response.status(400).json({ message: "个人网页链接必须为 http 或 https 地址" });
      return;
    }

    await pool.execute(
      `UPDATE users
       SET uid = COALESCE(NULLIF(uid, ''), ?),
           full_name = ?,
           bio = ?,
           website_url = ?
       WHERE id = ?`,
      [await createUniqueUserUid(), fullName, bio || null, websiteUrl || null, user.id]
    );

    response.json({
      message: "个人资料已更新",
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "更新个人资料失败", detail: error.message });
  }
});

app.patch("/api/profile/password", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const currentPassword = String(request.body.currentPassword || "");
    const newPassword = String(request.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      response.status(400).json({ message: "请输入当前密码和新密码" });
      return;
    }

    if (newPassword.length < 6) {
      response.status(400).json({ message: "新密码长度至少为 6 位" });
      return;
    }

    if (currentPassword === newPassword) {
      response.status(400).json({ message: "新密码不能与当前密码相同" });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT password_hash
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [user.id]
    );

    const row = rows[0];

    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      response.status(401).json({ message: "当前密码错误" });
      return;
    }

    await pool.execute(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?`,
      [hashPassword(newPassword), user.id]
    );

    response.json({ message: "密码已更新" });
  } catch (error) {
    response.status(500).json({ message: "修改密码失败", detail: error.message });
  }
});

app.post("/api/profile/avatar", async (request, response) => {
  try {
    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const imageDataUrl = String(request.body.imageDataUrl || "");
    const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);

    if (!match) {
      response.status(400).json({ message: "请上传 PNG、JPG、WEBP 或 GIF 图片" });
      return;
    }

    const mimeType = match[1];
    const fileName = buildAvatarFileName(user.id, mimeType);

    if (!fileName) {
      response.status(400).json({ message: "不支持的头像格式" });
      return;
    }

    const fileBuffer = Buffer.from(match[2], "base64");

    if (!fileBuffer.length || fileBuffer.length > 5 * 1024 * 1024) {
      response.status(400).json({ message: "头像大小需在 5MB 以内" });
      return;
    }

    const avatarPath = `/uploads/${fileName}`;
    await fs.promises.writeFile(path.join(config.uploadDir, fileName), fileBuffer);
    await pool.execute(
      `UPDATE users
       SET uid = COALESCE(NULLIF(uid, ''), ?),
           avatar_path = ?
       WHERE id = ?`,
      [await createUniqueUserUid(), avatarPath, user.id]
    );

    removeStoredAvatar(user.avatar_path);

    response.json({
      message: "头像上传成功",
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "头像上传失败", detail: error.message });
  }
});

app.get("/api/admin/users", async (request, response) => {
  try {
    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const [rows] = await pool.execute(
      `SELECT id, uid, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, heat, grade, major, avatar_path, bio, website_url, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    response.json({
      users: rows.map(toUserProfile)
    });
  } catch (error) {
    response.status(500).json({ message: "获取用户列表失败", detail: error.message });
  }
});

app.patch("/api/admin/fortune-config", async (request, response) => {
  try {
    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const fortuneBonusEnabled = Boolean(request.body.fortuneBonusEnabled);
    await setAppSetting(FORTUNE_BONUS_KEY, fortuneBonusEnabled ? "1" : "0");

    response.json({
      fortuneBonusEnabled
    });
  } catch (error) {
    response.status(500).json({ message: "更新运势配置失败", detail: error.message });
  }
});

app.post("/api/admin/users", async (request, response) => {
  try {
    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const username = String(request.body.username || "").trim();
    const fullName = String(request.body.fullName || "").trim();
    const studentId = String(request.body.studentId || "").trim();
    const email = String(request.body.email || "").trim();
    const password = String(request.body.password || "");
    const role = String(request.body.role || "student").trim();
    const electrons = Number(request.body.electrons ?? 0);
    const manetrons = Number(request.body.manetrons ?? 0);
    const heat = Number(request.body.heat ?? 0);

    if (!username || username.length < 3 || username.length > 64) {
      response.status(400).json({ message: "用户名长度需在 3 到 64 个字符之间" });
      return;
    }

    if (!fullName || fullName.length > 64) {
      response.status(400).json({ message: "请输入姓名，且长度不超过 64 个字符" });
      return;
    }

    if (!/^20\d{8}$/.test(studentId)) {
      response.status(400).json({ message: "学号必须是 20 开头的 10 位数字" });
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      response.status(400).json({ message: "请输入有效邮箱地址" });
      return;
    }

    if (!password || password.length < 6) {
      response.status(400).json({ message: "密码长度至少为 6 位" });
      return;
    }

    if (!["student", "admin"].includes(role)) {
      response.status(400).json({ message: "角色不合法" });
      return;
    }

    const grade = studentId.slice(0, 4);
    const major = "电子信息科学与技术";

    const [result] = await pool.execute(
      `INSERT INTO users (
        uid, username, full_name, student_id, email, password_hash, email_verified_at,
        role, electrons, manetrons, heat, grade, major
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
      [
        await createUniqueUserUid(),
        username,
        fullName,
        studentId,
        email,
        hashPassword(password),
        role,
        Number.isFinite(electrons) ? electrons : 0,
        Number.isFinite(manetrons) ? manetrons : 0,
        Number.isFinite(heat) ? heat : 0,
        grade,
        major
      ]
    );

    const user = await getUserById(result.insertId);

    response.status(201).json({
      user: toUserProfile(user)
    });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      response.status(409).json({ message: "用户名、学号或邮箱已存在" });
      return;
    }

    response.status(500).json({ message: "创建用户失败", detail: error.message });
  }
});

app.patch("/api/admin/users/:id", async (request, response) => {
  try {
    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const targetId = Number(request.params.id);
    const fullName = String(request.body.fullName || "").trim();
    const role = String(request.body.role || "").trim();
    const electrons = Number(request.body.electrons ?? 0);
    const manetrons = Number(request.body.manetrons ?? 0);
    const heat = Number(request.body.heat ?? 0);

    if (!targetId) {
      response.status(400).json({ message: "无效用户 ID" });
      return;
    }

    if (!fullName || fullName.length > 64) {
      response.status(400).json({ message: "请输入姓名，且长度不超过 64 个字符" });
      return;
    }

    if (!["student", "admin"].includes(role)) {
      response.status(400).json({ message: "角色不合法" });
      return;
    }

    await pool.execute(
      `UPDATE users
       SET uid = COALESCE(NULLIF(uid, ''), ?),
           full_name = ?,
           role = ?,
           electrons = ?,
           manetrons = ?,
           heat = ?
       WHERE id = ?`,
      [
        await createUniqueUserUid(),
        fullName,
        role,
        Number.isFinite(electrons) ? electrons : 0,
        Number.isFinite(manetrons) ? manetrons : 0,
        Number.isFinite(heat) ? heat : 0,
        targetId
      ]
    );

    const user = await getUserById(targetId);

    if (!user) {
      response.status(404).json({ message: "用户不存在" });
      return;
    }

    response.json({
      user: toUserProfile(user)
    });
  } catch (error) {
    response.status(500).json({ message: "更新用户失败", detail: error.message });
  }
});

app.delete("/api/admin/users/:id", async (request, response) => {
  try {
    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const targetId = Number(request.params.id);

    if (!targetId) {
      response.status(400).json({ message: "无效用户 ID" });
      return;
    }

    if (targetId === adminUser.id) {
      response.status(400).json({ message: "不能删除当前登录的管理员账户" });
      return;
    }

    const [result] = await pool.execute(`DELETE FROM users WHERE id = ?`, [targetId]);

    if (result.affectedRows === 0) {
      response.status(404).json({ message: "用户不存在" });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ message: "删除用户失败", detail: error.message });
  }
});

async function start() {
  await ensureUsersUidColumn();
  await ensureAppSettingsTable();
  await ensureDiscussionTables();
  await ensureAiDialogTables();
  await ensureFortuneTables();
  await ensureEconomyTables();
  await decayHeatIfNeeded(new Date());
  scheduleNextHeatDecay();

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(`FREE-BBS backend running at http://${config.apiHost}:${config.apiPort}`);
    console.log(`MySQL target: ${config.db.host}:${config.db.port}/${config.db.database}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
