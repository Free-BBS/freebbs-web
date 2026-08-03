const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadTsinghuaConnectorRuntimeConfig,
  parseTsinghuaConnectorRuntimeConfig,
} = require('./runtime-config');

const ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
const ENCRYPTION_KEY_HEX = Buffer.alloc(32, 9).toString('hex');

function officialEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'production',
    TSINGHUA_CONNECTOR_MODE: 'official',
    TSINGHUA_CONNECTOR_ADAPTER_ID: 'official_broker_v1',
    TSINGHUA_CONNECTOR_CALLBACK_URL:
      'https://freebbs.example.test/api/workbench/connectors/tsinghua-learn/callback',
    TSINGHUA_CONNECTOR_ENCRYPTION_KEY: ENCRYPTION_KEY_BASE64,
    TSINGHUA_CONNECTOR_WORKER_SOCKET: '/run/freebbs/tsinghua-connector.sock',
    ...overrides,
  };
}

function directCasEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'development',
    TSINGHUA_CONNECTOR_MODE: 'direct_cas',
    TSINGHUA_CONNECTOR_ADAPTER_ID: 'tsinghua_direct_cas',
    TSINGHUA_CONNECTOR_ENCRYPTION_KEY: ENCRYPTION_KEY_BASE64,
    PUBLIC_WEB_URL: 'http://127.0.0.1:3000',
    ...overrides,
  };
}

test('defaults to disabled and returns only a safe public status', () => {
  const result = parseTsinghuaConnectorRuntimeConfig({
    TSINGHUA_CONNECTOR_ENCRYPTION_KEY: 'must-never-be-returned',
    TSINGHUA_CONNECTOR_WORKER_SOCKET: '/private/worker.sock',
  });

  assert.deepEqual(result, { status: 'not_configured', missing: [] });
  assert.deepEqual(Object.keys(result), ['status', 'missing']);
  assert.doesNotMatch(JSON.stringify(result), /must-never-be-returned|private|worker\.sock/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.missing), true);
});

test('rejects unknown modes without interpreting them as adapter paths', () => {
  for (const mode of ['mock', '../adapter', 'file:///tmp/adapter.js', 'OFFICIAL']) {
    assert.deepEqual(parseTsinghuaConnectorRuntimeConfig({ TSINGHUA_CONNECTOR_MODE: mode }), {
      status: 'misconfigured',
      missing: ['mode'],
    });
  }
});

test('official mode reports every missing required setting without exposing values', () => {
  assert.deepEqual(
    parseTsinghuaConnectorRuntimeConfig({
      NODE_ENV: 'production',
      TSINGHUA_CONNECTOR_MODE: 'official',
    }),
    {
      status: 'misconfigured',
      missing: ['adapter_id', 'callback_url', 'encryption_key', 'worker_socket'],
    },
  );
});

test('direct CAS mode requires an adapter id, encryption key and secure public URL', () => {
  assert.deepEqual(parseTsinghuaConnectorRuntimeConfig(directCasEnvironment()), {
    status: 'direct_cas',
    missing: [],
  });
  assert.deepEqual(
    parseTsinghuaConnectorRuntimeConfig({
      NODE_ENV: 'development',
      TSINGHUA_CONNECTOR_MODE: 'direct_cas',
    }),
    {
      status: 'misconfigured',
      missing: ['adapter_id', 'encryption_key', 'public_web_url_https'],
    },
  );
  const runtime = loadTsinghuaConnectorRuntimeConfig(directCasEnvironment());
  assert.equal(runtime.callbackUrl, '');
  assert.equal(runtime.workerSocket, '');
  assert.equal(runtime.state, 'direct_cas');
  assert.equal(runtime.adapterId, 'tsinghua_direct_cas');
  assert.equal(runtime.encryptionKey, ENCRYPTION_KEY_BASE64);
});

test('direct CAS production mode requires an HTTPS public web URL', () => {
  assert.deepEqual(
    parseTsinghuaConnectorRuntimeConfig({
      ...directCasEnvironment(),
      NODE_ENV: 'production',
      PUBLIC_WEB_URL: 'http://127.0.0.1:3000',
    }),
    { status: 'misconfigured', missing: ['public_web_url_https'] },
  );
  assert.equal(
    parseTsinghuaConnectorRuntimeConfig({
      ...directCasEnvironment(),
      NODE_ENV: 'production',
      PUBLIC_WEB_URL: 'https://freebbs.example.test',
    }).status,
    'direct_cas',
  );
});

test('direct CAS allows HTTP only on loopback in explicit local environments', () => {
  for (const nodeEnvironment of ['development', 'test']) {
    for (const publicWebUrl of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
    ]) {
      assert.equal(
        parseTsinghuaConnectorRuntimeConfig(
          directCasEnvironment({
            NODE_ENV: nodeEnvironment,
            PUBLIC_WEB_URL: publicWebUrl,
          }),
        ).status,
        'direct_cas',
      );
    }
  }

  for (const environment of [
    directCasEnvironment({ PUBLIC_WEB_URL: '' }),
    directCasEnvironment({ PUBLIC_WEB_URL: 'http://192.168.1.10:3000' }),
    directCasEnvironment({
      NODE_ENV: 'staging',
      PUBLIC_WEB_URL: 'http://127.0.0.1:3000',
    }),
  ]) {
    assert.deepEqual(parseTsinghuaConnectorRuntimeConfig(environment), {
      status: 'misconfigured',
      missing: ['public_web_url_https'],
    });
  }

  assert.equal(
    parseTsinghuaConnectorRuntimeConfig(
      directCasEnvironment({
        NODE_ENV: 'staging',
        PUBLIC_WEB_URL: 'https://freebbs.example.test',
      }),
    ).status,
    'direct_cas',
  );
});

test('direct CAS mode accepts only its built-in adapter id', () => {
  const result = parseTsinghuaConnectorRuntimeConfig(
    directCasEnvironment({ TSINGHUA_CONNECTOR_ADAPTER_ID: 'other_adapter' }),
  );
  assert.equal(result.status, 'misconfigured');
  assert.deepEqual(result.missing, ['adapter_id']);
});

test('accepts a syntactic adapter id but rejects module paths and package specifiers', () => {
  assert.deepEqual(parseTsinghuaConnectorRuntimeConfig(officialEnvironment()), {
    status: 'ready',
    missing: [],
  });

  assert.equal(
    parseTsinghuaConnectorRuntimeConfig(
      officialEnvironment({ TSINGHUA_CONNECTOR_ADAPTER_ID: 'a'.repeat(32) }),
    ).status,
    'ready',
  );

  for (const adapterId of [
    '../broker',
    './broker.js',
    '@scope/broker',
    'file:///tmp/broker.js',
    'broker.js',
    'Broker',
    'a'.repeat(33),
  ]) {
    const result = parseTsinghuaConnectorRuntimeConfig(
      officialEnvironment({ TSINGHUA_CONNECTOR_ADAPTER_ID: adapterId }),
    );
    assert.equal(result.status, 'misconfigured');
    assert.deepEqual(result.missing, ['adapter_id']);
    assert.doesNotMatch(
      JSON.stringify(result),
      new RegExp(adapterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('requires HTTPS callbacks in production', () => {
  const result = parseTsinghuaConnectorRuntimeConfig(
    officialEnvironment({
      TSINGHUA_CONNECTOR_CALLBACK_URL: 'http://127.0.0.1:3001/callback',
    }),
  );
  assert.deepEqual(result, { status: 'misconfigured', missing: ['callback_url'] });
});

test('allows HTTP callbacks only on exact loopback hosts in test or development', () => {
  for (const nodeEnvironment of ['test', 'development']) {
    for (const callbackUrl of [
      'http://localhost:3001/callback',
      'http://127.0.0.1:3001/callback',
      'http://[::1]:3001/callback',
    ]) {
      assert.deepEqual(
        parseTsinghuaConnectorRuntimeConfig(
          officialEnvironment({
            NODE_ENV: nodeEnvironment,
            TSINGHUA_CONNECTOR_CALLBACK_URL: callbackUrl,
          }),
        ),
        { status: 'ready', missing: [] },
      );
    }
  }

  for (const callbackUrl of [
    'http://localhost.example.test/callback',
    'http://0.0.0.0:3001/callback',
    'http://192.168.1.10/callback',
    '/relative/callback',
    'ftp://localhost/callback',
    'https://user:secret@example.test/callback',
    'https://example.test/callback#fragment',
  ]) {
    const result = parseTsinghuaConnectorRuntimeConfig(
      officialEnvironment({
        NODE_ENV: 'test',
        TSINGHUA_CONNECTOR_CALLBACK_URL: callbackUrl,
      }),
    );
    assert.equal(result.status, 'misconfigured');
    assert.deepEqual(result.missing, ['callback_url']);
  }
});

test('requires an independent, exactly 32-byte encryption key', () => {
  for (const encryptionKey of [
    ENCRYPTION_KEY_HEX,
    `base64:${ENCRYPTION_KEY_BASE64}`,
    ENCRYPTION_KEY_BASE64.replace(/=+$/u, ''),
  ]) {
    assert.deepEqual(
      parseTsinghuaConnectorRuntimeConfig(
        officialEnvironment({ TSINGHUA_CONNECTOR_ENCRYPTION_KEY: encryptionKey }),
      ),
      { status: 'ready', missing: [] },
    );
  }

  for (const encryptionKey of [
    Buffer.alloc(31, 1).toString('base64'),
    Buffer.alloc(33, 1).toString('base64'),
    'x'.repeat(32),
    'not-base64!',
  ]) {
    const result = parseTsinghuaConnectorRuntimeConfig(
      officialEnvironment({ TSINGHUA_CONNECTOR_ENCRYPTION_KEY: encryptionKey }),
    );
    assert.equal(result.status, 'misconfigured');
    assert.deepEqual(result.missing, ['encryption_key']);
    assert.doesNotMatch(JSON.stringify(result), /not-base64|xxxxxxxx/u);
  }

  const onlySharedKey = officialEnvironment({ TSINGHUA_CONNECTOR_ENCRYPTION_KEY: '' });
  onlySharedKey.SETTINGS_ENCRYPTION_KEY = ENCRYPTION_KEY_BASE64;
  assert.deepEqual(parseTsinghuaConnectorRuntimeConfig(onlySharedKey), {
    status: 'misconfigured',
    missing: ['encryption_key'],
  });
});

test('requires a safe absolute POSIX worker socket path', () => {
  for (const workerSocket of [
    'relative/worker.sock',
    './worker.sock',
    '/run/freebbs/',
    '/run/freebbs/worker.sock\nforged',
    '',
  ]) {
    const result = parseTsinghuaConnectorRuntimeConfig(
      officialEnvironment({ TSINGHUA_CONNECTOR_WORKER_SOCKET: workerSocket }),
    );
    assert.equal(result.status, 'misconfigured');
    assert.deepEqual(result.missing, ['worker_socket']);
    assert.doesNotMatch(JSON.stringify(result), /worker\.sock|forged/u);
  }
});

test('enforces authorization-state TTL boundaries without silently clamping', () => {
  for (const value of ['300', '900']) {
    assert.equal(
      parseTsinghuaConnectorRuntimeConfig(
        officialEnvironment({ TSINGHUA_CONNECTOR_STATE_TTL_SECONDS: value }),
      ).status,
      'ready',
    );
  }
  for (const value of ['299', '901', '300.5', '-1', '1e3']) {
    assert.deepEqual(
      parseTsinghuaConnectorRuntimeConfig(
        officialEnvironment({ TSINGHUA_CONNECTOR_STATE_TTL_SECONDS: value }),
      ),
      { status: 'misconfigured', missing: ['state_ttl_seconds'] },
    );
  }
});

test('enforces synchronization interval boundaries without silently clamping', () => {
  for (const value of ['60', '3600']) {
    assert.equal(
      parseTsinghuaConnectorRuntimeConfig(
        officialEnvironment({ TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS: value }),
      ).status,
      'ready',
    );
  }
  for (const value of ['59', '3601', '60.5', '-1', '1e3']) {
    assert.deepEqual(
      parseTsinghuaConnectorRuntimeConfig(
        officialEnvironment({ TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS: value }),
      ),
      { status: 'misconfigured', missing: ['sync_interval_seconds'] },
    );
  }
});

test('development mock is available only in explicit local environments', () => {
  for (const nodeEnvironment of ['test', 'development']) {
    assert.deepEqual(
      parseTsinghuaConnectorRuntimeConfig({
        NODE_ENV: nodeEnvironment,
        TSINGHUA_CONNECTOR_MODE: 'development_mock',
      }),
      { status: 'development_mock', missing: [] },
    );
  }

  for (const nodeEnvironment of ['production', 'staging', '']) {
    assert.deepEqual(
      parseTsinghuaConnectorRuntimeConfig({
        NODE_ENV: nodeEnvironment,
        TSINGHUA_CONNECTOR_MODE: 'development_mock',
      }),
      {
        status: 'misconfigured',
        missing: ['development_mock_environment'],
      },
    );
  }
});

test('development mock still honors TTL and synchronization safety limits', () => {
  assert.deepEqual(
    parseTsinghuaConnectorRuntimeConfig({
      NODE_ENV: 'test',
      TSINGHUA_CONNECTOR_MODE: 'development_mock',
      TSINGHUA_CONNECTOR_STATE_TTL_SECONDS: '10',
      TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS: '9999',
    }),
    {
      status: 'misconfigured',
      missing: ['state_ttl_seconds', 'sync_interval_seconds'],
    },
  );
});
test('loads a frozen internal runtime config while keeping the public summary secret-free', () => {
  const environment = officialEnvironment({
    TSINGHUA_CONNECTOR_STATE_TTL_SECONDS: '720',
    TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS: '180',
  });
  const runtime = loadTsinghuaConnectorRuntimeConfig(environment);

  assert.deepEqual(runtime, {
    state: 'ready',
    mode: 'official',
    adapterId: environment.TSINGHUA_CONNECTOR_ADAPTER_ID,
    callbackUrl: environment.TSINGHUA_CONNECTOR_CALLBACK_URL,
    encryptionKey: environment.TSINGHUA_CONNECTOR_ENCRYPTION_KEY,
    workerSocket: environment.TSINGHUA_CONNECTOR_WORKER_SOCKET,
    authorizationTtlSeconds: 720,
    syncIntervalSeconds: 180,
    missing: [],
  });
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.missing), true);

  const summary = parseTsinghuaConnectorRuntimeConfig(environment);
  assert.deepEqual(summary, { status: 'ready', missing: [] });
  const serializedSummary = JSON.stringify(summary);
  assert.doesNotMatch(
    serializedSummary,
    /official_broker_v1|freebbs\.example\.test|run\/freebbs|tsinghua-connector/u,
  );
  assert.equal(serializedSummary.includes(ENCRYPTION_KEY_BASE64), false);
});

test('internal loading retains diagnostic values for disabled and misconfigured modes', () => {
  const disabled = loadTsinghuaConnectorRuntimeConfig({
    TSINGHUA_CONNECTOR_MODE: 'disabled',
    TSINGHUA_CONNECTOR_ADAPTER_ID: 'dormant_adapter',
    TSINGHUA_CONNECTOR_CALLBACK_URL: 'https://disabled.example.test/callback',
    TSINGHUA_CONNECTOR_ENCRYPTION_KEY: ENCRYPTION_KEY_HEX,
    TSINGHUA_CONNECTOR_WORKER_SOCKET: '/run/freebbs/disabled.sock',
  });
  assert.equal(disabled.state, 'not_configured');
  assert.equal(disabled.adapterId, 'dormant_adapter');
  assert.equal(disabled.encryptionKey, ENCRYPTION_KEY_HEX);
  assert.equal(disabled.authorizationTtlSeconds, 600);
  assert.equal(disabled.syncIntervalSeconds, 300);
  assert.deepEqual(disabled.missing, []);

  const misconfiguredEnvironment = officialEnvironment({
    TSINGHUA_CONNECTOR_ADAPTER_ID: '../unsafe-adapter',
    TSINGHUA_CONNECTOR_CALLBACK_URL: 'http://127.0.0.1/callback',
    TSINGHUA_CONNECTOR_ENCRYPTION_KEY: 'invalid-key',
    TSINGHUA_CONNECTOR_WORKER_SOCKET: 'relative.sock',
    TSINGHUA_CONNECTOR_STATE_TTL_SECONDS: '299',
    TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS: '3601',
  });
  const misconfigured = loadTsinghuaConnectorRuntimeConfig(misconfiguredEnvironment);
  assert.equal(misconfigured.state, 'misconfigured');
  assert.equal(misconfigured.adapterId, '../unsafe-adapter');
  assert.equal(misconfigured.callbackUrl, 'http://127.0.0.1/callback');
  assert.equal(misconfigured.encryptionKey, 'invalid-key');
  assert.equal(misconfigured.workerSocket, 'relative.sock');
  assert.equal(misconfigured.authorizationTtlSeconds, null);
  assert.equal(misconfigured.syncIntervalSeconds, null);
  assert.deepEqual(misconfigured.missing, [
    'adapter_id',
    'state_ttl_seconds',
    'sync_interval_seconds',
    'callback_url',
    'encryption_key',
    'worker_socket',
  ]);
  assert.deepEqual(parseTsinghuaConnectorRuntimeConfig(misconfiguredEnvironment), {
    status: 'misconfigured',
    missing: misconfigured.missing,
  });
});
