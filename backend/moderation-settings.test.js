const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SETTING_KEYS,
  DEFAULT_BASE_URL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_MODEL,
  createModerationSettingsStore,
  isPublicAddress,
  normalizeModerationBaseUrl,
  normalizeModerationModel,
  toPublicModerationSettings,
} = require('./moderation-settings');
const { encryptSecret, decryptSecret } = require('./system-settings');

const ENCRYPTION_KEY = Buffer.alloc(32, 19);

function fixture() {
  const state = {
    settings: new Map([
      [
        'llm_base_url',
        { setting_key: 'llm_base_url', setting_value: 'https://max.example.com/v1' },
      ],
      ['llm_model', { setting_key: 'llm_model', setting_value: 'max-original' }],
      [
        'system_settings_revision',
        { setting_key: 'system_settings_revision', setting_value: '20' },
      ],
    ]),
    secrets: new Map([
      [
        'llm_api_key',
        {
          ...encryptSecret('max-private-credential', ENCRYPTION_KEY, 'llm_api_key'),
          last_four: 'tial',
        },
      ],
    ]),
    queries: [],
    failSecretWrite: false,
    released: 0,
  };
  const pool = {
    async getConnection() {
      let before;
      return {
        async query(sql) {
          state.queries.push(sql);
          assert.equal(sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        },
        async beginTransaction() {
          before = { settings: new Map(state.settings), secrets: new Map(state.secrets) };
        },
        async commit() {
          before = null;
        },
        async rollback() {
          if (before) {
            state.settings = before.settings;
            state.secrets = before.secrets;
            before = null;
          }
        },
        release() {
          state.released += 1;
        },
        async execute(rawSql, parameters) {
          const sql = rawSql.replace(/\s+/g, ' ').trim();
          state.queries.push({ sql, parameters });
          if (sql.startsWith('SELECT setting_key')) {
            return [
              [...state.settings.values()].filter((row) => parameters.includes(row.setting_key)),
            ];
          }
          if (sql.startsWith('SELECT ciphertext')) {
            const row = state.secrets.get(parameters[0]);
            return [row ? [row] : []];
          }
          if (sql.startsWith('INSERT INTO app_settings') && sql.includes("VALUES (?, '0')")) {
            if (!state.settings.has(parameters[0])) {
              state.settings.set(parameters[0], { setting_key: parameters[0], setting_value: '0' });
            }
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('SELECT setting_value')) {
            const row = state.settings.get(parameters[0]);
            return [row ? [row] : []];
          }
          if (sql.startsWith('UPDATE app_settings')) {
            const row = state.settings.get(parameters[0]);
            state.settings.set(parameters[0], {
              ...row,
              setting_value: String(Number(row.setting_value) + 1),
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('INSERT INTO app_settings')) {
            state.settings.set(parameters[0], {
              setting_key: parameters[0],
              setting_value: parameters[1],
              updated_at: '2026-11-02T10:00:00Z',
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('INSERT INTO system_secret_settings')) {
            if (state.failSecretWrite) throw new Error('injected storage failure');
            state.secrets.set(parameters[0], {
              ciphertext: parameters[1],
              iv: parameters[2],
              auth_tag: parameters[3],
              last_four: parameters[4],
              updated_by: parameters[5],
              updated_at: '2026-11-02T10:00:00Z',
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('DELETE FROM system_secret_settings')) {
            return [{ affectedRows: Number(state.secrets.delete(parameters[0])) }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  return {
    state,
    pool,
    store: createModerationSettingsStore({ pool, encryptionKey: ENCRYPTION_KEY }),
  };
}

test('starts with independent defaults and never falls back to the MAX credential', async () => {
  const { store } = fixture();
  assert.deepEqual(await store.readSettings({ includeSecret: true }), {
    baseUrl: DEFAULT_BASE_URL,
    textModel: DEFAULT_TEXT_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    configured: false,
    lastFour: '',
    revision: 0,
    updatedAt: null,
    apiKey: '',
  });
});

test('writes an authenticated independent credential and updates all settings atomically', async () => {
  const { store, state } = fixture();
  const originalMax = state.secrets.get('llm_api_key');
  const result = await store.updateSettings({
    actorId: 7,
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'moderation-secret-1234',
    textModel: 'provider/text-model',
    imageModel: 'provider/image-model',
  });
  assert.equal(result.baseUrl, 'https://api.example.com/v1');
  assert.equal(result.textModel, 'provider/text-model');
  assert.equal(result.imageModel, 'provider/image-model');
  assert.equal(result.configured, true);
  assert.equal(result.lastFour, '1234');
  assert.equal(result.revision, 1);
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(
    (await store.readSettings({ includeSecret: true })).apiKey,
    'moderation-secret-1234',
  );
  const encrypted = state.secrets.get(SETTING_KEYS.apiKey);
  assert.equal(encrypted.updated_by, 7);
  assert.notEqual(encrypted.ciphertext.toString('utf8'), 'moderation-secret-1234');
  assert.throws(() => decryptSecret(encrypted, ENCRYPTION_KEY, 'llm_api_key'), /无法解密/u);
  assert.equal(state.secrets.get('llm_api_key'), originalMax);
  assert.equal(state.settings.get('llm_base_url').setting_value, 'https://max.example.com/v1');
  assert.equal(state.settings.get('llm_model').setting_value, 'max-original');
  assert.equal(state.settings.get('system_settings_revision').setting_value, '20');
  assert.ok(state.queries.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
});

test('changing a model keeps the key, changing the endpoint requires a new key', async () => {
  const { store } = fixture();
  await store.updateSettings({ actorId: 1, apiKey: 'moderation-secret-old' });
  await store.updateSettings({ textModel: 'new-model' });
  assert.equal((await store.readSettings({ includeSecret: true })).apiKey, 'moderation-secret-old');
  await assert.rejects(
    store.updateSettings({ baseUrl: 'https://new-provider.example.com/v1' }),
    (error) => error.code === 'MODERATION_NEW_ENDPOINT_REQUIRES_KEY',
  );
  const unchanged = await store.readSettings({ includeSecret: true });
  assert.equal(unchanged.baseUrl, DEFAULT_BASE_URL);
  assert.equal(unchanged.apiKey, 'moderation-secret-old');
  assert.equal(unchanged.revision, 2);
  await store.updateSettings({ baseUrl: `${DEFAULT_BASE_URL}/` });
  await store.updateSettings({
    actorId: 1,
    baseUrl: 'https://new-provider.example.com/v1',
    apiKey: 'moderation-secret-new',
  });
  const replaced = await store.readSettings({ includeSecret: true });
  assert.equal(replaced.baseUrl, 'https://new-provider.example.com/v1');
  assert.equal(replaced.apiKey, 'moderation-secret-new');
});

test('deleting the moderation key leaves MAX and moderation models untouched', async () => {
  const { store, state } = fixture();
  await store.updateSettings({ apiKey: 'moderation-secret-delete', textModel: 'keep-model' });
  assert.equal((await store.deleteApiKey()).configured, false);
  const settings = await store.readSettings({ includeSecret: true });
  assert.equal(settings.apiKey, '');
  assert.equal(settings.textModel, 'keep-model');
  assert.equal(settings.revision, 2);
  assert.ok(state.secrets.has('llm_api_key'));
  assert.equal((await store.deleteApiKey()).revision, 2);
});

test('failed writes roll back address, model, credential and revision together', async () => {
  const { store, state } = fixture();
  await store.updateSettings({ apiKey: 'original-moderation-key' });
  state.failSecretWrite = true;
  await assert.rejects(
    store.updateSettings({
      baseUrl: 'https://new.example.com/v1',
      textModel: 'new-text',
      imageModel: 'new-image',
      apiKey: 'replacement-key',
    }),
    /injected storage failure/u,
  );
  const settings = await store.readSettings({ includeSecret: true });
  assert.equal(settings.baseUrl, DEFAULT_BASE_URL);
  assert.equal(settings.textModel, DEFAULT_TEXT_MODEL);
  assert.equal(settings.imageModel, DEFAULT_IMAGE_MODEL);
  assert.equal(settings.apiKey, 'original-moderation-key');
  assert.equal(settings.revision, 1);
});

test('public reads and projections never decrypt or expose the credential', async () => {
  const { store, pool } = fixture();
  await store.updateSettings({ apiKey: 'private-moderation-key' });
  const unreadableStore = createModerationSettingsStore({ pool, encryptionKey: 'invalid' });
  const publicRead = await unreadableStore.readSettings();
  assert.equal(publicRead.configured, true);
  assert.equal(Object.hasOwn(publicRead, 'apiKey'), false);
  await assert.rejects(unreadableStore.readSettings({ includeSecret: true }));
  const publicProjection = toPublicModerationSettings({
    ...publicRead,
    apiKey: 'private-moderation-key',
    ciphertext: 'hidden',
  });
  assert.equal(Object.hasOwn(publicProjection, 'apiKey'), false);
  assert.equal(Object.hasOwn(publicProjection, 'ciphertext'), false);
  assert.equal(JSON.stringify(publicProjection).includes('private-moderation-key'), false);
});

test('rejects malformed keys and models before writing settings', async () => {
  const { store, state } = fixture();
  for (const apiKey of ['', 'a b', 'one\ntwo']) {
    await assert.rejects(store.updateSettings({ apiKey }));
  }
  for (const textModel of ['', 'with spaces', '../bad model', 'x'.repeat(129), null]) {
    await assert.rejects(store.updateSettings({ textModel }));
  }
  await assert.rejects(store.updateSettings({}));
  assert.equal(state.queries.length, 0);
  assert.equal(normalizeModerationModel(' provider/model:1.0 '), 'provider/model:1.0');
});

test('accepts normalized public HTTPS base URLs including provider prefixes', () => {
  assert.equal(
    normalizeModerationBaseUrl(' https://API.EXAMPLE.COM/compatible-mode/v1/ '),
    'https://api.example.com/compatible-mode/v1',
  );
  assert.equal(normalizeModerationBaseUrl('https://8.8.8.8/v1'), 'https://8.8.8.8/v1');
  assert.equal(
    normalizeModerationBaseUrl('https://[2606:4700:4700::1111]/v1'),
    'https://[2606:4700:4700::1111]/v1',
  );
});

test('blocks credentials, queries, fragments and local/private literal URL variants', () => {
  const urls = [
    'http://api.example.com/v1',
    'https://user:pass@api.example.com/v1',
    'https://api.example.com/v1?key=x',
    'https://api.example.com/v1?',
    'https://api.example.com/v1#key',
    'https://api.example.com/v1#',
    'https://localhost/v1',
    'https://localhost./v1',
    'https://api.localhost/v1',
    'https://host.internal/v1',
    'https://host.local/v1',
    'https://server/v1',
    'https://home.arpa/v1',
    'https://router.home.arpa/v1',
    'https://127.0.0.1/v1',
    'https://127.1/v1',
    'https://2130706433/v1',
    'https://0x7f000001/v1',
    'https://0177.0.0.1/v1',
    'https://10.1.2.3/v1',
    'https://169.254.169.254/v1',
    'https://192.168.1.1/v1',
    'https://172.31.255.1/v1',
    'https://100.64.0.1/v1',
    'https://0.0.0.0/v1',
    'https://224.0.0.1/v1',
    'https://255.255.255.255/v1',
    'https://[::1]/v1',
    'https://[::]/v1',
    'https://[fe80::1]/v1',
    'https://[fc00::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[64:ff9b::7f00:1]/v1',
    'https://[2002:7f00:1::]/v1',
    'https://[2001:db8::1]/v1',
    'https://[3fff::1]/v1',
  ];
  for (const url of urls)
    assert.throws(
      () => normalizeModerationBaseUrl(url),
      { code: 'MODERATION_BASE_URL_INVALID' },
      url,
    );
});

test('public-address validation fails closed for mapped, reserved and invalid addresses', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true, address);
  for (const address of [
    null,
    'example.com',
    '127.0.0.1',
    '198.18.0.1',
    '192.0.2.1',
    '203.0.113.1',
    '::ffff:8.8.8.8',
    '::ffff:10.0.0.1',
    '2001::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicAddress(address), false, String(address));
  }
});
