const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_ALGORITHM = 'aes-256-gcm';
const SECRET_IV_BYTES = 12;
const SECRET_TAG_BYTES = 16;
const MAX_API_KEY_LENGTH = 8192;
const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_LENGTH = 255;

const SETTING_KEYS = Object.freeze({
  apiKey: 'llm_api_key',
  baseUrl: 'llm_base_url',
  courseMaterialsRoot: 'course_materials_root',
  model: 'llm_model',
  revision: 'system_settings_revision',
});

class SystemSettingsError extends Error {
  constructor(message, { code = 'SYSTEM_SETTINGS_ERROR', status = 400 } = {}) {
    super(message);
    this.name = 'SystemSettingsError';
    this.code = code;
    this.status = status;
  }
}

function decodeEncryptionKey(value) {
  const encoded = String(value || '').trim();

  if (!encoded) {
    throw new SystemSettingsError('系统设置加密密钥未配置', {
      code: 'SETTINGS_ENCRYPTION_KEY_MISSING',
      status: 503,
    });
  }

  let key;

  if (/^[a-f\d]{64}$/i.test(encoded)) {
    key = Buffer.from(encoded, 'hex');
  } else {
    const base64Value = encoded.startsWith('base64:') ? encoded.slice(7) : encoded;
    key = Buffer.from(base64Value, 'base64');
  }

  if (key.length !== 32) {
    throw new SystemSettingsError('系统设置加密密钥必须是 32 字节的 Base64 或十六进制值', {
      code: 'SETTINGS_ENCRYPTION_KEY_INVALID',
      status: 503,
    });
  }

  return key;
}

function encryptSecret(value, encryptionKey, settingKey = SETTING_KEYS.apiKey) {
  return finalizeEncryptedSecret(value, encryptionKey, settingKey);
}

function finalizeEncryptedSecret(value, encryptionKey, settingKey = SETTING_KEYS.apiKey) {
  const plaintext = String(value || '');
  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : decodeEncryptionKey(encryptionKey);
  const iv = crypto.randomBytes(SECRET_IV_BYTES);
  const cipher = crypto.createCipheriv(SECRET_ALGORITHM, key, iv);

  cipher.setAAD(Buffer.from(settingKey, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
  };
}

function decryptSecret(record, encryptionKey, settingKey = SETTING_KEYS.apiKey) {
  if (!record) {
    return '';
  }

  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : decodeEncryptionKey(encryptionKey);
  const iv = Buffer.from(record.iv || []);
  const authTag = Buffer.from(record.auth_tag || record.authTag || []);
  const ciphertext = Buffer.from(record.ciphertext || []);

  if (iv.length !== SECRET_IV_BYTES || authTag.length !== SECRET_TAG_BYTES) {
    throw new SystemSettingsError('系统密钥数据格式无效', {
      code: 'SYSTEM_SECRET_INVALID',
      status: 500,
    });
  }

  const decipher = crypto.createDecipheriv(SECRET_ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(settingKey, 'utf8'));
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SystemSettingsError('系统密钥无法解密', {
      code: 'SYSTEM_SECRET_DECRYPTION_FAILED',
      status: 500,
    });
  }
}

function maskSecret(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(-4) : '';
}

function hasControlCharacters(value) {
  return Array.from(String(value || '')).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function normalizeApiKey(value) {
  const apiKey = String(value || '').trim();

  if (!apiKey) {
    throw new SystemSettingsError('API key 不能为空；如需清除请使用删除操作', {
      code: 'API_KEY_REQUIRED',
    });
  }

  if (apiKey.length > MAX_API_KEY_LENGTH || hasControlCharacters(apiKey)) {
    throw new SystemSettingsError('API key 格式无效', {
      code: 'API_KEY_INVALID',
    });
  }

  return apiKey;
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || '').trim();

  if (!baseUrl) {
    throw new SystemSettingsError('API Base URL 不能为空', {
      code: 'MODEL_BASE_URL_REQUIRED',
    });
  }

  if (baseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new SystemSettingsError('API Base URL 过长', {
      code: 'MODEL_BASE_URL_INVALID',
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new SystemSettingsError('请输入有效的 API Base URL', {
      code: 'MODEL_BASE_URL_INVALID',
    });
  }

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new SystemSettingsError('API Base URL 仅支持无内嵌凭据的 HTTP 或 HTTPS 地址', {
      code: 'MODEL_BASE_URL_INVALID',
    });
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function normalizeModel(value) {
  const model = String(value || '').trim();

  if (!model) {
    throw new SystemSettingsError('模型名称不能为空', {
      code: 'MODEL_NAME_REQUIRED',
    });
  }

  if (model.length > MAX_MODEL_LENGTH || hasControlCharacters(model)) {
    throw new SystemSettingsError('模型名称格式无效', {
      code: 'MODEL_NAME_INVALID',
    });
  }

  return model;
}

function safeTokenEquals(providedToken, expectedToken) {
  const providedDigest = crypto
    .createHash('sha256')
    .update(String(providedToken || ''))
    .digest();
  const expectedDigest = crypto
    .createHash('sha256')
    .update(String(expectedToken || ''))
    .digest();

  return Boolean(expectedToken) && crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function validateCourseMaterialsRoot(value, allowedRoot) {
  const requestedRoot = String(value || '').trim();
  const configuredAllowedRoot = String(allowedRoot || '').trim();

  if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
    throw new SystemSettingsError('课程资料根目录必须是绝对路径', {
      code: 'COURSE_MATERIALS_ROOT_INVALID',
    });
  }

  if (!configuredAllowedRoot || !path.isAbsolute(configuredAllowedRoot)) {
    throw new SystemSettingsError('课程资料允许根目录未正确配置', {
      code: 'COURSE_MATERIALS_ALLOWED_ROOT_INVALID',
      status: 503,
    });
  }

  let realAllowedRoot;
  let realRequestedRoot;

  try {
    [realAllowedRoot, realRequestedRoot] = await Promise.all([
      fs.promises.realpath(configuredAllowedRoot),
      fs.promises.realpath(requestedRoot),
    ]);
  } catch {
    throw new SystemSettingsError('课程资料根目录不存在或无法访问', {
      code: 'COURSE_MATERIALS_ROOT_NOT_FOUND',
    });
  }

  if (!isPathInside(realAllowedRoot, realRequestedRoot)) {
    throw new SystemSettingsError('课程资料根目录超出允许范围', {
      code: 'COURSE_MATERIALS_ROOT_OUTSIDE_ALLOWED_ROOT',
    });
  }

  let stats;
  try {
    stats = await fs.promises.stat(realRequestedRoot);
  } catch {
    throw new SystemSettingsError('课程资料根目录不可读', {
      code: 'COURSE_MATERIALS_ROOT_NOT_READABLE',
    });
  }

  if (!stats.isDirectory()) {
    throw new SystemSettingsError('课程资料根目录必须指向目录', {
      code: 'COURSE_MATERIALS_ROOT_NOT_DIRECTORY',
    });
  }

  try {
    const readableDirectoryMode = fs.constants.R_OK + fs.constants.X_OK;
    await fs.promises.access(realRequestedRoot, readableDirectoryMode);
  } catch {
    throw new SystemSettingsError('课程资料根目录不可读', {
      code: 'COURSE_MATERIALS_ROOT_NOT_READABLE',
    });
  }

  return realRequestedRoot;
}

async function readAppSettings(executor) {
  const [rows] = await executor.execute(
    `SELECT setting_key, setting_value, updated_at
     FROM app_settings
     WHERE setting_key IN (?, ?, ?, ?)`,
    [
      SETTING_KEYS.baseUrl,
      SETTING_KEYS.courseMaterialsRoot,
      SETTING_KEYS.model,
      SETTING_KEYS.revision,
    ],
  );

  return new Map(rows.map((row) => [row.setting_key, row]));
}

async function readSecretSetting(executor) {
  const [rows] = await executor.execute(
    `SELECT ciphertext, iv, auth_tag, last_four, updated_by, updated_at
     FROM system_secret_settings
     WHERE setting_key = ?
     LIMIT 1`,
    [SETTING_KEYS.apiKey],
  );

  return rows[0] || null;
}

async function setAppSetting(executor, settingKey, value) {
  await executor.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [settingKey, String(value)],
  );
}

async function bumpRevision(executor) {
  await executor.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, '1')
     ON DUPLICATE KEY UPDATE
       setting_value = CAST(setting_value AS UNSIGNED) + 1`,
    [SETTING_KEYS.revision],
  );

  const [rows] = await executor.execute(
    `SELECT setting_value
     FROM app_settings
     WHERE setting_key = ?
     LIMIT 1`,
    [SETTING_KEYS.revision],
  );

  return Number(rows[0]?.setting_value || 0);
}

function newestTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return timestamps[0] || null;
}

function createSystemSettingsStore({
  pool,
  encryptionKey,
  defaultBaseUrl = '',
  defaultCourseMaterialsRoot = '',
  defaultModel = '',
  courseMaterialsAllowedRoot = '',
}) {
  async function readSettings({ includeSecret = false } = {}) {
    const connection = await pool.getConnection();
    let appSettings;
    let secretSetting;

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      appSettings = await readAppSettings(connection);
      secretSetting = await readSecretSetting(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    const baseUrlRow = appSettings.get(SETTING_KEYS.baseUrl);
    const courseRootRow = appSettings.get(SETTING_KEYS.courseMaterialsRoot);
    const modelRow = appSettings.get(SETTING_KEYS.model);
    const revisionRow = appSettings.get(SETTING_KEYS.revision);
    const settings = {
      baseUrl: baseUrlRow?.setting_value ?? defaultBaseUrl,
      model: modelRow?.setting_value ?? defaultModel,
      courseMaterialsRoot: courseRootRow?.setting_value ?? defaultCourseMaterialsRoot,
      configured: Boolean(secretSetting),
      lastFour: secretSetting?.last_four || '',
      revision: Number(revisionRow?.setting_value || 0),
      modelUpdatedAt: newestTimestamp([
        baseUrlRow?.updated_at,
        modelRow?.updated_at,
        secretSetting?.updated_at,
      ]),
      courseMaterialsUpdatedAt: newestTimestamp([courseRootRow?.updated_at]),
      updatedAt: newestTimestamp([
        baseUrlRow?.updated_at,
        courseRootRow?.updated_at,
        modelRow?.updated_at,
        secretSetting?.updated_at,
      ]),
    };

    if (includeSecret) {
      settings.apiKey = secretSetting
        ? decryptSecret(secretSetting, encryptionKey, SETTING_KEYS.apiKey)
        : '';
    }

    return settings;
  }

  async function updateModelSettings({ actorId, apiKey, baseUrl, model }) {
    const hasApiKey = apiKey !== undefined;
    const hasBaseUrl = baseUrl !== undefined;
    const hasModel = model !== undefined;

    if (!hasApiKey && !hasBaseUrl && !hasModel) {
      throw new SystemSettingsError('没有可更新的模型设置', {
        code: 'MODEL_SETTINGS_EMPTY',
      });
    }

    const normalizedApiKey = hasApiKey ? normalizeApiKey(apiKey) : '';
    const normalizedBaseUrl = hasBaseUrl ? normalizeBaseUrl(baseUrl) : '';
    const normalizedModel = hasModel ? normalizeModel(model) : '';
    const encryptedApiKey = hasApiKey
      ? finalizeEncryptedSecret(normalizedApiKey, encryptionKey, SETTING_KEYS.apiKey)
      : null;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (hasBaseUrl) {
        await setAppSetting(connection, SETTING_KEYS.baseUrl, normalizedBaseUrl);
      }

      if (hasModel) {
        await setAppSetting(connection, SETTING_KEYS.model, normalizedModel);
      }

      if (encryptedApiKey) {
        await connection.execute(
          `INSERT INTO system_secret_settings (
             setting_key, ciphertext, iv, auth_tag, last_four, updated_by
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             ciphertext = VALUES(ciphertext),
             iv = VALUES(iv),
             auth_tag = VALUES(auth_tag),
             last_four = VALUES(last_four),
             updated_by = VALUES(updated_by)`,
          [
            SETTING_KEYS.apiKey,
            encryptedApiKey.ciphertext,
            encryptedApiKey.iv,
            encryptedApiKey.authTag,
            maskSecret(normalizedApiKey),
            actorId,
          ],
        );
      }

      await bumpRevision(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    return readSettings();
  }

  async function deleteApiKey() {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `DELETE FROM system_secret_settings
         WHERE setting_key = ?`,
        [SETTING_KEYS.apiKey],
      );

      if (result.affectedRows) {
        await bumpRevision(connection);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    return readSettings();
  }

  async function updateCourseMaterialsRoot({ courseMaterialsRoot }) {
    const normalizedRoot = await validateCourseMaterialsRoot(
      courseMaterialsRoot,
      courseMaterialsAllowedRoot,
    );
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await setAppSetting(connection, SETTING_KEYS.courseMaterialsRoot, normalizedRoot);
      await bumpRevision(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    return readSettings();
  }

  return {
    deleteApiKey,
    readSettings,
    updateCourseMaterialsRoot,
    updateModelSettings,
  };
}

async function ensureSystemSecretSettingsTable(executor) {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS system_secret_settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      ciphertext MEDIUMBLOB NOT NULL,
      iv BINARY(12) NOT NULL,
      auth_tag BINARY(16) NOT NULL,
      last_four VARCHAR(8) NOT NULL DEFAULT '',
      updated_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_system_secret_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE SET NULL
    )`,
  );
}

module.exports = {
  SETTING_KEYS,
  SystemSettingsError,
  createSystemSettingsStore,
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  ensureSystemSecretSettingsTable,
  finalizeEncryptedSecret,
  hasControlCharacters,
  isPathInside,
  maskSecret,
  normalizeApiKey,
  normalizeBaseUrl,
  normalizeModel,
  safeTokenEquals,
  validateCourseMaterialsRoot,
};
