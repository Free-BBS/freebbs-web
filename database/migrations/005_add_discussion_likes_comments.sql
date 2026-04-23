CREATE TABLE IF NOT EXISTS discussion_post_likes (
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_discussion_post_likes_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_discussion_post_likes_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_discussion_post_likes_user (user_id)
);

CREATE TABLE IF NOT EXISTS discussion_comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    author_student_id VARCHAR(10) NULL,
    content_markdown TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_discussion_comments_post
        FOREIGN KEY (post_id) REFERENCES discussion_posts (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_discussion_comments_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_discussion_comments_post_created_at (post_id, created_at ASC),
    INDEX idx_discussion_comments_user (user_id)
);

