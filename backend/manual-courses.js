const crypto = require('node:crypto');
const { listCourseSchedules } = require('./course-schedule');
const { expand } = require('../public/schedule-recurrence');
const { definitionFor, writeDefinition } = require('./schedule-series');

// Manual/audited courses are ordinary owned schedule rows, independent of campus grants.
// One rule represents one weekly time/location; a second rule can cover another weekday.
function expandManualCourse(body = {}, { kind = 'course' } = {}) {
  const fail = () => {
    throw Object.assign(
      new Error(
        body?.recurrence
          ? '请填写有效的安排名称和起止时间，每次安排不超过 24 小时；课程须在同一天内结束'
          : '请填写课程名、首次上课时间和结束时间，以及 1–32 次、每周或隔周的重复安排',
      ),
      { status: 400 },
    );
  };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const start = new Date(body.startAt);
  const end = new Date(body.endAt);
  const dates = body.recurrence ? expand(body) : null;
  const count = dates ? dates.length : body.count;
  const interval = dates
    ? body.recurrence.interval * (body.recurrence.unit === 'week' ? 1 : 1 / 7)
    : body.intervalWeeks;
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
    count > (dates ? 200 : 32) ||
    (!dates && ![1, 2].includes(interval)) ||
    !['event', 'course'].includes(kind) ||
    (body.allDay != null && typeof body.allDay !== 'boolean')
  )
    fail();
  if (kind === 'course' && dayKey(start) !== dayKey(end)) fail();
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        title,
        description,
        start.toISOString(),
        end.toISOString(),
        count,
        interval,
        ...(body.allDay ? [true] : []),
      ]),
    )
    .digest('hex')
    .slice(0, 32);
  return Array.from({ length: count }, (_, index) => ({
    title,
    description,
    kind,
    sourceType: 'manual',
    sourceReference: `manual:${kind === 'course' ? 'course' : 'recurring'}:${hash}`,
    dedupeKey: `manual:${kind === 'course' ? 'course' : 'recurring'}:${hash}:${index}`,
    startAt:
      dates?.[index].startAt ||
      new Date(start.getTime() + index * interval * 7 * 86400000).toISOString(),
    endAt:
      dates?.[index].endAt ||
      new Date(end.getTime() + index * interval * 7 * 86400000).toISOString(),
    timezone: 'Asia/Shanghai',
    allDay: kind === 'event' && body.allDay === true,
  }));
}

async function saveManualCourse(pool, userId, body, options) {
  const items = expandManualCourse(body, options).map((item) => ({
    ...item,
    publicId: `ws_${crypto.randomBytes(12).toString('hex')}`,
  }));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [existing] = await connection.execute(
      'SELECT public_id FROM schedule_items WHERE user_id = ? AND source_reference = ? AND deleted_at IS NULL',
      [userId, items[0].sourceReference],
    );
    if (existing.length) {
      throw Object.assign(new Error('这组安排已经添加，请在计划表中编辑，不要重复生成'), {
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
          new Error('重复安排与已有日程重叠，请核对日期和时间；确认仍要加入时再次保存'),
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
        ) VALUES (?, ?, ?, 'manual', ?, ?, ?, NULLIF(?, ''), ?, ?, ?, 'Asia/Shanghai', 'confirmed', CURRENT_TIMESTAMP)`,
        [
          item.publicId,
          userId,
          userId,
          item.sourceReference,
          item.dedupeKey,
          item.title,
          item.description,
          new Date(item.startAt),
          new Date(item.endAt),
          item.allDay ? 1 : 0,
        ],
      );
    }
    const recurrence = body.recurrence || {
      unit: 'week',
      interval: body.intervalWeeks,
      count: body.count,
    };
    await writeDefinition(
      connection,
      userId,
      items[0].sourceReference,
      definitionFor(items, recurrence),
    );
    await connection.commit();
    return { created: items.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('这组安排已存在，请检查计划表'), { status: 409 });
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { expandManualCourse, saveManualCourse };
