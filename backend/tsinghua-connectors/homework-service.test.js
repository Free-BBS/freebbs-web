const assert = require('node:assert/strict');
const test = require('node:test');
const { createHomeworkService } = require('./homework-service');

function fixture({ upstreamStatus = 'submitted', beforePersist = () => {} } = {}) {
  const item = {
    sourceReference: 'learn:homework:one',
    courseReference: 'course',
    providerCourseId: 'course1',
    title: '作业',
    status: 'unsubmitted',
  };
  const connection = {
    status: 'active_verified',
    adapter_id: 'fixture',
    adapter_version: '1',
    generation: 3,
  };
  let initialized = false;
  const fetchedAt = new Date('2026-10-08T02:00:00Z');
  let items = [item];
  const writes = [];
  const transactions = { commits: 0, rollbacks: 0, releases: 0 };
  const pool = {
    async execute(sql, params) {
      assert.match(sql, /^SELECT homework_json/);
      assert.deepEqual(params, [7, 3, '2026-2027-1']);
      return [
        [{ homework_json: structuredClone(items), fetched_at: fetchedAt, sync_status: 'complete' }],
      ];
    },
    async getConnection() {
      await beforePersist(connection);
      return {
        beginTransaction: async () => {},
        commit: async () => {
          transactions.commits += 1;
        },
        rollback: async () => {
          transactions.rollbacks += 1;
        },
        release: () => {
          transactions.releases += 1;
        },
        async execute(sql, params) {
          if (sql.includes('FROM user_campus_connectors')) {
            assert.deepEqual(params, [7]);
            assert.match(sql, /FOR UPDATE/);
            return [[{ ...connection }]];
          }
          if (sql.startsWith('SELECT homework_json')) return pool.execute(sql, params);
          writes.push({ sql, params });
          if (sql.startsWith('UPDATE campus_homework_snapshots')) {
            assert.deepEqual(params.slice(1), [7, 3, '2026-2027-1']);
            items = JSON.parse(params[0]);
          }
          return [{ affectedRows: 1 }];
        },
      };
    },
  };
  const service = createHomeworkService({
    pool,
    store: { getConnection: async () => connection },
    vault: { decrypt: () => 'grant' },
    adapter: { id: 'fixture', version: '1', createHomeworkFetch: () => async () => {} },
    clientFactory: ({ assertActive }) => ({
      initialize: async () => {
        initialized = true;
        await assertActive();
      },
      list: async () => {
        assert.ok(initialized);
        return [
          {
            ...item,
            status: typeof upstreamStatus === 'function' ? await upstreamStatus() : upstreamStatus,
            submittedFileId: 'file',
          },
        ];
      },
      detail: async (fresh) => ({
        ...fresh,
        submittedContent: '已交正文',
        attachments: [{ id: 'own', name: '题目.pdf' }],
      }),
      download: async () => new Response('PDF'),
    }),
  });
  return { service, connection, writes, transactions };
}
test('read-only service preserves snapshots, live status, submitted content and downloads', async () => {
  const { service, writes } = fixture();
  assert.deepEqual(Object.keys(service).sort(), ['download', 'getDetail', 'list']);
  const args = [7, '2026-2027-1', 'learn:homework:one'];
  assert.equal((await service.list(...args)).items.length, 1);
  const detail = await service.getDetail(...args);
  assert.equal(detail.status, 'submitted');
  assert.equal(detail.submittedContent, '已交正文');
  const saved = (await service.list(7, '2026-2027-1')).items[0];
  assert.equal(saved.status, 'submitted');
  assert.equal(saved.submittedContent, undefined);
  assert.equal(saved.attachments, undefined);
  assert.ok(writes.some(({ sql }) => sql.startsWith('UPDATE important_items')));
  assert.equal(await (await service.download(...args, 'own')).response.text(), 'PDF');
  await assert.rejects(service.download(...args, 'foreign'), {
    code: 'homework_attachment_not_found',
  });
  await assert.rejects(service.getDetail(7, '2026-2027-1', 'foreign'), {
    code: 'homework_not_found',
  });
});

test('failed/unsubmitted attempts with an attachment never complete the calendar or important item', async () => {
  const { service, writes } = fixture({ upstreamStatus: 'unsubmitted' });
  await service.getDetail(7, '2026-2027-1', 'learn:homework:one');
  assert.equal((await service.list(7, '2026-2027-1')).items[0].status, 'unsubmitted');
  assert.equal(
    writes.some(({ sql }) => /important_items|calendar_states/.test(sql)),
    false,
  );
});

test('reconnection or revocation between the upstream read and commit cannot persist old private state', async () => {
  for (const mutate of [
    (connection) => {
      Object.assign(connection, { generation: 4 });
    },
    (connection) => {
      Object.assign(connection, { status: 'revoked' });
    },
    (connection) => {
      Object.assign(connection, { credential_expires_at: new Date('2000-01-01') });
    },
  ]) {
    const { service, writes, transactions } = fixture({ beforePersist: mutate });
    await assert.rejects(service.getDetail(7, '2026-2027-1', 'learn:homework:one'), {
      code: 'homework_connection_changed',
    });
    assert.deepEqual(writes, []);
    assert.deepEqual(transactions, { commits: 0, rollbacks: 1, releases: 1 });
  }
});

test('a slower old detail cannot overwrite a submitted record saved by another detail request', async () => {
  let releaseOld;
  let oldStarted;
  const oldResponse = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const started = new Promise((resolve) => {
    oldStarted = resolve;
  });
  let calls = 0;
  const { service } = fixture({
    upstreamStatus: async () => {
      calls += 1;
      if (calls === 1) {
        oldStarted();
        return oldResponse;
      }
      return 'submitted';
    },
  });
  const args = [7, '2026-2027-1', 'learn:homework:one'];
  const old = service.getDetail(...args);
  await started;
  await service.getDetail(...args);
  const rejection = assert.rejects(old, { code: 'homework_snapshot_changed' });
  releaseOld('unsubmitted');
  await rejection;
  assert.equal((await service.list(7, '2026-2027-1')).items[0].status, 'submitted');
});
test('revoked and expired connections cannot read private homework', async () => {
  const { service, connection } = fixture();
  connection.status = 'revoked';
  await assert.rejects(service.list(7, '2026-2027-1'), { code: 'homework_authorization_required' });
  connection.status = 'active_verified';
  connection.credential_expires_at = '2000-01-01';
  await assert.rejects(service.list(7, '2026-2027-1'), { code: 'homework_authorization_required' });
});
