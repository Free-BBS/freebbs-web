const { createHomeworkClient, fail } = require('./homework-client');

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createHomeworkService({
  pool,
  store,
  vault,
  adapter,
  now = () => new Date(),
  clientFactory = createHomeworkClient,
}) {
  async function session(userId) {
    if (!vault || !adapter?.createHomeworkFetch)
      fail('homework_unavailable', '请先配置并连接网络学堂。', 503);
    const connection = await store.getConnection(userId, 'tsinghua-learn');
    function check(row) {
      if (
        !row ||
        !['active_verified', 'active_unverified'].includes(row.status) ||
        row.adapter_id !== adapter.id ||
        row.adapter_version !== adapter.version ||
        (row.credential_expires_at && new Date(row.credential_expires_at) <= now())
      ) {
        fail('homework_authorization_required', '请重新连接网络学堂。', 409);
      }
    }
    check(connection);
    async function assertActive() {
      const current = await store.getConnection(userId, 'tsinghua-learn');
      check(current);
      if (Number(current.generation) !== Number(connection.generation)) {
        fail('homework_connection_changed', '学堂连接已变更，请重新同步。', 409);
      }
    }
    let grant;
    try {
      grant = vault.decrypt(
        {
          ciphertext: connection.credential_ciphertext,
          iv: connection.credential_iv,
          authTag: connection.credential_auth_tag,
        },
        { userId, connectorId: 'tsinghua-learn', adapterVersion: connection.adapter_version },
      );
    } catch {
      fail('homework_authorization_required', '请重新连接网络学堂。', 409);
    }
    const client = clientFactory({
      authorizedFetch: adapter.createHomeworkFetch(grant),
      assertActive,
    });
    return { connection, client, assertActive };
  }
  async function snapshot(userId, generation, semesterId) {
    const [rows] = await pool.execute(
      `SELECT homework_json, fetched_at, sync_status FROM campus_homework_snapshots
      WHERE user_id = ? AND connector_generation = ? AND semester_id = ?`,
      [userId, generation, semesterId],
    );
    if (!rows.length) fail('homework_sync_required', '请先重新同步该学期以载入作业。', 409);
    return {
      items: parseArray(rows[0].homework_json),
      fetchedAt: rows[0].fetched_at,
      syncStatus: rows[0].sync_status,
    };
  }
  async function context(userId, semesterId, reference) {
    const current = await session(userId);
    const data = await snapshot(userId, current.connection.generation, semesterId);
    const homework = data.items.find((item) => item.sourceReference === reference);
    if (!homework) fail('homework_not_found', '没有找到该作业，请重新同步。', 404);
    return { ...current, homework };
  }
  async function refresh(ctx) {
    const course = {
      providerCourseId: ctx.homework.providerCourseId,
      sourceReference: ctx.homework.courseReference,
      title: '',
    };
    const items = await ctx.client.list(course);
    const fresh = items.find((item) => item.sourceReference === ctx.homework.sourceReference);
    if (!fresh) fail('homework_not_found', '学堂中已找不到该作业，请重新同步。', 404);
    return { ...fresh, title: ctx.homework.title };
  }
  async function list(userId, semesterId) {
    const ctx = await session(userId);
    const result = await snapshot(userId, ctx.connection.generation, semesterId);
    await ctx.assertActive();
    return result;
  }
  async function getDetail(userId, semesterId, reference) {
    const ctx = await context(userId, semesterId, reference);
    await ctx.client.initialize();
    const detail = await ctx.client.detail(await refresh(ctx));
    await ctx.assertActive();
    return detail;
  }

  async function download(userId, semesterId, reference, attachmentId) {
    const ctx = await context(userId, semesterId, reference);
    await ctx.client.initialize();
    const fresh = await refresh(ctx);
    const detail = await ctx.client.detail(fresh);
    const attachment = detail.attachments.find((item) => item.id === attachmentId);
    if (!attachment) fail('homework_attachment_not_found', '该附件不属于当前作业。', 404);
    const response = await ctx.client.download(fresh, attachmentId);
    await ctx.assertActive();
    return { response, attachment };
  }
  return { list, getDetail, download };
}

module.exports = { createHomeworkService };
