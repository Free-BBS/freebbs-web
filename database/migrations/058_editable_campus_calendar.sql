-- Personal changes remain isolated by both platform user and campus binding generation.
CREATE TABLE IF NOT EXISTS campus_schedule_overrides (
  user_id BIGINT NOT NULL,
  connector_generation INT UNSIGNED NOT NULL,
  public_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  patch_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 2,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, connector_generation, public_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
SET @freebbs_058_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campus_course_calendar_settings'
     AND COLUMN_NAME = 'options_json') = 0,
  'ALTER TABLE campus_course_calendar_settings ADD COLUMN options_json JSON NULL',
  'SELECT 1'
);
PREPARE freebbs_058_statement FROM @freebbs_058_sql;
EXECUTE freebbs_058_statement;
DEALLOCATE PREPARE freebbs_058_statement;
