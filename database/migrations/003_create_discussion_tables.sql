CREATE TABLE IF NOT EXISTS discussion_boards (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(255) NULL,
    description_markdown MEDIUMTEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discussion_posts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    pid VARCHAR(32) NULL UNIQUE,
    board_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    content_markdown MEDIUMTEXT NOT NULL,
    is_pinned TINYINT(1) NOT NULL DEFAULT 0,
    pinned_at DATETIME NULL,
    pinned_by BIGINT NULL,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    featured_at DATETIME NULL,
    featured_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_discussion_posts_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_discussion_posts_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_discussion_posts_pinned_by
        FOREIGN KEY (pinned_by) REFERENCES users (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_discussion_posts_featured_by
        FOREIGN KEY (featured_by) REFERENCES users (id)
        ON DELETE SET NULL,
    INDEX idx_discussion_posts_featured_created_at (is_featured, featured_at DESC, created_at DESC),
    INDEX idx_discussion_posts_pinned_created_at (is_pinned, pinned_at DESC, created_at DESC),
    INDEX idx_discussion_posts_board_created_at (board_id, created_at DESC),
    INDEX idx_discussion_posts_created_at (created_at DESC)
);

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
    ('daily', '日常', '生活、课程与校园碎碎念', '生活、课程与校园碎碎念。可以分享日常、提问、吐槽和轻量讨论。', 10, 1),
    ('math', '数理', '数学、物理与推导讨论', '数学、物理与推导讨论。支持 Markdown 与 KaTeX，例如 `$E=mc^2$`。', 20, 1),
    ('circuit', '电路', '模电、数电与硬件实现', '模电、数电与硬件实现相关内容。建议附上电路图、波形、公式或关键参数。', 30, 1),
    ('signal', '信号', '信号、系统与通信方向讨论', '信号、系统与通信方向讨论。可以贴推导、代码、仿真结果和参考资料。', 40, 1),
    ('changelog', '更新日志', '站点更新、修复与版本记录', 'FREE-BBS 的站点更新、修复与版本记录。这里用于同步功能变化和维护信息。', 50, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    description_markdown = COALESCE(discussion_boards.description_markdown, VALUES(description_markdown)),
    sort_order = VALUES(sort_order),
    is_active = VALUES(is_active);
