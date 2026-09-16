CREATE TABLE IF NOT EXISTS admin_reward_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_id BIGINT NOT NULL,
  request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(80) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  electric BIGINT NOT NULL,
  magnetic BIGINT NOT NULL,
  recipient_count INT NOT NULL,
  result_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_reward_request (actor_id, request_id)
);

CREATE TABLE IF NOT EXISTS admin_reward_entries (
  batch_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username VARCHAR(120) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  student_id VARCHAR(64) NOT NULL,
  electric_before BIGINT NOT NULL,
  electric_after BIGINT NOT NULL,
  magnetic_before BIGINT NOT NULL,
  magnetic_after BIGINT NOT NULL,
  PRIMARY KEY (batch_id, user_id),
  INDEX idx_reward_user (user_id, batch_id),
  CONSTRAINT fk_admin_reward_batch FOREIGN KEY (batch_id) REFERENCES admin_reward_batches (id)
);
