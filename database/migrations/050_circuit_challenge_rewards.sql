SET @challenge_reward_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'circuit_challenges'
     AND COLUMN_NAME = 'reward_electric') = 0,
  'ALTER TABLE circuit_challenges ADD COLUMN reward_electric INT UNSIGNED NOT NULL DEFAULT 0 AFTER tolerance',
  'SELECT 1'
);
PREPARE challenge_reward_stmt FROM @challenge_reward_sql;
EXECUTE challenge_reward_stmt;
DEALLOCATE PREPARE challenge_reward_stmt;

SET @challenge_reward_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'circuit_challenge_submissions'
     AND COLUMN_NAME = 'completion_reward') = 0,
  'ALTER TABLE circuit_challenge_submissions ADD COLUMN completion_reward INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_score',
  'SELECT 1'
);
PREPARE challenge_reward_stmt FROM @challenge_reward_sql;
EXECUTE challenge_reward_stmt;
DEALLOCATE PREPARE challenge_reward_stmt;

SET @challenge_reward_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'circuit_challenge_submissions'
     AND COLUMN_NAME = 'record_reward') = 0,
  'ALTER TABLE circuit_challenge_submissions ADD COLUMN record_reward INT UNSIGNED NOT NULL DEFAULT 0 AFTER completion_reward',
  'SELECT 1'
);
PREPARE challenge_reward_stmt FROM @challenge_reward_sql;
EXECUTE challenge_reward_stmt;
DEALLOCATE PREPARE challenge_reward_stmt;
