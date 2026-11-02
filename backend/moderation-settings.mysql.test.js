const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { createModerationSettingsStore } = require('./moderation-settings');
const { createSystemSettingsStore, ensureSystemSecretSettingsTable } = require('./system-settings');

test(
  'isolated MySQL: moderation settings isolate MAX and preserve atomic credential snapshots',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    await assertIsolatedMysql(admin);
    const database = `moderation_settings_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_settings_test_[a-f0-9]{32}$/u);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 10 });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP DATABASE ${database}`);
      await admin.end();
    });
    await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users (id) VALUES (1)');
    await pool.query(`CREATE TABLE app_settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await ensureSystemSecretSettingsTable(pool);
    const encryptionKey = Buffer.alloc(32, 45);
    const max = createSystemSettingsStore({ pool, encryptionKey });
    await max.updateModelSettings({
      actorId: 1,
      baseUrl: 'https://max.example.com/v1',
      model: 'max-original',
      apiKey: 'max-original-key',
    });
    const beforeMax = await max.readSettings({ includeSecret: true });
    const store = createModerationSettingsStore({ pool, encryptionKey });

    await t.test('fresh store does not read MAX values; metadata never exposes a key', async () => {
      const fresh = await store.readSettings({ includeSecret: true });
      assert.equal(fresh.configured, false);
      assert.equal(fresh.apiKey, '');
      assert.notEqual(fresh.baseUrl, beforeMax.baseUrl);
      const saved = await store.updateSettings({
        actorId: 1,
        baseUrl: 'https://moderation.example.com/v1',
        apiKey: 'moderation-key-0',
        textModel: 'text-0',
        imageModel: 'image-0',
      });
      assert.equal(saved.revision, 1);
      assert.equal(Object.hasOwn(saved, 'apiKey'), false);
      assert.equal((await store.readSettings({ includeSecret: true })).apiKey, 'moderation-key-0');
    });

    await t.test('foreign-key failures roll back model, endpoint and revision writes', async () => {
      const before = await store.readSettings({ includeSecret: true });
      await assert.rejects(
        store.updateSettings({
          actorId: 999,
          baseUrl: 'https://rejected.example.com/v1',
          textModel: 'rejected-model',
          apiKey: 'rejected-key',
        }),
        (error) => error.code === 'ER_NO_REFERENCED_ROW_2',
      );
      assert.deepEqual(await store.readSettings({ includeSecret: true }), before);
    });

    await t.test(
      'concurrent saves serialize and readers never mix model/key revisions',
      async () => {
        const before = await store.readSettings();
        let completed = false;
        const readers = (async () => {
          while (!completed) {
            const snapshot = await store.readSettings({ includeSecret: true });
            const suffix = snapshot.textModel.replace(/^text-/u, '');
            assert.equal(snapshot.imageModel, `image-${suffix}`);
            assert.equal(snapshot.apiKey, `moderation-key-${suffix}`);
          }
        })();
        try {
          const writes = await Promise.allSettled(
            Array.from({ length: 12 }, (_, index) =>
              store.updateSettings({
                actorId: 1,
                textModel: `text-${index + 1}`,
                imageModel: `image-${index + 1}`,
                apiKey: `moderation-key-${index + 1}`,
              }),
            ),
          );
          for (const outcome of writes) {
            if (outcome.status === 'rejected') throw outcome.reason;
          }
        } finally {
          completed = true;
          await readers;
        }
        assert.equal((await store.readSettings()).revision, before.revision + 12);
      },
    );

    await t.test(
      'endpoint changes require a replacement key and deletion keeps MAX unchanged',
      async () => {
        await assert.rejects(
          store.updateSettings({ baseUrl: 'https://another.example.com/v1' }),
          (error) => error.code === 'MODERATION_NEW_ENDPOINT_REQUIRES_KEY',
        );
        await store.deleteApiKey();
        assert.equal((await store.readSettings({ includeSecret: true })).apiKey, '');
        assert.deepEqual(await max.readSettings({ includeSecret: true }), beforeMax);
        const [[row]] = await pool.execute(
          'SELECT COUNT(*) AS total FROM system_secret_settings WHERE setting_key = ?',
          ['moderation_api_key'],
        );
        assert.equal(Number(row.total), 0);
      },
    );
  },
);
