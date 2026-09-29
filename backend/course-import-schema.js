// A confirmed workbench copy is independent of the connector's mutable snapshot.
// Backfill ONLY during the additive migration, never during a normal sync/boot.
const BACKFILL_COURSE_COPIES = `UPDATE campus_learn_semester_snapshots s
  LEFT JOIN campus_course_calendar_settings settings
    ON settings.user_id = s.user_id AND settings.semester_id = s.semester_id
    AND settings.connector_generation > 0
  SET s.calendar_copy_json = JSON_OBJECT(
    'courses', s.courses_json, 'generation', s.connector_generation,
    'fetchedAt', DATE_FORMAT(s.fetched_at, '%Y-%m-%dT%H:%i:%s.000Z'),
    'firstWeekMonday', COALESCE(DATE_FORMAT(settings.first_week_monday, '%Y-%m-%d'),
      IF(s.semester_id = '2026-2027-1', '2026-09-14', NULL)),
    'teachingWeeks', COALESCE(settings.teaching_weeks,
      IF(s.semester_id = '2026-2027-1', 16, NULL)),
    'options', COALESCE(settings.options_json,
      IF(s.semester_id = '2026-2027-1' AND
        (settings.first_week_monday IS NULL OR settings.first_week_monday = '2026-09-14'),
        JSON_OBJECT('holidayPreset', 'tsinghua-2026-autumn'), JSON_OBJECT()))
  )
  WHERE s.calendar_copy_json IS NULL AND s.connector_generation > 0`;

async function ensureCourseCopies(pool) {
  const [rows] = await pool.execute(
    `SELECT 1 AS present FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    ['campus_learn_semester_snapshots', 'calendar_copy_json'],
  );
  if (rows.length) return;
  try {
    await pool.execute(
      'ALTER TABLE campus_learn_semester_snapshots ADD COLUMN calendar_copy_json JSON NULL',
    );
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') return;
    throw error;
  }
  await pool.execute(BACKFILL_COURSE_COPIES);
}

module.exports = { ensureCourseCopies, BACKFILL_COURSE_COPIES };
