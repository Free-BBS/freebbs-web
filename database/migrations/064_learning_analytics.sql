CREATE TABLE IF NOT EXISTS learning_analytics_preferences (
  user_id BIGINT NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_engagement_at DATETIME(3) NULL,
  browser_window_started_at DATETIME(3) NULL,
  browser_event_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_learning_analytics_preferences_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL,
  node_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(20) NOT NULL,
  event_source VARCHAR(10) NOT NULL,
  delta_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json JSON NOT NULL,
  request_key CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_learning_analytics_request (user_id, request_key),
  KEY idx_learning_analytics_owner (user_id, created_at, id),
  KEY idx_learning_analytics_course (course_id, created_at, user_id),
  KEY idx_learning_analytics_retention (created_at, id),
  CONSTRAINT fk_learning_analytics_event_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_analytics_event_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
