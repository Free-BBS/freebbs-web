const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SystemSettingsError,
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  maskSecret,
  normalizeApiKey,
  normalizeBaseUrl,
  normalizeModel,
  safeTokenEquals,
  validateCourseMaterialsRoot,
} = require('./system-settings');

const TEST_KEY = Buffer.alloc(32, 7);

test('decodes exactly 32 bytes from Base64 or hexadecimal encryption keys', () => {
  assert.deepEqual(decodeEncryptionKey(TEST_KEY.toString('base64')), TEST_KEY);
  assert.deepEqual(decodeEncryptionKey(TEST_KEY.toString('hex')), TEST_KEY);
  assert.throws(
    () => decodeEncryptionKey(Buffer.alloc(16).toString('base64')),
    SystemSettingsError,
  );
});

test('encrypts API keys with authenticated encryption and setting-key AAD', () => {
  const apiKey = 'sk-private-test-value';
  const encrypted = encryptSecret(apiKey, TEST_KEY);

  assert.notEqual(encrypted.ciphertext.toString('utf8'), apiKey);
  assert.equal(decryptSecret(encrypted, TEST_KEY), apiKey);
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 9)), /无法解密/u);
  assert.throws(() => decryptSecret(encrypted, TEST_KEY, 'another_setting'), /无法解密/u);
});

test('normalizes model settings without exposing or accepting control characters', () => {
  assert.equal(maskSecret('sk-12345678'), '5678');
  assert.equal(normalizeApiKey('  sk-example  '), 'sk-example');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(normalizeModel('  gpt-example  '), 'gpt-example');
  assert.throws(() => normalizeApiKey('sk-one\ntwo'), /格式无效/u);
  assert.throws(() => normalizeBaseUrl(''), /不能为空/u);
  assert.throws(() => normalizeBaseUrl('ftp://api.example.com'), /HTTP/u);
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.com'), /内嵌凭据/u);
  assert.throws(() => normalizeModel(''), /不能为空/u);
  assert.throws(() => normalizeModel('model\u0000name'), /格式无效/u);
});

test('compares service tokens without leaking their length', () => {
  const token = 'a'.repeat(48);

  assert.equal(safeTokenEquals(token, token), true);
  assert.equal(safeTokenEquals(`${token}x`, token), false);
  assert.equal(safeTokenEquals('', ''), false);
});

test('accepts readable course directories only after resolving allowed-root boundaries', async (t) => {
  const temporaryRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'free-bbs-system-settings-'),
  );
  const allowedRoot = path.join(temporaryRoot, 'allowed');
  const courseRoot = path.join(allowedRoot, 'signals');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  const filePath = path.join(allowedRoot, 'not-a-directory');
  const escapingLink = path.join(allowedRoot, 'escaping-link');

  await fs.promises.mkdir(courseRoot, { recursive: true });
  await fs.promises.mkdir(outsideRoot);
  await fs.promises.writeFile(filePath, 'not a directory');
  await fs.promises.symlink(outsideRoot, escapingLink);

  t.after(async () => {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  });

  assert.equal(
    await validateCourseMaterialsRoot(courseRoot, allowedRoot),
    await fs.promises.realpath(courseRoot),
  );
  await assert.rejects(validateCourseMaterialsRoot('../relative', allowedRoot), /绝对路径/u);
  await assert.rejects(validateCourseMaterialsRoot(outsideRoot, allowedRoot), /超出允许范围/u);
  await assert.rejects(validateCourseMaterialsRoot(escapingLink, allowedRoot), /超出允许范围/u);
  await assert.rejects(validateCourseMaterialsRoot(filePath, allowedRoot), /必须指向目录/u);
});
