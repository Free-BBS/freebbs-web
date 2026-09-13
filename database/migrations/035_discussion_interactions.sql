SET @interaction_sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discussion_posts' AND COLUMN_NAME = 'is_anonymous') = 0, 'ALTER TABLE discussion_posts ADD COLUMN is_anonymous TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE interaction_stmt FROM @interaction_sql;
EXECUTE interaction_stmt;
DEALLOCATE PREPARE interaction_stmt;

SET @interaction_sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discussion_comments' AND COLUMN_NAME = 'is_deleted') = 0, 'ALTER TABLE discussion_comments ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE interaction_stmt FROM @interaction_sql;
EXECUTE interaction_stmt;
DEALLOCATE PREPARE interaction_stmt;

SET @interaction_sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discussion_comments' AND COLUMN_NAME = 'deleted_at') = 0, 'ALTER TABLE discussion_comments ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE interaction_stmt FROM @interaction_sql;
EXECUTE interaction_stmt;
DEALLOCATE PREPARE interaction_stmt;

SET @interaction_sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discussion_comments' AND COLUMN_NAME = 'deleted_by') = 0, 'ALTER TABLE discussion_comments ADD COLUMN deleted_by BIGINT NULL', 'SELECT 1');
PREPARE interaction_stmt FROM @interaction_sql;
EXECUTE interaction_stmt;
DEALLOCATE PREPARE interaction_stmt;

CREATE TABLE IF NOT EXISTS discussion_comment_likes (
  comment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id),
  CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES discussion_comments(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
