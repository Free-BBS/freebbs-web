const assert = require('node:assert/strict');
const test = require('node:test');
const { CredentialVault, CredentialVaultError, decodeVaultKey } = require('./credential-vault');

const HEX_KEY = '11'.repeat(32);
const OTHER_HEX_KEY = '22'.repeat(32);
const CONTEXT = Object.freeze({
  userId: 7,
  connectorId: 'tsinghua-learn',
  adapterVersion: 'disabled-v1',
});

function expectSafeError(operation, expectedCode, forbiddenValues = []) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof CredentialVaultError);
    assert.equal(error.code, expectedCode);
    forbiddenValues.forEach((value) => {
      assert.doesNotMatch(
        error.message,
        new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      assert.doesNotMatch(
        String(error),
        new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    });
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
}

test('accepts 32-byte hex, base64 and base64-prefixed keys', () => {
  const expected = Buffer.from(HEX_KEY, 'hex');
  const base64 = expected.toString('base64');

  assert.deepEqual(decodeVaultKey(HEX_KEY), expected);
  assert.deepEqual(decodeVaultKey(base64), expected);
  assert.deepEqual(decodeVaultKey(`base64:${base64}`), expected);
});

test('rejects missing and malformed keys with safe error codes', () => {
  expectSafeError(() => new CredentialVault(), 'CONNECTOR_VAULT_KEY_MISSING');
  expectSafeError(() => new CredentialVault('not-a-key'), 'CONNECTOR_VAULT_KEY_INVALID', [
    'not-a-key',
  ]);
  expectSafeError(
    () => new CredentialVault(Buffer.alloc(31).toString('base64')),
    'CONNECTOR_VAULT_KEY_INVALID',
  );
});

test('round-trips opaque authorization material without embedding plaintext in the record', () => {
  const vault = new CredentialVault(HEX_KEY);
  const plaintext = JSON.stringify({ session: 'highly-sensitive-session', expiresAt: 123 });
  const record = vault.encrypt(plaintext, CONTEXT);

  assert.deepEqual(Object.keys(record).sort(), ['authTag', 'ciphertext', 'iv']);
  assert.equal(record.iv.length, 12);
  assert.equal(record.authTag.length, 16);
  assert.doesNotMatch(record.ciphertext.toString('utf8'), /highly-sensitive-session/);
  assert.equal(vault.decrypt(record, CONTEXT), plaintext);
});

test('binds ciphertext to userId, connectorId and adapterVersion through AAD', () => {
  const vault = new CredentialVault(HEX_KEY);
  const plaintext = 'opaque-session-material';
  const record = vault.encrypt(plaintext, CONTEXT);

  for (const mismatchedContext of [
    { ...CONTEXT, userId: 8 },
    { ...CONTEXT, connectorId: 'tsinghua-info' },
    { ...CONTEXT, adapterVersion: 'official-v2' },
  ]) {
    expectSafeError(
      () => vault.decrypt(record, mismatchedContext),
      'CONNECTOR_VAULT_DECRYPTION_FAILED',
      [plaintext, CONTEXT.connectorId, CONTEXT.adapterVersion],
    );
  }
});

test('wrong keys and tampered ciphertext or tags fail without leaking secrets', () => {
  const plaintext = 'ticket-and-cookie-must-not-leak';
  const vault = new CredentialVault(HEX_KEY);
  const record = vault.encrypt(plaintext, CONTEXT);
  const wrongVault = new CredentialVault(OTHER_HEX_KEY);

  expectSafeError(() => wrongVault.decrypt(record, CONTEXT), 'CONNECTOR_VAULT_DECRYPTION_FAILED', [
    plaintext,
    record.ciphertext.toString('hex'),
  ]);

  const tamperedCiphertext = Buffer.from(record.ciphertext);
  tamperedCiphertext[0] = 255 - tamperedCiphertext[0];
  expectSafeError(
    () => vault.decrypt({ ...record, ciphertext: tamperedCiphertext }, CONTEXT),
    'CONNECTOR_VAULT_DECRYPTION_FAILED',
    [plaintext],
  );

  const tamperedTag = Buffer.from(record.authTag);
  tamperedTag[0] = 255 - tamperedTag[0];
  expectSafeError(
    () => vault.decrypt({ ...record, authTag: tamperedTag }, CONTEXT),
    'CONNECTOR_VAULT_DECRYPTION_FAILED',
    [plaintext],
  );
});

test('creates deterministic keyed fingerprints scoped by connector id', () => {
  const vault = new CredentialVault(HEX_KEY);
  const otherVault = new CredentialVault(OTHER_HEX_KEY);
  const value = 'opaque-tsinghua-subject';
  const first = vault.fingerprint(value, { connectorId: 'tsinghua-learn' });
  const repeated = vault.fingerprint(value, { connectorId: 'tsinghua-learn' });
  const otherConnector = vault.fingerprint(value, { connectorId: 'tsinghua-info' });
  const otherKey = otherVault.fingerprint(value, { connectorId: 'tsinghua-learn' });

  assert.ok(Buffer.isBuffer(first));
  assert.equal(first.length, 32);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, otherConnector);
  assert.notDeepEqual(first, otherKey);
});

test('rejects malformed records, plaintext and AAD without echoing their values', () => {
  const vault = new CredentialVault(HEX_KEY);

  expectSafeError(() => vault.encrypt('', CONTEXT), 'CONNECTOR_VAULT_PLAINTEXT_INVALID');
  expectSafeError(
    () => vault.encrypt('secret', { ...CONTEXT, connectorId: 'bad connector id' }),
    'CONNECTOR_VAULT_CONTEXT_INVALID',
    ['bad connector id', 'secret'],
  );
  expectSafeError(
    () => vault.decrypt({ version: 1, algorithm: 'aes-256-gcm' }, CONTEXT),
    'CONNECTOR_VAULT_RECORD_INVALID',
  );
});
