SET @uid_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'uid'
);

SET @add_uid_column_sql := IF(
    @uid_column_exists = 0,
    'ALTER TABLE users ADD COLUMN uid VARCHAR(32) NULL AFTER id, ADD UNIQUE KEY uq_users_uid (uid)',
    'SELECT 1'
);

PREPARE add_uid_column_stmt FROM @add_uid_column_sql;
EXECUTE add_uid_column_stmt;
DEALLOCATE PREPARE add_uid_column_stmt;

UPDATE users
SET uid = CONCAT('u_', LPAD(CONV(id, 10, 36), 8, '0'))
WHERE uid IS NULL OR uid = '';

SET @uid_unique_index_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'uid'
      AND NON_UNIQUE = 0
);

SET @add_uid_index_sql := IF(
    @uid_unique_index_exists = 0,
    'ALTER TABLE users ADD UNIQUE KEY uq_users_uid (uid)',
    'SELECT 1'
);

PREPARE add_uid_index_stmt FROM @add_uid_index_sql;
EXECUTE add_uid_index_stmt;
DEALLOCATE PREPARE add_uid_index_stmt;
