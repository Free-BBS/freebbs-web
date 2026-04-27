SET @column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_post_likes'
      AND COLUMN_NAME = 'reaction_type'
);

SET @migration_sql := IF(
    @column_exists = 0,
    'ALTER TABLE discussion_post_likes
        ADD COLUMN reaction_type VARCHAR(24) NOT NULL DEFAULT ''smile'' AFTER user_id,
        DROP PRIMARY KEY,
        ADD PRIMARY KEY (post_id, user_id, reaction_type)',
    'SELECT 1'
);

PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
