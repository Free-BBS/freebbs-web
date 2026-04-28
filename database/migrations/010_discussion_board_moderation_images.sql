SET @board_description_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_boards'
      AND COLUMN_NAME = 'description_markdown'
);

SET @add_board_description_sql := IF(
    @board_description_column_exists = 0,
    'ALTER TABLE discussion_boards ADD COLUMN description_markdown MEDIUMTEXT NULL AFTER description',
    'SELECT 1'
);

PREPARE add_board_description_stmt FROM @add_board_description_sql;
EXECUTE add_board_description_stmt;
DEALLOCATE PREPARE add_board_description_stmt;

SET @post_pin_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_posts'
      AND COLUMN_NAME = 'is_pinned'
);

SET @add_post_pin_sql := IF(
    @post_pin_column_exists = 0,
    'ALTER TABLE discussion_posts ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER content_markdown, ADD COLUMN pinned_at DATETIME NULL AFTER is_pinned, ADD COLUMN pinned_by BIGINT NULL AFTER pinned_at, ADD INDEX idx_discussion_posts_pinned_created_at (is_pinned, pinned_at DESC, created_at DESC)',
    'SELECT 1'
);

PREPARE add_post_pin_stmt FROM @add_post_pin_sql;
EXECUTE add_post_pin_stmt;
DEALLOCATE PREPARE add_post_pin_stmt;

CREATE TABLE IF NOT EXISTS discussion_board_moderators (
    board_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (board_id, user_id),
    CONSTRAINT fk_discussion_board_moderators_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_discussion_board_moderators_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_discussion_board_moderators_user (user_id)
);

INSERT INTO discussion_boards (slug, name, description, description_markdown, sort_order, is_active)
VALUES
    ('changelog', '更新日志', '站点更新、修复与版本记录', 'FREE-BBS 的站点更新、修复与版本记录。这里用于同步功能变化和维护信息。', 50, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    description_markdown = COALESCE(discussion_boards.description_markdown, VALUES(description_markdown)),
    sort_order = VALUES(sort_order),
    is_active = VALUES(is_active);
