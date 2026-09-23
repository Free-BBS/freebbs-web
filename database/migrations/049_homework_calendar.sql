CREATE TABLE IF NOT EXISTS campus_homework_calendar_states (
    user_id BIGINT NOT NULL,
    homework_reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    completed TINYINT(1) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, homework_reference),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
