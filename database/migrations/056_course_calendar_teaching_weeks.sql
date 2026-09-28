-- Nullable by design: old calendars must not silently assume a 16-week semester.
-- Runtime schema initialization may have added the column before deployment migration.
SET @freebbs_056_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'campus_course_calendar_settings'
     AND COLUMN_NAME = 'teaching_weeks') = 0,
  'ALTER TABLE campus_course_calendar_settings ADD COLUMN teaching_weeks TINYINT UNSIGNED NULL AFTER first_week_monday',
  'SELECT 1'
);
PREPARE freebbs_056_statement FROM @freebbs_056_sql;
EXECUTE freebbs_056_statement;
DEALLOCATE PREPARE freebbs_056_statement;
