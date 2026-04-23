CREATE TABLE IF NOT EXISTS discussion_boards (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discussion_posts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    board_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    content_markdown MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_discussion_posts_board
        FOREIGN KEY (board_id) REFERENCES discussion_boards (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_discussion_posts_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_discussion_posts_board_created_at (board_id, created_at DESC),
    INDEX idx_discussion_posts_created_at (created_at DESC)
);

INSERT INTO discussion_boards (slug, name, description, sort_order, is_active)
VALUES
    ('daily', '日常', '生活、课程与校园碎碎念', 10, 1),
    ('math', '数理', '数学、物理与推导讨论', 20, 1),
    ('circuit', '电路', '模电、数电与硬件实现', 30, 1),
    ('signal', '信号', '信号、系统与通信方向讨论', 40, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    sort_order = VALUES(sort_order),
    is_active = VALUES(is_active);
