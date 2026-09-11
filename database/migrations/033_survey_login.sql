SET @survey_schema_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'surveys' AND COLUMN_NAME = 'requires_login');
SET @survey_schema_sql := IF(@survey_schema_exists = 0,
    'ALTER TABLE surveys ADD COLUMN requires_login TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE survey_schema_stmt FROM @survey_schema_sql;
EXECUTE survey_schema_stmt;
DEALLOCATE PREPARE survey_schema_stmt;

SET @survey_schema_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'survey_entries' AND COLUMN_NAME = 'user_id');
SET @survey_schema_sql := IF(@survey_schema_exists = 0,
    'ALTER TABLE survey_entries ADD COLUMN user_id BIGINT NULL', 'SELECT 1');
PREPARE survey_schema_stmt FROM @survey_schema_sql;
EXECUTE survey_schema_stmt;
DEALLOCATE PREPARE survey_schema_stmt;

SET @survey_schema_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'survey_entries' AND INDEX_NAME = 'survey_user');
SET @survey_schema_sql := IF(@survey_schema_exists = 0,
    'ALTER TABLE survey_entries ADD UNIQUE KEY survey_user (survey_id, user_id)', 'SELECT 1');
PREPARE survey_schema_stmt FROM @survey_schema_sql;
EXECUTE survey_schema_stmt;
DEALLOCATE PREPARE survey_schema_stmt;
