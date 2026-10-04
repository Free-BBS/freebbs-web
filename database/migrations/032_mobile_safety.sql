CREATE TABLE IF NOT EXISTS mobile_user_blocks (
    user_id BIGINT NOT NULL,
    blocked_user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, blocked_user_id),
    CONSTRAINT fk_mobile_blocks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_mobile_blocks_target FOREIGN KEY (blocked_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mobile_content_reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    reporter_id BIGINT NULL,
    target_type ENUM('post', 'comment') NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    reason ENUM('abuse', 'inappropriate', 'spam', 'privacy', 'other') NOT NULL,
    detail VARCHAR(2000) NOT NULL DEFAULT '',
    status ENUM('pending', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
    resolution VARCHAR(2000) NOT NULL DEFAULT '',
    reviewed_by BIGINT NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mobile_reports_user FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_mobile_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_mobile_reports_status (status, created_at),
    INDEX idx_mobile_reports_reporter (reporter_id, created_at)
);

CREATE TABLE IF NOT EXISTS mobile_account_deletion_requests (
    user_id BIGINT PRIMARY KEY,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mobile_deletion_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
