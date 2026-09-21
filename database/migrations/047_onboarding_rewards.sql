-- One permanent reward per account, regardless of guide releases or manual replay.
-- guide_version is audit evidence only and must never become part of the claim key.
CREATE TABLE IF NOT EXISTS onboarding_rewards (
  user_id BIGINT NOT NULL,
  guide_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  electric BIGINT NOT NULL,
  magnetic BIGINT NOT NULL,
  claimed_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_onboarding_rewards_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
