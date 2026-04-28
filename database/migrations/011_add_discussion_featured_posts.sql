SET @post_feature_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_posts'
      AND COLUMN_NAME = 'is_featured'
);

SET @add_post_feature_sql := IF(
    @post_feature_column_exists = 0,
    'ALTER TABLE discussion_posts ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER pinned_by, ADD COLUMN featured_at DATETIME NULL AFTER is_featured, ADD COLUMN featured_by BIGINT NULL AFTER featured_at, ADD INDEX idx_discussion_posts_featured_created_at (is_featured, featured_at DESC, created_at DESC)',
    'SELECT 1'
);

PREPARE add_post_feature_stmt FROM @add_post_feature_sql;
EXECUTE add_post_feature_stmt;
DEALLOCATE PREPARE add_post_feature_stmt;
