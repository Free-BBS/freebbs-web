CREATE TABLE IF NOT EXISTS user_profile_extras (
  user_id BIGINT PRIMARY KEY,
  equipped_json JSON NOT NULL,
  adopted TINYINT NOT NULL DEFAULT 0,
  last_feed_day VARCHAR(10) NOT NULL DEFAULT '',
  revision BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_profile_extras_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_profile_actions (
  user_id BIGINT NOT NULL,
  request_key VARCHAR(64) NOT NULL,
  fingerprint VARCHAR(512) NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, request_key),
  CONSTRAINT fk_profile_actions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
