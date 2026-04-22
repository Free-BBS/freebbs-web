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

app.get("/api/fortune-config", async (_request, response) => {
  try {
    response.json({
      fortuneBonusEnabled: await getFortuneBonusEnabled()
    });
  } catch (error) {
    response.status(500).json({ message: "获取运势配置失败", detail: error.message });
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

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(`FREE-BBS backend running at http://${config.apiHost}:${config.apiPort}`);
    console.log(`MySQL target: ${config.db.host}:${config.db.port}/${config.db.database}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
