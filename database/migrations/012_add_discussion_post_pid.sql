SET @post_pid_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_posts'
      AND COLUMN_NAME = 'pid'
);

SET @add_post_pid_column_sql := IF(
    @post_pid_column_exists = 0,
    'ALTER TABLE discussion_posts ADD COLUMN pid VARCHAR(32) NULL AFTER id',
    'SELECT 1'
);

PREPARE add_post_pid_column_stmt FROM @add_post_pid_column_sql;
EXECUTE add_post_pid_column_stmt;
DEALLOCATE PREPARE add_post_pid_column_stmt;

UPDATE discussion_posts
SET pid = CONCAT('p_', LPAD(CONV(id, 10, 36), 8, '0'))
WHERE pid IS NULL OR pid = '';

SET @post_pid_unique_index_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_posts'
      AND COLUMN_NAME = 'pid'
      AND NON_UNIQUE = 0
);

SET @add_post_pid_index_sql := IF(
    @post_pid_unique_index_exists = 0,
    'ALTER TABLE discussion_posts ADD UNIQUE KEY uq_discussion_posts_pid (pid)',
    'SELECT 1'
);

PREPARE add_post_pid_index_stmt FROM @add_post_pid_index_sql;
EXECUTE add_post_pid_index_stmt;
DEALLOCATE PREPARE add_post_pid_index_stmt;
