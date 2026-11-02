const { BlockList, isIP } = require('node:net');
const {
  SystemSettingsError,
  decryptSecret,
  encryptSecret,
  hasControlCharacters,
  maskSecret,
  normalizeApiKey,
} = require('./system-settings');

const SETTING_KEYS = Object.freeze({
  apiKey: 'moderation_api_key',
  baseUrl: 'moderation_base_url',
  textModel: 'moderation_text_model',
  imageModel: 'moderation_image_model',
  revision: 'moderation_settings_revision',
});
const DEFAULT_BASE_URL = 'https://cloud.infini-ai.com/maas/v1';
const DEFAULT_TEXT_MODEL = 'qwen3.6-27b';
const DEFAULT_IMAGE_MODEL = 'kimi-k2.6';

// Reuse at DNS resolution and connection time: validating a hostname alone
// cannot stop it resolving to a private address or changing its DNS answer.
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, 'ipv4');
}
const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, 'ipv6');
}

function isPublicAddress(value) {
  if (typeof value !== 'string') return false;
  const address = value.replace(/^\[|\]$/g, '');
  const version = isIP(address);
  if (version === 4) return !NON_PUBLIC_ADDRESSES.check(address, 'ipv4');
  // IPv4-mapped IPv6 and translation/transition ranges are not accepted as
  // public IPv6. Their embedded address must never bypass the IPv4 checks.
  return (
    version === 6 &&
    GLOBAL_IPV6.check(address, 'ipv6') &&
    !NON_PUBLIC_ADDRESSES.check(address, 'ipv6')
  );
}

function normalizeModerationBaseUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const fail = () => {
    throw new SystemSettingsError(
      '审核 API 地址须为公网 HTTPS Base URL，且不能包含凭据、查询参数或片段。',
      {
        code: 'MODERATION_BASE_URL_INVALID',
      },
    );
  };
  if (!input || input.length > 2048 || hasControlCharacters(input)) return fail();
  let url;
  try {
    url = new URL(input);
  } catch {
    return fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    input.includes('?') ||
    input.includes('#')
  )
    return fail();
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) return fail();
  } else if (
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/u.test(hostname) ||
    hostname === 'home.arpa' ||
    hostname.endsWith('.home.arpa')
  ) {
    return fail();
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizeModerationModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(model)) {
    throw new SystemSettingsError('审核模型名称无效，请填写平台提供的准确模型 ID。', {
      code: 'MODERATION_MODEL_INVALID',
    });
  }
  return model;
}

function toPublicModerationSettings(settings) {
  return {
    baseUrl: settings.baseUrl,
    textModel: settings.textModel,
    imageModel: settings.imageModel,
    configured: Boolean(settings.configured),
    lastFour: settings.lastFour || '',
    revision: settings.revision,
    updatedAt: settings.updatedAt || null,
  };
}

function newestTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  return timestamps.length ? new Date(Math.max(...timestamps.map(Number))) : null;
}

function createModerationSettingsStore({
  pool,
  encryptionKey,
  defaultBaseUrl = DEFAULT_BASE_URL,
  defaultTextModel = DEFAULT_TEXT_MODEL,
  defaultImageModel = DEFAULT_IMAGE_MODEL,
}) {
  const defaults = {
    baseUrl: normalizeModerationBaseUrl(defaultBaseUrl),
    textModel: normalizeModerationModel(defaultTextModel),
    imageModel: normalizeModerationModel(defaultImageModel),
  };

  async function readRows(connection) {
    const [rows] = await connection.execute(
      `SELECT setting_key, setting_value, updated_at
       FROM app_settings WHERE setting_key IN (?, ?, ?, ?)`,
      [
        SETTING_KEYS.baseUrl,
        SETTING_KEYS.textModel,
        SETTING_KEYS.imageModel,
        SETTING_KEYS.revision,
      ],
    );
    const [secrets] = await connection.execute(
      `SELECT ciphertext, iv, auth_tag, last_four, updated_by, updated_at
       FROM system_secret_settings WHERE setting_key = ? LIMIT 1`,
      [SETTING_KEYS.apiKey],
    );
    return { settings: new Map(rows.map((row) => [row.setting_key, row])), secret: secrets[0] };
  }

  async function readSettings({ includeSecret = false } = {}) {
    const connection = await pool.getConnection();
    let rows;
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      rows = await readRows(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    const value = (name) => rows.settings.get(SETTING_KEYS[name])?.setting_value;
    const settings = {
      baseUrl: normalizeModerationBaseUrl(value('baseUrl') ?? defaults.baseUrl),
      textModel: normalizeModerationModel(value('textModel') ?? defaults.textModel),
      imageModel: normalizeModerationModel(value('imageModel') ?? defaults.imageModel),
      configured: Boolean(rows.secret),
      lastFour: rows.secret?.last_four || '',
      revision: Number(value('revision') || 0),
      updatedAt: newestTimestamp([
        ...Array.from(rows.settings.values(), (row) => row.updated_at),
        rows.secret?.updated_at,
      ]),
    };
    if (!Number.isSafeInteger(settings.revision) || settings.revision < 0) {
      throw new SystemSettingsError('审核 API 配置版本无效。', {
        code: 'MODERATION_SETTINGS_REVISION_INVALID',
        status: 503,
      });
    }
    if (includeSecret) {
      settings.apiKey = rows.secret
        ? decryptSecret(rows.secret, encryptionKey, SETTING_KEYS.apiKey)
        : '';
    }
    return settings;
  }

  async function lockRevision(connection) {
    // Serializing mutations also makes the endpoint/key replacement check
    // atomic, so concurrent saves cannot carry a key to another provider.
    await connection.execute(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, '0')
       ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)`,
      [SETTING_KEYS.revision],
    );
    await connection.execute(
      `SELECT setting_value FROM app_settings WHERE setting_key = ? FOR UPDATE`,
      [SETTING_KEYS.revision],
    );
  }

  async function bumpRevision(connection) {
    await connection.execute(
      `UPDATE app_settings SET setting_value = CAST(setting_value AS UNSIGNED) + 1
       WHERE setting_key = ?`,
      [SETTING_KEYS.revision],
    );
  }

  async function updateSettings({ actorId, apiKey, baseUrl, textModel, imageModel } = {}) {
    if ([apiKey, baseUrl, textModel, imageModel].every((value) => value === undefined)) {
      throw new SystemSettingsError('没有可更新的审核 API 设置。', {
        code: 'MODERATION_SETTINGS_EMPTY',
      });
    }
    const normalized = {};
    if (baseUrl !== undefined) normalized.baseUrl = normalizeModerationBaseUrl(baseUrl);
    if (textModel !== undefined) normalized.textModel = normalizeModerationModel(textModel);
    if (imageModel !== undefined) normalized.imageModel = normalizeModerationModel(imageModel);
    let encrypted;
    let normalizedKey;
    if (apiKey !== undefined) {
      normalizedKey = normalizeApiKey(apiKey);
      if (/\s/u.test(normalizedKey)) {
        throw new SystemSettingsError('审核 API Key 不能包含空白字符。', {
          code: 'MODERATION_API_KEY_INVALID',
        });
      }
      encrypted = encryptSecret(normalizedKey, encryptionKey, SETTING_KEYS.apiKey);
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await lockRevision(connection);
      const previous = await readRows(connection);
      const previousUrl =
        previous.settings.get(SETTING_KEYS.baseUrl)?.setting_value ?? defaults.baseUrl;
      if (
        normalized.baseUrl !== undefined &&
        normalized.baseUrl !== normalizeModerationBaseUrl(previousUrl) &&
        previous.secret &&
        !encrypted
      ) {
        throw new SystemSettingsError('更换审核 API 地址时，请同时填写新平台的 API Key。', {
          code: 'MODERATION_NEW_ENDPOINT_REQUIRES_KEY',
        });
      }
      for (const [name, value] of Object.entries(normalized)) {
        await connection.execute(
          `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [SETTING_KEYS[name], value],
        );
      }
      if (encrypted) {
        await connection.execute(
          `INSERT INTO system_secret_settings
             (setting_key, ciphertext, iv, auth_tag, last_four, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE ciphertext = VALUES(ciphertext), iv = VALUES(iv),
             auth_tag = VALUES(auth_tag), last_four = VALUES(last_four), updated_by = VALUES(updated_by)`,
          [
            SETTING_KEYS.apiKey,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            maskSecret(normalizedKey),
            actorId ?? null,
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
      await lockRevision(connection);
      const [result] = await connection.execute(
        'DELETE FROM system_secret_settings WHERE setting_key = ?',
        [SETTING_KEYS.apiKey],
      );
      if (result.affectedRows) await bumpRevision(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    return readSettings();
  }

  return { readSettings, updateSettings, deleteApiKey };
}

module.exports = {
  SETTING_KEYS,
  DEFAULT_BASE_URL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_MODEL,
  createModerationSettingsStore,
  isPublicAddress,
  normalizeModerationBaseUrl,
  normalizeModerationModel,
  toPublicModerationSettings,
};
