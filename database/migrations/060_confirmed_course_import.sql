-- Capture existing courses once. Future snapshots require explicit confirmation.
SET @freebbs_060_missing = (
 SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
 AND TABLE_NAME = 'campus_learn_semester_snapshots' AND COLUMN_NAME = 'calendar_copy_json'
) = 0;
SET @freebbs_060_sql = IF(@freebbs_060_missing,
 'ALTER TABLE campus_learn_semester_snapshots ADD COLUMN calendar_copy_json JSON NULL', 'SELECT 1');
PREPARE freebbs_060_statement FROM @freebbs_060_sql;
EXECUTE freebbs_060_statement;
DEALLOCATE PREPARE freebbs_060_statement;
SET @freebbs_060_sql = IF(@freebbs_060_missing,
 'UPDATE campus_learn_semester_snapshots s
  LEFT JOIN campus_course_calendar_settings settings
    ON settings.user_id = s.user_id AND settings.semester_id = s.semester_id
    AND settings.connector_generation > 0
  SET s.calendar_copy_json = JSON_OBJECT(
    ''courses'', s.courses_json, ''generation'', s.connector_generation,
    ''fetchedAt'', DATE_FORMAT(s.fetched_at, ''%Y-%m-%dT%H:%i:%s.000Z''),
    ''firstWeekMonday'', COALESCE(DATE_FORMAT(settings.first_week_monday, ''%Y-%m-%d''),
      IF(s.semester_id = ''2026-2027-1'', ''2026-09-14'', NULL)),
    ''teachingWeeks'', COALESCE(settings.teaching_weeks,
      IF(s.semester_id = ''2026-2027-1'', 16, NULL)),
    ''options'', COALESCE(settings.options_json,
      IF(s.semester_id = ''2026-2027-1'' AND
        (settings.first_week_monday IS NULL OR settings.first_week_monday = ''2026-09-14''),
        JSON_OBJECT(''holidayPreset'', ''tsinghua-2026-autumn''), JSON_OBJECT()))
  )
  WHERE s.calendar_copy_json IS NULL AND s.connector_generation > 0', 'SELECT 1');
PREPARE freebbs_060_statement FROM @freebbs_060_sql;
EXECUTE freebbs_060_statement;
DEALLOCATE PREPARE freebbs_060_statement;
