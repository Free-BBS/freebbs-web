SET @column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_comments'
      AND COLUMN_NAME = 'parent_comment_id'
);

SET @migration_sql := IF(
    @column_exists = 0,
    'ALTER TABLE discussion_comments
        ADD COLUMN parent_comment_id BIGINT NULL AFTER post_id,
        ADD INDEX idx_discussion_comments_parent (parent_comment_id),
        ADD CONSTRAINT fk_discussion_comments_parent
            FOREIGN KEY (parent_comment_id) REFERENCES discussion_comments (id)
            ON DELETE CASCADE',
    'SELECT 1'
);

PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
