const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("./db");
const config = require("./config");
const { hashPassword, verifyPassword } = require("./password");
const { sign, verify } = require("./token");
const { sendVerificationCode } = require("./mailer");
const { CODE_TTL_MINUTES, buildExpiryDate, generateEmailCode, hashCode } = require("./verification");

const app = express();
const FORTUNE_BONUS_KEY = "fortune_bonus_enabled";
const DISCUSSION_BOARD_SEEDS = [
  {
    slug: "daily",
    name: "日常",
    description: "生活、课程与校园碎碎念",
    sortOrder: 10
  },
  {
    slug: "math",
    name: "数理",
    description: "数学、物理与推导讨论",
    sortOrder: 20
  },
  {
    slug: "circuit",
    name: "电路",
    description: "模电、数电与硬件实现",
    sortOrder: 30
  },
  {
    slug: "signal",
    name: "信号",
    description: "信号、系统与通信方向讨论",
    sortOrder: 40
  }
];

fs.mkdirSync(config.uploadDir, { recursive: true });

app.use(express.json({ limit: "8mb" }));
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

async function ensureDiscussionTables() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_boards (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      description VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_posts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      board_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      author_student_id VARCHAR(10) NULL,
      title VARCHAR(120) NOT NULL,
      content_markdown MEDIUMTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_discussion_posts_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_discussion_posts_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_posts_board_created_at (board_id, created_at DESC),
      INDEX idx_discussion_posts_created_at (created_at DESC)
    )`
  );

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

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_post_likes (
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      CONSTRAINT fk_discussion_post_likes_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_post_likes_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_post_likes_user (user_id)
    )`
  );

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS discussion_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      author_student_id VARCHAR(10) NULL,
      content_markdown TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_discussion_comments_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
      CONSTRAINT fk_discussion_comments_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
      INDEX idx_discussion_comments_post_created_at (post_id, created_at ASC),
      INDEX idx_discussion_comments_user (user_id)
    )`
  );

  for (const board of DISCUSSION_BOARD_SEEDS) {
    await pool.execute(
      `INSERT INTO discussion_boards (slug, name, description, sort_order, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         sort_order = VALUES(sort_order),
         is_active = VALUES(is_active)`,
      [board.slug, board.name, board.description, board.sortOrder]
    );
  }
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

function toUserProfile(row) {
  return {
    id: row.id,
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
    createdAt: row.created_at
  };
}

function toDiscussionBoard(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    sortOrder: Number(row.sort_order || 0)
  };
}

function toDiscussionPostSummary(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    board: {
      slug: row.board_slug,
      name: row.board_name
    },
    author: {
      id: row.user_id,
      username: row.username,
      fullName: row.full_name || "",
      displayName: row.full_name || row.username,
      studentId: row.author_student_id || row.student_id || "",
      avatarPath: row.avatar_path || ""
    },
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByMe: Boolean(row.liked_by_me)
  };
}

function toDiscussionComment(row) {
  return {
    id: row.id,
    contentMarkdown: row.content_markdown || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.user_id,
      username: row.username,
      fullName: row.full_name || "",
      displayName: row.full_name || row.username,
      studentId: row.author_student_id || row.student_id || "",
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

function normalizeLimit(value, defaultLimit = 12, maxLimit = 50) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.floor(parsed), maxLimit);
}

async function getDiscussionBoardBySlug(slug) {
  const [rows] = await pool.execute(
    `SELECT id, slug, name, description, sort_order
     FROM discussion_boards
     WHERE slug = ?
       AND is_active = 1
     LIMIT 1`,
    [slug]
  );

  return rows[0] || null;
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
    `SELECT id, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, grade, major, avatar_path, bio, website_url, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [id]
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
  const payload = request.body;

  if (!payload || typeof payload !== "object") {
    response.status(400).json({ message: "请求体必须是 JSON 对象" });
    return;
  }

  try {
    const agentResponse = await fetch(`${config.agentBaseUrl.replace(/\/$/, "")}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

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

app.get("/api/fortune-config", async (_request, response) => {
  try {
    response.json({
      fortuneBonusEnabled: await getFortuneBonusEnabled()
    });
  } catch (error) {
    response.status(500).json({ message: "获取运势配置失败", detail: error.message });
  }
});

app.get("/api/discussion/boards", async (_request, response) => {
  try {
    await ensureDiscussionTables();

    const [rows] = await pool.execute(
      `SELECT id, slug, name, description, sort_order
       FROM discussion_boards
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );

    response.json({
      boards: rows.map(toDiscussionBoard)
    });
  } catch (error) {
    response.status(500).json({ message: "获取讨论版块失败", detail: error.message });
  }
});

app.get("/api/discussion/stats", async (_request, response) => {
  try {
    await ensureDiscussionTables();

    const [summaryRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM discussion_posts) AS post_count,
         (SELECT COUNT(*) FROM discussion_post_likes) AS like_count`
    );
    const [boardRows] = await pool.execute(
      `SELECT b.slug, b.name, COUNT(p.id) AS post_count
       FROM discussion_boards b
       LEFT JOIN discussion_posts p ON p.board_id = b.id
       WHERE b.is_active = 1
       GROUP BY b.id, b.slug, b.name, b.sort_order
       ORDER BY b.sort_order ASC, b.id ASC`
    );

    response.json({
      postCount: Number(summaryRows[0]?.post_count || 0),
      likeCount: Number(summaryRows[0]?.like_count || 0),
      boards: boardRows.map((row) => ({
        slug: row.slug,
        name: row.name,
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
      `SELECT p.id, p.title, p.created_at, p.updated_at, p.user_id,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.username, u.full_name, u.avatar_path,
              COUNT(DISTINCT l.user_id) AS like_count,
              COUNT(DISTINCT c.id) AS comment_count,
              MAX(CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END) AS liked_by_me
       FROM discussion_posts p
       INNER JOIN discussion_boards b ON b.id = p.board_id
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN discussion_post_likes l ON l.post_id = p.id
       LEFT JOIN discussion_comments c ON c.post_id = p.id
       LEFT JOIN discussion_post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ${currentUser ? "?" : "0"}
       ${where}
       GROUP BY p.id, p.title, p.created_at, p.updated_at, p.user_id,
                b.slug, b.name, p.author_student_id, u.student_id, u.username, u.full_name, u.avatar_path
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${limit}`,
      currentUser ? [currentUser.id, ...params] : params
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
  const postId = Number(request.params.id);

  if (!postId) {
    response.status(400).json({ message: "无效帖子 ID" });
    return;
  }

  try {
    await ensureDiscussionTables();
    const currentUser = await getOptionalAuthUser(request);

    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.username, u.full_name, u.avatar_path,
              COUNT(DISTINCT l.user_id) AS like_count,
              COUNT(DISTINCT c.id) AS comment_count,
              MAX(CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END) AS liked_by_me
       FROM discussion_posts p
       INNER JOIN discussion_boards b ON b.id = p.board_id
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN discussion_post_likes l ON l.post_id = p.id
       LEFT JOIN discussion_comments c ON c.post_id = p.id
       LEFT JOIN discussion_post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ${currentUser ? "?" : "0"}
       WHERE p.id = ?
         AND b.is_active = 1
       GROUP BY p.id, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
                b.slug, b.name, p.author_student_id, u.student_id, u.username, u.full_name, u.avatar_path
       LIMIT 1`,
      currentUser ? [currentUser.id, postId] : [postId]
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

    const [result] = await pool.execute(
      `INSERT INTO discussion_posts (board_id, user_id, author_student_id, title, content_markdown)
       VALUES (?, ?, ?, ?, ?)`,
      [board.id, user.id, user.student_id, title, contentMarkdown]
    );

    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.content_markdown, p.created_at, p.updated_at, p.user_id,
              b.slug AS board_slug, b.name AS board_name,
              COALESCE(p.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.username, u.full_name, u.avatar_path,
              0 AS like_count,
              0 AS comment_count,
              0 AS liked_by_me
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

app.post("/api/discussion/posts/:id/like", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const user = await requireAuth(request, response);

    if (!user) {
      return;
    }

    const postId = Number(request.params.id);

    if (!postId) {
      response.status(400).json({ message: "无效帖子 ID" });
      return;
    }

    const [posts] = await pool.execute(
      `SELECT id FROM discussion_posts WHERE id = ? LIMIT 1`,
      [postId]
    );

    if (!posts[0]) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [existing] = await pool.execute(
      `SELECT post_id
       FROM discussion_post_likes
       WHERE post_id = ? AND user_id = ?
       LIMIT 1`,
      [postId, user.id]
    );

    let liked = true;

    if (existing[0]) {
      await pool.execute(
        `DELETE FROM discussion_post_likes
         WHERE post_id = ? AND user_id = ?`,
        [postId, user.id]
      );
      liked = false;
    } else {
      await pool.execute(
        `INSERT INTO discussion_post_likes (post_id, user_id)
         VALUES (?, ?)`,
        [postId, user.id]
      );
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS like_count
       FROM discussion_post_likes
       WHERE post_id = ?`,
      [postId]
    );

    response.json({
      liked,
      likeCount: Number(countRows[0]?.like_count || 0)
    });
  } catch (error) {
    response.status(500).json({ message: "更新点赞失败", detail: error.message });
  }
});

app.get("/api/discussion/posts/:id/comments", async (request, response) => {
  const postId = Number(request.params.id);

  if (!postId) {
    response.status(400).json({ message: "无效帖子 ID" });
    return;
  }

  try {
    await ensureDiscussionTables();

    const [rows] = await pool.execute(
      `SELECT c.id, c.post_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
              COALESCE(c.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.username, u.full_name, u.avatar_path
       FROM discussion_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [postId]
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

    const postId = Number(request.params.id);
    const contentMarkdown = String(request.body.contentMarkdown || "").trim();

    if (!postId) {
      response.status(400).json({ message: "无效帖子 ID" });
      return;
    }

    if (!contentMarkdown || contentMarkdown.length > 5000) {
      response.status(400).json({ message: "评论不能为空，且长度不能超过 5000 个字符" });
      return;
    }

    const [posts] = await pool.execute(
      `SELECT id FROM discussion_posts WHERE id = ? LIMIT 1`,
      [postId]
    );

    if (!posts[0]) {
      response.status(404).json({ message: "帖子不存在" });
      return;
    }

    const [result] = await pool.execute(
      `INSERT INTO discussion_comments (post_id, user_id, author_student_id, content_markdown)
       VALUES (?, ?, ?, ?)`,
      [postId, user.id, user.student_id, contentMarkdown]
    );

    const [rows] = await pool.execute(
      `SELECT c.id, c.post_id, c.user_id, c.content_markdown, c.created_at, c.updated_at,
              COALESCE(c.author_student_id, u.student_id) AS author_student_id,
              u.student_id, u.username, u.full_name, u.avatar_path
       FROM discussion_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [result.insertId]
    );

    response.status(201).json({
      message: "评论已发布",
      comment: toDiscussionComment(rows[0])
    });
  } catch (error) {
    response.status(500).json({ message: "发布评论失败", detail: error.message });
  }
});

app.delete("/api/admin/discussion/posts/:id", async (request, response) => {
  try {
    await ensureDiscussionTables();

    const adminUser = await requireAdmin(request, response);

    if (!adminUser) {
      return;
    }

    const postId = Number(request.params.id);

    if (!postId) {
      response.status(400).json({ message: "无效帖子 ID" });
      return;
    }

    const [result] = await pool.execute(
      `DELETE FROM discussion_posts
       WHERE id = ?`,
      [postId]
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
      `INSERT INTO users (username, full_name, student_id, email, password_hash, role, grade, major, email_verified_at)
       VALUES (?, ?, ?, ?, ?, 'student', ?, ?, NOW())`,
      [username, fullName, studentId, email, hashPassword(password), grade, major]
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

app.post("/api/auth/login", async (request, response) => {
  const identifier = String(request.body.identifier || "").trim();
  const password = String(request.body.password || "");

  if (!identifier || !password) {
    response.status(400).json({ message: "请输入用户名/邮箱和密码" });
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, username, full_name, student_id, email, email_verified_at, password_hash, role, electrons, manetrons, grade, major, avatar_path, bio, website_url, created_at
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

app.get("/api/users/:studentId/public-profile", async (request, response) => {
  const studentId = String(request.params.studentId || "").trim();

  if (!/^20\d{8}$/.test(studentId)) {
    response.status(400).json({ message: "无效学号" });
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, username, full_name, student_id, role, grade, major, avatar_path, bio, website_url, created_at
       FROM users
       WHERE student_id = ?
       LIMIT 1`,
      [studentId]
    );

    if (!rows[0]) {
      response.status(404).json({ message: "用户不存在" });
      return;
    }

    const user = rows[0];
    const [statsRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM discussion_posts WHERE author_student_id = ?) AS post_count,
         (SELECT COUNT(*) FROM discussion_post_likes l
            INNER JOIN discussion_posts p ON p.id = l.post_id
            WHERE p.author_student_id = ?) AS like_count`
      ,
      [studentId, studentId]
    );

    response.json({
      profile: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        studentId: user.student_id,
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
       SET full_name = ?, bio = ?, website_url = ?
       WHERE id = ?`,
      [fullName, bio || null, websiteUrl || null, user.id]
    );

    response.json({
      message: "个人资料已更新",
      user: toUserProfile(await getUserById(user.id))
    });
  } catch (error) {
    response.status(500).json({ message: "更新个人资料失败", detail: error.message });
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
       SET avatar_path = ?
       WHERE id = ?`,
      [avatarPath, user.id]
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
      `SELECT id, username, full_name, student_id, email, email_verified_at, role, electrons, manetrons, grade, major, avatar_path, bio, website_url, created_at
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
        username, full_name, student_id, email, password_hash, email_verified_at,
        role, electrons, manetrons, grade, major
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        username,
        fullName,
        studentId,
        email,
        hashPassword(password),
        role,
        Number.isFinite(electrons) ? electrons : 0,
        Number.isFinite(manetrons) ? manetrons : 0,
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
       SET full_name = ?, role = ?, electrons = ?, manetrons = ?
       WHERE id = ?`,
      [
        fullName,
        role,
        Number.isFinite(electrons) ? electrons : 0,
        Number.isFinite(manetrons) ? manetrons : 0,
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
  await ensureAppSettingsTable();
  await ensureDiscussionTables();

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(`FREE-BBS backend running at http://${config.apiHost}:${config.apiPort}`);
    console.log(`MySQL target: ${config.db.host}:${config.db.port}/${config.db.database}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
