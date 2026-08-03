const assert = require('node:assert/strict');
const test = require('node:test');
const { AUTHORIZATION_ERRORS, createTsinghuaSyncDispatcher } = require('./sync-dispatcher');

function claimedRun(overrides = {}) {
  return {
    public_id: 'csr_run',
    connector_id: 41,
    connector_generation: 3,
    user_id: 7,
    provider: 'tsinghua-learn',
    adapter_id: 'tsinghua_direct_cas',
    adapter_version: 'direct-cas-v1',
    credential_ciphertext: Buffer.from('ciphertext'),
    credential_iv: Buffer.alloc(12, 1),
    credential_auth_tag: Buffer.alloc(16, 2),
    ...overrides,
  };
}

function createHarness({
  claimed = claimedRun(),
  decrypt = () => '{"version":1}',
  createAuthorizedFetch = () => async () => undefined,
  runSync = async () => ({ status: 'succeeded' }),
  adapterOverrides = {},
} = {}) {
  const calls = { claims: [], completes: [], decrypts: [], failures: [], runSync: [] };
  const nowValue = new Date('2026-08-02T08:00:00.000Z');
  const syncStore = {
    async claimRun(publicId, startedAt) {
      calls.claims.push({ publicId, startedAt });
      return claimed;
    },
    async completeRun(run, snapshot, finishedAt) {
      calls.completes.push({ run, snapshot, finishedAt });
      return true;
    },
    async failRun(run, code, failedAt, options) {
      calls.failures.push({ run, code, failedAt, options });
      return true;
    },
  };
  const vault = {
    decrypt(encrypted, aad) {
      calls.decrypts.push({ encrypted, aad });
      return decrypt(encrypted, aad);
    },
  };
  const adapter = {
    id: 'tsinghua_direct_cas',
    version: 'direct-cas-v1',
    createAuthorizedFetch,
    ...adapterOverrides,
  };
  const dispatcher = createTsinghuaSyncDispatcher({
    adapter,
    vault,
    syncStore,
    now: () => nowValue,
    runSync: async (input) => {
      calls.runSync.push(input);
      return runSync(input);
    },
  });
  return { calls, dispatcher, nowValue };
}

test('a queued run decrypts with bound AAD and completes with the parsed snapshot', async () => {
  const authorizedFetch = async () => undefined;
  const snapshot = { status: 'succeeded', notifications: [{ title: '通知' }] };
  const harness = createHarness({
    createAuthorizedFetch(grant) {
      assert.equal(grant, '{"version":1}');
      return authorizedFetch;
    },
    runSync: async ({ authorizedFetch: received }) => {
      assert.equal(received, authorizedFetch);
      return snapshot;
    },
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.deepEqual(harness.calls.claims, [{ publicId: 'csr_run', startedAt: harness.nowValue }]);
  assert.deepEqual(harness.calls.decrypts[0].aad, {
    userId: 7,
    connectorId: 'tsinghua-learn',
    adapterVersion: 'direct-cas-v1',
  });
  assert.equal(harness.calls.completes.length, 1);
  assert.equal(harness.calls.completes[0].snapshot, snapshot);
  assert.deepEqual(harness.calls.failures, []);
});

test('matches the adapter version using the same 32 character bound as the broker', async () => {
  const longVersion = 'direct-cas-version-abcdefghijklmnopqrstuvwxyz';
  const storedVersion = longVersion.slice(0, 32);
  const harness = createHarness({
    claimed: claimedRun({ adapter_version: storedVersion }),
    adapterOverrides: { version: longVersion },
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.decrypts.length, 1);
  assert.equal(harness.calls.decrypts[0].aad.adapterVersion, storedVersion);
  assert.equal(harness.calls.completes.length, 1);
  assert.deepEqual(harness.calls.failures, []);
});

test('adapter changes are authorization failures and credentials are never decrypted', async () => {
  const harness = createHarness({
    claimed: claimedRun({ adapter_version: 'old-version' }),
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.decrypts.length, 0);
  assert.equal(harness.calls.completes.length, 0);
  assert.deepEqual(harness.calls.failures[0].options, {
    requiresAuthorization: true,
  });
  assert.equal(harness.calls.failures[0].code, 'connector_adapter_changed');
});

test('vault failures are normalized without leaking crypto details and require authorization', async () => {
  const harness = createHarness({
    decrypt() {
      throw new Error('bad auth tag containing sensitive implementation details');
    },
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.failures.length, 1);
  assert.equal(harness.calls.failures[0].code, 'connector_credential_decrypt_failed');
  assert.deepEqual(harness.calls.failures[0].options, {
    requiresAuthorization: true,
  });
});

test('ordinary sync failures remain retryable without forcing reauthorization', async () => {
  const harness = createHarness({
    runSync: async () => {
      const error = new Error('upstream timeout');
      error.code = 'upstream_timeout';
      throw error;
    },
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.failures[0].code, 'upstream_timeout');
  assert.deepEqual(harness.calls.failures[0].options, {
    requiresAuthorization: false,
  });
});

test('upstream authorization expiry forces reauthorization', async () => {
  const harness = createHarness({
    runSync: async () => {
      const error = new Error('session expired');
      error.code = 'authorization_required';
      throw error;
    },
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.completes.length, 0);
  assert.equal(harness.calls.failures[0].code, 'authorization_required');
  assert.deepEqual(harness.calls.failures[0].options, {
    requiresAuthorization: true,
  });
});

test('a non-function authorized transport fails with a stable local error', async () => {
  const harness = createHarness({
    createAuthorizedFetch: () => null,
  });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.equal(harness.calls.runSync.length, 0);
  assert.equal(harness.calls.completes.length, 0);
  assert.equal(harness.calls.failures[0].code, 'connector_transport_invalid');
  assert.deepEqual(harness.calls.failures[0].options, {
    requiresAuthorization: false,
  });
});

test('a run already claimed by another worker is ignored', async () => {
  const harness = createHarness({ claimed: null });

  harness.dispatcher.enqueue({ public_id: 'csr_run' });
  await harness.dispatcher.drain();

  assert.deepEqual(harness.calls.decrypts, []);
  assert.deepEqual(harness.calls.completes, []);
  assert.deepEqual(harness.calls.failures, []);
});

test('authorization error classification covers stored grant and adapter invalidation', () => {
  for (const code of [
    'authorization_required',
    'connector_authorization_required',
    'connector_adapter_changed',
    'connector_credential_decrypt_failed',
    'connector_grant_invalid',
  ]) {
    assert.equal(AUTHORIZATION_ERRORS.has(code), true, code);
  }
});
