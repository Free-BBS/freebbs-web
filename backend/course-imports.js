const crypto = require('node:crypto');
const { DEFAULTS } = require('../public/academic-calendar');
const { projectCourseSchedules, validSemester } = require('./course-schedule');
const { normalizeHtmlText } = require('./tsinghua-learn-connector');

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}

function prepareCourseImport(row, semesterId) {
  const calendar = DEFAULTS[semesterId];
  if (!calendar) fail('该学期的统一校历尚未配置，请暂时手动添加课程。');
  if (!row || !(Number(row.connector_generation) > 0)) fail('请先连接清华账号并同步该学期课程。');
  if (row.sync_status !== 'complete')
    fail('本次同步尚不完整，请重新同步成功后再接入，原有安排保持不变。');
  const courses =
    typeof row.courses_json === 'string' ? JSON.parse(row.courses_json) : row.courses_json;
  if (!Array.isArray(courses) || !courses.length) fail('该学期尚无可接入课程，原有安排保持不变。');
  const fetchedAt = new Date(row.fetched_at).toISOString();
  const options = { holidayPreset: calendar.holidayPreset };
  const projection = projectCourseSchedules(courses, {
    semesterId,
    ...calendar,
    options,
    fetchedAt,
    includeExcluded: true,
  });
  const revision = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        semesterId,
        courses,
        Number(row.connector_generation),
        fetchedAt,
        calendar,
        projection.events,
        row.calendar_copy_json || null,
      ]),
    )
    .digest('hex');
  const copy = {
    courses,
    events: projection.events,
    generation: Number(row.connector_generation),
    fetchedAt,
    firstWeekMonday: calendar.firstWeekMonday,
    teachingWeeks: calendar.teachingWeeks,
    options,
  };
  return {
    copy,
    preview: {
      semesterId,
      revision,
      ...calendar,
      imported: Boolean(row.calendar_copy_json),
      courses: courses.map((course) => ({
        title: normalizeHtmlText(course.title, 200),
        schedule: normalizeHtmlText(course.scheduleText, 2000),
        location: normalizeHtmlText(course.locationText, 200),
      })),
      issues: projection.issues,
      scheduledLessons: projection.events.filter((item) => !item.calendarHoliday).length,
      skippedLessons: projection.skippedLessons,
    },
  };
}

async function sourceRow(pool, userId, semesterId, lock = false) {
  if (!validSemester(semesterId)) fail('学期标识无效', 400);
  const [rows] = await pool.execute(
    `SELECT s.courses_json, s.connector_generation, s.fetched_at,
       s.sync_status, s.calendar_copy_json
     FROM campus_learn_semester_snapshots s
     JOIN user_campus_connectors c ON c.user_id = s.user_id AND c.provider = 'tsinghua-learn'
       AND c.generation = s.connector_generation
       AND c.status IN ('active_verified', 'active_unverified')
     WHERE s.user_id = ? AND s.semester_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [userId, semesterId],
  );
  return rows[0];
}

async function previewCourseImport(pool, userId, semesterId) {
  return prepareCourseImport(await sourceRow(pool, userId, semesterId), semesterId).preview;
}

async function confirmCourseImport(pool, userId, { semesterId, revision } = {}) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
    fail('请先预览课程后再确认。', 400);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Same lock order as connector sync/revocation and personal course edits.
    await connection.execute(
      "SELECT id FROM user_campus_connectors WHERE user_id = ? AND provider = 'tsinghua-learn' FOR UPDATE",
      [userId],
    );
    const prepared = prepareCourseImport(
      await sourceRow(connection, userId, semesterId, true),
      semesterId,
    );
    if (prepared.preview.revision !== revision) fail('课程数据已变化，请重新预览并确认。');
    if (!prepared.preview.scheduledLessons) fail('没有可识别的课程安排，原有安排保持不变。');
    await connection.execute(
      'UPDATE campus_learn_semester_snapshots SET calendar_copy_json = ? WHERE user_id = ? AND semester_id = ?',
      [JSON.stringify(prepared.copy), userId, semesterId],
    );
    await connection.commit();
    return { imported: true, scheduledLessons: prepared.preview.scheduledLessons };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { prepareCourseImport, previewCourseImport, confirmCourseImport };
