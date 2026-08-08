const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createCampusConnectorBroker } = require('./broker');

const FINGERPRINT = '0123456789abcdef0123456789abcdef';

function createMemoryStore() {
  const flows = new Map();
  const connections = new Map();
  const runs = new Map();

  return {
    flows,
    connections,
    runs,
    async getConnection(userId, provider) {
      return connections.get(`${userId}:${provider}`) || null;
    },
    async getPendingAuthorizationFlow(userId, provider, currentTime) {
      return (
        [...flows.values()].find(
          (flow) =>
            flow.user_id === userId &&
            flow.provider === provider &&
            flow.status === 'redirect_issued' &&
            flow.expires_at > currentTime,
        ) || null
      );
    },
    async getLatestSyncRun(userId, provider) {
      const connection = connections.get(`${userId}:${provider}`);
      if (!connection) return null;
      return (
        [...runs.values()]
          .filter(
            (run) =>
              run.userId === userId &&
              run.provider === provider &&
              run.connector_generation === connection.generation,
          )
          .at(-1) || null
      );
    },
    async replaceAuthorizationFlow(flow) {
      for (const existing of flows.values()) {
        if (
          existing.user_id === flow.userId &&
          existing.provider === flow.provider &&
          existing.status === 'redirect_issued'
        ) {
          existing.status = 'invalidated';
          existing.consumed_at = flow.createdAt;
        }
      }
      const key = flow.stateHash.toString('hex');
      flows.set(key, {
        state_hash: flow.stateHash,
        public_id: flow.publicId,
        user_id: flow.userId,
        provider: flow.provider,
        adapter_id: flow.adapterId,
        adapter_version: flow.adapterVersion,
        return_path: flow.returnPath,
        flow_secret_ciphertext: flow.encryptedFlowSecret?.ciphertext || null,
        flow_secret_iv: flow.encryptedFlowSecret?.iv || null,
        flow_secret_auth_tag: flow.encryptedFlowSecret?.authTag || null,
        status: flow.status,
        expires_at: flow.expiresAt,
        consumed_at: null,
      });
    },
    async invalidatePendingAuthorizationFlows() {
      return undefined;
    },
    async claimAuthorizationFlow(stateHash, provider, claimedAt) {
      const flow = flows.get(stateHash.toString('hex'));
      if (
        !flow ||
        flow.provider !== provider ||
        flow.status !== 'redirect_issued' ||
        flow.consumed_at ||
        flow.expires_at <= claimedAt
      ) {
        return null;
      }
      flow.status = 'callback_received';
      flow.consumed_at = claimedAt;
      return { ...flow };
    },
    async failAuthorizationFlow(stateHash, errorCode) {
      const flow = flows.get(stateHash.toString('hex'));
      if (flow) {
        flow.status = 'failed';
        flow.safe_error_code = errorCode;
      }
    },
    async completeAuthorization(input) {
      const key = `${input.flow.user_id}:${input.provider}`;
      connections.set(key, {
        id: connections.size + 1,
        public_id: `ucc_${connections.size + 1}`,
        user_id: input.flow.user_id,
        provider: input.provider,
        status: 'active_unverified',
        generation: 1,
        adapter_id: input.adapterId,
        adapter_version: input.adapterVersion,
        credential_ciphertext: input.encryptedGrant.ciphertext,
        credential_iv: input.encryptedGrant.iv,
        credential_auth_tag: input.encryptedGrant.authTag,
        credential_expires_at: input.credentialExpiresAt,
        connected_at: input.completedAt,
      });
      const flow = flows.get(input.stateHash.toString('hex'));
      flow.status = 'succeeded';
    },
    async completeDirectConnection(input) {
      const key = `${input.userId}:${input.provider}`;
      const existing = connections.get(key);
      connections.set(key, {
        id: existing?.id || connections.size + 1,
        public_id: existing?.public_id || `ucc_${connections.size + 1}`,
        user_id: input.userId,
        provider: input.provider,
        status: 'active_unverified',
        generation: (existing?.generation || 0) + 1,
        adapter_id: input.adapterId,
        adapter_version: input.adapterVersion,
        credential_type: input.credentialType,
        credential_ciphertext: input.encryptedGrant.ciphertext,
        credential_iv: input.encryptedGrant.iv,
        credential_auth_tag: input.encryptedGrant.authTag,
        credential_expires_at: input.credentialExpiresAt,
        connected_at: input.completedAt,
        granted_scopes: input.scopes,
        last_successful_sync_at: null,
      });
    },
    async expireConnection({ userId, provider, expectedGeneration, expiredAt }) {
      const connection = connections.get(`${userId}:${provider}`);
      const credentialExpiresAt = connection?.credential_expires_at
        ? new Date(connection.credential_expires_at)
        : null;
      if (
        !connection ||
        !['active_unverified', 'active_verified'].includes(connection.status) ||
        connection.generation !== expectedGeneration ||
        !credentialExpiresAt ||
        Number.isNaN(credentialExpiresAt.getTime()) ||
        credentialExpiresAt > expiredAt
      ) {
        return false;
      }

      connection.status = 'reauthorization_required';
      connection.generation += 1;
      connection.identity_fingerprint = null;
      connection.granted_scopes = null;
      connection.credential_type = null;
      connection.credential_ciphertext = null;
      connection.credential_iv = null;
      connection.credential_auth_tag = null;
      connection.credential_expires_at = null;
      connection.reauthorization_required_at = expiredAt;
      connection.last_successful_sync_at = null;
      connection.last_error_code = 'authorization_required';
      for (const run of runs.values()) {
        if (run.connector_id === connection.id && ['queued', 'running'].includes(run.status)) {
          run.status = 'cancelled';
          run.finished_at = expiredAt;
          run.error_code = 'authorization_required';
        }
      }
      return true;
    },
    async revokeConnection(userId, provider, revokedAt) {
      const connection = connections.get(`${userId}:${provider}`);
      if (!connection) return null;
      const previous = { ...connection };
      connection.status = 'revoked';
      connection.generation += 1;
      connection.credential_ciphertext = null;
      connection.credential_iv = null;
      connection.credential_auth_tag = null;
      connection.revoked_at = revokedAt;
      return previous;
    },
    async createSyncRun(input) {
      const connection = [...connections.values()].find((item) => item.id === input.connectorId);
      const active = [...runs.values()].some(
        (run) =>
          run.connector_id === input.connectorId && ['queued', 'running'].includes(run.status),
      );
      if (active) {
        const error = new Error('active run');
        error.code = 'sync_in_progress';
        throw error;
      }
      const run = {
        public_id: input.publicId,
        trace_id: input.traceId,
        connector_id: input.connectorId,
        status: 'queued',
        connector_generation: input.connectorGeneration,
        userId: input.requestedByUserId,
        provider: connection.provider,
      };
      runs.set(run.public_id, run);
      return run;
    },
    async failSyncRun(publicId, errorCode) {
      const run = runs.get(publicId);
      run.status = 'failed';
      run.error_code = errorCode;
    },
    async getSyncRun(userId, provider, publicId) {
      const run = runs.get(publicId);
      return run?.userId === userId && run?.provider === provider ? run : null;
    },
  };
}

function createMemoryVault() {
  return {
    encrypt(value) {
      return {
        ciphertext: Buffer.from(String(value)),
        iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
      };
    },
    decrypt(record) {
      return Buffer.from(record.ciphertext).toString('utf8');
    },
    fingerprint(value, context) {
      return crypto.createHash('sha256').update(`${context.connectorId}:${value}`).digest();
    },
  };
}

function createAdapter(overrides = {}) {
  return {
    id: 'fixture-adapter',
    version: 'v1',
    allowedAuthorizationOrigins: ['https://id.example.test'],
    async beginAuthorization({ state }) {
      return {
        authorizationUrl: `https://id.example.test/authorize?state=${state}`,
        flowSecret: 'pkce-verifier',
      };
    },
    async completeAuthorization() {
      return {
        subject: 'student-subject',
        opaqueGrant: 'opaque-broker-handle',
        scopes: ['courses', 'homework'],
        expiresAt: '2026-08-02T12:00:00.000Z',
      };
    },
    async revoke() {
      return undefined;
    },
    ...overrides,
  };
}

function createReadyBroker(options = {}) {
  const store = options.store || createMemoryStore();
  const adapter = options.adapter || createAdapter();
  const clock = options.clock || { value: new Date('2026-08-02T08:00:00.000Z') };
  const broker = createCampusConnectorBroker({
    store,
    vault: options.vault || createMemoryVault(),
    adapter,
    runtimeConfig: {
      state: 'ready',
      adapterId: adapter.id,
      callbackUrl: 'https://free-bbs.example/api/workbench/connectors/tsinghua/callback',
      authorizationTtlSeconds: 600,
    },
    syncDispatcher: options.syncDispatcher,
    now: () => new Date(clock.value),
    randomBytes: options.randomBytes || ((length) => Buffer.alloc(length, 7)),
  });
  return { adapter, broker, clock, store };
}

function createDirectBroker(options = {}) {
  const store = options.store || createMemoryStore();
  const adapter =
    options.adapter ||
    createAdapter({
      id: 'tsinghua_direct_cas',
      async authenticateDirect() {
        return {
          subject: 'student-subject',
          opaqueGrant: JSON.stringify({ version: 1, cookies: [{ name: 'SESSION', value: 'x' }] }),
          scopes: ['semesters', 'courses', 'course_notices', 'homework'],
          expiresAt: '2026-08-02T12:00:00.000Z',
        };
      },
    });
  const clock = options.clock || { value: new Date('2026-08-02T08:00:00.000Z') };
  const broker = createCampusConnectorBroker({
    store,
    vault: options.vault || createMemoryVault(),
    adapter,
    runtimeConfig: {
      state: 'direct_cas',
      adapterId: adapter.id,
      authorizationTtlSeconds: 600,
    },
    syncDispatcher: options.syncDispatcher,
    now: () => new Date(clock.value),
    randomBytes: options.randomBytes || ((length) => Buffer.alloc(length, 7)),
  });
  return { adapter, broker, clock, store };
}

test('exposes only actual, secret-free connector availability', () => {
  const syncDispatcher = {
    async enqueue() {
      return undefined;
    },
  };
  const disabled = createCampusConnectorBroker({
    store: createMemoryStore(),
    runtimeConfig: {
      state: 'not_configured',
      encryptionKey: 'must-never-be-returned',
      workerSocket: '/private/connector.sock',
    },
    syncDispatcher,
  }).getAvailability();
  assert.deepEqual(disabled, {
    state: 'not_configured',
    authorizationAvailable: false,
    authorizationKind: 'none',
    syncAvailable: false,
  });
  assert.doesNotMatch(JSON.stringify(disabled), /must-never|private|connector\.sock/u);

  const missingOfficialAdapter = createCampusConnectorBroker({
    store: createMemoryStore(),
    vault: createMemoryVault(),
    runtimeConfig: {
      state: 'ready',
      adapterId: 'official_broker_v1',
    },
    syncDispatcher,
  }).getAvailability();
  assert.deepEqual(missingOfficialAdapter, {
    state: 'misconfigured',
    authorizationAvailable: false,
    authorizationKind: 'none',
    syncAvailable: false,
  });

  const directAdapter = createAdapter({
    id: 'tsinghua_direct_cas',
    authenticateDirect() {},
  });
  const missingVault = createCampusConnectorBroker({
    store: createMemoryStore(),
    adapter: directAdapter,
    runtimeConfig: {
      state: 'direct_cas',
      adapterId: directAdapter.id,
    },
    syncDispatcher,
  }).getAvailability();
  assert.deepEqual(missingVault, {
    state: 'misconfigured',
    authorizationAvailable: false,
    authorizationKind: 'none',
    syncAvailable: false,
  });
});

test('reports synchronization availability only for a callable dispatcher', async () => {
  const withoutDispatcher = createDirectBroker({ syncDispatcher: {} });
  assert.deepEqual(withoutDispatcher.broker.getAvailability(), {
    state: 'direct_cas',
    authorizationAvailable: true,
    authorizationKind: 'direct_credentials',
    syncAvailable: false,
  });
  await withoutDispatcher.broker.connectDirect({
    userId: 7,
    username: '2026000000',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });
  const unavailableStatus = await withoutDispatcher.broker.getStatus(7);
  assert.equal(unavailableStatus.sync.available, false);

  const withDispatcher = createDirectBroker({
    syncDispatcher: {
      async enqueue() {
        return undefined;
      },
    },
  });
  assert.deepEqual(withDispatcher.broker.getAvailability(), {
    state: 'direct_cas',
    authorizationAvailable: true,
    authorizationKind: 'direct_credentials',
    syncAvailable: true,
  });
  await withDispatcher.broker.connectDirect({
    userId: 8,
    username: '2026000001',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });
  const availableStatus = await withDispatcher.broker.getStatus(8);
  assert.equal(availableStatus.sync.available, true);
});

test('disabled runtime fails closed without creating a flow or authorization URL', async () => {
  const store = createMemoryStore();
  let adapterCalls = 0;
  const adapter = createAdapter({
    async beginAuthorization() {
      adapterCalls += 1;
      return { authorizationUrl: 'https://id.example.test/' };
    },
  });
  const broker = createCampusConnectorBroker({
    store,
    adapter,
    runtimeConfig: { state: 'not_configured' },
  });

  await assert.rejects(
    broker.beginAuthorization({ userId: 7 }),
    (error) => error.code === 'tsinghua_authorization_not_configured' && error.status === 503,
  );
  assert.equal(adapterCalls, 0);
  assert.equal(store.flows.size, 0);
});

test('authorization start stores only a digest and replaces older pending state', async () => {
  let counter = 0;
  const { broker, store } = createReadyBroker({
    randomBytes(length) {
      counter += 1;
      return Buffer.alloc(length, counter);
    },
  });
  const first = await broker.beginAuthorization({ userId: 7 });
  const second = await broker.beginAuthorization({ userId: 7 });
  const firstState = new URL(first.authorizationUrl).searchParams.get('state');
  const secondState = new URL(second.authorizationUrl).searchParams.get('state');

  assert.match(firstState, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstState, secondState);
  assert.equal(
    [...store.flows.values()].filter((flow) => flow.status === 'redirect_issued').length,
    1,
  );
  assert.equal(
    [...store.flows.keys()].includes(
      crypto.createHash('sha256').update(secondState, 'utf8').digest('hex'),
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify([...store.flows.values()]), new RegExp(secondState));
});

test('callback binds to the state owner and rejects a sequential replay', async () => {
  const { broker, store } = createReadyBroker();
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');
  const completed = await broker.completeAuthorization({
    state,
    browserBinding: attempt.browserBinding,
    callbackParams: { ticket: 'one-time-ticket' },
  });

  assert.equal(completed.result, 'connected');
  assert.equal(store.connections.get('7:tsinghua-learn').user_id, 7);
  assert.equal(store.connections.has('8:tsinghua-learn'), false);
  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: attempt.browserBinding,
      callbackParams: { ticket: 'one-time-ticket' },
    }),
    (error) => error.code === 'authorization_state_invalid',
  );
});

test('callback rejects a different browser binding and burns the claimed state', async () => {
  let exchangeCalls = 0;
  const adapter = createAdapter({
    async completeAuthorization() {
      exchangeCalls += 1;
      return { subject: 'subject', opaqueGrant: 'grant' };
    },
  });
  const { broker, store } = createReadyBroker({ adapter });
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: 'A'.repeat(43),
      callbackParams: { ticket: 'forwarded-ticket' },
    }),
    (error) => error.code === 'authorization_state_invalid' && error.status === 400,
  );
  const [flow] = [...store.flows.values()];
  assert.equal(flow.status, 'failed');
  assert.equal(flow.safe_error_code, 'authorization_browser_mismatch');
  assert.equal(exchangeCalls, 0);

  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: attempt.browserBinding,
      callbackParams: { ticket: 'forwarded-ticket' },
    }),
    (error) => error.code === 'authorization_state_invalid',
  );
  assert.equal(exchangeCalls, 0);
});

test('expired authorization state is never exchanged', async () => {
  let exchangeCalls = 0;
  const adapter = createAdapter({
    async completeAuthorization() {
      exchangeCalls += 1;
      return { subject: 'subject', opaqueGrant: 'grant' };
    },
  });
  const { broker, clock } = createReadyBroker({ adapter });
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');
  clock.value = new Date('2026-08-02T08:10:00.001Z');

  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: attempt.browserBinding,
      callbackParams: { ticket: 'expired' },
    }),
    (error) => error.code === 'authorization_state_invalid',
  );
  assert.equal(exchangeCalls, 0);
});

test('adapter exchange failure burns the claimed state', async () => {
  let exchangeCalls = 0;
  const adapter = createAdapter({
    async completeAuthorization() {
      exchangeCalls += 1;
      throw new Error('secret upstream detail');
    },
  });
  const { broker } = createReadyBroker({ adapter });
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: attempt.browserBinding,
      callbackParams: { ticket: 'ticket' },
    }),
    (error) => error.code === 'authorization_failed' && !error.message.includes('secret upstream'),
  );
  await assert.rejects(
    broker.completeAuthorization({
      state,
      browserBinding: attempt.browserBinding,
      callbackParams: { ticket: 'ticket' },
    }),
    (error) => error.code === 'authorization_state_invalid',
  );
  assert.equal(exchangeCalls, 1);
});

test('disconnect destroys the local credential before best-effort remote revoke', async () => {
  let revokedGrant = '';
  const adapter = createAdapter({
    async revoke({ opaqueGrant }) {
      revokedGrant = opaqueGrant;
    },
  });
  const { broker, store } = createReadyBroker({ adapter });
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');
  await broker.completeAuthorization({
    state,
    browserBinding: attempt.browserBinding,
    callbackParams: { ticket: 'ticket' },
  });
  await broker.disconnect(7);

  const connection = store.connections.get('7:tsinghua-learn');
  assert.equal(connection.status, 'revoked');
  assert.equal(connection.credential_ciphertext, null);
  assert.equal(revokedGrant, 'opaque-broker-handle');
});

test('disconnect never passes a grant to an adapter with a different id or version', async (t) => {
  const scenarios = [
    { name: 'adapter id changed', adapterId: 'replacement-adapter', adapterVersion: 'v1' },
    { name: 'adapter version changed', adapterId: 'fixture-adapter', adapterVersion: 'v2' },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let decryptCalls = 0;
      let revokeCalls = 0;
      const baseVault = createMemoryVault();
      const vault = {
        ...baseVault,
        decrypt(...args) {
          decryptCalls += 1;
          return baseVault.decrypt(...args);
        },
      };
      const adapter = createAdapter({
        async revoke() {
          revokeCalls += 1;
        },
      });
      const { broker, store } = createReadyBroker({ adapter, vault });
      const attempt = await broker.beginAuthorization({ userId: 7 });
      const state = new URL(attempt.authorizationUrl).searchParams.get('state');
      await broker.completeAuthorization({
        state,
        browserBinding: attempt.browserBinding,
        callbackParams: { ticket: 'ticket' },
      });
      decryptCalls = 0;
      const connection = store.connections.get('7:tsinghua-learn');
      connection.adapter_id = scenario.adapterId;
      connection.adapter_version = scenario.adapterVersion;

      await broker.disconnect(7);

      assert.equal(connection.status, 'revoked');
      assert.equal(connection.credential_ciphertext, null);
      assert.equal(connection.credential_iv, null);
      assert.equal(connection.credential_auth_tag, null);
      assert.equal(decryptCalls, 0);
      assert.equal(revokeCalls, 0);
    });
  }
});

test('authorization rejects an invalid or already expired grant expiry', async (t) => {
  for (const expiresAt of ['not-a-date', '2026-08-02T07:59:59.000Z']) {
    await t.test(expiresAt, async () => {
      const adapter = createAdapter({
        async completeAuthorization() {
          return {
            subject: 'student-subject',
            opaqueGrant: 'opaque-broker-handle',
            expiresAt,
          };
        },
      });
      const { broker, store } = createReadyBroker({ adapter });
      const attempt = await broker.beginAuthorization({ userId: 7 });
      const state = new URL(attempt.authorizationUrl).searchParams.get('state');

      await assert.rejects(
        broker.completeAuthorization({
          state,
          browserBinding: attempt.browserBinding,
          callbackParams: { ticket: 'ticket' },
        }),
        (error) => error.code === 'authorization_failed' && error.status === 502,
      );
      assert.equal(store.connections.size, 0);
      assert.equal([...store.flows.values()][0].safe_error_code, 'authorization_response_invalid');
    });
  }
});

test('sync creation is user scoped and enforces a single active run', async () => {
  const enqueued = [];
  const { broker } = createReadyBroker({
    syncDispatcher: {
      async enqueue(run) {
        enqueued.push(run.public_id);
      },
    },
  });
  const attempt = await broker.beginAuthorization({ userId: 7 });
  const state = new URL(attempt.authorizationUrl).searchParams.get('state');
  await broker.completeAuthorization({
    state,
    browserBinding: attempt.browserBinding,
    callbackParams: { ticket: 'ticket' },
  });

  const first = await broker.requestSync(7);
  assert.equal(first.status, 'queued');
  await assert.rejects(broker.requestSync(7), (error) => error.code === 'sync_in_progress');
  assert.deepEqual(enqueued, [first.publicId]);
  await assert.rejects(
    broker.getSyncRun(8, first.publicId),
    (error) => error.code === 'sync_run_not_found',
  );
});

test('direct CAS mode stores only an encrypted verified session grant', async () => {
  let observedCredentials = null;
  const adapter = createAdapter({
    id: 'tsinghua_direct_cas',
    async authenticateDirect(credentials) {
      observedCredentials = credentials;
      return {
        subject: '2026000000',
        opaqueGrant: JSON.stringify({
          version: 1,
          cookies: [{ name: 'SESSION', value: 'upstream-secret' }],
        }),
        scopes: ['courses', 'homework'],
        expiresAt: '2026-08-02T12:00:00.000Z',
      };
    },
  });
  const { broker, store } = createDirectBroker({ adapter });

  const result = await broker.connectDirect({
    userId: 7,
    username: '2026000000',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });

  assert.equal(result.connectionStatus, 'active_unverified');
  assert.deepEqual(observedCredentials, {
    username: '2026000000',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });
  const connection = store.connections.get('7:tsinghua-learn');
  assert.equal(connection.status, 'active_unverified');
  assert.equal(connection.credential_type, 'encrypted_cookie_jar');
  assert.equal(connection.credential_ciphertext.includes(Buffer.from('one-time-password')), false);
  assert.equal(connection.credential_ciphertext.includes(Buffer.from(FINGERPRINT)), false);
  assert.match(connection.credential_ciphertext.toString(), /upstream-secret/u);

  store.runs.set('csr_partial', {
    public_id: 'csr_partial',
    userId: 7,
    provider: 'tsinghua-learn',
    connector_generation: connection.generation,
    status: 'partial',
    result_counts: { courses: 5, notifications: 16 },
    error_context: {
      warnings: [{ resource: 'homework:unsubmitted', code: 'parser_record_rejected', count: 2 }],
      errors: [{ resource: 'unsafe value', code: 'raw_private_value', count: 1 }],
    },
  });

  const status = await broker.getStatus(7);
  assert.equal(status.configuration.authorizationKind, 'direct_credentials');
  assert.equal(status.safeguards.acceptsPasswordFromBrowser, true);
  assert.equal(status.safeguards.storesPassword, false);
  assert.equal(status.safeguards.oneTimeAuthorizationState, false);
  assert.deepEqual(status.sync.latestRun.resultCounts, { courses: 5, notifications: 16 });
  assert.deepEqual(status.sync.latestRun.diagnostics, {
    warnings: [{ resource: 'homework:unsubmitted', code: 'parser_record_rejected', count: 2 }],
    errors: [],
  });
  assert.doesNotMatch(JSON.stringify(status), new RegExp(FINGERPRINT, 'iu'));
});

test('natural credential expiry atomically clears identity and cancels old sync work once', async () => {
  const { broker, clock, store } = createDirectBroker();
  await broker.connectDirect({
    userId: 7,
    username: '2026000000',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });
  const connection = store.connections.get('7:tsinghua-learn');
  connection.status = 'active_verified';
  connection.identity_fingerprint = Buffer.alloc(32, 9);
  connection.last_successful_sync_at = new Date('2026-08-02T10:00:00.000Z');
  const expiredGeneration = connection.generation;
  store.runs.set('csr_pending', {
    public_id: 'csr_pending',
    connector_id: connection.id,
    connector_generation: expiredGeneration,
    userId: 7,
    provider: 'tsinghua-learn',
    status: 'queued',
  });
  clock.value = new Date('2026-08-02T12:00:00.000Z');

  const status = await broker.getStatus(7);
  assert.equal(status.connection.status, 'reauthorization_required');
  assert.equal(status.connection.credentialExpiresAt, null);
  assert.equal(status.connection.lastSuccessfulSyncAt, null);
  assert.equal(status.sync.latestRun, null);
  assert.equal(connection.generation, expiredGeneration + 1);
  assert.equal(connection.identity_fingerprint, null);
  assert.equal(connection.granted_scopes, null);
  assert.equal(connection.credential_ciphertext, null);
  assert.equal(connection.credential_iv, null);
  assert.equal(connection.credential_auth_tag, null);
  assert.equal(store.runs.get('csr_pending').status, 'cancelled');

  await broker.getStatus(7);
  assert.equal(connection.generation, expiredGeneration + 1);
});

test('sync request expires stale credentials before creating or dispatching work', async () => {
  let enqueueCalls = 0;
  const { broker, clock, store } = createDirectBroker({
    syncDispatcher: {
      async enqueue() {
        enqueueCalls += 1;
      },
    },
  });
  await broker.connectDirect({
    userId: 7,
    username: '2026000000',
    password: 'one-time-password',
    fingerprint: FINGERPRINT,
  });
  const connection = store.connections.get('7:tsinghua-learn');
  const expiredGeneration = connection.generation;
  clock.value = new Date('2026-08-02T12:00:00.000Z');

  await assert.rejects(
    broker.requestSync(7),
    (error) => error.code === 'connector_authorization_required' && error.status === 409,
  );
  assert.equal(connection.status, 'reauthorization_required');
  assert.equal(connection.generation, expiredGeneration + 1);
  assert.equal(connection.credential_ciphertext, null);
  assert.equal(store.runs.size, 0);
  assert.equal(enqueueCalls, 0);
});

test('direct CAS rejects grants without a bounded server-side expiry', async (t) => {
  for (const expiresAt of [undefined, '2026-08-02T16:00:00.001Z']) {
    await t.test(String(expiresAt), async () => {
      const adapter = createAdapter({
        id: 'tsinghua_direct_cas',
        async authenticateDirect() {
          return {
            subject: '2026000000',
            opaqueGrant: JSON.stringify({
              version: 1,
              cookies: [{ name: 'SESSION', value: 'upstream-secret' }],
            }),
            scopes: ['courses'],
            expiresAt,
          };
        },
      });
      const { broker, store } = createDirectBroker({ adapter });

      await assert.rejects(
        broker.connectDirect({
          userId: 7,
          username: '2026000000',
          password: 'one-time-password',
          fingerprint: FINGERPRINT,
        }),
        (error) => error.code === 'direct_authorization_response_invalid' && error.status === 502,
      );
      assert.equal(store.connections.size, 0);
    });
  }
});
test('direct CAS mode rejects redirect start and sanitizes invalid credentials', async () => {
  const adapter = createAdapter({
    id: 'tsinghua_direct_cas',
    async authenticateDirect() {
      const error = new Error('sensitive upstream response');
      error.code = 'invalid_credentials';
      throw error;
    },
  });
  const { broker, store } = createDirectBroker({ adapter });

  await assert.rejects(
    broker.beginAuthorization({ userId: 7 }),
    (error) => error.code === 'connector_authorization_method_not_available',
  );
  await assert.rejects(
    broker.connectDirect({
      userId: 7,
      username: '2026000000',
      password: 'incorrect',
      fingerprint: FINGERPRINT,
    }),
    (error) =>
      error.code === 'invalid_credentials' &&
      error.status === 401 &&
      !error.message.includes('sensitive'),
  );
  assert.equal(store.connections.size, 0);
});
