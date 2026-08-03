/* eslint-disable max-classes-per-file */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_SECRET_BYTES = 64 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ENCRYPTION_KEY_DOMAIN = 'freebbs.tsinghua.connector.vault.encryption.v1';
const FINGERPRINT_KEY_DOMAIN = 'freebbs.tsinghua.connector.vault.fingerprint.v1';
const FINGERPRINT_PAYLOAD_DOMAIN = 'freebbs.tsinghua.connector.identity.v1';

class CredentialVaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialVaultError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CredentialVaultError(code, message);
}

function decodeVaultKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('CONNECTOR_VAULT_KEY_MISSING', '连接器授权材料加密密钥未配置');
  }

  const encoded = value.trim();
  if (/^[a-f\d]{64}$/i.test(encoded)) {
    return Buffer.from(encoded, 'hex');
  }

  const base64Value = encoded.startsWith('base64:') ? encoded.slice(7) : encoded;
  if (!base64Value || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Value)) {
    fail('CONNECTOR_VAULT_KEY_INVALID', '连接器授权材料加密密钥格式无效');
  }

  const key = Buffer.from(base64Value, 'base64');
  const suppliedCanonical = base64Value.replace(/=+$/, '');
  const decodedCanonical = key.toString('base64').replace(/=+$/, '');
  if (key.length !== KEY_BYTES || suppliedCanonical !== decodedCanonical) {
    fail('CONNECTOR_VAULT_KEY_INVALID', '连接器授权材料加密密钥必须为 32 字节');
  }

  return key;
}

function normalizeUserId(value) {
  if (Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)) {
    return value;
  }
  fail('CONNECTOR_VAULT_CONTEXT_INVALID', '连接器授权材料上下文无效');
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('CONNECTOR_VAULT_CONTEXT_INVALID', '连接器授权材料上下文无效');
  }
  return value;
}

function buildCredentialAad({ userId, connectorId, adapterVersion } = {}) {
  return Buffer.from(
    JSON.stringify({
      userId: normalizeUserId(userId),
      connectorId: normalizeIdentifier(connectorId),
      adapterVersion: normalizeIdentifier(adapterVersion),
    }),
    'utf8',
  );
}

function normalizeSecret(value, errorCode) {
  let secret;
  if (typeof value === 'string') {
    secret = Buffer.from(value, 'utf8');
  } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    secret = Buffer.from(value);
  } else {
    fail(errorCode, '连接器授权材料格式无效');
  }

  if (!secret.length || secret.length > MAX_SECRET_BYTES) {
    fail(errorCode, '连接器授权材料格式无效');
  }
  return secret;
}

function toBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return null;
  }
  return Buffer.from(value);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    fail('CONNECTOR_VAULT_RECORD_INVALID', '连接器授权材料密文格式无效');
  }

  const ciphertext = toBuffer(record.ciphertext);
  const iv = toBuffer(record.iv);
  const authTag = toBuffer(record.authTag || record.auth_tag);
  if (
    !ciphertext ||
    !iv ||
    !authTag ||
    !ciphertext.length ||
    ciphertext.length > MAX_SECRET_BYTES ||
    iv.length !== IV_BYTES ||
    authTag.length !== AUTH_TAG_BYTES
  ) {
    fail('CONNECTOR_VAULT_RECORD_INVALID', '连接器授权材料密文格式无效');
  }
  return { authTag, ciphertext, iv };
}

function deriveKey(masterKey, domain) {
  return crypto.createHmac('sha256', masterKey).update(domain, 'utf8').digest();
}

class CredentialVault {
  constructor(encryptionKey, { randomBytes = crypto.randomBytes } = {}) {
    const masterKey = decodeVaultKey(encryptionKey);
    if (typeof randomBytes !== 'function') {
      throw new TypeError('randomBytes must be a function');
    }

    this.encryptionKey = crypto.createSecretKey(deriveKey(masterKey, ENCRYPTION_KEY_DOMAIN));
    this.fingerprintKey = crypto.createSecretKey(deriveKey(masterKey, FINGERPRINT_KEY_DOMAIN));
    this.randomBytes = randomBytes;
    masterKey.fill(0);
  }

  encrypt(value, context) {
    const plaintext = normalizeSecret(value, 'CONNECTOR_VAULT_PLAINTEXT_INVALID');
    const aad = buildCredentialAad(context);
    const iv = toBuffer(this.randomBytes(IV_BYTES));
    if (!iv || iv.length !== IV_BYTES) {
      fail('CONNECTOR_VAULT_RANDOM_SOURCE_INVALID', '连接器授权材料随机源无效');
    }

    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    cipher.setAAD(aad);
    return {
      ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
      iv,
      authTag: cipher.getAuthTag(),
    };
  }

  decrypt(record, context) {
    const { authTag, ciphertext, iv } = normalizeRecord(record);
    const aad = buildCredentialAad(context);

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      fail('CONNECTOR_VAULT_DECRYPTION_FAILED', '连接器授权材料无法解密');
    }
  }

  fingerprint(value, { connectorId } = {}) {
    const normalizedConnectorId = normalizeIdentifier(connectorId);
    const input = normalizeSecret(value, 'CONNECTOR_VAULT_FINGERPRINT_INPUT_INVALID');
    const connectorBytes = Buffer.from(normalizedConnectorId, 'utf8');
    const connectorLength = Buffer.allocUnsafe(4);
    connectorLength.writeUInt32BE(connectorBytes.length);
    const valueLength = Buffer.allocUnsafe(4);
    valueLength.writeUInt32BE(input.length);

    return crypto
      .createHmac('sha256', this.fingerprintKey)
      .update(FINGERPRINT_PAYLOAD_DOMAIN, 'utf8')
      .update(connectorLength)
      .update(connectorBytes)
      .update(valueLength)
      .update(input)
      .digest();
  }
}

module.exports = {
  CredentialVault,
  CredentialVaultError,
  decodeVaultKey,
};
