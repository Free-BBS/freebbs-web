CREATE TABLE IF NOT EXISTS ai_background_tasks (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id BIGINT NOT NULL,
    kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_id VARCHAR(190) NOT NULL DEFAULT '',
    payload_json LONGTEXT NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'queued',
    progress_json TEXT NULL,
    result_json LONGTEXT NULL,
    error_message VARCHAR(1000) NULL,
    watching TINYINT(1) NOT NULL DEFAULT 1,
    acknowledged_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ai_background_tasks_user_latest (user_id, kind, scope_id, created_at),
    INDEX idx_ai_background_tasks_queue (status, created_at),
    CONSTRAINT fk_ai_background_tasks_user
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
