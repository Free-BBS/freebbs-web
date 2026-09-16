CREATE TABLE IF NOT EXISTS economy_account_state (
  user_id BIGINT PRIMARY KEY,
  fed_until_ms BIGINT NOT NULL DEFAULT 0,
  luck_until_ms BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_economy_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS economy_rewards (
  user_id BIGINT NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  reward_day DATE NOT NULL,
  amount INT NOT NULL,
  category VARCHAR(24) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source_key),
  INDEX idx_reward_day (user_id, reward_day, category),
  CONSTRAINT fk_economy_reward_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS economy_migrations (
  version_key VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
