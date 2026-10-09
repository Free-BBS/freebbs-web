const { isDeepStrictEqual } = require('node:util');
const { createHomeworkClient, fail } = require('./homework-client');
const { parseHomeworkArray, reconcileHomeworkCompletion } = require('./homework-state-sync');

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
    const connection = { ...(await store.getConnection(userId, 'tsinghua-learn')) };
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
    return { ...current, homework, userId, semesterId, snapshotFetchedAt: data.fetchedAt };
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
    const fresh = await refresh(ctx);
    const detail = await ctx.client.detail(fresh);
    await ctx.assertActive();
    await saveVerifiedStatus(ctx, fresh);
    return detail;
  }

  async function saveVerifiedStatus(ctx, fresh) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [connectors] = await connection.execute(
        `SELECT generation, status, adapter_id, adapter_version, credential_expires_at
         FROM user_campus_connectors
         WHERE user_id = ? AND provider = 'tsinghua-learn' FOR UPDATE`,
        [ctx.userId],
      );
      const current = connectors[0];
      if (
        !current ||
        !['active_verified', 'active_unverified'].includes(current.status) ||
        Number(current.generation) !== Number(ctx.connection.generation) ||
        current.adapter_id !== adapter.id ||
        current.adapter_version !== adapter.version ||
        (current.credential_expires_at && new Date(current.credential_expires_at) <= now())
      )
        fail('homework_connection_changed', '学堂连接已变更，请重新同步。', 409);
      const [rows] = await connection.execute(
        `SELECT homework_json, fetched_at FROM campus_homework_snapshots
         WHERE user_id = ? AND connector_generation = ? AND semester_id = ? FOR UPDATE`,
        [ctx.userId, ctx.connection.generation, ctx.semesterId],
      );
      const previous = parseHomeworkArray(rows[0]?.homework_json);
      if (new Date(rows[0]?.fetched_at).getTime() !== new Date(ctx.snapshotFetchedAt).getTime())
        fail('homework_snapshot_changed', '作业同步记录已更新，请重新查看。', 409);
      const old = previous.find((item) => item.sourceReference === fresh.sourceReference);
      if (!old) fail('homework_sync_required', '请先重新同步该学期以载入作业。', 409);
      if (!isDeepStrictEqual(old, ctx.homework))
        fail('homework_snapshot_changed', '作业状态已更新，请重新查看。', 409);
      // Store only the normalized list record, never answers or submitted body.
      const verifiedAt = now();
      const items = previous.map((item) =>
        item === old
          ? {
              ...fresh,
              title: item.title,
              homeworkStatusVerifiedAt: verifiedAt.toISOString(),
            }
          : item,
      );
      await connection.execute(
        `UPDATE campus_homework_snapshots SET homework_json = ?
         WHERE user_id = ? AND connector_generation = ? AND semester_id = ?`,
        [JSON.stringify(items), ctx.userId, ctx.connection.generation, ctx.semesterId],
      );
      await reconcileHomeworkCompletion(connection, ctx.userId, previous, [fresh], verifiedAt);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
