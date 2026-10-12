CREATE TABLE IF NOT EXISTS learning_star_awards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL,
  node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  star_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_version CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  question_version VARCHAR(64) NULL,
  evidence_json MEDIUMTEXT NOT NULL,
  earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_learning_star_owner (user_id, course_id, node_id, star_key),
  KEY idx_learning_star_course (user_id, course_id, earned_at),
  CONSTRAINT fk_learning_star_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_star_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
