const crypto = require('node:crypto');
const { listCourseSchedules } = require('./course-schedule');

// Manual/audited courses are ordinary owned schedule rows, independent of campus grants.
// One rule represents one weekly time/location; a second rule can cover another weekday.
function expandManualCourse(body = {}) {
  const fail = () => {
    throw Object.assign(
      new Error('请填写课程名、首次上课时间和结束时间，以及 1–32 次、每周或隔周的重复安排'),
      { status: 400 },
    );
  };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const start = new Date(body.startAt);
  const end = new Date(body.endAt);
  const count = body.count;
  const interval = body.intervalWeeks;
  const dayKey = (date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (
    !title ||
    title.length > 200 ||
    description.length > 4000 ||
    (body.description != null && typeof body.description !== 'string') ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start ||
    end - start > 24 * 3600000 ||
    start.getUTCFullYear() < 2000 ||
    end.getUTCFullYear() > 2200 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 32 ||
    ![1, 2].includes(interval)
  )
    fail();
  if (dayKey(start) !== dayKey(end)) fail();
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([title, description, start.toISOString(), end.toISOString(), count, interval]),
    )
    .digest('hex')
    .slice(0, 32);
  return Array.from({ length: count }, (_, index) => ({
    title,
    description,
    kind: 'course',
    sourceType: 'manual',
    sourceReference: `manual:course:${hash}`,
    dedupeKey: `manual:course:${hash}:${index}`,
    startAt: new Date(start.getTime() + index * interval * 7 * 86400000).toISOString(),
    endAt: new Date(end.getTime() + index * interval * 7 * 86400000).toISOString(),
    timezone: 'Asia/Shanghai',
    allDay: false,
  }));
}

async function saveManualCourse(pool, userId, body) {
  const items = expandManualCourse(body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [existing] = await connection.execute(
      'SELECT public_id FROM schedule_items WHERE user_id = ? AND source_reference = ? AND deleted_at IS NULL',
      [userId, items[0].sourceReference],
    );
    if (existing.length) {
      throw Object.assign(new Error('这组课程已经添加，请在计划表中编辑，不要重复生成'), {
        status: 409,
      });
    }
    if (body.allowConflicts !== true) {
      const start = new Date(items[0].startAt);
      const end = new Date(items.at(-1).endAt);
      const [rows] = await connection.execute(
        `SELECT title, start_at, end_at FROM schedule_items
         WHERE user_id = ? AND deleted_at IS NULL AND status IN ('draft', 'confirmed')
           AND (source_reference IS NULL OR source_reference NOT IN ('planner:deadline', 'manual:deadline'))
           AND start_at < ? AND end_at > ? LIMIT 2001`,
        [userId, end, start],
      );
      const courses = await listCourseSchedules(connection, userId, { start, end });
      const conflicts = [...rows, ...courses].filter((other) =>
        items.some(
          (item) =>
            new Date(item.startAt) < new Date(other.endAt || other.end_at) &&
            new Date(item.endAt) > new Date(other.startAt || other.start_at),
        ),
      );
      if (conflicts.length || rows.length > 2000) {
        throw Object.assign(
          new Error('重复课程与已有安排重叠，请核对课程日期和时间；确认仍要加入时再次保存'),
          {
            status: 409,
            code: 'course_conflict',
          },
        );
      }
    }
    for (const item of items) {
      await connection.execute(
        `INSERT INTO schedule_items (
          public_id, user_id, created_by_user_id, source_type, source_reference, dedupe_key,
          title, description, start_at, end_at, all_day, timezone, status, user_confirmed_at
        ) VALUES (?, ?, ?, 'manual', ?, ?, ?, NULLIF(?, ''), ?, ?, 0, 'Asia/Shanghai', 'confirmed', CURRENT_TIMESTAMP)`,
        [
          `ws_${crypto.randomBytes(12).toString('hex')}`,
          userId,
          userId,
          item.sourceReference,
          item.dedupeKey,
          item.title,
          item.description,
          new Date(item.startAt),
          new Date(item.endAt),
        ],
      );
    }
    await connection.commit();
    return { created: items.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('这组课程已存在，请检查计划表'), { status: 409 });
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { expandManualCourse, saveManualCourse };
