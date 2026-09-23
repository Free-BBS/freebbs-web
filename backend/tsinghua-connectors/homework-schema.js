const HOMEWORK_TABLES = [
  `CREATE TABLE IF NOT EXISTS campus_homework_calendar_states (
    user_id BIGINT NOT NULL,
    homework_reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    completed TINYINT(1) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, homework_reference),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS campus_homework_snapshots (
    user_id BIGINT NOT NULL,
    connector_generation INT UNSIGNED NOT NULL,
    semester_id VARCHAR(32) NOT NULL,
    homework_json JSON NOT NULL,
    sync_status ENUM('complete', 'partial') NOT NULL DEFAULT 'complete',
    fetched_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, connector_generation, semester_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

module.exports = { HOMEWORK_TABLES };
