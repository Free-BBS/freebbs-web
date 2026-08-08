const assert = require('node:assert/strict');
const test = require('node:test');
const { buildBackendHealth } = require('./health');

function buildHealth(overrides = {}) {
  return buildBackendHealth({
    agentSettingsRequired: false,
    agentSettingsState: 'disabled',
    tsinghuaConnectorRequired: false,
    tsinghuaConnectorAvailability: {
      state: 'not_configured',
      authorizationAvailable: false,
      syncAvailable: false,
    },
    ...overrides,
  });
}

test('keeps an optional disabled Tsinghua connector from failing backend health', () => {
  const health = buildHealth();

  assert.equal(health.statusCode, 200);
  assert.equal(health.body.ok, true);
  assert.deepEqual(health.body.tsinghuaConnector, {
    required: false,
    state: 'not_configured',
    ready: false,
    authorizationAvailable: false,
    syncAvailable: false,
    missing: [],
  });
  assert.equal(Object.hasOwn(health.body, 'message'), false);
});

test('fails health when the required Tsinghua connector is disabled or misconfigured', () => {
  for (const state of ['not_configured', 'misconfigured']) {
    const health = buildHealth({
      tsinghuaConnectorRequired: true,
      tsinghuaConnectorAvailability: {
        state,
        authorizationAvailable: false,
        syncAvailable: false,
      },
    });

    assert.equal(health.statusCode, 503);
    assert.equal(health.body.ok, false);
    assert.match(health.body.message, /Tsinghua connector/u);
  }
});

test('requires both authorization and synchronization runtime capabilities', () => {
  for (const availability of [
    { state: 'ready', authorizationAvailable: false, syncAvailable: true },
    { state: 'direct_cas', authorizationAvailable: true, syncAvailable: false },
    { state: 'misconfigured', authorizationAvailable: true, syncAvailable: true },
    { state: 'development_mock', authorizationAvailable: true, syncAvailable: true },
  ]) {
    const health = buildHealth({
      tsinghuaConnectorRequired: true,
      tsinghuaConnectorAvailability: availability,
    });

    assert.equal(health.statusCode, 503);
    assert.equal(health.body.ok, false);
  }

  for (const state of ['ready', 'direct_cas']) {
    const health = buildHealth({
      tsinghuaConnectorRequired: true,
      tsinghuaConnectorAvailability: {
        state,
        authorizationAvailable: true,
        syncAvailable: true,
      },
    });

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.tsinghuaConnector.ready, true);
  }
});

test('preserves the required Agent settings health contract', () => {
  const failed = buildHealth({
    agentSettingsRequired: true,
    agentSettingsState: 'failed',
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.ok, false);
  assert.match(failed.body.message, /Agent settings internal API/u);

  const ready = buildHealth({
    agentSettingsRequired: true,
    agentSettingsState: 'ready',
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.body.ok, true);
});

test('publishes only normalized connector diagnostics', () => {
  const secret = 'super-secret-runtime-value';
  const health = buildHealth({
    tsinghuaConnectorRequired: true,
    tsinghuaConnectorAvailability: {
      state: secret,
      authorizationAvailable: false,
      syncAvailable: false,
    },
    tsinghuaConnectorMissing: [
      'encryption_key',
      'worker_socket',
      `/run/freebbs/${secret}.sock`,
      `callback_url=${secret}`,
    ],
  });

  assert.equal(health.body.tsinghuaConnector.state, 'misconfigured');
  assert.deepEqual(health.body.tsinghuaConnector.missing, ['encryption_key', 'worker_socket']);
  assert.doesNotMatch(JSON.stringify(health), new RegExp(secret, 'u'));
});
