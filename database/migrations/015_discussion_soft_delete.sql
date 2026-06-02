SET @discussion_posts_deleted_column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'discussion_posts'
    AND COLUMN_NAME = 'is_deleted'
);

SET @discussion_posts_deleted_migration_sql := IF(
  @discussion_posts_deleted_column_exists = 0,
  'ALTER TABLE discussion_posts
     ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER featured_by,
     ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted,
     ADD COLUMN deleted_by BIGINT NULL AFTER deleted_at,
     ADD INDEX idx_discussion_posts_deleted_created_at (is_deleted, created_at DESC)',
  'SELECT 1'
);

PREPARE discussion_posts_deleted_migration_stmt FROM @discussion_posts_deleted_migration_sql;
EXECUTE discussion_posts_deleted_migration_stmt;
DEALLOCATE PREPARE discussion_posts_deleted_migration_stmt;
