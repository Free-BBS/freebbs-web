const assert = require('node:assert/strict');
const test = require('node:test');
const { createHomeworkService } = require('./homework-service');

function fixture() {
  const item = {
    sourceReference: 'learn:homework:one',
    courseReference: 'course',
    providerCourseId: 'course1',
    title: '作业',
  };
  const connection = {
    status: 'active_verified',
    adapter_id: 'fixture',
    adapter_version: '1',
    generation: 3,
  };
  let initialized = false;
  const service = createHomeworkService({
    pool: {
      async execute(sql, params) {
        assert.match(sql, /^SELECT homework_json/);
        assert.deepEqual(params, [7, 3, '2026-2027-1']);
        return [[{ homework_json: [item], fetched_at: new Date(), sync_status: 'complete' }]];
      },
    },
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
        return [{ ...item, status: 'submitted' }];
      },
      detail: async (fresh) => ({
        ...fresh,
        submittedContent: '已交正文',
        attachments: [{ id: 'own', name: '题目.pdf' }],
      }),
      download: async () => new Response('PDF'),
    }),
  });
  return { service, connection };
}
test('read-only service preserves snapshots, live status, submitted content and downloads', async () => {
  const { service } = fixture();
  assert.deepEqual(Object.keys(service).sort(), ['download', 'getDetail', 'list']);
  const args = [7, '2026-2027-1', 'learn:homework:one'];
  assert.equal((await service.list(...args)).items.length, 1);
  const detail = await service.getDetail(...args);
  assert.equal(detail.status, 'submitted');
  assert.equal(detail.submittedContent, '已交正文');
  assert.equal(await (await service.download(...args, 'own')).response.text(), 'PDF');
  await assert.rejects(service.download(...args, 'foreign'), {
    code: 'homework_attachment_not_found',
  });
  await assert.rejects(service.getDetail(7, '2026-2027-1', 'foreign'), {
    code: 'homework_not_found',
  });
});
test('revoked and expired connections cannot read private homework', async () => {
  const { service, connection } = fixture();
  connection.status = 'revoked';
  await assert.rejects(service.list(7, '2026-2027-1'), { code: 'homework_authorization_required' });
  connection.status = 'active_verified';
  connection.credential_expires_at = '2000-01-01';
  await assert.rejects(service.list(7, '2026-2027-1'), { code: 'homework_authorization_required' });
});
