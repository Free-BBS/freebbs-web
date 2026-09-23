CREATE TABLE IF NOT EXISTS campus_homework_snapshots (
    user_id BIGINT NOT NULL,
    connector_generation INT UNSIGNED NOT NULL,
    semester_id VARCHAR(32) NOT NULL,
    homework_json JSON NOT NULL,
    sync_status ENUM('complete', 'partial') NOT NULL DEFAULT 'complete',
    fetched_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, connector_generation, semester_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
