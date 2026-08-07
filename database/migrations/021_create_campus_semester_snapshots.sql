CREATE TABLE IF NOT EXISTS campus_learn_semester_snapshots (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    semester_id VARCHAR(32) NOT NULL,
    courses_json JSON NOT NULL,
    notifications_json JSON NOT NULL,
    sync_status ENUM('complete', 'partial') NOT NULL DEFAULT 'complete',
    fetched_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_learn_semester_snapshots_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_campus_learn_semester_user (user_id, semester_id),
    INDEX idx_campus_learn_semester_user_fetched (user_id, fetched_at DESC)
);
