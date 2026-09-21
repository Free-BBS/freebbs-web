-- Guide progress only; visiting a page is not evidence of learning or a reward claim.
CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id BIGINT NOT NULL,
  guide_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('not_started', 'in_progress', 'skipped', 'completed') NOT NULL DEFAULT 'not_started',
  current_step SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  completed_tasks_json JSON NOT NULL,
  seen_at_ms BIGINT NOT NULL,
  completed_at_ms BIGINT NULL,
  dismissed_at_ms BIGINT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, guide_version),
  CONSTRAINT fk_user_onboarding_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
